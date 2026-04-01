#!/bin/bash
# ═══════════════════════════════════════════════════
#  AEGIS VAULT — Full Stack Setup
#  One-command setup for local development & demo
# ═══════════════════════════════════════════════════

set -e
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "╔════════════════════════════════════════════════╗"
echo "║       AEGIS VAULT — Setup Script               ║"
echo "╚════════════════════════════════════════════════╝"
echo ""

# ── Step 1: Install dependencies ──
echo "── Step 1: Installing dependencies ──"
cd "$ROOT_DIR/contracts" && npm install --silent
cd "$ROOT_DIR/orchestrator" && npm install --legacy-peer-deps --silent
cd "$ROOT_DIR/landing" && npm install --silent
echo "✓ Dependencies installed"

# ── Step 2: Compile contracts ──
echo ""
echo "── Step 2: Compiling smart contracts ──"
cd "$ROOT_DIR/contracts" && npx hardhat compile --quiet
echo "✓ Contracts compiled"

# ── Step 3: Check if Hardhat node is running ──
echo ""
echo "── Step 3: Checking Hardhat node ──"
if curl -s http://127.0.0.1:8545 -X POST -H "Content-Type: application/json" \
   -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' > /dev/null 2>&1; then
  echo "✓ Hardhat node already running"
else
  echo "Starting Hardhat node in background..."
  cd "$ROOT_DIR/contracts" && npx hardhat node > /tmp/hardhat-node.log 2>&1 &
  sleep 3
  echo "✓ Hardhat node started (PID: $!)"
fi

# ── Step 4: Deploy contracts ──
echo ""
echo "── Step 4: Deploying contracts ──"
cd "$ROOT_DIR/contracts" && npx hardhat run scripts/deploy.js --network localhost
echo "✓ Contracts deployed"

# ── Step 5: Sync configs ──
echo ""
echo "── Step 5: Syncing configurations ──"
cd "$ROOT_DIR/contracts"
node scripts/gen-env.js
node scripts/sync-frontend.js

# Copy ABIs to orchestrator
for f in AegisVault AegisVaultFactory ExecutionRegistry; do
  node -e "const a=JSON.parse(require('fs').readFileSync('artifacts/contracts/${f}.sol/${f}.json','utf8')); require('fs').writeFileSync('../orchestrator/src/abi/${f}.json', JSON.stringify(a.abi, null, 2))"
done
node -e "const a=JSON.parse(require('fs').readFileSync('artifacts/contracts/mocks/MockERC20.sol/MockERC20.json','utf8')); require('fs').writeFileSync('../orchestrator/src/abi/MockERC20.json', JSON.stringify(a.abi, null, 2))"
node -e "const a=JSON.parse(require('fs').readFileSync('artifacts/contracts/mocks/MockDEX.sol/MockDEX.json','utf8')); require('fs').writeFileSync('../orchestrator/src/abi/MockDEX.json', JSON.stringify(a.abi, null, 2))"

# Copy ABIs to frontend
cp "$ROOT_DIR/orchestrator/src/abi/"*.json "$ROOT_DIR/landing/src/lib/abi/"
echo "✓ Configs synced"

# ── Step 6: Run tests ──
echo ""
echo "── Step 6: Running contract tests ──"
cd "$ROOT_DIR/contracts" && npx hardhat test
echo "✓ Tests passed"

echo ""
echo "╔════════════════════════════════════════════════╗"
echo "║       SETUP COMPLETE                            ║"
echo "╠════════════════════════════════════════════════╣"
echo "║                                                 ║"
echo "║  To start all services:                         ║"
echo "║                                                 ║"
echo "║  Terminal 1 (if not already running):            ║"
echo "║    cd contracts && npx hardhat node              ║"
echo "║                                                 ║"
echo "║  Terminal 2:                                     ║"
echo "║    cd orchestrator && npm start                  ║"
echo "║                                                 ║"
echo "║  Terminal 3:                                     ║"
echo "║    cd landing && npm run dev                     ║"
echo "║                                                 ║"
echo "║  Then open: http://localhost:5173                ║"
echo "║                                                 ║"
echo "║  Or run the demo:                                ║"
echo "║    node demo.js                                  ║"
echo "║                                                 ║"
echo "╚════════════════════════════════════════════════╝"
