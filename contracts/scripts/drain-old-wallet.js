/**
 * Drain native 0G from the compromised deployer wallet to the fresh admin.
 * Auto-computes (balance − gas) so no balance is left behind for the
 * attacker if the old key ever leaks further.
 *
 * Usage:
 *   DEPLOYER_PRIVATE_KEY=<old-key> FRESH_ADMIN=0x... \
 *     npx hardhat run scripts/drain-old-wallet.js --network og_mainnet
 */

const { ethers } = require("hardhat");

async function main() {
  const [signer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const fresh = process.env.FRESH_ADMIN;
  if (!fresh || !ethers.isAddress(fresh)) {
    throw new Error("FRESH_ADMIN env var not set or not a valid address");
  }
  if (fresh.toLowerCase() === signer.address.toLowerCase()) {
    throw new Error("FRESH_ADMIN == signer — refusing to drain to self");
  }

  console.log("Drain old wallet");
  console.log("  Network:   ", net.name, "(chainId", net.chainId, ")");
  console.log("  From:      ", signer.address);
  console.log("  To (fresh):", fresh);

  const balance = await ethers.provider.getBalance(signer.address);
  if (balance === 0n) {
    console.log("\nBalance is already zero — nothing to drain.");
    return;
  }
  console.log("\nCurrent balance:", ethers.formatEther(balance), "0G");

  // Estimate gas for a bare transfer (21000 is hard min). We buffer 30% and
  // read gasPrice from the provider so the tx actually lands.
  const gasLimit = 21000n;
  const feeData = await ethers.provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas ?? 1_000_000_000n; // 1 gwei fallback
  const gasCost = gasLimit * gasPrice;
  const buffered = (gasCost * 130n) / 100n; // 30% headroom

  if (balance <= buffered) {
    console.log("Balance too small to cover gas — leaving funds where they are.");
    return;
  }
  const value = balance - buffered;
  console.log(`  gasPrice:    ${ethers.formatUnits(gasPrice, "gwei")} gwei`);
  console.log(`  gasReserved: ${ethers.formatEther(buffered)} 0G`);
  console.log(`  Sending:     ${ethers.formatEther(value)} 0G`);

  const tx = await signer.sendTransaction({
    to: fresh,
    value,
    gasLimit,
  });
  console.log("\nTx:", tx.hash);
  await tx.wait();

  const remaining = await ethers.provider.getBalance(signer.address);
  console.log("Remaining on old wallet:", ethers.formatEther(remaining), "0G");
  console.log("Drain complete ✓");
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error("Drain failed:", err); process.exit(1); });
