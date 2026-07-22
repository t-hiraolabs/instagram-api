create table if not exists public.marketing_guide_cache (
  ig_user_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  week_key text not null,
  rank text not null,
  grade text not null,
  guide jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.marketing_guide_cache enable row level security;

create policy "select own marketing_guide_cache"
  on public.marketing_guide_cache for select
  using (auth.uid() = user_id);

create policy "insert own marketing_guide_cache"
  on public.marketing_guide_cache for insert
  with check (auth.uid() = user_id);

create policy "update own marketing_guide_cache"
  on public.marketing_guide_cache for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
