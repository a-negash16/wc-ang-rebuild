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
