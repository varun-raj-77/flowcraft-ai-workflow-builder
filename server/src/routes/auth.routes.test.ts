import express from 'express';
import cookieParser from 'cookie-parser';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { AppError, errorHandler } from '../middleware/errorHandler.middleware';

const authService = vi.hoisted(() => ({
  register: vi.fn(),
  login: vi.fn(),
  getMe: vi.fn(),
  changePassword: vi.fn(),
}));

vi.mock('../services/auth.service', () => authService);
vi.mock('../config/environment', () => ({
  env: {
    NODE_ENV: 'test',
    JWT_SECRET: 'change-password-test-secret',
    DEMO_ACCOUNT_EMAIL: 'demo@flowcraft.app',
  },
}));

import authRoutes from './auth.routes';
import { signToken } from '../utils/jwt';

let server: Server;
let baseUrl: string;
const token = signToken({ userId: 'user-1' });

function post(body: unknown, authenticated = true) {
  return fetch(`${baseUrl}/api/auth/change-password`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(authenticated ? { cookie: `token=${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRoutes);
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

describe('POST /api/auth/change-password', () => {
  it('rejects unauthenticated requests', async () => {
    const response = await post({ currentPassword: 'current-password', newPassword: 'new-password' }, false);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: 'MISSING_TOKEN', message: 'Authentication required' } });
    expect(authService.changePassword).not.toHaveBeenCalled();
  });

  it('rejects malformed requests before the service runs', async () => {
    const response = await post({ currentPassword: '', newPassword: 'short' });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    expect(authService.changePassword).not.toHaveBeenCalled();
  });

  it('rejects client-supplied account targeting fields', async () => {
    const response = await post({
      currentPassword: 'current-password',
      newPassword: 'new-password',
      email: 'other@example.com',
      userId: 'user-2',
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    expect(authService.changePassword).not.toHaveBeenCalled();
  });

  it('uses only the authenticated user, preserves the session, and returns no sensitive fields', async () => {
    authService.changePassword.mockResolvedValue(undefined);
    authService.getMe.mockResolvedValue({
      email: 'user@example.com',
      toJSON: () => ({ _id: 'user-1', email: 'user@example.com', displayName: 'User' }),
    });

    const response = await post({ currentPassword: 'current-password', newPassword: 'new-password' });
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(authService.changePassword).toHaveBeenCalledWith('user-1', {
      currentPassword: 'current-password',
      newPassword: 'new-password',
    });
    expect(result).toEqual({ data: { success: true, message: 'Password changed successfully.' } });
    expect(JSON.stringify(result)).not.toContain('passwordHash');

    const meResponse = await fetch(`${baseUrl}/api/auth/me`, { headers: { cookie: `token=${token}` } });
    expect(meResponse.status).toBe(200);
    expect(await meResponse.json()).toMatchObject({ data: { _id: 'user-1', isDemoAccount: false } });
  });

  it('preserves the stable demo-account authorization error', async () => {
    authService.changePassword.mockRejectedValue(new AppError(
      403,
      'DEMO_ACCOUNT_RESTRICTED',
      'This action is unavailable in the shared demo account.',
    ));
    const response = await post({ currentPassword: 'current-password', newPassword: 'new-password' });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: {
        code: 'DEMO_ACCOUNT_RESTRICTED',
        message: 'This action is unavailable in the shared demo account.',
      },
    });
  });
});
