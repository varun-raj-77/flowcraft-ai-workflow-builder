import { describe, expect, it } from 'vitest';
import { isDemoAccountEmail } from './demoAccount';

describe('demo account identity', () => {
  it('normalizes configured demo email matching without restricting unrelated users', () => {
    expect(isDemoAccountEmail('  DEMO@FLOWCRAFT.APP ')).toBe(true);
    expect(isDemoAccountEmail('user@example.com')).toBe(false);
  });
});
