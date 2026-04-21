/**
 * Reward Distribution Agent
 * Handles prize payouts, wallet transfers, and reward tracking
 */

import { randomUUID } from 'crypto';
import { supabase } from '../config/supabase';
import { redis, Keys, TTL } from '../config/redis';
import {
  RewardDistributionRequest,
  RewardDistribution,
  UserReward,
  Agent,
  AgentType,
  AgentStatus,
  AgentMetrics,
} from './types';

interface PendingDistribution {
  distributionId: string;
  request: RewardDistributionRequest;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
  blockchainTxHash?: string;
  timestamp: number;
}

export class RewardDistributionAgent implements Agent {
  id: string;
  type = AgentType.REWARD_DISTRIBUTOR;
  status: AgentStatus = AgentStatus.IDLE;
  createdAt: number;
  lastHeartbeat: number;

  private pendingDistributions: Map<string, PendingDistribution> = new Map();

  private metrics: Omit<AgentMetrics, 'agentId' | 'type'> = {
    processedCount: 0,
    successCount: 0,
    errorCount: 0,
    averageProcessTime: 0,
    uptime: 0,
  };

  private startTime = Date.now();
  private processingLoop = false;

  constructor() {
    this.id = randomUUID();
    this.createdAt = Date.now();
    this.lastHeartbeat = Date.now();
  }

  /**
   * Queue reward distribution for a match
   */
  async queueDistribution(request: RewardDistributionRequest): Promise<string> {
    const distributionId = randomUUID();

    const pending: PendingDistribution = {
      distributionId,
      request,
      status: 'pending',
      timestamp: Date.now(),
    };

    this.pendingDistributions.set(distributionId, pending);

    // Persist to Redis
    await redis.set(
      Keys.pendingDistribution(distributionId),
      JSON.stringify(pending),
      { ex: TTL.PENDING_DISTRIBUTION }
    );

    console.log(`[RewardDistributionAgent] Queued distribution: ${distributionId}`);
    return distributionId;
  }

  /**
   * Process a single distribution
   */
  async processDistribution(distributionId: string): Promise<RewardDistribution> {
    const startTime = Date.now();
    this.status = AgentStatus.PROCESSING;

    try {
      const pending = this.pendingDistributions.get(distributionId);
      if (!pending) {
        throw new Error(`Distribution not found: ${distributionId}`);
      }

      pending.status = 'processing';

      const { request } = pending;

      // Calculate rewards based on results
      const rewards = this.calculateRewards(request);

      // Validate total
      const total = rewards.reduce((sum, r) => sum + r.amount, 0);
      if (total > request.totalPrizePool * 1.1) {
        // Allow 10% buffer for rounding
        throw new Error('Rewards exceed prize pool');
      }

      // Process on-chain distribution (if applicable)
      let blockchainTxHash: string | undefined;
      if (total > 0) {
        blockchainTxHash = await this.processBlockchainRewards(rewards);
      }

      // Update user balances
      for (const reward of rewards) {
        await supabase
          .from('users')
          .update({
            balance: supabase.rpc('increment', { x: reward.amount }),
          })
          .eq('id', reward.userId);

        // Log transaction
        await supabase.from('transactions').insert({
          user_id: reward.userId,
          type: 'reward',
          amount: reward.amount,
          reward_type: reward.rewardType,
          distribution_id: distributionId,
          blockchain_tx_hash: blockchainTxHash,
          created_at: new Date().toISOString(),
        });

        // Notify user
        await redis.publish(
          `user:${reward.userId}:reward`,
          JSON.stringify({
            event: 'reward_received',
            distributionId,
            amount: reward.amount,
            type: reward.rewardType,
          })
        );
      }

      const distribution: RewardDistribution = {
        distributionId,
        matchId: request.matchId,
        rewards,
        totalDistributed: total,
        timestamp: Date.now(),
        blockchainTxHash,
      };

      // Save to database
      await supabase.from('reward_distributions').insert({
        id: distributionId,
        match_id: request.matchId,
        total_distributed: total,
        blockchain_tx_hash: blockchainTxHash,
        created_at: new Date().toISOString(),
      });

      // Save individual rewards
      for (const reward of rewards) {
        await supabase.from('rewards').insert({
          distribution_id: distributionId,
          user_id: reward.userId,
          amount: reward.amount,
          type: reward.rewardType,
          created_at: new Date().toISOString(),
        });
      }

      // Update status
      pending.status = 'completed';
      pending.blockchainTxHash = blockchainTxHash;

      this.metrics.successCount++;

      return distribution;
    } catch (error) {
      const pending = this.pendingDistributions.get(distributionId);
      if (pending) {
        pending.status = 'failed';
        pending.error = error instanceof Error ? error.message : String(error);
      }

      this.metrics.errorCount++;
      throw error;
    } finally {
      this.metrics.processedCount++;
      const duration = Date.now() - startTime;
      this.metrics.averageProcessTime =
        (this.metrics.averageProcessTime * (this.metrics.processedCount - 1) + duration) /
        this.metrics.processedCount;
      this.status = AgentStatus.IDLE;
      this.lastHeartbeat = Date.now();
    }
  }

  /**
   * Calculate rewards for all players
   */
  private calculateRewards(request: RewardDistributionRequest): UserReward[] {
    const rewards: UserReward[] = [];

    // Group results by user
    const userResults = new Map<string, number>();

    for (const result of request.results) {
      const current = userResults.get(result.sessionId) || 0;
      userResults.set(result.sessionId, current + result.payoutUsd);
    }

    // Calculate rewards (simple: payout is the reward)
    for (const [sessionId, amount] of userResults) {
      rewards.push({
        userId: sessionId,
        amount,
        rewardType: 'winnings',
      });

      // Bonus for jackpot
      const jackpotCount = request.results.filter((r) => r.isJackpot).length;
      if (jackpotCount > 0) {
        rewards.push({
          userId: sessionId,
          amount: amount * 0.1, // 10% bonus
          rewardType: 'jackpot_bonus',
        });
      }
    }

    return rewards;
  }

  /**
   * Process blockchain reward distribution
   */
  private async processBlockchainRewards(rewards: UserReward[]): Promise<string> {
    // TODO: Integrate with blockchain service
    // This is a placeholder - implement with actual contract calls
    const mockTxHash = `0x${randomUUID().replace(/-/g, '').substring(0, 64)}`;
    console.log(
      `[RewardDistributionAgent] Processing blockchain rewards (${rewards.length} recipients)`
    );
    return mockTxHash;
  }

  /**
   * Start background processing loop
   */
  async startProcessingLoop(): Promise<void> {
    if (this.processingLoop) return;
    this.processingLoop = true;

    const loop = async () => {
      while (this.processingLoop) {
        try {
          // Process pending distributions
          for (const [id, pending] of this.pendingDistributions) {
            if (pending.status === 'pending') {
              await this.processDistribution(id);
            }
          }
        } catch (error) {
          console.error('[RewardDistributionAgent] Processing loop error:', error);
        }
        await new Promise((resolve) => setTimeout(resolve, 10000)); // Every 10 seconds
      }
    };

    loop().catch((error) => {
      console.error('[RewardDistributionAgent] Fatal processing loop error:', error);
      this.processingLoop = false;
    });
  }

  /**
   * Stop processing loop
   */
  stopProcessingLoop(): void {
    this.processingLoop = false;
  }

  /**
   * Get distribution status
   */
  async getDistributionStatus(distributionId: string): Promise<PendingDistribution | null> {
    return this.pendingDistributions.get(distributionId) || null;
  }

  /**
   * Get pending count
   */
  getPendingCount(): number {
    return Array.from(this.pendingDistributions.values()).filter(
      (d) => d.status === 'pending'
    ).length;
  }

  /**
   * Get metrics
   */
  getMetrics(): AgentMetrics {
    return {
      agentId: this.id,
      type: this.type,
      ...this.metrics,
    };
  }

  /**
   * Health check
   */
  healthCheck(): { healthy: boolean; reason?: string } {
    const timeSinceHeartbeat = Date.now() - this.lastHeartbeat;

    if (timeSinceHeartbeat > 60000) {
      return { healthy: false, reason: 'Heartbeat timeout' };
    }

    if (this.getPendingCount() > 1000) {
      return { healthy: false, reason: 'Too many pending distributions' };
    }

    return { healthy: true };
  }
}

// ─── Agent Instance ───────────────────────────────────────────────────────

export let rewardDistributionAgent: RewardDistributionAgent | null = null;

export function initRewardDistributionAgent(): RewardDistributionAgent {
  if (!rewardDistributionAgent) {
    rewardDistributionAgent = new RewardDistributionAgent();
    console.log(`[RewardDistributionAgent] Initialized (ID: ${rewardDistributionAgent.id})`);
  }
  return rewardDistributionAgent;
}

export function getRewardDistributionAgent(): RewardDistributionAgent {
  if (!rewardDistributionAgent) {
    throw new Error('RewardDistributionAgent not initialized');
  }
  return rewardDistributionAgent;
}
