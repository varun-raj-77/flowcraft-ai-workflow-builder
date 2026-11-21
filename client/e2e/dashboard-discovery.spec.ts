import { expect, test } from '@playwright/test';
import { executableWorkflow, installMockApi } from './mockApi';

test('finds workflows by name and description, intersects the last run filter, and opens the right editor', async ({ page }) => {
  const workflows = [
    { ...executableWorkflow('release-failed'), name: 'Release digest', description: 'Alerts engineering.' },
    { ...executableWorkflow('inventory-never-run'), name: 'Inventory sync', description: 'Prepares the release inventory.' },
    { ...executableWorkflow('customer-unavailable'), name: 'Customer report', description: 'Summarizes customer activity.' },
    {
      ...executableWorkflow('support-completed'),
      name: 'Support report',
      description: 'Summarizes support activity.',
      isGeneratedByAI: true,
      generationMetadata: { originalPrompt: 'release prompt only' },
    },
  ];
  await installMockApi(page, { workflows });
  let listRequests = 0;
  await page.route(/\/api\/workflows(?:\?[^#]*)?$/, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    listRequests += 1;
    // The shared mock gives every workflow a null status. Override only the
    // dashboard summary read; editor requests still use the shared fixture.
    const summaries = workflows.map(({ nodes, edges: _edges, ...summary }) => ({
      ...summary,
      nodeCount: nodes.length,
    }));
    await route.fulfill({
      json: {
        data: [
          { ...summaries[0], lastExecutionStatus: 'failed' },
          { ...summaries[1], lastExecutionStatus: null },
          summaries[2], // Omitted status is different from an explicit null.
          { ...summaries[3], lastExecutionStatus: 'completed' },
        ],
      },
    });
  });

  await page.goto('/dashboard');
  const search = page.getByLabel('Search workflows', { exact: true });
  const status = page.getByRole('combobox', { name: 'Last run status', exact: true });
  const clear = page.getByRole('button', { name: 'Clear filters', exact: true });
  const cards = page.getByRole('article');
  const names = cards.getByRole('heading', { level: 3 });

  await expect(page.getByText('Showing 4 of 4 workflows', { exact: true })).toBeVisible();
  await expect(names).toHaveText(['Release digest', 'Inventory sync', 'Customer report', 'Support report']);
  const initialListRequests = listRequests;
  expect(initialListRequests).toBeGreaterThan(0);

  await search.fill('  rELeAsE  ');
  await expect(page.getByText('Showing 2 of 4 workflows', { exact: true })).toBeVisible();
  await expect(names).toHaveText(['Release digest', 'Inventory sync']);

  await status.selectOption({ label: 'Failed' });
  await expect(names).toHaveText(['Release digest']);
  await expect(page.getByText('Showing 1 of 4 workflows', { exact: true })).toBeVisible();

  await status.selectOption({ label: 'Never run' });
  await expect(names).toHaveText(['Inventory sync']);

  await status.selectOption({ label: 'Status unavailable' });
  await expect(page.getByText('No matching workflows', { exact: true })).toBeVisible();
  await expect(page.getByText('Showing 0 of 4 workflows', { exact: true })).toBeVisible();
  await expect(cards).toHaveCount(0);

  await search.clear();
  await expect(names).toHaveText(['Customer report']);

  await clear.click();
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
  await expect(status.locator('option:checked')).toHaveText('Any status');
  await expect(page.getByText('Showing 4 of 4 workflows', { exact: true })).toBeVisible();
  await expect(names).toHaveText(['Release digest', 'Inventory sync', 'Customer report', 'Support report']);

  await search.fill('inventory');
  await expect(names).toHaveText(['Inventory sync']);
  expect(listRequests).toBe(initialListRequests);

  await page.getByRole('link', { name: 'Open Inventory sync', exact: true }).click();
  await expect(page).toHaveURL(/\/editor\/inventory-never-run$/);
  await expect(page.getByRole('button', { name: 'Inventory sync', exact: true })).toBeVisible();
});


test('keeps the existing create workflow entry point on an empty dashboard', async ({ page }) => {
  await installMockApi(page);
  await page.goto('/dashboard');

  await expect(page.getByRole('heading', { name: 'No workflows yet', exact: true })).toBeVisible();
  await expect(page.getByLabel('Search workflows', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Create Workflow', exact: true }).click();
  await expect(page).toHaveURL(/\/editor\/workflow-1$/);
});
