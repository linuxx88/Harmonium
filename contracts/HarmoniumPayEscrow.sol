// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/**
 * @title HarmoniumPayEscrow
 * @notice Non-custodial, permissionless e-commerce escrow with cryptographically verified delivery settlement.
 * @dev Hardened with EIP-712 structured vouchers, 2-of-3 threshold oracle verification, buyer-paid fee surcharges, and per-order anti-replay nonces.
 * @dev Note: Assumes strictly standard IERC20 tokens (e.g. standard USDC). Tokens with fee-on-transfer, rebasing, or deflationary mechanics are unsupported as they violate gross amount accounting invariants.
 * 
 * DISCLAIMER: This repository is a security-focused PoC and has not been audited. It must not be used with production funds.
 */
contract HarmoniumPayEscrow is ReentrancyGuard, Pausable, Ownable, EIP712 {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    enum OrderState { UNINITIALIZED, FUNDED, SETTLED, REFUNDED }

    struct EscrowOrder {
        bytes32 orderId;
        address buyer;
        address seller;
        address protocolFeeRecipient;
        uint256 itemPrice;
        uint256 feeAmount;
        uint256 grossAmount;
        uint256 createdAt;
        uint256 fulfillmentDeadline;
        OrderState state;
    }

    bytes32 public constant RELEASE_VOUCHER_TYPEHASH = keccak256(
        "ReleaseVoucher(bytes32 orderId,address buyer,address seller,address token,uint256 grossAmount,uint256 itemPrice,string carrierId,bytes32 trackingHash,uint256 nonce,uint256 voucherDeadline)"
    );

    IERC20 public immutable usdcToken;
    address public feeRecipient;
    uint256 public constant PROTOCOL_FEE_BPS = 10; // 0.1% (10 basis points)
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant DEFAULT_TIMEOUT = 7 days;
    uint256 public constant THRESHOLD = 2;

    uint256 public constant MIN_ITEM_PRICE = 1000;
    uint256 public constant ORACLE_UPDATE_TIMELOCK = 2 days;

    address[] public oracleSigners;
    mapping(address => bool) public isOracleSigner;
    address[] public pendingOracleSigners;
    uint256 public oracleUpdateEta;

    mapping(bytes32 => EscrowOrder) public orders;
    // Per-order settlement nonce anti-replay mapping: orderId => nonce => used
    mapping(bytes32 => mapping(uint256 => bool)) public usedNonces;

    event OrderCreated(bytes32 indexed orderId, address indexed buyer, address indexed seller, uint256 itemPrice);
    event PaymentDeposited(
        bytes32 indexed orderId,
        address indexed buyer,
        address indexed seller,
        uint256 itemPrice,
        uint256 feeAmount,
        uint256 grossAmount
    );
    event PaymentSettled(bytes32 indexed orderId, address indexed seller, uint256 itemPrice, uint256 feeAmount);
    event BuyerRefunded(bytes32 indexed orderId, address indexed buyer, uint256 amountRefunded);
    event OracleSignersProposed(address[] pendingSigners, uint256 eta);
    event OracleSignersUpdated(address[] newSigners);
    event FeeRecipientUpdated(address indexed newFeeRecipient);

    error OrderAlreadyExists();
    error OrderDoesNotExist();
    error InvalidStatus();
    error TimeoutNotReached();
    error TimeoutPassed();
    error Unauthorized();
    error InvalidSignature();
    error InvalidAddress();
    error InvalidAmount();
    error InvalidAccounting();
    error InvalidQuorum();
    error SignatureExpired();
    error DuplicateSignature();
    error SettlementDeadlinePassed();
    error NonceAlreadyUsed();
    error TimelockNotExpired();
    error NoPendingUpdate();

    constructor(
        address _usdcToken,
        address[] memory _oracleSigners,
        address _feeRecipient
    ) Ownable(msg.sender) EIP712("HarmoniumPayEscrow", "1") {
        if (_usdcToken == address(0) || _feeRecipient == address(0)) revert InvalidAddress();
        if (_oracleSigners.length < THRESHOLD) revert InvalidQuorum();

        usdcToken = IERC20(_usdcToken);
        feeRecipient = _feeRecipient;

        for (uint256 i = 0; i < _oracleSigners.length; i++) {
            address signer = _oracleSigners[i];
            if (signer == address(0) || isOracleSigner[signer]) revert InvalidAddress();
            isOracleSigner[signer] = true;
        }
        oracleSigners = _oracleSigners;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function setFeeRecipient(address _feeRecipient) external onlyOwner {
        if (_feeRecipient == address(0)) revert InvalidAddress();
        feeRecipient = _feeRecipient;
        emit FeeRecipientUpdated(_feeRecipient);
    }

    function proposeOracleSigners(address[] calldata _newSigners) external onlyOwner {
        if (_newSigners.length < THRESHOLD) revert InvalidQuorum();

        for (uint256 i = 0; i < _newSigners.length; i++) {
            if (_newSigners[i] == address(0)) revert InvalidAddress();
            for (uint256 j = 0; j < i; j++) {
                if (_newSigners[i] == _newSigners[j]) revert DuplicateSignature();
            }
        }

        pendingOracleSigners = _newSigners;
        oracleUpdateEta = block.timestamp + ORACLE_UPDATE_TIMELOCK;
        emit OracleSignersProposed(_newSigners, oracleUpdateEta);
    }

    function executeOracleSignersUpdate() external onlyOwner {
        if (oracleUpdateEta == 0) revert NoPendingUpdate();
        if (block.timestamp < oracleUpdateEta) revert TimelockNotExpired();

        for (uint256 i = 0; i < oracleSigners.length; i++) {
            isOracleSigner[oracleSigners[i]] = false;
        }

        for (uint256 i = 0; i < pendingOracleSigners.length; i++) {
            isOracleSigner[pendingOracleSigners[i]] = true;
        }

        oracleSigners = pendingOracleSigners;
        delete pendingOracleSigners;
        oracleUpdateEta = 0;

        emit OracleSignersUpdated(oracleSigners);
    }

    /**
     * @notice Helper to compute order tracking hash from carrier string/ID and tracking number.
     */
    function computeTrackingHash(string calldata carrierId, string calldata trackingNumber) public pure returns (bytes32) {
        return keccak256(abi.encode(carrierId, trackingNumber));
    }

    /**
     * @notice Atomic creation and funding of escrow order.
     * @param orderId Unique identifier for the order.
     * @param seller Recipient of net payment upon delivery.
     * @param itemPrice Exact amount seller will receive ($100.00 USDC).
     */
    function createAndFundOrder(bytes32 orderId, address seller, uint256 itemPrice) external whenNotPaused nonReentrant {
        if (orders[orderId].state != OrderState.UNINITIALIZED) revert OrderAlreadyExists();
        if (seller == address(0)) revert InvalidAddress();
        if (itemPrice < MIN_ITEM_PRICE) revert InvalidAmount();

        uint256 feeAmount = (itemPrice * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;
        uint256 grossAmount = itemPrice + feeAmount;

        orders[orderId] = EscrowOrder({
            orderId: orderId,
            buyer: msg.sender,
            seller: seller,
            protocolFeeRecipient: feeRecipient,
            itemPrice: itemPrice,
            feeAmount: feeAmount,
            grossAmount: grossAmount,
            createdAt: block.timestamp,
            fulfillmentDeadline: block.timestamp + DEFAULT_TIMEOUT,
            state: OrderState.FUNDED
        });

        usdcToken.safeTransferFrom(msg.sender, address(this), grossAmount);
        emit OrderCreated(orderId, msg.sender, seller, itemPrice);
        emit PaymentDeposited(orderId, msg.sender, seller, itemPrice, feeAmount, grossAmount);
    }

    /**
     * @notice Alias for createAndFundOrder for backwards compatibility.
     */
    function deposit(bytes32 orderId, address seller, uint256 itemPrice) external whenNotPaused nonReentrant {
        if (orders[orderId].state != OrderState.UNINITIALIZED) revert OrderAlreadyExists();
        if (seller == address(0)) revert InvalidAddress();
        if (itemPrice < MIN_ITEM_PRICE) revert InvalidAmount();

        uint256 feeAmount = (itemPrice * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;
        uint256 grossAmount = itemPrice + feeAmount;

        orders[orderId] = EscrowOrder({
            orderId: orderId,
            buyer: msg.sender,
            seller: seller,
            protocolFeeRecipient: feeRecipient,
            itemPrice: itemPrice,
            feeAmount: feeAmount,
            grossAmount: grossAmount,
            createdAt: block.timestamp,
            fulfillmentDeadline: block.timestamp + DEFAULT_TIMEOUT,
            state: OrderState.FUNDED
        });

        usdcToken.safeTransferFrom(msg.sender, address(this), grossAmount);
        emit OrderCreated(orderId, msg.sender, seller, itemPrice);
        emit PaymentDeposited(orderId, msg.sender, seller, itemPrice, feeAmount, grossAmount);
    }

    /**
     * @notice Releases escrow funds using 2-of-3 EIP-712 threshold signatures.
     * @dev Follows strict Checks-Effects-Interactions (CEI) pattern.
     */
    function releaseWithOracle(
        bytes32 orderId,
        uint256 grossAmount,
        uint256 itemPrice,
        string calldata carrierId,
        bytes32 trackingHash,
        uint256 nonce,
        uint256 voucherDeadline,
        bytes[] calldata signatures
    ) external whenNotPaused nonReentrant {
        // Step 1: Checks
        EscrowOrder storage order = orders[orderId];
        if (order.state != OrderState.FUNDED) revert InvalidStatus();
        if (signatures.length < THRESHOLD) revert InvalidQuorum();

        // Strict accounting validation checks
        if (grossAmount != order.grossAmount || itemPrice != order.itemPrice || order.grossAmount != order.itemPrice + order.feeAmount) {
            revert InvalidAccounting();
        }

        // Enforce per-order nonce uniqueness
        if (usedNonces[orderId][nonce]) revert NonceAlreadyUsed();

        // Cryptographic voucher deadline check vs current block timestamp
        if (block.timestamp > voucherDeadline) revert SignatureExpired();
        // Fulfillment deadline check vs current block timestamp
        if (block.timestamp > order.fulfillmentDeadline) revert SettlementDeadlinePassed();

        _verifyVoucherSignatures(order, grossAmount, itemPrice, carrierId, trackingHash, nonce, voucherDeadline, signatures);

        // Step 2 & 3: Effects & Interactions
        usedNonces[orderId][nonce] = true;
        _executeSettlement(order);
    }

    /**
     * @notice Alias for releaseWithOracle for oracle-based settlement.
     * @dev Follows strict Checks-Effects-Interactions (CEI) pattern.
     */
    function settleWithOracle(
        bytes32 orderId,
        uint256 grossAmount,
        uint256 itemPrice,
        string calldata carrierId,
        bytes32 trackingHash,
        uint256 nonce,
        uint256 voucherDeadline,
        bytes[] calldata signatures
    ) external whenNotPaused nonReentrant {
        // Step 1: Checks
        EscrowOrder storage order = orders[orderId];
        if (order.state != OrderState.FUNDED) revert InvalidStatus();
        if (signatures.length < THRESHOLD) revert InvalidQuorum();

        if (grossAmount != order.grossAmount || itemPrice != order.itemPrice || order.grossAmount != order.itemPrice + order.feeAmount) {
            revert InvalidAccounting();
        }

        if (usedNonces[orderId][nonce]) revert NonceAlreadyUsed();

        if (block.timestamp > voucherDeadline) revert SignatureExpired();
        if (block.timestamp > order.fulfillmentDeadline) revert SettlementDeadlinePassed();

        _verifyVoucherSignatures(order, grossAmount, itemPrice, carrierId, trackingHash, nonce, voucherDeadline, signatures);

        // Step 2 & 3: Effects & Interactions
        usedNonces[orderId][nonce] = true;
        _executeSettlement(order);
    }

    function _verifyVoucherSignatures(
        EscrowOrder storage order,
        uint256 grossAmount,
        uint256 itemPrice,
        string calldata carrierId,
        bytes32 trackingHash,
        uint256 nonce,
        uint256 voucherDeadline,
        bytes[] calldata signatures
    ) internal view {
        bytes32 structHash = keccak256(
            abi.encode(
                RELEASE_VOUCHER_TYPEHASH,
                order.orderId,
                order.buyer,
                order.seller,
                address(usdcToken),
                grossAmount,
                itemPrice,
                keccak256(bytes(carrierId)),
                trackingHash,
                nonce,
                voucherDeadline
            )
        );

        bytes32 digest = _hashTypedDataV4(structHash);
        uint256 validSignaturesCount = 0;
        address[] memory seenSigners = new address[](signatures.length);

        for (uint256 i = 0; i < signatures.length; i++) {
            (address signer, ECDSA.RecoverError err, ) = ECDSA.tryRecover(digest, signatures[i]);
            if (err != ECDSA.RecoverError.NoError || !isOracleSigner[signer]) {
                continue;
            }

            bool duplicate = false;
            for (uint256 j = 0; j < validSignaturesCount; j++) {
                if (seenSigners[j] == signer) {
                    duplicate = true;
                    break;
                }
            }

            if (!duplicate) {
                seenSigners[validSignaturesCount] = signer;
                validSignaturesCount++;

                if (validSignaturesCount >= THRESHOLD) {
                    break;
                }
            }
        }

        if (validSignaturesCount < THRESHOLD) revert InvalidQuorum();
    }

    /**
     * @notice Direct voluntary confirmation and settlement triggered exclusively by the buyer.
     * @dev Follows strict Checks-Effects-Interactions (CEI) pattern.
     */
    function confirmReceiptByBuyer(bytes32 orderId) external whenNotPaused nonReentrant {
        // Step 1: Checks
        EscrowOrder storage order = orders[orderId];
        if (order.state != OrderState.FUNDED) revert InvalidStatus();
        if (msg.sender != order.buyer) revert Unauthorized();

        // Step 2 & 3: Effects (State mutation to SETTLED) & Interactions (Token transfers)
        _executeSettlement(order);
    }

    /**
     * @notice Buyer-triggered refund after fulfillment deadline expiry (claimRefund).
     * @dev Note: Not restricted by whenNotPaused so refunds remain permanently accessible even when paused.
     */
    function claimRefund(bytes32 orderId) external nonReentrant {
        EscrowOrder storage order = orders[orderId];
        if (order.state != OrderState.FUNDED) revert InvalidStatus();
        if (msg.sender != order.buyer) revert Unauthorized();
        if (block.timestamp <= order.fulfillmentDeadline) revert TimeoutNotReached();

        order.state = OrderState.REFUNDED;
        uint256 totalRefund = order.grossAmount;

        usdcToken.safeTransfer(order.buyer, totalRefund);
        emit BuyerRefunded(orderId, order.buyer, totalRefund);
    }

    /**
     * @dev Backward compatibility alias for refundTimeout.
     */
    function refundTimeout(bytes32 orderId) external nonReentrant {
        EscrowOrder storage order = orders[orderId];
        if (order.state != OrderState.FUNDED) revert InvalidStatus();
        if (msg.sender != order.buyer) revert Unauthorized();
        if (block.timestamp <= order.fulfillmentDeadline) revert TimeoutNotReached();

        order.state = OrderState.REFUNDED;
        uint256 totalRefund = order.grossAmount;

        usdcToken.safeTransfer(order.buyer, totalRefund);
        emit BuyerRefunded(orderId, order.buyer, totalRefund);
    }

    function _executeSettlement(EscrowOrder storage order) internal {
        order.state = OrderState.SETTLED;

        if (order.feeAmount > 0) {
            usdcToken.safeTransfer(order.protocolFeeRecipient, order.feeAmount);
        }
        usdcToken.safeTransfer(order.seller, order.itemPrice);

        emit PaymentSettled(order.orderId, order.seller, order.itemPrice, order.feeAmount);
    }

    function getDomainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
