-- コラージュ機能に画像ベースの「スタイル」（背景・フレーム画像＋アクセントカラー）を追加
-- Story Studioのtemplatesテーブルをtype='collage'として流用する

alter table templates drop constraint templates_type_check;
alter table templates add constraint templates_type_check
  check (type in ('story', 'feed', 'carousel', 'reel_cover', 'collage'));

alter table templates add column if not exists is_active boolean not null default true;

drop policy if exists "templates admin write" on templates;
create policy "templates admin write" on templates for all using (is_admin()) with check (is_admin());
