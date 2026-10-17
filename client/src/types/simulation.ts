import type { NodeType } from './workflow';

export interface SimulationNode {
  id: string;
  label: string;
  type: NodeType;
}

export interface SimulationAssertionInput {
  nodeId: string;
  path?: string;
  equals: unknown;
}

export interface SimulationScenario {
  expectedRevision: number;
  mocks: Record<string, Record<string, unknown>>;
  assertions: SimulationAssertionInput[];
  expectedBranches: Record<string, 'true' | 'false'>;
}

export interface SimulationStep {
  nodeId: string;
  nodeType: NodeType;
  status: 'simulated' | 'mocked' | 'skipped' | 'failed';
  output?: Record<string, unknown>;
  error?: string;
}

export interface SimulationAssertionResult {
  nodeId: string;
  path?: string;
  passed: boolean;
  message: string;
}

export interface SimulationResult {
  status: 'passed' | 'failed';
  steps: SimulationStep[];
  assertions: SimulationAssertionResult[];
  provenance: { workflowRevision: number; definitionHash: string };
}

export interface SimulationDiagnosticFinding {
  nodeId: string;
  action: 'add_mock' | 'inspect_fixture' | 'review_assertion' | 'review_branch' | 'inspect_workflow';
  explanation: string;
  suggestedNextStep: string;
  confidence: 'low' | 'medium';
}

export interface SimulationDiagnosis {
  provider: 'anthropic';
  model: string;
  provenance: { workflowRevision: number; definitionHash: string };
  findings: SimulationDiagnosticFinding[];
  disclaimer: string;
}

export interface TestLabAssertionDraft {
  id: string;
  nodeId: string;
  path: string;
  expectedJson: string;
}
