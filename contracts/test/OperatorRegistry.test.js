const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("OperatorRegistry", function () {
  let registry;
  let owner, operatorA, operatorB, vaultUser;

  // Mandate enum: 0 = Conservative, 1 = Balanced, 2 = Tactical
  const Mandate = { Conservative: 0, Balanced: 1, Tactical: 2 };

  // Default OperatorInput struct (Phase 1: now with fees + recommendations)
  function makeInput(overrides = {}) {
    return {
      name: "Default Bot",
      description: "desc",
      endpoint: "",
      mandate: Mandate.Balanced,
      performanceFeeBps: 1500,        // 15%
      managementFeeBps: 200,          // 2%/year
      entryFeeBps: 0,
      exitFeeBps: 50,                 // 0.5%
      recommendedMaxPositionBps: 5000,
      recommendedConfidenceMinBps: 6000,
      recommendedStopLossBps: 1500,
      recommendedCooldownSeconds: 900,
      recommendedMaxActionsPerDay: 6,
      ...overrides,
    };
  }

  beforeEach(async function () {
    [owner, operatorA, operatorB, vaultUser] = await ethers.getSigners();

    const Registry = await ethers.getContractFactory("OperatorRegistry");
    registry = await Registry.deploy();
    await registry.waitForDeployment();
  });

  describe("Registration", function () {
    it("should register a new operator", async function () {
      await expect(
        registry.connect(operatorA).register(
          makeInput({
            name: "Aegis Alpha Bot",
            description: "Conservative momentum trading on BTC/ETH",
            endpoint: "https://aegis-alpha.io",
            mandate: Mandate.Conservative,
          })
        )
      )
        .to.emit(registry, "OperatorRegistered")
        .withArgs(operatorA.address, "Aegis Alpha Bot", Mandate.Conservative, anyValue());

      expect(await registry.totalOperators()).to.equal(1);
      expect(await registry.isRegistered(operatorA.address)).to.be.true;
      expect(await registry.isActive(operatorA.address)).to.be.true;

      const op = await registry.getOperator(operatorA.address);
      expect(op.wallet).to.equal(operatorA.address);
      expect(op.name).to.equal("Aegis Alpha Bot");
      expect(op.mandate).to.equal(Mandate.Conservative);
      expect(op.active).to.be.true;
      expect(op.performanceFeeBps).to.equal(1500);
      expect(op.managementFeeBps).to.equal(200);
    });

    it("should reject duplicate registration", async function () {
      await registry.connect(operatorA).register(makeInput({ name: "Bot1" }));
      await expect(
        registry.connect(operatorA).register(makeInput({ name: "Bot2" }))
      ).to.be.revertedWithCustomError(registry, "AlreadyRegistered");
    });

    it("should reject empty name", async function () {
      await expect(
        registry.connect(operatorA).register(makeInput({ name: "" }))
      ).to.be.revertedWithCustomError(registry, "EmptyName");
    });

    it("should reject overly long name", async function () {
      await expect(
        registry.connect(operatorA).register(makeInput({ name: "x".repeat(65) }))
      ).to.be.revertedWithCustomError(registry, "NameTooLong");
    });

    it("should reject overly long description", async function () {
      await expect(
        registry.connect(operatorA).register(makeInput({ description: "x".repeat(501) }))
      ).to.be.revertedWithCustomError(registry, "DescriptionTooLong");
    });

    it("should reject overly long endpoint", async function () {
      await expect(
        registry.connect(operatorA).register(makeInput({ endpoint: "https://" + "x".repeat(195) }))
      ).to.be.revertedWithCustomError(registry, "EndpointTooLong");
    });

    it("should reject performance fee above max", async function () {
      await expect(
        registry.connect(operatorA).register(makeInput({ performanceFeeBps: 3001 }))
      ).to.be.revertedWithCustomError(registry, "FeeAboveMax");
    });

    it("should reject management fee above max", async function () {
      await expect(
        registry.connect(operatorA).register(makeInput({ managementFeeBps: 501 }))
      ).to.be.revertedWithCustomError(registry, "FeeAboveMax");
    });

    it("should reject entry fee above max", async function () {
      await expect(
        registry.connect(operatorA).register(makeInput({ entryFeeBps: 201 }))
      ).to.be.revertedWithCustomError(registry, "FeeAboveMax");
    });

    it("should reject exit fee above max", async function () {
      await expect(
        registry.connect(operatorA).register(makeInput({ exitFeeBps: 201 }))
      ).to.be.revertedWithCustomError(registry, "FeeAboveMax");
    });

    it("should track multiple operators", async function () {
      await registry.connect(operatorA).register(
        makeInput({ name: "BotA", description: "descA", mandate: Mandate.Conservative })
      );
      await registry.connect(operatorB).register(
        makeInput({ name: "BotB", description: "descB", mandate: Mandate.Tactical })
      );

      expect(await registry.totalOperators()).to.equal(2);
      const list = await registry.getAllOperators();
      expect(list).to.deep.equal([operatorA.address, operatorB.address]);
    });
  });

  describe("Update Metadata", function () {
    beforeEach(async function () {
      await registry.connect(operatorA).register(makeInput({ name: "Original" }));
    });

    it("should update metadata", async function () {
      await expect(
        registry.connect(operatorA).updateMetadata(
          makeInput({
            name: "Updated Name",
            description: "New description",
            endpoint: "https://updated.io",
            mandate: Mandate.Tactical,
            performanceFeeBps: 2000,
          })
        )
      )
        .to.emit(registry, "OperatorUpdated")
        .withArgs(operatorA.address, "Updated Name", Mandate.Tactical);

      const op = await registry.getOperator(operatorA.address);
      expect(op.name).to.equal("Updated Name");
      expect(op.endpoint).to.equal("https://updated.io");
      expect(op.mandate).to.equal(Mandate.Tactical);
      expect(op.performanceFeeBps).to.equal(2000);
    });

    it("should not allow non-registered to update", async function () {
      await expect(
        registry.connect(operatorB).updateMetadata(makeInput({ name: "X" }))
      ).to.be.revertedWithCustomError(registry, "NotRegistered");
    });
  });

  describe("Activation", function () {
    beforeEach(async function () {
      await registry.connect(operatorA).register(makeInput({ name: "Bot" }));
    });

    it("should deactivate", async function () {
      await expect(registry.connect(operatorA).deactivate())
        .to.emit(registry, "OperatorDeactivated")
        .withArgs(operatorA.address);

      expect(await registry.isActive(operatorA.address)).to.be.false;
      expect(await registry.isRegistered(operatorA.address)).to.be.true;
    });

    it("should reactivate", async function () {
      await registry.connect(operatorA).deactivate();
      await expect(registry.connect(operatorA).activate())
        .to.emit(registry, "OperatorActivated")
        .withArgs(operatorA.address);

      expect(await registry.isActive(operatorA.address)).to.be.true;
    });
  });

  describe("Pagination", function () {
    it("should return paginated results", async function () {
      const signers = await ethers.getSigners();
      for (let i = 1; i <= 5; i++) {
        await registry.connect(signers[i]).register(makeInput({ name: `Bot${i}` }));
      }
      expect(await registry.totalOperators()).to.equal(5);

      const page1 = await registry.getOperatorPage(0, 3);
      expect(page1.length).to.equal(3);

      const page2 = await registry.getOperatorPage(3, 3);
      expect(page2.length).to.equal(2);

      const empty = await registry.getOperatorPage(10, 5);
      expect(empty.length).to.equal(0);
    });
  });
});

function anyValue() {
  return (val) => val !== undefined;
}
