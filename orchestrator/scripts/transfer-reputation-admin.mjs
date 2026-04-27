// Transfer admin of OperatorReputation to a new wallet.
//
// Single-step transfer — the contract uses a simple `admin = newAdmin`
// assignment with no accept step. Mistyped address = admin role lost forever.
//
// Admin controls: setRecorder (authorize vaults/executors to write reputation),
// setVerified (grant/revoke the Verified badge), transferAdmin (rotate).
//
// Usage:
//   NEW_ADMIN=0x… node scripts/transfer-reputation-admin.mjs           # dry-run
//   CONFIRM=yes NEW_ADMIN=0x… node scripts/transfer-reputation-admin.mjs
//
// Env:
//   PRIVATE_KEY                 — current admin's private key
//   OPERATOR_REPUTATION_ADDRESS — overrides default deployment address
//   RPC_URL                     — 0G mainnet RPC (default: https://evmrpc.0g.ai)

import { ethers } from 'ethers';
import dotenv from 'dotenv';
dotenv.config();

const DEFAULT_REPUTATION = '0xc270c579400a45975B2EBff05A2fF80f620080CA';

const ABI = [
  'function admin() view returns (address)',
  'function transferAdmin(address newAdmin) external',
];

async function main() {
  const newAdmin = process.env.NEW_ADMIN;
  const confirm  = process.env.CONFIRM;

  if (!newAdmin) throw new Error('Set NEW_ADMIN=0x… in env');
  if (!ethers.isAddress(newAdmin)) throw new Error(`NEW_ADMIN is not a valid address: ${newAdmin}`);
  if (newAdmin.toLowerCase() === ethers.ZeroAddress.toLowerCase()) {
    throw new Error('NEW_ADMIN is the zero address — that would brick admin controls.');
  }

  const rpc = process.env.RPC_URL || 'https://evmrpc.0g.ai';
  const pk  = (process.env.PRIVATE_KEY || '').replace(/^0x/, '');
  if (!pk) throw new Error('Set PRIVATE_KEY in orchestrator/.env');

  const reputation = process.env.OPERATOR_REPUTATION_ADDRESS || DEFAULT_REPUTATION;

  const provider = new ethers.JsonRpcProvider(rpc, { chainId: 16661, name: '0g-mainnet' }, { staticNetwork: true });
  const wallet   = new ethers.Wallet(pk, provider);
  const rep      = new ethers.Contract(reputation, ABI, wallet);

  const currentAdmin = await rep.admin();

  console.log('Reputation     :', reputation);
  console.log('Current admin  :', currentAdmin);
  console.log('Signer         :', wallet.address);
  console.log('New admin      :', ethers.getAddress(newAdmin));

  if (currentAdmin.toLowerCase() !== wallet.address.toLowerCase()) {
    console.error('\n✗ Signer is not the current admin. Use the wallet that currently owns admin.');
    process.exit(1);
  }

  if (currentAdmin.toLowerCase() === newAdmin.toLowerCase()) {
    console.log('\n= New admin matches current admin. Nothing to do.');
    return;
  }

  if (confirm !== 'yes') {
    console.log('\n⚠  Dry-run. SINGLE-STEP transfer: no accept, no undo.');
    console.log('   Re-run with CONFIRM=yes to broadcast.');
    return;
  }

  console.log(`\nSending transferAdmin(${ethers.getAddress(newAdmin)})…`);
  const tx = await rep.transferAdmin(newAdmin);
  console.log('tx hash:', tx.hash);
  const rc = await tx.wait();
  console.log('mined in block', rc?.blockNumber);

  const after = await rep.admin();
  console.log('\nAdmin now      :', after);

  if (after.toLowerCase() !== newAdmin.toLowerCase()) {
    console.error('✗ Admin did not update — investigate.');
    process.exit(1);
  }

  console.log('\n✓ Admin transferred.');
  console.log('  Next: with .env now pointing to the new admin, run');
  console.log('        RECORDER=<executor> CONFIRM=yes node scripts/authorize-reputation-recorder.mjs');
}

main().catch((e) => {
  console.error('\n✗ Failed:', e.shortMessage || e.message);
  process.exit(1);
});
