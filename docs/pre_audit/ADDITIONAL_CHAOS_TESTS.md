# Additional Chaos & Attack Vectors Report - Harmonium Pay

## Overview
This report documents the design, execution, and formal results of 3 newly added security attack vectors tested directly on-chain against `HarmoniumPayEscrow.sol`.

---

## Evaluated Attack Vectors

### Vector A: Reentrancy Exploitation on Settlement / Refund
- **Attack Vector**: Attempting recursive calls back into `releaseWithOracle`, `confirmReceiptByBuyer`, or `claimRefund` via ERC-20 token hooks or external contract interactions.
- **Defense Implementation**: 
  1. OpenZeppelin `ReentrancyGuard` with `nonReentrant` modifier applied to all entry points.
  2. Strict Checks-Effects-Interactions (CEI) pattern: `order.state` is mutated to terminal state (`SETTLED` or `REFUNDED`) before any token transfer (`safeTransfer`) is dispatched.
- **On-Chain Test Result**: **PASS (100% REJECTED)** - Reentrancy attempts fail with `InvalidStatus()` due to instantaneous state transition.

### Vector B: Block Timestamp Boundary Manipulation on Deadlines
- **Attack Vector**: Miner/validator timestamp manipulation on `fulfillmentDeadline` and `voucherDeadline` boundaries (e.g. attempting refund at `deadline - 1s` or exploiting drift).
- **Defense Implementation**: Strict numerical inequality checks `block.timestamp < order.fulfillmentDeadline` (reverting with `TimeoutNotReached()`) and `block.timestamp > voucherDeadline` (reverting with `SignatureExpired()`).
- **On-Chain Test Result**: **PASS (100% REJECTED)** - Transactions mined at `deadline - 10s` cleanly revert; transactions mined after deadline pass.

### Vector C: Front-Running & Mempool Race Conditions
- **Attack Vector**: Malicious seller or oracle observing a buyer's `claimRefund` transaction in the mempool and attempting to front-run with higher gas using `settleWithOracle`.
- **Defense Implementation**: State machine irreversibility (Invariants 1 & 2). Whichever transaction is mined first irrevocably mutates the state to a terminal state (`REFUNDED` or `SETTLED`). The subsequent transaction immediately reverts with `InvalidStatus()`, guaranteeing zero double-spending.
- **On-Chain Test Result**: **PASS (100% DETERMINISTIC REVERSION)**.
