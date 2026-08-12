const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DecentralizedStripeEscrow - Property-Based & Fuzz Testing", function () {
  let mockUSDC, escrow;
  let owner, buyer, seller, oracle1, oracle2, oracle3, feeRecipient, attacker;

  const INITIAL_MINT = ethers.utils.parseUnits("100000", 6);
  const CARRIER_ID = "UPS";
  const TRACKING_NUMBER = "1Z9999999999999999";
  const TRACKING_HASH = ethers.utils.solidityKeccak256(["bytes"], [ethers.utils.defaultAbiCoder.encode(["string", "string"], [CARRIER_ID, TRACKING_NUMBER])]);

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
  });

  describe("Fuzz Invariant 1: State Machine Irreversibility", function () {
    it("Randomized call sequences on funded orders can never revert SETTLED -> REFUNDED or REFUNDED -> SETTLED", async function () {
      const NUM_RUNS = 25;
      const signers = [buyer, seller, owner, attacker];

      for (let i = 0; i < NUM_RUNS; i++) {
        const orderId = ethers.utils.id(`FUZZ_ORDER_STATE_${i}`);
        const itemPrice = ethers.utils.parseUnits((10 + (i * 7) % 500).toString(), 6);
        await escrow.connect(buyer).deposit(orderId, seller.address, itemPrice);

        const block = await ethers.provider.getBlock("latest");
        const voucherDeadline = block.timestamp + 3600;
        const grossAmount = (await escrow.orders(orderId)).grossAmount;

        const sig1 = await createEIP712Signature(oracle1, orderId, buyer.address, seller.address, mockUSDC.address, grossAmount, itemPrice, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline);
        const sig2 = await createEIP712Signature(oracle2, orderId, buyer.address, seller.address, mockUSDC.address, grossAmount, itemPrice, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline);

        if (i % 2 === 0) {
          await escrow.settleWithOracle(orderId, grossAmount, itemPrice, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline, [sig1, sig2]);
          let order = await escrow.orders(orderId);
          expect(order.state).to.equal(2); // SETTLED

          // Fuzz random attempts to trigger refund after SETTLED
          for (const s of signers) {
            try {
              await escrow.connect(s).claimRefund(orderId);
            } catch (err) {
              expect(err.message).to.include("InvalidStatus");
            }
          }
          order = await escrow.orders(orderId);
          expect(order.state).to.equal(2); // Must remain SETTLED
        } else {
          await ethers.provider.send("evm_increaseTime", [7 * 86400 + 1]);
          await ethers.provider.send("evm_mine");

          await escrow.connect(buyer).claimRefund(orderId);
          let order = await escrow.orders(orderId);
          expect(order.state).to.equal(3); // REFUNDED

          // Fuzz random attempts to trigger settlement after REFUNDED
          for (const s of signers) {
            try {
              await escrow.connect(s).confirmReceiptByBuyer(orderId);
            } catch (err) {
              expect(err.message).to.include("InvalidStatus");
            }
            try {
              await escrow.connect(s).settleWithOracle(orderId, grossAmount, itemPrice, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline, [sig1, sig2]);
            } catch (err) {
              expect(err.message).to.include("InvalidStatus");
            }
          }
          order = await escrow.orders(orderId);
          expect(order.state).to.equal(3); // Must remain REFUNDED
        }
      }
    });
  });

  describe("Fuzz Invariant 2: Strict Payout Conservation & Contract Balance Equality", function () {
    it("Contract balance strictly equals total grossAmount of active FUNDED orders across 20 randomized orders", async function () {
      const NUM_ORDERS = 20;
      const orderIds = [];
      let expectedBalance = ethers.BigNumber.from(0);

      for (let i = 0; i < NUM_ORDERS; i++) {
        const orderId = ethers.utils.id(`CONSERVATION_ORDER_${i}`);
        const itemPrice = ethers.utils.parseUnits((50 + (i * 13) % 300).toString(), 6);
        await escrow.connect(buyer).deposit(orderId, seller.address, itemPrice);

        const order = await escrow.orders(orderId);
        expectedBalance = expectedBalance.add(order.grossAmount);
        orderIds.push({ orderId, itemPrice, grossAmount: order.grossAmount });

        const contractBal = await mockUSDC.balanceOf(escrow.address);
        expect(contractBal.toString()).to.equal(expectedBalance.toString());
      }

      // Step 1: Settle even-indexed orders before fulfillment deadline
      for (let i = 0; i < NUM_ORDERS; i += 2) {
        const { orderId, itemPrice, grossAmount } = orderIds[i];
        const block = await ethers.provider.getBlock("latest");
        const voucherDeadline = block.timestamp + 3600;
        const sig1 = await createEIP712Signature(oracle1, orderId, buyer.address, seller.address, mockUSDC.address, grossAmount, itemPrice, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline);
        const sig2 = await createEIP712Signature(oracle2, orderId, buyer.address, seller.address, mockUSDC.address, grossAmount, itemPrice, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline);

        await escrow.settleWithOracle(orderId, grossAmount, itemPrice, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline, [sig1, sig2]);
        expectedBalance = expectedBalance.sub(grossAmount);

        const contractBal = await mockUSDC.balanceOf(escrow.address);
        expect(contractBal.toString()).to.equal(expectedBalance.toString());
      }

      // Step 2: Advance time past fulfillment deadline and refund remaining odd-indexed orders
      await ethers.provider.send("evm_increaseTime", [7 * 86400 + 1]);
      await ethers.provider.send("evm_mine");

      for (let i = 1; i < NUM_ORDERS; i += 2) {
        const { orderId, grossAmount } = orderIds[i];
        await escrow.connect(buyer).claimRefund(orderId);
        expectedBalance = expectedBalance.sub(grossAmount);

        const contractBal = await mockUSDC.balanceOf(escrow.address);
        expect(contractBal.toString()).to.equal(expectedBalance.toString());
      }

      expect((await mockUSDC.balanceOf(escrow.address)).toString()).to.equal("0");
    });
  });

  describe("Fuzz Invariant 3: Proof-Gated Settlement", function () {
    it("Randomized invalid signature payloads and caller identities fail settlement", async function () {
      const orderId = ethers.utils.id("FUZZ_PROOF_GATED");
      const itemPrice = ethers.utils.parseUnits("100", 6);
      await escrow.connect(buyer).deposit(orderId, seller.address, itemPrice);

      const block = await ethers.provider.getBlock("latest");
      const voucherDeadline = block.timestamp + 3600;
      const grossAmount = (await escrow.orders(orderId)).grossAmount;

      const randomCallers = [seller, owner, attacker];

      // Fuzz random non-buyer direct confirmations
      for (const caller of randomCallers) {
        try {
          await escrow.connect(caller).confirmReceiptByBuyer(orderId);
          expect.fail("Expected non-buyer direct confirmation to revert");
        } catch (err) {
          expect(err.message).to.include("Unauthorized");
        }
      }

      // Fuzz random unauthorized signature combinations
      const sigBuyer = await createEIP712Signature(buyer, orderId, buyer.address, seller.address, mockUSDC.address, grossAmount, itemPrice, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline);
      const sigAttacker = await createEIP712Signature(attacker, orderId, buyer.address, seller.address, mockUSDC.address, grossAmount, itemPrice, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline);
      const sigOracle1 = await createEIP712Signature(oracle1, orderId, buyer.address, seller.address, mockUSDC.address, grossAmount, itemPrice, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline);

      const invalidSigPairs = [
        [sigBuyer, sigAttacker],
        [sigAttacker, sigOracle1],
        [sigOracle1, sigOracle1] // Duplicate check
      ];

      for (const sigPair of invalidSigPairs) {
        try {
          await escrow.settleWithOracle(orderId, grossAmount, itemPrice, CARRIER_ID, TRACKING_HASH, 1, voucherDeadline, sigPair);
          expect.fail("Expected settlement with invalid signatures to revert");
        } catch (err) {
          expect(err.message).to.satisfy(msg => msg.includes("InvalidSignature") || msg.includes("DuplicateSignature"));
        }
      }
    });
  });

  describe("Fuzz Invariant 4: Admin Zero-Custody Constraint", function () {
    it("Random admin invocations on escrow contract result in exactly ZERO balance delta for locked funds", async function () {
      const orderId = ethers.utils.id("FUZZ_ZERO_CUSTODY");
      const itemPrice = ethers.utils.parseUnits("500", 6);
      await escrow.connect(buyer).deposit(orderId, seller.address, itemPrice);

      const initialAdminBal = await mockUSDC.balanceOf(owner.address);
      const initialEscrowBal = await mockUSDC.balanceOf(escrow.address);

      // Fuzz admin actions: pause/unpause, setFeeRecipient, setOracleSigners
      await escrow.connect(owner).pause();
      await escrow.connect(owner).unpause();
      await escrow.connect(owner).setFeeRecipient(owner.address);
      await escrow.connect(owner).setOracleSigners([oracle1.address, oracle2.address, oracle3.address]);

      const finalAdminBal = await mockUSDC.balanceOf(owner.address);
      const finalEscrowBal = await mockUSDC.balanceOf(escrow.address);

      expect(finalAdminBal.toString()).to.equal(initialAdminBal.toString());
      expect(finalEscrowBal.toString()).to.equal(initialEscrowBal.toString());
    });
  });
});
