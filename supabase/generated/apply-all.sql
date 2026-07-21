-- ============================================================
-- supabase/migrations/0001_initial_schema.sql
-- ============================================================
create table groups (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  timezone text not null default 'America/New_York',
  lock_minutes_before_kickoff integer not null default 60,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table managers (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  manager_code text not null,
  display_name text not null,
  pin_hash text not null,
  role text not null default 'manager' check (role in ('manager', 'commissioner')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, manager_code),
  unique (group_id, display_name)
);

create table teams (
  id uuid primary key default gen_random_uuid(),
  fifa_code text unique,
  name text not null,
  short_name text,
  flag_code text
);

create table matches (
  id uuid primary key default gen_random_uuid(),
  external_match_id text unique,
  stage text not null,
  group_label text,
  team_a_id uuid references teams(id),
  team_b_id uuid references teams(id),
  kickoff_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'locked', 'live', 'finished', 'cancelled')),
  team_a_score integer,
  team_b_score integer,
  winner_team_id uuid references teams(id),
  length text check (length is null or length in ('90', 'ET', 'Pens')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table group_matches (
  group_id uuid not null references groups(id) on delete cascade,
  match_id uuid not null references matches(id) on delete cascade,
  primary key (group_id, match_id)
);

create table predictions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  manager_id uuid not null references managers(id) on delete cascade,
  match_id uuid not null references matches(id) on delete cascade,
  pick_type text not null check (pick_type in ('team_a', 'team_b', 'tie')),
  pick_team_id uuid references teams(id),
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text not null default 'active' check (status in ('active', 'inactive', 'void'))
);

create unique index predictions_one_active_pick
  on predictions (group_id, manager_id, match_id)
  where status = 'active';

create table prediction_audit (
  id uuid primary key default gen_random_uuid(),
  prediction_id uuid references predictions(id) on delete set null,
  group_id uuid not null references groups(id) on delete cascade,
  manager_id uuid not null references managers(id) on delete cascade,
  match_id uuid not null references matches(id) on delete cascade,
  old_pick_type text,
  old_pick_team_id uuid references teams(id),
  new_pick_type text,
  new_pick_team_id uuid references teams(id),
  changed_by uuid references managers(id),
  changed_at timestamptz not null default now(),
  reason text
);

create table odds_snapshots (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references matches(id) on delete cascade,
  source text not null,
  market text not null,
  raw_payload jsonb not null,
  captured_at timestamptz not null default now()
);

create table match_pick_values (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  points integer not null check (points between 1 and 9),
  source_odds_snapshot_id uuid references odds_snapshots(id),
  created_at timestamptz not null default now(),
  unique (match_id, team_id)
);

create table futures_pick_values (
  id uuid primary key default gen_random_uuid(),
  tournament text not null,
  team_id uuid not null references teams(id) on delete cascade,
  points integer not null check (points between 1 and 100),
  source text,
  raw_odds jsonb,
  created_at timestamptz not null default now(),
  unique (tournament, team_id)
);

create table scoring_events (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  manager_id uuid not null references managers(id) on delete cascade,
  source_type text not null,
  source_id uuid,
  points integer not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create view active_prediction_details as
select
  p.id as prediction_id,
  g.slug as group_slug,
  m.manager_code,
  m.display_name as manager_name,
  mt.external_match_id,
  mt.stage,
  mt.group_label,
  mt.kickoff_at,
  mt.status as match_status,
  ta.fifa_code as team_a_code,
  ta.name as team_a_name,
  tb.fifa_code as team_b_code,
  tb.name as team_b_name,
  p.pick_type,
  pt.fifa_code as pick_team_code,
  pt.name as pick_team_name,
  p.submitted_at,
  p.updated_at
from predictions p
join groups g on g.id = p.group_id
join managers m on m.id = p.manager_id
join matches mt on mt.id = p.match_id
left join teams ta on ta.id = mt.team_a_id
left join teams tb on tb.id = mt.team_b_id
left join teams pt on pt.id = p.pick_team_id
where p.status = 'active';

create view prediction_pulse_details as
select
  group_slug,
  external_match_id,
  stage,
  group_label,
  kickoff_at,
  team_a_code,
  team_a_name,
  team_b_code,
  team_b_name,
  count(*) filter (where pick_type = 'team_a') as team_a_picks,
  count(*) filter (where pick_type = 'tie') as tie_picks,
  count(*) filter (where pick_type = 'team_b') as team_b_picks,
  count(*) as total_picks,
  string_agg(manager_name, ', ' order by manager_name) filter (where pick_type = 'team_a') as team_a_managers,
  string_agg(manager_name, ', ' order by manager_name) filter (where pick_type = 'tie') as tie_managers,
  string_agg(manager_name, ', ' order by manager_name) filter (where pick_type = 'team_b') as team_b_managers
from active_prediction_details
group by
  group_slug,
  external_match_id,
  stage,
  group_label,
  kickoff_at,
  team_a_code,
  team_a_name,
  team_b_code,
  team_b_name;

-- ============================================================
-- supabase/migrations/0002_enable_rls.sql
-- ============================================================
alter table groups enable row level security;
alter table managers enable row level security;
alter table teams enable row level security;
alter table matches enable row level security;
alter table group_matches enable row level security;
alter table predictions enable row level security;
alter table prediction_audit enable row level security;
alter table odds_snapshots enable row level security;
alter table match_pick_values enable row level security;
alter table futures_pick_values enable row level security;
alter table scoring_events enable row level security;

-- No anon/authenticated policies yet.
-- The Next.js API uses the service role key server-side, which bypasses RLS.
-- Add narrow read policies later only for data that should be directly public.

-- ============================================================
-- supabase/migrations/0003_draft_scoring.sql
-- ============================================================
create table players (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams(id) on delete set null,
  external_player_id text,
  display_name text not null,
  position text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (display_name)
);

create table drafted_teams (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  manager_id uuid not null references managers(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  draft_slot integer,
  notes text,
  created_at timestamptz not null default now(),
  unique (group_id, manager_id, team_id)
);

create table drafted_players (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  manager_id uuid not null references managers(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  draft_slot integer,
  notes text,
  created_at timestamptz not null default now(),
  unique (group_id, manager_id, player_id)
);

create table player_stat_tallies (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  goals integer not null default 0 check (goals >= 0),
  assists integer not null default 0 check (assists >= 0),
  player_of_match integer not null default 0 check (player_of_match >= 0),
  updated_by uuid references managers(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (player_id)
);

create view drafted_team_details as
select
  dt.id as drafted_team_id,
  g.slug as group_slug,
  m.manager_code,
  m.display_name as manager_name,
  t.fifa_code as team_code,
  t.name as team_name,
  dt.draft_slot,
  dt.notes
from drafted_teams dt
join groups g on g.id = dt.group_id
join managers m on m.id = dt.manager_id
join teams t on t.id = dt.team_id;

create view drafted_player_details as
select
  dp.id as drafted_player_id,
  g.slug as group_slug,
  m.manager_code,
  m.display_name as manager_name,
  p.display_name as player_name,
  p.position,
  t.fifa_code as team_code,
  t.name as team_name,
  coalesce(pst.goals, 0) as goals,
  coalesce(pst.assists, 0) as assists,
  coalesce(pst.player_of_match, 0) as player_of_match,
  dp.draft_slot,
  dp.notes
from drafted_players dp
join groups g on g.id = dp.group_id
join managers m on m.id = dp.manager_id
join players p on p.id = dp.player_id
left join teams t on t.id = p.team_id
left join player_stat_tallies pst on pst.player_id = p.id;

alter table players enable row level security;
alter table drafted_teams enable row level security;
alter table drafted_players enable row level security;
alter table player_stat_tallies enable row level security;

-- ============================================================
-- supabase/migrations/0004_half_point_match_values.sql
-- ============================================================
alter table match_pick_values
  drop constraint if exists match_pick_values_points_check;

alter table match_pick_values
  alter column points type numeric(3,1) using points::numeric;

alter table match_pick_values
  add constraint match_pick_values_points_check check (points between 3 and 7);

-- ============================================================
-- supabase/migrations/0005_group_comments.sql
-- ============================================================
create table group_comments (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  manager_id uuid not null references managers(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 30),
  status text not null default 'active' check (status in ('active', 'hidden', 'deleted')),
  created_at timestamptz not null default now()
);

create index group_comments_group_created_idx
  on group_comments (group_id, created_at desc)
  where status = 'active';

alter table group_comments enable row level security;

-- ============================================================
-- supabase/migrations/0006_shorten_group_comments.sql
-- ============================================================
alter table group_comments
  drop constraint if exists group_comments_body_check;

alter table group_comments
  add constraint group_comments_body_check
  check (char_length(body) between 1 and 30);

-- ============================================================
-- supabase/migrations/0007_knockout_length_risk.sql
-- ============================================================
alter table predictions
  add column if not exists length_pick text
    check (length_pick is null or length_pick in ('ET', 'Pens'));

alter table prediction_audit
  add column if not exists old_length_pick text
    check (old_length_pick is null or old_length_pick in ('ET', 'Pens')),
  add column if not exists new_length_pick text
    check (new_length_pick is null or new_length_pick in ('ET', 'Pens'));

drop view if exists prediction_pulse_details;
drop view if exists active_prediction_details;

create or replace view active_prediction_details as
select
  p.id as prediction_id,
  g.slug as group_slug,
  m.manager_code,
  m.display_name as manager_name,
  mt.external_match_id,
  mt.stage,
  mt.group_label,
  mt.kickoff_at,
  mt.status as match_status,
  mt.length as match_length,
  ta.fifa_code as team_a_code,
  ta.name as team_a_name,
  tb.fifa_code as team_b_code,
  tb.name as team_b_name,
  p.pick_type,
  p.length_pick,
  pt.fifa_code as pick_team_code,
  pt.name as pick_team_name,
  p.submitted_at,
  p.updated_at
from predictions p
join groups g on g.id = p.group_id
join managers m on m.id = p.manager_id
join matches mt on mt.id = p.match_id
left join teams ta on ta.id = mt.team_a_id
left join teams tb on tb.id = mt.team_b_id
left join teams pt on pt.id = p.pick_team_id
where p.status = 'active';

create or replace view prediction_pulse_details as
select
  group_slug,
  external_match_id,
  stage,
  group_label,
  kickoff_at,
  team_a_code,
  team_a_name,
  team_b_code,
  team_b_name,
  count(*) filter (where pick_type = 'team_a') as team_a_picks,
  count(*) filter (where pick_type = 'tie') as tie_picks,
  count(*) filter (where pick_type = 'team_b') as team_b_picks,
  count(*) as total_picks,
  string_agg(manager_name, ', ' order by manager_name) filter (where pick_type = 'team_a') as team_a_managers,
  string_agg(manager_name, ', ' order by manager_name) filter (where pick_type = 'tie') as tie_managers,
  string_agg(manager_name, ', ' order by manager_name) filter (where pick_type = 'team_b') as team_b_managers,
  count(*) filter (where length_pick = 'ET') as et_risk_picks,
  count(*) filter (where length_pick = 'Pens') as pens_risk_picks,
  string_agg(manager_name, ', ' order by manager_name) filter (where length_pick = 'ET') as et_risk_managers,
  string_agg(manager_name, ', ' order by manager_name) filter (where length_pick = 'Pens') as pens_risk_managers
from active_prediction_details
group by
  group_slug,
  external_match_id,
  stage,
  group_label,
  kickoff_at,
  team_a_code,
  team_a_name,
  team_b_code,
  team_b_name;

-- ============================================================
-- supabase/migrations/0008_expand_match_pick_values.sql
-- ============================================================
alter table match_pick_values
  drop constraint if exists match_pick_values_points_check;

alter table match_pick_values
  add constraint match_pick_values_points_check check (points between 0 and 15);

-- ============================================================
-- supabase/migrations/0009_first_score_risk.sql
-- ============================================================
alter table matches
  add column if not exists first_score_team_id uuid references teams(id) on delete set null;

alter table predictions
  add column if not exists first_score_pick_team_id uuid references teams(id) on delete set null;

alter table prediction_audit
  add column if not exists old_first_score_pick_team_id uuid references teams(id) on delete set null,
  add column if not exists new_first_score_pick_team_id uuid references teams(id) on delete set null;

drop view if exists prediction_pulse_details;
drop view if exists active_prediction_details;

create or replace view active_prediction_details as
select
  p.id as prediction_id,
  g.slug as group_slug,
  m.manager_code,
  m.display_name as manager_name,
  mt.external_match_id,
  mt.stage,
  mt.group_label,
  mt.kickoff_at,
  mt.status as match_status,
  mt.length as match_length,
  mt.first_score_team_id,
  fst.fifa_code as first_score_team_code,
  fst.name as first_score_team_name,
  mt.team_a_id,
  ta.fifa_code as team_a_code,
  ta.name as team_a_name,
  mt.team_b_id,
  tb.fifa_code as team_b_code,
  tb.name as team_b_name,
  p.pick_type,
  p.length_pick,
  p.first_score_pick_team_id,
  fspt.fifa_code as first_score_pick_team_code,
  fspt.name as first_score_pick_team_name,
  pt.fifa_code as pick_team_code,
  pt.name as pick_team_name,
  p.submitted_at,
  p.updated_at
from predictions p
join groups g on g.id = p.group_id
join managers m on m.id = p.manager_id
join matches mt on mt.id = p.match_id
left join teams ta on ta.id = mt.team_a_id
left join teams tb on tb.id = mt.team_b_id
left join teams pt on pt.id = p.pick_team_id
left join teams fst on fst.id = mt.first_score_team_id
left join teams fspt on fspt.id = p.first_score_pick_team_id
where p.status = 'active';

create or replace view prediction_pulse_details as
select
  group_slug,
  external_match_id,
  stage,
  group_label,
  kickoff_at,
  team_a_id,
  team_a_code,
  team_a_name,
  team_b_id,
  team_b_code,
  team_b_name,
  first_score_team_id,
  first_score_team_code,
  first_score_team_name,
  count(*) filter (where pick_type = 'team_a') as team_a_picks,
  count(*) filter (where pick_type = 'tie') as tie_picks,
  count(*) filter (where pick_type = 'team_b') as team_b_picks,
  count(*) as total_picks,
  string_agg(manager_name, ', ' order by manager_name) filter (where pick_type = 'team_a') as team_a_managers,
  string_agg(manager_name, ', ' order by manager_name) filter (where pick_type = 'tie') as tie_managers,
  string_agg(manager_name, ', ' order by manager_name) filter (where pick_type = 'team_b') as team_b_managers,
  count(*) filter (where length_pick = 'ET') as et_risk_picks,
  count(*) filter (where length_pick = 'Pens') as pens_risk_picks,
  string_agg(manager_name, ', ' order by manager_name) filter (where length_pick = 'ET') as et_risk_managers,
  string_agg(manager_name, ', ' order by manager_name) filter (where length_pick = 'Pens') as pens_risk_managers,
  count(*) filter (where first_score_pick_team_id = team_a_id) as team_a_first_score_picks,
  count(*) filter (where first_score_pick_team_id = team_b_id) as team_b_first_score_picks,
  string_agg(manager_name, ', ' order by manager_name) filter (where first_score_pick_team_id = team_a_id) as team_a_first_score_managers,
  string_agg(manager_name, ', ' order by manager_name) filter (where first_score_pick_team_id = team_b_id) as team_b_first_score_managers
from active_prediction_details
group by
  group_slug,
  external_match_id,
  stage,
  group_label,
  kickoff_at,
  team_a_id,
  team_a_code,
  team_a_name,
  team_b_id,
  team_b_code,
  team_b_name,
  first_score_team_id,
  first_score_team_code,
  first_score_team_name;

-- ============================================================
-- supabase/migrations/0010_semifinal_future_picks.sql
-- ============================================================
create table if not exists future_pick_options (
  id uuid primary key default gen_random_uuid(),
  stage text not null,
  category text not null,
  option_kind text not null check (option_kind in ('team', 'player')),
  option_key text not null,
  label text not null,
  team_id uuid references teams(id) on delete set null,
  points numeric(6, 1) not null check (points >= 0 and points <= 100),
  sort_order integer not null default 0,
  is_winner boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (stage, category, option_key)
);

create table if not exists future_predictions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  manager_id uuid not null references managers(id) on delete cascade,
  stage text not null,
  category text not null,
  option_id uuid not null references future_pick_options(id) on delete restrict,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text not null default 'active' check (status in ('active', 'inactive', 'void')),
  unique (group_id, manager_id, stage, category)
);

create index if not exists future_predictions_group_stage_idx
  on future_predictions (group_id, stage, status);

alter table future_pick_options enable row level security;
alter table future_predictions enable row level security;

-- The Next.js API uses the service role key server-side, which bypasses RLS.
-- Keep these tables private from anon/authenticated clients for now.

-- ============================================================
-- supabase/migrations/0011_future_pick_elimination.sql
-- ============================================================
alter table future_pick_options
  add column if not exists is_eliminated boolean not null default false;

comment on column future_pick_options.is_eliminated is
  'Commissioner-controlled flag for future/locked-pick outcomes that are no longer possible but should remain visible historically.';

-- ============================================================
-- supabase/migrations/0012_final_parlay_slips.sql
-- ============================================================
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

-- ============================================================
-- supabase/migrations/0013_parlay_exact_score.sql
-- ============================================================
alter table public.parlay_markets
  add column if not exists points numeric(6, 1) not null default 0;

alter table public.parlay_predictions
  alter column option_id drop not null;

alter table public.parlay_predictions
  add column if not exists predicted_team_a_score integer,
  add column if not exists predicted_team_b_score integer;

alter table public.parlay_predictions
  drop constraint if exists parlay_predictions_option_or_score_check;

alter table public.parlay_predictions
  add constraint parlay_predictions_option_or_score_check
  check (
    option_id is not null
    or (
      predicted_team_a_score is not null
      and predicted_team_b_score is not null
      and predicted_team_a_score >= 0
      and predicted_team_b_score >= 0
    )
  );

alter table public.parlay_markets
  drop constraint if exists parlay_markets_market_type_check;

alter table public.parlay_markets
  add constraint parlay_markets_market_type_check
  check (market_type in ('over_under', 'boolean', 'exact_score'));

comment on column public.parlay_markets.points is
  'Market-level point value used when the market does not have fixed options, such as exact score.';
comment on column public.parlay_predictions.predicted_team_a_score is
  'Manager-entered exact score prediction for team A.';
comment on column public.parlay_predictions.predicted_team_b_score is
  'Manager-entered exact score prediction for team B.';

-- ============================================================
-- supabase/migrations/0014_tournament_complete_mode.sql
-- ============================================================
alter table public.groups
  add column if not exists tournament_complete boolean not null default false;

comment on column public.groups.tournament_complete is
  'Commissioner-controlled flag that switches a group page from live prediction mode to final tournament recap mode.';

-- ============================================================
-- supabase/seed-data/seed.sql
-- ============================================================
-- Generated by scripts/extract-workbook-seeds.py
-- PIN hashes are placeholders and must be set by the commissioner before real use.

insert into groups (slug, name, timezone, lock_minutes_before_kickoff) values ('squad', 'Squad', 'America/New_York', 60) on conflict (slug) do update set name = excluded.name, timezone = excluded.timezone, lock_minutes_before_kickoff = excluded.lock_minutes_before_kickoff;
insert into groups (slug, name, timezone, lock_minutes_before_kickoff) values ('tikur-abay', 'Tikur-Abay', 'America/New_York', 60) on conflict (slug) do update set name = excluded.name, timezone = excluded.timezone, lock_minutes_before_kickoff = excluded.lock_minutes_before_kickoff;
insert into groups (slug, name, timezone, lock_minutes_before_kickoff) values ('dagi-united', 'Dagi-United', 'America/New_York', 60) on conflict (slug) do update set name = excluded.name, timezone = excluded.timezone, lock_minutes_before_kickoff = excluded.lock_minutes_before_kickoff;

insert into teams (fifa_code, name, short_name, flag_code) values ('ALG', 'Algeria', 'Algeria', 'ALG') on conflict (fifa_code) do update set name = excluded.name, short_name = excluded.short_name, flag_code = excluded.flag_code;
insert into teams (fifa_code, name, short_name, flag_code) values ('ARG', 'Argentina', 'Argentina', 'ARG') on conflict (fifa_code) do update set name = excluded.name, short_name = excluded.short_name, flag_code = excluded.flag_code;
insert into teams (fifa_code, name, short_name, flag_code) values ('AUS', 'Australia', 'Australia', 'AUS') on conflict (fifa_code) do update set name = excluded.name, short_name = excluded.short_name, flag_code = excluded.flag_code;
insert into teams (fifa_code, name, short_name, flag_code) values ('AUT', 'Austria', 'Austria', 'AUT') on conflict (fifa_code) do update set name = excluded.name, short_name = excluded.short_name, flag_code = excluded.flag_code;
insert into teams (fifa_code, name, short_name, flag_code) values ('BEL', 'Belgium', 'Belgium', 'BEL') on conflict (fifa_code) do update set name = excluded.name, short_name = excluded.short_name, flag_code = excluded.flag_code;
insert into teams (fifa_code, name, short_name, flag_code) values ('BIH', 'Bosnia and Herzegovina', 'Bosnia and Herzegovina', 'BIH') on conflict (fifa_code) do update set name = excluded.name, short_name = excluded.short_name, flag_code = excluded.flag_code;
insert into teams (fifa_code, name, short_name, flag_code) values ('BRA', 'Brazil', 'Brazil', 'BRA') on conflict (fifa_code) do update set name = excluded.name, short_name = excluded.short_name, flag_code = excluded.flag_code;
insert into teams (fifa_code, name, short_name, flag_code) values ('CPV', 'Cabo Verde', 'Cabo Verde', 'CPV') on conflict (fifa_code) do update set name = excluded.name, short_name = excluded.short_name, flag_code = excluded.flag_code;
insert into teams (fifa_code, name, short_name, flag_code) values ('CAN', 'Canada', 'Canada', 'CAN') on conflict (fifa_code) do update set name = excluded.name, short_name = excluded.short_name, flag_code = excluded.flag_code;
insert into teams (fifa_code, name, short_name, flag_code) values ('COL', 'Colombia', 'Colombia', 'COL') on conflict (fifa_code) do update set name = excluded.name, short_name = excluded.short_name, flag_code = excluded.flag_code;
insert into teams (fifa_code, name, short_name, flag_code) values ('COD', 'Congo DR', 'Congo DR', 'COD') on conflict (fifa_code) do update set name = excluded.name, short_name = excluded.short_name, flag_code = excluded.flag_code;
insert into teams (fifa_code, name, short_name, flag_code) values ('CRO', 'Croatia', 'Croatia', 'CRO') on conflict (fifa_code) do update set name = excluded.name, short_name = excluded.short_name, flag_code = excluded.flag_code;
insert into teams (fifa_code, name, short_name, flag_code) values ('CUW', 'Curaçao', 'Curaçao', 'CUW') on conflict (fifa_code) do update set name = excluded.name, short_name = excluded.short_name, flag_code = excluded.flag_code;
insert into teams (fifa_code, name, short_name, flag_code) values ('CZE', 'Czechia', 'Czechia', 'CZE') on conflict (fifa_code) do update set name = excluded.name, short_name = excluded.short_name, flag_code = excluded.flag_code;
insert into teams (fifa_code, name, short_name, flag_code) values ('CIV', 'Côte d''Ivoire', 'Côte d''Ivoire', 'CIV') on conflict (fifa_code) do update set name = excluded.name, short_name = excluded.short_name, flag_code = excluded.flag_code;
insert into teams (fifa_code, name, short_name, flag_code) values ('ECU', 'Ecuador', 'Ecuador', 'ECU') on conflict (fifa_code) do update set name = excluded.name, short_name = excluded.short_name, flag_code = excluded.flag_code;
insert into teams (fifa_code, name, short_name, flag_code) values ('EGY', 'Egypt', 'Egypt', 'EGY') on conflict (fifa_code) do update set name = excluded.name, short_name = excluded.short_name, flag_code = excluded.flag_code;
insert into teams (fifa_code, name, short_name, flag_code) values ('ENG', 'England', 'England', 'ENG') on conflict (fifa_code) do update set name = excluded.name, short_name = excluded.short_name, flag_code = excluded.flag_code;
insert into teams (fifa_code, name, short_name, flag_code) values ('FRA', 'France', 'France', 'FRA') on conflict (fifa_code) do update set name = excluded.name, short_name = excluded.short_name, flag_code = excluded.flag_code;
insert into teams (fifa_code, name, short_name, flag_code) values ('GER', 'Germany', 'Germany', 'GER') on conflict (fifa_code) do update set name = excluded.name, short_name = excluded.short_name, flag_code = excluded.flag_code;
insert into teams (fifa_code, name, short_name, flag_code) values ('GHA', 'Ghana', 'Ghana', 'GHA') on conflict (fifa_code) do update set name = excluded.name, short_name = excluded.short_name, flag_code = excluded.flag_code;
insert into teams (fifa_code, name, short_name, flag_code) values ('HAI', 'Haiti', 'Haiti', 'HAI') on conflict (fifa_code) do update set name = excluded.name, short_name = excluded.short_name, flag_code = excluded.flag_code;
insert into teams (fifa_code, name, short_name, flag_code) values ('IRN', 'IR Iran', 'IR Iran', 'IRN') on conflict (fifa_code) do update set name = excluded.name, short_name = excluded.short_name, flag_code = excluded.flag_code;
insert into teams (fifa_code, name, short_name, flag_code) values ('IRQ', 'Iraq', 'Iraq', 'IRQ') on conflict (fifa_code) do update set name = excluded.name, short_name = excluded.short_name, flag_code = excluded.flag_code;
insert into teams (fifa_code, name, short_name, flag_code) values ('JPN', 'Japan', 'Japan', 'JPN') on conflict (fifa_code) do update set name = excluded.name, short_name = excluded.short_name, flag_code = excluded.flag_code;
insert into teams (fifa_code, name, short_name, flag_code) values ('JOR', 'Jordan', 'Jordan', 'JOR') on conflict (fifa_code) do update set name = excluded.name, short_name = excluded.short_name, flag_code = excluded.flag_code;
insert into teams (fifa_code, name, short_name, flag_code) values ('KOR', 'Korea Republic', 'Korea Republic', 'KOR') on conflict (fifa_code) do update set name = excluded.name, short_name = excluded.short_name, flag_code = excluded.flag_code;
insert into teams (fifa_code, name, short_name, flag_code) values ('MEX', 'Mexico', 'Mexico', 'MEX') on conflict (fifa_code) do update set name = excluded.name, short_name = excluded.short_name, flag_code = excluded.flag_code;
insert into teams (fifa_code, name, short_name, flag_code) values ('MAR', 'Morocco', 'Morocco', 'MAR') on conflict (fifa_code) do update set name = excluded.name, short_name = excluded.short_name, flag_code = excluded.flag_code;
insert into teams (fifa_code, name, short_name, flag_code) values ('NED', 'Netherlands', 'Netherlands', 'NED') on conflict (fifa_code) do update set name = excluded.name, short_name = excluded.short_name, flag_code = excluded.flag_code;
insert into teams (fifa_code, name, short_name, flag_code) values ('NZL', 'New Zealand', 'New Zealand', 'NZL') on conflict (fifa_code) do update set name = excluded.name, short_name = excluded.short_name, flag_code = excluded.flag_code;
insert into teams (fifa_code, name, short_name, flag_code) values ('NOR', 'Norway', 'Norway', 'NOR') on conflict (fifa_code) do update set name = excluded.name, short_name = excluded.short_name, flag_code = excluded.flag_code;
insert into teams (fifa_code, name, short_name, flag_code) values ('PAN', 'Panama', 'Panama', 'PAN') on conflict (fifa_code) do update set name = excluded.name, short_name = excluded.short_name, flag_code = excluded.flag_code;
insert into teams (fifa_code, name, short_name, flag_code) values ('PAR', 'Paraguay', 'Paraguay', 'PAR') on conflict (fifa_code) do update set name = excluded.name, short_name = excluded.short_name, flag_code = excluded.flag_code;
insert into teams (fifa_code, name, short_name, flag_code) values ('POR', 'Portugal', 'Portugal', 'POR') on conflict (fifa_code) do update set name = excluded.name, short_name = excluded.short_name, flag_code = excluded.flag_code;
insert into teams (fifa_code, name, short_name, flag_code) values ('QAT', 'Qatar', 'Qatar', 'QAT') on conflict (fifa_code) do update set name = excluded.name, short_name = excluded.short_name, flag_code = excluded.flag_code;
insert into teams (fifa_code, name, short_name, flag_code) values ('KSA', 'Saudi Arabia', 'Saudi Arabia', 'KSA') on conflict (fifa_code) do update set name = excluded.name, short_name = excluded.short_name, flag_code = excluded.flag_code;
insert into teams (fifa_code, name, short_name, flag_code) values ('SCO', 'Scotland', 'Scotland', 'SCO') on conflict (fifa_code) do update set name = excluded.name, short_name = excluded.short_name, flag_code = excluded.flag_code;
insert into teams (fifa_code, name, short_name, flag_code) values ('SEN', 'Senegal', 'Senegal', 'SEN') on conflict (fifa_code) do update set name = excluded.name, short_name = excluded.short_name, flag_code = excluded.flag_code;
insert into teams (fifa_code, name, short_name, flag_code) values ('RSA', 'South Africa', 'South Africa', 'RSA') on conflict (fifa_code) do update set name = excluded.name, short_name = excluded.short_name, flag_code = excluded.flag_code;
insert into teams (fifa_code, name, short_name, flag_code) values ('ESP', 'Spain', 'Spain', 'ESP') on conflict (fifa_code) do update set name = excluded.name, short_name = excluded.short_name, flag_code = excluded.flag_code;
insert into teams (fifa_code, name, short_name, flag_code) values ('SWE', 'Sweden', 'Sweden', 'SWE') on conflict (fifa_code) do update set name = excluded.name, short_name = excluded.short_name, flag_code = excluded.flag_code;
insert into teams (fifa_code, name, short_name, flag_code) values ('SUI', 'Switzerland', 'Switzerland', 'SUI') on conflict (fifa_code) do update set name = excluded.name, short_name = excluded.short_name, flag_code = excluded.flag_code;
insert into teams (fifa_code, name, short_name, flag_code) values ('TUN', 'Tunisia', 'Tunisia', 'TUN') on conflict (fifa_code) do update set name = excluded.name, short_name = excluded.short_name, flag_code = excluded.flag_code;
insert into teams (fifa_code, name, short_name, flag_code) values ('TUR', 'Türkiye', 'Türkiye', 'TUR') on conflict (fifa_code) do update set name = excluded.name, short_name = excluded.short_name, flag_code = excluded.flag_code;
insert into teams (fifa_code, name, short_name, flag_code) values ('USA', 'USA', 'USA', 'USA') on conflict (fifa_code) do update set name = excluded.name, short_name = excluded.short_name, flag_code = excluded.flag_code;
insert into teams (fifa_code, name, short_name, flag_code) values ('URU', 'Uruguay', 'Uruguay', 'URU') on conflict (fifa_code) do update set name = excluded.name, short_name = excluded.short_name, flag_code = excluded.flag_code;
insert into teams (fifa_code, name, short_name, flag_code) values ('UZB', 'Uzbekistan', 'Uzbekistan', 'UZB') on conflict (fifa_code) do update set name = excluded.name, short_name = excluded.short_name, flag_code = excluded.flag_code;

insert into managers (group_id, manager_code, display_name, pin_hash, role, is_active) select g.id, 'M001', 'Abrham', 'SET_BY_COMMISSIONER', 'commissioner', true from groups g where g.slug = 'squad' on conflict (group_id, manager_code) do update set display_name = excluded.display_name, role = excluded.role, is_active = excluded.is_active;
insert into managers (group_id, manager_code, display_name, pin_hash, role, is_active) select g.id, 'M002', 'Maki', 'SET_BY_COMMISSIONER', 'manager', true from groups g where g.slug = 'squad' on conflict (group_id, manager_code) do update set display_name = excluded.display_name, role = excluded.role, is_active = excluded.is_active;
insert into managers (group_id, manager_code, display_name, pin_hash, role, is_active) select g.id, 'M003', 'Salim', 'SET_BY_COMMISSIONER', 'manager', true from groups g where g.slug = 'squad' on conflict (group_id, manager_code) do update set display_name = excluded.display_name, role = excluded.role, is_active = excluded.is_active;
insert into managers (group_id, manager_code, display_name, pin_hash, role, is_active) select g.id, 'M004', 'Eyerus', 'SET_BY_COMMISSIONER', 'manager', true from groups g where g.slug = 'squad' on conflict (group_id, manager_code) do update set display_name = excluded.display_name, role = excluded.role, is_active = excluded.is_active;
insert into managers (group_id, manager_code, display_name, pin_hash, role, is_active) select g.id, 'M005', 'Redu', 'SET_BY_COMMISSIONER', 'manager', true from groups g where g.slug = 'squad' on conflict (group_id, manager_code) do update set display_name = excluded.display_name, role = excluded.role, is_active = excluded.is_active;
insert into managers (group_id, manager_code, display_name, pin_hash, role, is_active) select g.id, 'M006', 'Kidist', 'SET_BY_COMMISSIONER', 'manager', true from groups g where g.slug = 'squad' on conflict (group_id, manager_code) do update set display_name = excluded.display_name, role = excluded.role, is_active = excluded.is_active;
insert into managers (group_id, manager_code, display_name, pin_hash, role, is_active) select g.id, 'M007', 'Tsinat', 'SET_BY_COMMISSIONER', 'manager', true from groups g where g.slug = 'squad' on conflict (group_id, manager_code) do update set display_name = excluded.display_name, role = excluded.role, is_active = excluded.is_active;
insert into managers (group_id, manager_code, display_name, pin_hash, role, is_active) select g.id, 'M001', 'Abrham', 'SET_BY_COMMISSIONER', 'commissioner', true from groups g where g.slug = 'tikur-abay' on conflict (group_id, manager_code) do update set display_name = excluded.display_name, role = excluded.role, is_active = excluded.is_active;
insert into managers (group_id, manager_code, display_name, pin_hash, role, is_active) select g.id, 'M002', 'Aman M', 'SET_BY_COMMISSIONER', 'manager', true from groups g where g.slug = 'tikur-abay' on conflict (group_id, manager_code) do update set display_name = excluded.display_name, role = excluded.role, is_active = excluded.is_active;
insert into managers (group_id, manager_code, display_name, pin_hash, role, is_active) select g.id, 'M003', 'Amanu G', 'SET_BY_COMMISSIONER', 'manager', true from groups g where g.slug = 'tikur-abay' on conflict (group_id, manager_code) do update set display_name = excluded.display_name, role = excluded.role, is_active = excluded.is_active;
insert into managers (group_id, manager_code, display_name, pin_hash, role, is_active) select g.id, 'M004', 'Amen', 'SET_BY_COMMISSIONER', 'manager', true from groups g where g.slug = 'tikur-abay' on conflict (group_id, manager_code) do update set display_name = excluded.display_name, role = excluded.role, is_active = excluded.is_active;
insert into managers (group_id, manager_code, display_name, pin_hash, role, is_active) select g.id, 'M005', 'Ermi', 'SET_BY_COMMISSIONER', 'manager', true from groups g where g.slug = 'tikur-abay' on conflict (group_id, manager_code) do update set display_name = excluded.display_name, role = excluded.role, is_active = excluded.is_active;
insert into managers (group_id, manager_code, display_name, pin_hash, role, is_active) select g.id, 'M006', 'Oyala', 'SET_BY_COMMISSIONER', 'manager', true from groups g where g.slug = 'tikur-abay' on conflict (group_id, manager_code) do update set display_name = excluded.display_name, role = excluded.role, is_active = excluded.is_active;
insert into managers (group_id, manager_code, display_name, pin_hash, role, is_active) select g.id, 'M007', 'Maki', 'SET_BY_COMMISSIONER', 'manager', true from groups g where g.slug = 'tikur-abay' on conflict (group_id, manager_code) do update set display_name = excluded.display_name, role = excluded.role, is_active = excluded.is_active;
insert into managers (group_id, manager_code, display_name, pin_hash, role, is_active) select g.id, 'M008', 'Salim', 'SET_BY_COMMISSIONER', 'manager', true from groups g where g.slug = 'tikur-abay' on conflict (group_id, manager_code) do update set display_name = excluded.display_name, role = excluded.role, is_active = excluded.is_active;
insert into managers (group_id, manager_code, display_name, pin_hash, role, is_active) select g.id, 'M009', 'Sele', 'SET_BY_COMMISSIONER', 'manager', true from groups g where g.slug = 'tikur-abay' on conflict (group_id, manager_code) do update set display_name = excluded.display_name, role = excluded.role, is_active = excluded.is_active;
insert into managers (group_id, manager_code, display_name, pin_hash, role, is_active) select g.id, 'M010', 'Yabsew', 'SET_BY_COMMISSIONER', 'manager', true from groups g where g.slug = 'tikur-abay' on conflict (group_id, manager_code) do update set display_name = excluded.display_name, role = excluded.role, is_active = excluded.is_active;
insert into managers (group_id, manager_code, display_name, pin_hash, role, is_active) select g.id, 'M011', 'Papi', 'SET_BY_COMMISSIONER', 'manager', true from groups g where g.slug = 'tikur-abay' on conflict (group_id, manager_code) do update set display_name = excluded.display_name, role = excluded.role, is_active = excluded.is_active;
insert into managers (group_id, manager_code, display_name, pin_hash, role, is_active) select g.id, 'M012', 'Aadil', 'SET_BY_COMMISSIONER', 'manager', true from groups g where g.slug = 'tikur-abay' on conflict (group_id, manager_code) do update set display_name = excluded.display_name, role = excluded.role, is_active = excluded.is_active;
insert into managers (group_id, manager_code, display_name, pin_hash, role, is_active) select g.id, 'M001', 'Abrham', 'SET_BY_COMMISSIONER', 'commissioner', true from groups g where g.slug = 'dagi-united' on conflict (group_id, manager_code) do update set display_name = excluded.display_name, role = excluded.role, is_active = excluded.is_active;
insert into managers (group_id, manager_code, display_name, pin_hash, role, is_active) select g.id, 'M002', 'Anton', 'SET_BY_COMMISSIONER', 'manager', true from groups g where g.slug = 'dagi-united' on conflict (group_id, manager_code) do update set display_name = excluded.display_name, role = excluded.role, is_active = excluded.is_active;
insert into managers (group_id, manager_code, display_name, pin_hash, role, is_active) select g.id, 'M003', 'Armaan', 'SET_BY_COMMISSIONER', 'manager', true from groups g where g.slug = 'dagi-united' on conflict (group_id, manager_code) do update set display_name = excluded.display_name, role = excluded.role, is_active = excluded.is_active;
insert into managers (group_id, manager_code, display_name, pin_hash, role, is_active) select g.id, 'M004', 'Dagi', 'SET_BY_COMMISSIONER', 'manager', true from groups g where g.slug = 'dagi-united' on conflict (group_id, manager_code) do update set display_name = excluded.display_name, role = excluded.role, is_active = excluded.is_active;
insert into managers (group_id, manager_code, display_name, pin_hash, role, is_active) select g.id, 'M005', 'Derek', 'SET_BY_COMMISSIONER', 'manager', true from groups g where g.slug = 'dagi-united' on conflict (group_id, manager_code) do update set display_name = excluded.display_name, role = excluded.role, is_active = excluded.is_active;
insert into managers (group_id, manager_code, display_name, pin_hash, role, is_active) select g.id, 'M006', 'Kahf', 'SET_BY_COMMISSIONER', 'manager', true from groups g where g.slug = 'dagi-united' on conflict (group_id, manager_code) do update set display_name = excluded.display_name, role = excluded.role, is_active = excluded.is_active;
insert into managers (group_id, manager_code, display_name, pin_hash, role, is_active) select g.id, 'M007', 'Simon', 'SET_BY_COMMISSIONER', 'manager', true from groups g where g.slug = 'dagi-united' on conflict (group_id, manager_code) do update set display_name = excluded.display_name, role = excluded.role, is_active = excluded.is_active;
insert into managers (group_id, manager_code, display_name, pin_hash, role, is_active) select g.id, 'M008', 'Nafis', 'SET_BY_COMMISSIONER', 'manager', true from groups g where g.slug = 'dagi-united' on conflict (group_id, manager_code) do update set display_name = excluded.display_name, role = excluded.role, is_active = excluded.is_active;

insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021443', 'Group Stage', 'A', ta.id, tb.id, '2026-06-11T19:00:00Z'::timestamptz, 'finished' from (select 1) s left join teams ta on ta.fifa_code = 'MEX' left join teams tb on tb.fifa_code = 'RSA' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021441', 'Group Stage', 'A', ta.id, tb.id, '2026-06-12T02:00:00Z'::timestamptz, 'finished' from (select 1) s left join teams ta on ta.fifa_code = 'KOR' left join teams tb on tb.fifa_code = 'CZE' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021449', 'Group Stage', 'B', ta.id, tb.id, '2026-06-12T19:00:00Z'::timestamptz, 'finished' from (select 1) s left join teams ta on ta.fifa_code = 'CAN' left join teams tb on tb.fifa_code = 'BIH' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021458', 'Group Stage', 'D', ta.id, tb.id, '2026-06-13T01:00:00Z'::timestamptz, 'finished' from (select 1) s left join teams ta on ta.fifa_code = 'USA' left join teams tb on tb.fifa_code = 'PAR' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021453', 'Group Stage', 'B', ta.id, tb.id, '2026-06-14T01:00:00Z'::timestamptz, 'finished' from (select 1) s left join teams ta on ta.fifa_code = 'HAI' left join teams tb on tb.fifa_code = 'SCO' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021463', 'Group Stage', 'C', ta.id, tb.id, '2026-06-14T00:00:00Z'::timestamptz, 'finished' from (select 1) s left join teams ta on ta.fifa_code = 'AUS' left join teams tb on tb.fifa_code = 'TUR' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021456', 'Group Stage', 'C', ta.id, tb.id, '2026-06-13T22:00:00Z'::timestamptz, 'finished' from (select 1) s left join teams ta on ta.fifa_code = 'BRA' left join teams tb on tb.fifa_code = 'MAR' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021447', 'Group Stage', 'D', ta.id, tb.id, '2026-06-13T19:00:00Z'::timestamptz, 'finished' from (select 1) s left join teams ta on ta.fifa_code = 'QAT' left join teams tb on tb.fifa_code = 'SUI' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021467', 'Group Stage', 'E', ta.id, tb.id, '2026-06-14T23:00:00Z'::timestamptz, 'finished' from (select 1) s left join teams ta on ta.fifa_code = 'CIV' left join teams tb on tb.fifa_code = 'ECU' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021464', 'Group Stage', 'F', ta.id, tb.id, '2026-06-14T17:00:00Z'::timestamptz, 'finished' from (select 1) s left join teams ta on ta.fifa_code = 'GER' left join teams tb on tb.fifa_code = 'CUW' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021470', 'Group Stage', 'E', ta.id, tb.id, '2026-06-14T20:00:00Z'::timestamptz, 'finished' from (select 1) s left join teams ta on ta.fifa_code = 'NED' left join teams tb on tb.fifa_code = 'JPN' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021474', 'Group Stage', 'F', ta.id, tb.id, '2026-06-15T02:00:00Z'::timestamptz, 'finished' from (select 1) s left join teams ta on ta.fifa_code = 'SWE' left join teams tb on tb.fifa_code = 'TUN' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021486', 'Group Stage', 'H', ta.id, tb.id, '2026-06-15T22:00:00Z'::timestamptz, 'finished' from (select 1) s left join teams ta on ta.fifa_code = 'KSA' left join teams tb on tb.fifa_code = 'URU' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021482', 'Group Stage', 'G', ta.id, tb.id, '2026-06-15T16:00:00Z'::timestamptz, 'finished' from (select 1) s left join teams ta on ta.fifa_code = 'ESP' left join teams tb on tb.fifa_code = 'CPV' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021476', 'Group Stage', 'H', ta.id, tb.id, '2026-06-16T01:00:00Z'::timestamptz, 'finished' from (select 1) s left join teams ta on ta.fifa_code = 'IRN' left join teams tb on tb.fifa_code = 'NZL' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021478', 'Group Stage', 'G', ta.id, tb.id, '2026-06-15T19:00:00Z'::timestamptz, 'finished' from (select 1) s left join teams ta on ta.fifa_code = 'BEL' left join teams tb on tb.fifa_code = 'EGY' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021490', 'Group Stage', 'I', ta.id, tb.id, '2026-06-16T19:00:00Z'::timestamptz, 'finished' from (select 1) s left join teams ta on ta.fifa_code = 'FRA' left join teams tb on tb.fifa_code = 'SEN' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021488', 'Group Stage', 'I', ta.id, tb.id, '2026-06-16T22:00:00Z'::timestamptz, 'finished' from (select 1) s left join teams ta on ta.fifa_code = 'IRQ' left join teams tb on tb.fifa_code = 'NOR' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021496', 'Group Stage', 'J', ta.id, tb.id, '2026-06-17T01:00:00Z'::timestamptz, 'finished' from (select 1) s left join teams ta on ta.fifa_code = 'ARG' left join teams tb on tb.fifa_code = 'ALG' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021498', 'Group Stage', 'J', ta.id, tb.id, '2026-06-17T00:00:00Z'::timestamptz, 'finished' from (select 1) s left join teams ta on ta.fifa_code = 'AUT' left join teams tb on tb.fifa_code = 'JOR' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021510', 'Group Stage', 'K', ta.id, tb.id, '2026-06-17T23:00:00Z'::timestamptz, 'finished' from (select 1) s left join teams ta on ta.fifa_code = 'GHA' left join teams tb on tb.fifa_code = 'PAN' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021507', 'Group Stage', 'L', ta.id, tb.id, '2026-06-17T20:00:00Z'::timestamptz, 'finished' from (select 1) s left join teams ta on ta.fifa_code = 'ENG' left join teams tb on tb.fifa_code = 'CRO' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021502', 'Group Stage', 'L', ta.id, tb.id, '2026-06-17T17:00:00Z'::timestamptz, 'finished' from (select 1) s left join teams ta on ta.fifa_code = 'POR' left join teams tb on tb.fifa_code = 'COD' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021504', 'Group Stage', 'K', ta.id, tb.id, '2026-06-18T02:00:00Z'::timestamptz, 'finished' from (select 1) s left join teams ta on ta.fifa_code = 'UZB' left join teams tb on tb.fifa_code = 'COL' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021440', 'Group Stage', 'A', ta.id, tb.id, '2026-06-18T16:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = 'CZE' left join teams tb on tb.fifa_code = 'RSA' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021446', 'Group Stage', 'B', ta.id, tb.id, '2026-06-18T19:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = 'SUI' left join teams tb on tb.fifa_code = 'BIH' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021450', 'Group Stage', 'B', ta.id, tb.id, '2026-06-18T22:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = 'CAN' left join teams tb on tb.fifa_code = 'QAT' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021442', 'Group Stage', 'A', ta.id, tb.id, '2026-06-19T01:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = 'MEX' left join teams tb on tb.fifa_code = 'KOR' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021457', 'Group Stage', 'D', ta.id, tb.id, '2026-06-20T00:30:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = 'BRA' left join teams tb on tb.fifa_code = 'HAI' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021454', 'Group Stage', 'C', ta.id, tb.id, '2026-06-19T22:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = 'SCO' left join teams tb on tb.fifa_code = 'MAR' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021460', 'Group Stage', 'C', ta.id, tb.id, '2026-06-20T03:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = 'TUR' left join teams tb on tb.fifa_code = 'PAR' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021462', 'Group Stage', 'D', ta.id, tb.id, '2026-06-19T19:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = 'USA' left join teams tb on tb.fifa_code = 'AUS' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021469', 'Group Stage', 'F', ta.id, tb.id, '2026-06-20T20:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = 'GER' left join teams tb on tb.fifa_code = 'CIV' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021465', 'Group Stage', 'E', ta.id, tb.id, '2026-06-21T00:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = 'ECU' left join teams tb on tb.fifa_code = 'CUW' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021472', 'Group Stage', 'E', ta.id, tb.id, '2026-06-20T17:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = 'NED' left join teams tb on tb.fifa_code = 'SWE' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021475', 'Group Stage', 'F', ta.id, tb.id, '2026-06-21T00:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = 'TUN' left join teams tb on tb.fifa_code = 'JPN' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021487', 'Group Stage', 'H', ta.id, tb.id, '2026-06-21T22:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = 'URU' left join teams tb on tb.fifa_code = 'CPV' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021483', 'Group Stage', 'G', ta.id, tb.id, '2026-06-21T16:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = 'ESP' left join teams tb on tb.fifa_code = 'KSA' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021477', 'Group Stage', 'H', ta.id, tb.id, '2026-06-21T19:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = 'BEL' left join teams tb on tb.fifa_code = 'IRN' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021480', 'Group Stage', 'G', ta.id, tb.id, '2026-06-22T01:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = 'NZL' left join teams tb on tb.fifa_code = 'EGY' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021491', 'Group Stage', 'J', ta.id, tb.id, '2026-06-23T00:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = 'NOR' left join teams tb on tb.fifa_code = 'SEN' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021492', 'Group Stage', 'I', ta.id, tb.id, '2026-06-22T21:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = 'FRA' left join teams tb on tb.fifa_code = 'IRQ' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021494', 'Group Stage', 'I', ta.id, tb.id, '2026-06-22T17:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = 'ARG' left join teams tb on tb.fifa_code = 'AUT' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021499', 'Group Stage', 'J', ta.id, tb.id, '2026-06-23T03:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = 'JOR' left join teams tb on tb.fifa_code = 'ALG' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021506', 'Group Stage', 'K', ta.id, tb.id, '2026-06-23T20:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = 'ENG' left join teams tb on tb.fifa_code = 'GHA' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021511', 'Group Stage', 'L', ta.id, tb.id, '2026-06-23T23:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = 'PAN' left join teams tb on tb.fifa_code = 'CRO' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021503', 'Group Stage', 'L', ta.id, tb.id, '2026-06-23T17:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = 'POR' left join teams tb on tb.fifa_code = 'UZB' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021501', 'Group Stage', 'K', ta.id, tb.id, '2026-06-24T02:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = 'COL' left join teams tb on tb.fifa_code = 'COD' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021455', 'Group Stage', 'B', ta.id, tb.id, '2026-06-24T22:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = 'SCO' left join teams tb on tb.fifa_code = 'BRA' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021452', 'Group Stage', 'B', ta.id, tb.id, '2026-06-24T22:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = 'MAR' left join teams tb on tb.fifa_code = 'HAI' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021451', 'Group Stage', 'C', ta.id, tb.id, '2026-06-24T19:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = 'SUI' left join teams tb on tb.fifa_code = 'CAN' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021448', 'Group Stage', 'C', ta.id, tb.id, '2026-06-24T19:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = 'BIH' left join teams tb on tb.fifa_code = 'QAT' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021444', 'Group Stage', 'A', ta.id, tb.id, '2026-06-25T01:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = 'CZE' left join teams tb on tb.fifa_code = 'MEX' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021445', 'Group Stage', 'A', ta.id, tb.id, '2026-06-25T01:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = 'RSA' left join teams tb on tb.fifa_code = 'KOR' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021468', 'Group Stage', 'E', ta.id, tb.id, '2026-06-25T20:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = 'CUW' left join teams tb on tb.fifa_code = 'CIV' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021466', 'Group Stage', 'E', ta.id, tb.id, '2026-06-25T20:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = 'ECU' left join teams tb on tb.fifa_code = 'GER' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021471', 'Group Stage', 'F', ta.id, tb.id, '2026-06-25T23:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = 'JPN' left join teams tb on tb.fifa_code = 'SWE' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021473', 'Group Stage', 'F', ta.id, tb.id, '2026-06-25T23:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = 'TUN' left join teams tb on tb.fifa_code = 'NED' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021459', 'Group Stage', 'D', ta.id, tb.id, '2026-06-26T02:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = 'TUR' left join teams tb on tb.fifa_code = 'USA' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021461', 'Group Stage', 'D', ta.id, tb.id, '2026-06-26T02:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = 'PAR' left join teams tb on tb.fifa_code = 'AUS' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021489', 'Group Stage', 'I', ta.id, tb.id, '2026-06-26T19:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = 'NOR' left join teams tb on tb.fifa_code = 'FRA' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021493', 'Group Stage', 'I', ta.id, tb.id, '2026-06-26T19:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = 'SEN' left join teams tb on tb.fifa_code = 'IRQ' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021479', 'Group Stage', 'H', ta.id, tb.id, '2026-06-27T03:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = 'EGY' left join teams tb on tb.fifa_code = 'IRN' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021481', 'Group Stage', 'H', ta.id, tb.id, '2026-06-27T03:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = 'NZL' left join teams tb on tb.fifa_code = 'BEL' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021485', 'Group Stage', 'G', ta.id, tb.id, '2026-06-27T00:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = 'CPV' left join teams tb on tb.fifa_code = 'KSA' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021484', 'Group Stage', 'G', ta.id, tb.id, '2026-06-27T00:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = 'URU' left join teams tb on tb.fifa_code = 'ESP' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021508', 'Group Stage', 'L', ta.id, tb.id, '2026-06-27T21:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = 'PAN' left join teams tb on tb.fifa_code = 'ENG' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021509', 'Group Stage', 'L', ta.id, tb.id, '2026-06-27T21:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = 'CRO' left join teams tb on tb.fifa_code = 'GHA' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021497', 'Group Stage', 'K', ta.id, tb.id, '2026-06-28T02:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = 'ALG' left join teams tb on tb.fifa_code = 'AUT' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021495', 'Group Stage', 'K', ta.id, tb.id, '2026-06-28T02:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = 'JOR' left join teams tb on tb.fifa_code = 'ARG' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021505', 'Group Stage', 'J', ta.id, tb.id, '2026-06-27T23:30:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = 'COL' left join teams tb on tb.fifa_code = 'POR' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021500', 'Group Stage', 'J', ta.id, tb.id, '2026-06-27T23:30:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = 'COD' left join teams tb on tb.fifa_code = 'UZB' on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021518', 'Round of 32', null, ta.id, tb.id, '2026-06-28T19:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = null left join teams tb on tb.fifa_code = null on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021513', 'Round of 32', null, ta.id, tb.id, '2026-06-29T20:30:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = null left join teams tb on tb.fifa_code = null on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021522', 'Round of 32', null, ta.id, tb.id, '2026-06-30T01:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = null left join teams tb on tb.fifa_code = null on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021516', 'Round of 32', null, ta.id, tb.id, '2026-06-29T17:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = null left join teams tb on tb.fifa_code = null on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021523', 'Round of 32', null, ta.id, tb.id, '2026-06-30T21:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = null left join teams tb on tb.fifa_code = null on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021514', 'Round of 32', null, ta.id, tb.id, '2026-06-30T17:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = null left join teams tb on tb.fifa_code = null on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021520', 'Round of 32', null, ta.id, tb.id, '2026-07-01T01:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = null left join teams tb on tb.fifa_code = null on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021512', 'Round of 32', null, ta.id, tb.id, '2026-07-01T16:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = null left join teams tb on tb.fifa_code = null on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021524', 'Round of 32', null, ta.id, tb.id, '2026-07-02T00:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = null left join teams tb on tb.fifa_code = null on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021525', 'Round of 32', null, ta.id, tb.id, '2026-07-01T20:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = null left join teams tb on tb.fifa_code = null on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021526', 'Round of 32', null, ta.id, tb.id, '2026-07-02T23:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = null left join teams tb on tb.fifa_code = null on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021519', 'Round of 32', null, ta.id, tb.id, '2026-07-02T19:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = null left join teams tb on tb.fifa_code = null on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021527', 'Round of 32', null, ta.id, tb.id, '2026-07-03T03:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = null left join teams tb on tb.fifa_code = null on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021521', 'Round of 32', null, ta.id, tb.id, '2026-07-03T22:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = null left join teams tb on tb.fifa_code = null on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021517', 'Round of 32', null, ta.id, tb.id, '2026-07-04T01:30:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = null left join teams tb on tb.fifa_code = null on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021515', 'Round of 32', null, ta.id, tb.id, '2026-07-03T18:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = null left join teams tb on tb.fifa_code = null on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021533', 'Round of 16', null, ta.id, tb.id, '2026-07-04T21:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = null left join teams tb on tb.fifa_code = null on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021530', 'Round of 16', null, ta.id, tb.id, '2026-07-04T17:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = null left join teams tb on tb.fifa_code = null on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021532', 'Round of 16', null, ta.id, tb.id, '2026-07-05T20:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = null left join teams tb on tb.fifa_code = null on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021531', 'Round of 16', null, ta.id, tb.id, '2026-07-06T00:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = null left join teams tb on tb.fifa_code = null on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021529', 'Round of 16', null, ta.id, tb.id, '2026-07-06T19:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = null left join teams tb on tb.fifa_code = null on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021534', 'Round of 16', null, ta.id, tb.id, '2026-07-07T00:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = null left join teams tb on tb.fifa_code = null on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021528', 'Round of 16', null, ta.id, tb.id, '2026-07-07T16:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = null left join teams tb on tb.fifa_code = null on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021535', 'Round of 16', null, ta.id, tb.id, '2026-07-07T20:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = null left join teams tb on tb.fifa_code = null on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021536', 'Quarterfinal', null, ta.id, tb.id, '2026-07-09T20:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = null left join teams tb on tb.fifa_code = null on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021538', 'Quarterfinal', null, ta.id, tb.id, '2026-07-10T19:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = null left join teams tb on tb.fifa_code = null on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021539', 'Quarterfinal', null, ta.id, tb.id, '2026-07-11T21:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = null left join teams tb on tb.fifa_code = null on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021537', 'Quarterfinal', null, ta.id, tb.id, '2026-07-12T01:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = null left join teams tb on tb.fifa_code = null on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021541', 'Semifinal', null, ta.id, tb.id, '2026-07-14T19:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = null left join teams tb on tb.fifa_code = null on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021540', 'Semifinal', null, ta.id, tb.id, '2026-07-15T19:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = null left join teams tb on tb.fifa_code = null on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021542', 'Third Place', null, ta.id, tb.id, '2026-07-18T21:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = null left join teams tb on tb.fifa_code = null on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;
insert into matches (external_match_id, stage, group_label, team_a_id, team_b_id, kickoff_at, status) select '400021543', 'Final', null, ta.id, tb.id, '2026-07-19T19:00:00Z'::timestamptz, 'scheduled' from (select 1) s left join teams ta on ta.fifa_code = null left join teams tb on tb.fifa_code = null on conflict (external_match_id) do update set stage = excluded.stage, group_label = excluded.group_label, team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id, kickoff_at = excluded.kickoff_at, status = excluded.status;

insert into group_matches (group_id, match_id) select g.id, m.id from groups g cross join matches m on conflict (group_id, match_id) do nothing;
