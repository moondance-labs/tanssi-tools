import fs from "fs/promises";
import yargs from "yargs";
import { Keyring } from "@polkadot/api";
import { KeyringPair } from "@polkadot/keyring/types";
import { hideBin } from "yargs/helpers";
import jsonBg from "json-bigint";
import { chainSpecToContainerChainGenesisData } from "../util/genesis_data";
import { NETWORK_YARGS_OPTIONS, getApiFor } from "./utils/network";
const JSONbig = jsonBg({ useNativeBigInt: true });

yargs(hideBin(process.argv))
  .usage("Usage: $0")
  .version("1.0.0")
  .command(
    `registerForCollation`,
    "Registers a parachain, adds bootnodes, and sets it valid for collating",
    (yargs) => {
      return yargs
        .options({
            ...NETWORK_YARGS_OPTIONS,
            "account-priv-key": {
                type: "string",
                demandOption: false,
                alias: "account",
            },
            "chain": {
                describe: "Input path of raw chainSpec file",
                type: "string",
            }
        })
        .demandOption(["chain", "account-priv-key"]);
    },
    async (argv) => {
        const api = await getApiFor(argv);
        const keyring = new Keyring({ type: 'sr25519' });

        try {
            process.stdout.write(`Reading chainSpec from: ${argv.chain}\n`);
            const rawSpec = JSONbig.parse(await fs.readFile(argv.chain!, "utf8"));
    
            let account: KeyringPair;
            const privKey = argv["account-priv-key"];
            account = keyring.addFromUri(privKey);

            const containerChainGenesisData = chainSpecToContainerChainGenesisData(api, rawSpec);
            const txs = [];
            const tx1 = api.tx.registrar.register(rawSpec.para_id, containerChainGenesisData);
            txs.push(tx1);
            if (rawSpec.bootNodes?.length) {
                const tx2 = api.tx.registrar.setBootNodes(rawSpec.para_id, rawSpec.bootNodes);
                const tx2s = api.tx.sudo.sudo(tx2);
                txs.push(tx2s);
            }
            const tx3 = api.tx.registrar.markValidForCollating(rawSpec.para_id);
            const tx3s = api.tx.sudo.sudo(tx3);
            txs.push(tx3s);

            if (txs.length == 2) {
                process.stdout.write(`Sending register transaction (register + markValidForCollating)... `);
            } else {
                process.stdout.write(`Sending register transaction (register + setBootNodes + markValidForCollating)... `);
            }
            const txBatch = api.tx.utility.batchAll(txs);
            const txHash = await txBatch.signAndSend(account);
            process.stdout.write(`${txHash.toHex()}\n`);
            // TODO: this will always print Done, even if the extrinsic has failed
            process.stdout.write(`Done ✅\n`);
        } finally {
            await api.disconnect();
        }
    }
  )
  .command(
    `register`,
    "Registers a parachain, but does not mark it as valid for collation",
    (yargs) => {
      return yargs
        .options({
            ...NETWORK_YARGS_OPTIONS,
            "account-priv-key": {
                type: "string",
                demandOption: false,
                alias: "account",
            },
            "chain": {
                describe: "Input path of raw chainSpec file",
                type: "string",
            }
        })
        .demandOption(["chain", "account-priv-key"]);
    },
    async (argv) => {
        const api = await getApiFor(argv);
        const keyring = new Keyring({ type: 'sr25519' });

        try {
            process.stdout.write(`Reading chainSpec from: ${argv.chain}\n`);
            const rawSpec = JSONbig.parse(await fs.readFile(argv.chain!, "utf8"));
    
            let account: KeyringPair;
            const privKey = argv["account-priv-key"];
            account = keyring.addFromUri(privKey);

            const containerChainGenesisData = chainSpecToContainerChainGenesisData(api, rawSpec);
            const txs = [];
            const tx1 = api.tx.registrar.register(rawSpec.para_id, containerChainGenesisData);
            txs.push(tx1);
            const txBatch = api.tx.utility.batchAll(txs);
            const txHash = await txBatch.signAndSend(account);
            process.stdout.write(`${txHash.toHex()}\n`);
            // TODO: this will always print Done, even if the extrinsic has failed
            process.stdout.write(`Done ✅\n`);
        } finally {
            await api.disconnect();
        }
    }
  )
  .command(
    `markValidForCollating`,
    "Marks a registered parachain as valid, allowing collators to start collating",
    (yargs) => {
      return yargs
        .options({
            ...NETWORK_YARGS_OPTIONS,
            "account-priv-key": {
                type: "string",
                demandOption: false,
                alias: "account",
            },
            "para-id": {
                describe: "Container chain para id",
                type: "number",
            }
        })
        .demandOption(["para-id", "account-priv-key"]);
    },
    async (argv) => {
        const api = await getApiFor(argv);
        const keyring = new Keyring({ type: 'sr25519' });

        try {    
            let account: KeyringPair;
            const privKey = argv["account-priv-key"];
            account = keyring.addFromUri(privKey);

            let tx = api.tx.registrar.markValidForCollating(argv.paraId);
            tx = api.tx.sudo.sudo(tx);
            process.stdout.write(`Sending transaction... `);
            const txHash = await tx.signAndSend(account);
            process.stdout.write(`${txHash.toHex()}\n`);
            // TODO: this will always print Done, even if the extrinsic has failed
            process.stdout.write(`Done ✅\n`);
        } finally {
            await api.disconnect();
        }
    }
  )
  .command(
    `setBootNodes`,
    "Set bootnodes for a container chain",
    (yargs) => {
      return yargs
        .options({
            ...NETWORK_YARGS_OPTIONS,
            "account-priv-key": {
                type: "string",
                demandOption: false,
                alias: "account",
            },
            "para-id": {
                describe: "Container chain para id",
                type: "number",
            },
            "bootnode": {
                describe: "Container chain para id",
                type: "string",
            },
        })
        .demandOption(["para-id", "account-priv-key"]);
    },
    async (argv) => {
        const api = await getApiFor(argv as any);
        const keyring = new Keyring({ type: 'sr25519' });

        try {    
            let account: KeyringPair;
            const privKey = argv["account-priv-key"];
            account = keyring.addFromUri(privKey);

            // Creates the data preserver profile
            let tx1 = api.tx.dataPreservers.createProfile( 
                {
                    url: argv.bootnode, 
                    paraIds: {
                        WhiteList: [ argv.paraId ]
                    }, 
                    mode: 'Bootnode', 
                    assignmentRequest: 'Free' 
                } );

            let txHash = await tx1.signAndSend(account);
            console.log(`profile create, tx hash ${txHash.toHex()}`);
              
            await new Promise(f => setTimeout(f, 10000));

            // Queries the data preserver profile id, required for assignation
            const profiles = await api.query.dataPreservers.profiles.entries();
            const profile = profiles.find(profile => {
                const profileparaid = (profile[1].toJSON() as any).profile.paraIds.whitelist[0];

                if (profileparaid == argv.paraId)
                    return profile;
            });
            const profileId = profile[0].toHuman()[0];
            
            // Assigns the profile
            let tx2 = api.tx.dataPreservers.forceStartAssignment(profileId, argv.paraId, 'Free');
            let tx2s = api.tx.sudo.sudo(tx2);
            
            txHash = await tx2s.signAndSend(account);
            process.stdout.write(`Profile assigned, tx hash ${txHash.toHex()}\n`);


            process.stdout.write(`Done ✅\n`);
        } finally {
            await api.disconnect();
        }
    }
  )
  .command(
    `deregister`,
    "Deregister a container chain",
    (yargs) => {
      return yargs
        .options({
            ...NETWORK_YARGS_OPTIONS,
            "account-priv-key": {
                type: "string",
                demandOption: false,
                alias: "account",
            },
            "para-id": {
                describe: "Container chain para id",
                type: "number",
            },
        })
        .demandOption(["para-id", "account-priv-key"]);
    },
    async (argv) => {
        const api = await getApiFor(argv as any);
        const keyring = new Keyring({ type: 'sr25519' });

        try {    
            let account: KeyringPair;
            const privKey = argv["account-priv-key"];
            account = keyring.addFromUri(privKey);

            let tx = api.tx.registrar.deregister(argv.paraId);
            tx = api.tx.sudo.sudo(tx);
            process.stdout.write(`Sending transaction... `);
            const txHash = await tx.signAndSend(account);
            process.stdout.write(`${txHash.toHex()}\n`);
            // TODO: this will always print Done, even if the extrinsic has failed
            process.stdout.write(`Done ✅\n`);
        } finally {
            await api.disconnect();
        }
    }
  )
  .parse();