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
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Workflows', exact: true })).toBeVisible();
  });

  test('creates a manual workflow', async ({ page }) => {
    await installMockApi(page);
    await page.goto('/dashboard');

    await page.getByRole('button', { name: 'New Workflow' }).click();
    await expect(page).toHaveURL(/\/editor\/workflow-1$/);
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
