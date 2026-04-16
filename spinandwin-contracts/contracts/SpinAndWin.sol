// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title SpinAndWin
 * @notice Provably fair spin wheel game on Polygon.
 *         The backend (owner) resolves outcomes off-chain using HMAC-SHA256
 *         and calls spin() to record results and pay out winners on-chain.
 * @dev    Deployed on Polygon Amoy testnet → Polygon mainnet.
 */
contract SpinAndWin {

    // ─── State ────────────────────────────────────────────────────────────────

    address public owner;
    uint256 public prizePool;
    bool    public paused;

    struct PlayerStats {
        uint256 totalSpins;
        uint256 totalWageredWei;
        uint256 totalWonWei;
    }

    mapping(address => PlayerStats) public playerStats;

    // ─── Events ───────────────────────────────────────────────────────────────

    event SpinRecorded(
        address indexed player,
        uint256 outcomeIndex,
        uint256 wagerWei,
        uint256 payoutWei,
        bytes32 serverSeedHash,
        uint256 nonce,
        uint256 timestamp
    );

    event JackpotWon(
        address indexed player,
        uint256 payoutWei,
        uint256 timestamp
    );

    event PrizePoolDeposit(address indexed from, uint256 amount);
    event PrizePoolWithdrawal(address indexed to, uint256 amount);
    event OwnershipTransferred(address indexed previous, address indexed newOwner);
    event Paused(address indexed by);
    event Unpaused(address indexed by);

    // ─── Errors ───────────────────────────────────────────────────────────────

    error NotOwner();
    error ContractPaused();
    error InsufficientPrizePool(uint256 required, uint256 available);
    error InvalidOutcomeIndex(uint256 index);
    error InvalidWager();
    error PayoutFailed(address player, uint256 amount);
    error ZeroAddress();

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert ContractPaused();
        _;
    }

    // ─── Wheel config (must match backend WHEEL array) ────────────────────────
    // Multipliers stored as basis points (10000 = 1x, 20000 = 2x, etc.)

    uint256 private constant SEGMENTS = 12;
    uint256[12] private MULTIPLIER_BPS = [
        0,       // 0  LOSE
        0,       // 1  LOSE
        12000,   // 2  1.2x
        15000,   // 3  1.5x
        0,       // 4  LOSE
        20000,   // 5  2x
        12000,   // 6  1.2x
        30000,   // 7  3x
        20000,   // 8  2x
        50000,   // 9  5x
        100000,  // 10 10x
        500000   // 11 JACKPOT 50x
    ];

    uint256 private constant JACKPOT_INDEX = 11;

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor() {
        owner = msg.sender;
    }

    // ─── Receive ETH/MATIC ────────────────────────────────────────────────────

    receive() external payable {
        prizePool += msg.value;
        emit PrizePoolDeposit(msg.sender, msg.value);
    }

    // ─── Core function ────────────────────────────────────────────────────────

    /**
     * @notice Record a spin result and pay out the winner.
     * @dev    Called by the backend (owner) after resolving the outcome off-chain.
     *         The serverSeedHash was committed to before the spin — clients can
     *         verify fairness once the raw serverSeed is revealed after the session.
     *
     * @param player         The player's wallet address
     * @param wagerWei       Wager amount in wei (for record-keeping)
     * @param outcomeIndex   Wheel segment index (0–11)
     * @param serverSeedHash HMAC-SHA256 hash of the server seed (provably fair)
     * @param clientSeed     Client-provided seed (provably fair)
     * @param nonce          Spin count for this session
     */
    function spin(
        address  player,
        uint256  wagerWei,
        uint256  outcomeIndex,
        bytes32  serverSeedHash,
        bytes32  clientSeed,
        uint256  nonce
    ) external onlyOwner whenNotPaused returns (uint256 payoutWei) {
        if (player == address(0))         revert ZeroAddress();
        if (wagerWei == 0)                revert InvalidWager();
        if (outcomeIndex >= SEGMENTS)     revert InvalidOutcomeIndex(outcomeIndex);

        // Calculate payout
        payoutWei = (wagerWei * MULTIPLIER_BPS[outcomeIndex]) / 10000;

        if (payoutWei > 0) {
            if (prizePool < payoutWei) {
                revert InsufficientPrizePool(payoutWei, prizePool);
            }
            prizePool -= payoutWei;

            // Transfer payout to player
            (bool success, ) = payable(player).call{ value: payoutWei }("");
            if (!success) revert PayoutFailed(player, payoutWei);

            playerStats[player].totalWonWei += payoutWei;
        }

        // Update stats
        playerStats[player].totalSpins       += 1;
        playerStats[player].totalWageredWei  += wagerWei;

        emit SpinRecorded(
            player,
            outcomeIndex,
            wagerWei,
            payoutWei,
            serverSeedHash,
            nonce,
            block.timestamp
        );

        if (outcomeIndex == JACKPOT_INDEX && payoutWei > 0) {
            emit JackpotWon(player, payoutWei, block.timestamp);
        }

        return payoutWei;
    }

    // ─── Prize pool management ────────────────────────────────────────────────

    /**
     * @notice Deposit MATIC into the prize pool (owner only).
     */
    function depositPrizePool() external payable onlyOwner {
        prizePool += msg.value;
        emit PrizePoolDeposit(msg.sender, msg.value);
    }

    /**
     * @notice Withdraw MATIC from the prize pool (owner only).
     */
    function withdrawPrizePool(uint256 amount) external onlyOwner {
        if (amount > prizePool) revert InsufficientPrizePool(amount, prizePool);
        prizePool -= amount;
        (bool success, ) = payable(owner).call{ value: amount }("");
        if (!success) revert PayoutFailed(owner, amount);
        emit PrizePoolWithdrawal(owner, amount);
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getPlayerStats(address player)
        external
        view
        returns (uint256 totalSpins, uint256 totalWageredWei, uint256 totalWonWei)
    {
        PlayerStats memory s = playerStats[player];
        return (s.totalSpins, s.totalWageredWei, s.totalWonWei);
    }

    function getMultiplierBps(uint256 outcomeIndex)
        external
        view
        returns (uint256)
    {
        if (outcomeIndex >= SEGMENTS) revert InvalidOutcomeIndex(outcomeIndex);
        return MULTIPLIER_BPS[outcomeIndex];
    }

    function getContractBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
