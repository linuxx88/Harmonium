const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DecentralizedStripeEscrow - Hardened EIP-712 & 2-of-3 Threshold", function () {
  let mockUSDC, escrow;
  let owner, buyer, seller, oracle1, oracle2, oracle3, feeRecipient, attacker;

  const INITIAL_MINT = ethers.utils.parseUnits("1000", 6); // 1,000 USDC (6 decimals)
  const NET_AMOUNT = ethers.utils.parseUnits("100", 6);     // $100.00 USDC
  const FEE_AMOUNT = NET_AMOUNT.mul(10).div(10000);         // $0.10 USDC (10 bps)
  const TOTAL_DEPOSIT = NET_AMOUNT.add(FEE_AMOUNT);         // $100.10 USDC
  const ORDER_ID = ethers.utils.id("ORDER_SECURE_123");
  const TRACKING_HASH = ethers.utils.id("TRACKING_UPS_999");

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

  describe("Deposit (Buyer Pays Surcharge)", function () {
    it("Should deposit net amount + surcharge fee successfully", async function () {
      const initialBuyerBalance = await mockUSDC.balanceOf(buyer.address);

      const tx = await escrow.connect(buyer).deposit(ORDER_ID, seller.address, NET_AMOUNT);
      const receipt = await tx.wait();

      const event = receipt.events.find(e => e.event === 'PaymentDeposited');
      expect(event).to.not.be.undefined;
      expect(event.args.orderId).to.equal(ORDER_ID);
      expect(event.args.buyer).to.equal(buyer.address);
      expect(event.args.seller).to.equal(seller.address);
      expect(event.args.netAmount.toString()).to.equal(NET_AMOUNT.toString());
      expect(event.args.feeAmount.toString()).to.equal(FEE_AMOUNT.toString());

      const finalBuyerBalance = await mockUSDC.balanceOf(buyer.address);
      expect(initialBuyerBalance.sub(finalBuyerBalance).toString()).to.equal(TOTAL_DEPOSIT.toString());

      const order = await escrow.orders(ORDER_ID);
      expect(order.netAmount.toString()).to.equal(NET_AMOUNT.toString());
      expect(order.feeAmount.toString()).to.equal(FEE_AMOUNT.toString());
      expect(order.nonce.toString()).to.equal("1");
    });
  });

  describe("EIP-712 & 2-of-3 Threshold Settlement", function () {
    beforeEach(async function () {
      await escrow.connect(buyer).deposit(ORDER_ID, seller.address, NET_AMOUNT);
    });

    it("Should release escrow when 2-of-3 valid oracle EIP-712 signatures are provided", async function () {
      const deadline = Math.floor(Date.now() / 1000) + 3600;

      const sig1 = await createEIP712Signature(
        oracle1, ORDER_ID, buyer.address, seller.address, mockUSDC.address, NET_AMOUNT, TRACKING_HASH, 1, deadline
      );
      const sig2 = await createEIP712Signature(
        oracle2, ORDER_ID, buyer.address, seller.address, mockUSDC.address, NET_AMOUNT, TRACKING_HASH, 1, deadline
      );

      const initialSellerBalance = await mockUSDC.balanceOf(seller.address);
      const initialFeeBalance = await mockUSDC.balanceOf(feeRecipient.address);

      await escrow.releaseWithOracle(ORDER_ID, TRACKING_HASH, deadline, [sig1, sig2]);

      const finalSellerBalance = await mockUSDC.balanceOf(seller.address);
      const finalFeeBalance = await mockUSDC.balanceOf(feeRecipient.address);

      expect(finalSellerBalance.sub(initialSellerBalance).toString()).to.equal(NET_AMOUNT.toString());
      expect(finalFeeBalance.sub(initialFeeBalance).toString()).to.equal(FEE_AMOUNT.toString());
    });

    it("Should revert if only 1 signature is provided (Quorum check)", async function () {
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const sig1 = await createEIP712Signature(
        oracle1, ORDER_ID, buyer.address, seller.address, mockUSDC.address, NET_AMOUNT, TRACKING_HASH, 1, deadline
      );

      await expectRevertCustomError(
        escrow.releaseWithOracle(ORDER_ID, TRACKING_HASH, deadline, [sig1]),
        escrow,
        "InvalidQuorum"
      );
    });

    it("Should revert on duplicate signatures from the same oracle signer", async function () {
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const sig1 = await createEIP712Signature(
        oracle1, ORDER_ID, buyer.address, seller.address, mockUSDC.address, NET_AMOUNT, TRACKING_HASH, 1, deadline
      );

      await expectRevertCustomError(
        escrow.releaseWithOracle(ORDER_ID, TRACKING_HASH, deadline, [sig1, sig1]),
        escrow,
        "DuplicateSignature"
      );
    });

    it("Should revert on unauthorized attacker signature", async function () {
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const sig1 = await createEIP712Signature(
        oracle1, ORDER_ID, buyer.address, seller.address, mockUSDC.address, NET_AMOUNT, TRACKING_HASH, 1, deadline
      );
      const sigAttacker = await createEIP712Signature(
        attacker, ORDER_ID, buyer.address, seller.address, mockUSDC.address, NET_AMOUNT, TRACKING_HASH, 1, deadline
      );

      await expectRevertCustomError(
        escrow.releaseWithOracle(ORDER_ID, TRACKING_HASH, deadline, [sig1, sigAttacker]),
        escrow,
        "InvalidSignature"
      );
    });

    it("Should revert on expired deadline", async function () {
      const expiredDeadline = Math.floor(Date.now() / 1000) - 100;
      const sig1 = await createEIP712Signature(
        oracle1, ORDER_ID, buyer.address, seller.address, mockUSDC.address, NET_AMOUNT, TRACKING_HASH, 1, expiredDeadline
      );
      const sig2 = await createEIP712Signature(
        oracle2, ORDER_ID, buyer.address, seller.address, mockUSDC.address, NET_AMOUNT, TRACKING_HASH, 1, expiredDeadline
      );

      await expectRevertCustomError(
        escrow.releaseWithOracle(ORDER_ID, TRACKING_HASH, expiredDeadline, [sig1, sig2]),
        escrow,
        "SignatureExpired"
      );
    });
  });

  describe("Buyer Direct Controls & Buyer-Triggered Refund", function () {
    beforeEach(async function () {
      await escrow.connect(buyer).deposit(ORDER_ID, seller.address, NET_AMOUNT);
    });

    it("Should allow buyer to directly release payment to seller", async function () {
      await escrow.connect(buyer).releaseByBuyer(ORDER_ID);
      const order = await escrow.orders(ORDER_ID);
      expect(order.status).to.equal(2); // Released
    });

    it("Should revert non-buyer attempt for direct release", async function () {
      await expectRevertCustomError(
        escrow.connect(seller).releaseByBuyer(ORDER_ID),
        escrow,
        "Unauthorized"
      );
    });

    it("Should execute buyer-triggered refund after 7-day timeout", async function () {
      await ethers.provider.send("evm_increaseTime", [7 * 86400 + 1]);
      await ethers.provider.send("evm_mine");

      const initialBuyerBalance = await mockUSDC.balanceOf(buyer.address);
      await escrow.connect(buyer).refundTimeout(ORDER_ID);

      const finalBuyerBalance = await mockUSDC.balanceOf(buyer.address);
      expect(finalBuyerBalance.sub(initialBuyerBalance).toString()).to.equal(TOTAL_DEPOSIT.toString());
    });

    it("Should revert non-buyer attempt for timeout refund", async function () {
      await ethers.provider.send("evm_increaseTime", [7 * 86400 + 1]);
      await ethers.provider.send("evm_mine");

      await expectRevertCustomError(
        escrow.connect(seller).refundTimeout(ORDER_ID),
        escrow,
        "Unauthorized"
      );
    });
  });
});
