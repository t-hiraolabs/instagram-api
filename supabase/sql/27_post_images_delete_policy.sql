-- post-imagesバケットにDELETEポリシーが存在せず、コラージュの個人用テンプレート削除時に
-- 背景画像を消そうとしても常に失敗していたため追加する。
-- 既存のINSERTポリシーと同じ粒度（bucket_id一致のみ、パスによる所有者チェックなし）で揃える。
drop policy if exists "post-images delete" on storage.objects;
create policy "post-images delete" on storage.objects for delete to authenticated
  using (bucket_id = 'post-images');
