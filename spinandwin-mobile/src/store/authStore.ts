import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { firebaseSignOut } from '../services/firebase';
import { connectSocket, disconnectSocket } from '../services/socket';

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  balanceUsd: number;
  balanceSpin: number;
  walletAddress: string | null;
  kycVerified: boolean;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  isLoading: boolean;

  setAuth: (token: string, user: AuthUser) => Promise<void>;
  updateUser: (partial: Partial<AuthUser>) => void;
  clearAuth: () => Promise<void>;
  loadFromStorage: () => Promise<void>;
}

const TOKEN_KEY = '@spinandwin:token';
const USER_KEY  = '@spinandwin:user';

export const useAuthStore = create<AuthState>((set) => ({
  token:     null,
  user:      null,
  isLoading: true,

  setAuth: async (token, user) => {
    await AsyncStorage.setItem(TOKEN_KEY, token);
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
    set({ token, user });
    connectSocket();
  },

  updateUser: (partial) =>
    set((state) => ({
      user: state.user ? { ...state.user, ...partial } : null,
    })),

  clearAuth: async () => {
    disconnectSocket();
    await Promise.all([
      AsyncStorage.removeItem(TOKEN_KEY),
      AsyncStorage.removeItem(USER_KEY),
      firebaseSignOut().catch(() => { /* already signed out */ }),
    ]);
    set({ token: null, user: null });
  },

  loadFromStorage: async () => {
    try {
      const [token, userJson] = await Promise.all([
        AsyncStorage.getItem(TOKEN_KEY),
        AsyncStorage.getItem(USER_KEY),
      ]);
      if (token && userJson) {
        set({ token, user: JSON.parse(userJson) as AuthUser });
        connectSocket();
      }
    } finally {
      set({ isLoading: false });
    }
  },
}));
