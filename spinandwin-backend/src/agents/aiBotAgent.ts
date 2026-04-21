/**
 * AI Bot Agent
 * Manages automated bot players for gameplay, testing, and liquidity
 */

import { randomUUID } from 'crypto';
import { supabase } from '../config/supabase';
import { redis, Keys, TTL } from '../config/redis';
import {
  BotConfig,
  BotStrategy,
  BotAction,
  Agent,
  AgentType,
  AgentStatus,
  AgentMetrics,
} from './types';

interface ActiveBot extends BotConfig {
  currentWager: number;
  consecutiveLosses: number;
  lastSpinTime: number;
  disabled: boolean;
  disabledReason?: string;
}

export class AIBotAgent implements Agent {
  id: string;
  type = AgentType.AI_BOT;
  status: AgentStatus = AgentStatus.IDLE;
  createdAt: number;
  lastHeartbeat: number;

  private bots: Map<string, ActiveBot> = new Map();
  private botActions: Map<string, BotAction[]> = new Map();

  private metrics: Omit<AgentMetrics, 'agentId' | 'type'> = {
    processedCount: 0,
    successCount: 0,
    errorCount: 0,
    averageProcessTime: 0,
    uptime: 0,
  };

  private startTime = Date.now();
  private botLoopRunning = false;

  constructor() {
    this.id = randomUUID();
    this.createdAt = Date.now();
    this.lastHeartbeat = Date.now();
  }

  /**
   * Create a new bot
   */
  async createBot(config: Omit<BotConfig, 'botId' | 'createdAt'>): Promise<BotConfig> {
    const botId = randomUUID();
    const botConfig: BotConfig = {
      ...config,
      botId,
      createdAt: Date.now(),
    };

    const activeBot: ActiveBot = {
      ...botConfig,
      currentWager: config.strategy.initialWager,
      consecutiveLosses: 0,
      lastSpinTime: 0,
      disabled: false,
    };

    this.bots.set(botId, activeBot);

    // Save to database
    await supabase.from('ai_bots').insert({
      id: botId,
      name: botConfig.name,
      skill_level: botConfig.skillLevel,
      bankroll: botConfig.bankroll,
      active: botConfig.active,
      created_at: new Date(botConfig.createdAt).toISOString(),
    });

    // Save strategy
    await supabase.from('bot_strategies').insert({
      bot_id: botId,
      initial_wager: config.strategy.initialWager,
      wager_adjustment_factor: config.strategy.wagerAdjustmentFactor,
      martingale_enabled: config.strategy.martingaleEnabled,
      max_consecutive_losses: config.strategy.maxConsecutiveLosses,
      pause_after_win: config.strategy.pauseAfterWin,
      stop_loss_limit: config.strategy.stopLossLimit,
    });

    console.log(`[AIBotAgent] Created bot: ${botId} (${botConfig.name})`);

    return botConfig;
  }

  /**
   * Make bot decision for next action
   */
  async makeBotDecision(botId: string): Promise<BotAction | null> {
    const bot = this.bots.get(botId);
    if (!bot || !bot.active || bot.disabled) {
      return null;
    }

    const startTime = Date.now();
    this.status = AgentStatus.PROCESSING;

    try {
      // Check stop conditions
      if (bot.bankroll <= bot.currentWager) {
        bot.disabled = true;
        bot.disabledReason = 'Insufficient bankroll';
        return null;
      }

      if (bot.consecutiveLosses >= bot.strategy.maxConsecutiveLosses) {
        bot.disabled = true;
        bot.disabledReason = 'Max consecutive losses exceeded';
        return null;
      }

      // Decide action
      const action = this.decideAction(bot);

      // Log action
      if (!this.botActions.has(botId)) {
        this.botActions.set(botId, []);
      }
      this.botActions.get(botId)!.push(action);

      // Save action
      await supabase.from('bot_actions').insert({
        bot_id: botId,
        action_type: action.actionType,
        metadata: JSON.stringify(action.metadata),
        created_at: new Date(action.timestamp).toISOString(),
      });

      this.metrics.successCount++;

      return action;
    } catch (error) {
      this.metrics.errorCount++;
      console.error(`[AIBotAgent] Decision error for bot ${botId}:`, error);
      return null;
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
   * Decide bot's next action based on strategy
   */
  private decideAction(bot: ActiveBot): BotAction {
    const now = Date.now();

    // Minimum time between spins (5 seconds)
    if (now - bot.lastSpinTime < 5000) {
      return {
        botId: bot.botId,
        actionType: 'pause',
        timestamp: now,
      };
    }

    // Determine wager
    let wager = bot.currentWager;

    if (bot.strategy.martingaleEnabled && bot.consecutiveLosses > 0) {
      // Increase wager after loss (Martingale)
      wager = bot.currentWager * bot.strategy.wagerAdjustmentFactor;
    }

    // Cap wager to bankroll
    wager = Math.min(wager, bot.bankroll * 0.1); // Never bet more than 10% of bankroll
    wager = Math.max(wager, bot.strategy.initialWager * 0.5); // Never go below 50% of initial

    bot.currentWager = wager;

    return {
      botId: bot.botId,
      actionType: 'spin',
      timestamp: now,
      metadata: {
        wager,
        skillLevel: bot.skillLevel,
        strategy: bot.strategy.martingaleEnabled ? 'martingale' : 'standard',
        consecutiveLosses: bot.consecutiveLosses,
      },
    };
  }

  /**
   * Update bot after a spin result
   */
  async updateBotAfterSpin(
    botId: string,
    wagerAmount: number,
    payoutAmount: number
  ): Promise<void> {
    const bot = this.bots.get(botId);
    if (!bot) {
      throw new Error(`Bot not found: ${botId}`);
    }

    const won = payoutAmount > wagerAmount;

    // Update bankroll
    bot.bankroll += payoutAmount - wagerAmount;

    if (won) {
      bot.consecutiveLosses = 0;

      // Pause after win (if strategy enabled)
      if (bot.strategy.pauseAfterWin) {
        return; // Don't take action until next decision cycle
      }

      // Reset wager on win
      bot.currentWager = bot.strategy.initialWager;
    } else {
      bot.consecutiveLosses++;

      // Check stop-loss
      const lossPercentage = (bot.strategy.initialWager - bot.bankroll) / bot.strategy.initialWager;
      if (lossPercentage >= bot.strategy.stopLossLimit) {
        bot.disabled = true;
        bot.disabledReason = `Stop-loss limit reached (${(lossPercentage * 100).toFixed(1)}%)`;
      }
    }

    bot.lastSpinTime = Date.now();

    // Update database
    await supabase
      .from('ai_bots')
      .update({
        bankroll: bot.bankroll,
        active: !bot.disabled,
      })
      .eq('id', botId);
  }

  /**
   * Start bot gameplay loop
   */
  async startBotLoop(): Promise<void> {
    if (this.botLoopRunning) return;
    this.botLoopRunning = true;

    const loop = async () => {
      while (this.botLoopRunning) {
        try {
          // Process each active bot
          for (const [botId, bot] of this.bots) {
            if (bot.active && !bot.disabled) {
              const action = await this.makeBotDecision(botId);
              // Action would be processed by game logic (integration point)
            }
          }
        } catch (error) {
          console.error('[AIBotAgent] Bot loop error:', error);
        }
        await new Promise((resolve) => setTimeout(resolve, 10000)); // Every 10 seconds
      }
    };

    loop().catch((error) => {
      console.error('[AIBotAgent] Fatal bot loop error:', error);
      this.botLoopRunning = false;
    });
  }

  /**
   * Stop bot loop
   */
  stopBotLoop(): void {
    this.botLoopRunning = false;
  }

  /**
   * Get bot info
   */
  getBot(botId: string): ActiveBot | undefined {
    return this.bots.get(botId);
  }

  /**
   * Get bot actions
   */
  getBotActions(botId: string, limit: number = 100): BotAction[] {
    const actions = this.botActions.get(botId) || [];
    return actions.slice(-limit);
  }

  /**
   * List active bots
   */
  listActiveBots(): ActiveBot[] {
    return Array.from(this.bots.values()).filter((b) => b.active && !b.disabled);
  }

  /**
   * Disable bot
   */
  async disableBot(botId: string, reason?: string): Promise<void> {
    const bot = this.bots.get(botId);
    if (bot) {
      bot.disabled = true;
      bot.disabledReason = reason;

      await supabase.from('ai_bots').update({ active: false }).eq('id', botId);
    }
  }

  /**
   * Enable bot
   */
  async enableBot(botId: string): Promise<void> {
    const bot = this.bots.get(botId);
    if (bot) {
      bot.disabled = false;
      bot.disabledReason = undefined;
      bot.consecutiveLosses = 0;
      bot.currentWager = bot.strategy.initialWager;

      await supabase.from('ai_bots').update({ active: true }).eq('id', botId);
    }
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

export let aiBotAgent: AIBotAgent | null = null;

export function initAIBotAgent(): AIBotAgent {
  if (!aiBotAgent) {
    aiBotAgent = new AIBotAgent();
    console.log(`[AIBotAgent] Initialized (ID: ${aiBotAgent.id})`);
  }
  return aiBotAgent;
}

export function getAIBotAgent(): AIBotAgent {
  if (!aiBotAgent) {
    throw new Error('AIBotAgent not initialized');
  }
  return aiBotAgent;
}
