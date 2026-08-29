import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { executableWorkflow, installMockApi } from './mockApi';

test.setTimeout(90_000);

async function capture(page: Page, testInfo: TestInfo, name: string) {
  if (process.env.FLOWCRAFT_VISUAL_AUDIT !== '1') return;
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: false });
}

test('keeps the complete product presentation journey discoverable and operable', async ({ page }, testInfo) => {
  const aiWorkflow = {
    ...executableWorkflow('workflow-presentation'),
    isGeneratedByAI: true,
    generationMetadata: {
      originalPrompt: 'Fetch release data and output a concise summary',
      generatedAt: '2026-08-28T12:00:00.000Z',
      provider: 'mock',
      model: 'mock-flowcraft',
    },
  };
  const manualWorkflow = { ...executableWorkflow('workflow-manual-presentation'), name: 'Manual review' };
  await installMockApi(page, { workflows: [aiWorkflow, manualWorkflow] });
  await page.setViewportSize({ width: 1440, height: 960 });

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Workflows', exact: true })).toBeVisible();
  await capture(page, testInfo, 'dashboard');

  await page.getByRole('link', { name: 'Open Release summary' }).click();
  await expect(page).toHaveURL(/\/editor\/workflow-presentation$/, { timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Release summary', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add Delay node' }).click();
  const delayNode = page.locator('.react-flow__node-delay');
  const delayBox = await delayNode.boundingBox();
  if (delayBox) {
    await page.mouse.move(delayBox.x + delayBox.width / 2, delayBox.y + delayBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(delayBox.x + delayBox.width / 2, delayBox.y + delayBox.height / 2 - 190, { steps: 8 });
    await page.mouse.up();
  }
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('v2', { exact: true })).toBeVisible();
  await capture(page, testInfo, 'editor');

  await expect(page.getByLabel('Node label')).toBeVisible();
  await capture(page, testInfo, 'config-panel');

  await page.getByRole('button', { name: '✦ AI Generate' }).click();
  const aiDialog = page.getByRole('dialog', { name: /Generate with AI/ });
  await expect(aiDialog.getByLabel('Workflow prompt')).toHaveValue('Fetch release data and output a concise summary');
  await capture(page, testInfo, 'ai-saved-prompt');
  await aiDialog.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: /History/ }).click();
  let history = page.getByRole('dialog', { name: 'Revision history' });
  await expect(history.getByText('Current', { exact: true })).toBeVisible();
  await capture(page, testInfo, 'history');
  await history.getByRole('button', { name: 'View revision v1' }).click();
  await expect(page.getByText('Historical revision · Read only')).toBeVisible();
  await capture(page, testInfo, 'historical-preview');
  await page.getByRole('button', { name: 'Back to current v2' }).click();

  await page.getByRole('button', { name: /History/ }).click();
  history = page.getByRole('dialog', { name: 'Revision history' });
  await history.getByRole('button', { name: 'Compare revision v1 with current v2' }).click();
  await expect(page.getByText('Comparing v1 → v2')).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Revision changes' })).toBeVisible();
  await capture(page, testInfo, 'comparison');
  await page.getByRole('button', { name: 'Back to current v2' }).click();

  await page.getByRole('button', { name: 'Run', exact: true }).click();
  const inspector = page.getByRole('region', { name: 'Execution Inspector', exact: true });
  await expect(inspector).toContainText('completed');
  await expect(inspector).toContainText('Executed v2');
  await capture(page, testInfo, 'execution-inspector');
  if (process.env.FLOWCRAFT_VISUAL_AUDIT === '1') {
    await page.getByLabel('Execution workflow revision').screenshot({
      path: testInfo.outputPath('execution-provenance.png'),
    });
  }

  await page.goto('/editor/workflow-manual-presentation');
  await page.getByRole('button', { name: '✦ AI Generate' }).click();
  const manualDialog = page.getByRole('dialog', { name: /Generate with AI/ });
  await expect(manualDialog.getByLabel('Workflow prompt')).toHaveValue('');
  await expect(manualDialog.getByText('Based on the prompt used to generate this workflow.')).toHaveCount(0);
  await capture(page, testInfo, 'ai-manual');
});
