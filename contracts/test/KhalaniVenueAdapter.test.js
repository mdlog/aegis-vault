/**
 * KhalaniVenueAdapter.test.js
 *
 * Coverage for the view-only Khalani route registry. The adapter holds no
 * funds and never moves tokens — Khalani settlement is solver-fulfilled
 * off-chain — so these tests exercise admin gating, mapping flips, event
 * emission, custom-error reverts, and the pure {khalaniApiBase} constant.
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");

const ABSOLUTE_FEE_CAP_BPS = 200;
const DEFAULT_FEE_BPS = 50;
const KHALANI_API_BASE = "https://api.hyperstream.dev";

async function deployFixture(initialFee = DEFAULT_FEE_BPS) {
  const [deployer, alice, bob, carol] = await ethers.getSigners();
  const Factory = await ethers.getContractFactory("KhalaniVenueAdapter");
  const adapter = await Factory.deploy(initialFee);
  await adapter.waitForDeployment();
  return { adapter, deployer, alice, bob, carol, Factory };
}

describe("KhalaniVenueAdapter", function () {
  describe("Constructor", function () {
    it("sets owner = msg.sender", async function () {
      const { adapter, deployer } = await deployFixture();
      expect(await adapter.owner()).to.equal(deployer.address);
    });

    it("sets defaultMaxFeeBps = constructor argument", async function () {
      const { adapter } = await deployFixture(DEFAULT_FEE_BPS);
      expect(await adapter.defaultMaxFeeBps()).to.equal(DEFAULT_FEE_BPS);
    });

    it("reverts with FeeBpsTooHigh if constructor arg > ABSOLUTE_FEE_CAP_BPS (200)", async function () {
      const Factory = await ethers.getContractFactory("KhalaniVenueAdapter");
      await expect(Factory.deploy(ABSOLUTE_FEE_CAP_BPS + 1)).to.be.revertedWithCustomError(
        Factory,
        "FeeBpsTooHigh"
      );
    });

    it("emits OwnershipTransferred(0x0, deployer) and MaxFeeBpsUpdated(0, defaultMaxFeeBps) at deploy", async function () {
      const [deployer] = await ethers.getSigners();
      const Factory = await ethers.getContractFactory("KhalaniVenueAdapter");
      const adapter = await Factory.deploy(DEFAULT_FEE_BPS);
      const tx = adapter.deploymentTransaction();
      await expect(tx)
        .to.emit(adapter, "OwnershipTransferred")
        .withArgs(ethers.ZeroAddress, deployer.address);
      await expect(tx)
        .to.emit(adapter, "MaxFeeBpsUpdated")
        .withArgs(0, DEFAULT_FEE_BPS);
    });
  });

  describe("Admin: setChainAllowed", function () {
    it("setChainAllowed(chainId, true) — owner success: emits ChainAllowed and flips mapping", async function () {
      const { adapter } = await deployFixture();
      const chainId = 16661n;
      await expect(adapter.setChainAllowed(chainId, true))
        .to.emit(adapter, "ChainAllowed")
        .withArgs(chainId, true);
      expect(await adapter.allowedChains(chainId)).to.equal(true);
    });

    it("setChainAllowed(chainId, false) — flips back", async function () {
      const { adapter } = await deployFixture();
      const chainId = 16661n;
      await adapter.setChainAllowed(chainId, true);
      expect(await adapter.allowedChains(chainId)).to.equal(true);

      await expect(adapter.setChainAllowed(chainId, false))
        .to.emit(adapter, "ChainAllowed")
        .withArgs(chainId, false);
      expect(await adapter.allowedChains(chainId)).to.equal(false);
    });

    it("setChainAllowed reverts OnlyOwner for non-owner caller", async function () {
      const { adapter, alice } = await deployFixture();
      await expect(
        adapter.connect(alice).setChainAllowed(1n, true)
      ).to.be.revertedWithCustomError(adapter, "OnlyOwner");
    });
  });

  describe("Admin: setTokenAllowed", function () {
    it("setTokenAllowed(token, true) — owner success: emits and flips mapping", async function () {
      const { adapter, bob } = await deployFixture();
      const token = bob.address; // any non-zero address suffices for a registry
      await expect(adapter.setTokenAllowed(token, true))
        .to.emit(adapter, "TokenAllowed")
        .withArgs(token, true);
      expect(await adapter.allowedTokens(token)).to.equal(true);
    });

    it("setTokenAllowed(0x0, true) — reverts ZeroAddress", async function () {
      const { adapter } = await deployFixture();
      await expect(
        adapter.setTokenAllowed(ethers.ZeroAddress, true)
      ).to.be.revertedWithCustomError(adapter, "ZeroAddress");
    });

    it("setTokenAllowed reverts OnlyOwner for non-owner", async function () {
      const { adapter, alice, bob } = await deployFixture();
      await expect(
        adapter.connect(alice).setTokenAllowed(bob.address, true)
      ).to.be.revertedWithCustomError(adapter, "OnlyOwner");
    });
  });

  describe("Admin: setDefaultMaxFeeBps", function () {
    it("setDefaultMaxFeeBps(newBps) — owner success: emits MaxFeeBpsUpdated(old, new) and updates value", async function () {
      const { adapter } = await deployFixture(DEFAULT_FEE_BPS);
      const newBps = 120;
      await expect(adapter.setDefaultMaxFeeBps(newBps))
        .to.emit(adapter, "MaxFeeBpsUpdated")
        .withArgs(DEFAULT_FEE_BPS, newBps);
      expect(await adapter.defaultMaxFeeBps()).to.equal(newBps);
    });

    it("setDefaultMaxFeeBps(201) — reverts FeeBpsTooHigh", async function () {
      const { adapter } = await deployFixture();
      await expect(
        adapter.setDefaultMaxFeeBps(ABSOLUTE_FEE_CAP_BPS + 1)
      ).to.be.revertedWithCustomError(adapter, "FeeBpsTooHigh");
    });

    it("setDefaultMaxFeeBps reverts OnlyOwner for non-owner", async function () {
      const { adapter, alice } = await deployFixture();
      await expect(
        adapter.connect(alice).setDefaultMaxFeeBps(75)
      ).to.be.revertedWithCustomError(adapter, "OnlyOwner");
    });
  });

  describe("Admin: transferOwnership", function () {
    it("transferOwnership(newOwner) — emits OwnershipTransferred(old, new), owner updates", async function () {
      const { adapter, deployer, alice } = await deployFixture();
      await expect(adapter.transferOwnership(alice.address))
        .to.emit(adapter, "OwnershipTransferred")
        .withArgs(deployer.address, alice.address);
      expect(await adapter.owner()).to.equal(alice.address);
    });

    it("transferOwnership(0x0) — reverts ZeroAddress", async function () {
      const { adapter } = await deployFixture();
      await expect(
        adapter.transferOwnership(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(adapter, "ZeroAddress");
    });

    it("transferOwnership reverts OnlyOwner for non-owner", async function () {
      const { adapter, alice, bob } = await deployFixture();
      await expect(
        adapter.connect(alice).transferOwnership(bob.address)
      ).to.be.revertedWithCustomError(adapter, "OnlyOwner");
    });
  });

  describe("View: isRouteAllowed", function () {
    const CHAIN_ID = 16661n;
    let adapter;
    let tokenIn;
    let tokenOut;

    beforeEach(async function () {
      const fx = await deployFixture();
      adapter = fx.adapter;
      tokenIn = fx.alice.address;
      tokenOut = fx.bob.address;
    });

    it("returns true when chain + both tokens are all allowed and tokenIn != tokenOut", async function () {
      await adapter.setChainAllowed(CHAIN_ID, true);
      await adapter.setTokenAllowed(tokenIn, true);
      await adapter.setTokenAllowed(tokenOut, true);
      expect(await adapter.isRouteAllowed(CHAIN_ID, tokenIn, tokenOut)).to.equal(true);
    });

    it("returns false when chain not allowed (even if both tokens are)", async function () {
      await adapter.setTokenAllowed(tokenIn, true);
      await adapter.setTokenAllowed(tokenOut, true);
      // chain deliberately NOT allowed
      expect(await adapter.isRouteAllowed(CHAIN_ID, tokenIn, tokenOut)).to.equal(false);
    });

    it("returns false when tokenIn not allowed", async function () {
      await adapter.setChainAllowed(CHAIN_ID, true);
      await adapter.setTokenAllowed(tokenOut, true);
      // tokenIn deliberately NOT allowed
      expect(await adapter.isRouteAllowed(CHAIN_ID, tokenIn, tokenOut)).to.equal(false);
    });

    it("returns false when tokenOut not allowed", async function () {
      await adapter.setChainAllowed(CHAIN_ID, true);
      await adapter.setTokenAllowed(tokenIn, true);
      // tokenOut deliberately NOT allowed
      expect(await adapter.isRouteAllowed(CHAIN_ID, tokenIn, tokenOut)).to.equal(false);
    });

    it("returns false when tokenIn == tokenOut", async function () {
      await adapter.setChainAllowed(CHAIN_ID, true);
      await adapter.setTokenAllowed(tokenIn, true);
      expect(await adapter.isRouteAllowed(CHAIN_ID, tokenIn, tokenIn)).to.equal(false);
    });

    it("returns false when tokenIn == 0x0 OR tokenOut == 0x0", async function () {
      await adapter.setChainAllowed(CHAIN_ID, true);
      await adapter.setTokenAllowed(tokenIn, true);
      await adapter.setTokenAllowed(tokenOut, true);

      expect(
        await adapter.isRouteAllowed(CHAIN_ID, ethers.ZeroAddress, tokenOut)
      ).to.equal(false);
      expect(
        await adapter.isRouteAllowed(CHAIN_ID, tokenIn, ethers.ZeroAddress)
      ).to.equal(false);
      expect(
        await adapter.isRouteAllowed(CHAIN_ID, ethers.ZeroAddress, ethers.ZeroAddress)
      ).to.equal(false);
    });
  });

  describe("Constant: khalaniApiBase", function () {
    it('returns the literal string "https://api.hyperstream.dev"', async function () {
      const { adapter } = await deployFixture();
      expect(await adapter.khalaniApiBase()).to.equal(KHALANI_API_BASE);
    });
  });
});
