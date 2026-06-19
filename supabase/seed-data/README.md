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

Use `seed.sql` after running the initial migration to populate:

- groups
- managers
- teams
- matches
- group_matches
