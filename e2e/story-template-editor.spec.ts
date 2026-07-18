// StoryTemplateEditorの、テキストのプロパティパネル・上部プレビュー表示切り替えの回帰テスト。
// src/screens/__e2e__/E2EStoryTemplateEditorScreen.tsxを?e2e=storyTemplateEditorで直接マウント
// し、ログインや写真選択に依存せず検証する。
import { test, expect, CDPSession } from '@playwright/test';

async function dispatchTouch(client: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', touches: { x: number; y: number }[]) {
  await client.send('Input.dispatchTouchEvent', { type, touchPoints: touches.map((t) => ({ x: t.x, y: t.y })) });
}

test.describe('StoryTemplateEditor テキストのプロパティ表示', () => {
  test('文字を追加すると自動選択され、プロパティと上部プレビューが表示される', async ({ page }) => {
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

  test('テキストをワンタップすると再び選択され、プロパティと上部プレビューが表示される', async ({ page }) => {
    await page.goto('/?e2e=storyTemplateEditor');
    await page.waitForTimeout(1000);

    await page.getByTestId('story-editor-add-text-btn').click();
    await page.waitForTimeout(500);
    // 空のまま完了すると追加されない仕様のため、再選択の対象として文字を入力しておく
    await page.getByTestId('story-editor-text-preview-input').fill('テスト');
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

    // 移動中は、配置先を隠さないようプロパティ・プレビューの両方が非表示のまま
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

    // 移動して離した直後（選択状態は続くがプロパティは非表示）でも、
    // ツールバーの文字追加・ステッカー追加などのアイコンは操作できるままのはず
    await expect(page.getByTestId('story-editor-add-text-btn')).toBeVisible();

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

test.describe('StoryTemplateEditor キャンバスサイズの固定', () => {
  test('編集セッション中にウィンドウサイズが変わっても、キャンバス表示サイズは変化しない', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/?e2e=storyTemplateEditor');
    await page.waitForTimeout(1000);

    const before = await page.locator('[data-testid="layer-photo_1"]').boundingBox();
    expect(before).not.toBeNull();

    // 実機でソフトキーボードが表示された時にウィンドウの高さが縮む状況を模す
    await page.setViewportSize({ width: 390, height: 500 });
    await page.waitForTimeout(500);

    const after = await page.locator('[data-testid="layer-photo_1"]').boundingBox();
    expect(after).not.toBeNull();
    expect(after!.width).toBeCloseTo(before!.width, 0);
    expect(after!.height).toBeCloseTo(before!.height, 0);
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

  test('一覧をスクロールしている最中に、指を離さなくてもリアルタイムでフォントが切り替わる', async ({ page }) => {
    await page.goto('/?e2e=storyTemplateEditor');
    await page.waitForTimeout(1000);

    await page.getByTestId('story-editor-add-text-btn').click();
    await page.waitForTimeout(500);
    await expect(page.getByTestId('font-dropdown-trigger-label')).toHaveText('ゴシック（極太）');

    await page.getByTestId('font-dropdown-trigger').click();
    await page.waitForTimeout(200);

    async function scrollTo(y: number) {
      await page.evaluate((yy) => {
        const el = document.querySelector('[data-testid="font-dropdown-scroll"]') as HTMLElement;
        el.scrollTop = yy;
        el.dispatchEvent(new Event('scroll', { bubbles: true }));
      }, y);
    }

    // 「スクロール中」であることを示すため、指を離す動作を挟まず、ごく短い待ち時間
    // （デバウンスに頼っていた場合は間に合わない長さ）だけでも切り替わることを確認する
    await scrollTo(44 * 3);
    await page.waitForTimeout(30);
    await expect(page.getByTestId('font-dropdown-trigger-label')).toHaveText('装飾セリフ');

    // さらにスクロールを続ける（1回で終わりではなく、動いている間ずっと追従することを確認）
    await scrollTo(44 * 5);
    await page.waitForTimeout(30);
    await expect(page.getByTestId('font-dropdown-trigger-label')).toHaveText('手書き風（よもぎ）');
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

test.describe('StoryTemplateEditor 上部プレビューでの文字編集', () => {
  test('上部プレビューへ直接入力すると、テキスト内容が変わりキャンバスにも反映される', async ({ page }) => {
    await page.goto('/?e2e=storyTemplateEditor');
    await page.waitForTimeout(1000);

    await page.getByTestId('story-editor-add-text-btn').click();
    await page.waitForTimeout(500);

    const previewInput = page.getByTestId('story-editor-text-preview-input');
    await expect(previewInput).toBeVisible();
    await previewInput.click();
    await previewInput.fill('こんにちは世界');
    await page.waitForTimeout(300);

    await expect(previewInput).toHaveValue('こんにちは世界');
    const canvasText = await page.evaluate(() => {
      const el = document.querySelector('[data-testid^="layer-text_"]');
      return el ? el.textContent : null;
    });
    expect(canvasText).toBe('こんにちは世界');
  });

  test('プロパティパネル側には文字入力欄が重複して存在しない', async ({ page }) => {
    await page.goto('/?e2e=storyTemplateEditor');
    await page.waitForTimeout(1000);

    await page.getByTestId('story-editor-add-text-btn').click();
    await page.waitForTimeout(500);

    // 文字内容を編集できる入力欄は、上部プレビューの1つだけ
    await expect(page.getByTestId('story-editor-text-preview-input')).toHaveCount(1);
    await expect(page.getByTestId('story-editor-text-panel').locator('textarea, input[type="text"]')).toHaveCount(0);
  });

  test('文字を追加した直後は自動的に入力欄にフォーカスが当たる（キーボードが開く）', async ({ page }) => {
    await page.goto('/?e2e=storyTemplateEditor');
    await page.waitForTimeout(1000);

    await page.getByTestId('story-editor-add-text-btn').click();
    await page.waitForTimeout(500);

    const focused = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="story-editor-text-preview-input"]');
      return document.activeElement === el;
    });
    expect(focused).toBe(true);
  });

  test('既存のテキストをタップして選択し直した時も、自動的に入力欄にフォーカスが当たる', async ({ page }) => {
    await page.goto('/?e2e=storyTemplateEditor');
    await page.waitForTimeout(1000);

    await page.getByTestId('story-editor-add-text-btn').click();
    await page.waitForTimeout(500);
    // 空のまま完了すると追加されない仕様のため、再選択の対象として文字を入力しておく
    await page.getByTestId('story-editor-text-preview-input').fill('テスト');
    await page.getByText('完了').click();
    await page.waitForTimeout(300);

    const layer = page.locator('[data-testid^="layer-text_"]');
    const box = await layer.boundingBox();
    expect(box).not.toBeNull();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    const client = await page.context().newCDPSession(page);
    await dispatchTouch(client, 'touchStart', [{ x: cx, y: cy }]);
    await page.waitForTimeout(50);
    await dispatchTouch(client, 'touchEnd', []);
    await page.waitForTimeout(300);

    const focused = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="story-editor-text-preview-input"]');
      return document.activeElement === el;
    });
    expect(focused).toBe(true);
  });
});

test.describe('StoryTemplateEditor プロパティパネルとキーボードの位置関係', () => {
  // window.visualViewportをテスト用の実装に差し替え、resizeイベントを
  // 手動で発火できるようにする（実機のソフトキーボードはPlaywrightで
  // 再現できないため、visualViewport.heightの縮小として模す）
  const installFakeViewport = (page: any) => page.addInitScript(() => {
    class FakeViewport extends EventTarget {
      height = window.innerHeight;
      width = window.innerWidth;
      offsetTop = 0;
      offsetLeft = 0;
    }
    (window as any).visualViewport = new FakeViewport();
  });

  test('パネルの下にすでに空きがある程度の小さいキーボードでは動かない', async ({ page }) => {
    await installFakeViewport(page);
    await page.goto('/?e2e=storyTemplateEditor');
    await page.waitForTimeout(1000);
    await page.getByTestId('story-editor-add-text-btn').click();
    await page.waitForTimeout(500);

    const panel = page.getByTestId('story-editor-text-panel');
    const before = await panel.boundingBox();
    expect(before).not.toBeNull();

    // ツールバー・投稿バー分の余白（56+64=120px程度）より小さいキーボードは
    // まだパネルにかぶらないので、パネルは動かないはず
    await page.evaluate(() => {
      const vv = (window as any).visualViewport;
      vv.height = window.innerHeight - 50;
      vv.dispatchEvent(new Event('resize'));
    });
    await page.waitForTimeout(300);

    const after = await panel.boundingBox();
    expect(after).not.toBeNull();
    expect(after!.y).toBeCloseTo(before!.y, 0);
  });

  test('パネルの下の余白を超える大きさのキーボードでは、パネル下端がキーボード上端にちょうど揃う', async ({ page }) => {
    await installFakeViewport(page);
    await page.goto('/?e2e=storyTemplateEditor');
    await page.waitForTimeout(1000);
    await page.getByTestId('story-editor-add-text-btn').click();
    await page.waitForTimeout(500);

    const panel = page.getByTestId('story-editor-text-panel');
    const innerHeight = await page.evaluate(() => window.innerHeight);

    await page.evaluate(() => {
      const vv = (window as any).visualViewport;
      vv.height = window.innerHeight - 300;
      vv.dispatchEvent(new Event('resize'));
    });
    await page.waitForTimeout(300);

    const after = await panel.boundingBox();
    expect(after).not.toBeNull();
    // パネルより上に隙間ができず、ちょうどキーボードの上端に接するはず
    expect(after!.y + after!.height).toBeCloseTo(innerHeight - 300, 0);
  });
});

test.describe('StoryTemplateEditor 空のテキストの扱い', () => {
  test('文字を追加した直後、初期文字は入っていない', async ({ page }) => {
    await page.goto('/?e2e=storyTemplateEditor');
    await page.waitForTimeout(1000);

    await page.getByTestId('story-editor-add-text-btn').click();
    await page.waitForTimeout(500);

    const value = await page.getByTestId('story-editor-text-preview-input').inputValue();
    expect(value).toBe('');
  });

  test('何も入力せず「完了」を押すと、そのテキストは追加されない', async ({ page }) => {
    await page.goto('/?e2e=storyTemplateEditor');
    await page.waitForTimeout(1000);

    await page.getByTestId('story-editor-add-text-btn').click();
    await page.waitForTimeout(500);
    await page.getByText('完了').click();
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid^="layer-text_"]')).toHaveCount(0);
  });

  test('文字を入力してから「完了」を押すと、そのテキストは残る', async ({ page }) => {
    await page.goto('/?e2e=storyTemplateEditor');
    await page.waitForTimeout(1000);

    await page.getByTestId('story-editor-add-text-btn').click();
    await page.waitForTimeout(500);
    await page.getByTestId('story-editor-text-preview-input').fill('こんにちは');
    await page.getByText('完了').click();
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid^="layer-text_"]')).toHaveCount(1);
  });
});

test.describe('StoryTemplateEditor 写真の追加は「写真」アイコンからのみ', () => {
  test('写真未設定のプレビュー部分をタップしても写真は追加されない', async ({ page }) => {
    await page.goto('/?e2e=storyTemplateEditor');
    await page.waitForTimeout(1000);

    const placeholder = page.locator('[data-testid="layer-photo_1"]');
    const box = await placeholder.boundingBox();
    expect(box).not.toBeNull();
    await placeholder.click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(300);

    const hasImage = await page.evaluate(() => !!document.querySelector('[data-testid="layer-photo_1"] img'));
    expect(hasImage).toBe(false);
  });

  test('「写真」アイコンからは引き続き写真を追加できる（テスト用フックで代替）', async ({ page }) => {
    await page.goto('/?e2e=storyTemplateEditor');
    await page.waitForTimeout(1000);

    await page.evaluate(() => (window as any).__e2eAssignPhoto());
    await page.waitForTimeout(300);

    const hasImage = await page.evaluate(() => !!document.querySelector('[data-testid="layer-photo_1"] img'));
    expect(hasImage).toBe(true);
  });
});

test.describe('StoryTemplateEditor 編集中カーソルの初期位置', () => {
  test('既存テキストを選択し直すと、カーソルは先頭ではなく末尾に置かれる', async ({ page }) => {
    await page.goto('/?e2e=storyTemplateEditor');
    await page.waitForTimeout(1000);

    await page.getByTestId('story-editor-add-text-btn').click();
    await page.waitForTimeout(500);
    await page.getByTestId('story-editor-text-preview-input').fill('こんにちは');
    await page.getByText('完了').click();
    await page.waitForTimeout(300);

    const layer = page.locator('[data-testid^="layer-text_"]');
    await layer.click();
    await page.waitForTimeout(400);

    const sel = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="story-editor-text-preview-input"]') as HTMLTextAreaElement | null;
      return el ? { start: el.selectionStart, end: el.selectionEnd, len: el.value.length } : null;
    });
    expect(sel).not.toBeNull();
    expect(sel!.start).toBe(sel!.len);
    expect(sel!.end).toBe(sel!.len);
  });
});

test.describe('StoryTemplateEditor 他の場所をタップした時に閉じる', () => {
  test('背景パネルを開いた状態でキャンバスの他の場所をタップすると閉じる', async ({ page }) => {
    await page.goto('/?e2e=storyTemplateEditor');
    await page.waitForTimeout(1000);

    await page.getByText('背景').click();
    await page.waitForTimeout(300);
    await expect(page.locator('text=インク').first()).toBeVisible();

    const placeholder = page.locator('[data-testid="layer-photo_1"]');
    const box = await placeholder.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + 10, box!.y + box!.height * 0.55);
    await page.waitForTimeout(300);

    await expect(page.locator('text=インク').first()).toHaveCount(0);
  });

  test('テキスト編集中にキャンバスの他の場所をタップすると、プロパティ・プレビューが閉じる', async ({ page }) => {
    await page.goto('/?e2e=storyTemplateEditor');
    await page.waitForTimeout(1000);

    await page.getByTestId('story-editor-add-text-btn').click();
    await page.waitForTimeout(500);
    await page.getByTestId('story-editor-text-preview-input').fill('テスト');
    await page.waitForTimeout(300);

    const placeholder = page.locator('[data-testid="layer-photo_1"]');
    const box = await placeholder.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + 10, box!.y + box!.height * 0.55);
    await page.waitForTimeout(300);

    await expect(page.getByTestId('story-editor-text-panel')).toHaveCount(0);
    await expect(page.getByTestId('story-editor-text-preview')).toHaveCount(0);
  });

  test('（回帰）選択中のテキスト自身を再タップした場合は、閉じずに入力欄へフォーカスが当たる', async ({ page }) => {
    await page.goto('/?e2e=storyTemplateEditor');
    await page.waitForTimeout(1000);

    await page.getByTestId('story-editor-add-text-btn').click();
    await page.waitForTimeout(500);
    await page.getByTestId('story-editor-text-preview-input').fill('テスト');
    await page.getByText('完了').click();
    await page.waitForTimeout(300);

    const layer = page.locator('[data-testid^="layer-text_"]');
    const box = await layer.boundingBox();
    expect(box).not.toBeNull();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;
    const client = await page.context().newCDPSession(page);
    await dispatchTouch(client, 'touchStart', [{ x: cx, y: cy }]);
    await page.waitForTimeout(50);
    await dispatchTouch(client, 'touchEnd', []);
    await page.waitForTimeout(300);

    await expect(page.getByTestId('story-editor-text-panel')).toBeVisible();
    const focused = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="story-editor-text-preview-input"]');
      return document.activeElement === el;
    });
    expect(focused).toBe(true);
  });
});

test.describe('StoryTemplateEditor 1文字目入力時のプレビューの見切れ', () => {
  test('空文字から1文字目を入力した直後も、入力欄はフォントサイズに応じた最小サイズを下回らない', async ({ page }) => {
    await page.goto('/?e2e=storyTemplateEditor');
    await page.waitForTimeout(1000);
    await page.getByTestId('story-editor-add-text-btn').click();
    await page.waitForTimeout(500);

    const input = page.getByTestId('story-editor-text-preview-input');
    await input.type('あ', { delay: 0 });

    // 計測（previewInputSize）の反映を待たず、直後の状態を確認する。
    // min-width/min-heightがフォントサイズに応じた下限を確保しているため、
    // 計測が追いつく前の一瞬でも文字が入りきらないほど小さい箱にはならないはず
    const box = await input.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        width: el.getBoundingClientRect().width,
        height: el.getBoundingClientRect().height,
        fontSize: parseFloat(cs.fontSize),
      };
    });
    expect(box.width).toBeGreaterThanOrEqual(box.fontSize);
    expect(box.height).toBeGreaterThanOrEqual(box.fontSize);
  });

  test('1文字目に限らず、入力するたびに実際の内容が見切れない（計測の遅れを常に下限が補う）', async ({ page }) => {
    await page.goto('/?e2e=storyTemplateEditor');
    await page.waitForTimeout(1000);
    await page.getByTestId('story-editor-add-text-btn').click();
    await page.waitForTimeout(500);

    const input = page.getByTestId('story-editor-text-preview-input');
    const text = 'こんにちは世界これはテストです。もう少し長い文章を入力してみます。';
    let anyClipped = false;
    for (const ch of text) {
      await input.type(ch, { delay: 0 });
      const result = await input.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return {
          width: rect.width,
          height: rect.height,
          scrollW: (el as HTMLTextAreaElement).scrollWidth,
          scrollH: (el as HTMLTextAreaElement).scrollHeight,
        };
      });
      // scrollWidth/scrollHeightが見えている幅/高さを超えていれば、内容が見切れている
      if (result.scrollW - result.width > 2 || result.scrollH - result.height > 2) anyClipped = true;
    }
    expect(anyClipped).toBe(false);
  });
});

