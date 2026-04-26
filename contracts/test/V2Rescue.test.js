/**
 * V2Rescue.test.js — verifies the rescue paths added in:
 *   - AegisVault_v2    (withdrawToken, withdrawAllNonBase)
 *   - OperatorStaking_v2  (rescueToken)
 *   - InsurancePool_v2    (rescueToken)
 *
 * Focus is on the NEW surface only — v1 behavior is already covered by
 * AegisVault.test.js / OperatorStaking.test.js. Here we just need:
 *   (a) rescue paths transfer the right amount and emit the right event
 *   (b) protected tokens (baseAsset / stakeToken / payoutToken) are blocked
 *   (c) only the correct role (owner / arbitrator) can call
 *   (d) MAX_ALLOWED_ASSETS cap at init
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");

// Shared policy (unpaused) matching the v2 VaultPolicy struct.
function v2Policy(overrides = {}) {
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

// Deploy the three slim libraries then link them into AegisVault_v2. Mirrors
// the v1 helper in AegisVault.test.js but targets the v2 contract.
async function deployV2Impl() {
  const ExecLib   = await ethers.getContractFactory("ExecLib");
  const SealedLib = await ethers.getContractFactory("SealedLib");
  const IOLib     = await ethers.getContractFactory("IOLib");

  const execLib   = await ExecLib.deploy();   await execLib.waitForDeployment();
  const sealedLib = await SealedLib.deploy(); await sealedLib.waitForDeployment();
  const ioLib     = await IOLib.deploy();     await ioLib.waitForDeployment();

  const VaultV2 = await ethers.getContractFactory("AegisVault_v2", {
    libraries: {
      ExecLib:   await execLib.getAddress(),
      SealedLib: await sealedLib.getAddress(),
      IOLib:     await ioLib.getAddress(),
    },
  });
  const impl = await VaultV2.deploy();
  await impl.waitForDeployment();
  return { impl, VaultV2 };
}

describe("AegisVault_v2 rescue paths", function () {
  let owner, attacker, treasury;
  let usdc, wbtc, weth, w0g;
  let registry, factory, vault;

  beforeEach(async function () {
    [owner, attacker, treasury] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    usdc = await MockERC20.deploy("USDC", "USDC", 6);
    wbtc = await MockERC20.deploy("WBTC", "WBTC", 8);
    weth = await MockERC20.deploy("WETH", "WETH", 18);
    w0g  = await MockERC20.deploy("Wrapped 0G", "W0G", 18);

    const ExecutionRegistry = await ethers.getContractFactory("ExecutionRegistry");
    registry = await ExecutionRegistry.deploy();

    const { impl } = await deployV2Impl();
    const Factory = await ethers.getContractFactory("AegisVaultFactory");
    factory = await Factory.deploy(
      await impl.getAddress(),
      await registry.getAddress(),
      treasury.address
    );
    await factory.waitForDeployment();

    // Multi-factory path: deployer remains registry admin, factory is added
    // to the authorizedFactories set. Avoids the legacy admin-rotation pattern
    // which became 2-step (Ownable2Step) and would otherwise need an
    // intermediate `acceptAdmin()` call from the factory.
    await registry.authorizeFactory(await factory.getAddress());

    // Create a v2 vault, USDC-base, with WBTC/WETH/W0G as allowed assets.
    const allowed = [await usdc.getAddress(), await wbtc.getAddress(), await weth.getAddress(), await w0g.getAddress()];
    const tx = await factory.connect(owner).createVault(
      await usdc.getAddress(),
      owner.address, // executor (placeholder; not used by rescue)
      ethers.ZeroAddress, // venue (unused for rescue)
      v2Policy(),
      allowed,
    );
    const rc = await tx.wait();
    const evt = rc.logs.find((l) => l.fragment?.name === "VaultDeployed");
    const vaultAddr = evt.args.vault;

    // Attach the v2 ABI to the freshly-cloned proxy. withdrawToken /
    // withdrawAllNonBase are local (no library call), so we don't need to
    // re-link libraries here — getContractAt is enough.
    vault = await ethers.getContractAt("AegisVault_v2", vaultAddr);
  });

  it("withdrawToken reverts when called with the base asset", async function () {
    await usdc.mint(await vault.getAddress(), ethers.parseUnits("100", 6));
    await expect(
      vault.connect(owner).withdrawToken(await usdc.getAddress(), 1)
    ).to.be.revertedWith("use withdraw()");
  });

  it("withdrawToken reverts for non-owner callers", async function () {
    await w0g.mint(await vault.getAddress(), ethers.parseUnits("5", 18));
    await expect(
      vault.connect(attacker).withdrawToken(await w0g.getAddress(), 1)
    ).to.be.revertedWith("wt");
  });

  it("withdrawToken reverts on zero args", async function () {
    await expect(
      vault.connect(owner).withdrawToken(ethers.ZeroAddress, 1)
    ).to.be.revertedWith("bad args");
    await expect(
      vault.connect(owner).withdrawToken(await w0g.getAddress(), 0)
    ).to.be.revertedWith("bad args");
  });

  it("withdrawToken transfers the correct amount and emits TokenWithdrawn", async function () {
    const amount = ethers.parseUnits("3.5", 18);
    await w0g.mint(await vault.getAddress(), amount);

    const ownerBalBefore = await w0g.balanceOf(owner.address);
    await expect(
      vault.connect(owner).withdrawToken(await w0g.getAddress(), amount)
    )
      .to.emit(vault, "TokenWithdrawn")
      .withArgs(await vault.getAddress(), await w0g.getAddress(), owner.address, amount);

    expect(await w0g.balanceOf(owner.address)).to.equal(ownerBalBefore + amount);
    expect(await w0g.balanceOf(await vault.getAddress())).to.equal(0);
  });

  it("withdrawAllNonBase drains WBTC + WETH + W0G, skips USDC, emits per-token", async function () {
    await usdc.mint(await vault.getAddress(), ethers.parseUnits("1000", 6));
    await wbtc.mint(await vault.getAddress(), ethers.parseUnits("0.1", 8));
    await weth.mint(await vault.getAddress(), ethers.parseUnits("2", 18));
    await w0g.mint(await vault.getAddress(),  ethers.parseUnits("5", 18));

    const usdcBefore = await usdc.balanceOf(await vault.getAddress());
    const wbtcOwnerBefore = await wbtc.balanceOf(owner.address);
    const wethOwnerBefore = await weth.balanceOf(owner.address);
    const w0gOwnerBefore  = await w0g.balanceOf(owner.address);

    await expect(vault.connect(owner).withdrawAllNonBase())
      .to.emit(vault, "TokenWithdrawn");

    // Base asset untouched
    expect(await usdc.balanceOf(await vault.getAddress())).to.equal(usdcBefore);

    // Non-base drained
    expect(await wbtc.balanceOf(await vault.getAddress())).to.equal(0);
    expect(await weth.balanceOf(await vault.getAddress())).to.equal(0);
    expect(await w0g.balanceOf(await vault.getAddress())).to.equal(0);

    // Owner received everything
    expect(await wbtc.balanceOf(owner.address)).to.equal(wbtcOwnerBefore + ethers.parseUnits("0.1", 8));
    expect(await weth.balanceOf(owner.address)).to.equal(wethOwnerBefore + ethers.parseUnits("2", 18));
    expect(await w0g.balanceOf(owner.address)).to.equal(w0gOwnerBefore + ethers.parseUnits("5", 18));
  });

  it("withdrawAllNonBase skips tokens with zero balance (doesn't revert)", async function () {
    // Only one token funded; the others should be silently skipped
    await weth.mint(await vault.getAddress(), ethers.parseUnits("1", 18));
    await expect(vault.connect(owner).withdrawAllNonBase()).to.not.be.reverted;
    expect(await weth.balanceOf(owner.address)).to.be.gte(ethers.parseUnits("1", 18));
  });

  it("withdrawAllNonBase reverts for non-owner callers", async function () {
    await w0g.mint(await vault.getAddress(), ethers.parseUnits("1", 18));
    await expect(
      vault.connect(attacker).withdrawAllNonBase()
    ).to.be.revertedWith("wa");
  });

  it("initialize reverts when allowed assets exceed MAX_ALLOWED_ASSETS (10)", async function () {
    // Build an 11-asset allowed list. Addresses don't have to be real; cap
    // enforcement is purely a length check.
    const allowed = [];
    for (let i = 0; i < 11; i++) {
      const t = await (await ethers.getContractFactory("MockERC20")).deploy(`T${i}`, `T${i}`, 18);
      allowed.push(await t.getAddress());
    }
    await expect(
      factory.connect(owner).createVault(
        await usdc.getAddress(),
        owner.address,
        ethers.ZeroAddress,
        v2Policy(),
        allowed,
      )
    ).to.be.revertedWith("too many assets");
  });
});

describe("OperatorStaking_v2 rescueToken", function () {
  let arbitrator, operator, attacker, rescueReceiver;
  let usdc, strayToken, staking, pool, registry;

  beforeEach(async function () {
    [arbitrator, operator, attacker, rescueReceiver] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    usdc       = await MockERC20.deploy("USDC", "USDC", 6);
    strayToken = await MockERC20.deploy("StrayToken", "STRAY", 18);

    // Minimal registry so staking's constructor check passes
    const OperatorRegistry = await ethers.getContractFactory("OperatorRegistry");
    registry = await OperatorRegistry.deploy();

    // Placeholder pool (v2 staking expects a pool address non-zero; no calls made in rescue test)
    const InsurancePoolV2 = await ethers.getContractFactory("InsurancePool_v2");
    pool = await InsurancePoolV2.deploy(await usdc.getAddress(), arbitrator.address);

    const StakingV2 = await ethers.getContractFactory("OperatorStaking_v2");
    staking = await StakingV2.deploy(
      await usdc.getAddress(),
      await registry.getAddress(),
      await pool.getAddress(),
      arbitrator.address,
    );
  });

  it("rescueToken reverts when the stakeToken (USDC) is targeted", async function () {
    await usdc.mint(await staking.getAddress(), ethers.parseUnits("10", 6));
    await expect(
      staking.connect(arbitrator).rescueToken(await usdc.getAddress(), rescueReceiver.address, 1)
    ).to.be.revertedWithCustomError(staking, "CannotRescueStakeToken");
  });

  it("rescueToken reverts for non-arbitrator callers", async function () {
    await strayToken.mint(await staking.getAddress(), ethers.parseUnits("5", 18));
    await expect(
      staking.connect(attacker).rescueToken(await strayToken.getAddress(), rescueReceiver.address, 1)
    ).to.be.revertedWithCustomError(staking, "NotArbitrator");
  });

  it("rescueToken transfers non-stakeToken and emits TokenRescued", async function () {
    const amount = ethers.parseUnits("7", 18);
    await strayToken.mint(await staking.getAddress(), amount);

    await expect(
      staking.connect(arbitrator).rescueToken(await strayToken.getAddress(), rescueReceiver.address, amount)
    )
      .to.emit(staking, "TokenRescued")
      .withArgs(await strayToken.getAddress(), rescueReceiver.address, amount);

    expect(await strayToken.balanceOf(rescueReceiver.address)).to.equal(amount);
    expect(await strayToken.balanceOf(await staking.getAddress())).to.equal(0);
  });
});

describe("InsurancePool_v2 rescueToken", function () {
  let arbitrator, attacker, rescueReceiver;
  let usdc, strayToken, pool;

  beforeEach(async function () {
    [arbitrator, attacker, rescueReceiver] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    usdc       = await MockERC20.deploy("USDC", "USDC", 6);
    strayToken = await MockERC20.deploy("StrayToken", "STRAY", 18);

    const PoolV2 = await ethers.getContractFactory("InsurancePool_v2");
    pool = await PoolV2.deploy(await usdc.getAddress(), arbitrator.address);
  });

  it("rescueToken reverts when the payoutToken (USDC) is targeted", async function () {
    await usdc.mint(await pool.getAddress(), ethers.parseUnits("10", 6));
    await expect(
      pool.connect(arbitrator).rescueToken(await usdc.getAddress(), rescueReceiver.address, 1)
    ).to.be.revertedWithCustomError(pool, "CannotRescuePayoutToken");
  });

  it("rescueToken reverts for non-arbitrator callers", async function () {
    await strayToken.mint(await pool.getAddress(), ethers.parseUnits("5", 18));
    await expect(
      pool.connect(attacker).rescueToken(await strayToken.getAddress(), rescueReceiver.address, 1)
    ).to.be.revertedWithCustomError(pool, "NotArbitrator");
  });

  it("rescueToken transfers non-payoutToken and emits TokenRescued", async function () {
    const amount = ethers.parseUnits("2.5", 18);
    await strayToken.mint(await pool.getAddress(), amount);

    await expect(
      pool.connect(arbitrator).rescueToken(await strayToken.getAddress(), rescueReceiver.address, amount)
    )
      .to.emit(pool, "TokenRescued")
      .withArgs(await strayToken.getAddress(), rescueReceiver.address, amount);

    expect(await strayToken.balanceOf(rescueReceiver.address)).to.equal(amount);
    expect(await strayToken.balanceOf(await pool.getAddress())).to.equal(0);
  });
});
