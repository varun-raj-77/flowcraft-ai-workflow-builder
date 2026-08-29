import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ command: vi.fn() }));

vi.mock('mongoose', () => ({
  default: {
    connection: { db: { admin: () => ({ command: mocks.command }) } },
  },
}));

import { assertTransactionCapability } from './mongoTransaction';

beforeEach(() => {
  mocks.command.mockReset();
});

describe('MongoDB transaction capability preflight', () => {
  it.each([
    { setName: 'rs0', logicalSessionTimeoutMinutes: 30 },
    { msg: 'isdbgrid', logicalSessionTimeoutMinutes: 30 },
  ])('accepts transaction-capable topology evidence', async (hello) => {
    mocks.command.mockResolvedValue(hello);
    await expect(assertTransactionCapability()).resolves.toBeUndefined();
    expect(mocks.command).toHaveBeenCalledWith({ hello: 1 });
  });

  it('rejects a standalone before migration writes begin', async () => {
    mocks.command.mockResolvedValue({ logicalSessionTimeoutMinutes: 30 });
    await expect(assertTransactionCapability()).rejects.toMatchObject({
      statusCode: 503,
      code: 'MONGODB_TRANSACTIONS_UNSUPPORTED',
    });
  });

  it('fails conservatively when topology cannot be determined', async () => {
    mocks.command.mockRejectedValue(new Error('command unavailable'));
    await expect(assertTransactionCapability()).rejects.toMatchObject({
      statusCode: 503,
      code: 'MONGODB_TRANSACTION_PREFLIGHT_FAILED',
    });
  });
});
