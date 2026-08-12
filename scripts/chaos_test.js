const { ethers } = require("hardhat");

async function main() {
  console.log("=== Refactored Chaos & Security Test Suite Execution ===");

  const [owner, buyer, seller, feeRecipient, attacker] = await ethers.getSigners();
  const oracle1 = ethers.Wallet.createRandom();
  const oracle2 = ethers.Wallet.createRandom();
  const oracle3 = ethers.Wallet.createRandom();

  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  await usdc.deployed();

  const Escrow = await ethers.getContractFactory("DecentralizedStripeEscrow");
  const escrow = await Escrow.deploy(usdc.address, [oracle1.address, oracle2.address, oracle3.address], feeRecipient.address);
  await escrow.deployed();

  const itemPrice = ethers.utils.parseUnits("500", 6);
  const feeAmount = itemPrice.mul(10).div(10000);
  const grossAmount = itemPrice.add(feeAmount);

  await usdc.mint(buyer.address, grossAmount.mul(5));
  await usdc.connect(buyer).approve(escrow.address, grossAmount.mul(5));

  // TEST 1: Pause Enforcement
  console.log("--- Test Case 1: Emergency Pause Enforcement ---");
  await escrow.connect(owner).pause();
  const orderId1 = ethers.utils.id("CHAOS_1");

  try {
    await escrow.connect(buyer).deposit(orderId1, seller.address, itemPrice);
    console.error("FAIL: Deposit succeeded while paused!");
    process.exit(1);
  } catch (err) {
    console.log("PASS: Deposit correctly blocked during contract pause.");
  }

  await escrow.connect(owner).unpause();
  await escrow.connect(buyer).deposit(orderId1, seller.address, itemPrice);
  console.log("PASS: Deposit successful post-unpause.");

  // TEST 2: Single Attacker Signature Rejection (Threshold Failure)
  console.log("--- Test Case 2: Quorum Failure & Attacker Signature Rejection ---");
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const block = await ethers.provider.getBlock("latest");
  const voucherDeadline = block.timestamp + 3600;
  const carrierId = "UPS";
  const trackingHash = await escrow.computeTrackingHash(carrierId, "TRACKING_UPS");

  const domain = {
    name: "DecentralizedStripeEscrow",
    version: "1",
    chainId: chainId,
    verifyingContract: escrow.address
  };

  const types = {
    ReleaseVoucher: [
      { name: "orderId", type: "bytes32" },
      { name: "buyer", type: "address" },
      { name: "seller", type: "address" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "carrierId", type: "string" },
      { name: "trackingHash", type: "bytes32" },
      { name: "nonce", type: "uint256" },
      { name: "voucherDeadline", type: "uint256" }
    ]
  };

  const value = {
    orderId: orderId1,
    buyer: buyer.address,
    seller: seller.address,
    token: usdc.address,
    amount: itemPrice,
    carrierId: carrierId,
    trackingHash: trackingHash,
    nonce: 1,
    voucherDeadline: voucherDeadline
  };

  const sigAttacker = await attacker._signTypedData(domain, types, value);
  const sig1 = await oracle1._signTypedData(domain, types, value);
  const sig2 = await oracle2._signTypedData(domain, types, value);

  try {
    await escrow.releaseWithOracle(orderId1, carrierId, trackingHash, 1, voucherDeadline, [sig1, sigAttacker]);
    console.error("FAIL: Attacker signature accepted!");
    process.exit(1);
  } catch (err) {
    console.log("PASS: Attacker signature correctly rejected.");
  }

  await escrow.releaseWithOracle(orderId1, carrierId, trackingHash, 1, voucherDeadline, [sig1, sig2]);
  console.log("PASS: Valid 2-of-3 quorum release successful.");

  // TEST 3: Buyer-Triggered Refund & Unauthorized Attempt
  console.log("--- Test Case 3: Buyer-Only Refund after Timeout ---");
  const orderId2 = ethers.utils.id("CHAOS_2");
  await escrow.connect(buyer).deposit(orderId2, seller.address, itemPrice);

  await ethers.provider.send("evm_increaseTime", [7 * 86400 + 1]);
  await ethers.provider.send("evm_mine");

  try {
    await escrow.connect(seller).claimRefund(orderId2);
    console.error("FAIL: Seller triggered refund!");
    process.exit(1);
  } catch (err) {
    console.log("PASS: Non-buyer refund attempt rejected.");
  }

  await escrow.connect(buyer).claimRefund(orderId2);
  console.log("PASS: Buyer successfully triggered timeout refund.");

  console.log("====================================================");
  console.log("=== ALL CHAOS & SECURITY TESTS PASSED 100% CLEAN ===");
  console.log("====================================================");
}

main().catch((error) => {
  console.error("Chaos test failed:", error);
  process.exit(1);
});

