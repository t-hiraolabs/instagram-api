-- ユーザーが自分専用に保存できるコラージュテンプレート（他ユーザーには公開しない）。
-- owner_user_idがnullの行は従来通り管理者が作成した全ユーザー向けテンプレート。

alter table templates add column if not exists owner_user_id uuid references auth.users(id) on delete cascade;
create index if not exists templates_owner_user_id_idx on templates(owner_user_id);

-- SELECT: 管理者テンプレート（owner_user_id無し）・自分のテンプレート・管理者本人のみ閲覧可
drop policy if exists "templates_select" on templates;
create policy "templates_select" on templates for select using (
  owner_user_id is null
  or owner_user_id = auth.uid()
  or is_admin()
);

-- 一般ユーザーは type='collage' かつ owner_user_id=自分 の行のみ作成・更新・削除できる
-- （管理者向けの全操作は既存の "templates admin write" ポリシーでカバーされる）
drop policy if exists "templates_own_insert" on templates;
create policy "templates_own_insert" on templates for insert to authenticated
  with check (type = 'collage' and owner_user_id = auth.uid());

drop policy if exists "templates_own_update" on templates;
create policy "templates_own_update" on templates for update to authenticated
  using (type = 'collage' and owner_user_id = auth.uid())
  with check (type = 'collage' and owner_user_id = auth.uid());

drop policy if exists "templates_own_delete" on templates;
create policy "templates_own_delete" on templates for delete to authenticated
  using (type = 'collage' and owner_user_id = auth.uid());
