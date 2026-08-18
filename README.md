# Harmonium Protocol (Core Smart Contracts & Test Suite)

> [!WARNING]
> **DISCLAIMER**: This repository is a security-focused smart contract protocol implementation and testing suite. It is experimental and has not been audited by an independent third party. It must NOT be used with production funds.

**Harmonium Protocol** is an open, non-custodial, permissionless e-commerce escrow protocol on EVM-compatible blockchains. It facilitates cryptographically verified physical delivery settlement using EIP-712 structured release vouchers, a 2-of-3 threshold oracle verification model, and strict invariant-enforced smart contracts.

---

## 🏛 Public Protocol Scope vs Commercial Harmonium Cloud

This public repository contains only the open smart contracts, automated test suites, protocol documentation, and a development-only mock oracle:

* **Included in this repository**:
  - `contracts/`: OpenZeppelin-based `HarmoniumPayEscrow.sol` core contract and mock ERC-20 tokens.
  - `test/`: Complete Hardhat unit test suite, property-based fuzzing suite, invariant verification tests, and chaos testing scenarios.
  - `examples/mock-oracle/`: Lightweight development mock oracle for local testing and ephemeral EIP-712 voucher generation.
  - `docs/`: Protocol specifications, formal security invariants, and testnet deployment guides.

* **Maintained Separately (Not Included)**:
  - Commercial Harmonium Cloud backend infrastructure, databases, migrations, and merchant checkout APIs.
  - Production shipping carrier integrations (FedEx, UPS, DHL, Canada Post).
  - Production HSM/KMS-backed distributed oracle signer nodes.
  - Merchant analytics, risk engines, webhooks, and private hosted services.

---

## 🛡️ Protocol Security Model & Non-Custodial Architecture

```
UNINITIALIZED
      │
      │ createAndFundOrder()
      ▼
   FUNDED
    │   │
    │   └── claimRefund() (after fulfillment deadline) ──> REFUNDED
    │
    ├── 2-of-3 oracle voucher quorum ────────────────────> SETTLED
    │
    └── direct buyer confirmation ───────────────────────> SETTLED
```

### On-Chain Guarantees (EVM Execution Boundary)
1. **Zero Administrative Fund Custody (`INV-9`)**: Neither the contract owner nor any administrator has functions to divert, confiscate, or withdraw locked escrow deposits.
2. **Terminal State Irreversibility (`INV-1`, `INV-2`)**: Once an order reaches `SETTLED` or `REFUNDED`, state transitions are permanently locked.
3. **Strict Accounting Conservation**: Escrow contract token balance strictly equals the total gross amounts of active `FUNDED` orders.
4. **EIP-712 Cryptographic Replay Protection (`INV-5`, `INV-6`, `INV-7`)**: Release vouchers explicitly bind `chainId`, `verifyingContract`, `orderId`, amounts, and per-order mapped nonces.
5. **Buyer Autonomous Fallbacks (`INV-3`, `INV-4`, `INV-12`)**: If oracles are unavailable, the buyer can confirm delivery directly, or claim a full refund once `fulfillmentDeadline` expires—even if the contract is paused.

---

## 🛠 Repository Structure

```
HARMONIUM/
├── contracts/
│   ├── HarmoniumPayEscrow.sol          # Non-custodial EIP-712 2-of-3 threshold escrow contract
│   ├── MockERC20.sol                   # Generic Mock ERC-20 token
│   └── MockUSDC.sol                    # Mock USDC for test environments
├── examples/
│   └── mock-oracle/                    # Development mock oracle & EIP-712 signer utilities
├── scripts/
│   ├── chaos_test.js                   # Hardhat network delay & chaos scenarios
│   ├── demo.js                         # Standalone E2E protocol demo script
│   ├── deploy_testnet.js               # Testnet deployment script
│   └── simulate_flow.js                # Protocol lifecycle simulation script
├── test/
│   ├── HarmoniumPayEscrow.test.js      # Hardhat unit tests
│   ├── HarmoniumPayEscrow.fuzz.test.js # Property-based fuzzing & invariant tests
│   └── oracle_resilience.test.js       # Multi-oracle resilience test suite
├── hardhat.config.js                   # Hardhat EVM compiler & network configuration
├── ARCHITECTURE.md                     # Detailed protocol architecture & invariants
└── README.md                           # Public protocol overview
```

---

## 🚀 Quickstart & Testing

### 1. Installation

```bash
npm install
```

### 2. Run Test Suite

Run the full smart contract test suite covering unit tests, fuzz testing, and chaos scenarios:

```bash
HARDHAT_DISABLE_TELEMETRY=true npx hardhat test
```

### 3. Run Development Mock Oracle Tests

Verify the local development mock oracle utility:

```bash
node examples/mock-oracle/test_mock_oracle.js
```

### 4. Run Standalone Demonstration Flow

```bash
npm run demo
```

---

## 🌐 Testnet Deployment

Target testnet networks configured in `hardhat.config.js`:
- **Ethereum Sepolia**: `0x9e0F50123cac1151782D77099774a58140363dD1` (Chain ID: `11155111`)
- **Arbitrum Sepolia**: Chain ID `421614`
- **Base Sepolia**: Chain ID `84532`

```bash
HARDHAT_DISABLE_TELEMETRY=true npx hardhat run scripts/deploy_testnet.js --network sepolia
```
