import { describe, expect, it } from 'vitest';
import { comparePassword, hashPassword } from './password';

describe('password hashing', () => {
  it('stores a bcrypt hash and accepts only the new password after replacement', async () => {
    const oldHash = await hashPassword('old-password');
    const newHash = await hashPassword('new-password');

    expect(oldHash).not.toBe('old-password');
    expect(newHash).not.toBe('new-password');
    expect(await comparePassword('old-password', oldHash)).toBe(true);
    expect(await comparePassword('old-password', newHash)).toBe(false);
    expect(await comparePassword('new-password', newHash)).toBe(true);
  });
});
