// Disable the Pyth oracle guard on Jaine venue adapter by setting pyth to
// address(0). Required on 0G mainnet because Pyth on-chain prices there are
// not pushed frequently enough to satisfy `getPriceNoOlderThan(feedId, 5min)`
// inside OracleGuardLib.checkDeviation(), which reverts every swap with
// StalePrice(). Disabling the guard falls back to the adapter's built-in
// slippage cap (maxSlippageBps) for protection.
//
// Admin-only: caller must be the adapter's `owner()` (set at deploy time).
//
// Usage: node scripts/disable-oracle-guard.mjs
//        node scripts/disable-oracle-guard.mjs --enable <pythAddress>  // re-enable

import { ethers } from 'ethers';
import dotenv from 'dotenv';
dotenv.config();

const JAINE_ADAPTER = '0x0F8B269368925Fd55C62560B6f818173A8cB25eD';

const ABI = [
  'function owner() view returns (address)',
  'function pyth() view returns (address)',
  'function setPyth(address) external',
  'function maxSlippageBps() view returns (uint16)',
];

async function main() {
  const enableArg = process.argv.indexOf('--enable');
  const newPyth  = enableArg >= 0 ? process.argv[enableArg + 1] : '0x0000000000000000000000000000000000000000';

  const rpc = process.env.RPC_URL || 'https://evmrpc.0g.ai';
  const pk  = (process.env.PRIVATE_KEY || '').replace(/^0x/, '');
  if (!pk) throw new Error('Set PRIVATE_KEY in orchestrator/.env');

  const provider = new ethers.JsonRpcProvider(rpc, { chainId: 16661, name: '0g-mainnet' }, { staticNetwork: true });
  const wallet   = new ethers.Wallet(pk, provider);
  const adapter  = new ethers.Contract(JAINE_ADAPTER, ABI, wallet);

  const owner   = await adapter.owner();
  const current = await adapter.pyth();
  const slipBps = await adapter.maxSlippageBps();

  console.log('Adapter:      ', JAINE_ADAPTER);
  console.log('Owner:        ', owner);
  console.log('Signer:       ', wallet.address);
  console.log('Pyth current: ', current);
  console.log('Pyth target:  ', newPyth);
  console.log('Slip cap:     ', slipBps, 'bps');

  if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
    console.error('\n✗ Signer is not the adapter owner. Use the wallet that deployed the adapter.');
    process.exit(1);
  }

  if (current.toLowerCase() === newPyth.toLowerCase()) {
    console.log(`\n= Pyth already set to ${newPyth}. Nothing to do.`);
    return;
  }

  console.log(`\nSending setPyth(${newPyth})…`);
  const tx = await adapter.setPyth(newPyth);
  console.log('tx hash:', tx.hash);
  const rc = await tx.wait();
  console.log('mined in block', rc?.blockNumber);

  const after = await adapter.pyth();
  console.log('Pyth now:    ', after);

  if (newPyth === '0x0000000000000000000000000000000000000000') {
    console.log('\n✓ Oracle guard DISABLED. Swaps will use only maxSlippageBps cap.');
    console.log('  Re-enable later with: node scripts/disable-oracle-guard.mjs --enable <pythAddr>');
  } else {
    console.log('\n✓ Oracle guard ENABLED with', newPyth);
  }
}

main().catch((e) => {
  console.error('\n✗ Failed:', e.shortMessage || e.message);
  process.exit(1);
});
