# Commissioner Missed Prediction Entry

Use this when a manager missed the website flow and the commissioner approved a manual pick.

## Safety Rules

- Confirm the group, manager, match, and pick before writing.
- Run a dry run first.
- Use `--write` only after the dry run looks right.
- Every write creates or updates one active prediction and appends a `prediction_audit` row.

## Command

Dry run:

```sh
npm run apply:missed-prediction -- --group tikur-abay --manager Ermi --match "Uruguay v Cabo Verde" --pick Tie --reason "commissioner approved missed prediction"
```

Write:

```sh
npm run apply:missed-prediction -- --group tikur-abay --manager Ermi --match "Uruguay v Cabo Verde" --pick Tie --reason "commissioner approved missed prediction" --write
```

## Pick Values

Use either:

```text
Tie
```

or the exact team name:

```text
France
Norway
Algeria
```

The script maps the team name to `team_a` or `team_b` for the selected match.

## Required Env Vars

The script reads `.env.local` and needs:

```text
NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

Do not commit `.env.local`.
