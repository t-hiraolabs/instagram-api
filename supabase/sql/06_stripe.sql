-- =====================================================================
-- ⑥ Stripe決済: profiles に Stripe の顧客ID・サブスクIDを保存する列を追加
--    Webアプリでの課金（Pro ¥980/月）と、解約時のプラン戻しに使う。
--    Supabase ダッシュボード → SQL Editor に貼り付けて Run するだけ
-- =====================================================================

alter table public.profiles
  add column if not exists stripe_customer_id     text,
  add column if not exists stripe_subscription_id text;

-- 顧客IDから素早く引けるように（Webhookでの逆引き用）
create index if not exists idx_profiles_stripe_customer
  on public.profiles (stripe_customer_id);
