/**
 * M7 opt-in production probe. Default: anonymous GET checks only.
 * Pinned mode: operator-approved, dedicated-account simulation of an already
 * saved disposable fixture. It NEVER creates, updates, runs or deletes workflows.
 * No secrets, workflow source, responses or cookies are written to logs.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PRODUCTION_ORIGIN = 'https://flowcraft-ai-workflow-builder.vercel.app';
export const FIXTURE_PREFIX = '__flowcraft_smoke_readonly_';
const OBJECT_ID = /^[a-f0-9]{24}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const CONFIRMATION = 'READ_ONLY_PINNED_SIMULATION';
const EXPECTED_ITEMS = [{ id: 1 }, { id: 2 }];
const EXPECTED_MESSAGE = 'first=1; branch=true';
const fixtureTypes = {
  start: 'start', items: 'transform', decision: 'condition',
  yes: 'output', no: 'output', end: 'end',
};
const fixtureEdges = [
  'start:items', 'items:decision', 'decision:yes:true',
  'decision:no:false', 'yes:end', 'no:end',
];

function requireValid(condition, message) {
  if (!condition) throw new Error(message);
}

export function parseOptions(env = {}) {
  const mode = env.FLOWCRAFT_SMOKE_MODE || 'public';
  requireValid(mode === 'public' || mode === 'pinned', 'Invalid smoke mode');
  if (mode === 'public') return { mode };

  requireValid(env.FLOWCRAFT_SMOKE_CONFIRM === CONFIRMATION,
    'Pinned simulation requires explicit manual confirmation');
  requireValid(typeof env.FLOWCRAFT_SMOKE_EMAIL === 'string' && env.FLOWCRAFT_SMOKE_EMAIL.includes('@')
    && typeof env.FLOWCRAFT_SMOKE_PASSWORD === 'string' && env.FLOWCRAFT_SMOKE_PASSWORD.length > 0,
  'Pinned simulation requires dedicated-account credentials');
  requireValid(OBJECT_ID.test(env.FLOWCRAFT_SMOKE_WORKFLOW_ID || ''),
    'Pinned simulation requires a valid saved fixture ID');
  const revision = Number(env.FLOWCRAFT_SMOKE_REVISION);
  requireValid(Number.isSafeInteger(revision) && revision > 0,
    'Pinned simulation requires a positive revision number');
  requireValid(SHA256.test(env.FLOWCRAFT_SMOKE_DEFINITION_HASH || ''),
    'Pinned simulation requires an exact SHA-256 definition hash');
  return {
    mode,
    email: env.FLOWCRAFT_SMOKE_EMAIL,
    password: env.FLOWCRAFT_SMOKE_PASSWORD,
    workflowId: env.FLOWCRAFT_SMOKE_WORKFLOW_ID,
    revision,
    definitionHash: env.FLOWCRAFT_SMOKE_DEFINITION_HASH,
  };
}

function assertFixture(workflow, revision, opts) {
  requireValid(workflow && typeof workflow.name === 'string'
    && workflow.name.startsWith(FIXTURE_PREFIX),
  'Refusing to simulate a workflow without the disposable fixture prefix');
  requireValid(workflow.currentRevision === opts.revision,
    'Saved fixture revision changed; aborting');
  requireValid(revision?.revision === opts.revision
    && revision?.definitionHash === opts.definitionHash,
  'Saved fixture definition hash or revision differs; aborting');

  const nodes = revision.nodes;
  const edges = revision.edges;
  requireValid(Array.isArray(nodes) && nodes.length === 6
    && Array.isArray(edges) && edges.length === 6,
  'Saved fixture graph does not match the approved shape');

  for (const [id, type] of Object.entries(fixtureTypes)) {
    requireValid(nodes.filter((node) => node.id === id && node.type === type).length === 1,
      'Saved fixture contains unexpected nodes');
  }
  const byId = Object.fromEntries(nodes.map((node) => [node.id, node]));
  requireValid(byId.items.config?.transformCode === 'return [{ id: 1 }, { id: 2 }];'
    && byId.decision.config?.expression === 'input.items.length === 2 && input.items[0].id === 1'
    && byId.yes.config?.message === 'first={{items.0.id}}; branch={{decision.branchTaken}}'
    && byId.no.config?.message === 'wrong branch',
  'Saved fixture source or Output templates changed');

  const actualEdges = edges.map((edge) => edge.source + ':' + edge.target
    + (edge.conditionBranch ? ':' + edge.conditionBranch : '')).sort();
  requireValid(JSON.stringify(actualEdges) === JSON.stringify([...fixtureEdges].sort()),
    'Saved fixture branches do not match the approved graph');
}

export async function runSmoke({ env = process.env, fetchImpl = fetch, log = console.log } = {}) {
  const options = parseOptions(env); // Verify ALL opt-in parameters before network I/O.
  const checks = [];
  const passed = (label) => {
    checks.push(label);
    log('SMOKE PASS ' + label);
  };
  let cookie = '';

  async function api(path, method = 'GET', body) {
    const headers = { accept: 'application/json', origin: PRODUCTION_ORIGIN };
    if (cookie) headers.cookie = cookie;
    if (body !== undefined) headers['content-type'] = 'application/json';
    let response;
    try {
      response = await fetchImpl(new URL(path, PRODUCTION_ORIGIN), {
        method,
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(10000),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new Error('Production HTTP request failed');
    }
    requireValid(response.status < 300 || response.status >= 400,
      'Refusing an unexpected redirect');
    let text;
    try { text = await response.text(); } catch { throw new Error('Cannot read production response'); }
    requireValid(text.length <= 250000, 'Production response too large');
    let json;
    try { json = JSON.parse(text); } catch { throw new Error('Production returned invalid JSON'); }
    return { status: response.status, json, headers: response.headers };
  }

  const health = await api('/api/health');
  requireValid(health.status === 200 && health.json?.status === 'ok',
    'Public health check failed');
  passed('public API health');

  const unauthorized = await api('/api/workflows');
  requireValid(unauthorized.status === 401,
    'Unauthenticated workflow access was not rejected');
  passed('unauthenticated workflow access denied');

  if (options.mode === 'public') {
    log('SMOKE SUMMARY: 2 public checks passed; no credentials or mutations used');
    return { mode: options.mode, checks };
  }

  const login = await api('/api/auth/login', 'POST',
    { email: options.email, password: options.password });
  requireValid(login.status === 200, 'Dedicated smoke account login failed');
  const rawCookie = login.headers.get('set-cookie') || '';
  const match = rawCookie.match(/(?:^|[, ])(token=[^;\s]+)/);
  requireValid(Boolean(match), 'Dedicated smoke login returned no session cookie');
  cookie = match[1]; // Never log the cookie or include it in error messages.

  const me = await api('/api/auth/me');
  requireValid(me.status === 200
    && me.json?.data?.email?.toLowerCase() === options.email.toLowerCase()
    && me.json?.data?.isDemoAccount === false,
  'Dedicated smoke identity could not be verified; shared demo accounts are forbidden');
  passed('dedicated-account identity verified');

  const id = options.workflowId; // Prevalidated as exactly 24 hexadecimal characters.
  const workflow = await api('/api/workflows/' + id);
  requireValid(workflow.status === 200, 'Disposable fixture lookup failed');

  const rev = await api('/api/workflows/' + id + '/revisions/' + options.revision);
  requireValid(rev.status === 200, 'Immutable fixture revision lookup failed');
  assertFixture(workflow.json?.data, rev.json?.data, options);
  passed('owned disposable graph and pinned definition verified');

  const scenario = {
    expectedRevision: options.revision,
    mode: 'isolated',
    mocks: {},
    assertions: [
      { nodeId: 'items', equals: EXPECTED_ITEMS },
      { nodeId: 'items', path: '0.id', equals: 1 },
      { nodeId: 'yes', path: 'message', equals: EXPECTED_MESSAGE },
    ],
    expectedBranches: { decision: 'true' },
  };
  // This POST is the EXISTING read-only Test Lab simulator, NOT /run.
  const sim = await api('/api/executions/' + id + '/simulate', 'POST', scenario);
  const result = sim.json?.data;
  requireValid(sim.status === 200
    && result?.mode === 'isolated' && result?.status === 'passed'
    && result?.provenance?.workflowRevision === options.revision
    && result?.provenance?.definitionHash === options.definitionHash
    && Array.isArray(result.assertions) && result.assertions.length === 4
    && result.assertions.every((a) => a.passed === true),
  'Pinned read-only Test Lab assertions or provenance failed');
  const steps = result.steps;
  requireValid(Array.isArray(steps)
    && steps.find((s) => s.nodeId === 'items')?.status === 'simulated'
    && JSON.stringify(steps.find((s) => s.nodeId === 'items')?.output) === JSON.stringify(EXPECTED_ITEMS)
    && steps.find((s) => s.nodeId === 'yes')?.output?.message === EXPECTED_MESSAGE
    && steps.find((s) => s.nodeId === 'no')?.status === 'skipped',
  'Pinned Test Lab array shape or conditional branch differed');
  passed('isolated array, template, branch and immutable provenance');
  log('SMOKE SUMMARY: ' + checks.length + ' checks passed; no saved workflow mutations or /run calls');
  return { mode: options.mode, checks };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSmoke().catch((error) => {
    // All external errors are mapped to static, non-sensitive messages above.
    console.error('SMOKE FAIL ' + (error instanceof Error ? error.message : 'Unknown smoke failure'));
    process.exitCode = 1;
  });
}
