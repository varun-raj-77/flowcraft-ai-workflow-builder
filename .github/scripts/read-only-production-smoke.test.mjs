import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseOptions, runSmoke, PRODUCTION_ORIGIN } from './read-only-production-smoke.mjs';

const ID = 'a'.repeat(24);
const HASH = 'b'.repeat(64);
const env = {
  FLOWCRAFT_SMOKE_MODE: 'pinned',
  FLOWCRAFT_SMOKE_CONFIRM: 'READ_ONLY_PINNED_SIMULATION',
  FLOWCRAFT_SMOKE_EMAIL: 'test-owner@example.test',
  FLOWCRAFT_SMOKE_PASSWORD: 'private-password-never-log',
  FLOWCRAFT_SMOKE_WORKFLOW_ID: ID,
  FLOWCRAFT_SMOKE_REVISION: '3',
  FLOWCRAFT_SMOKE_DEFINITION_HASH: HASH,
};

const nodes = [
  { id: 'start', type: 'start', config: {} },
  { id: 'items', type: 'transform', config: { transformCode: 'return [{ id: 1 }, { id: 2 }];' } },
  { id: 'decision', type: 'condition', config: { expression: 'input.items.length === 2 && input.items[0].id === 1' } },
  { id: 'yes', type: 'output', config: { message: 'first={{items.0.id}}; branch={{decision.branchTaken}}' } },
  { id: 'no', type: 'output', config: { message: 'wrong branch' } },
  { id: 'end', type: 'end', config: {} },
];
const edges = [
  { source: 'start', target: 'items' },
  { source: 'items', target: 'decision' },
  { source: 'decision', target: 'yes', conditionBranch: 'true' },
  { source: 'decision', target: 'no', conditionBranch: 'false' },
  { source: 'yes', target: 'end' },
  { source: 'no', target: 'end' },
];
const simulated = {
  mode: 'isolated', status: 'passed',
  provenance: { workflowRevision: 3, definitionHash: HASH },
  assertions: Array.from({ length: 4 }, () => ({ passed: true })),
  steps: [
    { nodeId: 'items', status: 'simulated', output: [{ id: 1 }, { id: 2 }] },
    { nodeId: 'yes', status: 'simulated', output: { message: 'first=1; branch=true' } },
    { nodeId: 'no', status: 'skipped' },
  ],
};

function json(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status, headers: { 'content-type': 'application/json', ...headers },
  });
}

function fixtureFetch(override = {}) {
  const seen = [];
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, PRODUCTION_ORIGIN, 'Probe should never contact another origin');
    assert.equal(init.redirect, 'manual', 'Probe must reject redirects');
    assert.ok(init.signal, 'All calls require an abort signal');
    const path = parsed.pathname;
    seen.push({ path, method: init.method, headers: init.headers, body: init.body });
    if (typeof override[path] === 'function') return override[path](init);
    if (override[path]) return override[path];

    if (path === '/api/health') return json({ status: 'ok' });
    if (path === '/api/workflows' && !init.headers.cookie) return json({ error: { code: 'MISSING_TOKEN' } }, 401);
    if (path === '/api/auth/login') return json({ data: {} }, 200, { 'set-cookie': 'token=test-session; HttpOnly; Path=/' });
    if (path === '/api/auth/me') return json({ data: { email: env.FLOWCRAFT_SMOKE_EMAIL, isDemoAccount: false } });
    if (path === '/api/workflows/' + ID) {
      return json({ data: { name: '__flowcraft_smoke_readonly_fixture', currentRevision: 3 } });
    }
    if (path === '/api/workflows/' + ID + '/revisions/3') {
      return json({ data: { revision: 3, definitionHash: HASH, nodes, edges } });
    }
    if (path === '/api/executions/' + ID + '/simulate') return json({ data: simulated });
    throw new Error('Unexpected HTTP request: ' + path);
  };
  return { fetchImpl, seen };
}
const quiet = () => {};
async function fails(network, options, expected) {
  await assert.rejects(
    runSmoke({ env: options, fetchImpl: network.fetchImpl, log: quiet }),
    expected,
  );
}

describe('manual-only M7 production probe; no actual network', () => {
  it('defaults to public GET-only, without using even available credentials', async () => {
    const network = fixtureFetch();
    const messages = [];
    const result = await runSmoke({ env: { ...env, FLOWCRAFT_SMOKE_MODE: 'public' },
      fetchImpl: network.fetchImpl, log: (line) => messages.push(line) });
    assert.equal(result.mode, 'public');
    assert.equal(result.checks.length, 2);
    assert.deepEqual(network.seen.map((req) => [req.method, req.path]), [
      ['GET', '/api/health'], ['GET', '/api/workflows'],
    ]);
    assert.ok(network.seen.every((req) => !req.headers.cookie && req.body === undefined));
    assert.ok(messages.join(' ').includes('no credentials or mutations'));
  });

  it('validates mode and complete operator approval BEFORE any request', async () => {
    const badConfigs = [
      { ...env, FLOWCRAFT_SMOKE_MODE: 'run' },
      { ...env, FLOWCRAFT_SMOKE_CONFIRM: '' },
      { ...env, FLOWCRAFT_SMOKE_EMAIL: '' },
      { ...env, FLOWCRAFT_SMOKE_PASSWORD: '' },
      { ...env, FLOWCRAFT_SMOKE_WORKFLOW_ID: 'malformed/path' },
      { ...env, FLOWCRAFT_SMOKE_REVISION: '0' },
      { ...env, FLOWCRAFT_SMOKE_REVISION: '1.1' },
      { ...env, FLOWCRAFT_SMOKE_DEFINITION_HASH: 'not-a-hash' },
    ];
    for (const options of badConfigs) {
      const network = fixtureFetch();
      await assert.rejects(runSmoke({ env: options, fetchImpl: network.fetchImpl, log: quiet }));
      assert.equal(network.seen.length, 0);
    }
    assert.equal(parseOptions({}).mode, 'public');
  });

  it('authenticates with an unprivileged dedicated account and uses only /simulate, never /run or writes', async () => {
    const network = fixtureFetch();
    const messages = [];
    const result = await runSmoke({ env, fetchImpl: network.fetchImpl, log: (message) => messages.push(message) });
    assert.equal(result.mode, 'pinned');
    assert.equal(result.checks.length, 5);
    assert.deepEqual(network.seen.map(({ method, path }) => method + ' ' + path), [
      'GET /api/health',
      'GET /api/workflows',
      'POST /api/auth/login',
      'GET /api/auth/me',
      'GET /api/workflows/' + ID,
      'GET /api/workflows/' + ID + '/revisions/3',
      'POST /api/executions/' + ID + '/simulate',
    ]);
    assert.equal(network.seen.filter((x) => x.method === 'POST').length, 2);
    assert.equal(network.seen[2].headers.cookie, undefined);
    assert.equal(network.seen[3].headers.cookie, 'token=test-session');
    const request = JSON.parse(network.seen.at(-1).body);
    assert.equal(request.mode, 'isolated');
    assert.equal(request.expectedRevision, 3);
    assert.deepEqual(request.mocks, {});
    assert.equal(request.assertions.length, 3);
    assert.equal(request.expectedBranches.decision, 'true');
    const printed = messages.join('\n');
    assert.ok(!printed.includes(env.FLOWCRAFT_SMOKE_PASSWORD));
    assert.ok(!printed.includes('test-session'));
    assert.ok(!printed.includes(ID), 'Do not disclose workflow IDs in logs');
  });

  it('rejects shared demo sessions before inspecting or simulating workflows', async () => {
    const network = fixtureFetch({ '/api/auth/me': json({
      data: { email: env.FLOWCRAFT_SMOKE_EMAIL, isDemoAccount: true },
    }) });
    await fails(network, env, /shared demo accounts are forbidden/);
    assert.ok(!network.seen.some((r) => r.path.includes('/simulate')));
    assert.ok(!network.seen.some((r) => r.path.endsWith('/revisions/3')));
  });

  it('rejects a different authenticated identity', async () => {
    const network = fixtureFetch({ '/api/auth/me': json({
      data: { email: 'someone-else@example.test', isDemoAccount: false },
    }) });
    await fails(network, env, /identity/);
    assert.ok(!network.seen.some((r) => r.path.includes('/simulate')));
  });

  it('rejects a non-disposable workflow or changed revision before running QuickJS', async () => {
    for (const workflow of [
      { name: 'customer orders', currentRevision: 3 },
      { name: '__flowcraft_smoke_readonly_fixture', currentRevision: 4 },
    ]) {
      const network = fixtureFetch({ ['/api/workflows/' + ID]: json({ data: workflow }) });
      await fails(network, env, /disposable fixture prefix|revision changed/);
      assert.ok(!network.seen.some((r) => r.path.includes('/simulate')));
    }
  });

  it('rejects definition hash or graph drift before invoking Test Lab', async () => {
    for (const revision of [
      { revision: 3, definitionHash: 'c'.repeat(64), nodes, edges },
      { revision: 3, definitionHash: HASH, nodes: nodes.slice(0, -1), edges },
      { revision: 3, definitionHash: HASH, nodes: nodes.map((n) => n.id === 'items'
        ? { ...n, config: { transformCode: 'return [];' } } : n), edges },
      { revision: 3, definitionHash: HASH, nodes, edges: edges.slice(0, -1) },
    ]) {
      const network = fixtureFetch({ ['/api/workflows/' + ID + '/revisions/3']: json({ data: revision }) });
      await assert.rejects(runSmoke({ env, fetchImpl: network.fetchImpl, log: quiet }));
      assert.ok(!network.seen.some((r) => r.path.includes('/simulate')));
    }
  });

  it('rejects forged green results when assertions, array output, branch or provenance are wrong', async () => {
    const variants = [
      { ...simulated, assertions: [{ passed: false }, ...simulated.assertions.slice(1)] },
      { ...simulated, provenance: { ...simulated.provenance, definitionHash: 'c'.repeat(64) } },
      { ...simulated, steps: simulated.steps.map((s) => s.nodeId === 'items' ? { ...s, output: { data: [{ id: 1 }, { id: 2 }] } } : s) },
      { ...simulated, steps: simulated.steps.map((s) => s.nodeId === 'no' ? { ...s, status: 'simulated' } : s) },
      { ...simulated, mode: 'mock' },
    ];
    for (const variant of variants) {
      const network = fixtureFetch({ ['/api/executions/' + ID + '/simulate']: json({ data: variant }) });
      await assert.rejects(runSmoke({ env, fetchImpl: network.fetchImpl, log: quiet }));
    }
  });

  it('fails on auth rejection and missing session cookies without disclosure', async () => {
    for (const login of [
      json({ error: { message: 'private-password-never-log' } }, 401),
      json({ data: {} }, 200),
    ]) {
      const network = fixtureFetch({ '/api/auth/login': login });
      let message;
      try { await runSmoke({ env, fetchImpl: network.fetchImpl, log: quiet }); }
      catch (error) { message = error.message; }
      assert.ok(message);
      assert.ok(!message.includes(env.FLOWCRAFT_SMOKE_PASSWORD));
      assert.ok(!network.seen.some((r) => r.path.includes('/simulate')));
    }
  });

  it('refuses redirects, invalid JSON and unexpectedly large responses', async () => {
    const responses = [
      json({ redirect: true }, 302, { location: 'https://evil.example/' }),
      new Response('not-json', { status: 200 }),
      new Response('x'.repeat(250001), { status: 200 }),
    ];
    for (const response of responses) {
      const network = fixtureFetch({ '/api/health': response });
      await assert.rejects(runSmoke({ env: {}, fetchImpl: network.fetchImpl, log: quiet }));
      assert.equal(network.seen.length, 1);
    }
  });

  it('turns network errors into a static report without leaking request internals', async () => {
    const secretError = 'private-password-never-log';
    const network = { fetchImpl: async () => { throw new Error(secretError); } };
    await assert.rejects(
      runSmoke({ env: {}, fetchImpl: network.fetchImpl, log: quiet }),
      (e) => e.message === 'Production HTTP request failed' && !e.message.includes(secretError),
    );
  });
});
