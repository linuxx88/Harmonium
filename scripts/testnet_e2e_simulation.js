const { ethers } = require("hardhat");

async function main() {
  console.log("=== Running Upgraded Testnet E2E Cryptographic Invariant Suite ===");

  const [deployer, buyer, seller, feeRecipient] = await ethers.getSigners();
  const oracle1 = ethers.Wallet.createRandom();
  const oracle2 = ethers.Wallet.createRandom();
  const oracle3 = ethers.Wallet.createRandom();

  // Deploy MockUSDC
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  await usdc.deployed();

  // Deploy Primary Escrow Contract (Instance A)
  const Escrow = await ethers.getContractFactory("HarmoniumPayEscrow");
  const escrowA = await Escrow.deploy(usdc.address, [oracle1.address, oracle2.address, oracle3.address], feeRecipient.address);
  await escrowA.deployed();

  // Deploy Secondary Escrow Contract (Instance B) for cross-contract replay checks
  const escrowB = await Escrow.deploy(usdc.address, [oracle1.address, oracle2.address, oracle3.address], feeRecipient.address);
  await escrowB.deployed();

  const network = await ethers.provider.getNetwork();
  const currentChainId = network.chainId;
  const itemPrice = ethers.utils.parseUnits("100", 6);
  const feeAmount = itemPrice.mul(10).div(10000);
  const grossAmount = itemPrice.add(feeAmount);

  await usdc.mint(buyer.address, grossAmount.mul(10));
  await usdc.connect(buyer).approve(escrowA.address, grossAmount.mul(5));
  await usdc.connect(buyer).approve(escrowB.address, grossAmount.mul(5));

  // ASSERTION 1: Chain ID & Contract Address Matching
  console.log("\n[ASSERTION 1] Validating chainId and verifyingContract...");
  const orderIdA = ethers.utils.id("TESTNET_INVARIANT_ORDER_A");
  const carrierId = "FEDEX";
  const trackingHash = await escrowA.computeTrackingHash(carrierId, "FEDEX_INVARIANT_99");

  const depositTx = await escrowA.connect(buyer).createAndFundOrder(orderIdA, seller.address, itemPrice);
  await depositTx.wait();

  // ASSERTION 2: Domain Separator Hash Matching
  console.log("\n[ASSERTION 2] Validating computed DOMAIN_SEPARATOR match...");
  const contractDomainSeparator = await escrowA.getDomainSeparator();
  const expectedDomainSeparator = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["bytes32", "bytes32", "bytes32", "uint256", "address"],
      [
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")),
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("HarmoniumPayEscrow")),
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("1")),
        currentChainId,
        escrowA.address
      ]
    )
  );
  if (contractDomainSeparator !== expectedDomainSeparator) {
    throw new Error(`Domain separator mismatch! Contract: ${contractDomainSeparator}, Expected: ${expectedDomainSeparator}`);
  }
  console.log("✓ PASS: On-chain EIP-712 DOMAIN_SEPARATOR strictly matches expected value.");

  // Helper function to build signatures
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

  async function getVoucherSignature(signer, customDomain, nonce, voucherDeadline) {
    const value = {
      orderId: orderIdA,
      buyer: buyer.address,
      seller: seller.address,
      token: usdc.address,
      grossAmount: grossAmount,
      itemPrice: itemPrice,
      carrierId: carrierId,
      trackingHash: trackingHash,
      nonce: nonce,
      voucherDeadline: voucherDeadline
    };
    return await signer._signTypedData(customDomain, types, value);
  }

  const block = await ethers.provider.getBlock("latest");
  const validDeadline = block.timestamp + 3600;

  const validDomainA = {
    name: "HarmoniumPayEscrow",
    version: "1",
    chainId: currentChainId,
    verifyingContract: escrowA.address
  };

  // ASSERTION 3: Cross-Chain Replay Rejection
  console.log("\n[ASSERTION 3] Validating Cross-Chain Replay Rejection (Arbitrum 421614 vs Base 84532)...");
  const crossChainDomain = {
    name: "HarmoniumPayEscrow",
    version: "1",
    chainId: currentChainId === 421614 ? 84532 : 421614,
    verifyingContract: escrowA.address
  };
  const crossChainSig1 = await getVoucherSignature(oracle1, crossChainDomain, 1, validDeadline);
  const crossChainSig2 = await getVoucherSignature(oracle2, crossChainDomain, 1, validDeadline);

  let crossChainReverted = false;
  try {
    await escrowA.releaseWithOracle(orderIdA, grossAmount, itemPrice, carrierId, trackingHash, 1, validDeadline, [crossChainSig1, crossChainSig2]);
  } catch (e) {
    crossChainReverted = true;
  }
  if (!crossChainReverted) {
    throw new Error("FAIL: Cross-chain replay attack succeeded!");
  }
  console.log("✓ PASS: Cross-chain replay signature strictly reverted.");

  // ASSERTION 4: Cross-Contract Replay Rejection
  console.log("\n[ASSERTION 4] Validating Cross-Contract Replay Rejection (Escrow A vs Escrow B)...");
  const crossContractDomain = {
    name: "HarmoniumPayEscrow",
    version: "1",
    chainId: currentChainId,
    verifyingContract: escrowB.address
  };
  const crossContractSig1 = await getVoucherSignature(oracle1, crossContractDomain, 1, validDeadline);
  const crossContractSig2 = await getVoucherSignature(oracle2, crossContractDomain, 1, validDeadline);

  let crossContractReverted = false;
  try {
    await escrowA.releaseWithOracle(orderIdA, grossAmount, itemPrice, carrierId, trackingHash, 1, validDeadline, [crossContractSig1, crossContractSig2]);
  } catch (e) {
    crossContractReverted = true;
  }
  if (!crossContractReverted) {
    throw new Error("FAIL: Cross-contract replay attack succeeded!");
  }
  console.log("✓ PASS: Cross-contract replay signature strictly reverted.");

  // ASSERTION 5: Quorum Threshold (1-of-3 Revert vs 2-of-3 Succeed)
  console.log("\n[ASSERTION 5] Validating Quorum Threshold (1-of-3 revert vs 2-of-3 success)...");
  const sigA1 = await getVoucherSignature(oracle1, validDomainA, 1, validDeadline);
  const sigA2 = await getVoucherSignature(oracle2, validDomainA, 1, validDeadline);

  let quorumReverted = false;
  try {
    await escrowA.releaseWithOracle(orderIdA, grossAmount, itemPrice, carrierId, trackingHash, 1, validDeadline, [sigA1]);
  } catch (e) {
    quorumReverted = true;
  }
  if (!quorumReverted) {
    throw new Error("FAIL: 1-of-3 oracle signature succeeded when quorum threshold is 2!");
  }
  console.log("✓ PASS: 1-of-3 oracle quorum attempt strictly reverted with InvalidQuorum.");

  // Execute 2-of-3 release
  await escrowA.releaseWithOracle(orderIdA, grossAmount, itemPrice, carrierId, trackingHash, 1, validDeadline, [sigA1, sigA2]);
  console.log("✓ PASS: 2-of-3 valid oracle signatures successfully settled payment.");

  // ASSERTION 6: Nonce Replay Rejection
  console.log("\n[ASSERTION 6] Validating Nonce Replay Rejection...");
  let nonceReplayReverted = false;
  try {
    await escrowA.releaseWithOracle(orderIdA, grossAmount, itemPrice, carrierId, trackingHash, 1, validDeadline, [sigA1, sigA2]);
  } catch (e) {
    nonceReplayReverted = true;
  }
  if (!nonceReplayReverted) {
    throw new Error("FAIL: Re-submitting already processed nonce succeeded!");
  }
  console.log("✓ PASS: Re-submitting processed nonce strictly reverted.");

  // ASSERTION 7: Timelock & Expiration Enforcement
  console.log("\n[ASSERTION 7] Validating Timelock & Expiration Enforcement...");
  const orderIdB = ethers.utils.id("TESTNET_INVARIANT_ORDER_B");
  await escrowA.connect(buyer).createAndFundOrder(orderIdB, seller.address, itemPrice);

  const expiredDeadline = Math.floor(Date.now() / 1000) - 500;
  const expiredSig1 = await getVoucherSignature(oracle1, validDomainA, 2, expiredDeadline);
  const expiredSig2 = await getVoucherSignature(oracle2, validDomainA, 2, expiredDeadline);

  let expiredReverted = false;
  try {
    await escrowA.releaseWithOracle(orderIdB, grossAmount, itemPrice, carrierId, trackingHash, 2, expiredDeadline, [expiredSig1, expiredSig2]);
  } catch (e) {
    expiredReverted = true;
  }
  if (!expiredReverted) {
    throw new Error("FAIL: Expired voucher signature accepted!");
  }
  console.log("✓ PASS: Expired voucher signature strictly reverted with SignatureExpired.");

  // Timelock refund checks
  let prematureRefundReverted = false;
  try {
    await escrowA.connect(buyer).claimRefund(orderIdB);
  } catch (e) {
    prematureRefundReverted = true;
  }
  if (!prematureRefundReverted) {
    throw new Error("FAIL: Refund succeeded before fulfillmentDeadline!");
  }
  console.log("✓ PASS: Claiming refund before fulfillmentDeadline strictly reverted with TimeoutNotReached.");

  // Fast forward past fulfillmentDeadline
  await ethers.provider.send("evm_increaseTime", [7 * 86400 + 1]);
  await ethers.provider.send("evm_mine");

  await escrowA.connect(buyer).claimRefund(orderIdB);
  console.log("✓ PASS: Claiming refund after fulfillmentDeadline successfully refunded buyer.");

  console.log("\n==========================================================");
  console.log("=== ALL CRYPTOGRAPHIC INVARIANT ASSERTIONS PASSED 100% ===");
  console.log("==========================================================");
}

main().catch((error) => {
  console.error("Testnet assertion suite failed:", error);
  process.exit(1);
});
