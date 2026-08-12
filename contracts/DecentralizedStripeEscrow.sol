// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title DecentralizedStripeEscrow
 * @dev Escrow contract providing payment deposits, automated oracle releases, manual disputes, and auto-refund timeouts.
 */
contract DecentralizedStripeEscrow is ReentrancyGuard, Pausable, Ownable {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    enum EscrowStatus { NonExistent, Deposited, Released, Refunded, Disputed }

    struct EscrowOrder {
        bytes32 orderId;
        address buyer;
        address seller;
        uint256 amount;
        uint256 createdAt;
        uint256 timeout;
        EscrowStatus status;
    }

    IERC20 public immutable usdcToken;
    address public oracleAddress;
    address public feeRecipient;
    uint256 public constant PROTOCOL_FEE_BPS = 10; // 0.1% (10 basis points)
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant DEFAULT_TIMEOUT = 7 days;

    mapping(bytes32 => EscrowOrder) public orders;

    event PaymentDeposited(bytes32 indexed orderId, address indexed buyer, address indexed seller, uint256 amount);
    event PaymentReleased(bytes32 indexed orderId, address indexed seller, uint256 amountReleased, uint256 feeDeducted);
    event PaymentRefunded(bytes32 indexed orderId, address indexed buyer, uint256 amountRefunded);
    event DisputeRaised(bytes32 indexed orderId, address indexed raisedBy);
    event DisputeResolved(bytes32 indexed orderId, address recipient, uint256 amount);
    event OracleUpdated(address indexed newOracle);
    event FeeRecipientUpdated(address indexed newFeeRecipient);

    error OrderAlreadyExists();
    error OrderDoesNotExist();
    error InvalidStatus();
    error TimeoutNotReached();
    error Unauthorized();
    error InvalidSignature();
    error InvalidAddress();

    constructor(address _usdcToken, address _oracleAddress, address _feeRecipient) Ownable(msg.sender) {
        if (_usdcToken == address(0) || _oracleAddress == address(0) || _feeRecipient == address(0)) {
            revert InvalidAddress();
        }
        usdcToken = IERC20(_usdcToken);
        oracleAddress = _oracleAddress;
        feeRecipient = _feeRecipient;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function setOracle(address _oracleAddress) external onlyOwner {
        if (_oracleAddress == address(0)) revert InvalidAddress();
        oracleAddress = _oracleAddress;
        emit OracleUpdated(_oracleAddress);
    }

    function setFeeRecipient(address _feeRecipient) external onlyOwner {
        if (_feeRecipient == address(0)) revert InvalidAddress();
        feeRecipient = _feeRecipient;
        emit FeeRecipientUpdated(_feeRecipient);
    }

    function deposit(bytes32 orderId, address seller, uint256 amount) external whenNotPaused nonReentrant {
        if (orders[orderId].status != EscrowStatus.NonExistent) revert OrderAlreadyExists();
        if (seller == address(0) || amount == 0) revert InvalidAddress();

        orders[orderId] = EscrowOrder({
            orderId: orderId,
            buyer: msg.sender,
            seller: seller,
            amount: amount,
            createdAt: block.timestamp,
            timeout: block.timestamp + DEFAULT_TIMEOUT,
            status: EscrowStatus.Deposited
        });

        usdcToken.safeTransferFrom(msg.sender, address(this), amount);
        emit PaymentDeposited(orderId, msg.sender, seller, amount);
    }

    function releaseWithOracle(bytes32 orderId, bytes calldata signature) external whenNotPaused nonReentrant {
        EscrowOrder storage order = orders[orderId];
        if (order.status != EscrowStatus.Deposited) revert InvalidStatus();

        bytes32 messageHash = keccak256(abi.encodePacked(orderId, order.buyer, order.seller, order.amount));
        bytes32 ethSignedMessageHash = MessageHashUtils.toEthSignedMessageHash(messageHash);
        address recoveredSigner = ethSignedMessageHash.recover(signature);

        if (recoveredSigner != oracleAddress) revert InvalidSignature();

        _executeRelease(order);
    }

    function release(bytes32 orderId) external whenNotPaused nonReentrant {
        EscrowOrder storage order = orders[orderId];
        if (order.status != EscrowStatus.Deposited) revert InvalidStatus();
        if (msg.sender != order.buyer && msg.sender != oracleAddress && msg.sender != owner()) revert Unauthorized();

        _executeRelease(order);
    }

    function refundTimeout(bytes32 orderId) external whenNotPaused nonReentrant {
        EscrowOrder storage order = orders[orderId];
        if (order.status != EscrowStatus.Deposited) revert InvalidStatus();
        if (block.timestamp < order.timeout) revert TimeoutNotReached();

        order.status = EscrowStatus.Refunded;
        usdcToken.safeTransfer(order.buyer, order.amount);
        emit PaymentRefunded(orderId, order.buyer, order.amount);
    }

    function raiseDispute(bytes32 orderId) external whenNotPaused nonReentrant {
        EscrowOrder storage order = orders[orderId];
        if (order.status != EscrowStatus.Deposited) revert InvalidStatus();
        if (msg.sender != order.buyer && msg.sender != order.seller) revert Unauthorized();

        order.status = EscrowStatus.Disputed;
        emit DisputeRaised(orderId, msg.sender);
    }

    function resolveDispute(bytes32 orderId, address recipient, uint256 amountToRecipient) external onlyOwner nonReentrant {
        EscrowOrder storage order = orders[orderId];
        if (order.status != EscrowStatus.Disputed) revert InvalidStatus();
        if (amountToRecipient > order.amount) revert InvalidAddress();

        order.status = EscrowStatus.Released;
        uint256 remaining = order.amount - amountToRecipient;

        if (amountToRecipient > 0) {
            usdcToken.safeTransfer(recipient, amountToRecipient);
        }
        if (remaining > 0) {
            address otherParty = (recipient == order.buyer) ? order.seller : order.buyer;
            usdcToken.safeTransfer(otherParty, remaining);
        }

        emit DisputeResolved(orderId, recipient, amountToRecipient);
    }

    function _executeRelease(EscrowOrder storage order) internal {
        order.status = EscrowStatus.Released;

        uint256 fee = (order.amount * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;
        uint256 netAmount = order.amount - fee;

        if (fee > 0) {
            usdcToken.safeTransfer(feeRecipient, fee);
        }
        usdcToken.safeTransfer(order.seller, netAmount);

        emit PaymentReleased(order.orderId, order.seller, netAmount, fee);
    }
}
