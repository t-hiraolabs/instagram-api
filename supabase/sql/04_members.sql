-- =====================================================================
-- 「本日の出勤」用：メンバー登録テーブル
--   名前＋写真URLを保存。各ユーザーは自分のメンバーだけ操作できる。
--   Supabase ダッシュボード → SQL Editor に貼り付けて Run
-- =====================================================================

create table if not exists public.members (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name       text not null default '',
  photo_url  text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.members enable row level security;

drop policy if exists "members select own" on public.members;
create policy "members select own" on public.members
  for select using (auth.uid() = user_id);

drop policy if exists "members insert own" on public.members;
create policy "members insert own" on public.members
  for insert with check (auth.uid() = user_id);

drop policy if exists "members update own" on public.members;
create policy "members update own" on public.members
  for update using (auth.uid() = user_id);

drop policy if exists "members delete own" on public.members;
create policy "members delete own" on public.members
  for delete using (auth.uid() = user_id);
