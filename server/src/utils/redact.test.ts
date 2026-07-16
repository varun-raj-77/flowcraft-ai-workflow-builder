import { describe, expect, it } from 'vitest';
import { redactSecrets, redactText } from './redact';

describe('secret redaction', () => {
  it('redacts sensitive object fields recursively before execution logging', () => {
    expect(redactSecrets({
      headers: { Authorization: 'Bearer super-secret', accept: 'application/json' },
      nested: { apiKey: 'key-123' },
    })).toEqual({
      headers: { Authorization: '[REDACTED]', accept: 'application/json' },
      nested: { apiKey: '[REDACTED]' },
    });
  });

  it('redacts common secret-shaped text before console output', () => {
    expect(redactText('Authorization: Bearer value token=abc')).toBe('Authorization: Bearer [REDACTED] token=[REDACTED]');
  });
});
