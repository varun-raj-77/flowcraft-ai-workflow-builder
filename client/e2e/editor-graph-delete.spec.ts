import { expect, test, type Page } from '@playwright/test';
import { executableWorkflow, installMockApi } from './mockApi';

async function openWorkflow(page: Page, directPath = false) {
  const workflow = executableWorkflow('workflow-graph-delete');
  if (directPath) workflow.edges.push({ id: 'start-end', source: 'start', target: 'end' });
  await installMockApi(page, { workflows: [workflow] });
  await page.goto('/editor/workflow-graph-delete');
  const canvas = page.getByRole('application');
  await expect(canvas.getByText('Output Summary', { exact: true })).toBeVisible();
  return canvas;
}

function handleNextDialog(page: Page, action: 'accept' | 'dismiss') {
  const dialogs: Array<{ type: string; message: string }> = [];
  page.once('dialog', async (dialog) => {
    dialogs.push({ type: dialog.type(), message: dialog.message() });
    await dialog[action]();
  });
  return dialogs;
}

async function afterGraphPaint(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => { requestAnimationFrame(() => resolve()); });
  }));
}

test('keyboard Delete does not remove the Start node or dirty the workflow', async ({ page }) => {
  const canvas = await openWorkflow(page);
  const start = canvas.getByText('Start', { exact: true });
  await start.click();
  await expect(page.getByRole('complementary', { name: 'Node configuration' })).toBeVisible();

  const dialogs = handleNextDialog(page, 'dismiss');
  await canvas.locator('[data-id="start"]').press('Delete');
  await afterGraphPaint(page);

  expect(dialogs).toEqual([{ type: 'alert', message: expect.stringMatching(/delete start/i) }]);
  await expect(start).toBeVisible();
  await expect(canvas.locator('.react-flow__edge')).toHaveCount(2);
  await expect(page.getByText('Unsaved', { exact: true })).toHaveCount(0);
});

test('cancelling keyboard reconnect preserves the graph; accepting is one undoable edit', async ({ page }) => {
  const canvas = await openWorkflow(page);
  const output = canvas.getByText('Output Summary', { exact: true });
  await output.click();
  await expect(page.getByRole('complementary', { name: 'Node configuration' })).toBeVisible();

  const cancelled = handleNextDialog(page, 'dismiss');
  await canvas.locator('[data-id="output"]').press('Backspace');
  await afterGraphPaint(page);
  expect(cancelled).toEqual([{ type: 'confirm', message: expect.stringMatching(/reconnect/i) }]);
  await expect(output).toBeVisible();
  await expect(canvas.locator('.react-flow__edge')).toHaveCount(2);
  await expect(page.getByText('Unsaved', { exact: true })).toHaveCount(0);

  const confirmed = handleNextDialog(page, 'accept');
  await canvas.locator('[data-id="output"]').press('Backspace');
  expect(confirmed).toEqual([{ type: 'confirm', message: expect.stringMatching(/reconnect/i) }]);
  await expect(output).toHaveCount(0);
  await expect(canvas.locator('.react-flow__edge')).toHaveCount(1);
  await page.getByText('Node deleted — Undo', { exact: true }).locator('..').getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(output).toBeVisible();
  await expect(canvas.locator('.react-flow__edge')).toHaveCount(2);
  await expect(page.getByText('Unsaved', { exact: true })).toHaveCount(0);
});


test('keyboard-selected connections can still be deleted and undone', async ({ page }) => {
  const canvas = await openWorkflow(page);
  const connection = canvas.locator('.react-flow__edge').first();
  await connection.press('Enter');
  await expect(connection).toHaveClass(/\bselected\b/);
  await connection.press('Delete');

  await expect(canvas.locator('.react-flow__edge')).toHaveCount(1);
  await expect(canvas.locator('.react-flow__node')).toHaveCount(3);
  await page.getByText('Edge deleted — Undo', { exact: true }).locator('..').getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(canvas.locator('.react-flow__edge')).toHaveCount(2);
  await expect(page.getByText('Unsaved', { exact: true })).toHaveCount(0);
});


test('keyboard reconnect leaves the graph unchanged if the proposed connection already exists', async ({ page }) => {
  const canvas = await openWorkflow(page, true);
  const output = canvas.getByText('Output Summary', { exact: true });
  await output.click();
  const dialogs = handleNextDialog(page, 'accept');
  await canvas.locator('[data-id="output"]').press('Delete');
  await afterGraphPaint(page);

  expect(dialogs).toEqual([{ type: 'alert', message: expect.stringMatching(/cannot safely reconnect.*no changes were made/i) }]);
  await expect(output).toBeVisible();
  await expect(canvas.locator('.react-flow__edge')).toHaveCount(3);
  await expect(page.getByText('Unsaved', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete node', exact: true })).toBeVisible();
});
