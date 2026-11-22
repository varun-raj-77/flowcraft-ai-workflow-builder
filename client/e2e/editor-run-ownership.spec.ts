import { expect, test, type Page } from '@playwright/test';
import { executableWorkflow, installMockApi } from './mockApi';

async function holdRun(page: Page, workflowId: string) {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let submitted = 0;
  const suffix = `/api/executions/${workflowId}/run`;
  await page.route(`**${suffix}`, async (route) => {
    submitted += 1;
    await pending;
    await route.fallback();
  });
  return { release, count: () => submitted, suffix };
}

test('a delayed execution stays out of the next workflow’s inspector', async ({ page }) => {
  const previous = { ...executableWorkflow('previous-run-owner'), name: 'Previous workflow' };
  const next = { ...executableWorkflow('next-run-owner'), name: 'Next workflow' };
  const { executions } = await installMockApi(page, { workflows: [previous, next] });
  const held = await holdRun(page, previous._id);
  await page.goto(`/editor/${previous._id}`);
  const inspector = page.getByRole('region', { name: 'Execution Inspector', exact: true });
  let startResponse: ReturnType<Page['waitForResponse']> | undefined;

  try {
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await expect.poll(held.count).toBe(1);
    await page.getByRole('link', { name: 'FlowCraft dashboard', exact: true }).click();
    await page.getByRole('link', { name: 'Open Next workflow', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Next workflow', exact: true })).toBeVisible();
    await expect(inspector).toContainText('Click Run to execute the workflow.');
    startResponse = page.waitForResponse((response) => new URL(response.url()).pathname === held.suffix);
  } finally {
    held.release();
  }

  expect((await startResponse)?.status()).toBe(201);
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => { requestAnimationFrame(() => resolve()); });
  }));
  expect(executions.get(previous._id)).toHaveLength(1);
  await expect(inspector).toContainText('Click Run to execute the workflow.');
  await expect(inspector.getByText('Workflow completed', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();
});

test('Run stays pending through the first-save URL handoff and displays that one result', async ({ page }) => {
  const { workflows, executions } = await installMockApi(page);
  const held = await holdRun(page, 'workflow-1');
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Generate with AI' }).click();
  const dialog = page.getByRole('dialog', { name: 'Generate with AI' });
  await dialog.getByPlaceholder(/Fetch data from an API/).fill('Create a release summary and output the result');
  await dialog.getByRole('button', { name: 'Generate Workflow' }).click();
  await expect(page).toHaveURL(/\/editor\/new$/);
  await expect(page.getByRole('button', { name: 'AI Release Digest', exact: true })).toBeVisible();
  const run = page.getByRole('button', { name: 'Run', exact: true });

  try {
    await run.click();
    await expect.poll(held.count).toBe(1);
    await expect(page).toHaveURL(/\/editor\/workflow-1$/);
    await expect(run).toBeDisabled();
    await expect(run).toHaveAttribute('aria-busy', 'true');
  } finally {
    held.release();
  }

  const inspector = page.getByRole('region', { name: 'Execution Inspector', exact: true });
  await expect(inspector.getByText('Workflow completed', { exact: true })).toBeVisible();
  await expect(run).toBeEnabled();
  expect(held.count()).toBe(1);
  expect(workflows.size).toBe(1);
  expect(executions.get('workflow-1')).toHaveLength(1);
});
