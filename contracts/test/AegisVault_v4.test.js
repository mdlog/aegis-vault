/**
 * AegisVault_v4.test.js — coverage for the V4 strategy-binding additions.
 *
 *   V4 layers a strategy-manifest commitment onto the V3 surface:
 *     - `acceptedManifestHash` storage set at create time
 *     - `executeIntent(intent, sig)` rejects intents whose
 *        `intent.strategyHash` does not match the active commitment
 *     - `intent.strategySchemaVer > MAX_SUPPORTED_SCHEMA_VER` is rejected
 *     - manifest upgrade is a 24-hour timelocked two-step (request / apply)
 *     - cancel discards a pending upgrade
 *
 *   The cross-chain (Khalani) path is unchanged from V3 and intentionally
 *   not re-tested here; AegisVault_v3.test.js covers that surface end-to-end
 *   and V4's `acceptCrossChainFill` is bit-identical.
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");

const HARDHAT_CHAIN_ID = 31337;

// EIP-712 types for the V4 ExecutionIntent. MUST match
// ExecLibV4.EXECUTION_INTENT_TYPEHASH_V4 field-for-field.
const EXECUTION_INTENT_V4_TYPES = {
  ExecutionIntent: [
    { name: "vault",                 type: "address" },
    { name: "assetIn",               type: "address" },
    { name: "assetOut",              type: "address" },
    { name: "amountIn",              type: "uint256" },
    { name: "minAmountOut",          type: "uint256" },
    { name: "createdAt",             type: "uint256" },
    { name: "expiresAt",             type: "uint256" },
    { name: "confidenceBps",         type: "uint256" },
    { name: "riskScoreBps",          type: "uint256" },
    { name: "attestationReportHash", type: "bytes32" },
    { name: "strategyHash",          type: "bytes32" },
    { name: "strategySchemaVer",     type: "uint32"  },
  ],
};

function intentDomain(vaultAddress) {
  return {
    name: "AegisVault",
    version: "1",
    chainId: HARDHAT_CHAIN_ID,
    verifyingContract: vaultAddress,
  };
}

function v4Policy(attestedSigner, overrides = {}) {
  return {
    maxPositionBps: 5000,
    maxDailyLossBps: 500,
    stopLossBps: 1500,
    cooldownSeconds: 0, // 0 so executeIntent isn't blocked by cooldown right after init
    confidenceThresholdBps: 6000,
    maxActionsPerDay: 10,
    autoExecution: true,
    paused: false,
    performanceFeeBps: 0,
    managementFeeBps: 0,
    entryFeeBps: 0,
    exitFeeBps: 0,
    feeRecipient: ethers.ZeroAddress,
    sealedMode: false,
    attestedSigner,
    ...overrides,
  };
}

// Build a V4 ExecutionIntent struct + the EIP-712 digest the orchestrator
// would sign. The struct passed back includes an `intentHash` field so it
// matches the on-chain Solidity layout expected by `executeIntent`.
async function buildV4Intent(vaultAddr, overrides = {}) {
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  const baseAssetAddr = overrides.assetIn || ethers.ZeroAddress;
  const fields = {
    vault: vaultAddr,
    assetIn: baseAssetAddr,
    assetOut: overrides.assetOut || ethers.ZeroAddress,
    amountIn: overrides.amountIn ?? 0n,
    minAmountOut: overrides.minAmountOut ?? 0n,
    createdAt: overrides.createdAt ?? now,
    expiresAt: overrides.expiresAt ?? now + 600,
    confidenceBps: overrides.confidenceBps ?? 8000,
    riskScoreBps: overrides.riskScoreBps ?? 2000,
    attestationReportHash: overrides.attestationReportHash ?? ethers.keccak256(ethers.toUtf8Bytes("attestation-v4")),
    strategyHash: overrides.strategyHash ?? ethers.keccak256(ethers.toUtf8Bytes("strategy-v1-default")),
    strategySchemaVer: overrides.strategySchemaVer ?? 1,
  };

  const digest = ethers.TypedDataEncoder.hash(
    intentDomain(vaultAddr),
    EXECUTION_INTENT_V4_TYPES,
    fields
  );

  // Solidity ExecutionIntentV4 struct includes intentHash + reasonSummary
  // tail fields not part of the EIP-712 type — append them now.
  const intent = {
    intentHash: digest,
    ...fields,
    reasonSummary: overrides.reasonSummary ?? "",
  };
  return { intent, digest };
}

async function signV4Intent(wallet, vaultAddr, intent) {
  // The signed payload only includes the typed fields, not intentHash /
  // reasonSummary (which are derived / free-form respectively).
  const typedFields = {
    vault: intent.vault,
    assetIn: intent.assetIn,
    assetOut: intent.assetOut,
    amountIn: intent.amountIn,
    minAmountOut: intent.minAmountOut,
    createdAt: intent.createdAt,
    expiresAt: intent.expiresAt,
    confidenceBps: intent.confidenceBps,
    riskScoreBps: intent.riskScoreBps,
    attestationReportHash: intent.attestationReportHash,
    strategyHash: intent.strategyHash,
    strategySchemaVer: intent.strategySchemaVer,
  };
  return await wallet.signTypedData(
    intentDomain(vaultAddr),
    EXECUTION_INTENT_V4_TYPES,
    typedFields
  );
}

// Deploy + link all libraries needed by AegisVault_v4 and return the linked
// implementation contract.
async function deployV4Impl() {
  const ExecLibV4       = await ethers.getContractFactory("ExecLibV4");
  const SealedLib       = await ethers.getContractFactory("SealedLib");
  const IOLib           = await ethers.getContractFactory("IOLib");
  const CrossChainLibV4 = await ethers.getContractFactory("CrossChainLibV4");

  const execLib   = await ExecLibV4.deploy();      await execLib.waitForDeployment();
  const sealedLib = await SealedLib.deploy();      await sealedLib.waitForDeployment();
  const ioLib     = await IOLib.deploy();          await ioLib.waitForDeployment();
  const ccLib     = await CrossChainLibV4.deploy(); await ccLib.waitForDeployment();

  const VaultV4 = await ethers.getContractFactory("AegisVault_v4", {
    libraries: {
      ExecLibV4:       await execLib.getAddress(),
      SealedLib:       await sealedLib.getAddress(),
      IOLib:           await ioLib.getAddress(),
      CrossChainLibV4: await ccLib.getAddress(),
    },
  });
  const impl = await VaultV4.deploy();
  await impl.waitForDeployment();
  return { impl, VaultV4 };
}

// Build a complete factory-driven setup: registry + factory + funded mocks
// + freshly created V4 vault. `acceptedManifestHash` parameterizes the
// vault's strategy commitment so per-test variations are easy to express.
async function setupV4({
  acceptedManifestHash = ethers.keccak256(ethers.toUtf8Bytes("strategy-v1-default")),
  policyOverrides = {},
  signerOverride,
} = {}) {
  const [admin, depositor, operator, treasury] = await ethers.getSigners();

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const usdc = await MockERC20.deploy("USDC", "USDC", 6);
  const wbtc = await MockERC20.deploy("WBTC", "WBTC", 8);

  const Registry = await ethers.getContractFactory("ExecutionRegistry");
  const registry = await Registry.deploy();
  await registry.waitForDeployment();

  const { impl, VaultV4 } = await deployV4Impl();

  const Factory = await ethers.getContractFactory("AegisVaultFactoryV4");
  const factory = await Factory.deploy(
    await impl.getAddress(),
    await registry.getAddress(),
    treasury.address
  );
  await factory.waitForDeployment();

  await registry.authorizeFactory(await factory.getAddress());

  // TEE attestation key — random per test for isolation. Caller can override
  // with a known wallet to test sig-recovery edge cases.
  const teeWallet = signerOverride
    ? signerOverride
    : ethers.Wallet.createRandom().connect(ethers.provider);

  const policy = v4Policy(teeWallet.address, policyOverrides);

  // depositor (msg.sender) becomes the vault owner; operator's wallet
  // becomes the executor — same role mapping as V3.
  const tx = await factory.connect(depositor).createVault(
    operator.address,
    await usdc.getAddress(),
    ethers.ZeroAddress, // venue: no on-chain swap exercised by these tests
    policy,
    [await usdc.getAddress(), await wbtc.getAddress()],
    50,
    acceptedManifestHash
  );
  const receipt = await tx.wait();

  const ev = receipt.logs
    .map((l) => { try { return factory.interface.parseLog(l); } catch { return null; } })
    .find((p) => p && p.name === "VaultDeployed");
  expect(ev, "VaultDeployed not emitted").to.not.equal(null);

  const vault = VaultV4.attach(ev.args.vault);

  return {
    admin, depositor, operator, treasury,
    usdc, wbtc, registry, factory, vault, teeWallet,
    deployTx: tx, deployReceipt: receipt, deployEvent: ev,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("AegisVault_v4", function () {
  describe("Factory createVault", function () {
    it("seals acceptedManifestHash at create time and exposes it via the public getter", async function () {
      const expectedHash = ethers.keccak256(ethers.toUtf8Bytes("trend-following-v1"));
      const { vault } = await setupV4({ acceptedManifestHash: expectedHash });
      expect(await vault.acceptedManifestHash()).to.equal(expectedHash);
      // Defaults: no pending upgrade in flight at create time.
      expect(await vault.pendingManifestHash()).to.equal(ethers.ZeroHash);
      expect(await vault.manifestUpgradeRequestedAt()).to.equal(0);
    });

    it("emits VaultDeployed with the 8-arg signature including acceptedManifestHash", async function () {
      const expectedHash = ethers.keccak256(ethers.toUtf8Bytes("mean-reversion-v1"));
      const { factory, vault, depositor, operator, usdc, deployEvent } =
        await setupV4({ acceptedManifestHash: expectedHash });

      // VaultDeployed must carry exactly 8 args, with the new manifest hash
      // as the trailing field (off-chain indexers depend on this layout).
      expect(deployEvent.args.length).to.equal(8);
      expect(deployEvent.args.vault).to.equal(await vault.getAddress());
      expect(deployEvent.args.owner).to.equal(depositor.address);
      expect(deployEvent.args.operator).to.equal(operator.address);
      expect(deployEvent.args.baseAsset).to.equal(await usdc.getAddress());
      expect(deployEvent.args.venue).to.equal(ethers.ZeroAddress);
      expect(deployEvent.args.requestedMaxCrossChainFeeBps).to.equal(50);
      expect(deployEvent.args.acceptedManifestHash).to.equal(expectedHash);

      // Factory-side mirror (off-chain consumers can read this without
      // touching the vault).
      expect(await factory.vaultManifestHash(await vault.getAddress()))
        .to.equal(expectedHash);
    });

    it("permits acceptedManifestHash == 0 (backwards-compat valve)", async function () {
      const { vault } = await setupV4({ acceptedManifestHash: ethers.ZeroHash });
      expect(await vault.acceptedManifestHash()).to.equal(ethers.ZeroHash);
    });

    it("reports v4 from the version() view (frontend / indexer routing key)", async function () {
      const { vault, factory } = await setupV4();
      expect(await vault.version()).to.equal("v4");
      expect(await factory.version()).to.equal("v4");
    });

    it("preserves the depositor → owner / operator → executor mapping", async function () {
      const { vault, depositor, operator } = await setupV4();
      expect(await vault.owner()).to.equal(depositor.address);
      expect(await vault.executor()).to.equal(operator.address);
    });
  });

  describe("executeIntent strategy binding", function () {
    it("rejects an intent whose strategyHash does not match acceptedManifestHash", async function () {
      const acceptedHash = ethers.keccak256(ethers.toUtf8Bytes("trend-following-v1"));
      const wrongHash    = ethers.keccak256(ethers.toUtf8Bytes("mean-reversion-v1"));

      const { vault, operator, teeWallet, usdc } = await setupV4({
        acceptedManifestHash: acceptedHash,
      });
      const vaultAddr = await vault.getAddress();

      const { intent } = await buildV4Intent(vaultAddr, {
        assetIn: await usdc.getAddress(),
        assetOut: await usdc.getAddress(),
        strategyHash: wrongHash,
      });
      const sig = await signV4Intent(teeWallet, vaultAddr, intent);

      await expect(
        vault.connect(operator).executeIntent(intent, sig)
      ).to.be.revertedWithCustomError(vault, "WrongStrategyHash");
    });

    it("rejects an intent whose strategySchemaVer exceeds MAX_SUPPORTED_SCHEMA_VER", async function () {
      const { vault, operator, teeWallet, usdc } = await setupV4();
      const vaultAddr = await vault.getAddress();

      const { intent } = await buildV4Intent(vaultAddr, {
        assetIn: await usdc.getAddress(),
        assetOut: await usdc.getAddress(),
        strategySchemaVer: 2, // > MAX_SUPPORTED_SCHEMA_VER (1)
      });
      const sig = await signV4Intent(teeWallet, vaultAddr, intent);

      await expect(
        vault.connect(operator).executeIntent(intent, sig)
      ).to.be.revertedWithCustomError(vault, "UnsupportedSchemaVersion");
    });

    it("schema version check runs BEFORE strategy hash check (forward-version intents are diagnosed distinctly)", async function () {
      // Sanity: a forward-version intent that ALSO has a wrong strategy hash
      // surfaces the schema error, not the hash error. Off-chain alerting
      // depends on this ordering to distinguish "operator on a future schema"
      // from "operator on a stale strategy".
      const { vault, operator, teeWallet, usdc } = await setupV4();
      const vaultAddr = await vault.getAddress();
      const { intent } = await buildV4Intent(vaultAddr, {
        assetIn: await usdc.getAddress(),
        assetOut: await usdc.getAddress(),
        strategyHash: ethers.keccak256(ethers.toUtf8Bytes("not-the-active-strategy")),
        strategySchemaVer: 99,
      });
      const sig = await signV4Intent(teeWallet, vaultAddr, intent);
      await expect(
        vault.connect(operator).executeIntent(intent, sig)
      ).to.be.revertedWithCustomError(vault, "UnsupportedSchemaVersion");
    });

    it("rejects strategySchemaVer == 0 (catches uninitialized field bug)", async function () {
      // The implementation enforces a [1, MAX_SUPPORTED_SCHEMA_VER] range so
      // a caller that forgot to set strategySchemaVer (default 0 in Solidity
      // calldata) is rejected with the same error as a forward-version one.
      const { vault, operator, teeWallet, usdc } = await setupV4();
      const vaultAddr = await vault.getAddress();
      const { intent } = await buildV4Intent(vaultAddr, {
        assetIn: await usdc.getAddress(),
        assetOut: await usdc.getAddress(),
        strategySchemaVer: 0,
      });
      const sig = await signV4Intent(teeWallet, vaultAddr, intent);
      await expect(
        vault.connect(operator).executeIntent(intent, sig)
      ).to.be.revertedWithCustomError(vault, "UnsupportedSchemaVersion");
    });

    it("strict equality: zero-hash strategyHash is rejected against a bound vault", async function () {
      // Defense-in-depth check: a non-zero acceptedManifestHash never matches
      // a default-constructed (all-zero) intent.strategyHash. Catches
      // orchestrator bugs where the strategy field gets dropped between
      // signing and submission.
      const acceptedHash = ethers.keccak256(ethers.toUtf8Bytes("strategy-bound"));
      const { vault, operator, teeWallet, usdc } = await setupV4({
        acceptedManifestHash: acceptedHash,
      });
      const vaultAddr = await vault.getAddress();
      const { intent } = await buildV4Intent(vaultAddr, {
        assetIn: await usdc.getAddress(),
        assetOut: await usdc.getAddress(),
        strategyHash: ethers.ZeroHash,
      });
      const sig = await signV4Intent(teeWallet, vaultAddr, intent);
      await expect(
        vault.connect(operator).executeIntent(intent, sig)
      ).to.be.revertedWithCustomError(vault, "WrongStrategyHash");
    });

    it("sealed mode still works: attestationReportHash binding preserved + StrategyApplied emitted", async function () {
      // Setup sealed-mode policy so executeIntent must follow commit-reveal.
      // Run end-to-end with amountIn=0 so we bypass the venue swap (no venue
      // configured in setupV4) and reach the tail of executeIntent — the
      // SealedIntentExecuted + StrategyApplied events must both fire.
      const { vault, operator, teeWallet, usdc } = await setupV4({
        policyOverrides: { sealedMode: true },
      });
      const vaultAddr = await vault.getAddress();

      const attestationHash = ethers.keccak256(ethers.toUtf8Bytes("sealed-attestation-1"));
      const acceptedHash = await vault.acceptedManifestHash();

      const { intent } = await buildV4Intent(vaultAddr, {
        assetIn: await usdc.getAddress(),
        assetOut: await usdc.getAddress(),
        amountIn: 0n,
        minAmountOut: 0n,
        attestationReportHash: attestationHash,
        strategyHash: acceptedHash,
      });
      const sig = await signV4Intent(teeWallet, vaultAddr, intent);

      // Pre-commit the sealed commit hash. Skipping this step would revert
      // with "cr" — proving the sealed pipeline is wired into V4.
      const commitHash = ethers.keccak256(
        ethers.solidityPacked(["bytes32", "bytes32"], [intent.intentHash, attestationHash])
      );
      await vault.connect(operator).commitIntent(commitHash);
      // V4 enforces `block.number >= commitBlock + 1` — mine one extra block.
      await ethers.provider.send("evm_mine", []);

      const tx = vault.connect(operator).executeIntent(intent, sig);
      await expect(tx)
        .to.emit(vault, "SealedIntentExecuted")
        .withArgs(vaultAddr, intent.intentHash, teeWallet.address, attestationHash);
      // V4 also emits StrategyApplied at the tail of every successful
      // executeIntent so off-chain indexers can attribute on-chain actions
      // to a specific strategy commitment.
      await expect(tx)
        .to.emit(vault, "StrategyApplied")
        .withArgs(acceptedHash, 1);
    });
  });

  describe("Manifest upgrade timelock", function () {
    it("requestManifestUpgrade records the new hash + timestamp and emits the event", async function () {
      const { vault, depositor } = await setupV4();
      const newHash = ethers.keccak256(ethers.toUtf8Bytes("momentum-breakout-v1"));

      const tx = await vault.connect(depositor).requestManifestUpgrade(newHash);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);
      const expectedReadyAt = BigInt(block.timestamp) + 24n * 60n * 60n;

      await expect(tx)
        .to.emit(vault, "ManifestUpgradeRequested")
        .withArgs(newHash, expectedReadyAt);

      expect(await vault.pendingManifestHash()).to.equal(newHash);
      expect(await vault.manifestUpgradeRequestedAt()).to.equal(BigInt(block.timestamp));
    });

    it("applyManifestUpgrade reverts before the 24h timelock elapses", async function () {
      const { vault, depositor } = await setupV4();
      const newHash = ethers.keccak256(ethers.toUtf8Bytes("arbitrage-stable-v1"));
      await vault.connect(depositor).requestManifestUpgrade(newHash);

      // Try immediately — should fail.
      await expect(
        vault.connect(depositor).applyManifestUpgrade()
      ).to.be.revertedWithCustomError(vault, "ManifestTimelockActive");

      // Advance 23h59m — still too early.
      await ethers.provider.send("evm_increaseTime", [24 * 60 * 60 - 60]);
      await ethers.provider.send("evm_mine", []);
      await expect(
        vault.connect(depositor).applyManifestUpgrade()
      ).to.be.revertedWithCustomError(vault, "ManifestTimelockActive");
    });

    it("applyManifestUpgrade promotes the pending hash after the timelock", async function () {
      const acceptedHash = ethers.keccak256(ethers.toUtf8Bytes("strategy-v1-default"));
      const newHash = ethers.keccak256(ethers.toUtf8Bytes("market-neutral-v1"));
      const { vault, depositor } = await setupV4({ acceptedManifestHash: acceptedHash });

      await vault.connect(depositor).requestManifestUpgrade(newHash);
      await ethers.provider.send("evm_increaseTime", [24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine", []);

      await expect(vault.connect(depositor).applyManifestUpgrade())
        .to.emit(vault, "ManifestUpgraded")
        .withArgs(acceptedHash, newHash);

      expect(await vault.acceptedManifestHash()).to.equal(newHash);
      expect(await vault.pendingManifestHash()).to.equal(ethers.ZeroHash);
      expect(await vault.manifestUpgradeRequestedAt()).to.equal(0);
    });

    it("cancelManifestUpgrade discards the pending upgrade", async function () {
      const newHash = ethers.keccak256(ethers.toUtf8Bytes("ephemeral-strategy"));
      const { vault, depositor } = await setupV4();
      const acceptedBefore = await vault.acceptedManifestHash();

      await vault.connect(depositor).requestManifestUpgrade(newHash);
      await expect(vault.connect(depositor).cancelManifestUpgrade())
        .to.emit(vault, "ManifestUpgradeCancelled")
        .withArgs(newHash);

      expect(await vault.pendingManifestHash()).to.equal(ethers.ZeroHash);
      expect(await vault.manifestUpgradeRequestedAt()).to.equal(0);
      // active commitment unchanged
      expect(await vault.acceptedManifestHash()).to.equal(acceptedBefore);
    });

    it("requestManifestUpgrade rejects the zero hash (would alias the pending sentinel)", async function () {
      // The pending-state machine uses bytes32(0) to mean "nothing pending",
      // so queueing a zero would alias the two states and break apply/cancel
      // bookkeeping. The contract rejects it explicitly.
      const { vault, depositor } = await setupV4();
      await expect(
        vault.connect(depositor).requestManifestUpgrade(ethers.ZeroHash)
      ).to.be.revertedWithCustomError(vault, "ManifestUpgradeNoChange");
    });

    it("applyManifestUpgrade / cancelManifestUpgrade revert when nothing is pending", async function () {
      const { vault, depositor } = await setupV4();
      await expect(
        vault.connect(depositor).applyManifestUpgrade()
      ).to.be.revertedWithCustomError(vault, "NoPendingManifestUpgrade");
      await expect(
        vault.connect(depositor).cancelManifestUpgrade()
      ).to.be.revertedWithCustomError(vault, "NoPendingManifestUpgrade");
    });

    it("a re-request before apply overwrites the pending hash + restarts the timer", async function () {
      const newHashA = ethers.keccak256(ethers.toUtf8Bytes("strategy-A"));
      const newHashB = ethers.keccak256(ethers.toUtf8Bytes("strategy-B"));
      const { vault, depositor } = await setupV4();

      await vault.connect(depositor).requestManifestUpgrade(newHashA);
      const tsAfterA = (await ethers.provider.getBlock("latest")).timestamp;

      // Advance some time, then re-request — the second call must overwrite.
      await ethers.provider.send("evm_increaseTime", [60 * 60]); // 1 hour
      await ethers.provider.send("evm_mine", []);
      await vault.connect(depositor).requestManifestUpgrade(newHashB);
      const tsAfterB = (await ethers.provider.getBlock("latest")).timestamp;

      expect(await vault.pendingManifestHash()).to.equal(newHashB);
      expect(await vault.manifestUpgradeRequestedAt()).to.equal(BigInt(tsAfterB));
      // Sanity: the second timestamp is later than the first.
      expect(tsAfterB).to.be.greaterThan(tsAfterA);
    });

    it("once applied, executeIntent now requires the NEW hash", async function () {
      const oldHash = ethers.keccak256(ethers.toUtf8Bytes("old-strategy"));
      const newHash = ethers.keccak256(ethers.toUtf8Bytes("new-strategy"));
      const { vault, depositor, operator, teeWallet, usdc } = await setupV4({
        acceptedManifestHash: oldHash,
      });
      const vaultAddr = await vault.getAddress();

      // Roll the upgrade through the timelock.
      await vault.connect(depositor).requestManifestUpgrade(newHash);
      await ethers.provider.send("evm_increaseTime", [24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine", []);
      await vault.connect(depositor).applyManifestUpgrade();

      // OLD-hash intent must now be rejected (operator is on a stale manifest).
      const { intent: stale } = await buildV4Intent(vaultAddr, {
        assetIn: await usdc.getAddress(),
        assetOut: await usdc.getAddress(),
        strategyHash: oldHash,
      });
      const sigStale = await signV4Intent(teeWallet, vaultAddr, stale);
      await expect(
        vault.connect(operator).executeIntent(stale, sigStale)
      ).to.be.revertedWithCustomError(vault, "WrongStrategyHash");
    });
  });

  describe("Owner-only access controls", function () {
    it("requestManifestUpgrade reverts when caller is not owner", async function () {
      const { vault, operator } = await setupV4();
      const newHash = ethers.keccak256(ethers.toUtf8Bytes("attacker-strategy"));
      await expect(
        vault.connect(operator).requestManifestUpgrade(newHash)
      ).to.be.revertedWith("owner");
    });

    it("applyManifestUpgrade reverts when caller is not owner", async function () {
      const { vault, depositor, operator } = await setupV4();
      const newHash = ethers.keccak256(ethers.toUtf8Bytes("queued-strategy"));
      await vault.connect(depositor).requestManifestUpgrade(newHash);
      await ethers.provider.send("evm_increaseTime", [24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine", []);
      // Even after timelock, only owner can apply.
      await expect(
        vault.connect(operator).applyManifestUpgrade()
      ).to.be.revertedWith("owner");
    });

    it("cancelManifestUpgrade reverts when caller is not owner", async function () {
      const { vault, depositor, operator } = await setupV4();
      const newHash = ethers.keccak256(ethers.toUtf8Bytes("queued-strategy"));
      await vault.connect(depositor).requestManifestUpgrade(newHash);
      await expect(
        vault.connect(operator).cancelManifestUpgrade()
      ).to.be.revertedWith("owner");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Regression — maxPositionBps decimals mismatch (AUDIT_MONEY_PATH.md blocker).
//
// The trade-size cap is `cap = totalDeposited * maxPositionBps / 10000`, where
// totalDeposited is in 6-decimal USDC (base asset) units. On a SELL, intent.amountIn
// is the sold asset in its OWN decimals (WETH = 18-dec). Comparing the two directly
// reverts every realistic WETH SELL with PositionTooLarge — so the AI can BUY a WETH
// position but can never SELL / stop-loss it on-chain. The cap is a principal-deployment
// guard and must only apply to the BUY leg (assetIn == baseAsset).
// ─────────────────────────────────────────────────────────────────────────────
describe("AegisVault_v4 — maxPositionBps decimals (18-dec non-base asset)", function () {
  // setup mirroring setupV4 but whitelisting an 18-decimal WETH alongside 6-dec USDC.
  async function setupV4Weth({ policyOverrides = {} } = {}) {
    const [, depositor, operator, treasury] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const usdc = await MockERC20.deploy("USDC", "USDC", 6);
    const weth = await MockERC20.deploy("WETH", "WETH", 18);

    const Registry = await ethers.getContractFactory("ExecutionRegistry");
    const registry = await Registry.deploy();
    await registry.waitForDeployment();

    const { impl, VaultV4 } = await deployV4Impl();

    const Factory = await ethers.getContractFactory("AegisVaultFactoryV4");
    const factory = await Factory.deploy(
      await impl.getAddress(),
      await registry.getAddress(),
      treasury.address
    );
    await factory.waitForDeployment();
    await registry.authorizeFactory(await factory.getAddress());

    const teeWallet = ethers.Wallet.createRandom().connect(ethers.provider);
    const acceptedManifestHash = ethers.keccak256(ethers.toUtf8Bytes("strategy-v1-default"));
    const policy = v4Policy(teeWallet.address, policyOverrides);

    const tx = await factory.connect(depositor).createVault(
      operator.address,
      await usdc.getAddress(),
      ethers.ZeroAddress, // venue: no on-chain swap exercised here
      policy,
      [await usdc.getAddress(), await weth.getAddress()],
      50,
      acceptedManifestHash
    );
    const receipt = await tx.wait();
    const ev = receipt.logs
      .map((l) => { try { return factory.interface.parseLog(l); } catch { return null; } })
      .find((p) => p && p.name === "VaultDeployed");
    const vault = VaultV4.attach(ev.args.vault);

    return { depositor, operator, usdc, weth, vault, teeWallet };
  }

  async function fundVaultPrincipal(vault, usdc, depositor, usdcUnits) {
    const amount = usdcUnits * 10n ** 6n;
    await usdc.mint(depositor.address, amount);
    await usdc.connect(depositor).approve(await vault.getAddress(), amount);
    await vault.connect(depositor).deposit(amount);
  }

  it("does NOT revert on a within-policy WETH SELL (18-dec assetIn vs 6-dec base cap)", async function () {
    const { depositor, operator, usdc, weth, vault, teeWallet } = await setupV4Weth();
    const vaultAddr = await vault.getAddress();

    // Principal 10,000 USDC -> totalDeposited = 1e10, cap = 50% = 5e9.
    await fundVaultPrincipal(vault, usdc, depositor, 10_000n);

    // Vault holds a 1 WETH position (~$1.7k, far under 50% of the $10k vault by
    // value) — a clearly within-policy size. But 1e18 (18-dec) >> 5e9 (6-dec cap).
    const oneWeth = 1n * 10n ** 18n;
    await weth.mint(vaultAddr, oneWeth);

    const { intent } = await buildV4Intent(vaultAddr, {
      assetIn: await weth.getAddress(),
      assetOut: await usdc.getAddress(),
      amountIn: oneWeth,
      minAmountOut: 0n,
    });
    const sig = await signV4Intent(teeWallet, vaultAddr, intent);

    // BUG: current code reverts PositionTooLarge here. The fix scopes the cap to
    // the BUY leg (assetIn == baseAsset), so this SELL is allowed.
    await expect(vault.connect(operator).executeIntent(intent, sig)).to.not.be.reverted;
  });

  it("still caps an oversized BUY (assetIn == baseAsset) and allows a within-cap BUY", async function () {
    const { depositor, operator, usdc, weth, vault, teeWallet } = await setupV4Weth();
    const vaultAddr = await vault.getAddress();

    // Principal 10,000 USDC -> cap = 5e9 (6-dec). Vault holds the deposited USDC.
    await fundVaultPrincipal(vault, usdc, depositor, 10_000n);

    // Within-cap BUY (4,000 USDC <= 5e9 cap): must NOT revert.
    const within = await buildV4Intent(vaultAddr, {
      assetIn: await usdc.getAddress(),
      assetOut: await weth.getAddress(),
      amountIn: 4_000n * 10n ** 6n,
      minAmountOut: 0n,
    });
    const sigW = await signV4Intent(teeWallet, vaultAddr, within.intent);
    await expect(vault.connect(operator).executeIntent(within.intent, sigW)).to.not.be.reverted;

    // Oversized BUY (6,000 USDC > 5e9 cap, <= vault USDC balance): must revert.
    const over = await buildV4Intent(vaultAddr, {
      assetIn: await usdc.getAddress(),
      assetOut: await weth.getAddress(),
      amountIn: 6_000n * 10n ** 6n,
      minAmountOut: 0n,
    });
    const sigO = await signV4Intent(teeWallet, vaultAddr, over.intent);
    await expect(vault.connect(operator).executeIntent(over.intent, sigO)).to.be.reverted;
  });
});
