-- 「ストーリー作成」の旧・絵文字ステッカー機能（STICKER_CATEGORIES固定リスト）を廃止し、
-- 代わりにユーザーが入力したテキスト（フォント・色・サイズ込み）を自分専用の
-- 「マイスタンプ」として保存し、あとからテンプレートとして再利用できる機能を追加する。
-- 保存できる件数はプランごとに上限がある（src/utils/plans.ts の maxStoryStamps 参照:
-- フリー3・Pro10・ビジネス30）。上限チェックはアプリ側（保存前に件数を数える）で行う。
create table if not exists story_stamps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  text text not null,
  font text not null default 'gothic',
  color text not null default '#FFFFFF',
  size integer not null default 64,
  align text,
  created_at timestamptz not null default now()
);

create index if not exists story_stamps_user_id_idx on story_stamps(user_id);

alter table story_stamps enable row level security;

drop policy if exists "story_stamps_select" on story_stamps;
create policy "story_stamps_select" on story_stamps for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "story_stamps_insert" on story_stamps;
create policy "story_stamps_insert" on story_stamps for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "story_stamps_delete" on story_stamps;
create policy "story_stamps_delete" on story_stamps for delete to authenticated
  using (user_id = auth.uid());
