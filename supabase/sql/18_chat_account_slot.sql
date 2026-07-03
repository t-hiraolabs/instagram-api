-- =====================================================================
-- チャットの会話をInstagramアカウント（スロット1/2）ごとに分ける
-- =====================================================================

alter table public.chat_conversations
  add column if not exists account_slot smallint not null default 1;

create index if not exists chat_conversations_user_slot_updated
  on public.chat_conversations (user_id, account_slot, updated_at desc);
