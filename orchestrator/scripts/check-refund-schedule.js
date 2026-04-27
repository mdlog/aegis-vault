#!/usr/bin/env node
/**
 * Query the InferenceServing contract directly to read the refund schedule
 * for a specific (user, provider) pair. Each refund entry has a createdAt
 * timestamp — once current time > createdAt + lockTime, retrieveFund() can
 * finalize and release the funds back to the ledger's availableBalance.
 *
 * Usage:
 *   WALLET=0x...         # user wallet (the one that deposited)
 *   PROVIDER=0x...       # provider address from `inspect-compute-ledger.js`
 *   node scripts/check-refund-schedule.js
 */

import { ethers } from 'ethers';

const RPC = process.env.OG_COMPUTE_RPC || 'https://evmrpc.0g.ai';
const WALLET = process.env.WALLET || process.argv[2];
const PROVIDER = process.env.PROVIDER || process.argv[3];

// 0G Compute InferenceServing contract — mainnet address from @0glabs SDK
// (CONTRACT_ADDRESSES.mainnet.inference)
const INFERENCE_SERVING = '0x47340d900bdFec2BD393c626E12ea0656F938d84';

// Minimal ABI — just the getters we need
const ABI = [
  'function getAccount(address user, address provider) view returns (tuple(address user, address provider, uint256 nonce, uint256 balance, uint256 pendingRefund, uint256[2] signer, string additionalInfo, tuple(uint256 index, uint256 amount, uint256 createdAt, bool processed)[] refunds, address providerPubKey, string teeSignerAddress, uint8 engine))',
  'function lockTime() view returns (uint256)',
];

async function main() {
  if (!WALLET || !PROVIDER) {
    console.error('Usage: WALLET=0x... PROVIDER=0x... node scripts/check-refund-schedule.js');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC);
  const inf = new ethers.Contract(INFERENCE_SERVING, ABI, provider);

  const lockTime = await inf.lockTime().catch(() => null);
  if (lockTime != null) {
    const hours = Number(lockTime) / 3600;
    console.log(`Contract cooldown (lockTime): ${lockTime.toString()} seconds (~${hours} hours)`);
  }

  console.log(`\nQuerying account: user=${WALLET} provider=${PROVIDER}`);
  let account;
  try {
    account = await inf.getAccount(WALLET, PROVIDER);
  } catch (err) {
    console.error('getAccount failed:', err.message?.substring(0, 200));
    console.error('\nThis can mean the sub-account was already closed and funds moved back to ledger main.');
    console.error('Run withdraw-compute-balance.js again — availableBalance should now be > 0.');
    process.exit(1);
  }

  console.log('\nAccount state:');
  console.log('  balance       :', ethers.formatUnits(account.balance, 18), '0G');
  console.log('  pendingRefund :', ethers.formatUnits(account.pendingRefund, 18), '0G');
  console.log('  nonce         :', account.nonce.toString());
  console.log('  refunds       :', account.refunds.length, 'entries');

  if (account.refunds.length === 0) {
    console.log('\nNo refund entries. You may need to call retrieveFund() first to open a refund window.');
    process.exit(0);
  }

  console.log('\nRefund schedule:');
  const now = Math.floor(Date.now() / 1000);
  const lockSec = Number(lockTime ?? 0n);

  for (const r of account.refunds) {
    const created = Number(r.createdAt);
    const expires = created + lockSec;
    const amount = ethers.formatUnits(r.amount, 18);
    const status = r.processed ? 'PROCESSED' : (now >= expires ? 'READY_TO_CLAIM' : 'COOLDOWN');
    const createdDate = new Date(created * 1000).toISOString();
    const expiresDate = new Date(expires * 1000).toISOString();
    const remaining = expires - now;
    const remainingHuman = remaining <= 0
      ? '(expired)'
      : `${Math.floor(remaining / 3600)}h ${Math.floor((remaining % 3600) / 60)}m remaining`;

    console.log(`  #${r.index}`);
    console.log(`     amount    : ${amount} 0G`);
    console.log(`     createdAt : ${createdDate}`);
    console.log(`     expiresAt : ${expiresDate}`);
    console.log(`     status    : ${status} ${remainingHuman}`);
    console.log(`     processed : ${r.processed}`);
  }

  const ready = account.refunds.filter((r) => !r.processed && now >= Number(r.createdAt) + lockSec);
  if (ready.length > 0) {
    const total = ready.reduce((a, r) => a + BigInt(r.amount), 0n);
    console.log(`\n✓ ${ready.length} refund(s) READY TO CLAIM. Total: ${ethers.formatUnits(total, 18)} 0G.`);
    console.log('  Run: WITHDRAW_PRIVATE_KEY=<key> node scripts/withdraw-compute-balance.js');
  } else {
    const soonest = account.refunds
      .filter((r) => !r.processed)
      .map((r) => Number(r.createdAt) + lockSec - now)
      .filter((x) => x > 0)
      .sort((a, b) => a - b)[0];
    if (soonest) {
      const h = Math.floor(soonest / 3600);
      const m = Math.floor((soonest % 3600) / 60);
      console.log(`\nCooldown still active. Next refund expires in ${h}h ${m}m.`);
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
