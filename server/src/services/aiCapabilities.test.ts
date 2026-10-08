import { describe, expect, it } from 'vitest';
import { assessCapabilityCoverage, identifyRequestedCapabilities } from './aiCapabilities';

const start = { id: 'start', type: 'start', label: 'Start', config: {} };
const end = { id: 'end', type: 'end', label: 'End', config: {} };

describe('AI capability coverage', () => {
  it('requires a transform when the prompt requests one', () => {
    const coverage = assessCapabilityCoverage('Fetch data, transform response, and return result', { nodes: [start, { id: 'api', type: 'api_call', label: 'Fetch data', config: {} }, { id: 'out', type: 'output', label: 'Return result', config: {} }, end], edges: [{ source: 'start', target: 'api' }, { source: 'api', target: 'out' }, { source: 'out', target: 'end' }] });
    expect(coverage.missingCapabilities).toContain('transform');
    expect(coverage.isComplete).toBe(false);
  });

  it('does not accept an HTTP-status condition as customer qualification', () => {
    const coverage = assessCapabilityCoverage('Call an enrichment API and qualify customer based on company size and industry', { nodes: [start, { id: 'api', type: 'api_call', label: 'Enrich customer', config: { url: 'https://example.test/enrich' } }, { id: 'condition', type: 'condition', label: 'Status OK', config: { expression: '{{api.status}} === 200' } }, end], edges: [{ source: 'start', target: 'api' }, { source: 'api', target: 'condition' }, { source: 'condition', target: 'end' }] });
    expect(coverage.missingCapabilities).toContain('qualification_condition');
  });

  it('ignores explicitly excluded capabilities in the interview demo prompt', () => {
    const prompt = "Create a workflow with four nodes connected in order: Start, Delay, Output, End. Configure Delay to wait 1000 milliseconds. Configure Output to log the message 'FlowCraft demo successful' at info level. Do not use external APIs, authentication, transformations, or condition branches.";
    expect(identifyRequestedCapabilities(prompt)).toEqual(['delay', 'output']);
    const coverage = assessCapabilityCoverage(prompt, {
      nodes: [
        start,
        { id: 'delay', type: 'delay', label: 'Delay', config: { delayMs: 1000 } },
        { id: 'output', type: 'output', label: 'Log', config: { logLevel: 'info', message: 'FlowCraft demo successful' } },
        end,
      ],
      edges: [{ source: 'start', target: 'delay' }, { source: 'delay', target: 'output' }, { source: 'output', target: 'end' }],
    });
    expect(coverage.isComplete).toBe(true);
    expect(coverage.missingCapabilities).toEqual([]);
  });

  it('retains affirmative instructions after contrasted prohibitions', () => {
    expect(identifyRequestedCapabilities('Do not call an API or add a condition; instead, wait 1 second and log the result')).toEqual(['delay', 'output']);
    expect(identifyRequestedCapabilities('Fetch data but do not transform it. Log the result')).toEqual(['api_call', 'output']);
    expect(identifyRequestedCapabilities('Create a workflow without condition branches or API calls. Wait one second, then output the result')).toEqual(['delay', 'output']);
  });

  it('marks executable AI summaries as unsupported', () => {
    const coverage = assessCapabilityCoverage('Fetch data and generate an AI summary', { nodes: [start, { id: 'api', type: 'api_call', label: 'Fetch data', config: {} }, { id: 'out', type: 'output', label: 'Log summary', config: {} }, end], edges: [{ source: 'start', target: 'api' }, { source: 'api', target: 'out' }, { source: 'out', target: 'end' }] });
    expect(coverage.unsupportedCapabilities).toContain('ai_summary');
    expect(coverage.isComplete).toBe(false);
  });

  it('reports a fully-supported ordered workflow as complete', () => {
    const prompt = 'Call API, transform response, check condition, then return result';
    expect(identifyRequestedCapabilities(prompt)).toEqual(['api_call', 'transform', 'qualification_condition', 'output']);
    const coverage = assessCapabilityCoverage(prompt, { nodes: [start, { id: 'api', type: 'api_call', label: 'Call API', config: {} }, { id: 'transform', type: 'transform', label: 'Transform response', config: {} }, { id: 'condition', type: 'condition', label: 'Check condition', config: {} }, { id: 'output', type: 'output', label: 'Return result', config: {} }, end], edges: [{ source: 'start', target: 'api' }, { source: 'api', target: 'transform' }, { source: 'transform', target: 'condition' }, { source: 'condition', target: 'output' }, { source: 'output', target: 'end' }] });
    expect(coverage.isComplete).toBe(true);
  });
});
