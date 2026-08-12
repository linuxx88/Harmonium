const { ethers } = require("hardhat");

async function main() {
  console.log("=== Starting Refactored E2E Integration Simulation ===");

  const [deployer, buyer, seller, feeRecipient] = await ethers.getSigners();
  const oracle1 = ethers.Wallet.createRandom();
  const oracle2 = ethers.Wallet.createRandom();
  const oracle3 = ethers.Wallet.createRandom();

  // 1. Deploy MockUSDC
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  await usdc.deployed();
  console.log(`MockUSDC deployed to: ${usdc.address}`);

  // Mint USDC to buyer
  const itemPrice = ethers.utils.parseUnits("100", 6);
  const feeAmount = itemPrice.mul(10).div(10000);
  const grossAmount = itemPrice.add(feeAmount);
  await usdc.mint(buyer.address, grossAmount);

  // 2. Deploy Escrow Contract with 2-of-3 threshold
  const Escrow = await ethers.getContractFactory("DecentralizedStripeEscrow");
  const escrow = await Escrow.deploy(usdc.address, [oracle1.address, oracle2.address, oracle3.address], feeRecipient.address);
  await escrow.deployed();
  console.log(`DecentralizedStripeEscrow deployed to: ${escrow.address}`);

  // 3. Buyer approves and deposits
  const orderId = ethers.utils.id("ORDER_SIM_999");
  const carrierId = "UPS";
  const trackingHash = await escrow.computeTrackingHash(carrierId, "TRACK123");
  await usdc.connect(buyer).approve(escrow.address, grossAmount);

  const tx = await escrow.connect(buyer).deposit(orderId, seller.address, itemPrice);
  await tx.wait();
  console.log(`Deposit successful for Order ID: ${orderId}`);

  // 4. Generate 2-of-3 EIP-712 signatures
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const block = await ethers.provider.getBlock("latest");
  const voucherDeadline = block.timestamp + 3600;

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

  const sig1 = await oracle1._signTypedData(domain, types, value);
  const sig2 = await oracle2._signTypedData(domain, types, value);

  // 5. Execute 2-of-3 threshold release
  await escrow.releaseWithOracle(orderId, grossAmount, itemPrice, carrierId, trackingHash, 1, voucherDeadline, [sig1, sig2]);

  const sellerBalance = await usdc.balanceOf(seller.address);
  const feeBalance = await usdc.balanceOf(feeRecipient.address);

  console.log(`Seller Balance: ${ethers.utils.formatUnits(sellerBalance, 6)} USDC`);
  console.log(`Fee Recipient Balance: ${ethers.utils.formatUnits(feeBalance, 6)} USDC`);

  if (sellerBalance.eq(itemPrice) && feeBalance.eq(feeAmount)) {
    console.log("=== Refactored E2E Simulation SUCCESS ===");
  } else {
    console.error("Mismatch in balances!");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
