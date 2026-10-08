-- Stripe Sales Tax Extractor: initial schema.
--
-- Every table has RLS enabled with no policies, so the anon/authenticated
-- roles can read nothing directly. All access goes through the Next.js server,
-- which checks the signed-in user and then uses the service role.

create extension if not exists pgcrypto;

-- Users ---------------------------------------------------------------------

create type public.app_role as enum ('super_admin', 'member');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  full_name text,
  role public.app_role not null default 'member',
  disabled boolean not null default false,
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Only one super admin may exist.
create unique index profiles_single_super_admin
  on public.profiles (role) where role = 'super_admin';

-- Stripe accounts -----------------------------------------------------------

create table public.stripe_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- Restricted read-only key, AES-256-GCM encrypted by the app server.
  -- Format: base64(iv).base64(auth_tag).base64(ciphertext)
  encrypted_key text not null,
  key_hint text not null,            -- e.g. "rk_live_…a1b2"
  stripe_account_id text,            -- acct_… returned by Stripe when the key was verified
  livemode boolean,
  timezone text not null default 'America/Chicago',
  archived boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Reports (extraction jobs) -------------------------------------------------

create type public.report_status as enum ('queued', 'processing', 'ready', 'failed', 'canceled');

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  stripe_account_id uuid not null references public.stripe_accounts (id) on delete cascade,
  state text not null,               -- two-letter code, or 'ALL'
  period_type text not null check (period_type in ('month', 'custom')),
  period_start timestamptz not null, -- inclusive
  period_end timestamptz not null,   -- exclusive
  period_label text not null,
  timezone text not null,

  status public.report_status not null default 'queued',
  -- Background job bookkeeping
  cursor text,                       -- Stripe starting_after for the next page
  scanned_count integer not null default 0,
  scanned_through timestamptz,       -- created time of the oldest charge scanned so far
  locked_until timestamptz,
  attempts integer not null default 0,   -- failed worker attempts
  error text,

  -- Results (filled in when the report completes)
  gross_amount bigint,               -- cents
  refunded_amount bigint,
  net_amount bigint,
  transaction_count integer,
  refunded_count integer,
  currency text,

  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create index reports_created_at_idx on public.reports (created_at desc);
create index reports_pending_idx on public.reports (status, locked_until)
  where status in ('queued', 'processing');

create table public.report_rows (
  report_id uuid not null references public.reports (id) on delete cascade,
  charge_id text not null,
  created timestamptz not null,
  state text,
  state_source text,                 -- shipping | billing | customer | customer_shipping
  amount bigint not null,            -- cents
  amount_refunded bigint not null,
  currency text not null,
  customer_id text,
  customer_name text,
  customer_email text,
  description text,
  city text,
  postal_code text,
  country text,
  payment_intent text,
  invoice text,
  primary key (report_id, charge_id)
);

create index report_rows_report_created_idx on public.report_rows (report_id, created);

-- Download history ----------------------------------------------------------

create table public.downloads (
  id uuid primary key default gen_random_uuid(),
  report_id uuid references public.reports (id) on delete set null,
  user_id uuid references public.profiles (id) on delete set null,
  variant text not null,
  filename text not null,
  row_count integer,
  created_at timestamptz not null default now()
);

create index downloads_created_at_idx on public.downloads (created_at desc);

-- RLS: on everywhere, no policies -------------------------------------------

alter table public.profiles enable row level security;
alter table public.stripe_accounts enable row level security;
alter table public.reports enable row level security;
alter table public.report_rows enable row level security;
alter table public.downloads enable row level security;

revoke all on public.profiles, public.stripe_accounts, public.reports,
  public.report_rows, public.downloads from anon, authenticated;

-- Job queue helpers ---------------------------------------------------------

-- Atomically lease the next report that needs work. A lease lasts long enough
-- for one worker invocation; if the worker dies, the lease expires and the
-- next invocation resumes from the saved cursor.
create or replace function public.claim_report(lease_seconds integer default 120)
returns setof public.reports
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_id uuid;
begin
  select id into claimed_id
  from public.reports
  where status in ('queued', 'processing')
    and (locked_until is null or locked_until < now())
  order by created_at
  limit 1
  for update skip locked;

  if claimed_id is null then
    return;
  end if;

  return query
  update public.reports
  set status = 'processing',
      locked_until = now() + make_interval(secs => lease_seconds),
      started_at = coalesce(started_at, now())
  where id = claimed_id
  returning *;
end;
$$;

-- Compute the totals for a report from its stored rows and mark it ready.
create or replace function public.finalize_report(p_report_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.reports r
  set status = 'ready',
      locked_until = null,
      cursor = null,
      completed_at = now(),
      error = null,
      gross_amount = coalesce(t.gross, 0),
      refunded_amount = coalesce(t.refunded, 0),
      net_amount = coalesce(t.gross, 0) - coalesce(t.refunded, 0),
      transaction_count = coalesce(t.cnt, 0),
      refunded_count = coalesce(t.refunded_cnt, 0),
      currency = t.currency
  from (
    select sum(amount) as gross,
           sum(amount_refunded) as refunded,
           count(*) as cnt,
           count(*) filter (where amount_refunded > 0) as refunded_cnt,
           min(currency) as currency
    from public.report_rows
    where report_id = p_report_id
  ) t
  where r.id = p_report_id;
$$;

-- Per-state totals for a report (used for 'ALL' state reports and summaries).
create or replace function public.report_state_summary(p_report_id uuid)
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
  where report_id = p_report_id
  group by 1
  order by 1;
$$;

revoke execute on function public.claim_report(integer) from public, anon, authenticated;
revoke execute on function public.finalize_report(uuid) from public, anon, authenticated;
revoke execute on function public.report_state_summary(uuid) from public, anon, authenticated;
grant execute on function public.claim_report(integer) to service_role;
grant execute on function public.finalize_report(uuid) to service_role;
grant execute on function public.report_state_summary(uuid) to service_role;

grant all on public.profiles, public.stripe_accounts, public.reports,
  public.report_rows, public.downloads to service_role;
