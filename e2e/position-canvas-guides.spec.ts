// PositionCanvas（テンプレート作成の枠調整）の見えやすいガイド線の回帰テスト。
// 隣接する2枠をドラッグでぴったり隙間なく揃えたときにガイド線が表示されることを確認する。
// src/screens/__e2e__/E2EPositionCanvasScreen.tsxを?e2e=positionCanvasで直接マウントする。
import { test, expect, CDPSession } from '@playwright/test';

async function dispatchTouch(client: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', touches: { x: number; y: number }[]) {
  await client.send('Input.dispatchTouchEvent', { type, touchPoints: touches.map((t) => ({ x: t.x, y: t.y })) });
}

test.describe('PositionCanvas ガイド線', () => {
  test('枠aを枠bへドラッグで近づけると隙間なく揃い、ガイド線が表示される', async ({ page }) => {
    await page.goto('/?e2e=positionCanvas');
    await page.waitForTimeout(1000);

    const boxA = await page.getByTestId('position-box-a').boundingBox();
    expect(boxA).not.toBeNull();
    const cx = boxA!.x + boxA!.width / 2;
    const cy = boxA!.y + boxA!.height / 2;

    const client = await page.context().newCDPSession(page);
    await dispatchTouch(client, 'touchStart', [{ x: cx, y: cy }]);
    await page.waitForTimeout(100);

    // PanResponderの較正のクセ上、まず明確に大きく動かして登録を確定させてから、
    // 隙間ゼロで揃う目標位置（下へ40px）付近まで細かく戻す
    await dispatchTouch(client, 'touchMove', [{ x: cx, y: cy + 60 }]);
    await page.waitForTimeout(60);
    await dispatchTouch(client, 'touchMove', [{ x: cx, y: cy + 13 }]);
    await page.waitForTimeout(150);

    const guideCount = await page.locator('[data-testid="position-guide-h"]').count();
    expect(guideCount).toBe(1);
    const guideColor = await page.locator('[data-testid="position-guide-h"]').first().evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(guideColor).toBe('rgb(0, 229, 255)');

    await dispatchTouch(client, 'touchEnd', []);
    await page.waitForTimeout(300);

    // ぴったり隙間なく揃う（枠aの下端=枠bの上端960）
    const readoutA = await page.getByTestId('e2e-box-a').textContent();
    expect(readoutA).toMatch(/y=40\.0/);

    // 離した後はガイド線が消える
    const guideCountAfter = await page.locator('[data-testid="position-guide-h"]').count();
    expect(guideCountAfter).toBe(0);
  });
});
