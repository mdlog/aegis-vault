/**
 * whoami.js
 *
 * Prints the address + balance of the wallet loaded from .env,
 * without ever logging the private key itself. Useful to confirm
 * DEPLOYER_PRIVATE_KEY in .env maps to the wallet you expect.
 *
 * Usage:
 *   npx hardhat run scripts/whoami.js --network og_mainnet
 */

const { ethers } = require("hardhat");

async function main() {
  const signers = await ethers.getSigners();
  if (signers.length === 0) {
    throw new Error(
      "No signer loaded. DEPLOYER_PRIVATE_KEY is missing from .env, " +
      "or hardhat.config.js is not loading the .env file."
    );
  }
  const signer = signers[0];
  const network = await ethers.provider.getNetwork();
  const balance = await ethers.provider.getBalance(signer.address);

  console.log("╔════════════════════════════════════════════════╗");
  console.log("║   Wallet identity check                        ║");
  console.log("╚════════════════════════════════════════════════╝");
  console.log("");
  console.log("  Address:      ", signer.address);
  console.log("  Network:      ", network.name);
  console.log("  Chain ID:     ", Number(network.chainId));
  console.log("  Balance:      ", ethers.formatEther(balance), "native");
  console.log("");

  // Balance sanity check for deploy
  if (Number(network.chainId) === 16661) {
    const minForDeploy = ethers.parseEther("0.1");
    if (balance < minForDeploy) {
      console.log(`  ⚠  Balance below 0.1 0G — insufficient for full deploy.`);
    } else {
      console.log(`  ✓ Balance sufficient for full mainnet deploy (≥ 0.1 0G).`);
    }
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
