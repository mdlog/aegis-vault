const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * UniswapV3VenueAdapter tests using mocked Uniswap V3 router + factory.
 *
 * The real adapter would integrate with Arbitrum's canonical SwapRouter02 +
 * factory + pools. These tests prove the adapter's logic in isolation:
 *   - swap() pulls tokenIn, calls router with correct params, sends tokenOut to caller
 *   - hasPool() looks up the right pool tier
 *   - reverts on no pool, same token, zero amount
 *   - approval flow: forceApprove → swap → forceApprove(0)
 *   - admin: addFeeTier, transferOwnership, rescueTokens
 */
describe("UniswapV3VenueAdapter", function () {
  let adapter, router, factory, usdc, weth, owner, user, attacker;

  const USDC_AMT = (n) => ethers.parseUnits(n.toString(), 6);
  const WETH_AMT = (n) => ethers.parseUnits(n.toString(), 18);

  beforeEach(async function () {
    [owner, user, attacker] = await ethers.getSigners();

    // Deploy mock tokens
    const Mock20 = await ethers.getContractFactory("MockERC20");
    usdc = await Mock20.deploy("USD Coin", "USDC", 6);
    weth = await Mock20.deploy("Wrapped Ether", "WETH", 18);

    // Deploy mock factory + a pool
    const MockFactory = await ethers.getContractFactory("MockUniV3Factory");
    factory = await MockFactory.deploy();

    const MockPool = await ethers.getContractFactory("MockUniV3Pool");
    const pool = await MockPool.deploy(1_000_000n);
    await factory.setPool(
      await usdc.getAddress(),
      await weth.getAddress(),
      500,
      await pool.getAddress()
    );

    // Deploy mock router and pre-fund it with WETH so it can pay out
    const MockRouter = await ethers.getContractFactory("MockSwapRouter02");
    router = await MockRouter.deploy();
    await weth.mint(await router.getAddress(), WETH_AMT(1000));

    // Set router rate: 1 USDC → 0.0005 WETH (i.e. ETH at $2000)
    // amountOut = amountIn * rateBps / 10000
    // To get 0.0005 ETH per USDC: 1e6 USDC * rate = 5e14 WETH
    // rate = 5e14 / 1e6 / 1e4 = ... actually mocking this cleanly is hard with bps,
    // so we use a 1:1 token-unit rate and adjust the test expectations.
    await router.setRate(10000); // 1:1 token unit (USDC unit → WETH unit)

    // Deploy the adapter
    const Adapter = await ethers.getContractFactory("UniswapV3VenueAdapter");
    adapter = await Adapter.deploy(await router.getAddress(), await factory.getAddress());
  });

  describe("Construction", function () {
    it("rejects zero router", async function () {
      const Adapter = await ethers.getContractFactory("UniswapV3VenueAdapter");
      await expect(Adapter.deploy(ethers.ZeroAddress, await factory.getAddress()))
        .to.be.revertedWithCustomError(adapter, "ZeroAddress");
    });

    it("rejects zero factory", async function () {
      const Adapter = await ethers.getContractFactory("UniswapV3VenueAdapter");
      await expect(Adapter.deploy(await router.getAddress(), ethers.ZeroAddress))
        .to.be.revertedWithCustomError(adapter, "ZeroAddress");
    });

    it("seeds standard fee tiers", async function () {
      expect(await adapter.feeTiers(0)).to.equal(100);
      expect(await adapter.feeTiers(1)).to.equal(500);
      expect(await adapter.feeTiers(2)).to.equal(3000);
      expect(await adapter.feeTiers(3)).to.equal(10000);
    });
  });

  describe("swap", function () {
    beforeEach(async function () {
      // Fund user with USDC and approve adapter
      await usdc.mint(user.address, USDC_AMT(1000));
      await usdc.connect(user).approve(await adapter.getAddress(), USDC_AMT(1000));
    });

    it("pulls tokenIn from caller and sends tokenOut to caller", async function () {
      const usdcBefore = await usdc.balanceOf(user.address);
      const wethBefore = await weth.balanceOf(user.address);

      await adapter.connect(user).swap(
        await usdc.getAddress(),
        await weth.getAddress(),
        USDC_AMT(100),
        1n // minOut
      );

      const usdcAfter = await usdc.balanceOf(user.address);
      const wethAfter = await weth.balanceOf(user.address);

      expect(usdcBefore - usdcAfter).to.equal(USDC_AMT(100));
      // Mock router 1:1 → 100 USDC raw units (10^6 of each) → 10^6 WETH raw units
      expect(wethAfter - wethBefore).to.equal(USDC_AMT(100));
    });

    it("emits Swapped event with the picked fee tier", async function () {
      await expect(
        adapter.connect(user).swap(
          await usdc.getAddress(),
          await weth.getAddress(),
          USDC_AMT(50),
          1n
        )
      )
        .to.emit(adapter, "Swapped")
        .withArgs(user.address, await usdc.getAddress(), await weth.getAddress(), USDC_AMT(50), USDC_AMT(50), 500);
    });

    it("reverts on zero amount", async function () {
      await expect(
        adapter.connect(user).swap(
          await usdc.getAddress(),
          await weth.getAddress(),
          0,
          0
        )
      ).to.be.revertedWithCustomError(adapter, "ZeroAmount");
    });

    it("reverts on same token", async function () {
      await expect(
        adapter.connect(user).swap(
          await usdc.getAddress(),
          await usdc.getAddress(),
          USDC_AMT(10),
          1n
        )
      ).to.be.revertedWithCustomError(adapter, "SameToken");
    });

    it("reverts when no pool exists for the pair", async function () {
      const Mock20 = await ethers.getContractFactory("MockERC20");
      const orphan = await Mock20.deploy("Orphan", "ORF", 18);

      await expect(
        adapter.connect(user).swap(
          await usdc.getAddress(),
          await orphan.getAddress(),
          USDC_AMT(10),
          1n
        )
      ).to.be.revertedWithCustomError(adapter, "NoPoolFound");
    });

    it("router slippage rejection bubbles up to caller", async function () {
      // Demand more than 1:1 → router will revert
      await expect(
        adapter.connect(user).swap(
          await usdc.getAddress(),
          await weth.getAddress(),
          USDC_AMT(100),
          USDC_AMT(101) // ask for more than what 1:1 produces
        )
      ).to.be.reverted;
    });

    it("resets approval to zero after swap (security invariant)", async function () {
      await adapter.connect(user).swap(
        await usdc.getAddress(),
        await weth.getAddress(),
        USDC_AMT(50),
        1n
      );
      const allowance = await usdc.allowance(
        await adapter.getAddress(),
        await router.getAddress()
      );
      expect(allowance).to.equal(0);
    });

    it("does not retain tokens after swap (atomic flow)", async function () {
      await adapter.connect(user).swap(
        await usdc.getAddress(),
        await weth.getAddress(),
        USDC_AMT(50),
        1n
      );
      expect(await usdc.balanceOf(await adapter.getAddress())).to.equal(0);
      expect(await weth.balanceOf(await adapter.getAddress())).to.equal(0);
    });
  });

  describe("hasPool", function () {
    it("returns true with the pool's fee tier and liquidity", async function () {
      const result = await adapter.hasPool(await usdc.getAddress(), await weth.getAddress());
      expect(result.exists).to.be.true;
      expect(result.fee).to.equal(500);
      expect(result.liquidity).to.equal(1_000_000n);
    });

    it("returns false when no pool exists", async function () {
      const Mock20 = await ethers.getContractFactory("MockERC20");
      const orphan = await Mock20.deploy("Orphan", "ORF", 18);
      const result = await adapter.hasPool(await usdc.getAddress(), await orphan.getAddress());
      expect(result.exists).to.be.false;
    });
  });

  describe("Admin functions", function () {
    it("addFeeTier appends a new tier", async function () {
      await adapter.connect(owner).addFeeTier(2500);
      expect(await adapter.feeTiers(4)).to.equal(2500);
    });

    it("addFeeTier rejects beyond MAX_FEE_TIERS", async function () {
      // Already 4 tiers, MAX_FEE_TIERS = 10
      for (let i = 0; i < 6; i++) {
        await adapter.connect(owner).addFeeTier(1000 + i);
      }
      // Now at 10
      await expect(adapter.connect(owner).addFeeTier(99))
        .to.be.revertedWithCustomError(adapter, "TooManyFeeTiers");
    });

    it("addFeeTier rejects from non-owner", async function () {
      await expect(adapter.connect(attacker).addFeeTier(2500))
        .to.be.revertedWithCustomError(adapter, "OnlyOwner");
    });

    it("transferOwnership rotates ownership", async function () {
      await adapter.connect(owner).transferOwnership(user.address);
      expect(await adapter.owner()).to.equal(user.address);
    });

    it("transferOwnership rejects zero address", async function () {
      await expect(adapter.connect(owner).transferOwnership(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(adapter, "ZeroAddress");
    });

    it("rescueTokens recovers stuck tokens to owner", async function () {
      await usdc.mint(await adapter.getAddress(), USDC_AMT(50));
      await adapter.connect(owner).rescueTokens(await usdc.getAddress(), owner.address, USDC_AMT(50));
      expect(await usdc.balanceOf(owner.address)).to.equal(USDC_AMT(50));
    });

    it("rescueTokens rejects zero address recipient", async function () {
      await expect(
        adapter.connect(owner).rescueTokens(await usdc.getAddress(), ethers.ZeroAddress, USDC_AMT(1))
      ).to.be.revertedWithCustomError(adapter, "ZeroAddress");
    });
  });
});
