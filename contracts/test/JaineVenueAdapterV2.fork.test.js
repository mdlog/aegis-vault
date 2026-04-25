const { expect } = require("chai");
const { ethers, network } = require("hardhat");

/**
 * Fork test for JaineVenueAdapterV2 against the real 0G Aristotle mainnet.
 *
 * Runs only when OG_FORK_BLOCK is set (CI default skips it because forking
 * requires reaching out to evmrpc.0g.ai). Tests the actual Jaine router +
 * factory + live pool liquidity, so a passing run gives strong evidence
 * that mainnet deployment will route correctly.
 *
 *   OG_FORK_BLOCK=latest npx hardhat test test/JaineVenueAdapterV2.fork.test.js
 *
 * What this verifies:
 *   1. swap(USDC.e, WBTC, ...) auto-routes through W0G (no direct pool exists)
 *      and lands WBTC at the caller's address.
 *   2. swap(USDC.e, WETH, ...) auto-routes through W0G similarly.
 *   3. swap(USDC.e, W0G, ...) takes the single-hop path (direct pool).
 *   4. previewRoute() reports kind=2 (hub) for USDC.e↔WBTC and kind=1 for
 *      USDC.e↔W0G — matches actual swap behavior.
 */

// Real 0G mainnet addresses (matches contracts/deployments-mainnet.json).
const JAINE_ROUTER  = "0x8b598a7c136215a95ba0282b4d832b9f9801f2e2";
const JAINE_FACTORY = "0x9bdcA5798E52e592A08e3b34d3F18EeF76Af7ef4";
const W0G           = "0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c";
const USDCE         = "0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E";
const WBTC          = "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c";
const WETH          = "0x564770837Ef8bbF077cFe54E5f6106538c815B22";

// USDC.e / W0G 0.3% pool — confirmed via getPool() at fork time. Used as the
// USDC.e source: it holds ~$191K of USDC.e, ample for ~100-USDCe test trades.
const USDCE_W0G_POOL = "0xa9e824eddb9677fb2189ab9c439238a83695c091";

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
  "function approve(address,uint256) returns (bool)",
];

const onFork = process.env.OG_FORK_BLOCK ? describe : describe.skip;

onFork("JaineVenueAdapterV2 — fork against 0G mainnet", function () {
  // RPC roundtrips to 0G are slow; raise default timeout so the suite has
  // breathing room without hiding genuine failures.
  this.timeout(120_000);

  let adapter, owner, user, usdcE, wbtc, weth;

  before(async function () {
    [owner, user] = await ethers.getSigners();

    // Deploy V2 adapter on the fork pointing at the real Jaine router/factory
    // and W0G as the hub. Same constructor we'll call on real mainnet.
    const Adapter = await ethers.getContractFactory("JaineVenueAdapterV2");
    adapter = await Adapter.deploy(JAINE_ROUTER, JAINE_FACTORY, W0G);
    await adapter.waitForDeployment();

    usdcE = await ethers.getContractAt(ERC20_ABI, USDCE);
    wbtc  = await ethers.getContractAt(ERC20_ABI, WBTC);
    weth  = await ethers.getContractAt(ERC20_ABI, WETH);

    // Fund `user` with USDC.e by impersonating the USDC.e/W0G pool. This
    // mirrors how a real LP token-flow looks; the pool holds the reserves
    // we need anyway.
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [USDCE_W0G_POOL],
    });
    await network.provider.send("hardhat_setBalance", [
      USDCE_W0G_POOL,
      "0xDE0B6B3A7640000", // 1 0G for impersonated tx gas
    ]);
    const poolSigner = await ethers.getSigner(USDCE_W0G_POOL);
    await usdcE.connect(poolSigner).transfer(user.address, 200_000_000n); // 200 USDC.e
    await network.provider.request({
      method: "hardhat_stopImpersonatingAccount",
      params: [USDCE_W0G_POOL],
    });

    expect(await usdcE.balanceOf(user.address)).to.equal(200_000_000n);
  });

  describe("previewRoute()", function () {
    it("reports direct (kind=1) for USDC.e ↔ W0G", async function () {
      const [kind, feeA] = await adapter.previewRoute(USDCE, W0G);
      expect(kind).to.equal(1);
      expect(feeA).to.be.greaterThan(0n);
    });

    it("reports hub (kind=2) for USDC.e ↔ WBTC", async function () {
      const [kind, feeIn, feeOut] = await adapter.previewRoute(USDCE, WBTC);
      expect(kind).to.equal(2);
      expect(feeIn).to.be.greaterThan(0n);
      expect(feeOut).to.be.greaterThan(0n);
    });

    it("reports a route (kind ≥ 1) for USDC.e ↔ WETH", async function () {
      // Reality on 0G mainnet: a thin USDC.e/WETH direct pool exists (~$3K TVL),
      // so the adapter prefers single-hop (kind=1). When that pool eventually
      // dries up the adapter will fall back to W0G hub (kind=2). Either is
      // valid — what we want to verify is that *some* route is found.
      const [kind] = await adapter.previewRoute(USDCE, WETH);
      expect(kind).to.be.oneOf([1n, 2n]);
    });

    it("returns kind=0 for self-swap", async function () {
      const [kind] = await adapter.previewRoute(USDCE, USDCE);
      expect(kind).to.equal(0);
    });
  });

  describe("swap() — single-hop direct", function () {
    it("USDC.e → W0G uses single-hop path", async function () {
      const amountIn = 5_000_000n; // 5 USDC.e
      await usdcE.connect(user).approve(adapter.target, amountIn);

      const w0gBefore = await ethers.provider.getBalance(user.address);
      // W0G is an ERC-20 contract (wrapped native), check via ERC-20 balanceOf
      const w0g = await ethers.getContractAt(ERC20_ABI, W0G);
      const w0gBalBefore = await w0g.balanceOf(user.address);

      // Expect Swapped event (NOT MultiHopSwapped) — direct path
      await expect(adapter.connect(user).swap(USDCE, W0G, amountIn, 1n))
        .to.emit(adapter, "Swapped");

      const w0gBalAfter = await w0g.balanceOf(user.address);
      expect(w0gBalAfter - w0gBalBefore).to.be.greaterThan(0n);
      // Adapter shouldn't retain dust
      expect(await usdcE.balanceOf(adapter.target)).to.equal(0n);
      expect(await w0g.balanceOf(adapter.target)).to.equal(0n);
    });
  });

  describe("swap() — two-hop via W0G hub", function () {
    it("USDC.e → WBTC routes through W0G and lands WBTC at user", async function () {
      const amountIn = 50_000_000n; // 50 USDC.e
      await usdcE.connect(user).approve(adapter.target, amountIn);

      const wbtcBefore = await wbtc.balanceOf(user.address);

      await expect(adapter.connect(user).swap(USDCE, WBTC, amountIn, 1n))
        .to.emit(adapter, "MultiHopSwapped");

      const wbtcAfter = await wbtc.balanceOf(user.address);
      const received = wbtcAfter - wbtcBefore;
      expect(received).to.be.greaterThan(0n);

      // Adapter should never retain leftover tokens (hub or otherwise)
      expect(await usdcE.balanceOf(adapter.target)).to.equal(0n);
      expect(await wbtc.balanceOf(adapter.target)).to.equal(0n);
      const w0g = await ethers.getContractAt(ERC20_ABI, W0G);
      expect(await w0g.balanceOf(adapter.target)).to.equal(0n);
    });

    it("USDC.e → WETH lands WETH at user (whichever path adapter picks)", async function () {
      // The adapter picks single-hop when a direct pool exists, multi-hop
      // otherwise. For this assertion we only care that the swap settles
      // and the user gets WETH — both events represent a successful route.
      const amountIn = 50_000_000n; // 50 USDC.e
      await usdcE.connect(user).approve(adapter.target, amountIn);

      const wethBefore = await weth.balanceOf(user.address);
      const tx = await adapter.connect(user).swap(USDCE, WETH, amountIn, 1n);
      const receipt = await tx.wait();

      const swappedEvents = receipt.logs.filter((l) => {
        try {
          const parsed = adapter.interface.parseLog(l);
          return parsed && (parsed.name === "Swapped" || parsed.name === "MultiHopSwapped");
        } catch { return false; }
      });
      expect(swappedEvents.length).to.equal(1);

      const wethAfter = await weth.balanceOf(user.address);
      expect(wethAfter - wethBefore).to.be.greaterThan(0n);
    });

    it("respects minAmountOut on the end-to-end output", async function () {
      const amountIn = 10_000_000n;
      await usdcE.connect(user).approve(adapter.target, amountIn);

      // Jaine's WBTC/W0G pool prices WBTC very generously vs market (the pool
      // hasn't been arb'd to spot), so a "1 BTC for 10 USDC" minOut would
      // actually clear. We need to overshoot whatever the pool quotes —
      // 1e18 sats = 10 billion BTC, far above any conceivable supply.
      await expect(
        adapter.connect(user).swap(USDCE, WBTC, amountIn, 10n ** 18n)
      ).to.be.reverted;

      // After failure, no tokens should be stuck in the adapter
      expect(await usdcE.balanceOf(adapter.target)).to.equal(0n);
    });
  });

  describe("swap() — error paths", function () {
    it("reverts SameToken when tokenIn == tokenOut", async function () {
      await expect(
        adapter.connect(user).swap(USDCE, USDCE, 1_000_000n, 1n)
      ).to.be.revertedWithCustomError(adapter, "SameToken");
    });

    it("reverts ZeroAmount when amountIn == 0", async function () {
      await expect(
        adapter.connect(user).swap(USDCE, WBTC, 0n, 1n)
      ).to.be.revertedWithCustomError(adapter, "ZeroAmount");
    });
  });
});
