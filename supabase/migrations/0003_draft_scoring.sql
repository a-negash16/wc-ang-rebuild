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
