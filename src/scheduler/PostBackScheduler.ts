import { Config } from "../common/Config";
import { logger } from "../common/Logger";
import { PostBackStorage } from "../storage/PostBackStorage";
import { ProvisionStatus } from "../types";
import { Scheduler } from "./Scheduler";

import { BOACoin, NetWorkType, ProviderClient } from "kios-service-sdk";

import { ethers } from "ethers";

export class PostBackScheduler extends Scheduler {
    private _config: Config | undefined;
    private _storage: PostBackStorage | undefined;
    private _provider: ethers.providers.JsonRpcProvider | undefined;

    constructor(expression: string) {
        super(expression);
    }

    private get config(): Config {
        if (this._config !== undefined) return this._config;
        else {
            logger.error("Config is not ready yet.");
            process.exit(1);
        }
    }

    private get web3Provider(): ethers.providers.JsonRpcProvider {
        if (this._provider === undefined)
            this._provider = new ethers.providers.JsonRpcProvider(this.config.setting.rpcEndpoint);
        return this._provider;
    }

    private get storage(): PostBackStorage {
        if (this._storage !== undefined) return this._storage;
        else {
            logger.error("Storage is not ready yet.");
            process.exit(1);
        }
    }

    public setOption(options: any) {
        if (options) {
            if (options.config && options.config instanceof Config) this._config = options.config;
            if (options.storage && options.storage instanceof PostBackStorage) this._storage = options.storage;
        }
    }

    public async onStart() {
        //
    }

    protected async work() {
        try {
            await this.onSend();
        } catch (error) {
            logger.error(`Failed to execute the PostBackScheduler: ${error}`);
        }
    }

    private async onSend() {
        const list = await this.storage.getItemsOnStarted(
            this.config.setting.inquiryLimit,
            this.config.setting.delaySecond
        );
        for (const item of list) {
            if (item.user_payout > 0) {
                const provisionItem = this.config.provision.getProvision(item.provider);
                const agent = provisionItem !== undefined ? provisionItem.agent : this.config.setting.agent;

                try {
                    const amount = BOACoin.make(item.user_payout_in_vc).value;
                    logger.info(
                        `Send: user_id: ${item.user_id}, point: ${new BOACoin(
                            amount
                        ).toBOAString()}, user_payout_in_vc: ${item.user_payout_in_vc}, user_payout: ${
                            item.user_payout
                        }, payout: ${item.payout}, provider: ${item.provider}`
                    );

                    const network =
                        this.config.setting.network === "testnet"
                            ? NetWorkType.kios_testnet
                            : this.config.setting.network === "mainnet"
                            ? NetWorkType.kios_mainnet
                            : NetWorkType.kios_mainnet;
                    const providerClient = new ProviderClient(network, agent);
                    if (item.user_id_type === 0) {
                        item.tx_hash = await providerClient.provideToAddress(item.provider, item.user_id, amount);
                    } else {
                        item.tx_hash = await providerClient.provideToPhone(item.provider, item.user_id, amount);
                    }
                    await this.web3Provider.waitForTransaction(item.tx_hash, undefined, 1_000);

                    item.status = ProvisionStatus.Sent;
                    await this.storage.updateItemTxHash(item);
                } catch (error) {
                    logger.error(`Failed to send point: ${error}`);
                }
            } else {
                item.status = ProvisionStatus.Pass;
                await this.storage.updateItem(item);
            }
        }
    }
}
