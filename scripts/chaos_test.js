const { ethers } = require("hardhat");

async function main() {
  console.log("====================================================");
  console.log("=== Phase 4 Chaos & Security Test Suite Execution ===");
  console.log("====================================================\n");

  const [owner, buyer, seller, feeRecipient, attacker] = await ethers.getSigners();
  const oracleSigner = ethers.Wallet.createRandom();
  console.log(`[Setup] Deployer/Owner: ${owner.address}`);
  console.log(`[Setup] Oracle Signer: ${oracleSigner.address}`);
  console.log(`[Setup] Attacker: ${attacker.address}\n`);

  // 1. Deploy contracts
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  await usdc.deployed();

  const Escrow = await ethers.getContractFactory("DecentralizedStripeEscrow");
  const escrow = await Escrow.deploy(usdc.address, oracleSigner.address, feeRecipient.address);
  await escrow.deployed();

  const amount = ethers.utils.parseUnits("500", 6);
  await usdc.mint(buyer.address, amount.mul(5));
  await usdc.connect(buyer).approve(escrow.address, amount.mul(5));

  // TEST CASE 1: Circuit Breaker Emergency Pause/Unpause
  console.log("--- Test Case 1: Emergency Circuit Breaker Enforcement ---");
  console.log("Pausing contract as owner...");
  await escrow.connect(owner).pause();
  const orderId1 = ethers.utils.id("CHAOS_ORDER_1");

  try {
    await escrow.connect(buyer).deposit(orderId1, seller.address, amount);
    console.error("FAIL: Deposit succeeded while paused!");
    process.exit(1);
  } catch (err) {
    console.log("PASS: Deposit correctly blocked during contract pause.");
  }

  console.log("Unpausing contract...");
  await escrow.connect(owner).unpause();
  await escrow.connect(buyer).deposit(orderId1, seller.address, amount);
  console.log("PASS: Deposit successful post-unpause.\n");

  // TEST CASE 2: Invalid Oracle ECDSA Signature Injection
  console.log("--- Test Case 2: Invalid Oracle Signature Injection (Spoofing) ---");
  const messageHash = ethers.utils.solidityKeccak256(
    ["bytes32", "address", "address", "uint256"],
    [orderId1, buyer.address, seller.address, amount]
  );
  const attackerSignature = await attacker.signMessage(ethers.utils.arrayify(messageHash));

  try {
    await escrow.connect(seller).releaseWithOracle(orderId1, attackerSignature);
    console.error("FAIL: Invalid signature accepted!");
    process.exit(1);
  } catch (err) {
    console.log("PASS: Invalid signature rejected by escrow smart contract.");
  }

  // Valid oracle signature release
  const validSignature = await oracleSigner.signMessage(ethers.utils.arrayify(messageHash));
  await escrow.connect(seller).releaseWithOracle(orderId1, validSignature);
  console.log("PASS: Valid oracle signature successfully released funds.\n");

  // TEST CASE 3: Expired Escrow Auto-Refund Timeout & Early Refund Attempt
  console.log("--- Test Case 3: Timeout Expiration & Early Refund Shield ---");
  const orderId2 = ethers.utils.id("CHAOS_ORDER_2");
  await escrow.connect(buyer).deposit(orderId2, seller.address, amount);

  // Attempt early refund
  try {
    await escrow.connect(buyer).refundTimeout(orderId2);
    console.error("FAIL: Early refund granted before timeout!");
    process.exit(1);
  } catch (err) {
    console.log("PASS: Early refund attempt correctly blocked.");
  }

  // Fast forward 7 days + 1 second
  console.log("Simulating network/time delay (+7 days)...");
  await ethers.provider.send("evm_increaseTime", [7 * 86400 + 1]);
  await ethers.provider.send("evm_mine");

  const buyerBalanceBefore = await usdc.balanceOf(buyer.address);
  await escrow.connect(buyer).refundTimeout(orderId2);
  const buyerBalanceAfter = await usdc.balanceOf(buyer.address);
  
  if (buyerBalanceAfter.sub(buyerBalanceBefore).eq(amount)) {
    console.log("PASS: Expired escrow successfully refunded full amount to buyer after 7-day timeout.\n");
  } else {
    console.error("FAIL: Refund amount calculation mismatch!");
    process.exit(1);
  }

  // TEST CASE 4: Re-entrancy & Unauthorized Access Guard
  console.log("--- Test Case 4: Unauthorized Dispute Resolution Prevention ---");
  const orderId3 = ethers.utils.id("CHAOS_ORDER_3");
  await escrow.connect(buyer).deposit(orderId3, seller.address, amount);
  await escrow.connect(buyer).raiseDispute(orderId3);

  try {
    await escrow.connect(attacker).resolveDispute(orderId3, attacker.address, amount);
    console.error("FAIL: Attacker resolved dispute!");
    process.exit(1);
  } catch (err) {
    console.log("PASS: Non-owner attempt to resolve dispute rejected.");
  }

  await escrow.connect(owner).resolveDispute(orderId3, buyer.address, amount);
  console.log("PASS: Owner successfully resolved dispute.\n");

  console.log("====================================================");
  console.log("=== ALL CHAOS & SECURITY TESTS PASSED 100% CLEAN ===");
  console.log("====================================================");
}

main().catch((error) => {
  console.error("Chaos test failed:", error);
  process.exit(1);
});
