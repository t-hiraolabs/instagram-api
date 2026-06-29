-- =====================================================================
-- ブランド設定を「スロット番号」ではなく「Instagramアカウント単位」で
-- 保存できるようにする。ig_user_id を追加し、(user_id, ig_user_id) で一意に。
-- これにより、スロットに別のアカウントを連携し直しても設定が混ざらない。
-- =====================================================================

alter table public.brand_settings
  add column if not exists ig_user_id text;

-- slot は後方互換のため残すが、NOT NULL 制約・slot の一意制約は外す
alter table public.brand_settings
  alter column slot drop not null;

alter table public.brand_settings
  drop constraint if exists brand_settings_user_id_slot_key;

-- Instagramアカウント単位の一意制約
create unique index if not exists brand_settings_user_ig_unique
  on public.brand_settings (user_id, ig_user_id)
  where ig_user_id is not null;
