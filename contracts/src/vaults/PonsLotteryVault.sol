// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/token/ERC20/utils/SafeERC20.sol";
import {Strings} from "@openzeppelin/utils/Strings.sol";

import {PonsAddresses} from "../PonsAddresses.sol";
import {PonsVaultBase} from "./PonsVaultBase.sol";

/// @title PonsLotteryVault
/// @notice Fee raffle: creator LP fees fund a pot; holders opt in; a commit–reveal draw pays one winner.
///
/// @dev Why not draw inside {run}: {run} is permissionless, so a caller who could see the outcome
///      before broadcasting would only send when they win. There is no VRF on this chain. The
///      operator therefore commits to a secret while entries are closed, waits {Config-revealDelay},
///      then reveals — the wait is what stops them picking a seed that lands on themselves after
///      seeing the entrant list.
///
///      Entry is opt-in on purpose. Auto-including every holder needs a snapshot the size of the
///      RWA path; for a raffle, "connect and enter" is the product people expect and keeps the
///      draw O(1) on-chain.
contract PonsLotteryVault is PonsVaultBase {
    using SafeERC20 for IERC20;

    error NotOperator(address caller, address operator);
    error RoundActive(uint256 roundId);
    error NoActiveRound();
    error EntryClosed();
    error EntryStillOpen(uint256 endsAt);
    error AlreadyEntered(address account);
    error NotAHolder();
    error WrongPhase();
    error RevealTooEarly(uint256 revealAfter);
    error BadReveal();
    error NoEntrants();
    error InvalidPeriod();

    event OperatorChanged(address indexed from, address indexed to);
    event Configured(uint256 minHarvestWei, uint32 entryPeriod, uint32 revealDelay);
    event RoundOpened(uint256 indexed roundId, uint256 prizeWeth, uint64 entryEndsAt);
    event Entered(uint256 indexed roundId, address indexed account);
    event Committed(uint256 indexed roundId, bytes32 commitment, uint64 revealAfter);
    event Drawn(uint256 indexed roundId, address indexed winner, uint256 prizeWeth, uint256 entrants);
    event RoundCancelled(uint256 indexed roundId, uint256 prizeWeth);

    /// @param minHarvestWei Floor on idle WETH before {run} opens a round.
    /// @param entryPeriod Seconds holders may call {enter} after a round opens.
    /// @param revealDelay Seconds the operator must wait between {commit} and {reveal}.
    struct Config {
        uint256 minHarvestWei;
        uint32 entryPeriod;
        uint32 revealDelay;
    }

    enum Phase {
        None,
        Entering,
        Committed,
        Drawn,
        Cancelled
    }

    struct Round {
        uint128 prizeWeth;
        uint64 entryEndsAt;
        uint64 revealAfter;
        bytes32 commitment;
        address winner;
        Phase phase;
    }

    Config public config;

    /// @notice Key allowed to commit and reveal. Set by the factory, not the creator.
    address public operator;

    /// @notice Rounds opened so far. The current one is always `roundCount - 1` while active.
    uint256 public roundCount;

    /// @notice Lifetime WETH paid to winners.
    uint256 public totalPrizePaid;

    mapping(uint256 roundId => Round) private _rounds;
    mapping(uint256 roundId => address[]) private _entrants;
    mapping(uint256 roundId => mapping(address => bool)) private _entered;

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _token,
        address _locker,
        address _collector,
        address _operator,
        Config calldata _config
    ) external initializer {
        __PonsVaultBase_init(_token, _locker, _collector);
        if (_operator == address(0)) revert ZeroAddress();
        _validate(_config);
        config = _config;
        operator = _operator;
        emit Configured(_config.minHarvestWei, _config.entryPeriod, _config.revealDelay);
        emit OperatorChanged(address(0), _operator);
    }

    function template() external pure override returns (string memory) {
        return "lottery";
    }

    function description() external view override returns (string memory) {
        if (roundCount == 0) return "Lottery vault - waiting for the first pot.";
        Round storage current = _rounds[roundCount - 1];
        if (current.phase == Phase.Entering) {
            return string.concat("Lottery round open - enter before ", Strings.toString(current.entryEndsAt));
        }
        if (current.phase == Phase.Committed) return "Lottery draw committed - waiting to reveal.";
        return "Lottery vault - waiting for the next pot.";
    }

    function setOperator(address next) external {
        if (msg.sender != operator) revert NotOperator(msg.sender, operator);
        if (next == address(0)) revert ZeroAddress();
        emit OperatorChanged(operator, next);
        operator = next;
    }

    /// @notice Harvest fees, burn the token side, and open a raffle over the WETH pot.
    /// @dev Permissionless. Refuses while a round is still Entering or Committed so a new pot
    ///      cannot bury an unfinished draw.
    function run() external nonReentrant returns (uint256 roundId, uint256 prizeWeth) {
        if (roundCount != 0) {
            Phase phase = _rounds[roundCount - 1].phase;
            if (phase == Phase.Entering || phase == Phase.Committed) revert RoundActive(roundCount - 1);
        }

        Config memory cfg = config;
        _harvest();
        _burnAllTokens();

        (uint256 wethBalance,) = idleBalances();
        // Prize is whatever is idle: prior cancelled pots fold back in automatically.
        if (wethBalance < cfg.minHarvestWei || wethBalance == 0) revert NothingToHarvest();

        // forge-lint: disable-next-line(block-timestamp)
        uint64 entryEndsAt = uint64(block.timestamp + cfg.entryPeriod);

        roundId = roundCount++;
        prizeWeth = wethBalance;
        _rounds[roundId] = Round({
            prizeWeth: uint128(prizeWeth),
            entryEndsAt: entryEndsAt,
            revealAfter: 0,
            commitment: bytes32(0),
            winner: address(0),
            phase: Phase.Entering
        });

        lastRunAt = block.timestamp;
        runCount += 1;

        emit RoundOpened(roundId, prizeWeth, entryEndsAt);
    }

    /// @notice Opt into the open round. One ticket per wallet; must hold the token now.
    function enter() external nonReentrant {
        if (roundCount == 0) revert NoActiveRound();
        uint256 roundId = roundCount - 1;
        Round storage round = _rounds[roundId];
        if (round.phase != Phase.Entering) revert WrongPhase();
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp >= round.entryEndsAt) revert EntryClosed();
        if (_entered[roundId][msg.sender]) revert AlreadyEntered(msg.sender);
        if (IERC20(token).balanceOf(msg.sender) == 0) revert NotAHolder();

        _entered[roundId][msg.sender] = true;
        _entrants[roundId].push(msg.sender);
        emit Entered(roundId, msg.sender);
    }

    /// @notice Lock the entrant list behind a commitment. Callable once entry has closed.
    /// @dev `commitment` must be `keccak256(abi.encodePacked(secret, roundId, address(this)))`.
    function commit(bytes32 commitment) external nonReentrant {
        if (msg.sender != operator) revert NotOperator(msg.sender, operator);
        if (roundCount == 0) revert NoActiveRound();
        uint256 roundId = roundCount - 1;
        Round storage round = _rounds[roundId];
        if (round.phase != Phase.Entering) revert WrongPhase();
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < round.entryEndsAt) revert EntryStillOpen(round.entryEndsAt);

        uint256 entrants = _entrants[roundId].length;
        if (entrants == 0) {
            // Nobody showed up — put the pot back for the next run rather than locking it forever.
            round.phase = Phase.Cancelled;
            emit RoundCancelled(roundId, round.prizeWeth);
            return;
        }

        // forge-lint: disable-next-line(block-timestamp)
        uint64 revealAfter = uint64(block.timestamp + config.revealDelay);
        round.commitment = commitment;
        round.revealAfter = revealAfter;
        round.phase = Phase.Committed;
        emit Committed(roundId, commitment, revealAfter);
    }

    /// @notice Open the commitment and pay the winner.
    function reveal(uint256 secret) external nonReentrant {
        if (msg.sender != operator) revert NotOperator(msg.sender, operator);
        if (roundCount == 0) revert NoActiveRound();
        uint256 roundId = roundCount - 1;
        Round storage round = _rounds[roundId];
        if (round.phase != Phase.Committed) revert WrongPhase();
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < round.revealAfter) revert RevealTooEarly(round.revealAfter);

        bytes32 expected = keccak256(abi.encodePacked(secret, roundId, address(this)));
        if (expected != round.commitment) revert BadReveal();

        address[] storage entrants = _entrants[roundId];
        uint256 n = entrants.length;
        if (n == 0) revert NoEntrants();

        uint256 index = uint256(keccak256(abi.encodePacked(secret, roundId, address(this), "draw"))) % n;
        address winner = entrants[index];
        uint256 prize = round.prizeWeth;

        round.winner = winner;
        round.phase = Phase.Drawn;
        totalPrizePaid += prize;

        IERC20(PonsAddresses.WETH).safeTransfer(winner, prize);
        emit Drawn(roundId, winner, prize, n);
    }

    function canRun() external view returns (bool ready, string memory reason) {
        if (roundCount != 0) {
            Phase phase = _rounds[roundCount - 1].phase;
            if (phase == Phase.Entering) return (false, "Round is open for entries");
            if (phase == Phase.Committed) return (false, "Round is waiting to be revealed");
        }
        (uint256 wethBalance,) = idleBalances();
        if (wethBalance < config.minHarvestWei || wethBalance == 0) {
            return (false, "Insufficient accrued fees (harvest may still be pending in the locker)");
        }
        return (true, "");
    }

    function rounds(uint256 roundId) external view returns (Round memory) {
        return _rounds[roundId];
    }

    function entrantCount(uint256 roundId) external view returns (uint256) {
        return _entrants[roundId].length;
    }

    function entrantAt(uint256 roundId, uint256 index) external view returns (address) {
        return _entrants[roundId][index];
    }

    function hasEntered(uint256 roundId, address account) external view returns (bool) {
        return _entered[roundId][account];
    }

    function _validate(Config calldata cfg) private pure {
        if (cfg.entryPeriod == 0 || cfg.revealDelay == 0) revert InvalidPeriod();
        // Cap periods so a mis-set vault cannot lock fees for years.
        if (cfg.entryPeriod > 30 days || cfg.revealDelay > 7 days) revert InvalidPeriod();
    }

    uint256[42] private __gap;
}
