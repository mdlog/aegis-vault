// Dry-run of the operator registration flow.
//
//   - With OPERATOR_KEY set and a funded wallet: actually submits register +
//     activate on 0G mainnet via `sdk.registerOperator`.
//   - Without OPERATOR_KEY: just builds + prints the OperatorInput tuple so
//     you can inspect the exact on-chain payload before committing.
//
// Usage:
//   OPERATOR_KEY=0x... node examples/register-operator.js          # live
//   node examples/register-operator.js                             # dry-run

import { AegisSDK, Mandate, buildOperatorInput } from '../src/index.js';

const input = {
  name: 'Aegis Alpha',
  description: 'Balanced-mandate v1 — momentum + vol regime',
  endpoint: 'https://op.aegis.xyz',
  mandate: Mandate.Balanced,
  performanceFeePct: 15,
  managementFeePct: 2,
  entryFeePct: 0,
  exitFeePct: 0,
  recommendedMaxPositionPct: 50,
  recommendedConfidenceMinPct: 60,
  recommendedStopLossPct: 15,
  recommendedCooldownMinutes: 15,
  recommendedMaxActionsPerDay: 6,
};

const normalised = buildOperatorInput(input);
console.log('OperatorInput (normalised to bps):');
console.dir(normalised, { depth: null });

if (!process.env.OPERATOR_KEY) {
  console.log('\n(dry-run; set OPERATOR_KEY to submit on-chain)');
  process.exit(0);
}

const rawKey = process.env.OPERATOR_KEY.trim();
if (!/^0x[a-fA-F0-9]{64}$/.test(rawKey)) {
  console.error('ERROR: OPERATOR_KEY must be a 0x-prefixed 32-byte hex string (66 chars).');
  console.error('Never paste keys into shell history or commit them. Use a secure secret manager.');
  process.exit(1);
}

const { ethers } = await import('ethers');
const provider = new ethers.JsonRpcProvider('https://evmrpc.0g.ai');
const signer = new ethers.Wallet(rawKey, provider);

const sdk = new AegisSDK({ chainId: 16661, signer });

console.log('\nSubmitting as', await signer.getAddress(), '…');
const result = await sdk.registerOperator({
  input,
  autoActivate: true,
  onStep: (step, tx) => {
    console.log(`→ ${step}`, tx?.hash ?? '(submitting…)');
  },
});

console.log('\nDone.');
console.log('alreadyRegistered:', result.alreadyRegistered);
console.log('txHashes:', result.txHashes);
