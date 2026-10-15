-- Quarterly reports. A quarter is stored on reports as a 'custom' period
-- labeled "Q3 2026" (reports.period_type only allows month|custom, and this
-- migration stays additive). Schedules gain a frequency.

alter table public.report_schedules
  add column frequency text not null default 'monthly' check (frequency in ('monthly', 'quarterly'));

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
  local_start timestamp;    -- period start, local time
  local_end timestamp;      -- period end (exclusive), local time
  label text;
  quarterly boolean;
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
    quarterly := s.frequency = 'quarterly';

    if quarterly then
      -- Due on the chosen day of the first month after the quarter ends.
      if (extract(month from local_now)::int - 1) % 3 = 0 and extract(day from local_now) < s.day_of_month then
        continue;
      end if;
      local_end := date_trunc('quarter', local_now);
      local_start := local_end - interval '3 months';
      label := to_char(local_start, '"Q"Q YYYY');
    else
      if extract(day from local_now) < s.day_of_month then
        continue;
      end if;
      local_end := date_trunc('month', local_now);
      local_start := local_end - interval '1 month';
      label := to_char(local_start, 'FMMonth YYYY');
    end if;

    p_start := local_start at time zone tz;
    if s.last_period_start is not null and s.last_period_start >= p_start then
      continue;
    end if;

    select count(*) into n_accounts
    from public.stripe_accounts a
    where a.id = any (s.stripe_account_ids) and not a.archived;

    g := null;
    if n_accounts > 1 then
      insert into public.report_groups (state, period_label, schedule_id, created_by)
      values (s.state, label, s.id, s.created_by)
      returning id into g;
    end if;

    -- Each account's period uses its own timezone. In a group the schedule
    -- link lives on the group (see 20261008200000_combined_reports.sql).
    insert into public.reports
      (stripe_account_id, state, period_type, period_start, period_end, period_label, timezone, created_by, schedule_id, group_id)
    select a.id, s.state, case when quarterly then 'custom' else 'month' end,
           local_start at time zone a.timezone,
           local_end at time zone a.timezone,
           label, a.timezone, s.created_by, case when g is null then s.id end, g
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

revoke execute on function public.enqueue_due_schedules() from public, anon, authenticated;
grant execute on function public.enqueue_due_schedules() to service_role;
