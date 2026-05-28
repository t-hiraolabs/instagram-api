# InstaAI - Instagram AI投稿生成アプリ

Instagram のフィード投稿・ストーリーをAIで自動生成するReact Native (Expo) アプリです。

## 技術スタック

| カテゴリ | 技術 |
|---|---|
| フレームワーク | React Native + Expo |
| 言語 | TypeScript |
| ナビゲーション | React Navigation v6 |
| 状態管理 | Zustand |
| AI生成 | Anthropic Claude API |
| SNS連携 | Instagram Graph API |
| HTTPクライアント | Axios |
| サーバーキャッシュ | TanStack Query |

## 機能

- ✨ **AI投稿生成** — テーマ・トーンを選ぶだけでキャプション＋ハッシュタグを自動生成
- 📖 **ストーリー生成** — お知らせ・アンケート・プロモなどタイプ別にAI生成
- 📅 **予約投稿管理** — 投稿のスケジュール管理・一覧表示
- 👤 **プロフィール** — Instagramアカウント連携・プラン管理

## セットアップ

### 1. 依存関係インストール

```bash
npm install
```

### 2. 環境変数設定

```bash
cp .env.example .env
# .env を編集してAPIキーを設定
```

### 3. APIキーの取得

#### Anthropic API Key
1. https://console.anthropic.com にアクセス
2. API Keys → Create Key
3. `.env` の `EXPO_PUBLIC_ANTHROPIC_API_KEY` に設定

#### Instagram Graph API
1. https://developers.facebook.com にアクセス
2. アプリ作成 → Instagram Graph API を有効化
3. Instagram Business/Creator アカウントを連携
4. アクセストークンを取得

> ⚠️ **セキュリティ注意**: 本番環境ではAPIキーをクライアントに持たせず、バックエンドサーバー経由でリクエストしてください。

### 4. アプリ起動

```bash
# Expo Go アプリで確認
npx expo start

# iOSシミュレーター
npx expo start --ios

# Androidエミュレーター
npx expo start --android
```

## ディレクトリ構成

```
src/
├── screens/          # 各画面
│   ├── HomeScreen.tsx
│   ├── GenerateScreen.tsx   # AI投稿生成
│   ├── StoryScreen.tsx      # ストーリー生成
│   ├── ScheduleScreen.tsx   # 予約投稿
│   └── ProfileScreen.tsx
├── services/
│   ├── aiService.ts         # Claude API呼び出し
│   └── instagramService.ts  # Instagram Graph API
├── store/
│   └── appStore.ts          # Zustand グローバル状態
├── navigation/
│   └── RootNavigator.tsx
└── utils/
    └── theme.ts             # デザイントークン
```

## 今後の実装予定

- [ ] Instagram OAuth ログイン
- [ ] 画像アップロード（S3連携）
- [ ] リール動画生成
- [ ] アナリティクス画面
- [ ] ブランドトーン学習機能
- [ ] Push通知（投稿リマインダー）
- [ ] バックエンドAPI（Supabase or Firebase）
