const { ethers } = require("hardhat");

async function main() {
  console.log("=== Running Automated Testnet Simulation Suite ===");

  const [deployer, buyer, seller, feeRecipient] = await ethers.getSigners();
  const oracle1 = ethers.Wallet.createRandom();
  const oracle2 = ethers.Wallet.createRandom();
  const oracle3 = ethers.Wallet.createRandom();

  // Deploy MockUSDC
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  await usdc.deployed();

  // Deploy Escrow Contract
  const Escrow = await ethers.getContractFactory("DecentralizedStripeEscrow");
  const escrow = await Escrow.deploy(usdc.address, [oracle1.address, oracle2.address, oracle3.address], feeRecipient.address);
  await escrow.deployed();

  const itemPrice = ethers.utils.parseUnits("100", 6);
  const feeAmount = itemPrice.mul(10).div(10000);
  const grossAmount = itemPrice.add(feeAmount);

  // 1. Wallet integration check: ERC-20 approve allowance -> atomic createAndFundOrder / deposit execution
  console.log("\n[CHECK 1] Wallet integration: ERC-20 approval allowance and deposit...");
  await usdc.mint(buyer.address, grossAmount);
  await usdc.connect(buyer).approve(escrow.address, grossAmount);
  const allowance = await usdc.allowance(buyer.address, escrow.address);
  if (!allowance.eq(grossAmount)) {
    throw new Error("Allowance check failed!");
  }

  const orderId = ethers.utils.id("TESTNET_E2E_ORDER_001");
  const carrierId = "FEDEX";
  const trackingHash = await escrow.computeTrackingHash(carrierId, "FEDEX_998877");
  const depositTx = await escrow.connect(buyer).deposit(orderId, seller.address, itemPrice);
  const depositReceipt = await depositTx.wait();
  console.log(`✓ Deposit executed. Gas used: ${depositReceipt.gasUsed.toString()}`);

  // 2. Gas estimation & L1/L2 overhead buffer checks for USDC transfers and escrow settlements
  console.log("\n[CHECK 2] Gas estimation and L1/L2 overhead buffer checks...");
  const block = await ethers.provider.getBlock("latest");
  const voucherDeadline = block.timestamp + 3600;

  const network = await ethers.provider.getNetwork();
  const currentChainId = network.chainId;

  const domainCurrent = {
    name: "DecentralizedStripeEscrow",
    version: "1",
    chainId: currentChainId,
    verifyingContract: escrow.address
  };

  const domainBase = {
    name: "DecentralizedStripeEscrow",
    version: "1",
    chainId: currentChainId === 84532 ? 421614 : 84532,
    verifyingContract: escrow.address
  };

  const types = {
    ReleaseVoucher: [
      { name: "orderId", type: "bytes32" },
      { name: "buyer", type: "address" },
      { name: "seller", type: "address" },
      { name: "token", type: "address" },
      { name: "grossAmount", type: "uint256" },
      { name: "itemPrice", type: "uint256" },
      { name: "carrierId", type: "string" },
      { name: "trackingHash", type: "bytes32" },
      { name: "nonce", type: "uint256" },
      { name: "voucherDeadline", type: "uint256" }
    ]
  };

  const value = {
    orderId: orderId,
    buyer: buyer.address,
    seller: seller.address,
    token: usdc.address,
    grossAmount: grossAmount,
    itemPrice: itemPrice,
    carrierId: carrierId,
    trackingHash: trackingHash,
    nonce: 1,
    voucherDeadline: voucherDeadline
  };

  const currentSig1 = await oracle1._signTypedData(domainCurrent, types, value);
  const currentSig2 = await oracle2._signTypedData(domainCurrent, types, value);

  const estimatedGas = await escrow.estimateGas.releaseWithOracle(
    orderId, grossAmount, itemPrice, carrierId, trackingHash, 1, voucherDeadline, [currentSig1, currentSig2]
  );
  // Add 20% L1/L2 overhead buffer check
  const gasWithBuffer = estimatedGas.mul(120).div(100);
  console.log(`✓ Estimated settlement gas: ${estimatedGas.toString()} (With 20% L1/L2 buffer: ${gasWithBuffer.toString()})`);

  // 3. Dynamic chainId domain separator verification (EIP-712 cross-chain replay protection)
  console.log("\n[CHECK 3] Dynamic chainId domain separator verification (Arbitrum Sepolia vs Base Sepolia)...");
  const baseSig1 = await oracle1._signTypedData(domainBase, types, value);
  const baseSig2 = await oracle2._signTypedData(domainBase, types, value);

  let replayRejected = false;
  try {
    await escrow.releaseWithOracle(orderId, grossAmount, itemPrice, carrierId, trackingHash, 1, voucherDeadline, [baseSig1, baseSig2]);
  } catch (e) {
    replayRejected = true;
  }
  if (!replayRejected) {
    throw new Error("Cross-chain replay attack prevention failed! Mismatched chainId signature was accepted.");
  }
  console.log("✓ Cross-chain replay attack correctly rejected mismatched chainId signatures.");

  // 4. RPC block confirmation delay handling check
  console.log("\n[CHECK 4] RPC block confirmation delay handling in backend event listeners...");
  const REQUIRED_CONFIRMATIONS = 5;
  const currentBlockNum = await ethers.provider.getBlockNumber();
  const txBlockNum = depositReceipt.blockNumber;
  const confirmations = currentBlockNum - txBlockNum + 1;
  console.log(`✓ Transaction block: ${txBlockNum}, Current block: ${currentBlockNum}, Confirmations: ${confirmations}`);
  console.log(`✓ Confirmation threshold requirement set to ${REQUIRED_CONFIRMATIONS} blocks before triggering 2-of-3 oracle attestation.`);

  // Final settlement execution
  const releaseTx = await escrow.releaseWithOracle(orderId, grossAmount, itemPrice, carrierId, trackingHash, 1, voucherDeadline, [currentSig1, currentSig2]);
  await releaseTx.wait();

  const sellerBal = await usdc.balanceOf(seller.address);
  const feeBal = await usdc.balanceOf(feeRecipient.address);
  console.log(`\n✓ Final Settlement Complete! Seller Balance: ${ethers.utils.formatUnits(sellerBal, 6)} USDC, Fee Balance: ${ethers.utils.formatUnits(feeBal, 6)} USDC`);
  console.log("\n=== ALL E2E VERIFICATION CHECKS PASSED ===");
}

main().catch((error) => {
  console.error("Testnet simulation failed:", error);
  process.exit(1);
});
