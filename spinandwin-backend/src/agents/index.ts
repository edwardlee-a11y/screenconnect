/**
 * Agents Module
 * Centralized exports for all agent classes and utilities
 */

// Types
export * from './types';

// Agents
export {
  GameLogicAgent,
  initGameLogicAgent,
  getGameLogicAgent,
} from './gameLogicAgent';

export {
  MatchmakingAgent,
  initMatchmakingAgent,
  getMatchmakingAgent,
} from './matchmakingAgent';

export {
  RewardDistributionAgent,
  initRewardDistributionAgent,
  getRewardDistributionAgent,
} from './rewardDistributionAgent';

export {
  FairnessMonitoringAgent,
  initFairnessMonitoringAgent,
  getFairnessMonitoringAgent,
} from './fairnessMonitoringAgent';

export {
  AIBotAgent,
  initAIBotAgent,
  getAIBotAgent,
} from './aiBotAgent';

// Manager
export {
  AgentManager,
  getAgentManager,
  initializeAgentSystem,
} from './agentManager';
