import yargs from "yargs";
import { NETWORK_YARGS_OPTIONS, getApiFor } from "./utils/network";
import fs from "fs";
import * as path from "path";
import { decodeAddress } from "@polkadot/util-crypto";
import { parse } from "csv-parse/sync";
import "@tanssi/api-augment";
import { PalletProxyProxyDefinition } from "@polkadot/types/lookup";

/* CSV file must have the following format
Genesis Account | Proxy Account | Proxy Type | Delay
Account 1       | Account 2     | Any        | 0
....
*/

const args = yargs.options({
  ...NETWORK_YARGS_OPTIONS,
  "proxy-dir": {
    describe: "Folder where CSV files with proxy configuration",
    type: "string",
    demandOption: true,
    alias: ["pd"],
  },
}).argv;

// Define a type for a proxy configuration
interface ProxyConfig {
  delegate: string;
  proxyType: string;
  delay: string; // Storing as string for consistent comparison with CSV input
}

async function verifyAccounts(api, directoryPath: string) {
  const EXPECTED_HEADERS = [
    "Genesis Account",
    "Proxy Account",
    "Proxy Type",
    "Delay",
  ];

  // Map to store expected proxies from CSV, keyed by Genesis Account
  // Value will be an array of ProxyConfig objects
  const expectedProxiesFromCsv: Map<string, ProxyConfig[]> = new Map();

  // Read all files in the specified directory
  const files = fs.readdirSync(directoryPath);

  // Filter for CSV files that do not end with _old*
  const reOld = /_old(\d+)?$/i;

  const csvFiles = files.filter((file) => {
    const { ext, name } = path.parse(file);
    return ext.toLowerCase() === ".csv" && !reOld.test(name);
  });

  if (csvFiles.length === 0) {
    throw new Error(`No CSV files found in the directory: ${directoryPath}`);
  }

  // --- Step 1: Parse all CSV files and collect expected proxy configurations ---
  for (const csvFile of csvFiles) {
    if (csvFile === "Genesis_Accounts.csv") {
      console.log(`Skipping file: ${csvFile}`);
      continue; // Skip this file
    }

    const filePath = path.join(directoryPath, csvFile);
    console.log(`Reading CSV file: ${filePath}`);

    const content = fs.readFileSync(filePath, "utf-8");

    const records: Record<string, any>[] = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    if (records.length === 0) {
      console.warn(`CSV file is empty: ${filePath}. Skipping.`);
      continue;
    }

    // Check headers
    const headers = Object.keys(records[0]);
    for (let i = 0; i < EXPECTED_HEADERS.length; i++) {
      if (headers[i] !== EXPECTED_HEADERS[i]) {
        throw new Error(
          `CSV header mismatch in ${filePath}. Expected "${
            EXPECTED_HEADERS[i]
          }", got "${headers[i]}" at column ${i + 1}`
        );
      }
    }

    // Validate rows and populate expectedProxiesFromCsv map
    for (const [index, row] of records.entries()) {
      const lineNumber = index + 2; // +2 to account for header row + 1-based index

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
        throw new Error(
          `Invalid Genesis Account address at row ${lineNumber} of ${filePath}`
        );
      }

      try {
        decodeAddress(proxy);
      } catch {
        throw new Error(
          `Invalid Proxy Account address at row ${lineNumber} of ${filePath}`
        );
      }

      // Validate Delay is a number (and convert to string for consistent storage)
      const numericDelay = Number(delay);
      if (isNaN(numericDelay)) {
        throw new Error(
          `Invalid Delay value (not a number) at row ${lineNumber} of ${filePath}`
        );
      }

      // Add to our map of expected proxies
      const proxyConfig: ProxyConfig = {
        delegate: proxy,
        proxyType: type,
        delay: String(numericDelay), // Store delay as string
      };

      if (!expectedProxiesFromCsv.has(genesis)) {
        expectedProxiesFromCsv.set(genesis, []);
      }
      expectedProxiesFromCsv.get(genesis)!.push(proxyConfig);
    }
  }

  console.log("\n--- Starting On-Chain Verification ---");

  // --- Step 2 & 3: Iterate through collected genesis accounts and compare with on-chain data ---
  for (const [
    genesisAccount,
    csvProxyConfigs,
  ] of expectedProxiesFromCsv.entries()) {
    console.log(`\nVerifying proxies for Genesis Account: ${genesisAccount}`);

    try {
      const chainProxyResponse = await api.query.proxy.proxies(genesisAccount);
      const chainProxyDefinitions: PalletProxyProxyDefinition =
        chainProxyResponse.toHuman() as any;

      const onChainProxies: ProxyConfig[] = [];

      // Extract on-chain proxy configurations into a standardized format
      if (
        Array.isArray(chainProxyDefinitions) &&
        Array.isArray(chainProxyDefinitions[0])
      ) {
        for (const config of chainProxyDefinitions[0]) {
          onChainProxies.push({
            delegate: config.delegate,
            proxyType: config.proxyType,
            delay: String(config.delay), // Ensure delay is string for comparison
          });
        }
      }

      // --- 3.1: Check if all CSV proxies exist on-chain ---
      for (const csvConfig of csvProxyConfigs) {
        let matchFound = false;
        for (const onChainConfig of onChainProxies) {
          if (
            onChainConfig.delegate === csvConfig.delegate &&
            onChainConfig.proxyType === csvConfig.proxyType &&
            onChainConfig.delay === csvConfig.delay
          ) {
            matchFound = true;
            break;
          }
        }
        if (matchFound) {
          console.log(
            `  ✅ CSV proxy found on-chain: Delegate: ${csvConfig.delegate}, Type: ${csvConfig.proxyType}, Delay: ${csvConfig.delay}`
          );
        } else {
          console.error(
            `  ❌ CSV proxy NOT found on-chain: Delegate: ${csvConfig.delegate}, Type: ${csvConfig.proxyType}, Delay: ${csvConfig.delay}`
          );
        }
      }

      // --- 3.2: Check if all on-chain proxies exist in CSV ---
      for (const onChainConfig of onChainProxies) {
        let matchFound = false;
        for (const csvConfig of csvProxyConfigs) {
          if (
            csvConfig.delegate === onChainConfig.delegate &&
            csvConfig.proxyType === onChainConfig.proxyType &&
            csvConfig.delay === onChainConfig.delay
          ) {
            matchFound = true;
            break;
          }
        }
        if (matchFound) {
          // This case was already covered by the previous loop, but helps readability if uncommented
          // console.log(`  ✅ On-chain proxy found in CSV: Delegate: ${onChainConfig.delegate}, Type: ${onChainConfig.proxyType}, Delay: ${onChainConfig.delay}`);
        } else {
          console.warn(
            `  ⚠️ On-chain proxy NOT in CSV config: Delegate: ${onChainConfig.delegate}, Type: ${onChainConfig.proxyType}, Delay: ${onChainConfig.delay}`
          );
        }
      }

      if (csvProxyConfigs.length === 0 && onChainProxies.length === 0) {
        console.log(
          `  No proxies expected and none found on-chain for ${genesisAccount}.`
        );
      } else if (csvProxyConfigs.length === 0 && onChainProxies.length > 0) {
        console.warn(
          `  ⚠️ No proxies expected in CSV for ${genesisAccount}, but ${onChainProxies.length} found on-chain.`
        );
      } else if (csvProxyConfigs.length > 0 && onChainProxies.length === 0) {
        console.warn(
          `  ⚠️ Proxies expected in CSV for ${genesisAccount}, but none found on-chain.`
        );
      }
    } catch (error) {
      console.error(
        `Error querying or verifying proxies for Genesis Account ${genesisAccount}:`,
        error
      );
    }
  }
}

async function main() {
  // Get API
  const api = await getApiFor(args);

  try {
    // Validate setups
    await verifyAccounts(api, args["proxy-dir"]);
  } catch (error) {
    console.error(error);
  } finally {
    await api.disconnect();
  }
}

main()
  .catch(console.error)
  .finally(() => process.exit());
