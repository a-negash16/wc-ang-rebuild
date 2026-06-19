# WC ANG Rebuild

Parallel rebuild for the WC ANG prediction league. The current spreadsheet-backed system remains production while this project is built and tested.

## Initial Scope

- Start all three groups with shared code paths.
- Keep manager PINs commissioner-managed.
- Move website predictions into a backend/database.
- Keep drafts and futures commissioner-entered for now.
- Add odds-aware knockout and futures scoring.

## Local Commands

```sh
npm test
npm run check
```

## Secrets

Do not commit API keys. Copy `.env.example` to `.env` locally and set:

```text
ODDS_API_KEY=...
```

The Odds API key must only be used server-side.
