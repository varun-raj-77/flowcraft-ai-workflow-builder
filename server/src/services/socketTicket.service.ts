import { createHash, randomBytes } from 'crypto';
import { SocketTicket } from '../models/SocketTicket.model';

const TICKET_TTL_MS = 60_000;

function hashTicket(ticket: string): string {
  return createHash('sha256').update(ticket).digest('hex');
}

export async function createSocketTicket(userId: string): Promise<string> {
  const ticket = randomBytes(32).toString('base64url');
  await SocketTicket.create({
    tokenHash: hashTicket(ticket),
    userId,
    expiresAt: new Date(Date.now() + TICKET_TTL_MS),
  });
  return ticket;
}

/** One-time consumption prevents replay of the browser-visible socket ticket. */
export async function consumeSocketTicket(ticket: string): Promise<string | null> {
  const record = await SocketTicket.findOneAndDelete({
    tokenHash: hashTicket(ticket),
    expiresAt: { $gt: new Date() },
  });
  return record?.userId ?? null;
}
