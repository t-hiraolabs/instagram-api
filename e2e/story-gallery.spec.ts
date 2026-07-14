// StoryGalleryScreenのフィルタチップの回帰テスト（実データの有無に依存しない構造的な検証）。
import { test, expect } from '@playwright/test';

test.describe('StoryGalleryScreen フィルタチップ', () => {
  test('計画書指定の全チップが表示される', async ({ page }) => {
    await page.goto('/?e2e=gallery');
    await page.waitForTimeout(1000);

    for (const label of [
      'すべて', '写真1枚', '写真2枚', '写真3枚', '写真4枚以上',
      'ビフォーアフター', 'シンプル', 'ナチュラル', '高級感',
      '季節', '業種', '投稿目的',
    ]) {
      await expect(page.getByText(label, { exact: true })).toHaveCount(1);
    }
  });

  test('写真1枚チップをタップすると選択状態になる（文字色が白に変わる）', async ({ page }) => {
    await page.goto('/?e2e=gallery');
    await page.waitForTimeout(1000);
    const chip = page.getByText('写真1枚', { exact: true });

    const colorBefore = await chip.evaluate((el) => getComputedStyle(el).color);
    expect(colorBefore).toBe('rgb(102, 102, 102)'); // COLORS.textMuted

    await chip.click();
    await page.waitForTimeout(200);
    const colorAfter = await chip.evaluate((el) => getComputedStyle(el).color);
    expect(colorAfter).toBe('rgb(255, 255, 255)'); // chipTextActive
  });

  test('季節チップをタップすると春/夏/秋/冬が展開される', async ({ page }) => {
    await page.goto('/?e2e=gallery');
    await page.waitForTimeout(1000);
    await page.getByText('季節', { exact: true }).click();
    await page.waitForTimeout(300);
    await expect(page.getByText('春', { exact: true })).toHaveCount(1);
    await expect(page.getByText('夏', { exact: true })).toHaveCount(1);
    await expect(page.getByText('秋', { exact: true })).toHaveCount(1);
    await expect(page.getByText('冬', { exact: true })).toHaveCount(1);
  });

  test('業種チップをタップするとaiService.INDUSTRIESの選択肢が展開される', async ({ page }) => {
    await page.goto('/?e2e=gallery');
    await page.waitForTimeout(1000);
    await page.getByText('業種', { exact: true }).click();
    await page.waitForTimeout(300);
    await expect(page.getByText('飲食・カフェ', { exact: true })).toHaveCount(1);
  });

  test('投稿目的チップをタップするとStoryStudioScreen.PURPOSESが展開される', async ({ page }) => {
    await page.goto('/?e2e=gallery');
    await page.waitForTimeout(1000);
    await page.getByText('投稿目的', { exact: true }).click();
    await page.waitForTimeout(300);
    await expect(page.getByText('集客', { exact: true })).toHaveCount(1);
  });

  test('検索欄に入力してもクラッシュしない', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/?e2e=gallery');
    await page.waitForTimeout(1000);
    await page.getByPlaceholder('テンプレートを検索').fill('テスト');
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });
});
