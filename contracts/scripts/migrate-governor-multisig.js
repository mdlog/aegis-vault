#!/usr/bin/env node
/**
 * Migrate AegisGovernor from 1-of-1 to M-of-N multisig.
 *
 * Flow (single existing owner executes on behalf of the group):
 *   1. For each new owner: submit + confirm + execute `addOwner(newOwner)`
 *   2. Submit + confirm + execute `changeThreshold(newThreshold)`
 *
 * Because the current threshold is 1, the existing lone owner can both submit
 * and finalize each proposal in one tx each. After threshold is raised the
 * governor operates as proper M-of-N and any future owner rotation needs the
 * new threshold of confirmations.
 *
 * Usage:
 *   # Required
 *   GOVERNOR_PRIVATE_KEY=0x...   # current lone owner
 *   NEW_OWNERS=0xA,0xB           # comma-separated new owners to add
 *   NEW_THRESHOLD=2              # final threshold (must be <= total owners)
 *
 *   # Optional
 *   DEPLOYMENTS_FILE=./deployments-mainnet.json
 *   RPC_URL=https://evmrpc.0g.ai
 *   DRY_RUN=1                    # print plan only, no tx
 *
 *   node scripts/migrate-governor-multisig.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GOVERNOR_ABI = [
  'function owners(uint256) view returns (address)',
  'function isOwner(address) view returns (bool)',
  'function threshold() view returns (uint256)',
  'function proposals(uint256) view returns (address target, uint256 value, bytes data, string description, address proposer, uint256 confirmations, bool executed, bool canceled, uint256 createdAt, uint256 executedAt, uint256 generation)',
  'function submit(address target, uint256 value, bytes data, string description) returns (uint256)',
  'function confirm(uint256 id)',
  'function execute(uint256 id)',
  'function addOwner(address owner)',
  'function removeOwner(address owner)',
  'function changeThreshold(uint256 newThreshold)',
  'event ProposalSubmitted(uint256 indexed id, address indexed proposer, address indexed target, uint256 value, string description)',
];

async function loadDeployments() {
  const filePath = process.env.DEPLOYMENTS_FILE
    || path.join(__dirname, '..', 'deployments-mainnet.json');
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseNewOwners(raw) {
  if (!raw) throw new Error('NEW_OWNERS env is required (comma-separated addresses)');
  const addrs = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (addrs.length === 0) throw new Error('NEW_OWNERS is empty');
  for (const a of addrs) {
    if (!ethers.isAddress(a)) throw new Error(`Not a valid address: ${a}`);
  }
  return addrs;
}

async function submitConfirmExecute(governor, signer, { target, value, data, description }) {
  const submitTx = await governor.submit(target, value, data, description);
  const receipt = await submitTx.wait();
  const event = receipt.logs
    .map((log) => { try { return governor.interface.parseLog(log); } catch { return null; } })
    .find((e) => e && e.name === 'ProposalSubmitted');
  if (!event) throw new Error('ProposalSubmitted event not found — submit may have reverted');
  const id = event.args.id;

  // With threshold=1 and proposer auto-confirming inside submit, next step is execute.
  // But in case the current governor version doesn't auto-confirm on submit, confirm first.
  try {
    await (await governor.confirm(id)).wait();
  } catch (err) {
    // Already confirmed — that's fine
    if (!String(err?.message || err).includes('AlreadyConfirmed')) throw err;
  }
  await (await governor.execute(id)).wait();
  return id;
}

async function main() {
  const dryRun = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
  const rpcUrl = process.env.RPC_URL || 'https://evmrpc.0g.ai';

  const newOwners = parseNewOwners(process.env.NEW_OWNERS);
  const newThreshold = Number(process.env.NEW_THRESHOLD);
  if (!Number.isInteger(newThreshold) || newThreshold < 1) {
    throw new Error('NEW_THRESHOLD must be a positive integer');
  }

  const deployments = await loadDeployments();
  const governorAddr = deployments.aegisGovernor;
  if (!governorAddr) throw new Error('aegisGovernor not found in deployments file');

  const provider = new ethers.JsonRpcProvider(rpcUrl);

  let signer = null;
  if (!dryRun) {
    const pk = process.env.GOVERNOR_PRIVATE_KEY;
    if (!pk) throw new Error('GOVERNOR_PRIVATE_KEY is required (skip with DRY_RUN=1)');
    signer = new ethers.Wallet(pk, provider);
  }

  const governorRead = new ethers.Contract(governorAddr, GOVERNOR_ABI, provider);
  const currentThreshold = Number(await governorRead.threshold());

  const existingOwners = [];
  for (let i = 0; ; i++) {
    try {
      const o = await governorRead.owners(i);
      existingOwners.push(o);
    } catch {
      break;
    }
  }

  console.log('AegisGovernor @', governorAddr);
  console.log('  existing owners   :', existingOwners);
  console.log('  current threshold :', currentThreshold);
  console.log('  will add owners   :', newOwners);
  console.log('  new threshold     :', newThreshold);

  const totalAfter = existingOwners.length + newOwners
    .filter((a) => !existingOwners.map((x) => x.toLowerCase()).includes(a.toLowerCase()))
    .length;
  if (newThreshold > totalAfter) {
    throw new Error(`NEW_THRESHOLD (${newThreshold}) > total owners after migration (${totalAfter})`);
  }

  if (dryRun) {
    console.log('\nDRY_RUN: no transactions sent.');
    return;
  }

  if (!existingOwners.map((x) => x.toLowerCase()).includes(signer.address.toLowerCase())) {
    throw new Error(`Signer ${signer.address} is not an existing owner`);
  }

  const governor = governorRead.connect(signer);

  for (const newOwner of newOwners) {
    if (existingOwners.map((x) => x.toLowerCase()).includes(newOwner.toLowerCase())) {
      console.log(`  skip addOwner — ${newOwner} already an owner`);
      continue;
    }
    const data = governor.interface.encodeFunctionData('addOwner', [newOwner]);
    const id = await submitConfirmExecute(governor, signer, {
      target: governorAddr,
      value: 0n,
      data,
      description: `Add owner ${newOwner}`,
    });
    console.log(`  addOwner(${newOwner}) executed via proposal #${id}`);
  }

  if (currentThreshold !== newThreshold) {
    const data = governor.interface.encodeFunctionData('changeThreshold', [newThreshold]);
    const id = await submitConfirmExecute(governor, signer, {
      target: governorAddr,
      value: 0n,
      data,
      description: `Change threshold to ${newThreshold}`,
    });
    console.log(`  changeThreshold(${newThreshold}) executed via proposal #${id}`);
  }

  const finalThreshold = Number(await governorRead.threshold());
  console.log('\nDone. Final threshold:', finalThreshold);
  console.log('Remember to update deployments-mainnet.json → governorOwners and governorThreshold.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
