-- 素材機能の全廃。
-- Story Studioは「素材の組み合わせ」から「完成テンプレート方式」（layer_defaultsに画像URLを
-- 直接埋め込む）に作り直したため、assets/asset_sheets/categories/asset_tagsテーブルは不要になった。
-- 削除前にDBを確認済み: templates(type='story')は0件、assets/asset_sheets/categoriesは全て
-- 動作確認用のダミーデータのみで、実データの移行は不要。

-- favoritesのtarget_type制約から'asset'を除外
alter table favorites drop constraint if exists favorites_target_type_check;
alter table favorites add constraint favorites_target_type_check check (target_type in ('template'));

-- story-assetsバケットの管理者アップロード用ポリシー（素材シートアップロード専用だった）を削除
drop policy if exists "story-assets admin upload" on storage.objects;
drop policy if exists "story-assets admin manage" on storage.objects;
drop policy if exists "story-assets admin delete" on storage.objects;

-- 素材関連テーブルを完全削除（依存関係の順序: asset_tags → assets → asset_sheets → categories）
drop table if exists asset_tags;
drop table if exists assets;
drop table if exists asset_sheets;
drop table if exists categories;
