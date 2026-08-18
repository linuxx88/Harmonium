# Harmonium Protocol Architecture

> [!WARNING]
> **DISCLAIMER**: This repository is a security-focused protocol implementation and reference test suite. It must not be used with production funds without a comprehensive smart contract security audit.

## Protocol Position & Summary
**Harmonium Protocol**: Non-custodial, permissionless e-commerce escrow with cryptographically verified delivery settlement on EVM-compatible blockchains.

## Security Model

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

### 1. On-Chain Guarantees (EVM Execution Boundary)
- **Zero Administrative Fund-Transfer Authority**: No owner or administrator function exists to confiscate, divert, or withdraw locked escrow deposits (`Invariant 9`).
- **Terminal State Irreversibility**: Orders in `SETTLED` or `REFUNDED` states can never transition to any other state (`Invariants 1 & 2`).
- **Strict Accounting Conservation**: Escrow contract token balance strictly equals the sum of gross amounts across active `FUNDED` orders.
- **Cryptographic Replay Resistance**: EIP-712 domain separation binds `chainId`, `verifyingContract`, and per-order mapped nonces (`Invariants 5, 6, 7`).
- **Fail-Safe Buyer Redundancy**: If oracles are offline or fail to issue attestations, the buyer can voluntarily release funds via `confirmReceiptByBuyer` (`Invariant 4`), or claim a full refund via `claimRefund` once `fulfillmentDeadline` elapses (`Invariant 3`).

### 2. Oracle Trust Assumptions
- **2-of-3 Quorum Threshold**: Automated settlement strictly mandates valid cryptographic attestations from $\ge 2$ distinct authorized oracle keys.
- **Threshold Honesty Model**: The security boundary assumes that fewer than 2 out of 3 authorized oracle keys are compromised or colluding. A single compromised key cannot trigger settlement.

### 3. Carrier-Data Boundary (Physical-World Grounding)
- **Physical-World Data Boundary**: The smart contract cannot independently verify physical parcel contents. The protocol model assumes carrier tracking identifiers reflect physical transit and delivery updates attested by authorized oracles.

### Actor Trust Taxonomy
- **Trusted**: EVM Consensus / L2 Execution, Token Contract (e.g., standard USDC), OpenZeppelin Library Primitives, Secp256k1 ECDSA / EIP-712 Cryptographic Standards.
- **Assumed Honest**: 2-of-3 Oracle Quorum ($\le 1$ compromised key).
- **Untrusted / Adversarial**: Buyer, Seller, External Callers / Relayers, Contract Deployer / Owner.

### Threat Model & Mitigation Matrix

| Attacker Capability | Targeted Component | Expected Security Boundary | Mitigation Strategy | Corresponding Test Target |
| :--- | :--- | :--- | :--- | :--- |
| **Compromised Oracle Key (1-of-3)** | Settlement Attestation (`releaseWithOracle`) | Single corrupted signature cannot trigger fund release | 2-of-3 Threshold Quorum with strict `signer0 != signer1` validation | `test_invalid_quorum_rejection` |
| **Forged Price / Amount Payload** | Release Voucher Parameter Verification | Signed voucher with modified amount cannot extract escrow funds | Strict on-chain parameter validation matching stored order state | `test_voucher_parameter_mismatch` |
| **Signature & Nonce Replay** | Settlement Execution | Settled voucher cannot be re-executed on current or other orders | State transition to `SETTLED` + per-order mapped nonces (`usedNonces`) | `test_settled_order_cannot_settle_replay` |
| **Cross-Chain / Cross-Contract Replay** | EIP-712 Signature Domain | Voucher from testnet/fork cannot be submitted on mainnet or another contract | EIP-712 domain separator binding `chainId` & `verifyingContract` | `test_voucher_domain_chain_separation` |
| **Malicious Contract Owner / Admin** | Fund Custody & State Transitions | Admin cannot unilaterally confiscate or divert escrowed deposits | Zero administrative fund-transfer functions (`Invariant 9`) | `test_admin_has_no_fund_transfer_authority` |
| **Fulfillment Timeout Race Condition** | Settlement vs Refund Race | Late settlement cannot reverse buyer refund and vice versa | First mined transaction establishes irreversible terminal state | `test_deterministic_settlement_vs_refund_race` |
| **Protocol Emergency Halt** | Circuit Breaker (`Pausable`) | Paused contract blocks new orders but does not lock user funds | `claimRefund` explicitly remains accessible during pause | `test_refund_accessible_when_paused` |

## Explicit 12 Security Invariants & Test Verification Matrix

| ID | Invariant Name | Rule Description | Test Harness File | Verification Status |
| :--- | :--- | :--- | :--- | :--- |
| **INV-1** | Settled cannot refund | Settled order can never be refunded (`SETTLED` -> `REFUNDED` forbidden) | `HarmoniumPayEscrow.test.js`, `HarmoniumPayEscrow.fuzz.test.js` | `PASSED` |
| **INV-2** | Refunded cannot settle | Refunded order can never be settled (`REFUNDED` -> `SETTLED` forbidden) | `HarmoniumPayEscrow.test.js`, `HarmoniumPayEscrow.fuzz.test.js` | `PASSED` |
| **INV-3** | Buyer-only refund | Only buyer can trigger `claimRefund` (`claimRefund` restricts caller) | `HarmoniumPayEscrow.test.js` | `PASSED` |
| **INV-4** | Settlement quorum | 2-of-3 Oracle sigs OR direct buyer confirm (`confirmReceiptByBuyer`) | `HarmoniumPayEscrow.test.js`, `oracle_resilience.test.js` | `PASSED` |
| **INV-5** | Cross-order replay protection | Nonces strictly scoped per order (`usedNonces[orderId][nonce]`) | `oracle_resilience.test.js` | `PASSED` |
| **INV-6** | Cross-chain domain isolation | EIP-712 locked to `chainId` in domain separator | `HarmoniumPayEscrow.test.js` | `PASSED` |
| **INV-7** | Cross-contract domain isolation | EIP-712 locked to `verifyingContract` in domain separator | `HarmoniumPayEscrow.test.js` | `PASSED` |
| **INV-8** | No pre-settlement seller withdraw | Seller cannot withdraw funds pre-settlement | `HarmoniumPayEscrow.fuzz.test.js` | `PASSED` |
| **INV-9** | Zero admin fund authority | Admin cannot transfer/confiscate funds without oracle/buyer | `HarmoniumPayEscrow.fuzz.test.js` | `PASSED` |
| **INV-10** | Fee immutability | Gross amount = itemPrice + feeAmount immutable on funding | `HarmoniumPayEscrow.test.js` | `PASSED` |
| **INV-11** | Exact parameter binding | Vouchers bind exact on-chain order fields | `HarmoniumPayEscrow.test.js` | `PASSED` |
| **INV-12** | Circuit breaker override | `claimRefund` remains accessible when contract paused | `HarmoniumPayEscrow.test.js` | `PASSED` |

## Cryptographic & Deadline Specifications
- **Cryptographic Domain Separation**: `chainId` and `verifyingContract` are bound strictly via the EIP-712 domain separator (`name = "HarmoniumPayEscrow"`, `version = "1"`).
- **Order Binding**: The release voucher payload explicitly binds `orderId`, `buyer`, `seller`, `token`, `grossAmount`, `itemPrice`, `carrierId`, `trackingHash`, `nonce`, and `voucherDeadline`.
- **Replay Protection**: Replays are prevented via nonces scoped per order (`usedNonces[orderId][nonce] = true`).
- **Decoupled Deadlines**:
  - `fulfillmentDeadline`: Order-level expiration timestamp after which the buyer may trigger `claimRefund()`.
  - `voucherDeadline`: EIP-712 cryptographic signature validity window.
  - Settlement requires `block.timestamp <= min(voucherDeadline, order.fulfillmentDeadline)`.
- **EIP-712 TypeHash Specification**:
  ```solidity
  bytes32 public constant RELEASE_VOUCHER_TYPEHASH = keccak256(
      "ReleaseVoucher(bytes32 orderId,address buyer,address seller,address token,uint256 grossAmount,uint256 itemPrice,string carrierId,bytes32 trackingHash,uint256 nonce,uint256 voucherDeadline)"
  );
  ```
- **Oracle Signer Extraction & Quorum Verification**:
  - Signatures are recovered via `ECDSA.recover(digest, signature)`.
  - The contract iterates across provided signatures and validates `isOracleSigner[signer] == true` while enforcing unique recovered addresses (`seenSigners` bitmask/tracking) until reaching `THRESHOLD = 2`.
  - No specific lexicographical sorting of signatures is mandated by the contract, provided distinct authorized oracle signers satisfy quorum.

## 🔄 Oracle Key Rotation Governance (Two-Step Timelocked Process)

Oracle signer set updates in `HarmoniumPayEscrow.sol` follow a strict two-phase timelocked governance workflow to preserve non-custodial invariants:

1. **Phase 1 — Proposal (`proposeOracleSigners`)**:
   - Contract owner initiates a proposed list of exactly 3 distinct non-zero oracle addresses.
   - Sets `oracleUpdateEta = block.timestamp + ORACLE_UPDATE_TIMELOCK` (2-day timelock delay).
   - Emits `OracleSignersUpdateProposed(newSigners, oracleUpdateEta)`.

2. **Phase 2 — Execution (`executeOracleSignersUpdate`)**:
   - Can only be executed by `onlyOwner` once `block.timestamp >= oracleUpdateEta`.
   - Clears existing oracle signers mapping and replaces them with `pendingOracleSigners`.
   - Resets `oracleUpdateEta = 0` and emits `OracleSignersUpdated(newSigners)`.

3. **Invariants & Safeguards**:
   - Active orders validate signers against the active `isOracleSigner` mapping at settlement execution time.
   - Admin cannot bypass the 2-day timelock delay to instantaneously rotate signers.
   - Timelocked rotation does not allow the admin to confiscate or redirect locked escrow funds.

## State Machine Transition Rules
- **Enum Specification**: `enum OrderState { UNINITIALIZED, FUNDED, SETTLED, REFUNDED }`
- **Allowed Transitions**:
  - `UNINITIALIZED` -> `FUNDED` (via atomic `createAndFundOrder` or `deposit`)
  - `FUNDED` -> `SETTLED` (via 2-of-3 Oracle voucher attestation or `confirmReceiptByBuyer`)
  - `FUNDED` -> `REFUNDED` (via `claimRefund` after `fulfillmentDeadline` expiration)
- **Forbidden Transitions**:
  - `UNINITIALIZED` -> `SETTLED` / `REFUNDED`
  - `SETTLED` -> `ANY`
  - `REFUNDED` -> `ANY`

## Circuit Breaker & Pause Behavior
- **Paused Functions (`whenNotPaused`)**: `createAndFundOrder`, `deposit`, `releaseWithOracle`, `settleWithOracle`, `confirmReceiptByBuyer`.
- **Unpaused Functions (`whenPaused` permitted)**: `claimRefund` and `refundTimeout` remain permanently accessible during emergency pause.
