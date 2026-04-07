const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("OperatorStaking + InsurancePool (Phase 2)", function () {
  let staking, registry, insurance, usdc;
  let admin, arbitrator, opA, opB, claimant;

  const USDC = (n) => ethers.parseUnits(n.toString(), 6);

  const Mandate = { Conservative: 0, Balanced: 1, Tactical: 2 };

  function makeInput(overrides = {}) {
    return {
      name: "Default Bot",
      description: "desc",
      endpoint: "",
      mandate: Mandate.Balanced,
      performanceFeeBps: 1500,
      managementFeeBps: 200,
      entryFeeBps: 0,
      exitFeeBps: 50,
      recommendedMaxPositionBps: 5000,
      recommendedConfidenceMinBps: 6000,
      recommendedStopLossBps: 1500,
      recommendedCooldownSeconds: 900,
      recommendedMaxActionsPerDay: 6,
      ...overrides,
    };
  }

  beforeEach(async function () {
    [admin, arbitrator, opA, opB, claimant] = await ethers.getSigners();

    // Mock USDC (6 decimals)
    const Mock = await ethers.getContractFactory("MockERC20");
    usdc = await Mock.deploy("USD Coin", "USDC", 6);
    await usdc.waitForDeployment();

    // Mint test balances
    await usdc.mint(opA.address, USDC(2_000_000));
    await usdc.mint(opB.address, USDC(2_000_000));

    // Operator Registry
    const Registry = await ethers.getContractFactory("OperatorRegistry");
    registry = await Registry.deploy();
    await registry.waitForDeployment();

    // Insurance Pool
    const Insurance = await ethers.getContractFactory("InsurancePool");
    insurance = await Insurance.deploy(await usdc.getAddress(), arbitrator.address);
    await insurance.waitForDeployment();

    // Operator Staking
    const Staking = await ethers.getContractFactory("OperatorStaking");
    staking = await Staking.deploy(
      await usdc.getAddress(),
      await registry.getAddress(),
      await insurance.getAddress(),
      arbitrator.address
    );
    await staking.waitForDeployment();

    // Both operators register first
    await registry.connect(opA).register(makeInput({ name: "Op A" }));
    await registry.connect(opB).register(makeInput({ name: "Op B" }));
  });

  // ── Stake basics ──
  describe("Stake", function () {
    it("should let registered operator stake USDC", async function () {
      await usdc.connect(opA).approve(await staking.getAddress(), USDC(5_000));
      await expect(staking.connect(opA).stake(USDC(5_000)))
        .to.emit(staking, "Staked")
        .withArgs(opA.address, USDC(5_000), USDC(5_000));

      const s = await staking.getStake(opA.address);
      expect(s.amount).to.equal(USDC(5_000));
      expect(s.lifetimeStaked).to.equal(USDC(5_000));
      expect(await staking.totalStakers()).to.equal(1);
    });

    it("should reject stake from unregistered wallet", async function () {
      await usdc.mint(admin.address, USDC(1_000));
      await usdc.connect(admin).approve(await staking.getAddress(), USDC(1_000));
      await expect(staking.connect(admin).stake(USDC(1_000)))
        .to.be.revertedWithCustomError(staking, "NotRegistered");
    });

    it("should reject zero amount", async function () {
      await expect(staking.connect(opA).stake(0))
        .to.be.revertedWithCustomError(staking, "ZeroAmount");
    });

    it("should accumulate multiple stakes", async function () {
      await usdc.connect(opA).approve(await staking.getAddress(), USDC(20_000));
      await staking.connect(opA).stake(USDC(5_000));
      await staking.connect(opA).stake(USDC(15_000));

      const s = await staking.getStake(opA.address);
      expect(s.amount).to.equal(USDC(20_000));
      expect(s.lifetimeStaked).to.equal(USDC(20_000));
    });
  });

  // ── Tiers ──
  describe("Tiers", function () {
    it("should compute tier correctly across thresholds", async function () {
      expect(await staking.tierOf(opA.address)).to.equal(0); // None

      await usdc.connect(opA).approve(await staking.getAddress(), USDC(2_000_000));

      await staking.connect(opA).stake(USDC(1_000));
      expect(await staking.tierOf(opA.address)).to.equal(1); // Bronze

      await staking.connect(opA).stake(USDC(9_000)); // total 10k
      expect(await staking.tierOf(opA.address)).to.equal(2); // Silver

      await staking.connect(opA).stake(USDC(90_000)); // total 100k
      expect(await staking.tierOf(opA.address)).to.equal(3); // Gold

      await staking.connect(opA).stake(USDC(900_000)); // total 1M
      expect(await staking.tierOf(opA.address)).to.equal(4); // Platinum
    });

    it("should expose maxVaultSize per tier", async function () {
      const capNone = await staking.maxVaultSize(opA.address);
      expect(capNone).to.equal(USDC(5_000));

      await usdc.connect(opA).approve(await staking.getAddress(), USDC(11_000));
      await staking.connect(opA).stake(USDC(11_000));
      const capSilver = await staking.maxVaultSize(opA.address);
      expect(capSilver).to.equal(USDC(500_000));
    });
  });

  // ── Unstake cooldown ──
  describe("Unstake cooldown", function () {
    beforeEach(async function () {
      await usdc.connect(opA).approve(await staking.getAddress(), USDC(20_000));
      await staking.connect(opA).stake(USDC(20_000));
    });

    it("should request unstake into 14-day cooldown", async function () {
      await expect(staking.connect(opA).requestUnstake(USDC(5_000)))
        .to.emit(staking, "UnstakeRequested");

      const s = await staking.getStake(opA.address);
      expect(s.amount).to.equal(USDC(15_000));
      expect(s.pendingUnstake).to.equal(USDC(5_000));
      expect(s.unstakeAvailableAt).to.be.greaterThan(0);
    });

    it("should reject claim before cooldown elapses", async function () {
      await staking.connect(opA).requestUnstake(USDC(5_000));
      await expect(staking.connect(opA).claimUnstake())
        .to.be.revertedWithCustomError(staking, "UnstakeStillCooling");
    });

    it("should allow claim after 14 days", async function () {
      await staking.connect(opA).requestUnstake(USDC(5_000));

      await ethers.provider.send("evm_increaseTime", [14 * 24 * 3600 + 1]);
      await ethers.provider.send("evm_mine");

      const before = await usdc.balanceOf(opA.address);
      await staking.connect(opA).claimUnstake();
      const after = await usdc.balanceOf(opA.address);
      expect(after - before).to.equal(USDC(5_000));

      const s = await staking.getStake(opA.address);
      expect(s.pendingUnstake).to.equal(0);
    });

    it("should reject second pending unstake", async function () {
      await staking.connect(opA).requestUnstake(USDC(5_000));
      await expect(staking.connect(opA).requestUnstake(USDC(1_000)))
        .to.be.revertedWithCustomError(staking, "AlreadyHasPendingUnstake");
    });

    it("should reject unstake exceeding active stake", async function () {
      await expect(staking.connect(opA).requestUnstake(USDC(50_000)))
        .to.be.revertedWithCustomError(staking, "InsufficientStake");
    });
  });

  // ── Slashing ──
  describe("Slashing", function () {
    beforeEach(async function () {
      await usdc.connect(opA).approve(await staking.getAddress(), USDC(100_000));
      await staking.connect(opA).stake(USDC(100_000));
    });

    it("should let arbitrator slash and send to insurance pool", async function () {
      const insBefore = await usdc.balanceOf(await insurance.getAddress());
      await expect(
        staking.connect(arbitrator).slash(opA.address, USDC(20_000), "double_signing")
      ).to.emit(staking, "Slashed");

      const insAfter = await usdc.balanceOf(await insurance.getAddress());
      expect(insAfter - insBefore).to.equal(USDC(20_000));

      const s = await staking.getStake(opA.address);
      expect(s.amount).to.equal(USDC(80_000));
      expect(s.lifetimeSlashed).to.equal(USDC(20_000));
    });

    it("should reject slash from non-arbitrator", async function () {
      await expect(staking.connect(opB).slash(opA.address, USDC(1_000), "x"))
        .to.be.revertedWithCustomError(staking, "NotArbitrator");
    });

    it("should reject slash above 50% cap in one call", async function () {
      // Operator has 100k staked → max single slash = 50k
      await expect(
        staking.connect(arbitrator).slash(opA.address, USDC(60_000), "exceed")
      ).to.be.revertedWithCustomError(staking, "SlashTooLarge");
    });

    it("should slash from pending unstake too", async function () {
      // Move 30k into pending
      await staking.connect(opA).requestUnstake(USDC(30_000));

      // Slash 50k → first 50k from active (capped at active=70k, so 50k from active)
      await staking.connect(arbitrator).slash(opA.address, USDC(50_000), "abuse");

      const s = await staking.getStake(opA.address);
      expect(s.amount).to.equal(USDC(20_000));
      expect(s.pendingUnstake).to.equal(USDC(30_000));
    });

    it("should freeze prevent withdrawal during arbitration", async function () {
      await staking.connect(arbitrator).freeze(opA.address);
      await expect(staking.connect(opA).requestUnstake(USDC(1_000)))
        .to.be.revertedWithCustomError(staking, "Frozen");

      await staking.connect(arbitrator).unfreeze(opA.address);
      await staking.connect(opA).requestUnstake(USDC(1_000));
      const s = await staking.getStake(opA.address);
      expect(s.pendingUnstake).to.equal(USDC(1_000));
    });
  });

  // ── Insurance pool ──
  describe("Insurance Pool", function () {
    it("should accept deposits with source tag", async function () {
      await usdc.connect(opA).approve(await insurance.getAddress(), USDC(5_000));
      await expect(insurance.connect(opA).deposit(USDC(5_000), "donation"))
        .to.emit(insurance, "Deposited")
        .withArgs(opA.address, USDC(5_000), "donation");

      expect(await insurance.totalDeposited()).to.equal(USDC(5_000));
    });

    it("should let user submit a claim", async function () {
      const tx = await insurance.connect(claimant).submitClaim(USDC(2_000), "operator drained vault");
      const receipt = await tx.wait();
      expect(await insurance.claimCount()).to.equal(1);

      const claim = await insurance.claims(1);
      expect(claim.claimant).to.equal(claimant.address);
      expect(claim.amount).to.equal(USDC(2_000));
      expect(claim.paid).to.be.false;
    });

    it("should let arbitrator pay out a claim", async function () {
      // Fund the pool first
      await usdc.connect(opA).approve(await insurance.getAddress(), USDC(10_000));
      await insurance.connect(opA).deposit(USDC(10_000), "seed");

      await insurance.connect(claimant).submitClaim(USDC(3_000), "loss");

      const before = await usdc.balanceOf(claimant.address);
      await expect(insurance.connect(arbitrator).payoutClaim(1, USDC(3_000)))
        .to.emit(insurance, "ClaimPaid");
      const after = await usdc.balanceOf(claimant.address);

      expect(after - before).to.equal(USDC(3_000));
      const claim = await insurance.claims(1);
      expect(claim.paid).to.be.true;
    });

    it("should reject payout from non-arbitrator", async function () {
      await usdc.connect(opA).approve(await insurance.getAddress(), USDC(5_000));
      await insurance.connect(opA).deposit(USDC(5_000), "seed");
      await insurance.connect(claimant).submitClaim(USDC(1_000), "x");
      await expect(insurance.connect(opB).payoutClaim(1, USDC(1_000)))
        .to.be.revertedWithCustomError(insurance, "NotArbitrator");
    });

    it("should reject double payout", async function () {
      await usdc.connect(opA).approve(await insurance.getAddress(), USDC(5_000));
      await insurance.connect(opA).deposit(USDC(5_000), "seed");
      await insurance.connect(claimant).submitClaim(USDC(1_000), "x");
      await insurance.connect(arbitrator).payoutClaim(1, USDC(1_000));
      await expect(insurance.connect(arbitrator).payoutClaim(1, USDC(1_000)))
        .to.be.revertedWithCustomError(insurance, "AlreadyPaid");
    });
  });

  // ── End-to-end ──
  describe("End-to-end slashing flow", function () {
    it("should slash → insurance receives → claimant gets paid", async function () {
      // Setup: opA stakes 100k, achieves Gold tier
      await usdc.connect(opA).approve(await staking.getAddress(), USDC(100_000));
      await staking.connect(opA).stake(USDC(100_000));
      expect(await staking.tierOf(opA.address)).to.equal(3);

      // Misbehavior: arbitrator freezes + slashes
      await staking.connect(arbitrator).freeze(opA.address);
      await staking.connect(arbitrator).slash(opA.address, USDC(50_000), "policy_violation");

      const sAfter = await staking.getStake(opA.address);
      expect(sAfter.amount).to.equal(USDC(50_000));
      expect(await staking.tierOf(opA.address)).to.equal(2); // Demoted to Silver
      expect(await usdc.balanceOf(await insurance.getAddress())).to.equal(USDC(50_000));

      // Damaged user files claim, arbitrator pays out from pool
      await insurance.connect(claimant).submitClaim(USDC(20_000), "lost funds");
      const before = await usdc.balanceOf(claimant.address);
      await insurance.connect(arbitrator).payoutClaim(1, USDC(20_000));
      const after = await usdc.balanceOf(claimant.address);
      expect(after - before).to.equal(USDC(20_000));

      // Pool retains the rest
      expect(await usdc.balanceOf(await insurance.getAddress())).to.equal(USDC(30_000));
    });
  });
});
