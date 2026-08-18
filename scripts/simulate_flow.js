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
  const path = require("path");

  // 2. Setup Oracle Signer Wallets from environment variables (fail closed)
  const oraclePk1 = process.env.ORACLE1_PRIVATE_KEY || process.env.TEST_ORACLE1_PRIVATE_KEY;
  const oraclePk2 = process.env.ORACLE2_PRIVATE_KEY || process.env.TEST_ORACLE2_PRIVATE_KEY;
  const oraclePk3 = process.env.ORACLE3_PRIVATE_KEY || process.env.TEST_ORACLE3_PRIVATE_KEY;

  if (!oraclePk1 || !oraclePk2 || !oraclePk3) {
    throw new Error(
      "Missing required oracle private keys for E2E simulation! Please set ORACLE1_PRIVATE_KEY, ORACLE2_PRIVATE_KEY, and ORACLE3_PRIVATE_KEY (or TEST_ORACLE* equivalents) in the environment."
    );
  }
  
  const oracle1 = new ethers.Wallet(oraclePk1, ethers.provider);
  const oracle2 = new ethers.Wallet(oraclePk2, ethers.provider);
  const oracle3 = new ethers.Wallet(oraclePk3, ethers.provider);

  const Escrow = await ethers.getContractFactory("HarmoniumPayEscrow");
  const escrow = await Escrow.deploy(usdc.address, [oracle1.address, oracle2.address, oracle3.address], feeRecipient.address);
  await escrow.deployed();
  console.log(`HarmoniumPayEscrow deployed to: ${escrow.address}`);

  const chainId = (await ethers.provider.getNetwork()).chainId;

  // 3. Launch backend FastAPI server for E2E REST attestation
  const backendPort = process.env.BACKEND_PORT || "8009";
  const backendHost = process.env.BACKEND_HOST || "127.0.0.1";
  const pythonPath = process.env.PYTHON_PATH || path.join(__dirname, "..", ".venv", "bin", "python3");

  const backendEnv = Object.assign({}, process.env, {
    ORACLE1_PRIVATE_KEY: oraclePk1,
    ORACLE2_PRIVATE_KEY: oraclePk2,
    ORACLE3_PRIVATE_KEY: oraclePk3,
  });

  const backendProc = spawn(pythonPath, ["-m", "uvicorn", "backend.main:app", "--host", backendHost, "--port", backendPort], {
    env: backendEnv,
    stdio: "inherit"
  });

  // Wait for backend to be ready
  const BACKEND_URL = `http://${backendHost}:${backendPort}`;
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
