# Decentralized Stripe PoC

A production-ready Proof of Concept (PoC) for decentralized, escrow-backed e-commerce payments on Ethereum Virtual Machine (EVM) compatible networks (Arbitrum Sepolia, Base Sepolia, Hardhat Local).

---

## 📖 System Overview

Decentralized Stripe enables trustless e-commerce transactions by leveraging EVM smart contracts, USDC stablecoins, and an automated FastAPI carrier oracle.

```
+------------------+         1. Deposit USDC         +-------------------------+
|                  | ------------------------------> |                         |
|   Buyer Wallet   |                                 | Escrow Smart Contract   |
|                  | <------------------------------ |                         |
+------------------+         4. Auto Refund          +-------------------------+
         |                      (if expired)                     ^
         |                                                       | 3. ECDSA Release
         | 2. Tracking ID                                        |    Signature
         v                                                       |
+------------------+      Carrier API Check          +-------------------------+
|   Backend API    | ------------------------------> |  Oracle Settlement Engine|
+------------------+                                 +-------------------------+
```

### Key Security & Architecture Highlights
- **0.1% Protocol Fee**: Built-in 10 bps fee model routed to configurable fee recipient.
- **Automated Settlement**: FastAPI Oracle monitors shipping status (UPS / Canada Post) and signs cryptographic ECDSA authorization vouchers for instant settlement upon delivery.
- **7-Day Auto-Refund Timeout**: Buyer can trigger full refund if seller fails to fulfill delivery within deadline.
- **Dispute Resolution & Emergency Pause**: OpenZeppelin `Pausable` and `ReentrancyGuard` with owner-managed dispute resolution.

---

## 🛠 Project Structure

```
DECENTRALIZED-STRIPE/
├── contracts/
│   ├── DecentralizedStripeEscrow.sol   # Escrow core smart contract
│   └── MockUSDC.sol                    # ERC-20 Mock USDC for test environments
├── backend/
│   ├── main.py                         # FastAPI Oracle server & webhook listener
│   ├── oracle.py                       # Carrier verification & ECDSA signature engine
│   └── requirements.txt                # Python dependencies
├── frontend/
│   ├── index.html                      # Embeddable checkout widget interface
│   └── widget.js                       # Web3 wallet & contract interaction script
├── scripts/
│   ├── deploy_testnet.js               # Testnet deployment & verification script
│   ├── chaos_test.js                   # Network delay, invalid sig & pause chaos test suite
│   └── simulate_flow.js                # End-to-end integration test runner
├── test/
│   └── DecentralizedStripeEscrow.test.js # Hardhat unit tests
├── hardhat.config.js                   # Hardhat EVM compiler & network settings
└── ARCHITECTURE.md                     # System design roadmap & task matrix
```

---

## 🚀 Quickstart Guide

### 1. Environment Setup

Copy `.env.example` to `.env` and populate environment variables:

```bash
cp .env.example .env
```

`.env` setup:
```env
RPC_URL=http://127.0.0.1:8545
PRIVATE_KEY=0x... (Deployer / Admin Private Key)
ORACLE_PRIVATE_KEY=0x... (Oracle Signer Private Key)
USDC_ADDRESS=0x... (Optional testnet token address)
ESCROW_ADDRESS=0x... (Deployed Escrow address)
```

### 2. Install Dependencies

**Smart Contracts (Node.js):**
```bash
npm install
```

**Oracle Backend (Python):**
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cd ..
```

---

## 🧪 Testing & Verification

### Hardhat Unit Tests
Run full suite of smart contract unit tests covering happy paths, fee deduction, re-entrancy protection, and custom errors:

```bash
HARDHAT_DISABLE_TELEMETRY=true npx hardhat test
```

### Chaos & Security Test Suite
Simulate network latency, circuit breakers, expired escrow timeouts, and signature spoofing attacks:

```bash
HARDHAT_DISABLE_TELEMETRY=true npx hardhat run scripts/chaos_test.js
```

### End-to-End Flow Simulation
Run full lifecycle simulation from checkout deposit to carrier delivery and settlement:

```bash
HARDHAT_DISABLE_TELEMETRY=true npx hardhat run scripts/simulate_flow.js
```

---

## 📡 Oracle Backend API Specification

The FastAPI backend exposes fully documented OpenAPI endpoints. Access interactive Swagger UI at `http://localhost:8000/docs`.

### Key Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/` | Service health status |
| `POST` | `/api/v1/checkout/session` | Create checkout session |
| `GET` | `/api/v1/checkout/session/{session_id}` | Retrieve checkout session status |
| `POST` | `/api/v1/webhook/carrier-update` | Webhook for carrier shipping status updates |
| `GET` | `/api/v1/order/{order_id}/voucher` | Generate ECDSA release voucher upon delivery |

### Running the Backend Service:
```bash
export ORACLE_PRIVATE_KEY="0x..."
uvicorn backend.main:app --reload --port 8000
```

---

## 🌐 Public Testnet Deployment

To deploy contracts on Arbitrum Sepolia or Base Sepolia:

```bash
HARDHAT_DISABLE_TELEMETRY=true npx hardhat run scripts/deploy_testnet.js --network arbitrumSepolia
```

### Verification Command
```bash
npx hardhat verify --network arbitrumSepolia <ESCROW_ADDRESS> "<USDC_ADDRESS>" "<ORACLE_ADDRESS>" "<FEE_RECIPIENT>"
```

---

## 🛡 Security & Audit Compliance

- Zero hardcoded private keys or sensitive credentials in source code.
- All secrets strictly dynamically parsed via `.env`.
- SafeERC20 for token transfer protection against non-standard ERC-20s.
- Re-entrancy protection across all external state-mutating methods.
