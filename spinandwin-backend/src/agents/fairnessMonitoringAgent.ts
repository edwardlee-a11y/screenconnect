/**
 * Fairness Monitoring Agent
 * Verifies game integrity, detects anomalies, and generates audit reports
 */

import { randomUUID } from 'crypto';
import { createHmac } from 'crypto';
import { supabase } from '../config/supabase';
import { redis, Keys, TTL } from '../config/redis';
import {
  FairnessAudit,
  FairnessReport,
  SuspiciousPattern,
  Agent,
  AgentType,
  AgentStatus,
  AgentMetrics,
} from './types';
import { WHEEL } from '../services/gameService';

export class FairnessMonitoringAgent implements Agent {
  id: string;
  type = AgentType.FAIRNESS_MONITOR;
  status: AgentStatus = AgentStatus.IDLE;
  createdAt: number;
  lastHeartbeat: number;

  private audits: Map<string, FairnessAudit> = new Map();
  private suspiciousUsers: Set<string> = new Set();

  private metrics: Omit<AgentMetrics, 'agentId' | 'type'> = {
    processedCount: 0,
    successCount: 0,
    errorCount: 0,
    averageProcessTime: 0,
    uptime: 0,
  };

  private startTime = Date.now();
  private monitoringLoop = false;

  constructor() {
    this.id = randomUUID();
    this.createdAt = Date.now();
    this.lastHeartbeat = Date.now();
  }

  /**
   * Audit a spin for fairness
   */
  async auditSpin(
    spinId: string,
    sessionId: string,
    serverSeed: string,
    clientSeed: string,
    nonce: number,
    actualSegment: number
  ): Promise<FairnessAudit> {
    const startTime = Date.now();
    this.status = AgentStatus.PROCESSING;

    try {
      // Compute expected outcome
      const hmac = createHmac('sha256', serverSeed)
        .update(`${clientSeed}:${nonce}`)
        .digest('hex');

      const WHEEL_TOTAL_WEIGHT = WHEEL.reduce((s, seg) => s + seg.weight, 0);
      const roll = parseInt(hmac.slice(0, 8), 16) % WHEEL_TOTAL_WEIGHT;

      let cumulative = 0;
      let computedSegment = 0;
      for (const seg of WHEEL) {
        cumulative += seg.weight;
        if (roll < cumulative) {
          computedSegment = seg.index;
          break;
        }
      }

      // Verify
      const isVerified = computedSegment === actualSegment;

      const audit: FairnessAudit = {
        auditId: randomUUID(),
        spinId,
        sessionId,
        serverSeed,
        clientSeed,
        nonce,
        computedSegment,
        actualSegment,
        isVerified,
        verifiedAt: Date.now(),
      };

      // Save to database
      await supabase.from('fairness_audits').insert({
        id: audit.auditId,
        spin_id: spinId,
        session_id: sessionId,
        is_verified: isVerified,
        computed_segment: computedSegment,
        actual_segment: actualSegment,
        verified_at: new Date(audit.verifiedAt).toISOString(),
      });

      this.audits.set(spinId, audit);

      if (!isVerified) {
        this.flagSuspiciousActivity(sessionId, 'segment_mismatch', 'high', spinId);
      }

      this.metrics.successCount++;

      return audit;
    } catch (error) {
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
   * Detect suspicious patterns in user activity
   */
  async detectAnomalies(userId: string, timeWindowSeconds: number = 3600): Promise<void> {
    const startTime = Date.now();
    this.status = AgentStatus.PROCESSING;

    try {
      const endTime = Date.now();
      const startDate = new Date(endTime - timeWindowSeconds * 1000);

      // Fetch recent spins
      const { data: spins } = await supabase
        .from('game_spins')
        .select('*')
        .eq('user_id', userId)
        .gte('created_at', startDate.toISOString());

      if (!spins || spins.length === 0) return;

      const patterns: SuspiciousPattern[] = [];

      // 1. Check win rate
      const wins = spins.filter((s) => s.payout_usd > s.wager_usd).length;
      const winRate = wins / spins.length;
      const expectedWinRate = 0.35; // Adjust based on your wheel

      if (winRate > expectedWinRate * 1.5) {
        patterns.push({
          type: 'unusual_win_rate',
          userId,
          severity: 'medium',
          description: `Unusual win rate: ${(winRate * 100).toFixed(1)}% (expected: ${(expectedWinRate * 100).toFixed(1)}%)`,
          detectedAt: Date.now(),
        });
      }

      // 2. Check for timing anomalies (too fast spins)
      if (spins.length > 1) {
        const intervals = [];
        for (let i = 1; i < spins.length; i++) {
          const prev = new Date(spins[i - 1].created_at).getTime();
          const curr = new Date(spins[i].created_at).getTime();
          intervals.push(curr - prev);
        }

        const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const suspiciouslyFast = intervals.filter((i) => i < 1000).length;

        if (suspiciouslyFast > spins.length * 0.3) {
          patterns.push({
            type: 'timing_anomaly',
            userId,
            severity: 'low',
            description: `${suspiciouslyFast} spins faster than 1 second`,
            detectedAt: Date.now(),
          });
        }
      }

      // 3. Check for jackpot clustering
      const jackpots = spins.filter((s) => s.is_jackpot).length;
      const jackpotRate = jackpots / spins.length;
      const expectedJackpotRate = 0.0025; // 0.25%

      if (jackpotRate > expectedJackpotRate * 10) {
        patterns.push({
          type: 'statistical_deviation',
          userId,
          severity: 'high',
          description: `Excessive jackpots: ${jackpots} in ${spins.length} spins`,
          detectedAt: Date.now(),
        });
      }

      // Save patterns
      for (const pattern of patterns) {
        await supabase.from('suspicious_patterns').insert({
          user_id: userId,
          type: pattern.type,
          severity: pattern.severity,
          description: pattern.description,
          detected_at: new Date(pattern.detectedAt).toISOString(),
        });
      }

      if (patterns.length > 0) {
        this.suspiciousUsers.add(userId);
      }
    } catch (error) {
      this.metrics.errorCount++;
      throw error;
    } finally {
      this.status = AgentStatus.IDLE;
      this.lastHeartbeat = Date.now();
    }
  }

  /**
   * Flag suspicious activity
   */
  private async flagSuspiciousActivity(
    userId: string,
    type: string,
    severity: 'low' | 'medium' | 'high',
    referenceId?: string
  ): Promise<void> {
    await supabase.from('suspicious_patterns').insert({
      user_id: userId,
      type,
      severity,
      description: `Manual flag: ${type}${referenceId ? ` (${referenceId})` : ''}`,
      detected_at: new Date().toISOString(),
    });

    if (severity === 'high') {
      this.suspiciousUsers.add(userId);

      // Alert admins
      await redis.publish('alerts:suspicious_activity', JSON.stringify({
        userId,
        type,
        timestamp: Date.now(),
      }));
    }
  }

  /**
   * Generate fairness report for a time period
   */
  async generateReport(startTime: number, endTime: number): Promise<FairnessReport> {
    const reportId = randomUUID();
    const startDate = new Date(startTime);
    const endDate = new Date(endTime);

    // Fetch all spins in period
    const { data: spins } = await supabase
      .from('game_spins')
      .select('*')
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString());

    // Fetch all audits in period
    const { data: audits } = await supabase
      .from('fairness_audits')
      .select('*')
      .gte('verified_at', startDate.toISOString())
      .lte('verified_at', endDate.toISOString());

    // Fetch suspicious patterns
    const { data: patterns } = await supabase
      .from('suspicious_patterns')
      .select('*')
      .gte('detected_at', startDate.toISOString())
      .lte('detected_at', endDate.toISOString());

    const totalSpins = spins?.length || 0;
    const verifiedSpins = audits?.filter((a) => a.is_verified).length || 0;
    const anomalyCount = patterns?.length || 0;

    // Calculate house edge
    let totalWagered = 0;
    let totalPayout = 0;
    if (spins) {
      totalWagered = spins.reduce((sum, s) => sum + (s.wager_usd || 0), 0);
      totalPayout = spins.reduce((sum, s) => sum + (s.payout_usd || 0), 0);
    }
    const averageHouseEdge = totalWagered > 0 ? ((totalWagered - totalPayout) / totalWagered) * 100 : 0;

    // Determine status
    let status: 'clean' | 'warning' | 'alert' = 'clean';
    if (anomalyCount > totalSpins * 0.01) {
      status = 'warning';
    }
    if (anomalyCount > totalSpins * 0.05 || !audits || verifiedSpins < totalSpins * 0.9) {
      status = 'alert';
    }

    const report: FairnessReport = {
      reportId,
      period: { start: startTime, end: endTime },
      totalSpins,
      verifiedSpins,
      anomalyCount,
      averageHouseEdge,
      suspiciousPatterns: patterns || [],
      status,
    };

    // Save report
    await supabase.from('fairness_reports').insert({
      id: reportId,
      period_start: startDate.toISOString(),
      period_end: endDate.toISOString(),
      total_spins: totalSpins,
      verified_spins: verifiedSpins,
      anomaly_count: anomalyCount,
      house_edge: averageHouseEdge,
      status,
      created_at: new Date().toISOString(),
    });

    console.log(`[FairnessMonitor] Report generated: ${reportId} (Status: ${status})`);

    return report;
  }

  /**
   * Start monitoring loop
   */
  async startMonitoringLoop(): Promise<void> {
    if (this.monitoringLoop) return;
    this.monitoringLoop = true;

    const loop = async () => {
      while (this.monitoringLoop) {
        try {
          // Scan for anomalies
          for (const userId of this.suspiciousUsers) {
            await this.detectAnomalies(userId, 3600);
          }
        } catch (error) {
          console.error('[FairnessMonitoringAgent] Monitoring loop error:', error);
        }
        await new Promise((resolve) => setTimeout(resolve, 60000)); // Every minute
      }
    };

    loop().catch((error) => {
      console.error('[FairnessMonitoringAgent] Fatal monitoring loop error:', error);
      this.monitoringLoop = false;
    });
  }

  /**
   * Stop monitoring loop
   */
  stopMonitoringLoop(): void {
    this.monitoringLoop = false;
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

    if (timeSinceHeartbeat > 120000) {
      return { healthy: false, reason: 'Heartbeat timeout' };
    }

    return { healthy: true };
  }
}

// ─── Agent Instance ───────────────────────────────────────────────────────

export let fairnessMonitoringAgent: FairnessMonitoringAgent | null = null;

export function initFairnessMonitoringAgent(): FairnessMonitoringAgent {
  if (!fairnessMonitoringAgent) {
    fairnessMonitoringAgent = new FairnessMonitoringAgent();
    console.log(`[FairnessMonitoringAgent] Initialized (ID: ${fairnessMonitoringAgent.id})`);
  }
  return fairnessMonitoringAgent;
}

export function getFairnessMonitoringAgent(): FairnessMonitoringAgent {
  if (!fairnessMonitoringAgent) {
    throw new Error('FairnessMonitoringAgent not initialized');
  }
  return fairnessMonitoringAgent;
}
