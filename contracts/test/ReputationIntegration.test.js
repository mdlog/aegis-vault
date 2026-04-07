const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * Phase 5: Verify that AegisVault.executeIntent records stats on OperatorReputation
 * when a recorder is configured AND the vault is authorized.
 */
describe("Reputation integration (Phase 5)", function () {
  let vault, registry, reputation, factory, protocolTreasury;
  let usdc, btc, dex, venueAdapter;
  let deployer, owner, executor, attacker;

  const DEPOSIT_AMOUNT = ethers.parseUnits("50000", 6);

  beforeEach(async function () {
    [deployer, owner, executor, attacker] = await ethers.getSigners();

    const Mock = await ethers.getContractFactory("MockERC20");
    usdc = await Mock.deploy("USD Coin", "USDC", 6);
    btc = await Mock.deploy("Bitcoin", "BTC", 8);
    await usdc.waitForDeployment();
    await btc.waitForDeployment();

    const ExecutionRegistry = await ethers.getContractFactory("ExecutionRegistry");
    registry = await ExecutionRegistry.deploy();
    await registry.waitForDeployment();

    const Treasury = await ethers.getContractFactory("ProtocolTreasury");
    protocolTreasury = await Treasury.deploy(deployer.address);
    await protocolTreasury.waitForDeployment();

    const Factory = await ethers.getContractFactory("AegisVaultFactory");
    factory = await Factory.deploy(
      await registry.getAddress(),
      await protocolTreasury.getAddress()
    );
    await factory.waitForDeployment();
    await registry.transferAdmin(await factory.getAddress());

    const MockDex = await ethers.getContractFactory("MockDEX");
    dex = await MockDex.deploy();
    await dex.waitForDeployment();
    // Set USDC↔BTC pair rate (BTC @ ~$70k, so 1 USDC = 0.0000143 BTC)
    await dex.setPairRate(
      await usdc.getAddress(), await btc.getAddress(),
      ethers.parseUnits("0.0000143", 18), 6, 8
    );
    // Seed the DEX with liquidity
    await usdc.mint(await dex.getAddress(), ethers.parseUnits("1000000", 6));
    await btc.mint(await dex.getAddress(), ethers.parseUnits("100", 8));

    const defaultPolicy = {
      maxPositionBps: 5000, maxDailyLossBps: 1000, stopLossBps: 1500,
      cooldownSeconds: 0, confidenceThresholdBps: 5000, maxActionsPerDay: 20,
      autoExecution: true, paused: false,
      performanceFeeBps: 0, managementFeeBps: 0, entryFeeBps: 0, exitFeeBps: 0,
      feeRecipient: ethers.ZeroAddress,
    };

    // Create vault via factory
    await factory.connect(owner).createVault(
      await usdc.getAddress(),
      executor.address,
      await dex.getAddress(),
      defaultPolicy,
      [await usdc.getAddress(), await btc.getAddress()]
    );
    const ownerVaults = await factory.getOwnerVaults(owner.address);
    const vaultAddr = ownerVaults[0];
    vault = await ethers.getContractAt("AegisVault", vaultAddr);

    // Mint and deposit
    await usdc.mint(owner.address, DEPOSIT_AMOUNT);
    await usdc.connect(owner).approve(vaultAddr, DEPOSIT_AMOUNT);
    await vault.connect(owner).deposit(DEPOSIT_AMOUNT);

    // Deploy OperatorReputation
    const Reputation = await ethers.getContractFactory("OperatorReputation");
    reputation = await Reputation.deploy(deployer.address);
    await reputation.waitForDeployment();
  });

  async function buildIntent(overrides = {}) {
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const base = {
      vault: await vault.getAddress(),
      assetIn: await usdc.getAddress(),
      assetOut: await btc.getAddress(),
      amountIn: ethers.parseUnits("5000", 6),
      minAmountOut: 1n,
      createdAt: now - 10,
      expiresAt: now + 300,
      confidenceBps: 8000,
      riskScoreBps: 2800,
      reasonSummary: "test",
      ...overrides,
    };
    base.intentHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "address", "uint256", "uint256", "uint256", "uint256", "uint256", "uint256"],
        [base.vault, base.assetIn, base.assetOut, base.amountIn, base.minAmountOut, base.createdAt, base.expiresAt, base.confidenceBps, base.riskScoreBps]
      )
    );
    return base;
  }

  it("should NOT record when recorder not set (baseline)", async function () {
    const intent = await buildIntent();
    await vault.connect(executor).executeIntent(intent);
    const s = await reputation.getStats(executor.address);
    expect(s.totalExecutions).to.equal(0);
  });

  it("should record stats when recorder set AND vault authorized", async function () {
    // Owner points the vault at the reputation contract
    await vault.connect(owner).setReputationRecorder(await reputation.getAddress());
    // Admin authorizes the vault as a recorder
    await reputation.connect(deployer).setRecorder(await vault.getAddress(), true);

    // Sanity checks: recorder and authorization are wired up
    expect(await vault.reputationRecorder()).to.equal(await reputation.getAddress());
    expect(await reputation.authorizedRecorders(await vault.getAddress())).to.be.true;

    await ethers.provider.send("evm_mine");
    const intent = await buildIntent();
    await vault.connect(executor).executeIntent(intent);

    // Sanity: execution actually happened
    expect(await vault.dailyActionCount()).to.equal(1);

    const s = await reputation.getStats(executor.address);
    expect(s.totalExecutions).to.equal(1);
    expect(s.successfulExecutions).to.equal(1);
    expect(s.totalVolumeUsd6).to.equal(ethers.parseUnits("5000", 6));
    expect(s.firstExecutionAt).to.be.greaterThan(0);
  });

  it("should silently skip recording when vault not authorized (try/catch safety)", async function () {
    // Set recorder but DON'T authorize the vault
    await vault.connect(owner).setReputationRecorder(await reputation.getAddress());

    const intent = await buildIntent();
    // Should not revert
    await expect(vault.connect(executor).executeIntent(intent)).to.not.be.reverted;

    // But stats remain empty
    const s = await reputation.getStats(executor.address);
    expect(s.totalExecutions).to.equal(0);
  });

  it("should accumulate across multiple executions", async function () {
    await vault.connect(owner).setReputationRecorder(await reputation.getAddress());
    await reputation.connect(deployer).setRecorder(await vault.getAddress(), true);

    // Execute 3 intents with different volumes
    for (let i = 0; i < 3; i++) {
      const intent = await buildIntent({
        amountIn: ethers.parseUnits(String(1000 * (i + 1)), 6),
      });
      // Advance block so createdAt differs (cooldown=0 so no wait needed)
      await ethers.provider.send("evm_mine");
      await vault.connect(executor).executeIntent(intent);
    }

    const s = await reputation.getStats(executor.address);
    expect(s.totalExecutions).to.equal(3);
    expect(s.totalVolumeUsd6).to.equal(ethers.parseUnits("6000", 6));
  });

  it("should reject setReputationRecorder from non-owner", async function () {
    await expect(
      vault.connect(attacker).setReputationRecorder(await reputation.getAddress())
    ).to.be.revertedWithCustomError(vault, "OnlyOwner");
  });
});
