import yargs from "yargs";
import { NETWORK_YARGS_OPTIONS, getApiFor } from "./utils/network";
import fs from "fs";
import { parse } from "csv-parse/sync";
import { decodeAddress } from "@polkadot/util-crypto";
import "@tanssi/api-augment";
import type { ApiPromise } from "@polkadot/api";

/*
CSV file must have the following format:
Address,Balance
Account1Address,1000000000000
Account2Address,25000000000000
...
Notes:
- Balances should be integers representing the smallest unit of the currency (e.g., Planck for Polkadot).
- Do not include commas or unit symbols (e.g., KSM, DOT) in the Balance column.
*/

const args = yargs.options({
  ...NETWORK_YARGS_OPTIONS,
  "file-path": {
    describe: "Path to the CSV file with balances",
    type: "string",
    demandOption: true,
    alias: ["fp", "file"],
  },
}).argv;

async function verifyBalances(api: ApiPromise, filePath: string) {
  const EXPECTED_HEADERS = ["Address", "Balance"];
  let totalCsvBalance = BigInt(0);
  let MismatchesFound = false;
  const csvAddresses = new Set<string>(); // To store addresses from CSV for quick lookup

  console.log(`\n📄 Attempting to read CSV file: ${filePath}`);

  if (!fs.existsSync(filePath)) {
    console.error(`  ❌ Error: File not found at path: ${filePath}`);
    process.exitCode = 1;
    return;
  }

  const content = fs.readFileSync(filePath, "utf-8");
  let records: Record<string, string>[];
  try {
    records = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });
  } catch (parseError: any) {
    console.error(`  ❌ Error parsing CSV file ${filePath}: ${parseError.message}`);
    process.exitCode = 1;
    return;
  }

  console.log("--- Verifying Balances from CSV against On-Chain Data ---");
  if (records.length === 0) {
    console.warn(
      `   ⚠️ CSV file is empty or contains only a header (no data records): ${filePath}.`
    );
  } else {
    const headers = Object.keys(records[0]);
    let headersMatch = EXPECTED_HEADERS.length === headers.length;
    if (headersMatch) {
      for (let i = 0; i < EXPECTED_HEADERS.length; i++) {
        if (headers[i].trim() !== EXPECTED_HEADERS[i]) {
          headersMatch = false;
          break;
        }
      }
    }

    if (!headersMatch) {
      console.error(
        `  ❌ CSV header mismatch in ${filePath}. Expected "${EXPECTED_HEADERS.join(
          ","
        )}", got "${headers.join(",")}"`
      );
      MismatchesFound = true;
    } else {
      console.log(`   Found ${records.length} data record(s) in ${filePath}. Verifying...`);
      for (const [index, row] of records.entries()) {
        const lineNumber = index + 2;
        const address = row["Address"];
        const csvBalanceStr = row["Balance"];

        if (address === undefined || csvBalanceStr === undefined) {
          console.error(
            `  ❌ Missing 'Address' or 'Balance' field in row ${lineNumber} of ${filePath}. Row: ${JSON.stringify(row)}`
          );
          MismatchesFound = true;
          continue;
        }

        const trimmedAddress = address.trim();
        const trimmedCsvBalanceStr = csvBalanceStr.trim();

        if (!trimmedAddress && !trimmedCsvBalanceStr) {
          console.warn(`  Skipping empty or whitespace-only row ${lineNumber} in ${filePath}.`);
          continue;
        }
        if (!trimmedAddress) {
          console.error(`  ❌ Missing Address in row ${lineNumber} of ${filePath}.`);
          MismatchesFound = true;
          continue;
        }
        csvAddresses.add(trimmedAddress); // Add to set after basic validation

        if (trimmedCsvBalanceStr === "") {
          console.error(`  ❌ Missing Balance value in row ${lineNumber} for address ${trimmedAddress} in ${filePath}.`);
          MismatchesFound = true;
          continue;
        }

        try {
          decodeAddress(trimmedAddress);
        } catch {
          console.error(`  ❌ Invalid address format for "${trimmedAddress}" at row ${lineNumber} of ${filePath}.`);
          MismatchesFound = true;
          continue;
        }

        let csvBalance: bigint;
        try {
          const cleanBalanceStr = trimmedCsvBalanceStr.replace(/,/g, "");
          if (isNaN(Number(cleanBalanceStr))) {
            throw new Error("Balance is not a valid number.");
          }
          csvBalance = BigInt(cleanBalanceStr);
          if (csvBalance < BigInt(0)) {
            throw new Error("Balance cannot be negative.");
          }
        } catch (e: any) {
          console.error(`  ❌ Invalid Balance format in CSV for address "${trimmedAddress}" at row ${lineNumber}: "${trimmedCsvBalanceStr}". ${e.message}`);
          MismatchesFound = true;
          continue;
        }

        totalCsvBalance += csvBalance;

        try {
          const accountInfo = await api.query.system.account(trimmedAddress) as any;
          const onChainFreeBalance = BigInt(accountInfo.data.free.toString());

          if (csvBalance === onChainFreeBalance) {
            console.log(`  ✅ Balance MATCH for ${trimmedAddress}: CSV: ${csvBalance.toString()}, On-chain: ${onChainFreeBalance.toString()}`);
          } else {
            console.error(`  ❌ Balance MISMATCH for ${trimmedAddress}: CSV: ${csvBalance.toString()}, On-chain: ${onChainFreeBalance.toString()}`);
            MismatchesFound = true;
          }
        } catch (error: any) {
          console.error(`  ❌ Error querying balance for address ${trimmedAddress} at row ${lineNumber}: ${error.message}`);
          if (csvBalance !== BigInt(0)) MismatchesFound = true;
          else console.warn(`     CSV expected 0 for ${trimmedAddress}, but querying failed. This might be okay if account is reaped/empty.`);
        }
      }
    }
  }

  // --- New Section: Full On-Chain Account Scan ---
  console.log("\n--- Scanning All On-Chain Accounts (via system.account.entries) ---");
  let totalOnChainFreeBalanceSum = BigInt(0);
  const accountsOnChainNotInCsvWithBalance: { address: string; balance: bigint }[] = [];
  let onChainAccountsProcessed = 0;

  try {
    const rawAccountEntires = await api.query.system.account.entries();

  let rawAccounts = [];

  rawAccountEntires.forEach(([key, exposure]) => {
    rawAccounts.push({
      account: key.args.map((k) => k.toHuman()),
      balance: exposure.toHuman(),
    });
  });

    for (const account of rawAccounts) {
      // The first argument to the key is the AccountId
      const onChainAddress = account.account[0];
      const onChainFreeBalance = BigInt(account.balance.data.free.toString().replaceAll(',',''));

      totalOnChainFreeBalanceSum += onChainFreeBalance;

      if (onChainFreeBalance > BigInt(0) && !csvAddresses.has(onChainAddress)) {
        accountsOnChainNotInCsvWithBalance.push({
          address: onChainAddress,
          balance: onChainFreeBalance,
        });
      }
    }

    console.log(`  🔎 Processed ${rawAccounts.length} on-chain account entries.`);
    console.log(`  💰 Sum of all on-chain 'free' balances from scan: ${totalOnChainFreeBalanceSum.toString()}`);

    if (accountsOnChainNotInCsvWithBalance.length > 0) {
      MismatchesFound = true;
      console.error(
        `  ❌ Found ${accountsOnChainNotInCsvWithBalance.length} account(s) with a 'free' balance on-chain but NOT listed in the CSV:`
      );
      for (const acc of accountsOnChainNotInCsvWithBalance) {
        console.error(`     - Address: ${acc.address}, Balance: ${acc.balance.toString()}`);
      }
    } else {
      console.log("  ✅ All on-chain accounts with a 'free' balance appear to be covered by the CSV (or have zero 'free' balance).");
    }
  } catch (error: any) {
    console.error(`  ❌ Error during on-chain account scan (system.account.entries): ${error.message}`);
    MismatchesFound = true;
  }
  // --- End of New Section ---

  console.log("\n--- Verifying Sums against On-Chain Total Issuance ---");
  try {
    const totalIssuanceRaw = await api.query.balances.totalIssuance();
    const onChainTotalIssuance = BigInt(totalIssuanceRaw.toString());

    console.log(`  💰 Total 'free' balance summed from CSV:             ${totalCsvBalance.toString()}`);
    console.log(`  💰 Sum of all on-chain 'free' balances from scan:  ${totalOnChainFreeBalanceSum.toString()}`);
    console.log(`  ⛓️ On-chain total issuance:                          ${onChainTotalIssuance.toString()}`);

    // Comparison 1: CSV sum vs Total Issuance
    if (totalCsvBalance === onChainTotalIssuance) {
      console.log("  ✅ Sum of 'free' balances from CSV MATCHES on-chain total issuance.");
    } else {
      console.error("  ❌ Sum of 'free' balances from CSV DOES NOT MATCH on-chain total issuance.");
      console.error(`     Difference (CSV Total - Total Issuance): ${(totalCsvBalance - onChainTotalIssuance).toString()}`);
      MismatchesFound = true;
    }

    // Comparison 2: Sum of all on-chain 'free' balances vs Total Issuance
    // Note: This sum might not equal totalIssuance if there are reserved/locked balances,
    // as totalIssuance includes all forms of balance, not just 'free'.
    if (totalOnChainFreeBalanceSum === onChainTotalIssuance) {
        console.log("  ✅ Sum of all on-chain 'free' balances (from scan) MATCHES total issuance.");
    } else {
        // This might not be an "error" per se, but a point of information if reserved balances exist.
        console.warn("  ⚠️ Sum of all on-chain 'free' balances (from scan) DOES NOT MATCH total issuance.");
        const diff = totalOnChainFreeBalanceSum - onChainTotalIssuance;
        console.warn(`     Difference (On-chain Free Sum - Total Issuance): ${diff.toString()}`);
        console.warn(`     (This can be expected if accounts have reserved balances not included in the 'free' sum)`);
        // You might decide if this specific difference should set MismatchesFound = true based on chain specifics.
        // For now, it's a warning. If strict equality is expected, change to console.error and set MismatchesFound.
    }

  } catch (error: any) {
    console.error(`  ❌ Error querying total issuance: ${error.message}`);
    MismatchesFound = true;
  }

  if (MismatchesFound) {
    console.error("\n🚨 Verification complete with one or more mismatches or errors. 🚨");
    if (!process.exitCode) process.exitCode = 1;
  } else {
    console.log("\n🎉 Verification complete. All checks passed successfully or with noted warnings! 🎉");
  }
}

async function main() {
  const filePath = args["file-path"] as string;
  if (!filePath) {
    console.error("Error: File path argument is missing. Please use --file-path <path_to_csv_file>.");
    process.exit(1);
  }

  let api: ApiPromise | undefined;
  try {
    api = await getApiFor(args);
    await api.isReady;
    console.log(`🚀 Connected to network: ${(await api.rpc.system.chain()).toHuman()} via ${api.runtimeVersion.specName}/${api.runtimeVersion.specVersion}`);
    await verifyBalances(api, filePath);
  } catch (error: any) {
    console.error(`An unexpected error occurred in main: ${error.message}`, error);
    process.exitCode = 1;
  } finally {
    if (api) {
      console.log("🔚 Disconnecting from API...");
      await api.disconnect();
    }
  }
}

main().catch((error) => {
  console.error("Critical error in main execution:", error);
  if (!process.exitCode) process.exitCode = 1;
});