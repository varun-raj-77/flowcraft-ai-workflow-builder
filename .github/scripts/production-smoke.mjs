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

  const targets = list.slice(0, 30); // Bounded read-only audit.
  for (const workflow of targets) {
    const title = 'existing workflow: ' + workflow.name + ' rev ' + (workflow.currentRevision ?? '?') + ' (' + workflow._id + ')';
    await attempt(title, async () => {
      const read = requireStatus(await api('/api/workflows/' + workflow._id), 200, 'GET existing workflow');
      if (!Array.isArray(read?.nodes)) throw new Error('Saved graph missing');
      return read.nodes.length + ' nodes';
    });
    // The diagnostic route is read-only and emits no graph bodies or prompts.
    let diagnostic = await api('/api/workflows/' + workflow._id + '/revision-integrity-diagnostics');
    // Wait for Railway's backend deployment to expose the expanded report.
    if (workflow === targets[0]) {
      for (let retry = 0; retry < 8 && (diagnostic.status !== 200 || !diagnostic.data?.legacyRoot); retry += 1) {
        await new Promise((resolve) => setTimeout(resolve, 8000));
        diagnostic = await api('/api/workflows/' + workflow._id + '/revision-integrity-diagnostics');
      }
    }
    const category = diagnostic.data ?? { status: 'route_unavailable', httpStatus: diagnostic.status, errorCode: diagnostic.errorCode };
    console.log('REVISION_FINGERPRINT ' + workflow.name + ' (' + workflow._id + ') ' + JSON.stringify(category));
  }
  if (targets.length === 0) report('existing demo workflows', true, 'No existing records to inspect');

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

  await attempt('persist API node with empty headers', async () => {
    const suffix = String(Date.now());
    const apiGraph = {
      nodes: [
        { id: 'start', type: 'start', label: 'Start', position: { x: 0, y: 0 }, config: {} },
        { id: 'api', type: 'api_call', label: 'Public API', position: { x: 220, y: 0 },
          config: { url: 'https://jsonplaceholder.typicode.com/posts', method: 'GET', headers: {} } },
        { id: 'end', type: 'end', label: 'End', position: { x: 440, y: 0 }, config: {} },
      ],
      edges: [
        { id: 'start-api', source: 'start', target: 'api' },
        { id: 'api-end', source: 'api', target: 'end' },
      ],
    };
    const created = requireStatus(await api('/api/workflows', 'POST', {
      name: '__flowcraft_api_smoke_' + suffix,
      description: 'Disposable empty API headers test; never execute',
      ...apiGraph,
      isGeneratedByAI: false,
    }), 201, 'create API workflow');
    if (!created?._id) throw new Error('API workflow ID missing');
    ownedWorkflowIds.push(created._id);
    const loaded = requireStatus(await api('/api/workflows/' + created._id), 200, 'reload API workflow');
    const config = loaded.nodes?.find((n) => n.id === 'api')?.config;
    if (!config || !Object.prototype.hasOwnProperty.call(config, 'headers')) {
      throw new Error('Empty API headers field disappeared during persistence');
    }
    if (Object.keys(config.headers).length !== 0) throw new Error('Unexpected API header values');
    return 'API revision hash stable and empty headers retained';
  });

  await attempt('reject unauthenticated workflow list', async () => {
    const response = await fetch(new URL('/api/workflows', origin), { headers: { accept: 'application/json' } });
    if (response.status !== 401) throw new Error('Expected HTTP 401; received ' + response.status);
    return '401 without session cookie';
  });

  await attempt('execute deterministic transform and condition branches', async () => {
    const id = String(Date.now());
    const nodes = [
      { id: 'start', type: 'start', label: 'Start', position: { x: 0, y: 0 }, config: {} },
      { id: 'compute', type: 'transform', label: 'Compute', position: { x: 200, y: 0 },
        config: { transformCode: 'return { data: 2 };' } },
      { id: 'decide', type: 'condition', label: 'Branch', position: { x: 400, y: 0 },
        config: { expression: 'input.compute.data === 2', trueTargetNodeId: 'yes', falseTargetNodeId: 'no' } },
      { id: 'yes', type: 'output', label: 'Yes', position: { x: 600, y: -80 },
        config: { logLevel: 'info', message: 'chosen {{decide.branchTaken}}' } },
      { id: 'no', type: 'output', label: 'No', position: { x: 600, y: 80 },
        config: { logLevel: 'info', message: 'should never execute' } },
      { id: 'end', type: 'end', label: 'End', position: { x: 820, y: 0 }, config: {} },
    ];
    const edges = [
      { id: 'e1', source: 'start', target: 'compute' },
      { id: 'e2', source: 'compute', target: 'decide' },
      { id: 'e3', source: 'decide', target: 'yes', sourceHandle: 'condition_true', conditionBranch: 'true' },
      { id: 'e4', source: 'decide', target: 'no', sourceHandle: 'condition_false', conditionBranch: 'false' },
      { id: 'e5', source: 'yes', target: 'end' },
      { id: 'e6', source: 'no', target: 'end' },
    ];
    const created = requireStatus(await api('/api/workflows', 'POST', {
      name: '__flowcraft_branch_smoke_' + id,
      description: 'Disposable safe transform and condition check',
      nodes, edges, isGeneratedByAI: false,
    }), 201, 'create branching workflow');
    if (!created?._id) throw new Error('Missing branching workflow ID');
    ownedWorkflowIds.push(created._id);
    const started = requireStatus(await api('/api/executions/' + created._id + '/run', 'POST'), 201, 'run branching workflow');
    if (!started?._id) throw new Error('Missing branching run ID');
    let final;
    for (let i = 0; i < 12; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      final = requireStatus(await api('/api/executions/run/' + started._id), 200, 'GET branching run');
      if (final.status !== 'running' && final.status !== 'pending') break;
    }
    if (final?.status !== 'completed') throw new Error('Branching run ' + final?.status + ': ' + String(final?.error || '').slice(0, 120));
    const no = final.stepLogs?.find((step) => step.nodeId === 'no');
    const yes = final.stepLogs?.find((step) => step.nodeId === 'yes');
    if (no?.status !== 'skipped' || yes?.status !== 'success') {
      throw new Error('Incorrect branch statuses: yes=' + yes?.status + ', no=' + no?.status);
    }
    return 'true path executed, false path skipped';
  });

  // A single inexpensive AI generation probe. Never execute untrusted generated
  // graphs on the shared demo account.
  await attempt('live AI generation with simple supported prompt', async () => {
    const generated = requireStatus(await api('/api/ai/generate', 'POST', { prompt: "Start the workflow, wait 1000 milliseconds, log the message 'FlowCraft demo successful' at info level, then end the workflow." }), 200, 'POST AI generation');
    if (!generated?.nodes?.some((node) => node.type === 'delay') || !generated?.nodes?.some((node) => node.type === 'output')) throw new Error('Generated graph does not include requested nodes');
    if (generated.generationMetadata?.capabilityCoverage?.isComplete !== true) throw new Error('AI capability coverage incomplete');
    return 'schema valid and coverage complete';
  });

  // Verify the remaining visible AI examples against the real provider.
  // Generated candidates are not persisted or executed.
  const examples = [
    {
      name: 'sum numbers',
      prompt: "Start the workflow, use a JavaScript Transform node to calculate the sum of the numbers [10, 20, 30], log the sum with an Output node, then end the workflow.",
      types: ['transform', 'output'],
    },
    {
      name: 'condition branches',
      prompt: "Start the workflow, check the condition 10 > 5, log 'Check passed' on the true branch or 'Check failed' on the false branch, then end the workflow.",
      types: ['condition', 'output'],
    },
    {
      name: 'public GET',
      prompt: "Start the workflow, fetch public posts from https://jsonplaceholder.typicode.com/posts using a GET API Call with no authentication, log the HTTP response status, then end the workflow.",
      types: ['api_call', 'output'],
    },
  ];
  for (const example of examples) {
    await attempt('AI example: ' + example.name, async () => {
      const generated = requireStatus(
        await api('/api/ai/generate', 'POST', { prompt: example.prompt }),
        200, 'POST example ' + example.name,
      );
      if (generated?.generationMetadata?.capabilityCoverage?.isComplete !== true) {
        throw new Error('Incomplete capability coverage');
      }
      const types = new Set(generated.nodes?.map((n) => n.type));
      for (const type of example.types) {
        if (!types.has(type)) throw new Error('Missing generated node: ' + type);
      }
      return 'validated graph with ' + generated.nodes.length + ' nodes';
    });
  }

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
