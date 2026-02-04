const hre = require("hardhat");
require("dotenv").config();

const CLAWSTAKE_ABI = [
  "function stake(string calldata marketSlug, bool isYes, uint256 amount) external",
  "function getMarketInfo(string calldata marketSlug) external view returns (uint256 totalYes, uint256 totalNo, bool resolved, bool outcomeYes)",
  "function getStake(string calldata marketSlug, address staker) external view returns (uint256 amountYes, uint256 amountNo, bool claimed)",
];

const USDC_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
];

async function main() {
  const args = process.argv.slice(2);

  // Parse args: --slug <slug> --side <yes|no> --amount <usdc>
  let slug, side, amount;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--slug" && args[i + 1]) slug = args[++i];
    if (args[i] === "--side" && args[i + 1]) side = args[++i].toLowerCase();
    if (args[i] === "--amount" && args[i + 1]) amount = args[++i];
  }

  if (!slug || !side || !amount) {
    console.log("Usage: npx hardhat run scripts/stake.js --network baseSepolia -- --slug <market-slug> --side <yes|no> --amount <usdc>");
    console.log("\nExample:");
    console.log('  npx hardhat run scripts/stake.js --network baseSepolia -- --slug "will-btc-hit-100k" --side yes --amount 5');
    process.exit(1);
  }

  const isYes = side === "yes";
  const amountUsdc = parseFloat(amount);
  const amountWei = BigInt(Math.round(amountUsdc * 1e6)); // USDC has 6 decimals

  const clawstakeAddr = process.env.CLAWSTAKE_ADDRESS;
  const usdcAddr = process.env.USDC_ADDRESS || "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

  if (!clawstakeAddr) {
    console.error("❌ Set CLAWSTAKE_ADDRESS in .env first (deploy the contract)");
    process.exit(1);
  }

  const [signer] = await hre.ethers.getSigners();
  console.log(`🦀 ClawStake - Staking on market`);
  console.log(`   Staker: ${signer.address}`);
  console.log(`   Market: ${slug}`);
  console.log(`   Side: ${isYes ? "YES ✅" : "NO ❌"}`);
  console.log(`   Amount: ${amountUsdc} USDC`);

  const usdc = new hre.ethers.Contract(usdcAddr, USDC_ABI, signer);
  const clawstake = new hre.ethers.Contract(clawstakeAddr, CLAWSTAKE_ABI, signer);

  // Check USDC balance
  const balance = await usdc.balanceOf(signer.address);
  console.log(`   USDC Balance: ${Number(balance) / 1e6} USDC`);

  if (balance < amountWei) {
    console.error(`❌ Insufficient USDC balance. Need ${amountUsdc}, have ${Number(balance) / 1e6}`);
    process.exit(1);
  }

  // Check and set allowance
  const allowance = await usdc.allowance(signer.address, clawstakeAddr);
  if (allowance < amountWei) {
    console.log(`\n   Approving USDC spend...`);
    const approveTx = await usdc.approve(clawstakeAddr, hre.ethers.MaxUint256);
    await approveTx.wait();
    console.log(`   ✅ Approved`);
  }

  // Stake
  console.log(`\n   Staking...`);
  const tx = await clawstake.stake(slug, isYes, amountWei);
  const receipt = await tx.wait();
  console.log(`   ✅ Staked! Tx: ${receipt.hash}`);

  // Show market state
  const info = await clawstake.getMarketInfo(slug);
  console.log(`\n   Market State:`);
  console.log(`   YES pool: ${Number(info.totalYes) / 1e6} USDC`);
  console.log(`   NO pool:  ${Number(info.totalNo) / 1e6} USDC`);
  console.log(`   Total:    ${(Number(info.totalYes) + Number(info.totalNo)) / 1e6} USDC`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Error:", error.message);
    process.exit(1);
  });
