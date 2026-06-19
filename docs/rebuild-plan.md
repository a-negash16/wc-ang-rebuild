# Rebuild Plan

## Decisions

- Start all three groups at the same time.
- Use `team_a` and `team_b`, not home/away.
- Use one app/database schema for every group.
- Keep manager PINs commissioner-managed.
- Keep drafts and futures commissioner-entered at first.
- Prediction pulse reveals manager names after each match deadline.
- Commissioner handles leaderboard tie-breakers.

## Security Notes

- The Odds API key must never ship to the browser.
- PIN verification must happen server-side.
- Store PINs as hashes, never plaintext.
- Keep an audit row for every changed prediction.
- The backend, not the frontend, enforces deadlines.

## Next Milestones

1. Choose frontend/backend framework for the new repo.
2. Create seed data for groups, managers, teams, and World Cup matches.
3. Define the odds-to-points formulas.
4. Build manager prediction flow.
5. Build commissioner result/status admin.
6. Build leaderboard and point breakdown pages.
