-- Oklahoma COPO import file. The file itself is computed on demand from a
-- finished Oklahoma report (single or combined) plus these lookup tables, so a
-- scheduled report is ready to download as soon as it finishes.

-- Every COPO code the Tax Commission's portal accepts (CSV-BaseCopos).
create table public.ok_copos (
  code text primary key check (code ~ '^\d{4}$'),
  name text
);

-- Cleaned city name -> COPO codes. Multi-county cities have several; aliases
-- are typos and variants saved when an operator confirms them.
create table public.ok_city_copos (
  city text primary key,
  copos text[] not null check (cardinality(copos) > 0),
  alias boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- 5-digit zip -> county.
create table public.ok_zip_counties (
  zip text primary key check (zip ~ '^\d{5}$'),
  county text not null
);

-- Unincorporated towns (no city COPO) -> county. County tax only.
create table public.ok_town_counties (
  town text primary key,
  county text not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- One month's operator decisions that shouldn't become permanent: a rejected
-- fuzzy match, a sale left out of the file, a county-only sale accepted as is.
create table public.filing_overrides (
  id uuid primary key default gen_random_uuid(),
  state text not null,
  report_id uuid references public.reports (id) on delete cascade,
  group_id uuid references public.report_groups (id) on delete cascade,
  kind text not null check (kind in ('reject', 'skip', 'accept')),
  value text not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check ((report_id is null) <> (group_id is null))
);

create unique index filing_overrides_unique
  on public.filing_overrides (state, coalesce(report_id, group_id), kind, value);

alter table public.ok_copos enable row level security;
alter table public.ok_city_copos enable row level security;
alter table public.ok_zip_counties enable row level security;
alter table public.ok_town_counties enable row level security;
alter table public.filing_overrides enable row level security;

revoke all on public.ok_copos, public.ok_city_copos, public.ok_zip_counties,
  public.ok_town_counties, public.filing_overrides from anon, authenticated;
grant all on public.ok_copos, public.ok_city_copos, public.ok_zip_counties,
  public.ok_town_counties, public.filing_overrides to service_role;
