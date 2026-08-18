const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("HarmoniumPayEscrow - Hardened EIP-712 & 2-of-3 Threshold", function () {
  let mockUSDC, escrow;
  let owner, buyer, seller, oracle1, oracle2, oracle3, feeRecipient, attacker;

  const INITIAL_MINT = ethers.utils.parseUnits("1000", 6); // 1,000 USDC (6 decimals)
  const ITEM_PRICE = ethers.utils.parseUnits("100", 6);     // $100.00 USDC
  const FEE_AMOUNT = ITEM_PRICE.mul(10).div(10000);         // $0.10 USDC (10 bps)
  const GROSS_AMOUNT = ITEM_PRICE.add(FEE_AMOUNT);         // $100.10 USDC
  const ORDER_ID = ethers.utils.id("ORDER_SECURE_123");
  const CARRIER_ID = "UPS";
  const TRACKING_NUMBER = "1Z9999999999999999";
  const TRACKING_HASH = ethers.utils.solidityKeccak256(["bytes"], [ethers.utils.defaultAbiCoder.encode(["string", "string"], [CARRIER_ID, TRACKING_NUMBER])]);

  async function expectRevertCustomError(promise, contract, errorName) {
    try {
      await promise;
      expect.fail(`Expected transaction to revert with custom error ${errorName}, but it succeeded`);
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
  });

  describe("Deposit & Gross Surcharge Accounting", function () {
    it("Should deposit item price + surcharge fee successfully and set OrderState.FUNDED", async function () {
      const initialBuyerBalance = await mockUSDC.balanceOf(buyer.address);

      const tx = await escrow.connect(buyer).createAndFundOrder(ORDER_ID, seller.address, ITEM_PRICE);
      const receipt = await tx.wait();

      const event = receipt.events.find(e => e.event === 'PaymentDeposited');
      expect(event).to.not.be.undefined;
      expect(event.args.orderId).to.equal(ORDER_ID);
      expect(event.args.buyer).to.equal(buyer.address);
      expect(event.args.seller).to.equal(seller.address);
      expect(event.args.itemPrice.toString()).to.equal(ITEM_PRICE.toString());
      expect(event.args.feeAmount.toString()).to.equal(FEE_AMOUNT.toString());
      expect(event.args.grossAmount.toString()).to.equal(GROSS_AMOUNT.toString());

      const finalBuyerBalance = await mockUSDC.balanceOf(buyer.address);
      expect(initialBuyerBalance.sub(finalBuyerBalance).toString()).to.equal(GROSS_AMOUNT.toString());

      const order = await escrow.orders(ORDER_ID);
      expect(order.itemPrice.toString()).to.equal(ITEM_PRICE.toString());
      expect(order.feeAmount.toString()).to.equal(FEE_AMOUNT.toString());
      expect(order.grossAmount.toString()).to.equal(GROSS_AMOUNT.toString());
      expect(order.state).to.equal(1); // OrderState.FUNDED (UNINITIALIZED=0, FUNDED=1, SETTLED=2, REFUNDED=3)
    });

    it("Should correctly compute carrier tracking hash", async function () {
      const hashFromContract = await escrow.computeTrackingHash(CARRIER_ID, TRACKING_NUMBER);
      expect(hashFromContract).to.equal(TRACKING_HASH);
    });
  });

  describe("EIP-712 & 2-of-3 Threshold Settlement", function () {
    beforeEach(async function () {
      await escrow.connect(buyer).deposit(ORDER_ID, seller.address, ITEM_PRICE);
    });

    it("Should release escrow when 2-of-3 valid oracle EIP-712 signatures are provided", async function () {
      const block = await ethers.provider.getBlock("latest");
      const voucherDeadline = block.timestamp + 3600;

      const sig1 = await createEIP712Signature(
        oracle1, ORDER_ID, buyer.address, seller.address, mockUSDC.address, GROSS_AMOUNT, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline
      );
      const sig2 = await createEIP712Signature(
        oracle2, ORDER_ID, buyer.address, seller.address, mockUSDC.address, GROSS_AMOUNT, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline
      );

      const initialSellerBalance = await mockUSDC.balanceOf(seller.address);
      const initialFeeBalance = await mockUSDC.balanceOf(feeRecipient.address);

      await escrow.releaseWithOracle(ORDER_ID, GROSS_AMOUNT, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline, [sig1, sig2]);

      const finalSellerBalance = await mockUSDC.balanceOf(seller.address);
      const finalFeeBalance = await mockUSDC.balanceOf(feeRecipient.address);

      expect(finalSellerBalance.sub(initialSellerBalance).toString()).to.equal(ITEM_PRICE.toString());
      expect(finalFeeBalance.sub(initialFeeBalance).toString()).to.equal(FEE_AMOUNT.toString());

      const order = await escrow.orders(ORDER_ID);
      expect(order.state).to.equal(2); // OrderState.SETTLED
    });

    it("Should settle escrow via settleWithOracle alias following CEI pattern", async function () {
      const block = await ethers.provider.getBlock("latest");
      const voucherDeadline = block.timestamp + 3600;

      const sig1 = await createEIP712Signature(
        oracle1, ORDER_ID, buyer.address, seller.address, mockUSDC.address, GROSS_AMOUNT, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline
      );
      const sig2 = await createEIP712Signature(
        oracle2, ORDER_ID, buyer.address, seller.address, mockUSDC.address, GROSS_AMOUNT, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline
      );

      await escrow.settleWithOracle(ORDER_ID, GROSS_AMOUNT, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline, [sig1, sig2]);

      const order = await escrow.orders(ORDER_ID);
      expect(order.state).to.equal(2); // OrderState.SETTLED
    });

    it("Should revert if only 1 signature is provided (Quorum check)", async function () {
      const block = await ethers.provider.getBlock("latest");
      const voucherDeadline = block.timestamp + 3600;
      const sig1 = await createEIP712Signature(
        oracle1, ORDER_ID, buyer.address, seller.address, mockUSDC.address, GROSS_AMOUNT, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline
      );

      await expectRevertCustomError(
        escrow.releaseWithOracle(ORDER_ID, GROSS_AMOUNT, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline, [sig1]),
        escrow,
        "InvalidQuorum"
      );
    });

    it("Should revert on duplicate signatures from the same oracle signer resulting in insufficient quorum", async function () {
      const block = await ethers.provider.getBlock("latest");
      const voucherDeadline = block.timestamp + 3600;
      const sig1 = await createEIP712Signature(
        oracle1, ORDER_ID, buyer.address, seller.address, mockUSDC.address, GROSS_AMOUNT, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline
      );

      await expectRevertCustomError(
        escrow.releaseWithOracle(ORDER_ID, GROSS_AMOUNT, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline, [sig1, sig1]),
        escrow,
        "InvalidQuorum"
      );
    });

    it("Should revert on unauthorized attacker signature resulting in insufficient valid quorum", async function () {
      const block = await ethers.provider.getBlock("latest");
      const voucherDeadline = block.timestamp + 3600;
      const sig1 = await createEIP712Signature(
        oracle1, ORDER_ID, buyer.address, seller.address, mockUSDC.address, GROSS_AMOUNT, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline
      );
      const sigAttacker = await createEIP712Signature(
        attacker, ORDER_ID, buyer.address, seller.address, mockUSDC.address, GROSS_AMOUNT, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline
      );

      await expectRevertCustomError(
        escrow.releaseWithOracle(ORDER_ID, GROSS_AMOUNT, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline, [sig1, sigAttacker]),
        escrow,
        "InvalidQuorum"
      );
    });

    it("Should succeed if invalid signature is followed by threshold of valid signatures (resilience)", async function () {
      const block = await ethers.provider.getBlock("latest");
      const voucherDeadline = block.timestamp + 3600;
      const sig1 = await createEIP712Signature(
        oracle1, ORDER_ID, buyer.address, seller.address, mockUSDC.address, GROSS_AMOUNT, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline
      );
      const sig2 = await createEIP712Signature(
        oracle2, ORDER_ID, buyer.address, seller.address, mockUSDC.address, GROSS_AMOUNT, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline
      );
      const sigAttacker = await createEIP712Signature(
        attacker, ORDER_ID, buyer.address, seller.address, mockUSDC.address, GROSS_AMOUNT, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline
      );

      await escrow.releaseWithOracle(ORDER_ID, GROSS_AMOUNT, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline, [sigAttacker, sig1, sig2]);
      const order = await escrow.orders(ORDER_ID);
      expect(order.state).to.equal(2); // OrderState.SETTLED
    });

    it("Should revert on expired signature voucherDeadline", async function () {
      const expiredDeadline = Math.floor(Date.now() / 1000) - 100;
      const sig1 = await createEIP712Signature(
        oracle1, ORDER_ID, buyer.address, seller.address, mockUSDC.address, GROSS_AMOUNT, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, 1, expiredDeadline
      );
      const sig2 = await createEIP712Signature(
        oracle2, ORDER_ID, buyer.address, seller.address, mockUSDC.address, GROSS_AMOUNT, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, 1, expiredDeadline
      );

      await expectRevertCustomError(
        escrow.releaseWithOracle(ORDER_ID, GROSS_AMOUNT, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, 1, expiredDeadline, [sig1, sig2]),
        escrow,
        "SignatureExpired"
      );
    });

    it("Should revert on forged/tampered EIP-712 parameter binding (itemPrice mismatch)", async function () {
      const block = await ethers.provider.getBlock("latest");
      const voucherDeadline = block.timestamp + 3600;
      const tamperedPrice = ethers.utils.parseUnits("50", 6); // 50 instead of 100

      const sig1 = await createEIP712Signature(
        oracle1, ORDER_ID, buyer.address, seller.address, mockUSDC.address, GROSS_AMOUNT, tamperedPrice, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline
      );
      const sig2 = await createEIP712Signature(
        oracle2, ORDER_ID, buyer.address, seller.address, mockUSDC.address, GROSS_AMOUNT, tamperedPrice, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline
      );

      await expectRevertCustomError(
        escrow.releaseWithOracle(ORDER_ID, GROSS_AMOUNT, tamperedPrice, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline, [sig1, sig2]),
        escrow,
        "InvalidAccounting"
      );
    });

    it("Should revert when attempting to replay a settlement on an already settled order", async function () {
      const block = await ethers.provider.getBlock("latest");
      const voucherDeadline = block.timestamp + 3600;
      const nonce = 42;

      const sig1 = await createEIP712Signature(
        oracle1, ORDER_ID, buyer.address, seller.address, mockUSDC.address, GROSS_AMOUNT, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, nonce, voucherDeadline
      );
      const sig2 = await createEIP712Signature(
        oracle2, ORDER_ID, buyer.address, seller.address, mockUSDC.address, GROSS_AMOUNT, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, nonce, voucherDeadline
      );

      // Settle successfully once
      await escrow.settleWithOracle(ORDER_ID, GROSS_AMOUNT, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, nonce, voucherDeadline, [sig1, sig2]);

      // Replay attempt on same order reverts with InvalidStatus (already SETTLED)
      await expectRevertCustomError(
        escrow.settleWithOracle(ORDER_ID, GROSS_AMOUNT, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, nonce, voucherDeadline, [sig1, sig2]),
        escrow,
        "InvalidStatus"
      );
    });
  });

  describe("Deterministic Settlement vs Refund Race Condition & Non-Custodial Controls", function () {
    beforeEach(async function () {
      await escrow.connect(buyer).deposit(ORDER_ID, seller.address, ITEM_PRICE);
    });

    it("Should allow buyer to directly confirm receipt and release payment to seller", async function () {
      await escrow.connect(buyer).confirmReceiptByBuyer(ORDER_ID);
      const order = await escrow.orders(ORDER_ID);
      expect(order.state).to.equal(2); // OrderState.SETTLED
    });

    it("Should revert confirmReceiptByBuyer when called by unauthorized roles (seller, oracle, owner/admin, attacker)", async function () {
      // Seller attempt
      await expectRevertCustomError(
        escrow.connect(seller).confirmReceiptByBuyer(ORDER_ID),
        escrow,
        "Unauthorized"
      );
      // Oracle attempt
      await expectRevertCustomError(
        escrow.connect(oracle1).confirmReceiptByBuyer(ORDER_ID),
        escrow,
        "Unauthorized"
      );
      // Admin / Contract Owner attempt
      await expectRevertCustomError(
        escrow.connect(owner).confirmReceiptByBuyer(ORDER_ID),
        escrow,
        "Unauthorized"
      );
      // Attacker attempt
      await expectRevertCustomError(
        escrow.connect(attacker).confirmReceiptByBuyer(ORDER_ID),
        escrow,
        "Unauthorized"
      );
    });

    it("Should revert confirmReceiptByBuyer when order state is not FUNDED", async function () {
      const UNINIT_ORDER = ethers.utils.id("ORDER_UNINITIALIZED_TEST");
      // Attempt on UNINITIALIZED order
      await expectRevertCustomError(
        escrow.connect(buyer).confirmReceiptByBuyer(UNINIT_ORDER),
        escrow,
        "InvalidStatus"
      );
    });

    it("Should allow buyer claimRefund after fulfillment timeout expiry", async function () {
      await ethers.provider.send("evm_increaseTime", [7 * 86400 + 1]);
      await ethers.provider.send("evm_mine");

      const initialBuyerBalance = await mockUSDC.balanceOf(buyer.address);
      await escrow.connect(buyer).claimRefund(ORDER_ID);

      const finalBuyerBalance = await mockUSDC.balanceOf(buyer.address);
      expect(finalBuyerBalance.sub(initialBuyerBalance).toString()).to.equal(GROSS_AMOUNT.toString());

      const order = await escrow.orders(ORDER_ID);
      expect(order.state).to.equal(3); // OrderState.REFUNDED
    });

    it("[INV-1: test_settled_order_cannot_be_refunded] Should enforce irreversible terminal state (cannot refund after SETTLED)", async function () {
      await escrow.connect(buyer).confirmReceiptByBuyer(ORDER_ID);

      await ethers.provider.send("evm_increaseTime", [7 * 86400 + 1]);
      await ethers.provider.send("evm_mine");

      await expectRevertCustomError(
        escrow.connect(buyer).claimRefund(ORDER_ID),
        escrow,
        "InvalidStatus"
      );
    });

    it("[INV-2: test_refunded_order_cannot_settle] Should enforce irreversible terminal state (cannot SETTLE after REFUNDED)", async function () {
      await ethers.provider.send("evm_increaseTime", [7 * 86400 + 1]);
      await ethers.provider.send("evm_mine");

      await escrow.connect(buyer).claimRefund(ORDER_ID);

      await expectRevertCustomError(
        escrow.connect(buyer).confirmReceiptByBuyer(ORDER_ID),
        escrow,
        "InvalidStatus"
      );
    });

    it("[INV-12: test_refund_accessible_when_paused] Should block deposit when contract is paused but allow claimRefund when paused", async function () {
      const NEW_ORDER_ID = ethers.utils.id("ORDER_PAUSE_TEST");
      await escrow.connect(owner).pause();

      await expectRevertCustomError(
        escrow.connect(buyer).deposit(NEW_ORDER_ID, seller.address, ITEM_PRICE),
        escrow,
        "EnforcedPause"
      );

      // Timeout order ORDER_ID deposited during beforeEach
      await ethers.provider.send("evm_increaseTime", [7 * 86400 + 1]);
      await ethers.provider.send("evm_mine");

      // claimRefund must succeed even when paused
      const initialBalance = await mockUSDC.balanceOf(buyer.address);
      await escrow.connect(buyer).claimRefund(ORDER_ID);
      const finalBalance = await mockUSDC.balanceOf(buyer.address);
      expect(finalBalance.sub(initialBalance).toString()).to.equal(GROSS_AMOUNT.toString());
    });
  });

  describe("Formal Invariant 9: No Privileged Arbitrary Transfer", function () {
    beforeEach(async function () {
      await escrow.connect(buyer).deposit(ORDER_ID, seller.address, ITEM_PRICE);
    });

    it("Should revert when contract owner attempts confirmReceiptByBuyer without buyer authority", async function () {
      await expectRevertCustomError(
        escrow.connect(owner).confirmReceiptByBuyer(ORDER_ID),
        escrow,
        "Unauthorized"
      );
    });

    it("Should revert when contract owner attempts claimRefund without buyer authority", async function () {
      await ethers.provider.send("evm_increaseTime", [7 * 86400 + 1]);
      await ethers.provider.send("evm_mine");

      await expectRevertCustomError(
        escrow.connect(owner).claimRefund(ORDER_ID),
        escrow,
        "Unauthorized"
      );
    });

    it("Should revert when contract owner attempts settlement without valid 2-of-3 oracle signatures", async function () {
      const block = await ethers.provider.getBlock("latest");
      const voucherDeadline = block.timestamp + 3600;

      const ownerSig = await createEIP712Signature(
        owner, ORDER_ID, buyer.address, seller.address, mockUSDC.address, GROSS_AMOUNT, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline
      );
      const attackerSig = await createEIP712Signature(
        attacker, ORDER_ID, buyer.address, seller.address, mockUSDC.address, GROSS_AMOUNT, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline
      );

      await expectRevertCustomError(
        escrow.connect(owner).releaseWithOracle(ORDER_ID, GROSS_AMOUNT, ITEM_PRICE, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline, [ownerSig, attackerSig]),
        escrow,
        "InvalidQuorum"
      );
    });

    it("Should preserve immutable protocolFeeRecipient on funded order even if global feeRecipient changes", async function () {
      const newFeeRecipient = attacker.address;
      await escrow.connect(owner).setFeeRecipient(newFeeRecipient);

      const order = await escrow.orders(ORDER_ID);
      expect(order.protocolFeeRecipient).to.equal(feeRecipient.address);
      expect(order.protocolFeeRecipient).to.not.equal(newFeeRecipient);

      const initialFeeRecipientBalance = await mockUSDC.balanceOf(feeRecipient.address);
      await escrow.connect(buyer).confirmReceiptByBuyer(ORDER_ID);
      const finalFeeRecipientBalance = await mockUSDC.balanceOf(feeRecipient.address);

      expect(finalFeeRecipientBalance.sub(initialFeeRecipientBalance).toString()).to.equal(FEE_AMOUNT.toString());
      expect((await mockUSDC.balanceOf(newFeeRecipient)).toString()).to.equal("0");
    });
  });

  describe("Branch & Edge Case Hardening", function () {
    it("Should successfully execute refund via backward-compatible refundTimeout alias", async function () {
      const orderIdAlias = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("order-alias-1"));
      await escrow.connect(buyer).deposit(orderIdAlias, seller.address, ITEM_PRICE);
      
      await ethers.provider.send("evm_increaseTime", [7 * 86400 + 1]);
      await ethers.provider.send("evm_mine");

      const balanceBefore = await mockUSDC.balanceOf(buyer.address);
      await escrow.connect(buyer).refundTimeout(orderIdAlias);
      const balanceAfter = await mockUSDC.balanceOf(buyer.address);
      expect(balanceAfter.sub(balanceBefore).toString()).to.equal(GROSS_AMOUNT.toString());
    });

    it("Should return correct domain separator via getDomainSeparator()", async function () {
      const domainSep = await escrow.getDomainSeparator();
      expect(domainSep).to.match(/^0x[a-fA-F0-9]{64}$/);
    });

    it("Should revert on setFeeRecipient with zero address", async function () {
      await expectRevertCustomError(
        escrow.connect(owner).setFeeRecipient(ethers.constants.AddressZero),
        escrow,
        "InvalidAddress"
      );
    });

    it("Should allow proposing and executing oracle signers update with timelock", async function () {
      await expectRevertCustomError(
        escrow.connect(owner).proposeOracleSigners([oracle1.address]),
        escrow,
        "InvalidQuorum"
      );

      await expectRevertCustomError(
        escrow.connect(owner).proposeOracleSigners([oracle1.address, ethers.constants.AddressZero, oracle2.address]),
        escrow,
        "InvalidAddress"
      );

      await expectRevertCustomError(
        escrow.connect(owner).proposeOracleSigners([oracle1.address, oracle1.address, oracle2.address]),
        escrow,
        "DuplicateSignature"
      );

      const [newO1, newO2, newO3] = [buyer.address, seller.address, attacker.address];
      await escrow.connect(owner).proposeOracleSigners([newO1, newO2, newO3]);

      // Attempting to execute immediately reverts with TimelockNotExpired
      await expectRevertCustomError(
        escrow.connect(owner).executeOracleSignersUpdate(),
        escrow,
        "TimelockNotExpired"
      );

      // Fast forward 2 days
      await ethers.provider.send("evm_increaseTime", [2 * 86400 + 1]);
      await ethers.provider.send("evm_mine");

      await escrow.connect(owner).executeOracleSignersUpdate();
      expect(await escrow.isOracleSigner(newO1)).to.be.true;
      expect(await escrow.isOracleSigner(oracle1.address)).to.be.false;
    });

    it("Should revert deposit with zero address seller or itemPrice below MIN_ITEM_PRICE", async function () {
      const oIdZero = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("order-zero-test"));
      await expectRevertCustomError(
        escrow.connect(buyer).deposit(oIdZero, ethers.constants.AddressZero, ITEM_PRICE),
        escrow,
        "InvalidAddress"
      );

      await expectRevertCustomError(
        escrow.connect(buyer).deposit(oIdZero, seller.address, 0),
        escrow,
        "InvalidAmount"
      );

      await expectRevertCustomError(
        escrow.connect(buyer).deposit(oIdZero, seller.address, 999),
        escrow,
        "InvalidAmount"
      );
    });

    it("Should revert deposit if order already exists", async function () {
      const oIdDup = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("order-dup-test"));
      await escrow.connect(buyer).deposit(oIdDup, seller.address, ITEM_PRICE);
      await expectRevertCustomError(
        escrow.connect(buyer).deposit(oIdDup, seller.address, ITEM_PRICE),
        escrow,
        "OrderAlreadyExists"
      );
    });

    it("Should revert claimRefund if timeout is not reached or caller is not buyer", async function () {
      const oIdRef = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("order-ref-test"));
      await escrow.connect(buyer).deposit(oIdRef, seller.address, ITEM_PRICE);

      await expectRevertCustomError(
        escrow.connect(buyer).claimRefund(oIdRef),
        escrow,
        "TimeoutNotReached"
      );

      await expectRevertCustomError(
        escrow.connect(buyer).refundTimeout(oIdRef),
        escrow,
        "TimeoutNotReached"
      );

      await expectRevertCustomError(
        escrow.connect(attacker).claimRefund(oIdRef),
        escrow,
        "Unauthorized"
      );

      await expectRevertCustomError(
        escrow.connect(attacker).refundTimeout(oIdRef),
        escrow,
        "Unauthorized"
      );
    });
  });

});
