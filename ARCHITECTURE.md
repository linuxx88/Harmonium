# Architecture System Documentation

## System Position & Summary
Non-custodial, permissionless e-commerce escrow with cryptographically verified delivery settlement.

## Non-Custodial Invariants
1. **Zero Discretionary Admin Control**: The administrator has no authority to release, refund, confiscate, or transfer escrowed funds under any circumstances. Admin authority is restricted strictly to emergency pause/unpause circuit breaker operations.
2. **Strict Linear Order State Machine**: An escrow order state machine is strictly linear: `CREATED` -> `FUNDED` -> (`SETTLED`) OR (`REFUNDED`). Terminal states (`SETTLED`, `REFUNDED`) are strictly irreversible.
3. **Mutual Exclusivity of Terminal States**: An escrow order can NEVER be both `SETTLED` and `REFUNDED`.

## System Components
- **Smart Contracts (EVM)**: Hardened ERC-20 Escrow with EIP-712 structured signatures, 2-of-3 threshold oracle verification, buyer fee surcharge model, anti-replay nonces, explicit gross surcharge accounting, and zero discretionary admin overrides.
- **Backend (FastAPI + web3.py)**: Multi-node oracle engine monitoring on-chain events, shipping carrier APIs, and generating cryptographic EIP-712 release vouchers signed by distinct oracle nodes (`ORACLE1_PRIVATE_KEY`, `ORACLE2_PRIVATE_KEY`, `ORACLE3_PRIVATE_KEY`).
- **Frontend (Vanilla HTML/JS)**: Embeddable checkout widget interacting with EVM wallets and backend oracle endpoints.
- **Scripts**: Automated testnet deployment (`deploy_testnet.js`), E2E flow simulation (`simulate_flow.js`), and security chaos test suite (`chaos_test.js`).

## Data Flow
1. **Merchant/Client** -> Requests a payment session from **Backend API**.
2. **Backend API** -> Generates order ID and parameters for **Frontend**.
3. **Frontend** -> Buyer deposits item price + 0.1% surcharge fee (`grossAmount = itemPrice + feeAmount`) into **Escrow Contract**.
4. **Smart Contract** -> Locks USDC tokens, sets state to `FUNDED`, and emits `PaymentDeposited` event.
5. **Oracle Nodes** -> Attest shipping carrier delivery status (`keccak256(abi.encode(carrierId, trackingNumber))`) and produce 2-of-3 EIP-712 threshold signatures.
6. **Settlement** -> Valid 2-of-3 oracle threshold signatures (verified via `ECDSA.recover(digest, signatures[0])` and `signatures[1]`) or buyer direct release unlocks USDC funds to merchant (`itemPrice` exact) and protocol fee recipient (`feeAmount`).
7. **Timeout Refund** -> If `block.timestamp >= deadline` and order is not `SETTLED`, buyer can trigger `claimRefund()` to reclaim full `grossAmount`.

## Security Architecture & Risk Controls
- **EIP-712 Anti-Replay**: Signatures include `domainSeparator` (chainId, contractAddress), `orderId`, `buyer`, `seller`, `token`, `amount`, `trackingHash`, `nonce`, and `deadline`.
- **2-of-3 Threshold Oracle Quorum**: Validates `signatures[0]` and `signatures[1]`, ensuring `signer0 != signer1`, both signers are part of the `authorizedOracles` mapping, and signatures cannot be duplicated.
- **Deterministic Settlement vs Refund Race Condition**: If `block.timestamp >= deadline` AND order is not `SETTLED`, `buyer` can trigger `claimRefund()`. Settlement is only valid if a valid 2-of-3 oracle attestation was signed BEFORE or AT `deadline`.
- **Minimization of Admin Control**: Owner can ONLY toggle emergency circuit breakers (`pause`/`unpause`). Discretionary release/refund overrides are strictly removed.
- **Buyer-Triggered Refund**: Buyer can trigger full refund after fulfillment deadline expiry if unfulfilled.
- **Order State Machine & Gross Surcharge Accounting**: Explicit `enum OrderState { UNINITIALIZED, CREATED, FUNDED, SETTLED, REFUNDED }` with stored explicit values (`itemPrice`, `feeAmount`, `grossAmount = itemPrice + feeAmount`).

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
- [x] **2.4 2-of-3 Threshold Oracle Quorum**
- [x] **2.5 Reduced Admin Rights & Buyer Surcharge Fee Model**
- [x] **2.6 Automated Unit & Chaos Test Suite**

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
