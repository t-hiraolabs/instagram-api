# あとでやる設定作業（PC推奨）

新しく追加した機能を有効化するために必要な、Supabase側の手作業のまとめです。
（アプリ側コードは main にデプロイ済み。以下が済むと機能が動きます）

---

## 1. Supabase SQL Editor で実行するSQL

未実行のものを順に実行してください（`if not exists` 付きなので再実行しても安全）。

### ① タグ・場所（ユーザータグ / 商品タグ / 場所ID）
`supabase/sql/12_post_tags.sql`
```sql
alter table public.scheduled_posts
  add column if not exists user_tags    text[],
  add column if not exists product_tags text[],
  add column if not exists location_id  text;
```

### ② 画像生成の使用回数
`supabase/sql/13_image_usage.sql`
```sql
alter table public.profiles
  add column if not exists img_used integer not null default 0;
alter table public.profiles
  add column if not exists img_period_start date not null default current_date;
```

### ③ チャット利用量（トークン管理）
`supabase/sql/14_chat_usage.sql`
```sql
alter table public.profiles
  add column if not exists chat_used integer not null default 0;
alter table public.profiles
  add column if not exists chat_period_start date not null default current_date;
```

### （未実行なら）ブランド分析の裏カウント
`supabase/sql/11_brand_ai_usage.sql`
```sql
alter table public.profiles
  add column if not exists brand_ai_used integer not null default 0;
alter table public.profiles
  add column if not exists brand_ai_period_start date not null default current_date;
```

---

## 2. Supabase の環境変数（Edge Functions → Secrets）

- **`OPENAI_API_KEY`** … OpenAIのAPIキー（画像生成 gpt-image-1 用）
  - ※ `ANTHROPIC_API_KEY` は既存のはず。無ければ併せて設定。

---

## 3. Edge Function の再デプロイ

コードを更新したので、以下を再デプロイ：

- **`claude`** … チャット会話（トークン%管理）対応
- **`generate-image`** … 新規（画像生成・複数枚・残枚数）
- **`publish-now`** … ユーザータグ / 商品タグ / 場所ID 対応
- **`publish-scheduled`** … 同上（予約投稿）

---

## 4. 動作確認

- ホーム →「🎨 AIで画像を作る」→ 会話 → 「画像を生成」→ 生成 → 投稿へ
- 投稿作成 →「タグ・場所」→ タグ付けして投稿
- ヘッダーに「会話 残り○%」「画像 残り○枚」が出る

---

## メモ：上限値（コードで調整可）
- AI生成：free 5 / pro 50 / business 300（`supabase/functions/claude` LIMITS）
- 画像生成：ビジネス限定（free 0 / pro 0 / business 60）（`generate-image` IMG_LIMITS）
- チャット（トークン/月）：free 5万 / pro 50万 / business 150万（`claude` CHAT_TOKEN_LIMITS）
- ブランド分析：free 3 / pro・business 10（`claude` BRAND_LIMITS）
