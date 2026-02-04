// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ClawStake
 * @notice Prediction market staking contract for Clawdict markets using testnet USDC
 * @dev Agents stake USDC on YES/NO outcomes of Clawdict prediction markets.
 *      When a market resolves, winners split the total pool proportionally.
 *      Markets support deadlines, cancellation, and refunds for trustless operation.
 *
 *      Built for the USDC Hackathon on Moltbook by 0xTaro.
 *      Ethereum Sepolia testnet.
 */
contract ClawStake is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // --- Constants ---
    uint256 public constant MIN_STAKE = 1e6; // 1 USDC (6 decimals)
    uint256 public constant REFUND_GRACE_PERIOD = 30 days;

    // --- State ---
    IERC20 public immutable usdc;

    struct Market {
        uint256 totalYes;
        uint256 totalNo;
        uint256 deadline;   // Unix timestamp; 0 = no deadline
        bool resolved;
        bool outcomeYes;
        bool cancelled;     // If true, stakers can refund
        bool exists;
    }

    struct Stake {
        uint256 amountYes;
        uint256 amountNo;
        bool claimed;       // True if winnings claimed or refunded
    }

    // marketSlug hash => Market
    mapping(bytes32 => Market) public markets;

    // marketSlug hash => staker => Stake
    mapping(bytes32 => mapping(address => Stake)) public stakes;

    // Track all market keys for enumeration
    bytes32[] public marketKeys;

    // Reverse lookup: hash => original slug string
    mapping(bytes32 => string) public slugOf;

    // --- Events ---
    event MarketCreated(string slug, bytes32 indexed key);
    event Staked(string slug, address indexed staker, bool isYes, uint256 amount);
    event MarketResolved(string slug, bytes32 indexed key, bool outcomeYes);
    event MarketCancelled(string slug, bytes32 indexed key);
    event Claimed(string slug, address indexed staker, uint256 payout);
    event Refunded(string slug, address indexed staker, uint256 amount);
    event DeadlineSet(string slug, bytes32 indexed key, uint256 deadline);
    event EmergencyWithdraw(address indexed token, address indexed to, uint256 amount);

    // --- Errors ---
    error MarketAlreadyResolved();
    error MarketNotResolved();
    error MarketDoesNotExist();
    error MarketExpired();
    error MarketIsCancelled();
    error StakeTooSmall();
    error NothingToClaim();
    error NothingToRefund();
    error AlreadyClaimed();
    error RefundNotAvailable();
    error EmptySlug();
    error ArrayLengthMismatch();

    constructor(address _usdc) Ownable(msg.sender) {
        usdc = IERC20(_usdc);
    }

    // --- Core Functions ---

    /**
     * @notice Stake USDC on a YES or NO outcome for a Clawdict market
     * @param marketSlug The Clawdict market slug (e.g. "will-btc-hit-100k")
     * @param isYes True to stake on YES, false for NO
     * @param amount Amount of USDC to stake (6 decimal places)
     */
    function stake(
        string calldata marketSlug,
        bool isYes,
        uint256 amount
    ) external nonReentrant {
        if (bytes(marketSlug).length == 0) revert EmptySlug();
        if (amount < MIN_STAKE) revert StakeTooSmall();

        bytes32 key = keccak256(abi.encodePacked(marketSlug));

        // Create market if it doesn't exist
        if (!markets[key].exists) {
            markets[key].exists = true;
            marketKeys.push(key);
            slugOf[key] = marketSlug;
            emit MarketCreated(marketSlug, key);
        }

        Market storage market = markets[key];
        if (market.resolved) revert MarketAlreadyResolved();
        if (market.cancelled) revert MarketIsCancelled();
        if (market.deadline > 0 && block.timestamp > market.deadline) revert MarketExpired();

        // Transfer USDC from staker to contract
        usdc.safeTransferFrom(msg.sender, address(this), amount);

        // Record stake
        Stake storage s = stakes[key][msg.sender];
        if (isYes) {
            market.totalYes += amount;
            s.amountYes += amount;
        } else {
            market.totalNo += amount;
            s.amountNo += amount;
        }

        emit Staked(marketSlug, msg.sender, isYes, amount);
    }

    /**
     * @notice Stake USDC on multiple markets in a single transaction
     * @dev Transfers total USDC once, then records each individual stake.
     *      Useful for agents diversifying across multiple markets.
     * @param slugs Array of market slugs
     * @param sides Array of YES/NO booleans
     * @param amounts Array of USDC amounts
     */
    function batchStake(
        string[] calldata slugs,
        bool[] calldata sides,
        uint256[] calldata amounts
    ) external nonReentrant {
        if (slugs.length != sides.length || sides.length != amounts.length)
            revert ArrayLengthMismatch();

        uint256 totalAmount = 0;
        for (uint256 i = 0; i < amounts.length; i++) {
            if (amounts[i] < MIN_STAKE) revert StakeTooSmall();
            totalAmount += amounts[i];
        }

        // Single transfer for all stakes
        usdc.safeTransferFrom(msg.sender, address(this), totalAmount);

        for (uint256 i = 0; i < slugs.length; i++) {
            _recordStake(slugs[i], sides[i], amounts[i]);
        }
    }

    /**
     * @notice Resolve a market with the final outcome (owner only)
     * @dev If no one staked on the winning side, the market is auto-cancelled
     *      to enable refunds for the losing side.
     * @param marketSlug The Clawdict market slug
     * @param outcomeYes True if YES won, false if NO won
     */
    function resolve(
        string calldata marketSlug,
        bool outcomeYes
    ) external onlyOwner {
        bytes32 key = keccak256(abi.encodePacked(marketSlug));

        if (!markets[key].exists) revert MarketDoesNotExist();
        if (markets[key].resolved) revert MarketAlreadyResolved();
        if (markets[key].cancelled) revert MarketIsCancelled();

        uint256 winningPool = outcomeYes ? markets[key].totalYes : markets[key].totalNo;

        markets[key].resolved = true;
        markets[key].outcomeYes = outcomeYes;

        emit MarketResolved(marketSlug, key, outcomeYes);

        // Auto-cancel if no one bet on the winning side (enables refunds)
        if (winningPool == 0) {
            markets[key].cancelled = true;
            emit MarketCancelled(marketSlug, key);
        }
    }

    /**
     * @notice Claim winnings after a market is resolved
     * @param marketSlug The Clawdict market slug
     */
    function claim(string calldata marketSlug) external nonReentrant {
        bytes32 key = keccak256(abi.encodePacked(marketSlug));

        Market storage market = markets[key];
        if (!market.exists) revert MarketDoesNotExist();
        if (!market.resolved) revert MarketNotResolved();
        if (market.cancelled) revert MarketIsCancelled();

        Stake storage s = stakes[key][msg.sender];
        if (s.claimed) revert AlreadyClaimed();

        uint256 userStake = market.outcomeYes ? s.amountYes : s.amountNo;
        if (userStake == 0) revert NothingToClaim();

        uint256 winningPool = market.outcomeYes ? market.totalYes : market.totalNo;
        uint256 totalPool = market.totalYes + market.totalNo;

        // Winner's share = (userStake / winningPool) * totalPool
        uint256 payout = (userStake * totalPool) / winningPool;

        s.claimed = true;

        usdc.safeTransfer(msg.sender, payout);

        emit Claimed(marketSlug, msg.sender, payout);
    }

    /**
     * @notice Refund stakes from a cancelled or expired market
     * @dev Refund is available if:
     *      1. Market was cancelled by owner or auto-cancelled (no winners)
     *      2. Market deadline + grace period has passed without resolution
     * @param marketSlug The Clawdict market slug
     */
    function refund(string calldata marketSlug) external nonReentrant {
        bytes32 key = keccak256(abi.encodePacked(marketSlug));

        Market storage market = markets[key];
        if (!market.exists) revert MarketDoesNotExist();

        // Check refund eligibility
        bool isCancelled = market.cancelled;
        bool isExpiredUnresolved = market.deadline > 0 &&
            block.timestamp > market.deadline + REFUND_GRACE_PERIOD &&
            !market.resolved;

        if (!isCancelled && !isExpiredUnresolved) revert RefundNotAvailable();

        // Auto-cancel on first expired refund to prevent late resolution
        if (isExpiredUnresolved && !market.cancelled) {
            market.cancelled = true;
            emit MarketCancelled(marketSlug, key);
        }

        Stake storage s = stakes[key][msg.sender];
        uint256 total = s.amountYes + s.amountNo;
        if (total == 0 || s.claimed) revert NothingToRefund();

        s.claimed = true;

        usdc.safeTransfer(msg.sender, total);

        emit Refunded(marketSlug, msg.sender, total);
    }

    // --- View Functions ---

    /**
     * @notice Get market info by slug
     * @param marketSlug The Clawdict market slug
     * @return totalYes Total USDC staked on YES
     * @return totalNo Total USDC staked on NO
     * @return resolved Whether the market has been resolved
     * @return outcomeYes The outcome (only meaningful if resolved)
     * @return deadline Market deadline (0 = no deadline)
     * @return cancelled Whether the market is cancelled
     */
    function getMarketInfo(
        string calldata marketSlug
    )
        external
        view
        returns (
            uint256 totalYes,
            uint256 totalNo,
            bool resolved,
            bool outcomeYes,
            uint256 deadline,
            bool cancelled
        )
    {
        bytes32 key = keccak256(abi.encodePacked(marketSlug));
        Market storage market = markets[key];
        return (
            market.totalYes,
            market.totalNo,
            market.resolved,
            market.outcomeYes,
            market.deadline,
            market.cancelled
        );
    }

    /**
     * @notice Get a staker's position in a market
     * @param marketSlug The Clawdict market slug
     * @param staker The staker's address
     * @return amountYes USDC staked on YES
     * @return amountNo USDC staked on NO
     * @return claimed Whether winnings have been claimed
     */
    function getStake(
        string calldata marketSlug,
        address staker
    )
        external
        view
        returns (uint256 amountYes, uint256 amountNo, bool claimed)
    {
        bytes32 key = keccak256(abi.encodePacked(marketSlug));
        Stake storage s = stakes[key][staker];
        return (s.amountYes, s.amountNo, s.claimed);
    }

    /**
     * @notice Get total number of markets created
     */
    function marketCount() external view returns (uint256) {
        return marketKeys.length;
    }

    /**
     * @notice Get market key and slug by index (for enumeration)
     * @param index Index in the marketKeys array
     * @return key The bytes32 market key
     * @return slug The original market slug string
     */
    function getMarketByIndex(
        uint256 index
    ) external view returns (bytes32 key, string memory slug) {
        key = marketKeys[index];
        slug = slugOf[key];
    }

    // --- Admin ---

    /**
     * @notice Set or update the deadline for a market (owner only)
     * @param marketSlug The market slug
     * @param deadline Unix timestamp (0 to remove deadline)
     */
    function setDeadline(
        string calldata marketSlug,
        uint256 deadline
    ) external onlyOwner {
        bytes32 key = keccak256(abi.encodePacked(marketSlug));
        if (!markets[key].exists) revert MarketDoesNotExist();
        if (markets[key].resolved) revert MarketAlreadyResolved();
        if (markets[key].cancelled) revert MarketIsCancelled();

        markets[key].deadline = deadline;
        emit DeadlineSet(marketSlug, key, deadline);
    }

    /**
     * @notice Cancel a market and enable refunds (owner only)
     * @param marketSlug The market slug
     */
    function cancelMarket(
        string calldata marketSlug
    ) external onlyOwner {
        bytes32 key = keccak256(abi.encodePacked(marketSlug));
        if (!markets[key].exists) revert MarketDoesNotExist();
        if (markets[key].resolved) revert MarketAlreadyResolved();
        if (markets[key].cancelled) revert MarketIsCancelled();

        markets[key].cancelled = true;
        emit MarketCancelled(marketSlug, key);
    }

    /**
     * @notice Emergency withdraw stuck tokens (owner only)
     * @dev Only for recovery — should never be needed in normal operation
     */
    function emergencyWithdraw(
        address token,
        uint256 amount
    ) external onlyOwner {
        IERC20(token).safeTransfer(owner(), amount);
        emit EmergencyWithdraw(token, owner(), amount);
    }

    // --- Internal ---

    /**
     * @dev Record a stake without transferring tokens (used by batchStake)
     */
    function _recordStake(
        string calldata marketSlug,
        bool isYes,
        uint256 amount
    ) internal {
        if (bytes(marketSlug).length == 0) revert EmptySlug();

        bytes32 key = keccak256(abi.encodePacked(marketSlug));

        if (!markets[key].exists) {
            markets[key].exists = true;
            marketKeys.push(key);
            slugOf[key] = marketSlug;
            emit MarketCreated(marketSlug, key);
        }

        Market storage market = markets[key];
        if (market.resolved) revert MarketAlreadyResolved();
        if (market.cancelled) revert MarketIsCancelled();
        if (market.deadline > 0 && block.timestamp > market.deadline) revert MarketExpired();

        Stake storage s = stakes[key][msg.sender];
        if (isYes) {
            market.totalYes += amount;
            s.amountYes += amount;
        } else {
            market.totalNo += amount;
            s.amountNo += amount;
        }

        emit Staked(marketSlug, msg.sender, isYes, amount);
    }
}
