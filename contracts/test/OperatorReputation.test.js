const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("OperatorReputation (Phase 3)", function () {
  let reputation;
  let admin, recorder, operator, otherOperator, rater1, rater2;

  const USDC = (n) => ethers.parseUnits(n.toString(), 6);

  beforeEach(async function () {
    [admin, recorder, operator, otherOperator, rater1, rater2] = await ethers.getSigners();
    const Reputation = await ethers.getContractFactory("OperatorReputation");
    reputation = await Reputation.deploy(admin.address);
    await reputation.waitForDeployment();
  });

  describe("Recorder authorization", function () {
    it("should let admin authorize a recorder", async function () {
      await expect(reputation.connect(admin).setRecorder(recorder.address, true))
        .to.emit(reputation, "RecorderAuthorized")
        .withArgs(recorder.address, true);
      expect(await reputation.authorizedRecorders(recorder.address)).to.be.true;
    });

    it("should reject non-admin authorize attempts", async function () {
      await expect(reputation.connect(operator).setRecorder(recorder.address, true))
        .to.be.revertedWithCustomError(reputation, "NotAdmin");
    });

    it("should reject unauthorized recordExecution calls", async function () {
      await expect(
        reputation.connect(operator).recordExecution(operator.address, USDC(1000), 0, true)
      ).to.be.revertedWithCustomError(reputation, "NotAuthorized");
    });
  });

  describe("Recording executions", function () {
    beforeEach(async function () {
      await reputation.connect(admin).setRecorder(recorder.address, true);
    });

    it("should accumulate stats from authorized recorder", async function () {
      await reputation.connect(recorder).recordExecution(operator.address, USDC(5_000), USDC(50), true);
      await reputation.connect(recorder).recordExecution(operator.address, USDC(3_000), -USDC(20), true);
      await reputation.connect(recorder).recordExecution(operator.address, USDC(2_000), 0, false);

      const s = await reputation.getStats(operator.address);
      expect(s.totalExecutions).to.equal(3);
      expect(s.successfulExecutions).to.equal(2);
      expect(s.totalVolumeUsd6).to.equal(USDC(10_000));
      expect(s.cumulativePnlUsd6).to.equal(USDC(30));
      expect(s.firstExecutionAt).to.be.greaterThan(0);
      expect(s.lastExecutionAt).to.be.greaterThan(0);
    });

    it("should compute success rate in bps", async function () {
      await reputation.connect(recorder).recordExecution(operator.address, USDC(1000), 0, true);
      await reputation.connect(recorder).recordExecution(operator.address, USDC(1000), 0, true);
      await reputation.connect(recorder).recordExecution(operator.address, USDC(1000), 0, false);
      expect(await reputation.successRateBps(operator.address)).to.equal(6666); // 2/3 ≈ 66.66%
    });

    it("should return zero success rate for new operator", async function () {
      expect(await reputation.successRateBps(operator.address)).to.equal(0);
    });
  });

  describe("Ratings (Sybil-resistant)", function () {
    // P5-S10: Ratings now require eligibility from an authorized recorder.
    // Tests authorize the `recorder` signer as a recorder, then mark eligible
    // raters before submission. This mirrors how the vault would do it after
    // a successful executeIntent.
    beforeEach(async function () {
      await reputation.connect(admin).setRecorder(recorder.address, true);
    });

    it("should reject submitRating from non-eligible (Sybil) wallet", async function () {
      await expect(
        reputation.connect(rater1).submitRating(operator.address, 5, "spam")
      ).to.be.revertedWithCustomError(reputation, "NotEligibleToRate");
    });

    it("should reject markEligibleRater from non-authorized caller", async function () {
      await expect(
        reputation.connect(rater1).markEligibleRater(operator.address, rater1.address)
      ).to.be.revertedWithCustomError(reputation, "NotAuthorized");
    });

    it("should accept a 1-5 star rating with comment after eligibility", async function () {
      await reputation.connect(recorder).markEligibleRater(operator.address, rater1.address);
      await expect(
        reputation.connect(rater1).submitRating(operator.address, 5, "Excellent results")
      )
        .to.emit(reputation, "RatingSubmitted")
        .withArgs(operator.address, rater1.address, 5, "Excellent results");

      const s = await reputation.getStats(operator.address);
      expect(s.ratingCount).to.equal(1);
      expect(s.ratingSumScaled).to.equal(5);
    });

    it("should reject double rating from same wallet", async function () {
      await reputation.connect(recorder).markEligibleRater(operator.address, rater1.address);
      await reputation.connect(rater1).submitRating(operator.address, 4, "Good");
      await expect(
        reputation.connect(rater1).submitRating(operator.address, 5, "Try again")
      ).to.be.revertedWithCustomError(reputation, "AlreadyRated");
    });

    it("should reject ratings outside 1..5 range (eligibility checked first)", async function () {
      await reputation.connect(recorder).markEligibleRater(operator.address, rater1.address);
      await expect(reputation.connect(rater1).submitRating(operator.address, 0, "")).to.be.revertedWithCustomError(reputation, "InvalidRating");
      await expect(reputation.connect(rater1).submitRating(operator.address, 6, "")).to.be.revertedWithCustomError(reputation, "InvalidRating");
    });

    it("should reject comments longer than 256 chars", async function () {
      await reputation.connect(recorder).markEligibleRater(operator.address, rater1.address);
      const longComment = "x".repeat(257);
      await expect(
        reputation.connect(rater1).submitRating(operator.address, 5, longComment)
      ).to.be.revertedWithCustomError(reputation, "CommentTooLong");
    });

    it("should compute scaled average rating", async function () {
      await reputation.connect(recorder).markEligibleRater(operator.address, rater1.address);
      await reputation.connect(recorder).markEligibleRater(operator.address, rater2.address);
      await reputation.connect(rater1).submitRating(operator.address, 5, "");
      await reputation.connect(rater2).submitRating(operator.address, 4, "");
      // (5+4)/2 = 4.5 → scaled by 100 = 450
      expect(await reputation.averageRatingScaled(operator.address)).to.equal(450);
    });

    it("should let same rater rate different operators (per-operator eligibility)", async function () {
      await reputation.connect(recorder).markEligibleRater(operator.address, rater1.address);
      await reputation.connect(recorder).markEligibleRater(otherOperator.address, rater1.address);
      await reputation.connect(rater1).submitRating(operator.address, 5, "");
      await reputation.connect(rater1).submitRating(otherOperator.address, 3, "");
      const s1 = await reputation.getStats(operator.address);
      const s2 = await reputation.getStats(otherOperator.address);
      expect(s1.ratingCount).to.equal(1);
      expect(s2.ratingCount).to.equal(1);
    });
  });

  describe("Verified badge", function () {
    it("should let admin grant verified badge", async function () {
      await expect(reputation.connect(admin).setVerified(operator.address, true))
        .to.emit(reputation, "VerifiedBadgeChanged")
        .withArgs(operator.address, true);
      const s = await reputation.getStats(operator.address);
      expect(s.verified).to.be.true;
    });

    it("should let admin revoke verified badge", async function () {
      await reputation.connect(admin).setVerified(operator.address, true);
      await reputation.connect(admin).setVerified(operator.address, false);
      const s = await reputation.getStats(operator.address);
      expect(s.verified).to.be.false;
    });

    it("should reject non-admin verify attempts", async function () {
      await expect(reputation.connect(rater1).setVerified(operator.address, true))
        .to.be.revertedWithCustomError(reputation, "NotAdmin");
    });
  });

  describe("Admin transfer", function () {
    it("should transfer admin", async function () {
      await reputation.connect(admin).transferAdmin(rater1.address);
      expect(await reputation.admin()).to.equal(rater1.address);
      // Old admin can no longer act
      await expect(reputation.connect(admin).setRecorder(recorder.address, true))
        .to.be.revertedWithCustomError(reputation, "NotAdmin");
    });
  });
});
