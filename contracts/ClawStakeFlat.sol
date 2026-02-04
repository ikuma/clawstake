// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ============================================================================
// OpenZeppelin Contracts v5.1.0 — Flattened for ClawStake
// ============================================================================

// --- utils/introspection/IERC165.sol ---

interface IERC165 {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

// --- token/ERC20/IERC20.sol ---

interface IERC20 {
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

// --- interfaces/IERC1363.sol ---

interface IERC1363 is IERC20, IERC165 {
    function transferAndCall(address to, uint256 value) external returns (bool);
    function transferAndCall(address to, uint256 value, bytes calldata data) external returns (bool);
    function transferFromAndCall(address from, address to, uint256 value) external returns (bool);
    function transferFromAndCall(address from, address to, uint256 value, bytes calldata data) external returns (bool);
    function approveAndCall(address spender, uint256 value) external returns (bool);
    function approveAndCall(address spender, uint256 value, bytes calldata data) external returns (bool);
}

// --- utils/Errors.sol ---

library Errors {
    error InsufficientBalance(uint256 balance, uint256 needed);
    error FailedCall();
    error FailedDeployment();
    error MissingPrecompile(address);
}

// --- utils/Context.sol ---

abstract contract Context {
    function _msgSender() internal view virtual returns (address) {
        return msg.sender;
    }

    function _msgData() internal view virtual returns (bytes calldata) {
        return msg.data;
    }

    function _contextSuffixLength() internal view virtual returns (uint256) {
        return 0;
    }
}

// --- utils/ReentrancyGuard.sol ---

abstract contract ReentrancyGuard {
    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED = 2;

    uint256 private _status;

    error ReentrancyGuardReentrantCall();

    constructor() {
        _status = NOT_ENTERED;
    }

    modifier nonReentrant() {
        _nonReentrantBefore();
        _;
        _nonReentrantAfter();
    }

    function _nonReentrantBefore() private {
        if (_status == ENTERED) {
            revert ReentrancyGuardReentrantCall();
        }
        _status = ENTERED;
    }

    function _nonReentrantAfter() private {
        _status = NOT_ENTERED;
    }

    function _reentrancyGuardEntered() internal view returns (bool) {
        return _status == ENTERED;
    }
}

// --- utils/Address.sol ---

library Address {
    error AddressEmptyCode(address target);

    function sendValue(address payable recipient, uint256 amount) internal {
        if (address(this).balance < amount) {
            revert Errors.InsufficientBalance(address(this).balance, amount);
        }

        (bool success, ) = recipient.call{value: amount}("");
        if (!success) {
            revert Errors.FailedCall();
        }
    }

    function functionCall(address target, bytes memory data) internal returns (bytes memory) {
        return functionCallWithValue(target, data, 0);
    }

    function functionCallWithValue(address target, bytes memory data, uint256 value) internal returns (bytes memory) {
        if (address(this).balance < value) {
            revert Errors.InsufficientBalance(address(this).balance, value);
        }
        (bool success, bytes memory returndata) = target.call{value: value}(data);
        return verifyCallResultFromTarget(target, success, returndata);
    }

    function functionStaticCall(address target, bytes memory data) internal view returns (bytes memory) {
        (bool success, bytes memory returndata) = target.staticcall(data);
        return verifyCallResultFromTarget(target, success, returndata);
    }

    function functionDelegateCall(address target, bytes memory data) internal returns (bytes memory) {
        (bool success, bytes memory returndata) = target.delegatecall(data);
        return verifyCallResultFromTarget(target, success, returndata);
    }

    function verifyCallResultFromTarget(
        address target,
        bool success,
        bytes memory returndata
    ) internal view returns (bytes memory) {
        if (!success) {
            _revert(returndata);
        } else {
            if (returndata.length == 0 && target.code.length == 0) {
                revert AddressEmptyCode(target);
            }
            return returndata;
        }
    }

    function verifyCallResult(bool success, bytes memory returndata) internal pure returns (bytes memory) {
        if (!success) {
            _revert(returndata);
        } else {
            return returndata;
        }
    }

    function _revert(bytes memory returndata) private pure {
        if (returndata.length > 0) {
            assembly ("memory-safe") {
                let returndata_size := mload(returndata)
                revert(add(32, returndata), returndata_size)
            }
        } else {
            revert Errors.FailedCall();
        }
    }
}

// --- access/Ownable.sol ---

abstract contract Ownable is Context {
    address private _owner;

    error OwnableUnauthorizedAccount(address account);
    error OwnableInvalidOwner(address owner);

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    constructor(address initialOwner) {
        if (initialOwner == address(0)) {
            revert OwnableInvalidOwner(address(0));
        }
        _transferOwnership(initialOwner);
    }

    modifier onlyOwner() {
        _checkOwner();
        _;
    }

    function owner() public view virtual returns (address) {
        return _owner;
    }

    function _checkOwner() internal view virtual {
        if (owner() != _msgSender()) {
            revert OwnableUnauthorizedAccount(_msgSender());
        }
    }

    function renounceOwnership() public virtual onlyOwner {
        _transferOwnership(address(0));
    }

    function transferOwnership(address newOwner) public virtual onlyOwner {
        if (newOwner == address(0)) {
            revert OwnableInvalidOwner(address(0));
        }
        _transferOwnership(newOwner);
    }

    function _transferOwnership(address newOwner) internal virtual {
        address oldOwner = _owner;
        _owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }
}

// --- token/ERC20/utils/SafeERC20.sol ---

library SafeERC20 {
    error SafeERC20FailedOperation(address token);
    error SafeERC20FailedDecreaseAllowance(address spender, uint256 currentAllowance, uint256 requestedDecrease);

    function safeTransfer(IERC20 token, address to, uint256 value) internal {
        _callOptionalReturn(token, abi.encodeCall(token.transfer, (to, value)));
    }

    function safeTransferFrom(IERC20 token, address from, address to, uint256 value) internal {
        _callOptionalReturn(token, abi.encodeCall(token.transferFrom, (from, to, value)));
    }

    function safeIncreaseAllowance(IERC20 token, address spender, uint256 value) internal {
        uint256 oldAllowance = token.allowance(address(this), spender);
        forceApprove(token, spender, oldAllowance + value);
    }

    function safeDecreaseAllowance(IERC20 token, address spender, uint256 requestedDecrease) internal {
        unchecked {
            uint256 currentAllowance = token.allowance(address(this), spender);
            if (currentAllowance < requestedDecrease) {
                revert SafeERC20FailedDecreaseAllowance(spender, currentAllowance, requestedDecrease);
            }
            forceApprove(token, spender, currentAllowance - requestedDecrease);
        }
    }

    function forceApprove(IERC20 token, address spender, uint256 value) internal {
        bytes memory approvalCall = abi.encodeCall(token.approve, (spender, value));

        if (!_callOptionalReturnBool(token, approvalCall)) {
            _callOptionalReturn(token, abi.encodeCall(token.approve, (spender, 0)));
            _callOptionalReturn(token, approvalCall);
        }
    }

    function transferAndCallRelaxed(IERC1363 token, address to, uint256 value, bytes memory data) internal {
        if (to.code.length == 0) {
            safeTransfer(token, to, value);
        } else if (!token.transferAndCall(to, value, data)) {
            revert SafeERC20FailedOperation(address(token));
        }
    }

    function transferFromAndCallRelaxed(
        IERC1363 token,
        address from,
        address to,
        uint256 value,
        bytes memory data
    ) internal {
        if (to.code.length == 0) {
            safeTransferFrom(token, from, to, value);
        } else if (!token.transferFromAndCall(from, to, value, data)) {
            revert SafeERC20FailedOperation(address(token));
        }
    }

    function approveAndCallRelaxed(IERC1363 token, address to, uint256 value, bytes memory data) internal {
        if (to.code.length == 0) {
            forceApprove(token, to, value);
        } else if (!token.approveAndCall(to, value, data)) {
            revert SafeERC20FailedOperation(address(token));
        }
    }

    function _callOptionalReturn(IERC20 token, bytes memory data) private {
        uint256 returnSize;
        uint256 returnValue;
        assembly ("memory-safe") {
            let success := call(gas(), token, 0, add(data, 0x20), mload(data), 0, 0x20)
            if iszero(success) {
                let ptr := mload(0x40)
                returndatacopy(ptr, 0, returndatasize())
                revert(ptr, returndatasize())
            }
            returnSize := returndatasize()
            returnValue := mload(0)
        }

        if (returnSize == 0 ? address(token).code.length == 0 : returnValue != 1) {
            revert SafeERC20FailedOperation(address(token));
        }
    }

    function _callOptionalReturnBool(IERC20 token, bytes memory data) private returns (bool) {
        bool success;
        uint256 returnSize;
        uint256 returnValue;
        assembly ("memory-safe") {
            success := call(gas(), token, 0, add(data, 0x20), mload(data), 0, 0x20)
            returnSize := returndatasize()
            returnValue := mload(0)
        }
        return success && (returnSize == 0 ? address(token).code.length > 0 : returnValue == 1);
    }
}

// ============================================================================
// ClawStake — Prediction market staking for Clawdict
// ============================================================================

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

    function stake(
        string calldata marketSlug,
        bool isYes,
        uint256 amount
    ) external nonReentrant {
        if (amount < MIN_STAKE) revert StakeTooSmall();

        bytes32 key = keccak256(abi.encodePacked(marketSlug));

        if (!markets[key].exists) {
            markets[key].exists = true;
            marketKeys.push(key);
            slugOf[key] = marketSlug;
            emit MarketCreated(marketSlug, key);
        }

        Market storage market = markets[key];
        if (market.resolved) revert MarketAlreadyResolved();

        usdc.safeTransferFrom(msg.sender, address(this), amount);

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

        uint256 payout = (userStake * totalPool) / winningPool;

        s.claimed = true;

        usdc.safeTransfer(msg.sender, payout);

        emit Claimed(marketSlug, msg.sender, payout);
    }

    // --- View Functions ---

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

    function marketCount() external view returns (uint256) {
        return marketKeys.length;
    }

    function getMarketByIndex(
        uint256 index
    ) external view returns (bytes32 key, string memory slug) {
        key = marketKeys[index];
        slug = slugOf[key];
    }

    // --- Admin ---

    function emergencyWithdraw(
        address token,
        uint256 amount
    ) external onlyOwner {
        IERC20(token).safeTransfer(owner(), amount);
    }
}
