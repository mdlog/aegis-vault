const { expect } = require("chai");
const { ethers } = require("hardhat");

async function deployVaultImpl() {
  const execLib = await (await ethers.getContractFactory("ExecLib")).deploy();
  const sealedLib = await (await ethers.getContractFactory("SealedLib")).deploy();
  const ioLib = await (await ethers.getContractFactory("IOLib")).deploy();
  await execLib.waitForDeployment();
  await sealedLib.waitForDeployment();
  await ioLib.waitForDeployment();
  const AegisVault = await ethers.getContractFactory("AegisVault", {
    libraries: {
      ExecLib: await execLib.getAddress(),
      SealedLib: await sealedLib.getAddress(),
      IOLib: await ioLib.getAddress(),
    },
  });
  const impl = await AegisVault.deploy();
  await impl.waitForDeployment();
  return await impl.getAddress();
}

/**
 * Phase 5 security sweep: edge cases around the new fixes.
 *
 *   1. AegisGovernor: cannot remove the last owner (would brick the contract).
 *   2. OperatorStaking: cannot freeze a wallet that has never staked.
 *   3. InsurancePool: totalSlashReceived tracks slash deposits separately from
 *      voluntary deposits.
 *   4. Slash-per-call cap (50%) is per-call — confirm compounding behavior.
 *   5. Fee math edges: zero-fee vaults, HWM never regresses on loss+recovery.
 */

const USDC = (n) => ethers.parseUnits(n.toString(), 6);

const Mandate = { Conservative: 0, Balanced: 1, Tactical: 2 };
function makeOperatorInput(overrides = {}) {
  return {
    name: "TestBot",
    description: "desc",
    endpoint: "",
    mandate: Mandate.Balanced,
    performanceFeeBps: 1500,
    managementFeeBps: 200,
    entryFeeBps: 0,
    exitFeeBps: 0,
    recommendedMaxPositionBps: 5000,
    recommendedConfidenceMinBps: 6000,
    recommendedStopLossBps: 1500,
    recommendedCooldownSeconds: 0,
    recommendedMaxActionsPerDay: 20,
    ...overrides,
  };
}

describe("Security edge cases (Phase 5 sweep)", function () {
  let owner1, owner2, operator, arbitrator, attacker;

  before(async function () {
    [owner1, owner2, operator, arbitrator, attacker] = await ethers.getSigners();
  });

  describe("AegisGovernor — last owner invariant", function () {
    it("should reject removing the last remaining owner", async function () {
      const Governor = await ethers.getContractFactory("AegisGovernor");
      // Start with 1-of-1
      const gov = await Governor.deploy([owner1.address], 1);

      // Any attempt to remove the only owner must revert
      const removeData = gov.interface.encodeFunctionData("removeOwner", [owner1.address]);
      await gov.connect(owner1).submit(await gov.getAddress(), 0, removeData, "try to remove self");
      await expect(gov.connect(owner1).execute(0))
        .to.be.revertedWithCustomError(gov, "CallFailed");
    });

    it("should allow removing a non-last owner and correctly auto-lower threshold", async function () {
      const Governor = await ethers.getContractFactory("AegisGovernor");
      // Start with 2-of-2
      const gov = await Governor.deploy([owner1.address, owner2.address], 2);

      const removeData = gov.interface.encodeFunctionData("removeOwner", [owner2.address]);
      await gov.connect(owner1).submit(await gov.getAddress(), 0, removeData, "remove owner2");
      await gov.connect(owner2).confirm(0);
      await gov.connect(owner1).execute(0);

      expect(await gov.ownerCount()).to.equal(1);
      // Threshold auto-lowered to match owners.length
      expect(await gov.threshold()).to.equal(1);
    });

    it("should never let threshold fall to zero via direct changeThreshold", async function () {
      const Governor = await ethers.getContractFactory("AegisGovernor");
      const gov = await Governor.deploy([owner1.address, owner2.address], 2);

      const data = gov.interface.encodeFunctionData("changeThreshold", [0]);
      await gov.connect(owner1).submit(await gov.getAddress(), 0, data, "zero threshold");
      await gov.connect(owner2).confirm(0);
      await expect(gov.connect(owner1).execute(0))
        .to.be.revertedWithCustomError(gov, "CallFailed");
    });
  });

  describe("OperatorStaking — freeze pre-conditions", function () {
    let usdc, registry, insurance, staking;

    beforeEach(async function () {
      const Mock = await ethers.getContractFactory("MockERC20");
      usdc = await Mock.deploy("USDC", "USDC", 6);

      const Registry = await ethers.getContractFactory("OperatorRegistry");
      registry = await Registry.deploy();

      const Insurance = await ethers.getContractFactory("InsurancePool");
      insurance = await Insurance.deploy(await usdc.getAddress(), arbitrator.address);

      const Staking = await ethers.getContractFactory("OperatorStaking");
      staking = await Staking.deploy(
        await usdc.getAddress(),
        await registry.getAddress(),
        await insurance.getAddress(),
        arbitrator.address
      );
    });

    it("should reject freezing a wallet that has never staked", async function () {
      await expect(staking.connect(arbitrator).freeze(attacker.address))
        .to.be.revertedWithCustomError(staking, "InsufficientStake");
    });

    it("should allow freezing a wallet with only pending unstake (no active)", async function () {
      // Setup: register + stake + request full unstake
      await registry.connect(operator).register(makeOperatorInput());
      await usdc.mint(operator.address, USDC(5_000));
      await usdc.connect(operator).approve(await staking.getAddress(), USDC(5_000));
      await staking.connect(operator).stake(USDC(5_000));
      await staking.connect(operator).requestUnstake(USDC(5_000));

      const sBefore = await staking.getStake(operator.address);
      expect(sBefore.amount).to.equal(0);
      expect(sBefore.pendingUnstake).to.equal(USDC(5_000));

      // Freeze should still work on pending-only stakes
      await staking.connect(arbitrator).freeze(operator.address);
      const sAfter = await staking.getStake(operator.address);
      expect(sAfter.frozen).to.be.true;
    });
  });

  describe("InsurancePool — slash accounting separation", function () {
    let usdc, registry, insurance, staking;

    beforeEach(async function () {
      const Mock = await ethers.getContractFactory("MockERC20");
      usdc = await Mock.deploy("USDC", "USDC", 6);

      const Registry = await ethers.getContractFactory("OperatorRegistry");
      registry = await Registry.deploy();

      const Insurance = await ethers.getContractFactory("InsurancePool");
      insurance = await Insurance.deploy(await usdc.getAddress(), arbitrator.address);

      const Staking = await ethers.getContractFactory("OperatorStaking");
      staking = await Staking.deploy(
        await usdc.getAddress(),
        await registry.getAddress(),
        await insurance.getAddress(),
        arbitrator.address
      );

      // Authorize staking as a notifier on the insurance pool
      await insurance.connect(arbitrator).setNotifier(await staking.getAddress(), true);

      // Setup operator with stake
      await registry.connect(operator).register(makeOperatorInput());
      await usdc.mint(operator.address, USDC(100_000));
      await usdc.connect(operator).approve(await staking.getAddress(), USDC(100_000));
      await staking.connect(operator).stake(USDC(100_000));
    });

    it("should track slash deposits in totalSlashReceived, not totalDeposited", async function () {
      expect(await insurance.totalDeposited()).to.equal(0);
      expect(await insurance.totalSlashReceived()).to.equal(0);

      await staking.connect(arbitrator).slash(operator.address, USDC(10_000), "test");

      expect(await insurance.totalDeposited()).to.equal(0); // unchanged
      expect(await insurance.totalSlashReceived()).to.equal(USDC(10_000));
      expect(await insurance.balance()).to.equal(USDC(10_000));
    });

    it("should reject notifySlashReceived from unauthorized caller", async function () {
      await expect(insurance.connect(attacker).notifySlashReceived(USDC(1_000)))
        .to.be.revertedWithCustomError(insurance, "NotAuthorized");
      // Counter unchanged
      expect(await insurance.totalSlashReceived()).to.equal(0);
    });

    it("should let voluntary deposits coexist with slash deposits", async function () {
      // Slash $10k
      await staking.connect(arbitrator).slash(operator.address, USDC(10_000), "slash reason");

      // Voluntary donation of $5k
      await usdc.mint(attacker.address, USDC(5_000));
      await usdc.connect(attacker).approve(await insurance.getAddress(), USDC(5_000));
      await insurance.connect(attacker).deposit(USDC(5_000), "donation");

      expect(await insurance.totalDeposited()).to.equal(USDC(5_000));
      expect(await insurance.totalSlashReceived()).to.equal(USDC(10_000));
      expect(await insurance.balance()).to.equal(USDC(15_000));
    });
  });

  describe("Slashing — per-call cap compounding behavior", function () {
    let usdc, registry, insurance, staking;

    beforeEach(async function () {
      const Mock = await ethers.getContractFactory("MockERC20");
      usdc = await Mock.deploy("USDC", "USDC", 6);

      const Registry = await ethers.getContractFactory("OperatorRegistry");
      registry = await Registry.deploy();

      const Insurance = await ethers.getContractFactory("InsurancePool");
      insurance = await Insurance.deploy(await usdc.getAddress(), arbitrator.address);

      const Staking = await ethers.getContractFactory("OperatorStaking");
      staking = await Staking.deploy(
        await usdc.getAddress(),
        await registry.getAddress(),
        await insurance.getAddress(),
        arbitrator.address
      );

      await registry.connect(operator).register(makeOperatorInput());
      await usdc.mint(operator.address, USDC(100_000));
      await usdc.connect(operator).approve(await staking.getAddress(), USDC(100_000));
      await staking.connect(operator).stake(USDC(100_000));
    });

    it("P5-S9: per-window cap blocks slash compounding within 7 days", async function () {
      // First slash: 50k (50% of 100k window-start). Opens window.
      await staking.connect(arbitrator).slash(operator.address, USDC(50_000), "round1");
      expect((await staking.getStake(operator.address)).amount).to.equal(USDC(50_000));

      // Second slash within same window — would have been allowed under per-call cap
      // (50% of remaining 50k = 25k) but the per-window cap blocks it because we've
      // already slashed the full 50% of windowStartStake (100k * 0.5 = 50k).
      await expect(
        staking.connect(arbitrator).slash(operator.address, USDC(1_000), "round2")
      ).to.be.revertedWithCustomError(staking, "SlashTooLarge");

      // Even a tiny additional slash is blocked
      await expect(
        staking.connect(arbitrator).slash(operator.address, USDC(1), "round2")
      ).to.be.revertedWithCustomError(staking, "SlashTooLarge");
    });

    it("P5-S9: new window opens after 7 days, allowing further slashing", async function () {
      // Initial slash uses up the first window
      await staking.connect(arbitrator).slash(operator.address, USDC(50_000), "round1");

      // Fast-forward past SLASH_WINDOW
      await ethers.provider.send("evm_increaseTime", [7 * 24 * 3600 + 1]);
      await ethers.provider.send("evm_mine");

      // New window opens — slashable based on current 50k stake (max 25k per call)
      await staking.connect(arbitrator).slash(operator.address, USDC(25_000), "round2");
      expect((await staking.getStake(operator.address)).amount).to.equal(USDC(25_000));

      // Lifetime slashed = 50k + 25k = 75k
      expect((await staking.getStake(operator.address)).lifetimeSlashed).to.equal(USDC(75_000));
    });
  });


  describe("ProposalBuilders — owner rotation cannot lock governor", function () {
    it("should allow rotation: add + remove flow leaves governor operational", async function () {
      const Governor = await ethers.getContractFactory("AegisGovernor");
      const gov = await Governor.deploy([owner1.address, owner2.address], 2);

      // Proposal A: add attacker as 3rd owner
      const addData = gov.interface.encodeFunctionData("addOwner", [attacker.address]);
      await gov.connect(owner1).submit(await gov.getAddress(), 0, addData, "add attacker");
      await gov.connect(owner2).confirm(0);
      await gov.connect(owner1).execute(0);
      expect(await gov.ownerCount()).to.equal(3);

      // Proposal B: remove owner2
      const removeData = gov.interface.encodeFunctionData("removeOwner", [owner2.address]);
      await gov.connect(owner1).submit(await gov.getAddress(), 0, removeData, "remove owner2");
      await gov.connect(attacker).confirm(1);
      await gov.connect(owner1).execute(1);
      expect(await gov.ownerCount()).to.equal(2);

      // Proposal C should still work with new 2-owner set (owner1 + attacker)
      const addData2 = gov.interface.encodeFunctionData("addOwner", [operator.address]);
      await gov.connect(owner1).submit(await gov.getAddress(), 0, addData2, "add operator");
      await gov.connect(attacker).confirm(2);
      await gov.connect(owner1).execute(2);
      expect(await gov.ownerCount()).to.equal(3);
    });
  });
});
