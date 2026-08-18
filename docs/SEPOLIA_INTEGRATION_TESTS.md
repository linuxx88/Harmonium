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

### Scenario 3: Transfer to Third-Party Random Recipient (25 tokens)
- **Recipient Address**: `0xd66c98714d5fa6F90F4fb54651DfF976dd98A19d`
- **Transfer Tx**: [`0xdf268563435ed4390c00a2bec0e5c205f3fe9948ff5879ba07426dc962007842`](https://sepolia.etherscan.io/tx/0xdf268563435ed4390c00a2bec0e5c205f3fe9948ff5879ba07426dc962007842)
- **Validation**: Recipient balance transitioned from 0.0 to 25.0 tokens.
