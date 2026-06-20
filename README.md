# WC ANG Rebuild

Parallel rebuild for the WC ANG prediction league. The current spreadsheet-backed system remains production while this project is built and tested.

## Initial Scope

- Start all three groups with shared code paths.
- Keep manager PINs commissioner-managed.
- Move website predictions into a backend/database.
- Keep drafts and futures commissioner-entered for now.
- Add odds-aware knockout and futures scoring.

## Stack

```text
Next.js App Router
Supabase Postgres
The Odds API server-side integration
Node test runner for rules
```

## Local Commands

```sh
npm install
npm run dev
npm test
npm run check
```

## Seed Data

Workbook seed extraction is available for the current transition period:

```sh
python3 scripts/extract-workbook-seeds.py
```

Generated seed files live in:

```text
supabase/seed-data/
```

The seed data includes all three groups, manager display names, teams, matches,
and group-to-match links. PIN hashes are placeholders and must be set privately
by the commissioner before real use.

## Supabase Setup

See [docs/supabase-setup.md](docs/supabase-setup.md) for the free-tier setup path.
Use [docs/deployment-checklist.md](docs/deployment-checklist.md) before sending
live links to managers.

Generate a copy/paste SQL bundle with:

```sh
npm run supabase:bundle
```

After setting `.env.local`, verify the Supabase connection with:

```sh
npm run deployment:check
npm run supabase:check
```

## Secrets

Do not commit API keys. Copy `.env.example` to `.env` locally and set:

```text
ODDS_API_KEY=...
```

The Odds API key must only be used server-side.

## Local Prediction Flow

Without Supabase credentials, the app reads checked-in seed data and does not
write predictions. For local UI testing, set a temporary shared PIN:

```text
DEV_MANAGER_PIN=12345
```

Then unlock with any seeded manager code such as `M001`. Real submissions still
require Supabase so picks can be written and audited server-side.

Generate production PIN hashes with:

```sh
node scripts/hash-pin.mjs 12345
```

Or update a manager directly from `.env.local`:

```sh
npm run set-manager-pin -- squad M001 12345
```

Smoke-test the Supabase prediction flow:

```sh
npm run smoke:prediction -- --group squad --manager M001 --pin 12345
npm run smoke:prediction -- --group squad --manager M001 --pin 12345 --write
```
