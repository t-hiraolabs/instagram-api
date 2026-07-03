-- =====================================================================
-- 複数の会話スレッド（Claude風）を保存する
-- =====================================================================

create table if not exists public.chat_conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  title      text not null default '新しい会話',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chat_conversations_user_updated
  on public.chat_conversations (user_id, updated_at desc);

alter table public.chat_conversations enable row level security;
drop policy if exists "users manage own chat_conversations" on public.chat_conversations;
create policy "users manage own chat_conversations"
  on public.chat_conversations for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- メッセージを会話に紐づける
alter table public.chat_messages
  add column if not exists conversation_id uuid references public.chat_conversations (id) on delete cascade;

create index if not exists chat_messages_conversation
  on public.chat_messages (conversation_id, created_at);
