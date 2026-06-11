-- =====================================================================
-- ③ 予約2件制限: 無料プランは「未投稿（pending）の予約」を2件までに制限
--    Proプランは無制限。データベース側で止めるので画面改ざんでもすり抜けられない。
--    Supabase ダッシュボード → SQL Editor に貼り付けて Run するだけ
-- =====================================================================

create or replace function public.enforce_schedule_limit()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  user_plan     text;
  pending_count integer;
begin
  -- 未投稿（pending）の予約だけを制限の対象にする
  if NEW.status is distinct from 'pending' then
    return NEW;
  end if;

  -- このユーザーのプランを取得（無ければ free 扱い）
  select plan into user_plan from public.profiles where id = NEW.user_id;
  if user_plan is null then
    user_plan := 'free';
  end if;

  -- Proは無制限なのでチェックしない
  if user_plan = 'free' then
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

drop trigger if exists trg_enforce_schedule_limit on public.scheduled_posts;
create trigger trg_enforce_schedule_limit
  before insert on public.scheduled_posts
  for each row execute function public.enforce_schedule_limit();
