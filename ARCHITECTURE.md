# Architecture System Documentation

## System Position & Summary
Permissionless USDC escrow infrastructure for e-commerce with verifiable delivery settlement.

## System Components
- **Smart Contracts (EVM)**: Hardened ERC-20 Escrow with EIP-712 structured signatures, 2-of-3 threshold oracle verification, buyer fee surcharge model, anti-replay nonces, and zero discretionary admin overrides.
- **Backend (FastAPI + web3.py)**: Multi-node oracle engine monitoring on-chain events, shipping carrier APIs, and generating cryptographic EIP-712 release vouchers.
- **Frontend (Vanilla HTML/JS)**: Embeddable checkout widget interacting with EVM wallets and backend oracle endpoints.
- **Scripts**: Automated testnet deployment (`deploy_testnet.js`), E2E flow simulation (`simulate_flow.js`), and security chaos test suite (`chaos_test.js`).

## Data Flow
1. **Merchant/Client** -> Requests a payment session from **Backend API**.
2. **Backend API** -> Generates order ID and parameters for **Frontend**.
3. **Frontend** -> Buyer deposits exact item amount + 0.1% surcharge fee into **Escrow Contract**.
4. **Smart Contract** -> Locks USDC tokens and emits `PaymentDeposited` event.
5. **Oracle Nodes** -> Attest shipping carrier delivery status and produce EIP-712 signatures.
6. **Settlement** -> 2-of-3 oracle threshold signatures or buyer direct release unlocks USDC funds to merchant ($100.00 exact) and protocol fee recipient ($0.10).

## Security Architecture & Risk Controls
- **EIP-712 Anti-Replay**: Signatures include `domainSeparator` (chainId, contractAddress), `orderId`, `buyer`, `seller`, `token`, `amount`, `trackingHash`, `nonce`, and `deadline`.
- **2-of-3 Threshold Oracle Quorum**: Eliminates single-point-of-failure oracle risk.
- **Minimization of Admin Control**: Owner can ONLY toggle emergency circuit breakers (`pause`/`unpause`). Discretionary release/refund overrides are strictly removed.
- **Buyer-Triggered Refund**: Buyer can trigger full refund after 7-day timeout expiry if unfulfilled.
- **Buyer Surcharge Model**: Buyer pays item price + fee (e.g. $100.10 USDC) so seller receives net amount ($100.00 USDC).

---

## Phase 1: System Architecture & Project Setup

- [x] **1.1 Directory & Workspace Initialization**
- [x] **1.2 Smart Contract Toolchain Setup**
- [x] **1.3 Back-End & Front-End Boilerplate Setup**
- [x] **1.4 Verification**

## Phase 2: Core Smart Contract Implementation, Security Hardening & Testing

- [x] **2.1 Contract Specification & Interface Design**
- [x] **2.2 Smart Contract Development (Solidity & OpenZeppelin)**
- [x] **2.3 EIP-712 Typed Signatures & Anti-Replay Nonce Engine**
  - Replace legacy ECDSA signatures with EIP-712 structured hash vouchers.
  - Bind chainId, verifyingContract, orderId, buyer, seller, token, amount, trackingHash, nonce, and deadline.
- [x] **2.4 2-of-3 Threshold Oracle Quorum**
  - Implement multi-oracle threshold verification requiring 2 valid distinct oracle signatures for settlement.
- [x] **2.5 Reduced Admin Rights & Buyer Surcharge Fee Model**
  - Restrict owner permissions exclusively to emergency circuit breaker pause/unpause.
  - Implement buyer surcharge model ($100.10 paid by buyer, $100.00 net seller payout, $0.10 protocol fee).
- [x] **2.6 Automated Unit & Chaos Test Suite**
  - Validate 100% test coverage across EIP-712 typed data hashing, threshold quorum, anti-replay, and timeout paths.

## Phase 3: Oracle Back-End & Front-End Payment Widget

- [x] **3.1 Oracle Service Architecture (FastAPI)**
- [x] **3.2 Delivery Verification & Automated Settlement Engine**
- [x] **3.3 Embeddable Checkout Widget Development**
- [x] **3.4 End-to-End Local Integration Testing**

## Phase 4: Full Deployment, Security Audit & Final Cleanup

- [x] **4.1 Public Testnet Deployment**
- [x] **4.2 Edge-Case & Chaos Testing**
- [x] **4.3 Code Optimization & Security Sanitization**
- [x] **4.4 Developer Documentation & Demo Setup**
