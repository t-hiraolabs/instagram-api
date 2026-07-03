-- =====================================================================
-- ⑦ ビジネスプラン追加: profiles.plan に 'business' を許可する
--    無料 / Pro / ビジネス の3段階にする。
--    Supabase ダッシュボード → SQL Editor に貼り付けて Run するだけ
-- =====================================================================

-- plan の CHECK 制約があれば一旦すべて外す（'business' を弾かれないように）
do $$
declare
  c text;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%plan%'
  loop
    execute format('alter table public.profiles drop constraint %I', c);
  end loop;
end $$;

-- 3種類の plan を許可し直す
alter table public.profiles
  add constraint profiles_plan_check
  check (plan in ('free', 'pro', 'business'));
