import {
  PublicKey,
  TransactionInstruction,
  VersionedTransaction,
  TransactionMessage,
  LAMPORTS_PER_SOL,
  Connection,
  Keypair,
  Transaction,
  ComputeBudgetProgram,
  sendAndConfirmTransaction,
  sendAndConfirmRawTransaction,
  TransactionExpiredBlockheightExceededError,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  closeAccount,
  createAssociatedTokenAccountInstruction,
  createCloseAccountInstruction,
  getAssociatedTokenAddress,
  getMint,
} from "@solana/spl-token";

import {
  commitment,
  feePayer
} from "./config";
import {
  bufferFromUInt64,
  createTransaction,
  generateDistribution,
  saveDataToFile,
  sendAndConfirmTransactionWrapper,
  sleep,
  logger
} from "./utility";
import {
  bundle,
  execute
} from "./executor";
import {
  BONDINGCURVECUSTOM,
  BONDING_CURV
} from "./layout/layout";
import {
  GLOBAL,
  FEE_RECIPIENT,
  SYSTEM_PROGRAM,
  TOKEN_PROGRAM,
  RENT,
  PUMP_FUN_ACCOUNT,
  PUMP_FUN_PROGRAM,
  CHECK_FILTER,
  JITO_MODE,
  ASSOC_TOKEN_ACC_PROG,
} from "./constants";

import { filterToken } from "./tokenFilter";
import fs from "fs"
import BN from "bn.js";
import base58 from "bs58";
import readline from "readline"
import { snipe_menu } from "./bot_starter";

const fileName = "./config.json"
const fileName2 = "./config_sniper.json"

let file_content = fs.readFileSync(fileName, 'utf-8');
let file_content2 = fs.readFileSync(fileName2, 'utf-8');
let content = JSON.parse(file_content);
let content2 = JSON.parse(file_content2);

const RPC_ENDPOINT = content.RPC_ENDPOINT;
const RPC_WEBSOCKET_ENDPOINT = content.RPC_WEBSOCKET_ENDPOINT;
const SLIPPAGE = content.Slippage;
const PAYERPRIVATEKEY = content.PAYERPRIVATEKEY;
const payerKeypair = Keypair.fromSecretKey(base58.decode(PAYERPRIVATEKEY));

const solIn = content2.solIn;
const txNum = content2.txNum;
const takeProfit = content2.takeProfit;
const stopLoss = content2.stopLoss;
const txDelay = content2.txDelay;
const txFee = content2.txFee;
const computeUnit = content2.computeUnit;

const connection = new Connection(RPC_ENDPOINT, { wsEndpoint: RPC_WEBSOCKET_ENDPOINT, commitment: "confirmed" });

let virtualSolReserves: BN;
let virtualTokenReserves: BN;

const TRADE_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const BONDING_ADDR_SEED = new Uint8Array([98, 111, 110, 100, 105, 110, 103, 45, 99, 117, 114, 118, 101]);

let bonding: PublicKey;
let assoc_bonding_addr: PublicKey;

let isBuying = false;
let isBought = false;
let buyPrice: number;
let globalLogListener: number | null = null

let rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})

export const runListenerAutomatic = async () => {
  try {
    globalLogListener = connection.onLogs(
      PUMP_FUN_PROGRAM,
      async ({ logs, err, signature }) => {
        const isMint = logs.filter(log => log.includes("MintTo")).length;
        if (!isBuying && isMint && !isBought) {
          isBuying = true

          console.log("\n============== Found new token in the pump.fun: ==============\n")
          console.log("signature: ", signature);

          const parsedTransaction = await connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
          if (!parsedTransaction) {
            console.log("bad Transaction, signature: ", signature);
            isBuying = false
            return;
          }

          const wallet = parsedTransaction?.transaction.message.accountKeys[0].pubkey;
          const mint = parsedTransaction?.transaction.message.accountKeys[1].pubkey;
          const tokenPoolAta = parsedTransaction?.transaction.message.accountKeys[4].pubkey;
          console.log("mint:", mint)
          console.log("tokenPoolAta:", tokenPoolAta)
          console.log("wallet:", wallet)

          // check token if the filtering condition is ok
          if (CHECK_FILTER) {

            // true if the filtering condition is ok, false if the filtering conditin is false
            const buyable = await filterToken(connection, mint!, commitment, wallet!, tokenPoolAta!);

            console.log("🚀 ~ Token is Buyable:", buyable)
            if (buyable) {

              await getPoolState(mint);

              console.log("========= Token Buy start ==========");

              try {
                connection.removeOnLogsListener(globalLogListener!)
                console.log("Global listener is removed!");
              } catch (err) {
                console.log(err);
              }

              // buy transaction
              await buy(payerKeypair, mint, solIn / 10 ** 9, 10);

              console.log("========= Token Buy end ===========");

              // const buyerAta = await getAssociatedTokenAddress(mint, payerKeypair.publicKey)
              // // console.log("BuyerAta: ", buyerAta);
              // const balance = (await connection.getTokenAccountBalance(buyerAta)).value.amount
              // console.log("BuyerAtaBalance: ", balance);
              // const priorityFeeInSol = txFee;     // SOL

              // console.log("========== Token Sell start ===========");

              // await getPoolState(mint);

              // if (!balance) {
              //   console.log("There is no token in this wallet.");
              // } else {
              //   // sell transaction
              //   await sell(payerKeypair, mint, Number(balance), priorityFeeInSol, SLIPPAGE / 100, buyerAta);
              // }

              // console.log("========== Token Sell end ==========");
            }
          }
          isBuying = false
          console.log("isBuying: ", isBuying);
          rl.question("Press Enter to continue Sniping.", () => {
            snipe_menu();
          })
          // if (isBought) process.exit(1);
        }
      },
      commitment
    );
  } catch (err) {
    console.log(err);
  }
};

export const runListenerManual = async () => {
  try {
    globalLogListener = connection.onLogs(
      PUMP_FUN_PROGRAM,
      async ({ logs, err, signature }) => {
        const isMint = logs.filter(log => log.includes("MintTo")).length;
        if (!isBuying && isMint && !isBought) {
          isBuying = true

          console.log("\n============== Found new token in the pump.fun: ==============\n")
          console.log("signature: ", signature);

          const parsedTransaction = await connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
          if (!parsedTransaction) {
            console.log("bad Transaction, signature: ", signature);
            isBuying = false
            return;
          }

          const wallet = parsedTransaction?.transaction.message.accountKeys[0].pubkey;
          const mint = parsedTransaction?.transaction.message.accountKeys[1].pubkey;
          const tokenPoolAta = parsedTransaction?.transaction.message.accountKeys[4].pubkey;
          console.log("mint:", mint)
          console.log("tokenPoolAta:", tokenPoolAta)
          console.log("wallet:", wallet)

          // check token if the filtering condition is ok
          if (CHECK_FILTER) {

            // true if the filtering condition is ok, false if the filtering condition is false
            const buyable = await filterToken(connection, mint!, commitment, wallet!, tokenPoolAta!);
            console.log("🚀 ~ Token is Buyable:", buyable)

            if (buyable) {

              await getPoolState(mint);

              console.log("========= Token Buy start ==========");

              try {
                connection.removeOnLogsListener(globalLogListener!)
                console.log("Global listener is removed!");
              } catch (err) {
                console.log(err);
              }

              // buy transaction
              await buy(payerKeypair, mint, solIn / 10 ** 9, 10);

              console.log("========= Token Buy end ===========");

              const buyerAta = await getAssociatedTokenAddress(mint, payerKeypair.publicKey)
              // console.log("BuyerAta: ", buyerAta);
              const balance = (await connection.getTokenAccountBalance(buyerAta)).value.amount
              console.log("BuyerAtaBalance: ", balance);
              const priorityFeeInSol = txFee;     // SOL


              rl.question("Press 1 to continue Selling.\n Press 2 to return", async (answer) => {
                let choice = parseInt(answer);
                if(choice == 1) {
                  await getPoolState(mint);
                  
                  if (!balance) {
                    console.log("There is no token in this wallet.");
                    await sleep(3000)
                  } else {
                    // sell transaction
                    console.log("========== Token Sell start ===========");
                    await sell(payerKeypair, mint, Number(balance), priorityFeeInSol, SLIPPAGE / 100, buyerAta);
                    console.log("========== Token Sell end ==========");
                  }
                }
                else if(choice == 2) {
                  await getPoolState(mint);
                }
                snipe_menu();
              })
            }
          }
          isBuying = false
          // console.log("isBuying: ", isBuying);
          rl.question("Press Enter to continue Sniping.", () => {
            snipe_menu();
          })
          // if (isBought) process.exit(1);
        }
      },
      commitment
    );
  } catch (err) {
    console.log(err);
  }
};



export const buy = async (
  keypair: Keypair,
  mint: PublicKey,
  solIn: number,
  slippageDecimal: number = 0.01
) => {

  console.log("Payer wallet public key is", payerKeypair.publicKey.toBase58())
  const buyerKeypair = keypair
  const buyerWallet = buyerKeypair.publicKey;
  const tokenMint = mint
  let buyerAta = await getAssociatedTokenAddress(tokenMint, buyerWallet)

  try {
    const transactions: VersionedTransaction[] = []

    console.log("🚀 ~ buyerAta:", buyerAta)

    let ixs: TransactionInstruction[] = [
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Math.floor(txFee * 10 ** 9 / computeUnit * 10 ** 6) }),
      ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnit })
    ];

    // Attempt to retrieve token account, otherwise create associated token account
    try {
      
      const buyerTokenAccountInfo = await connection.getAccountInfo(buyerAta)
      if (!buyerTokenAccountInfo) {
        ixs.push(
          createAssociatedTokenAccountInstruction(
            buyerWallet,
            buyerAta,
            buyerWallet,
            tokenMint,
          )
        )
      }
    } catch (error) {
      console.log(error)
      return
    }

    const solInLamports = solIn * LAMPORTS_PER_SOL;
    console.log("🚀 ~ solInLamports:", solInLamports)
    const tokenOut = Math.round(solInLamports * (virtualTokenReserves.div(virtualSolReserves)).toNumber());
    console.log("🚀 ~ tokenOut:", tokenOut)

    // Calculate the buy price of the token
    buyPrice = (virtualTokenReserves.div(virtualSolReserves)).toNumber();

    const ATA_USER = buyerAta;
    const USER = buyerWallet;
    console.log("🚀 ~ buyerAta:", buyerAta)
    console.log("🚀 ~ buyerWallet:", buyerWallet)

    // Build account key list
    const keys = [
      { pubkey: GLOBAL, isSigner: false, isWritable: false },
      { pubkey: FEE_RECIPIENT, isSigner: false, isWritable: true },
      { pubkey: tokenMint, isSigner: false, isWritable: false },
      { pubkey: bonding, isSigner: false, isWritable: true },
      { pubkey: assoc_bonding_addr, isSigner: false, isWritable: true },
      { pubkey: ATA_USER, isSigner: false, isWritable: true },
      { pubkey: USER, isSigner: true, isWritable: true },
      { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: RENT, isSigner: false, isWritable: false },
      { pubkey: PUMP_FUN_ACCOUNT, isSigner: false, isWritable: false },
      { pubkey: PUMP_FUN_PROGRAM, isSigner: false, isWritable: false }
    ];

    keys.map(async ({ pubkey }, i) => {
      const info = await connection.getAccountInfo(pubkey)
      if (!info) console.log(pubkey.toBase58(), " address info : null : ", i)
    })

    // Calculating the slippage process
    const calc_slippage_up = (sol_amount: number, slippage: number): number => {
      const lamports = sol_amount * LAMPORTS_PER_SOL;
      return Math.round(lamports * (1 + slippage));
      return Math.round(lamports / 1000 * (1 + slippage) + lamports / 1000 * (1 + slippage));
      return Math.round(lamports / 1000 * (1 + slippage / 100));
    }

    const instruction_buf = Buffer.from('66063d1201daebea', 'hex');
    const token_amount_buf = Buffer.alloc(8);
    token_amount_buf.writeBigUInt64LE(BigInt(tokenOut), 0);
    const slippage_buf = Buffer.alloc(8);
    slippage_buf.writeBigUInt64LE(BigInt(calc_slippage_up(solInLamports, slippageDecimal)), 0);
    const data = Buffer.concat([instruction_buf, token_amount_buf, slippage_buf]);

    const swapInstruction = new TransactionInstruction({
      keys: keys,
      programId: PUMP_FUN_PROGRAM,
      data: data
    })

    ixs.push(swapInstruction)
    const blockhash = await connection.getLatestBlockhash()

    // simulation process
    // const tx = new Transaction().add(...ixs)
    // tx.recentBlockhash = blockhash
    // tx.feePayer = buyerWallet

    // Compile message
    const messageV0 = new TransactionMessage({
      payerKey: buyerWallet,
      recentBlockhash: blockhash.blockhash,
      instructions: ixs,
    }).compileToV0Message()
    const transaction = new VersionedTransaction(messageV0)
    transaction.sign([buyerKeypair])
    console.log("==============================================")
    console.log(await connection.simulateTransaction(transaction))

    // Bundling process
    console.log("JITO_MODE:", JITO_MODE);

    if (JITO_MODE) {
      const result = await bundle([transaction], buyerKeypair, connection)
      console.log("Bundling result: ", result);
    } else {
      await execute(transaction, blockhash)
    }
  } catch (e) {
    logger.debug(e)
    console.log(`Failed to buy token, ${mint}`)
  }

  console.log("---------Checking the result---------")
  let index = 0
  while (true) {
    if (index > txNum) {
      console.log("token sniping failed")
      return
    }
    try {
      const tokenBalance = (await connection.getTokenAccountBalance(buyerAta)).value.uiAmount
      if (tokenBalance && tokenBalance > 0) {
        console.log("🚀 ~ tokenBalance:", tokenBalance)
        isBought = true
        break
      }
    } catch (error) {
      index++
      await sleep(txDelay * 1000)
    }
  }
  console.log("Bundling result confirmed, successfully bought")
}

export const sell = async (
  payerKeypair: Keypair,
  mint: PublicKey,
  tokenBalance: number,
  priorityFeeInSol: number = 0,
  slippageDecimal: number = 0.25,
  tokenAccountAddress: PublicKey
) => {
  
  try {
    const owner = payerKeypair;
    const txBuilder = new Transaction();
    
    // await getPoolState(new PublicKey("ZsPzY1DASFhBshVS4ErHsN8UEqLQwGpeHMh17Yepump"));
    await getPoolState(mint);
    
    // console.log("virtualSolReserves: ", virtualSolReserves.toString());
    // console.log("virtualTokenReserves", virtualTokenReserves.toString());
    
    // Calculate the sell price
    const sellPrice = (virtualTokenReserves.div(virtualSolReserves)).toNumber();
    
    // Check if the price is good for the Stop_Loss and take_profit
    const netChange = (sellPrice - buyPrice) / buyPrice;
    console.log("Net change : ", netChange);
    
    let index = 0;
    if (stopLoss + netChange * 100 > 0 && netChange < 0 || netChange * 100 < takeProfit && netChange > 0) {
      index++;
      if(index > txNum) {
        console.log("---Selling failed.---");
        return false;
      }
      if(netChange < 0) {
        console.log("Price goes down under the stopLoss");
        await sleep(txDelay * 1000)
        await sell(payerKeypair, mint, tokenBalance, priorityFeeInSol, slippageDecimal, tokenAccountAddress);
      } else if(netChange > 0) {
        console.log("Price not goes up over the takeProfit");
        await sleep(txDelay * 1000)
        await sell(payerKeypair, mint, tokenBalance, priorityFeeInSol, slippageDecimal, tokenAccountAddress);
      }
    }
    
    // const tokenAccountInfo = await connection.getAccountInfo(tokenAccountAddress);
    const tokenAccount = tokenAccountAddress;
    
    const minSolOutput = Math.floor(tokenBalance * (1 - slippageDecimal) * (virtualSolReserves.mul(new BN(1000000)).div(virtualTokenReserves)).toNumber());
    console.log("minSolOut: ", minSolOutput);
    
    const keys = [
      { pubkey: GLOBAL, isSigner: false, isWritable: false },
      { pubkey: FEE_RECIPIENT, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: bonding, isSigner: false, isWritable: true },
      { pubkey: assoc_bonding_addr, isSigner: false, isWritable: true },
      { pubkey: tokenAccount, isSigner: false, isWritable: true },
      { pubkey: owner.publicKey, isSigner: false, isWritable: true },
      { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: ASSOC_TOKEN_ACC_PROG, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: PUMP_FUN_ACCOUNT, isSigner: false, isWritable: false },
      { pubkey: PUMP_FUN_PROGRAM, isSigner: false, isWritable: false }
    ];

    const data = Buffer.concat([
      bufferFromUInt64("12502976635542562355"),
      bufferFromUInt64(tokenBalance),
      bufferFromUInt64(minSolOutput)
    ]);
    
    const instruction = new TransactionInstruction({
      keys: keys,
      programId: PUMP_FUN_PROGRAM,
      data: data
    });

    const blockhash = await connection.getLatestBlockhash()

    txBuilder.add(instruction);
    txBuilder.feePayer = owner.publicKey;
    txBuilder.recentBlockhash = blockhash.blockhash;
    console.log(await connection.simulateTransaction(txBuilder));
    
    txBuilder.add(createCloseAccountInstruction(tokenAccount, owner.publicKey, owner.publicKey))
    
    const transaction = await createTransaction(connection, txBuilder.instructions, owner.publicKey, priorityFeeInSol);
    console.log("🚀 ~ priorityFeeInSol:", priorityFeeInSol)

    
    // console.log(transaction);
    console.log("Ok");
    console.log(await connection.simulateTransaction(transaction))
    console.log("Ok");
    
    const signature = await sendAndConfirmTransactionWrapper(connection, transaction, [owner]);
    if (signature) console.log('Sell transaction confirmed:', signature);
  }
  catch (error) {
    console.log(error)
  }
}



const getPoolState = async (mint: PublicKey) => {
  // get the address of bonding curve and associated bonding curve
  [bonding] = PublicKey.findProgramAddressSync([BONDING_ADDR_SEED, mint.toBuffer()], TRADE_PROGRAM_ID);
  [assoc_bonding_addr] = PublicKey.findProgramAddressSync([bonding.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID);

  // get the accountinfo of bonding curve
  const accountInfo = await connection.getAccountInfo(bonding, "processed")
  // console.log("🚀 ~ accountInfo:", accountInfo)
  if (!accountInfo) return

  // get the poolstate of the bonding curve
  const poolState = BONDING_CURV.decode(
    accountInfo.data
  );
  console.log("🚀 ~ poolState:", poolState)
  // console.log("virtualTokenReserves: ", poolState.virtualTokenReserves.toString());
  // console.log("realTokenReserves: ", poolState.realTokenReserves.toString());

  // Calculate tokens out
  virtualSolReserves = poolState.virtualSolReserves;
  virtualTokenReserves = poolState.virtualTokenReserves;
}

runListenerAutomatic()

// sell(payerKeypair, new PublicKey("ZsPzY1DASFhBshVS4ErHsN8UEqLQwGpeHMh17Yepump"), 6500000000, 0.00002, 1, new PublicKey("2CzeRJcFd9bUDEtL8YK8m1NmkEwS7J53f2yao9Uzksdk"))
