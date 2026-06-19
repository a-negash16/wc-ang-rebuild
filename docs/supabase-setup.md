# Supabase Setup

This project is designed to work on Supabase's free plan while usage is small.

## 1. Create Project

1. Go to Supabase.
2. Create a new project.
3. Save the project password somewhere private.
4. Use the default region unless you have a reason to choose another.

## 2. Apply Schema And Seed

Generate the combined SQL bundle:

```sh
node scripts/build-supabase-sql.mjs
```

Open:

```text
supabase/generated/apply-all.sql
```

In Supabase:

1. Open `SQL Editor`.
2. Paste the full SQL bundle.
3. Run it.

This creates:

- groups
- managers
- teams
- matches
- group_matches
- predictions
- prediction_audit
- odds tables
- scoring_events
- prediction read views
- seed records for all three groups

RLS is enabled and no direct browser policies are added yet. The app server uses
the service-role key from server-side API routes.

## 3. Set Manager PIN Hashes

Generate a hash locally:

```sh
node scripts/hash-pin.mjs 12345
```

Then run a private SQL update in Supabase:

```sql
update managers
set pin_hash = 'sha256:replace_with_generated_hash'
where manager_code = 'M001'
  and group_id = (select id from groups where slug = 'squad');
```

Repeat per manager. Do not commit real PIN hashes unless you intentionally want
them in the repo.

## 4. Configure Environment

In `.env.local`:

```text
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SESSION_SECRET=long-random-string
ODDS_API_KEY=your-odds-api-key
```

Important:

- `SUPABASE_SERVICE_ROLE_KEY` must never be exposed to the browser.
- `ODDS_API_KEY` must never be exposed to the browser.
- `SESSION_SECRET` should be long and random.

## 5. Smoke Test

Run the app:

```sh
npm install
npm run dev
```

Then check:

```text
http://localhost:3000/api/health
http://localhost:3000/squad
```

Unlock with a manager code whose `pin_hash` has been set.

