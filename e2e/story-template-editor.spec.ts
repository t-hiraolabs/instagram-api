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

  test('テキストの位置を指で動かしている間はプロパティ・プレビューが消え、離した後も表示されないまま終わる', async ({ page }) => {
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

    // プロパティはタップして指を離した時だけ起動する。移動して離した場合は
    // （選択状態自体は継続していても）プロパティ・プレビューを表示しないまま終わる
    await expect(page.getByTestId('story-editor-text-panel')).toHaveCount(0);
    await expect(page.getByTestId('story-editor-text-preview')).toHaveCount(0);
  });

  test('移動して離した後でも、改めてタップして離せばプロパティ・プレビューが表示される', async ({ page }) => {
    await page.goto('/?e2e=storyTemplateEditor');
    await page.waitForTimeout(1000);

    await page.getByTestId('story-editor-add-text-btn').click();
    await page.waitForTimeout(500);

    const layer = page.locator('[data-testid^="layer-text_"]');
    const box = await layer.boundingBox();
    expect(box).not.toBeNull();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    const client = await page.context().newCDPSession(page);
    await dispatchTouch(client, 'touchStart', [{ x: cx, y: cy }]);
    await page.waitForTimeout(80);
    for (let i = 1; i <= 10; i++) {
      await dispatchTouch(client, 'touchMove', [{ x: cx + i * 4, y: cy + i * 2 }]);
      await page.waitForTimeout(30);
    }
    await dispatchTouch(client, 'touchEnd', []);
    await page.waitForTimeout(300);
    await expect(page.getByTestId('story-editor-text-panel')).toHaveCount(0);

    // 動いた後の新しい位置を改めてタップして離す（移動を伴わない）
    const movedBox = await layer.boundingBox();
    expect(movedBox).not.toBeNull();
    const mx = movedBox!.x + movedBox!.width / 2;
    const my = movedBox!.y + movedBox!.height / 2;
    await dispatchTouch(client, 'touchStart', [{ x: mx, y: my }]);
    await page.waitForTimeout(50);
    await dispatchTouch(client, 'touchEnd', []);
    await page.waitForTimeout(300);

    await expect(page.getByTestId('story-editor-text-panel')).toBeVisible();
    await expect(page.getByTestId('story-editor-text-preview')).toBeVisible();
  });
});

test.describe('StoryTemplateEditor 写真と背景の共存', () => {
  test('写真を追加した後でも背景を設定でき、写真は使われ続ける', async ({ page }) => {
    await page.goto('/?e2e=storyTemplateEditor');
    await page.waitForTimeout(1000);

    // expo-image-pickerの実際のファイル選択ダイアログはPlaywrightから自動化できないため、
    // E2EStoryTemplateEditorScreen.tsxがwindowへ公開しているデバッグ用フックで代用する
    await page.evaluate(() => (window as any).__e2eAssignPhoto());
    await page.waitForTimeout(300);

    const hasImgBefore = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="layer-photo_1"]');
      return !!el?.querySelector('img');
    });
    expect(hasImgBefore).toBe(true);

    await page.getByText('背景').click();
    await page.waitForTimeout(300);
    await page.getByText('インク').click();
    await page.waitForTimeout(300);

    // 写真は消えずそのまま使われ続け、背景レイヤーも追加で描画される
    const hasImgAfter = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="layer-photo_1"]');
      return !!el?.querySelector('img');
    });
    expect(hasImgAfter).toBe(true);
    await expect(page.locator('[data-testid="layer-bg"]')).toHaveCount(1);
  });
});

test.describe('StoryTemplateEditor フォントのドロップダウン', () => {
  test('タップすると開き、フォント一覧が表示される', async ({ page }) => {
    await page.goto('/?e2e=storyTemplateEditor');
    await page.waitForTimeout(1000);

    await page.getByTestId('story-editor-add-text-btn').click();
    await page.waitForTimeout(500);

    await expect(page.getByTestId('font-dropdown-scroll')).toHaveCount(0);
    await page.getByTestId('font-dropdown-trigger').click();
    await page.waitForTimeout(200);
    await expect(page.getByTestId('font-dropdown-scroll')).toBeVisible();
  });

  test('一覧をスクロールすると、指を離さなくても自動的にフォントが切り替わる', async ({ page }) => {
    await page.goto('/?e2e=storyTemplateEditor');
    await page.waitForTimeout(1000);

    await page.getByTestId('story-editor-add-text-btn').click();
    await page.waitForTimeout(500);
    await expect(page.getByTestId('font-dropdown-trigger-label')).toHaveText('ゴシック（極太）');

    await page.getByTestId('font-dropdown-trigger').click();
    await page.waitForTimeout(200);

    // react-native-webのScrollViewは自前でscrollイベントをリッスンしているため、
    // scrollTopを直接動かしてscrollイベントを発火させ、その後の切り替え（自前の
    // デバウンス判定）を待つ
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="font-dropdown-scroll"]') as HTMLElement;
      el.scrollTop = 44 * 3;
      el.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    await page.waitForTimeout(400);

    await expect(page.getByTestId('font-dropdown-trigger-label')).toHaveText('装飾セリフ');
  });

  test('行を直接タップしても選択され、一覧が閉じる', async ({ page }) => {
    await page.goto('/?e2e=storyTemplateEditor');
    await page.waitForTimeout(1000);

    await page.getByTestId('story-editor-add-text-btn').click();
    await page.waitForTimeout(500);
    await page.getByTestId('font-dropdown-trigger').click();
    await page.waitForTimeout(200);

    await page.locator('[data-testid="font-dropdown-scroll"] >> text="明朝（上品）"').click();
    await page.waitForTimeout(200);

    await expect(page.getByTestId('font-dropdown-trigger-label')).toHaveText('明朝（上品）');
    await expect(page.getByTestId('font-dropdown-scroll')).toHaveCount(0);
  });
});
