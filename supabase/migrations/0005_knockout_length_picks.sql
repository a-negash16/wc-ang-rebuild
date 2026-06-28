alter table predictions
  add column if not exists length_pick text check (length_pick is null or length_pick in ('90', 'ET', 'Pens'));

alter table prediction_audit
  add column if not exists old_length_pick text,
  add column if not exists new_length_pick text;

drop view if exists prediction_pulse_details;
drop view if exists active_prediction_details;

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
  count(*) filter (where length_pick = '90') as length_90_picks,
  count(*) filter (where length_pick = 'ET') as length_et_picks,
  count(*) filter (where length_pick = 'Pens') as length_pens_picks,
  count(*) as total_picks,
  string_agg(manager_name, ', ' order by manager_name) filter (where pick_type = 'team_a') as team_a_managers,
  string_agg(manager_name, ', ' order by manager_name) filter (where pick_type = 'tie') as tie_managers,
  string_agg(manager_name, ', ' order by manager_name) filter (where pick_type = 'team_b') as team_b_managers,
  string_agg(manager_name, ', ' order by manager_name) filter (where length_pick = '90') as length_90_managers,
  string_agg(manager_name, ', ' order by manager_name) filter (where length_pick = 'ET') as length_et_managers,
  string_agg(manager_name, ', ' order by manager_name) filter (where length_pick = 'Pens') as length_pens_managers
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
