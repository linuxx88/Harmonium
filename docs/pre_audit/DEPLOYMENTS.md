# Testnet Deployment Status & Verification - Harmonium Pay

## Deployment Policy & Safety Constraint
> [!IMPORTANT]
> Live testnet deployments require confirmed gas funds and explicit transaction broadcast. Contracts deployed to testnets serve as pre-audit public execution verification fixtures.

---

## Target Network Configuration & Live Status

### 1. Ethereum Sepolia (Live Deployment)
- **Chain ID**: `11155111`
- **Explorer**: `https://sepolia.etherscan.io`
- **Status**: **LIVE DEPLOYED & VERIFIED ON-CHAIN**
- **Escrow Contract**: `0x9e0F50123cac1151782D77099774a58140363dD1`
- **USDC Token**: `0x52387944807715b66c8CB50AF3975f8A1210bbF2`
- **Oracle Signers (3)**:
  - `0xd85DE497C3D2FcC5957499249eB149af58Be8cfF`
  - `0xD9983f2136ef9DBA0682B670b94975a2927D6CdD`
  - `0x08D185dC4CF0E01FB8D5b91f35d9574D98EafB5c`
- **Fee Recipient**: `0x0000000000000000000000000000000000000002`

### 2. Arbitrum Sepolia
- **Chain ID**: `421614`
- **RPC Endpoint**: `https://sepolia.arbitrum.io/rpc`
- **Explorer**: `https://sepolia.arbiscan.io`
- **Deployment Script**: `scripts/deploy_testnet.js`
- **Status**: **PENDING EXPLICIT CONFIRMATION / READY FOR BROADCAST**

### 3. Base Sepolia
- **Chain ID**: `84532`
- **RPC Endpoint**: `https://sepolia.base.org`
- **Explorer**: `https://sepolia.basescan.org`
- **Deployment Script**: `scripts/deploy_testnet.js`
- **Status**: **PENDING EXPLICIT CONFIRMATION / READY FOR BROADCAST**

---

## Deployment & Verification Commands

```bash
# Ethereum Sepolia Deployment & Verification
npx hardhat run scripts/deploy_testnet.js --network sepolia
npx hardhat verify --network sepolia 0x9e0F50123cac1151782D77099774a58140363dD1 "0x52387944807715b66c8CB50AF3975f8A1210bbF2" "[\"0xd85DE497C3D2FcC5957499249eB149af58Be8cfF\",\"0xD9983f2136ef9DBA0682B670b94975a2927D6CdD\",\"0x08D185dC4CF0E01FB8D5b91f35d9574D98EafB5c\"]" "0x0000000000000000000000000000000000000002"

# Arbitrum Sepolia Deployment & Verification
npx hardhat run scripts/deploy_testnet.js --network arbitrumSepolia
npx hardhat verify --network arbitrumSepolia <DEPLOYED_ESCROW_ADDRESS> "<USDC_TOKEN_ADDRESS>" "[\"<ORACLE_1>\",\"<ORACLE_2>\",\"<ORACLE_3>\"]" "<FEE_RECIPIENT>"

# Base Sepolia Deployment & Verification
npx hardhat run scripts/deploy_testnet.js --network baseSepolia
npx hardhat verify --network baseSepolia <DEPLOYED_ESCROW_ADDRESS> "<USDC_TOKEN_ADDRESS>" "[\"<ORACLE_1>\",\"<ORACLE_2>\",\"<ORACLE_3>\"]" "<FEE_RECIPIENT>"
```
