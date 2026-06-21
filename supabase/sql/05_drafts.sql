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

-- ---------------------------------------------------------------------
-- 下書き(draft) → 予約(pending) への変換でも、無料プランの「予約2件まで」を効かせる。
-- 既存の enforce_schedule_limit は INSERT 時だけ発火するため、
-- 「📅で下書きを予約に変える(UPDATE)」と制限をすり抜けられてしまう。それを塞ぐ。
-- ---------------------------------------------------------------------
create or replace function public.enforce_schedule_limit_update()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  user_plan     text;
  pending_count integer;
begin
  -- 「pending へ変化した」ときだけチェック。
  -- すでに pending の投稿を編集しただけ（OLD も pending）の場合は対象外。
  if NEW.status is distinct from 'pending' then
    return NEW;
  end if;
  if OLD.status is not distinct from 'pending' then
    return NEW;
  end if;

  select plan into user_plan from public.profiles where id = NEW.user_id;
  if user_plan is null then
    user_plan := 'free';
  end if;

  if user_plan = 'free' then
    -- この行はまだ OLD(draft等)なので、自分自身はカウントに含まれない
    select count(*) into pending_count
    from public.scheduled_posts
    where user_id = NEW.user_id and status = 'pending';

    if pending_count >= 2 then
      raise exception '無料プランの予約は2件までです。1件投稿が完了すると、また予約できます。Proプランなら無制限です。';
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_enforce_schedule_limit_update on public.scheduled_posts;
create trigger trg_enforce_schedule_limit_update
  before update on public.scheduled_posts
  for each row execute function public.enforce_schedule_limit_update();
