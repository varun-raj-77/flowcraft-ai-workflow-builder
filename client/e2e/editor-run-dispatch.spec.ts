import { expect, test } from '@playwright/test';
import { executableWorkflow, installMockApi } from './mockApi';

test('Run sends one request and stays disabled while the start acknowledgement is pending', async ({ page }) => {
  const workflowId = 'workflow-run-dispatch';
  await installMockApi(page, { workflows: [executableWorkflow(workflowId)] });
  let releaseStart!: () => void;
  const start = new Promise<void>((resolve) => { releaseStart = resolve; });
  let starts = 0;

  await page.route(`**/api/executions/${workflowId}/run`, async (route) => {
    starts += 1;
    await start;
    await route.fallback();
  });

  await page.goto(`/editor/${workflowId}`);
  const run = page.getByRole('button', { name: 'Run', exact: true });
  const inspector = page.getByRole('region', { name: 'Execution Inspector', exact: true });
  try {
    await run.dblclick();
    await expect.poll(() => starts).toBe(1);
    await expect(run).toBeDisabled();
    await expect(run).toHaveAttribute('aria-busy', 'true');
  } finally {
    releaseStart();
  }

  await expect(inspector).toContainText('completed');
  await expect(run).toBeEnabled();
  expect(starts).toBe(1);
});
