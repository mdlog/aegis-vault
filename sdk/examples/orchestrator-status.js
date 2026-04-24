// Print live orchestrator status. Usage:
//   AEGIS_ORCHESTRATOR=http://localhost:4002 node examples/orchestrator-status.js

import { OrchestratorClient } from '../src/orchestrator.js';

const baseUrl = process.env.AEGIS_ORCHESTRATOR || 'http://localhost:4002';
const orch = new OrchestratorClient({ baseUrl });

const [health, status, pyth] = await Promise.all([
  orch.health().catch((e) => ({ error: e.message })),
  orch.status().catch((e) => ({ error: e.message })),
  orch.pythPrices().catch((e) => ({ error: e.message })),
]);

console.log('health:', JSON.stringify(health, null, 2));
console.log('status:', JSON.stringify(status, null, 2));
console.log('pyth:',   JSON.stringify(pyth,   null, 2));
