create table if not exists public.parlay_markets (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  stage text not null,
  market_key text not null,
  label text not null,
  market_type text not null check (market_type in ('over_under', 'boolean')),
  line numeric(6, 1),
  display_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (match_id, market_key)
);

create table if not exists public.parlay_options (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.parlay_markets(id) on delete cascade,
  option_key text not null,
  label text not null,
  odds integer,
  points numeric(6, 1) not null default 0,
  is_correct boolean,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (market_id, option_key)
);

create table if not exists public.parlay_predictions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  manager_id uuid not null references public.managers(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  market_id uuid not null references public.parlay_markets(id) on delete cascade,
  option_id uuid not null references public.parlay_options(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'void')),
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, manager_id, match_id, market_id)
);

alter table public.parlay_markets enable row level security;
alter table public.parlay_options enable row level security;
alter table public.parlay_predictions enable row level security;

drop policy if exists "Service role manages parlay markets" on public.parlay_markets;
create policy "Service role manages parlay markets"
  on public.parlay_markets
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "Service role manages parlay options" on public.parlay_options;
create policy "Service role manages parlay options"
  on public.parlay_options
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "Service role manages parlay predictions" on public.parlay_predictions;
create policy "Service role manages parlay predictions"
  on public.parlay_predictions
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

comment on table public.parlay_markets is
  'Final and third-place slip questions such as total goals, scorer yes/no, ET/Pens, and cards.';
comment on table public.parlay_options is
  'Selectable outcomes for a parlay market. Commissioner marks is_correct after the match.';
comment on table public.parlay_predictions is
  'Manager selections for final and third-place parlay slips.';
