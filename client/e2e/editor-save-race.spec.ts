import { expect, test } from '@playwright/test';
import { executableWorkflow, installMockApi } from './mockApi';

test('a save acknowledgement preserves newer edits and their Undo/Redo', async ({ page }) => {
  const workflowId = 'workflow-save-race';
  const { workflows } = await installMockApi(page, { workflows: [executableWorkflow(workflowId)] });
  let releaseSave!: () => void;
  const firstSaveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
  const requestedRevisions: number[] = [];
  await page.route(`**/api/workflows/${workflowId}`, async (route) => {
    if (route.request().method() === 'PUT') {
      requestedRevisions.push(route.request().postDataJSON().expectedRevision);
      if (requestedRevisions.length === 1) await firstSaveGate;
    }
    await route.fallback();
  });

  await page.goto(`/editor/${workflowId}`);
  const canvas = page.getByRole('application');
  await expect(canvas.getByText('Output Summary', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add Delay node', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const transform = canvas.getByText('Transform', { exact: true });
  try {
    await expect.poll(() => requestedRevisions).toEqual([1]);
    await page.getByRole('button', { name: 'Add Transform node', exact: true }).click();
    await expect(transform).toHaveCount(1);
  } finally {
    releaseSave();
  }

  await expect(page.getByText('v2', { exact: true })).toBeVisible();
  await expect(transform).toHaveCount(1);
  await expect(page.getByText('Unsaved', { exact: true })).toBeVisible();
  expect(workflows.get(workflowId)?.nodes).toHaveLength(4);

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(transform).toHaveCount(0);
  await expect(page.getByText('Unsaved', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(transform).toHaveCount(1);
  await expect(page.getByText('Unsaved', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('v3', { exact: true })).toBeVisible();
  await expect(page.getByText('Unsaved', { exact: true })).toHaveCount(0);
  expect(requestedRevisions).toEqual([1, 2]);
  expect(workflows.get(workflowId)?.nodes).toHaveLength(5);
});
