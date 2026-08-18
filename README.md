# Harmonium Pay PoC

> [!WARNING]
> **DISCLAIMER**: This repository is a security-focused PoC and has not been audited. It must not be used with production funds.

**Harmonium Pay** is a security-focused Web3 escrow Proof of Concept (PoC) and engineering benchmark demonstrating production-oriented design principles, cryptographic physical delivery settlement, and formal invariant testing on EVM networks (Arbitrum Sepolia, Base Sepolia, Hardhat Local).

---

## 💎 Portfolio & Professional Engineering Highlights

This project demonstrates production-grade Solidity security engineering, cryptographic attestation, adversarial testing, and end-to-end full-stack Web3 architecture:

* **🛡️ Solidity Security Engineering**: Atomic 4-state lifecycle (`UNINITIALIZED` -> `FUNDED` -> `SETTLED` | `REFUNDED`), Checks-Effects-Interactions (CEI), `ReentrancyGuard`, `Pausable` circuit breaker, and zero administrative fund custody (`Invariant 9`).
* **✍️ EIP-712 Cryptographic Attestation**: Domain-separated typed structured data binding `chainId`, `verifyingContract`, `orderId`, price, carrier, and per-order anti-replay nonces (`usedNonces`).
* **🏛️ 2-of-3 Threshold Oracle Quorum**: On-chain threshold multisig signature verification (`ECDSA.recover`) requiring $\ge 2$ distinct authorized oracle keys.
* **🧪 Property-Based Fuzzing & Invariant Testing**: Hardhat fuzz suite proving 12 explicit mathematical security invariants across randomized execution orders.
* **⚡ 5,000-Agent Concurrency & Chaos Simulation**: High-throughput async engine simulating 3,500 buyers, 750 merchants, 500 adversarial chaos attackers, and 250 oracles on a local EVM node with SQLite WAL persistence.
* **🌐 End-to-End Web3 Integration**: Modular architecture spanning Solidity smart contracts, Python/FastAPI oracle backend, Ethers.js checkout widget, and Web2 carrier tracking pipelines.

### 📊 Measurable Empirical Evidence (Pre-Audit Stress Benchmark)

The following metrics were measured during the 5,000-agent concurrency and chaos stress run on local EVM infrastructure:

* **👥 5,000 Concurrent Simulated Agents**: 3,500 autonomous buyers, 750 merchants, 500 adversarial chaos actors, and 250 independent oracle signing nodes executed in parallel.
* **⚡ 12,250 Mined Transactions**: Full lifecycle operations processed without unhandled RPC drops or contract halts.
* **🛡️ 500 Adversarial Attack Attempts Rejected**: 100% of tested attack vectors (truncated signatures, duplicate signers, forged payloads, replay nonces, unauthorized keys) reverted on-chain.
* **🚀 3.46 TPS Average Throughput**: Sustained end-to-end throughput across multi-step order lifecycles and oracle quorum aggregation.
* **💰 0.00 USDC Fund Leakage**: Zero unauthorized withdrawals or administrative confiscations across all tested state transitions.
* **🗄️ 0 SQLite Concurrency Deadlocks**: WAL (Write-Ahead Logging) mode and busy-retry handlers prevented database locks across 4,050 concurrent order mutations.

> *Note: These figures represent empirical pre-audit stress benchmark results under local simulated load and do not constitute third-party audit certification.*

---

## 💼 What This Demonstrates (For Technical Clients)

This codebase serves as a concrete technical showcase of end-to-end engineering excellence across four critical domains:

1. **Smart Contract Development (Solidity / EVM)**
   - Custom error architectures for minimal gas consumption and expressive debugging.
   - Strict Checks-Effects-Interactions (CEI) state patterns eliminating reentrancy attack vectors.
   - Comprehensive OpenZeppelin integration (`ReentrancyGuard`, `Pausable`, `SafeERC20`, `Ownable`).
   - Clean, auditable, and modular Solidity 0.8.20+ codebase with explicit NatSpec documentation.

2. **Web3 Payments & Settlement Infrastructure**
   - Non-custodial escrow architecture ensuring zero platform custody over user capital.
   - Deterministic gross-fee surcharge accounting calculated atomically on deposit.
   - Autonomous buyer refund fallbacks protecting capital against oracle downtime or merchant abandonment.
   - Multi-chain deployment readiness across Layer-2 ecosystems (Arbitrum Sepolia, Base Sepolia).

3. **Blockchain Security & Pre-Audit Verification**
   - 12 explicit test-verified security invariants mapped directly to automated Hardhat test targets.
   - Property-based fuzzing verifying state machine irreversibility and balance conservation.
   - High-concurrency chaos simulation rejecting 100% of tested malicious vectors (replays, forged data, key leaks).
   - Clear threat modeling separating on-chain guarantees from physical-world oracle assumptions.

4. **Full-Stack Web3 & Systems Integration**
   - Cryptographic EIP-712 structured voucher generation and ECDSA signature aggregation.
   - High-performance asynchronous Python/FastAPI backend with SQLite WAL concurrency management.
   - Seamless frontend Web3 wallet connection, token approvals, and deposit flows via Ethers.js.
   - Simulated Web2 shipping carrier webhook ingestion bridging off-chain physical events with on-chain settlement.

---

## 📖 System Overview & Architecture Positioning

This PoC demonstrates how decentralized e-commerce escrow can achieve cryptographically verified delivery settlement using EVM smart contracts, USDC stablecoins, EIP-712 structured vouchers, and a 2-of-3 threshold oracle verification engine without administrative fund custody.

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
> **Zero-Config Persistent Storage & Production Scaling**: Off-chain order state, checkout sessions, anti-replay nonces, voucher deadlines, and EIP-712 threshold signatures are persistently managed via a local SQLite database (`harmonium_pay.db` via `backend/database.py`). This guarantees state survival across FastAPI service restarts without requiring external database server dependencies. For distributed, multi-container horizontal scaling in production, migrating to PostgreSQL (e.g. AWS RDS/Aurora) with connection pooling is required to avoid shared file-locking constraints.


### 🔒 Trust Model & Custodial Boundaries

> [!IMPORTANT]
> **Non-Custodial Escrow vs Oracle Attestation**:
> - **Funds Custody (Zero Admin Fund-Transfer Authority)**: The smart contract escrow fund path enforces zero administrative custody (`Invariant 9`). Neither the contract owner nor protocol operators possess functions to arbitrarily transfer, freeze, or confiscate escrowed balances. Escrowed funds can exclusively transition via verified 2-of-3 threshold oracle signatures or direct buyer actions (`Invariant 3`, `Invariant 4`).
> - **Delivery Attestation (2-of-3 Threshold Trust Assumption)**: Automated release relies on Web2 carrier webhooks signed by a 2-of-3 threshold oracle quorum. The security model explicitly assumes **fewer than 2 out of 3 authorized oracle keys are compromised or colluding**.

```
Funds Custody Boundary:
  Funds → Smart Contract → Zero Administrative Fund-Transfer Authority (Non-Custodial Logic)

Delivery Attestation Boundary:
  Delivery Event (Carrier API) → 2-of-3 Oracle Quorum (HSM/KMS Keys) → Cryptographic Release Voucher (Trust Assumption)
```

### ⚠️ Trust Assumptions & System Limitations

To ensure absolute technical transparency, this protocol explicitly defines its operational boundaries and assumptions:

- **EVM & Smart Contract Integrity**: The escrow smart contract logic is assumed to be deployed immutably and compiled with standard EVM rules (`^0.8.20`).
- **Standard Token Interface**: The underlying USDC/ERC-20 token contract is assumed to strictly conform to standard IERC20 transfer/balance interfaces. Non-standard tokens—specifically fee-on-transfer, rebasing, or deflationary tokens—are strictly unsupported as token fee deductions on transfer break the accounting balance invariant (`grossAmount = itemPrice + feeAmount`).
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
Harmonium/
├── contracts/
│   ├── HarmoniumPayEscrow.sol          # Non-custodial EIP-712 & 2-of-3 threshold escrow core contract
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
│   ├── HarmoniumPayEscrow.test.js      # Hardhat unit test suite
│   ├── HarmoniumPayEscrow.fuzz.test.js # Hardhat property-based fuzz suite
│   └── oracle_resilience.test.js       # Hardhat multi-oracle resilience suite
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

## 🌐 Public Testnet Deployment & E2E Verification Readiness
 
Target testnet network configurations are pre-configured in `hardhat.config.js`:
- **Arbitrum Sepolia** (Chain ID: `421614`, RPC: `ARBITRUM_SEPOLIA_RPC_URL`)
- **Base Sepolia** (Chain ID: `84532`, RPC: `BASE_SEPOLIA_RPC_URL`)

> **Pre-Deployment Readiness Notice**: The codebase and deployment scripts are fully prepared for Arbitrum Sepolia and Base Sepolia. To perform a verifiable live deployment, ensure `.env` is populated with a funded testnet account `PRIVATE_KEY`, valid RPC URLs, and 3 distinct oracle addresses. Do not claim public testnet deployment status until transactions are mined on-chain and contracts are verified on Arbiscan / Basescan.

### Deploy Commands
```bash
# Arbitrum Sepolia
HARDHAT_DISABLE_TELEMETRY=true npx hardhat run scripts/deploy_testnet.js --network arbitrumSepolia

# Base Sepolia
HARDHAT_DISABLE_TELEMETRY=true npx hardhat run scripts/deploy_testnet.js --network baseSepolia
```

### Verification Commands
```bash
# Arbiscan (Arbitrum Sepolia)
npx hardhat verify --network arbitrumSepolia <ESCROW_ADDRESS> "<USDC_ADDRESS>" "[\"<ORACLE1>\",\"<ORACLE2>\",\"<ORACLE3>\"]" "<FEE_RECIPIENT>"

# Basescan (Base Sepolia)
npx hardhat verify --network baseSepolia <ESCROW_ADDRESS> "<USDC_ADDRESS>" "[\"<ORACLE1>\",\"<ORACLE2>\",\"<ORACLE3>\"]" "<FEE_RECIPIENT>"
```

## 📚 Documentation & Pre-Audit Test Reports (`docs/`)

Comprehensive test results, static analysis reports, stress benchmarks, and live testnet verification runs are documented in the [`docs/`](docs/) folder:

### 🧪 Test & Simulation Reports
- 📄 [**Live Sepolia Integration Tests** (`docs/SEPOLIA_INTEGRATION_TESTS.md`)](docs/SEPOLIA_INTEGRATION_TESTS.md) — On-chain Sepolia execution report with verified transaction hashes (allowance revert, faucet, transfers).
- 📄 [**Pre-Audit Concurrency & Chaos Benchmark** (`docs/benchmarks/SIMULATION_REPORT.md`)](docs/benchmarks/SIMULATION_REPORT.md) — 5,000-agent concurrency simulation, 12,250 mined transactions, 100% attack rejection rate, and gas profiles.
- 📄 [**Additional Chaos Attack Tests** (`docs/pre_audit/ADDITIONAL_CHAOS_TESTS.md`)](docs/pre_audit/ADDITIONAL_CHAOS_TESTS.md) — Reentrancy defense, timestamp manipulation, and mempool front-running chaos vectors.

### 🛡️ Audit & Security Dossier
- 📄 [**Pre-Audit Summary Dossier** (`docs/pre_audit/PRE_AUDIT_SUMMARY.md`)](docs/pre_audit/PRE_AUDIT_SUMMARY.md) — Synthesis of contract invariants, architectural boundaries, and test matrices.
- 📄 [**Code Coverage Report** (`docs/pre_audit/COVERAGE_REPORT.md`)](docs/pre_audit/COVERAGE_REPORT.md) — 100% statement and function coverage report.
- 📄 [**Static Analysis Report** (`docs/pre_audit/STATIC_ANALYSIS_REPORT.md`)](docs/pre_audit/STATIC_ANALYSIS_REPORT.md) — Slither vulnerability analysis results and remediations.
- 📄 [**Deployment & Multi-Network Plan** (`docs/pre_audit/DEPLOYMENTS.md`)](docs/pre_audit/DEPLOYMENTS.md) — Target networks, configuration, and verification procedures.
- 📄 [**Migration & Upgrade Guide** (`docs/pre_audit/MIGRATION_GUIDE.md`)](docs/pre_audit/MIGRATION_GUIDE.md) — Upgrade paths and backward compatibility details.

### Running Multi-Agent Stress Simulation:
```bash
.venv/bin/python scripts/multi_agent_stress_simulation.py
```
