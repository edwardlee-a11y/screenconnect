import { io, Socket } from 'socket.io-client';
import Constants from 'expo-constants';
import { useAuthStore } from '../store/authStore';

const BASE_URL = (Constants.expoConfig?.extra?.apiUrl as string) ?? 'http://localhost:3000';

// ─── Event type definitions (mirror backend gameSocket.ts) ─────────────────

export interface SpinResultPayload {
  outcomeIndex: number;
  outcomeLabel: string;
  multiplier: number;
  wagerUsd: number;
  payoutUsd: number;
  netChangeUsd: number;
  newBalanceUsd: number;
  nonce: number;
  serverSeedHash: string;
}

export interface JackpotPayload {
  username: string;
  payoutUsd: number;
  outcomeLabel: string;
  timestamp: string;
}

export interface ChatPayload {
  username: string;
  message: string;
  timestamp: string;
}

export interface LeaderboardEntry {
  username: string;
  payoutUsd: number;
}

type ServerToClient = {
  'game:spin:result':   (p: SpinResultPayload) => void;
  'game:spin:error':    (p: { message: string; code?: string }) => void;
  'game:jackpot':       (p: JackpotPayload) => void;
  'game:player:joined': (p: { username: string; sessionId: string }) => void;
  'game:player:left':   (p: { username: string; sessionId: string }) => void;
  'leaderboard:update': (p: LeaderboardEntry[]) => void;
  'chat:message':       (p: ChatPayload) => void;
  'error':              (p: { message: string; code?: string }) => void;
};

type ClientToServer = {
  'game:join':    (p: { sessionId: string }) => void;
  'game:leave':   () => void;
  'chat:message': (p: { message: string }) => void;
};

// ─── Singleton socket instance ──────────────────────────────────────────────

let _socket: Socket<ServerToClient, ClientToServer> | null = null;

/**
 * Return the shared socket, creating it on first call.
 * The JWT token is read lazily from the auth store so it's always fresh.
 */
export function getSocket(): Socket<ServerToClient, ClientToServer> {
  if (!_socket) {
    _socket = io(BASE_URL, {
      autoConnect: false,
      transports: ['websocket'],
      auth: (cb) => {
        const token = useAuthStore.getState().token;
        cb({ token });
      },
    });

    _socket.on('connect_error', (err) => {
      console.warn('[socket] connect error:', err.message);
    });
  }
  return _socket;
}

/** Connect the socket (call after the user logs in). */
export function connectSocket(): void {
  const socket = getSocket();
  if (!socket.connected) socket.connect();
}

/** Disconnect and destroy the socket (call on logout). */
export function disconnectSocket(): void {
  if (_socket) {
    _socket.disconnect();
    _socket = null;
  }
}

/** Emit game:join for the given session. */
export function joinGameSession(sessionId: string): void {
  getSocket().emit('game:join', { sessionId });
}

/** Emit game:leave. */
export function leaveGameSession(): void {
  if (_socket?.connected) {
    _socket.emit('game:leave');
  }
}
