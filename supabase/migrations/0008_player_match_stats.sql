-- Per-match ledger for automated goal/assist scoring. Kept separate from
-- player_stat_tallies (which holds manually entered totals) so the
-- automated sync job can never double-count or overwrite anything a
-- commissioner already typed in by hand — the two sources cover
-- non-overlapping matches by construction (see sync-player-stats job).
create table if not exists player_match_stats (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  match_id uuid not null references matches(id) on delete cascade,
  goals integer not null default 0 check (goals >= 0),
  assists integer not null default 0 check (assists >= 0),
  updated_at timestamptz not null default now(),
  unique (player_id, match_id)
);

alter table player_match_stats enable row level security;

drop view if exists drafted_player_details;

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
  coalesce(pst.goals, 0) + coalesce(auto.goals, 0) as goals,
  coalesce(pst.assists, 0) + coalesce(auto.assists, 0) as assists,
  coalesce(pst.player_of_match, 0) as player_of_match,
  dp.draft_slot,
  dp.notes
from drafted_players dp
join groups g on g.id = dp.group_id
join managers m on m.id = dp.manager_id
join players p on p.id = dp.player_id
left join teams t on t.id = p.team_id
left join player_stat_tallies pst on pst.player_id = p.id
left join (
  select player_id, sum(goals) as goals, sum(assists) as assists
  from player_match_stats
  group by player_id
) auto on auto.player_id = p.id;
