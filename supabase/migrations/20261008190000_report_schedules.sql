-- Monthly report schedules: on the chosen day each month, queue a report for
-- the previous full month (in the Stripe account's timezone). The existing
-- worker cron picks the queued report up within a minute.

create table public.report_schedules (
  id uuid primary key default gen_random_uuid(),
  stripe_account_id uuid not null references public.stripe_accounts (id) on delete cascade,
  state text not null,               -- two-letter code, or 'ALL'
  day_of_month smallint not null default 1 check (day_of_month between 1 and 28),
  enabled boolean not null default true,
  -- Start of the last month a report was queued for, so each month runs once.
  last_period_start timestamptz,
  last_run_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.report_schedules enable row level security;
revoke all on public.report_schedules from anon, authenticated;
grant all on public.report_schedules to service_role;

alter table public.reports
  add column schedule_id uuid references public.report_schedules (id) on delete set null;

create unique index reports_schedule_period_idx
  on public.reports (schedule_id, period_start) where schedule_id is not null;

-- Queue a report for every enabled schedule that is due. Safe to call often.
create or replace function public.enqueue_due_schedules()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  local_now timestamp;
  month_start timestamp;
  p_start timestamptz;
  p_end timestamptz;
  queued integer := 0;
begin
  for s in
    select sch.*, a.timezone
    from public.report_schedules sch
    join public.stripe_accounts a on a.id = sch.stripe_account_id
    where sch.enabled and not a.archived
    for update of sch skip locked
  loop
    local_now := now() at time zone s.timezone;
    if extract(day from local_now) < s.day_of_month then
      continue;
    end if;

    month_start := date_trunc('month', local_now);
    -- Local midnights converted to UTC instants; handles DST like the app does.
    p_start := (month_start - interval '1 month') at time zone s.timezone;
    p_end := month_start at time zone s.timezone;

    if s.last_period_start is not null and s.last_period_start >= p_start then
      continue;
    end if;

    insert into public.reports
      (stripe_account_id, state, period_type, period_start, period_end, period_label, timezone, created_by, schedule_id)
    values
      (s.stripe_account_id, s.state, 'month', p_start, p_end,
       to_char(month_start - interval '1 month', 'FMMonth YYYY'), s.timezone, s.created_by, s.id)
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
