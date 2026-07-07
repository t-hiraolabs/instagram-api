-- 会話をアカウントスロット（1/2/3）ではなく、実際のInstagramアカウントID単位で管理する。
-- スロットに紐づけていると、連携解除→別アカウントを同じスロットに連携したときに
-- 前のアカウントの会話が引き継がれてしまうため。
alter table public.chat_conversations
  add column if not exists ig_user_id text;

create index if not exists chat_conversations_user_iguser_updated
  on public.chat_conversations (user_id, ig_user_id, updated_at desc);
