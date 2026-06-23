// Verify the new listAvailableModels() shape — does it filter unack'd
// providers and surface TEE metadata correctly?
import 'dotenv/config';
import { listAvailableModels } from '../../src/services/ogCompute.js';
const models = await listAvailableModels();
console.log(`listAvailableModels() returned ${models.length} entries\n`);
models.forEach((m, i) => {
  console.log(`${i+1}. ${m.model}`);
  console.log(`   provider:    ${m.provider}`);
  console.log(`   verifiability:   ${m.verifiability}`);
  console.log(`   teeAcknowledged: ${m.teeAcknowledged}`);
  console.log(`   teeVerifier:     ${m.teeVerifier}`);
  console.log(`   teeSigner:       ${m.teeSignerAddress}`);
  if (m.teeImageDigest) console.log(`   imageDigest:     ${m.teeImageDigest}`);
  console.log();
});
process.exit(0);
