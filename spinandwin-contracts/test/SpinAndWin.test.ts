import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SpinAndWin } from '../typechain-types';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';

// ─── Wheel config (must match SpinAndWin.sol) ─────────────────────────────────
//   index | label   | multiplier_bps
//   0     | LOSE    | 0
//   1     | LOSE    | 0
//   2     | 1.2x    | 12000
//   3     | 1.5x    | 15000
//   4     | LOSE    | 0
//   5     | 2x      | 20000
//   6     | 1.2x    | 12000
//   7     | 3x      | 30000
//   8     | 2x      | 20000
//   9     | 5x      | 50000
//   10    | 10x     | 100000
//   11    | JACKPOT | 500000

const BPS_BASE = 10_000n;

function expectedPayout(wagerWei: bigint, multiplierBps: bigint): bigint {
  return (wagerWei * multiplierBps) / BPS_BASE;
}

// Dummy provably-fair fields (content doesn't matter for contract logic)
const SEED_HASH  = ethers.keccak256(ethers.toUtf8Bytes('serverSeed'));
const CLIENT_SEED = ethers.keccak256(ethers.toUtf8Bytes('clientSeed'));
const NONCE = 1n;

describe('SpinAndWin', () => {
  let contract: SpinAndWin;
  let owner: HardhatEthersSigner;
  let player: HardhatEthersSigner;
  let other: HardhatEthersSigner;

  const INITIAL_POOL = ethers.parseEther('10'); // 10 MATIC
  const ONE_MATIC    = ethers.parseEther('1');

  beforeEach(async () => {
    [owner, player, other] = await ethers.getSigners();

    const Factory = await ethers.getContractFactory('SpinAndWin');
    contract = (await Factory.deploy()) as SpinAndWin;

    // Fund the prize pool via receive()
    await owner.sendTransaction({ to: await contract.getAddress(), value: INITIAL_POOL });
  });

  // ─── Deployment ─────────────────────────────────────────────────────────────

  describe('deployment', () => {
    it('sets the deployer as owner', async () => {
      expect(await contract.owner()).to.equal(owner.address);
    });

    it('is not paused', async () => {
      expect(await contract.paused()).to.be.false;
    });

    it('records the initial prize pool from receive()', async () => {
      expect(await contract.prizePool()).to.equal(INITIAL_POOL);
    });

    it('emits PrizePoolDeposit when receiving ETH', async () => {
      await expect(
        owner.sendTransaction({ to: await contract.getAddress(), value: ONE_MATIC }),
      ).to.emit(contract, 'PrizePoolDeposit').withArgs(owner.address, ONE_MATIC);
    });
  });

  // ─── spin() — losing outcomes ───────────────────────────────────────────────

  describe('spin() — lose (multiplier 0)', () => {
    it('records stats without paying out', async () => {
      await contract.spin(player.address, ONE_MATIC, 0, SEED_HASH, CLIENT_SEED, NONCE);

      const [totalSpins, totalWagered, totalWon] = await contract.getPlayerStats(player.address);
      expect(totalSpins).to.equal(1n);
      expect(totalWagered).to.equal(ONE_MATIC);
      expect(totalWon).to.equal(0n);
    });

    it('does not reduce the prize pool on a loss', async () => {
      const poolBefore = await contract.prizePool();
      await contract.spin(player.address, ONE_MATIC, 0, SEED_HASH, CLIENT_SEED, NONCE);
      expect(await contract.prizePool()).to.equal(poolBefore);
    });

    it('emits SpinRecorded with payoutWei = 0', async () => {
      await expect(
        contract.spin(player.address, ONE_MATIC, 0, SEED_HASH, CLIENT_SEED, NONCE),
      )
        .to.emit(contract, 'SpinRecorded')
        .withArgs(player.address, 0n, ONE_MATIC, 0n, SEED_HASH, NONCE, (await ethers.provider.getBlock('latest'))!.timestamp + 1);
    });
  });

  // ─── spin() — winning outcomes ──────────────────────────────────────────────

  describe('spin() — win (1.2x, index 2)', () => {
    const MULTIPLIER_BPS = 12_000n;

    it('pays the player correctly', async () => {
      const payout = expectedPayout(ONE_MATIC, MULTIPLIER_BPS);
      await expect(
        contract.spin(player.address, ONE_MATIC, 2, SEED_HASH, CLIENT_SEED, NONCE),
      ).to.changeEtherBalance(player, payout);
    });

    it('reduces the prize pool by payout', async () => {
      const payout = expectedPayout(ONE_MATIC, MULTIPLIER_BPS);
      const poolBefore = await contract.prizePool();
      await contract.spin(player.address, ONE_MATIC, 2, SEED_HASH, CLIENT_SEED, NONCE);
      expect(await contract.prizePool()).to.equal(poolBefore - payout);
    });

    it('updates totalWonWei in player stats', async () => {
      const payout = expectedPayout(ONE_MATIC, MULTIPLIER_BPS);
      await contract.spin(player.address, ONE_MATIC, 2, SEED_HASH, CLIENT_SEED, NONCE);
      const [, , totalWon] = await contract.getPlayerStats(player.address);
      expect(totalWon).to.equal(payout);
    });
  });

  describe('spin() — win (2x, index 5)', () => {
    const MULTIPLIER_BPS = 20_000n;

    it('pays 2x the wager', async () => {
      const payout = expectedPayout(ONE_MATIC, MULTIPLIER_BPS);
      await expect(
        contract.spin(player.address, ONE_MATIC, 5, SEED_HASH, CLIENT_SEED, NONCE),
      ).to.changeEtherBalance(player, payout);
    });
  });

  describe('spin() — win (10x, index 10)', () => {
    const MULTIPLIER_BPS = 100_000n;

    it('pays 10x the wager', async () => {
      const payout = expectedPayout(ONE_MATIC, MULTIPLIER_BPS);
      await expect(
        contract.spin(player.address, ONE_MATIC, 10, SEED_HASH, CLIENT_SEED, NONCE),
      ).to.changeEtherBalance(player, payout);
    });
  });

  describe('spin() — JACKPOT (50x, index 11)', () => {
    const JACKPOT_BPS = 500_000n;

    beforeEach(async () => {
      // Ensure pool is large enough for a 50x payout on 1 MATIC
      await owner.sendTransaction({ to: await contract.getAddress(), value: ethers.parseEther('100') });
    });

    it('pays 50x the wager', async () => {
      const payout = expectedPayout(ONE_MATIC, JACKPOT_BPS);
      await expect(
        contract.spin(player.address, ONE_MATIC, 11, SEED_HASH, CLIENT_SEED, NONCE),
      ).to.changeEtherBalance(player, payout);
    });

    it('emits JackpotWon event', async () => {
      const payout = expectedPayout(ONE_MATIC, JACKPOT_BPS);
      await expect(
        contract.spin(player.address, ONE_MATIC, 11, SEED_HASH, CLIENT_SEED, NONCE),
      ).to.emit(contract, 'JackpotWon').withArgs(player.address, payout, (await ethers.provider.getBlock('latest'))!.timestamp + 1);
    });
  });

  // ─── spin() — accumulates stats across multiple spins ───────────────────────

  describe('spin() — cumulative stats', () => {
    it('tracks multiple spins for the same player', async () => {
      await contract.spin(player.address, ONE_MATIC, 0, SEED_HASH, CLIENT_SEED, 1n); // loss
      await contract.spin(player.address, ONE_MATIC, 2, SEED_HASH, CLIENT_SEED, 2n); // 1.2x win

      const [totalSpins, totalWagered] = await contract.getPlayerStats(player.address);
      expect(totalSpins).to.equal(2n);
      expect(totalWagered).to.equal(ONE_MATIC * 2n);
    });
  });

  // ─── spin() — revert cases ──────────────────────────────────────────────────

  describe('spin() — reverts', () => {
    it('reverts when called by non-owner', async () => {
      await expect(
        contract.connect(other).spin(player.address, ONE_MATIC, 0, SEED_HASH, CLIENT_SEED, NONCE),
      ).to.be.revertedWithCustomError(contract, 'NotOwner');
    });

    it('reverts when paused', async () => {
      await contract.pause();
      await expect(
        contract.spin(player.address, ONE_MATIC, 0, SEED_HASH, CLIENT_SEED, NONCE),
      ).to.be.revertedWithCustomError(contract, 'ContractPaused');
    });

    it('reverts on zero player address', async () => {
      await expect(
        contract.spin(ethers.ZeroAddress, ONE_MATIC, 0, SEED_HASH, CLIENT_SEED, NONCE),
      ).to.be.revertedWithCustomError(contract, 'ZeroAddress');
    });

    it('reverts on zero wager', async () => {
      await expect(
        contract.spin(player.address, 0n, 0, SEED_HASH, CLIENT_SEED, NONCE),
      ).to.be.revertedWithCustomError(contract, 'InvalidWager');
    });

    it('reverts on out-of-range outcome index (>= 12)', async () => {
      await expect(
        contract.spin(player.address, ONE_MATIC, 12, SEED_HASH, CLIENT_SEED, NONCE),
      ).to.be.revertedWithCustomError(contract, 'InvalidOutcomeIndex');
    });

    it('reverts when prize pool has insufficient funds for payout', async () => {
      // Withdraw all funds so pool is empty
      const pool = await contract.prizePool();
      await contract.withdrawPrizePool(pool);

      await expect(
        contract.spin(player.address, ONE_MATIC, 2, SEED_HASH, CLIENT_SEED, NONCE), // 1.2x win
      ).to.be.revertedWithCustomError(contract, 'InsufficientPrizePool');
    });
  });

  // ─── depositPrizePool() ─────────────────────────────────────────────────────

  describe('depositPrizePool()', () => {
    it('increases prizePool by the deposited amount', async () => {
      const before = await contract.prizePool();
      await contract.depositPrizePool({ value: ONE_MATIC });
      expect(await contract.prizePool()).to.equal(before + ONE_MATIC);
    });

    it('emits PrizePoolDeposit', async () => {
      await expect(
        contract.depositPrizePool({ value: ONE_MATIC }),
      ).to.emit(contract, 'PrizePoolDeposit').withArgs(owner.address, ONE_MATIC);
    });

    it('reverts when called by non-owner', async () => {
      await expect(
        contract.connect(other).depositPrizePool({ value: ONE_MATIC }),
      ).to.be.revertedWithCustomError(contract, 'NotOwner');
    });
  });

  // ─── withdrawPrizePool() ────────────────────────────────────────────────────

  describe('withdrawPrizePool()', () => {
    it('sends MATIC to owner and reduces prizePool', async () => {
      const amount = ONE_MATIC;
      await expect(
        contract.withdrawPrizePool(amount),
      ).to.changeEtherBalance(owner, amount);
      expect(await contract.prizePool()).to.equal(INITIAL_POOL - amount);
    });

    it('emits PrizePoolWithdrawal', async () => {
      await expect(
        contract.withdrawPrizePool(ONE_MATIC),
      ).to.emit(contract, 'PrizePoolWithdrawal').withArgs(owner.address, ONE_MATIC);
    });

    it('reverts when withdrawal exceeds prizePool', async () => {
      const tooMuch = INITIAL_POOL + ONE_MATIC;
      await expect(
        contract.withdrawPrizePool(tooMuch),
      ).to.be.revertedWithCustomError(contract, 'InsufficientPrizePool');
    });

    it('reverts when called by non-owner', async () => {
      await expect(
        contract.connect(other).withdrawPrizePool(ONE_MATIC),
      ).to.be.revertedWithCustomError(contract, 'NotOwner');
    });
  });

  // ─── pause() / unpause() ────────────────────────────────────────────────────

  describe('pause() / unpause()', () => {
    it('owner can pause and unpause', async () => {
      await contract.pause();
      expect(await contract.paused()).to.be.true;

      await contract.unpause();
      expect(await contract.paused()).to.be.false;
    });

    it('emits Paused / Unpaused events', async () => {
      await expect(contract.pause()).to.emit(contract, 'Paused').withArgs(owner.address);
      await expect(contract.unpause()).to.emit(contract, 'Unpaused').withArgs(owner.address);
    });

    it('non-owner cannot pause', async () => {
      await expect(
        contract.connect(other).pause(),
      ).to.be.revertedWithCustomError(contract, 'NotOwner');
    });

    it('non-owner cannot unpause', async () => {
      await contract.pause();
      await expect(
        contract.connect(other).unpause(),
      ).to.be.revertedWithCustomError(contract, 'NotOwner');
    });

    it('spins are allowed again after unpause', async () => {
      await contract.pause();
      await contract.unpause();
      await expect(
        contract.spin(player.address, ONE_MATIC, 0, SEED_HASH, CLIENT_SEED, NONCE),
      ).to.not.be.reverted;
    });
  });

  // ─── transferOwnership() ────────────────────────────────────────────────────

  describe('transferOwnership()', () => {
    it('transfers owner to a new address', async () => {
      await contract.transferOwnership(other.address);
      expect(await contract.owner()).to.equal(other.address);
    });

    it('emits OwnershipTransferred', async () => {
      await expect(
        contract.transferOwnership(other.address),
      ).to.emit(contract, 'OwnershipTransferred').withArgs(owner.address, other.address);
    });

    it('reverts on zero address', async () => {
      await expect(
        contract.transferOwnership(ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(contract, 'ZeroAddress');
    });

    it('reverts when called by non-owner', async () => {
      await expect(
        contract.connect(other).transferOwnership(other.address),
      ).to.be.revertedWithCustomError(contract, 'NotOwner');
    });

    it('new owner can call spin; old owner cannot', async () => {
      await contract.transferOwnership(other.address);

      // New owner succeeds
      await expect(
        contract.connect(other).spin(player.address, ONE_MATIC, 0, SEED_HASH, CLIENT_SEED, NONCE),
      ).to.not.be.reverted;

      // Old owner is rejected
      await expect(
        contract.spin(player.address, ONE_MATIC, 0, SEED_HASH, CLIENT_SEED, NONCE),
      ).to.be.revertedWithCustomError(contract, 'NotOwner');
    });
  });

  // ─── View helpers ────────────────────────────────────────────────────────────

  describe('getMultiplierBps()', () => {
    it('returns 0 for lose segments', async () => {
      expect(await contract.getMultiplierBps(0)).to.equal(0n);
      expect(await contract.getMultiplierBps(1)).to.equal(0n);
      expect(await contract.getMultiplierBps(4)).to.equal(0n);
    });

    it('returns correct BPS for win segments', async () => {
      expect(await contract.getMultiplierBps(2)).to.equal(12_000n);   // 1.2x
      expect(await contract.getMultiplierBps(5)).to.equal(20_000n);   // 2x
      expect(await contract.getMultiplierBps(9)).to.equal(50_000n);   // 5x
      expect(await contract.getMultiplierBps(10)).to.equal(100_000n); // 10x
      expect(await contract.getMultiplierBps(11)).to.equal(500_000n); // 50x JACKPOT
    });

    it('reverts for out-of-range index', async () => {
      await expect(
        contract.getMultiplierBps(12),
      ).to.be.revertedWithCustomError(contract, 'InvalidOutcomeIndex');
    });
  });

  describe('getContractBalance()', () => {
    it('returns the current ETH balance', async () => {
      const bal = await contract.getContractBalance();
      expect(bal).to.equal(await ethers.provider.getBalance(await contract.getAddress()));
    });
  });
});
