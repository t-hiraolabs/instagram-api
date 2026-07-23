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

  test('スナップ中は写真スロットの枠線が見えやすい色になり、離すと非表示に戻る', async ({ page }) => {
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

    // まずスナップ範囲外まで大きくズームアウトする（選択状態にもなる。写真は選択中でも
    // 青い枠線を表示しない仕様のため、スナップしていない間は枠線なし＝透明のまま）
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
    expect(await borderColor()).toBe('rgba(0, 0, 0, 0)'); // 選択中でも枠線は表示しない（スナップしていない）

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
    expect(await borderColor()).toBe('rgba(0, 0, 0, 0)'); // 離すと枠線は再び非表示に戻る
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

  test('ピンチ中のわずかな指の角度のブレでは回転しない（回転の不感帯）', async ({ page }) => {
    await page.goto('/?e2e=creativeCanvas');
    await page.waitForTimeout(1000);

    const box = await page.getByTestId('layer-title').boundingBox();
    expect(box).not.toBeNull();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    // サイズ変更のつもりで指を動かしても、完全に一直線に動かせるとは限らない。わずかな
    // 角度のブレ（不感帯の角度未満）まで回転として反映すると、「拡大縮小しただけなのに
    // 最初から角度が変わってしまう」と感じられてしまうため、小さなブレは無視されるべき
    const client = await page.context().newCDPSession(page);
    await dispatchTouch(client, 'touchStart', [{ x: cx - 15, y: cy }, { x: cx + 15, y: cy }]);
    await page.waitForTimeout(100);
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const offset = 15 + (40 * i) / steps;
      const yDrift = (2 * i) / steps; // 55px程度の半径に対して数度程度のわずかなブレ
      await dispatchTouch(client, 'touchMove', [{ x: cx - offset, y: cy - yDrift }, { x: cx + offset, y: cy + yDrift }]);
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(100);
    await dispatchTouch(client, 'touchEnd', []);
    await page.waitForTimeout(300);

    const after = await page.getByTestId('e2e-offset-title').textContent();
    const rotation = Number(after!.match(/rotation=(-?[\d.]+)/)![1]);
    expect(rotation).toBe(0);
  });

  test('意図的に大きく指を回転させれば、不感帯を超えた分だけ滑らかに回転する', async ({ page }) => {
    await page.goto('/?e2e=creativeCanvas');
    await page.waitForTimeout(1000);

    const box = await page.getByTestId('layer-title').boundingBox();
    expect(box).not.toBeNull();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    const client = await page.context().newCDPSession(page);
    const radius = 15;
    await dispatchTouch(client, 'touchStart', [{ x: cx - radius, y: cy }, { x: cx + radius, y: cy }]);
    await page.waitForTimeout(100);
    const steps = 20;
    const targetAngleDeg = 70; // 不感帯（15度）にもカーディナルスナップ（90度）にも
    // 十分な余裕を持たせた角度まで回転させる（半径は一定、拡大縮小は伴わない）
    for (let i = 1; i <= steps; i++) {
      const angle = ((targetAngleDeg * Math.PI) / 180) * (i / steps);
      const dx = radius * Math.cos(angle), dy = radius * Math.sin(angle);
      await dispatchTouch(client, 'touchMove', [{ x: cx - dx, y: cy - dy }, { x: cx + dx, y: cy + dy }]);
      await page.waitForTimeout(30);
    }
    await page.waitForTimeout(100);
    await dispatchTouch(client, 'touchEnd', []);
    await page.waitForTimeout(300);

    const after = await page.getByTestId('e2e-offset-title').textContent();
    const rotation = Number(after!.match(/rotation=(-?[\d.]+)/)![1]);
    // 不感帯（15度）の分だけ差し引かれた角度が反映される（70度回した場合は約55度）
    expect(rotation).toBeGreaterThan(45);
    expect(rotation).toBeLessThan(65);
  });

  test('写真スロットも指2本の回転操作で角度を変えられる', async ({ page }) => {
    await page.goto('/?e2e=creativeCanvas');
    await page.waitForTimeout(1000);

    const box = await page.getByTestId('layer-photo_1').boundingBox();
    expect(box).not.toBeNull();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    const client = await page.context().newCDPSession(page);
    const radius = 15;
    await dispatchTouch(client, 'touchStart', [{ x: cx - radius, y: cy }, { x: cx + radius, y: cy }]);
    await page.waitForTimeout(100);
    const steps = 20;
    const targetAngleDeg = 70;
    for (let i = 1; i <= steps; i++) {
      const angle = ((targetAngleDeg * Math.PI) / 180) * (i / steps);
      const dx = radius * Math.cos(angle), dy = radius * Math.sin(angle);
      await dispatchTouch(client, 'touchMove', [{ x: cx - dx, y: cy - dy }, { x: cx + dx, y: cy + dy }]);
      await page.waitForTimeout(30);
    }
    await page.waitForTimeout(100);
    await dispatchTouch(client, 'touchEnd', []);
    await page.waitForTimeout(300);

    const after = await page.getByTestId('e2e-offset-photo_1').textContent();
    const rotation = Number(after!.match(/rotation=(-?[\d.]+)/)![1]);
    // 写真は回転を無効化していた旧実装では常に0のまま。不感帯（15度）を差し引いた
    // 角度（70度回した場合は約55度）が反映されることを確認する
    expect(rotation).toBeGreaterThan(45);
    expect(rotation).toBeLessThan(65);
  });

  test('回転が90度（カーディナル角）に近づくと一瞬止まり、ちょうど90度にスナップする', async ({ page }) => {
    await page.goto('/?e2e=creativeCanvas');
    await page.waitForTimeout(1000);

    const box = await page.getByTestId('layer-title').boundingBox();
    expect(box).not.toBeNull();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    const client = await page.context().newCDPSession(page);
    const radius = 15;

    async function borderColor() {
      return page.evaluate(() => {
        const el = document.querySelector('[data-testid="layer-title"]') as HTMLElement | null;
        return el ? getComputedStyle(el).borderTopColor : null;
      });
    }

    // 0度は不感帯の間ずっと「まだ0度のまま」になるため、それ自体がカーディナル角と
    // 判定されて開始直後にガイドが出てしまう（意図しない誤検出）。そのため、判定は
    // 0度のゾーンを抜けた後（30度以降）からだけ行い、90度への接近だけを見る。
    // 1本の連続したジェスチャーの途中で、枠線がスナップ色に変わった瞬間を検出し、
    // その場で指を離して確定させる（ちょうど90度で止まるはず）
    await dispatchTouch(client, 'touchStart', [{ x: cx - radius, y: cy }, { x: cx + radius, y: cy }]);
    await page.waitForTimeout(100);
    const steps = 60;
    const targetAngleDeg = 115; // 不感帯15度を引いた約100度、90度スナップ範囲を確実に通過する
    let sawSnapColor = false;
    for (let i = 1; i <= steps; i++) {
      const angleDeg = (targetAngleDeg * i) / steps;
      const angle = (angleDeg * Math.PI) / 180;
      const dx = radius * Math.cos(angle), dy = radius * Math.sin(angle);
      await dispatchTouch(client, 'touchMove', [{ x: cx - dx, y: cy - dy }, { x: cx + dx, y: cy + dy }]);
      await page.waitForTimeout(25);
      if (angleDeg >= 30 && (await borderColor()) === 'rgb(0, 229, 255)') { sawSnapColor = true; break; }
    }
    expect(sawSnapColor).toBe(true);
    await dispatchTouch(client, 'touchEnd', []);
    await page.waitForTimeout(300);

    const after = await page.getByTestId('e2e-offset-title').textContent();
    const rotation = Number(after!.match(/rotation=(-?[\d.]+)/)![1]);
    expect(rotation).toBeCloseTo(90, 1);
  });

  test('要素をキャンバス中央へドラッグすると中央線で一瞬止まり、ぴったり整列する', async ({ page }) => {
    await page.goto('/?e2e=creativeCanvas');
    await page.waitForTimeout(1500); // onLayoutでの実寸測定が安定するまで待つ

    const box = await page.getByTestId('layer-title').boundingBox();
    expect(box).not.toBeNull();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    const bgBox = await page.getByTestId('layer-bg').boundingBox();
    expect(bgBox).not.toBeNull();
    const targetX = bgBox!.x + bgBox!.width / 2;
    const targetY = bgBox!.y + bgBox!.height / 2;

    async function guideLineVisible() {
      return page.evaluate(() => {
        const guides = Array.from(document.querySelectorAll('div')).filter((el) => {
          const s = getComputedStyle(el);
          return s.backgroundColor === 'rgb(0, 229, 255)' && s.width === '1px';
        });
        return guides.some((g) => getComputedStyle(g).opacity === '1');
      });
    }

    const client = await page.context().newCDPSession(page);
    await dispatchTouch(client, 'touchStart', [{ x: cx, y: cy }]);
    await page.waitForTimeout(100);
    const steps = 60;
    // CDPの合成タッチイベントは計算通りの座標にきっちり届かないことがあるため、
    // わざと少し行き過ぎる位置まで動かして確実にスナップ範囲を通過させ、キャンバス
    // 全体を貫く中央ガイド線が見えた瞬間に指を離す（ぴったり中央に着地させる方式）
    const OVERSHOOT = 1.3;
    let sawGuide = false;
    for (let i = 1; i <= steps; i++) {
      const x = cx + ((targetX - cx) * OVERSHOOT * i) / steps;
      const y = cy + ((targetY - cy) * OVERSHOOT * i) / steps;
      await dispatchTouch(client, 'touchMove', [{ x, y }]);
      await page.waitForTimeout(25);
      if (await guideLineVisible()) { sawGuide = true; break; }
    }
    expect(sawGuide).toBe(true);
    await dispatchTouch(client, 'touchEnd', []);
    await page.waitForTimeout(300);

    const after = await page.getByTestId('e2e-offset-title').textContent();
    const x = Number(after!.match(/x=(-?[\d.]+)/)![1]);
    // テキストの実寸(onLayoutで測定した値)から算出される、キャンバス水平中央に
    // ぴったり整列する位置に近い値になっている（初期位置x=200から明確に移動している）
    expect(x).toBeGreaterThan(460);
    expect(x).toBeLessThan(500);
  });

  test('写真スロットをドラッグしてもキャンバス全体を貫く中央整列ガイド線は表示されない（離した位置からずれて配置される不具合の再発防止）', async ({ page }) => {
    // 回帰テスト: 以前はDraggablePhotoSlotがwidth/height/canvasOffsetX/Yを
    // DraggableLayerへ渡し、写真の中心がキャンバス全体の絶対中央（CANVAS_W/2,
    // CANVAS_H/2）に近づくと一瞬止まってガイド線を表示していた。しかし写真スロットの
    // クランプ可能範囲（clampPhotoOffset）はスロット自身の中央（centerX/centerY）
    // 基準であり、キャンバス全体の中央はスロットの位置によってはクランプ範囲外に
    // なる（特にグリッド型テンプレートのphoto_3のように、スロットがキャンバス左上
    // 以外にある場合）。その結果、ガイド線が出た位置で指を離しても、実際にはクランプ
    // されたスロット自身の中央位置へずれて配置されてしまう不具合があった。
    // 写真スロットにとって意味のある「中央」はスロット自身の中央だけであり、それは
    // 既にsnapX/snapY（isSnapped表示）で正しくカバーされているため、キャンバス全体の
    // ガイド線はスロットの操作では一切表示しないようにした。
    await page.goto('/?e2e=creativeCanvas');
    await page.waitForTimeout(1000);

    const box = await page.getByTestId('layer-photo_3').boundingBox();
    expect(box).not.toBeNull();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    // layer-bgはキャンバス全面(0,0)-(1080,1920)を占めるので、その中心＝キャンバスの
    // 絶対中央位置（スクリーン座標）の基準として使える
    const bgBox = await page.getByTestId('layer-bg').boundingBox();
    expect(bgBox).not.toBeNull();
    const targetX = bgBox!.x + bgBox!.width / 2;
    const targetY = bgBox!.y + bgBox!.height / 2;

    async function guideLineVisible() {
      return page.evaluate(() => {
        const guides = Array.from(document.querySelectorAll('div')).filter((el) => {
          const s = getComputedStyle(el);
          return s.backgroundColor === 'rgb(0, 229, 255)' && s.width === '1px';
        });
        return guides.some((g) => getComputedStyle(g).opacity === '1');
      });
    }

    const client = await page.context().newCDPSession(page);
    await dispatchTouch(client, 'touchStart', [{ x: cx, y: cy }]);
    await page.waitForTimeout(100);
    const steps = 60;
    // キャンバスの絶対中央（bgBoxの中心）をちょうど通過する経路でドラッグする。
    // photo_3のようにスロットがキャンバス左上以外にある場合、この経路は以前の
    // 実装だとガイド線が誤って表示される（そしてクランプで位置がずれる）経路だった
    let sawGuide = false;
    for (let i = 1; i <= steps; i++) {
      const x = cx + ((targetX - cx) * i) / steps;
      const y = cy + ((targetY - cy) * i) / steps;
      await dispatchTouch(client, 'touchMove', [{ x, y }]);
      await page.waitForTimeout(25);
      if (await guideLineVisible()) { sawGuide = true; break; }
    }
    await dispatchTouch(client, 'touchEnd', []);
    await page.waitForTimeout(300);

    expect(sawGuide).toBe(false);
  });
});
