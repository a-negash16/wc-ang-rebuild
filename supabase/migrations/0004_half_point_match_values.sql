alter table match_pick_values
  drop constraint if exists match_pick_values_points_check;

alter table match_pick_values
  alter column points type numeric(3,1) using points::numeric;

alter table match_pick_values
  add constraint match_pick_values_points_check check (points between 3 and 7);
