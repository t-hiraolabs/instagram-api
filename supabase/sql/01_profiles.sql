-- =====================================================================
-- ① 土台: ユーザーごとの「プラン」と「AI使用回数」を記録する profiles テーブル
--    無料/有料の機能分け（AI回数・予約件数・くりかえし投稿）の基礎になる
--    Supabase ダッシュボード → SQL Editor に貼り付けて Run するだけ
-- =====================================================================

-- 1) profiles テーブル（auth.users と1対1）
create table if not exists public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  plan            text not null default 'free' check (plan in ('free', 'pro')),
  ai_used         integer not null default 0,            -- 今の期間に使ったAI回数
  ai_period_start date not null default current_date,    -- AI回数の集計開始日（毎月リセット用）
  created_at      timestamptz not null default now()
);

-- 2) RLS（行レベルセキュリティ）を有効化
alter table public.profiles enable row level security;

-- 3) 自分のプロフィールだけ「読める」ようにする
--    （アプリで「残り回数」や現在のプランを表示するため）
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile"
  on public.profiles for select
  using (auth.uid() = id);

--    ※ あえて UPDATE ポリシーは付けない。
--      プラン変更やAI回数の加算は Edge 関数（service role）だけが行う。
--      → ユーザーが勝手に自分を 'pro' にしたり回数をリセットできない。

-- 4) 新規ユーザー登録時に、自動で profiles の行を作るトリガー
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 5) すでに登録済みのユーザー分も profiles を作っておく
insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;

-- =====================================================================
-- 【メモ】自分のアカウントを手動で Pro にしてテストしたいとき:
--   update public.profiles set plan = 'pro' where id = '（自分のユーザーID）';
-- ユーザーIDは Supabase の Authentication → Users で確認できます。
-- =====================================================================
