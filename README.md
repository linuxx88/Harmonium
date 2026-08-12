# Decentralized Stripe PoC

> [!WARNING]
> **DISCLAIMER**: This repository is a security-focused PoC and has not been audited. It must not be used with production funds.

Non-custodial, permissionless e-commerce escrow with cryptographically verified delivery settlement on Ethereum Virtual Machine (EVM) compatible networks (Arbitrum Sepolia, Base Sepolia, Hardhat Local).

---

## 📖 System Overview

Decentralized Stripe enables non-custodial, permissionless e-commerce escrow with cryptographically verified delivery settlement by leveraging EVM smart contracts, USDC stablecoins, EIP-712 structured vouchers, and a 2-of-3 threshold oracle verification engine.

```
                  Carrier APIs
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
       Oracle 1     Oracle 2     Oracle 3
          │            │            │
          └──────┬─────┴─────┬──────┘
                 │   2 / 3   │
                 ▼           │
           EIP-712 Attestation
                 │
                 ▼
          Escrow Contract ◄─── Voluntary Buyer Confirmation
                 │
          ┌──────┴──────┐
          ▼             ▼
       SETTLED       REFUNDED
                         ▲
                         │
                  Buyer + fulfillmentDeadline
```

### Key Non-Custodial Invariants & Security Highlights
- **11 Explicit Security Invariants**:
  1. **Invariant 1**: A settled order can never be refunded.
  2. **Invariant 2**: A refunded order can never be settled.
  3. **Invariant 3**: Only the buyer can trigger a refund (`claimRefund`).
  4. **Invariant 4**: Settlement can occur via EITHER (2-of-3 Oracle Quorum threshold release) OR (Direct Voluntary Buyer Confirmation via `confirmReceiptByBuyer`).
  5. **Invariant 5**: A settlement voucher nonce is scoped per order (`usedNonces[orderId][nonce]`) and can only be used once to prevent cross-order replay attacks.
  6. **Invariant 6**: A voucher cannot be replayed on another chain (`chainId` in EIP-712 domain).
  7. **Invariant 7**: A voucher cannot be replayed on another escrow contract (`verifyingContract` address in EIP-712 domain).
  8. **Invariant 8**: The seller can never withdraw funds before settlement.
  9. **Invariant 9**: The administrator cannot transfer, confiscate, or release escrow funds ("No privileged account can arbitrarily transfer escrowed funds").
  10. **Invariant 10**: Protocol fee can only be paid according to the order's immutable fee parameters.
  11. **Invariant 11**: A settlement voucher is valid ONLY for the exact order parameters stored on-chain (orderId, buyer, seller, token, amount, carrierId, trackingHash, nonce, voucherDeadline).
- **Circuit Breaker Pause Rules**:
  - `deposit`, `releaseWithOracle`, `confirmReceiptByBuyer` are paused during circuit breaker activation.
  - `claimRefund` remains permanently accessible when paused to prevent indefinite custody of user funds.
- **Race Condition Resolution**: On-chain transaction ordering determines state. Whichever valid transaction (`SETTLED` or `REFUNDED`) hits the block first seals the terminal state.
- **EIP-712 Typed Data Signatures**: Structured EIP-712 typed vouchers (`domainSeparator`, `orderId`, `buyer`, `seller`, `token`, `amount`, `carrierId`, `trackingHash`, `nonce`, `voucherDeadline`) to block cross-chain, cross-contract, and replay attacks.
- **2-of-3 Threshold Oracle Quorum**: settlement requires signatures from two distinct authorized oracle identities. The security model assumes fewer than two authorized oracle keys are compromised or colluding.
- **Carrier & Order Specific Tracking Hash**: Defined as `keccak256(abi.encode(carrierId, trackingNumber))` and embedded into EIP-712 typed vouchers alongside explicit `carrierId`.
- **Order State Machine & Gross Surcharge Accounting**: Strict atomic state machine `UNINITIALIZED` -> `FUNDED` -> (`SETTLED` | `REFUNDED`) via `createAndFundOrder` with explicit values (`itemPrice`, `feeAmount`, `grossAmount = itemPrice + feeAmount`). Terminal states `SETTLED` and `REFUNDED` are strictly irreversible.

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
ARBITRUM_SEPOLIA_RPC_URL=https://sepolia.arbitrum.io/rpc
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
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

### Hardhat Unit & Fuzzing Tests
Run full suite of smart contract unit and property-based fuzzing tests covering EIP-712 signatures, 2-of-3 threshold quorum, gross surcharge accounting, anti-replay nonces, and non-custodial invariants:

```bash
HARDHAT_DISABLE_TELEMETRY=true npx hardhat test
```

### Chaos & Security Test Suite
Simulate network latency, circuit breakers, expired escrow timeouts, and signature spoofing attacks:

```bash
HARDHAT_DISABLE_TELEMETRY=true npx hardhat run scripts/chaos_test.js
```

### Automated Testnet Simulation Suite
Execute end-to-end testnet verification covering dynamic domain separation, gas overhead estimation, block delay confirmations, and wallet interactions:

```bash
HARDHAT_DISABLE_TELEMETRY=true npx hardhat run scripts/testnet_e2e_simulation.js
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
| `POST` | `/api/v1/order/{order_id}/attestation` | Generate EIP-712 release voucher upon delivery attestation |

### Running the Backend Service:
```bash
export ORACLE1_PRIVATE_KEY="0x..."
export ORACLE2_PRIVATE_KEY="0x..."
export ORACLE3_PRIVATE_KEY="0x..."
uvicorn backend.main:app --reload --port 8000
```

---

## 🌐 Public Testnet Deployment & E2E Verification

Supported network targets:
- **Arbitrum Sepolia** (Chain ID: `421614`, Env: `ARBITRUM_SEPOLIA_RPC_URL`)
- **Base Sepolia** (Chain ID: `84532`, Env: `BASE_SEPOLIA_RPC_URL`)

### Deploy Command
```bash
HARDHAT_DISABLE_TELEMETRY=true npx hardhat run scripts/deploy_testnet.js --network arbitrumSepolia
HARDHAT_DISABLE_TELEMETRY=true npx hardhat run scripts/deploy_testnet.js --network baseSepolia
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

