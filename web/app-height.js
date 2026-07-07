// PWA(standalone)でInstagramの認証画面など外部サイトへ移動して戻ってくると、
// window.innerHeight/visualViewport.heightが一瞬古い値のままになり、
// 画面下部に隙間ができることがある。resize/focus/visibilitychange/pageshowの
// たびに複数回（間隔を空けて）再計算することで、OS側のレイアウト確定を待つ。
(function () {
  function setAppHeight() {
    var h = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
    document.documentElement.style.setProperty('--app-height', h + 'px');
  }

  function setAppHeightWithRetries() {
    setAppHeight();
    [50, 150, 300, 600, 1000].forEach(function (delay) {
      setTimeout(setAppHeight, delay);
    });
  }

  window.addEventListener('resize', setAppHeight);
  window.addEventListener('orientationchange', setAppHeightWithRetries);
  window.addEventListener('pageshow', setAppHeightWithRetries);
  window.addEventListener('focus', setAppHeightWithRetries);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) setAppHeightWithRetries();
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', setAppHeight);
    window.visualViewport.addEventListener('scroll', setAppHeight);
  }

  setAppHeightWithRetries();
})();
