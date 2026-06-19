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
  display_name text not null,
  pin_hash text not null,
  role text not null default 'manager' check (role in ('manager', 'commissioner')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
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
  status text not null default 'active' check (status in ('active', 'inactive', 'void')),
  unique (group_id, manager_id, match_id, status)
);

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
