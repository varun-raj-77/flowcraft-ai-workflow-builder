import { describe, expect, it } from 'vitest';
import { migrationExitCode, verificationExitCode } from './maintenanceExitCode';

describe('workflow revision maintenance exit codes', () => {
  it('keeps successful and idempotent migration summaries successful', () => {
    expect(migrationExitCode({ invalid: 0, integrityErrors: 0, failed: 0 })).toBe(0);
  });

  it.each([
    { invalid: 1, integrityErrors: 0, failed: 0 },
    { invalid: 0, integrityErrors: 1, failed: 0 },
    { invalid: 0, integrityErrors: 0, failed: 1 },
  ])('fails migration for invalid, corrupt, or failed records: %o', (summary) => {
    expect(migrationExitCode(summary)).toBe(1);
  });

  it('fails verification only when integrity errors are present', () => {
    expect(verificationExitCode({ integrityErrors: 0 })).toBe(0);
    expect(verificationExitCode({ integrityErrors: 1 })).toBe(1);
  });
});
