import { parse } from 'csv-parse';
import fs from "fs/promises";
import jsonBg from "json-bigint";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { NETWORK_YARGS_OPTIONS, getApiFor } from "./utils/network";

const JSONbig = jsonBg({ useNativeBigInt: true });

type DataType = {
    address: string;
    purpose: string;
    balance: number;
    circulating: string;
    stake: string;
    used: string;
    multisigAssigned: string;
  };

yargs(hideBin(process.argv))
  .usage("Usage: $0")
  .version("1.0.0")
  .command(
    `verify`,
    "verifies a set of balances given by a excel sheet",
    (yargs) => {
      return yargs
        .options({
            ...NETWORK_YARGS_OPTIONS,
            "file": {
                describe: "Input path of excel file with balances",
                type: "string"
            },
        })
        .demandOption(["file"]);
    },
    async (argv) => {
        const fileContent = await fs.readFile(argv["file"]!, { encoding: 'utf-8' });
        const headers = ['Address', 'Purpose', 'Balance', 'Circulating', "Stake?", "Used", "Multisig Assigned"];
        try {

            parse(fileContent, {
            delimiter: ',',
            columns: headers,
            from_line: 4,
            to_line: 151,
            }, async (error, result: DataType[]) => {
            if (error) {
                console.error(error);
            }
            const api = await getApiFor(argv);


            // remove first element as it is header
            result.shift()

            const chain = api.runtimeChain.toString();

            for (var item of result) {
                const address = item["Address"];
                const balance = item["Balance"].replace(/\,/g,'').replace(/\./g,'');
                if(chain == 'Moonlight' && (item['Purpose'].includes('Sudo') || item['Purpose'].includes('Operator'))) {
                    continue;
                }

                // In the excel all numbers have 2 decimals
                // we trail 10 zeroes since the number of tanssi decimals is 12
                const balanceFormatted = balance.padEnd(balance.length +10, "0");
                const balanceData = (await api.query.system.account(address)) as any;
                const balanceOnChain =  balanceData.data.free;
                if(balanceOnChain.toString() != balanceFormatted) {
                    throw new Error(`Balance for account ${address} has distinct balances in file ${balanceFormatted} and onchain ${balanceOnChain}`);
                }
            }
            console.log("All balances are correct!")
            await api.disconnect();
            });
        }
        finally {
            
        }

    }
  )
  .parse();