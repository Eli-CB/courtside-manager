# Courtside Manager: notes for working on this repo

Fantasy basketball (Fantrax, and public ESPN leagues) weekly matchup site. Static GitHub Pages site, no build step, no backend.
Live: https://eli-cb.github.io/courtside-manager/ (repo Eli-CB/courtside-manager). Owner's league:
"Keepers and Creepers" `my19c8mwmoipvhon` (9-cat H2H, most categories wins the week, weekly lineups,
8 starters + 5 bench + 1 IR, 2 keepers). Last season: `czqgnyozmf2tbr93` (2025-26).

## Layout
- `index.html`, `styles.css`, `js/*.js`. The js files are ONE script split by area and share one global
  scope; they must load in the order index.html lists: core, nba, info, fantrax, espn, render, history, views,
  matchups, live, draft, actions. Top-level code may only use things defined in earlier files (no hoisting across files).
  - core: constants, `state` (localStorage `courtside-manager-v1`), `ui`, helpers, headshots (ring + background in team colors,
    `TEAM_COLORS`; logos only where there is no photo)
  - nba: NBA data load (`data/players.json`), projections (`projectSide`, `compareCats`, `matchOdds`), category
    model (`scoreCats`, `catZ`, `BASE`: each stat's mean/spread from the data via `baseNow`, the league's teams × roster
    spots by minutes, smart blend, or a past season's archive inside `withSeason`), lineup optimizer
  - info: `INFO` texts for every (i) button (`infoBtn(key)`)
  - fantrax: `fxGet` (retries/backoff), `fxGetAll`, `fetchFantraxLeague`, league cache (`getLeague`, 6h), shared
    player list/ADP (daily), scoring (`fxScoring`: points or categories), keepers (`keepersOf`), name matching
    (`matchPlayers`), which site an ID is on (`leagueSourceOf`, `parseLeagueId`, `sourceName`), `getJson` (shared retries)
  - espn: `fetchEspnLeague` turns a public ESPN league into the same league shape (`source: 'espn'`), so every
    tab works unchanged. "fx" names (`fxLeague`, `raw.fx`, `fxTeamSide`) mean "the league's site", either one.
  - render: `render()`, league/season bar (`ctxBar`), gear menu, past-season switching (`withSeason`,
    address `#tab/<seasonLeagueId>`), `viewLeague`/`myTeamId()` override
  - history: weekly rosters (`loadRosterWeeks`, cached per league), arrivals (start/trade/pickup), season
    archives (`data/seasons/`), game logs (`loadGameLog`; `'cur'` = this season's box scores via `boxGameLog`),
    all awards, past Rosters
  - views: Dashboard (Performances: today, last game day or this week, sortable tables), Roster, Standings + Season totals, Trades, Free Agents + recommended adds
  - matchups: Matchups tab, schedule dots, stat tables, tooltips. A finished week shows no projections: its real
    result and lineups, plus bench swaps that would have changed it (`pastWeekCard`; `benchSwaps`/`weekScore` in history);
    leagues without weekly lineups (ESPN) show today's lineups labelled as such
  - live: live box scores for Performances' Today (and This week). The browser polls ESPN's site API
    (`site.api.espn.com`, CORS-open; NBA.com's live CDN isn't) about once a minute while the Dashboard is visible,
    Performances isn't set to the last game day, and games are on: scoreboard + the box score of each game in progress
    (`live.lines`: date -> NBA id -> line). ESPN players matched by `espn` id (from the daily job) else initial + last
    name + team. Yesterday and this week's earlier days missing from `data/boxscores.json` are asked for once.
  - draft: Draft tab/board, saved leagues, landing page
  - actions: `actions` (data-action handlers), event wiring, `route()`, `init()`
- `scripts/update_data.py`: daily data job (GitHub Actions 08:00 UTC = 4 a.m. ET, 3 a.m. in winter) builds `data/players.json` and
  `data/boxscores.json` from NBA.com CDN / ESPN / Fantrax. `scripts/build_images.py`: headshot sprite (80px)
  + logos, monthly or when >5 players lack one. `scripts/archive_season.py`: one-time past-season archives.
- `tests/`: `node --test tests/app.test.js` (Node built-ins only). `harness.js` loads the js files in a vm
  in page order with fake fetch (fixtures) and a fixed clock (2026-10-26 20:00 ET). Fixtures in
  `tests/fixtures` (refresh: `python tests/capture_fixtures.py`). Runs on every push (`.github/workflows/tests.yml`).

## Rules settled with the owner (keep them)
- Everything follows each league's own settings on Fantrax or ESPN (category list or point values, slots, daily
  vs weekly lineups, playoffs). Never hard-code the owner's league.
- Fantrax: minimize requests. League data cached on the device; manual ↻ Reload (gear menu) instead of
  loading fresh each visit. Weekly rosters fetched once per finished period. Shared player list/ADP once a day.
- Keepers exist only if draft rounds < roster spots (starters + bench); keepers = opening-week roster minus
  that team's picks. Past keepers are shown, never graded; never compare today's ADP to a past draft.
- Awards (current season "so far" + past seasons) all come from weekly starters (ACTIVE status) and game logs:
  Best draft (picks' games until first dropped, through trades, above replacement in cats), Best manager
  (actual wins vs all-play record), Waiver Wire Wizard (pickups' games while starting; trades excluded),
  Street Clothes (games starters missed while starting), Biggest punt / Even Steven (real season totals),
  Unc Status (starters' ages, week-weighted). Seasons never mix.
- Static explanations go in (i) popups; on-screen text stays short and specific.
- Mobile matters: check phone width (375px); no page-level sideways scroll.

## Gotchas
- ESPN (phase 1, Oct 2026): public leagues only; API is `lm-api-reads.fantasy.espn.com/apis/v3/games/fba/...`
  (the old `/apps/fantasy/v3` path answers 403). One league request (views in `ESPN_LEAGUE_VIEWS`) plus ESPN's
  player list (daily, needs the `X-Fantasy-Filter` header). ESPN sends no dates: day 1 = NBA opening night; weeks
  Monday-Sunday with the All-Star week joined to the next (verified on ESPN's schedule page: 2027 Matchup 18 =
  Feb 15-28), checked against `status.finalScoringPeriod`. Matchup numbers are ESPN's week numbers; weeks before
  `status.firstScoringPeriod` aren't the league's. Season totals, Awards and past seasons are Fantrax-only
  (`hasLineupHistory`); doing ESPN means one roster request per day (`mRoster&scoringPeriodId=N`) or its
  transactions (`mTransactions2`). ESPN doesn't say waivers vs free agent in the league data: unrostered = 'A'.
- `python serve.py` (preview config "site", port 5173) refreshes `data/` locally: never commit
  `data/players.json` / `data/boxscores.json` from a local run (`git checkout -- data/players.json data/boxscores.json`).
- stats.nba.com blocks GitHub runners. Past seasons live in `data/seasons/<season>.json` + `-games.json`
  (2016-17..2025-26), made on the owner's PC. Each fall archive the season just ended:
  `python scripts/archive_season.py 2026-27`.
- Deploy: push to main triggers the site workflow (deploy only); `gh workflow run site.yml` refreshes data.
  Commit flow used: `git pull --rebase -q origin main && git push -q origin main`, then `gh run watch`.
  Commit messages end with the Co-Authored-By line.
- `__BUILD__` in index.html and js/core.js is replaced with the commit hash at deploy (cache busting).
- Box score cache holds NBA.com and ESPN copies of games: always dedupe by date+teams (`loadBoxes` does).
- Fantrax names can differ from NBA.com ("Nicolas"/"Nic"): `matchNicknames` (initial + last name + team).
- The preview browser sometimes loses localStorage on restart (back to the landing page): reconnect the
  league by ID in the form, then pick "Eli's SGAteam".
