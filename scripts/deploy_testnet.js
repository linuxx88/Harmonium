const { ethers } = require("hardhat");
require("dotenv").config();

async function main() {
  console.log("=== Decentralized Stripe PoC - Testnet Deployment ===");
  const network = await ethers.provider.getNetwork();
  console.log(`Target Network: ${network.name} (Chain ID: ${network.chainId})`);

  const [deployer] = await ethers.getSigners();
  console.log(`Deploying contracts with account: ${deployer.address}`);

  const balance = await deployer.getBalance ? await deployer.getBalance() : await ethers.provider.getBalance(deployer.address);
  console.log(`Account balance: ${ethers.utils ? ethers.utils.formatEther(balance) : ethers.formatEther(balance)} ETH`);

  // Environment variables or fallback defaults
  const oracleAddress = process.env.ORACLE_ADDRESS || deployer.address;
  const feeRecipient = process.env.FEE_RECIPIENT || deployer.address;
  let usdcAddress = process.env.USDC_ADDRESS;

  // If mock USDC needed on testnet
  if (!usdcAddress) {
    console.log("No USDC_ADDRESS specified in .env. Deploying MockUSDC token...");
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const mockUsdc = await MockUSDC.deploy();
    await (mockUsdc.deployed ? mockUsdc.deployed() : mockUsdc.waitForDeployment());
    usdcAddress = mockUsdc.address || (await mockUsdc.getAddress());
    console.log(`MockUSDC deployed to: ${usdcAddress}`);
  } else {
    console.log(`Using existing USDC token address: ${usdcAddress}`);
  }

  console.log("Deploying DecentralizedStripeEscrow contract...");
  const Escrow = await ethers.getContractFactory("DecentralizedStripeEscrow");
  const escrow = await Escrow.deploy(usdcAddress, oracleAddress, feeRecipient);
  await (escrow.deployed ? escrow.deployed() : escrow.waitForDeployment());
  const escrowAddress = escrow.address || (await escrow.getAddress());

  console.log("====================================================");
  console.log("SUCCESS: Deployment Complete!");
  console.log(`MockUSDC Address: ${usdcAddress}`);
  console.log(`Escrow Contract Address: ${escrowAddress}`);
  console.log(`Oracle Address: ${oracleAddress}`);
  console.log(`Fee Recipient Address: ${feeRecipient}`);
  console.log("====================================================");
  console.log("To verify contracts on block explorer (Arbiscan / Basescan):");
  console.log(`npx hardhat verify --network <network_name> ${escrowAddress} "${usdcAddress}" "${oracleAddress}" "${feeRecipient}"`);
  console.log("====================================================");
}

main().catch((error) => {
  console.error("Deployment failed:", error);
  process.exit(1);
});
