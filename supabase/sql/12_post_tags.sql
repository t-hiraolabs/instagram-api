-- =====================================================================
-- 投稿のタグ・場所（ユーザータグ／商品タグ／場所ID）を保存するカラム
-- =====================================================================

alter table public.scheduled_posts
  add column if not exists user_tags    text[],
  add column if not exists product_tags text[],
  add column if not exists location_id  text;
