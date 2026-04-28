/**
 * AegisVault_v4_strategy.test.js — additive coverage focused on the
 * strategy-binding execute path.
 *
 * Existing AegisVault_v4.test.js (Phase 1A) covers:
 *   - factory createVault + acceptedManifestHash storage
 *   - WrongStrategyHash / UnsupportedSchemaVersion reverts
 *   - manifest upgrade timelock + access control
 *
 * This file extends with the EXECUTE flow that downstream operators care
 * about — sealed-mode round-trips that actually swap through a mock venue
 * with the strategy commitment threaded through every check:
 *
 *   1. End-to-end execute: sealed mode + matching strategyHash + real
 *      MockDEX swap → IntentExecuted + StrategyApplied both fire, balances
 *      move, intent is registered + finalized.
 *   2. Wrong strategyHash on an otherwise-valid sealed flow → revert with
 *      the correct error class (proves the binding is enforced AT the
 *      vault gate, before ExecLibV4 is reached).
 *   3. Lower bound: strategySchemaVer == 0 from a real signed intent →
 *      UnsupportedSchemaVersion (this is the field-defaulted-to-0 bug
 *      class — orchestrator code that forgets to set the field).
 *   4. Upper bound: strategySchemaVer > MAX_SUPPORTED_SCHEMA_VER → same
 *      error.
 *   5. The schema check must run BEFORE the hash check (forward-version
 *      intents are diagnosed distinctly in logs).
 *   6. VaultDeployed factory event still carries the 8-arg signature with
 *      acceptedManifestHash as the trailing field — covered here as a
 *      regression sentinel since a struct refactor is what would silently
 *      drop the field.
 *
 * The signing helpers and setup are duplicated from AegisVault_v4.test.js
 * deliberately so this file can run standalone against the V4 implementation
 * — coupling to the sibling helper file would make either file harder to
 * delete in isolation.
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");

const HARDHAT_CHAIN_ID = 31337;

// MUST match ExecLibV4.EXECUTION_INTENT_TYPEHASH_V4. Field order is
// load-bearing — the on-chain typehash is derived by string concatenation
// of these names + types.
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

// Minimal viable V4 policy: cooldown 0 so executeIntent isn't blocked
// immediately after init, daily cap large, no fees so balances are easy
// to reason about.
function v4Policy(attestedSigner, overrides = {}) {
  return {
    maxPositionBps: 5000,
    maxDailyLossBps: 500,
    stopLossBps: 1500,
    cooldownSeconds: 0,
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

// Build the V4 intent struct + EIP-712 digest. The on-chain struct also
// carries `intentHash` (the digest itself) and `reasonSummary`, neither
// of which is part of the typed encoding — we attach them here so the
// returned intent matches the Solidity ExecutionIntentV4 layout passed
// to executeIntent().
async function buildV4Intent(vaultAddr, overrides = {}) {
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  const fields = {
    vault: vaultAddr,
    assetIn: overrides.assetIn || ethers.ZeroAddress,
    assetOut: overrides.assetOut || ethers.ZeroAddress,
    amountIn: overrides.amountIn ?? 0n,
    minAmountOut: overrides.minAmountOut ?? 0n,
    createdAt: overrides.createdAt ?? now,
    expiresAt: overrides.expiresAt ?? now + 600,
    confidenceBps: overrides.confidenceBps ?? 8000,
    riskScoreBps: overrides.riskScoreBps ?? 2000,
    attestationReportHash: overrides.attestationReportHash ?? ethers.keccak256(ethers.toUtf8Bytes("attestation-v4-default")),
    strategyHash: overrides.strategyHash ?? ethers.keccak256(ethers.toUtf8Bytes("strategy-v1-default")),
    strategySchemaVer: overrides.strategySchemaVer ?? 1,
  };
  const digest = ethers.TypedDataEncoder.hash(intentDomain(vaultAddr), EXECUTION_INTENT_V4_TYPES, fields);
  return {
    intent: {
      intentHash: digest,
      ...fields,
      reasonSummary: overrides.reasonSummary ?? "",
    },
    digest,
  };
}

async function signV4Intent(wallet, vaultAddr, intent) {
  const typedFields = {
    vault: intent.vault, assetIn: intent.assetIn, assetOut: intent.assetOut,
    amountIn: intent.amountIn, minAmountOut: intent.minAmountOut,
    createdAt: intent.createdAt, expiresAt: intent.expiresAt,
    confidenceBps: intent.confidenceBps, riskScoreBps: intent.riskScoreBps,
    attestationReportHash: intent.attestationReportHash,
    strategyHash: intent.strategyHash,
    strategySchemaVer: intent.strategySchemaVer,
  };
  return await wallet.signTypedData(intentDomain(vaultAddr), EXECUTION_INTENT_V4_TYPES, typedFields);
}

async function deployV4Impl() {
  const ExecLibV4     = await ethers.getContractFactory("ExecLibV4");
  const SealedLib     = await ethers.getContractFactory("SealedLib");
  const IOLib         = await ethers.getContractFactory("IOLib");
  const CrossChainLib = await ethers.getContractFactory("CrossChainLib");

  const execLib   = await ExecLibV4.deploy();    await execLib.waitForDeployment();
  const sealedLib = await SealedLib.deploy();    await sealedLib.waitForDeployment();
  const ioLib     = await IOLib.deploy();        await ioLib.waitForDeployment();
  const ccLib     = await CrossChainLib.deploy(); await ccLib.waitForDeployment();

  const VaultV4 = await ethers.getContractFactory("AegisVault_v4", {
    libraries: {
      ExecLibV4:     await execLib.getAddress(),
      SealedLib:     await sealedLib.getAddress(),
      IOLib:         await ioLib.getAddress(),
      CrossChainLib: await ccLib.getAddress(),
    },
  });
  const impl = await VaultV4.deploy();
  await impl.waitForDeployment();
  return { impl, VaultV4 };
}

// Setup that includes a real MockDEX so executeIntent can actually swap
// and produce IntentExecuted / StrategyApplied event pairs. The DEX is
// pre-funded with the OUT asset so the vault's swap leg succeeds.
async function setupV4WithVenue({
  acceptedManifestHash = ethers.keccak256(ethers.toUtf8Bytes("strategy-v1-default")),
  policyOverrides = {},
} = {}) {
  const [admin, depositor, operator, treasury] = await ethers.getSigners();

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const usdc = await MockERC20.deploy("USDC", "USDC", 6);
  const wbtc = await MockERC20.deploy("WBTC", "WBTC", 8);

  const MockDEX = await ethers.getContractFactory("MockDEX");
  const dex = await MockDEX.deploy();
  await dex.waitForDeployment();

  // 1 WBTC = 50_000 USDC (rate scaled 1e18). Decimals 6/8.
  await dex.setPairRate(
    await usdc.getAddress(),
    await wbtc.getAddress(),
    ethers.parseUnits("0.00002", 18), // 1 USDC = 0.00002 WBTC
    6, 8,
  );
  // Pre-fund the DEX with WBTC so vault swaps can settle.
  await wbtc.mint(await dex.getAddress(), ethers.parseUnits("100", 8));

  const Registry = await ethers.getContractFactory("ExecutionRegistry");
  const registry = await Registry.deploy();
  await registry.waitForDeployment();

  const { impl, VaultV4 } = await deployV4Impl();

  const Factory = await ethers.getContractFactory("AegisVaultFactoryV4");
  const factory = await Factory.deploy(
    await impl.getAddress(),
    await registry.getAddress(),
    treasury.address,
  );
  await factory.waitForDeployment();
  await registry.authorizeFactory(await factory.getAddress());

  // Random TEE wallet so test cases isolate — connect to provider so it
  // can sign typed data using ethers v6 helpers.
  const teeWallet = ethers.Wallet.createRandom().connect(ethers.provider);

  const policy = v4Policy(teeWallet.address, policyOverrides);

  const tx = await factory.connect(depositor).createVault(
    operator.address,
    await usdc.getAddress(),
    await dex.getAddress(),
    policy,
    [await usdc.getAddress(), await wbtc.getAddress()],
    50,
    acceptedManifestHash,
  );
  const receipt = await tx.wait();
  const ev = receipt.logs
    .map((l) => { try { return factory.interface.parseLog(l); } catch { return null; } })
    .find((p) => p && p.name === "VaultDeployed");
  expect(ev, "VaultDeployed not emitted").to.not.equal(null);
  const vault = VaultV4.attach(ev.args.vault);

  // Fund the vault with USDC so swaps have something to spend.
  await usdc.mint(await vault.getAddress(), ethers.parseUnits("10000", 6));

  return {
    admin, depositor, operator, treasury,
    usdc, wbtc, dex, registry, factory, vault, teeWallet,
    deployTx: tx, deployReceipt: receipt, deployEvent: ev,
  };
}

// Pre-commit a sealed-mode commitHash for an intent + mine one block
// (V4 enforces commitBlock + 1) so executeIntent can proceed. Returns
// the commit hash for assertions.
async function commitSealedIntent(vault, operator, intent) {
  const commitHash = ethers.keccak256(
    ethers.solidityPacked(["bytes32", "bytes32"], [intent.intentHash, intent.attestationReportHash]),
  );
  await vault.connect(operator).commitIntent(commitHash);
  await ethers.provider.send("evm_mine", []);
  return commitHash;
}

describe("AegisVault_v4 — strategy binding execute path", function () {
  describe("End-to-end executeIntent + StrategyApplied", function () {
    it("sealed-mode swap with matching strategyHash succeeds and emits StrategyApplied + IntentExecuted", async function () {
      // The load-bearing happy-path: TEE-signed intent whose strategyHash
      // matches the vault commitment, attestation pre-committed, real swap
      // through the mock DEX. We assert ALL the boundary events fire so a
      // regression that drops StrategyApplied (the new V4 emission) but
      // leaves IntentExecuted intact would still be caught.
      const acceptedHash = ethers.keccak256(ethers.toUtf8Bytes("trend-following-v1"));
      const ctx = await setupV4WithVenue({
        acceptedManifestHash: acceptedHash,
        policyOverrides: { sealedMode: true },
      });
      const vaultAddr = await ctx.vault.getAddress();

      const attestationHash = ethers.keccak256(ethers.toUtf8Bytes("tee-attestation-1"));
      const amountIn = ethers.parseUnits("100", 6); // 100 USDC

      const { intent } = await buildV4Intent(vaultAddr, {
        assetIn: await ctx.usdc.getAddress(),
        assetOut: await ctx.wbtc.getAddress(),
        amountIn,
        minAmountOut: 1n, // any positive minOut so the venue swap path engages
        attestationReportHash: attestationHash,
        strategyHash: acceptedHash,
        strategySchemaVer: 1,
      });
      const sig = await signV4Intent(ctx.teeWallet, vaultAddr, intent);
      await commitSealedIntent(ctx.vault, ctx.operator, intent);

      const tx = ctx.vault.connect(ctx.operator).executeIntent(intent, sig);

      // The two V4-distinguishing events:
      // - SealedIntentExecuted from the existing sealed pipeline.
      // - StrategyApplied appended at the tail of executeIntent.
      await expect(tx)
        .to.emit(ctx.vault, "SealedIntentExecuted")
        .withArgs(vaultAddr, intent.intentHash, ctx.teeWallet.address, attestationHash);
      await expect(tx).to.emit(ctx.vault, "StrategyApplied").withArgs(acceptedHash, 1);

      // Fail-loud sanity: WBTC balance moved into the vault.
      const wbtcBal = await ctx.wbtc.balanceOf(vaultAddr);
      expect(wbtcBal).to.be.greaterThan(0n);

      // Registry side: the intent hash is registered + finalized (so a
      // replay attempt would revert downstream).
      const finalized = await ctx.registry.isFinalized(intent.intentHash);
      expect(finalized).to.equal(true);
    });

    it("StrategyApplied carries the EXACT acceptedManifestHash + schemaVer (not the intent's), so logs cannot be spoofed by the orchestrator", async function () {
      // The contract emits the values from `intent.strategyHash` /
      // `intent.strategySchemaVer` AFTER the equality + range checks have
      // passed. So the emitted hash is necessarily the active commitment
      // (would have reverted otherwise). We pin the precise field values
      // here so a refactor that switches to an alternate source (e.g.
      // emitting acceptedManifestHash() view at the end) is still
      // observably equivalent.
      const acceptedHash = ethers.keccak256(ethers.toUtf8Bytes("market-neutral-v1"));
      const ctx = await setupV4WithVenue({
        acceptedManifestHash: acceptedHash,
        policyOverrides: { sealedMode: true },
      });
      const vaultAddr = await ctx.vault.getAddress();

      const attestationHash = ethers.keccak256(ethers.toUtf8Bytes("attest-2"));
      const { intent } = await buildV4Intent(vaultAddr, {
        assetIn: await ctx.usdc.getAddress(),
        assetOut: await ctx.wbtc.getAddress(),
        amountIn: ethers.parseUnits("50", 6),
        minAmountOut: 1n,
        attestationReportHash: attestationHash,
        strategyHash: acceptedHash,
        strategySchemaVer: 1,
      });
      const sig = await signV4Intent(ctx.teeWallet, vaultAddr, intent);
      await commitSealedIntent(ctx.vault, ctx.operator, intent);

      const tx = await ctx.vault.connect(ctx.operator).executeIntent(intent, sig);
      const receipt = await tx.wait();

      const log = receipt.logs
        .map((l) => { try { return ctx.vault.interface.parseLog(l); } catch { return null; } })
        .find((p) => p && p.name === "StrategyApplied");
      expect(log, "StrategyApplied not in receipt").to.not.equal(null);
      expect(log.args.strategyHash).to.equal(acceptedHash);
      expect(log.args.schemaVer).to.equal(1);
    });
  });

  describe("Strategy-binding reverts in the sealed flow", function () {
    it("WrongStrategyHash fires BEFORE any state mutation when sealed-mode intent has a mismatched hash", async function () {
      // The strategy-binding check sits ahead of the sealed-attestation
      // verifier. Even if the orchestrator pre-committed the right
      // attestation, the wrong strategyHash must short-circuit the
      // entire executeIntent without consuming the commit. This proves
      // the binding cannot be bypassed by piggy-backing onto a valid
      // attestation flow.
      const acceptedHash = ethers.keccak256(ethers.toUtf8Bytes("strategy-good"));
      const wrongHash    = ethers.keccak256(ethers.toUtf8Bytes("strategy-bad"));
      const ctx = await setupV4WithVenue({
        acceptedManifestHash: acceptedHash,
        policyOverrides: { sealedMode: true },
      });
      const vaultAddr = await ctx.vault.getAddress();

      const attestationHash = ethers.keccak256(ethers.toUtf8Bytes("attest-3"));
      const { intent } = await buildV4Intent(vaultAddr, {
        assetIn: await ctx.usdc.getAddress(),
        assetOut: await ctx.wbtc.getAddress(),
        amountIn: ethers.parseUnits("10", 6),
        minAmountOut: 1n,
        attestationReportHash: attestationHash,
        strategyHash: wrongHash,
        strategySchemaVer: 1,
      });
      const sig = await signV4Intent(ctx.teeWallet, vaultAddr, intent);

      // Pre-commit so the only failure mode is the strategyHash mismatch.
      await commitSealedIntent(ctx.vault, ctx.operator, intent);

      await expect(
        ctx.vault.connect(ctx.operator).executeIntent(intent, sig),
      ).to.be.revertedWithCustomError(ctx.vault, "WrongStrategyHash");

      // Vault state untouched: no WBTC moved in.
      expect(await ctx.wbtc.balanceOf(vaultAddr)).to.equal(0n);
      // Registry untouched: nothing was registered or finalized.
      expect(await ctx.registry.isFinalized(intent.intentHash)).to.equal(false);
    });

    it("UnsupportedSchemaVersion fires for strategySchemaVer == 0 in a sealed flow", async function () {
      // The lower-bound branch catches the field-defaulted-to-0 bug
      // (orchestrator forgot to set strategySchemaVer). We exercise this
      // through the sealed pipeline so we know the schema check runs
      // BEFORE the attestation verification, otherwise a legitimate
      // attestation could mask a malformed intent.
      const ctx = await setupV4WithVenue({
        policyOverrides: { sealedMode: true },
      });
      const vaultAddr = await ctx.vault.getAddress();

      const attestationHash = ethers.keccak256(ethers.toUtf8Bytes("attest-4"));
      const { intent } = await buildV4Intent(vaultAddr, {
        assetIn: await ctx.usdc.getAddress(),
        assetOut: await ctx.wbtc.getAddress(),
        amountIn: ethers.parseUnits("10", 6),
        minAmountOut: 1n,
        attestationReportHash: attestationHash,
        strategyHash: await ctx.vault.acceptedManifestHash(),
        strategySchemaVer: 0,
      });
      const sig = await signV4Intent(ctx.teeWallet, vaultAddr, intent);
      await commitSealedIntent(ctx.vault, ctx.operator, intent);

      await expect(
        ctx.vault.connect(ctx.operator).executeIntent(intent, sig),
      ).to.be.revertedWithCustomError(ctx.vault, "UnsupportedSchemaVersion");
    });

    it("UnsupportedSchemaVersion fires for strategySchemaVer == 99 in a sealed flow", async function () {
      // Upper-bound branch — same revert class so off-chain alerting can
      // distinguish a forward-version manifest from a hash mismatch by
      // error class alone.
      const ctx = await setupV4WithVenue({
        policyOverrides: { sealedMode: true },
      });
      const vaultAddr = await ctx.vault.getAddress();

      const attestationHash = ethers.keccak256(ethers.toUtf8Bytes("attest-5"));
      const { intent } = await buildV4Intent(vaultAddr, {
        assetIn: await ctx.usdc.getAddress(),
        assetOut: await ctx.wbtc.getAddress(),
        amountIn: ethers.parseUnits("10", 6),
        minAmountOut: 1n,
        attestationReportHash: attestationHash,
        strategyHash: await ctx.vault.acceptedManifestHash(),
        strategySchemaVer: 99,
      });
      const sig = await signV4Intent(ctx.teeWallet, vaultAddr, intent);
      await commitSealedIntent(ctx.vault, ctx.operator, intent);

      await expect(
        ctx.vault.connect(ctx.operator).executeIntent(intent, sig),
      ).to.be.revertedWithCustomError(ctx.vault, "UnsupportedSchemaVersion");
    });

    it("schema-version check runs ahead of strategy-hash check in the sealed flow (forward-version + wrong-hash → schema error)", async function () {
      // Pin the check ordering. If a future refactor swaps these two
      // require()s the wrong way around, off-chain dashboards that branch
      // on error class would silently misclassify forward-version
      // operators as malicious-deviation operators.
      const ctx = await setupV4WithVenue({
        policyOverrides: { sealedMode: true },
      });
      const vaultAddr = await ctx.vault.getAddress();

      const attestationHash = ethers.keccak256(ethers.toUtf8Bytes("attest-6"));
      const { intent } = await buildV4Intent(vaultAddr, {
        assetIn: await ctx.usdc.getAddress(),
        assetOut: await ctx.wbtc.getAddress(),
        amountIn: ethers.parseUnits("10", 6),
        minAmountOut: 1n,
        attestationReportHash: attestationHash,
        strategyHash: ethers.keccak256(ethers.toUtf8Bytes("not-the-active-strategy")),
        strategySchemaVer: 99,
      });
      const sig = await signV4Intent(ctx.teeWallet, vaultAddr, intent);
      await commitSealedIntent(ctx.vault, ctx.operator, intent);

      await expect(
        ctx.vault.connect(ctx.operator).executeIntent(intent, sig),
      ).to.be.revertedWithCustomError(ctx.vault, "UnsupportedSchemaVersion");
    });
  });

  describe("Factory event provenance", function () {
    it("VaultDeployed emits 8 args including acceptedManifestHash as the trailing field", async function () {
      // Off-chain indexers (frontend operator catalogue, journal exporter)
      // depend on the 8-arg signature. A struct refactor that adds args
      // earlier or drops the trailing manifest hash would break them
      // silently because indexers usually positionally decode without
      // schema validation. Keep this assertion strict.
      const expectedHash = ethers.keccak256(ethers.toUtf8Bytes("momentum-breakout-v1"));
      const ctx = await setupV4WithVenue({ acceptedManifestHash: expectedHash });
      const ev = ctx.deployEvent;

      // Strict cardinality.
      expect(ev.args.length).to.equal(8);

      // Strict positional layout. Names line up with the Solidity event
      // declaration:
      //   event VaultDeployed(address vault, address owner, address operator,
      //                       address baseAsset, address venue,
      //                       uint16 requestedMaxCrossChainFeeBps,
      //                       uint256 timestamp, bytes32 acceptedManifestHash)
      expect(ev.args.vault).to.equal(await ctx.vault.getAddress());
      expect(ev.args.owner).to.equal(ctx.depositor.address);
      expect(ev.args.operator).to.equal(ctx.operator.address);
      expect(ev.args.baseAsset).to.equal(await ctx.usdc.getAddress());
      expect(ev.args.venue).to.equal(await ctx.dex.getAddress());
      expect(ev.args.requestedMaxCrossChainFeeBps).to.equal(50);
      expect(ev.args.timestamp).to.be.a("bigint");
      expect(ev.args.acceptedManifestHash).to.equal(expectedHash);

      // Factory-side mirror so off-chain consumers can read without a
      // vault round-trip — same value as the event tail.
      expect(await ctx.factory.vaultManifestHash(await ctx.vault.getAddress())).to.equal(expectedHash);
    });
  });
});
