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

  it('does not treat input.filter as an upstream node or endpoint field', () => {
    expect(validateGeneratedWorkflowConsistency({ nodes: [node('transform', 'transform', { transformCode: 'return input.filter((user) => user.email)' })] })).toEqual([]);
    expect(validateGeneratedWorkflowConsistency({ nodes: [node('users', 'api_call', { url: 'https://jsonplaceholder.typicode.com/users' }), node('transform', 'transform', { transformCode: 'return input.users.filter((user) => user.email)' })] })[0]?.code).toBe('AI_UNSAFE_API_COLLECTION_ACCESS');
  });

  it('does not treat array length as an endpoint field', () => {
    expect(validateGeneratedWorkflowConsistency({ nodes: [node('transform', 'transform', { transformCode: 'return input.length' })] })).toEqual([]);
    expect(validateGeneratedWorkflowConsistency({ nodes: [node('users', 'api_call', { url: 'https://jsonplaceholder.typicode.com/users' }), node('transform', 'transform', { transformCode: 'return input.users.data.length' })] })).toEqual([]);
  });

  it('validates callback email access while ignoring endsWith and possible empty results', () => {
    const issues = validateGeneratedWorkflowConsistency({ nodes: [
      node('users', 'api_call', { url: 'https://jsonplaceholder.typicode.com/users' }),
      node('transform', 'transform', { transformCode: 'if (!Array.isArray(input.users.data)) throw new Error("Expected users array"); return input.users.data.filter((user) => user.email.endsWith(".biz"))' }),
    ] });
    expect(issues).toEqual([]);
  });

  it('ignores map while validating its record field', () => {
    expect(validateGeneratedWorkflowConsistency({ nodes: [
      node('users', 'api_call', { url: 'https://jsonplaceholder.typicode.com/users' }),
      node('transform', 'transform', { transformCode: 'if (!Array.isArray(input.users.data)) throw new Error("Expected users array"); return input.users.data.map((user) => user.name)' }),
    ] })).toEqual([]);
    expect(validateGeneratedWorkflowConsistency({ nodes: [
      node('users', 'api_call', { url: 'https://jsonplaceholder.typicode.com/users' }),
      node('transform', 'transform', { transformCode: 'if (!Array.isArray(input.users.data)) throw new Error("Expected users array"); return input.users.data.map((user) => user.orderTotal)' }),
    ] })[0]).toMatchObject({ code: 'AI_KNOWN_ENDPOINT_FIELD_MISMATCH', apiNodeId: 'users' });
  });

  it('still rejects unsupported record fields used inside collection callbacks', () => {
    const issues = validateGeneratedWorkflowConsistency({ nodes: [
      node('users', 'api_call', { url: 'https://jsonplaceholder.typicode.com/users' }),
      node('transform', 'transform', { transformCode: 'if (!Array.isArray(input.users.data)) throw new Error("Expected users array"); return input.users.data.filter((user) => user.orderTotal > 100)' }),
    ] });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'AI_KNOWN_ENDPOINT_FIELD_MISMATCH', apiNodeId: 'users' });
    expect(issues[0].message).toContain('expects "orderTotal"');
  });

  it('ignores reduce and string/object methods while retaining known field checks', () => {
    expect(validateGeneratedWorkflowConsistency({ nodes: [
      node('users', 'api_call', { url: 'https://jsonplaceholder.typicode.com/users' }),
      node('transform', 'transform', { transformCode: 'if (!Array.isArray(input.users.data)) throw new Error("Expected users array"); return input.users.data.reduce((names, user) => names.concat(user.name.toLowerCase().includes("a") ? Object.keys(user) : []), [])' }),
    ] })).toEqual([]);
  });

  it('requires generated API collection transforms to resolve and validate the payload', () => {
    const api = node('issues', 'api_call', { url: 'https://api.github.com/issues' });
    expect(validateGeneratedWorkflowConsistency({ nodes: [
      api,
      node('transform', 'transform', { transformCode: 'const issues = input.issues; issues.forEach(() => {}); return issues' }),
    ] })[0]?.code).toBe('AI_UNSAFE_API_COLLECTION_ACCESS');
    expect(validateGeneratedWorkflowConsistency({ nodes: [
      api,
      node('transform', 'transform', { transformCode: 'const issues = input.issues.data; return issues.filter(Boolean)' }),
    ] })[0]?.code).toBe('AI_UNSAFE_API_COLLECTION_ACCESS');
    expect(validateGeneratedWorkflowConsistency({ nodes: [
      api,
      node('transform', 'transform', { transformCode: 'const issues = input.issues?.data ?? input.issues; if (!Array.isArray(issues)) throw new Error("Expected an array from Fetch GitHub Issues"); return issues.filter(Boolean)' }),
    ] })).toEqual([]);
  });

  it('retains known endpoint field validation through a guarded payload alias', () => {
    const issues = validateGeneratedWorkflowConsistency({ nodes: [
      node('users', 'api_call', { url: 'https://jsonplaceholder.typicode.com/users' }),
      node('transform', 'transform', { transformCode: 'const users = input.users.data; if (!Array.isArray(users)) throw new Error("Expected users array"); return users.filter((user) => user.orderTotal > 100)' }),
    ] });
    expect(issues[0]).toMatchObject({ code: 'AI_KNOWN_ENDPOINT_FIELD_MISMATCH', apiNodeId: 'users' });
  });
});
