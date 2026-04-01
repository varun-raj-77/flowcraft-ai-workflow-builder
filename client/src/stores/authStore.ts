import { create } from 'zustand';
import * as api from '@/lib/api';

interface User {
  _id: string;
  email: string;
  displayName: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  checkAuth: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true, // Starts true — resolved by checkAuth on app mount

  checkAuth: async () => {
    set({ isLoading: true });
    try {
      const user = await api.getMe();
      set({ user, isAuthenticated: true, isLoading: false });
    } catch {
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },

  login: async (email, password) => {
    const user = await api.login({ email, password });
    set({ user, isAuthenticated: true });
  },

  register: async (email, password, displayName) => {
    const user = await api.register({ email, password, displayName });
    set({ user, isAuthenticated: true });
  },

  logout: async () => {
    try {
      await api.logout();
    } finally {
      set({ user: null, isAuthenticated: false });
    }
  },
}));
