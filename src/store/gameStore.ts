import { create } from 'zustand';
import type { SpinResult, WheelSegment } from '../services/api';
import type { JackpotPayload, LeaderboardEntry } from '../services/socket';

const MAX_JACKPOT_HISTORY = 10;

interface GameState {
  sessionId: string | null;
  serverSeedHash: string | null;
  isSpinning: boolean;
  lastResult: SpinResult | null;
  wheelSegments: WheelSegment[];
  minWager: number;
  maxWager: number;
  wager: number;

  // Room state
  currentRoomTier: number | null;
  roomPlayerCount: number;
  roomPlayers: string[];
  isRoomReady: boolean;

  // Real-time socket state
  jackpotHistory: JackpotPayload[];
  liveLeaderboard: LeaderboardEntry[];

  setSession: (sessionId: string, serverSeedHash: string) => void;
  clearSession: () => void;
  setSpinning: (val: boolean) => void;
  setLastResult: (result: SpinResult) => void;
  setWheelConfig: (segments: WheelSegment[], min: number, max: number) => void;
  setWager: (val: number) => void;
  setCurrentRoom: (tier: number | null) => void;
  updateRoomPlayers: (tier: number, players: string[], isReady: boolean) => void;
  addJackpot: (payload: JackpotPayload) => void;
  setLiveLeaderboard: (entries: LeaderboardEntry[]) => void;
}

export const useGameStore = create<GameState>((set) => ({
  sessionId:       null,
  serverSeedHash:  null,
  isSpinning:      false,
  lastResult:      null,
  wheelSegments:   [],
  minWager:        0.10,
  maxWager:        10000.00,
  wager:           1.00,
  jackpotHistory:  [],
  liveLeaderboard: [],

  currentRoomTier:  null,
  roomPlayerCount:  0,
  roomPlayers:      [],
  isRoomReady:      false,

  setSession: (sessionId, serverSeedHash) =>
    set({ sessionId, serverSeedHash }),

  clearSession: () =>
    set({ sessionId: null, serverSeedHash: null, lastResult: null }),

  setSpinning: (val) => set({ isSpinning: val }),

  setLastResult: (result) => set({ lastResult: result }),

  setWheelConfig: (segments, min, max) =>
    set({ wheelSegments: segments, minWager: min, maxWager: max }),

  setWager: (val) => set({ wager: val }),

  setCurrentRoom: (tier) =>
    set({ currentRoomTier: tier, roomPlayerCount: 0, roomPlayers: [], isRoomReady: false }),

  updateRoomPlayers: (tier, players, isReady) =>
    set((state) =>
      state.currentRoomTier === tier
        ? { roomPlayerCount: players.length, roomPlayers: players, isRoomReady: isReady }
        : {},
    ),

  addJackpot: (payload) =>
    set((state) => ({
      jackpotHistory: [payload, ...state.jackpotHistory].slice(0, MAX_JACKPOT_HISTORY),
    })),

  setLiveLeaderboard: (entries) => set({ liveLeaderboard: entries }),
}));
