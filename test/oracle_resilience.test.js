const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DecentralizedStripeEscrow - Oracle Resilience & Chaos Test Suite", function () {
  let mockUSDC, escrow;
  let owner, buyer, seller, oracle1, oracle2, oracle3, feeRecipient, attacker;

  const INITIAL_MINT = ethers.utils.parseUnits("10000", 6);
  const ITEM_PRICE = ethers.utils.parseUnits("100", 6);
  const FEE_AMOUNT = ITEM_PRICE.mul(10).div(10000);
  const GROSS_AMOUNT = ITEM_PRICE.add(FEE_AMOUNT);
  const ORDER_ID = ethers.utils.id("CHAOS_ORDER_123");
  const CARRIER_ID = "UPS";
  const TRACKING_NUMBER = "1Z9999999999999999";
  const TRACKING_HASH = ethers.utils.solidityKeccak256(["bytes"], [ethers.utils.defaultAbiCoder.encode(["string", "string"], [CARRIER_ID, TRACKING_NUMBER])]);

  async function expectRevertCustomError(promise, contract, errorName) {
    try {
      await promise;
      expect.fail(`Expected transaction to revert with ${errorName}, but it succeeded`);
    } catch (error) {
      if (error.message.includes(errorName) || (error.error && error.error.message && error.error.message.includes(errorName))) {
        return;
      }
      throw error;
    }
  }

  async function createEIP712Signature(signer, orderId, buyerAddr, sellerAddr, tokenAddr, grossAmount, itemPrice, carrierId, trackingHash, nonce, voucherDeadline) {
    const chainId = (await ethers.provider.getNetwork()).chainId;
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
      buyer: buyerAddr,
      seller: sellerAddr,
      token: tokenAddr,
      grossAmount: grossAmount,
      itemPrice: itemPrice,
      carrierId: carrierId,
      trackingHash: trackingHash,
      nonce: nonce,
      voucherDeadline: voucherDeadline
    };

    return await signer._signTypedData(domain, types, value);
  }

  beforeEach(async function () {
    [owner, buyer, seller, oracle1, oracle2, oracle3, feeRecipient, attacker] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    mockUSDC = await MockUSDC.deploy();
    await mockUSDC.deployed();

    const Escrow = await ethers.getContractFactory("DecentralizedStripeEscrow");
    escrow = await Escrow.deploy(
      mockUSDC.address,
      [oracle1.address, oracle2.address, oracle3.address],
      feeRecipient.address
    );
    await escrow.deployed();

    await mockUSDC.mint(buyer.address, INITIAL_MINT);
    await mockUSDC.connect(buyer).approve(escrow.address, INITIAL_MINT);
    await escrow.connect(buyer).deposit(ORDER_ID, seller.address, ITEM_PRICE);
  });

  it("Scenario 1: Single Oracle Offline (Normal Degradation - Oracles 1 & 2 sign)", async function () {
    const block = await ethers.provider.getBlock("latest");
    const voucherDeadline = block.timestamp + 3600;

    const sig1 = await createEIP712Signature(oracle1, ORDER_ID, buyer.address, seller.address, mockUSDC.address, GROSS_AMOUNT, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline);
    const sig2 = await createEIP712Signature(oracle2, ORDER_ID, buyer.address, seller.address, mockUSDC.address, GROSS_AMOUNT, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline);

    await escrow.settleWithOracle(ORDER_ID, GROSS_AMOUNT, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline, [sig1, sig2]);

    const order = await escrow.orders(ORDER_ID);
    expect(order.state).to.equal(2); // SETTLED
  });

  it("Scenario 2: Two Oracles Offline (Quorum Loss - Only Oracle 1 signs)", async function () {
    const block = await ethers.provider.getBlock("latest");
    const voucherDeadline = block.timestamp + 3600;

    const sig1 = await createEIP712Signature(oracle1, ORDER_ID, buyer.address, seller.address, mockUSDC.address, GROSS_AMOUNT, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline);

    await expectRevertCustomError(
      escrow.settleWithOracle(ORDER_ID, GROSS_AMOUNT, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline, [sig1]),
      escrow,
      "InvalidQuorum"
    );

    const order = await escrow.orders(ORDER_ID);
    expect(order.state).to.equal(1); // FUNDED
  });

  it("Scenario 3: One Malicious + One Offline Oracle (Critical Security Boundary)", async function () {
    const block = await ethers.provider.getBlock("latest");
    const voucherDeadline = block.timestamp + 3600;

    const sig1 = await createEIP712Signature(oracle1, ORDER_ID, buyer.address, seller.address, mockUSDC.address, GROSS_AMOUNT, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline);
    // Compromised Oracle 2 signs invalid/forged itemPrice
    const sig2Forged = await createEIP712Signature(oracle2, ORDER_ID, buyer.address, seller.address, mockUSDC.address, GROSS_AMOUNT, ITEM_PRICE.add(1000), CARRIER_ID, TRACKING_HASH, 1, voucherDeadline);

    await expectRevertCustomError(
      escrow.settleWithOracle(ORDER_ID, GROSS_AMOUNT, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline, [sig1, sig2Forged]),
      escrow,
      "InvalidSignature"
    );

    const order = await escrow.orders(ORDER_ID);
    expect(order.state).to.equal(1); // FUNDED (Funds safe)
  });

  it("Scenario 4: Replayed / Duplicate Webhook Attestation", async function () {
    const block = await ethers.provider.getBlock("latest");
    const voucherDeadline = block.timestamp + 3600;

    const sig1 = await createEIP712Signature(oracle1, ORDER_ID, buyer.address, seller.address, mockUSDC.address, GROSS_AMOUNT, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline);
    const sig2 = await createEIP712Signature(oracle2, ORDER_ID, buyer.address, seller.address, mockUSDC.address, GROSS_AMOUNT, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline);

    // 1st call succeeds
    await escrow.settleWithOracle(ORDER_ID, GROSS_AMOUNT, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline, [sig1, sig2]);

    // 2nd call with identical nonce reverts on NonceAlreadyUsed or InvalidStatus
    await expectRevertCustomError(
      escrow.settleWithOracle(ORDER_ID, GROSS_AMOUNT, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline, [sig1, sig2]),
      escrow,
      "InvalidStatus"
    );
  });

  it("Scenario 5: Expired Voucher Attestation", async function () {
    const expiredDeadline = Math.floor(Date.now() / 1000) - 500;

    const sig1 = await createEIP712Signature(oracle1, ORDER_ID, buyer.address, seller.address, mockUSDC.address, GROSS_AMOUNT, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, 1, expiredDeadline);
    const sig2 = await createEIP712Signature(oracle2, ORDER_ID, buyer.address, seller.address, mockUSDC.address, GROSS_AMOUNT, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, 1, expiredDeadline);

    await expectRevertCustomError(
      escrow.settleWithOracle(ORDER_ID, GROSS_AMOUNT, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, 1, expiredDeadline, [sig1, sig2]),
      escrow,
      "SignatureExpired"
    );
  });

  it("Scenario 6: Conflicting Carrier Data / Invalid Tracking Hash", async function () {
    const block = await ethers.provider.getBlock("latest");
    const voucherDeadline = block.timestamp + 3600;
    const mismatchedHash = ethers.utils.id("MISMATCHED_TRACKING");

    const sig1 = await createEIP712Signature(oracle1, ORDER_ID, buyer.address, seller.address, mockUSDC.address, GROSS_AMOUNT, ITEM_PRICE, CARRIER_ID, mismatchedHash, 1, voucherDeadline);
    const sig2 = await createEIP712Signature(oracle2, ORDER_ID, buyer.address, seller.address, mockUSDC.address, GROSS_AMOUNT, ITEM_PRICE, CARRIER_ID, mismatchedHash, 1, voucherDeadline);

    // Submitting trackingHash != expected mismatchedHash in digest recovery causes InvalidSignature revert
    await expectRevertCustomError(
      escrow.settleWithOracle(ORDER_ID, GROSS_AMOUNT, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline, [sig1, sig2]),
      escrow,
      "InvalidSignature"
    );
  });
});
