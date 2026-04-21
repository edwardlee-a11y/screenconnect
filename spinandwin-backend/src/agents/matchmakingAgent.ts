// @ts-nocheck
/**
 * Matchmaking Agent
 * Handles player matching for multiplayer games and tournaments
 */

import { randomUUID } from 'crypto';
import { supabase } from '../config/supabase';
import { redis, Keys, TTL } from '../config/redis';
import {
  MatchmakingRequest,
  GameMatch,
  MatchPlayer,
  Agent,
  AgentType,
  AgentStatus,
  AgentMetrics,
} from './types';

const MATCH_TIMEOUT = 30000; // 30 seconds
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 8;

export class MatchmakingAgent implements Agent {
  id: string;
  type = AgentType.MATCHMAKER;
  status: AgentStatus = AgentStatus.IDLE;
  createdAt: number;
  lastHeartbeat: number;

  private queue: Map<string, MatchmakingRequest & { timestamp: number }> = new Map();
  private activeMatches: Map<string, GameMatch> = new Map();

  private metrics: Omit<AgentMetrics, 'agentId' | 'type'> = {
    processedCount: 0,
    successCount: 0,
    errorCount: 0,
    averageProcessTime: 0,
    uptime: 0,
  };

  private startTime = Date.now();
  private matchLoopRunning = false;

  constructor() {
    this.id = randomUUID();
    this.createdAt = Date.now();
    this.lastHeartbeat = Date.now();
  }

  /**
   * Add player to matchmaking queue
   */
  async joinQueue(request: MatchmakingRequest): Promise<void> {
    const startTime = Date.now();

    try {
      // Check if player already in queue
      if (this.queue.has(request.userId)) {
        throw new Error('Player already in queue');
      }

      // Add to queue
      this.queue.set(request.userId, {
        ...request,
        timestamp: Date.now(),
      });

      // Store in Redis for persistence
      await redis.set(
        Keys.matchmakingQueue(request.userId),
        JSON.stringify(request),
        { ex: TTL.MATCHMAKING_QUEUE }
      );

      // Attempt to match
      await this.attemptMatch();

      this.metrics.successCount++;
    } catch (error) {
      this.metrics.errorCount++;
      throw error;
    } finally {
      this.metrics.processedCount++;
      const duration = Date.now() - startTime;
      this.metrics.averageProcessTime =
        (this.metrics.averageProcessTime * (this.metrics.processedCount - 1) + duration) /
        this.metrics.processedCount;
      this.lastHeartbeat = Date.now();
    }
  }

  /**
   * Remove player from queue
   */
  async leaveQueue(userId: string): Promise<void> {
    this.queue.delete(userId);
    await redis.del(Keys.matchmakingQueue(userId));
  }

  /**
   * Attempt to match players
   */
  private async attemptMatch(): Promise<void> {
    if (this.queue.size < MIN_PLAYERS) {
      return;
    }

    const players = Array.from(this.queue.values());

    // Group by game type and stake range
    const groupedByType: Record<string, MatchmakingRequest & { timestamp: number }[]> = {};

    for (const player of players) {
      if (!groupedByType[player.gameType]) {
        groupedByType[player.gameType] = [];
      }
      groupedByType[player.gameType].push(player);
    }

    // Process each game type
    for (const gameType of Object.keys(groupedByType)) {
      const groupedByStake = this.groupByStakeRange(groupedByType[gameType]);

      for (const group of Object.values(groupedByStake)) {
        if (group.length >= MIN_PLAYERS) {
          // Create match with first available players
          const matchPlayers = group.slice(0, Math.min(group.length, MAX_PLAYERS));
          await this.createMatch(gameType, matchPlayers);

          // Remove from queue
          for (const player of matchPlayers) {
            this.queue.delete(player.userId);
            await redis.del(Keys.matchmakingQueue(player.userId));
          }
        }
      }
    }
  }

  /**
   * Group players by stake range compatibility
   */
  private groupByStakeRange(
    players: (MatchmakingRequest & { timestamp: number })[]
  ): Record<string, (MatchmakingRequest & { timestamp: number })[]> {
    const grouped: Record<string, (MatchmakingRequest & { timestamp: number })[]> = {};

    for (const player of players) {
      const key = `${player.stakeRange[0]}-${player.stakeRange[1]}`;
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(player);
    }

    return grouped;
  }

  /**
   * Create a match with selected players
   */
  private async createMatch(
    gameType: string,
    players: (MatchmakingRequest & { timestamp: number })[]
  ): Promise<void> {
    const matchId = randomUUID();
    const now = Date.now();

    const matchPlayers: MatchPlayer[] = players.map((p) => ({
      userId: p.userId,
      joinedAt: now,
      wager: p.stakeRange[0], // Use minimum stake
    }));

    const match: GameMatch = {
      matchId,
      players: matchPlayers,
      gameType,
      status: 'pending',
      createdAt: now,
    };

    // Save to database
    await supabase.from('matches').insert({
      id: matchId,
      game_type: gameType,
      status: 'pending',
      player_count: matchPlayers.length,
      created_at: new Date(now).toISOString(),
    });

    // Add players to match
    for (const player of matchPlayers) {
      await supabase.from('match_players').insert({
        match_id: matchId,
        user_id: player.userId,
        wager: player.wager,
        joined_at: new Date(player.joinedAt).toISOString(),
      });

      // Notify player
      await redis.publish(
        `user:${player.userId}:match`,
        JSON.stringify({
          event: 'match_found',
          matchId,
          opponents: matchPlayers.filter((p) => p.userId !== player.userId).length,
          wager: player.wager,
        })
      );
    }

    // Store in memory
    this.activeMatches.set(matchId, match);

    // Store in Redis
    await redis.set(
      Keys.activeMatch(matchId),
      JSON.stringify(match),
      { ex: TTL.ACTIVE_MATCH }
    );

    console.log(`[MatchmakingAgent] Match created: ${matchId} (${matchPlayers.length} players)`);
  }

  /**
   * Get match status
   */
  async getMatch(matchId: string): Promise<GameMatch | null> {
    // Check memory first
    if (this.activeMatches.has(matchId)) {
      return this.activeMatches.get(matchId) || null;
    }

    // Check Redis
    const data = await redis.get(Keys.activeMatch(matchId));
    if (data) {
      return JSON.parse(data as string) as GameMatch;
    }

    return null;
  }

  /**
   * End a match
   */
  async endMatch(matchId: string): Promise<void> {
    const match = await this.getMatch(matchId);
    if (!match) {
      throw new Error('Match not found');
    }

    match.status = 'completed';
    match.endedAt = Date.now();

    // Update database
    await supabase
      .from('matches')
      .update({
        status: 'completed',
        ended_at: new Date(match.endedAt).toISOString(),
      })
      .eq('id', matchId);

    // Clean up
    this.activeMatches.delete(matchId);
    await redis.del(Keys.activeMatch(matchId));
  }

  /**
   * Get queue status
   */
  getQueueStatus(): { waitingCount: number; avgWaitTime: number } {
    const now = Date.now();
    const waits = Array.from(this.queue.values()).map((p) => now - p.timestamp);
    const avgWait = waits.length > 0 ? waits.reduce((a, b) => a + b, 0) / waits.length : 0;

    return {
      waitingCount: this.queue.size,
      avgWaitTime: Math.round(avgWait),
    };
  }

  /**
   * Start background matching loop
   */
  async startMatchLoop(): Promise<void> {
    if (this.matchLoopRunning) return;
    this.matchLoopRunning = true;

    const loop = async () => {
      while (this.matchLoopRunning) {
        try {
          await this.attemptMatch();
        } catch (error) {
          console.error('[MatchmakingAgent] Match loop error:', error);
        }
        await new Promise((resolve) => setTimeout(resolve, 5000)); // Every 5 seconds
      }
    };

    loop().catch((error) => {
      console.error('[MatchmakingAgent] Fatal match loop error:', error);
      this.matchLoopRunning = false;
    });
  }

  /**
   * Stop background matching loop
   */
  stopMatchLoop(): void {
    this.matchLoopRunning = false;
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

    return { healthy: true };
  }
}

// ─── Agent Instance ───────────────────────────────────────────────────────

export let matchmakingAgent: MatchmakingAgent | null = null;

export function initMatchmakingAgent(): MatchmakingAgent {
  if (!matchmakingAgent) {
    matchmakingAgent = new MatchmakingAgent();
    console.log(`[MatchmakingAgent] Initialized (ID: ${matchmakingAgent.id})`);
  }
  return matchmakingAgent;
}

export function getMatchmakingAgent(): MatchmakingAgent {
  if (!matchmakingAgent) {
    throw new Error('MatchmakingAgent not initialized');
  }
  return matchmakingAgent;
}
