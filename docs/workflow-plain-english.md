# WC ANG Workflow, Plain English

This version explains how the rebuild works without assuming a developer background.

## The Short Version

The site has one page per group:

```text
/squad
/dagi-united
/tikur-abay
```

Each manager receives the link for their own group. They unlock with their manager name/code and PIN, then submit picks for open matches. The website saves those picks in Supabase, which is the new database.

The public page then reads the database, checks official match results, calculates points, and shows standings, recent results, open picks, and Prediction Pulse.

## What Happens When A Manager Opens The Page

1. The manager opens their group link.
2. The site loads that group's managers, matches, standings, recent results, and Prediction Pulse.
3. If matches are within the open prediction window, the manager can unlock and submit picks.
4. The site only lets them pick valid buttons: Team A, Tie, or Team B.
5. When they save a pick, the server checks the manager PIN, match ID, selected team, and deadline.
6. If everything is valid, the pick is saved in Supabase.
7. The manager sees a saved confirmation and can preview their current picks.

## Where Data Comes From

Supabase is the main database. It stores:

- groups
- managers
- teams
- matches
- predictions
- correction/audit history
- manual scoring events, such as Nafis starting with 20 points

FIFA's match feed is used for finished match scores. The app overlays those official scores on top of the matches stored in Supabase.

The Odds API is reserved for odds-based knockout and futures scoring later.

## How Picks Become Points

For group-stage prediction points:

- Correct team winner: 3 points
- Correct tie: 5 points
- Wrong pick: 0 points

The app checks each active prediction against finished match results. If the match is not finished yet, it gives no points yet.

Manual scoring events are added on top of prediction points. The manual column is hidden from managers, but the points still count.

## How Rank Movement Works

Rank movement compares standings after the latest finished group-stage match against standings before that match.

Example:

```text
Before latest result: Abrham was 3rd
After latest result: Abrham is 2nd
Displayed movement: ↑1
```

If a manager did not move, the site shows:

```text
-
```

This means the arrows are tied to real match updates, not random page refreshes.

## How Prediction Pulse Works

Prediction Pulse shows how managers picked after the deadline has passed.

Before the deadline:

- manager names stay hidden
- the match can still be picked if it is within the open window

After the deadline:

- manager names are revealed by selected outcome
- recent revealed matches stay visible so the group can react to the picks

## What The Commissioner Controls

The commissioner controls:

- manager PINs
- correction/admin actions
- manual scoring events
- future draft and futures entries until those are automated later

The commissioner can correct a pick from the admin page. Corrections are saved in the audit log with old pick, new pick, who changed it, and reason.

## What Is Still Good To Keep As Backup

For the first few matchdays, keep the spreadsheet process as a backup. The new site is designed to replace manual prediction collection, but it is smart to compare totals until everyone trusts the workflow.

