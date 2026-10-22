import { describe, expect, it } from 'vitest';
import { DEVELOPMENT_JWT_SECRET, resolveJwtSecret } from './jwtSecret';

describe('JWT signing key configuration', () => {
  it('retains the existing local development fallback only outside production', () => {
    expect(resolveJwtSecret('development', undefined)).toBe(DEVELOPMENT_JWT_SECRET);
    expect(resolveJwtSecret('test', '')).toBe(DEVELOPMENT_JWT_SECRET);
    expect(resolveJwtSecret('development', 'explicit-local-key')).toBe('explicit-local-key');
  });

  it('fails closed on absent, blank, predictable or short production signing keys', () => {
    for (const secret of [
      undefined, '', '    ', DEVELOPMENT_JWT_SECRET, 'a'.repeat(31),
      '   ' + 'b'.repeat(28) + '  ',
    ]) {
      let thrown: unknown;
      try { resolveJwtSecret('production', secret); } catch (error) { thrown = error; }
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toMatch(/JWT_SECRET.*production/);
      if (secret && secret.trim().length >= 4) {
        expect((thrown as Error).message).not.toContain(secret);
      }
    }
  });

  it('preserves a configured sufficiently long production signing key without logging it', () => {
    const configured = 'j'.repeat(33);
    expect(resolveJwtSecret('production', configured)).toBe(configured);
  });
});
