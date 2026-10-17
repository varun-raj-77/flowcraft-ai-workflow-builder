import { expect, test } from '@playwright/test';
import { executableWorkflow, installMockApi } from './mockApi';

test.describe('Test Lab visual simulation', () => {
  test('edits a fixture-free scenario, submits pinned assertions and inspects results', async ({ page }) => {
    const workflow = executableWorkflow('workflow-test-lab');
    await installMockApi(page, { workflows: [workflow] });
    let simulationCount = 0;
    await page.route('**/api/executions/workflow-test-lab/simulate', async (route) => {
      simulationCount += 1;
      const payload = route.request().postDataJSON();
      expect(payload).toMatchObject({
        expectedRevision: 1,
        mocks: {},
        assertions: [{ nodeId: 'output', path: 'message', equals: 'Browser test complete' }],
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: {
          status: 'passed',
          steps: [
            { nodeId: 'start', nodeType: 'start', status: 'simulated' },
            { nodeId: 'output', nodeType: 'output', status: 'simulated', output: { message: 'Browser test complete', logLevel: 'info' } },
            { nodeId: 'end', nodeType: 'end', status: 'simulated' },
          ],
          assertions: [{ nodeId: 'output', path: 'message', passed: true, message: 'Expected value matched' }],
          provenance: { workflowRevision: 1, definitionHash: 'a'.repeat(64) },
        } }),
      });
    });
    await page.goto('/editor/workflow-test-lab');
    await page.getByRole('button', { name: '◈ Test Lab' }).click();
    const dialog = page.getByRole('dialog', { name: 'Workflow Test Lab' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Pinned definition');
    await expect(dialog).toContainText('v1');
    await dialog.getByRole('button', { name: '+ Add' }).click();
    await dialog.getByLabel('Node').selectOption('output');
    await dialog.getByLabel('Output field (optional)').fill('message');
    await dialog.getByLabel('Expected JSON value').fill('"Browser test complete"');
    await dialog.getByRole('button', { name: 'Run simulation' }).click();
    await expect(dialog.getByText('Simulation passed')).toBeVisible();
    await expect(dialog).toContainText('1/1 checks passed');
    expect(simulationCount).toBe(1);
    await dialog.getByRole('button', { name: 'Close Test Lab' }).click();
    await expect(dialog).not.toBeVisible();
  });

  test('does not simulate unsaved edits and closes with Escape', async ({ page }) => {
    await installMockApi(page, { workflows: [executableWorkflow('workflow-test-lab-dirty')] });
    await page.goto('/editor/workflow-test-lab-dirty');
    await page.getByRole('button', { name: 'Add Delay node' }).click();
    await page.getByRole('button', { name: '◈ Test Lab' }).click();
    const dialog = page.getByRole('dialog', { name: 'Workflow Test Lab' });
    await expect(dialog.getByText(/Save your changes first/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Run simulation' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  });
});
