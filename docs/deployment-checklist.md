# Deployment Checklist

Use this checklist before letting managers rely on the rebuild for real picks.

## 1. Environment

Create `.env.local` locally and configure the deployment provider with the same production-safe values:

```text
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SESSION_SECRET=...
ODDS_API_KEY=...
ODDS_API_BASE_URL=https://api.the-odds-api.com/v4
```

Required safety checks:

- `SUPABASE_SERVICE_ROLE_KEY` is server-side only.
- `ODDS_API_KEY` is server-side only.
- `SESSION_SECRET` is long, random, and not the local fallback.
- `DEV_MANAGER_PIN` is empty for any real deployment.
- Real PINs are never committed to seed files.

Generate a strong session secret with:

```sh
npm run generate:session-secret
```

Run:

```sh
npm run deployment:check
```

## 2. Database

Generate and apply the SQL bundle:

```sh
npm run supabase:bundle
```

Paste `supabase/generated/apply-all.sql` into the Supabase SQL Editor and run it.

Confirm:

- Tables exist for groups, managers, teams, matches, group matches, predictions, and prediction audit.
- Views exist for `active_prediction_details` and `prediction_pulse_details`.
- RLS is enabled.
- There are no anon/authenticated policies for direct browser table access yet.

Run:

```sh
npm run supabase:check -- --strict
```

## 3. Manager PINs

Set each real manager PIN privately:

```sh
npm run set-manager-pin -- squad M001 12345
```

Repeat for each group and manager.

Confirm:

- No manager still has `pin_hash = SET_BY_COMMISSIONER` before launch.
- The commissioner keeps the real PIN list privately.
- Managers only receive their group link and their own PIN.

## 4. Prediction Flow

Dry-run a manager:

```sh
npm run smoke:prediction -- --group squad --manager M001 --pin 12345
```

Write-test one safe pick:

```sh
npm run smoke:prediction -- --group squad --manager M001 --pin 12345 --write
```

Then open the app and verify:

- `/squad`, `/dagi-united`, and `/tikur-abay` load.
- Unlock works only with the correct manager PIN.
- A saved pick shows a confirmation timestamp.
- The same pick appears after refresh/unlock.
- Prediction Pulse does not reveal manager names before the deadline.
- Prediction Pulse reveals manager names after the deadline.
- The deadline is enforced server-side.

## 5. Public Pages

Before sending links:

- Root page only shows the group picker.
- Group pages do not link to `/admin`.
- Mobile pages have no horizontal page scroll.
- Open Picks and Prediction Pulse use the group theme color.
- Empty states read clearly when there are no picks, standings, or recent results.

## 6. Launch Guardrails

Keep these in place for MVP:

- Use the current spreadsheet process as backup until the rebuild has survived a real matchday.
- Keep `prediction_audit` enabled so changed picks can be reviewed.
- Do not add direct browser Supabase write policies yet.
- Do not expose the service-role key in client components.
- Rotate `SESSION_SECRET` and manager PINs if there is any accidental exposure.
