# Architecture System Documentation

> [!WARNING]
> **DISCLAIMER**: This repository is a security-focused PoC and has not been audited. It must not be used with production funds.

## System Position & Summary
**Harmonium Pay PoC**: Non-custodial, permissionless e-commerce escrow with cryptographically verified delivery settlement.

## Security Model

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

### 1. On-Chain Guarantees (EVM Execution Boundary)
- **Zero Administrative Fund-Transfer Authority**: No owner/admin function exists to confiscate, divert, or withdraw locked escrow funds (`Invariant 9`).
- **Terminal State Irreversibility**: Orders in `SETTLED` or `REFUNDED` states can never transition to any other state (`Invariants 1 & 2`).
- **Strict Accounting Conservation**: Escrow balance exactly equals the sum of gross amounts for active `FUNDED` orders.
- **Cryptographic Replay Resistance**: EIP-712 domain separation binds `chainId`, `verifyingContract`, and per-order nonces (`Invariants 5, 6, 7`).
- **Fail-Safe Buyer Redundancy**: If oracles are offline or fail to sign, the buyer can voluntarily release funds via `confirmReceiptByBuyer` (`Invariant 4`), or claim full refund via `claimRefund` once `fulfillmentDeadline` elapses (`Invariant 3`).

### 2. Oracle Trust Assumptions
- **2-of-3 Quorum Threshold**: Automated settlement strictly mandates valid cryptographic attestations from $\ge 2$ distinct authorized oracle keys.
- **Threshold Honesty Model**: The security boundary assumes that **fewer than 2 out of 3 authorized oracle keys are compromised or colluding**. A single compromised key cannot trigger settlement.

### 3. Carrier-Data Assumptions (Physical-World Grounding)
- **External Web2 Grounding**: Automated attestation relies on external shipping carrier tracking APIs (e.g. UPS, FedEx, Canada Post).
- **Physical-World Data Boundary**: The smart contract cannot independently verify physical parcel contents. The security model assumes that carrier status updates genuinely reflect physical transit and delivery.

### 4. Off-Chain Key-Management Assumptions
- **Signer Identity Isolation**: In a production setting, oracle private keys must be stored in secure HSMs or cloud KMS enclaves (AWS KMS, GCP KMS, Vault Transit) with hardware-enforced access policies.
- **Signer Nonce & Timestamp Integrity**: Oracle services are assumed to generate monotonic nonces and valid EIP-712 expiration timestamps (`voucherDeadline`).

### 5. PoC Infrastructure Limitations
- **In-Process Key Simulation**: In this local PoC, the 3 oracle signing identities run within `backend/oracle.py` on a single process. This simulates cryptographic verification and quorum logic but **does not provide physical or infrastructure isolation**.
- **Mock Shipping Fixture**: Carrier status queries use `MOCK_SHIPPING_DB` and `verify_carrier_status` rather than live authenticated carrier WebSockets/Webhooks.
- **Unaudited Status**: This codebase is an unaudited Proof of Concept and must not be used with production funds.

### Actor Trust Taxonomy
- **Trusted**: EVM Consensus / L2 Execution, USDC Token Contract, OpenZeppelin Primitives, Secp256k1 ECDSA / EIP-712 Standards.
- **Assumed Honest**: 2-of-3 Oracle Quorum ($\le 1$ compromised key), Carrier API feeds.
- **Untrusted / Adversarial**: Buyer, Seller, Frontend UI, Backend Web Server, Contract Deployer / Owner.

### Threat Model & Mitigation Matrix

| Attacker Capability | Targeted Component | Expected Security Boundary | Mitigation Strategy | Corresponding Test Target |
| :--- | :--- | :--- | :--- | :--- |
| **Compromised Oracle Key (1-of-3)** | Settlement Attestation (`settleWithOracle`) | Single corrupted signature cannot trigger fund release | 2-of-3 Threshold Quorum with strict `signer0 != signer1` check | `test_invalid_quorum_rejection` / `Scenario 3` |
| **Forged Price / Amount Payload** | Release Voucher Parameter Verification | Signed voucher with modified amount cannot extract escrow funds | Strict on-chain parameter validation matching stored order state | `test_voucher_parameter_mismatch` |
| **Signature & Nonce Replay** | Settlement Execution | Settled voucher cannot be re-executed on current or other orders | State transition to `SETTLED` + per-order mapped nonces (`usedNonces`) | `test_settled_order_cannot_settle_replay` |
| **Cross-Chain / Cross-Contract Replay** | EIP-712 Signature Domain | Voucher from Testnet/Fork cannot be submitted on Mainnet/other contract | EIP-712 domain separator binding `chainId` & `verifyingContract` | `test_voucher_domain_chain_separation` |
| **Malicious Contract Owner / Admin** | Fund Custody & State Transitions | Admin cannot unilaterally confiscate or divert escrowed deposits | Zero administrative fund-transfer functions (`Invariant 9`) | `test_admin_has_no_fund_transfer_authority` |
| **Fulfillment Timeout Race Condition** | Settlement vs Refund Race | Late settlement cannot reverse buyer refund and vice versa | First mined transaction establishes irreversible terminal state | `test_deterministic_settlement_vs_refund_race` |
| **Protocol Emergency Halt** | Circuit Breaker (`Pausable`) | Paused contract blocks new orders but does not lock user funds | `claimRefund` explicitly overrides pause check (`whenNotPaused` omitted) | `test_refund_accessible_when_paused` |

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
- **Cryptographic Domain Separation**: `chainId` and `verifyingContract` are bound strictly via the EIP-712 domain separator, blocking cross-chain and cross-contract signature replays.
- **Order Binding**: The release voucher payload explicitly binds `orderId`, `buyer`, `seller`, `token`, `grossAmount`, `itemPrice`, `carrierId`, `trackingHash`, `nonce`, and `voucherDeadline` to guarantee attestations are valid strictly for the intended on-chain order parameters.
- **Replay Protection**: Replays are strictly prevented via nonces scoped per order and stored directly in mapped state (`usedNonces[orderId][nonce] = true`).
- **Decoupled Deadlines & Expiration Behavior**:
  - `fulfillmentDeadline` (order-level expiration for buyer refunds, e.g., T + 7 days) vs `voucherDeadline` (EIP-712 cryptographic signature validity window).
  - **Voucher Exceeding Fulfillment Deadline**: If an oracle generates a `voucherDeadline > fulfillmentDeadline`, the voucher cannot bypass the hard order deadline on-chain. If presented after `fulfillmentDeadline`, settlement reverts with `SettlementDeadlinePassed()` regardless of remaining voucher validity, and the buyer's refund rights via `claimRefund()` take absolute priority. Settlement requires `block.timestamp <= min(voucherDeadline, order.fulfillmentDeadline)`.
- **Explicit Carrier Data & EIP-712 TypeHash Specification**:
  - Struct TypeHash:
    ```solidity
    bytes32 public constant RELEASE_VOUCHER_TYPEHASH = keccak256(
        "ReleaseVoucher(bytes32 orderId,address buyer,address seller,address token,uint256 grossAmount,uint256 itemPrice,string carrierId,bytes32 trackingHash,uint256 nonce,uint256 voucherDeadline)"
    );
    ```
  - **Dynamic Type Encoding Rule**: In strict compliance with the EIP-712 standard, dynamic types (such as `string carrierId`) are encoded in the `structHash` as `keccak256(bytes(carrierId))` within `abi.encode(...)` before computing `_hashTypedDataV4(structHash)`.
- **Oracle Signer Extraction & Strict Ordered Uniqueness**:
  - `signer0 = ECDSA.recover(digest, signatures[0])`
  - `signer1 = ECDSA.recover(digest, signatures[1])`
  - Strict validation: `signer0 != signer1` (distinct oracle identities required) and `isOracleSigner[signer0] && isOracleSigner[signer1]` (both signers must be authorized oracle identities).
  - **Canonical Ordering Enforcement**: For multi-signature quorum verification over iterated arrays or pairs, requiring strictly ascending signer address order (`signer0 < signer1`) prevents array permutation malleability (e.g. `[sigA, sigB]` vs `[sigB, sigA]`) and guarantees a single canonical representation per settlement call.
- **Accounting Validation Checks**:
  - `voucher.grossAmount == order.grossAmount`
  - `voucher.itemPrice == order.itemPrice`
  - `order.grossAmount == order.itemPrice + order.feeAmount`

## 🔄 Oracle Key Rotation Governance & Security Boundaries

To maintain strict compliance with **Invariant 9** (*No privileged account can arbitrarily release escrow funds*), oracle key rotation via `setOracleSigners(address[] calldata _newSigners)` adheres to the following rules:

1. **Who can rotate an oracle?**
   - Strictly restricted to contract `onlyOwner` (admin/multisig).
2. **Can rotation occur while orders are `FUNDED`?**
   - **Yes.** Active `FUNDED` orders are not locked to specific oracle key snapshots. They evaluate validity against `isOracleSigner[signer]` at the moment of settlement transaction execution.
3. **Can the admin replace 2-of-3 compromised oracles?**
   - **Yes.** In an emergency incident response scenario where 1 or 2 oracle private keys are compromised, the admin can invoke `setOracleSigners` to revoke the compromised addresses and register new secure oracle public keys.
4. **Can oracle rotation invalidate existing vouchers?**
   - **Yes.** Any outstanding EIP-712 vouchers signed by revoked oracle keys become instantly invalid (`isOracleSigner[signer] == false` causing `InvalidSignature` revert).
   - **Operational Impact on Merchants**: If all 3 keys (or 2 out of 3) are rotated simultaneously, merchants holding unsubmitted valid vouchers will see their settlement transactions revert. To settle, merchants must request the newly provisioned oracle quorum to re-sign and reissue a fresh EIP-712 release voucher matching the order parameters.
5. **Non-Custodial Safeguard Guarantee (Invariant 9 Integrity)**:
   - Admin rotation of oracle signers does **NOT** grant the admin custody or transfer rights over escrowed funds.
   - To settle an order after rotation, the admin must control at least 2 valid, active oracle private keys *AND* generate a cryptographically valid EIP-712 `ReleaseVoucher` matching the exact on-chain order parameters.
   - If the buyer does not receive delivery, the buyer retains their autonomous right to execute `claimRefund` once `fulfillmentDeadline` expires, regardless of any oracle key rotations performed by the admin.

### Off-Chain Oracle Infrastructure: PoC vs Production
- **PoC Topology (Current)**: All 3 oracle signing identities are colocated in a single backend process (`backend/main.py`) for simplified local testing, continuous integration, and benchmark reproducibility.
- **Production Architecture**: 3 physically isolated signer microservices (each hosting a single private key in a dedicated KMS/HSM module and validating shipment webhooks independently) communicating via authenticated internal RPC/gRPC with a stateless quorum coordinator.

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

## Off-Chain State Persistence Layer
- **Storage Engine**: Zero-config local SQLite3 database (`backend/harmonium_pay.db`).
- **Managed Entity (`orders` table)**: Persists `order_id`, `session_id`, `buyer`, `seller`, `item_price`, `gross_amount`, `token`, `contract_address`, `chain_id`, `tracking_id`, `status`, `nonce`, `voucher_deadline`, `signatures` (JSON list), and `created_at`.
- **Lifecycle Integration**: Initialized via `init_db()` on FastAPI `startup` lifecycle event (`on_startup` in `backend/main.py`).
- **Security & Reliability**: Thread-safe connection factory (`get_db_connection()`), SQL parameterization (`?`) preventing SQL injection vulnerabilities, and complete state recovery across server restarts.
- **Horizontal Scaling & Production Topology**: While SQLite (in WAL mode) provides zero-config simplicity for PoC and single-node instances, it does not support multi-instance distributed deployments due to file-locking constraints across multiple API containers. Production high-availability (HA) topologies require migrating the persistence layer to PostgreSQL / AWS Aurora with a connection pooler (e.g. PgBouncer).

## System Components
- **Smart Contracts (EVM)**: Hardened ERC-20 Escrow with EIP-712 structured signatures, 2-of-3 threshold oracle verification, buyer fee surcharge model, per-order anti-replay nonces, explicit gross surcharge accounting, and zero discretionary admin overrides.
- **Backend (FastAPI + web3.py + SQLite / PostgreSQL)**: Multi-node oracle engine monitoring on-chain events, shipping carrier APIs, managing persistent order state, and coordinating cryptographic EIP-712 release vouchers.
- **Frontend (Vanilla HTML/JS)**: Embeddable checkout widget interacting with EVM wallets and backend oracle endpoints.
- **Scripts**: Automated testnet deployment (`deploy_testnet.js`), E2E flow simulation (`simulate_flow.js`), and security chaos test suite (`chaos_test.js`).

## 🛡️ Target Production Multi-Oracle Quorum Architecture
For mainnet production deployment, the single-process PoC oracle simulator transitions into a fully distributed, fault-isolated architecture:
1. **3 Autonomous Microservices**: Each oracle node runs in a dedicated VPC/cluster with separate network boundaries, distinct cloud accounts, and independent operator credentials.
2. **Dedicated Cloud HSM / KMS Keys**: Oracle private keys are never exposed in environment variables or application memory; all EIP-712 signing operations are executed inside FIPS 140-2 Level 3 compliant Hardware Security Modules (e.g., AWS CloudHSM, Google Cloud KMS, or HashiCorp Vault Transit engine).
3. **Independent Carrier API Ingestion**: Each oracle service independently queries and parses authenticated carrier endpoints (FedEx/UPS/DHL webhooks and REST APIs) with distinct API credentials.
4. **Quorum Aggregation Gateway**: A lightweight, non-custodial relayer aggregates signatures from at least 2 distinct, verified nodes to construct the final 2-of-3 release voucher payload for the merchant/buyer.



