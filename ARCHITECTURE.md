# Architecture System Documentation

## System Components
- **Smart Contracts (EVM)**: ERC-20 Mock USDC token and Escrow payment contract with manual confirmation & oracle interface.
- **Backend (FastAPI + web3.py)**: Listens for blockchain events, tracks payment state, and exposes API endpoints for checkout session creation.
- **Frontend (Vanilla HTML/JS)**: Lightweight payment widget interacting with MetaMask/EVM wallet and backend API.
- **Scripts**: Deployment and utility scripts for local EVM network setup (Anvil / Hardhat).

## Data Flow
1. **Merchant/Client** -> Requests a payment session from **Backend API**.
2. **Backend API** -> Creates a payment intent and returns contract/order parameters to **Frontend**.
3. **Frontend** -> Prompts user to approve USDC allowance & deposit tokens to **Escrow Contract**.
4. **Smart Contract** -> Emits `PaymentDeposited` event.
5. **Backend** -> Listens for `PaymentDeposited` event and updates order status.
6. **Delivery / Release** -> Merchant/Oracle triggers release on **Escrow Contract** to transfer funds to merchant.

## File Organization
```
DECENTRALIZED-STRIPE/
├── contracts/       # Solidity smart contracts
├── backend/         # FastAPI & web3.py application
├── frontend/        # Vanilla HTML/JS widget
├── scripts/         # Local deployment and setup scripts
└── .env.example     # Environment configuration placeholders
```

## Phase 1: System Architecture & Project Setup

- [x] **1.1 Directory & Workspace Initialization**
  - Create project folder structure (`contracts/`, `backend/`, `frontend/`, `scripts/`).
  - Initialize git repository and set up `.gitignore` and `.env.example`.

- [x] **1.2 Smart Contract Toolchain Setup**
  - Initialize Hardhat/Foundry environment with required dependencies (OpenZeppelin contracts, compilers).

- [x] **1.3 Back-End & Front-End Boilerplate Setup**
  - Set up Python virtual environment, `requirements.txt` (FastAPI, web3.py, uvicorn), and basic app entry point.
  - Create minimal `index.html` structure in `frontend/`.

- [x] **1.4 Verification**
  - Verify local dev environment compiles clean before moving to Phase 2.

## Phase 2: Core Smart Contract Implementation & Testing

- [x] **2.1 Contract Specification & Interface Design**
  - Define `DecentralizedStripeEscrow.sol` state variables (`buyer`, `seller`, `amount`, `status`, `trackingId`).
  - Map essential function signatures: `deposit()`, `release()`, `refund()`, `raiseDispute()`, `setOracle()`.
  - Design circuit breakers and emergency pause mechanisms.

- [x] **2.2 Smart Contract Development (Solidity)**
  - Implement core escrow logic using OpenZeppelin standards (`ReentrancyGuard`, `Pausable`, `SafeERC20`).
  - Integrate fee deduction logic (0.1% protocol fee) and time-locked auto-refund timers.

- [x] **2.3 Automated Test Suite Setup**
  - Build comprehensive unit test suite in Hardhat/Foundry covering happy paths, edge cases, reentrancy resistance, and deadline expirations.

- [x] **2.4 Local Verification & Gas Profiling**
  - Execute full local test suite (100% pass target).
  - Generate gas consumption report and verify zero critical vulnerabilities before approval.

## Phase 3: Oracle Back-End & Front-End Payment Widget

- [x] **3.1 Oracle Service Architecture (FastAPI)**
  - Design FastAPI application structure to monitor on-chain `PaymentDeposited` events.
  - Set up API endpoints to link on-chain transaction hashes with carrier tracking IDs.

- [x] **3.2 Delivery Verification & Automated Settlement Engine**
  - Implement the Oracle worker service that periodically queries shipping statuses (e.g., Canada Post / UPS mock API).
  - Generate cryptographic signatures to trigger the smart contract's `release()` function automatically upon delivery confirmation.

- [x] **3.3 Embeddable Checkout Widget Development**
  - Build a zero-dependency JavaScript checkout component that merchants can insert into any web app.
  - Handle wallet connections (or Passkey/Account Abstraction) and contract interaction signatures seamlessly.

- [x] **3.4 End-to-End Local Integration Testing**
  - Execute full transaction simulation: Checkout click -> Escrow deposit -> Carrier update simulation -> Oracle trigger -> Merchant USDC release.
  - Validate end-to-end flow and confirm all system integration tests pass.

## Phase 4: Full Deployment, Security Audit & Final Cleanup

- [x] **4.1 Public Testnet Deployment**
  - Deploy compiled smart contracts to a public testnet (e.g., Arbitrum Sepolia or Base Sepolia).
  - Verify contract bytecode and publish source code on the block explorer (Etherscan/Basescan).

- [x] **4.2 Edge-Case & Chaos Testing**
  - Simulate network delays, failed oracle API calls, unfulfilled deliveries, and manual dispute triggers.
  - Verify circuit breakers, pause mechanisms, and emergency refund paths under failure conditions.

- [x] **4.3 Code Optimization & Security Sanitization**
  - Clean up codebase, enforce strict linting rules, and remove all hardcoded test keys/secrets.
  - Run static analysis tools (e.g., Slither/Mythril) to generate a final vulnerability and gas-optimization audit report.

- [x] **4.4 Developer Documentation & Demo Setup**
  - Finalize `README.md` with step-by-step instructions to run the local stack and widget demo.
  - Generate OpenAPI/Swagger documentation for the FastAPI Oracle service.


