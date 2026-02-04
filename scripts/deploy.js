const hre = require("hardhat");

async function main() {
  const USDC_BASE_SEPOLIA = process.env.USDC_ADDRESS || "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

  console.log("🦀 Deploying ClawStake...");
  console.log(`   Network: ${hre.network.name}`);
  console.log(`   USDC: ${USDC_BASE_SEPOLIA}`);

  const [deployer] = await hre.ethers.getSigners();
  console.log(`   Deployer: ${deployer.address}`);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`   Balance: ${hre.ethers.formatEther(balance)} ETH`);

  const ClawStake = await hre.ethers.getContractFactory("ClawStake");
  const clawStake = await ClawStake.deploy(USDC_BASE_SEPOLIA);
  await clawStake.waitForDeployment();

  const address = await clawStake.getAddress();
  console.log(`\n✅ ClawStake deployed to: ${address}`);
  console.log(`\nNext steps:`);
  console.log(`  1. Update .env with CLAWSTAKE_ADDRESS=${address}`);
  console.log(`  2. Approve USDC spending: usdc.approve("${address}", amount)`);
  console.log(`  3. Start staking: npm run stake`);
  console.log(`\nVerify on BaseScan:`);
  console.log(`  npx hardhat verify --network baseSepolia ${address} ${USDC_BASE_SEPOLIA}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });
