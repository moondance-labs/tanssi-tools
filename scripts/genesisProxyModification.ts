#!/usr/bin/env ts-node

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { NETWORK_YARGS_OPTIONS, getApiFor } from "./utils/network";
import fs from "fs";
import { decodeAddress } from "@polkadot/util-crypto";
import { parse } from "csv-parse/sync";
import { signFakeWithApi } from "@acala-network/chopsticks-utils";

/**
 * CSV FORMAT (strict headers & order):
 * Genesis Account,Proxy Account,Proxy Type,Delay
 */

type ProxyRow = {
  "Genesis Account": string;
  "Proxy Account": string;
  "Proxy Type": string;
  "Delay": string | number;
};

type PerGenesisConfig = Map<
  string,
  { proxy: string; type: string; delay: string }
>;

const args = yargs(hideBin(process.argv))
  .options({
    ...NETWORK_YARGS_OPTIONS,
    "proxy-file": {
      describe: "Location of CSV file with the NEW proxy configuration",
      type: "string",
      demandOption: true,
      alias: ["pf"],
      coerce: (arg: string) => {
        if (!fs.existsSync(arg)) throw new Error(`Proxy file not found: ${arg}`);
        return arg;
      },
    },
    "proxy-file-old": {
      describe: "Location of CSV file with the OLD proxy configuration",
      type: "string",
      demandOption: true,
      alias: ["pold"],
      coerce: (arg: string) => {
        if (!fs.existsSync(arg)) throw new Error(`Proxy file not found: ${arg}`);
        return arg;
      },
    },
    sudo: {
      describe: "Wrap the batch in sudo.sudo(...)",
      type: "boolean",
      demandOption: false,
    },
    chopsticks: {
      describe: "Chopsticks test (expects endpoint to be ws://localhost:8000",
      type: "boolean",
      demandOption: false,
    },
  })
  .strict()
  .argv as unknown as {
  ["proxy-file"]: string;
  ["proxy-file-old"]: string;
  sudo?: boolean;
  chopsticks?: string;
} & Record<string, any>;

// Known ProxyType values (case-insensitive normalization)
const KNOWN_PROXY_TYPES = new Set([
  "Any",
  "NonTransfer",
  "Governance",
  "Staking",
  "IdentityJudgement",
  "CancelProxy",
  "Auction",
  "Society",
  "NominationPools",
  "FastGovernance",
  "EthereumBridge",
  "Assets",
]);

function normalizeProxyType(raw: string): string {
  // Trim & TitleCase-like normalization
  const t = String(raw).trim();
  // Accept common synonyms
  const synonyms: Record<string, string> = {
    any: "Any",
    staking: "Staking",
    governance: "Governance",
    nontransfer: "NonTransfer",
    "non-transfer": "NonTransfer",
    identityjudgement: "IdentityJudgement",
    "identity-judgement": "IdentityJudgement",
    cancelproxy: "CancelProxy",
    pools: "NominationPools",
    nominationpools: "NominationPools",
  };
  const key = t.replace(/[\s_-]/g, "").toLowerCase();
  const mapped = synonyms[key] ?? t.charAt(0).toUpperCase() + t.slice(1);
  if (!KNOWN_PROXY_TYPES.has(mapped)) {
    throw new Error(
      `Unknown Proxy Type "${raw}". Known: ${Array.from(KNOWN_PROXY_TYPES).join(
        ", "
      )}`
    );
  }
  return mapped;
}

function validateCSVStructure(filePath: string): ProxyRow[] {
  const EXPECTED_HEADERS = [
    "Genesis Account",
    "Proxy Account",
    "Proxy Type",
    "Delay",
  ];

  const content = fs.readFileSync(filePath, "utf-8");
  const records: ProxyRow[] = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  if (records.length === 0) {
    throw new Error(`CSV file "${filePath}" is empty.`);
  }

  // Check headers & order
  const headers = Object.keys(records[0]);
  for (let i = 0; i < EXPECTED_HEADERS.length; i++) {
    if (headers[i] !== EXPECTED_HEADERS[i]) {
      throw new Error(
        `CSV header mismatch in "${filePath}". Expected "${EXPECTED_HEADERS[i]}", got "${headers[i]}" at column ${i + 1}.`
      );
    }
  }

  // Validate rows
  for (const [index, row] of records.entries()) {
    const lineNumber = index + 2; // header is line 1
    const genesis = row["Genesis Account"];
    const proxy = row["Proxy Account"];
    const type = row["Proxy Type"];
    const delay = row["Delay"];

    if (!genesis || !proxy || !type || delay === undefined) {
      throw new Error(`Missing field(s) in row ${lineNumber} (${filePath}).`);
    }

    // Validate addresses
    try {
      decodeAddress(genesis);
    } catch {
      throw new Error(
        `Invalid Genesis Account address at row ${lineNumber} (${filePath}).`
      );
    }

    try {
      decodeAddress(proxy);
    } catch {
      throw new Error(
        `Invalid Proxy Account address at row ${lineNumber} (${filePath}).`
      );
    }

    // Validate Proxy Type
    normalizeProxyType(type);

    // Validate Delay is a non-negative integer
    const d = Number(delay);
    if (!Number.isFinite(d) || isNaN(d) || d < 0 || !Number.isInteger(d)) {
      throw new Error(
        `Invalid Delay value (must be a non-negative integer) at row ${lineNumber} (${filePath}).`
      );
    }
  }

  return records;
}

function toPerGenesisMap(rows: ProxyRow[]): PerGenesisConfig {
  const map: PerGenesisConfig = new Map();
  for (const r of rows) {
    const genesis = r["Genesis Account"].trim();
    if (map.has(genesis)) {
      throw new Error(
        `Duplicate Genesis Account in CSV: ${genesis}. This tool expects a single proxy config per genesis account.`
      );
    }
    map.set(genesis, {
      proxy: r["Proxy Account"].trim(),
      type: normalizeProxyType(r["Proxy Type"]),
      delay: String(Number(r["Delay"])),
    });
  }
  return map;
}

function summarizePlan(
  toRemove: Array<{ genesis: string; proxy: string; type: string; delay: string }>,
  toAdd: Array<{ genesis: string; proxy: string; type: string; delay: string }>
) {
  const set = new Set<string>();
  for (const r of toRemove) set.add(r.genesis);
  for (const a of toAdd) set.add(a.genesis);
  const accounts = Array.from(set);
  console.log(`\n=== PLAN SUMMARY ===`);
  console.log(`Accounts impacted: ${accounts.length}`);
  console.log(`Removals: ${toRemove.length} | Additions: ${toAdd.length}`);
  if (accounts.length <= 10) {
    console.log(`Accounts: ${accounts.join(", ")}`);
  }
}

async function buildCalls(
  api: any,
  newCfg: PerGenesisConfig,
  oldCfg: PerGenesisConfig
) {
  const calls: any[] = [];

  // Union of all genesis accounts
  const allGenesis = new Set<string>([
    ...Array.from(newCfg.keys()),
    ...Array.from(oldCfg.keys()),
  ]);

  for (const genesis of allGenesis) {
    const oldRow = oldCfg.get(genesis);
    const newRow = newCfg.get(genesis);

    // Skip if identical
    if (
      oldRow &&
      newRow &&
      oldRow.proxy === newRow.proxy &&
      oldRow.type === newRow.type &&
      oldRow.delay === newRow.delay
    ) {
      continue;
    }

    const innerCalls: any[] = [];

    if (oldRow) {
      innerCalls.push(
        api.tx.proxy.removeProxy(
          decodeAddress(oldRow.proxy),
          oldRow.type,
          BigInt(oldRow.delay)
        )
      );
    }

    if (newRow) {
      innerCalls.push(
        api.tx.proxy.addProxy(
          decodeAddress(newRow.proxy),
          newRow.type,
          BigInt(newRow.delay)
        )
      );
    }

    if (innerCalls.length === 0) continue;

    // IMPORTANT: batch the per-genesis actions together, then dispatchAs that genesis
    const perGenesisBatch =
      innerCalls.length === 1
        ? innerCalls[0] // no need to batch one call
        : api.tx.utility.batchAll(innerCalls);

    const dispatchAsGenesis = api.tx.utility.dispatchAs(
      { system: { Signed: decodeAddress(genesis) } },
      perGenesisBatch
    );

    calls.push(dispatchAsGenesis);
  }

  return calls;
}

async function main() {
  // API
  const api = await getApiFor(args);
  await api.isReady;

  // Read & validate CSVs
  const dataNew = validateCSVStructure(args["proxy-file"]);
  const dataOld = validateCSVStructure(args["proxy-file-old"]);

  // Convert to keyed maps (one row per genesis)
  const newMap = toPerGenesisMap(dataNew);
  const oldMap = toPerGenesisMap(dataOld);

  // Build calls
  const calls = await buildCalls(api, newMap, oldMap);

  if (calls.length === 0) {
    console.log("\nNothing to do: old and new proxy configurations are identical.");
    await api.disconnect();
    return;
  }

  // Build batch
  const batchTx = await api.tx.utility.batchAll(calls);

  // Wrap the batch inside sudo if requested
  const finalTx = await api.tx.sudo.sudo(batchTx);

  // Print all hex for review
  console.log(`\n --- BATCH TX HEX ---`);
  console.log(batchTx.toHex());
  console.log(`\n--- FINAL TX HEX ---`);
  console.log(finalTx.toHex());

  // Optional: Test on Chopsticks with fake sudo (requires --sudo)
  if (args["chopsticks"] && args["sudo"] && args['url'] === 'ws://localhost:8000') {
    console.log(`\n--- Chopsticks Testing ${args["chopsticks"]} ---`);

    // Create Chopsticks API
    const chopsticksAPI = await getApiFor({ url: args["url"] });
    const sudo = (await chopsticksAPI.query.sudo.key()).toString();
    console.log(`Sudo: ${sudo}`);

    // Send fake transaction
    await signFakeWithApi(chopsticksAPI, finalTx, sudo);
    await finalTx.send();
    console.log("--- Chopsticks Test Done ---");
    await chopsticksAPI.disconnect();
  } else if (args["chopsticks"]) {
    console.log(
      `\nSkipping Chopsticks test (either --chopsticks or --sudo missing, or --url not ws://localhost:8000).`
    );
  }

  await api.disconnect();

}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
