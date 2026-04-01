import { type Request, type Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import * as authService from '../services/auth.service';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,                 // ALWAYS true in production
  sameSite: 'none' as const,    // CRITICAL FIX
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/',
};

// ── POST /api/auth/register ─────────────────────────────────

export const register = asyncHandler(async (req: Request, res: Response) => {
  const { user, token } = await authService.register(req.body);

  res.cookie('token', token, COOKIE_OPTIONS);
  res.status(201).json({ data: user });
});

// ── POST /api/auth/login ────────────────────────────────────

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { user, token } = await authService.login(req.body);

  res.cookie('token', token, COOKIE_OPTIONS);
  res.json({ data: user });
});

// ── POST /api/auth/logout ───────────────────────────────────

export const logout = asyncHandler(async (_req: Request, res: Response) => {
  res.clearCookie('token', { path: '/' });
  res.json({ data: { message: 'Logged out' } });
});

// ── GET /api/auth/me ────────────────────────────────────────

export const getMe = asyncHandler(async (req: Request, res: Response) => {
  const user = await authService.getMe(req.userId!);
  res.json({ data: user });
});
