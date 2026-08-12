const { ethers } = require("hardhat");

async function main() {
  console.log("=== Starting Phase 3 E2E Integration Simulation ===");

  const [deployer, buyer, seller, feeRecipient] = await ethers.getSigners();
  const oracleSigner = ethers.Wallet.createRandom();
  console.log(`Oracle Address: ${oracleSigner.address}`);

  // 1. Deploy MockUSDC
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  await usdc.deployed ? await usdc.deployed() : await usdc.waitForDeployment();
  const usdcAddress = await usdc.getAddress ? await usdc.getAddress() : usdc.address;
  console.log(`MockUSDC deployed to: ${usdcAddress}`);

  // Mint USDC to buyer
  const depositAmount = ethers.utils ? ethers.utils.parseUnits("100", 6) : ethers.parseUnits("100", 6);
  await usdc.mint(buyer.address, depositAmount);

  // 2. Deploy Escrow Contract
  const Escrow = await ethers.getContractFactory("DecentralizedStripeEscrow");
  const escrow = await Escrow.deploy(usdcAddress, oracleSigner.address, feeRecipient.address);
  await escrow.deployed ? await escrow.deployed() : await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress ? await escrow.getAddress() : escrow.address;
  console.log(`DecentralizedStripeEscrow deployed to: ${escrowAddress}`);

  // 3. Buyer approves and deposits
  const orderId = ethers.utils.id("ORDER_12345");
  await usdc.connect(buyer).approve(escrowAddress, depositAmount);
  console.log("Approved USDC spending for Escrow contract.");

  const tx = await escrow.connect(buyer).deposit(orderId, seller.address, depositAmount);
  await tx.wait();
  console.log(`Deposit successful for Order ID: ${orderId}`);

  // 4. Simulate Carrier Delivery & Oracle Signing
  console.log("Simulating Oracle carrier verification & signature generation...");
  
  // Hash matching Solidity abi.encodePacked(orderId, buyer, seller, amount)
  const messageHash = ethers.utils.solidityKeccak256(
    ["bytes32", "address", "address", "uint256"],
    [orderId, buyer.address, seller.address, depositAmount]
  );
  
  // Sign message
  const signature = await oracleSigner.signMessage(ethers.utils.arrayify(messageHash));
  console.log(`Generated Oracle Signature: ${signature}`);

  // 5. Execute Oracle Release
  console.log("Executing releaseWithOracle on Smart Contract...");
  const releaseTx = await escrow.connect(seller).releaseWithOracle(orderId, signature);
  await releaseTx.wait();
  console.log("Payment successfully released via Oracle signature!");

  // Check balances
  const feeBps = 10; // 0.1%
  const fee = depositAmount.mul(feeBps).div(10000);
  const sellerNet = depositAmount.sub(fee);

  const sellerBalance = await usdc.balanceOf(seller.address);
  const feeBalance = await usdc.balanceOf(feeRecipient.address);

  console.log(`Seller Balance: ${ethers.utils.formatUnits(sellerBalance, 6)} USDC`);
  console.log(`Fee Recipient Balance: ${ethers.utils.formatUnits(feeBalance, 6)} USDC`);

  if (sellerBalance.eq(sellerNet) && feeBalance.eq(fee)) {
    console.log("=== Phase 3 E2E Integration Simulation SUCCESS ===");
  } else {
    console.error("Mismatch in balances!");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
