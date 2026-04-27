// Authorize the executor wallet as a recorder on OperatorReputation so the
// orchestrator can call `recordExecution(operator, vol, pnl, success)` after
// each settled swap. Without this, successful executions never land in the
// on-chain track record and the operator detail page stays at 0.
//
// Admin-only: PRIVATE_KEY must belong to the reputation contract's `admin`.
//
// Usage:
//   RECORDER=0x… node scripts/authorize-reputation-recorder.mjs           # dry-run
//   CONFIRM=yes RECORDER=0x… node scripts/authorize-reputation-recorder.mjs
//   ALLOWED=false RECORDER=0x… CONFIRM=yes node …                         # revoke

import { ethers } from 'ethers';
import dotenv from 'dotenv';
dotenv.config();

const DEFAULT_REPUTATION = '0xc270c579400a45975B2EBff05A2fF80f620080CA';

const ABI = [
  'function admin() view returns (address)',
  'function authorizedRecorders(address) view returns (bool)',
  'function setRecorder(address recorder, bool allowed) external',
];

async function main() {
  const recorder = process.env.RECORDER;
  const allowed  = (process.env.ALLOWED ?? 'true').toLowerCase() !== 'false';
  const confirm  = process.env.CONFIRM;

  if (!recorder) throw new Error('Set RECORDER=0x… in env');
  if (!ethers.isAddress(recorder)) throw new Error(`RECORDER is not a valid address: ${recorder}`);

  const rpc = process.env.RPC_URL || 'https://evmrpc.0g.ai';
  const pk  = (process.env.PRIVATE_KEY || '').replace(/^0x/, '');
  if (!pk) throw new Error('Set PRIVATE_KEY in orchestrator/.env');

  const reputation = process.env.OPERATOR_REPUTATION_ADDRESS || DEFAULT_REPUTATION;

  const provider = new ethers.JsonRpcProvider(rpc, { chainId: 16661, name: '0g-mainnet' }, { staticNetwork: true });
  const wallet   = new ethers.Wallet(pk, provider);
  const rep      = new ethers.Contract(reputation, ABI, wallet);

  const admin   = await rep.admin();
  const current = await rep.authorizedRecorders(recorder);

  console.log('Reputation :', reputation);
  console.log('Admin      :', admin);
  console.log('Signer     :', wallet.address);
  console.log('Recorder   :', ethers.getAddress(recorder));
  console.log('Authed now :', current);
  console.log('Target     :', allowed);

  if (admin.toLowerCase() !== wallet.address.toLowerCase()) {
    console.error('\n✗ Signer is not the reputation admin. Use the admin wallet.');
    process.exit(1);
  }

  if (current === allowed) {
    console.log('\n= Already in target state. Nothing to do.');
    return;
  }

  if (confirm !== 'yes') {
    console.log('\n⚠  Dry-run. Re-run with CONFIRM=yes to broadcast.');
    return;
  }

  console.log(`\nSending setRecorder(${ethers.getAddress(recorder)}, ${allowed})…`);
  const tx = await rep.setRecorder(recorder, allowed);
  console.log('tx hash:', tx.hash);
  const rc = await tx.wait();
  console.log('mined in block', rc?.blockNumber);

  const after = await rep.authorizedRecorders(recorder);
  console.log('\nAuthed now :', after);
  console.log(after === allowed ? '\n✓ Authorization updated.' : '\n✗ State did not change — investigate.');
}

main().catch((e) => {
  console.error('\n✗ Failed:', e.shortMessage || e.message);
  process.exit(1);
});
