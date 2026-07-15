// FeedCropEditor（フィード投稿の写真調整）の見えやすいガイド線・枠線ハイライトの回帰テスト。
// src/screens/__e2e__/E2EFeedCropScreen.tsxを?e2e=feedCropで直接マウントし、
// ログインや実データに依存せず検証する。
import { test, expect, CDPSession } from '@playwright/test';

async function dispatchTouch(client: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', touches: { x: number; y: number }[]) {
  await client.send('Input.dispatchTouchEvent', { type, touchPoints: touches.map((t) => ({ x: t.x, y: t.y })) });
}

test.describe('FeedCropEditor スナップガイド', () => {
  test('枠を覆う倍率（scale=1）に近づくと枠線が見えやすい色に変わり、離すと白に戻る', async ({ page }) => {
    await page.goto('/?e2e=feedCrop');
    await page.waitForTimeout(1000);

    const box = await page.getByTestId('feedcrop-box').boundingBox();
    expect(box).not.toBeNull();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    const client = await page.context().newCDPSession(page);
    async function border() {
      return page.getByTestId('feedcrop-box').evaluate((el) => getComputedStyle(el).borderColor);
    }

    // 初期倍率はDEFAULT_FEED_TRANSFORM（scale=1、ちょうど枠を覆う）。ピンチ距離較正が
    // ブラウザに配信される実際の最初のtouchmoveフレームに依存し、正確な較正フレームを
    // 予測できない（Chromiumが微小な移動をまとめる/間引くため）ので、ごく小さい刻みで
    // 少しずつ指を開いていき、scale=1付近を通過するどこかのフレームで枠線が見えやすい色に
    // 変わることを確認する（一気に大きく動かして特定のフレームちょうどでの一致を狙うより頑健）。
    await dispatchTouch(client, 'touchStart', [{ x: cx - 50, y: cy }, { x: cx + 50, y: cy }]);
    await page.waitForTimeout(100);
    let sawSnapColor = false;
    for (let off = 50; off <= 58; off += 1) {
      await dispatchTouch(client, 'touchMove', [{ x: cx - off, y: cy }, { x: cx + off, y: cy }]);
      await page.waitForTimeout(60);
      if ((await border()) === 'rgb(0, 229, 255)') sawSnapColor = true;
    }
    expect(sawSnapColor).toBe(true);

    // さらに大きく開いてスナップ範囲外まで拡大すると、ガイド色が消える（ジェスチャー中のまま）
    for (let off = 60; off <= 130; off += 10) {
      await dispatchTouch(client, 'touchMove', [{ x: cx - off, y: cy }, { x: cx + off, y: cy }]);
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(60);
    expect(await border()).toBe('rgb(255, 255, 255)');

    await dispatchTouch(client, 'touchEnd', []);
    await page.waitForTimeout(300);
    expect(await border()).toBe('rgb(255, 255, 255)');
  });
});
