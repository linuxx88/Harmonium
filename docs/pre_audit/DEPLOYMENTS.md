# Testnet Deployment Status & Verification - Harmonium Pay

## Deployment Policy & Safety Constraint
> [!IMPORTANT]
> In accordance with pre-audit safety guidelines, live testnet deployments (Arbitrum Sepolia, Base Sepolia) and contract verification requiring external gas funds and live private keys must be explicitly confirmed and executed in a dedicated operational window.

---

## Target Network Configuration

### 1. Arbitrum Sepolia
- **Chain ID**: `421614`
- **RPC Endpoint**: `https://sepolia.arbitrum.io/rpc`
- **Explorer**: `https://sepolia.arbiscan.io`
- **Deployment Script**: `scripts/deploy_testnet.js`
- **Status**: **PENDING EXPLICIT CONFIRMATION / READY FOR BROADCAST**

### 2. Base Sepolia
- **Chain ID**: `84532`
- **RPC Endpoint**: `https://sepolia.base.org`
- **Explorer**: `https://sepolia.basescan.org`
- **Deployment Script**: `scripts/deploy_testnet.js`
- **Status**: **PENDING EXPLICIT CONFIRMATION / READY FOR BROADCAST**

---

## Deployment & Verification Commands

```bash
# Arbitrum Sepolia Deployment & Verification
npx hardhat run scripts/deploy_testnet.js --network arbitrumSepolia
npx hardhat verify --network arbitrumSepolia <DEPLOYED_ESCROW_ADDRESS> "<USDC_TOKEN_ADDRESS>" "[\"<ORACLE_1>\",\"<ORACLE_2>\",\"<ORACLE_3>\"]" "<FEE_RECIPIENT>"

# Base Sepolia Deployment & Verification
npx hardhat run scripts/deploy_testnet.js --network baseSepolia
npx hardhat verify --network baseSepolia <DEPLOYED_ESCROW_ADDRESS> "<USDC_TOKEN_ADDRESS>" "[\"<ORACLE_1>\",\"<ORACLE_2>\",\"<ORACLE_3>\"]" "<FEE_RECIPIENT>"
```
