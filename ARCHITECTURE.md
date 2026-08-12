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
- 2-of-3 Threshold Oracle Quorum: settlement requires signatures from two distinct authorized oracle identities. The security model assumes fewer than two authorized oracle keys are compromised or colluding.
- Shipping carrier tracking APIs (Canada Post / UPS)

### Not Trusted
- Buyer
- Seller
- Frontend UI
- Backend API Server
- Contract Administrator / Owner

## Explicit 11 Security Invariants
1. **Invariant 1**: A settled order can never be refunded (`SETTLED` -> `REFUNDED` is strictly forbidden).
2. **Invariant 2**: A refunded order can never be settled (`REFUNDED` -> `SETTLED` is strictly forbidden).
3. **Invariant 3**: Only the buyer can trigger a refund (`claimRefund` restricts caller to `order.buyer`).
4. **Invariant 4**: Settlement can occur via EITHER (2-of-3 Oracle Quorum threshold release) OR (Direct Voluntary Buyer Confirmation via `confirmReceiptByBuyer`).
5. **Invariant 5**: A settlement voucher nonce is scoped per order (`usedNonces[orderId][nonce]`) and can only be used once to prevent cross-order/intra-order replay attacks.
6. **Invariant 6**: A voucher cannot be replayed on another chain (`chainId` enforced in EIP-712 domain separator).
7. **Invariant 7**: A voucher cannot be replayed on another escrow contract (`verifyingContract` address enforced in EIP-712 domain separator).
8. **Invariant 8**: The seller can never withdraw funds before settlement (funds locked in contract until valid settlement state transition).
9. **Invariant 9**: For every escrowed order in state `FUNDED`, no administrative/privileged caller (contract owner, multisig, or operator) can trigger a buyer refund, seller settlement, protocol fee withdrawal, or arbitrary token transfer without satisfying the exact same state, signature (2-of-3 oracle), or deadline requirements enforced on non-privileged actors.
10. **Invariant 10**: Protocol fee can only be paid according to the order's immutable fee parameters (`feeAmount = itemPrice * PROTOCOL_FEE_BPS / BPS_DENOMINATOR`). Order fee parameters (`protocolFeeRecipient`, `feeAmount`, `itemPrice`, `grossAmount`) are strictly immutable once the order is funded. Neither contract owner nor any future admin can alter the `protocolFeeRecipient` or `feeAmount` of an existing `FUNDED` order.
11. **Invariant 11**: A settlement voucher is valid ONLY for the exact order parameters stored on-chain (orderId, buyer, seller, token, amount, carrierId, trackingHash, nonce, voucherDeadline).
12. **Invariant 12**: Functions `confirmReceiptByBuyer` and `settleWithOracle` (`releaseWithOracle`) strictly enforce the Checks-Effects-Interactions (CEI) pattern: caller and status checks occur first, state mutation to `SETTLED` occurs before any external token transfers.

## Cryptographic & Deadline Specifications
- **Cryptographic Domain Separation**: `chainId` and `verifyingContract` are bound strictly via the EIP-712 domain separator, blocking cross-chain and cross-contract signature replays.
- **Order Binding**: The release voucher payload explicitly binds `orderId`, `buyer`, `seller`, `token`, `grossAmount`, `itemPrice`, `carrierId`, `trackingHash`, `nonce`, and `voucherDeadline` to guarantee attestations are valid strictly for the intended on-chain order parameters.
- **Replay Protection**: Replays are strictly prevented via nonces scoped per order and stored directly in mapped state (`usedNonces[orderId][nonce] = true`).
- **Decoupled Deadlines**: `fulfillmentDeadline` (order-level expiration for buyer refunds, e.g., T + 7 days) vs `voucherDeadline` (EIP-712 cryptographic signature validity window).
- **Explicit Carrier Data**: Struct includes `carrierId` and `trackingHash` directly inside EIP-712 typed voucher (`ReleaseVoucher(bytes32 orderId,address buyer,address seller,address token,uint256 grossAmount,uint256 itemPrice,string carrierId,bytes32 trackingHash,uint256 nonce,uint256 voucherDeadline)`).
- **Oracle Signer Extraction & Unique Identity Verification**:
  - `signer0 = ECDSA.recover(digest, signatures[0])`
  - `signer1 = ECDSA.recover(digest, signatures[1])`
  - Strict validation: `signer0 != signer1` (distinct oracle identities required) and `isOracleSigner[signer0] && isOracleSigner[signer1]` (both signers must be authorized oracle identities).
- **Accounting Validation Checks**:
  - `voucher.grossAmount == order.grossAmount`
  - `voucher.itemPrice == order.itemPrice`
  - `order.grossAmount == order.itemPrice + order.feeAmount`

## State Machine Strict Transition Rules
- **Enum Specification**: `enum OrderState { UNINITIALIZED, FUNDED, SETTLED, REFUNDED }`
- **Allowed Transitions**:
  - `UNINITIALIZED` -> `FUNDED` (via atomic `createAndFundOrder`)
  - `FUNDED` -> `SETTLED` (via 2-of-3 Oracle attestation OR buyer voluntary `confirmReceiptByBuyer`)
  - `FUNDED` -> `REFUNDED` (via `claimRefund` after `fulfillmentDeadline` expiration)
  - Note: Terminal states `SETTLED` and `REFUNDED` are strictly irreversible.
- **Forbidden Transitions**:
  - `UNINITIALIZED` -> `SETTLED`
  - `UNINITIALIZED` -> `REFUNDED`
  - `SETTLED` -> `ANY`
  - `REFUNDED` -> `ANY`

## Circuit Breaker & Pause Rules
- **Paused Functions (`whenNotPaused`)**: `createAndFundOrder` (and legacy alias `deposit`), `releaseWithOracle`, `confirmReceiptByBuyer`.
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


