import { ethers } from 'ethers';

// ─── ABI (minimal — only functions we call) ────────────────────────────────
const CONTRACT_ABI = [
  'function spin(address player, uint256 wagerWei, uint256 outcomeIndex, bytes32 serverSeedHash, bytes32 clientSeed, uint256 nonce) external returns (uint256 payoutWei)',
  'function depositPrizePool() external payable',
  'function prizePool() external view returns (uint256)',
  'function getPlayerStats(address player) external view returns (uint256 totalSpins, uint256 totalWagered, uint256 totalWon)',
  'event SpinResult(address indexed player, uint256 outcomeIndex, uint256 wagerWei, uint256 payoutWei, bytes32 serverSeedHash)',
  'event JackpotWon(address indexed player, uint256 payoutWei)',
];

// ─── Provider + Wallet singleton ───────────────────────────────────────────

let _provider: ethers.JsonRpcProvider | null = null;
let _wallet: ethers.Wallet | null = null;
let _contract: ethers.Contract | null = null;

function getProvider(): ethers.JsonRpcProvider {
  if (!_provider) {
    const apiKey = process.env.ALCHEMY_API_KEY;
    const network = process.env.NODE_ENV === 'production'
      ? `polygon-mainnet`
      : `polygon-amoy`;

    if (!apiKey) throw new Error('[blockchain] ALCHEMY_API_KEY not set');

    const rpcUrl = process.env.NODE_ENV === 'production'
      ? `https://polygon-mainnet.g.alchemy.com/v2/${apiKey}`
      : `https://polygon-amoy.g.alchemy.com/v2/${apiKey}`;

    _provider = new ethers.JsonRpcProvider(rpcUrl, undefined, {
      staticNetwork: true,        // Avoids extra eth_chainId calls
      batchMaxCount: 10,
    });

    console.log(`[blockchain] Provider: ${network}`);
  }
  return _provider;
}

function getWallet(): ethers.Wallet {
  if (!_wallet) {
    const privateKey = process.env.POLYGON_PRIVATE_KEY;
    if (!privateKey) throw new Error('[blockchain] POLYGON_PRIVATE_KEY not set');
    _wallet = new ethers.Wallet(privateKey, getProvider());
  }
  return _wallet;
}

function getContract(): ethers.Contract {
  if (!_contract) {
    const address = process.env.POLYGON_CONTRACT_ADDRESS;
    if (!address) throw new Error('[blockchain] POLYGON_CONTRACT_ADDRESS not set');
    _contract = new ethers.Contract(address, CONTRACT_ABI, getWallet());
  }
  return _contract;
}

// ─── Chainlink MATIC/USD price feed ───────────────────────────────────────
// AggregatorV3Interface — only latestRoundData() needed.

const CHAINLINK_ABI = [
  'function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function decimals() external view returns (uint8)',
];

// Feed addresses (env var overrides for custom RPC setups)
const CHAINLINK_FEED_MAINNET =
  process.env.CHAINLINK_MATIC_USD_FEED ?? '0xAB594600376Ec9fD91F8e885dADF0CE036862dE';
const CHAINLINK_FEED_TESTNET =
  process.env.CHAINLINK_MATIC_USD_FEED_TESTNET ?? '0x001382149eBa3441043c1c66972b4772963f5D43';

// Fallback rate used when Chainlink is unavailable (e.g., local dev / testnet with no feed)
const FALLBACK_MATIC_USD_RATE = parseFloat(process.env.MATIC_USD_RATE ?? '0.85');

// 60-second in-memory cache to avoid hammering the RPC
let _cachedRate: number | null = null;
let _cacheExpiry = 0;
const CACHE_TTL_MS = 60_000;

/**
 * Fetch the current MATIC/USD rate from Chainlink.
 * Returns the cached value if it is still fresh, or falls back to the env rate
 * when Chainlink is unavailable (testnet / local dev).
 */
export async function getMATICPriceUSD(): Promise<number> {
  const now = Date.now();
  if (_cachedRate !== null && now < _cacheExpiry) return _cachedRate;

  try {
    const provider = getProvider();
    const feedAddress =
      process.env.NODE_ENV === 'production' ? CHAINLINK_FEED_MAINNET : CHAINLINK_FEED_TESTNET;

    const feed = new ethers.Contract(feedAddress, CHAINLINK_ABI, provider);

    const [decimals, roundData] = await Promise.all([
      feed.decimals() as Promise<bigint>,
      feed.latestRoundData() as Promise<{ answer: bigint }>,
    ]);

    // Chainlink answer has `decimals` places (typically 8 for USD pairs)
    const price = Number(roundData.answer) / 10 ** Number(decimals);

    if (price <= 0) throw new Error('Chainlink returned non-positive price');

    _cachedRate = price;
    _cacheExpiry = now + CACHE_TTL_MS;

    console.log(`[blockchain] MATIC/USD from Chainlink: $${price.toFixed(4)}`);
    return price;
  } catch (err) {
    console.warn('[blockchain] Chainlink price feed unavailable, using fallback rate:', err);
    return FALLBACK_MATIC_USD_RATE;
  }
}

export async function usdToWei(usd: number): Promise<bigint> {
  const rate = await getMATICPriceUSD();
  const matic = usd / rate;
  return ethers.parseEther(matic.toFixed(18));
}

export async function weiToUsd(wei: bigint): Promise<number> {
  const rate = await getMATICPriceUSD();
  const matic = parseFloat(ethers.formatEther(wei));
  return parseFloat((matic * rate).toFixed(2));
}

// ─── Blockchain service functions ──────────────────────────────────────────

export interface SpinTxResult {
  txHash: string;
  payoutWei: bigint;
  payoutUsd: number;
  blockNumber: number;
}

/**
 * Submit a spin result on-chain and wait for confirmation.
 * Called after the off-chain spin logic has already resolved the outcome.
 */
export async function submitSpinOnChain(params: {
  playerAddress: string;
  wagerUsd: number;
  outcomeIndex: number;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
}): Promise<SpinTxResult> {
  const contract = getContract();
  const wallet = getWallet();

  const wagerWei = await usdToWei(params.wagerUsd);
  const serverSeedHashBytes = ethers.hexlify(
    ethers.toUtf8Bytes(params.serverSeedHash),
  ).slice(0, 66).padEnd(66, '0') as `0x${string}`;
  const clientSeedBytes = ethers.hexlify(
    ethers.toUtf8Bytes(params.clientSeed),
  ).slice(0, 66).padEnd(66, '0') as `0x${string}`;

  // Estimate gas with 20% buffer
  const gasEstimate = await contract.spin.estimateGas(
    params.playerAddress,
    wagerWei,
    params.outcomeIndex,
    serverSeedHashBytes,
    clientSeedBytes,
    params.nonce,
  );

  const gasLimit = (gasEstimate * 120n) / 100n;

  // Get current gas price + apply 10% tip for faster inclusion
  const feeData = await wallet.provider!.getFeeData();
  const maxFeePerGas = feeData.maxFeePerGas
    ? (feeData.maxFeePerGas * 110n) / 100n
    : undefined;

  const tx: ethers.ContractTransactionResponse = await contract.spin(
    params.playerAddress,
    wagerWei,
    params.outcomeIndex,
    serverSeedHashBytes,
    clientSeedBytes,
    params.nonce,
    { gasLimit, maxFeePerGas },
  );

  // Wait for 2 confirmations on mainnet, 1 on testnet
  const confirmations = process.env.NODE_ENV === 'production' ? 2 : 1;
  const receipt = await tx.wait(confirmations);

  if (!receipt || receipt.status === 0) {
    throw new Error(`[blockchain] Spin transaction reverted: ${tx.hash}`);
  }

  // Parse SpinResult event to get actual payout
  const spinEvent = receipt.logs
    .map((log) => {
      try { return contract.interface.parseLog(log); } catch { return null; }
    })
    .find((e) => e?.name === 'SpinResult');

  const payoutWei: bigint = spinEvent?.args?.payoutWei ?? 0n;

  return {
    txHash: receipt.hash,
    payoutWei,
    payoutUsd: await weiToUsd(payoutWei),
    blockNumber: receipt.blockNumber,
  };
}

/**
 * Send MATIC payout directly to a player wallet (off-chain payout path).
 * Used for smaller payouts where on-chain spin contract isn't called.
 */
export async function sendPayout(
  toAddress: string,
  amountUsd: number,
  skipLimit = false,
): Promise<{ txHash: string; amountWei: bigint }> {
  const wallet = getWallet();
  const amountWei = await usdToWei(amountUsd);

  // Safety check — don't send more than $500 in one tx without manual review
  if (!skipLimit && amountUsd > 500) {
    throw new Error(`[blockchain] Payout of $${amountUsd} exceeds auto-limit of $500. Manual review required.`);
  }

  const feeData = await wallet.provider!.getFeeData();

  const tx = await wallet.sendTransaction({
    to: toAddress,
    value: amountWei,
    maxFeePerGas: feeData.maxFeePerGas ?? undefined,
  });

  const receipt = await tx.wait(1);
  if (!receipt || receipt.status === 0) {
    throw new Error(`[blockchain] Payout transaction reverted: ${tx.hash}`);
  }

  return { txHash: receipt.hash, amountWei };
}

/**
 * Verify an EIP-191 personal_sign message from WalletConnect.
 * Returns the signer address if valid, throws if invalid.
 */
export function verifyWalletSignature(
  message: string,
  signature: string,
): string {
  return ethers.verifyMessage(message, signature).toLowerCase();
}

/**
 * Get current MATIC balance of the hot wallet.
 */
export async function getHotWalletBalance(): Promise<{ wei: bigint; matic: string; usd: number }> {
  const wallet = getWallet();
  const [wei, rate] = await Promise.all([
    wallet.provider!.getBalance(wallet.address),
    getMATICPriceUSD(),
  ]);
  const matic = ethers.formatEther(wei);
  return {
    wei,
    matic,
    usd: parseFloat((parseFloat(matic) * rate).toFixed(2)),
  };
}

/**
 * Get the contract's prize pool balance.
 */
export async function getPrizePoolBalance(): Promise<{ wei: bigint; matic: string; usd: number }> {
  const contract = getContract();
  const [wei, rate] = await Promise.all([
    contract.prizePool() as Promise<bigint>,
    getMATICPriceUSD(),
  ]);
  const matic = ethers.formatEther(wei);
  return {
    wei,
    matic,
    usd: parseFloat((parseFloat(matic) * rate).toFixed(2)),
  };
}

/**
 * Verify the hot wallet has enough MATIC to cover a payout.
 */
export async function hasSufficientBalance(requiredUsd: number): Promise<boolean> {
  const { usd } = await getHotWalletBalance();
  return usd >= requiredUsd * 1.2; // 20% buffer for gas
}

// ─── Crypto deposit helpers ────────────────────────────────────────────────

/**
 * Derive a unique deposit address for a user using BIP-44 HD wallet.
 * The master mnemonic is stored in DEPOSIT_WALLET_MNEMONIC env var.
 * Each user gets a unique child address at m/44'/60'/0'/0/{index}.
 */
export function generateDepositAddress(index: number): string {
  const mnemonic = process.env.DEPOSIT_WALLET_MNEMONIC;
  if (!mnemonic) throw new Error('[blockchain] DEPOSIT_WALLET_MNEMONIC not set');
  const hdNode = ethers.HDNodeWallet.fromPhrase(mnemonic);
  const child = hdNode.derivePath(`m/44'/60'/0'/0/${index}`);
  return child.address.toLowerCase();
}

/**
 * Check the current MATIC balance of a deposit address on-chain.
 * Returns the balance in wei as a bigint.
 */
export async function getAddressBalanceWei(address: string): Promise<bigint> {
  return getProvider().getBalance(address);
}

/**
 * Convert a MATIC amount in wei to USD using the current Chainlink price.
 */
export async function weiToUsdDeposit(wei: bigint): Promise<number> {
  const rate = await getMATICPriceUSD();
  const matic = parseFloat(ethers.formatEther(wei));
  return parseFloat((matic * rate).toFixed(2));
}

/**
 * Sweep all MATIC from a user's deposit address into the hot wallet.
 * Called automatically after a deposit is detected and credited.
 * Returns null if the balance is too small to cover gas (dust).
 */
export async function sweepDepositToHotWallet(
  index: number,
): Promise<{ txHash: string; sweptWei: bigint } | null> {
  const mnemonic = process.env.DEPOSIT_WALLET_MNEMONIC;
  if (!mnemonic) throw new Error('[blockchain] DEPOSIT_WALLET_MNEMONIC not set');

  const provider = getProvider();
  const hdNode = ethers.HDNodeWallet.fromPhrase(mnemonic);
  const child = hdNode.derivePath(`m/44'/60'/0'/0/${index}`);
  const depositWallet = child.connect(provider);

  const hotWalletAddress = getWallet().address;
  const [balance, feeData] = await Promise.all([
    provider.getBalance(depositWallet.address),
    provider.getFeeData(),
  ]);

  const gasPrice = feeData.maxFeePerGas ?? feeData.gasPrice ?? ethers.parseUnits('30', 'gwei');
  const gasLimit = 21000n;
  const gasCost = gasPrice * gasLimit;

  if (balance <= gasCost) return null; // Dust — not worth sweeping

  const sendAmount = balance - gasCost;

  const tx = await depositWallet.sendTransaction({
    to: hotWalletAddress,
    value: sendAmount,
    gasLimit,
    maxFeePerGas: feeData.maxFeePerGas ?? undefined,
  });

  const receipt = await tx.wait(1);
  if (!receipt || receipt.status === 0) {
    throw new Error(`[blockchain] Sweep transaction reverted: ${tx.hash}`);
  }

  console.log(`[blockchain] Swept ${ethers.formatEther(sendAmount)} MATIC from deposit[${index}] → hot wallet (${tx.hash})`);
  return { txHash: receipt.hash, sweptWei: sendAmount };
}
