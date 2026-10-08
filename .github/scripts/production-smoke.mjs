// Live, disposable smoke test for the publicly documented FlowCraft demo workspace.
// Only the workflows created by this process may be deleted.
const origin = process.env.FLOWCRAFT_BASE_URL || 'https://flowcraft-ai-workflow-builder.vercel.app';
const username = process.env.FLOWCRAFT_SMOKE_EMAIL;
const password = process.env.FLOWCRAFT_SMOKE_PASSWORD;
const results = [];
const ownedWorkflowIds = [];
let cookie = '';

function report(name, passed, detail = '') {
  results.push({ name, passed });
  console.log('SMOKE ' + (passed ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ': ' + detail : ''));
}

async function api(path, method = 'GET', body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(new URL(path, origin), {
      method,
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        'accept': 'application/json',
        'origin': origin,
        ...(cookie ? { cookie } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let payload;
    try { payload = JSON.parse(text); } catch { payload = null; }
    const errorCode = payload?.error?.code ?? (response.status >= 400 ? 'UNKNOWN_ERROR' : null);
    return { status: response.status, data: payload?.data, errorCode, headers: response.headers };
  } finally {
    clearTimeout(timeout);
  }
}

async function attempt(name, fn) {
  try {
    const detail = await fn();
    report(name, true, typeof detail === 'string' ? detail : '');
    return true;
  } catch (error) {
    report(name, false, error instanceof Error ? error.message : String(error));
    return false;
  }
}

function requireStatus(response, code, context) {
  if (response.status !== code) throw new Error(context + ' HTTP ' + response.status + (response.errorCode ? ' (' + response.errorCode + ')' : ''));
  return response.data;
}

function graph(delayMs = 1000) {
  const nodes = [
    { id: 'start', type: 'start', label: 'Start', position: { x: 0, y: 0 }, config: {} },
    { id: 'wait', type: 'delay', label: 'Delay', position: { x: 220, y: 0 }, config: { delayMs } },
    { id: 'log', type: 'output', label: 'Output', position: { x: 440, y: 0 }, config: { logLevel: 'info', message: 'Smoke run completed' } },
    { id: 'end', type: 'end', label: 'End', position: { x: 660, y: 0 }, config: {} },
  ];
  const edges = [
    { id: 'start-wait', source: 'start', target: 'wait' },
    { id: 'wait-log', source: 'wait', target: 'log' },
    { id: 'log-end', source: 'log', target: 'end' },
  ];
  return { nodes, edges };
}

async function main() {
  if (!username || !password) throw new Error('Smoke credentials are not configured.');
  const login = await api('/api/auth/login', 'POST', { email: username, password });
  requireStatus(login, 200, 'Login');
  const setCookie = login.headers.get('set-cookie');
  if (!setCookie || !/(^|[, ])token=/.test(setCookie)) throw new Error('Login did not set a session cookie');
  const token = setCookie.match(/(?:^|[, ])(token=[^;]+)/);
  if (!token) throw new Error('Cannot parse session cookie');
  cookie = token[1];
  report('real production login', true);

  const demoVerified = await attempt('session verification', async () => {
    const me = requireStatus(await api('/api/auth/me'), 200, 'GET /auth/me');
    if (!me?.isDemoAccount) throw new Error('Logged into an unexpected account (aborting writes)');
    return 'confirmed shared demo account';
  });
  if (!demoVerified) throw new Error('Demo authorization not verified; aborting production mutations');
  const list = requireStatus(await api('/api/workflows'), 200, 'GET /workflows');
  if (!Array.isArray(list)) throw new Error('List response was not an array');
  report('production dashboard list', true, String(list.length) + ' workflows');

  const targets = list.filter((w) => /^(temperature|weather) alert$/i.test(w.name || ''));
  for (const workflow of targets) {
    await attempt('existing workflow: ' + workflow.name + ' rev ' + (workflow.currentRevision ?? '?') + ' (' + workflow._id + ')', async () => {
      const read = requireStatus(await api('/api/workflows/' + workflow._id), 200, 'GET existing workflow');
      if (!Array.isArray(read?.nodes)) throw new Error('Saved graph missing');
      return read.nodes.length + ' nodes';
    });
  }
  if (targets.length === 0) {
    report('existing Temperature Alert discovery', false, 'No matching workflow in demo account');
  }

  const uniqueName = '__flowcraft_smoke_' + process.env.GITHUB_RUN_ID + '_' + Date.now();
  let workflowId;
  let revision = 1;
  await attempt('create manual workflow', async () => {
    const created = requireStatus(await api('/api/workflows', 'POST', { name: uniqueName, description: 'Disposable CI production smoke test', ...graph(), isGeneratedByAI: false }), 201, 'POST workflow');
    if (!created?._id || created.currentRevision !== 1) throw new Error('Missing ID or incorrect revision on creation');
    workflowId = created._id;
    ownedWorkflowIds.push(workflowId);
    return 'created revision 1';
  });

  if (workflowId) {
    await attempt('reload persisted workflow', async () => {
      const loaded = requireStatus(await api('/api/workflows/' + workflowId), 200, 'GET created workflow');
      if (loaded.nodes?.length !== 4 || loaded.edges?.length !== 3) throw new Error('Unexpected graph after reload');
      return '4 nodes / 3 edges';
    });
    await attempt('save graph as revision 2', async () => {
      const updated = requireStatus(await api('/api/workflows/' + workflowId, 'PUT', { expectedRevision: 1, name: uniqueName, ...graph(1500) }), 200, 'PUT graph');
      if (updated.currentRevision !== 2) throw new Error('Revision did not advance to v2');
      revision = 2;
      return 'revision 2';
    });
    await attempt('revision history and original immutable graph', async () => {
      const history = requireStatus(await api('/api/workflows/' + workflowId + '/revisions'), 200, 'GET revisions');
      const old = requireStatus(await api('/api/workflows/' + workflowId + '/revisions/1'), 200, 'GET revision 1');
      if (history?.revisions?.length !== 2 || old?.revision !== 1) throw new Error('Revision history inconsistent');
      if (old.nodes?.find((node) => node.id === 'wait')?.config?.delayMs !== 1000) throw new Error('Immutable version changed');
      return 'v1 preserved and v2 saved';
    });
    await attempt('execute pinned revision', async () => {
      const started = requireStatus(await api('/api/executions/' + workflowId + '/run', 'POST'), 201, 'POST execution');
      if (!started?._id) throw new Error('Missing run ID');
      let final;
      for (let i = 0; i < 22; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        final = requireStatus(await api('/api/executions/run/' + started._id), 200, 'GET execution');
        if (final?.status && final.status !== 'running' && final.status !== 'pending') break;
      }
      if (final?.status !== 'completed') throw new Error('Run ended with ' + (final?.status ?? 'unknown') + (final?.error ? ': ' + final.error.slice(0, 120) : ''));
      const provenance = requireStatus(await api('/api/executions/run/' + started._id + '/provenance'), 200, 'GET provenance');
      if (provenance.workflowRevision !== revision) throw new Error('Run not pinned to expected revision');
      return 'completed, pinned to v' + revision;
    });
  }

  // A single inexpensive AI generation probe. Never execute untrusted generated
  // graphs on the shared demo account.
  await attempt('live AI generation with simple supported prompt', async () => {
    const generated = requireStatus(await api('/api/ai/generate', 'POST', { prompt: "Start the workflow, wait 1000 milliseconds, log the message 'FlowCraft demo successful' at info level, then end the workflow." }), 200, 'POST AI generation');
    if (!generated?.nodes?.some((node) => node.type === 'delay') || !generated?.nodes?.some((node) => node.type === 'output')) throw new Error('Generated graph does not include requested nodes');
    if (generated.generationMetadata?.capabilityCoverage?.isComplete !== true) throw new Error('AI capability coverage incomplete');
    return 'schema valid and coverage complete';
  });
}

try {
  await main();
} catch (error) {
  report('smoke runner', false, error instanceof Error ? error.message : String(error));
} finally {
  // Only delete workflow IDs created in this run, never existing customer data.
  for (const id of ownedWorkflowIds.reverse()) {
    try {
      const removed = await api('/api/workflows/' + id, 'DELETE');
      report('cleanup ' + id, removed.status === 204, 'HTTP ' + removed.status);
    } catch (error) {
      report('cleanup ' + id, false, error instanceof Error ? error.message : String(error));
    }
  }
}

const passed = results.filter((item) => item.passed).length;
const failed = results.length - passed;
console.log('SMOKE SUMMARY ' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
