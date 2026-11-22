import { expect, test } from '@playwright/test';
import { executableWorkflow, installMockApi } from './mockApi';

test('a temporary workflow load error can be retried without leaving the editor', async ({ page }) => {
  const workflowId = 'workflow-load-retry';
  await installMockApi(page, { workflows: [executableWorkflow(workflowId)] });
  let releaseFirstLoad!: () => void;
  const firstLoad = new Promise<void>((resolve) => { releaseFirstLoad = resolve; });
  let failLoad = true;

  await page.route(`**/api/workflows/${workflowId}`, async (route) => {
    if (!failLoad) {
      await route.fallback();
      return;
    }
    await firstLoad;
    await route.fulfill({
      status: 503,
      json: { error: { code: 'UNAVAILABLE', message: 'The workflow service is temporarily unavailable.' } },
    });
  });

  await page.goto(`/editor/${workflowId}`);
  try {
    await expect(page.getByRole('status').filter({ hasText: 'Loading workflow' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add Delay node', exact: true })).toHaveCount(0);
  } finally {
    releaseFirstLoad();
  }

  await expect(page.getByRole('heading', { name: 'Could not load workflow' })).toBeVisible();
  await expect(page.getByText('The workflow service is temporarily unavailable.')).toBeVisible();
  failLoad = false;
  await page.getByRole('button', { name: 'Try again' }).click();

  await expect(page).toHaveURL(new RegExp(`/editor/${workflowId}$`));
  await expect(page.getByRole('application').getByText('Output Summary', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add Delay node', exact: true })).toBeVisible();
});

test('a missing workflow offers a dashboard exit instead of retrying', async ({ page }) => {
  await installMockApi(page);
  await page.goto('/editor/does-not-exist');

  await expect(page.getByRole('heading', { name: 'Workflow not found' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Back to Dashboard' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test('leaving a loading workflow aborts its request and keeps the next workflow active', async ({ page }) => {
  const oldWorkflow = { ...executableWorkflow('workflow-load-old'), name: 'Old workflow' };
  const nextWorkflow = { ...executableWorkflow('workflow-load-next'), name: 'Next workflow' };
  await installMockApi(page, { workflows: [oldWorkflow, nextWorkflow] });

  let releaseOldLoad!: () => void;
  const oldLoad = new Promise<void>((resolve) => { releaseOldLoad = resolve; });
  const oldUrl = `/api/workflows/${oldWorkflow._id}`;
  let intercepted = false;
  let failedAfterNavigation = false;
  let leaving = false;
  page.on('requestfailed', (request) => {
    if (leaving && new URL(request.url()).pathname === oldUrl) failedAfterNavigation = true;
  });
  await page.route(`**${oldUrl}`, async (route) => {
    intercepted = true;
    await oldLoad;
    await route.fallback();
  });

  await page.goto(`/editor/${oldWorkflow._id}`);
  try {
    await expect.poll(() => intercepted).toBe(true);
    leaving = true;
    await page.getByRole('link', { name: 'FlowCraft dashboard', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.getByRole('link', { name: 'Open Next workflow', exact: true }).click();
    await expect(page).toHaveURL(/\/editor\/workflow-load-next$/);
    await expect(page.getByRole('button', { name: 'Next workflow', exact: true })).toBeVisible();
  } finally {
    releaseOldLoad();
  }

  await expect.poll(() => failedAfterNavigation).toBe(true);
  await expect(page.getByRole('button', { name: 'Next workflow', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Old workflow', exact: true })).toHaveCount(0);
});
