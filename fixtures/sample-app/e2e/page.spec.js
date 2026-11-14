import { test, expect } from '@playwright/test';
import { expectFast } from './support/expect-fast.ts';

// Opened straight from disk: no web server or emulator needed.
const PAGE = new URL('./index.html', import.meta.url).href;

test('saving shows a confirmation', async ({ page }) => {
  await page.goto(PAGE);
  await expectFast('Save button', async () => {
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('#status')).toHaveText('Saved');
  });
});
