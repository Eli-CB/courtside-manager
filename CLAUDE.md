# League Layer: notes for working on this repo

Fantasy basketball (Fantrax, public ESPN leagues, Sleeper), hockey (Fantrax) and football (Sleeper, part of the site so far) weekly matchup site. Static GitHub Pages site, no build step, no backend.
Live: https://leaguelayer.com (domain on Cloudflare, DNS only, set in the repo's Pages settings; the old
eli-cb.github.io/courtside-manager/ link redirects there) (repo Eli-CB/courtside-manager:
the site was Courtside Manager until Oct 2026; the repo and every `courtside-*` storage key keep the old name so nobody's
saved leagues are lost). Owner's league:
"Keepers and Creepers" `my19c8mwmoipvhon` (9-cat H2H, most categories wins the week, weekly lineups,
8 starters + 5 bench + 1 IR, 2 keepers). Last season: `czqgnyozmf2tbr93` (2025-26).

## Layout
- `index.html`, `styles.css`, `js/*.js`. The js files are ONE script split by area and share one global
  scope; they must load in the order index.html lists: sports, core, nba, info, fantrax, espn, sleeper, football, yahoo, render, history, views,
  dashboard, players, matchups, recap, live, draft, actions. Top-level code may only use things defined in earlier files (no hoisting across files).
  - sports: `SPORTS` (each sport's positions, slots, stats, categories, team colors, data folder, ESPN feed) and `setSport`, which
    points the plain names the site reads (`POSITIONS`, `ELIG`, `STAT_LABEL`, `COUNT_KEYS`, `TEAM_COLORS`...) at a sport's tables.
    "NBA", `nbaId`, `nbaPlayers` and the like mean "the sport's data" (as "fx" names mean "the league's site")
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
    ESPN football (`fetchEspnFootball`, `sport: 'nfl'`): an ID ESPN answers 404 as basketball is asked for as football (one extra request). Weeks are NFL weeks from
    the file's `weeks` (ESPN's scoring periods), players the file's by `espn` id (the job matches ESPN's player list by name and team: Sleeper's has a quarter of
    them; a D/ST is -16000 less its team's number, `espnFootballId`), scoring `ESPN_FFL_STATS` (ESPN stat id -> the data's names; D/ST-only stats at ESPN's
    D/ST points; a TE/RB/WR reception premium as Sleeper's bonus_rec_*). The job adds ESPN's own points-allowed brackets (14-17, 18-21, 22-27, 35-45, 46+)
    and `def_fum_rec` (special teams' included) to a defense's lines (`espn_defense`). Checked on a real league: 1,169 of 1,170 player-weeks matched ESPN's
    points (the one: a sack counted differently). Live points: ESPN's per week, in `L.slpWeek` like Sleeper's (`espnWeekFresh`, `leagueWeekFresh`, every 30 s).
    Category football isn't read. No Recap, Awards or Season totals (as ESPN basketball).
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
  - football: a player's week (`footballProj`, `footballNow`, `footballEntry`), lineups (`bestFootballIds`), live points (`footballLines`). Other files branch on `isFootball()` and call these.
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
  - views: Standings (+ Category strengths, `strengthsCard`, and Season totals; the Roster tab is gone, `#roster` and `#lineup` land here), Trades, shared table helpers, box score loading. A fantasy team's name anywhere (`teamLink`, core.js; plain in past seasons and inside menus) opens its card (`showTeamCard`/`teamCardHtml`: record, this week's opponent, category ranks, roster by spot, Compare on Plan Ahead) in the player card's dialog.
  - dashboard: the Matchup tab (`#dashboard`, was Dashboard; `dashMatchupCard`: Today / Yesterday show only who plays that day, each side one gapless column: starters, bench (tagged), Out/DNP;
    This period (the league's own) slot by slot; big score = period so far, ties count half, category table + each starter's game and line; then
    one-line folds that open on tap (`dashFold`, open ones kept in `ui.dashFolds`): a fresh recap (`recapFold`), this week's waiver
    moves (`periodMoves`: last period's rosters vs this one's, Fantrax only) and injury news; then action items).
  - players: Players tab (`#players`, was Free Agents): one table (`topPerformancesCard`) of every NBA stat line of
    a menu of Today / Yesterday (the last game day) / This period / This season (football: Projected first), and for a period or the season a Totals / Per game toggle (`ui.perfPer`; the season per game is `seasonRows`, averages from the Stats used basis, internally range 'avg'; a period's is its games averaged); top 300 for the season ranges, 100 otherwise; search, position and NBA team (pill-style menus), Rookies / Injured toggles,
    search, then one Filters button (`ui.perfFiltOpen`, counts the ones on) opening a panel: Show toggles (`ui.perfWhose`: me, opp, other, fa, any together, never none), Lineup All / Active / Bench (`ui.perfSpot`, rostered players only: waivers have no lineup), position, NBA team, Rookies, Injured, Show more (100 at a time), ranked by value (pickup ideas are only on Matchups). Player card: under his fantasy team, how he got there (`cardHow`: Keeper / Drafted round, pick / Waiver add / Traded from, with the week, from the weekly rosters; ESPN: the draft only)
  - matchups: the Plan Ahead tab (`#week`, was Matchups; opens on next week until a week is picked: `planAheadWeek`, `ui.weekChosen`), schedule dots, stat tables, tooltips. A finished week shows no projections: its real
    result and lineups, plus bench swaps that would have changed it (`pastWeekCard`; `benchSwaps`/`weekScore` in history);
    leagues without weekly lineups (ESPN) show today's lineups labelled as such
  - A week is over (`periodOver`) at its end or once its last game day's box scores are all in: Fantrax ends a weekly
    period Monday evening when the next locks, a day after its last games. Recap, awards, past-week cards use it.
  - recap: Recap tab: a finished week across the league (Player/Game of the week, Worst week (worst per game, 2+ G), Worst game, Street clothes (most games missed while starting), with full lines in the league's cats,
    bench regret, best all-play week (categories only); points leagues add Carried (biggest share of a team's points, 20%+), Tough luck / Lucky win (best losing / worst winning score, on the wrong side of the middle) and Nail-biter (closest final under 5% of the winner, not a game already told as luck); hockey Goalie of the week and Hat trick, football Defense of the week; then every final) from `benchSwaps` on the shared `pastWeeksOf` data; Share opens a popup with the
    recap as a picture (`recapCanvas`: 1080 px PNG on a canvas, headshots from the sheet `IMG.sheet`; Share image / Copy image / Save
    image) or the text: the standouts + a link `?league=<id>&week=<n>#recap` (`openSharedLink` connects the league, asks for the team, then shows it).
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
  - Demo (`state.demo`, the landing page's "Explore a basketball demo league"): the daily file's site league, seen as a team (`demoTeam`: the
    best record with a matchup) so every tab has something to show, it and its teams under made-up names (`demoNames`, in memory only); never in `savedLeagues`, the team picker changes the team, `demo-exit` or
    connecting any league ends it and keeps nothing (`switchLeague`'s `fromDemo`).
  - No league (`state.browse`, the landing page's "Just browse players"): `fxLeague()` is null (the daily file's site
    league stays loaded for the demo), `clearLeaguePlayers()` drops its rosters/positions from the players, the tabs are
    just Players (`TABS_BROWSE`), valued for a standard 9-cat league; "Connect a league" (`browse-exit`) or connecting
    any league ends it. Code reading `state.fxTeam` must expect undefined there (a first visit), not only null.
- `scripts/update_data.py`: daily data job (GitHub Actions 08:00 UTC = 4 a.m. ET, 3 a.m. in winter) builds `data/players.json` and
  `data/boxscores.json` from NBA.com CDN / ESPN / Fantrax / Sleeper's player list (each player's `nat`: NBA.com country as ISO, for the card's flag from flagcdn.com). `scripts/build_images.py`: headshot sprite (80px)
  + logos, monthly or when >5 players lack one. `scripts/archive_season.py`: one-time past-season archives.
- NFL (Sleeper leagues only; stages 1-3 of 5 done: data; Standings, Dashboard scores, Recap, Awards, past weeks; then projections on Matchups, Roster and
  Players. `soonTabs` hides Draft and Trades. Next: Draft, Trades, past seasons, then Fantrax). `scripts/update_nfl.py` (own step in the daily job, as hockey's) builds `data/nfl/`: players from Sleeper's list (too big for a browser: 14 MB), schedule
  from ESPN, stats by week from Sleeper's undocumented `api.sleeper.com/stats`. A game counts only with its `gp`: `gms_active` is on for anyone on an active roster, injured starters included. A line's stats keep Sleeper's names, the same as a league's `scoring_settings`, so
  `L.points` is simply those settings and `lineFp` gives the league's exact points, bonuses and defense brackets included: 80 team-weeks of a real league matched Sleeper's
  to the hundredth. `statKeys` come from the file (`fetchSport` fills `countKeys`, `playerKeys`). A league is `oneGame`, which already means one game a week per slot, with no
  Game of the week. Weeks are Tuesday to Monday (`weekShift`, in `dayOffset`), from the file's `weeks`. During a game the points come from Sleeper's matchups (`footballLines`:
  lines holding only `bonus`), every 30 s; ESPN gives only the game clock (scoreboard, no box scores). A team defense is a player, id 900000 + its team's index, `slp` its code.
  Projections: the job adds Sleeper's weekly feed (Rotowire's numbers, also undocumented) as `raw.proj[week]`, in `projKeys` order, for 3 weeks (`projWeeks`), with the stat names of a
  league's scoring, so `footballPts` is exact in any scoring; kicks are renamed to match (`projected`). A week not in the file uses season averages, and so does a failed feed.
  `perGame` isn't used: `footballEntry` is a player's week (`footballProj`, `footballNow`: real points, plus the projection for the time left), `oneGameSide` adds them up, `fpTotals` takes the
  spread from `projSd` (sports.js; real misses × 0.8, to match 40 real matchups' margins). Matchups counts as weekly lineups, but `bestFootballIds` locks player by player as each game starts;
  the page follows the week's games live, as the Dashboard does. Adds and pickups replace the weakest at the same position. Checked on a real league's 80 team-weeks, weeks 1-8: projected
  110.8 a week, scored 110.1, team-week miss 19.5, favorites won 25 of 40. (i) texts: `infoOver` in sports.js.
- NHL (Fantrax leagues only; every tab and past seasons, as basketball; "Just browse" and the demo are NBA only). Goalies: a team's game isn't each
  goalie's. `startChance(p, d)` (nba.js) is 1 for skaters; a goalie's comes from `startChain(team)`, game by game from the team's last
  (`teams[t].lg`): his share of recent starts (`raw.st`, `goalie_shares` in the job; roster goalies only, anyone Out shares nothing), cut
  for whoever started the game before (×0.1 on a back-to-back: the same goalie started the second night 7% of the time in 2025-26;
  ×0.8 otherwise), and ESPN's named starter (`g.goalies` from the scoreboard's `probables`: Confirmed is certain, Expected counts
  75%). `projectSide`, `weeklyPriority`, `weekGames` (to a tenth) and the Dashboard's pace use it; value stays per game played
  (`gameWorth` for a trade or lineup: value × share). Street Clothes and Missed skip goalies: a healthy backup sits most games. Checked on 48
  real team-weeks: goalies scored 4.7 a week, every-game projected 8.1, this 5.2 (average miss 3.8 to 2.0). Category leagues were
  only tested on a made-up scoring setup: no real hockey category league yet. A Fantrax league's sport comes from its scoring groups (`fxSport`:
  `HOCKEY_SKATING`, Fantrax doesn't name it). `fetchFantraxLeague` reads a league against that sport's data file
  (`fetchSport`) without changing the page; `switchLeague` then swaps sports (`useSport`, with `ui.hold` stopping `render` until the
  league is in place; a league that fails puts the sport back). `state.sport` picks the tables before a saved state is read.
  `scripts/update_nhl.py` (same daily job, its own step, a failure there doesn't stop the NBA data) builds `data/nhl/` laid out
  like `data/`: `players.json` (+ `sport: 'nhl'`), `boxscores.json` (+ `keys`, `who`, each game's `last`: REG/OT/SO), `headshots.webp` +
  `images.json` (`build_images.py nhl`), `seasons/<season>.json` + `-games.json` (2016-17 on, last season made by the job, older ones with
  `update_nhl.py --archive 2016-17 2024-25`; each fall's new one needs nothing). From NHL.com's stats API by date range,
  not box scores, which lack faceoffs, power-play assists and game-winning goals. One stat row fits skaters and goalies
  (`LINE_KEYS`; box rows drop trailing zeros); a goalie's goals, assists and PIM are `gg`, `ag`, `gpim`, as leagues score them
  apart, and `gt` is his hours played (GAA is a `pct` category with `rate` and `neg`). Shootout losses (`sol`) are apart from
  overtime losses (`otl`), as on Fantrax. Checked: every team's fantasy points through week 6 of a real league, from the weekly lineups
  as Recap and Awards count them, matched Fantrax's `totalPointsFor` within 0.2 (that total includes the week in progress). Weeks: Monday-Sunday from opening night. Regular
  season only. Names need team and role: two Sebastian Ahos, and two Elias Petterssons on Vancouver (ESPN's "Elias N."; Fantrax's
  C vs D; `hockeyRole`). A namesake with no data here must not take a player's id (`matchPlayers`: two entries on one player, the
  one on his team in his role keeps him; `homePos` is the NHL's position, as a league's overwrites `pos`). Long-term injured aren't on NHL rosters: ESPN's rosters and injury report put them on a team. Tests:
  `tests/test_update_nhl.py` (Python), the last tests in `app.test.js`; fixtures from `tests/capture_nhl_fixtures.py` (team names replaced).
- Logo ("Sheet": two tilted Ls, the second a thin edge under the first; "Ink" colors, chosen for now): `scripts/build_icons.py` draws it and writes `icons/logo.svg`,
  `icons/favicon.svg` (a 16 px cut with a wider gap and no background, the first L dark on a light tab and white on a dark one, also inline in index.html: copy it there if it changes) and the three PNGs. On a home screen the mark stays inside the middle 80% circle.
- Home screen: `manifest.webmanifest` + `icons/` + the tags in index.html make the site install full screen (`canInstall`, the settings menu's Install the app:
  the browser's offer, or steps for an iPhone, which keeps the app's storage apart from Safari's, so a league is connected once more there). No service worker on purpose: every
  visit is the live site. An installed app has no refresh button, so returning after 3 hours reloads it (`appStale`).
- `tests/`: `node --test tests/app.test.js` (Node built-ins only). `harness.js` loads the js files in a vm
  in page order with fake fetch (fixtures) and a fixed clock (2026-10-26 20:00 ET). Fixtures in
  `tests/fixtures` (refresh: `python tests/capture_fixtures.py`). Every run of the site workflow, data runs too, tests
  what's on main in its `test` job, and publishes exactly that commit only if they pass (`site.yml`; `tests.yml` covers pull requests).

## Rules settled with the owner (keep them)
- Everything follows each league's own settings on Fantrax or ESPN (category list or point values, slots, daily
  vs weekly lineups, playoffs). Never hard-code the owner's league.
- Weekly lineups lock when the week starts, so the lineup people are setting is next week's: Fantrax leagues with weekly
  lineups also load next period's rosters (`L.nextRosters`, one more request; the daily job too), and the Matchups tab
  shows them on next week (`withViewedTeam(viewWeek, true)`, `nextRosterPeriod()`, `fxTeamSide(tid, period)`). Every
  other tab and the saved lineup stay on this week's.
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
- The look (Nov 2026, chosen from a mock): shadcn/ui-style, in styles.css alone: zinc neutrals (`--bg`, `--surface`, `--border`, `--text`, `--muted`, `--ring`), Inter served from `fonts/` (OFL), quiet tabs, grey-track toggles with the chosen one raised, dark primary buttons, filters filled dark when on. Orange (`--accent`) is only for your own team and team things; player names stay black. Phones (Nov 2026): sections run edge to edge with a line between (no boxes or gaps), and those after a tab's first one with a heading roll up to it (`rollCards`, render.js; open ones in `ui.rollOpen`; not Trades or award cards). A tab's own (i) is on the tab bar (`TAB_INFO`), not over its first card.

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
- Deploy: push to main triggers the site workflow (deploy only); `gh workflow run site.yml` refreshes data. Each sport's refresh
  runs apart; one that fails (or NFL projections failing) fails the run at the end, so GitHub says so, and the rest still publishes.
  Commit flow used: `git pull --rebase -q origin main && git push -q origin main`, then `gh run watch`.
  Commit messages end with the Co-Authored-By line.
- `__BUILD__` in index.html and js/core.js is replaced at deploy with the hash of the last commit that changed `index.html`, `styles.css` or `js/` (cache busting; not the latest commit: the daily data commits mustn't make visitors download the code again).
- Errors: on leaguelayer.com, `reportError` (core.js, from window `error` / `unhandledrejection` in our own js files,
  each once a visit, 5 at most) posts to the Worker's `/errors` (KV `ERRORS`, 30 days); the owner reads
  `api.leaguelayer.com/errors?key=<ERRORS_KEY>` (setup in `worker/README.md`). The footer says so, with the not-affiliated line.
  Caught errors don't reach it by themselves: ESPN's live feed failing 3 updates in a row does, as "ESPN live scores failing" (`noteLiveFailure`:
  a block, or a new format the site can't read; not the visitor's own connection). If that shows up: `SPORT.espn` in sports.js is where the feed is read.
- Traffic: Cloudflare Web Analytics (no cookies), its beacon added at the end of index.html on leaguelayer.com only
  (the domain is DNS-only, so Cloudflare can't inject it). Stats: dash.cloudflare.com → Web Analytics.
- Fantrax rate limits answer 200 OK with `{ error: { code: 'RATE_LIMITED', message: '... at most once every 5 seconds per
  IP address.' } }` (getDraftResults: 5 s): `getJson` waits what it says and asks again; a draft that still doesn't come
  marks the league `draftFailed` (not kept on the device; Draft tab offers Try again), never "no draft".
- Box score cache holds NBA.com and ESPN copies of games: always dedupe by date+teams (`loadBoxes` does).
- Fantrax names can differ from NBA.com ("Nicolas"/"Nic"): `matchNicknames` (initial + last name + team).
- The preview browser sometimes loses localStorage on restart (back to the landing page): reconnect the
  league by ID in the form, then pick "Eli's SGAteam".
