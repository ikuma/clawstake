const hre = require("hardhat");
require("dotenv").config();

const CLAWSTAKE_ABI = [
  "function resolve(string calldata marketSlug, bool outcomeYes) external",
  "function getMarketInfo(string calldata marketSlug) external view returns (uint256 totalYes, uint256 totalNo, bool resolved, bool outcomeYes, uint256 deadline, bool cancelled)",
];

async function main() {
  const args = process.argv.slice(2);

  let slug, outcome;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--slug" && args[i + 1]) slug = args[++i];
    if (args[i] === "--outcome" && args[i + 1]) outcome = args[++i].toLowerCase();
  }

  if (!slug || !outcome) {
    console.log("Usage: npx hardhat run scripts/resolve.js --network sepolia -- --slug <market-slug> --outcome <yes|no>");
    console.log("\nExample:");
    console.log('  npx hardhat run scripts/resolve.js --network sepolia -- --slug "will-btc-hit-100k" --outcome yes');
    process.exit(1);
  }

  const outcomeYes = outcome === "yes";
  const clawstakeAddr = process.env.CLAWSTAKE_ADDRESS;

  if (!clawstakeAddr) {
    console.error("Set CLAWSTAKE_ADDRESS in .env first");
    process.exit(1);
  }

  const [signer] = await hre.ethers.getSigners();
  const clawstake = new hre.ethers.Contract(clawstakeAddr, CLAWSTAKE_ABI, signer);

  // Show current state
  const info = await clawstake.getMarketInfo(slug);
  console.log(`ClawStake - Resolving market`);
  console.log(`   Market: ${slug}`);
  console.log(`   YES pool: ${Number(info.totalYes) / 1e6} USDC`);
  console.log(`   NO pool:  ${Number(info.totalNo) / 1e6} USDC`);
  console.log(`   Outcome: ${outcomeYes ? "YES" : "NO"}`);

  if (info.resolved) {
    console.log(`\n   Market already resolved!`);
    process.exit(1);
  }

  if (info.cancelled) {
    console.log(`\n   Market is cancelled!`);
    process.exit(1);
  }

  // Check if winning pool is empty
  const winningPool = outcomeYes ? Number(info.totalYes) : Number(info.totalNo);
  if (winningPool === 0) {
    console.log(`\n   Warning: No one staked on the winning side. Market will be auto-cancelled for refunds.`);
  }

  // Resolve
  console.log(`\n   Resolving...`);
  const tx = await clawstake.resolve(slug, outcomeYes);
  const receipt = await tx.wait();
  console.log(`   Resolved! Tx: ${receipt.hash}`);

  const totalPool = Number(info.totalYes) + Number(info.totalNo);
  if (winningPool > 0) {
    const multiplier = totalPool / winningPool;
    console.log(`\n   Winners get ${multiplier.toFixed(2)}x their stake`);
  } else {
    console.log(`\n   Market auto-cancelled. Stakers can refund via: npm run claim -- --slug "${slug}" --refund`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error:", error.message);
    process.exit(1);
  });
