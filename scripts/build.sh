#!/bin/sh
npx expo export --platform web
cp web/service-worker.js dist/service-worker.js
cp assets/icon.png dist/icon.png
cp web/manifest.json dist/manifest.json
cp web/privacy.html dist/privacy.html
sed -i 's/<title>.*<\/title>/<title>AImark アイマーク<\/title>/' dist/index.html
# ズーム（ピンチ／ダブルタップ拡大）を無効化する viewport に置き換え
sed -i 's|<meta name="viewport"[^>]*>|<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no, viewport-fit=cover">|' dist/index.html
sed -i 's%</head>%<link rel="manifest" href="/manifest.json"><link rel="apple-touch-icon" href="/icon.png"><meta name="apple-mobile-web-app-title" content="AImark"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="theme-color" content="#833AB4"><style>html,body{touch-action:pan-x pan-y;-ms-touch-action:pan-x pan-y;background:#0A0A0A}</style><script>document.addEventListener("gesturestart",function(e){e.preventDefault()});document.addEventListener("gesturechange",function(e){e.preventDefault()});var _lt=0;document.addEventListener("touchend",function(e){var n=Date.now();if(n-_lt<=300){e.preventDefault()}_lt=n},{passive:false});document.addEventListener("wheel",function(e){if(e.ctrlKey)e.preventDefault()},{passive:false});</script></head>%' dist/index.html
