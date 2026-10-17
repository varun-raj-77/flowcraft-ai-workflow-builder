import { describe, expect, it } from 'vitest';
import type { SimulationNode } from '@/types/simulation';
import { buildSimulationScenario, initialConditionBranches, initialSimulationFixtures } from './simulationScenario';

const nodes: SimulationNode[] = [
  { id: 'start', label: 'Start', type: 'start' },
  { id: 'api', label: 'Fetch Issues', type: 'api_call' },
  { id: 'transform', label: 'Count Bugs', type: 'transform' },
  { id: 'decision', label: 'Review', type: 'condition' },
  { id: 'end', label: 'End', type: 'end' },
];

const defaults = () => ({
  revision: 3,
  nodes,
  fixtures: initialSimulationFixtures(nodes),
  conditionBranches: initialConditionBranches(nodes),
  expectedBranches: { decision: 'false' as const },
  assertions: [
    { id: '1', nodeId: 'api', path: 'status', expectedJson: '200' },
    { id: '2', nodeId: 'transform', path: 'data', expectedJson: 'null' },
  ],
});

describe('visual Test Lab fixture preparation', () => {
  it('generates useful mocks for API and transform but never enters code or network URLs', () => {
    const fixtures = initialSimulationFixtures(nodes);
    expect(JSON.parse(fixtures.api)).toEqual({ status: 200, data: [], headers: {} });
    expect(JSON.parse(fixtures.transform)).toEqual({ data: null });
    expect(Object.keys(fixtures)).toEqual(['api', 'transform']);
    expect(initialConditionBranches(nodes)).toEqual({ decision: 'true' });
  });

  it('constructs a revision-pinned scenario with explicit branch and output assertions', () => {
    const scenario = buildSimulationScenario(defaults());
    expect(scenario).toEqual({
      expectedRevision: 3,
      mocks: {
        api: { status: 200, data: [], headers: {} },
        transform: { data: null },
        decision: { branchTaken: 'true' },
      },
      assertions: [
        { nodeId: 'api', path: 'status', equals: 200 },
        { nodeId: 'transform', path: 'data', equals: null },
      ],
      expectedBranches: { decision: 'false' },
    });
  });

  it('accepts primitive expected JSON values and an optional full-output comparison', () => {
    const scenario = buildSimulationScenario({
      ...defaults(),
      assertions: [{ id: '3', nodeId: 'end', path: '', expectedJson: '{"success": true}' }],
      expectedBranches: {},
    });
    expect(scenario.assertions).toEqual([{ nodeId: 'end', equals: { success: true } }]);
    expect(scenario.expectedBranches).toEqual({});
  });

  it('rejects malformed fixture JSON, arrays, and missing API fields', () => {
    expect(() => buildSimulationScenario({ ...defaults(), fixtures: { ...defaults().fixtures, api: '{nope' } })).toThrow(/Fetch Issues: enter a valid JSON/);
    expect(() => buildSimulationScenario({ ...defaults(), fixtures: { ...defaults().fixtures, transform: '[1]' } })).toThrow(/Count Bugs: the mock must be a JSON object/);
    expect(() => buildSimulationScenario({ ...defaults(), fixtures: { ...defaults().fixtures, api: '{"status":200}' } })).toThrow(/HTTP status/);
  });

  it('rejects stale or unsaved revisions and invalid assertion data', () => {
    expect(() => buildSimulationScenario({ ...defaults(), revision: 0 })).toThrow(/Save this workflow/);
    expect(() => buildSimulationScenario({ ...defaults(), assertions: [{ id: '1', nodeId: 'unknown', path: '', expectedJson: '1' }] })).toThrow(/choose a workflow node/);
    expect(() => buildSimulationScenario({ ...defaults(), assertions: [{ id: '1', nodeId: 'api', path: 'constructor.prototype', expectedJson: 'true' }] })).toThrow(/simple field path/);
    expect(() => buildSimulationScenario({ ...defaults(), assertions: [{ id: '1', nodeId: 'api', path: 'status', expectedJson: 'invalid' }] })).toThrow(/valid JSON/);
  });

  it('rejects fixtures above the server 50 KB request budget', () => {
    expect(() => buildSimulationScenario({
      ...defaults(),
      fixtures: { ...defaults().fixtures, transform: JSON.stringify({ data: 'x'.repeat(51_000) }) },
    })).toThrow(/below 50 KB/);
  });
});
