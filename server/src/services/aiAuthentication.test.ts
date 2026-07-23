import { describe, expect, it } from 'vitest';
import {
  isPublicGitHubRepositoryIssuesUrl,
  validateGeneratedApiAuthentication,
  validatePromptAuthenticationIntent,
} from './aiAuthentication';

const apiWorkflow = (url: string, headers: Record<string, string> = {}) => ({
  nodes: [{
    id: 'node_1',
    type: 'api_call',
    label: 'Fetch GitHub Issues',
    config: { url, method: 'GET', headers },
  }],
});

describe('AI authentication safety', () => {
  it('blocks authenticated-user GitHub intent without calling it anonymous', () => {
    const prompts = [
      'Build a GitHub workflow for issues assigned to me',
      'Fetch my GitHub issues and group them',
      'Summarize private repositories on GitHub',
      'List GitHub issues assigned to the authenticated user',
    ];
    for (const prompt of prompts) {
      expect(validatePromptAuthenticationIntent(prompt)).toMatchObject({
        code: 'AI_AUTHENTICATION_REQUIRED',
        message: expect.stringContaining('does not currently support safe secret references'),
      });
    }
  });

  it('does not invent or expose a username or token in the validation response', () => {
    const issue = validatePromptAuthenticationIntent('Fetch GitHub issues assigned to me');
    expect(issue?.message).not.toMatch(/Bearer|ghp_|github_pat_|YOUR_|username/i);
    expect(issue?.message).toContain('specific owner/repository');
  });

  it('allows public repository issue endpoints', () => {
    const url = 'https://api.github.com/repos/facebook/react/issues?state=open';
    expect(isPublicGitHubRepositoryIssuesUrl(url)).toBe(true);
    expect(validatePromptAuthenticationIntent('Fetch open bug issues from facebook/react and group them by priority labels')).toBeNull();
    expect(validateGeneratedApiAuthentication(apiWorkflow(url))).toEqual([]);
  });

  it('blocks the authenticated-user endpoint when Authorization is absent', () => {
    expect(validateGeneratedApiAuthentication(apiWorkflow('https://api.github.com/issues?state=open'))[0]).toMatchObject({
      code: 'AI_AUTHENTICATION_REQUIRED',
      apiNodeId: 'node_1',
    });
  });

  it('rejects unsupported secret placeholders instead of pretending they resolve', () => {
    const issues = validateGeneratedApiAuthentication(apiWorkflow(
      'https://api.github.com/issues',
      { Authorization: 'Bearer {{secrets.GITHUB_TOKEN}}', Accept: 'application/vnd.github+json' },
    ));
    expect(issues[0]).toMatchObject({ code: 'AI_UNSUPPORTED_SECRET_REFERENCE' });
    expect(issues[0].message).not.toContain('GITHUB_TOKEN');
  });

  it('rejects generated literal credentials without echoing their value', () => {
    const credential = 'Bearer literal-test-credential';
    const issues = validateGeneratedApiAuthentication(apiWorkflow(
      'https://api.github.com/issues',
      { authorization: credential },
    ));
    expect(issues[0]).toMatchObject({ code: 'AI_UNSAFE_EMBEDDED_CREDENTIAL' });
    expect(JSON.stringify(issues)).not.toContain(credential);
  });
});
