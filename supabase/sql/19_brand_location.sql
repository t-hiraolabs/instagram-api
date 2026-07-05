alter table public.brand_settings
  add column if not exists location text not null default '';
