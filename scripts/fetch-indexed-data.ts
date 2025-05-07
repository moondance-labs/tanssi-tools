// @ts-ignore
const fetch = require('node-fetch');

// Dancebox data block 6801516
const danceboxSignedTx = BigInt('733586'); // https://dancebox.subscan.io/extrinsic?page=1&time_dimension=date&signed=all
const danceboxUnsignedTx = BigInt('27187292');
const danceboxTx = danceboxSignedTx + danceboxUnsignedTx;
const danceboxAccounts = BigInt('35718'); // From Subscan https://dancebox.subscan.io/
const danceboxAppchains = BigInt('120'); //https://dancebox.subscan.io/extrinsic?page=1&time_dimension=date&signed=all&module=registrar&call=register
const flashboxSignedTx = BigInt('43335'); // https://tanssi-campaign.squids.live/airlyft-flashbox/v/v1/graphql
const flashboxAccounts = BigInt('10772'); // https://tanssi-campaign.squids.live/airlyft-flashbox/v/v1/graphql
const flashboxUnsignedTx = BigInt('23128000'); // https://polkadot.js.org/apps/?rpc=wss://fraa-flashbox-rpc.a.stagenet.tanssi.network#/explorer

// GraphQL endpoint for the Tanssi campaign
const GRAPHQL_URL_APPCHAINS_DEPLOYMENT =
  'https://tanssi-campaign.squids.live/flashbox-appchain-deployment/graphql';

const GRAPHQL_URL_APPCHAINS_DATA =
  'https://tanssi-campaign.squids.live/airlyft/graphql';

// Queries
const queryAppchains = `
  query {
    parachainIdRegistrations {
      paraId
    }
  }
`;

const queryTxAndAddresses = `
  query MyQuery {
    transactionsConnection(orderBy: id_ASC) {
      totalCount
    }
    addressesConnection(orderBy: id_ASC) {
      totalCount
    }
  }
`;

interface AppchainRegistration {
  paraId: number;
}

interface RegisteredAppchainsInterface {
  data?: {
    parachainIdRegistrations: AppchainRegistration[];
  };
  errors?: any;
}

interface TotalTxAndAddressesInterface {
  data?: {
    transactionsConnection: {
      totalCount: number;
    };
    addressesConnection: {
      totalCount: number;
    };
  };
  errors?: any;
}

async function main() {
  // Appchains deployment
  try {
    const response = await fetch(GRAPHQL_URL_APPCHAINS_DEPLOYMENT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: queryAppchains }),
    });

    const result: RegisteredAppchainsInterface = await response.json();

    if (result.errors) {
      console.error('GraphQL errors:', result.errors);
      return;
    }

    const registrations = result.data?.parachainIdRegistrations;

    // Get actual deployments vs intents
    const appchainIntents = registrations.filter(
      (item) => item.paraId === 0
    ).length;
    const appchainDeployments = registrations.filter(
      (item) => item.paraId !== 0
    ).length;

    if (registrations) {
      console.log(
        'Number of total Appchains:',
        (
          BigInt(appchainDeployments) +
          BigInt(appchainIntents) +
          danceboxAppchains
        ).toString()
      );
      console.log(
        '------> Dancebox Appchains deployed:',
        danceboxAppchains.toString()
      );
      console.log(
        '------> Flashbox Appchains deployed:',
        appchainDeployments.toString()
      );
      console.log(
        '------> Flashbox Appchains intents:',
        appchainIntents.toString()
      );
    } else {
      console.log('No data received.');
    }
  } catch (error) {
    console.error('Error fetching data:', error);
  }

  // Appchains data
  try {
    const response = await fetch(GRAPHQL_URL_APPCHAINS_DATA, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: queryTxAndAddresses }),
    });

    const result: TotalTxAndAddressesInterface = await response.json();

    if (result.errors) {
      console.error('GraphQL errors:', result.errors);
      return;
    }

    const totalTransactions = result.data?.transactionsConnection.totalCount;
    const totalAddresses = result.data?.addressesConnection.totalCount;

    if (totalTransactions && totalAddresses) {
      console.log(
        'Number of total addresses:',
        (
          BigInt(totalAddresses) +
          danceboxAccounts +
          flashboxAccounts
        ).toString()
      );
      console.log('------> Dancebox addresses:', danceboxAccounts.toString());
      console.log('------> Flashbox addresses:', flashboxAccounts.toString());
      console.log(
        '------> Flashbox Appchains addresses:',
        totalAddresses.toString()
      );
      console.log(
        'Number of total transactions:',
        (
          BigInt(totalTransactions) +
          danceboxTx +
          flashboxSignedTx +
          flashboxUnsignedTx
        ).toString()
      );
      console.log(
        '------> Dancebox total transactions:',
        danceboxTx.toString()
      );
      console.log(
        '------> Dancebox unsigned/system transactions:',
        danceboxUnsignedTx.toString()
      );
      console.log(
        '------> Flashbox unsigned/system transactions:',
        flashboxUnsignedTx.toString()
      );
      console.log(
        '------> Dancebox signed/user transactions:',
        danceboxSignedTx.toString()
      );
      console.log(
        '------> Flashbox signed/user transactions:',
        flashboxSignedTx.toString()
      );
      console.log(
        '------> Flashbox Appchains transactions:',
        totalTransactions.toString()
      );
    } else {
      console.log('No data received.');
    }
  } catch (error) {
    console.error('Error fetching data:', error);
  }
}

main();
