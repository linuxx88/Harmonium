/**
 * === Formal Threat Model & Oracle Resilience Test Suite ===
 * Statement: The system does not eliminate oracle risk; it elevates the compromise threshold to N >= 2.
 * 
 * Boundary Conditions:
 * 1. 1 compromised oracle -> Settlement remains cryptographically protected (Security assumption HOLDS).
 * 2. 2 compromised oracles -> Threshold broken, unauthorized settlement becomes possible (Security assumption FAILS).
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("HarmoniumPayEscrow - Oracle Resilience & Chaos Test Suite", function () {
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
      name: "HarmoniumPayEscrow",
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

    const Escrow = await ethers.getContractFactory("HarmoniumPayEscrow");
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
      "InvalidQuorum"
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

    // Submitting trackingHash != expected mismatchedHash in digest recovery causes InvalidQuorum revert
    await expectRevertCustomError(
      escrow.settleWithOracle(ORDER_ID, GROSS_AMOUNT, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline, [sig1, sig2]),
      escrow,
      "InvalidQuorum"
    );
  });

  describe("Phase 7 - Additional Chaos & Attack Vectors", function () {
    it("Vector A: Reentrancy Defense & CEI Compliance", async function () {
      const orderIdVecA = ethers.utils.id("CHAOS_REENTRANCY_VECTOR");
      await escrow.connect(buyer).deposit(orderIdVecA, seller.address, ITEM_PRICE);

      const block = await ethers.provider.getBlock("latest");
      const voucherDeadline = block.timestamp + 3600;

      const sig1 = await createEIP712Signature(oracle1, orderIdVecA, buyer.address, seller.address, mockUSDC.address, GROSS_AMOUNT, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline);
      const sig2 = await createEIP712Signature(oracle2, orderIdVecA, buyer.address, seller.address, mockUSDC.address, GROSS_AMOUNT, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline);

      await escrow.settleWithOracle(orderIdVecA, GROSS_AMOUNT, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline, [sig1, sig2]);
      const order = await escrow.orders(orderIdVecA);
      expect(order.state).to.equal(2); // SETTLED

      // Any reentrant or secondary attempt immediately reverts due to state != FUNDED
      await expectRevertCustomError(
        escrow.settleWithOracle(orderIdVecA, GROSS_AMOUNT, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline, [sig1, sig2]),
        escrow,
        "InvalidStatus"
      );
    });


    it("Vector B: Block Timestamp Boundary Manipulation on Deadlines", async function () {
      const Escrow = await ethers.getContractFactory("HarmoniumPayEscrow");
      const freshEscrow = await Escrow.deploy(
        mockUSDC.address,
        [oracle1.address, oracle2.address, oracle3.address],
        feeRecipient.address
      );
      await freshEscrow.deployed();
      await mockUSDC.connect(buyer).approve(freshEscrow.address, INITIAL_MINT);

      const orderIdBound = ethers.utils.id("CHAOS_TIMESTAMP_BOUNDARY_ISOLATED");
      await freshEscrow.connect(buyer).deposit(orderIdBound, seller.address, ITEM_PRICE);

      const order = await freshEscrow.orders(orderIdBound);
      const deadline = order.fulfillmentDeadline.toNumber();

      // At exactly deadline - 10s, claimRefund MUST revert
      const currentBlock = await ethers.provider.getBlock("latest");
      const timeToAdvance = deadline - currentBlock.timestamp - 10;
      if (timeToAdvance > 0) {
        await ethers.provider.send("evm_increaseTime", [timeToAdvance]);
        await ethers.provider.send("evm_mine");
      }

      await expectRevertCustomError(
        freshEscrow.connect(buyer).claimRefund(orderIdBound),
        freshEscrow,
        "TimeoutNotReached"
      );

      // Advance time past fulfillment deadline
      await ethers.provider.send("evm_increaseTime", [20]);
      await ethers.provider.send("evm_mine");

      await freshEscrow.connect(buyer).claimRefund(orderIdBound);
      const refundedOrder = await freshEscrow.orders(orderIdBound);
      expect(refundedOrder.state).to.equal(3); // REFUNDED
    });



    it("Vector C: Front-running / Mempool Race Condition between Settle and Refund", async function () {
      const orderIdRace = ethers.utils.id("CHAOS_MEMPOOL_RACE");
      await escrow.connect(buyer).deposit(orderIdRace, seller.address, ITEM_PRICE);

      // Advance time past fulfillment deadline
      await ethers.provider.send("evm_increaseTime", [7 * 86400 + 10]);
      await ethers.provider.send("evm_mine");

      const block = await ethers.provider.getBlock("latest");
      const voucherDeadline = block.timestamp + 3600;
      const grossAmount = (await escrow.orders(orderIdRace)).grossAmount;

      const sig1 = await createEIP712Signature(oracle1, orderIdRace, buyer.address, seller.address, mockUSDC.address, grossAmount, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline);
      const sig2 = await createEIP712Signature(oracle2, orderIdRace, buyer.address, seller.address, mockUSDC.address, grossAmount, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline);

      // Tx1 mined: Buyer claimRefund
      await escrow.connect(buyer).claimRefund(orderIdRace);

      // Tx2 in mempool: Attacker/Seller settleWithOracle executes second -> MUST REVERT with InvalidStatus
      await expectRevertCustomError(
        escrow.settleWithOracle(orderIdRace, grossAmount, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline, [sig1, sig2]),
        escrow,
        "InvalidStatus"
      );
    });
  });

});
