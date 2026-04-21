/**
 * Agent Manager & Orchestrator
 * Coordinates all agents and provides centralized control
 */

import {
  initGameLogicAgent,
  getGameLogicAgent,
  GameLogicAgent,
} from './gameLogicAgent';
import {
  initMatchmakingAgent,
  getMatchmakingAgent,
  MatchmakingAgent,
} from './matchmakingAgent';
import {
  initRewardDistributionAgent,
  getRewardDistributionAgent,
  RewardDistributionAgent,
} from './rewardDistributionAgent';
import {
  initFairnessMonitoringAgent,
  getFairnessMonitoringAgent,
  FairnessMonitoringAgent,
} from './fairnessMonitoringAgent';
import { initAIBotAgent, getAIBotAgent, AIBotAgent } from './aiBotAgent';
import { Agent, AgentType, AgentStatus, AgentMetrics } from './types';

export class AgentManager {
  private gameLogicAgent: GameLogicAgent | null = null;
  private matchmakingAgent: MatchmakingAgent | null = null;
  private rewardDistributionAgent: RewardDistributionAgent | null = null;
  private fairnessMonitoringAgent: FairnessMonitoringAgent | null = null;
  private aiBotAgent: AIBotAgent | null = null;

  private initialized = false;
  private agentHealthCheckInterval: NodeJS.Timeout | null = null;

  /**
   * Initialize all agents
   */
  async initializeAgents(): Promise<void> {
    if (this.initialized) {
      console.log('[AgentManager] Already initialized');
      return;
    }

    console.log('[AgentManager] Initializing all agents...');

    try {
      this.gameLogicAgent = initGameLogicAgent();
      this.matchmakingAgent = initMatchmakingAgent();
      this.rewardDistributionAgent = initRewardDistributionAgent();
      this.fairnessMonitoringAgent = initFairnessMonitoringAgent();
      this.aiBotAgent = initAIBotAgent();

      this.initialized = true;

      console.log('[AgentManager] ✓ All agents initialized');
      console.log(`  - GameLogicAgent: ${this.gameLogicAgent.id}`);
      console.log(`  - MatchmakingAgent: ${this.matchmakingAgent.id}`);
      console.log(`  - RewardDistributionAgent: ${this.rewardDistributionAgent.id}`);
      console.log(`  - FairnessMonitoringAgent: ${this.fairnessMonitoringAgent.id}`);
      console.log(`  - AIBotAgent: ${this.aiBotAgent.id}`);
    } catch (error) {
      console.error('[AgentManager] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Start all agent background processes
   */
  async startAgents(): Promise<void> {
    if (!this.initialized) {
      throw new Error('Agents not initialized');
    }

    console.log('[AgentManager] Starting agent background processes...');

    try {
      await this.matchmakingAgent!.startMatchLoop();
      await this.rewardDistributionAgent!.startProcessingLoop();
      await this.fairnessMonitoringAgent!.startMonitoringLoop();
      await this.aiBotAgent!.startBotLoop();

      console.log('[AgentManager] ✓ All agents started');

      // Start health check loop
      this.startHealthCheckLoop();
    } catch (error) {
      console.error('[AgentManager] Start failed:', error);
      throw error;
    }
  }

  /**
   * Stop all agents
   */
  async stopAgents(): Promise<void> {
    console.log('[AgentManager] Stopping all agents...');

    if (this.agentHealthCheckInterval) {
      clearInterval(this.agentHealthCheckInterval);
      this.agentHealthCheckInterval = null;
    }

    this.matchmakingAgent?.stopMatchLoop();
    this.rewardDistributionAgent?.stopProcessingLoop();
    this.fairnessMonitoringAgent?.stopMonitoringLoop();
    this.aiBotAgent?.stopBotLoop();

    console.log('[AgentManager] ✓ All agents stopped');
  }

  /**
   * Start periodic health check
   */
  private startHealthCheckLoop(): void {
    this.agentHealthCheckInterval = setInterval(() => {
      const status = this.getAgentsStatus();
      const unhealthy = Object.entries(status).filter(([_, s]) => !s.healthy);

      if (unhealthy.length > 0) {
        console.warn('[AgentManager] Health check warnings:');
        for (const [agent, info] of unhealthy) {
          console.warn(`  - ${agent}: ${info.reason}`);
        }
      }
    }, 60000); // Every minute
  }

  /**
   * Get agent by type
   */
  getAgent(type: AgentType): Agent | null {
    switch (type) {
      case AgentType.GAME_ENGINE:
        return this.gameLogicAgent;
      case AgentType.MATCHMAKER:
        return this.matchmakingAgent;
      case AgentType.REWARD_DISTRIBUTOR:
        return this.rewardDistributionAgent;
      case AgentType.FAIRNESS_MONITOR:
        return this.fairnessMonitoringAgent;
      case AgentType.AI_BOT:
        return this.aiBotAgent;
      default:
        return null;
    }
  }

  /**
   * Get all agents status
   */
  getAgentsStatus(): Record<
    string,
    {
      id: string;
      status: AgentStatus;
      healthy: boolean;
      reason?: string;
    }
  > {
    const status: Record<
      string,
      {
        id: string;
        status: AgentStatus;
        healthy: boolean;
        reason?: string;
      }
    > = {};

    if (this.gameLogicAgent) {
      const health = this.gameLogicAgent.healthCheck();
      status['GameLogicAgent'] = {
        id: this.gameLogicAgent.id,
        status: this.gameLogicAgent.status,
        healthy: health.healthy,
        reason: health.reason,
      };
    }

    if (this.matchmakingAgent) {
      const health = this.matchmakingAgent.healthCheck();
      status['MatchmakingAgent'] = {
        id: this.matchmakingAgent.id,
        status: this.matchmakingAgent.status,
        healthy: health.healthy,
        reason: health.reason,
      };
    }

    if (this.rewardDistributionAgent) {
      const health = this.rewardDistributionAgent.healthCheck();
      status['RewardDistributionAgent'] = {
        id: this.rewardDistributionAgent.id,
        status: this.rewardDistributionAgent.status,
        healthy: health.healthy,
        reason: health.reason,
      };
    }

    if (this.fairnessMonitoringAgent) {
      const health = this.fairnessMonitoringAgent.healthCheck();
      status['FairnessMonitoringAgent'] = {
        id: this.fairnessMonitoringAgent.id,
        status: this.fairnessMonitoringAgent.status,
        healthy: health.healthy,
        reason: health.reason,
      };
    }

    if (this.aiBotAgent) {
      const health = this.aiBotAgent.healthCheck();
      status['AIBotAgent'] = {
        id: this.aiBotAgent.id,
        status: this.aiBotAgent.status,
        healthy: health.healthy,
        reason: health.reason,
      };
    }

    return status;
  }

  /**
   * Get all agents metrics
   */
  getAgentsMetrics(): Record<string, AgentMetrics> {
    const metrics: Record<string, AgentMetrics> = {};

    if (this.gameLogicAgent) {
      metrics['GameLogicAgent'] = this.gameLogicAgent.getMetrics();
    }
    if (this.matchmakingAgent) {
      metrics['MatchmakingAgent'] = this.matchmakingAgent.getMetrics();
    }
    if (this.rewardDistributionAgent) {
      metrics['RewardDistributionAgent'] = this.rewardDistributionAgent.getMetrics();
    }
    if (this.fairnessMonitoringAgent) {
      metrics['FairnessMonitoringAgent'] = this.fairnessMonitoringAgent.getMetrics();
    }
    if (this.aiBotAgent) {
      metrics['AIBotAgent'] = this.aiBotAgent.getMetrics();
    }

    return metrics;
  }

  /**
   * Get detailed agent info
   */
  getAgentInfo(type: AgentType): { agent: Agent; metrics: AgentMetrics; health: any } | null {
    const agent = this.getAgent(type);
    if (!agent) return null;

    const metrics =
      type === AgentType.GAME_ENGINE
        ? this.gameLogicAgent!.getMetrics()
        : type === AgentType.MATCHMAKER
          ? this.matchmakingAgent!.getMetrics()
          : type === AgentType.REWARD_DISTRIBUTOR
            ? this.rewardDistributionAgent!.getMetrics()
            : type === AgentType.FAIRNESS_MONITOR
              ? this.fairnessMonitoringAgent!.getMetrics()
              : this.aiBotAgent!.getMetrics();

    const health =
      type === AgentType.GAME_ENGINE
        ? this.gameLogicAgent!.healthCheck()
        : type === AgentType.MATCHMAKER
          ? this.matchmakingAgent!.healthCheck()
          : type === AgentType.REWARD_DISTRIBUTOR
            ? this.rewardDistributionAgent!.healthCheck()
            : type === AgentType.FAIRNESS_MONITOR
              ? this.fairnessMonitoringAgent!.healthCheck()
              : this.aiBotAgent!.healthCheck();

    return { agent, metrics, health };
  }

  /**
   * Check if all agents are initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get initialization status
   */
  getInitializationStatus(): {
    initialized: boolean;
    agents: Record<string, boolean>;
  } {
    return {
      initialized: this.initialized,
      agents: {
        gameLogicAgent: !!this.gameLogicAgent,
        matchmakingAgent: !!this.matchmakingAgent,
        rewardDistributionAgent: !!this.rewardDistributionAgent,
        fairnessMonitoringAgent: !!this.fairnessMonitoringAgent,
        aiBotAgent: !!this.aiBotAgent,
      },
    };
  }
}

// ─── Global Instance ──────────────────────────────────────────────────────

let agentManager: AgentManager | null = null;

export function getAgentManager(): AgentManager {
  if (!agentManager) {
    agentManager = new AgentManager();
  }
  return agentManager;
}

export async function initializeAgentSystem(): Promise<AgentManager> {
  const manager = getAgentManager();
  await manager.initializeAgents();
  await manager.startAgents();
  return manager;
}
