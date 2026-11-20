# The daily data job and box scores: scripts/, data/

Part of the repo's notes: CLAUDE.md says which file covers what and how to keep them current. Read this before changing scripts/, data/, or how box scores load (views.js).

- `scripts/update_data.py`: daily data job (GitHub Actions, started at 08:00 UTC = 4 a.m. ET, 3 a.m. in winter, by the Worker's Cron Trigger through
  GitHub's API, `startDataJob` in worker/yahoo.js: GitHub ran the workflow's own schedule hours late, 14:54-18:12 UTC on Nov 11-16, 2026;
  the workflow's 09:23 UTC schedule is the backstop. Set up Nov 17, 2026 (the owner's fine-grained `GITHUB_TOKEN`, Actions read/write on
  this repo only; renewing it: worker/README.md "Daily data job"; an expired one shows in the error log as "Daily data job not started").
  The page still mustn't wait on the job for last night's games) builds `data/players.json` and
  `data/boxscores.json` from NBA.com CDN / ESPN / Fantrax / Sleeper's player list (each player's `nat`: NBA.com country as ISO, for the card's flag from flagcdn.com; `slpNames`, Sleeper players with no NBA.com match: docs/sleeper.md). `scripts/build_images.py`: headshot sprite (80px)
  + logos, monthly or when >5 players lack one. `scripts/archive_season.py`: one-time past-season archives.

## Gotchas
- cdn.nba.com answers GitHub runners 403: `get_json` falls back to the same files on NBA's S3 storage (`CDN_MIRROR`), so box
  scores stay NBA.com's (official; ESPN keeps stats the NBA later takes away, Fantrax follows the NBA). The last 3 days'
  games are downloaded again each run for stat corrections; ESPN copies are dropped once the NBA copy is cached.
- stats.nba.com blocks GitHub runners. Past seasons live in `data/seasons/<season>.json` + `-games.json`
  (2016-17..2025-26), made on the owner's PC. Each fall archive the season just ended:
  `python scripts/archive_season.py 2026-27`.
- Box score cache holds NBA.com and ESPN copies of games: always dedupe by date+teams (`loadBoxes` does). A load that finishes after a sport switch
  is dropped for the new sport's (`loadBoxes` checks `SPORT`: it used to put basketball's games on hockey's page, Nov 18, 2026); a tab with only box
  scores to show waits through `boxWait` (views.js: the loading card, or the failure with Try again, never "Loading" for ever).
- Box scores reach the site by month: each job keeps `boxscores.json` as its own working copy and also writes `box/<YYYY-MM>.json` beside it
  (`box_months`, update_data.py), with `box: {month: version}` in the players file; the site asks for `box/<month>.json?v=<version>` (`boxFiles`, views.js), so a
  finished month is downloaded once and only the month underway each day. A players file without `box` falls back to the one file. Nothing on the site reads `boxscores.json` otherwise.
- The site has no percentages in its data: FG%, FT% and 3P% are a player's average makes ÷ average attempts (`cur`, `l10`, `prev`), so the job keeps those
  five columns to three decimals (`season_from_boxes`; at one decimal 4-8 over 3 games read .481). The archives' (`prev`, past seasons) are NBA.com's one-decimal averages
  with those columns recomputed from the season's game lines (`fine_shooting`, archive_season.py, run with every archive).
