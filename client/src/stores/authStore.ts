import { create } from 'zustand';
import * as api from '@/lib/api';

let authOperation = 0;

interface User {
  _id: string;
  email: string;
  displayName: string;
  isDemoAccount: boolean;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  checkAuth: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<api.ChangePasswordResult>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true, // Starts true — resolved by checkAuth on app mount

  checkAuth: async () => {
    const operation = ++authOperation;
    set({ isLoading: true });
    try {
      const user = await api.getMe();
      if (operation === authOperation) {
        set({ user, isAuthenticated: true, isLoading: false });
      }
    } catch {
      if (operation === authOperation) {
        set({ user: null, isAuthenticated: false, isLoading: false });
      }
    }
  },

  login: async (email, password) => {
    const operation = ++authOperation;
    set({ isLoading: true });
    try {
      await api.login({ email, password });
      const user = await api.getMe();
      if (operation === authOperation) {
        set({ user, isAuthenticated: true, isLoading: false });
      }
    } catch (error) {
      if (operation === authOperation) {
        set({ user: null, isAuthenticated: false, isLoading: false });
      }
      if (error instanceof api.ApiError && error.code === 'MISSING_TOKEN') {
        throw new api.ApiError(401, 'SESSION_NOT_ESTABLISHED', 'We could not establish a secure session. Please try again.');
      }
      throw error;
    }
  },

  register: async (email, password, displayName) => {
    const operation = ++authOperation;
    set({ isLoading: true });
    try {
      await api.register({ email, password, displayName });
      const user = await api.getMe();
      if (operation === authOperation) {
        set({ user, isAuthenticated: true, isLoading: false });
      }
    } catch (error) {
      if (operation === authOperation) {
        set({ user: null, isAuthenticated: false, isLoading: false });
      }
      if (error instanceof api.ApiError && error.code === 'MISSING_TOKEN') {
        throw new api.ApiError(401, 'SESSION_NOT_ESTABLISHED', 'We could not establish a secure session. Please try again.');
      }
      throw error;
    }
  },

  changePassword: (currentPassword, newPassword) => api.changePassword({ currentPassword, newPassword }),

  logout: async () => {
    ++authOperation;
    try {
      await api.logout();
    } finally {
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },
}));
