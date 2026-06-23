// One-shot 0G Compute ledger top-up.
//
// Reads PRIVATE_KEY (or OG_COMPUTE_PRIVATE_KEY) from orchestrator/.env, prints
// the current ledger balance, then deposits AMOUNT 0G (default 5) so the
// orchestrator's auto-fund step (broker.ledger.transferFund 1 0G per provider)
// can succeed.
//
// Usage:
//   node scripts/deposit-compute-balance.js                # deposits 5 0G
//   AMOUNT=3 node scripts/deposit-compute-balance.js       # deposits 3 0G

import 'dotenv/config';
import { ethers } from 'ethers';
import { createZGComputeNetworkBroker } from '@0glabs/0g-serving-broker';

const RPC = process.env.OG_COMPUTE_RPC || 'https://evmrpc.0g.ai';
const KEY = (process.env.OG_COMPUTE_PRIVATE_KEY || process.env.PRIVATE_KEY || '').replace(/^0x/, '');
const AMOUNT = Number(process.env.AMOUNT || 5);
const CHAIN_ID = Number(process.env.CHAIN_ID || 16661);

if (!KEY) {
  console.error('No PRIVATE_KEY / OG_COMPUTE_PRIVATE_KEY in .env');
  process.exit(1);
}

// Skip ethers' auto-detect (eth_chainId on startup) — RPC's state reads
// can be slow (5s+) and the implicit detection call times out before the
// script gets a chance to do anything. Hardcode chainId + raise pollingInterval.
const provider = new ethers.JsonRpcProvider(RPC, {
  chainId: CHAIN_ID,
  name: `chain-${CHAIN_ID}`,
}, { staticNetwork: true });

async function withRetry(fn, label, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === attempts) throw e;
      console.log(`${label}: attempt ${i} failed (${e.code || e.message?.slice(0, 60)}), retrying...`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

const wallet = new ethers.Wallet(KEY, provider);

console.log(`Wallet : ${wallet.address}`);
const nativeBal = await withRetry(() => provider.getBalance(wallet.address), 'getBalance');
console.log(`Native : ${ethers.formatEther(nativeBal)} 0G`);

if (nativeBal < ethers.parseEther(String(AMOUNT + 0.05))) {
  console.error(`Insufficient native 0G — need ~${AMOUNT + 0.05} for deposit + gas, have ${ethers.formatEther(nativeBal)}`);
  process.exit(1);
}

const broker = await createZGComputeNetworkBroker(wallet);

let ledgerExists = true;
try {
  const ledger = await broker.ledger.getLedger();
  console.log(`Ledger : available ${ledger.totalBalance ?? ledger.balance ?? '?'} (raw)`);
} catch {
  ledgerExists = false;
  console.log('Ledger : (not created yet)');
}

if (!ledgerExists) {
  console.log(`Creating ledger with addLedger(${AMOUNT})...`);
  await broker.ledger.addLedger(AMOUNT);
  console.log('Ledger created ✓');
} else {
  console.log(`Depositing ${AMOUNT} 0G via depositFund(${AMOUNT})...`);
  await broker.ledger.depositFund(AMOUNT);
  console.log('Deposit complete ✓');
}

// Re-read after deposit
try {
  const after = await broker.ledger.getLedger();
  console.log(`New balance: ${JSON.stringify(after, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2)}`);
} catch (e) {
  console.log('(could not re-read ledger after deposit:', e.message, ')');
}
