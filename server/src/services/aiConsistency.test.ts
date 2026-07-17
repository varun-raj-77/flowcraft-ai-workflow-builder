import { describe, expect, it } from 'vitest';
import { validateGeneratedWorkflowConsistency } from './aiConsistency';

const node = (id: string, type: string, config: Record<string, unknown> = {}) => ({ id, type, label: id, config });

describe('generated workflow consistency', () => {
  it('blocks users endpoints whose transform expects post body fields', () => {
    const issues = validateGeneratedWorkflowConsistency({ nodes: [node('api', 'api_call', { url: 'https://jsonplaceholder.typicode.com/users/1' }), node('transform', 'transform', { transformCode: 'return input.api.body.length' })] });
    expect(issues[0]?.code).toBe('AI_KNOWN_ENDPOINT_FIELD_MISMATCH');
  });
  it('accepts known JSONPlaceholder post and todo fields', () => {
    expect(validateGeneratedWorkflowConsistency({ nodes: [node('posts', 'api_call', { url: 'https://jsonplaceholder.typicode.com/posts/1' }), node('todos', 'api_call', { url: 'https://jsonplaceholder.typicode.com/todos/1' }), node('transform', 'transform', { transformCode: 'return input.posts.body.length + Number(input.todos.completed)' })] })).toEqual([]);
  });
  it('blocks nonexistent upstream references and leaves unknown APIs unblocked', () => {
    expect(validateGeneratedWorkflowConsistency({ nodes: [node('transform', 'transform', { transformCode: 'return input.missing.value' })] })[0]?.code).toBe('AI_NONEXISTENT_UPSTREAM_NODE');
    expect(validateGeneratedWorkflowConsistency({ nodes: [node('api', 'api_call', { url: 'https://example.com/users' }), node('transform', 'transform', { transformCode: 'return input.api.body.length' })] })).toEqual([]);
  });
});
