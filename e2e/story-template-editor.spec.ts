// StoryTemplateEditorの、テキストのプロパティパネル・中央プレビュー表示切り替えの回帰テスト。
// src/screens/__e2e__/E2EStoryTemplateEditorScreen.tsxを?e2e=storyTemplateEditorで直接マウント
// し、ログインや写真選択に依存せず検証する。
import { test, expect, CDPSession } from '@playwright/test';

async function dispatchTouch(client: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', touches: { x: number; y: number }[]) {
  await client.send('Input.dispatchTouchEvent', { type, touchPoints: touches.map((t) => ({ x: t.x, y: t.y })) });
}

test.describe('StoryTemplateEditor テキストのプロパティ表示', () => {
  test('文字を追加すると自動選択され、プロパティと中央プレビューが表示される', async ({ page }) => {
    await page.goto('/?e2e=storyTemplateEditor');
    await page.waitForTimeout(1000);

    await page.getByTestId('story-editor-add-text-btn').click();
    await page.waitForTimeout(500);

    await expect(page.getByTestId('story-editor-text-panel')).toBeVisible();
    await expect(page.getByTestId('story-editor-text-preview')).toBeVisible();
  });

  test('「完了」で選択解除するとプロパティ・プレビューが消える', async ({ page }) => {
    await page.goto('/?e2e=storyTemplateEditor');
    await page.waitForTimeout(1000);

    await page.getByTestId('story-editor-add-text-btn').click();
    await page.waitForTimeout(500);
    await expect(page.getByTestId('story-editor-text-panel')).toBeVisible();

    await page.getByText('完了').click();
    await page.waitForTimeout(300);

    await expect(page.getByTestId('story-editor-text-panel')).toHaveCount(0);
    await expect(page.getByTestId('story-editor-text-preview')).toHaveCount(0);
  });

  test('テキストをワンタップすると再び選択され、プロパティと中央プレビューが表示される', async ({ page }) => {
    await page.goto('/?e2e=storyTemplateEditor');
    await page.waitForTimeout(1000);

    await page.getByTestId('story-editor-add-text-btn').click();
    await page.waitForTimeout(500);
    await page.getByText('完了').click();
    await page.waitForTimeout(300);
    await expect(page.getByTestId('story-editor-text-panel')).toHaveCount(0);

    const layer = page.locator('[data-testid^="layer-text_"]');
    const box = await layer.boundingBox();
    expect(box).not.toBeNull();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    // 移動を伴わない、指を置いてすぐ離す「タップ」で再選択する
    const client = await page.context().newCDPSession(page);
    await dispatchTouch(client, 'touchStart', [{ x: cx, y: cy }]);
    await page.waitForTimeout(50);
    await dispatchTouch(client, 'touchEnd', []);
    await page.waitForTimeout(300);

    await expect(page.getByTestId('story-editor-text-panel')).toBeVisible();
    await expect(page.getByTestId('story-editor-text-preview')).toBeVisible();
  });

  test('テキストの位置を指で動かしている間はプロパティ・プレビューが消え、離すと再び表示される', async ({ page }) => {
    await page.goto('/?e2e=storyTemplateEditor');
    await page.waitForTimeout(1000);

    await page.getByTestId('story-editor-add-text-btn').click();
    await page.waitForTimeout(500);
    await expect(page.getByTestId('story-editor-text-panel')).toBeVisible();

    const layer = page.locator('[data-testid^="layer-text_"]');
    const box = await layer.boundingBox();
    expect(box).not.toBeNull();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    const client = await page.context().newCDPSession(page);
    await dispatchTouch(client, 'touchStart', [{ x: cx, y: cy }]);
    await page.waitForTimeout(80);
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      await dispatchTouch(client, 'touchMove', [{ x: cx + i * 4, y: cy + i * 2 }]);
      await page.waitForTimeout(30);
    }
    await page.waitForTimeout(100);

    // 移動中は、配置先を隠さないようプロパティ・プレビューの両方が非表示になる
    await expect(page.getByTestId('story-editor-text-panel')).toHaveCount(0);
    await expect(page.getByTestId('story-editor-text-preview')).toHaveCount(0);

    await dispatchTouch(client, 'touchEnd', []);
    await page.waitForTimeout(300);

    // 指を離すと、選択状態は継続しているためプロパティ・プレビューが再び表示される
    await expect(page.getByTestId('story-editor-text-panel')).toBeVisible();
    await expect(page.getByTestId('story-editor-text-preview')).toBeVisible();
  });
});
