import yargs from 'yargs';
import { NETWORK_YARGS_OPTIONS, getApiFor } from './utils/network';
import fs from 'fs';
import { decodeAddress } from '@polkadot/util-crypto';
import { parse } from 'csv-parse/sync';
import { signFakeWithApi } from '@acala-network/chopsticks-utils';

/* CSV file must have the following format
Genesis Account | Proxy Account | Proxy Type | Delay
Account 1       | Account 2     | Any        | 0
....
*/

const args = yargs.options({
  ...NETWORK_YARGS_OPTIONS,
  'proxy-file': {
    describe: 'Location of CSV file with proxy configuration',
    type: 'string',
    demandOption: true,
    alias: ['pf'],
    coerce: (arg) => {
      if (!fs.existsSync(arg)) {
        throw new Error(`Proxy file not found: ${arg}`);
      }
      return arg;
    },
  },
  sudo: {
    describe: 'Boolean to use sudo',
    type: 'boolean',
    demandOption: false,
    nargs: 0,
  },
  chopsticks: {
    describe: 'Provide Chopsticks endpoint (default wss://localhost:8000)',
    type: 'string',
    demandOption: false,
  },
}).argv;

// Initialize
let batchCall = [];

function validateCSVStructure(filePath: string): any[] {
  const EXPECTED_HEADERS = [
    'Genesis Account',
    'Proxy Account',
    'Proxy Type',
    'Delay',
  ];

  const content = fs.readFileSync(filePath, 'utf-8');

  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  if (records.length === 0) {
    throw new Error('CSV file is empty.');
  }

  // Check headers
  const headers = Object.keys(records[0]);
  for (let i = 0; i < EXPECTED_HEADERS.length; i++) {
    if (headers[i] !== EXPECTED_HEADERS[i]) {
      throw new Error(
        `CSV header mismatch. Expected "${EXPECTED_HEADERS[i]}", got "${
          headers[i]
        }" at column ${i + 1}`
      );
    }
  }

  // Validate rows
  for (const [index, row] of records.entries()) {
    const lineNumber = index + 2; // +2 to account for header row

    const genesis = row['Genesis Account'];
    const proxy = row['Proxy Account'];
    const type = row['Proxy Type'];
    const delay = row['Delay'];

    if (!genesis || !proxy || !type || delay === undefined) {
      throw new Error(`Missing field(s) in row ${lineNumber}`);
    }

    // Validate addresses
    try {
      decodeAddress(genesis);
    } catch {
      throw new Error(`Invalid Genesis Account address at row ${lineNumber}`);
    }

    try {
      decodeAddress(proxy);
    } catch {
      throw new Error(`Invalid Proxy Account address at row ${lineNumber}`);
    }

    // Validate Delay is a number
    if (isNaN(Number(delay))) {
      throw new Error(
        `Invalid Delay value (not a number) at row ${lineNumber}`
      );
    }
  }

  return records;
}

// Create utility dispatch as call in batch
async function utilityDispatchAsCall(api, data) {
  for (let i = 0; i < data.length; i++) {
    const genesisAccount = decodeAddress(data[i]['Genesis Account']);
    const proxyAccount = decodeAddress(data[i]['Proxy Account']);
    const proxyType = data[i]['Proxy Type'];
    const delay = BigInt(data[i]['Delay']);

    const call = api.tx.utility.dispatchAs(
      { system: { Signed: genesisAccount } },
      api.tx.proxy.addProxy(proxyAccount, proxyType, delay)
    );

    batchCall.push(call);
  }

  return batchCall;
}

async function main() {
  // Get API
  const api = await getApiFor(args);
  await api.isReady;

  // Get data and validate
  const data = validateCSVStructure(args['proxy-file']);

  // Create utility dispatch as call in batch
  const batchData = await utilityDispatchAsCall(api, data);

  // Create batch call
  let finalTx = api.tx.utility.batchAll(batchData);

  // Create sudo call
  if (args['sudo']) {
    console.log(`--- USING SUDO ---`);

    finalTx = api.tx.sudo.sudo(finalTx);
  }

  console.log(`--- FINAL TX ---`);
  console.log(finalTx.toHex());

  await api.disconnect();

  // Testing in Chopsticks
  if (args['chopsticks'] && args['sudo']) {
    console.log(`\n--- Chopsticks Testing ${args['chopsticks']} ---`);

    // Create Chopsticks API
    const chopsticksAPI = await getApiFor({ url: args['chopsticks'] });
    const sudo = (await chopsticksAPI.query.sudo.key()).toString();
    console.log(`Sudo: ${sudo}`);

    // Send fake transaction
    await signFakeWithApi(chopsticksAPI, finalTx, sudo);
    await finalTx.send();
    console.log('--- Chopsticks Test Done ---');
    await chopsticksAPI.disconnect();
  }
}

main()
  .catch(console.error)
  .finally(() => process.exit());
