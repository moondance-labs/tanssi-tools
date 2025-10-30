import yargs from "yargs";
import { NETWORK_YARGS_OPTIONS, getApiFor } from "./utils/network";
import fs from "fs";
import path from "path";
import { decodeAddress } from "@polkadot/util-crypto";
import { parse } from "csv-parse/sync";
import { signFakeWithApi } from "@acala-network/chopsticks-utils";

/* CSV file must have the following format
Genesis Account | Proxy Account | Proxy Type | Delay
Account 1       | Account 2     | Any        | 0
....
*/

const args = (yargs.options({
  ...NETWORK_YARGS_OPTIONS,
  "proxy-dir": {
    describe: "Directory containing CSV files with proxy configurations",
    type: "string",
    demandOption: true,
    alias: ["pd"],
    coerce: (arg: string) => {
      if (!fs.existsSync(arg)) {
        throw new Error(`Proxy directory not found: ${arg}`);
      }
      const stat = fs.statSync(arg);
      if (!stat.isDirectory()) {
        throw new Error(`Provided proxy-dir is not a directory: ${arg}`);
      }
      return arg;
    },
  },
  sudo: {
    describe: "Boolean to use sudo",
    type: "boolean",
    demandOption: false,
    nargs: 0,
  },
  chopsticks: {
    describe: "Chopsticks test (expects endpoint to be ws://localhost:8000",
    type: "boolean",
    demandOption: false,
  },
}).argv) as any;

// Initialize
let batchCall: any[] = [];

function validateCSVStructure(filePath: string): any[] {
  const EXPECTED_HEADERS = [
    "Genesis Account",
    "Proxy Account",
    "Proxy Type",
    "Delay",
  ];

  const content = fs.readFileSync(filePath, "utf-8");

  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  if (records.length === 0) {
    throw new Error(`CSV file is empty: ${filePath}`);
  }

  // Check headers
  const headers = Object.keys(records[0]);
  for (let i = 0; i < EXPECTED_HEADERS.length; i++) {
    if (headers[i] !== EXPECTED_HEADERS[i]) {
      throw new Error(
        `CSV header mismatch in ${filePath}. Expected "${EXPECTED_HEADERS[i]}", got "${headers[i]}" at column ${i + 1}`
      );
    }
  }

  // Validate rows
  for (const [index, row] of records.entries()) {
    const lineNumber = index + 2; // +2 to account for header row

    const genesis = row["Genesis Account"];
    const proxy = row["Proxy Account"];
    const type = row["Proxy Type"];
    const delay = row["Delay"];

    if (!genesis || !proxy || !type || delay === undefined) {
      throw new Error(`Missing field(s) in row ${lineNumber} of ${filePath}`);
    }

    // Validate addresses
    try {
      decodeAddress(genesis);
    } catch {
      throw new Error(`Invalid Genesis Account address at row ${lineNumber} of ${filePath}`);
    }

    try {
      decodeAddress(proxy);
    } catch {
      throw new Error(`Invalid Proxy Account address at row ${lineNumber} of ${filePath}`);
    }

    // Validate Delay is a number
    if (isNaN(Number(delay))) {
      throw new Error(
        `Invalid Delay value (not a number) at row ${lineNumber} of ${filePath}`
      );
    }
  }

  return records;
}

// Create utility dispatch as call in batch
async function utilityDispatchAsCall(api: any, data: any[]) {
  for (let i = 0; i < data.length; i++) {
    const genesisAccount = decodeAddress(data[i]["Genesis Account"]);
    const proxyAccount = decodeAddress(data[i]["Proxy Account"]);
    const proxyType = data[i]["Proxy Type"];
    const delay = BigInt(data[i]["Delay"]);

    const call = api.tx.utility.dispatchAs(
      { system: { Signed: genesisAccount } },
      api.tx.proxy.addProxy(proxyAccount, proxyType, delay)
    );

    batchCall.push(call);
  }

  return batchCall;
}

function collectCSVDataFromDir(directoryPath: string): any[] {
  const files = fs.readdirSync(directoryPath);
  const reOld = /_old(\d+)?$/i;

  const csvFiles = files.filter((file) => {
    const { ext, name } = path.parse(file);
    return ext.toLowerCase() === ".csv" && !reOld.test(name);
  });

  if (csvFiles.length === 0) {
    throw new Error(`No CSV files found in the directory: ${directoryPath}`);
  }

  let allRecords: any[] = [];

  for (const csvFile of csvFiles) {
    if (csvFile === "Genesis_Accounts.csv") {
      console.log(`Skipping file: ${csvFile}`);
      continue; // Skip this file
    }

    const fullPath = path.join(directoryPath, csvFile);
    console.log(`Parsing: ${csvFile}`);
    const records = validateCSVStructure(fullPath);
    allRecords = allRecords.concat(records);
  }

  if (allRecords.length === 0) {
    throw new Error(
      `After filtering and skipping, no valid CSV data was found in directory: ${directoryPath}`
    );
  }

  return allRecords;
}

async function main() {
  // Get API
  const api = await getApiFor(args);
  await api.isReady;

  // Collect & validate data from directory
  const data = collectCSVDataFromDir(args["proxy-dir"]);

  // Create utility dispatch as call in batch
  const batchData = await utilityDispatchAsCall(api, data);

  // Create batch call
  let finalTx = api.tx.utility.batchAll(batchData);

  // Create sudo call
  if (args["sudo"]) {
    console.log(`--- USING SUDO ---`);
    finalTx = api.tx.sudo.sudo(finalTx);
  }

  console.log(`--- FINAL TX ---`);
  console.log(finalTx.toHex());

  // Testing in Chopsticks
  if (args["chopsticks"] && args["sudo"] && args["url"] === "ws://localhost:8000") {
    console.log(`\n--- Chopsticks Testing ws://localhost:8000 ---`);

    // Create Chopsticks API
    const chopsticksAPI = await getApiFor({ url: args["url"] });
    const sudo = (await chopsticksAPI.query.sudo.key()).toString();
    console.log(`Sudo: ${sudo}`);

    // Send fake transaction
    await signFakeWithApi(chopsticksAPI, finalTx, sudo);
    await finalTx.send();
    console.log("--- Chopsticks Test Done ---");
    await chopsticksAPI.disconnect();
  }

  await api.disconnect();
}

main()
  .catch(console.error)
  .finally(() => process.exit());
