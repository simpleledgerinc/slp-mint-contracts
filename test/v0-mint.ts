import assert from "assert";
import BigNumber from "bignumber.js";
import { BITBOX, ECPair } from "bitbox-sdk";
import { Contract, Instance } from "cashscript";
import { step } from "mocha-steps";
import path from "path";
import { bitcore, LocalValidator, Slp, SlpAddressUtxoResult, TransactionHelpers, Utils } from "slpjs";

const Bitcore = require("bitcoincashjs-lib");
const bchaddr = require("bchaddrjs-slp");
const rpcClient = require("bitcoin-rpc-promise-retry");

// connect rpc client to regtest network (see "regtest" directory)
const connectionStringNodeMiner = "http://bitcoin:password@0.0.0.0:18443";
const rpcNodeMiner = new rpcClient(connectionStringNodeMiner, { maxRetries: 0 });

const bitbox = new BITBOX();
const slp = new Slp(bitbox);
const txnHelpers = new TransactionHelpers(slp);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let tokenReceiverAddrRegtest: string;
let tokenReceiverAddrSlptest: string;
let mintVaultAddrSlptestP2sh: string;
let mintBatonReceiverPubKey: Buffer;
let mintBatonReceiverWif: string;
let lastMintTxid: string;
let redeemScriptBuf: Buffer;
let txnInputs: SlpAddressUtxoResult[];

// setup a new local SLP validator
const validator = new LocalValidator(bitbox, async (txids) => {
    let txn;
    try {
        txn = ( await rpcNodeMiner.getRawTransaction(txids[0]) as string);
    } catch (err) {
        throw Error(`[ERROR] Could not get transaction ${txids[0]} in local validator: ${err}`);
    }
    return [ txn ];
}, console);

// load the contract file
const MintVault = Contract.fromCashFile(
    path.join(__dirname, "../slp-mint-vault-v0.cash"),
    "testnet",
);

describe("Mint", () => {

    step("[SETUP] Initial setup for all tests", async () => {
        // generate block to clear the mempool (may be dirty from previous tests)
        await rpcNodeMiner.generate(1);

        // make sure we have coins to use in tests
        let balance = await rpcNodeMiner.getBalance();
        while (balance < 1) {
            await rpcNodeMiner.generate(1);
            balance = await rpcNodeMiner.getBalance();
        }

        // put all the funds on the receiver's address
        //
        // console.log(receiverRegtest);
        tokenReceiverAddrRegtest = await rpcNodeMiner.getNewAddress("0");
        await rpcNodeMiner.sendToAddress(tokenReceiverAddrRegtest, 1, "", "", true);
        tokenReceiverAddrSlptest = Utils.toSlpAddress(tokenReceiverAddrRegtest);
    });

    step("[SETUP] Get public/private key for issuer and the token receiver address.", async () => {
        mintBatonReceiverWif = await rpcNodeMiner.dumpPrivKey(tokenReceiverAddrRegtest);
        mintBatonReceiverPubKey = (new ECPair().fromWIF(mintBatonReceiverWif)).getPublicKeyBuffer();
    });

    step("[SETUP] GENESIS: setup for the txn tests", async () => {
        let unspent = await rpcNodeMiner.listUnspent(0);
        unspent = unspent.filter((txo: any) => txo.address === tokenReceiverAddrRegtest);
        if (unspent.length === 0) { throw Error("No unspent outputs."); }
        unspent.map((txo: any) => txo.cashAddress = txo.address);
        unspent.map((txo: any) => txo.satoshis = txo.amount * 10 ** 8);
        await Promise.all(unspent.map(async (txo: any) => txo.wif = await rpcNodeMiner.dumpPrivKey(txo.address)));

        // validate and categorize unspent TXOs
        const utxos = await slp.processUtxosForSlpAbstract([unspent[0]], validator);
        txnInputs = utxos.nonSlpUtxos;

        assert.equal(txnInputs.length > 0, true);
    });

    const TOKEN_DECIMALS = 1;
    const TOKEN_GENESIS_QTY = 100;
    let tokenId: string;
    let vault: Instance;

    step("[SETUP] Create a new token genesis", async () => {
        const genesisHex = txnHelpers.simpleTokenGenesis(
            "unit-test-1", "ut1", new BigNumber(TOKEN_GENESIS_QTY).times(10 ** TOKEN_DECIMALS), null, null,
            TOKEN_DECIMALS, tokenReceiverAddrSlptest, tokenReceiverAddrSlptest, tokenReceiverAddrSlptest, txnInputs);

        tokenId = await rpcNodeMiner.sendRawTransaction(genesisHex, true);
        //await sleep(100);
    });

    step("[SETUP] Setup the mint vault contract address", async () => {
        vault = MintVault.new(
                            mintBatonReceiverPubKey,
                            Buffer.from(tokenId, "hex"),
                            Buffer.from("01", "hex"),
                            );

        // @ts-ignore
        redeemScriptBuf = bitbox.Script.encode(vault.redeemScript);

        console.log(`redeemScript:\n${redeemScriptBuf.toString("hex")}`);
        const scriptPubKey = "a914" + Buffer.from(bchaddr.decodeAddress(vault.address).hash).toString("hex") + "87";
        console.log(`scriptPubKey:\n${scriptPubKey}`);
        mintVaultAddrSlptestP2sh = Utils.toSlpAddress(vault.address);
    });

    step("[SETUP] Send mint baton to the mint vault contract address", async () => {
        // get current address UTXOs
        let unspent = await rpcNodeMiner.listUnspent(0);
        unspent = unspent.filter((txo: any) => txo.address === tokenReceiverAddrRegtest);
        if (unspent.length === 0) { throw Error("No unspent outputs."); }
        unspent.map((txo: any) => txo.cashAddress = txo.address);
        unspent.map((txo: any) => txo.satoshis = txo.amount * 10 ** 8);
        await Promise.all(unspent.map(async (txo: any) => txo.wif = await rpcNodeMiner.dumpPrivKey(txo.address)));

        // process raw UTXOs
        const utxos = await slp.processUtxosForSlpAbstract(unspent, validator);

        // select the inputs for transaction
        txnInputs = [ ...utxos.nonSlpUtxos, ...utxos.slpBatonUtxos[tokenId] ];

        assert.equal(txnInputs.length > 1, true);

        // create a MINT Transaction
        const mintHex = txnHelpers.simpleTokenMint(tokenId,
                                                    new BigNumber(0),
                                                    txnInputs,
                                                    tokenReceiverAddrSlptest,
                                                    mintVaultAddrSlptestP2sh,
                                                    tokenReceiverAddrSlptest,
                                                    );

        lastMintTxid = await rpcNodeMiner.sendRawTransaction(mintHex, true);

        console.log(lastMintTxid);
    });

    step("[MINT VAULT SPEND] Mint new tokens from the contract address #1", async () => {

        // get current address UTXOs
        let unspent = await rpcNodeMiner.listUnspent(0);
        unspent = unspent.filter((txo: any) => txo.address === tokenReceiverAddrRegtest);
        if (unspent.length === 0) { throw Error("No unspent outputs."); }
        unspent.map((txo: any) => txo.cashAddress = txo.address);
        unspent.map((txo: any) => txo.satoshis = txo.amount * 10 ** 8);
        await Promise.all(unspent.map(async (txo: any) => txo.wif = await rpcNodeMiner.dumpPrivKey(txo.address)));

        // process raw UTXOs
        const utxos = await slp.processUtxosForSlpAbstract(unspent, validator);

        // add p2sh baton input with scriptSig
        let txo = await rpcNodeMiner.gettxout(lastMintTxid, 2, true);
        txo.txid = lastMintTxid;
        txo.vout = 2;
        let baton = await slp.processUtxosForSlpAbstract([txo], validator);

        assert.equal(baton.slpBatonUtxos[tokenId].length, 1);

        // select the inputs for transaction
        txnInputs = [ ...baton.slpBatonUtxos[tokenId], ...utxos.nonSlpUtxos ];

        assert.equal(txnInputs.length > 1, true);

        // Estimate the additional fee for our larger p2sh scriptSig
        const extraFee = 4 + 100 + 8 + 4 + 32 + 8 + 8 + 20 + 72;

        // create a MINT Transaction
        const unsignedMintHex = txnHelpers.simpleTokenMint(
                                                tokenId,
                                                new BigNumber(1),
                                                txnInputs,
                                                tokenReceiverAddrSlptest,
                                                mintVaultAddrSlptestP2sh,
                                                tokenReceiverAddrSlptest,
                                                extraFee,
                                                true,
                                                );

        // Build scriptSig
        const scriptSigs = baton.slpBatonUtxos[tokenId].map((txo, i) => {
            const sigObj = txnHelpers.get_transaction_sig_p2sh(
                                                    unsignedMintHex,
                                                    mintBatonReceiverWif,
                                                    i, txo.satoshis,
                                                    redeemScriptBuf,
                                                    );

            const txn = Bitcore.Transaction.fromHex(unsignedMintHex);
            const preimageChunks = txn.sigHashPreimageBufChunks(i, redeemScriptBuf, 546, 0x41);

            return {
                index: i,
                lockingScriptBuf: redeemScriptBuf,
                unlockingScriptBufArray: [
                    sigObj.signatureBuf,
                    ...preimageChunks,
                    Buffer.from("0000000000000001", "hex"),
                    Buffer.from(bchaddr.decodeAddress(tokenReceiverAddrRegtest).hash),
                ].reverse(),
            };
        });

        const signedTxn = txnHelpers.addScriptSigs(unsignedMintHex, scriptSigs);

        try {
            lastMintTxid = await rpcNodeMiner.sendRawTransaction(signedTxn, true);
        } catch (error) {
            console.log(error);
            throw error;
        }

        // make sure we still have 1 valid baton after spending the contract
        txo = await rpcNodeMiner.gettxout(lastMintTxid, 2, true);
        txo.txid = lastMintTxid;
        txo.vout = 2;
        baton = await slp.processUtxosForSlpAbstract([txo], validator);
        assert.equal(baton.slpBatonUtxos[tokenId].length, 1);
    });

});
