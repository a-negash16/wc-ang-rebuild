alter table match_pick_values
  drop constraint if exists match_pick_values_points_check;

alter table match_pick_values
  add constraint match_pick_values_points_check check (points between 0 and 15);
