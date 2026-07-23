# Meta アプリ審査（App Review）準備メモ — InstaAI

このアプリを**一般公開**して、自分以外のユーザーがInstagramを連携できるようにするには、
Meta（Facebook）の **App Review（アプリ審査）** で各権限の承認が必要です。
（自分の連携アカウント＝アプリの管理者/テスターなら、審査前でも動作します）

---

## 1. アプリ概要（審査フォームの「アプリの説明」に貼る用）

**日本語**
InstaAIは、日本の小規模事業者（飲食店・美容室・バー・カフェなど）向けのInstagram運用支援アプリです。
AIがキャプションを作成し、フィード／ストーリー／リールの投稿・予約投稿・自動投稿を行い、
投稿の反応（フォロワー数・いいね・コメント・リーチ）を分析して表示します。

**English (審査は英語推奨)**
InstaAI helps small business owners in Japan (restaurants, salons, bars, cafés) manage their
Instagram presence. It generates captions with AI, publishes and schedules Feed / Story / Reel
posts on the user's behalf, and shows analytics (followers, likes, comments, reach) so owners
can understand how their posts perform.

---

## 2. リクエストする権限と用途（各権限ごとに用途説明＋録画が必要）

> ⚠️ 使っていない権限は要求しないこと。未使用権限の要求は却下理由になります。
> （`manage_messages` / `manage_comments` は機能が無いため削除済み）

### ① instagram_business_basic
- **用途**: 連携したアカウントのプロフィール（ユーザー名・フォロワー数・投稿数・プロフィール画像）と、
  投稿一覧（いいね数・コメント数を含む）を読み取り、ホーム画面と「分析」タブに表示する。
- **English**: Read the connected account's profile (username, followers, media count) and media
  list (including like/comment counts) to display on the Home and Analytics screens.

### ② instagram_business_content_publish
- **用途**: ユーザーが作成・予約した投稿を、本人の代わりにInstagramへ公開する
  （フィード画像／カルーセル、ストーリー、リール）。アプリの中心機能。
- **English**: Publish Feed (single/carousel), Story, and Reel content that the user created or
  scheduled, on the user's behalf. This is the core feature of the app.

### ③ instagram_business_manage_insights
- **用途**: 「分析」タブで投稿のリーチ（見られた人数）など、インサイト指標を取得して表示する。
- **English**: Retrieve media insights (e.g. reach) to display performance analytics on the
  Analytics screen.

---

## 3. 審査担当者向け テスト手順（フォームの「Test instructions」に貼る）

> Meta審査ではテスト用ログイン情報を求められます。アプリのテスト用メール/パスワードと、
> Instagram連携用のテスト用ビジネスアカウントを用意して記載します。

1. Open https://instagram-api-alpha.vercel.app/
2. Sign in with the provided test email / password.
3. Go to the **「プロフィール」(Profile)** tab → tap **「Instagram連携」(Connect Instagram)** →
   log in with the provided Instagram **Business/Creator** test account and approve permissions.
4. **Publish (content_publish)**: Go to **「投稿」(Post)** tab → 「フィード」 →
   choose a photo → write or AI-generate a caption → tap **「今すぐ投稿する」(Post now)**.
   The post appears on the connected Instagram account.
5. **Scheduling**: 「予約投稿」(Schedule) tab → 「＋追加」 → set a future date → 「予約する」.
6. **Insights (manage_insights) + basic**: Go to the **「分析」(Analytics)** tab.
   It shows followers, average likes/comments, engagement rate, and a ranking of top posts by
   likes (with reach where available).

---

## 4. 録画（スクリーンキャスト）チェックリスト

審査では**画面録画**で各権限の使用を示す必要があります。1本の動画で以下を順に映す：

- [ ] ログイン（アプリ）
- [ ] プロフィール画面からInstagramビジネスアカウントを連携（権限同意画面まで映す）
- [ ] ① basic: ホーム/分析にユーザー名・フォロワー数・投稿が表示される様子
- [ ] ② content_publish: 写真選択 → キャプション作成 → 「今すぐ投稿」→ 実際にIGに反映される様子
- [ ] ③ manage_insights: 分析タブでリーチ等が表示される様子
- [ ] 画面に表示されるアプリ名がMetaに登録したアプリ名と一致していること

### 録画シナリオ（このまま読み上げながら操作すればOK）

準備: テスト用のログイン情報（アプリのメール/パスワード）と、Instagramビジネス/クリエイターの
テストアカウントを用意してから撮影を始める。1本の動画に全部つなげて撮る（つなぎ直し不要）。

1. `https://instagram-api-alpha.vercel.app/` を開く
2. テスト用メール/パスワードでログイン
3. 下タブ「プロフィール」をタップ
4. 「連携する」ボタンをタップ → Instagramのログイン画面が開く →
   テスト用Instagramビジネス/クリエイターアカウントでログイン → 権限の同意画面まで映す → 同意する
5. 下タブ「ホーム」に戻る → ユーザー名・フォロワー数・投稿一覧が表示される様子を数秒映す
   （**① instagram_business_basic** の使用箇所）
6. 下タブ「分析」をタップ → フォロワー数・平均いいね・エンゲージメント率・人気投稿ランキングが
   表示される様子を数秒映す（**③ instagram_business_manage_insights** の使用箇所。リーチが
   表示される投稿があればそこも指させるとなお良い）
7. 下タブ「投稿」をタップ → 「フィード」を選ぶ → 写真を1枚選ぶ →
   キャプションを書く（またはAI生成ボタンで自動生成）→「今すぐ投稿する」をタップ →
   確認ダイアログで「OK」→ 投稿完了の表示まで映す（**② instagram_business_content_publish**
   の使用箇所）
8. （任意・録画してもよい）実際にInstagram側（アプリまたはブラウザ）を開き、
   手順7で投稿した内容が反映されていることを見せる（審査担当者が実際にIG側で確認できるとよりスムーズ）

---

## 5. 公開前に必要なその他（Metaの必須要件）

- [ ] **プライバシーポリシー** の公開URL（アプリで取得するデータと用途、第三者提供の有無）
- [x] **データ削除手順**（プロフィール画面のアカウント切替メニュー →「データを削除する」。
      連携解除とは別に、そのInstagramアカウントに紐づくサーバー側データ
      〈ブランド設定・チャット履歴・分析キャッシュ・ストーリー下書き〉を完全削除できる）
- [ ] **利用規約** の公開URL（任意だが推奨）
- [ ] アプリアイコン・正式名称の設定
- [ ] ビジネス認証（Business Verification）が求められる場合あり

> プライバシーポリシーはこのリポジトリで別途用意します（次のステップ候補）。

---

## 6. 現状ステータス

| 項目 | 状態 |
|------|------|
| 使う権限のみ要求（basic / content_publish / manage_insights） | ✅ 対応済み |
| 投稿（feed/carousel/story/reel）機能 | ✅ 実装済み |
| 分析（basic + insights） | ✅ 実装済み |
| データ削除導線 | ✅ 実装済み（`supabase/sql/30_account_data_deletion_policies.sql`の適用が別途必要） |
| テスト用ログイン情報の用意 | ⬜ 未（審査申請時に用意） |
| 録画 | ⬜ 未 |
| プライバシーポリシー | ⬜ 未（要作成） |
| ビジネス認証 | ⬜ 未確認 |
