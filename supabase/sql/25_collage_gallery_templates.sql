-- コラージュの「完成テンプレート」対応: テンプレート検索用のタグ列を追加。
-- レイアウト参照(layoutId)・装飾画像(decorations)・テキストレイヤー(textLayers)は
-- 既存のjsonb列 templates.layer_defaults に任意フィールドとして追加するため、
-- DDL変更は不要（アプリ側の型定義はsrc/services/collageStyleService.tsを参照）。
alter table templates add column if not exists tags text[] not null default '{}';
create index if not exists templates_tags_gin on templates using gin (tags);
