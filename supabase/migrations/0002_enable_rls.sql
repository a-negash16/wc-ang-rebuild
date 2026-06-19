alter table groups enable row level security;
alter table managers enable row level security;
alter table teams enable row level security;
alter table matches enable row level security;
alter table group_matches enable row level security;
alter table predictions enable row level security;
alter table prediction_audit enable row level security;
alter table odds_snapshots enable row level security;
alter table match_pick_values enable row level security;
alter table futures_pick_values enable row level security;
alter table scoring_events enable row level security;

-- No anon/authenticated policies yet.
-- The Next.js API uses the service role key server-side, which bypasses RLS.
-- Add narrow read policies later only for data that should be directly public.
