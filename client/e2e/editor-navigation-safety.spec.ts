import { expect, test, type Page } from '@playwright/test';
import { executableWorkflow, installMockApi } from './mockApi';

const workflowId = 'workflow-navigation-safety';
const editorPath = `/editor/${workflowId}`;
const editorURL = /\/editor\/workflow-navigation-safety$/;

async function openEditor(page: Page) {
  const state = await installMockApi(page, { workflows: [executableWorkflow(workflowId)] });
  await page.goto(editorPath);
  await expect(page.getByRole('application').getByText('Output Summary', { exact: true })).toBeVisible();
  return state;
}

function dashboardLink(page: Page) {
  return page.getByRole('link', { name: 'FlowCraft dashboard', exact: true });
}

function delayNode(page: Page) {
  return page.getByRole('application').getByText('Delay', { exact: true });
}

async function addDelay(page: Page) {
  await page.getByRole('button', { name: 'Add Delay node', exact: true }).click();
  await expect(delayNode(page)).toBeVisible();
  await expect(page.getByText('Unsaved', { exact: true })).toBeVisible();
}

function handleNextDialog(page: Page, decision: 'accept' | 'dismiss') {
  const observed: Array<{ type: string; message: string }> = [];
  page.once('dialog', async (dialog) => {
    observed.push({ type: dialog.type(), message: dialog.message() });
    await dialog[decision]();
  });
  return observed;
}

test('cancelling dashboard navigation keeps unsaved edits, while confirming discards them', async ({ page }) => {
  const { workflows } = await openEditor(page);
  await addDelay(page);

  const cancelled = handleNextDialog(page, 'dismiss');
  await dashboardLink(page).click();
  expect(cancelled).toEqual([{ type: 'confirm', message: expect.stringMatching(/unsaved changes/i) }]);
  await expect(page).toHaveURL(editorURL);
  await expect(delayNode(page)).toBeVisible();
  await expect(page.getByText('Unsaved', { exact: true })).toBeVisible();

  const accepted = handleNextDialog(page, 'accept');
  await dashboardLink(page).click();
  expect(accepted).toEqual([{ type: 'confirm', message: expect.stringMatching(/unsaved changes/i) }]);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Workflows', exact: true })).toBeVisible();

  expect(workflows.get(workflowId)?.currentRevision).toBe(1);
  await page.getByRole('link', { name: 'Open Release summary', exact: true }).click();
  await expect(page).toHaveURL(editorURL);
  await expect(page.getByRole('application').getByText('Output Summary', { exact: true })).toBeVisible();
  await expect(delayNode(page)).toHaveCount(0);
});

test('dismissing the native reload warning keeps the in-memory workflow changes', async ({ page }) => {
  await openEditor(page);
  await addDelay(page);

  const dialogs = handleNextDialog(page, 'dismiss');
  // Schedule the real browser reload without awaiting a new document that
  // will intentionally never commit after the user dismisses the warning.
  await page.evaluate(() => { window.setTimeout(() => window.location.reload(), 0); });
  await expect.poll(() => dialogs.map(({ type }) => type)).toEqual(['beforeunload']);
  await expect(page).toHaveURL(editorURL);
  await expect(delayNode(page)).toBeVisible();
  await expect(page.getByText('Unsaved', { exact: true })).toBeVisible();
});

test('clean and successfully saved workflows can leave without a dialog', async ({ page }) => {
  const { workflows } = await openEditor(page);
  const dialogs: string[] = [];
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.type());
    await dialog.accept();
  });

  await dashboardLink(page).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole('link', { name: 'Open Release summary', exact: true }).click();
  await expect(page).toHaveURL(editorURL);
  await addDelay(page);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('v2', { exact: true })).toBeVisible();
  expect(workflows.get(workflowId)?.currentRevision).toBe(2);

  await dashboardLink(page).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(dialogs).toEqual([]);
});

test('cancels sign-out before making a request and guards the other editor exits', async ({ page }) => {
  await openEditor(page);
  let logoutRequests = 0;
  await page.route('**/api/auth/logout', async (route) => {
    logoutRequests += 1;
    await route.fulfill({ status: 204 });
  });
  await addDelay(page);

  const exits = [
    page.getByRole('button', { name: 'Sign out', exact: true }),
    page.getByRole('link', { name: 'Workflows', exact: true }),
    page.getByRole('link', { name: 'Account settings', exact: true }),
  ];
  for (const exit of exits) {
    const cancelled = handleNextDialog(page, 'dismiss');
    await exit.click();
    expect(cancelled).toEqual([{ type: 'confirm', message: expect.stringMatching(/unsaved changes/i) }]);
    await expect(page).toHaveURL(editorURL);
    await expect(delayNode(page)).toBeVisible();
  }
  expect(logoutRequests).toBe(0);

  const accepted = handleNextDialog(page, 'accept');
  await exits[2].click();
  expect(accepted).toEqual([{ type: 'confirm', message: expect.stringMatching(/unsaved changes/i) }]);
  await expect(page).toHaveURL(/\/account$/);
});
