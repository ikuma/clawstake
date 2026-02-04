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
 *
 *      Built for the USDC Hackathon on Moltbook by 0xTaro.
 *      Base Sepolia testnet only.
 */
contract ClawStake is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // --- Constants ---
    uint256 public constant MIN_STAKE = 1e6; // 1 USDC (6 decimals)

    // --- State ---
    IERC20 public immutable usdc;

    struct Market {
        uint256 totalYes;
        uint256 totalNo;
        bool resolved;
        bool outcomeYes;
        bool exists;
    }

    struct Stake {
        uint256 amountYes;
        uint256 amountNo;
        bool claimed;
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
    event MarketCreated(string indexed slug, bytes32 indexed key);
    event Staked(string indexed slug, address indexed staker, bool isYes, uint256 amount);
    event MarketResolved(string indexed slug, bool outcomeYes);
    event Claimed(string indexed slug, address indexed staker, uint256 payout);

    // --- Errors ---
    error MarketAlreadyResolved();
    error MarketNotResolved();
    error MarketDoesNotExist();
    error StakeTooSmall();
    error NothingToClaim();
    error AlreadyClaimed();
    error NoWinningPool();

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
     * @notice Resolve a market with the final outcome (owner only)
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

        markets[key].resolved = true;
        markets[key].outcomeYes = outcomeYes;

        emit MarketResolved(marketSlug, outcomeYes);
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

    // --- View Functions ---

    /**
     * @notice Get market info by slug
     * @param marketSlug The Clawdict market slug
     * @return totalYes Total USDC staked on YES
     * @return totalNo Total USDC staked on NO
     * @return resolved Whether the market has been resolved
     * @return outcomeYes The outcome (only meaningful if resolved)
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
            bool outcomeYes
        )
    {
        bytes32 key = keccak256(abi.encodePacked(marketSlug));
        Market storage market = markets[key];
        return (
            market.totalYes,
            market.totalNo,
            market.resolved,
            market.outcomeYes
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
     * @notice Emergency withdraw stuck tokens (owner only)
     * @dev Only for recovery — should never be needed in normal operation
     */
    function emergencyWithdraw(
        address token,
        uint256 amount
    ) external onlyOwner {
        IERC20(token).safeTransfer(owner(), amount);
    }
}
