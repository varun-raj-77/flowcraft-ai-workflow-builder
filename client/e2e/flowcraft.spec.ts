import { expect, test } from '@playwright/test';
import { executableWorkflow, installMockApi } from './mockApi';

test.describe('FlowCraft critical journeys', () => {
  test('rejects invalid credentials and accepts a valid login', async ({ page }) => {
    await installMockApi(page, { authenticated: false });
    await page.goto('/login');

    await page.getByLabel('Email').fill('engineer@example.com');
    await page.getByLabel('Password').fill('wrong-password');
    const invalidLogin = page.waitForResponse((response) => (
      response.url().endsWith('/api/auth/login') && response.status() === 401
    ));
    await page.getByRole('button', { name: 'Sign in' }).click();
    await invalidLogin;
    await expect(page.getByText('Invalid email or password', { exact: true })).toBeVisible();

    await page.getByLabel('Password').fill('correct-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Workflows', exact: true })).toBeVisible();
  });

  test('creates a manual workflow', async ({ page }) => {
    await installMockApi(page);
    await page.goto('/dashboard');

    await page.getByRole('button', { name: 'New Workflow' }).click();
    await expect(page).toHaveURL(/\/editor\/workflow-1$/, { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Untitled Workflow' })).toBeVisible();
  });

  test('generates an AI workflow from a mocked provider response and saves it', async ({ page }) => {
    await installMockApi(page);
    await page.goto('/dashboard');

    await page.getByRole('button', { name: 'Generate with AI' }).click();
    const dialog = page.getByRole('dialog', { name: 'Generate with AI' });
    await dialog.getByPlaceholder(/Fetch data from an API/).fill('Create a release summary and output the result');
    await dialog.getByRole('button', { name: 'Generate Workflow' }).click();

    await expect(page).toHaveURL(/\/editor\/new$/);
    await expect(page.getByRole('button', { name: 'AI Release Digest' })).toBeVisible();
    const saveRequest = page.waitForRequest((request) => (
      request.url().endsWith('/api/workflows') && request.method() === 'POST'
    ));
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const persisted = await saveRequest;
    expect(persisted.postDataJSON()).toMatchObject({
      name: 'AI Release Digest',
      generationMetadata: { originalPrompt: 'Create a release summary and output the result' },
    });
    await expect(page).toHaveURL(/\/editor\/workflow-1$/);
    await expect(page.getByRole('button', { name: 'AI Release Digest' })).toBeVisible();
  });

  test('regenerates AI prompt P1 to P2 as v2 and reloads authoritative lineage', async ({ page }) => {
    const base = executableWorkflow('workflow-ai-lineage');
    const workflow = {
      ...base,
      isGeneratedByAI: true,
      generationMetadata: {
        originalPrompt: 'Prompt P1',
        generatedAt: '2026-07-23T11:00:00.000Z',
        provider: 'mock',
        model: 'mock-flowcraft',
      },
    };
    const state = await installMockApi(page, { workflows: [workflow] });
    await page.goto('/editor/workflow-ai-lineage');

    await page.getByRole('button', { name: '✦ AI Generate' }).click();
    let dialog = page.getByRole('dialog', { name: 'Generate with AI' });
    const prompt = dialog.getByLabel('Workflow prompt');
    await expect(prompt).toHaveValue('Prompt P1');
    await expect(dialog.getByText('Based on the prompt used to generate this workflow.')).toBeVisible();
    await prompt.fill('Prompt P2');
    const regenerate = page.waitForResponse((response) => (
      response.url().endsWith('/api/ai/workflows/workflow-ai-lineage/regenerate')
      && response.request().method() === 'POST'
    ));
    await dialog.getByRole('button', { name: 'Generate Workflow' }).click();
    expect((await regenerate).status()).toBe(201);

    await expect(page.getByText('v2', { exact: true })).toBeVisible();
    expect(state.revisions.get('workflow-ai-lineage')).toMatchObject([
      { revision: 1, source: 'ai_generated', generationMetadata: { originalPrompt: 'Prompt P1' } },
      { revision: 2, source: 'ai_generated', generationMetadata: { originalPrompt: 'Prompt P2' } },
    ]);

    await page.getByRole('button', { name: '✦ AI Generate' }).click();
    dialog = page.getByRole('dialog', { name: 'Generate with AI' });
    await expect(dialog.getByLabel('Workflow prompt')).toHaveValue('Prompt P2');
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    await page.reload();
    await expect(page.getByRole('button', { name: 'AI Release Digest' })).toBeVisible();
    await page.getByRole('button', { name: '✦ AI Generate' }).click();
    dialog = page.getByRole('dialog', { name: 'Generate with AI' });
    await expect(dialog.getByLabel('Workflow prompt')).toHaveValue('Prompt P2');
  });

  test('opens a manual workflow with an empty AI prompt and no invented history', async ({ page }) => {
    const workflow = executableWorkflow('workflow-manual-lineage');
    await installMockApi(page, { workflows: [workflow] });
    await page.goto('/editor/workflow-manual-lineage');

    await page.getByRole('button', { name: '✦ AI Generate' }).click();
    const dialog = page.getByRole('dialog', { name: 'Generate with AI' });
    await expect(dialog.getByLabel('Workflow prompt')).toBeEnabled();
    await expect(dialog.getByLabel('Workflow prompt')).toHaveValue('');
    await expect(dialog.getByText('Based on the prompt used to generate this workflow.')).toHaveCount(0);
    await expect(dialog.getByText(/previous prompt|saved prompt/i)).toHaveCount(0);
  });

  test('executes a deterministic saved workflow', async ({ page }) => {
    const workflow = executableWorkflow();
    await installMockApi(page, { workflows: [workflow] });
    await page.goto('/editor/workflow-ready');

    await page.getByRole('button', { name: 'Run', exact: true }).click();
    const inspector = page.getByRole('region', { name: 'Execution Inspector', exact: true });
    await expect(inspector).toContainText('completed');
    await expect(inspector).toContainText('3/3 steps');
    await expect(inspector.getByRole('button', { name: /Output Summary Success/ })).toBeVisible();
  });

  test('rejects a stale graph save from a second client', async ({ browser }) => {
    const workflow = executableWorkflow('workflow-shared');
    const workflowState = new Map([[String(workflow._id), workflow]]);
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();
      await installMockApi(pageA, { workflowState });
      await installMockApi(pageB, { workflowState });

      await Promise.all([
        pageA.goto('/editor/workflow-shared'),
        pageB.goto('/editor/workflow-shared'),
      ]);
      await expect(pageA.getByRole('button', { name: 'Release summary' })).toBeVisible();
      await expect(pageB.getByRole('button', { name: 'Release summary' })).toBeVisible();

      await pageA.getByRole('button', { name: 'Add Delay node' }).click();
      const firstSave = pageA.waitForResponse((response) => (
        response.url().endsWith('/api/workflows/workflow-shared')
        && response.request().method() === 'PUT'
      ));
      await pageA.getByRole('button', { name: 'Save', exact: true }).click();
      expect((await firstSave).status()).toBe(200);
      expect(workflowState.get('workflow-shared')?.currentRevision).toBe(2);

      await pageB.getByRole('button', { name: 'Add Delay node' }).click();
      const staleSave = pageB.waitForResponse((response) => (
        response.url().endsWith('/api/workflows/workflow-shared')
        && response.request().method() === 'PUT'
      ));
      await pageB.getByRole('button', { name: 'Save', exact: true }).click();
      const staleResponse = await staleSave;

      expect(staleResponse.status()).toBe(409);
      await expect(staleResponse.json()).resolves.toMatchObject({
        error: { code: 'WORKFLOW_REVISION_CONFLICT' },
      });
      await expect(pageB.getByText('Save failed', { exact: true })).toBeVisible();
      expect(workflowState.get('workflow-shared')?.currentRevision).toBe(2);
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test('previews v1 read-only and restores it as new v3 without rewinding history', async ({ page }) => {
    const workflow = executableWorkflow('workflow-history');
    const mockState = await installMockApi(page, { workflows: [workflow] });
    await page.goto('/editor/workflow-history');
    const canvas = page.getByRole('application');
    await expect(canvas.getByText('Output Summary', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Add Delay node' }).click();
    await expect(canvas.getByText('Delay', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('v2', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: /History/ }).click();
    let history = page.getByRole('dialog', { name: 'Revision history' });
    await expect(history.getByText('Current', { exact: true })).toBeVisible();
    await history.getByRole('button', { name: 'View revision v1' }).click();

    await expect(page.getByText('Viewing v1')).toBeVisible();
    await expect(page.getByText('Historical revision · Read only')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add Delay node' })).toHaveCount(0);
    await expect(canvas.getByText('Delay', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeDisabled();

    await page.getByRole('button', { name: 'Back to current v2' }).click();
    await expect(canvas.getByText('Delay', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: /History/ }).click();
    history = page.getByRole('dialog', { name: 'Revision history' });
    await history.getByRole('button', { name: 'View revision v1' }).click();
    await page.getByRole('button', { name: 'Restore v1' }).click();
    const restoreDialog = page.getByRole('alertdialog', { name: 'Restore v1?' });
    await expect(restoreDialog).toContainText('create a new revision');
    await restoreDialog.getByRole('button', { name: 'Restore as new revision' }).click();

    await expect(page.getByText('v3', { exact: true })).toBeVisible();
    await expect(page.getByText('Viewing v1')).toHaveCount(0);
    await expect(canvas.getByText('Delay', { exact: true })).toHaveCount(0);
    expect(mockState.workflows.get('workflow-history')?.currentRevision).toBe(3);
    expect(mockState.revisions.get('workflow-history')?.map((revision) => revision.revision)).toEqual([1, 2, 3]);

    await page.getByRole('button', { name: /History/ }).click();
    history = page.getByRole('dialog', { name: 'Revision history' });
    const historyItems = history.locator('ol > li');
    await expect(historyItems).toHaveCount(3);
    await expect(historyItems.nth(0)).toContainText('v3');
    await expect(historyItems.nth(0)).toContainText('Current');
    await expect(historyItems.nth(0)).toContainText('Restored from v1');
    await expect(historyItems.nth(1)).toContainText('v2');
    await expect(historyItems.nth(2)).toContainText('v1');
  });

  test('compares revisions read-only and traces an older execution to its exact workflow definition', async ({ page }) => {
    const workflow = executableWorkflow('workflow-comparison');
    await installMockApi(page, { workflows: [workflow] });
    await page.goto('/editor/workflow-comparison');
    const canvas = page.getByRole('application');

    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(page.getByLabel('Execution workflow revision')).toContainText('Executed v1 · same as current revision');

    await page.getByRole('button', { name: 'Add Delay node' }).click();
    await expect(canvas.getByText('Delay', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('v2', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: /History/ }).click();
    const history = page.getByRole('dialog', { name: 'Revision history' });
    await history.getByRole('button', { name: 'Compare revision v1 with current v2' }).click();

    await expect(page.getByText('Comparing v1 → v2')).toBeVisible();
    const changes = page.getByRole('complementary', { name: 'Revision changes' });
    await expect(changes).toContainText('Added nodes');
    await expect(changes.getByRole('button', { name: /Delay/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Add Delay node' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Back to current v2' }).click();
    await expect(canvas.getByText('Delay', { exact: true })).toBeVisible();

    const inspector = page.getByRole('region', { name: 'Execution Inspector', exact: true });
    await inspector.getByRole('tab', { name: 'History' }).click();
    await inspector.getByRole('button', { name: /completed · manual/i }).click();
    const provenance = page.getByLabel('Execution workflow revision');
    await expect(provenance).toContainText('Executed v1 · current v2');
    await expect(provenance.locator('code')).toHaveAttribute('title', 'a'.repeat(64));

    await provenance.getByRole('button', { name: 'View exact revision v1' }).click();
    await expect(page.getByText('Viewing v1')).toBeVisible();
    await expect(canvas.getByText('Delay', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Back to current v2' }).click();
    await expect(canvas.getByText('Delay', { exact: true })).toBeVisible();

    await provenance.getByRole('button', { name: 'Compare executed → current' }).click();
    await expect(page.getByText('Comparing v1 → v2')).toBeVisible();
  });

  test('cancels and confirms workflow deletion', async ({ page }) => {
    const workflow = executableWorkflow();
    await installMockApi(page, { workflows: [workflow] });
    await page.goto('/dashboard');
    await expect(page.getByRole('link', { name: 'Open Release summary' })).toBeVisible();

    page.once('dialog', async (dialog) => dialog.dismiss());
    await page.getByRole('button', { name: 'Delete Release summary' }).click();
    await expect(page.getByRole('link', { name: 'Open Release summary' })).toBeVisible();

    page.once('dialog', async (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Delete Release summary' }).click();
    await expect(page.getByRole('link', { name: 'Open Release summary' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'No workflows yet' })).toBeVisible();
  });
});
