import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { SimulationResult } from './execution/workflowSimulation';

const mocks = vi.hoisted(() => ({ simulate: vi.fn() }));
vi.mock('./execution/workflowSimulation', () => ({
  simulateOwnedWorkflow: mocks.simulate,
  simulationScenarioSchema: { safeParse: () => ({ success: true }) },
}));
vi.mock('../config/environment', () => ({
  env: { ANTHROPIC_API_KEY: 'local-fake-provider-key', ANTHROPIC_MODEL: 'claude-test-model' },
}));

import { diagnoseOwnedSimulation, sanitizedFailureEvidence, validateDiagnosisResponse } from './aiSimulationDiagnosis';

const failedRun: SimulationResult = {
  status: 'failed',
  steps: [
    { nodeId: 'raw-user-token-abcd', nodeType: 'api_call', status: 'mocked',
      output: { status: 401, headers: { authorization: 'Bearer secret' }, data: { customerEmail: 'customer@example.com' } } },
    { nodeId: 'filter', nodeType: 'transform', status: 'failed', error: 'SIMULATION_MOCK_REQUIRED' },
    { nodeId: 'branch', nodeType: 'condition', status: 'skipped' },
  ],
  assertions: [
    { nodeId: 'raw-user-token-abcd', path: 'data.secretKey', passed: false, message: 'Expected value did not match' },
    { nodeId: 'branch', path: 'branchTaken', passed: false, message: 'Expected branch not selected' },
  ],
  provenance: { workflowRevision: 3, definitionHash: 'd'.repeat(64) },
};
const scenario = {
  expectedRevision: 3,
  mocks: { 'raw-user-token-abcd': {
    status: 401, data: { customerEmail: 'customer@example.com', token: 'user-secret-value' }, headers: { authorization: 'Bearer secret' },
  } },
  assertions: [{ nodeId: 'raw-user-token-abcd', path: 'data.secretKey', equals: 'private-value' }],
  expectedBranches: { branch: 'true' },
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  mocks.simulate.mockResolvedValue(failedRun);
});
afterEach(() => vi.unstubAllGlobals());

function response(findings: unknown) {
  return new Response(JSON.stringify({ content: [
    { type: 'text', text: JSON.stringify({ findings }) },
  ] }), { status: 200 });
}

describe('AI-assisted simulation failure diagnosis', () => {
  it('never sends workflow labels, node IDs, code, fixture values, headers or expected values to the provider', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response([
      { nodeRef: 'n1', action: 'add_mock', explanation: 'The Transform node has no fixture.',
        suggestedNextStep: 'Add an output object fixture for this Transform node.', confidence: 'medium' },
    ]));
    vi.stubGlobal('fetch', fetchMock);
    const diagnosis = await diagnoseOwnedSimulation('workflow-1', 'owner-1', scenario);
    expect(diagnosis).toMatchObject({
      provider: 'anthropic',
      provenance: { workflowRevision: 3, definitionHash: 'd'.repeat(64) },
      findings: [{ nodeId: 'filter', action: 'add_mock', confidence: 'medium' }],
    });
    expect(mocks.simulate).toHaveBeenCalledWith('workflow-1', 'owner-1', scenario);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const body = JSON.parse(request.body);
    expect(body.max_tokens).toBe(1000);
    const prompt = JSON.parse(body.messages[0].content);
    expect(prompt).toMatchObject({
      simulation: 'mock_only',
      failureFacts: [
        { nodeRef: 'n1', nodeType: 'transform', issue: 'missing_mock' },
        { nodeRef: 'n0', nodeType: 'api_call', issue: 'output_mismatch', fieldKind: 'nested_output' },
        { nodeRef: 'n2', nodeType: 'condition', issue: 'branch_mismatch', fieldKind: 'branchTaken' },
      ],
    });
    const payload = JSON.stringify(body);
    for (const sensitive of ['customer@example.com', 'Bearer secret', 'private-value', 'user-secret-value',
      'raw-user-token-abcd', 'data.secretKey', 'filter', 'customerEmail']) {
      expect(payload).not.toContain(sensitive);
    }
    expect(JSON.stringify(diagnosis)).not.toContain('customer@example.com');
  });

  it('refuses a successful simulation without calling the AI provider', async () => {
    mocks.simulate.mockResolvedValueOnce({ ...failedRun, status: 'passed', assertions: [], steps: [] });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(diagnoseOwnedSimulation('workflow-1', 'owner-1', scenario))
      .rejects.toMatchObject({ code: 'SIMULATION_HAS_NO_FAILURES', statusCode: 409 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never calls provider if the ownership or revision check fails', async () => {
    mocks.simulate.mockRejectedValueOnce({ statusCode: 404, code: 'WORKFLOW_NOT_FOUND' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(diagnoseOwnedSimulation('other-workflow', 'other-user', scenario))
      .rejects.toMatchObject({ code: 'WORKFLOW_NOT_FOUND' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects hallucinated node references or malformed provider objects', async () => {
    const { facts, nodeByRef } = sanitizedFailureEvidence(failedRun);
    expect(() => validateDiagnosisResponse({ findings: [
      { nodeRef: 'n99', action: 'add_mock', explanation: 'There might be a missing mock fixture.',
        suggestedNextStep: 'Provide a mock for the missing node.', confidence: 'medium' },
    ] }, nodeByRef, facts)).toThrowError(/outside the failed checks/);
    expect(() => validateDiagnosisResponse({ findings: [
      { nodeRef: 'n1', action: 'execute_arbitrary_code', explanation: 'Try something dangerous',
        suggestedNextStep: 'Run the workflow in production now.', confidence: 'high' },
    ] }, nodeByRef, facts)).toThrowError(/invalid diagnosis/);
    expect(() => validateDiagnosisResponse({ findings: [] }, nodeByRef, facts)).toThrowError(/invalid diagnosis/);
  });

  it('does not pass through provider 429 or invalid JSON as diagnosis', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: [{ type: 'text', text: 'not-json' }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(diagnoseOwnedSimulation('workflow-1', 'owner-1', scenario))
      .rejects.toMatchObject({ statusCode: 503, code: 'AI_RATE_LIMITED' });
    await expect(diagnoseOwnedSimulation('workflow-1', 'owner-1', scenario))
      .rejects.toMatchObject({ statusCode: 502, code: 'AI_DIAGNOSIS_INVALID' });
  });

  it('redacts credential-like strings from AI advice even when the model invents them', () => {
    const { facts, nodeByRef } = sanitizedFailureEvidence(failedRun);
    const findings = validateDiagnosisResponse({ findings: [
      { nodeRef: 'n1', action: 'inspect_fixture', explanation: 'Bearer invented-secret might appear.',
        suggestedNextStep: 'Check token=fictional-secret against the fixture.', confidence: 'low' },
    ] }, nodeByRef, facts);
    expect(JSON.stringify(findings)).not.toContain('invented-secret');
    expect(JSON.stringify(findings)).not.toContain('fictional-secret');
  });

  it('rejects isolated-mode AI requests before accessing the workflow or provider', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(diagnoseOwnedSimulation('workflow-1', 'owner-1', {
      ...scenario, mode: 'isolated',
    })).rejects.toMatchObject({ statusCode: 409, code: 'SIMULATION_DIAGNOSIS_MODE_UNSUPPORTED' });
    expect(mocks.simulate).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
