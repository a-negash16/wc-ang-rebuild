# WC ANG Developer Workflow

This guide explains how the rebuild works from data entry through display, with enough plain English context to make the technical pieces easier to maintain.

## Architecture

```text
Browser
  |
  | group pages, unlock form, prediction cards
  v
Next.js App Router
  |
  | server components read data
  | route handlers validate and write predictions
  v
Supabase Postgres
  |
  | official result overlay
  v
FIFA match feed
```

The app is intentionally server-heavy for anything sensitive. The browser displays data and sends prediction requests, but the important validation happens in Next.js route handlers using the Supabase service role key.

## Main Runtime Pieces

- `src/app/[group]/page.js`: renders each public group page.
- `src/app/[group]/PredictionPanel.js`: handles manager unlock, saved pick preview, and prediction submission UI.
- `src/app/api/predictions/route.js`: validates and saves manager picks.
- `src/app/api/predictions/state/route.js`: returns saved/missing picks for the unlocked manager.
- `src/app/api/admin/corrections/route.js`: commissioner-only correction endpoint.
- `src/data/league.js`: central data access and leaderboard calculation layer.
- `src/rules/scoring.js`: point rules.
- `src/rules/predictions.js`: pick validation and deadline checks.
- `src/integrations/fifa-api.js`: reads and normalizes official match results.

## Database Tables

Core tables:

- `groups`: Squad, Dagi-United, Tikur-Abay.
- `managers`: manager identities, hashed PINs, role.
- `teams`: World Cup teams and flag codes.
- `matches`: tournament matches.
- `group_matches`: which matches belong to each group page.
- `predictions`: one active pick per group, manager, and match.
- `prediction_audit`: manager changes and commissioner corrections.
- `scoring_events`: manual scoring adjustments.

Future/knockout tables:

- `odds_snapshots`
- `match_pick_values`
- `futures_pick_values`

Views:

- `active_prediction_details`: readable joined prediction rows.
- `prediction_pulse_details`: counts and manager-name lists by match and outcome.

## Environment Variables

Local `.env.local` and Vercel production env vars should contain:

```text
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SESSION_SECRET=...
ODDS_API_KEY=...
ODDS_API_BASE_URL=https://api.the-odds-api.com/v4
```

Plain English: local and production must point at the same Supabase project if you expect the same points.

Important security boundaries:

- `SUPABASE_SERVICE_ROLE_KEY` is server-only.
- `ODDS_API_KEY` is server-only.
- `SESSION_SECRET` signs manager unlock sessions.
- Manager PINs are hashed in Supabase.
- `private/manager-pins.csv` is local-only and must never be committed.

## Public Page Flow

When `/squad`, `/dagi-united`, or `/tikur-abay` loads:

1. `src/app/[group]/page.js` calls data helpers from `src/data/league.js`.
2. `getGroupOverview()` loads the group, managers, and upcoming matches.
3. `getLeaderboardShell()` calculates current standings.
4. `getPredictionPulse()` loads revealed pulse data.
5. `getRecentResults()` loads finished matches.
6. The page renders hero summary, open picks, Prediction Pulse, standings, recent results, and rules.

If Supabase env vars are missing, the app falls back to checked-in seed data. That is useful for local UI work, but it will not match live scoring.

## Prediction Submission Flow

The browser never writes directly to Supabase.

1. Manager unlocks with manager identity and PIN.
2. Server verifies the PIN hash.
3. Server sends back a signed session token.
4. Manager clicks a team or Tie button.
5. `POST /api/predictions` receives the match and pick.
6. Server validates:
   - session token
   - group
   - manager
   - match ID
   - selected team or tie
   - deadline
7. Server upserts the active prediction.
8. Server appends audit history.
9. UI shows save confirmation and saved pick preview.

Plain English: the button is just a request. The server is the referee.

## Deadline Rules

The group has `lock_minutes_before_kickoff`, currently 60 minutes. The app uses the match kickoff time to calculate the deadline.

The UI only shows open prediction cards for the configured open-pick window. The server still enforces the real deadline, even if a user tries to bypass the UI.

## Prediction Pulse Reveal

Prediction Pulse is built from `prediction_pulse_details`.

Before deadline:

- picks are not revealed
- manager names stay hidden

After deadline:

- manager names are shown under Team A, Tie, or Team B
- recent revealed matches are kept visible for engagement

This protects pick privacy until the deadline passes.

## Scoring Flow

Group-stage scoring currently lives in `src/rules/scoring.js`:

```text
Correct team winner: 3
Correct tie: 5
Wrong pick: 0
```

`getLeaderboardShell()` calculates:

```text
total = group-stage prediction points
      + manual scoring events
      + future scoring categories
```

The future scoring categories exist in the shape of the leaderboard but are currently zero until knockout, futures, and draft scoring are wired.

## FIFA Result Overlay

Supabase stores the planned match list. FIFA provides current status and scores.

`src/integrations/fifa-api.js` fetches FIFA matches and normalizes:

- external match ID
- kickoff time
- status
- team scores
- winner code

`overlayMatchResult()` applies that result data to Supabase matches. This is why production and localhost can differ temporarily if one environment has a stale cache or different env vars.

The FIFA fetch has a 15-minute cache.

## Rank Movement

Rank movement is calculated from the latest finished group-stage match.

Current approach:

1. Calculate current standings using all finished group-stage matches.
2. Find the most recent finished group-stage match.
3. Calculate previous standings by excluding only that latest finished match.
4. Compare previous rank to current rank.

Formula:

```text
rank_delta = previous_rank - current_rank
```

Examples:

```text
previous 3, current 2 => ↑1
previous 2, current 3 => ↓1
same rank => -
```

This does not require a new table. It is deterministic from current predictions plus match results. If we later need audit-grade history, add a `leaderboard_movements` or `leaderboard_snapshots` table and store movements when a match transitions to finished.

## Commissioner Corrections

Commissioner corrections use `/admin`.

Rules:

- group page does not link to `/admin`
- only commissioner sessions can submit corrections
- Abrham/M001 is commissioner for all three groups
- the correction endpoint validates match, manager, pick, and reason
- changes are written to `predictions`
- changes are logged in `prediction_audit`

Plain English: a correction changes the official saved pick, but leaves a receipt.

## Deployment Flow

Source of truth:

```text
GitHub repo -> Vercel deployment -> Supabase database
```

Recommended deployment:

1. Push source code to GitHub.
2. Import GitHub repo into Vercel.
3. Add production env vars in Vercel.
4. Deploy.
5. Smoke-test `/squad`, `/dagi-united`, and `/tikur-abay`.

Vercel automatically redeploys future pushes to `main`.

## Local Commands

```sh
npm install
npm run dev
npm test
npm run check
npm run build
npm run deployment:check
npm run supabase:check -- --strict
```

If local and production totals differ, check these first:

1. Production env vars are present.
2. Production and local point to the same Supabase URL.
3. `SUPABASE_SERVICE_ROLE_KEY` is set in Vercel.
4. Latest GitHub commit is deployed.
5. FIFA cache may be different for up to about 15 minutes.
6. Manual scoring events exist in the Supabase project production is using.

## Files That Must Not Be Committed

```text
.env.local
.env
private/
node_modules/
.next/
```

Safe to commit:

```text
.env.example
src/
scripts/
supabase/
docs/
package.json
package-lock.json
```

## Future Enhancements

Good next upgrades:

- Persist rank movement snapshots after each finished match.
- Add odds ingestion for knockout winner values.
- Add futures odds values.
- Add draft/team advancement scoring.
- Add commissioner scoring review pages.
- Add automated match-status sync job if FIFA polling becomes central to production.

