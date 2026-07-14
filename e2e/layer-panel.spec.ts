// CreativeLayerListPanelのスロット切替UIしきい値（写真スロット2枚以上でのみ表示）の回帰テスト。
import { test, expect } from '@playwright/test';

test.describe('CreativeLayerListPanel スロット切替UI', () => {
  test('写真1枚では「写真1」チップが出ない', async ({ page }) => {
    await page.goto('/?e2e=layerPanel');
    await page.waitForTimeout(800);
    await page.getByTestId('e2e-mode-1slot').click();
    await page.waitForTimeout(300);
    await expect(page.getByText('写真1', { exact: true })).toHaveCount(0);
  });

  test('写真3枚では「写真1」「写真2」「写真3」チップが出る', async ({ page }) => {
    await page.goto('/?e2e=layerPanel');
    await page.waitForTimeout(800);
    await page.getByTestId('e2e-mode-3slot').click();
    await page.waitForTimeout(300);
    await expect(page.getByText('写真1', { exact: true })).toHaveCount(1);
    await expect(page.getByText('写真2', { exact: true })).toHaveCount(1);
    await expect(page.getByText('写真3', { exact: true })).toHaveCount(1);
  });
});
