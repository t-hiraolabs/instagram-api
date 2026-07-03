-- =====================================================================
-- ブランド分析など「カウント対象外のAI呼び出し」用の裏の使用回数カラム。
-- 通常のAI生成回数(ai_used)とは別枠で管理し、不正利用を防ぐ隠れ上限に使う。
-- =====================================================================

alter table public.profiles
  add column if not exists brand_ai_used integer not null default 0;

alter table public.profiles
  add column if not exists brand_ai_period_start date not null default current_date;
