-- =====================================================================
-- 画像生成AIの月間使用回数カラム
-- =====================================================================

alter table public.profiles
  add column if not exists img_used integer not null default 0;

alter table public.profiles
  add column if not exists img_period_start date not null default current_date;
