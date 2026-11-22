import { expect, test } from '@playwright/test';
import { executableWorkflow, installMockApi } from './mockApi';

test('an interrupted save leaves the draft visible and a successful retry persists every edit', async ({ page }) => {
  const workflowId = 'workflow-save-recovery';
  const { workflows } = await installMockApi(page, { workflows: [executableWorkflow(workflowId)] });
  const submittedRevisions: number[] = [];

  await page.route(`**/api/workflows/${workflowId}`, async (route) => {
    const request = route.request();
    if (request.method() === 'PUT') {
      submittedRevisions.push(request.postDataJSON().expectedRevision);
      if (submittedRevisions.length === 1) {
        await route.fulfill({
          status: 503,
          json: { error: { code: 'UNAVAILABLE', message: 'The save service is temporarily unavailable.' } },
        });
        return;
      }
    }
    await route.fallback();
  });

  await page.goto(`/editor/${workflowId}`);
  const canvas = page.getByRole('application');
  const failure = page.getByRole('alert').filter({ hasText: 'Save failed' });
  const save = page.getByRole('button', { name: 'Save', exact: true });
  await page.getByRole('button', { name: 'Add Delay node', exact: true }).click();
  await save.click();
  await expect(failure).toContainText('The save service is temporarily unavailable.');
  await expect(failure).toContainText('Your edits are still here.');
  await expect(canvas.getByText('Delay', { exact: true })).toBeVisible();
  expect(workflows.get(workflowId)?.currentRevision).toBe(1);

  await page.getByRole('button', { name: 'Add Transform node', exact: true }).click();
  await expect(failure).toBeVisible();
  await save.click();

  await expect(failure).toHaveCount(0);
  await expect(page.getByText('v2', { exact: true })).toBeVisible();
  await expect(canvas.getByText('Delay', { exact: true })).toBeVisible();
  await expect(canvas.getByText('Transform', { exact: true })).toBeVisible();
  expect(submittedRevisions).toEqual([1, 1]);
  expect(workflows.get(workflowId)?.nodes).toHaveLength(5);
});
