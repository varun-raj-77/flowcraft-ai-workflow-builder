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

test('first save keeps later edits while moving to the saved workflow URL', async ({ page }) => {
  const workflowId = 'workflow-1';
  const { workflows } = await installMockApi(page, { workflows: [] });
  let releaseCreate!: () => void;
  const createGate = new Promise<void>((resolve) => { releaseCreate = resolve; });
  const createPayloads: Array<{ nodes: Array<{ type: string }> }> = [];
  const updates: Array<{ expectedRevision: number }> = [];
  let loads = 0;
  await page.route(/\/api\/workflows(?:\/workflow-1)?$/, async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      createPayloads.push(request.postDataJSON());
      await createGate;
    } else if (request.method() === 'PUT') {
      updates.push(request.postDataJSON());
    } else if (request.url().endsWith(`/${workflowId}`)) {
      loads += 1;
    }
    await route.fallback();
  });

  await page.goto('/editor/new');
  const canvas = page.getByRole('application');
  const transform = canvas.getByText('Transform', { exact: true });
  await expect(canvas).toBeVisible();
  await page.getByRole('button', { name: 'Add Delay node', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  try {
    await expect.poll(() => createPayloads.map((payload) => payload.nodes.map((node) => node.type))).toEqual([['delay']]);
    await page.getByRole('button', { name: 'Add Transform node', exact: true }).click();
    await expect(transform).toBeVisible();
  } finally {
    releaseCreate();
  }

  await expect(page).toHaveURL(/\/editor\/workflow-1$/);
  await expect(page.getByText('v1', { exact: true })).toBeVisible();
  await expect(transform).toBeVisible();
  await expect(page.getByText('Unsaved', { exact: true })).toBeVisible();
  expect(workflows.get(workflowId)?.nodes).toHaveLength(1);
  expect(loads).toBe(0);

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(transform).toHaveCount(0);
  await expect(page.getByText('Unsaved', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(transform).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('v2', { exact: true })).toBeVisible();
  expect(createPayloads).toHaveLength(1);
  expect(updates.map((payload) => payload.expectedRevision)).toEqual([1]);
  expect(workflows.get(workflowId)?.nodes).toHaveLength(2);
  expect(loads).toBe(0);

  await page.getByRole('link', { name: 'FlowCraft dashboard', exact: true }).click();
  await page.getByRole('link', { name: 'Open Untitled Workflow', exact: true }).click();
  await expect(transform).toBeVisible();
  expect(loads).toBeGreaterThan(0);
});
