const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DecentralizedStripeEscrow - Hardened EIP-712 & 2-of-3 Threshold", function () {
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

  async function createEIP712Signature(signer, orderId, buyerAddr, sellerAddr, tokenAddr, amount, trackingHash, nonce, deadline) {
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
        { name: "amount", type: "uint256" },
        { name: "trackingHash", type: "bytes32" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" }
      ]
    };

    const value = {
      orderId: orderId,
      buyer: buyerAddr,
      seller: sellerAddr,
      token: tokenAddr,
      amount: amount,
      trackingHash: trackingHash,
      nonce: nonce,
      deadline: deadline
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
  });

  describe("Deposit & Gross Surcharge Accounting", function () {
    it("Should deposit item price + surcharge fee successfully and set OrderState.FUNDED", async function () {
      const initialBuyerBalance = await mockUSDC.balanceOf(buyer.address);

      const tx = await escrow.connect(buyer).deposit(ORDER_ID, seller.address, ITEM_PRICE);
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
      expect(order.state).to.equal(2); // OrderState.FUNDED
      expect(order.nonce.toString()).to.equal("1");
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
      const deadline = block.timestamp + 3600;

      const sig1 = await createEIP712Signature(
        oracle1, ORDER_ID, buyer.address, seller.address, mockUSDC.address, ITEM_PRICE, TRACKING_HASH, 1, deadline
      );
      const sig2 = await createEIP712Signature(
        oracle2, ORDER_ID, buyer.address, seller.address, mockUSDC.address, ITEM_PRICE, TRACKING_HASH, 1, deadline
      );

      const initialSellerBalance = await mockUSDC.balanceOf(seller.address);
      const initialFeeBalance = await mockUSDC.balanceOf(feeRecipient.address);

      await escrow.releaseWithOracle(ORDER_ID, TRACKING_HASH, deadline, [sig1, sig2]);

      const finalSellerBalance = await mockUSDC.balanceOf(seller.address);
      const finalFeeBalance = await mockUSDC.balanceOf(feeRecipient.address);

      expect(finalSellerBalance.sub(initialSellerBalance).toString()).to.equal(ITEM_PRICE.toString());
      expect(finalFeeBalance.sub(initialFeeBalance).toString()).to.equal(FEE_AMOUNT.toString());

      const order = await escrow.orders(ORDER_ID);
      expect(order.state).to.equal(3); // OrderState.SETTLED
    });

    it("Should revert if only 1 signature is provided (Quorum check)", async function () {
      const block = await ethers.provider.getBlock("latest");
      const deadline = block.timestamp + 3600;
      const sig1 = await createEIP712Signature(
        oracle1, ORDER_ID, buyer.address, seller.address, mockUSDC.address, ITEM_PRICE, TRACKING_HASH, 1, deadline
      );

      await expectRevertCustomError(
        escrow.releaseWithOracle(ORDER_ID, TRACKING_HASH, deadline, [sig1]),
        escrow,
        "InvalidQuorum"
      );
    });

    it("Should revert on duplicate signatures from the same oracle signer", async function () {
      const block = await ethers.provider.getBlock("latest");
      const deadline = block.timestamp + 3600;
      const sig1 = await createEIP712Signature(
        oracle1, ORDER_ID, buyer.address, seller.address, mockUSDC.address, ITEM_PRICE, TRACKING_HASH, 1, deadline
      );

      await expectRevertCustomError(
        escrow.releaseWithOracle(ORDER_ID, TRACKING_HASH, deadline, [sig1, sig1]),
        escrow,
        "DuplicateSignature"
      );
    });

    it("Should revert on unauthorized attacker signature", async function () {
      const block = await ethers.provider.getBlock("latest");
      const deadline = block.timestamp + 3600;
      const sig1 = await createEIP712Signature(
        oracle1, ORDER_ID, buyer.address, seller.address, mockUSDC.address, ITEM_PRICE, TRACKING_HASH, 1, deadline
      );
      const sigAttacker = await createEIP712Signature(
        attacker, ORDER_ID, buyer.address, seller.address, mockUSDC.address, ITEM_PRICE, TRACKING_HASH, 1, deadline
      );

      await expectRevertCustomError(
        escrow.releaseWithOracle(ORDER_ID, TRACKING_HASH, deadline, [sig1, sigAttacker]),
        escrow,
        "InvalidSignature"
      );
    });

    it("Should revert on expired signature deadline", async function () {
      const expiredDeadline = Math.floor(Date.now() / 1000) - 100;
      const sig1 = await createEIP712Signature(
        oracle1, ORDER_ID, buyer.address, seller.address, mockUSDC.address, ITEM_PRICE, TRACKING_HASH, 1, expiredDeadline
      );
      const sig2 = await createEIP712Signature(
        oracle2, ORDER_ID, buyer.address, seller.address, mockUSDC.address, ITEM_PRICE, TRACKING_HASH, 1, expiredDeadline
      );

      await expectRevertCustomError(
        escrow.releaseWithOracle(ORDER_ID, TRACKING_HASH, expiredDeadline, [sig1, sig2]),
        escrow,
        "SignatureExpired"
      );
    });
  });

  describe("Deterministic Settlement vs Refund Race Condition & Non-Custodial Controls", function () {
    beforeEach(async function () {
      await escrow.connect(buyer).deposit(ORDER_ID, seller.address, ITEM_PRICE);
    });

    it("Should allow buyer to directly release payment to seller", async function () {
      await escrow.connect(buyer).releaseByBuyer(ORDER_ID);
      const order = await escrow.orders(ORDER_ID);
      expect(order.state).to.equal(3); // OrderState.SETTLED
    });

    it("Should revert non-buyer attempt for direct release", async function () {
      await expectRevertCustomError(
        escrow.connect(seller).releaseByBuyer(ORDER_ID),
        escrow,
        "Unauthorized"
      );
    });

    it("Should allow buyer claimRefund after timeout expiry", async function () {
      await ethers.provider.send("evm_increaseTime", [7 * 86400 + 1]);
      await ethers.provider.send("evm_mine");

      const initialBuyerBalance = await mockUSDC.balanceOf(buyer.address);
      await escrow.connect(buyer).claimRefund(ORDER_ID);

      const finalBuyerBalance = await mockUSDC.balanceOf(buyer.address);
      expect(finalBuyerBalance.sub(initialBuyerBalance).toString()).to.equal(GROSS_AMOUNT.toString());

      const order = await escrow.orders(ORDER_ID);
      expect(order.state).to.equal(4); // OrderState.REFUNDED
    });

    it("Should enforce irreversible terminal state (cannot refund after SETTLED)", async function () {
      await escrow.connect(buyer).releaseByBuyer(ORDER_ID);

      await ethers.provider.send("evm_increaseTime", [7 * 86400 + 1]);
      await ethers.provider.send("evm_mine");

      await expectRevertCustomError(
        escrow.connect(buyer).claimRefund(ORDER_ID),
        escrow,
        "InvalidStatus"
      );
    });

    it("Should enforce irreversible terminal state (cannot SETTLE after REFUNDED)", async function () {
      await ethers.provider.send("evm_increaseTime", [7 * 86400 + 1]);
      await ethers.provider.send("evm_mine");

      await escrow.connect(buyer).claimRefund(ORDER_ID);

      await expectRevertCustomError(
        escrow.connect(buyer).releaseByBuyer(ORDER_ID),
        escrow,
        "InvalidStatus"
      );
    });
  });
});
