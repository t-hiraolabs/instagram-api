// 「ストーリー作成」統合の核心部分（CreativeCanvas/DraggablePhotoSlot）の回帰テスト。
// src/screens/__e2e__/E2ECreativeCanvasScreen.tsxを?e2e=creativeCanvasで直接マウントし、
// ログインや実データに依存せず検証する。
import { test, expect, CDPSession } from '@playwright/test';

async function dispatchTouch(client: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', touches: { x: number; y: number }[]) {
  await client.send('Input.dispatchTouchEvent', { type, touchPoints: touches.map((t) => ({ x: t.x, y: t.y })) });
}

test.describe('CreativeCanvas', () => {
  test('描画順序がDOM順序と一致する（背景→背面装飾→写真→前面装飾→フレーム）', async ({ page }) => {
    await page.goto('/?e2e=creativeCanvas');
    await page.waitForTimeout(1000);

    const order = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('[data-testid^="layer-"]'));
      return nodes.map((n) => n.getAttribute('data-testid'));
    });

    // fixtureはbg→decor_behind→photo_1/2/3→decor_front→frameの順で定義されている
    expect(order).toEqual([
      'layer-bg', 'layer-decor_behind',
      'layer-photo_1', 'layer-photo_2', 'layer-photo_3',
      'layer-decor_front', 'layer-frame',
    ]);
  });

  test('あるスロットのpan操作が他スロットのオフセットに影響しない', async ({ page }) => {
    await page.goto('/?e2e=creativeCanvas');
    await page.waitForTimeout(1000);

    const before2 = await page.getByTestId('e2e-offset-photo_2').textContent();
    const before3 = await page.getByTestId('e2e-offset-photo_3').textContent();

    const slot1Box = await page.getByTestId('layer-photo_1').boundingBox();
    expect(slot1Box).not.toBeNull();
    const cx = slot1Box!.x + slot1Box!.width / 2;
    const cy = slot1Box!.y + slot1Box!.height / 2;

    const client = await page.context().newCDPSession(page);
    await dispatchTouch(client, 'touchStart', [{ x: cx, y: cy }]);
    await page.waitForTimeout(100);
    const steps = 8;
    const dx = 60, dy = 40;
    for (let i = 1; i <= steps; i++) {
      await dispatchTouch(client, 'touchMove', [{ x: cx + (dx * i) / steps, y: cy + (dy * i) / steps }]);
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(100);
    await dispatchTouch(client, 'touchEnd', []);
    await page.waitForTimeout(300);

    const after1 = await page.getByTestId('e2e-offset-photo_1').textContent();
    const after2 = await page.getByTestId('e2e-offset-photo_2').textContent();
    const after3 = await page.getByTestId('e2e-offset-photo_3').textContent();

    expect(after1).not.toMatch(/x=0\.0 y=0\.0/);
    expect(after2).toBe(before2);
    expect(after3).toBe(before3);
  });
});
