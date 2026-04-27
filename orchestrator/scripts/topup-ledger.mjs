// One-off helper: top up the 0G Compute ledger reservoir from the wallet's
// native balance. Run when the orchestrator logs "[Auto-funding] Requires ...
// ledger available balance is insufficient".
//
// Prerequisite: wallet (addr from OG_COMPUTE_PRIVATE_KEY or PRIVATE_KEY) must
// hold at least `AMOUNT + 0.5` native 0G (deposit + gas buffer).
//
// Usage: node scripts/topup-ledger.mjs [amount]
//   default amount: 3 (0G)

import { ethers } from 'ethers';
import { createZGComputeNetworkBroker } from '@0glabs/0g-serving-broker';
import dotenv from 'dotenv';
dotenv.config();

const AMOUNT = Number(process.argv[2] || 3);

async function main() {
  const rpc = process.env.OG_COMPUTE_RPC || 'https://evmrpc.0g.ai';
  const pk  = (process.env.OG_COMPUTE_PRIVATE_KEY || process.env.PRIVATE_KEY || '').replace(/^0x/, '');
  if (!pk) throw new Error('Set OG_COMPUTE_PRIVATE_KEY or PRIVATE_KEY in .env');

  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet   = new ethers.Wallet(pk, provider);
  const bal      = await provider.getBalance(wallet.address);
  const balOG    = Number(ethers.formatEther(bal));

  console.log(`Wallet:          ${wallet.address}`);
  console.log(`Native balance:  ${balOG.toFixed(4)} 0G`);
  console.log(`Deposit amount:  ${AMOUNT} 0G`);

  if (balOG < AMOUNT + 0.5) {
    console.error(`\n✗ Insufficient balance. Need at least ${AMOUNT + 0.5} 0G (${AMOUNT} deposit + 0.5 gas buffer).`);
    console.error(`  Transfer more 0G to ${wallet.address} first.`);
    process.exit(1);
  }

  console.log('\nConnecting to 0G Compute broker…');
  const broker = await createZGComputeNetworkBroker(wallet);

  console.log(`Calling broker.ledger.depositFund(${AMOUNT})…`);
  await broker.ledger.depositFund(AMOUNT);
  console.log('✓ Deposit tx submitted.');

  // Give chain a few seconds to confirm, then re-read ledger.
  await new Promise((r) => setTimeout(r, 8000));
  try {
    const ledger = await broker.ledger.getLedger();
    console.log(`\nLedger after top-up:`);
    console.log(JSON.stringify(ledger, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
  } catch (e) {
    console.log('(Could not read ledger immediately; check next cycle log.)');
  }

  console.log('\n✓ Done. Orchestrator should pick up the new reservoir on next cycle.');
}

main().catch((e) => {
  console.error('\n✗ Top-up failed:', e.message);
  if (e.stack) console.error(e.stack);
  process.exit(1);
});
