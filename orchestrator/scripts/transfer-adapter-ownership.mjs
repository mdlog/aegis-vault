// Transfer ownership of JaineVenueAdapter to a new owner.
//
// Single-step transfer — the adapter uses a simple `owner = newOwner`
// assignment with no accept step. Mistyped address = ownership lost forever.
//
// Usage:
//   CONFIRM=yes NEW_OWNER=0x… node scripts/transfer-adapter-ownership.mjs
//
// Env:
//   PRIVATE_KEY — current adapter owner's private key (orchestrator/.env)
//   RPC_URL     — 0G mainnet RPC (defaults to https://evmrpc.0g.ai)
//   NEW_OWNER   — address receiving ownership
//   CONFIRM     — must equal "yes" to broadcast the tx

import { ethers } from 'ethers';
import dotenv from 'dotenv';
dotenv.config();

const JAINE_ADAPTER = '0x0F8B269368925Fd55C62560B6f818173A8cB25eD';

const ABI = [
  'function owner() view returns (address)',
  'function transferOwnership(address newOwner) external',
];

async function main() {
  const newOwner = process.env.NEW_OWNER;
  const confirm  = process.env.CONFIRM;

  if (!newOwner) throw new Error('Set NEW_OWNER=0x… in env');
  if (!ethers.isAddress(newOwner)) throw new Error(`NEW_OWNER is not a valid address: ${newOwner}`);
  if (newOwner.toLowerCase() === ethers.ZeroAddress.toLowerCase()) {
    throw new Error('NEW_OWNER is the zero address — that would brick the adapter.');
  }

  const rpc = process.env.RPC_URL || 'https://evmrpc.0g.ai';
  const pk  = (process.env.PRIVATE_KEY || '').replace(/^0x/, '');
  if (!pk) throw new Error('Set PRIVATE_KEY in orchestrator/.env');

  const provider = new ethers.JsonRpcProvider(rpc, { chainId: 16661, name: '0g-mainnet' }, { staticNetwork: true });
  const wallet   = new ethers.Wallet(pk, provider);
  const adapter  = new ethers.Contract(JAINE_ADAPTER, ABI, wallet);

  const currentOwner = await adapter.owner();

  console.log('Adapter:         ', JAINE_ADAPTER);
  console.log('Current owner:   ', currentOwner);
  console.log('Signer:          ', wallet.address);
  console.log('New owner target:', ethers.getAddress(newOwner));

  if (currentOwner.toLowerCase() !== wallet.address.toLowerCase()) {
    console.error('\n✗ Signer is not the current adapter owner. Use the wallet that currently owns the adapter.');
    process.exit(1);
  }

  if (currentOwner.toLowerCase() === newOwner.toLowerCase()) {
    console.log('\n= New owner matches current owner. Nothing to do.');
    return;
  }

  if (confirm !== 'yes') {
    console.log('\n⚠  Dry-run. This is a SINGLE-STEP transfer: no accept step, no undo.');
    console.log('   If the NEW_OWNER address is wrong, ownership is lost permanently.');
    console.log('   Re-run with CONFIRM=yes to broadcast the transaction.');
    return;
  }

  console.log(`\nSending transferOwnership(${ethers.getAddress(newOwner)})…`);
  const tx = await adapter.transferOwnership(newOwner);
  console.log('tx hash:', tx.hash);
  const rc = await tx.wait();
  console.log('mined in block', rc?.blockNumber);

  const after = await adapter.owner();
  console.log('\nOwner now:       ', after);

  if (after.toLowerCase() !== newOwner.toLowerCase()) {
    console.error('✗ Owner did not update — investigate.');
    process.exit(1);
  }

  console.log('\n✓ Ownership transferred.');
  console.log('  Next: put the NEW owner\'s PRIVATE_KEY in orchestrator/.env');
  console.log('        then run: node scripts/disable-oracle-guard.mjs');
}

main().catch((e) => {
  console.error('\n✗ Failed:', e.shortMessage || e.message);
  process.exit(1);
});
