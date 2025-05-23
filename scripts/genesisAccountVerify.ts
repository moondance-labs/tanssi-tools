import fs from 'fs';
import yargs from 'yargs';
import { isAddress } from '@polkadot/util-crypto'; // Recommended for simple boolean check



const args = yargs.options({
  'account-file': {
    describe: 'Location of CSV file with proxy configuration',
    type: 'string',
    demandOption: true,
    alias: ['af'],
    coerce: (arg) => {
      if (!fs.existsSync(arg)) {
        throw new Error(`Account file not found: ${arg}`);
      }
      return arg;
    },
  },
}).argv;


async function main() {
  console.log(`Attempting to read addresses from: ${args['account-file']}`);

  let fileContent;
  try {
    fileContent = fs.readFileSync(args['account-file'], 'utf-8');
  } catch (error) {
    console.error(`Error reading CSV file: ${error.message}`);
    process.exit(1); // Exit if the file can't be read
  }

  const lines = fileContent.split('\n');
  const validationResults = [];

  // Start processing lines after the first two header lines
  // Line 0: "Tanssi Genesis Addresses Generated on..."
  // Line 1: "Key#,Address"
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i].trim(); // Remove leading/trailing whitespace

    if (line === '') {
      // Skip empty lines
      continue;
    }

    const parts = line.split(',');
    if (parts.length < 2) {
      console.warn(`Skipping malformed line ${i + 1}: Not enough columns. Content: "${line}"`);
      validationResults.push({ lineNumber: i + 1, originalLine: line, address: 'N/A', isValid: false, error: 'Malformed line' });
      continue;
    }

    // The address is expected to be the second part (index 1)
    const keyNum = parts[0].trim();
    const address = parts[1].trim();

    if (!address) {
        console.warn(`Skipping line ${i + 1} (Key# ${keyNum}): Address field is empty.`);
        validationResults.push({ lineNumber: i + 1, originalLine: line, address: '', isValid: false, error: 'Empty address field' });
        continue;
    }

    const isValid = isAddress(address);
    validationResults.push({ lineNumber: i + 1, keyNum, address, isValid });
  }

  // Output the results
  console.log('\n--- Address Validation Results ---');
  validationResults.forEach(result => {
    if (result.isValid) {
      console.log(`Line ${result.lineNumber} (Key# ${result.keyNum}): Address '${result.address}' is VALID.`);
    } else {
      const errorMsg = result.error ? `Error: ${result.error}` : '';
      console.error(`Line ${result.lineNumber} (Key# ${result.keyNum}): Address '${result.address}' is INVALID. ${errorMsg}`);
    }
  });

  const validCount = validationResults.filter(r => r.isValid).length;
  const invalidCount = validationResults.length - validCount;
  console.log(`\n--- Summary ---`);
  console.log(`Total addresses processed: ${validationResults.length}`);
  console.log(`Valid addresses: ${validCount}`);
  console.log(`Invalid addresses: ${invalidCount}`);
}

main().catch(error => {
  console.error('An unexpected error occurred:', error);
});