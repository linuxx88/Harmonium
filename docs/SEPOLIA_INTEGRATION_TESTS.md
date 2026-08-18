# Live Sepolia Testnet Execution Report

This document records the live integration tests and advanced adversarial scenarios executed directly on the Ethereum Sepolia testnet.

---

## 1. General Information

- **Network**: Ethereum Sepolia (Chain ID: `11155111`)
- **Deployer / Signer**: `0x619CdaB7C39cF5E218a6D41d3e053273293f404A`
- **Tested Contract**: `MockERC20` (`mSUSD`)

---

## 2. Base Integration Test (`scripts/test_sepolia_live.js`)

- **Objective**: Validate RPC connectivity, `.env` parameter resolution, allowance approval, and standard transfer settlement.
- **Transactions**:
  - **Approve (1.0 token)**: [`0x647e44ab69b2fc97fcea333a3b4017cc810b86ecfe837ddc429ff66d587afa98`](https://sepolia.etherscan.io/tx/0x647e44ab69b2fc97fcea333a3b4017cc810b86ecfe837ddc429ff66d587afa98)
  - **Transfer (0.1 token)**: [`0x2e37e633a7ab0683826fa5f19f010ef78bcac9b4ccede46cd4a3e6dd6dccbc60`](https://sepolia.etherscan.io/tx/0x2e37e633a7ab0683826fa5f19f010ef78bcac9b4ccede46cd4a3e6dd6dccbc60)
- **Result**: Balances verified on-chain (0.11828 ETH remaining, initial 100 tokens minted and confirmed).

---

## 3. Advanced Test Suite (`scripts/test_sepolia_advanced.js`)

### Scenario 1: Allowance Exceed Revert
- **Approve (5.0 tokens)**: [`0xbd1f7f7f2facc96c9be8481142132c09eb15fcfa486e01783e8b24bc9a2f93a3`](https://sepolia.etherscan.io/tx/0xbd1f7f7f2facc96c9be8481142132c09eb15fcfa486e01783e8b24bc9a2f93a3)
- **Attempted `transferFrom` (10.0 tokens)**: Correctly rejected and revert captured on-chain.

### Scenario 2: Faucet Claim (+1000 tokens)
- **Faucet Tx**: [`0x727d8efa94ae46f12d57e3fb5120eccada2751152b5bbe2a251d013c3a20a508`](https://sepolia.etherscan.io/tx/0x727d8efa94ae46f12d57e3fb5120eccada2751152b5bbe2a251d013c3a20a508)
- **Impact**: Signer balance increased from 100.0 to 1100.0 tokens.

---

## 4. Live `HarmoniumPayEscrow` Contract Verification (`0x9e0F50123cac1151782D77099774a58140363dD1`)

### Flow 1: 2-of-3 Oracle EIP-712 Threshold Settlement
- **Deposit & Fund Tx**: [`0x03172f2dfdd19ac13a0fb86ae875a8c682ac6e3002a69337de74962a0d67e2fe`](https://sepolia.etherscan.io/tx/0x03172f2dfdd19ac13a0fb86ae875a8c682ac6e3002a69337de74962a0d67e2fe)
- **Settlement (`settleWithOracle`) Tx**: [`0x88b34e29cc2f8504f14aca8de6e0ce03da3f1d4aa34ff2c6f900b538ceff8df0`](https://sepolia.etherscan.io/tx/0x88b34e29cc2f8504f14aca8de6e0ce03da3f1d4aa34ff2c6f900b538ceff8df0)
- **Outcome**: **PASS** — Smart contract recovered 2 valid distinct oracle signatures on-chain and disbursed 10.0 USDC to seller.

### Flow 2: Direct Buyer Confirmation (`confirmReceiptByBuyer`)
- **Deposit & Fund Tx**: [`0x4c4caca8a8fba6b955efd557cc2b7b97b8d0741ca6c6bfad92aa33998e6095d0`](https://sepolia.etherscan.io/tx/0x4c4caca8a8fba6b955efd557cc2b7b97b8d0741ca6c6bfad92aa33998e6095d0)
- **Confirmation Tx**: [`0xe0d0b683ab6cfade6ffa8dd9be6727e98970569682c2caccd42bab2fec56700d`](https://sepolia.etherscan.io/tx/0xe0d0b683ab6cfade6ffa8dd9be6727e98970569682c2caccd42bab2fec56700d)
- **Outcome**: **PASS** — Instant non-custodial release to seller.

### Flow 3: Timeout Refund Temporal Boundary Check (`claimRefund`)
- **Premature Refund Invocation**: Evaluated on live order funded on-chain.
- **Contract Enforcement**: **REVERTED (`TimeoutNotReached`)** — Verified that `claimRefund` is strictly locked until the immutable 7-day fulfillment deadline elapses.
- **Pending Live Execution**: Live on-chain execution of `claimRefund` remains pending until 7 calendar days have elapsed on Ethereum Sepolia.
