/**
 * ExecutionRegistry — audit-pass behaviors:
 *   - admin actions emit events
 *   - authorizeFactory rejects EOA / zero address
 *   - Ownable2Step admin transfer flow
 *   - vault authorize / revoke / factory revoke event flow
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");

async function deployRegistry() {
  const Registry = await ethers.getContractFactory("ExecutionRegistry");
  const reg = await Registry.deploy();
  await reg.waitForDeployment();
  return reg;
}

async function deployStubFactory() {
  // Any contract works as "a contract"; reuse the registry as a stand-in.
  const Registry = await ethers.getContractFactory("ExecutionRegistry");
  const stub = await Registry.deploy();
  await stub.waitForDeployment();
  return stub;
}

describe("ExecutionRegistry — audit fixes", function () {
  describe("authorizeFactory", function () {
    it("rejects the zero address", async function () {
      const reg = await deployRegistry();
      await expect(reg.authorizeFactory(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(reg, "ZeroAddress");
    });

    it("rejects an EOA (no contract code)", async function () {
      const reg = await deployRegistry();
      const [, eoa] = await ethers.getSigners();
      await expect(reg.authorizeFactory(eoa.address))
        .to.be.revertedWithCustomError(reg, "FactoryNotAContract");
    });

    it("authorizes a contract address and emits FactoryAuthorized", async function () {
      const reg  = await deployRegistry();
      const stub = await deployStubFactory();
      const stubAddr = await stub.getAddress();
      await expect(reg.authorizeFactory(stubAddr))
        .to.emit(reg, "FactoryAuthorized")
        .withArgs(stubAddr);
      expect(await reg.authorizedFactories(stubAddr)).to.equal(true);
    });

    it("only callable by admin", async function () {
      const reg  = await deployRegistry();
      const stub = await deployStubFactory();
      const [, attacker] = await ethers.getSigners();
      await expect(
        reg.connect(attacker).authorizeFactory(await stub.getAddress())
      ).to.be.revertedWithCustomError(reg, "OnlyAdmin");
    });
  });

  describe("revokeFactory", function () {
    it("emits FactoryRevoked and clears the bit", async function () {
      const reg  = await deployRegistry();
      const stub = await deployStubFactory();
      const stubAddr = await stub.getAddress();
      await reg.authorizeFactory(stubAddr);
      await expect(reg.revokeFactory(stubAddr))
        .to.emit(reg, "FactoryRevoked")
        .withArgs(stubAddr);
      expect(await reg.authorizedFactories(stubAddr)).to.equal(false);
    });
  });

  describe("authorizeVault / revokeVault events", function () {
    it("authorizeVault emits VaultAuthorized", async function () {
      const reg = await deployRegistry();
      const [, fakeVault] = await ethers.getSigners();
      // admin can call authorizeVault directly (admin path on onlyFactoryOrAdmin)
      await expect(reg.authorizeVault(fakeVault.address))
        .to.emit(reg, "VaultAuthorized")
        .withArgs(fakeVault.address, await reg.admin());
      expect(await reg.authorizedVaults(fakeVault.address)).to.equal(true);
    });

    it("authorizeVault rejects zero address", async function () {
      const reg = await deployRegistry();
      await expect(reg.authorizeVault(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(reg, "ZeroAddress");
    });

    it("revokeVault emits VaultRevoked and is admin-only", async function () {
      const reg = await deployRegistry();
      const [, fakeVault, attacker] = await ethers.getSigners();
      await reg.authorizeVault(fakeVault.address);

      await expect(reg.connect(attacker).revokeVault(fakeVault.address))
        .to.be.revertedWithCustomError(reg, "OnlyAdmin");

      await expect(reg.revokeVault(fakeVault.address))
        .to.emit(reg, "VaultRevoked")
        .withArgs(fakeVault.address, await reg.admin());
      expect(await reg.authorizedVaults(fakeVault.address)).to.equal(false);
    });
  });

  describe("Ownable2Step admin transfer", function () {
    it("transferAdmin sets pendingAdmin and emits AdminTransferStarted", async function () {
      const reg = await deployRegistry();
      const [admin, newAdmin] = await ethers.getSigners();
      await expect(reg.transferAdmin(newAdmin.address))
        .to.emit(reg, "AdminTransferStarted")
        .withArgs(admin.address, newAdmin.address);
      expect(await reg.pendingAdmin()).to.equal(newAdmin.address);
      // admin slot unchanged until accepted
      expect(await reg.admin()).to.equal(admin.address);
    });

    it("acceptAdmin promotes pendingAdmin and emits AdminTransferred", async function () {
      const reg = await deployRegistry();
      const [admin, newAdmin] = await ethers.getSigners();
      await reg.transferAdmin(newAdmin.address);
      await expect(reg.connect(newAdmin).acceptAdmin())
        .to.emit(reg, "AdminTransferred")
        .withArgs(admin.address, newAdmin.address);
      expect(await reg.admin()).to.equal(newAdmin.address);
      expect(await reg.pendingAdmin()).to.equal(ethers.ZeroAddress);
    });

    it("acceptAdmin rejects callers who are not pendingAdmin", async function () {
      const reg = await deployRegistry();
      const [, newAdmin, attacker] = await ethers.getSigners();
      await reg.transferAdmin(newAdmin.address);
      await expect(reg.connect(attacker).acceptAdmin())
        .to.be.revertedWithCustomError(reg, "OnlyPendingAdmin");
    });

    it("transferAdmin rejects the zero address", async function () {
      const reg = await deployRegistry();
      await expect(reg.transferAdmin(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(reg, "ZeroAddress");
    });

    it("cancelAdminTransfer clears pendingAdmin and is admin-only", async function () {
      const reg = await deployRegistry();
      const [, newAdmin, attacker] = await ethers.getSigners();
      await reg.transferAdmin(newAdmin.address);
      await expect(reg.connect(attacker).cancelAdminTransfer())
        .to.be.revertedWithCustomError(reg, "OnlyAdmin");
      await reg.cancelAdminTransfer();
      expect(await reg.pendingAdmin()).to.equal(ethers.ZeroAddress);
      // Pending admin can no longer accept after cancel
      await expect(reg.connect(newAdmin).acceptAdmin())
        .to.be.revertedWithCustomError(reg, "OnlyPendingAdmin");
    });

    it("subsequent transferAdmin overwrites pendingAdmin (typo correction)", async function () {
      const reg = await deployRegistry();
      const [, wrongAdmin, correctAdmin] = await ethers.getSigners();
      await reg.transferAdmin(wrongAdmin.address);
      await reg.transferAdmin(correctAdmin.address);
      expect(await reg.pendingAdmin()).to.equal(correctAdmin.address);
      await expect(reg.connect(wrongAdmin).acceptAdmin())
        .to.be.revertedWithCustomError(reg, "OnlyPendingAdmin");
    });
  });
});
