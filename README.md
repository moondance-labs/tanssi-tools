# tanssi-tools

A set of scripts to help para registration in Tanssi.

**Use at your own risk!**

## Install dependencies

From this directory

`yarn install`

## Register-para script

Script that allows to perform several actions related to para registration, for instance:

### Register genesis state in Tanssi
This is done with yarn `register-para register` subcommand. This will ask for several things:
- `--chain` which should point to the **raw** chain spec file that we want to register
- `--account-priv-key` the private key of the account that we want to use to issue the transaction. **It does not need to be ths sudo account**.
- `--url` endpoint of the Tanssi network in which we want to issue the transaction.


#### Examples

`yarn register-para register --chain template-container-2002.json --account-priv-key "0xe5be9a5092b81bca64be81d212e7f2f9eba183bb7a90954f7b76361f6edb5c0a" --url "ws://127.0.0.1:9948"`

### Set bootnodes for a para-id in Tanssi
This is done with yarn `register-para setBootNodes` subcommand. This will ask for several things:
- `--para-id` the para id for which we want to register the bootnodes
- `--account-priv-key` the private key of the account that we want to use to issue the transaction. **IT NEEDS TO BE SUDO**.
- `--url` endpoint of the Tanssi network in which we want to issue the transaction.

- `--keep-existing` whether to keep existing bootnodes for such para-id or just replace all by the new one

- `--bootnode` new bootnode to be added as string


#### Examples

`yarn register-para setBootNodes --para-id 2002 --account-priv-key "0xe5be9a5092b81bca64be81d212e7f2f9eba183bb7a90954f7b76361f6edb5c0a" --url "ws://127.0.0.1:9948" --keep-existing --bootnode "/dns4/vira-stagenet-dancebox-c1-rpc-0.a.moondev.network/tcp/30333/p2p/12D3KooWHdrcQmeK4V158yEHF8U4iLQr3nseqjQ1bm3f2zBcZdoi"`


### Set bootnodes for a para-id in Tanssi
This is done with yarn `register-para setBootNodes` subcommand, and it allows to set bootnodes for a given container-chain. This will ask for several things:
- `--para-id` the para id for which we want to register the bootnodes
- `--account-priv-key` the private key of the account that we want to use to issue the transaction. **IT NEEDS TO BE SUDO**.
- `--url` endpoint of the Tanssi network in which we want to issue the transaction.

- `--keep-existing` whether to keep existing bootnodes for such para-id or just replace all by the new one

- `--bootnode` new bootnode to be added as string

- `--mark-valid-for-collating` whether we additionally want to immediatly mark as valid for collation the container-chain

#### Examples

`yarn register-para setBootNodes --para-id 2002 --account-priv-key "0xe5be9a5092b81bca64be81d212e7f2f9eba183bb7a90954f7b76361f6edb5c0a" --url "ws://127.0.0.1:9948" --keep-existing --bootnode "/dns4/vira-stagenet-dancebox-c1-rpc-0.a.moondev.network/tcp/30333/p2p/12D3KooWHdrcQmeK4V158yEHF8U4iLQr3nseqjQ1bm3f2zBcZdoi"`

### Mark valid for collating in Tanssi
This is done with yarn `register-para markValidForCollating` subcommand and it allows to mark a container-chain as valid for collation. This will ask for several things:
- `--para-id` the para id we want to mark as valid for collation
- `--account-priv-key` the private key of the account that we want to use to issue the transaction. **IT NEEDS TO BE SUDO**.
- `--url` endpoint of the Tanssi network in which we want to issue the transaction.

#### Examples

`yarn register-para markValidForCollating --para-id 2002 --account-priv-key "0xe5be9a5092b81bca64be81d212e7f2f9eba183bb7a90954f7b76361f6edb5c0a" --url "ws://127.0.0.1:9948"`


### De-register a container chain in Tanssi
This is done with yarn `register-para deregister` subcommand and it allows to de-register a container-chain from Tanssi. This will ask for several things:
- `--para-id` the para id we want to mark as valid for collation
- `--account-priv-key` the private key of the account that we want to use to issue the transaction. **IT NEEDS TO BE SUDO**.
- `--url` endpoint of the Tanssi network in which we want to issue the transaction.

#### Examples

`yarn register-para deregister --para-id 2002 --account-priv-key "0xe5be9a5092b81bca64be81d212e7f2f9eba183bb7a90954f7b76361f6edb5c0a" --url "ws://127.0.0.1:9948"`