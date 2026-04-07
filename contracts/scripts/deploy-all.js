/**
 * Aegis Vault — Unified deployment script
 *
 * Deploys the full Phase 1-5 stack in the correct order:
 *   1. ProtocolTreasury
 *   2. ExecutionRegistry
 *   3. AegisVaultFactory (wires registry admin + treasury)
 *   4. OperatorRegistry
 *   5. Mock tokens + MockDEX (testnet only; skip with SKIP_MOCKS=1)
 *   6. InsurancePool
 *   7. OperatorStaking
 *   8. OperatorReputation
 *   9. AegisGovernor (multi-sig)
 *  10. Rewire all admin roles to governor (arbitrator, admin, etc.)
 *
 * Usage:
 *   npx hardhat run scripts/deploy-all.js --network og_testnet
 *
 * Environment:
 *   GOVERNOR_OWNERS     — comma-separated owner addresses (default: deployer only)
 *   GOVERNOR_THRESHOLD  — M threshold (default: 1)
 *   SKIP_MOCKS          — set to 1 to skip mock tokens + DEX (mainnet)
 *   SKIP_GOVERNOR       — set to 1 to skip deploying governor
 *   TRANSFER_ADMINS     — set to 1 to transfer all admin roles to governor
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  console.log("╔═════════════════════════════════════════════════════════╗");
  console.log("║  Aegis Vault — Unified Deployment (Phase 1-5)          ║");
  console.log("╚═════════════════════════════════════════════════════════╝");
  console.log("  Deployer:", deployer.address);
  console.log("  Network: ", network.name, "(chainId:", network.chainId, ")");
  console.log();

  const deployments = {
    network: network.name,
    chainId: Number(network.chainId),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
  };
  const deploymentsPath = path.resolve(__dirname, "../deployments.json");

  // ═══════════════════════════════════════════════
  // PHASE 1: Foundation
  // ═══════════════════════════════════════════════
  console.log("── Phase 1: Foundation ──");

  console.log("  [1/9] ProtocolTreasury...");
  const Treasury = await ethers.getContractFactory("ProtocolTreasury");
  const treasury = await Treasury.deploy(deployer.address);
  await treasury.waitForDeployment();
  deployments.protocolTreasury = await treasury.getAddress();
  console.log("        →", deployments.protocolTreasury);

  console.log("  [2/9] ExecutionRegistry...");
  const ExecReg = await ethers.getContractFactory("ExecutionRegistry");
  const execRegistry = await ExecReg.deploy();
  await execRegistry.waitForDeployment();
  deployments.executionRegistry = await execRegistry.getAddress();
  console.log("        →", deployments.executionRegistry);

  console.log("  [3/9] AegisVaultFactory...");
  const Factory = await ethers.getContractFactory("AegisVaultFactory");
  const factory = await Factory.deploy(deployments.executionRegistry, deployments.protocolTreasury);
  await factory.waitForDeployment();
  deployments.aegisVaultFactory = await factory.getAddress();
  console.log("        →", deployments.aegisVaultFactory);
  await (await execRegistry.transferAdmin(deployments.aegisVaultFactory)).wait();
  console.log("        Registry admin → factory ✓");

  console.log("  [4/9] OperatorRegistry...");
  const OpReg = await ethers.getContractFactory("OperatorRegistry");
  const opRegistry = await OpReg.deploy();
  await opRegistry.waitForDeployment();
  deployments.operatorRegistry = await opRegistry.getAddress();
  console.log("        →", deployments.operatorRegistry);

  // ═══════════════════════════════════════════════
  // Mocks (testnet only)
  // ═══════════════════════════════════════════════
  if (process.env.SKIP_MOCKS !== "1") {
    console.log();
    console.log("── Testnet Mocks ──");

    const Mock = await ethers.getContractFactory("MockERC20");
    console.log("  [5/9a] MockUSDC...");
    const usdc = await Mock.deploy("USD Coin", "USDC", 6);
    await usdc.waitForDeployment();
    deployments.mockUSDC = await usdc.getAddress();
    console.log("        →", deployments.mockUSDC);

    console.log("  [5/9b] MockWBTC...");
    const wbtc = await Mock.deploy("Wrapped Bitcoin", "WBTC", 8);
    await wbtc.waitForDeployment();
    deployments.mockWBTC = await wbtc.getAddress();
    console.log("        →", deployments.mockWBTC);

    console.log("  [5/9c] MockWETH...");
    const weth = await Mock.deploy("Wrapped Ether", "WETH", 18);
    await weth.waitForDeployment();
    deployments.mockWETH = await weth.getAddress();
    console.log("        →", deployments.mockWETH);

    console.log("  [5/9d] MockDEX...");
    const Dex = await ethers.getContractFactory("MockDEX");
    const dex = await Dex.deploy();
    await dex.waitForDeployment();
    deployments.mockDEX = await dex.getAddress();
    console.log("        →", deployments.mockDEX);

    // Seed pair rates
    await (await dex.setPairRate(deployments.mockUSDC, deployments.mockWBTC, ethers.parseUnits("0.0000143", 18), 6, 8)).wait();
    await (await dex.setPairRate(deployments.mockUSDC, deployments.mockWETH, ethers.parseUnits("0.000455", 18), 6, 18)).wait();
    // Seed liquidity
    await (await wbtc.mint(deployments.mockDEX, ethers.parseUnits("100", 8))).wait();
    await (await weth.mint(deployments.mockDEX, ethers.parseUnits("10000", 18))).wait();
    await (await usdc.mint(deployments.mockDEX, ethers.parseUnits("10000000", 6))).wait();
    console.log("        DEX seeded with pair rates + liquidity ✓");
  } else {
    console.log("  [5/9] Skipping mocks (SKIP_MOCKS=1)");
  }

  // ═══════════════════════════════════════════════
  // PHASE 2: Stake & Slashing
  // ═══════════════════════════════════════════════
  console.log();
  console.log("── Phase 2: Stake & Slashing ──");

  if (!deployments.mockUSDC) {
    console.log("  ! Skipping Phase 2 — mockUSDC not deployed (set stake token manually)");
  } else {
    console.log("  [6/9] InsurancePool...");
    const Insurance = await ethers.getContractFactory("InsurancePool");
    const insurance = await Insurance.deploy(deployments.mockUSDC, deployer.address);
    await insurance.waitForDeployment();
    deployments.insurancePool = await insurance.getAddress();
    console.log("        →", deployments.insurancePool);

    console.log("  [7/9] OperatorStaking...");
    const Staking = await ethers.getContractFactory("OperatorStaking");
    const staking = await Staking.deploy(
      deployments.mockUSDC,
      deployments.operatorRegistry,
      deployments.insurancePool,
      deployer.address
    );
    await staking.waitForDeployment();
    deployments.operatorStaking = await staking.getAddress();
    console.log("        →", deployments.operatorStaking);

    // Authorize staking contract as the slash notifier on insurance pool
    await (await insurance.setNotifier(deployments.operatorStaking, true)).wait();
    console.log("        Insurance pool authorized staking as slash notifier ✓");
  }

  // ═══════════════════════════════════════════════
  // PHASE 3: Reputation & Discovery
  // ═══════════════════════════════════════════════
  console.log();
  console.log("── Phase 3: Reputation & Discovery ──");

  console.log("  [8/9] OperatorReputation...");
  const Reputation = await ethers.getContractFactory("OperatorReputation");
  const reputation = await Reputation.deploy(deployer.address);
  await reputation.waitForDeployment();
  deployments.operatorReputation = await reputation.getAddress();
  console.log("        →", deployments.operatorReputation);

  // Authorize factory as recorder
  await (await reputation.setRecorder(deployments.aegisVaultFactory, true)).wait();
  console.log("        Factory authorized as recorder ✓");

  // ═══════════════════════════════════════════════
  // PHASE 4: Governance
  // ═══════════════════════════════════════════════
  if (process.env.SKIP_GOVERNOR !== "1") {
    console.log();
    console.log("── Phase 4: Governance ──");

    const ownersStr = process.env.GOVERNOR_OWNERS || deployer.address;
    const owners = ownersStr.split(",").map(a => a.trim()).filter(Boolean);
    const threshold = Number(process.env.GOVERNOR_THRESHOLD || 1);

    console.log("  [9/9] AegisGovernor...");
    console.log("        Owners:", owners.join(", "));
    console.log("        Threshold:", threshold, "of", owners.length);
    const Governor = await ethers.getContractFactory("AegisGovernor");
    const governor = await Governor.deploy(owners, threshold);
    await governor.waitForDeployment();
    deployments.aegisGovernor = await governor.getAddress();
    console.log("        →", deployments.aegisGovernor);

    // Optionally transfer admin roles to governor (production mode)
    if (process.env.TRANSFER_ADMINS === "1") {
      console.log();
      console.log("── Transferring admin roles to governor ──");

      if (deployments.operatorStaking) {
        const staking = await ethers.getContractAt("OperatorStaking", deployments.operatorStaking);
        await (await staking.setArbitrator(deployments.aegisGovernor)).wait();
        console.log("        Staking arbitrator → governor ✓");
      }
      if (deployments.insurancePool) {
        const insurance = await ethers.getContractAt("InsurancePool", deployments.insurancePool);
        await (await insurance.setArbitrator(deployments.aegisGovernor)).wait();
        console.log("        Insurance arbitrator → governor ✓");
      }
      await (await reputation.transferAdmin(deployments.aegisGovernor)).wait();
      console.log("        Reputation admin → governor ✓");
      await (await treasury.transferAdmin(deployments.aegisGovernor)).wait();
      console.log("        Treasury admin → governor ✓");
    } else {
      console.log();
      console.log("  (Skipping admin role transfer. Set TRANSFER_ADMINS=1 to rotate.)");
    }
  }

  // ═══════════════════════════════════════════════
  // Persist deployments
  // ═══════════════════════════════════════════════
  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));
  console.log();
  console.log("╔═════════════════════════════════════════════════════════╗");
  console.log("║  Deployment Complete                                    ║");
  console.log("╚═════════════════════════════════════════════════════════╝");
  console.log("  File:", deploymentsPath);
  console.log();
  Object.entries(deployments).forEach(([key, value]) => {
    if (typeof value === "string" && value.startsWith("0x")) {
      console.log(`  ${key.padEnd(22)} ${value}`);
    }
  });
  console.log();
  console.log("Next steps:");
  console.log("  1. node scripts/sync-frontend.js");
  console.log("  2. Start the orchestrator");
  console.log("  3. Register operators at /operator/register");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Deployment failed:", err);
    process.exit(1);
  });
