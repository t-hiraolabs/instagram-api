// フィード作成・テンプレート作成での画像/枠のドラッグ・拡大縮小操作に使う、
// きりのいい位置（中央寄せ、枠にちょうど収まる倍率、他の要素の端など）へ
// 近づいたときに一瞬止まる「スナップ」処理の共通ユーティリティ。
// 'worklet'指定によりreact-native-reanimatedのUIスレッド（Gesture.onUpdate内）からも、
// 通常のJSコード（PanResponderのハンドラ内）からもそのまま呼び出せる。
export function snapValue(raw: number, targets: number[], zone: number): number {
  'worklet';
  let best = raw;
  let bestDist = zone;
  for (let i = 0; i < targets.length; i++) {
    const d = Math.abs(raw - targets[i]);
    if (d < bestDist) {
      bestDist = d;
      best = targets[i];
    }
  }
  return best;
}

/** snapValueと同じだが、どの候補にスナップしたか（していないならnull）も返す。
 *  スナップ中はガイド線（見えやすい枠線）を表示するために使う。 */
export function snapValueWithHit(raw: number, targets: number[], zone: number): { value: number; hit: number | null } {
  'worklet';
  let best = raw;
  let bestDist = zone;
  let hit: number | null = null;
  for (let i = 0; i < targets.length; i++) {
    const d = Math.abs(raw - targets[i]);
    if (d < bestDist) {
      bestDist = d;
      best = targets[i];
      hit = targets[i];
    }
  }
  return { value: best, hit };
}
