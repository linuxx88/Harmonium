# Decentralized Stripe PoC

> [!WARNING]
> **DISCLAIMER**: This repository is a security-focused PoC and has not been audited. It must not be used with production funds.

Non-custodial, permissionless e-commerce escrow with cryptographically verified delivery settlement on Ethereum Virtual Machine (EVM) compatible networks (Arbitrum Sepolia, Base Sepolia, Hardhat Local).

---

## 🎯 Target Engineering Roles & Capability Mapping

This repository is engineered as a security-focused engineering benchmark demonstrating competency across 4 core Web3 engineering specializations:

1. **Solidity / Smart Contract Developer**: Hardened state machines, OpenZeppelin integration, `ReentrancyGuard`, `Pausable`, `SafeERC20`, and EIP-712 cryptographic verification (`DecentralizedStripeEscrow.sol`).
2. **Web3 Payment Developer**: Non-custodial USDC payment flows, atomic buyer-paid fee surcharges, settlement/refund lifecycle management, and stablecoin escrow mechanics.
3. **Blockchain Security Developer**: Strict mathematical invariants, cross-chain domain separation, per-order anti-replay nonces, circuit breaker pause logic, property-based fuzzing, and adversarial chaos testing.
4. **Full-Stack Web3 Developer**: End-to-end integration spanning HTML5/Ethers.js frontend, Web3 wallet widget, smart contract state, Python FastAPI oracle backend, EIP-712 signing engine, and Web2 carrier webhooks.

---

## 📖 System Overview

Decentralized Stripe enables non-custodial, permissionless e-commerce escrow with cryptographically verified delivery settlement by leveraging EVM smart contracts, USDC stablecoins, EIP-712 structured vouchers, and a 2-of-3 threshold oracle verification engine.

```
UNINITIALIZED
      │
      │ createAndFundOrder()
      ▼
   FUNDED
    │   │
    │   └── claimRefund() (after deadline) ──> REFUNDED
    │
    ├── 2-of-3 oracle quorum ──────────────> SETTLED
    │
    └── buyer confirmation ────────────────> SETTLED
```

> [!NOTE]
> **Zero-Config Persistent Storage**: Off-chain order state, checkout sessions, anti-replay nonces, voucher deadlines, and EIP-712 threshold signatures are persistently managed via a local SQLite database (`decentralized_stripe.db` via `backend/database.py`). This guarantees state survival across FastAPI service restarts without requiring external database server dependencies.


### 🔒 Trust Model & Custodial Boundaries

> [!IMPORTANT]
> **Non-Custodial Escrow vs Oracle Attestation**:
> - **Funds Custody (100% Non-Custodial)**: Zero admin custody. Neither the contract owner nor protocol operators can arbitrarily transfer, freeze, or confiscate escrowed funds (`Invariant 9`). Funds can ONLY move via valid 2-of-3 threshold oracle settlement or buyer action (`Invariant 3`, `Invariant 4`).
> - **Delivery Attestation (2-of-3 Threshold Trust Assumption)**: Automated release relies on Web2 carrier webhooks signed by a 2-of-3 threshold oracle quorum. The security model explicitly assumes **fewer than 2 out of 3 authorized oracle keys are compromised or colluding**.

```
Funds Custody Boundary:
  Funds → Smart Contract → Zero Administrator Custody (Non-Custodial)

Delivery Attestation Boundary:
  Delivery Event → 2-of-3 Oracle Quorum → Cryptographic Release Voucher (Trust Assumption)
```

### ⚠️ Trust Assumptions & System Limitations

To ensure absolute technical transparency, this protocol explicitly defines its operational boundaries and assumptions:

- **EVM & Smart Contract Integrity**: The escrow smart contract logic is assumed to be deployed immutably and compiled with standard EVM rules (`^0.8.20`).
- **Standard Token Interface**: The underlying USDC/ERC-20 token contract is assumed to strictly conform to standard IERC20 transfer/balance interfaces.
- **Oracle Quorum Honesty**: At least 2 out of the 3 authorized oracle signing identities are assumed to remain uncompromised, non-colluding, and online.
- **Physical-World Oracle Risk**: Carrier delivery APIs (e.g. UPS/FedEx webhooks) are external physical-world data providers; carrier API key compromises or falsified tracking statuses at the carrier level cannot be independently verified on-chain.
- **Off-Chain Key Security**: Oracle private keys must be stored in secure HSMs/KMS modules; key storage security is an off-chain operational dependency.
- **Mocked Carrier Verification**: Carrier verification (`verify_carrier_status`) is currently mocked (`MOCK_SHIPPING_DB`) for deterministic local and testnet demonstrations; production integrations require live authenticated carrier WebSockets/Webhooks.
- **PoC Infrastructure vs Production Topology**: In this PoC demonstration, independent oracle key identities are simulated within the backend service. For mainnet production deployment, each of the 3 oracle signer identities MUST be hosted on separate, isolated private infrastructure nodes (or distinct microservices/HSM modules) feeding into a quorum aggregator.
- **Unaudited PoC Status**: This codebase is a security-focused Proof of Concept (PoC) and has not undergone an independent third-party audit. It MUST NOT be deployed with production mainnet funds.

### Key Non-Custodial Invariants & Security Highlights
- **12 Explicit Security Invariants & Test Verification Matrix**:

| ID | Invariant Name | Rule Description | Hardhat Test Target | Verification Status |
| :--- | :--- | :--- | :--- | :--- |
| **INV-1** | Settled cannot refund | Settled order can never be refunded | `test_settled_order_cannot_be_refunded` | `PASSED` |
| **INV-2** | Refunded cannot settle | Refunded order can never be settled | `test_refunded_order_cannot_settle` | `PASSED` |
| **INV-3** | Buyer-only refund | Only buyer can trigger `claimRefund` | `test_only_buyer_can_claim_refund` | `PASSED` |
| **INV-4** | Settlement quorum | 2-of-3 Oracle sigs OR direct buyer confirm | `test_settlement_quorum_or_buyer_only` | `PASSED` |
| **INV-5** | Cross-order replay protection | Nonces strictly scoped per order | `test_voucher_cannot_cross_orders` | `PASSED` |
| **INV-6** | Cross-chain domain isolation | EIP-712 locked to `chainId` | `test_voucher_domain_chain_separation` | `PASSED` |
| **INV-7** | Cross-contract domain isolation | EIP-712 locked to `verifyingContract` | `test_voucher_verifying_contract_isolation` | `PASSED` |
| **INV-8** | No pre-settlement seller withdraw | Seller cannot withdraw funds pre-settlement | `test_seller_cannot_withdraw_pre_settlement` | `PASSED` |
| **INV-9** | Zero admin fund authority | Admin cannot transfer/confiscate funds | `test_admin_has_no_fund_transfer_authority` | `PASSED` |
| **INV-10** | Fee immutability | Gross amount = itemPrice + feeAmount | `test_fee_parameters_are_immutable` | `PASSED` |
| **INV-11** | Exact parameter binding | Vouchers bind exact on-chain order fields | `test_voucher_must_match_order_parameters` | `PASSED` |
| **INV-12** | Circuit breaker override | `claimRefund` accessible when paused | `test_refund_accessible_when_paused` | `PASSED` |

- **Circuit Breaker Pause Rules**:
  - `deposit`, `releaseWithOracle`, `confirmReceiptByBuyer` are paused during circuit breaker activation.
  - `claimRefund` remains permanently accessible when paused to prevent indefinite custody of user funds (`INV-12`).
- **Race Condition Resolution**: On-chain transaction ordering determines state. Whichever valid transaction (`SETTLED` or `REFUNDED`) hits the block first seals the terminal state.
- **EIP-712 Typed Data Signatures**: Structured EIP-712 typed vouchers (`domainSeparator`, `orderId`, `buyer`, `seller`, `token`, `grossAmount`, `itemPrice`, `carrierId`, `trackingHash`, `nonce`, `voucherDeadline`) to block cross-chain, cross-contract, and replay attacks.
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
│   ├── database.py                     # SQLite persistence layer & thread-safe CRUD interface
│   ├── main.py                         # FastAPI Oracle server & webhook listener
│   ├── oracle.py                       # Carrier verification & EIP-712 signature engine
│   └── requirements.txt                # Python dependencies
├── frontend/
│   ├── index.html                      # Embeddable checkout widget interface
│   └── widget.js                       # Web3 wallet & contract interaction script
├── scripts/
│   ├── chaos_test.js                   # Network delay, invalid sig & pause chaos test suite
│   ├── demo.js                         # Zero-config standalone E2E demo runner
│   ├── deploy_testnet.js               # Testnet deployment & verification script
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

### Zero-Config Standalone E2E Demo Runner
Execute automated demonstration runner in under 60 seconds simulating both Oracle 2/3 Quorum settlement and Buyer Timeout refund:

```bash
npm run demo
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

