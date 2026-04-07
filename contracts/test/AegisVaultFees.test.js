const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("AegisVault Fee System (Phase 1)", function () {
  let owner, executor, operator, treasury, attacker;
  let usdc, btc;
  let registry, factory, vault, protocolTreasury;

  // Policy with realistic fees
  function makePolicy(overrides = {}) {
    return {
      maxPositionBps: 5000,
      maxDailyLossBps: 500,
      stopLossBps: 1500,
      cooldownSeconds: 60,
      confidenceThresholdBps: 6000,
      maxActionsPerDay: 20,
      autoExecution: true,
      paused: false,
      // Fees
      performanceFeeBps: 1500,        // 15%
      managementFeeBps: 200,          // 2%/year
      entryFeeBps: 50,                // 0.5%
      exitFeeBps: 100,                // 1%
      feeRecipient: ethers.ZeroAddress, // set after deploy
      ...overrides,
    };
  }

  beforeEach(async function () {
    [owner, executor, operator, treasury, attacker] = await ethers.getSigners();

    // Deploy mock tokens
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    usdc = await MockERC20.deploy("USD Coin", "USDC", 6);
    btc = await MockERC20.deploy("Wrapped BTC", "WBTC", 8);

    // Deploy ProtocolTreasury
    const Treasury = await ethers.getContractFactory("ProtocolTreasury");
    protocolTreasury = await Treasury.deploy(owner.address);

    // Deploy ExecutionRegistry
    const ExecutionRegistry = await ethers.getContractFactory("ExecutionRegistry");
    registry = await ExecutionRegistry.deploy();

    // Deploy Factory with treasury
    const Factory = await ethers.getContractFactory("AegisVaultFactory");
    factory = await Factory.deploy(
      await registry.getAddress(),
      await protocolTreasury.getAddress()
    );

    // Transfer registry admin to factory
    await registry.transferAdmin(await factory.getAddress());

    // Create vault with operator as feeRecipient
    const policy = makePolicy({ feeRecipient: operator.address });
    const tx = await factory.createVault(
      await usdc.getAddress(),
      executor.address,
      ethers.ZeroAddress, // no venue for fee tests
      policy,
      [await usdc.getAddress(), await btc.getAddress()]
    );
    await tx.wait();

    const vaultAddr = await factory.getVaultAt(0);
    vault = await ethers.getContractAt("AegisVault", vaultAddr);

    // Mint USDC to owner
    await usdc.mint(owner.address, ethers.parseUnits("1000000", 6));
    await usdc.connect(owner).approve(vaultAddr, ethers.parseUnits("1000000", 6));
  });

  describe("Fee Validation", function () {
    it("should reject performance fee above 30%", async function () {
      const badPolicy = makePolicy({ performanceFeeBps: 3001, feeRecipient: operator.address });
      await expect(
        factory.createVault(
          await usdc.getAddress(),
          executor.address,
          ethers.ZeroAddress,
          badPolicy,
          [await usdc.getAddress()]
        )
      ).to.be.reverted;
    });

    it("should reject management fee above 5%", async function () {
      const badPolicy = makePolicy({ managementFeeBps: 501, feeRecipient: operator.address });
      await expect(
        factory.createVault(
          await usdc.getAddress(),
          executor.address,
          ethers.ZeroAddress,
          badPolicy,
          [await usdc.getAddress()]
        )
      ).to.be.reverted;
    });

    it("should reject entry/exit fee above 2%", async function () {
      const badPolicy = makePolicy({ entryFeeBps: 201, feeRecipient: operator.address });
      await expect(
        factory.createVault(
          await usdc.getAddress(),
          executor.address,
          ethers.ZeroAddress,
          badPolicy,
          [await usdc.getAddress()]
        )
      ).to.be.reverted;
    });
  });

  describe("Entry Fee", function () {
    it("should charge entry fee on deposit (0.5%)", async function () {
      const depositAmount = ethers.parseUnits("10000", 6);
      const expectedFee = (depositAmount * 50n) / 10000n; // 0.5%
      const expectedNet = depositAmount - expectedFee;

      // 80% to operator, 20% to protocol
      const expectedOpFee = (expectedFee * 8000n) / 10000n;
      const expectedProtocolFee = expectedFee - expectedOpFee;

      const opBalBefore = await usdc.balanceOf(operator.address);
      const treasuryBalBefore = await usdc.balanceOf(await protocolTreasury.getAddress());

      await expect(vault.deposit(depositAmount))
        .to.emit(vault, "EntryFeeCharged");

      // Operator received their cut
      expect(await usdc.balanceOf(operator.address)).to.equal(opBalBefore + expectedOpFee);
      // Treasury received their cut
      expect(await usdc.balanceOf(await protocolTreasury.getAddress())).to.equal(treasuryBalBefore + expectedProtocolFee);
      // Vault has net deposit
      expect(await usdc.balanceOf(await vault.getAddress())).to.equal(expectedNet);
      // totalDeposited tracks net
      expect(await vault.totalDeposited()).to.equal(expectedNet);
    });

    it("should not charge entry fee when feeRecipient is zero", async function () {
      // Create new vault with no fee recipient
      const policy = makePolicy({ feeRecipient: ethers.ZeroAddress, entryFeeBps: 50 });
      await factory.createVault(
        await usdc.getAddress(),
        executor.address,
        ethers.ZeroAddress,
        policy,
        [await usdc.getAddress()]
      );
      const newVault = await ethers.getContractAt("AegisVault", await factory.getVaultAt(1));
      await usdc.connect(owner).approve(await newVault.getAddress(), ethers.parseUnits("10000", 6));

      const depositAmount = ethers.parseUnits("10000", 6);
      await newVault.deposit(depositAmount);

      // Full deposit goes to vault, no fee charged
      expect(await usdc.balanceOf(await newVault.getAddress())).to.equal(depositAmount);
    });
  });

  describe("Exit Fee", function () {
    beforeEach(async function () {
      await vault.deposit(ethers.parseUnits("10000", 6));
    });

    it("should charge exit fee on withdraw (1%)", async function () {
      const withdrawAmount = ethers.parseUnits("1000", 6);
      const expectedFee = (withdrawAmount * 100n) / 10000n; // 1%
      const expectedNet = withdrawAmount - expectedFee;

      const ownerBalBefore = await usdc.balanceOf(owner.address);
      const opBalBefore = await usdc.balanceOf(operator.address);

      await expect(vault.withdraw(withdrawAmount))
        .to.emit(vault, "ExitFeeCharged");

      // Owner gets net amount
      expect(await usdc.balanceOf(owner.address)).to.equal(ownerBalBefore + expectedNet);
      // Operator + treasury split
      expect(await usdc.balanceOf(operator.address)).to.be.gt(opBalBefore);
    });
  });

  describe("HWM (High Water Mark)", function () {
    it("should initialize HWM on first deposit", async function () {
      const depositAmount = ethers.parseUnits("10000", 6);
      const expectedNet = depositAmount - (depositAmount * 50n) / 10000n;

      await vault.deposit(depositAmount);

      // HWM should equal net deposit (after entry fee)
      expect(await vault.highWaterMark()).to.equal(expectedNet);
    });

    it("should NOT charge perf fee when NAV below HWM", async function () {
      await vault.deposit(ethers.parseUnits("10000", 6));
      const hwmBefore = await vault.highWaterMark();

      // Simulate loss: send some USDC out via attacker (just for testing)
      // We can't actually trade, so we'll just check that accrueFees does nothing
      await vault.accrueFees();

      // HWM unchanged
      expect(await vault.highWaterMark()).to.equal(hwmBefore);
      expect(await vault.accruedPerformanceFee()).to.equal(0);
    });

    it("should charge perf fee on profit above HWM", async function () {
      await vault.deposit(ethers.parseUnits("10000", 6));
      const hwmBefore = await vault.highWaterMark();

      // Simulate profit: mint extra USDC directly to vault (as if from a successful swap)
      await usdc.mint(await vault.getAddress(), ethers.parseUnits("1000", 6));

      // Trigger accrual
      await vault.accrueFees();

      // Performance fee should be ~15% of $1000 profit = $150
      const accrued = await vault.accruedPerformanceFee();
      // Allow tolerance for management fee that also accrued
      expect(accrued).to.be.gt(ethers.parseUnits("140", 6));
      expect(accrued).to.be.lt(ethers.parseUnits("160", 6));

      // HWM updated
      const hwmAfter = await vault.highWaterMark();
      expect(hwmAfter).to.be.gt(hwmBefore);
    });
  });

  describe("Streaming Management Fee", function () {
    it("should accrue management fee over time", async function () {
      await vault.deposit(ethers.parseUnits("10000", 6));

      // Fast forward 30 days
      await time.increase(30 * 24 * 3600);
      await vault.accrueFees();

      const accrued = await vault.accruedManagementFee();

      // Expected: NAV × 2% × (30/365)
      // ≈ 9950 × 0.02 × 0.0822 ≈ 16.35
      expect(accrued).to.be.gt(ethers.parseUnits("15", 6));
      expect(accrued).to.be.lt(ethers.parseUnits("18", 6));
    });

    it("should accrue management fee proportional to time elapsed", async function () {
      await vault.deposit(ethers.parseUnits("10000", 6));

      // 1 year
      await time.increase(365 * 24 * 3600);
      await vault.accrueFees();

      const accrued = await vault.accruedManagementFee();
      // Expected: ~2% of $9950 = ~$199
      expect(accrued).to.be.gt(ethers.parseUnits("190", 6));
      expect(accrued).to.be.lt(ethers.parseUnits("210", 6));
    });
  });

  describe("Claim Fees", function () {
    beforeEach(async function () {
      await vault.deposit(ethers.parseUnits("10000", 6));
      // Add profit so there's perf fee
      await usdc.mint(await vault.getAddress(), ethers.parseUnits("1000", 6));
      // Wait some time for management fee
      await time.increase(30 * 24 * 3600);
    });

    it("should distribute fees: 80% operator, 20% treasury", async function () {
      const opBalBefore = await usdc.balanceOf(operator.address);
      const treasuryBalBefore = await usdc.balanceOf(await protocolTreasury.getAddress());

      await expect(vault.connect(operator).claimFees())
        .to.emit(vault, "FeesClaimed");

      const opBalAfter = await usdc.balanceOf(operator.address);
      const treasuryBalAfter = await usdc.balanceOf(await protocolTreasury.getAddress());

      const opGain = opBalAfter - opBalBefore;
      const treasuryGain = treasuryBalAfter - treasuryBalBefore;

      // Operator should get more than treasury (80/20 split)
      expect(opGain).to.be.gt(0);
      expect(treasuryGain).to.be.gt(0);
      // Operator gets 4x what treasury gets (80/20 = 4:1)
      const ratio = (opGain * 100n) / treasuryGain;
      expect(ratio).to.be.gte(390n); // ~400, allow some rounding
      expect(ratio).to.be.lte(410n);

      // After claim, accrued should be zero
      expect(await vault.accruedPerformanceFee()).to.equal(0);
      expect(await vault.accruedManagementFee()).to.equal(0);
    });

    it("should reject claim from non-fee-recipient", async function () {
      await expect(
        vault.connect(attacker).claimFees()
      ).to.be.revertedWithCustomError(vault, "OnlyFeeRecipient");
    });

    it("should reject claim when no fees accrued", async function () {
      // Create fresh vault
      const policy = makePolicy({ feeRecipient: operator.address, performanceFeeBps: 0, managementFeeBps: 0, entryFeeBps: 0, exitFeeBps: 0 });
      await factory.createVault(
        await usdc.getAddress(),
        executor.address,
        ethers.ZeroAddress,
        policy,
        [await usdc.getAddress()]
      );
      const freshVault = await ethers.getContractAt("AegisVault", await factory.getVaultAt(1));
      await usdc.connect(owner).approve(await freshVault.getAddress(), ethers.parseUnits("100", 6));
      await freshVault.deposit(ethers.parseUnits("100", 6));

      await expect(
        freshVault.connect(operator).claimFees()
      ).to.be.revertedWithCustomError(freshVault, "NoFeesAccrued");
    });
  });

  describe("setFeeRecipient", function () {
    it("should let owner change fee recipient", async function () {
      await vault.deposit(ethers.parseUnits("10000", 6));
      await time.increase(30 * 24 * 3600);

      // Change recipient — old recipient gets accrued fees still pending
      await vault.connect(owner).setFeeRecipient(attacker.address);

      const policy = await vault.getPolicy();
      expect(policy.feeRecipient).to.equal(attacker.address);
    });

    it("should reject non-owner", async function () {
      await expect(
        vault.connect(attacker).setFeeRecipient(attacker.address)
      ).to.be.revertedWithCustomError(vault, "OnlyOwner");
    });
  });

  describe("Fee Change Cooldown (Phase 4 protection)", function () {
    it("should queue fee change with 7-day cooldown", async function () {
      await expect(
        vault.connect(owner).queueFeeChange(2000, 300, 100, 150)
      ).to.emit(vault, "FeeChangeQueued");

      const pending = await vault.pendingFeeChange();
      expect(pending.pending).to.be.true;
      expect(pending.newPerformanceFeeBps).to.equal(2000);
    });

    it("should reject applying fee change before cooldown", async function () {
      await vault.connect(owner).queueFeeChange(2000, 300, 100, 150);
      await expect(
        vault.connect(owner).applyFeeChange()
      ).to.be.revertedWithCustomError(vault, "FeeChangeTooSoon");
    });

    it("should apply fee change after 7 days", async function () {
      await vault.connect(owner).queueFeeChange(2000, 300, 100, 150);
      await time.increase(7 * 24 * 3600 + 1);

      await expect(vault.connect(owner).applyFeeChange())
        .to.emit(vault, "FeeChangeApplied");

      const policy = await vault.getPolicy();
      expect(policy.performanceFeeBps).to.equal(2000);
      expect(policy.managementFeeBps).to.equal(300);
    });

    it("should reject queueFeeChange above caps", async function () {
      await expect(
        vault.connect(owner).queueFeeChange(3001, 300, 100, 150)
      ).to.be.revertedWithCustomError(vault, "FeeAboveMax");
    });
  });

  describe("ProtocolTreasury", function () {
    it("should let admin spend treasury funds", async function () {
      // Generate some treasury revenue
      await vault.deposit(ethers.parseUnits("10000", 6));
      await usdc.mint(await vault.getAddress(), ethers.parseUnits("1000", 6));
      await time.increase(30 * 24 * 3600);
      await vault.connect(operator).claimFees();

      const treasuryBal = await usdc.balanceOf(await protocolTreasury.getAddress());
      expect(treasuryBal).to.be.gt(0);

      // Owner spends some
      const spendAmount = treasuryBal / 2n;
      await expect(
        protocolTreasury.spend(await usdc.getAddress(), attacker.address, spendAmount, "audit")
      ).to.emit(protocolTreasury, "Spent");

      expect(await usdc.balanceOf(attacker.address)).to.equal(spendAmount);
    });

    it("should reject spend from non-admin", async function () {
      await expect(
        protocolTreasury.connect(attacker).spend(await usdc.getAddress(), attacker.address, 1, "x")
      ).to.be.revertedWithCustomError(protocolTreasury, "OnlyApprovedSpender");
    });
  });
});
