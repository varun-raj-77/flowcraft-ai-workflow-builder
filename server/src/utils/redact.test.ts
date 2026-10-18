import { describe, expect, it } from 'vitest';
import { redactSecrets, redactText } from './redact';
import { truncateOutput } from '../services/execution/templateEngine';

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

  it('redacts passwords embedded in connection URIs', () => {
    expect(redactText('mongodb+srv://operator:database-password@example.test/flowcraft'))
      .toBe('mongodb+srv://operator:[REDACTED]@example.test/flowcraft');
  });

  it('redacts nested JSON fields including arrays and credential objects without dropping public fields', () => {
    const original = JSON.stringify({
      status: 200, credentials: { username: 'account-holder', password: 'private-pass' },
      items: [{ apiKey: 'private-api-key', count: 3 }],
      headers: { Authorization: 'Basic private-auth', accept: 'application/json' },
    });
    const redacted = JSON.parse(redactText(original));
    expect(redacted).toEqual({
      status: 200, credentials: '[REDACTED]',
      items: [{ apiKey: '[REDACTED]', count: 3 }],
      headers: { Authorization: '[REDACTED]', accept: 'application/json' },
    });
    expect(JSON.stringify(redacted)).not.toMatch(/account-holder|private-pass|private-api-key|private-auth/);
  });

  it('redacts embedded JSON without truncating quoted values at commas, spaces or escaped quotes', () => {
    const input = 'Output: {"password":"a \\"quoted\\" password, with spaces","count":2}';
    const redacted = redactText(input);
    expect(redacted).toBe('Output: {"password":"[REDACTED]","count":2}');
    expect(redacted).not.toContain('quoted');
  });

  it('redacts quoted plain-text assignments and keeps nonsensitive messages unchanged', () => {
    expect(redactText('password="some secret with spaces" finished'))
      .toBe('password=[REDACTED] finished');
    expect(redactText('Result: {"count":2,"ready":true}'))
      .toBe('Result: {"count":2,"ready":true}');
  });

  it('redacts nested JSON text in log previews and runtime context', () => {
    const input = { output: { message: '{"api_key":"demo-private","result":42}' } };
    expect(redactSecrets(input)).toEqual({
      output: { message: '{"api_key":"[REDACTED]","result":42}' },
    });
    const truncated = truncateOutput(input);
    expect(JSON.stringify(truncated)).not.toContain('demo-private');
    expect(truncated).toEqual({
      output: { message: '{"api_key":"[REDACTED]","result":42}' },
    });
  });

  it('does not accidentally hide safe boolean, numerical or string outputs', () => {
    const original = { status: 200, data: { message: 'Hello world', count: 7, enabled: false } };
    expect(redactSecrets(original)).toEqual(original);
  });
});
