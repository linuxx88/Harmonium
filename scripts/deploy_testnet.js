const { ethers } = require("hardhat");
try { require("dotenv").config(); } catch (e) {}

async function main() {
  console.log("=== Harmonium Pay PoC - Testnet Deployment ===");
  const network = await ethers.provider.getNetwork();
  console.log(`Target Network: ${network.name} (Chain ID: ${network.chainId})`);

  const [deployer] = await ethers.getSigners();
  console.log(`Deploying contracts with account: ${deployer.address}`);

  const balance = await deployer.getBalance ? await deployer.getBalance() : await ethers.provider.getBalance(deployer.address);
  console.log(`Account balance: ${ethers.utils ? ethers.utils.formatEther(balance) : ethers.formatEther(balance)} ETH`);

  const oracle1 = process.env.ORACLE1_ADDRESS;
  const oracle2 = process.env.ORACLE2_ADDRESS;
  const oracle3 = process.env.ORACLE3_ADDRESS;

  if (!oracle1 || !oracle2 || !oracle3) {
    throw new Error(
      "Missing required oracle addresses for testnet deployment! Please set ORACLE1_ADDRESS, ORACLE2_ADDRESS, and ORACLE3_ADDRESS in your environment/.env."
    );
  }

  const oracleSigners = [oracle1, oracle2, oracle3];
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

  console.log("Deploying HarmoniumPayEscrow contract (2-of-3 threshold quorum)...");
  const Escrow = await ethers.getContractFactory("HarmoniumPayEscrow");
  const escrow = await Escrow.deploy(usdcAddress, oracleSigners, feeRecipient);
  await (escrow.deployed ? escrow.deployed() : escrow.waitForDeployment());
  const escrowAddress = escrow.address || (await escrow.getAddress());

  console.log("====================================================");
  console.log("SUCCESS: Deployment Complete!");
  console.log(`MockUSDC Address: ${usdcAddress}`);
  console.log(`Escrow Contract Address: ${escrowAddress}`);
  console.log(`Oracle Signers (3): ${JSON.stringify(oracleSigners)}`);
  console.log(`Fee Recipient Address: ${feeRecipient}`);
  console.log("====================================================");
  console.log("To verify contracts on block explorer (Arbiscan / Basescan):");
  console.log(`npx hardhat verify --network <network_name> ${escrowAddress} "${usdcAddress}" "[\"${oracle1}\",\"${oracle2}\",\"${oracle3}\"]" "${feeRecipient}"`);
  console.log("====================================================");
}

main().catch((error) => {
  console.error("Deployment failed:", error);
  process.exit(1);
});
