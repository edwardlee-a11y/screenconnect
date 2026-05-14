import { create } from 'zustand';
import type { User } from '../api/client';

interface AuthState {
  token: string | null;
  user: User | null;
  setAuth: (token: string, user: User) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem('rs_token'),
  user: null,

  setAuth: (token, user) => {
    localStorage.setItem('rs_token', token);
    set({ token, user });
  },

  logout: () => {
    localStorage.removeItem('rs_token');
    set({ token: null, user: null });
  },
}));
