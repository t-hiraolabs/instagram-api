// PWA(standalone)でInstagramの認証画面など外部サイトへ移動して戻ってくると、
// window.innerHeight/visualViewport.heightが一瞬（あるいはずっと）古い値のままになり、
// 画面下部に隙間ができることがある。
// iOSのstandalone PWAはアプリスイッチャー経由で復帰した際にresize/focus/
// visibilitychangeが確実には発火しないことがあるため、イベント任せにせず、
// 一定間隔でポーリングして値が変わっていたら補正する（変化がなければ何もしない軽量な処理）。
(function () {
  var last = null;

  function currentHeight() {
    return (window.visualViewport && window.visualViewport.height) || window.innerHeight;
  }

  function setAppHeight() {
    var h = currentHeight();
    if (h === last) return;
    last = h;
    document.documentElement.style.setProperty('--app-height', h + 'px');
  }

  window.addEventListener('resize', setAppHeight);
  window.addEventListener('orientationchange', setAppHeight);
  window.addEventListener('pageshow', setAppHeight);
  window.addEventListener('focus', setAppHeight);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) setAppHeight();
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', setAppHeight);
    window.visualViewport.addEventListener('scroll', setAppHeight);
  }

  // イベントが発火しない環境でも取りこぼさないよう、常時ポーリングで補正し続ける
  setInterval(setAppHeight, 400);

  setAppHeight();
})();
