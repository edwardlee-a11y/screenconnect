/**
 * Agent API Routes
 * REST endpoints for managing and monitoring agents
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getAgentManager } from '../agents/agentManager';
import {
  AgentType,
  MatchmakingRequest,
  BotConfig,
} from '../agents/types';

export async function registerAgentRoutes(fastify: FastifyInstance): Promise<void> {
  const agentManager = getAgentManager();

  // ─── Status Endpoints ──────────────────────────────────────────────────

  /**
   * GET /agents/status
   * Get status of all agents
   */
  fastify.get('/agents/status', async (request, reply) => {
    try {
      const status = agentManager.getAgentsStatus();
      return reply.send({
        success: true,
        data: status,
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /agents/metrics
   * Get metrics for all agents
   */
  fastify.get('/agents/metrics', async (request, reply) => {
    try {
      const metrics = agentManager.getAgentsMetrics();
      return reply.send({
        success: true,
        data: metrics,
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /agents/:type
   * Get specific agent info
   */
  fastify.get('/agents/:type', async (request: FastifyRequest<{
    Params: { type: AgentType };
  }>, reply) => {
    try {
      const agentInfo = agentManager.getAgentInfo(request.params.type);
      if (!agentInfo) {
        return reply.status(404).send({
          success: false,
          error: 'Agent not found',
        });
      }

      return reply.send({
        success: true,
        data: agentInfo,
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // ─── Game Logic Agent Routes ───────────────────────────────────────────

  /**
   * POST /agents/game-logic/spin
   * Process a game spin
   */
  fastify.post(
    '/agents/game-logic/spin',
    async (request: FastifyRequest<{
      Body: {
        userId: string;
        sessionId: string;
        wagerUsd: number;
        clientSeed?: string;
        nonce?: number;
      };
    }>, reply) => {
      try {
        const gameLogicAgent = agentManager.getAgent(AgentType.GAME_ENGINE);
        if (!gameLogicAgent) {
          return reply.status(503).send({
            success: false,
            error: 'Game Logic Agent not available',
          });
        }

        // @ts-ignore - Cast to GameLogicAgent
        const result = await gameLogicAgent.processSpin({
          ...request.body,
          timestamp: Date.now(),
        });

        return reply.send({
          success: true,
          data: result,
        });
      } catch (error) {
        return reply.status(400).send({
          success: false,
          error: error instanceof Error ? error.message : 'Spin failed',
        });
      }
    }
  );

  // ─── Matchmaking Agent Routes ──────────────────────────────────────────

  /**
   * POST /agents/matchmaking/join-queue
   * Join matchmaking queue
   */
  fastify.post(
    '/agents/matchmaking/join-queue',
    async (request: FastifyRequest<{
      Body: MatchmakingRequest;
    }>, reply) => {
      try {
        const matchmakingAgent = agentManager.getAgent(AgentType.MATCHMAKER);
        if (!matchmakingAgent) {
          return reply.status(503).send({
            success: false,
            error: 'Matchmaking Agent not available',
          });
        }

        // @ts-ignore - Cast to MatchmakingAgent
        await matchmakingAgent.joinQueue(request.body);

        return reply.send({
          success: true,
          message: 'Joined queue',
        });
      } catch (error) {
        return reply.status(400).send({
          success: false,
          error: error instanceof Error ? error.message : 'Queue join failed',
        });
      }
    }
  );

  /**
   * POST /agents/matchmaking/leave-queue
   * Leave matchmaking queue
   */
  fastify.post(
    '/agents/matchmaking/leave-queue',
    async (request: FastifyRequest<{
      Body: { userId: string };
    }>, reply) => {
      try {
        const matchmakingAgent = agentManager.getAgent(AgentType.MATCHMAKER);
        if (!matchmakingAgent) {
          return reply.status(503).send({
            success: false,
            error: 'Matchmaking Agent not available',
          });
        }

        // @ts-ignore - Cast to MatchmakingAgent
        await matchmakingAgent.leaveQueue(request.body.userId);

        return reply.send({
          success: true,
          message: 'Left queue',
        });
      } catch (error) {
        return reply.status(400).send({
          success: false,
          error: error instanceof Error ? error.message : 'Queue leave failed',
        });
      }
    }
  );

  /**
   * GET /agents/matchmaking/queue-status
   * Get matchmaking queue status
   */
  fastify.get('/agents/matchmaking/queue-status', async (request, reply) => {
    try {
      const matchmakingAgent = agentManager.getAgent(AgentType.MATCHMAKER);
      if (!matchmakingAgent) {
        return reply.status(503).send({
          success: false,
          error: 'Matchmaking Agent not available',
        });
      }

      // @ts-ignore - Cast to MatchmakingAgent
      const status = matchmakingAgent.getQueueStatus();

      return reply.send({
        success: true,
        data: status,
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // ─── AI Bot Agent Routes ───────────────────────────────────────────────

  /**
   * POST /agents/ai-bot/create
   * Create a new AI bot
   */
  fastify.post(
    '/agents/ai-bot/create',
    async (request: FastifyRequest<{
      Body: {
        name: string;
        skillLevel: 'beginner' | 'intermediate' | 'advanced' | 'expert';
        bankroll: number;
        strategy: {
          initialWager: number;
          wagerAdjustmentFactor: number;
          martingaleEnabled: boolean;
          maxConsecutiveLosses: number;
          pauseAfterWin: boolean;
          stopLossLimit: number;
        };
      };
    }>, reply) => {
      try {
        const aiBotAgent = agentManager.getAgent(AgentType.AI_BOT);
        if (!aiBotAgent) {
          return reply.status(503).send({
            success: false,
            error: 'AI Bot Agent not available',
          });
        }

        // @ts-ignore - Cast to AIBotAgent
        const botConfig = await aiBotAgent.createBot({
          ...request.body,
          active: true,
        });

        return reply.send({
          success: true,
          data: botConfig,
        });
      } catch (error) {
        return reply.status(400).send({
          success: false,
          error: error instanceof Error ? error.message : 'Bot creation failed',
        });
      }
    }
  );

  /**
   * GET /agents/ai-bot/:botId
   * Get AI bot info
   */
  fastify.get('/agents/ai-bot/:botId', async (request: FastifyRequest<{
    Params: { botId: string };
  }>, reply) => {
    try {
      const aiBotAgent = agentManager.getAgent(AgentType.AI_BOT);
      if (!aiBotAgent) {
        return reply.status(503).send({
          success: false,
          error: 'AI Bot Agent not available',
        });
      }

      // @ts-ignore - Cast to AIBotAgent
      const bot = aiBotAgent.getBot(request.params.botId);
      if (!bot) {
        return reply.status(404).send({
          success: false,
          error: 'Bot not found',
        });
      }

      return reply.send({
        success: true,
        data: bot,
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /agents/ai-bot/:botId/actions
   * Get bot actions history
   */
  fastify.get('/agents/ai-bot/:botId/actions', async (request: FastifyRequest<{
    Params: { botId: string };
    Querystring: { limit?: string };
  }>, reply) => {
    try {
      const aiBotAgent = agentManager.getAgent(AgentType.AI_BOT);
      if (!aiBotAgent) {
        return reply.status(503).send({
          success: false,
          error: 'AI Bot Agent not available',
        });
      }

      const limit = request.query.limit ? parseInt(request.query.limit) : 100;

      // @ts-ignore - Cast to AIBotAgent
      const actions = aiBotAgent.getBotActions(request.params.botId, limit);

      return reply.send({
        success: true,
        data: actions,
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /agents/ai-bot/active
   * List all active bots
   */
  fastify.get('/agents/ai-bot/active', async (request, reply) => {
    try {
      const aiBotAgent = agentManager.getAgent(AgentType.AI_BOT);
      if (!aiBotAgent) {
        return reply.status(503).send({
          success: false,
          error: 'AI Bot Agent not available',
        });
      }

      // @ts-ignore - Cast to AIBotAgent
      const bots = aiBotAgent.listActiveBots();

      return reply.send({
        success: true,
        data: bots,
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  console.log('[boot] Agent routes registered ✓');
}
