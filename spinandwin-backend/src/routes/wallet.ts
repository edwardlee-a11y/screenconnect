import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomBytes } from 'crypto';
import { authenticate } from '../middleware/authenticate';
import { supabase } from '../config/supabase';
import { redis, Keys, TTL } from '../config/redis';
import {
  verifyWalletSignature,
  sendPayout,
  getHotWalletBalance,
  getPrizePoolBalance,
  hasSufficientBalance,
  weiToUsd,
  generateDepositAddress,
  getAddressBalanceWei,
  weiToUsdDeposit,
  sweepDepositToHotWallet,
} from '../services/blockchainService';
import { sendWithdrawalConfirmationEmail } from '../services/emailService';

// ─── Constants ─────────────────────────────────────────────────────────────
const DEFAULT_MIN_WITHDRAWAL_USD = 1.00;
const DEFAULT_MAX_WITHDRAWAL_USD = 500.00;
const WITHDRAWAL_FEE_PERCENT = 2; // 2% fee on withdrawals

async function getWithdrawalLimits(): Promise<{ min: number; max: number }> {
  const config = await redis.get<{ min: number; max: number }>(Keys.withdrawalConfig());
  return {
    min: config?.min ?? DEFAULT_MIN_WITHDRAWAL_USD,
    max: config?.max ?? DEFAULT_MAX_WITHDRAWAL_USD,
  };
}

// ─── Route plugin ──────────────────────────────────────────────────────────

export async function walletRoutes(fastify: FastifyInstance): Promise<void> {

  // ── GET /api/v1/wallet/nonce ──────────────────────────────────────────────
  // Step 1 of wallet connection.
  // Client sends their wallet address → server returns a nonce to sign.
  // This proves wallet ownership without a password.

  fastify.get<{ Querystring: { address: string } }>(
    '/nonce',
    { preHandler: [authenticate] },
    async (req: FastifyRequest<{ Querystring: { address: string } }>, reply: FastifyReply) => {
      const { address } = req.query;

      if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Valid Ethereum address required (0x + 40 hex chars).',
        });
      }

      const normalizedAddress = address.toLowerCase();

      // Check address not already linked to another account
      const { data: existing } = await supabase
        .from('users')
        .select('id')
        .eq('wallet_address', normalizedAddress)
        .neq('id', req.user.sub)
        .single();

      if (existing) {
        return reply.status(409).send({
          statusCode: 409,
          error: 'Conflict',
          message: 'This wallet is already linked to another account.',
        });
      }

      // Generate nonce and cache for 10 minutes
      const nonce = randomBytes(16).toString('hex');
      await redis.set(Keys.walletNonce(normalizedAddress), nonce, { ex: TTL.NONCE });

      const message = buildSignMessage(normalizedAddress, nonce);

      return reply.send({ nonce, message });
    },
  );

  // ── POST /api/v1/wallet/connect ───────────────────────────────────────────
  // Step 2 of wallet connection.
  // Client signs the nonce message with WalletConnect and sends the signature.
  // Server verifies, links wallet to user account.

  fastify.post<{ Body: { address: string; signature: string } }>(
    '/connect',
    {
      preHandler: [authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['address', 'signature'],
          properties: {
            address: { type: 'string' },
            signature: { type: 'string' },
          },
        },
      },
    },
    async (
      req: FastifyRequest<{ Body: { address: string; signature: string } }>,
      reply: FastifyReply,
    ) => {
      const { address, signature } = req.body;

      if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
        return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid address format.' });
      }

      const normalizedAddress = address.toLowerCase();

      // Retrieve nonce from Redis
      const nonce = await redis.get<string>(Keys.walletNonce(normalizedAddress));
      if (!nonce) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Nonce expired or not found. Request a new nonce.',
        });
      }

      // Verify the signature
      const message = buildSignMessage(normalizedAddress, nonce);
      let signerAddress: string;
      try {
        signerAddress = verifyWalletSignature(message, signature);
      } catch {
        return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Invalid signature.' });
      }

      if (signerAddress !== normalizedAddress) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Signature does not match the provided address.',
        });
      }

      // Link wallet to user
      const { error } = await supabase
        .from('users')
        .update({ wallet_address: normalizedAddress })
        .eq('id', req.user.sub);

      if (error) {
        fastify.log.error({ err: error }, 'Failed to link wallet');
        return reply.status(500).send({ statusCode: 500, error: 'Internal Server Error', message: 'Failed to link wallet.' });
      }

      // Consume nonce
      await redis.del(Keys.walletNonce(normalizedAddress));

      return reply.send({
        message: 'Wallet connected successfully.',
        address: normalizedAddress,
      });
    },
  );

  // ── DELETE /api/v1/wallet/disconnect ─────────────────────────────────────
  // Unlinks wallet from account.

  fastify.delete(
    '/disconnect',
    { preHandler: [authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      await supabase
        .from('users')
        .update({ wallet_address: null })
        .eq('id', req.user.sub);

      return reply.send({ message: 'Wallet disconnected.' });
    },
  );

  // ── GET /api/v1/wallet/balance ────────────────────────────────────────────
  // Returns on-chain and in-app balances.

  fastify.get(
    '/balance',
    { preHandler: [authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { data: user } = await supabase
        .from('users')
        .select('wallet_address, balance_usd, balance_spin')
        .eq('id', req.user.sub)
        .single();

      if (!user) {
        return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'User not found.' });
      }

      return reply.send({
        inApp: {
          balanceUsd: user.balance_usd,
          balanceSpin: user.balance_spin,
        },
        walletAddress: user.wallet_address ?? null,
      });
    },
  );

  // ── POST /api/v1/wallet/withdraw ─────────────────────────────────────────
  // Withdraw in-app balance to connected wallet as MATIC.

  fastify.post<{ Body: { amountUsd: number } }>(
    '/withdraw',
    {
      preHandler: [authenticate],
      config: { rateLimit: { max: 3, timeWindow: '1 hour' } }, // 3 withdrawals/hour
      schema: {
        body: {
          type: 'object',
          required: ['amountUsd'],
          properties: {
            amountUsd: { type: 'number', minimum: 0.01 },
          },
        },
      },
    },
    async (
      req: FastifyRequest<{ Body: { amountUsd: number } }>,
      reply: FastifyReply,
    ) => {
      const { amountUsd } = req.body;
      const uid = req.user.sub;

      // Read live limits from Redis (admin-configurable)
      const limits = await getWithdrawalLimits();

      if (amountUsd < limits.min || amountUsd > limits.max) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: `Withdrawal must be between $${limits.min.toFixed(2)} and $${limits.max.toFixed(2)}.`,
        });
      }

      // Fetch user
      const { data: user } = await supabase
        .from('users')
        .select('email, username, wallet_address, balance_usd, kyc_verified')
        .eq('id', uid)
        .single();

      if (!user) {
        return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'User not found.' });
      }

      if (!user.kyc_verified) {
        return reply.status(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: 'Email verification required before withdrawals.',
        });
      }

      if (!user.wallet_address) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'No wallet connected. Link a wallet before withdrawing.',
        });
      }

      if (user.balance_usd < amountUsd) {
        return reply.status(402).send({
          statusCode: 402,
          error: 'Payment Required',
          message: `Insufficient balance. You have $${user.balance_usd.toFixed(2)}.`,
        });
      }

      // Check hot wallet has enough funds
      const sufficient = await hasSufficientBalance(amountUsd);
      if (!sufficient) {
        fastify.log.warn({ amountUsd, uid }, 'Hot wallet low — withdrawal queued');
        return reply.status(503).send({
          statusCode: 503,
          error: 'Service Unavailable',
          message: 'Withdrawals temporarily unavailable. Please try again in a few minutes.',
        });
      }

      const fee = parseFloat((amountUsd * (WITHDRAWAL_FEE_PERCENT / 100)).toFixed(2));
      const netAmountUsd = parseFloat((amountUsd - fee).toFixed(2));

      // Debit balance first (prevents double-withdrawal)
      const { error: debitErr } = await supabase
        .from('users')
        .update({ balance_usd: parseFloat((user.balance_usd - amountUsd).toFixed(2)) })
        .eq('id', uid);

      if (debitErr) {
        return reply.status(500).send({ statusCode: 500, error: 'Internal Server Error', message: 'Withdrawal failed.' });
      }

      // Record pending transaction
      const { data: txRecord } = await supabase
        .from('transactions')
        .insert({
          user_id: uid,
          type: 'withdrawal',
          amount_usd: amountUsd,
          status: 'pending',
          tx_hash: null,
          metadata: { fee, netAmountUsd, walletAddress: user.wallet_address },
        })
        .select('id')
        .single();

      // Send on-chain
      let txHash: string;
      try {
        const result = await sendPayout(user.wallet_address, netAmountUsd);
        txHash = result.txHash;
      } catch (err: unknown) {
        // Refund balance if blockchain tx fails
        await supabase
          .from('users')
          .update({ balance_usd: user.balance_usd })
          .eq('id', uid);

        if (txRecord?.id) {
          await supabase
            .from('transactions')
            .update({ status: 'failed' })
            .eq('id', txRecord.id);
        }

        fastify.log.error({ err }, 'Blockchain payout failed');
        return reply.status(502).send({
          statusCode: 502,
          error: 'Bad Gateway',
          message: 'Blockchain transaction failed. Your balance has been restored.',
        });
      }

      // Mark transaction complete
      if (txRecord?.id) {
        await supabase
          .from('transactions')
          .update({ status: 'completed', tx_hash: txHash })
          .eq('id', txRecord.id);
      }

      // Send withdrawal confirmation email (fire-and-forget)
      sendWithdrawalConfirmationEmail({
        to:            user.email,
        username:      user.username,
        amountUsd,
        netAmountUsd,
        txHash,
        walletAddress: user.wallet_address,
      }).catch((err) => fastify.log.warn({ err }, 'Failed to send withdrawal email'));

      return reply.send({
        message: 'Withdrawal successful.',
        txHash,
        amountUsd,
        feeUsd: fee,
        netAmountUsd,
        walletAddress: user.wallet_address,
        polygonscanUrl: `https://${process.env.NODE_ENV === 'production' ? '' : 'amoy.'}polygonscan.com/tx/${txHash}`,
      });
    },
  );

  // ── GET /api/v1/wallet/transactions ──────────────────────────────────────
  // Returns paginated transaction history.

  fastify.get<{ Querystring: { page?: number; limit?: number } }>(
    '/transactions',
    { preHandler: [authenticate] },
    async (req, reply) => {
      const page = Math.max(1, req.query.page ?? 1);
      const limit = Math.min(50, req.query.limit ?? 20);
      const offset = (page - 1) * limit;

      const { data, error, count } = await supabase
        .from('transactions')
        .select('*', { count: 'exact' })
        .eq('user_id', req.user.sub)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        return reply.status(500).send({ statusCode: 500, error: 'Internal Server Error', message: 'Failed to fetch transactions.' });
      }

      return reply.send({
        transactions: data,
        pagination: { page, limit, total: count ?? 0, totalPages: Math.ceil((count ?? 0) / limit) },
      });
    },
  );

  // ── GET /api/v1/wallet/deposit-address ───────────────────────────────────
  // Returns (or creates) the user's unique MATIC deposit address.

  fastify.get(
    '/deposit-address',
    { preHandler: [authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const uid = req.user.sub;

      const { data: user } = await (supabase as any)
        .from('users')
        .select('deposit_address, deposit_index')
        .eq('id', uid)
        .single();

      if (user?.deposit_address) {
        return reply.send({ address: user.deposit_address });
      }

      // Assign next available index
      const { count } = await supabase
        .from('users')
        .select('id', { count: 'exact', head: true })
        .not('deposit_index', 'is', null);

      const index = count ?? 0;
      const address = generateDepositAddress(index);

      await (supabase as any)
        .from('users')
        .update({ deposit_address: address, deposit_index: index })
        .eq('id', uid);

      return reply.send({ address });
    },
  );

  // ── POST /api/v1/wallet/check-deposit ────────────────────────────────────
  // Polls the user's deposit address for new MATIC and credits USD balance.

  fastify.post(
    '/check-deposit',
    {
      preHandler: [authenticate],
      config: { rateLimit: { max: 6, timeWindow: '1 minute' } },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const uid = req.user.sub;

      const { data: user } = await (supabase as any)
        .from('users')
        .select('deposit_address, deposit_tracked_wei, balance_usd, deposit_index')
        .eq('id', uid)
        .single();

      if (!user?.deposit_address) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'No deposit address yet. Call GET /deposit-address first.',
        });
      }

      const currentWei = await getAddressBalanceWei(user.deposit_address);
      const trackedWei = BigInt(user.deposit_tracked_wei ?? '0');

      if (currentWei <= trackedWei) {
        return reply.send({ credited: 0, message: 'No new deposits detected.' });
      }

      const newWei = currentWei - trackedWei;
      const creditedUsd = await weiToUsdDeposit(newWei);

      // Credit balance — set tracked to currentWei to prevent double-credit during sweep
      const newBalance = parseFloat((user.balance_usd + creditedUsd).toFixed(2));

      await (supabase as any)
        .from('users')
        .update({
          balance_usd: newBalance,
          deposit_tracked_wei: currentWei.toString(),
        })
        .eq('id', uid);

      // Record deposit transaction
      await supabase.from('transactions').insert({
        user_id: uid,
        type: 'deposit',
        amount_usd: creditedUsd,
        status: 'completed',
        metadata: {
          maticWei: newWei.toString(),
          depositAddress: user.deposit_address,
        },
      });

      // Sweep deposited MATIC into hot wallet (fire-and-forget).
      // On success: reset deposit_tracked_wei to 0 so future deposits are detected.
      // On failure: MATIC stays at deposit address — player credit is already safe.
      if (user.deposit_index !== null && user.deposit_index !== undefined) {
        sweepDepositToHotWallet(user.deposit_index)
          .then(async (result) => {
            if (result) {
              await (supabase as any)
                .from('users')
                .update({ deposit_tracked_wei: '0' })
                .eq('id', uid);
            }
          })
          .catch((err) => {
            fastify.log.warn({ err, uid }, 'Deposit sweep to hot wallet failed — MATIC stays at deposit address');
          });
      }

      return reply.send({
        credited: creditedUsd,
        newBalance,
        message: `$${creditedUsd.toFixed(2)} credited to your account.`,
      });
    },
  );
}

// ─── Helper ────────────────────────────────────────────────────────────────

function buildSignMessage(address: string, nonce: string): string {
  return [
    'Welcome to Spin & Win!',
    '',
    'Sign this message to connect your wallet.',
    'This request will not trigger a blockchain transaction or cost any gas fees.',
    '',
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    `Issued: ${new Date().toISOString()}`,
  ].join('\n');
}
