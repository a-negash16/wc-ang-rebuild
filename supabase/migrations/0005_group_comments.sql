create table group_comments (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  manager_id uuid not null references managers(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 30),
  status text not null default 'active' check (status in ('active', 'hidden', 'deleted')),
  created_at timestamptz not null default now()
);

create index group_comments_group_created_idx
  on group_comments (group_id, created_at desc)
  where status = 'active';

alter table group_comments enable row level security;
