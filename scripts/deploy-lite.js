#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
require('dotenv').config();

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const RPC_URL = process.env.BASE_SEPOLIA_RPC || 'https://sepolia.base.org';
const USDC_ADDRESS = process.env.USDC_ADDRESS || '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

async function main() {
  if (!PRIVATE_KEY) { console.error('Missing PRIVATE_KEY in .env'); process.exit(1); }

  const buildDir = path.join(__dirname, '..', 'build');
  const abiFile = fs.readdirSync(buildDir).find(f => f.endsWith('_ClawStake.abi'));
  const binFile = fs.readdirSync(buildDir).find(f => f.endsWith('_ClawStake.bin'));

  const abi = JSON.parse(fs.readFileSync(path.join(buildDir, abiFile), 'utf8'));
  const bytecode = '0x' + fs.readFileSync(path.join(buildDir, binFile), 'utf8').trim();

  // Encode constructor args manually and append to bytecode
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  const encodedArgs = abiCoder.encode(['address'], [USDC_ADDRESS]);
  const deployData = bytecode + encodedArgs.slice(2); // remove 0x from args

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const balance = await provider.getBalance(wallet.address);

  console.log(`Deployer: ${wallet.address}`);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH`);
  console.log(`Deploying ClawStake (USDC: ${USDC_ADDRESS})...`);

  const tx = await wallet.sendTransaction({ data: deployData });
  console.log(`TX: ${tx.hash}`);
  console.log('Waiting for confirmation...');

  const receipt = await tx.wait();
  const address = receipt.contractAddress;

  console.log(`\nClawStake deployed!`);
  console.log(`Contract: ${address}`);
  console.log(`Explorer: https://sepolia.basescan.org/address/${address}`);

  fs.writeFileSync(path.join(__dirname, '..', 'deployment.json'), JSON.stringify({
    address, network: 'base-sepolia',
    usdc: USDC_ADDRESS, deployer: wallet.address,
    txHash: tx.hash, deployedAt: new Date().toISOString()
  }, null, 2));
  console.log('Saved deployment.json');
}

main().catch(err => { console.error('Deploy failed:', err.message); process.exit(1); });
