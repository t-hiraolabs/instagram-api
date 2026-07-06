create table if not exists public.ig_first_analysis (
  ig_user_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  username text,
  captured_at timestamptz not null default now(),
  followers_count integer,
  media_count integer,
  avg_likes numeric,
  avg_comments numeric,
  engagement_rate numeric
);

alter table public.ig_first_analysis enable row level security;

create policy "select own ig_first_analysis"
  on public.ig_first_analysis for select
  using (auth.uid() = user_id);

create policy "insert own ig_first_analysis"
  on public.ig_first_analysis for insert
  with check (auth.uid() = user_id);
