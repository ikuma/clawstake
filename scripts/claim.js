const hre = require("hardhat");
require("dotenv").config();

const CLAWSTAKE_ABI = [
  "function claim(string calldata marketSlug) external",
  "function refund(string calldata marketSlug) external",
  "function getMarketInfo(string calldata marketSlug) external view returns (uint256 totalYes, uint256 totalNo, bool resolved, bool outcomeYes, uint256 deadline, bool cancelled)",
  "function getStake(string calldata marketSlug, address staker) external view returns (uint256 amountYes, uint256 amountNo, bool claimed)",
];

const USDC_ABI = [
  "function balanceOf(address account) external view returns (uint256)",
];

async function main() {
  const args = process.argv.slice(2);

  let slug, doRefund = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--slug" && args[i + 1]) slug = args[++i];
    if (args[i] === "--refund") doRefund = true;
  }

  if (!slug) {
    console.log("Usage: npx hardhat run scripts/claim.js --network baseSepolia -- --slug <market-slug> [--refund]");
    console.log("\nExamples:");
    console.log('  npx hardhat run scripts/claim.js --network baseSepolia -- --slug "will-btc-hit-100k"');
    console.log('  npx hardhat run scripts/claim.js --network baseSepolia -- --slug "will-btc-hit-100k" --refund');
    process.exit(1);
  }

  const clawstakeAddr = process.env.CLAWSTAKE_ADDRESS;
  const usdcAddr = process.env.USDC_ADDRESS || "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

  if (!clawstakeAddr) {
    console.error("Set CLAWSTAKE_ADDRESS in .env first");
    process.exit(1);
  }

  const [signer] = await hre.ethers.getSigners();
  const clawstake = new hre.ethers.Contract(clawstakeAddr, CLAWSTAKE_ABI, signer);
  const usdc = new hre.ethers.Contract(usdcAddr, USDC_ABI, signer);

  // Check market state
  const info = await clawstake.getMarketInfo(slug);
  console.log(`ClawStake - ${doRefund ? "Refunding" : "Claiming winnings"}`);
  console.log(`   Market: ${slug}`);

  if (info.cancelled) {
    console.log(`   Status: CANCELLED`);
    if (!doRefund) {
      console.log(`\n   Market is cancelled. Use --refund to get your stake back.`);
      process.exit(1);
    }
  } else if (info.resolved) {
    console.log(`   Resolved: ${info.outcomeYes ? "YES" : "NO"}`);
  } else {
    console.log(`   Status: Not yet resolved`);
    if (!doRefund) {
      console.error(`\n   Market not yet resolved. Wait for resolution.`);
      process.exit(1);
    }
  }

  // Check user's stake
  const stake = await clawstake.getStake(slug, signer.address);
  console.log(`   Your YES stake: ${Number(stake.amountYes) / 1e6} USDC`);
  console.log(`   Your NO stake:  ${Number(stake.amountNo) / 1e6} USDC`);

  if (stake.claimed) {
    console.log(`\n   Already claimed/refunded!`);
    process.exit(1);
  }

  const balanceBefore = await usdc.balanceOf(signer.address);

  if (doRefund) {
    // Refund
    const totalStake = (Number(stake.amountYes) + Number(stake.amountNo)) / 1e6;
    console.log(`\n   Expected refund: ${totalStake.toFixed(2)} USDC`);
    console.log(`   Refunding...`);
    const tx = await clawstake.refund(slug);
    const receipt = await tx.wait();
    console.log(`   Refunded! Tx: ${receipt.hash}`);
  } else {
    // Claim
    const userWinning = info.outcomeYes ? Number(stake.amountYes) : Number(stake.amountNo);
    if (userWinning === 0) {
      console.log(`\n   You don't have a winning position in this market.`);
      process.exit(1);
    }

    const winningPool = info.outcomeYes ? Number(info.totalYes) : Number(info.totalNo);
    const totalPool = Number(info.totalYes) + Number(info.totalNo);
    const expectedPayout = (userWinning * totalPool) / winningPool;
    console.log(`\n   Expected payout: ${(expectedPayout / 1e6).toFixed(2)} USDC`);

    console.log(`   Claiming...`);
    const tx = await clawstake.claim(slug);
    const receipt = await tx.wait();
    console.log(`   Claimed! Tx: ${receipt.hash}`);
  }

  const balanceAfter = await usdc.balanceOf(signer.address);
  const received = Number(balanceAfter - balanceBefore) / 1e6;
  console.log(`   Received: ${received.toFixed(2)} USDC`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error:", error.message);
    process.exit(1);
  });
