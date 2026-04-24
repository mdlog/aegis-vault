// Read an on-chain vault's summary + policy + NAV. Usage:
//   AEGIS_VAULT=0xf7AAFFBddaf66B90f13fc3447634372eBF0Ea181 \
//   AEGIS_ORCHESTRATOR=http://localhost:4002 \
//     node examples/read-vault.js

import { AegisSDK } from '../src/index.js';

const vaultAddress = process.env.AEGIS_VAULT;
if (!vaultAddress) {
  console.error('Set AEGIS_VAULT=0x... in env.');
  process.exit(1);
}

const sdk = new AegisSDK({
  chainId: 16661,
  orchestratorUrl: process.env.AEGIS_ORCHESTRATOR, // optional
});

const vault = sdk.vault(vaultAddress);
const [summary, policy, allowedAssets] = await Promise.all([
  vault.getSummary(),
  vault.getPolicy(),
  vault.getAllowedAssets(),
]);

console.log('chain:', sdk.chainId, '@', sdk.rpcUrl);
console.log('vault:', vaultAddress);
console.log('summary:', {
  ...summary,
  totalDeposited: summary.totalDeposited.toString(),
  nav: summary.nav.toString(),
});
console.log('policy:', { ...policy, raw: undefined });
console.log('allowedAssets:', allowedAssets);

if (sdk.orchestrator) {
  const nav = await sdk.orchestrator.nav(vaultAddress).catch((e) => ({ error: e.message }));
  console.log('orchestrator nav:', nav);
}
