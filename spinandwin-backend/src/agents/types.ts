/**
 * Agent System Types & Interfaces
 * Defines core types for all agents in the system
 */

export enum AgentType {
  GAME_ENGINE = 'game_engine',
  MATCHMAKER = 'matchmaker',
  REWARD_DISTRIBUTOR = 'reward_distributor',
  FAIRNESS_MONITOR = 'fairness_monitor',
  AI_BOT = 'ai_bot',
}

export enum AgentStatus {
  IDLE = 'idle',
  ACTIVE = 'active',
  PROCESSING = 'processing',
  ERROR = 'error',
  PAUSED = 'paused',
}

// ─── Game Logic ───────────────────────────────────────────────────────────

export interface GameSpinRequest {
  userId: string;
  sessionId: string;
  wagerUsd: number;
  clientSeed?: string;
  nonce?: number;
  timestamp: number;
}

export interface SpinResult {
  spinId: string;
  sessionId: string;
  segmentIndex: number;
  label: string;
  multiplier: number;
  payoutUsd: number;
  serverSeedHash: string;
  timestamp: number;
  isJackpot: boolean;
}

// ─── Matchmaking ──────────────────────────────────────────────────────────

export interface MatchmakingRequest {
  userId: string;
  gameType: 'solo' | 'multiplayer' | 'tournament';
  stakeRange: [number, number]; // [min, max] in USD
  skillLevel?: 'beginner' | 'intermediate' | 'advanced';
  timezone?: string;
}

export interface GameMatch {
  matchId: string;
  players: MatchPlayer[];
  gameType: string;
  status: 'pending' | 'active' | 'completed';
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
}

export interface MatchPlayer {
  userId: string;
  joinedAt: number;
  wager: number;
  position?: number; // final position
  earnings?: number;
}

// ─── Reward Distribution ──────────────────────────────────────────────────

export interface RewardDistributionRequest {
  matchId: string;
  results: SpinResult[];
  totalPrizePool: number;
}

export interface RewardDistribution {
  distributionId: string;
  matchId: string;
  rewards: UserReward[];
  totalDistributed: number;
  timestamp: number;
  blockchainTxHash?: string;
}

export interface UserReward {
  userId: string;
  amount: number;
  rewardType: 'winnings' | 'jackpot_bonus' | 'referral' | 'loyalty';
  metadata?: Record<string, any>;
}

// ─── Fairness Monitoring ──────────────────────────────────────────────────

export interface FairnessAudit {
  auditId: string;
  spinId: string;
  sessionId: string;
  serverSeed: string;
  clientSeed: string;
  nonce: number;
  computedSegment: number;
  actualSegment: number;
  isVerified: boolean;
  verifiedAt: number;
}

export interface FairnessReport {
  reportId: string;
  period: {
    start: number;
    end: number;
  };
  totalSpins: number;
  verifiedSpins: number;
  anomalyCount: number;
  averageHouseEdge: number;
  suspiciousPatterns: SuspiciousPattern[];
  status: 'clean' | 'warning' | 'alert';
}

export interface SuspiciousPattern {
  type: 'unusual_win_rate' | 'seed_reuse' | 'timing_anomaly' | 'statistical_deviation';
  userId?: string;
  severity: 'low' | 'medium' | 'high';
  description: string;
  detectedAt: number;
}

// ─── AI Bot ───────────────────────────────────────────────────────────────

export interface BotConfig {
  botId: string;
  name: string;
  skillLevel: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  strategy: BotStrategy;
  bankroll: number;
  active: boolean;
  createdAt: number;
}

export interface BotStrategy {
  initialWager: number;
  wagerAdjustmentFactor: number; // 0.5 = half, 2.0 = double after loss
  martingaleEnabled: boolean;
  maxConsecutiveLosses: number;
  pauseAfterWin: boolean; // rest after winning
  stopLossLimit: number; // Stop if loses X% of bankroll
}

export interface BotAction {
  botId: string;
  actionType: 'place_wager' | 'spin' | 'cash_out' | 'pause' | 'resume';
  timestamp: number;
  metadata?: Record<string, any>;
}

// ─── Agent Base ───────────────────────────────────────────────────────────

export interface Agent {
  id: string;
  type: AgentType;
  status: AgentStatus;
  createdAt: number;
  lastHeartbeat: number;
}

export interface AgentMetrics {
  agentId: string;
  type: AgentType;
  processedCount: number;
  successCount: number;
  errorCount: number;
  averageProcessTime: number; // ms
  lastError?: string;
  uptime: number; // ms
}
