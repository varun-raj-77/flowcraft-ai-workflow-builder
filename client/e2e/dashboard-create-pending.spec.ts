import { expect, test } from '@playwright/test';
import { installMockApi } from './mockApi';

test('the dashboard and empty state share one pending workflow creation', async ({ page }) => {
  const { workflows } = await installMockApi(page);
  let releaseCreate!: () => void;
  const creation = new Promise<void>((resolve) => { releaseCreate = resolve; });
  let creates = 0;

  await page.route('**/api/workflows', async (route) => {
    if (route.request().method() === 'POST') {
      creates += 1;
      await creation;
    }
    await route.fallback();
  });

  await page.goto('/dashboard');
  const headerCreate = page.getByRole('button', { name: '+ New Workflow', exact: true });
  const emptyCreate = page.getByRole('button', { name: 'Create Workflow', exact: true });
  await expect(emptyCreate).toBeVisible();
  try {
    await headerCreate.dblclick();
    await expect.poll(() => creates).toBe(1);
    await expect(headerCreate).toBeDisabled();
    await expect(emptyCreate).toBeDisabled();
    await expect(headerCreate).toHaveAttribute('aria-busy', 'true');
  } finally {
    releaseCreate();
  }

  await expect(page).toHaveURL(/\/editor\/workflow-1$/);
  await expect(page.getByRole('button', { name: 'Untitled Workflow', exact: true })).toBeVisible();
  expect(creates).toBe(1);
  expect(workflows.size).toBe(1);
});
