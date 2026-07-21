alter table public.groups
  add column if not exists tournament_complete boolean not null default false;

comment on column public.groups.tournament_complete is
  'Commissioner-controlled flag that switches a group page from live prediction mode to final tournament recap mode.';
