const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DecentralizedStripeEscrow", function () {
  let mockUSDC, escrow;
  let owner, buyer, seller, oracle, feeRecipient, attacker;

  const INITIAL_MINT = ethers.utils.parseUnits("1000", 6);
  const DEPOSIT_AMOUNT = ethers.utils.parseUnits("100", 6);
  const ORDER_ID = ethers.utils.id("ORDER_123");

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

  beforeEach(async function () {
    [owner, buyer, seller, oracle, feeRecipient, attacker] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    mockUSDC = await MockUSDC.deploy();
    await mockUSDC.deployed();

    const Escrow = await ethers.getContractFactory("DecentralizedStripeEscrow");
    escrow = await Escrow.deploy(
      mockUSDC.address,
      oracle.address,
      feeRecipient.address
    );
    await escrow.deployed();

    await mockUSDC.mint(buyer.address, INITIAL_MINT);
    await mockUSDC.connect(buyer).approve(escrow.address, INITIAL_MINT);
  });

  describe("Deposit", function () {
    it("Should deposit funds successfully and emit event", async function () {
      const tx = await escrow.connect(buyer).deposit(ORDER_ID, seller.address, DEPOSIT_AMOUNT);
      const receipt = await tx.wait();

      const event = receipt.events.find(e => e.event === 'PaymentDeposited');
      expect(event).to.not.be.undefined;
      expect(event.args.orderId).to.equal(ORDER_ID);
      expect(event.args.buyer).to.equal(buyer.address);
      expect(event.args.seller).to.equal(seller.address);
      expect(event.args.amount.toString()).to.equal(DEPOSIT_AMOUNT.toString());

      const order = await escrow.orders(ORDER_ID);
      expect(order.buyer).to.equal(buyer.address);
      expect(order.seller).to.equal(seller.address);
      expect(order.amount.toString()).to.equal(DEPOSIT_AMOUNT.toString());
      expect(order.status).to.equal(1); // Deposited
    });

    it("Should revert duplicate order deposit", async function () {
      await escrow.connect(buyer).deposit(ORDER_ID, seller.address, DEPOSIT_AMOUNT);
      await expectRevertCustomError(
        escrow.connect(buyer).deposit(ORDER_ID, seller.address, DEPOSIT_AMOUNT),
        escrow,
        "OrderAlreadyExists"
      );
    });
  });

  describe("Oracle & Direct Release (Happy Path & Fees)", function () {
    beforeEach(async function () {
      await escrow.connect(buyer).deposit(ORDER_ID, seller.address, DEPOSIT_AMOUNT);
    });

    it("Should release payment via valid Oracle ECDSA signature deducting 0.1% fee", async function () {
      const messageHash = ethers.utils.solidityKeccak256(
        ["bytes32", "address", "address", "uint256"],
        [ORDER_ID, buyer.address, seller.address, DEPOSIT_AMOUNT]
      );
      const messageHashBytes = ethers.utils.arrayify(messageHash);
      const signature = await oracle.signMessage(messageHashBytes);

      const fee = DEPOSIT_AMOUNT.mul(10).div(10000); // 0.1% = 0.1 USDC
      const netAmount = DEPOSIT_AMOUNT.sub(fee);

      const initialSellerBalance = await mockUSDC.balanceOf(seller.address);
      const initialFeeRecipientBalance = await mockUSDC.balanceOf(feeRecipient.address);

      await escrow.releaseWithOracle(ORDER_ID, signature);

      const finalSellerBalance = await mockUSDC.balanceOf(seller.address);
      const finalFeeRecipientBalance = await mockUSDC.balanceOf(feeRecipient.address);

      expect(finalSellerBalance.toString()).to.equal(initialSellerBalance.add(netAmount).toString());
      expect(finalFeeRecipientBalance.toString()).to.equal(initialFeeRecipientBalance.add(fee).toString());

      const order = await escrow.orders(ORDER_ID);
      expect(order.status).to.equal(2); // Released
    });

    it("Should revert releaseWithOracle on invalid signature", async function () {
      const messageHash = ethers.utils.solidityKeccak256(
        ["bytes32", "address", "address", "uint256"],
        [ORDER_ID, buyer.address, seller.address, DEPOSIT_AMOUNT]
      );
      const messageHashBytes = ethers.utils.arrayify(messageHash);
      const signature = await attacker.signMessage(messageHashBytes);

      await expectRevertCustomError(
        escrow.releaseWithOracle(ORDER_ID, signature),
        escrow,
        "InvalidSignature"
      );
    });

    it("Should allow buyer to manually release payment", async function () {
      await escrow.connect(buyer).release(ORDER_ID);
      const order = await escrow.orders(ORDER_ID);
      expect(order.status).to.equal(2); // Released
    });

    it("Should revert release by unauthorized caller", async function () {
      await expectRevertCustomError(
        escrow.connect(attacker).release(ORDER_ID),
        escrow,
        "Unauthorized"
      );
    });
  });

  describe("Auto-Refund Timeout Path", function () {
    beforeEach(async function () {
      await escrow.connect(buyer).deposit(ORDER_ID, seller.address, DEPOSIT_AMOUNT);
    });

    it("Should revert refund before 7 days timeout", async function () {
      await expectRevertCustomError(
        escrow.refundTimeout(ORDER_ID),
        escrow,
        "TimeoutNotReached"
      );
    });

    it("Should execute refund after 7 days timeout", async function () {
      await ethers.provider.send("evm_increaseTime", [7 * 86400 + 1]);
      await ethers.provider.send("evm_mine");

      const initialBuyerBalance = await mockUSDC.balanceOf(buyer.address);

      await escrow.refundTimeout(ORDER_ID);

      const finalBuyerBalance = await mockUSDC.balanceOf(buyer.address);
      expect(finalBuyerBalance.toString()).to.equal(initialBuyerBalance.add(DEPOSIT_AMOUNT).toString());

      const order = await escrow.orders(ORDER_ID);
      expect(order.status).to.equal(3); // Refunded
    });
  });

  describe("Dispute & Emergency Pause Controls", function () {
    beforeEach(async function () {
      await escrow.connect(buyer).deposit(ORDER_ID, seller.address, DEPOSIT_AMOUNT);
    });

    it("Should allow buyer or seller to raise dispute and owner to resolve", async function () {
      await escrow.connect(buyer).raiseDispute(ORDER_ID);
      let order = await escrow.orders(ORDER_ID);
      expect(order.status).to.equal(4); // Disputed

      const halfAmount = DEPOSIT_AMOUNT.div(2);
      await escrow.connect(owner).resolveDispute(ORDER_ID, buyer.address, halfAmount);

      order = await escrow.orders(ORDER_ID);
      expect(order.status).to.equal(2); // Released
    });

    it("Should prevent non-owner from pausing circuit breaker", async function () {
      await expectRevertCustomError(
        escrow.connect(attacker).pause(),
        escrow,
        "OwnableUnauthorizedAccount"
      );
    });

    it("Should block deposits when circuit breaker is paused", async function () {
      await escrow.connect(owner).pause();
      const NEW_ORDER = ethers.utils.id("ORDER_456");
      await expectRevertCustomError(
        escrow.connect(buyer).deposit(NEW_ORDER, seller.address, DEPOSIT_AMOUNT),
        escrow,
        "EnforcedPause"
      );
    });
  });
});
