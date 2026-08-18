const { ethers } = require("hardhat");

async function main() {
  console.log("=== Starting Complete E2E Integration Simulation ===");

  const [deployer, buyer, seller, feeRecipient] = await ethers.getSigners();

  // 1. Deploy MockUSDC
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  await usdc.deployed();
  console.log(`MockUSDC deployed to: ${usdc.address}`);

  const { spawn } = require("child_process");

  // 2. Setup Oracle Signer Wallets matching backend keys
  const oraclePk1 = "0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a6f363173";
  const oraclePk2 = "0x8b3a350cf5c343ff1d26123497d3910c6aa099d07ee83a48e7150a0005d54519";
  const oraclePk3 = "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e";
  
  const oracle1 = new ethers.Wallet(oraclePk1, ethers.provider);
  const oracle2 = new ethers.Wallet(oraclePk2, ethers.provider);
  const oracle3 = new ethers.Wallet(oraclePk3, ethers.provider);

  const Escrow = await ethers.getContractFactory("HarmoniumPayEscrow");
  const escrow = await Escrow.deploy(usdc.address, [oracle1.address, oracle2.address, oracle3.address], feeRecipient.address);
  await escrow.deployed();
  console.log(`HarmoniumPayEscrow deployed to: ${escrow.address}`);

  const chainId = (await ethers.provider.getNetwork()).chainId;

  // 3. Launch backend FastAPI server for E2E REST attestation
  const backendEnv = Object.assign({}, process.env, {
    ORACLE1_PRIVATE_KEY: oraclePk1,
    ORACLE2_PRIVATE_KEY: oraclePk2,
    ORACLE3_PRIVATE_KEY: oraclePk3,
    WEB3_PROVIDER_URL: ""
  });

  const venvPython = "/home/ssr/Desktop/HARMONIUM/.venv/bin/python3";
  const backendProc = spawn(venvPython, ["-m", "uvicorn", "backend.main:app", "--port", "8009"], {
    env: backendEnv,
    stdio: "inherit"
  });

  // Wait for backend to be ready
  const BACKEND_URL = "http://127.0.0.1:8009";
  let backendReady = false;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${BACKEND_URL}/`);
      if (res.ok) {
        backendReady = true;
        break;
      }
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 200));
  }

  if (!backendReady) {
    backendProc.kill();
    throw new Error("Backend FastAPI server failed to start within timeout!");
  }
  console.log("Backend FastAPI Oracle Service is ONLINE");
  const itemPrice = ethers.utils.parseUnits("100", 6);
  const feeAmount = itemPrice.mul(10).div(10000);
  const grossAmount = itemPrice.add(feeAmount);

  // ==========================================
  // Flow 1: 2-of-3 Oracle Settlement via FastAPI Attestation Endpoint
  // ==========================================
  console.log("\n--- Flow 1: 2-of-3 Oracle Settlement via FastAPI Attestation Endpoint ---");
  await usdc.mint(buyer.address, grossAmount);
  await usdc.connect(buyer).approve(escrow.address, grossAmount);

  const orderId1 = ethers.utils.id("ORDER_SIM_SETTLE_1");
  const carrierId = "UPS";
  const trackingNumber = "TRACK123";
  const trackingHash = await escrow.computeTrackingHash(carrierId, trackingNumber);

  await (await escrow.connect(buyer).createAndFundOrder(orderId1, seller.address, itemPrice)).wait();
  console.log(`Order 1 funded on-chain: ${orderId1}`);

  // 1. Create checkout session via backend REST API
  const sessionRes = await fetch(`${BACKEND_URL}/api/v1/checkout/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_id: orderId1,
      buyer: buyer.address,
      seller: seller.address,
      item_price: itemPrice.toNumber(),
      gross_amount: grossAmount.toNumber(),
      token: usdc.address,
      contract_address: escrow.address,
      chain_id: chainId,
      tracking_id: trackingNumber
    })
  });

  if (!sessionRes.ok) {
    const errText = await sessionRes.text();
    throw new Error(`Failed to create checkout session via backend: ${errText}`);
  }
  const sessionData = await sessionRes.json();
  console.log(`Backend session created: ${sessionData.session_id}`);

  // 2. Request 2-of-3 delivery attestation from backend
  const attRes = await fetch(`${BACKEND_URL}/api/v1/order/${orderId1}/attestation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ buyer: buyer.address })
  });

  if (!attRes.ok) {
    const errText = await attRes.text();
    throw new Error(`Failed to get attestation from backend: ${errText}`);
  }
  const attData = await attRes.json();
  if (attData.status !== "success" || !attData.threshold_met) {
    throw new Error(`Backend attestation failed to meet threshold: ${JSON.stringify(attData)}`);
  }

  const { nonce, voucher_deadline, signatures } = attData.order;
  console.log(`Received ${signatures.length} oracle signatures from backend REST API (nonce: ${nonce})`);

  const formattedSignatures = signatures.map(s => s.startsWith("0x") ? s : `0x${s}`);

  // 3. Settle on-chain using exclusively backend-provided threshold signatures
  await (await escrow.settleWithOracle(
    orderId1,
    grossAmount,
    itemPrice,
    carrierId,
    trackingHash,
    nonce.toString(),
    voucher_deadline,
    formattedSignatures
  )).wait();

  const sellerBalance = await usdc.balanceOf(seller.address);
  const feeBalance = await usdc.balanceOf(feeRecipient.address);
  console.log(`Seller Balance: ${ethers.utils.formatUnits(sellerBalance, 6)} USDC (Expected: 100.0)`);
  console.log(`Fee Recipient Balance: ${ethers.utils.formatUnits(feeBalance, 6)} USDC (Expected: 0.10)`);
  if (!sellerBalance.eq(itemPrice) || !feeBalance.eq(feeAmount)) {
    throw new Error("Flow 1 Settlement balance check failed!");
  }
  console.log("✔ Flow 1 Settlement PASSED");

  // ==========================================
  // Flow 2: Timeout Refund (claimRefund)
  // ==========================================
  console.log("\n--- Flow 2: Timeout Refund (claimRefund) ---");
  await usdc.mint(buyer.address, grossAmount);
  await usdc.connect(buyer).approve(escrow.address, grossAmount);

  const orderId2 = ethers.utils.id("ORDER_SIM_REFUND_2");
  await (await escrow.connect(buyer).createAndFundOrder(orderId2, seller.address, itemPrice)).wait();
  console.log(`Order 2 funded: ${orderId2}`);

  const buyerBalPreRefund = await usdc.balanceOf(buyer.address);

  // Advance EVM time past 7-day fulfillment deadline
  await ethers.provider.send("evm_increaseTime", [7 * 86400 + 1]);
  await ethers.provider.send("evm_mine");

  await (await escrow.connect(buyer).claimRefund(orderId2)).wait();

  const buyerBalPostRefund = await usdc.balanceOf(buyer.address);
  const refundedDelta = buyerBalPostRefund.sub(buyerBalPreRefund);
  console.log(`Buyer Refunded Amount: ${ethers.utils.formatUnits(refundedDelta, 6)} USDC (Expected: ${ethers.utils.formatUnits(grossAmount, 6)})`);
  if (!refundedDelta.eq(grossAmount)) {
    throw new Error("Flow 2 Refund balance check failed!");
  }
  console.log("✔ Flow 2 Timeout Refund PASSED");

  console.log("\n=== Complete E2E Simulation SUCCESS ===");
  backendProc.kill();
}

main().catch((error) => {
  console.error("Simulation failed:", error);
  process.exit(1);
});
