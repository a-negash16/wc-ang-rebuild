# Seed Data

These files are generated from the current workbook exports using:

```sh
python3 scripts/extract-workbook-seeds.py
```

The generated manager records intentionally use:

```text
pin_hash = SET_BY_COMMISSIONER
```

Real PIN hashes should be set privately by the commissioner and must not be committed.

Generate a PIN hash locally:

```sh
node scripts/hash-pin.mjs 12345
```

Then update the manager privately in Supabase SQL:

```sql
update managers
set pin_hash = 'sha256:...'
where manager_code = 'M001'
  and group_id = (select id from groups where slug = 'squad');
```

Use `seed.sql` after running the initial migration to populate:

- groups
- managers
- teams
- matches
- group_matches
