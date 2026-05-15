import { create } from 'zustand';

export type ConnectionStatus =
  | 'idle'
  | 'registering'
  | 'online'
  | 'agent_joined'
  | 'sharing'
  | 'error'
  | 'offline';

export interface Attachment {
  name: string;
  type: string;
  data: string; // base64
}

export interface ChatMessage {
  id: string;
  role: 'agent' | 'device' | 'sys';
  text: string;
  ts: string;
  attachment?: Attachment;
}

interface DeviceState {
  deviceId: string | undefined;
  sessionCode: string | undefined;
  sessionId: string | undefined;
  status: ConnectionStatus;
  errorMsg: string | undefined;
  chat: ChatMessage[];

  setDevice: (id: string, code: string) => void;
  setStatus: (s: ConnectionStatus, err?: string) => void;
  setSessionId: (id: string | undefined) => void;
  addChat: (msg: Omit<ChatMessage, 'id'>) => void;
  clearSession: () => void;
}

export const useDeviceStore = create<DeviceState>((set) => ({
  deviceId:    undefined,
  sessionCode: undefined,
  sessionId:   undefined,
  status:      'idle',
  errorMsg:    undefined,
  chat:        [],

  setDevice: (id, code) => set({ deviceId: id, sessionCode: code }),

  setStatus: (status, errorMsg) => set({ status, errorMsg }),

  setSessionId: (sessionId) => set({ sessionId }),

  addChat: (msg) =>
    set((s) => ({
      chat: [...s.chat, { ...msg, id: Math.random().toString(36).slice(2) }],
    })),

  clearSession: () =>
    set({ sessionId: undefined, status: 'online', chat: [], errorMsg: undefined }),
}));
