import { Options } from "yargs";
import { ApiPromise, WsProvider } from "@polkadot/api";

export type TANSSI_NETWORK_NAME =
  | "dancelight"
  | "tanssi";
export type NETWORK_NAME = TANSSI_NETWORK_NAME;

// yargs wiring for your CLI
export type NetworkOptions = {
  url: Options & { type: "string" };
  network: Options & { type: "string" };
  finalized: Options & { type: "boolean" };
};

// Parsed CLI args shape (renamed to avoid confusion with yargs.Argv)
export type NetworkCliArgs = {
  url?: string;
  network?: string;   // validated at runtime
  finalized?: boolean;
};

export const NETWORK_WS_URLS: { [name in NETWORK_NAME]: string } = {
  // TODO: set public endpoints when they exist
  dancelight: "wss://services.tanssi-testnet.network/dancelight",
  tanssi: "wss://services.tanssi-mainnet.network/tanssi",
};

export const NETWORK_NAMES = Object.keys(NETWORK_WS_URLS) as NETWORK_NAME[];

export const NETWORK_YARGS_OPTIONS: NetworkOptions = {
  url: {
    type: "string",
    description: "WebSocket url",
    conflicts: ["network"],
    string: true,
  },
  network: {
    type: "string",
    choices: NETWORK_NAMES,
    description: "Known network",
    string: true,
  },
  finalized: {
    type: "boolean",
    default: false,
    description: "listen to finalized only",
  },
};

export function isKnownNetwork(name: string | undefined): name is NETWORK_NAME {
  return !!name && (NETWORK_NAMES as string[]).includes(name);
}

export const getWsProviderForNetwork = (name: NETWORK_NAME) => {
  const url = NETWORK_WS_URLS[name];
  if (!url) {
    throw new Error(
      `No WebSocket URL configured for network "${name}". Update NETWORK_WS_URLS.`
    );
  }
  return new WsProvider(url);
};

// Supports providing a URL or a known network
export const getWsProviderFor = (argv: Partial<NetworkCliArgs>) => {
  if (isKnownNetwork(argv.network)) {
    return getWsProviderForNetwork(argv.network);
  }
  if (!argv.url) {
    throw new Error(
      `Missing connection info. Provide either --url or --network (${NETWORK_NAMES.join(
        ", "
      )}).`
    );
  }
  return new WsProvider(argv.url);
};

export const getApiFor = async (
  argv: Partial<NetworkCliArgs> & Record<string, unknown>
) => {
  const wsProvider = getWsProviderFor(argv);
  return await ApiPromise.create({
    noInitWarn: true,
    provider: wsProvider,
  });
};
