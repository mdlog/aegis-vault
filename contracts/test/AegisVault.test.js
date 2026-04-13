/**
 * AegisVault.test.js — slim build + Track 2 sealed mode
 *
 * Key differences from the old test suite:
 *  - ExecLib, SealedLib, IOLib are external libraries that must be deployed
 *    and linked before AegisVault can be compiled/deployed.
 *  - AegisVaultFactory constructor takes 3 args: (implementation, registry, treasury)
 *  - executeIntent now takes TWO params: (intent, sig) — pass "0x" for non-sealed
 *  - ExecutionIntent.intentHash now includes attestationReportHash in the preimage
 *  - VaultPolicy has sealedMode (bool) and attestedSigner (address) fields
 *  - No getPolicy(), getAllowedAssets(), getVaultSummary(), pause(), unpause(),
 *    emergencyWithdraw(), updatePolicy(), updateAllowedAssets(), setExecutor(),
 *    getBalance(), totalDeposited(), dailyActionCount(), currentDailyLossBps(),
 *    cumulativePnl() — slim build removed them all
 *  - Revert reasons are short strings ("d", "w", "x", "v", "hash", etc.)
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, mine } = require("@nomicfoundation/hardhat-network-helpers");

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build an ExecutionIntent object.
 * attestationReportHash is included in the hash preimage (slim build).
 * Pass attestationReportHash as ethers.ZeroHash for non-sealed mode.
 */
async function buildIntent(overrides = {}) {
  const now = await time.latest();
  const base = {
    vault: ethers.ZeroAddress,       // must be overridden
    assetIn: ethers.ZeroAddress,     // must be overridden
    assetOut: ethers.ZeroAddress,    // must be overridden
    amountIn: ethers.parseUnits("5000", 6),
    minAmountOut: ethers.parseUnits("0.07", 8),
    createdAt: now,
    expiresAt: now + 300,
    confidenceBps: 8000,
    riskScoreBps: 2800,
    attestationReportHash: ethers.ZeroHash, // non-sealed default
    reasonSummary: "Momentum continuation",
    ...overrides,
  };

  // intentHash includes attestationReportHash (slim build change)
  base.intentHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      [
        "address", "address", "address",
        "uint256", "uint256",
        "uint256", "uint256",
        "uint256", "uint256",
        "bytes32",
      ],
      [
        base.vault, base.assetIn, base.assetOut,
        base.amountIn, base.minAmountOut,
        base.createdAt, base.expiresAt,
        base.confidenceBps, base.riskScoreBps,
        base.attestationReportHash,
      ]
    )
  );

  return base;
}

/**
 * Deploy ExecLib, SealedLib, IOLib, then link them into AegisVault.
 * Returns { execLib, sealedLib, ioLib, VaultFactory }.
 */
async function deployLibrariesAndVaultFactory() {
  const ExecLib   = await ethers.getContractFactory("ExecLib");
  const SealedLib = await ethers.getContractFactory("SealedLib");
  const IOLib     = await ethers.getContractFactory("IOLib");

  const execLib   = await ExecLib.deploy();
  const sealedLib = await SealedLib.deploy();
  const ioLib     = await IOLib.deploy();

  await execLib.waitForDeployment();
  await sealedLib.waitForDeployment();
  await ioLib.waitForDeployment();

  const AegisVaultFactory = await ethers.getContractFactory("AegisVault", {
    libraries: {
      ExecLib:   await execLib.getAddress(),
      SealedLib: await sealedLib.getAddress(),
      IOLib:     await ioLib.getAddress(),
    },
  });

  return { execLib, sealedLib, ioLib, AegisVaultFactory };
}

// ── Default policy (non-sealed) ──────────────────────────────────────────────

function defaultPolicy(overrides = {}) {
  return {
    maxPositionBps: 5000,
    maxDailyLossBps: 500,
    stopLossBps: 1500,
    cooldownSeconds: 900,
    confidenceThresholdBps: 6000,
    maxActionsPerDay: 6,
    autoExecution: true,
    paused: false,
    performanceFeeBps: 0,
    managementFeeBps: 0,
    entryFeeBps: 0,
    exitFeeBps: 0,
    feeRecipient: ethers.ZeroAddress,
    sealedMode: false,
    attestedSigner: ethers.ZeroAddress,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("AegisVault (slim build)", function () {
  let owner, executor, attacker, treasury;
  let usdc, btc, eth;
  let registry, factory, vault;
  let dex;

  beforeEach(async function () {
    [owner, executor, attacker, treasury] = await ethers.getSigners();

    // ── Mock tokens ──
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    usdc = await MockERC20.deploy("USD Coin", "USDC", 6);
    btc  = await MockERC20.deploy("Wrapped BTC",  "WBTC", 8);
    eth  = await MockERC20.deploy("Wrapped ETH",  "WETH", 18);

    // ── ExecutionRegistry ──
    const ExecutionRegistry = await ethers.getContractFactory("ExecutionRegistry");
    registry = await ExecutionRegistry.deploy();

    // ── Deploy libraries + linked AegisVault implementation ──
    const { AegisVaultFactory: AegisVaultImpl } = await deployLibrariesAndVaultFactory();
    const implementation = await AegisVaultImpl.deploy();
    await implementation.waitForDeployment();

    // ── Factory: 3 args (implementation, registry, treasury) ──
    const FactoryContract = await ethers.getContractFactory("AegisVaultFactory");
    factory = await FactoryContract.deploy(
      await implementation.getAddress(),
      await registry.getAddress(),
      treasury.address          // protocol treasury
    );
    await factory.waitForDeployment();

    // Transfer registry admin to factory so it can authorize vaults
    await registry.transferAdmin(await factory.getAddress());

    // ── MockDEX ──
    const MockDEX = await ethers.getContractFactory("MockDEX");
    dex = await MockDEX.deploy();
    await dex.waitForDeployment();

    await dex.setPairRate(
      await usdc.getAddress(), await btc.getAddress(),
      ethers.parseUnits("0.0000143", 18), 6, 8
    );
    await dex.setPairRate(
      await usdc.getAddress(), await eth.getAddress(),
      ethers.parseUnits("0.000455", 18), 6, 18
    );

    await btc.mint(await dex.getAddress(),  ethers.parseUnits("10", 8));
    await eth.mint(await dex.getAddress(),  ethers.parseUnits("1000", 18));
    await usdc.mint(await dex.getAddress(), ethers.parseUnits("500000", 6));

    // ── Create vault via factory ──
    const tx = await factory.createVault(
      await usdc.getAddress(),
      executor.address,
      await dex.getAddress(),
      defaultPolicy(),
      [await usdc.getAddress(), await btc.getAddress(), await eth.getAddress()]
    );
    await tx.wait();

    const vaultAddr = await factory.getVaultAt(0);
    // Attach with linked library ABI
    const { AegisVaultFactory: AegisVaultLinked } = await deployLibrariesAndVaultFactory();
    vault = AegisVaultLinked.attach(vaultAddr);

    // Mint + approve
    await usdc.mint(owner.address, ethers.parseUnits("100000", 6));
    await usdc.approve(await vault.getAddress(), ethers.parseUnits("100000", 6));
  });

  // ── Factory ───────────────────────────────────────────────────────────────

  describe("AegisVaultFactory", function () {
    it("deploys vault and registers it", async function () {
      expect(await factory.totalVaults()).to.equal(1);
      const vaults = await factory.getOwnerVaults(owner.address);
      expect(vaults.length).to.equal(1);
      expect(await factory.isVault(vaults[0])).to.be.true;
    });

    it("rejects zero base-asset", async function () {
      await expect(
        factory.createVault(
          ethers.ZeroAddress,
          executor.address,
          ethers.ZeroAddress,
          defaultPolicy(),
          []
        )
      ).to.be.revertedWithCustomError(factory, "ZeroAddress");
    });

    it("allows multiple vaults per owner", async function () {
      await factory.createVault(
        await usdc.getAddress(),
        executor.address,
        ethers.ZeroAddress,
        defaultPolicy(),
        [await usdc.getAddress()]
      );
      expect(await factory.totalVaults()).to.equal(2);
      const vaults = await factory.getOwnerVaults(owner.address);
      expect(vaults.length).to.equal(2);
    });
  });

  // ── Deposit ───────────────────────────────────────────────────────────────

  describe("Deposit", function () {
    it("accepts owner deposits", async function () {
      const amount = ethers.parseUnits("50000", 6);
      await vault.deposit(amount);
      expect(await usdc.balanceOf(await vault.getAddress())).to.equal(amount);
    });

    it("rejects zero deposit", async function () {
      // IOLib.doDeposit reverts with "0"
      await expect(vault.deposit(0)).to.be.revertedWith("0");
    });

    it("rejects non-owner deposit", async function () {
      // AegisVault.deposit reverts with "d" when msg.sender != owner
      await usdc.mint(attacker.address, ethers.parseUnits("1000", 6));
      await usdc.connect(attacker).approve(await vault.getAddress(), ethers.parseUnits("1000", 6));
      await expect(
        vault.connect(attacker).deposit(ethers.parseUnits("1000", 6))
      ).to.be.revertedWith("d");
    });
  });

  // ── Withdraw ──────────────────────────────────────────────────────────────

  describe("Withdraw", function () {
    beforeEach(async function () {
      await vault.deposit(ethers.parseUnits("50000", 6));
    });

    it("allows owner to withdraw", async function () {
      const before = await usdc.balanceOf(owner.address);
      await vault.withdraw(ethers.parseUnits("10000", 6));
      const after = await usdc.balanceOf(owner.address);
      expect(after - before).to.equal(ethers.parseUnits("10000", 6));
      expect(await usdc.balanceOf(await vault.getAddress())).to.equal(
        ethers.parseUnits("40000", 6)
      );
    });

    it("rejects non-owner withdraw", async function () {
      // AegisVault.withdraw reverts with "w" when msg.sender != owner
      await expect(
        vault.connect(attacker).withdraw(ethers.parseUnits("1000", 6))
      ).to.be.revertedWith("w");
    });

    it("rejects withdraw exceeding balance", async function () {
      // IOLib.doWithdraw reverts with "b"
      await expect(
        vault.withdraw(ethers.parseUnits("999999", 6))
      ).to.be.revertedWith("b");
    });

    it("rejects zero withdraw", async function () {
      // IOLib.doWithdraw reverts with "0"
      await expect(vault.withdraw(0)).to.be.revertedWith("0");
    });
  });

  // ── executeIntent (non-sealed) ────────────────────────────────────────────

  describe("executeIntent — non-sealed mode", function () {
    const DEPOSIT = ethers.parseUnits("50000", 6);

    beforeEach(async function () {
      await vault.deposit(DEPOSIT);
    });

    it("executes a valid intent", async function () {
      const intent = await buildIntent({
        vault: await vault.getAddress(),
        assetIn: await usdc.getAddress(),
        assetOut: await btc.getAddress(),
      });

      // executeIntent succeeds — events are emitted by ExecLib via DELEGATECALL
      // (not in vault ABI), so we verify via registry state instead
      const tx = await vault.connect(executor).executeIntent(intent, "0x");
      await tx.wait();

      expect(await registry.isSubmitted(intent.intentHash)).to.be.true;
      expect(await registry.isFinalized(intent.intentHash)).to.be.true;
    });

    it("blocks non-executor", async function () {
      const intent = await buildIntent({
        vault: await vault.getAddress(),
        assetIn: await usdc.getAddress(),
        assetOut: await btc.getAddress(),
      });
      // reverts with "x" (wrong executor or paused or autoExecution disabled)
      await expect(
        vault.connect(attacker).executeIntent(intent, "0x")
      ).to.be.revertedWith("x");
    });

    it("blocks wrong vault address in intent", async function () {
      const intent = await buildIntent({
        vault: ethers.Wallet.createRandom().address, // wrong vault
        assetIn: await usdc.getAddress(),
        assetOut: await btc.getAddress(),
      });
      // reverts with "v"
      await expect(
        vault.connect(executor).executeIntent(intent, "0x")
      ).to.be.revertedWith("v");
    });

    it("blocks expired intent", async function () {
      const intent = await buildIntent({
        vault: await vault.getAddress(),
        assetIn: await usdc.getAddress(),
        assetOut: await btc.getAddress(),
        expiresAt: (await time.latest()) - 1, // already expired
      });
      await expect(
        vault.connect(executor).executeIntent(intent, "0x")
      ).to.be.revertedWith("expired");
    });

    it("blocks low confidence", async function () {
      const intent = await buildIntent({
        vault: await vault.getAddress(),
        assetIn: await usdc.getAddress(),
        assetOut: await btc.getAddress(),
        confidenceBps: 4000, // below 6000 threshold
      });
      await expect(
        vault.connect(executor).executeIntent(intent, "0x")
      ).to.be.revertedWith("conf");
    });

    it("enforces cooldown between executions", async function () {
      const intent1 = await buildIntent({
        vault: await vault.getAddress(),
        assetIn: await usdc.getAddress(),
        assetOut: await btc.getAddress(),
      });
      await vault.connect(executor).executeIntent(intent1, "0x");

      // second intent immediately — should fail cooldown
      const intent2 = await buildIntent({
        vault: await vault.getAddress(),
        assetIn: await usdc.getAddress(),
        assetOut: await eth.getAddress(),
      });
      await expect(
        vault.connect(executor).executeIntent(intent2, "0x")
      ).to.be.revertedWith("cooldown");
    });

    it("allows execution after cooldown elapses", async function () {
      const intent1 = await buildIntent({
        vault: await vault.getAddress(),
        assetIn: await usdc.getAddress(),
        assetOut: await btc.getAddress(),
      });
      await vault.connect(executor).executeIntent(intent1, "0x");

      await time.increase(901); // past 900-second cooldown

      const intent2 = await buildIntent({
        vault: await vault.getAddress(),
        assetIn: await usdc.getAddress(),
        assetOut: await eth.getAddress(),
      });
      const tx = await vault.connect(executor).executeIntent(intent2, "0x");
      await tx.wait();

      expect(await registry.isSubmitted(intent2.intentHash)).to.be.true;
    });

    it("prevents replay via registry", async function () {
      const intent = await buildIntent({
        vault: await vault.getAddress(),
        assetIn: await usdc.getAddress(),
        assetOut: await btc.getAddress(),
        expiresAt: (await time.latest()) + 86400,
      });
      await vault.connect(executor).executeIntent(intent, "0x");

      await time.increase(901); // past cooldown

      await expect(
        vault.connect(executor).executeIntent(intent, "0x")
      ).to.be.revertedWithCustomError(registry, "IntentAlreadySubmitted");
    });

    it("executes swap and transfers tokens", async function () {
      const vaultAddr = await vault.getAddress();
      const usdcBefore = await usdc.balanceOf(vaultAddr);

      const intent = await buildIntent({
        vault: vaultAddr,
        assetIn: await usdc.getAddress(),
        assetOut: await btc.getAddress(),
        amountIn: ethers.parseUnits("5000", 6),
        minAmountOut: ethers.parseUnits("0.05", 8),
      });

      await vault.connect(executor).executeIntent(intent, "0x");

      const usdcAfter = await usdc.balanceOf(vaultAddr);
      expect(usdcBefore - usdcAfter).to.equal(ethers.parseUnits("5000", 6));
      expect(await btc.balanceOf(vaultAddr)).to.be.gt(0);
    });
  });

  // ── executeIntent (sealed mode) ───────────────────────────────────────────

  describe("executeIntent — sealed mode (Track 2)", function () {
    let sealedVault;
    let sealedWallet; // acts as the attested TEE signer

    beforeEach(async function () {
      // Create a fresh deterministic wallet as the TEE attestation key
      sealedWallet = ethers.Wallet.createRandom().connect(ethers.provider);

      const sealedPol = defaultPolicy({
        sealedMode: true,
        attestedSigner: sealedWallet.address,
        cooldownSeconds: 0,
      });

      const tx = await factory.createVault(
        await usdc.getAddress(),
        executor.address,
        await dex.getAddress(),
        sealedPol,
        [await usdc.getAddress(), await btc.getAddress()]
      );
      await tx.wait();

      const idx = (await factory.totalVaults()) - 1n;
      const addr = await factory.getVaultAt(idx);

      const { AegisVaultFactory: AegisVaultLinked } = await deployLibrariesAndVaultFactory();
      sealedVault = AegisVaultLinked.attach(addr);

      // Fund the sealed vault
      await usdc.mint(owner.address, ethers.parseUnits("50000", 6));
      await usdc.approve(addr, ethers.parseUnits("50000", 6));
      await sealedVault.deposit(ethers.parseUnits("50000", 6));
    });

    it("commits then executes a sealed intent", async function () {
      const vaultAddr = await sealedVault.getAddress();
      const reportHash = ethers.keccak256(ethers.toUtf8Bytes("attestation-report-abc"));

      const intent = await buildIntent({
        vault: vaultAddr,
        assetIn: await usdc.getAddress(),
        assetOut: await btc.getAddress(),
        amountIn: ethers.parseUnits("1000", 6),
        minAmountOut: ethers.parseUnits("0.01", 8),
        attestationReportHash: reportHash,
      });

      // commitHash = keccak256(intentHash, attestationReportHash)
      const commitHash = ethers.keccak256(
        ethers.solidityPacked(
          ["bytes32", "bytes32"],
          [intent.intentHash, reportHash]
        )
      );

      // Executor commits first
      await sealedVault.connect(executor).commitIntent(commitHash);

      // Advance one block (commit-reveal delay)
      await mine(1);

      // TEE signer signs the intentHash
      const ethSignedHash = ethers.keccak256(
        ethers.solidityPacked(
          ["string", "bytes32"],
          ["\x19Ethereum Signed Message:\n32", intent.intentHash]
        )
      );
      const sig = await sealedWallet.signMessage(ethers.getBytes(intent.intentHash));

      // Execute with valid sig — SealedIntentExecuted is emitted by AegisVault directly
      // (it's in executeIntent body, not in ExecLib), so we can check it on vault
      const tx = await sealedVault.connect(executor).executeIntent(intent, sig);
      await tx.wait();

      // Verify via registry that intent was processed
      expect(await registry.isFinalized(intent.intentHash)).to.be.true;
    });

    it("rejects sealed intent with wrong signer", async function () {
      const vaultAddr = await sealedVault.getAddress();
      const reportHash = ethers.keccak256(ethers.toUtf8Bytes("attestation-report-xyz"));

      const intent = await buildIntent({
        vault: vaultAddr,
        assetIn: await usdc.getAddress(),
        assetOut: await btc.getAddress(),
        amountIn: ethers.parseUnits("1000", 6),
        minAmountOut: ethers.parseUnits("0.01", 8),
        attestationReportHash: reportHash,
      });

      const commitHash = ethers.keccak256(
        ethers.solidityPacked(
          ["bytes32", "bytes32"],
          [intent.intentHash, reportHash]
        )
      );
      await sealedVault.connect(executor).commitIntent(commitHash);
      await mine(1);

      // Sign with wrong key
      const wrongSigner = ethers.Wallet.createRandom();
      const wrongSig = await wrongSigner.signMessage(ethers.getBytes(intent.intentHash));

      await expect(
        sealedVault.connect(executor).executeIntent(intent, wrongSig)
      ).to.be.revertedWithCustomError(
        { interface: new ethers.Interface(["error InvalidAttestationSignature()"]) },
        "InvalidAttestationSignature"
      );
    });

    it("rejects sealed intent without prior commit", async function () {
      const vaultAddr = await sealedVault.getAddress();
      const reportHash = ethers.keccak256(ethers.toUtf8Bytes("no-commit-report"));

      const intent = await buildIntent({
        vault: vaultAddr,
        assetIn: await usdc.getAddress(),
        assetOut: await btc.getAddress(),
        amountIn: ethers.parseUnits("1000", 6),
        minAmountOut: ethers.parseUnits("0.01", 8),
        attestationReportHash: reportHash,
      });

      const sig = await sealedWallet.signMessage(ethers.getBytes(intent.intentHash));

      // No commitIntent call — should revert at "cr"
      await expect(
        sealedVault.connect(executor).executeIntent(intent, sig)
      ).to.be.revertedWith("cr");
    });

    it("blocks commitIntent when not in sealed mode", async function () {
      const fakeHash = ethers.keccak256(ethers.toUtf8Bytes("test"));
      // `vault` is the non-sealed vault from the outer beforeEach
      await expect(
        vault.connect(executor).commitIntent(fakeHash)
      ).to.be.revertedWith("c");
    });

    it("blocks commitIntent by non-executor", async function () {
      const fakeHash = ethers.keccak256(ethers.toUtf8Bytes("test"));
      await expect(
        sealedVault.connect(attacker).commitIntent(fakeHash)
      ).to.be.revertedWith("c");
    });
  });

  // ── ExecutionRegistry ─────────────────────────────────────────────────────

  describe("ExecutionRegistry", function () {
    it("rejects unauthorized callers", async function () {
      const hash = ethers.keccak256(ethers.toUtf8Bytes("intent-unauth"));
      await expect(
        registry.registerIntent(hash, owner.address)
      ).to.be.revertedWithCustomError(registry, "NotAuthorizedVault");
    });

    it("tracks vault intents via authorized vault", async function () {
      await vault.deposit(ethers.parseUnits("50000", 6));
      const intent = await buildIntent({
        vault: await vault.getAddress(),
        assetIn: await usdc.getAddress(),
        assetOut: await btc.getAddress(),
      });
      await vault.connect(executor).executeIntent(intent, "0x");

      expect(await registry.isSubmitted(intent.intentHash)).to.be.true;
      expect(await registry.isFinalized(intent.intentHash)).to.be.true;
      expect(await registry.getVaultIntentCount(await vault.getAddress())).to.be.gte(1);
    });
  });

  // ── Deposit with entry fee ────────────────────────────────────────────────

  describe("Fees", function () {
    it("deducts entry fee on deposit", async function () {
      const feeVaultTx = await factory.createVault(
        await usdc.getAddress(),
        executor.address,
        await dex.getAddress(),
        defaultPolicy({ entryFeeBps: 100, feeRecipient: treasury.address }), // 1% fee
        [await usdc.getAddress()]
      );
      await feeVaultTx.wait();

      const idx = (await factory.totalVaults()) - 1n;
      const addr = await factory.getVaultAt(idx);
      const { AegisVaultFactory: AegisVaultLinked } = await deployLibrariesAndVaultFactory();
      const feeVault = AegisVaultLinked.attach(addr);

      const depositAmount = ethers.parseUnits("10000", 6);
      await usdc.mint(owner.address, depositAmount);
      await usdc.approve(addr, depositAmount);

      const treasuryBefore = await usdc.balanceOf(treasury.address);
      await feeVault.deposit(depositAmount);
      const treasuryAfter = await usdc.balanceOf(treasury.address);

      const fee = depositAmount * 100n / 10000n; // 1%
      expect(treasuryAfter - treasuryBefore).to.equal(fee);
      expect(await usdc.balanceOf(addr)).to.equal(depositAmount - fee);
    });

    it("deducts exit fee on withdraw", async function () {
      const feeVaultTx = await factory.createVault(
        await usdc.getAddress(),
        executor.address,
        await dex.getAddress(),
        defaultPolicy({ exitFeeBps: 50, feeRecipient: treasury.address }), // 0.5% fee
        [await usdc.getAddress()]
      );
      await feeVaultTx.wait();

      const idx = (await factory.totalVaults()) - 1n;
      const addr = await factory.getVaultAt(idx);
      const { AegisVaultFactory: AegisVaultLinked } = await deployLibrariesAndVaultFactory();
      const feeVault = AegisVaultLinked.attach(addr);

      const depositAmount = ethers.parseUnits("10000", 6);
      await usdc.mint(owner.address, depositAmount);
      await usdc.approve(addr, depositAmount);
      await feeVault.deposit(depositAmount);

      const treasuryBefore = await usdc.balanceOf(treasury.address);
      await feeVault.withdraw(depositAmount);
      const treasuryAfter = await usdc.balanceOf(treasury.address);

      const fee = depositAmount * 50n / 10000n;
      expect(treasuryAfter - treasuryBefore).to.equal(fee);
    });
  });
});
