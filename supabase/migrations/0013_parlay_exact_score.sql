alter table public.parlay_markets
  add column if not exists points numeric(6, 1) not null default 0;

alter table public.parlay_predictions
  alter column option_id drop not null;

alter table public.parlay_predictions
  add column if not exists predicted_team_a_score integer,
  add column if not exists predicted_team_b_score integer;

alter table public.parlay_predictions
  drop constraint if exists parlay_predictions_option_or_score_check;

alter table public.parlay_predictions
  add constraint parlay_predictions_option_or_score_check
  check (
    option_id is not null
    or (
      predicted_team_a_score is not null
      and predicted_team_b_score is not null
      and predicted_team_a_score >= 0
      and predicted_team_b_score >= 0
    )
  );

alter table public.parlay_markets
  drop constraint if exists parlay_markets_market_type_check;

alter table public.parlay_markets
  add constraint parlay_markets_market_type_check
  check (market_type in ('over_under', 'boolean', 'exact_score'));

comment on column public.parlay_markets.points is
  'Market-level point value used when the market does not have fixed options, such as exact score.';
comment on column public.parlay_predictions.predicted_team_a_score is
  'Manager-entered exact score prediction for team A.';
comment on column public.parlay_predictions.predicted_team_b_score is
  'Manager-entered exact score prediction for team B.';
