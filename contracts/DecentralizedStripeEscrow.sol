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
 * @title DecentralizedStripeEscrow
 * @notice Permissionless USDC escrow infrastructure for e-commerce with verifiable delivery settlement.
 * @dev Hardened with EIP-712 structured signatures, 2-of-3 threshold oracle verification, buyer-paid fee surcharges, and anti-replay nonces.
 */
contract DecentralizedStripeEscrow is ReentrancyGuard, Pausable, Ownable, EIP712 {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    enum EscrowStatus { NonExistent, Deposited, Released, Refunded, Disputed }

    struct EscrowOrder {
        bytes32 orderId;
        address buyer;
        address seller;
        uint256 netAmount;
        uint256 feeAmount;
        uint256 createdAt;
        uint256 timeout;
        uint256 nonce;
        EscrowStatus status;
    }

    bytes32 public constant RELEASE_VOUCHER_TYPEHASH = keccak256(
        "ReleaseVoucher(bytes32 orderId,address buyer,address seller,address token,uint256 amount,bytes32 trackingHash,uint256 nonce,uint256 deadline)"
    );

    IERC20 public immutable usdcToken;
    address public feeRecipient;
    uint256 public constant PROTOCOL_FEE_BPS = 10; // 0.1% (10 basis points)
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant DEFAULT_TIMEOUT = 7 days;
    uint256 public constant THRESHOLD = 2;

    address[] public oracleSigners;
    mapping(address => bool) public isOracleSigner;
    mapping(bytes32 => mapping(address => bool)) public oracleAttestations;

    mapping(bytes32 => EscrowOrder) public orders;

    event PaymentDeposited(
        bytes32 indexed orderId,
        address indexed buyer,
        address indexed seller,
        uint256 netAmount,
        uint256 feeAmount,
        uint256 totalDeposited
    );
    event PaymentReleased(bytes32 indexed orderId, address indexed seller, uint256 amountReleased, uint256 feeDeducted);
    event BuyerRefunded(bytes32 indexed orderId, address indexed buyer, uint256 amountRefunded);
    event DisputeRaised(bytes32 indexed orderId, address indexed raisedBy);
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
    error InvalidQuorum();
    error SignatureExpired();
    error DuplicateSignature();

    constructor(
        address _usdcToken,
        address[] memory _oracleSigners,
        address _feeRecipient
    ) Ownable(msg.sender) EIP712("DecentralizedStripeEscrow", "1") {
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

    function setOracleSigners(address[] calldata _newSigners) external onlyOwner {
        if (_newSigners.length < THRESHOLD) revert InvalidQuorum();

        for (uint256 i = 0; i < oracleSigners.length; i++) {
            isOracleSigner[oracleSigners[i]] = false;
        }

        for (uint256 i = 0; i < _newSigners.length; i++) {
            address signer = _newSigners[i];
            if (signer == address(0) || isOracleSigner[signer]) revert InvalidAddress();
            isOracleSigner[signer] = true;
        }

        oracleSigners = _newSigners;
        emit OracleSignersUpdated(_newSigners);
    }

    /**
     * @notice Buyer deposits payment + surcharge fee into escrow.
     * @param orderId Unique identifier for the order.
     * @param seller Recipient of net payment upon delivery.
     * @param netAmount Exact amount seller will receive ($100.00 USDC).
     */
    function deposit(bytes32 orderId, address seller, uint256 netAmount) external whenNotPaused nonReentrant {
        if (orders[orderId].status != EscrowStatus.NonExistent) revert OrderAlreadyExists();
        if (seller == address(0) || netAmount == 0) revert InvalidAddress();

        uint256 feeAmount = (netAmount * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;
        uint256 totalAmount = netAmount + feeAmount;

        orders[orderId] = EscrowOrder({
            orderId: orderId,
            buyer: msg.sender,
            seller: seller,
            netAmount: netAmount,
            feeAmount: feeAmount,
            createdAt: block.timestamp,
            timeout: block.timestamp + DEFAULT_TIMEOUT,
            nonce: 1,
            status: EscrowStatus.Deposited
        });

        usdcToken.safeTransferFrom(msg.sender, address(this), totalAmount);
        emit PaymentDeposited(orderId, msg.sender, seller, netAmount, feeAmount, totalAmount);
    }

    /**
     * @notice Releases escrow funds using 2-of-3 EIP-712 threshold signatures.
     */
    function releaseWithOracle(
        bytes32 orderId,
        bytes32 trackingHash,
        uint256 deadline,
        bytes[] calldata signatures
    ) external whenNotPaused nonReentrant {
        EscrowOrder storage order = orders[orderId];
        if (order.status != EscrowStatus.Deposited) revert InvalidStatus();
        if (block.timestamp > deadline) revert SignatureExpired();
        if (signatures.length < THRESHOLD) revert InvalidQuorum();

        bytes32 structHash = keccak256(
            abi.encode(
                RELEASE_VOUCHER_TYPEHASH,
                orderId,
                order.buyer,
                order.seller,
                address(usdcToken),
                order.netAmount,
                trackingHash,
                order.nonce,
                deadline
            )
        );

        bytes32 digest = _hashTypedDataV4(structHash);
        uint256 validSignatures = 0;
        address[] memory seenSigners = new address[](signatures.length);

        for (uint256 i = 0; i < signatures.length; i++) {
            address recovered = ECDSA.recover(digest, signatures[i]);
            if (!isOracleSigner[recovered]) revert InvalidSignature();

            for (uint256 j = 0; j < validSignatures; j++) {
                if (seenSigners[j] == recovered) revert DuplicateSignature();
            }

            seenSigners[validSignatures] = recovered;
            validSignatures++;
        }

        if (validSignatures < THRESHOLD) revert InvalidQuorum();

        order.nonce++;
        _executeRelease(order);
    }

    /**
     * @notice Direct release triggered exclusively by the buyer.
     */
    function releaseByBuyer(bytes32 orderId) external whenNotPaused nonReentrant {
        EscrowOrder storage order = orders[orderId];
        if (order.status != EscrowStatus.Deposited) revert InvalidStatus();
        if (msg.sender != order.buyer) revert Unauthorized();

        _executeRelease(order);
    }

    /**
     * @notice Buyer-triggered refund after 7-day timeout expiry.
     */
    function refundTimeout(bytes32 orderId) external whenNotPaused nonReentrant {
        EscrowOrder storage order = orders[orderId];
        if (order.status != EscrowStatus.Deposited) revert InvalidStatus();
        if (msg.sender != order.buyer) revert Unauthorized();
        if (block.timestamp < order.timeout) revert TimeoutNotReached();

        order.status = EscrowStatus.Refunded;
        uint256 totalRefund = order.netAmount + order.feeAmount;

        usdcToken.safeTransfer(order.buyer, totalRefund);
        emit BuyerRefunded(orderId, order.buyer, totalRefund);
    }

    /**
     * @notice Raises dispute lock on escrow order.
     */
    function raiseDispute(bytes32 orderId) external whenNotPaused nonReentrant {
        EscrowOrder storage order = orders[orderId];
        if (order.status != EscrowStatus.Deposited) revert InvalidStatus();
        if (msg.sender != order.buyer && msg.sender != order.seller) revert Unauthorized();

        order.status = EscrowStatus.Disputed;
        emit DisputeRaised(orderId, msg.sender);
    }

    function _executeRelease(EscrowOrder storage order) internal {
        order.status = EscrowStatus.Released;

        if (order.feeAmount > 0) {
            usdcToken.safeTransfer(feeRecipient, order.feeAmount);
        }
        usdcToken.safeTransfer(order.seller, order.netAmount);

        emit PaymentReleased(order.orderId, order.seller, order.netAmount, order.feeAmount);
    }

    function getDomainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
