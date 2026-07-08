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
