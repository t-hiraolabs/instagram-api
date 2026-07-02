-- =====================================================================
-- AIアシスタントの会話履歴（ユーザーごとに保存・復元）
-- =====================================================================

create table if not exists public.chat_messages (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       text not null,          -- user / assistant / image
  content    text not null default '', -- テキスト or 画像URL
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_user_created
  on public.chat_messages (user_id, created_at);

alter table public.chat_messages enable row level security;

drop policy if exists "users manage own chat_messages" on public.chat_messages;
create policy "users manage own chat_messages"
  on public.chat_messages for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
