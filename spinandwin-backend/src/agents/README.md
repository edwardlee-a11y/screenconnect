# Game Agent System

A comprehensive multi-agent system for the Spin & Win crypto game backend. This system handles all major game operations through specialized, autonomous agents.

## Overview

The agent system consists of 5 specialized agents that work together to manage game operations:

### 1. **Game Logic Agent** (GameLogicAgent)
Handles core game mechanics: wheel spins, outcome calculation, and game state management.

**Responsibilities:**
- Process spin requests
- Calculate outcomes using provably fair algorithm
- Update session statistics
- Manage player balances
- Track metrics and health

**Key Methods:**
- `processSpin(request: GameSpinRequest)` - Execute a spin and return result
- `getMetrics()` - Get processing metrics
- `healthCheck()` - Verify agent health

### 2. **Matchmaking Agent** (MatchmakingAgent)
Manages player matching for multiplayer games and tournaments.

**Responsibilities:**
- Maintain matchmaking queue
- Group players by game type and stake
- Create matches when enough players available
- Notify players of match found
- Manage match lifecycle

**Key Methods:**
- `joinQueue(request: MatchmakingRequest)` - Add player to queue
- `leaveQueue(userId: string)` - Remove player from queue
- `getMatch(matchId: string)` - Get match details
- `endMatch(matchId: string)` - Finish match
- `startMatchLoop()` / `stopMatchLoop()` - Background processing
- `getQueueStatus()` - Get queue metrics

### 3. **Reward Distribution Agent** (RewardDistributionAgent)
Handles prize payouts, wallet transfers, and reward tracking.

**Responsibilities:**
- Queue reward distributions
- Calculate rewards based on results
- Process on-chain transactions
- Update user balances
- Track distribution history
- Support multiple reward types (winnings, bonuses, loyalty)

**Key Methods:**
- `queueDistribution(request: RewardDistributionRequest)` - Queue rewards
- `processDistribution(distributionId: string)` - Execute distribution
- `startProcessingLoop()` / `stopProcessingLoop()` - Background processing
- `getDistributionStatus(distributionId: string)` - Check status

### 4. **Fairness Monitoring Agent** (FairnessMonitoringAgent)
Verifies game integrity, detects anomalies, and generates audit reports.

**Responsibilities:**
- Audit spins for fairness
- Detect suspicious patterns
- Monitor win rates and timing
- Identify potential cheating
- Generate fairness reports
- Alert administrators

**Key Methods:**
- `auditSpin(...)` - Verify a single spin
- `detectAnomalies(userId: string, timeWindow?: number)` - Scan for irregularities
- `generateReport(startTime: number, endTime: number)` - Create audit report
- `startMonitoringLoop()` / `stopMonitoringLoop()` - Background processing

### 5. **AI Bot Agent** (AIBotAgent)
Manages automated bot players for gameplay and testing.

**Responsibilities:**
- Create and manage AI bots
- Implement bot strategies (Martingale, standard, etc.)
- Make automated decisions
- Track bot performance
- Manage bot bankrolls
- Disable/enable bots based on conditions

**Key Methods:**
- `createBot(config)` - Create new bot
- `makeBotDecision(botId: string)` - Get bot's next action
- `updateBotAfterSpin(...)` - Update bot state after spin
- `getBot(botId: string)` - Get bot info
- `listActiveBots()` - Get all active bots
- `startBotLoop()` / `stopBotLoop()` - Background processing

## Agent Manager

The `AgentManager` class orchestrates all agents and provides centralized control.

```typescript
import { initializeAgentSystem, getAgentManager } from './agents';

// Initialize system
const manager = await initializeAgentSystem();

// Get agent status
const status = manager.getAgentsStatus();

// Get metrics
const metrics = manager.getAgentsMetrics();

// Get specific agent
const agent = manager.getAgent(AgentType.GAME_ENGINE);

// Stop all
await manager.stopAgents();
```

## Integration

### Server Initialization

Add to `src/server.ts`:

```typescript
import { initializeAgentSystem } from './agents';

// After other middleware setup
await initializeAgentSystem();
console.log('[boot] Agent system ✓');
```

### Register API Routes

Add to your route registration:

```typescript
import { registerAgentRoutes } from './routes/agentRoutes';

// Register agent routes
await registerAgentRoutes(fastify);
```

## API Endpoints

### Status & Monitoring

```
GET /agents/status         - All agents status
GET /agents/metrics        - All agents metrics
GET /agents/:type          - Specific agent info
```

### Game Logic

```
POST /agents/game-logic/spin {
  userId: string
  sessionId: string
  wagerUsd: number
  clientSeed?: string
  nonce?: number
}
```

### Matchmaking

```
POST /agents/matchmaking/join-queue {
  userId: string
  gameType: 'solo' | 'multiplayer' | 'tournament'
  stakeRange: [min, max]
  skillLevel?: string
  timezone?: string
}

POST /agents/matchmaking/leave-queue { userId: string }
GET  /agents/matchmaking/queue-status
```

### AI Bots

```
POST /agents/ai-bot/create {
  name: string
  skillLevel: 'beginner' | 'intermediate' | 'advanced' | 'expert'
  bankroll: number
  strategy: BotStrategy
}

GET  /agents/ai-bot/active
GET  /agents/ai-bot/:botId
GET  /agents/ai-bot/:botId/actions?limit=100
```

## Database Schema

The agent system requires these Supabase tables:

### game_sessions
```sql
id, user_id, status, total_spins, total_wagered_usd, total_payout_usd, created_at
```

### game_spins
```sql
id, session_id, user_id, wager_usd, segment_index, payout_usd, is_jackpot, created_at
```

### matches
```sql
id, game_type, status, player_count, created_at, started_at, ended_at
```

### match_players
```sql
match_id, user_id, wager, joined_at, position, earnings
```

### reward_distributions
```sql
id, match_id, total_distributed, blockchain_tx_hash, created_at
```

### rewards
```sql
distribution_id, user_id, amount, type, created_at
```

### fairness_audits
```sql
id, spin_id, session_id, is_verified, computed_segment, actual_segment, verified_at
```

### fairness_reports
```sql
id, period_start, period_end, total_spins, verified_spins, anomaly_count, house_edge, status, created_at
```

### suspicious_patterns
```sql
user_id, type, severity, description, detected_at
```

### ai_bots
```sql
id, name, skill_level, bankroll, active, created_at
```

### bot_strategies
```sql
bot_id, initial_wager, wager_adjustment_factor, martingale_enabled, max_consecutive_losses, pause_after_win, stop_loss_limit
```

### bot_actions
```sql
bot_id, action_type, metadata, created_at
```

## Configuration

### Redis Keys (via `config/redis.ts`)

The system uses Redis for caching and real-time coordination:

```typescript
Keys.activeSession(userId)        // Current user session
Keys.serverSeed(sessionId)         // Provably fair seed
Keys.matchmakingQueue(userId)      // Queue entry
Keys.activeMatch(matchId)          // Match data
Keys.pendingDistribution(id)       // Pending reward
```

### Metrics & Monitoring

Each agent tracks:
- `processedCount` - Total items processed
- `successCount` - Successful operations
- `errorCount` - Failed operations
- `averageProcessTime` - Avg processing time (ms)
- `uptime` - Time since creation (ms)

Health checks monitor:
- Heartbeat timeout (indicates agent stuck)
- Error rate (too many failures)
- Queue buildup (too many pending items)

## WebSocket Integration

Agents publish events via Redis pub/sub for real-time updates:

```typescript
// Player matched
redis.publish(`user:${userId}:match`, {
  event: 'match_found',
  matchId, opponents, wager
})

// Reward received
redis.publish(`user:${userId}:reward`, {
  event: 'reward_received',
  distributionId, amount, type
})

// Suspicious activity alert
redis.publish('alerts:suspicious_activity', {
  userId, type, timestamp
})
```

## Bot Strategies

### Standard Strategy
- Fixed wager amount
- No adjustment after wins/losses
- Simple, consistent gameplay

### Martingale Strategy
- Increase wager after loss
- Reset to initial on win
- Exponential growth potential (risky)

### Config Example
```typescript
{
  initialWager: 10,
  wagerAdjustmentFactor: 1.5,      // 1.5x after loss
  martingaleEnabled: true,
  maxConsecutiveLosses: 5,          // Stop after 5 losses
  pauseAfterWin: true,              // Rest after winning
  stopLossLimit: 0.5                // Stop if lose 50% of bankroll
}
```

## Fairness Features

### Provably Fair Verification
- Server seed + client seed + nonce
- HMAC-SHA256 hashing
- Verifiable segment computation
- Audit trail in database

### Anomaly Detection
1. **Win Rate Analysis** - Flag unusual win percentages
2. **Timing Analysis** - Detect suspiciously fast spins
3. **Jackpot Clustering** - Alert on excessive jackpots
4. **Seed Reuse** - Identify duplicate seeds

### Reporting
- Periodic fairness reports
- House edge calculation
- Anomaly summary
- Status indicators (clean/warning/alert)

## Error Handling & Resilience

### Automatic Recovery
- Failed distributions queued for retry
- Agent health checks with automatic restart attempts
- Graceful degradation if agent unavailable

### Circuit Breakers
- Agents disable on critical errors
- Bots pause after max losses
- Distributions skip on blockchain failure (logged)

### Logging
- Structured logs for all operations
- Detailed error messages
- Metrics available via API

## Performance Considerations

### Background Loops
- Match loop: 5-second intervals
- Reward processing: 10-second intervals
- Fairness monitoring: 60-second intervals
- Bot decision: 10-second intervals
- Health checks: 60-second intervals

### Scaling
- Agents designed for horizontal scaling
- Redis for cross-instance state
- Database for persistent storage
- No in-memory shared state

## Testing

```typescript
// Test game spin
const result = await gameLogicAgent.processSpin({
  userId: 'test-user',
  sessionId: 'test-session',
  wagerUsd: 10,
  timestamp: Date.now()
});

// Test bot creation
const bot = await aiBotAgent.createBot({
  name: 'TestBot',
  skillLevel: 'beginner',
  bankroll: 1000,
  strategy: { /* ... */ }
});

// Test fairness audit
const audit = await fairnessMonitor.auditSpin(
  spinId, sessionId, serverSeed, clientSeed, nonce, segment
);
```

## Future Enhancements

- [ ] Machine learning for bot strategy optimization
- [ ] Dynamic matching algorithms
- [ ] Blockchain integration for rewards
- [ ] Advanced anomaly detection (statistical models)
- [ ] Real-time leaderboard agent
- [ ] VIP tier management agent
- [ ] Tournament bracket agent
- [ ] Advanced analytics agent
