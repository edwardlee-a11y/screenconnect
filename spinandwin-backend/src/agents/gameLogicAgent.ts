/**
 * Game Logic Agent
 * Handles wheel spins, outcome calculation, and game state management
 */

import { randomUUID } from 'crypto';
import { supabase } from '../config/supabase';
import { redis, Keys, TTL } from '../config/redis';
import { 
  GameSpinRequest, 
  SpinResult, 
  Agent, 
  AgentType, 
  AgentStatus, 
  AgentMetrics 
} from './types';
import { computeOutcome, WHEEL, WHEEL_TOTAL_WEIGHT } from '../services/gameService';

export class GameLogicAgent implements Agent {
  id: string;
  type = AgentType.GAME_ENGINE;
  status: AgentStatus = AgentStatus.IDLE;
  createdAt: number;
  lastHeartbeat: number;

  private metrics: Omit<AgentMetrics, 'agentId' | 'type'> = {
    processedCount: 0,
    successCount: 0,
    errorCount: 0,
    averageProcessTime: 0,
    uptime: 0,
  };

  private startTime = Date.now();

  constructor() {
    this.id = randomUUID();
    this.createdAt = Date.now();
    this.lastHeartbeat = Date.now();
  }

  /**
   * Process a spin request
   */
  async processSpin(request: GameSpinRequest): Promise<SpinResult> {
    const startTime = Date.now();
    this.status = AgentStatus.PROCESSING;

    try {
      // Validate wager
      if (request.wagerUsd < 0.10 || request.wagerUsd > 100.00) {
        throw new Error(`Wager out of bounds: ${request.wagerUsd}`);
      }

      // Get session and verify active
      const sessionData = await redis.get(Keys.activeSession(request.userId));
      if (!sessionData || sessionData !== request.sessionId) {
        throw new Error('Invalid or inactive session');
      }

      // Get server seed for this session
      const serverSeed = await redis.get(Keys.serverSeed(request.sessionId));
      if (!serverSeed) {
        throw new Error('Server seed not found');
      }

      // Compute outcome (provably fair)
      const segmentIndex = computeOutcome(
        serverSeed,
        request.clientSeed || 'default',
        request.nonce || 0
      );

      const segment = WHEEL[segmentIndex];
      const payoutUsd = request.wagerUsd * segment.multiplier;
      const isJackpot = segment.multiplier === 50;

      // Create spin record
      const spinId = randomUUID();
      const spinRecord: SpinResult = {
        spinId,
        sessionId: request.sessionId,
        segmentIndex,
        label: segment.label,
        multiplier: segment.multiplier,
        payoutUsd,
        serverSeedHash: (await redis.get(Keys.serverSeedHash(request.sessionId))) || '',
        timestamp: Date.now(),
        isJackpot,
      };

      // Save to database
      const { error } = await supabase.from('game_spins').insert({
        id: spinId,
        session_id: request.sessionId,
        user_id: request.userId,
        wager_usd: request.wagerUsd,
        segment_index: segmentIndex,
        payout_usd: payoutUsd,
        is_jackpot: isJackpot,
        created_at: new Date(spinRecord.timestamp).toISOString(),
      });

      if (error) {
        throw new Error(`Database insert failed: ${error.message}`);
      }

      // Update session stats
      await supabase
        .from('game_sessions')
        .update({
          total_spins: supabase.rpc('increment', { x: 1 }),
          total_wagered_usd: supabase.rpc('increment', { x: request.wagerUsd }),
          total_payout_usd: supabase.rpc('increment', { x: payoutUsd }),
        })
        .eq('id', request.sessionId);

      // Update user balance
      await supabase
        .from('users')
        .update({ balance: supabase.rpc('increment', { x: payoutUsd - request.wagerUsd }) })
        .eq('id', request.userId);

      // Update metrics
      this.metrics.successCount++;
      const duration = Date.now() - startTime;
      this.metrics.averageProcessTime = 
        (this.metrics.averageProcessTime * this.metrics.processedCount + duration) / 
        (this.metrics.processedCount + 1);

      this.status = AgentStatus.IDLE;
      this.lastHeartbeat = Date.now();

      return spinRecord;
    } catch (error) {
      this.metrics.errorCount++;
      this.status = AgentStatus.ERROR;
      this.lastHeartbeat = Date.now();
      throw error;
    } finally {
      this.metrics.processedCount++;
      this.metrics.uptime = Date.now() - this.startTime;
    }
  }

  /**
   * Get current metrics
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
    
    if (timeSinceHeartbeat > 30000) {
      return { healthy: false, reason: 'Heartbeat timeout' };
    }

    if (this.metrics.errorCount > this.metrics.successCount && this.metrics.processedCount > 10) {
      return { healthy: false, reason: 'Error rate too high' };
    }

    return { healthy: true };
  }

  /**
   * Reset metrics (admin only)
   */
  resetMetrics(): void {
    this.metrics = {
      processedCount: 0,
      successCount: 0,
      errorCount: 0,
      averageProcessTime: 0,
      uptime: 0,
    };
    this.startTime = Date.now();
  }
}

// ─── Agent Instance ───────────────────────────────────────────────────────

export let gameLogicAgent: GameLogicAgent | null = null;

export function initGameLogicAgent(): GameLogicAgent {
  if (!gameLogicAgent) {
    gameLogicAgent = new GameLogicAgent();
    console.log(`[GameLogicAgent] Initialized (ID: ${gameLogicAgent.id})`);
  }
  return gameLogicAgent;
}

export function getGameLogicAgent(): GameLogicAgent {
  if (!gameLogicAgent) {
    throw new Error('GameLogicAgent not initialized');
  }
  return gameLogicAgent;
}
