const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AegisGovernor (Phase 4)", function () {
  let governor, target;
  let owner1, owner2, owner3, outsider, recipient;

  beforeEach(async function () {
    [owner1, owner2, owner3, outsider, recipient] = await ethers.getSigners();

    const Governor = await ethers.getContractFactory("AegisGovernor");
    governor = await Governor.deploy(
      [owner1.address, owner2.address, owner3.address],
      2 // 2-of-3 threshold
    );
    await governor.waitForDeployment();

    // A trivial target (use the governor itself as a no-op target where applicable)
    // For demonstration, deploy a MockERC20 to be a target
    const Mock = await ethers.getContractFactory("MockERC20");
    target = await Mock.deploy("TEST", "TST", 6);
    await target.waitForDeployment();
  });

  describe("Construction", function () {
    it("should set owners and threshold correctly", async function () {
      expect(await governor.threshold()).to.equal(2);
      expect(await governor.ownerCount()).to.equal(3);
      expect(await governor.isOwner(owner1.address)).to.be.true;
      expect(await governor.isOwner(outsider.address)).to.be.false;
    });

    it("should reject zero threshold", async function () {
      const Governor = await ethers.getContractFactory("AegisGovernor");
      await expect(Governor.deploy([owner1.address], 0))
        .to.be.revertedWithCustomError(Governor, "InvalidThreshold");
    });

    it("should reject duplicate owners", async function () {
      const Governor = await ethers.getContractFactory("AegisGovernor");
      await expect(Governor.deploy([owner1.address, owner1.address], 1))
        .to.be.revertedWithCustomError(Governor, "InvalidOwner");
    });
  });

  describe("Proposal lifecycle", function () {
    let proposalData;

    beforeEach(async function () {
      // Build calldata for target.mint(outsider, 1000)
      proposalData = target.interface.encodeFunctionData("mint", [outsider.address, 1000]);
    });

    it("should submit a proposal and auto-confirm by proposer", async function () {
      await expect(
        governor.connect(owner1).submit(await target.getAddress(), 0, proposalData, "Mint 1000")
      )
        .to.emit(governor, "ProposalSubmitted")
        .and.to.emit(governor, "ProposalConfirmed");

      const p = await governor.getProposal(0);
      expect(p.proposer).to.equal(owner1.address);
      expect(p.confirmations).to.equal(1);
      expect(p.executed).to.be.false;
    });

    it("should reject submit from non-owner", async function () {
      await expect(
        governor.connect(outsider).submit(await target.getAddress(), 0, proposalData, "x")
      ).to.be.revertedWithCustomError(governor, "NotOwner");
    });

    it("should reject double confirmation", async function () {
      await governor.connect(owner1).submit(await target.getAddress(), 0, proposalData, "x");
      await expect(governor.connect(owner1).confirm(0))
        .to.be.revertedWithCustomError(governor, "AlreadyConfirmed");
    });

    it("should let second owner confirm and reach threshold", async function () {
      await governor.connect(owner1).submit(await target.getAddress(), 0, proposalData, "x");
      await governor.connect(owner2).confirm(0);
      const p = await governor.getProposal(0);
      expect(p.confirmations).to.equal(2);
    });

    it("should execute proposal once threshold reached", async function () {
      await governor.connect(owner1).submit(await target.getAddress(), 0, proposalData, "Mint to outsider");
      await governor.connect(owner2).confirm(0);

      const before = await target.balanceOf(outsider.address);
      await expect(governor.connect(owner3).execute(0))
        .to.emit(governor, "ProposalExecuted");
      const after = await target.balanceOf(outsider.address);
      expect(after - before).to.equal(1000n);

      const p = await governor.getProposal(0);
      expect(p.executed).to.be.true;
    });

    it("should reject execute below threshold", async function () {
      await governor.connect(owner1).submit(await target.getAddress(), 0, proposalData, "x");
      await expect(governor.connect(owner2).execute(0))
        .to.be.revertedWithCustomError(governor, "NotEnoughConfirmations");
    });

    it("should reject re-execution", async function () {
      await governor.connect(owner1).submit(await target.getAddress(), 0, proposalData, "x");
      await governor.connect(owner2).confirm(0);
      await governor.connect(owner1).execute(0);
      await expect(governor.connect(owner1).execute(0))
        .to.be.revertedWithCustomError(governor, "AlreadyExecuted");
    });

    it("should let owner revoke their confirmation", async function () {
      await governor.connect(owner1).submit(await target.getAddress(), 0, proposalData, "x");
      await governor.connect(owner2).confirm(0);
      await governor.connect(owner2).revokeConfirmation(0);
      const p = await governor.getProposal(0);
      expect(p.confirmations).to.equal(1);
    });

    it("should let proposer cancel their own proposal but reject other owners", async function () {
      // P5-S6: Only the proposer can cancel. Other owners must use a counter-proposal
      // (submit + reach threshold) to override.
      await governor.connect(owner1).submit(await target.getAddress(), 0, proposalData, "x");
      // Non-proposer owner cannot cancel
      await expect(governor.connect(owner2).cancel(0))
        .to.be.revertedWithCustomError(governor, "NotProposer");
      // Proposer can cancel
      await governor.connect(owner1).cancel(0);
      const p = await governor.getProposal(0);
      expect(p.canceled).to.be.true;
      // Cannot execute canceled
      await expect(governor.connect(owner2).execute(0))
        .to.be.revertedWithCustomError(governor, "AlreadyCanceled");
    });
  });

  describe("Owner management via self-call", function () {
    it("should add an owner via executed proposal", async function () {
      const addData = governor.interface.encodeFunctionData("addOwner", [outsider.address]);
      await governor.connect(owner1).submit(await governor.getAddress(), 0, addData, "Add outsider as owner");
      await governor.connect(owner2).confirm(0);
      await governor.connect(owner1).execute(0);
      expect(await governor.isOwner(outsider.address)).to.be.true;
      expect(await governor.ownerCount()).to.equal(4);
    });

    it("should remove an owner via executed proposal", async function () {
      const removeData = governor.interface.encodeFunctionData("removeOwner", [owner3.address]);
      await governor.connect(owner1).submit(await governor.getAddress(), 0, removeData, "Remove owner3");
      await governor.connect(owner2).confirm(0);
      await governor.connect(owner1).execute(0);
      expect(await governor.isOwner(owner3.address)).to.be.false;
      expect(await governor.ownerCount()).to.equal(2);
    });

    it("should change threshold via executed proposal", async function () {
      const changeData = governor.interface.encodeFunctionData("changeThreshold", [3]);
      await governor.connect(owner1).submit(await governor.getAddress(), 0, changeData, "Raise to 3-of-3");
      await governor.connect(owner2).confirm(0);
      await governor.connect(owner1).execute(0);
      expect(await governor.threshold()).to.equal(3);
    });

    it("should reject direct addOwner call from owner (must go through proposal)", async function () {
      await expect(governor.connect(owner1).addOwner(outsider.address))
        .to.be.revertedWithCustomError(governor, "NotGovernor");
    });
  });

  describe("Slashing arbitration via governor", function () {
    let staking, registry, insurance, usdc, slashableOp;

    beforeEach(async function () {
      const Mock = await ethers.getContractFactory("MockERC20");
      usdc = await Mock.deploy("USD Coin", "USDC", 6);
      await usdc.waitForDeployment();

      const Registry = await ethers.getContractFactory("OperatorRegistry");
      registry = await Registry.deploy();
      await registry.waitForDeployment();

      const Insurance = await ethers.getContractFactory("InsurancePool");
      insurance = await Insurance.deploy(await usdc.getAddress(), await governor.getAddress());
      await insurance.waitForDeployment();

      // Deploy staking with the governor as arbitrator
      const Staking = await ethers.getContractFactory("OperatorStaking");
      staking = await Staking.deploy(
        await usdc.getAddress(),
        await registry.getAddress(),
        await insurance.getAddress(),
        await governor.getAddress() // governor IS the arbitrator
      );
      await staking.waitForDeployment();

      // Setup an operator with stake
      slashableOp = recipient;
      const input = {
        name: "Bot", description: "x", endpoint: "", mandate: 1,
        performanceFeeBps: 1000, managementFeeBps: 200, entryFeeBps: 0, exitFeeBps: 50,
        recommendedMaxPositionBps: 5000, recommendedConfidenceMinBps: 6000,
        recommendedStopLossBps: 1500, recommendedCooldownSeconds: 900, recommendedMaxActionsPerDay: 6,
      };
      await registry.connect(slashableOp).register(input);
      await usdc.mint(slashableOp.address, ethers.parseUnits("100000", 6));
      await usdc.connect(slashableOp).approve(await staking.getAddress(), ethers.parseUnits("100000", 6));
      await staking.connect(slashableOp).stake(ethers.parseUnits("100000", 6));
    });

    it("should slash via 2-of-3 governance proposal", async function () {
      const slashData = staking.interface.encodeFunctionData("slash", [
        slashableOp.address,
        ethers.parseUnits("20000", 6),
        "policy_violation_arbitration_42",
      ]);
      await governor.connect(owner1).submit(await staking.getAddress(), 0, slashData, "Slash slashableOp 20k for violation #42");
      await governor.connect(owner2).confirm(0);
      await governor.connect(owner1).execute(0);

      const s = await staking.getStake(slashableOp.address);
      expect(s.amount).to.equal(ethers.parseUnits("80000", 6));
      expect(await usdc.balanceOf(await insurance.getAddress())).to.equal(ethers.parseUnits("20000", 6));
    });

    it("should freeze + slash + payout via three governance proposals", async function () {
      // Proposal A: freeze
      const freezeData = staking.interface.encodeFunctionData("freeze", [slashableOp.address]);
      await governor.connect(owner1).submit(await staking.getAddress(), 0, freezeData, "Freeze pending arbitration");
      await governor.connect(owner2).confirm(0);
      await governor.connect(owner1).execute(0);

      const sFrozen = await staking.getStake(slashableOp.address);
      expect(sFrozen.frozen).to.be.true;

      // Proposal B: slash
      const slashData = staking.interface.encodeFunctionData("slash", [
        slashableOp.address,
        ethers.parseUnits("30000", 6),
        "violation_42",
      ]);
      await governor.connect(owner1).submit(await staking.getAddress(), 0, slashData, "Slash 30k");
      await governor.connect(owner2).confirm(1);
      await governor.connect(owner1).execute(1);

      expect(await usdc.balanceOf(await insurance.getAddress())).to.equal(ethers.parseUnits("30000", 6));

      // Proposal C: payout from insurance pool
      // First a claimant submits a claim
      await insurance.connect(outsider).submitClaim(ethers.parseUnits("15000", 6), "lost funds");

      const payoutData = insurance.interface.encodeFunctionData("payoutClaim", [1, ethers.parseUnits("15000", 6)]);
      await governor.connect(owner1).submit(await insurance.getAddress(), 0, payoutData, "Pay claim #1");
      await governor.connect(owner2).confirm(2);
      const before = await usdc.balanceOf(outsider.address);
      await governor.connect(owner1).execute(2);
      const after = await usdc.balanceOf(outsider.address);
      expect(after - before).to.equal(ethers.parseUnits("15000", 6));
    });
  });
});
