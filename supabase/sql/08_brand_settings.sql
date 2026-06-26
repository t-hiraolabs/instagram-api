-- =====================================================================
-- ブランド設定をデバイス間で同期するための brand_settings テーブル
-- slot 1 = メインアカウント、slot 2 = サブアカウント
-- =====================================================================

create table if not exists public.brand_settings (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  slot            smallint not null default 1 check (slot in (1, 2)),
  brand_name      text not null default '',
  industry        text not null default '',
  account_type    text not null default 'personal',
  atmosphere      text not null default '',
  target_audience text not null default '',
  tone            text not null default '明るい・ポジティブ',
  use_top_posts_insight boolean not null default false,
  updated_at      timestamptz not null default now(),
  unique (user_id, slot)
);

alter table public.brand_settings enable row level security;

drop policy if exists "users manage own brand_settings" on public.brand_settings;
create policy "users manage own brand_settings"
  on public.brand_settings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
