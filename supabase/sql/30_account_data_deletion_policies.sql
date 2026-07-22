-- ユーザーが「データを削除」操作でご自身のInstagramアカウントに紐づく
-- サーバー側データを消去できるようにするため、削除ポリシーが無かった
-- テーブルにdeleteポリシーを追加する（Meta App Reviewのデータ削除要件対応）。

drop policy if exists "delete own ig_first_analysis" on public.ig_first_analysis;
create policy "delete own ig_first_analysis"
  on public.ig_first_analysis for delete
  using (auth.uid() = user_id);

drop policy if exists "delete own marketing_guide_cache" on public.marketing_guide_cache;
create policy "delete own marketing_guide_cache"
  on public.marketing_guide_cache for delete
  using (auth.uid() = user_id);
