-- =====================================================================
-- チャット会話の月間使用回数カラム（表示は % で管理）
-- =====================================================================

alter table public.profiles
  add column if not exists chat_used integer not null default 0;

alter table public.profiles
  add column if not exists chat_period_start date not null default current_date;
