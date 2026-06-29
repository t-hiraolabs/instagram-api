#!/bin/sh
npx expo export --platform web
cp web/service-worker.js dist/service-worker.js
cp assets/icon.png dist/icon.png
cp web/manifest.json dist/manifest.json
cp web/privacy.html dist/privacy.html
sed -i 's/<title>.*<\/title>/<title>AImark アイマーク<\/title>/' dist/index.html
sed -i 's|</head>|<link rel="manifest" href="/manifest.json"><link rel="apple-touch-icon" href="/icon.png"><meta name="apple-mobile-web-app-title" content="AImark"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="theme-color" content="#833AB4"></head>|' dist/index.html
