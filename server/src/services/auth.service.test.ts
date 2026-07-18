import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../middleware/errorHandler.middleware';

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  updateOne: vi.fn(),
  comparePassword: vi.fn(),
  hashPassword: vi.fn(),
  isDemoAccountEmail: vi.fn(),
}));

vi.mock('../models/User.model', () => ({
  User: { findById: mocks.findById, updateOne: mocks.updateOne },
}));
vi.mock('../utils/password', () => ({
  comparePassword: mocks.comparePassword,
  hashPassword: mocks.hashPassword,
}));
vi.mock('../utils/demoAccount', () => ({ isDemoAccountEmail: mocks.isDemoAccountEmail }));

import { changePassword } from './auth.service';

function returnUser(user: { _id: string; email: string; passwordHash: string } | null) {
  const select = vi.fn().mockResolvedValue(user);
  mocks.findById.mockReturnValue({ select });
  return select;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isDemoAccountEmail.mockReturnValue(false);
  mocks.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
});

describe('changePassword', () => {
  it('verifies the current password and persists only a newly hashed password', async () => {
    const select = returnUser({ _id: 'user-1', email: 'user@example.com', passwordHash: 'existing-hash' });
    mocks.comparePassword.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    mocks.hashPassword.mockResolvedValue('new-bcrypt-hash');

    await changePassword('user-1', { currentPassword: 'current-password', newPassword: 'new-password' });

    expect(select).toHaveBeenCalledWith('+passwordHash');
    expect(mocks.comparePassword).toHaveBeenNthCalledWith(1, 'current-password', 'existing-hash');
    expect(mocks.comparePassword).toHaveBeenNthCalledWith(2, 'new-password', 'existing-hash');
    expect(mocks.hashPassword).toHaveBeenCalledWith('new-password');
    expect(mocks.updateOne).toHaveBeenCalledWith(
      { _id: 'user-1' },
      { $set: { passwordHash: 'new-bcrypt-hash' } },
    );
    expect(JSON.stringify(mocks.updateOne.mock.calls)).not.toContain('current-password');
    expect(JSON.stringify(mocks.updateOne.mock.calls)).not.toContain('new-password');
  });

  it('rejects an incorrect current password without hashing or persisting', async () => {
    returnUser({ _id: 'user-1', email: 'user@example.com', passwordHash: 'existing-hash' });
    mocks.comparePassword.mockResolvedValue(false);

    await expect(changePassword('user-1', { currentPassword: 'wrong-password', newPassword: 'new-password' }))
      .rejects.toMatchObject({ statusCode: 400, code: 'CURRENT_PASSWORD_INCORRECT' });
    expect(mocks.hashPassword).not.toHaveBeenCalled();
    expect(mocks.updateOne).not.toHaveBeenCalled();
  });

  it('rejects a new password that matches the stored current password', async () => {
    returnUser({ _id: 'user-1', email: 'user@example.com', passwordHash: 'existing-hash' });
    mocks.comparePassword.mockResolvedValueOnce(true).mockResolvedValueOnce(true);

    await expect(changePassword('user-1', { currentPassword: 'same-password', newPassword: 'same-password' }))
      .rejects.toMatchObject({ statusCode: 400, code: 'PASSWORD_UNCHANGED' });
    expect(mocks.updateOne).not.toHaveBeenCalled();
  });

  it('rejects the configured demo account before password verification', async () => {
    returnUser({ _id: 'demo-1', email: 'DEMO@FLOWCRAFT.APP', passwordHash: 'demo-hash' });
    mocks.isDemoAccountEmail.mockReturnValue(true);

    await expect(changePassword('demo-1', { currentPassword: 'demo-password', newPassword: 'new-password' }))
      .rejects.toMatchObject({ statusCode: 403, code: 'DEMO_ACCOUNT_RESTRICTED' });
    expect(mocks.isDemoAccountEmail).toHaveBeenCalledWith('DEMO@FLOWCRAFT.APP');
    expect(mocks.comparePassword).not.toHaveBeenCalled();
    expect(mocks.updateOne).not.toHaveBeenCalled();
  });

  it('returns a safe error when persistence fails', async () => {
    returnUser({ _id: 'user-1', email: 'user@example.com', passwordHash: 'existing-hash' });
    mocks.comparePassword.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    mocks.hashPassword.mockResolvedValue('new-bcrypt-hash');
    mocks.updateOne.mockRejectedValue(new Error('database connection detail'));

    await expect(changePassword('user-1', { currentPassword: 'current-password', newPassword: 'new-password' }))
      .rejects.toEqual(new AppError(500, 'PASSWORD_CHANGE_FAILED', 'Unable to change your password right now. Please try again.'));
  });

  it('does not modify an unrelated user record', async () => {
    returnUser({ _id: 'user-1', email: 'user@example.com', passwordHash: 'existing-hash' });
    mocks.comparePassword.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    mocks.hashPassword.mockResolvedValue('new-bcrypt-hash');

    await changePassword('user-1', { currentPassword: 'current-password', newPassword: 'new-password' });

    expect(mocks.findById).toHaveBeenCalledWith('user-1');
    expect(mocks.updateOne).toHaveBeenCalledWith(expect.objectContaining({ _id: 'user-1' }), expect.anything());
    expect(JSON.stringify(mocks.updateOne.mock.calls)).not.toContain('user-2');
  });
});
