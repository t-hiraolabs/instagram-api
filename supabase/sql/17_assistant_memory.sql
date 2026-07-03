-- =====================================================================
-- AIアシスタントに常に覚えさせる説明（事業・サービス内容など）
-- =====================================================================

alter table public.profiles
  add column if not exists assistant_memory text not null default '';
