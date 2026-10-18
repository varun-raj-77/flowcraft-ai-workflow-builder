import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestContext } from './requestContext.middleware';

const spies: Array<ReturnType<typeof vi.spyOn>> = [];
afterEach(() => {
  spies.splice(0).forEach((spy) => spy.mockRestore());
});

function runRequest(header?: string, path = '/api/executions/run/secret-id?token=untrusted') {
  const res = Object.assign(new EventEmitter(), {
    setHeader: vi.fn(),
    statusCode: 401,
  });
  const req = {
    path,
    method: 'GET',
    route: { path: '/run/:runId' },
    get: vi.fn(() => header),
    requestId: undefined as string | undefined,
  };
  const next = vi.fn();
  const logger = vi.spyOn(console, 'info').mockImplementation(() => {});
  spies.push(logger);
  requestContext(req as never, res as never, next);
  res.emit('finish');
  return { req, res, next, logger };
}

describe('M11 request correlation and log privacy', () => {
  it('accepts a UUID correlation ID and logs the route pattern, not the concrete URL', () => {
    const uuid = '2d5ac5dc-3a15-4b88-83a2-056111f946b8';
    const { req, res, next, logger } = runRequest(uuid);
    expect(req.requestId).toBe(uuid);
    expect(next).toHaveBeenCalledOnce();
    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', uuid);
    expect(logger).toHaveBeenCalledOnce();
    const record = JSON.parse(logger.mock.calls[0][0]);
    expect(record).toMatchObject({
      event: 'http_request_complete', requestId: uuid,
      method: 'GET', route: '/run/:runId', status: 401,
    });
    expect(JSON.stringify(record)).not.toMatch(/secret-id|untrusted|token=/);
  });

  it('rejects attacker-controlled huge/multiline headers instead of echoing them in logs', () => {
    const malicious = 'password=private\n'.repeat(500);
    const { req, res, logger } = runRequest(malicious);
    expect(req.requestId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(req.requestId).not.toBe(malicious);
    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', req.requestId);
    expect(JSON.stringify(logger.mock.calls)).not.toMatch(/private|password|secret-id/);
  });

  it('omits unknown raw URLs entirely', () => {
    const { logger } = runRequest(undefined);
    expect(JSON.parse(logger.mock.calls[0][0]).route).toBe('/run/:runId');
  });
});
