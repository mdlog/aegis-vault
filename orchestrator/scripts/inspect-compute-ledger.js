#!/usr/bin/env node
/**
 * Inspect 0G Compute ledger — enumerate every provider sub-account for a
 * given wallet and show per-provider balance + pending refund state. Useful
 * when refund() / retrieveFund() aren't freeing funds and you need to
 * understand which provider is holding how much + what the cooldown schedule
 * looks like.
 *
 * Usage:
 *   WITHDRAW_PRIVATE_KEY=<hex> node scripts/inspect-compute-ledger.js
 */

import { ethers } from 'ethers';
import { createZGComputeNetworkBroker } from '@0glabs/0g-serving-broker';

const RPC = process.env.OG_COMPUTE_RPC || 'https://evmrpc.0g.ai';
const KEY = process.env.WITHDRAW_PRIVATE_KEY;

async function main() {
  if (!KEY) { console.error('Set WITHDRAW_PRIVATE_KEY'); process.exit(1); }
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(KEY, provider);
  const broker = await createZGComputeNetworkBroker(wallet);

  console.log('Wallet:', wallet.address);

  // Public summary
  const ledger = await broker.ledger.getLedger();
  console.log('\nLedger summary:');
  console.log('  Total     :', ethers.formatUnits(ledger.totalBalance ?? 0n, 18), '0G');
  console.log('  Available :', ethers.formatUnits(ledger.availableBalance ?? 0n, 18), '0G');

  // Internal LedgerProcessor exposes richer info including .infers (per-provider)
  const processor = broker.ledger.ledger;
  if (!processor || typeof processor.getLedgerWithDetail !== 'function') {
    console.log('\n(internal getLedgerWithDetail not accessible — listing providers another way)');
    // Fallback: try broker.inference.listService() to see if we can match
    try {
      const services = await broker.inference.listService();
      console.log(`\n${services.length} services discovered on-chain (for reference):`);
      services.slice(0, 15).forEach((s) => {
        console.log(`  - ${s.provider}  ${s.model || ''}  ${s.url || ''}`);
      });
    } catch (err) {
      console.log('Could not list services:', err.message?.substring(0, 100));
    }
    process.exit(0);
  }

  const detail = await processor.getLedgerWithDetail();
  const infers = detail.infers || [];
  console.log(`\nProvider sub-accounts (${infers.length}):`);

  if (infers.length === 0) {
    console.log('  (none — locked balance may be elsewhere)');
    process.exit(0);
  }

  let sumLocked = 0n;
  for (const [providerAddr, bal1, bal2] of infers) {
    const b1 = ethers.formatUnits(BigInt(bal1 ?? 0n), 18);
    const b2 = ethers.formatUnits(BigInt(bal2 ?? 0n), 18);
    sumLocked += BigInt(bal1 ?? 0n) + BigInt(bal2 ?? 0n);
    console.log(`  ${providerAddr}`);
    console.log(`     bal1=${b1} · bal2=${b2}`);
  }
  console.log(`\n  Sum locked: ${ethers.formatUnits(sumLocked, 18)} 0G`);

  // Try to read pending refund state from InferenceServing for each provider
  if (broker.inference) {
    console.log('\nPer-provider InferenceServing account probe:');
    for (const [providerAddr] of infers) {
      try {
        // Use broker's internal inference contract if exposed
        const acc = await broker.inference.getAccount
          ? await broker.inference.getAccount(wallet.address, providerAddr)
          : null;
        if (!acc) {
          console.log(`  ${providerAddr.substring(0, 12)}…  (no getAccount helper)`);
          continue;
        }
        console.log(`  ${providerAddr}`);
        console.log(`     balance   =${ethers.formatUnits(acc.balance ?? 0n, 18)}`);
        console.log(`     pendingRefund=${ethers.formatUnits(acc.pendingRefund ?? 0n, 18)}`);
        if (acc.refunds?.length) {
          console.log('     refund schedule:');
          for (const r of acc.refunds) {
            const when = Number(r.createdAt ?? 0n) * 1000;
            const expired = r.processed || when === 0 ? 'N/A' : new Date(when).toISOString();
            console.log(`       - amount=${ethers.formatUnits(r.amount ?? 0n, 18)} · created=${expired} · processed=${r.processed}`);
          }
        }
      } catch (err) {
        console.log(`  ${providerAddr.substring(0, 12)}…  probe failed:`, err.message?.substring(0, 80));
      }
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
