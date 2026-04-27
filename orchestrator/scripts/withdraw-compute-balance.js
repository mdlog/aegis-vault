#!/usr/bin/env node
/**
 * Withdraw 0G Compute ledger balance from a wallet.
 *
 * 0G Compute holds pre-deposited funds in a ledger contract, keyed by the
 * depositing wallet's address. If you paid for inference from a wallet you
 * no longer use (e.g. an old compromised deployer key you still have the
 * private key of), you can pull the leftover balance back.
 *
 * Two-stage withdrawal:
 *   1. retrieveFund('inference')  — pulls any balance still locked in
 *      provider sub-accounts (from transferFund() calls) back to your main
 *      ledger balance.
 *   2. deleteLedger()             — closes your ledger account and refunds
 *      the ENTIRE main balance back to your wallet's on-chain native 0G.
 *
 * If you only want partial withdrawal without closing the account, use
 * `refund(amount)` instead of deleteLedger.
 *
 * Usage:
 *   WITHDRAW_PRIVATE_KEY=<hex> \
 *     node scripts/withdraw-compute-balance.js
 *
 *   # Partial refund (keeps ledger open):
 *   WITHDRAW_PRIVATE_KEY=<hex> AMOUNT=1.5 \
 *     node scripts/withdraw-compute-balance.js
 *
 *   # Nuclear: delete ledger + refund all:
 *   WITHDRAW_PRIVATE_KEY=<hex> NUKE=1 \
 *     node scripts/withdraw-compute-balance.js
 */

import { ethers } from 'ethers';
import { createZGComputeNetworkBroker } from '@0glabs/0g-serving-broker';

const RPC = process.env.OG_COMPUTE_RPC || 'https://evmrpc.0g.ai';
const KEY = process.env.WITHDRAW_PRIVATE_KEY;
const AMOUNT = process.env.AMOUNT ? parseFloat(process.env.AMOUNT) : null; // in 0G
const NUKE = process.env.NUKE === '1';

async function main() {
  if (!KEY) {
    console.error('Set WITHDRAW_PRIVATE_KEY=<hex private key of wallet with 0G Compute deposit>');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(KEY, provider);
  const nativeBal = await provider.getBalance(wallet.address);
  console.log('─'.repeat(60));
  console.log('0G Compute withdrawal');
  console.log('  Wallet      :', wallet.address);
  console.log('  Native 0G   :', ethers.formatEther(nativeBal));
  console.log('  RPC         :', RPC);

  if (nativeBal === 0n) {
    console.error('⚠️  Wallet has 0 native 0G — cannot pay gas for withdrawal tx.');
    console.error('    Transfer ~0.01 0G to this wallet first, then re-run.');
    process.exit(1);
  }

  console.log('\nConnecting to 0G Compute broker…');
  const broker = await createZGComputeNetworkBroker(wallet);

  // 1. Read current ledger state — TWO relevant fields on LedgerStructOutput:
  //    totalBalance    = everything you ever deposited (includes provider-locked)
  //    availableBalance = unlocked portion, the only thing refund() can pull
  let ledger;
  try {
    ledger = await broker.ledger.getLedger();
  } catch (err) {
    console.error('⚠️  No ledger account found for this wallet.');
    console.error('    This wallet never deposited to 0G Compute, or deposit was already refunded.');
    console.error('    Detail:', err.message?.substring(0, 160));
    process.exit(1);
  }

  const totalBalance = Number(ethers.formatUnits(ledger.totalBalance ?? 0n, 18));
  const availableBalance = Number(ethers.formatUnits(ledger.availableBalance ?? 0n, 18));
  const lockedBalance = Math.max(0, totalBalance - availableBalance);

  console.log('\nCurrent ledger state:');
  console.log('  Total balance         :', totalBalance.toFixed(6), '0G');
  console.log('  Available (refundable):', availableBalance.toFixed(6), '0G');
  console.log('  Locked in providers   :', lockedBalance.toFixed(6), '0G');

  // 2. Bulk retrieve from all inference provider sub-accounts at once. This
  //    is the public broker method; it iterates providers internally and
  //    frees whatever isn't still in the cooldown window.
  console.log('\n1/2  Retrieving funds from inference providers back to main balance…');
  try {
    await broker.ledger.retrieveFund('inference');
    console.log('      ✓ retrieveFund(inference) completed');
  } catch (err) {
    const msg = (err.message || '').substring(0, 160);
    if (/pending|zero|no.*fund|not.*allowed|has pending|cooldown/i.test(msg)) {
      console.log('      (nothing retrievable yet — providers still in cooldown)');
    } else {
      console.warn('      retrieveFund warning:', msg);
    }
  }

  // Re-read ledger after retrieve attempts
  ledger = await broker.ledger.getLedger();
  const availAfter = Number(ethers.formatUnits(ledger.availableBalance ?? 0n, 18));
  const totalAfter = Number(ethers.formatUnits(ledger.totalBalance ?? 0n, 18));
  console.log(`\nAfter retrieve: total=${totalAfter.toFixed(6)} · available=${availAfter.toFixed(6)} 0G`);

  if (availAfter === 0) {
    console.log('\n⚠️  Available balance is 0. Nothing to refund right now.');
    console.log('    Cause: provider sub-accounts may still be within their refund-cooldown window.');
    console.log('    The 0G Compute contract enforces a waiting period after transferFund() before');
    console.log('    retrieveFundFromProvider() can free those funds. Typical wait: a few hours to days.');
    console.log('    Re-run this script later. Or use NUKE=1 to try deleteLedger() (may also fail');
    console.log('    with the same constraint until cooldowns expire).');
    if (!NUKE) process.exit(0);
  }

  // 3. Refund or delete
  if (NUKE) {
    console.log('\n2/2  Deleting ledger (forces refund of whatever is unlocked)…');
    try {
      await broker.ledger.deleteLedger();
      console.log('      ✓ deleteLedger() — ledger closed, available balance refunded.');
    } catch (err) {
      console.error('      ✗ deleteLedger failed:', err.message?.substring(0, 200));
      console.error('        Provider-locked funds are likely still in cooldown. Try again later.');
      process.exit(1);
    }
  } else {
    // Cap refund to availableBalance
    const requested = AMOUNT != null ? AMOUNT : availAfter;
    const toRefund = Math.min(requested, availAfter);
    if (toRefund !== requested) {
      console.log(`\n⚠️  Requested ${requested} 0G exceeds availableBalance ${availAfter.toFixed(6)} 0G.`);
      console.log(`    Capping refund to ${toRefund.toFixed(6)} 0G.`);
    }
    if (toRefund === 0) {
      console.log('\nNothing to refund. Exit.');
      process.exit(0);
    }
    console.log(`\n2/2  Refunding ${toRefund.toFixed(6)} 0G (ledger stays open)…`);
    await broker.ledger.refund(toRefund);
    console.log('      ✓ refund() successful');
  }

  // Final balance check
  const finalNative = await provider.getBalance(wallet.address);
  console.log('\n' + '═'.repeat(60));
  console.log('Done.');
  console.log('  Native 0G before :', ethers.formatEther(nativeBal));
  console.log('  Native 0G after  :', ethers.formatEther(finalNative));
  console.log('  Difference       :', ethers.formatEther(finalNative - nativeBal), '(minus gas)');
  console.log('═'.repeat(60));
  console.log('Tip: now transfer this native 0G to your fresh admin wallet:');
  console.log(`  cast send 0x98cC8351C1310FD54B9090dF3fcA80CB61d7b5E7 \\`);
  console.log(`    --value <amount> --rpc-url ${RPC} --private-key <this-key> --legacy --chain 16661`);
}

main().catch((err) => {
  console.error('Withdraw failed:', err);
  process.exit(1);
});
