# Architecture System Documentation

> [!WARNING]
> **DISCLAIMER**: This repository is a security-focused PoC and has not been audited. It must not be used with production funds.

## System Position & Summary
**Decentralized Stripe PoC**: Non-custodial, permissionless e-commerce escrow with cryptographically verified delivery settlement.

## Security Model

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

### Trusted
- EVM Consensus / Layer-2 Execution
- Official USDC ERC-20 Contract
- OpenZeppelin Audit-Tested Primitives
- Secp256k1 ECDSA & EIP-712 Cryptographic Standards

### Assumed Honest
- At least 2 out of 3 independent oracle signing keys
- Shipping carrier tracking APIs (Canada Post / UPS)

### Not Trusted
- Buyer
- Seller
- Frontend UI
- Backend API Server
- Contract Administrator / Owner

## Explicit 10 Security Invariants
1. **Invariant 1**: A settled order can never be refunded (`SETTLED` -> `REFUNDED` is strictly forbidden).
2. **Invariant 2**: A refunded order can never be settled (`REFUNDED` -> `SETTLED` is strictly forbidden).
3. **Invariant 3**: Only the buyer can trigger a refund (`claimRefund` restricts caller to `order.buyer`).
4. **Invariant 4**: Settlement can occur via EITHER (2-of-3 Oracle Quorum threshold release) OR (Direct Voluntary Buyer Confirmation via `confirmReceiptByBuyer`).
5. **Invariant 5**: A settlement voucher nonce is scoped per order (`usedNonces[orderId][nonce]`) and can only be used once to prevent cross-order/intra-order replay attacks.
6. **Invariant 6**: A voucher cannot be replayed on another chain (`chainId` enforced in EIP-712 domain separator).
7. **Invariant 7**: A voucher cannot be replayed on another escrow contract (`verifyingContract` address enforced in EIP-712 domain separator).
8. **Invariant 8**: The seller can never withdraw funds before settlement (funds locked in contract until valid settlement state transition).
9. **Invariant 9**: The administrator cannot transfer, confiscate, or release escrow funds ("No privileged account can arbitrarily transfer escrowed funds").
10. **Invariant 10**: Protocol fee can only be paid according to the order's immutable fee parameters (`feeAmount = itemPrice * PROTOCOL_FEE_BPS / BPS_DENOMINATOR`).

## Cryptographic & Deadline Specifications
- **Decoupled Deadlines**: `fulfillmentDeadline` (order-level timeout, e.g., T + 7 days) vs `voucherDeadline` (EIP-712 signature window validity).
- **Explicit Carrier Data**: Struct includes `carrierId` and `trackingHash` directly inside EIP-712 typed voucher (`ReleaseVoucher(bytes32 orderId,address buyer,address seller,address token,uint256 amount,string carrierId,bytes32 trackingHash,uint256 nonce,uint256 voucherDeadline)`).

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
- **Paused Functions (`whenNotPaused`)**: `deposit`, `releaseWithOracle`, `confirmReceiptByBuyer`, `releaseByBuyer`.
- **Unpaused Functions (`whenPaused` allowed)**: `claimRefund` remains permanently accessible when paused.
- **Invariant Notice**: Emergency pause must never create indefinite custody of user funds. Buyer refunds remain permanently accessible after fulfillment deadline expiry even when the contract is paused.

## Race Condition & Transaction Ordering Resolution
- On-chain transaction ordering determines state. Whichever valid transaction (`SETTLED` or `REFUNDED`) hits the block first seals the terminal state.
- Settlement is valid if executed prior to refund. Once refunded, state transition to `SETTLED` reverts (`InvalidStatus`). Once settled, state transition to `REFUNDED` reverts (`InvalidStatus`).

## API Endpoints
- `POST /api/v1/checkout/session` -> Create checkout session.
- `GET /api/v1/checkout/session/{session_id}` -> Fetch checkout session details.
- `POST /api/v1/webhook/carrier-update` -> Carrier shipping status webhook updates.
- `POST /api/v1/order/{order_id}/attestation` -> Submit delivery attestation request & generate EIP-712 release voucher.

## System Components
- **Smart Contracts (EVM)**: Hardened ERC-20 Escrow with EIP-712 structured signatures, 2-of-3 threshold oracle verification, buyer fee surcharge model, per-order anti-replay nonces, explicit gross surcharge accounting, and zero discretionary admin overrides.
- **Backend (FastAPI + web3.py)**: Multi-node oracle engine monitoring on-chain events, shipping carrier APIs, and generating cryptographic EIP-712 release vouchers signed by distinct oracle nodes (`ORACLE1_PRIVATE_KEY`, `ORACLE2_PRIVATE_KEY`, `ORACLE3_PRIVATE_KEY`).
- **Frontend (Vanilla HTML/JS)**: Embeddable checkout widget interacting with EVM wallets and backend oracle endpoints.
- **Scripts**: Automated testnet deployment (`deploy_testnet.js`), E2E flow simulation (`simulate_flow.js`), and security chaos test suite (`chaos_test.js`).


