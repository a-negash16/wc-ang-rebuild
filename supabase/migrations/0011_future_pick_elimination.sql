alter table future_pick_options
  add column if not exists is_eliminated boolean not null default false;

comment on column future_pick_options.is_eliminated is
  'Commissioner-controlled flag for future/locked-pick outcomes that are no longer possible but should remain visible historically.';
