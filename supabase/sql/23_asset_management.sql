-- 素材シート（Sprite Sheet）方式への移行: 管理者権限・素材シート管理・assets拡張・RLS

-- ===== 1. 管理者権限 =====
alter table profiles add column if not exists is_admin boolean not null default false;

create or replace function is_admin() returns boolean
language sql stable as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false)
$$;

-- ===== 2. カテゴリにStorageフォルダ用slugを追加 =====
alter table categories add column if not exists slug text;
update categories set slug = case name
  when '花' then 'flowers' when '葉' then 'leaves' when 'フレーム' then 'frames'
  when '背景' then 'backgrounds' when 'ワンポイント' then 'one_points' when '線' then 'lines'
  when 'リボン' then 'ribbons' when 'アイコン' then 'icons' when 'スタンプ' then 'stamps'
  when '図形' then 'shapes' else slug end
where slug is null;
alter table categories alter column slug set not null;
alter table categories add constraint categories_slug_unique unique (slug);

-- ===== 3. 素材シート（アップロード履歴・archive参照） =====
create table if not exists asset_sheets (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references categories(id),
  original_filename text not null,
  archive_storage_path text not null,
  grid_cols int,
  grid_rows int,
  status text not null default 'uploaded' check (status in ('uploaded', 'processing', 'done', 'failed')),
  detected_count int,
  error_message text,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
alter table asset_sheets enable row level security;
drop policy if exists "asset_sheets admin all" on asset_sheets;
create policy "asset_sheets admin all" on asset_sheets for all using (is_admin()) with check (is_admin());

-- ===== 4. assetsテーブルの拡張 =====
alter table assets rename column file_url to storage_url;
alter table assets add column if not exists thumbnail_url text;
alter table assets add column if not exists is_active boolean not null default true;
alter table assets add column if not exists updated_at timestamptz not null default now();
alter table assets add column if not exists sheet_id uuid references asset_sheets(id) on delete set null;
alter table assets add column if not exists crop_x int;
alter table assets add column if not exists crop_y int;
alter table assets add column if not exists crop_w int;
alter table assets add column if not exists crop_h int;
alter table assets add column if not exists popularity int not null default 0;
alter table assets add column if not exists usage_count int not null default 0;
alter table assets add column if not exists ai_score numeric;

create extension if not exists moddatetime;
drop trigger if exists assets_set_updated_at on assets;
create trigger assets_set_updated_at before update on assets
  for each row execute function moddatetime(updated_at);

create index if not exists assets_sheet_id_idx on assets (sheet_id);
create index if not exists assets_is_active_idx on assets (is_active);

-- ===== 5. RLS: 管理者による書き込み許可 =====
drop policy if exists "categories admin write" on categories;
create policy "categories admin write" on categories for insert with check (is_admin());
drop policy if exists "categories admin update" on categories;
create policy "categories admin update" on categories for update using (is_admin()) with check (is_admin());
drop policy if exists "categories admin delete" on categories;
create policy "categories admin delete" on categories for delete using (is_admin());

drop policy if exists "tags admin write" on tags;
create policy "tags admin write" on tags for insert with check (is_admin());
drop policy if exists "tags admin update" on tags;
create policy "tags admin update" on tags for update using (is_admin()) with check (is_admin());
drop policy if exists "tags admin delete" on tags;
create policy "tags admin delete" on tags for delete using (is_admin());

drop policy if exists "assets admin write" on assets;
create policy "assets admin write" on assets for all using (is_admin()) with check (is_admin());

drop policy if exists "asset_tags admin write" on asset_tags;
create policy "asset_tags admin write" on asset_tags for all using (is_admin()) with check (is_admin());

-- ===== 6. Storage: 管理者アップロード許可（story-assetsバケットを流用） =====
drop policy if exists "story-assets admin upload" on storage.objects;
create policy "story-assets admin upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'story-assets' and is_admin());
drop policy if exists "story-assets admin manage" on storage.objects;
create policy "story-assets admin manage" on storage.objects for update to authenticated
  using (bucket_id = 'story-assets' and is_admin());
drop policy if exists "story-assets admin delete" on storage.objects;
create policy "story-assets admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'story-assets' and is_admin());
