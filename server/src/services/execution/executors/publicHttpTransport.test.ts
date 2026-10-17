import { EventEmitter } from 'node:events';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const hooks = vi.hoisted(() => ({ httpsRequest: vi.fn(), httpRequest: vi.fn(), dnsLookup: vi.fn() }));
vi.mock('node:https', () => ({ request: hooks.httpsRequest }));
vi.mock('node:http', () => ({ request: hooks.httpRequest }));
vi.mock('node:dns', () => ({ lookup: hooks.dnsLookup }));

import {
  isPublicIPv4, validatePublicApiUrl, requestPublicHttp,
  MAX_API_RESPONSE_BYTES, MAX_API_BODY_BYTES,
} from './publicHttpTransport';

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); });

function fakeSocket(onResponse?: (res: EventEmitter & {
  statusCode: number;
  headers: Record<string, string>;
  destroy: () => void;
}) => void) {
  const req = new EventEmitter() as EventEmitter & {
    end: (body?: string) => void; destroy: (error: Error) => void;
  };
  let options: {
    lookup: (hostname: string, options: object, callback: (err: Error | null, ip: string, family: number) => void) => void;
  };
  req.end = vi.fn();
  req.destroy = (error) => { req.emit('error', error); };
  hooks.httpsRequest.mockImplementation((_url, opts, callback) => {
    options = opts;
    if (onResponse) {
      const res = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string>; destroy: () => void };
      res.statusCode = 200;
      res.headers = { 'content-type': 'application/json' };
      res.destroy = vi.fn();
      queueMicrotask(() => {
        options.lookup('api.example.com', {}, (err) => {
          if (err) { req.destroy(err); return; }
          callback(res);
          onResponse(res);
        });
      });
    } else {
      queueMicrotask(() => options.lookup('api.example.com', {}, (err) => {
        if (err) req.destroy(err);
      }));
    }
    return req;
  });
  return req;
}

describe('connection-bound outbound HTTP guardrails', () => {
  it('permits only routable public IPv4 and conservatively rejects reserved networks', () => {
    for (const ip of ['1.1.1.1', '8.8.8.8', '140.82.114.3', '172.15.255.255', '198.17.0.1']) {
      expect(isPublicIPv4(ip)).toBe(true);
    }
    for (const ip of [
      '127.0.0.1', '0.0.0.0', '10.1.1.1', '100.64.0.10', '100.127.255.255',
      '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.1.10',
      '192.0.0.5', '192.0.2.1', '192.88.99.1', '198.18.0.1', '198.51.100.3',
      '203.0.113.10', '224.0.0.1', '240.0.0.1', '255.255.255.255', '::1',
    ]) expect(isPublicIPv4(ip)).toBe(false);
  });

  it('rejects non-HTTP schemes, loopback aliases, credentials, private IPs and numeric disguises', () => {
    for (const url of [
      'file:///etc/passwd', 'ftp://example.com/file', 'http://localhost:8080/',
      'http://metadata.google.internal/', 'http://service.local/path',
      'http://127.1/', 'http://0x7f000001/', 'http://2130706433/latest/meta-data',
      'http://169.254.169.254/latest/meta-data/', 'https://[::ffff:127.0.0.1]/',
      'http://10.0.0.1', 'https://user:pass@example.com/',
      'https://example.com/path#fragment', 'https://dev.test/',
    ]) expect(() => validatePublicApiUrl(url)).toThrow();
    expect(validatePublicApiUrl('https://api.github.com/repos/example/example/issues').hostname).toBe('api.github.com');
    expect(validatePublicApiUrl('https://8.8.8.8/dns-query').hostname).toBe('8.8.8.8');
  });

  it('fails closed when DNS at connection time resolves to a private network', async () => {
    const req = fakeSocket();
    hooks.dnsLookup.mockImplementation((_host, _options, done) => done(null, [{ address: '10.1.2.3', family: 4 }]));
    await expect(requestPublicHttp('https://api.example.com/', {
      method: 'GET', headers: {}, timeoutMs: 500,
    })).rejects.toThrow('destination is not permitted');
    expect(hooks.dnsLookup).toHaveBeenCalledWith('api.example.com', { all: true, family: 4 }, expect.any(Function));
    expect(req.end).toHaveBeenCalledOnce();
  });

  it('rejects mixed public/private DNS answers instead of choosing only a public answer', async () => {
    fakeSocket();
    hooks.dnsLookup.mockImplementation((_host, _options, done) => done(null, [
      { address: '8.8.8.8', family: 4 }, { address: '169.254.169.254', family: 4 },
    ]));
    await expect(requestPublicHttp('https://api.example.com/', {
      method: 'GET', headers: {}, timeoutMs: 500,
    })).rejects.toThrow('destination is not permitted');
  });

  it('uses the same validated socket lookup for successful outbound requests', async () => {
    fakeSocket((res) => {
      res.emit('data', Buffer.from('{"ok":true}'));
      res.emit('end');
    });
    hooks.dnsLookup.mockImplementation((_host, _options, done) => done(null, [{ address: '8.8.8.8', family: 4 }]));
    const result = await requestPublicHttp('https://api.example.com/public', {
      method: 'GET', headers: { Accept: 'application/json' }, timeoutMs: 500,
    });
    expect(result).toEqual({
      status: 200, data: { ok: true }, headers: { 'content-type': 'application/json' },
    });
  });

  it('terminates oversized response streams rather than reading them into memory', async () => {
    fakeSocket((res) => { res.emit('data', Buffer.alloc(MAX_API_RESPONSE_BYTES + 1)); });
    hooks.dnsLookup.mockImplementation((_host, _options, done) => done(null, [{ address: '8.8.8.8', family: 4 }]));
    await expect(requestPublicHttp('https://api.example.com/public', {
      method: 'GET', headers: {}, timeoutMs: 500,
    })).rejects.toThrow('exceeds 512 KB');
  });

  it('rejects redirect responses and never requests their Location header', async () => {
    fakeSocket((res) => { res.statusCode = 302; res.headers.location = 'http://169.254.169.254/'; });
    hooks.dnsLookup.mockImplementation((_host, _options, done) => done(null, [{ address: '8.8.8.8', family: 4 }]));
    await expect(requestPublicHttp('https://api.example.com/public', {
      method: 'GET', headers: {}, timeoutMs: 500,
    })).rejects.toThrow('redirects are blocked');
    expect(hooks.httpsRequest).toHaveBeenCalledTimes(1);
  });

  it('enforces request body, timeout, and protected header limits before network access', async () => {
    await expect(requestPublicHttp('https://api.example.com/', {
      method: 'POST', headers: {}, body: 'x'.repeat(MAX_API_BODY_BYTES + 1), timeoutMs: 1000,
    })).rejects.toThrow('64 KB');
    await expect(requestPublicHttp('https://api.example.com/', {
      method: 'GET', headers: {}, timeoutMs: 40_000,
    })).rejects.toThrow('outside allowed limits');
    for (const header of ['Host', 'Content-Length', 'Connection', 'Transfer-Encoding']) {
      await expect(requestPublicHttp('https://api.example.com/', {
        method: 'GET', headers: { [header]: '127.0.0.1' }, timeoutMs: 1000,
      })).rejects.toThrow('unsupported request header');
    }
    expect(hooks.httpsRequest).not.toHaveBeenCalled();
  });
});
