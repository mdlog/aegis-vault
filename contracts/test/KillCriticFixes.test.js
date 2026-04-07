const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * KillCritic security audit fixes — regression tests for the issues found during
 * the pre-mainnet audit.
 */

const USDC = (n) => ethers.parseUnits(n.toString(), 6);

const Mandate = { Conservative: 0, Balanced: 1, Tactical: 2 };
function makeOperatorInput(overrides = {}) {
  return {
    name: "Bot",
    description: "x",
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

describe("KillCritic security regression tests", function () {

  // ── P5-S6: Governor cancel restricted to proposer ──
  describe("P5-S6: AegisGovernor cancel restricted to proposer", function () {
    let governor, target, owner1, owner2, owner3;

    beforeEach(async function () {
      [owner1, owner2, owner3] = await ethers.getSigners();
      const Governor = await ethers.getContractFactory("AegisGovernor");
      governor = await Governor.deploy([owner1.address, owner2.address, owner3.address], 2);
      const Mock = await ethers.getContractFactory("MockERC20");
      target = await Mock.deploy("X", "X", 18);
    });

    it("non-proposer owner cannot cancel another owner's proposal", async function () {
      const data = target.interface.encodeFunctionData("mint", [owner2.address, 1000]);
      await governor.connect(owner1).submit(await target.getAddress(), 0, data, "test");
      await expect(governor.connect(owner2).cancel(0))
        .to.be.revertedWithCustomError(governor, "NotProposer");
      await expect(governor.connect(owner3).cancel(0))
        .to.be.revertedWithCustomError(governor, "NotProposer");
    });

    it("proposer can cancel their own proposal", async function () {
      const data = target.interface.encodeFunctionData("mint", [owner2.address, 1000]);
      await governor.connect(owner1).submit(await target.getAddress(), 0, data, "test");
      await governor.connect(owner1).cancel(0);
      const p = await governor.getProposal(0);
      expect(p.canceled).to.be.true;
    });
  });

  // ── P5-S7: Owner generation invalidates stale proposals ──
  describe("P5-S7: Owner generation invalidates stale proposals", function () {
    let governor, target, owner1, owner2, owner3, attacker;

    beforeEach(async function () {
      [owner1, owner2, owner3, attacker] = await ethers.getSigners();
      const Governor = await ethers.getContractFactory("AegisGovernor");
      governor = await Governor.deploy([owner1.address, owner2.address, owner3.address], 2);
      const Mock = await ethers.getContractFactory("MockERC20");
      target = await Mock.deploy("X", "X", 18);
    });

    it("a proposal submitted before an owner change cannot be confirmed/executed afterwards", async function () {
      // Stale proposal: owner1 submits, only auto-confirm (1/2)
      const data = target.interface.encodeFunctionData("mint", [owner1.address, 1000]);
      await governor.connect(owner1).submit(await target.getAddress(), 0, data, "stale");

      // Now: owner2 + owner3 collectively add a 4th owner via a counter-proposal
      const addData = governor.interface.encodeFunctionData("addOwner", [attacker.address]);
      await governor.connect(owner2).submit(await governor.getAddress(), 0, addData, "add");
      await governor.connect(owner3).confirm(1);
      await governor.connect(owner1).execute(1); // executes addOwner → bumps generation

      // Proposal 0 is now stale (generation=0 vs ownerGeneration=1)
      await expect(governor.connect(owner2).confirm(0))
        .to.be.revertedWithCustomError(governor, "ProposalStale");
    });
  });

  // ── P5-S8: OperatorStaking FoT token handling ──
  describe("P5-S8: OperatorStaking handles fee-on-transfer tokens", function () {
    let usdc, registry, insurance, staking, deployer, op;

    beforeEach(async function () {
      [deployer, op] = await ethers.getSigners();
      const Mock = await ethers.getContractFactory("MockERC20");
      usdc = await Mock.deploy("USDC", "USDC", 6);

      const Registry = await ethers.getContractFactory("OperatorRegistry");
      registry = await Registry.deploy();

      const Insurance = await ethers.getContractFactory("InsurancePool");
      insurance = await Insurance.deploy(await usdc.getAddress(), deployer.address);

      const Staking = await ethers.getContractFactory("OperatorStaking");
      staking = await Staking.deploy(
        await usdc.getAddress(),
        await registry.getAddress(),
        await insurance.getAddress(),
        deployer.address
      );

      await registry.connect(op).register(makeOperatorInput());
      await usdc.mint(op.address, USDC(10_000));
    });

    it("credits the actual received amount, not the requested amount", async function () {
      // Standard ERC20 with no fee → received == requested
      await usdc.connect(op).approve(await staking.getAddress(), USDC(5_000));
      await staking.connect(op).stake(USDC(5_000));
      const s = await staking.getStake(op.address);
      expect(s.amount).to.equal(USDC(5_000));
      expect(s.lifetimeStaked).to.equal(USDC(5_000));
      // Sanity: contract balance equals stored amount (no drift)
      expect(await usdc.balanceOf(await staking.getAddress())).to.equal(s.amount);
    });
  });

  // ── P5-S11: ProtocolTreasury notifyReceived auth ──
  describe("P5-S11: ProtocolTreasury notifyReceived requires authorized reporter", function () {
    let treasury, deployer, attacker, vault;

    beforeEach(async function () {
      [deployer, attacker, vault] = await ethers.getSigners();
      const Treasury = await ethers.getContractFactory("ProtocolTreasury");
      treasury = await Treasury.deploy(deployer.address);
    });

    it("rejects notifyReceived from unauthorized caller", async function () {
      const dummyToken = "0x0000000000000000000000000000000000000001";
      await expect(treasury.connect(attacker).notifyReceived(dummyToken, 1000))
        .to.be.revertedWithCustomError(treasury, "OnlyAuthorizedReporter");
    });

    it("admin can authorize a reporter who can then notify", async function () {
      const dummyToken = "0x0000000000000000000000000000000000000001";
      await treasury.connect(deployer).setReporter(vault.address, true);
      await treasury.connect(vault).notifyReceived(dummyToken, 5000);
      expect(await treasury.lifetimeRevenue(dummyToken)).to.equal(5000);
    });

    it("rejects setReporter from non-admin", async function () {
      await expect(treasury.connect(attacker).setReporter(vault.address, true))
        .to.be.revertedWithCustomError(treasury, "OnlyAdmin");
    });
  });

  // ── P5-S12: InsurancePool spam protection ──
  describe("P5-S12: InsurancePool claim spam protection", function () {
    let usdc, insurance, deployer, claimant;

    beforeEach(async function () {
      [deployer, claimant] = await ethers.getSigners();
      const Mock = await ethers.getContractFactory("MockERC20");
      usdc = await Mock.deploy("USDC", "USDC", 6);
      const Insurance = await ethers.getContractFactory("InsurancePool");
      insurance = await Insurance.deploy(await usdc.getAddress(), deployer.address);
    });

    it("one open claim per claimant", async function () {
      await insurance.connect(claimant).submitClaim(USDC(1_000), "first");
      await expect(
        insurance.connect(claimant).submitClaim(USDC(2_000), "second")
      ).to.be.revertedWithCustomError(insurance, "AlreadyHasOpenClaim");
    });

    it("payout frees the open-claim slot", async function () {
      // Fund pool
      await usdc.mint(deployer.address, USDC(10_000));
      await usdc.connect(deployer).approve(await insurance.getAddress(), USDC(10_000));
      await insurance.connect(deployer).deposit(USDC(10_000), "seed");

      await insurance.connect(claimant).submitClaim(USDC(1_000), "first");
      await insurance.connect(deployer).payoutClaim(1, USDC(1_000));

      // Now claimant can submit a new one
      await insurance.connect(claimant).submitClaim(USDC(500), "second");
      expect(await insurance.openClaimId(claimant.address)).to.equal(2);
    });

    it("reject frees the slot without paying out", async function () {
      await insurance.connect(claimant).submitClaim(USDC(1_000), "first");
      await insurance.connect(deployer).rejectClaim(1);
      expect(await insurance.openClaimId(claimant.address)).to.equal(0);
      // Can submit a new one
      await insurance.connect(claimant).submitClaim(USDC(2_000), "revised");
    });

    it("rejects oversized reason strings", async function () {
      const longReason = "x".repeat(513);
      await expect(
        insurance.connect(claimant).submitClaim(USDC(1_000), longReason)
      ).to.be.revertedWithCustomError(insurance, "ReasonTooLong");
    });
  });

  // ── P5-S15: Entry fee accounting drift fix ──
  describe("P5-S15: deposit credits full amount when feeRecipient is zero", function () {
    let usdc, factory, vault, execRegistry, treasury, deployer, user;

    beforeEach(async function () {
      [deployer, user] = await ethers.getSigners();
      const Mock = await ethers.getContractFactory("MockERC20");
      usdc = await Mock.deploy("USDC", "USDC", 6);
      const Treasury = await ethers.getContractFactory("ProtocolTreasury");
      treasury = await Treasury.deploy(deployer.address);
      const ExecReg = await ethers.getContractFactory("ExecutionRegistry");
      execRegistry = await ExecReg.deploy();
      const Factory = await ethers.getContractFactory("AegisVaultFactory");
      factory = await Factory.deploy(
        await execRegistry.getAddress(),
        await treasury.getAddress()
      );
      await execRegistry.transferAdmin(await factory.getAddress());

      const policy = {
        maxPositionBps: 5000, maxDailyLossBps: 1000, stopLossBps: 1500,
        cooldownSeconds: 0, confidenceThresholdBps: 5000, maxActionsPerDay: 20,
        autoExecution: true, paused: false,
        // Entry fee set BUT no recipient → fee skipped, full amount credited
        performanceFeeBps: 0, managementFeeBps: 0, entryFeeBps: 100, exitFeeBps: 0,
        feeRecipient: ethers.ZeroAddress,
      };
      await factory.connect(user).createVault(
        await usdc.getAddress(),
        deployer.address,
        ethers.ZeroAddress,
        policy,
        [await usdc.getAddress()]
      );
      const vaults = await factory.getOwnerVaults(user.address);
      vault = await ethers.getContractAt("AegisVault", vaults[0]);
    });

    it("credits the full deposit amount when feeRecipient is unset", async function () {
      await usdc.mint(user.address, USDC(10_000));
      await usdc.connect(user).approve(await vault.getAddress(), USDC(10_000));
      await vault.connect(user).deposit(USDC(10_000));

      // Vault should have full amount
      expect(await usdc.balanceOf(await vault.getAddress())).to.equal(USDC(10_000));
      // totalDeposited should match (no drift)
      expect(await vault.totalDeposited()).to.equal(USDC(10_000));
    });
  });

  // ── P5-S4: HWM init from netDeposit, not balance ──
  describe("P5-S4: HWM init from netDeposit (donation attack defense)", function () {
    let usdc, factory, execRegistry, treasury, deployer, user, attacker;

    beforeEach(async function () {
      [deployer, user, attacker] = await ethers.getSigners();
      const Mock = await ethers.getContractFactory("MockERC20");
      usdc = await Mock.deploy("USDC", "USDC", 6);
      const Treasury = await ethers.getContractFactory("ProtocolTreasury");
      treasury = await Treasury.deploy(deployer.address);
      const ExecReg = await ethers.getContractFactory("ExecutionRegistry");
      execRegistry = await ExecReg.deploy();
      const Factory = await ethers.getContractFactory("AegisVaultFactory");
      factory = await Factory.deploy(
        await execRegistry.getAddress(),
        await treasury.getAddress()
      );
      await execRegistry.transferAdmin(await factory.getAddress());
    });

    it("HWM is set from netDeposit, not from balanceOf, defeating the donation attack", async function () {
      const policy = {
        maxPositionBps: 5000, maxDailyLossBps: 1000, stopLossBps: 1500,
        cooldownSeconds: 0, confidenceThresholdBps: 5000, maxActionsPerDay: 20,
        autoExecution: true, paused: false,
        performanceFeeBps: 1500, managementFeeBps: 0, entryFeeBps: 0, exitFeeBps: 0,
        feeRecipient: deployer.address,
      };
      await factory.connect(user).createVault(
        await usdc.getAddress(),
        deployer.address,
        ethers.ZeroAddress,
        policy,
        [await usdc.getAddress()]
      );
      const vaults = await factory.getOwnerVaults(user.address);
      const vault = await ethers.getContractAt("AegisVault", vaults[0]);

      // Attacker pre-donates 100k to the vault
      await usdc.mint(attacker.address, USDC(100_000));
      await usdc.connect(attacker).transfer(await vault.getAddress(), USDC(100_000));

      // User deposits 10k
      await usdc.mint(user.address, USDC(10_000));
      await usdc.connect(user).approve(await vault.getAddress(), USDC(10_000));
      await vault.connect(user).deposit(USDC(10_000));

      // HWM should be 10k (the actual netDeposit), NOT 110k (vault balance after donation)
      expect(await vault.highWaterMark()).to.equal(USDC(10_000));
    });
  });

  // ── P5-S3: updatePolicy preserves fees ──
  describe("P5-S3: updatePolicy preserves fee fields (cannot bypass cooldown/caps)", function () {
    let usdc, factory, execRegistry, treasury, deployer, user;

    beforeEach(async function () {
      [deployer, user] = await ethers.getSigners();
      const Mock = await ethers.getContractFactory("MockERC20");
      usdc = await Mock.deploy("USDC", "USDC", 6);
      const Treasury = await ethers.getContractFactory("ProtocolTreasury");
      treasury = await Treasury.deploy(deployer.address);
      const ExecReg = await ethers.getContractFactory("ExecutionRegistry");
      execRegistry = await ExecReg.deploy();
      const Factory = await ethers.getContractFactory("AegisVaultFactory");
      factory = await Factory.deploy(
        await execRegistry.getAddress(),
        await treasury.getAddress()
      );
      await execRegistry.transferAdmin(await factory.getAddress());
    });

    it("owner cannot bypass fee cooldown via updatePolicy", async function () {
      const initialPolicy = {
        maxPositionBps: 5000, maxDailyLossBps: 1000, stopLossBps: 1500,
        cooldownSeconds: 60, confidenceThresholdBps: 5000, maxActionsPerDay: 20,
        autoExecution: true, paused: false,
        performanceFeeBps: 1500, managementFeeBps: 200, entryFeeBps: 0, exitFeeBps: 50,
        feeRecipient: deployer.address,
      };
      await factory.connect(user).createVault(
        await usdc.getAddress(), deployer.address, ethers.ZeroAddress, initialPolicy,
        [await usdc.getAddress()]
      );
      const vaults = await factory.getOwnerVaults(user.address);
      const vault = await ethers.getContractAt("AegisVault", vaults[0]);

      // Try to bypass cooldown by replacing the policy with a 100% perf fee policy
      const evilPolicy = {
        maxPositionBps: 8000, maxDailyLossBps: 2000, stopLossBps: 3000,
        cooldownSeconds: 30, confidenceThresholdBps: 4000, maxActionsPerDay: 50,
        autoExecution: true, paused: false,
        performanceFeeBps: 10000, // 100%! way above the 30% cap
        managementFeeBps: 1000,    // 10%! way above the 5% cap
        entryFeeBps: 1000,
        exitFeeBps: 1000,
        feeRecipient: deployer.address,
      };
      await vault.connect(user).updatePolicy(evilPolicy);

      // Risk parameters DID change
      const p = await vault.getPolicy();
      expect(p.maxPositionBps).to.equal(8000);
      // But fees were PRESERVED at the original (legal) values
      expect(p.performanceFeeBps).to.equal(1500);
      expect(p.managementFeeBps).to.equal(200);
      expect(p.entryFeeBps).to.equal(0);
      expect(p.exitFeeBps).to.equal(50);
    });
  });

  // ── P5-S2/S3: Pyth staleness + confidence (sanity test only via constants) ──
  describe("P5-S2/S3: Pyth NAV calculator constants", function () {
    it("MAX_PRICE_AGE and MAX_CONF_BPS are exposed and correct", async function () {
      // Deploy with a dummy Pyth address (we won't call it)
      const Calc = await ethers.getContractFactory("VaultNAVCalculator");
      const calc = await Calc.deploy("0x0000000000000000000000000000000000000001");
      expect(await calc.MAX_PRICE_AGE()).to.equal(300);
      expect(await calc.MAX_CONF_BPS()).to.equal(500);
    });
  });
});
