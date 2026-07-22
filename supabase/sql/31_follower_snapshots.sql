-- 分析タブの「フォロワー推移グラフ」用。Instagram側は長期のフォロワー推移を
-- 安定して返さないアカウントも多いため、アプリ側で毎日の値を自前で蓄積し、
-- それをグラフの元データにする（分析タブを開くたびに当日分をupsert）。
create table if not exists public.follower_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ig_user_id text not null,
  snapshot_date date not null default current_date,
  followers_count integer not null,
  media_count integer,
  created_at timestamptz not null default now(),
  unique (ig_user_id, snapshot_date)
);

create index if not exists follower_snapshots_ig_user_id_idx
  on public.follower_snapshots (ig_user_id, snapshot_date);

alter table public.follower_snapshots enable row level security;

create policy "select own follower_snapshots"
  on public.follower_snapshots for select
  using (auth.uid() = user_id);

create policy "insert own follower_snapshots"
  on public.follower_snapshots for insert
  with check (auth.uid() = user_id);

create policy "update own follower_snapshots"
  on public.follower_snapshots for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "delete own follower_snapshots"
  on public.follower_snapshots for delete
  using (auth.uid() = user_id);
