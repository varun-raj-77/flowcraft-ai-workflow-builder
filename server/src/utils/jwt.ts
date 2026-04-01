import jwt from 'jsonwebtoken';
import { env } from '../config/environment';

interface TokenPayload {
  userId: string;
}

const TOKEN_EXPIRY = '7d';

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, env.JWT_SECRET) as TokenPayload;
}
