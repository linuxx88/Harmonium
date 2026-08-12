# Decentralized Stripe PoC

Non-custodial, permissionless e-commerce escrow with cryptographically verified delivery settlement on Ethereum Virtual Machine (EVM) compatible networks (Arbitrum Sepolia, Base Sepolia, Hardhat Local).

---

## 📖 System Overview

Decentralized Stripe enables Non-custodial, permissionless e-commerce escrow with cryptographically verified delivery settlement by leveraging EVM smart contracts, USDC stablecoins, EIP-712 structured vouchers, and a 2-of-3 threshold oracle verification engine.

```
+------------------+         1. Deposit USDC + Surcharge      +-------------------------+
|                  | ---------------------------------------> |                         |
|   Buyer Wallet   |                                          | Escrow Smart Contract   |
|                  | <--------------------------------------- |                         |
+------------------+         4. Buyer-Triggered Refund        +-------------------------+
         |                        (After Timeout)                        ^
         |                                                               | 3. 2-of-3 EIP-712
         | 2. Tracking Hash                                              |    Threshold Vouchers
         v                                                               |
+------------------+         Carrier API Check                +-------------------------+
|   Backend API    | ---------------------------------------> | Multi-Oracle Threshold  |
+------------------+                                          +-------------------------+
```

### Key Non-Custodial Invariants & Security Highlights
- **Non-Custodial Invariants**:
  - The administrator has no authority to release, refund, confiscate, or transfer escrowed funds under any circumstances.
  - An escrow order state machine is strictly linear: `CREATED` -> `FUNDED` -> (`SETTLED`) OR (`REFUNDED`). Terminal states (`SETTLED`, `REFUNDED`) are irreversible.
  - An escrow order can NEVER be both `SETTLED` and `REFUNDED`.
- **EIP-712 Typed Data Signatures**: Replaced generic ECDSA signatures with structured EIP-712 typed vouchers (`domainSeparator`, `orderId`, `buyer`, `seller`, `token`, `amount`, `trackingHash`, `nonce`, `deadline`) to block cross-chain, cross-contract, and replay attacks.
- **2-of-3 Threshold Oracle Quorum**: Multi-signature oracle attestation requirement verifying `signatures[0]` and `signatures[1]` from `authorizedOracles`, ensuring distinct signers (`signer0 != signer1`) and preventing single-point-of-failure oracle risk.
- **Carrier & Order Specific Tracking Hash**: Defined as `keccak256(abi.encode(carrierId, trackingNumber))` and embedded into EIP-712 typed vouchers.
- **Order State Machine & Gross Surcharge Accounting**: Explicit `enum OrderState { UNINITIALIZED, CREATED, FUNDED, SETTLED, REFUNDED }` with stored explicit values (`itemPrice`, `feeAmount`, `grossAmount = itemPrice + feeAmount`).
- **Zero Discretionary Admin Overrides**: Contract owner permissions restricted strictly to emergency circuit breaker pause/unpause. Funds remain completely immutable on-chain.
- **Buyer-Triggered Refund**: Buyer can trigger a 100% refund (`grossAmount`) after fulfillment deadline timeout.

---

## 🛠 Project Structure

```
DECENTRALIZED-STRIPE/
├── contracts/
│   ├── DecentralizedStripeEscrow.sol   # Non-custodial EIP-712 & 2-of-3 threshold escrow core contract
│   └── MockUSDC.sol                    # ERC-20 Mock USDC for test environments
├── backend/
│   ├── main.py                         # FastAPI Oracle server & webhook listener
│   ├── oracle.py                       # Carrier verification & EIP-712 signature engine
│   └── requirements.txt                # Python dependencies
├── frontend/
│   ├── index.html                      # Embeddable checkout widget interface
│   └── widget.js                       # Web3 wallet & contract interaction script
├── scripts/
│   ├── deploy_testnet.js               # Testnet deployment & verification script
│   ├── chaos_test.js                   # Network delay, invalid sig & pause chaos test suite
│   └── simulate_flow.js                # End-to-end integration test runner
├── test/
│   └── DecentralizedStripeEscrow.test.js # Hardhat unit test suite
├── hardhat.config.js                   # Hardhat EVM compiler & network settings
└── ARCHITECTURE.md                     # System design roadmap & non-custodial security specification
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
USDC_ADDRESS=0x... (Optional testnet token address)
ESCROW_ADDRESS=0x... (Deployed Escrow address)
ORACLE1_PRIVATE_KEY=0x... (Oracle Signer 1 Private Key)
ORACLE2_PRIVATE_KEY=0x... (Oracle Signer 2 Private Key)
ORACLE3_PRIVATE_KEY=0x... (Oracle Signer 3 Private Key)
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
Run full suite of smart contract unit tests covering EIP-712 signatures, 2-of-3 threshold quorum, gross surcharge accounting, anti-replay nonces, and non-custodial invariants:

```bash
HARDHAT_DISABLE_TELEMETRY=true npx hardhat test
```

### Chaos & Security Test Suite
Simulate network latency, circuit breakers, expired escrow timeouts, and signature spoofing attacks:

```bash
HARDHAT_DISABLE_TELEMETRY=true npx hardhat run scripts/chaos_test.js
```

### End-to-End Flow Simulation
Run full lifecycle simulation from checkout deposit to 2-of-3 oracle carrier verification and settlement:

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
| `GET` | `/api/v1/order/{order_id}/voucher` | Generate EIP-712 release voucher upon delivery |

### Running the Backend Service:
```bash
export ORACLE1_PRIVATE_KEY="0x..."
export ORACLE2_PRIVATE_KEY="0x..."
export ORACLE3_PRIVATE_KEY="0x..."
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
npx hardhat verify --network arbitrumSepolia <ESCROW_ADDRESS> "<USDC_ADDRESS>" "[\"<ORACLE1>\",\"<ORACLE2>\",\"<ORACLE3>\"]" "<FEE_RECIPIENT>"
```

---

## 🛡 Security & Audit Compliance

- **Zero Hardcoded Keys**: Private keys loaded exclusively via environment variables (`ORACLE1_PRIVATE_KEY`, `ORACLE2_PRIVATE_KEY`, `ORACLE3_PRIVATE_KEY`).
- **EIP-712 Typed Hashing**: Complete domain separation preventing cross-chain and replay exploits.
- **SafeERC20 Protection**: Guarded against non-standard ERC-20 transfer behaviors.
- **Re-entrancy Guard**: Non-reentrant modifiers on all state-changing entrypoints.
