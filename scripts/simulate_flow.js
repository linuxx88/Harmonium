const { ethers } = require("hardhat");

async function main() {
  console.log("=== Starting Complete E2E Integration Simulation ===");

  const [deployer, buyer, seller, feeRecipient] = await ethers.getSigners();

  // 1. Deploy MockUSDC
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  await usdc.deployed();
  console.log(`MockUSDC deployed to: ${usdc.address}`);

  // 2. Setup Oracle Signer Wallets from environment variables (fail closed)
  const oraclePk1 = process.env.ORACLE1_PRIVATE_KEY || process.env.TEST_ORACLE1_PRIVATE_KEY;
  const oraclePk2 = process.env.ORACLE2_PRIVATE_KEY || process.env.TEST_ORACLE2_PRIVATE_KEY;
  const oraclePk3 = process.env.ORACLE3_PRIVATE_KEY || process.env.TEST_ORACLE3_PRIVATE_KEY;

  if (!oraclePk1 || !oraclePk2 || !oraclePk3) {
    throw new Error(
      "Missing required oracle private keys for E2E simulation! Please set ORACLE1_PRIVATE_KEY, ORACLE2_PRIVATE_KEY, and ORACLE3_PRIVATE_KEY (or TEST_ORACLE* equivalents) in the environment."
    );
  }
  
  const oracle1 = new ethers.Wallet(oraclePk1, ethers.provider);
  const oracle2 = new ethers.Wallet(oraclePk2, ethers.provider);
  const oracle3 = new ethers.Wallet(oraclePk3, ethers.provider);

  const Escrow = await ethers.getContractFactory("HarmoniumPayEscrow");
  const escrow = await Escrow.deploy(usdc.address, [oracle1.address, oracle2.address, oracle3.address], feeRecipient.address);
  await escrow.deployed();
  console.log(`HarmoniumPayEscrow deployed to: ${escrow.address}`);

  const chainId = (await ethers.provider.getNetwork()).chainId;

  const itemPrice = ethers.utils.parseUnits("100", 6);
  const feeAmount = itemPrice.mul(10).div(10000);
  const grossAmount = itemPrice.add(feeAmount);

  // ==========================================
  // Flow 1: 2-of-3 Oracle Settlement via EIP-712 Attestation Fixture
  // ==========================================
  console.log("\n--- Flow 1: 2-of-3 Oracle Settlement via EIP-712 Attestation Fixture ---");
  await usdc.mint(buyer.address, grossAmount);
  await usdc.connect(buyer).approve(escrow.address, grossAmount);

  const orderId1 = ethers.utils.id("ORDER_SIM_SETTLE_1");
  const carrierId = "UPS";
  const trackingNumber = "TRACK123";
  const trackingHash = await escrow.computeTrackingHash(carrierId, trackingNumber);

  await (await escrow.connect(buyer).createAndFundOrder(orderId1, seller.address, itemPrice)).wait();
  console.log(`Order 1 funded on-chain: ${orderId1}`);

  // Generate 2-of-3 EIP-712 threshold signatures using public mock oracle fixture
  const { generate2Of3MockVoucher } = require("../examples/mock-oracle/mock_oracle");
  const voucherDeadline = Math.floor(Date.now() / 1000) + 3600;
  const nonce = 1;

  const { voucher, signatures } = await generate2Of3MockVoucher(
    escrow.address,
    chainId,
    {
      orderId: orderId1,
      buyer: buyer.address,
      seller: seller.address,
      token: usdc.address,
      grossAmount: grossAmount,
      itemPrice: itemPrice,
      carrierId: carrierId,
      trackingHash: trackingHash,
      nonce: nonce,
      voucherDeadline: voucherDeadline
    },
    [oracle1, oracle2, oracle3]
  );

  console.log(`Generated ${signatures.length} valid EIP-712 oracle signatures`);

  // Settle on-chain using 2-of-3 threshold signatures
  await (await escrow.settleWithOracle(
    orderId1,
    grossAmount,
    itemPrice,
    carrierId,
    trackingHash,
    nonce.toString(),
    voucherDeadline,
    signatures
  )).wait();

  const sellerBalance = await usdc.balanceOf(seller.address);
  const feeBalance = await usdc.balanceOf(feeRecipient.address);
  console.log(`Seller Balance: ${ethers.utils.formatUnits(sellerBalance, 6)} USDC (Expected: 100.0)`);
  console.log(`Fee Recipient Balance: ${ethers.utils.formatUnits(feeBalance, 6)} USDC (Expected: 0.10)`);
  if (!sellerBalance.eq(itemPrice) || !feeBalance.eq(feeAmount)) {
    throw new Error("Flow 1 Settlement balance check failed!");
  }
  console.log("✔ Flow 1 Settlement PASSED");

  // ==========================================
  // Flow 2: Timeout Refund (claimRefund)
  // ==========================================
  console.log("\n--- Flow 2: Timeout Refund (claimRefund) ---");
  await usdc.mint(buyer.address, grossAmount);
  await usdc.connect(buyer).approve(escrow.address, grossAmount);

  const orderId2 = ethers.utils.id("ORDER_SIM_REFUND_2");
  await (await escrow.connect(buyer).createAndFundOrder(orderId2, seller.address, itemPrice)).wait();
  console.log(`Order 2 funded: ${orderId2}`);

  const buyerBalPreRefund = await usdc.balanceOf(buyer.address);

  // Advance EVM time past 7-day fulfillment deadline
  await ethers.provider.send("evm_increaseTime", [7 * 86400 + 1]);
  await ethers.provider.send("evm_mine");

  await (await escrow.connect(buyer).claimRefund(orderId2)).wait();

  const buyerBalPostRefund = await usdc.balanceOf(buyer.address);
  const refundedDelta = buyerBalPostRefund.sub(buyerBalPreRefund);
  console.log(`Buyer Refunded Amount: ${ethers.utils.formatUnits(refundedDelta, 6)} USDC (Expected: ${ethers.utils.formatUnits(grossAmount, 6)})`);
  if (!refundedDelta.eq(grossAmount)) {
    throw new Error("Flow 2 Refund balance check failed!");
  }
  console.log("✔ Flow 2 Timeout Refund PASSED");

  console.log("\n=== Complete E2E Simulation SUCCESS ===");
}

main().catch((error) => {
  console.error("Simulation failed:", error);
  process.exit(1);
});
