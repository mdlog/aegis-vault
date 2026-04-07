const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * End-to-end test: full lifecycle of a vault under Phase 1-5 production stack.
 *
 * Flow:
 *   1. Deploy full stack
 *   2. User creates vault with operator-specified fees
 *   3. User deposits 50k USDC (0.5% entry fee)
 *   4. Operator stakes 10k USDC (Silver tier)
 *   5. Operator executes an intent via the vault
 *   6. Vault records reputation stats
 *   7. Fast-forward 1 year, accrue management fee
 *   8. Claim fees (80% operator, 20% treasury)
 *   9. Governance slashes the operator for misbehavior
 *  10. User submits insurance claim, governance pays out
 */
describe("End-to-End (Phase 5 full stack)", function () {
  it("should execute the full production lifecycle", async function () {
    const [deployer, user, operator, governorOwner2] = await ethers.getSigners();

    const USDC = (n) => ethers.parseUnits(n.toString(), 6);

    // ── 1. Deploy stack ──
    const Mock = await ethers.getContractFactory("MockERC20");
    const usdc = await Mock.deploy("USD Coin", "USDC", 6);
    const wbtc = await Mock.deploy("Wrapped BTC", "WBTC", 8);
    await usdc.waitForDeployment();
    await wbtc.waitForDeployment();

    const Dex = await ethers.getContractFactory("MockDEX");
    const dex = await Dex.deploy();
    await dex.waitForDeployment();
    await dex.setPairRate(
      await usdc.getAddress(), await wbtc.getAddress(),
      ethers.parseUnits("0.0000143", 18), 6, 8
    );
    await wbtc.mint(await dex.getAddress(), ethers.parseUnits("100", 8));
    await usdc.mint(await dex.getAddress(), USDC(1_000_000));

    const Treasury = await ethers.getContractFactory("ProtocolTreasury");
    const treasury = await Treasury.deploy(deployer.address);

    const ExecReg = await ethers.getContractFactory("ExecutionRegistry");
    const execRegistry = await ExecReg.deploy();

    const Factory = await ethers.getContractFactory("AegisVaultFactory");
    const factory = await Factory.deploy(
      await execRegistry.getAddress(),
      await treasury.getAddress()
    );
    await execRegistry.transferAdmin(await factory.getAddress());

    const OpReg = await ethers.getContractFactory("OperatorRegistry");
    const opRegistry = await OpReg.deploy();

    const Insurance = await ethers.getContractFactory("InsurancePool");
    const insurance = await Insurance.deploy(await usdc.getAddress(), deployer.address);

    const Staking = await ethers.getContractFactory("OperatorStaking");
    const staking = await Staking.deploy(
      await usdc.getAddress(),
      await opRegistry.getAddress(),
      await insurance.getAddress(),
      deployer.address
    );

    const Reputation = await ethers.getContractFactory("OperatorReputation");
    const reputation = await Reputation.deploy(deployer.address);

    // Authorize staking as a slash notifier on insurance pool BEFORE rotating arbitrator
    await insurance.setNotifier(await staking.getAddress(), true);

    // Governor: 2-of-2 multi-sig
    const Governor = await ethers.getContractFactory("AegisGovernor");
    const governor = await Governor.deploy([deployer.address, governorOwner2.address], 2);

    // Transfer admin roles to governor
    await staking.setArbitrator(await governor.getAddress());
    await insurance.setArbitrator(await governor.getAddress());
    await reputation.transferAdmin(await governor.getAddress());
    await treasury.transferAdmin(await governor.getAddress());

    // ── 2. Operator registers with 15% perf fee, 2% mgmt fee ──
    const opInput = {
      name: "Alpha Bot",
      description: "momentum trading",
      endpoint: "",
      mandate: 1, // Balanced
      performanceFeeBps: 1500,
      managementFeeBps: 200,
      entryFeeBps: 50,   // 0.5%
      exitFeeBps: 50,    // 0.5%
      recommendedMaxPositionBps: 5000,
      recommendedConfidenceMinBps: 6000,
      recommendedStopLossBps: 1500,
      recommendedCooldownSeconds: 0,
      recommendedMaxActionsPerDay: 20,
    };
    await opRegistry.connect(operator).register(opInput);

    // ── 3. User creates vault with fees ──
    const policy = {
      maxPositionBps: 5000, maxDailyLossBps: 1000, stopLossBps: 1500,
      cooldownSeconds: 0, confidenceThresholdBps: 5000, maxActionsPerDay: 20,
      autoExecution: true, paused: false,
      performanceFeeBps: 1500, managementFeeBps: 200, entryFeeBps: 50, exitFeeBps: 50,
      feeRecipient: operator.address,
    };
    await factory.connect(user).createVault(
      await usdc.getAddress(),
      operator.address,
      await dex.getAddress(),
      policy,
      [await usdc.getAddress(), await wbtc.getAddress()]
    );
    const vaults = await factory.getOwnerVaults(user.address);
    const vault = await ethers.getContractAt("AegisVault", vaults[0]);

    // Wire reputation recording
    await vault.connect(user).setReputationRecorder(await reputation.getAddress());

    // Governance authorizes the vault as a reputation recorder
    // (in a real multi-sig this would be a proposal, but deployer is also owner)
    // Since admin is now governor, submit + confirm proposal
    const setRecorderData = reputation.interface.encodeFunctionData("setRecorder", [
      await vault.getAddress(), true,
    ]);
    await governor.connect(deployer).submit(
      await reputation.getAddress(), 0, setRecorderData,
      "Authorize demo vault as reputation recorder"
    );
    await governor.connect(governorOwner2).confirm(0);
    await governor.connect(deployer).execute(0);

    expect(await reputation.authorizedRecorders(await vault.getAddress())).to.be.true;

    // ── 4. User deposits 50k USDC (entry fee = 0.5% = 250 USDC → operator immediately) ──
    await usdc.mint(user.address, USDC(50_000));
    await usdc.connect(user).approve(await vault.getAddress(), USDC(50_000));
    await vault.connect(user).deposit(USDC(50_000));

    // Entry fee charged: 80% to operator, 20% to treasury
    // 250 * 0.8 = 200, 250 * 0.2 = 50
    expect(await usdc.balanceOf(operator.address)).to.equal(USDC(200));
    expect(await usdc.balanceOf(await treasury.getAddress())).to.equal(USDC(50));

    // Net deposit = 50k - 250 = 49,750 USDC
    const vaultBalance = await usdc.balanceOf(await vault.getAddress());
    expect(vaultBalance).to.equal(USDC(49_750));

    // ── 5. Operator stakes 10k USDC → Silver tier ──
    await usdc.mint(operator.address, USDC(10_000));
    await usdc.connect(operator).approve(await staking.getAddress(), USDC(10_000));
    await staking.connect(operator).stake(USDC(10_000));
    expect(await staking.tierOf(operator.address)).to.equal(2); // Silver

    // ── 6. Operator executes an intent ──
    async function buildIntent(amountIn) {
      const now = (await ethers.provider.getBlock("latest")).timestamp;
      const base = {
        vault: await vault.getAddress(),
        assetIn: await usdc.getAddress(),
        assetOut: await wbtc.getAddress(),
        amountIn: USDC(amountIn),
        minAmountOut: 1n,
        createdAt: now - 10,
        expiresAt: now + 300,
        confidenceBps: 8000,
        riskScoreBps: 2800,
        reasonSummary: "demo",
      };
      base.intentHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "address", "address", "uint256", "uint256", "uint256", "uint256", "uint256", "uint256"],
          [base.vault, base.assetIn, base.assetOut, base.amountIn, base.minAmountOut, base.createdAt, base.expiresAt, base.confidenceBps, base.riskScoreBps]
        )
      );
      return base;
    }

    const intent = await buildIntent(5_000);
    await vault.connect(operator).executeIntent(intent);

    // Reputation should have 1 successful execution
    const repStats = await reputation.getStats(operator.address);
    expect(repStats.totalExecutions).to.equal(1);
    expect(repStats.successfulExecutions).to.equal(1);

    // ── 7. Fast-forward 1 year and accrue mgmt fee ──
    await ethers.provider.send("evm_increaseTime", [365 * 24 * 3600]);
    await ethers.provider.send("evm_mine");
    await vault.accrueFees();

    const accruedMgmt = await vault.accruedManagementFee();
    // Mgmt fee: 2% of NAV for 1 year. NAV ≈ 44,750 USDC base + WBTC worth ~5k
    // Since NAV uses base-only path (no navCalculator), NAV ≈ 44,750
    // Fee ≈ 44,750 * 0.02 = 895 USDC
    expect(accruedMgmt).to.be.greaterThan(0);
    expect(accruedMgmt).to.be.lessThan(USDC(1_000));

    // ── 8. Claim fees ──
    const opUsdcBefore = await usdc.balanceOf(operator.address);
    const treasuryBefore = await usdc.balanceOf(await treasury.getAddress());
    await vault.connect(operator).claimFees();
    const opUsdcAfter = await usdc.balanceOf(operator.address);
    const treasuryAfter = await usdc.balanceOf(await treasury.getAddress());

    const opGain = opUsdcAfter - opUsdcBefore;
    const treasuryGain = treasuryAfter - treasuryBefore;
    // Verify 80/20 split within 1 micro-USDC rounding tolerance per fee component
    const totalClaimed = opGain + treasuryGain;
    const expectedOp = (totalClaimed * 80n) / 100n;
    const expectedTreasury = totalClaimed - expectedOp;
    // Allow small rounding (fees accrue in two components: mgmt + perf, each split separately)
    const tolerance = 10n;
    expect(opGain >= expectedOp - tolerance && opGain <= expectedOp + tolerance).to.be.true;
    expect(treasuryGain >= expectedTreasury - tolerance && treasuryGain <= expectedTreasury + tolerance).to.be.true;

    // ── 9. Governance slashes operator for misbehavior ──
    const slashData = staking.interface.encodeFunctionData("slash", [
      operator.address, USDC(3_000), "performance_manipulation"
    ]);
    await governor.connect(deployer).submit(
      await staking.getAddress(), 0, slashData, "Slash Alpha Bot 3k for manipulation"
    );
    await governor.connect(governorOwner2).confirm(1);
    await governor.connect(deployer).execute(1);

    // Operator stake reduced from 10k → 7k (still Bronze tier since 1k-10k)
    const sAfter = await staking.getStake(operator.address);
    expect(sAfter.amount).to.equal(USDC(7_000));
    expect(await staking.tierOf(operator.address)).to.equal(1); // Demoted to Bronze
    expect(await usdc.balanceOf(await insurance.getAddress())).to.equal(USDC(3_000));

    // ── 10. User submits insurance claim, governance pays out ──
    await insurance.connect(user).submitClaim(USDC(2_000), "lost funds from manipulation");
    const payoutData = insurance.interface.encodeFunctionData("payoutClaim", [1, USDC(2_000)]);
    await governor.connect(deployer).submit(
      await insurance.getAddress(), 0, payoutData, "Pay user claim #1"
    );
    await governor.connect(governorOwner2).confirm(2);

    const userUsdcBefore = await usdc.balanceOf(user.address);
    await governor.connect(deployer).execute(2);
    const userUsdcAfter = await usdc.balanceOf(user.address);
    expect(userUsdcAfter - userUsdcBefore).to.equal(USDC(2_000));

    // Insurance pool retains 1k after payout
    expect(await usdc.balanceOf(await insurance.getAddress())).to.equal(USDC(1_000));
  });
});
