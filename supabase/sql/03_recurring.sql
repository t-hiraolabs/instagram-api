-- =====================================================================
-- ④ くりかえし投稿（Pro限定）
--    scheduled_posts に「くりかえし設定」列を追加し、
--    くりかえしはProプラン限定にする。
--    Supabase ダッシュボード → SQL Editor に貼り付けて Run するだけ
-- =====================================================================

-- 1) くりかえし設定の列を追加
--    'none'=くりかえしなし / 'daily'=毎日 / 'weekly'=毎週 /
--    'monthly'=毎月 / 'weekdays'=平日のみ(月〜金)
alter table public.scheduled_posts
  add column if not exists repeat text not null default 'none'
  check (repeat in ('none', 'daily', 'weekly', 'monthly', 'weekdays'));

-- 2) 予約の制限ルールを更新（既存の関数を作り直す）
--    ・無料: 未投稿の予約は2件まで
--    ・くりかえし投稿: Proプラン限定
create or replace function public.enforce_schedule_limit()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  user_plan     text;
  pending_count integer;
begin
  -- プランを取得（無ければ free 扱い）
  select plan into user_plan from public.profiles where id = NEW.user_id;
  if user_plan is null then
    user_plan := 'free';
  end if;

  -- くりかえし投稿は Pro 限定
  if NEW.repeat is distinct from 'none' and user_plan <> 'pro' then
    raise exception 'くりかえし投稿はProプラン限定です。Proにアップグレードすると、毎日・毎週・毎月などの自動くりかえし投稿が使えます。';
  end if;

  -- 未投稿（pending）の予約だけ件数制限の対象
  if NEW.status is distinct from 'pending' then
    return NEW;
  end if;

  -- 無料は未投稿の予約2件まで（Proは無制限）
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

-- トリガーは既存のものをそのまま使う（02で作成済み）。
-- 念のため貼り直し:
drop trigger if exists trg_enforce_schedule_limit on public.scheduled_posts;
create trigger trg_enforce_schedule_limit
  before insert on public.scheduled_posts
  for each row execute function public.enforce_schedule_limit();
