-- =====================================================================
-- ブランド設定テーブル（Instagramアカウント単位で保存）
-- 既存テーブルが無い環境でも単体で実行できるようにテーブル作成から行う。
-- ブランド設定は (user_id, ig_user_id) で一意 = アカウントごとに保存。
-- =====================================================================

create table if not exists public.brand_settings (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  ig_user_id      text,
  slot            smallint,
  brand_name      text not null default '',
  industry        text not null default '',
  account_type    text not null default 'personal',
  atmosphere      text not null default '',
  target_audience text not null default '',
  tone            text not null default '明るい・ポジティブ',
  use_top_posts_insight boolean not null default false,
  updated_at      timestamptz not null default now()
);

-- 既存テーブルがある場合に備えて列追加・制約調整（無ければ no-op）
alter table public.brand_settings add column if not exists ig_user_id text;
alter table public.brand_settings alter column slot drop not null;
alter table public.brand_settings drop constraint if exists brand_settings_user_id_slot_key;

-- Instagramアカウント単位の一意制約。
-- ※ 部分インデックスは upsert(ON CONFLICT) の競合解決に使えないため、
--   通常のユニーク制約にする（NULL同士は別物として扱われるので旧データも共存可）。
drop index if exists brand_settings_user_ig_unique;
alter table public.brand_settings drop constraint if exists brand_settings_user_ig_key;
alter table public.brand_settings add constraint brand_settings_user_ig_key unique (user_id, ig_user_id);

-- RLS: 本人のみ自分の設定を操作可能
alter table public.brand_settings enable row level security;

drop policy if exists "users manage own brand_settings" on public.brand_settings;
create policy "users manage own brand_settings"
  on public.brand_settings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
