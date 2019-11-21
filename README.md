# slp-mint-contracts

This repo contains smart contracts for minting with enhanced functionality and security.

Features roadmap include:

- [x] prevents burning the minting baton using a convenant
- [ ] requires contract address private key to be updated
- [ ] absolute minting limit restrictions
- [ ] time-based minting restrictions
- [ ] time-based + quantity-based minting schedule restrictions
- [ ] time-based + quantity-based + absolute limit minting schedule restrictions

### Mint Vault Versions

* MintVaultV0 - Basic minting vault protects from accidental burning, uses same public key and p2sh address for each transaction
* MintVaultV1 - Basic minting vault protects from accidental burning, requires updated public key for each transaction
* MintVaultV2 - TBD
* MintVaultV3 - TBD
* MintVaultV4 - TBD

### Install

```
$ git clone https://github.com/simpleledgerinc/slp-mint-contracts.git
$ cd slp-mint-contracts
$ npm i
```

### Tests

```
$ cd regtest
$ docker-compose up -d
$ npm test
```
