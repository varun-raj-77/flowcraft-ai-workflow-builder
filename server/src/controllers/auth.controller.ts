import { type Request, type Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import * as authService from '../services/auth.service';
import * as socketTicketService from '../services/socketTicket.service';
import { env } from '../config/environment';
import { isDemoAccountEmail } from '../utils/demoAccount';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/',
};

const CLEAR_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
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
  res.clearCookie('token', CLEAR_COOKIE_OPTIONS);
  res.json({ data: { message: 'Logged out' } });
});

// ── GET /api/auth/me ────────────────────────────────────────

export const getMe = asyncHandler(async (req: Request, res: Response) => {
  const user = await authService.getMe(req.userId!);
  res.json({
    data: {
      ...user.toJSON(),
      isDemoAccount: isDemoAccountEmail(user.email),
    },
  });
});

export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  await authService.changePassword(req.userId!, req.body);
  res.json({
    data: {
      success: true,
      message: 'Password changed successfully.',
    },
  });
});

/** Creates a one-time, 60-second credential for the direct Socket.IO handshake. */
export const createSocketTicket = asyncHandler(async (req: Request, res: Response) => {
  const ticket = await socketTicketService.createSocketTicket(req.userId!);
  res.json({ data: { ticket } });
});
