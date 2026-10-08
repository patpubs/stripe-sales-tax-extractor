-- Combined reports: one request across several Stripe accounts. Each account
-- still gets its own report row (so the worker is unchanged); a report_group
-- ties them together for display and a single combined CSV.

create table public.report_groups (
  id uuid primary key default gen_random_uuid(),
  state text not null,
  period_label text not null,
  schedule_id uuid references public.report_schedules (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.report_groups enable row level security;
revoke all on public.report_groups from anon, authenticated;
grant all on public.report_groups to service_role;

alter table public.reports
  add column group_id uuid references public.report_groups (id) on delete cascade;
create index reports_group_idx on public.reports (group_id) where group_id is not null;

alter table public.downloads
  add column group_id uuid references public.report_groups (id) on delete set null;

-- Schedules can cover several accounts. stripe_account_id is kept (nullable,
-- unused) so this migration stays additive.
alter table public.report_schedules
  add column stripe_account_ids uuid[] not null,
  alter column stripe_account_id drop not null,
  add constraint report_schedules_accounts_nonempty check (cardinality(stripe_account_ids) > 0);

-- A scheduled combined run sets schedule_id on its group, not on the
-- per-account reports, so reports_schedule_period_idx still means "one report
-- per single-account schedule per month".

create or replace function public.enqueue_due_schedules()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  tz text;
  n_accounts integer;
  local_now timestamp;
  month_start timestamp;
  p_start timestamptz;
  g uuid;
  queued integer := 0;
begin
  for s in
    select * from public.report_schedules where enabled for update skip locked
  loop
    -- The first live account's timezone decides when the schedule is due.
    select a.timezone into tz
    from public.stripe_accounts a
    where a.id = any (s.stripe_account_ids) and not a.archived
    order by array_position(s.stripe_account_ids, a.id)
    limit 1;
    if tz is null then
      continue;
    end if;

    local_now := now() at time zone tz;
    if extract(day from local_now) < s.day_of_month then
      continue;
    end if;

    month_start := date_trunc('month', local_now);
    p_start := (month_start - interval '1 month') at time zone tz;
    if s.last_period_start is not null and s.last_period_start >= p_start then
      continue;
    end if;

    select count(*) into n_accounts
    from public.stripe_accounts a
    where a.id = any (s.stripe_account_ids) and not a.archived;

    g := null;
    if n_accounts > 1 then
      insert into public.report_groups (state, period_label, schedule_id, created_by)
      values (s.state, to_char(month_start - interval '1 month', 'FMMonth YYYY'), s.id, s.created_by)
      returning id into g;
    end if;

    -- Each account's period uses its own timezone.
    insert into public.reports
      (stripe_account_id, state, period_type, period_start, period_end, period_label, timezone, created_by, schedule_id, group_id)
    select a.id, s.state, 'month',
           (month_start - interval '1 month') at time zone a.timezone,
           month_start at time zone a.timezone,
           to_char(month_start - interval '1 month', 'FMMonth YYYY'),
           a.timezone, s.created_by, case when g is null then s.id end, g
    from public.stripe_accounts a
    where a.id = any (s.stripe_account_ids) and not a.archived
    on conflict (schedule_id, period_start) where schedule_id is not null do nothing;

    update public.report_schedules
    set last_period_start = p_start, last_run_at = now()
    where id = s.id;

    queued := queued + 1;
  end loop;
  return queued;
end;
$$;

-- Per-state totals across one or more reports.
create or replace function public.reports_state_summary(p_report_ids uuid[])
returns table (state text, transaction_count bigint, gross bigint, refunded bigint, net bigint, refunded_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(state, '??') as state,
         count(*),
         sum(amount)::bigint,
         sum(amount_refunded)::bigint,
         (sum(amount) - sum(amount_refunded))::bigint,
         count(*) filter (where amount_refunded > 0)
  from public.report_rows
  where report_id = any (p_report_ids)
  group by 1
  order by 1;
$$;

revoke execute on function public.enqueue_due_schedules() from public, anon, authenticated;
revoke execute on function public.reports_state_summary(uuid[]) from public, anon, authenticated;
grant execute on function public.enqueue_due_schedules() to service_role;
grant execute on function public.reports_state_summary(uuid[]) to service_role;
