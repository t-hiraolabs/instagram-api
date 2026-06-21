-- =====================================================================
-- ⑤ 下書き保存: status に 'draft' を許可する
--    作りかけの投稿を「下書き」として保存できるようにする。
--    下書き(status='draft')は自動投稿（cron）の対象外。
--    Supabase ダッシュボード → SQL Editor に貼り付けて Run するだけ
-- =====================================================================

-- status カラムに CHECK 制約があれば一旦すべて外す（'draft' を弾かれないように）
do $$
declare
  c text;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.scheduled_posts'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.scheduled_posts drop constraint %I', c);
  end loop;
end $$;

-- 4種類の status を許可し直す
alter table public.scheduled_posts
  add constraint scheduled_posts_status_check
  check (status in ('pending', 'published', 'failed', 'draft'));
