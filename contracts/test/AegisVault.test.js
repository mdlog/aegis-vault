const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Aegis Vault System", function () {
  let owner, executor, user, attacker;
  let usdc, btc, eth;
  let registry, factory, vault;

  // Default policy: Balanced mandate (Phase 1: includes fee fields)
  const defaultPolicy = {
    maxPositionBps: 5000,
    maxDailyLossBps: 500,
    stopLossBps: 1500,
    cooldownSeconds: 900,
    confidenceThresholdBps: 6000,
    maxActionsPerDay: 6,
    autoExecution: true,
    paused: false,
    // Phase 1: fees default to 0 for legacy tests
    performanceFeeBps: 0,
    managementFeeBps: 0,
    entryFeeBps: 0,
    exitFeeBps: 0,
    feeRecipient: ethers.ZeroAddress,
  };

  beforeEach(async function () {
    [owner, executor, user, attacker] = await ethers.getSigners();

    // Deploy mock tokens
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    usdc = await MockERC20.deploy("USD Coin", "USDC", 6);
    btc = await MockERC20.deploy("Wrapped BTC", "WBTC", 8);
    eth = await MockERC20.deploy("Wrapped ETH", "WETH", 18);

    // Deploy ExecutionRegistry
    const ExecutionRegistry = await ethers.getContractFactory("ExecutionRegistry");
    registry = await ExecutionRegistry.deploy();

    // Deploy Factory (Phase 1: with protocol treasury param, use ZeroAddress for tests)
    const Factory = await ethers.getContractFactory("AegisVaultFactory");
    factory = await Factory.deploy(await registry.getAddress(), ethers.ZeroAddress);

    // Transfer registry admin to factory so it can authorize vaults
    await registry.transferAdmin(await factory.getAddress());

    // Deploy MockDEX
    const MockDEX = await ethers.getContractFactory("MockDEX");
    const dex = await MockDEX.deploy();

    // Set price rates on DEX: 1 USDC = 0.0000143 BTC (BTC @ ~$70,000)
    await dex.setPairRate(
      await usdc.getAddress(), await btc.getAddress(),
      ethers.parseUnits("0.0000143", 18), 6, 8
    );
    // 1 USDC = 0.000455 ETH (ETH @ ~$2,200)
    await dex.setPairRate(
      await usdc.getAddress(), await eth.getAddress(),
      ethers.parseUnits("0.000455", 18), 6, 18
    );

    // Add liquidity to DEX
    await btc.mint(await dex.getAddress(), ethers.parseUnits("10", 8));
    await eth.mint(await dex.getAddress(), ethers.parseUnits("1000", 18));
    await usdc.mint(await dex.getAddress(), ethers.parseUnits("500000", 6));

    // Create a vault via factory
    const allowedAssets = [
      await usdc.getAddress(),
      await btc.getAddress(),
      await eth.getAddress(),
    ];

    const tx = await factory.createVault(
      await usdc.getAddress(),
      executor.address,
      await dex.getAddress(),
      defaultPolicy,
      allowedAssets
    );
    const receipt = await tx.wait();

    // Get vault address from event
    const vaultAddress = await factory.getVaultAt(0);
    vault = await ethers.getContractAt("AegisVault", vaultAddress);

    // Mint USDC to owner and approve vault
    await usdc.mint(owner.address, ethers.parseUnits("100000", 6));
    await usdc.approve(await vault.getAddress(), ethers.parseUnits("100000", 6));
  });

  // ── Factory Tests ──

  describe("AegisVaultFactory", function () {
    it("should deploy a vault and register it", async function () {
      expect(await factory.totalVaults()).to.equal(1);
      const vaults = await factory.getOwnerVaults(owner.address);
      expect(vaults.length).to.equal(1);
      expect(await factory.isVault(vaults[0])).to.be.true;
    });

    it("should reject zero addresses", async function () {
      await expect(
        factory.createVault(
          ethers.ZeroAddress,
          executor.address,
          ethers.ZeroAddress,
          defaultPolicy,
          []
        )
      ).to.be.revertedWithCustomError(factory, "ZeroAddress");
    });

    it("should allow multiple vaults per owner", async function () {
      await factory.createVault(
        await usdc.getAddress(),
        executor.address,
        ethers.ZeroAddress,
        defaultPolicy,
        [await usdc.getAddress()]
      );
      expect(await factory.totalVaults()).to.equal(2);
      const vaults = await factory.getOwnerVaults(owner.address);
      expect(vaults.length).to.equal(2);
    });
  });

  // ── Deposit Tests ──

  describe("Deposit", function () {
    it("should accept deposits", async function () {
      const amount = ethers.parseUnits("50000", 6);
      await vault.deposit(amount);

      expect(await vault.getBalance()).to.equal(amount);
      expect(await vault.totalDeposited()).to.equal(amount);
    });

    it("should reject zero deposits", async function () {
      await expect(vault.deposit(0)).to.be.revertedWithCustomError(vault, "ZeroAmount");
    });

    it("should reject deposits when paused", async function () {
      await vault.pause();
      await expect(
        vault.deposit(ethers.parseUnits("1000", 6))
      ).to.be.revertedWithCustomError(vault, "VaultPaused");
    });
  });

  // ── Withdraw Tests ──

  describe("Withdraw", function () {
    beforeEach(async function () {
      await vault.deposit(ethers.parseUnits("50000", 6));
    });

    it("should allow owner to withdraw", async function () {
      const amount = ethers.parseUnits("10000", 6);
      await vault.withdraw(amount);
      expect(await vault.getBalance()).to.equal(ethers.parseUnits("40000", 6));
    });

    it("should reject non-owner withdraw", async function () {
      await expect(
        vault.connect(user).withdraw(ethers.parseUnits("1000", 6))
      ).to.be.revertedWithCustomError(vault, "OnlyOwner");
    });

    it("should reject withdraw exceeding balance", async function () {
      await expect(
        vault.withdraw(ethers.parseUnits("999999", 6))
      ).to.be.revertedWithCustomError(vault, "InsufficientBalance");
    });
  });

  // ── Emergency Withdraw Tests ──

  describe("Emergency Withdraw", function () {
    beforeEach(async function () {
      await vault.deposit(ethers.parseUnits("50000", 6));
    });

    it("should allow emergency withdraw when paused", async function () {
      await vault.pause();
      const balanceBefore = await usdc.balanceOf(owner.address);
      await vault.emergencyWithdraw();
      const balanceAfter = await usdc.balanceOf(owner.address);
      expect(balanceAfter - balanceBefore).to.equal(ethers.parseUnits("50000", 6));
      expect(await vault.getBalance()).to.equal(0);
    });

    it("should reject emergency withdraw when not paused", async function () {
      await expect(vault.emergencyWithdraw()).to.be.revertedWithCustomError(vault, "VaultNotPaused");
    });
  });

  // ── Pause/Unpause Tests ──

  describe("Pause / Unpause", function () {
    it("should allow owner to pause", async function () {
      await vault.pause();
      const p = await vault.getPolicy();
      expect(p.paused).to.be.true;
    });

    it("should allow owner to unpause", async function () {
      await vault.pause();
      await vault.unpause();
      const p = await vault.getPolicy();
      expect(p.paused).to.be.false;
    });

    it("should reject non-owner pause", async function () {
      await expect(vault.connect(user).pause()).to.be.revertedWithCustomError(vault, "OnlyOwner");
    });

    it("should reject double pause", async function () {
      await vault.pause();
      await expect(vault.pause()).to.be.revertedWithCustomError(vault, "VaultPaused");
    });
  });

  // ── Policy Management Tests ──

  describe("Policy Management", function () {
    it("should allow owner to update policy", async function () {
      const newPolicy = { ...defaultPolicy, maxPositionBps: 3000 };
      await vault.updatePolicy(newPolicy);
      const p = await vault.getPolicy();
      expect(p.maxPositionBps).to.equal(3000);
    });

    it("should allow owner to update allowed assets", async function () {
      const newAssets = [await usdc.getAddress()];
      await vault.updateAllowedAssets(newAssets);
      const assets = await vault.getAllowedAssets();
      expect(assets.length).to.equal(1);
    });

    it("should allow owner to change executor", async function () {
      await vault.setExecutor(user.address);
      expect(await vault.executor()).to.equal(user.address);
    });

    it("should reject non-owner policy update", async function () {
      await expect(
        vault.connect(user).updatePolicy(defaultPolicy)
      ).to.be.revertedWithCustomError(vault, "OnlyOwner");
    });
  });

  // ── Shared Helpers ──

  async function buildIntent(overrides = {}) {
      const now = await time.latest();
      const base = {
        vault: ethers.ZeroAddress, // will be set
        assetIn: "", // will be set
        assetOut: "", // will be set
        amountIn: ethers.parseUnits("5000", 6), // 10% of vault
        minAmountOut: ethers.parseUnits("0.07", 8),
        createdAt: now,
        expiresAt: now + 300, // 5 min from block time
        confidenceBps: 8000, // 80%
        riskScoreBps: 2800,  // 28%
        reasonSummary: "Momentum continuation with acceptable volatility",
        ...overrides,
      };
      // Compute hash using abi.encode (matches on-chain C-3 fix)
      base.intentHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "address", "address", "uint256", "uint256", "uint256", "uint256", "uint256", "uint256"],
          [base.vault, base.assetIn, base.assetOut, base.amountIn, base.minAmountOut, base.createdAt, base.expiresAt, base.confidenceBps, base.riskScoreBps]
        )
      );
      return base;
  }

  // ── Execution Tests ──

  describe("Intent Execution", function () {
    const DEPOSIT_AMOUNT = ethers.parseUnits("50000", 6);

    beforeEach(async function () {
      await vault.deposit(DEPOSIT_AMOUNT);
    });

    it("should execute a valid intent", async function () {
      const intent = await buildIntent({
        vault: await vault.getAddress(),
        assetIn: await usdc.getAddress(),
        assetOut: await btc.getAddress(),
      });

      await expect(vault.connect(executor).executeIntent(intent))
        .to.emit(vault, "IntentSubmitted");

      // Verify registry
      expect(await registry.isSubmitted(intent.intentHash)).to.be.true;
      expect(await vault.dailyActionCount()).to.equal(1);
    });

    it("should block non-executor", async function () {
      const intent = await buildIntent({
        vault: await vault.getAddress(),
        assetIn: await usdc.getAddress(),
        assetOut: await btc.getAddress(),
      });

      await expect(
        vault.connect(attacker).executeIntent(intent)
      ).to.be.revertedWithCustomError(vault, "OnlyExecutor");
    });

    it("should block intent exceeding max position", async function () {
      const intent = await buildIntent({
        vault: await vault.getAddress(),
        assetIn: await usdc.getAddress(),
        assetOut: await btc.getAddress(),
        amountIn: ethers.parseUnits("30000", 6), // 60% — exceeds 50% limit
      });

      await expect(
        vault.connect(executor).executeIntent(intent)
      ).to.be.revertedWithCustomError(vault, "PolicyCheckFailed")
        .withArgs("Position size exceeds max limit");
    });

    it("should block intent with low confidence", async function () {
      const intent = await buildIntent({
        vault: await vault.getAddress(),
        assetIn: await usdc.getAddress(),
        assetOut: await btc.getAddress(),
        confidenceBps: 4000, // 40% — below 60% threshold
      });

      await expect(
        vault.connect(executor).executeIntent(intent)
      ).to.be.revertedWithCustomError(vault, "PolicyCheckFailed")
        .withArgs("Confidence below threshold");
    });

    it("should block intent when paused", async function () {
      await vault.pause();
      const intent = await buildIntent({
        vault: await vault.getAddress(),
        assetIn: await usdc.getAddress(),
        assetOut: await btc.getAddress(),
      });

      await expect(
        vault.connect(executor).executeIntent(intent)
      ).to.be.revertedWithCustomError(vault, "VaultPaused");
    });

    it("should enforce cooldown between executions", async function () {
      const intent1 = await buildIntent({
        vault: await vault.getAddress(),
        assetIn: await usdc.getAddress(),
        assetOut: await btc.getAddress(),
      });
      await vault.connect(executor).executeIntent(intent1);

      // Try immediately — should fail
      const intent2 = await buildIntent({
        vault: await vault.getAddress(),
        assetIn: await usdc.getAddress(),
        assetOut: await eth.getAddress(),
      });

      await expect(
        vault.connect(executor).executeIntent(intent2)
      ).to.be.revertedWithCustomError(vault, "PolicyCheckFailed")
        .withArgs("Cooldown period not elapsed");
    });

    it("should allow execution after cooldown elapsed", async function () {
      const intent1 = await buildIntent({
        vault: await vault.getAddress(),
        assetIn: await usdc.getAddress(),
        assetOut: await btc.getAddress(),
      });
      await vault.connect(executor).executeIntent(intent1);

      // Advance time past cooldown (15 min)
      await time.increase(901);

      const intent2 = await buildIntent({
        vault: await vault.getAddress(),
        assetIn: await usdc.getAddress(),
        assetOut: await eth.getAddress(),
      });

      await expect(vault.connect(executor).executeIntent(intent2))
        .to.emit(vault, "IntentSubmitted");

      expect(await vault.dailyActionCount()).to.equal(2);
    });

    it("should block asset not in whitelist", async function () {
      const fakeAsset = ethers.Wallet.createRandom().address;
      const intent = await buildIntent({
        vault: await vault.getAddress(),
        assetIn: await usdc.getAddress(),
        assetOut: fakeAsset,
      });

      await expect(
        vault.connect(executor).executeIntent(intent)
      ).to.be.revertedWithCustomError(vault, "PolicyCheckFailed")
        .withArgs("AssetOut not in whitelist");
    });

    it("should allow a full exit after the vault rotates entirely out of the base asset", async function () {
      await vault.updatePolicy({
        ...defaultPolicy,
        maxPositionBps: 10000,
        cooldownSeconds: 0,
      });

      const vaultAddr = await vault.getAddress();

      const buyIntent = await buildIntent({
        vault: vaultAddr,
        assetIn: await usdc.getAddress(),
        assetOut: await btc.getAddress(),
        amountIn: ethers.parseUnits("50000", 6),
        minAmountOut: ethers.parseUnits("0.70", 8),
      });

      await vault.connect(executor).executeIntent(buyIntent);

      expect(await usdc.balanceOf(vaultAddr)).to.equal(0);
      const btcBalance = await btc.balanceOf(vaultAddr);
      expect(btcBalance).to.be.gt(0);

      const sellIntent = await buildIntent({
        vault: vaultAddr,
        assetIn: await btc.getAddress(),
        assetOut: await usdc.getAddress(),
        amountIn: btcBalance,
        minAmountOut: 1,
      });

      await expect(vault.connect(executor).executeIntent(sellIntent))
        .to.emit(vault, "IntentExecuted");

      expect(await btc.balanceOf(vaultAddr)).to.equal(0);
      expect(await usdc.balanceOf(vaultAddr)).to.be.gt(0);
    });

    it("should not mark a reverted venue swap as a realized loss", async function () {
      await vault.updatePolicy({
        ...defaultPolicy,
        maxPositionBps: 10000,
        cooldownSeconds: 0,
      });

      const vaultAddr = await vault.getAddress();
      const balanceBefore = await usdc.balanceOf(vaultAddr);

      const intent = await buildIntent({
        vault: vaultAddr,
        assetIn: await usdc.getAddress(),
        assetOut: await btc.getAddress(),
        amountIn: ethers.parseUnits("5000", 6),
        minAmountOut: ethers.parseUnits("999", 8), // force MockDEX slippage revert
      });

      await vault.connect(executor).executeIntent(intent);

      expect(await usdc.balanceOf(vaultAddr)).to.equal(balanceBefore);
      expect(await btc.balanceOf(vaultAddr)).to.equal(0);
      expect(await vault.currentDailyLossBps()).to.equal(0);
      expect(await vault.cumulativePnl()).to.equal(0);

      const result = await registry.getResult(intent.intentHash);
      expect(result.success).to.be.false;
      expect(result.amountOut).to.equal(0);
    });

    it("should prevent replay via registry", async function () {
      // Use long expiry so intent doesn't expire before replay test
      const intent = await buildIntent({
        vault: await vault.getAddress(),
        assetIn: await usdc.getAddress(),
        assetOut: await btc.getAddress(),
      });
      // Override expiresAt to be very far in future
      const now = await time.latest();
      intent.expiresAt = now + 86400; // 24h
      // Recompute hash with new expiry (abi.encode)
      intent.intentHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "address", "address", "uint256", "uint256", "uint256", "uint256", "uint256", "uint256"],
          [intent.vault, intent.assetIn, intent.assetOut, intent.amountIn, intent.minAmountOut, intent.createdAt, intent.expiresAt, intent.confidenceBps, intent.riskScoreBps]
        )
      );

      await vault.connect(executor).executeIntent(intent);

      // Advance past cooldown but not past expiry
      await time.increase(901);

      // Same intent hash → should fail at registry level
      await expect(
        vault.connect(executor).executeIntent(intent)
      ).to.be.revertedWithCustomError(registry, "IntentAlreadySubmitted");
    });
  });

  // ── On-Chain Swap Tests ──

  describe("On-Chain Swap via Venue", function () {
    it("should execute a swap through MockDEX and receive tokens", async function () {
      await vault.deposit(ethers.parseUnits("50000", 6));

      const vaultAddr = await vault.getAddress();
      const usdcAddr = await usdc.getAddress();
      const btcAddr = await btc.getAddress();

      // Check vault USDC balance before
      const usdcBefore = await usdc.balanceOf(vaultAddr);

      // Build intent to buy BTC with 5000 USDC
      const intent = await buildIntent({
        vault: vaultAddr,
        assetIn: usdcAddr,
        assetOut: btcAddr,
        amountIn: ethers.parseUnits("5000", 6),
        minAmountOut: ethers.parseUnits("0.05", 8), // Min BTC output (slippage protection)
      });

      await vault.connect(executor).executeIntent(intent);

      // Verify USDC was spent
      const usdcAfter = await usdc.balanceOf(vaultAddr);
      expect(usdcBefore - usdcAfter).to.equal(ethers.parseUnits("5000", 6));

      // Verify BTC was received
      const btcBalance = await btc.balanceOf(vaultAddr);
      expect(btcBalance).to.be.gt(0);

      // Verify intent was auto-finalized in registry
      expect(await registry.isFinalized(intent.intentHash)).to.be.true;

      // Verify result stored
      const result = await registry.getResult(intent.intentHash);
      expect(result.success).to.be.true;
      expect(result.amountOut).to.be.gt(0);
    });

    it("should track vault NAV across multiple assets after swap", async function () {
      await vault.deposit(ethers.parseUnits("50000", 6));

      const intent = await buildIntent({
        vault: await vault.getAddress(),
        assetIn: await usdc.getAddress(),
        assetOut: await eth.getAddress(),
        amountIn: ethers.parseUnits("2000", 6),
        minAmountOut: ethers.parseUnits("0.5", 18), // Min WETH output
      });

      await vault.connect(executor).executeIntent(intent);

      // Vault now holds USDC + WETH
      const usdcBal = await usdc.balanceOf(await vault.getAddress());
      const ethBal = await eth.balanceOf(await vault.getAddress());

      expect(usdcBal).to.equal(ethers.parseUnits("48000", 6)); // 50000 - 2000
      expect(ethBal).to.be.gt(0); // Should have some WETH
    });
  });

  // ── ExecutionRegistry Tests ──

  describe("ExecutionRegistry", function () {
    it("should reject unauthorized callers", async function () {
      const hash = ethers.keccak256(ethers.toUtf8Bytes("intent-unauth"));
      await expect(
        registry.registerIntent(hash, owner.address)
      ).to.be.revertedWithCustomError(registry, "NotAuthorizedVault");
    });

    it("should track vault intents via authorized vault", async function () {
      // Execute an intent through the vault (which is authorized)
      await vault.deposit(ethers.parseUnits("50000", 6));
      const intent = await buildIntent({
        vault: await vault.getAddress(),
        assetIn: await usdc.getAddress(),
        assetOut: await btc.getAddress(),
      });
      await vault.connect(executor).executeIntent(intent);

      expect(await registry.isSubmitted(intent.intentHash)).to.be.true;
      expect(await registry.isFinalized(intent.intentHash)).to.be.true;
      expect(await registry.getVaultIntentCount(await vault.getAddress())).to.be.gte(1);
    });

    it("should compute intent hash deterministically", async function () {
      const vaultAddr = ethers.Wallet.createRandom().address;
      const assetIn = ethers.Wallet.createRandom().address;
      const assetOut = ethers.Wallet.createRandom().address;

      const onChainHash = await registry.computeIntentHash(
        vaultAddr, assetIn, assetOut, 1000, 900, 100, 200, 8000, 2800
      );

      const offChainHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "address", "address", "uint256", "uint256", "uint256", "uint256", "uint256", "uint256"],
          [vaultAddr, assetIn, assetOut, 1000, 900, 100, 200, 8000, 2800]
        )
      );

      expect(onChainHash).to.equal(offChainHash);
    });
  });

  // ── View Functions ──

  describe("View Functions", function () {
    it("should return vault summary", async function () {
      await vault.deposit(ethers.parseUnits("50000", 6));
      const summary = await vault.getVaultSummary();
      expect(summary._owner).to.equal(owner.address);
      expect(summary._executor).to.equal(executor.address);
      expect(summary._balance).to.equal(ethers.parseUnits("50000", 6));
      expect(summary._paused).to.be.false;
      expect(summary._autoExecution).to.be.true;
    });
  });
});
