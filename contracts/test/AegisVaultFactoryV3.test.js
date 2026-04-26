/**
 * AegisVaultFactoryV3.test.js — verifies the factory's role mapping and
 * boundary checks.
 *
 *   The audit-flagged invariant: caller of createVault becomes the vault's
 *   `owner` (depositor with withdrawal authority) and the `_operator`
 *   argument becomes the vault's `executor` (orchestrator wallet allowed to
 *   submit signed intents). Inverting these would let the operator drain
 *   deposits via withdraw().
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");

function defaultPolicy(attestedSigner = ethers.ZeroAddress) {
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
  };
}

async function deployStack() {
  const [admin, depositor, operator, treasury] = await ethers.getSigners();

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const usdc = await MockERC20.deploy("USDC", "USDC", 6);

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

  const Registry = await ethers.getContractFactory("ExecutionRegistry");
  const registry = await Registry.deploy();
  await registry.waitForDeployment();

  const Factory = await ethers.getContractFactory("AegisVaultFactoryV3");
  const factory = await Factory.deploy(
    await impl.getAddress(),
    await registry.getAddress(),
    treasury.address
  );
  await factory.waitForDeployment();

  // Multi-factory path: deployer remains registry admin, factory is added
  // to authorizedFactories so its createVault can call registry.authorizeVault.
  await registry.authorizeFactory(await factory.getAddress());

  return { admin, depositor, operator, treasury, usdc, registry, factory, VaultV3 };
}

describe("AegisVaultFactoryV3", function () {
  describe("Role mapping (audit Finding #1)", function () {
    it("assigns msg.sender as owner and _operator as executor", async function () {
      const { depositor, operator, usdc, factory, VaultV3 } = await deployStack();

      const tx = await factory.connect(depositor).createVault(
        operator.address,
        await usdc.getAddress(),
        ethers.ZeroAddress, // venue not exercised here
        defaultPolicy(),
        [await usdc.getAddress()],
        50
      );
      const receipt = await tx.wait();
      const ev = receipt.logs
        .map((l) => { try { return factory.interface.parseLog(l); } catch { return null; } })
        .find((p) => p && p.name === "VaultDeployed");
      expect(ev, "VaultDeployed not emitted").to.not.equal(null);

      const vaultAddr = ev.args.vault;
      const vault = VaultV3.attach(vaultAddr);

      expect(await vault.owner()).to.equal(depositor.address);
      expect(await vault.executor()).to.equal(operator.address);
      expect(ev.args.owner).to.equal(depositor.address);
      expect(ev.args.operator).to.equal(operator.address);
      expect(ev.args.requestedMaxCrossChainFeeBps).to.equal(50);
    });

    it("indexes ownerVaults by depositor (msg.sender), not operator", async function () {
      const { depositor, operator, usdc, factory } = await deployStack();

      await factory.connect(depositor).createVault(
        operator.address,
        await usdc.getAddress(),
        ethers.ZeroAddress,
        defaultPolicy(),
        [await usdc.getAddress()],
        50
      );

      const depositorVaults = await factory.getOwnerVaults(depositor.address);
      const operatorVaults  = await factory.getOwnerVaults(operator.address);
      expect(depositorVaults.length).to.equal(1);
      expect(operatorVaults.length).to.equal(0);
    });

    it("a depositor can withdraw, the operator cannot", async function () {
      const { depositor, operator, usdc, factory, VaultV3 } = await deployStack();

      const tx = await factory.connect(depositor).createVault(
        operator.address,
        await usdc.getAddress(),
        ethers.ZeroAddress,
        defaultPolicy(),
        [await usdc.getAddress()],
        50
      );
      const receipt = await tx.wait();
      const ev = receipt.logs
        .map((l) => { try { return factory.interface.parseLog(l); } catch { return null; } })
        .find((p) => p && p.name === "VaultDeployed");
      const vault = VaultV3.attach(ev.args.vault);

      // Pre-fund + approve so deposit() doesn't trip on allowance/balance.
      await usdc.mint(depositor.address, ethers.parseUnits("1000", 6));
      await usdc.connect(depositor).approve(await vault.getAddress(), ethers.parseUnits("1000", 6));
      await vault.connect(depositor).deposit(ethers.parseUnits("1000", 6));

      // Operator must NOT be able to withdraw — they only hold executor role.
      await expect(
        vault.connect(operator).withdraw(ethers.parseUnits("100", 6))
      ).to.be.revertedWith("w");

      // Depositor (owner) can withdraw.
      await vault.connect(depositor).withdraw(ethers.parseUnits("100", 6));
    });
  });

  describe("Cap + zero-address validation", function () {
    it("rejects _maxCrossChainFeeBps above 200 bps", async function () {
      const { depositor, operator, usdc, factory } = await deployStack();
      await expect(
        factory.connect(depositor).createVault(
          operator.address,
          await usdc.getAddress(),
          ethers.ZeroAddress,
          defaultPolicy(),
          [await usdc.getAddress()],
          201
        )
      ).to.be.revertedWithCustomError(factory, "CrossChainFeeCapTooHigh");
    });

    it("rejects zero operator", async function () {
      const { depositor, usdc, factory } = await deployStack();
      await expect(
        factory.connect(depositor).createVault(
          ethers.ZeroAddress,
          await usdc.getAddress(),
          ethers.ZeroAddress,
          defaultPolicy(),
          [await usdc.getAddress()],
          50
        )
      ).to.be.revertedWithCustomError(factory, "ZeroAddress");
    });

    it("reverts FactoryNotRegistryAdmin when factory was never made registry admin", async function () {
      const { depositor, operator, usdc, factory } = await deployStack();

      // Spin up a fresh registry whose admin is the deployer (not the new
      // factory we're about to instantiate) and a sibling factory pointed at
      // it — the canonical drift scenario.
      const Registry = await ethers.getContractFactory("ExecutionRegistry");
      const orphanRegistry = await Registry.deploy();
      await orphanRegistry.waitForDeployment();

      const Factory = await ethers.getContractFactory("AegisVaultFactoryV3");
      const orphanFactory = await Factory.deploy(
        await factory.vaultImplementation(),
        await orphanRegistry.getAddress(),
        ethers.ZeroAddress
      );
      await orphanFactory.waitForDeployment();

      await expect(
        orphanFactory.connect(depositor).createVault(
          operator.address,
          await usdc.getAddress(),
          ethers.ZeroAddress,
          defaultPolicy(),
          [await usdc.getAddress()],
          50
        )
      ).to.be.revertedWithCustomError(orphanFactory, "FactoryNotRegistryAdmin");
    });

    it("creates a vault when the factory is registered via authorizeFactory (multi-factory path)", async function () {
      const { depositor, operator, usdc, factory } = await deployStack();

      // Production sequence: registry stays admin'd by an initial owner (or
      // multisig) which then calls `authorizeFactory` for each track-version
      // factory. v1 + v3 coexist on a single registry without rotating admin.
      const Registry = await ethers.getContractFactory("ExecutionRegistry");
      const sharedRegistry = await Registry.deploy();
      await sharedRegistry.waitForDeployment();

      const Factory = await ethers.getContractFactory("AegisVaultFactoryV3");
      const sibling = await Factory.deploy(
        await factory.vaultImplementation(),
        await sharedRegistry.getAddress(),
        ethers.ZeroAddress
      );
      await sibling.waitForDeployment();

      await sharedRegistry.authorizeFactory(await sibling.getAddress());

      const tx = await sibling.connect(depositor).createVault(
        operator.address,
        await usdc.getAddress(),
        ethers.ZeroAddress,
        defaultPolicy(),
        [await usdc.getAddress()],
        50
      );
      const receipt = await tx.wait();
      const ev = receipt.logs
        .map((l) => { try { return sibling.interface.parseLog(l); } catch { return null; } })
        .find((p) => p && p.name === "VaultDeployed");
      expect(ev).to.not.equal(null);
      expect(await sharedRegistry.authorizedVaults(ev.args.vault)).to.equal(true);
    });
  });
});
