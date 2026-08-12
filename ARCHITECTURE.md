# Architecture System Documentation

## System Position & Summary
**Decentralized Stripe PoC**: Non-custodial, permissionless e-commerce escrow with cryptographically verified delivery settlement.

## Explicit 10 Security Invariants
1. **Invariant 1**: A settled order can never be refunded (`SETTLED` -> `REFUNDED` is strictly forbidden).
2. **Invariant 2**: A refunded order can never be settled (`REFUNDED` -> `SETTLED` is strictly forbidden).
3. **Invariant 3**: Only the buyer can trigger a refund (`claimRefund` restricts caller to `order.buyer`).
4. **Invariant 4**: Only authorized oracle quorum (2-of-3) can trigger settlement via release voucher attestation.
5. **Invariant 5**: A settlement voucher can only be used once (nonce invalidated / incremented upon execution).
6. **Invariant 6**: A voucher cannot be replayed on another chain (`chainId` enforced in EIP-712 domain separator).
7. **Invariant 7**: A voucher cannot be replayed on another escrow contract (`verifyingContract` address enforced in EIP-712 domain separator).
8. **Invariant 8**: The seller can never withdraw funds before settlement (funds locked in contract until valid settlement state transition).
9. **Invariant 9**: The administrator cannot transfer, confiscate, or release escrow funds ("No privileged account can arbitrarily transfer escrowed funds").
10. **Invariant 10**: Protocol fee can only be paid according to the order's immutable fee parameters (`feeAmount = itemPrice * PROTOCOL_FEE_BPS / BPS_DENOMINATOR`).

## State Machine Strict Transition Rules
- **Allowed Transitions**:
  - `UNINITIALIZED` -> `CREATED` (or `FUNDED` directly on initial deposit)
  - `CREATED` -> `FUNDED`
  - `FUNDED` -> `SETTLED`
  - `FUNDED` -> `REFUNDED`
- **Forbidden Transitions**:
  - `CREATED` -> `REFUNDED`
  - `CREATED` -> `SETTLED`
  - `FUNDED` -> `CREATED`
  - `SETTLED` -> `ANY`
  - `REFUNDED` -> `ANY`

## Circuit Breaker & Pause Rules
- **Paused Functions (`whenNotPaused`)**: `createOrder`, `deposit`, `releaseWithOracle`, `releaseByBuyer` (settlePayment).
- **Unpaused Functions (`whenPaused` allowed)**: `claimRefund` remains permanently accessible when paused.
- **Invariant Notice**: Emergency pause must never create indefinite custody of user funds. Buyer refunds remain permanently accessible after deadline expiry even when the contract is paused.

## Race Condition & Transaction Ordering Resolution
- On-chain transaction ordering determines state. Whichever valid transaction (`SETTLED` or `REFUNDED`) hits the block first seals the terminal state.
- Settlement is valid if executed prior to refund. Once refunded, state transition to `SETTLED` reverts (`InvalidStatus`). Once settled, state transition to `REFUNDED` reverts (`InvalidStatus`).

## API Endpoints
- `POST /api/v1/checkout/session` -> Create checkout session.
- `GET /api/v1/checkout/session/{session_id}` -> Fetch checkout session details.
- `POST /api/v1/webhook/carrier-update` -> Carrier shipping status webhook updates.
- `POST /api/v1/order/{order_id}/attestation` -> Submit delivery attestation request & generate EIP-712 release voucher.

## System Components
- **Smart Contracts (EVM)**: Hardened ERC-20 Escrow with EIP-712 structured signatures, 2-of-3 threshold oracle verification, buyer fee surcharge model, anti-replay nonces, explicit gross surcharge accounting, and zero discretionary admin overrides.
- **Backend (FastAPI + web3.py)**: Multi-node oracle engine monitoring on-chain events, shipping carrier APIs, and generating cryptographic EIP-712 release vouchers signed by distinct oracle nodes (`ORACLE1_PRIVATE_KEY`, `ORACLE2_PRIVATE_KEY`, `ORACLE3_PRIVATE_KEY`).
- **Frontend (Vanilla HTML/JS)**: Embeddable checkout widget interacting with EVM wallets and backend oracle endpoints.
- **Scripts**: Automated testnet deployment (`deploy_testnet.js`), E2E flow simulation (`simulate_flow.js`), and security chaos test suite (`chaos_test.js`).

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

