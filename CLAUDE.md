# League Layer: notes for working on this repo

Fantasy basketball (Fantrax, public ESPN leagues, Sleeper) weekly matchup site. Static GitHub Pages site, no build step, no backend.
Live: https://leaguelayer.com (domain on Cloudflare, DNS only, set in the repo's Pages settings; the old
eli-cb.github.io/courtside-manager/ link redirects there) (repo Eli-CB/courtside-manager:
the site was Courtside Manager until Oct 2026; the repo and every `courtside-*` storage key keep the old name so nobody's
saved leagues are lost). Owner's league:
"Keepers and Creepers" `my19c8mwmoipvhon` (9-cat H2H, most categories wins the week, weekly lineups,
8 starters + 5 bench + 1 IR, 2 keepers). Last season: `czqgnyozmf2tbr93` (2025-26).

## Layout
- `index.html`, `styles.css`, `js/*.js`. The js files are ONE script split by area and share one global
  scope; they must load in the order index.html lists: core, nba, info, fantrax, espn, sleeper, yahoo, render, history, views,
  matchups, recap, live, draft, actions. Top-level code may only use things defined in earlier files (no hoisting across files).
  - core: constants, `state` (localStorage `courtside-manager-v1`), `ui`, helpers (every time of day through `fmtTime`:
    the gear menu's 24-hour toggle, `courtside-clock`, else the device's own clock), headshots (ring + background in team colors,
    `TEAM_COLORS`; logos only where there is no photo)
  - nba: NBA data load (`data/players.json`), projections (`projectSide`, `compareCats`, `matchOdds`), category
    model (`scoreCats`, `catZ`, `BASE`: each stat's mean/spread from the data via `baseNow`, the league's teams × roster
    spots by minutes, smart blend, or a past season's archive inside `withSeason`), lineup optimizer. Player value
    (`value`, `lineValue` for a game) everywhere = categories won per game against not playing (`catWins`: each
    category's share of an average team's week over the spread of weekly margins); trades count it over a waiver
    player (`waiverValue`). `catZ` (vs an average rostered player) is only for shading
  - info: `INFO` texts for every (i) button (`infoBtn(key)`)
  - fantrax: `fxGet` (retries/backoff), `fxGetAll`, `fetchFantraxLeague`, league cache (`getLeague`, 6h), shared
    player list/ADP (daily), scoring (`fxScoring`: points or categories), keepers (`keepersOf`), name matching
    (`matchPlayers`), which site an ID is on (`leagueSourceOf`, `parseLeagueId`, `sourceName`), `getJson` (shared retries)
  - espn: `fetchEspnLeague` turns a public ESPN league into the same league shape (`source: 'espn'`), so every
    tab works unchanged. "fx" names (`fxLeague`, `raw.fx`, `fxTeamSide`) mean "the league's site", either one.
  - sleeper: `fetchSleeperLeague` (api.sleeper.app, CORS-open, no sign-in; IDs are 15-20 digits, `source: 'sleeper'`).
    Sleeper basketball is points only and counts ONE game a week per lineup slot (Lock-In: the game locked in after it's
    played, else the last of the week; Game Pick: the one picked): `L.oneGame`, `isOneGame()`. Projections (`oneGameSide`
    in nba.js: one game per starter, the best fill the slots), `weekGames`/`weeklyPriority` (1 game at most) and the
    Dashboard's period score (`oneGameLine`: the game nearest Sleeper's points for him this week, `L.slpWeek`, asked for
    again every 2 min by `sleeperWeekFresh`) follow it; no Daily bench swaps card. Weeks: Monday-Sunday from opening
    night, no All-Star exception (checked against 2025-26's weekly points); playoffs a week a round. Players are named
    only by Sleeper ids: the daily job gives each player `slp` (+ `slpPos`, Sleeper's positions, which its lineups follow).
    Fixtures: `tests/capture_sleeper_fixtures.py` (names anonymized). Awards, Recap, Season totals and past-week cards run
    on Sleeper's weekly matchups (`hasLineupHistory`; `loadRosterWeeks` keeps [id, starting, points] per player and the
    week's pairings under '#m', which fill `L.matchups`): `countedRows` keeps a starter's one counted game (nearest
    Sleeper's points, `countedIndex`; none when Sleeper says 0), a bench swap puts in the bench player's best game, Street
    Clothes counts empty starts, and the Recap has no Game of the week / Worst week. A game's Sleeper bonuses (40-point games...)
    ride along as `bonus` on game lines (`withBonus`, added by `lineFp`), so weekly scores match Sleeper's within techs and
    stat corrections. Past seasons stay Fantrax-only.
  - yahoo: Yahoo leagues through a Yahoo login (OAuth): the helper server `worker/yahoo.js` (Cloudflare Worker at
    api.leaguelayer.com, setup in `worker/README.md`) runs the sign-in and passes API requests through (Yahoo's API isn't
    CORS-open); tokens stay in the browser (`courtside-yahoo`). `yahoo.proxy` empty = Yahoo hidden; while `yahoo.beta`, the sign-in shows only on a device that opened `?yahoo=1` (or is signed in). `yflat` turns Yahoo's
    JSON ("0","1"…+count objects, arrays of one-key objects) into plain lists/objects; `fetchYahooLeague` maps to the league
    shape (`source: 'yahoo'`, ids = league keys `nba.l.N`). Test fixtures are made up in Yahoo's layout
    (`tests/make_yahoo_fixtures.py`): check against a real league once signed in.
  - render: `render()`, league/season bar (`ctxBar`), gear menu, past-season switching (`withSeason`,
    address `#tab/<seasonLeagueId>`), `viewLeague`/`myTeamId()` override
  - history: weekly rosters (`loadRosterWeeks`, cached per league), arrivals (start/trade/pickup), season
    archives (`data/seasons/`), game logs (`loadGameLog`; `'cur'` = this season's box scores via `boxGameLog`),
    all awards (every award but Biggest punt and Even Steven: a team's name opens a breakdown: `awardDetails`, `award-team`), past Rosters
  - views: Dashboard (`dashMatchupCard`: Today / Yesterday show only who plays that day, each side one gapless column: starters, bench (tagged), Out/DNP;
    This period (the league's own) slot by slot; big score = period so far, ties count half, category table + each starter's game and line; then
    this week's waiver moves (`periodMoves`: last period's rosters vs this one's, Fantrax only), action items and injuries), Roster,
    Standings + Season totals, Trades, Players tab (`#players`, was Free Agents): one table (`topPerformancesCard`) of every NBA stat line of
    today / last game day / this week / this season (added up), or Per game (`seasonRows`: averages from the Stats used basis); top 300 for the season ranges, 100 otherwise; search, position and NBA team (pill-style menus), Rookies / Injured toggles,
    team / Active / Bench / Waivers filters, ranked by value; then recommended adds. Player card: under his fantasy team, how he got there (`cardHow`: Keeper / Drafted round, pick / Waiver add / Traded from, with the week, from the weekly rosters; ESPN: the draft only)
  - matchups: Matchups tab, schedule dots, stat tables, tooltips. A finished week shows no projections: its real
    result and lineups, plus bench swaps that would have changed it (`pastWeekCard`; `benchSwaps`/`weekScore` in history);
    leagues without weekly lineups (ESPN) show today's lineups labelled as such
  - A week is over (`periodOver`) at its end or once its last game day's box scores are all in: Fantrax ends a weekly
    period Monday evening when the next locks, a day after its last games. Recap, awards, past-week cards use it.
  - recap: Recap tab: a finished week across the league (Player/Game of the week, Worst week (worst per game, 2+ G), Worst game, Street clothes (most games missed while starting), with full lines in the league's cats,
    bench regret, best all-play week, then every final) from `benchSwaps` on the shared `pastWeeksOf` data; Share sends the standouts +
    a link `?league=<id>&week=<n>#recap` (`openSharedLink` connects the league, asks for the team, then shows it).
    Fantrax and Sleeper. The Dashboard offers it for 3 days after a week ends (`freshRecap`)
  - live: live box scores for the Dashboard matchup's and Performances' Today (and This week). The browser polls ESPN's site API
    (`site.api.espn.com`, CORS-open; NBA.com's live CDN isn't) every 30 s (60 s with Save-Data) while the Dashboard or Players tab is visible,
    it isn't set to the last game day (`ui.dashRange` / `ui.perfRange`), and games are on: scoreboard + the box score of each game in progress
    (`live.lines`: date -> NBA id -> line). ESPN players matched by `espn` id (from the daily job) else initial + last
    name + team. Yesterday and this week's earlier days missing from `data/boxscores.json` are asked for once.
  - draft: Draft tab/board, saved leagues, landing page. Drafts are graded on the games of the league's own season
    (`leagueSeason`: first week to last, playoffs included; `draftSeason`/`windowStats` from that season's game log), not
    the NBA's full season: past seasons always, this season once the league is over or if it started late. Seasons: the league menu lists the current league's seasons
    under it (`season-pick`/`season-add`); the bar under the tabs only picks a team. The league form (`connectLeague`)
    files an earlier season (year < `NBA.season`, or a later season of the same Fantrax `historyId` is here) under its
    league in `state.pastSeasons[historyId]`, never as a league; `foldPastSeasons` moves old duplicates there
  - actions: `actions` (data-action handlers), event wiring, `route()`, `init()`
- `scripts/update_data.py`: daily data job (GitHub Actions 08:00 UTC = 4 a.m. ET, 3 a.m. in winter) builds `data/players.json` and
  `data/boxscores.json` from NBA.com CDN / ESPN / Fantrax / Sleeper's player list (each player's `nat`: NBA.com country as ISO, for the card's flag from flagcdn.com). `scripts/build_images.py`: headshot sprite (80px)
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
  that team's picks. Keepers are graded as the #5 and #15 picks: this season the better one by ADP, a past season by
  the season before's value per game (`L.priorSeason` archive); never compare today's ADP to a past draft.
- Awards (current season "so far" + past seasons) all come from weekly starters (ACTIVE status) and game logs:
  Best draft (picks' games until first dropped, through trades, above replacement in cats), Best manager
  (actual wins vs all-play record), Waiver Wire Wizard (pickups' games while starting; trades excluded),
  Street Clothes (games starters missed while starting), Biggest punt / Even Steven (real season totals),
  Unc Status (starters' ages, week-weighted), Steal / Bust of the Draft (one pick vs its rank over the season, Draft
  tab's Season totals; keepers excluded), Week of the Year (best all-play week), Heartbreak Hotel (losses by one
  category; points: under 5% of the winner), Benchwarmer Blues (bench players' games), Fan Boy (biggest share of
  starts from one NBA team). Seasons never mix.
- Static explanations go in (i) popups; on-screen text stays short and specific.
- Mobile matters: check phone width (375px); no page-level sideways scroll.

## Gotchas
- ESPN (phase 1, Oct 2026): public leagues only; API is `lm-api-reads.fantasy.espn.com/apis/v3/games/fba/...`
  (the old `/apps/fantasy/v3` path answers 403). One league request (views in `ESPN_LEAGUE_VIEWS`) plus ESPN's
  player list (daily, needs the `X-Fantasy-Filter` header). ESPN sends no dates: day 1 = NBA opening night; weeks
  Monday-Sunday with the All-Star week joined to the next (verified on ESPN's schedule page: 2027 Matchup 18 =
  Feb 15-28), checked against `status.finalScoringPeriod`. Matchup numbers are ESPN's week numbers; weeks before
  `status.firstScoringPeriod` aren't the league's. Season totals, Awards and past seasons are Fantrax/Sleeper-only
  (`hasLineupHistory`); doing ESPN means one roster request per day (`mRoster&scoringPeriodId=N`) or its
  transactions (`mTransactions2`). ESPN doesn't say waivers vs free agent in the league data: unrostered = 'A'.
- `python serve.py` (preview config "site", port 5173) refreshes `data/` locally: never commit
  `data/players.json` / `data/boxscores.json` from a local run (`git checkout -- data/players.json data/boxscores.json`).
- cdn.nba.com answers GitHub runners 403: `get_json` falls back to the same files on NBA's S3 storage (`CDN_MIRROR`), so box
  scores stay NBA.com's (official; ESPN keeps stats the NBA later takes away, Fantrax follows the NBA). The last 3 days'
  games are downloaded again each run for stat corrections; ESPN copies are dropped once the NBA copy is cached.
- stats.nba.com blocks GitHub runners. Past seasons live in `data/seasons/<season>.json` + `-games.json`
  (2016-17..2025-26), made on the owner's PC. Each fall archive the season just ended:
  `python scripts/archive_season.py 2026-27`.
- Deploy: push to main triggers the site workflow (deploy only); `gh workflow run site.yml` refreshes data.
  Commit flow used: `git pull --rebase -q origin main && git push -q origin main`, then `gh run watch`.
  Commit messages end with the Co-Authored-By line.
- `__BUILD__` in index.html and js/core.js is replaced with the commit hash at deploy (cache busting).
- Traffic: Cloudflare Web Analytics (no cookies), its beacon added at the end of index.html on leaguelayer.com only
  (the domain is DNS-only, so Cloudflare can't inject it). Stats: dash.cloudflare.com → Web Analytics.
- Fantrax rate limits answer 200 OK with `{ error: { code: 'RATE_LIMITED', message: '... at most once every 5 seconds per
  IP address.' } }` (getDraftResults: 5 s): `getJson` waits what it says and asks again; a draft that still doesn't come
  marks the league `draftFailed` (not kept on the device; Draft tab offers Try again), never "no draft".
- Box score cache holds NBA.com and ESPN copies of games: always dedupe by date+teams (`loadBoxes` does).
- Fantrax names can differ from NBA.com ("Nicolas"/"Nic"): `matchNicknames` (initial + last name + team).
- The preview browser sometimes loses localStorage on restart (back to the landing page): reconnect the
  league by ID in the form, then pick "Eli's SGAteam".
