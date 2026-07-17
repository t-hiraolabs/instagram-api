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

    // fixtureはbg→decor_behind→photo_1/2/3→decor_front→frame→text(title)の順で定義されている
    expect(order).toEqual([
      'layer-bg', 'layer-decor_behind',
      'layer-photo_1', 'layer-photo_2', 'layer-photo_3',
      'layer-decor_front', 'layer-frame', 'layer-title',
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

  test('ピンチでスロットを覆う倍率（scale=1）に近づくと一瞬止まる（スナップする）', async ({ page }) => {
    await page.goto('/?e2e=creativeCanvas');
    await page.waitForTimeout(1000);

    const box = await page.getByTestId('layer-photo_3').boundingBox();
    expect(box).not.toBeNull();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    const client = await page.context().newCDPSession(page);
    async function pinch(startOffset: number, endOffset: number) {
      await dispatchTouch(client, 'touchStart', [{ x: cx - startOffset, y: cy }, { x: cx + startOffset, y: cy }]);
      await page.waitForTimeout(100);
      const steps = 8;
      for (let i = 1; i <= steps; i++) {
        const offset = startOffset + ((endOffset - startOffset) * i) / steps;
        await dispatchTouch(client, 'touchMove', [{ x: cx - offset, y: cy }, { x: cx + offset, y: cy }]);
        await page.waitForTimeout(40);
      }
      await page.waitForTimeout(100);
      await dispatchTouch(client, 'touchEnd', []);
      await page.waitForTimeout(300);
    }

    // 1回目: 大きく拡大する（スナップ範囲外の倍率まで持っていく）
    await pinch(30, 90);
    const afterZoomOut = await page.getByTestId('e2e-offset-photo_3').textContent();
    expect(afterZoomOut).not.toMatch(/scale=1\.00/);

    // 2回目: scale=1のスナップ範囲に入った瞬間に指を離してコミットする（合成タッチイベントで
    // ちょうど1.00に着地させるのは狙いにくいため、スナップが効いた瞬間を検出して確定させる）。
    // e2e-offset-*のテキストはonEnd時にしか更新されない（ライブ中の値ではない）ため、
    // ライブ中に更新される枠線の色（isSnapped）でスナップの瞬間を検出する。
    async function borderColor() {
      return page.evaluate(() => {
        const el = document.querySelector('[data-testid="layer-photo_3"] > div') as HTMLElement | null;
        return el ? getComputedStyle(el).borderTopColor : null;
      });
    }
    await dispatchTouch(client, 'touchStart', [{ x: cx - 60, y: cy }, { x: cx + 60, y: cy }]);
    await page.waitForTimeout(100);
    const steps = 60;
    for (let i = 1; i <= steps; i++) {
      const offset = 60 + ((8 - 60) * i) / steps;
      await dispatchTouch(client, 'touchMove', [{ x: cx - offset, y: cy }, { x: cx + offset, y: cy }]);
      await page.waitForTimeout(15);
      if ((await borderColor()) === 'rgb(0, 229, 255)') break; // スナップ中の色を検出したら即座に離す
    }
    await dispatchTouch(client, 'touchEnd', []);
    await page.waitForTimeout(300);
    const afterSnapCommit = await page.getByTestId('e2e-offset-photo_3').textContent();
    expect(afterSnapCommit).toMatch(/scale=1\.00/);

    // 3回目: scale=1はもはや下限ではないため、さらに縮小して1未満にもできる
    // （写真をスロットより小さくして周囲に余白を作れるようにする、意図した仕様変更）
    await pinch(60, 20);
    const afterShrinkBelowOne = await page.getByTestId('e2e-offset-photo_3').textContent();
    const finalScale = Number(afterShrinkBelowOne!.match(/scale=([\d.]+)/)![1]);
    expect(finalScale).toBeLessThan(0.9);
  });

  test('スナップ中は写真スロットの枠線が見えやすい色になり、離すと選択枠の色に戻る', async ({ page }) => {
    await page.goto('/?e2e=creativeCanvas');
    await page.waitForTimeout(1000);

    const box = await page.getByTestId('layer-photo_3').boundingBox();
    expect(box).not.toBeNull();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    const client = await page.context().newCDPSession(page);
    async function borderColor() {
      return page.evaluate(() => {
        const el = document.querySelector('[data-testid="layer-photo_3"] > div') as HTMLElement | null;
        return el ? getComputedStyle(el).borderTopColor : null;
      });
    }

    // まずスナップ範囲外まで大きくズームアウトする（選択状態にもなる）
    await dispatchTouch(client, 'touchStart', [{ x: cx - 30, y: cy }, { x: cx + 30, y: cy }]);
    await page.waitForTimeout(100);
    for (let i = 1; i <= 8; i++) {
      const offset = 30 + ((90 - 30) * i) / 8;
      await dispatchTouch(client, 'touchMove', [{ x: cx - offset, y: cy }, { x: cx + offset, y: cy }]);
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(100);
    await dispatchTouch(client, 'touchEnd', []);
    await page.waitForTimeout(300);
    expect(await borderColor()).toBe('rgb(74, 144, 217)'); // 選択枠の色（スナップしていない）

    // scale=1（もはや下限ではなく、あくまでスナップ先の1つ）を通過するくらいまで、
    // 細かいステップでゆっくり縮小し、スナップ色になる瞬間があることを確認する
    // （「1.00にちょうど着地させる」のは合成タッチイベントでは狙いにくいため、
    // 通過過程で確認する方式にしている）
    await dispatchTouch(client, 'touchStart', [{ x: cx - 60, y: cy }, { x: cx + 60, y: cy }]);
    await page.waitForTimeout(100);
    let sawSnapColor = false;
    const steps = 60;
    for (let i = 1; i <= steps; i++) {
      const offset = 60 + ((8 - 60) * i) / steps;
      await dispatchTouch(client, 'touchMove', [{ x: cx - offset, y: cy }, { x: cx + offset, y: cy }]);
      await page.waitForTimeout(15);
      if ((await borderColor()) === 'rgb(0, 229, 255)') sawSnapColor = true;
    }
    expect(sawSnapColor).toBe(true);

    await dispatchTouch(client, 'touchEnd', []);
    await page.waitForTimeout(300);
    expect(await borderColor()).toBe('rgb(74, 144, 217)'); // 離すと選択枠の色に戻る
  });

  test('未選択の小さいテキストでも指2本のピンチで拡大できる', async ({ page }) => {
    await page.goto('/?e2e=creativeCanvas');
    await page.waitForTimeout(1000);

    const box = await page.getByTestId('layer-title').boundingBox();
    expect(box).not.toBeNull();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    const before = await page.getByTestId('e2e-offset-title').textContent();
    expect(before).toMatch(/scale=1\.00/);

    // タップで選択する前の、初期サイズの小さい状態からいきなりピンチで拡大する
    // （選択中だけhitSlopを広げていた旧実装では、未選択の小さい要素に指2本を
    // 置くこと自体が難しく拡大操作を開始できなかった）
    const client = await page.context().newCDPSession(page);
    await dispatchTouch(client, 'touchStart', [{ x: cx - 15, y: cy }, { x: cx + 15, y: cy }]);
    await page.waitForTimeout(100);
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const offset = 15 + ((70 - 15) * i) / steps;
      await dispatchTouch(client, 'touchMove', [{ x: cx - offset, y: cy }, { x: cx + offset, y: cy }]);
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(100);
    await dispatchTouch(client, 'touchEnd', []);
    await page.waitForTimeout(300);

    const after = await page.getByTestId('e2e-offset-title').textContent();
    const scale = Number(after!.match(/scale=([\d.]+)/)![1]);
    expect(scale).toBeGreaterThan(1.3);
  });

  test('2本指でそれぞれ別の要素に同時に触れても、片方だけが反応する（排他ロック）', async ({ page }) => {
    await page.goto('/?e2e=creativeCanvas');
    await page.waitForTimeout(1000);

    // photo_3はスロットと写真の比率が完全に一致しており、offsetが常に(0,0)に
    // クランプされる（=ジェスチャーが実際に効いたかどうかをこの値だけでは判定できない）
    // ため、検証対象には使わない。photo_1（実際にオフセットが動く）とtitle（クランプの
    // 一切ないテキスト、x/yがそのまま反映される）の組み合わせで検証する。
    const before = await page.getByTestId('e2e-offset-title').textContent();

    const box1 = await page.getByTestId('layer-photo_1').boundingBox();
    const boxTitle = await page.getByTestId('layer-title').boundingBox();
    expect(box1).not.toBeNull();
    expect(boxTitle).not.toBeNull();
    const c1 = { x: box1!.x + box1!.width / 2, y: box1!.y + box1!.height / 2 };
    const cTitle = { x: boxTitle!.x + boxTitle!.width / 2, y: boxTitle!.y + boxTitle!.height / 2 };

    const client = await page.context().newCDPSession(page);
    await dispatchTouch(client, 'touchStart', [c1, cTitle]);
    await page.waitForTimeout(100);
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      await dispatchTouch(client, 'touchMove', [
        { x: c1.x + (80 * i) / steps, y: c1.y },
        { x: cTitle.x - (80 * i) / steps, y: cTitle.y },
      ]);
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(100);
    await dispatchTouch(client, 'touchEnd', []);
    await page.waitForTimeout(300);

    const after1 = await page.getByTestId('e2e-offset-photo_1').textContent();
    const afterTitle = await page.getByTestId('e2e-offset-title').textContent();
    // 排他ロック導入前は、2本指で別々の要素に触れると両方が同時に反応してしまっていた。
    // 導入後はどちらか一方だけが反応し、もう片方（title）は初期位置のまま完全に不変
    expect(after1).not.toMatch(/x=0\.0 y=0\.0/);
    expect(afterTitle).toBe(before);
  });

  test('1本目の指がテキストに触れていれば、2本目の指は離れた場所でもピンチとして拡大できる', async ({ page }) => {
    await page.goto('/?e2e=creativeCanvas');
    await page.waitForTimeout(1000);

    const box = await page.getByTestId('layer-title').boundingBox();
    expect(box).not.toBeNull();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    const before = await page.getByTestId('e2e-offset-title').textContent();
    expect(before).toMatch(/scale=1\.00/);

    // 1本目の指をテキストの上に置いたまま、2本目の指はテキストから150px以上離れた
    // 場所から触れ始め、さらに離していく（react-native-gesture-handlerのWeb実装は
    // 新規タッチの捕捉を要素自身の実際のDOM矩形でしか判定しないため、要素側の
    // hitSlopをどれだけ広げても2本目の指の開始位置までは判定領域を広げられない。
    // そのためピンチ・回転はCreativeCanvas側のキャンバス全体を覆う1つのジェスチャーで
    // 受け止め、「今の操作対象要素」がある時だけそれを直接操作する設計にしている）
    const client = await page.context().newCDPSession(page);
    await dispatchTouch(client, 'touchStart', [{ x: cx, y: cy }]);
    await page.waitForTimeout(150);
    await dispatchTouch(client, 'touchStart', [{ x: cx, y: cy }, { x: cx + 150, y: cy }]);
    await page.waitForTimeout(100);
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      await dispatchTouch(client, 'touchMove', [{ x: cx, y: cy }, { x: cx + 150 + (i * 15), y: cy }]);
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(100);
    await dispatchTouch(client, 'touchEnd', []);
    await page.waitForTimeout(300);

    const after = await page.getByTestId('e2e-offset-title').textContent();
    const scale = Number(after!.match(/scale=([\d.]+)/)![1]);
    expect(scale).toBeGreaterThan(1.2);
  });

  test('時間差で別の要素に触れた場合も、先に触れていた要素だけが反応する', async ({ page }) => {
    await page.goto('/?e2e=creativeCanvas');
    await page.waitForTimeout(1000);

    // photo_3はoffsetが常に(0,0)にクランプされ「動いたかどうか」をこの値だけでは
    // 判定できないため、検証対象にはtitle（クランプの一切ないテキスト）を使う
    const box1 = await page.getByTestId('layer-photo_1').boundingBox();
    const boxTitle = await page.getByTestId('layer-title').boundingBox();
    expect(box1).not.toBeNull();
    expect(boxTitle).not.toBeNull();
    const c1 = { x: box1!.x + box1!.width / 2, y: box1!.y + box1!.height / 2 };
    const cTitle = { x: boxTitle!.x + boxTitle!.width / 2, y: boxTitle!.y + boxTitle!.height / 2 };

    const before1 = await page.getByTestId('e2e-offset-photo_1').textContent();
    const beforeTitle = await page.getByTestId('e2e-offset-title').textContent();

    // 先にphoto_1へ1本指で触れ（操作対象として確定させ）、少し間を置いてから
    // 別のtitleへ2本目の指を触れさせる。titleは一切反応してはならない
    const client = await page.context().newCDPSession(page);
    await dispatchTouch(client, 'touchStart', [c1]);
    await page.waitForTimeout(150);
    await dispatchTouch(client, 'touchStart', [c1, cTitle]);
    await page.waitForTimeout(100);
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      await dispatchTouch(client, 'touchMove', [
        { x: c1.x + (60 * i) / steps, y: c1.y + (40 * i) / steps },
        { x: cTitle.x - (60 * i) / steps, y: cTitle.y - (40 * i) / steps },
      ]);
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(100);
    await dispatchTouch(client, 'touchEnd', []);
    await page.waitForTimeout(300);

    const after1 = await page.getByTestId('e2e-offset-photo_1').textContent();
    const afterTitle = await page.getByTestId('e2e-offset-title').textContent();
    // 先に触れていたphoto_1は正しく動く（ロックのせいで自分の正当な操作まで
    // 失われてしまう不具合の再発防止）。後から触れた別要素（title）は一切変化しない
    expect(after1).not.toBe(before1);
    expect(afterTitle).toBe(beforeTitle);
  });
});
