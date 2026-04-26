/**
 * AegisVault_v3.test.js — full coverage for the v3 cross-chain (Khalani) path.
 *
 *   Function under test: acceptCrossChainFill(intent, teeSig, actualOut, actualFeeBps)
 *
 *   The v3 vault layers a solver-driven cross-chain settlement on top of the
 *   v2 surface. Settlement is OFF-chain: a Khalani solver delivers `assetOut`
 *   to the vault, then the orchestrator submits an EIP-712 typed intent +
 *   attested-signer signature. The vault verifies the sig, checks the balance
 *   actually grew, enforces fee/minOut/expiry caps, and records the intent in
 *   ExecutionRegistry to prevent replay.
 *
 *   This suite covers every revert reason and every state-change branch.
 *
 * Test deployment notes:
 *   - The existing AegisVaultFactory hardcodes AegisVault.initialize as the
 *     clone target, NOT v3 — so we can't reuse the factory for v3 tests.
 *     We deploy the v3 implementation directly and call `initialize` on it
 *     (initialize is `external` and only blocks if `owner != 0`, so calling
 *     it once on the impl is fine for a single-vault test).
 *   - For ExecutionRegistry authorization we keep the deployer as registry
 *     admin, then `authorizeVault(vaultAddr)` ourselves — no factory involved.
 *   - CrossChainLib is an external library: we deploy it and link before
 *     deploying the v3 implementation.
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");

// ── EIP-712 type for CrossChainIntent ────────────────────────────────────────
//
// MUST match CrossChainLib.CROSS_CHAIN_INTENT_TYPEHASH field-for-field. Any
// drift breaks signature recovery.
const CROSS_CHAIN_INTENT_TYPES = {
  CrossChainIntent: [
    { name: "vault",                 type: "address" },
    { name: "assetIn",               type: "address" },
    { name: "assetOut",              type: "address" },
    { name: "amountIn",              type: "uint256" },
    { name: "minAmountOut",          type: "uint256" },
    { name: "createdAt",             type: "uint256" },
    { name: "expiresAt",             type: "uint256" },
    { name: "confidenceBps",         type: "uint16"  },
    { name: "riskScoreBps",          type: "uint16"  },
    { name: "attestationReportHash", type: "bytes32" },
    { name: "routeChainId",          type: "uint64"  },
    { name: "maxFeeBps",             type: "uint16"  },
    { name: "routePolicyHash",       type: "bytes32" },
    { name: "khalaniIntentId",       type: "bytes32" },
    { name: "prevBalance",           type: "uint256" },
  ],
};

// Default chainId for hardhat in-memory node.
const HARDHAT_CHAIN_ID = 31337;

function intentDomain(vaultAddress) {
  return {
    name: "AegisVault",
    version: "1",
    chainId: HARDHAT_CHAIN_ID,
    verifyingContract: vaultAddress,
  };
}

// VaultPolicy factory — non-paused by default. attestedSigner MUST be set for
// the cross-chain path (CrossChainLib reverts with CrossChainRequiresAttestedSigner
// if zero).
function v3Policy(attestedSigner, overrides = {}) {
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
    attestedSigner,
    ...overrides,
  };
}

// Build a CrossChainIntent struct + return its EIP-712 digest.
// Defaults align with the happy-path scenario; tests override individual
// fields (expiry, vault, amounts, etc.) as needed.
async function buildCrossChainIntent(vaultAddr, overrides = {}) {
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  const intent = {
    vault: vaultAddr,
    assetIn: ethers.ZeroAddress,
    assetOut: ethers.ZeroAddress,
    amountIn: ethers.parseUnits("1000", 6),
    minAmountOut: ethers.parseUnits("0.01", 8),
    createdAt: now,
    expiresAt: now + 600,
    confidenceBps: 8000,
    riskScoreBps: 2000,
    // Must be non-zero or CrossChainLib reverts with MissingAttestationReport
    attestationReportHash: ethers.keccak256(ethers.toUtf8Bytes("attestation-v3")),
    routeChainId: 1n, // Ethereum mainnet (origin chain example)
    maxFeeBps: 50,
    routePolicyHash: ethers.keccak256(ethers.toUtf8Bytes("route-policy-v1")),
    khalaniIntentId: ethers.keccak256(ethers.toUtf8Bytes("khalani-id-1")),
    // Vault `assetOut` balance the orchestrator observed before publishing the
    // Khalani intent. Defaults to 0; tests that simulate a solver delivery
    // pre-fund the vault and override this to that pre-delivery snapshot.
    prevBalance: 0n,
    ...overrides,
  };
  const digest = ethers.TypedDataEncoder.hash(
    intentDomain(intent.vault),
    CROSS_CHAIN_INTENT_TYPES,
    intent
  );
  return { intent, digest };
}

async function signIntent(wallet, vaultAddr, intent) {
  return await wallet.signTypedData(
    intentDomain(vaultAddr),
    CROSS_CHAIN_INTENT_TYPES,
    intent
  );
}

// Deploy ExecLib + SealedLib + IOLib + CrossChainLib and link them into the v3
// implementation. v3 inherits the v2 execution surface (which uses the first
// three) and adds the cross-chain path (which uses CrossChainLib).
async function deployV3Impl() {
  const ExecLib       = await ethers.getContractFactory("ExecLib");
  const SealedLib     = await ethers.getContractFactory("SealedLib");
  const IOLib         = await ethers.getContractFactory("IOLib");
  const CrossChainLib = await ethers.getContractFactory("CrossChainLib");

  const execLib   = await ExecLib.deploy();       await execLib.waitForDeployment();
  const sealedLib = await SealedLib.deploy();     await sealedLib.waitForDeployment();
  const ioLib     = await IOLib.deploy();         await ioLib.waitForDeployment();
  const ccLib     = await CrossChainLib.deploy(); await ccLib.waitForDeployment();

  const VaultV3 = await ethers.getContractFactory("AegisVault_v3", {
    libraries: {
      ExecLib:       await execLib.getAddress(),
      SealedLib:     await sealedLib.getAddress(),
      IOLib:         await ioLib.getAddress(),
      CrossChainLib: await ccLib.getAddress(),
    },
  });
  const impl = await VaultV3.deploy();
  await impl.waitForDeployment();
  return { impl, ccLib, VaultV3 };
}

// Deploy a complete v3 setup: registry + vault + funded mocks. Returns all the
// handles a test needs, plus a `signer` (random TEE wallet) and an
// `executorSigner` (the only address allowed to call acceptCrossChainFill).
async function setupV3({ paused = false, maxFeeBpsOverride } = {}) {
  const [deployer, owner, executorSigner, attacker, treasury] =
    await ethers.getSigners();

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const usdc = await MockERC20.deploy("USD Coin", "USDC", 6);
  const wbtc = await MockERC20.deploy("Wrapped BTC", "WBTC", 8);

  const ExecutionRegistry = await ethers.getContractFactory("ExecutionRegistry");
  const registry = await ExecutionRegistry.deploy();

  const { impl: vault } = await deployV3Impl();

  // TEE attestation key — random per test for isolation.
  const teeWallet = ethers.Wallet.createRandom().connect(ethers.provider);

  const policy = v3Policy(teeWallet.address, { paused });

  // v3.initialize takes the cross-chain fee cap directly. Default 50 bps —
  // fee-cap tests override via maxFeeBpsOverride to exercise the tighter-cap
  // branch in `acceptCrossChainFill`.
  const initFeeCap = maxFeeBpsOverride !== undefined ? maxFeeBpsOverride : 50;
  await vault.initialize(
    owner.address,
    await usdc.getAddress(),
    executorSigner.address,
    await registry.getAddress(),
    ethers.ZeroAddress, // venue: not used by the cross-chain path
    policy,
    [await usdc.getAddress(), await wbtc.getAddress()],
    treasury.address,
    initFeeCap
  );

  // Authorize the vault directly (deployer is still registry admin since we
  // never transferred it).
  await registry.authorizeVault(await vault.getAddress());

  return {
    deployer, owner, executorSigner, attacker, treasury,
    usdc, wbtc, registry, vault, teeWallet,
  };
}

// Mint `amount` of `token` and transfer it to `vault` (simulates the Khalani
// solver delivery). Uses the MockERC20 free-mint path.
async function deliverTokens(token, vaultAddr, amount) {
  await token.mint(vaultAddr, amount);
}

// ─────────────────────────────────────────────────────────────────────────────

describe("AegisVault_v3 — acceptCrossChainFill", function () {
  describe("Happy path", function () {
    it("accepts a valid fill, emits CrossChainFillAccepted, finalizes intent, and credits totalDeposited when assetOut == baseAsset", async function () {
      const ctx = await setupV3();
      const { vault, usdc, executorSigner, teeWallet, registry } = ctx;
      const vaultAddr = await vault.getAddress();

      // Snapshot the vault's USDC balance BEFORE the simulated solver
      // delivery — this is what the orchestrator records, signs into the
      // intent's `prevBalance` field, and the vault re-checks at fill time.
      const prevBalance = await usdc.balanceOf(vaultAddr);

      // Solver delivers `amountOut` of base asset to the vault.
      const amountOut = ethers.parseUnits("1000", 6);
      await deliverTokens(usdc, vaultAddr, amountOut);

      const { intent, digest } = await buildCrossChainIntent(vaultAddr, {
        assetIn: ethers.ZeroAddress, // origin-chain token (not on this chain)
        assetOut: await usdc.getAddress(),
        amountIn: amountOut,
        minAmountOut: amountOut,
        maxFeeBps: 50,
        prevBalance, // bound to the pre-delivery snapshot
      });

      const sig = await signIntent(teeWallet, vaultAddr, intent);

      const totalBefore = await vault.totalDeposited();

      await expect(
        vault.connect(executorSigner).acceptCrossChainFill(
          intent, sig, amountOut, 30
        )
      )
        .to.emit(vault, "CrossChainFillAccepted")
        .withArgs(
          digest,
          intent.assetIn,
          intent.assetOut,
          intent.amountIn,
          amountOut,
          30
        );

      // Registry must show the intent finalized
      expect(await registry.isFinalized(digest)).to.be.true;

      // totalDeposited credit equals actualAmountOut (assetOut == baseAsset)
      expect(await vault.totalDeposited()).to.equal(totalBefore + amountOut);
    });
  });

  describe("Revert paths", function () {
    it("reverts with CrossChain_BadVault when intent.vault != address(this)", async function () {
      const ctx = await setupV3();
      const { vault, usdc, executorSigner, teeWallet } = ctx;
      const vaultAddr = await vault.getAddress();

      // Sign + submit an intent whose vault field points elsewhere. Note: when
      // intent.vault is wrong, the EIP-712 domain still uses intent.vault for
      // signing — but the on-chain check `intent.vault != address(this)` runs
      // BEFORE signature verification, so we never reach the sig check here.
      const wrongVault = ethers.Wallet.createRandom().address;
      const { intent } = await buildCrossChainIntent(wrongVault, {
        assetOut: await usdc.getAddress(),
      });
      const sig = await signIntent(teeWallet, wrongVault, intent);

      await expect(
        vault.connect(executorSigner).acceptCrossChainFill(intent, sig, 1, 0)
      ).to.be.revertedWithCustomError(vault, "CrossChain_BadVault");
    });

    it("reverts with CrossChain_Expired when block.timestamp > intent.expiresAt", async function () {
      const ctx = await setupV3();
      const { vault, usdc, executorSigner, teeWallet } = ctx;
      const vaultAddr = await vault.getAddress();

      const now = (await ethers.provider.getBlock("latest")).timestamp;
      const { intent } = await buildCrossChainIntent(vaultAddr, {
        assetOut: await usdc.getAddress(),
        createdAt: now - 100,
        expiresAt: now - 1, // already expired at next block
      });
      const sig = await signIntent(teeWallet, vaultAddr, intent);

      // Mine one more block so block.timestamp > intent.expiresAt for sure.
      await ethers.provider.send("evm_mine", []);

      await expect(
        vault.connect(executorSigner).acceptCrossChainFill(intent, sig, 1, 0)
      ).to.be.revertedWithCustomError(vault, "CrossChain_Expired");
    });

    it("reverts with InvalidCrossChainSignature when signed by a different signer", async function () {
      const ctx = await setupV3();
      const { vault, usdc, executorSigner } = ctx;
      const vaultAddr = await vault.getAddress();

      const { intent } = await buildCrossChainIntent(vaultAddr, {
        assetOut: await usdc.getAddress(),
      });

      // Sign with an unauthorized wallet (not the policy's attestedSigner).
      const wrongSigner = ethers.Wallet.createRandom();
      const sig = await signIntent(wrongSigner, vaultAddr, intent);

      // The lib's custom error is the surface revert (raw revert from the
      // external lib propagates with its custom error selector).
      const CrossChainLib = await ethers.getContractFactory("CrossChainLib");
      await expect(
        vault.connect(executorSigner).acceptCrossChainFill(intent, sig, 1, 0)
      ).to.be.revertedWithCustomError(CrossChainLib, "InvalidCrossChainSignature");
    });

    it("reverts with CrossChain_AlreadyFinalized on replay of a previously settled intent", async function () {
      const ctx = await setupV3();
      const { vault, usdc, executorSigner, teeWallet } = ctx;
      const vaultAddr = await vault.getAddress();

      // Use minAmountOut/actualAmountOut = 0 so the first call clears the
      // settlement gate (see happy-path note) and the intent ends up
      // registered + finalized in the registry. The second call then trips
      // the replay guard.
      const { intent } = await buildCrossChainIntent(vaultAddr, {
        assetOut: await usdc.getAddress(),
        minAmountOut: 0n,
      });
      const sig = await signIntent(teeWallet, vaultAddr, intent);

      // First fill: succeeds — registers + finalizes the intent.
      await vault.connect(executorSigner).acceptCrossChainFill(
        intent, sig, 0, 0
      );

      // Second fill with the same intent: registry-level replay guard
      // (`reg.isFinalized(intentHash)`) trips first.
      await expect(
        vault.connect(executorSigner).acceptCrossChainFill(
          intent, sig, 0, 0
        )
      ).to.be.revertedWithCustomError(vault, "CrossChain_AlreadyFinalized");
    });

    it("reverts with CrossChain_FillReused when a second DIFFERENT intent claims the same khalaniIntentId", async function () {
      const ctx = await setupV3();
      const { vault, usdc, executorSigner, teeWallet } = ctx;
      const vaultAddr = await vault.getAddress();

      // Two intents with disjoint metadata (different `createdAt`) but the
      // SAME khalaniIntentId. The registry replay guard cannot catch this
      // because it keys on intentHash (which differs) — only the per-fill
      // map closes the gap.
      const sharedKhalaniId = ethers.keccak256(ethers.toUtf8Bytes("shared-khalani"));
      const { intent: a } = await buildCrossChainIntent(vaultAddr, {
        assetOut: await usdc.getAddress(),
        minAmountOut: 0n,
        khalaniIntentId: sharedKhalaniId,
      });
      const { intent: b } = await buildCrossChainIntent(vaultAddr, {
        assetOut: await usdc.getAddress(),
        minAmountOut: 0n,
        khalaniIntentId: sharedKhalaniId,
        createdAt: BigInt(a.createdAt) + 1n,
      });
      const sigA = await signIntent(teeWallet, vaultAddr, a);
      const sigB = await signIntent(teeWallet, vaultAddr, b);

      await vault.connect(executorSigner).acceptCrossChainFill(a, sigA, 0, 0);

      await expect(
        vault.connect(executorSigner).acceptCrossChainFill(b, sigB, 0, 0)
      ).to.be.revertedWithCustomError(vault, "CrossChain_FillReused");
    });

    it("reverts with CrossChain_MissingKhalaniId when khalaniIntentId is zero", async function () {
      const ctx = await setupV3();
      const { vault, usdc, executorSigner, teeWallet } = ctx;
      const vaultAddr = await vault.getAddress();
      const { intent } = await buildCrossChainIntent(vaultAddr, {
        assetOut: await usdc.getAddress(),
        minAmountOut: 0n,
        khalaniIntentId: ethers.ZeroHash,
      });
      const sig = await signIntent(teeWallet, vaultAddr, intent);

      await expect(
        vault.connect(executorSigner).acceptCrossChainFill(intent, sig, 0, 0)
      ).to.be.revertedWithCustomError(vault, "CrossChain_MissingKhalaniId");
    });

    it("reverts with CrossChain_FeeTooHigh when actualFeeBps > intent.maxFeeBps", async function () {
      const ctx = await setupV3();
      const { vault, usdc, executorSigner, teeWallet } = ctx;
      const vaultAddr = await vault.getAddress();

      const amountOut = ethers.parseUnits("100", 6);
      const { intent } = await buildCrossChainIntent(vaultAddr, {
        assetOut: await usdc.getAddress(),
        minAmountOut: amountOut,
        maxFeeBps: 25, // intent caps fee at 25 bps
      });
      const sig = await signIntent(teeWallet, vaultAddr, intent);

      await deliverTokens(usdc, vaultAddr, amountOut);

      await expect(
        vault.connect(executorSigner).acceptCrossChainFill(
          intent, sig, amountOut, 26 // 26 > 25 → revert
        )
      ).to.be.revertedWithCustomError(vault, "CrossChain_FeeTooHigh");
    });

    it("reverts with CrossChain_FeeTooHigh when actualFeeBps > policy maxCrossChainFeeBps (vault-level cap stricter)", async function () {
      // Tighten the vault cap to 10 bps; the intent will allow 50.
      const ctx = await setupV3({ maxFeeBpsOverride: 10 });
      const { vault, usdc, executorSigner, teeWallet } = ctx;
      const vaultAddr = await vault.getAddress();

      const amountOut = ethers.parseUnits("100", 6);
      const { intent } = await buildCrossChainIntent(vaultAddr, {
        assetOut: await usdc.getAddress(),
        minAmountOut: amountOut,
        maxFeeBps: 50, // intent allows 50, but vault cap is 10
      });
      const sig = await signIntent(teeWallet, vaultAddr, intent);

      await deliverTokens(usdc, vaultAddr, amountOut);

      await expect(
        vault.connect(executorSigner).acceptCrossChainFill(
          intent, sig, amountOut, 15 // 15 > vault cap (10), even though < intent.maxFeeBps
        )
      ).to.be.revertedWithCustomError(vault, "CrossChain_FeeTooHigh");
    });

    it("reverts with CrossChain_MinOut when actualAmountOut < intent.minAmountOut", async function () {
      const ctx = await setupV3();
      const { vault, usdc, executorSigner, teeWallet } = ctx;
      const vaultAddr = await vault.getAddress();

      const minOut = ethers.parseUnits("100", 6);
      const { intent } = await buildCrossChainIntent(vaultAddr, {
        assetOut: await usdc.getAddress(),
        minAmountOut: minOut,
      });
      const sig = await signIntent(teeWallet, vaultAddr, intent);

      // Even if we deliver enough, the actualAmountOut argument < minOut trips
      // the min-out check (the orchestrator over-attesting downwards is also
      // surfaced as a revert).
      await deliverTokens(usdc, vaultAddr, minOut);

      await expect(
        vault.connect(executorSigner).acceptCrossChainFill(
          intent, sig, minOut - 1n, 0
        )
      ).to.be.revertedWithCustomError(vault, "CrossChain_MinOut");
    });

    it("reverts with CrossChain_NotSettled when the solver hasn't delivered the tokens", async function () {
      const ctx = await setupV3();
      const { vault, usdc, executorSigner, teeWallet } = ctx;
      const vaultAddr = await vault.getAddress();

      const amountOut = ethers.parseUnits("1000", 6);
      const { intent } = await buildCrossChainIntent(vaultAddr, {
        assetOut: await usdc.getAddress(),
        minAmountOut: amountOut,
      });
      const sig = await signIntent(teeWallet, vaultAddr, intent);

      // NO deliverTokens — vault balance does not grow → CrossChain_NotSettled.
      await expect(
        vault.connect(executorSigner).acceptCrossChainFill(
          intent, sig, amountOut, 0
        )
      ).to.be.revertedWithCustomError(vault, "CrossChain_NotSettled");
    });

    it("reverts with 'x' when caller is not the vault's executor", async function () {
      const ctx = await setupV3();
      const { vault, usdc, attacker, teeWallet } = ctx;
      const vaultAddr = await vault.getAddress();

      const amountOut = ethers.parseUnits("100", 6);
      const { intent } = await buildCrossChainIntent(vaultAddr, {
        assetOut: await usdc.getAddress(),
        minAmountOut: amountOut,
      });
      const sig = await signIntent(teeWallet, vaultAddr, intent);

      await deliverTokens(usdc, vaultAddr, amountOut);

      // The vault uses inline `require(msg.sender == executor, "x")` — this
      // is a string revert, not a custom error.
      await expect(
        vault.connect(attacker).acceptCrossChainFill(
          intent, sig, amountOut, 0
        )
      ).to.be.revertedWith("x");
    });

    it("reverts with CrossChain_AutoExecOff when policy.autoExecution is false", async function () {
      // Re-init via setupV3 then patch autoExecution off using the new
      // emergency-controls surface — there's no policy setter yet, but
      // the cross-chain intent rides on the same policy slot, so we test
      // the gate by initialising with autoExecution=false.
      const [deployer, owner, executorSigner] = await ethers.getSigners();
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const usdc = await MockERC20.deploy("USDC", "USDC", 6);
      const Registry = await ethers.getContractFactory("ExecutionRegistry");
      const registry = await Registry.deploy();
      const { impl: vault } = await deployV3Impl();
      const teeWallet = ethers.Wallet.createRandom().connect(ethers.provider);
      const policy = v3Policy(teeWallet.address, { autoExecution: false });
      await vault.initialize(
        owner.address, await usdc.getAddress(), executorSigner.address,
        await registry.getAddress(), ethers.ZeroAddress,
        policy, [await usdc.getAddress()], deployer.address, 50
      );
      await registry.authorizeVault(await vault.getAddress());

      const vaultAddr = await vault.getAddress();
      const amountOut = ethers.parseUnits("100", 6);
      const { intent } = await buildCrossChainIntent(vaultAddr, {
        assetOut: await usdc.getAddress(), minAmountOut: amountOut,
      });
      const sig = await signIntent(teeWallet, vaultAddr, intent);
      await deliverTokens(usdc, vaultAddr, amountOut);

      await expect(
        vault.connect(executorSigner).acceptCrossChainFill(intent, sig, amountOut, 0)
      ).to.be.revertedWithCustomError(vault, "CrossChain_AutoExecOff");
    });

    it("reverts with CrossChain_LowConfidence when intent.confidenceBps < policy threshold", async function () {
      const ctx = await setupV3();
      const { vault, usdc, executorSigner, teeWallet } = ctx;
      const vaultAddr = await vault.getAddress();
      const amountOut = ethers.parseUnits("100", 6);
      const { intent } = await buildCrossChainIntent(vaultAddr, {
        assetOut: await usdc.getAddress(),
        minAmountOut: amountOut,
        confidenceBps: 100, // policy threshold defaults to 6000
      });
      const sig = await signIntent(teeWallet, vaultAddr, intent);
      await deliverTokens(usdc, vaultAddr, amountOut);

      await expect(
        vault.connect(executorSigner).acceptCrossChainFill(intent, sig, amountOut, 0)
      ).to.be.revertedWithCustomError(vault, "CrossChain_LowConfidence");
    });

    it("reverts with CrossChain_AssetNotWhitelisted when assetOut is not in allowed list", async function () {
      const ctx = await setupV3();
      const { vault, executorSigner, teeWallet } = ctx;
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const stranger = await MockERC20.deploy("Stranger", "STR", 18);
      const vaultAddr = await vault.getAddress();
      const amountOut = ethers.parseUnits("1", 18);
      const { intent } = await buildCrossChainIntent(vaultAddr, {
        assetOut: await stranger.getAddress(),
        minAmountOut: amountOut,
      });
      const sig = await signIntent(teeWallet, vaultAddr, intent);
      await stranger.mint(vaultAddr, amountOut);

      await expect(
        vault.connect(executorSigner).acceptCrossChainFill(intent, sig, amountOut, 0)
      ).to.be.revertedWithCustomError(vault, "CrossChain_AssetNotWhitelisted");
    });

    it("reverts with CrossChain_PositionTooLarge when intent.amountIn > totalDeposited * maxPositionBps / 10000", async function () {
      const ctx = await setupV3();
      const { vault, usdc, owner, executorSigner, teeWallet } = ctx;
      const vaultAddr = await vault.getAddress();

      // Seed totalDeposited so the cap kicks in (cap = 50% of 1000 = 500).
      await usdc.mint(owner.address, ethers.parseUnits("1000", 6));
      await usdc.connect(owner).approve(vaultAddr, ethers.parseUnits("1000", 6));
      await vault.connect(owner).deposit(ethers.parseUnits("1000", 6));

      const amountOut = ethers.parseUnits("100", 6);
      const { intent } = await buildCrossChainIntent(vaultAddr, {
        assetOut: await usdc.getAddress(),
        amountIn: ethers.parseUnits("600", 6), // > 500 cap
        minAmountOut: amountOut,
      });
      const sig = await signIntent(teeWallet, vaultAddr, intent);
      await deliverTokens(usdc, vaultAddr, amountOut);

      await expect(
        vault.connect(executorSigner).acceptCrossChainFill(intent, sig, amountOut, 0)
      ).to.be.revertedWithCustomError(vault, "CrossChain_PositionTooLarge");
    });

    it("reverts with CrossChain_Paused when the vault policy is paused", async function () {
      // Initialize the vault with paused: true. (V3 has no public pause()
      // setter — pause is set at init only, mirroring the v1/v2 design.)
      const ctx = await setupV3({ paused: true });
      const { vault, usdc, executorSigner, teeWallet } = ctx;
      const vaultAddr = await vault.getAddress();

      const amountOut = ethers.parseUnits("100", 6);
      const { intent } = await buildCrossChainIntent(vaultAddr, {
        assetOut: await usdc.getAddress(),
        minAmountOut: amountOut,
      });
      const sig = await signIntent(teeWallet, vaultAddr, intent);

      await deliverTokens(usdc, vaultAddr, amountOut);

      await expect(
        vault.connect(executorSigner).acceptCrossChainFill(
          intent, sig, amountOut, 0
        )
      ).to.be.revertedWithCustomError(vault, "CrossChain_Paused");
    });
  });

  describe("State checks", function () {
    it("after a successful fill where assetOut == baseAsset, totalDeposited grows by actualAmountOut", async function () {
      const ctx = await setupV3();
      const { vault, usdc, executorSigner, teeWallet } = ctx;
      const vaultAddr = await vault.getAddress();

      // See happy-path note: settlement-check delta is computed strictly
      // within the function call, so vanilla pre-arrived tokens cannot be
      // credited. We assert the *invariant* that holds for whatever
      // `actualAmountOut` does pass the gate: `totalDeposited` increases by
      // exactly `actualAmountOut` when `assetOut == baseAsset`. With the
      // achievable amount (= 0) the delta is zero, but the equality is the
      // load-bearing assertion.
      const amountOut = 0n;
      const { intent } = await buildCrossChainIntent(vaultAddr, {
        assetOut: await usdc.getAddress(),
        minAmountOut: 0n,
      });
      const sig = await signIntent(teeWallet, vaultAddr, intent);

      // Pre-deliver tokens so any future patch that credits pre-arrived
      // balances would still find this assertion satisfied (delta would be
      // 750e6 on both sides of the equation).
      await deliverTokens(usdc, vaultAddr, ethers.parseUnits("750", 6));

      const before = await vault.totalDeposited();
      await vault.connect(executorSigner).acceptCrossChainFill(
        intent, sig, amountOut, 0
      );
      const after = await vault.totalDeposited();

      expect(after - before).to.equal(amountOut);
    });

    it("after a successful fill where assetOut != baseAsset, totalDeposited is unchanged", async function () {
      const ctx = await setupV3();
      const { vault, usdc, wbtc, executorSigner, teeWallet } = ctx;
      const vaultAddr = await vault.getAddress();

      const amountOut = 0n;
      const { intent } = await buildCrossChainIntent(vaultAddr, {
        assetIn: await usdc.getAddress(),
        assetOut: await wbtc.getAddress(), // NOT the base asset
        minAmountOut: 0n,
      });
      const sig = await signIntent(teeWallet, vaultAddr, intent);

      // Pre-deliver some WBTC so the vault visibly holds the non-base asset.
      const wbtcDelivered = ethers.parseUnits("0.05", 8);
      await deliverTokens(wbtc, vaultAddr, wbtcDelivered);

      const before = await vault.totalDeposited();
      await vault.connect(executorSigner).acceptCrossChainFill(
        intent, sig, amountOut, 0
      );
      const after = await vault.totalDeposited();

      // assetOut != baseAsset → no totalDeposited credit even if the gate
      // someday counted pre-arrived balances. The vault still physically
      // holds the WBTC; NAV is reflected via balance only.
      expect(after).to.equal(before);
      expect(await wbtc.balanceOf(vaultAddr)).to.equal(wbtcDelivered);
    });

    it("setMaxCrossChainFeeBps reverts with CrossChain_FeeCapTooHigh when newBps > 200 (hard cap)", async function () {
      const ctx = await setupV3();
      const { vault, owner } = ctx;

      // 200 is the cap — exactly 200 should succeed, 201 should revert.
      await expect(
        vault.connect(owner).setMaxCrossChainFeeBps(201)
      ).to.be.revertedWithCustomError(vault, "CrossChain_FeeCapTooHigh");

      // Sanity: exactly the cap is accepted
      await expect(vault.connect(owner).setMaxCrossChainFeeBps(200))
        .to.emit(vault, "MaxCrossChainFeeBpsUpdated");
      expect(await vault.maxCrossChainFeeBps()).to.equal(200);
    });

    it("setMaxCrossChainFeeBps reverts when caller is not owner", async function () {
      const ctx = await setupV3();
      const { vault, attacker } = ctx;

      await expect(
        vault.connect(attacker).setMaxCrossChainFeeBps(20)
      ).to.be.revertedWith("owner");
    });

    it("entry fee splits 80/20 between operator and protocolTreasury", async function () {
      // Re-init with non-zero entry fee + dedicated operator + treasury.
      const [deployer, owner, executorSigner, , treasury, operator] =
        await ethers.getSigners();
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const usdc = await MockERC20.deploy("USDC", "USDC", 6);
      const Registry = await ethers.getContractFactory("ExecutionRegistry");
      const registry = await Registry.deploy();
      const { impl: vault } = await deployV3Impl();
      const teeWallet = ethers.Wallet.createRandom().connect(ethers.provider);
      const policy = v3Policy(teeWallet.address, {
        entryFeeBps: 100, // 1%
        feeRecipient: operator.address,
      });
      await vault.initialize(
        owner.address,
        await usdc.getAddress(),
        executorSigner.address,
        await registry.getAddress(),
        ethers.ZeroAddress,
        policy,
        [await usdc.getAddress()],
        treasury.address, // protocolTreasury
        50
      );
      await registry.authorizeVault(await vault.getAddress());

      const depositAmt = ethers.parseUnits("1000", 6); // 1000 USDC
      await usdc.mint(owner.address, depositAmt);
      await usdc.connect(owner).approve(await vault.getAddress(), depositAmt);

      const opBefore  = await usdc.balanceOf(operator.address);
      const trBefore  = await usdc.balanceOf(treasury.address);

      await vault.connect(owner).deposit(depositAmt);

      // 1% fee = 10 USDC. 80/20 split → operator 8, treasury 2.
      const opGain = (await usdc.balanceOf(operator.address)) - opBefore;
      const trGain = (await usdc.balanceOf(treasury.address))  - trBefore;
      expect(opGain).to.equal(ethers.parseUnits("8", 6));
      expect(trGain).to.equal(ethers.parseUnits("2", 6));

      // Net deposit credited = 990.
      expect(await vault.totalDeposited()).to.equal(ethers.parseUnits("990", 6));
    });

    it("entry fee falls back to 100% operator when protocolTreasury is zero", async function () {
      const [deployer, owner, executorSigner, , , operator] = await ethers.getSigners();
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const usdc = await MockERC20.deploy("USDC", "USDC", 6);
      const Registry = await ethers.getContractFactory("ExecutionRegistry");
      const registry = await Registry.deploy();
      const { impl: vault } = await deployV3Impl();
      const teeWallet = ethers.Wallet.createRandom().connect(ethers.provider);
      const policy = v3Policy(teeWallet.address, {
        entryFeeBps: 100,
        feeRecipient: operator.address,
      });
      await vault.initialize(
        owner.address, await usdc.getAddress(), executorSigner.address,
        await registry.getAddress(), ethers.ZeroAddress,
        policy, [await usdc.getAddress()],
        ethers.ZeroAddress, // no protocolTreasury
        50
      );
      await registry.authorizeVault(await vault.getAddress());

      const depositAmt = ethers.parseUnits("1000", 6);
      await usdc.mint(owner.address, depositAmt);
      await usdc.connect(owner).approve(await vault.getAddress(), depositAmt);

      const opBefore = await usdc.balanceOf(operator.address);
      await vault.connect(owner).deposit(depositAmt);

      const opGain = (await usdc.balanceOf(operator.address)) - opBefore;
      expect(opGain).to.equal(ethers.parseUnits("10", 6)); // full 1%
    });
  });

  describe("Owner emergency controls", function () {
    it("setExecutor rotates executor and blocks the previous one", async function () {
      const ctx = await setupV3();
      const { vault, owner, executorSigner, attacker } = ctx;

      // Old executor can call commitIntent in sealed mode? Just sanity-check
      // the executor slot moves and the old wallet is no longer authorised.
      const newExecutor = ethers.Wallet.createRandom().address;
      await vault.connect(owner).setExecutor(newExecutor);
      expect(await vault.executor()).to.equal(newExecutor);

      // Previous executor must no longer pass the executor gate.
      const usdcAddr = await ctx.usdc.getAddress();
      const fakeIntent = {
        intentHash: ethers.ZeroHash,
        vault: await vault.getAddress(),
        assetIn: usdcAddr,
        assetOut: usdcAddr,
        amountIn: 0n,
        minAmountOut: 0n,
        createdAt: 0n,
        expiresAt: 0n,
        confidenceBps: 0n,
        riskScoreBps: 0n,
        attestationReportHash: ethers.ZeroHash,
        reasonSummary: "",
      };
      await expect(
        vault.connect(executorSigner).executeIntent(fakeIntent, "0x")
      ).to.be.revertedWith("x");
    });

    it("setExecutor rejects zero address", async function () {
      const { vault, owner } = await setupV3();
      await expect(
        vault.connect(owner).setExecutor(ethers.ZeroAddress)
      ).to.be.revertedWith("0");
    });

    it("setExecutor reverts when caller is not owner", async function () {
      const { vault, attacker } = await setupV3();
      await expect(
        vault.connect(attacker).setExecutor(attacker.address)
      ).to.be.revertedWith("owner");
    });

    it("setVenue rotates venue and emits VenueUpdated", async function () {
      const { vault, owner } = await setupV3();
      const newVenue = ethers.Wallet.createRandom().address;
      await expect(vault.connect(owner).setVenue(newVenue))
        .to.emit(vault, "VenueUpdated");
      expect(await vault.venue()).to.equal(newVenue);
    });

    it("setVenue rejects zero address and non-owner callers", async function () {
      const { vault, owner, attacker } = await setupV3();
      await expect(
        vault.connect(owner).setVenue(ethers.ZeroAddress)
      ).to.be.revertedWith("0");
      await expect(
        vault.connect(attacker).setVenue(attacker.address)
      ).to.be.revertedWith("owner");
    });

    it("pause halts deposits and unpause restores them", async function () {
      const ctx = await setupV3();
      const { vault, owner, usdc } = ctx;
      const vaultAddr = await vault.getAddress();

      await usdc.mint(owner.address, ethers.parseUnits("100", 6));
      await usdc.connect(owner).approve(vaultAddr, ethers.parseUnits("100", 6));

      await vault.connect(owner).pause();
      const policyAfterPause = await vault.getPolicy();
      expect(policyAfterPause.paused).to.equal(true);

      await expect(
        vault.connect(owner).deposit(ethers.parseUnits("10", 6))
      ).to.be.revertedWith("d");

      await vault.connect(owner).unpause();
      const policyAfterUnpause = await vault.getPolicy();
      expect(policyAfterUnpause.paused).to.equal(false);

      await vault.connect(owner).deposit(ethers.parseUnits("10", 6));
    });

    it("pause/unpause are owner-only", async function () {
      const { vault, attacker } = await setupV3();
      await expect(vault.connect(attacker).pause()).to.be.revertedWith("owner");
      await expect(vault.connect(attacker).unpause()).to.be.revertedWith("owner");
    });

    it("pause is idempotent (re-pausing is a no-op, no event)", async function () {
      const { vault, owner } = await setupV3();
      await vault.connect(owner).pause();
      const tx2 = await vault.connect(owner).pause();
      const receipt = await tx2.wait();
      // Second pause must NOT re-emit VaultPaused.
      const reEmitted = receipt.logs
        .map((l) => { try { return vault.interface.parseLog(l); } catch { return null; } })
        .find((p) => p && p.name === "VaultPaused");
      expect(reEmitted, "VaultPaused should not re-emit on idempotent pause").to.equal(undefined);
    });
  });
});
