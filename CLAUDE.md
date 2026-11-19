# League Layer: notes for working on this repo

Fantasy basketball (Fantrax, public ESPN leagues, Sleeper), hockey (Fantrax) and football (Sleeper, part of the site so far) weekly matchup site. Static GitHub Pages site, no build step, no backend.
Live: https://leaguelayer.com (domain on Cloudflare, DNS only, set in the repo's Pages settings; the old
eli-cb.github.io/courtside-manager/ link redirects there) (repo Eli-CB/league-layer, renamed from courtside-manager Nov 16, 2026:
GitHub redirects the old name as long as no new repo takes it. The site was Courtside Manager until Oct 2026; its storage keys were
`courtside-*` until Nov 16, 2026 and are `league-layer-*` now, renamed with nothing carried over, as the owner was the only visitor: with
real visitors, a renamed key needs its old copy moved first, or their saved leagues are gone). Owner's league:
"Keepers and Creepers" `my19c8mwmoipvhon` (9-cat H2H, most categories wins the week, weekly lineups,
8 starters + 5 bench + 1 IR, 2 keepers). Last season: `czqgnyozmf2tbr93` (2025-26). The owner's Sleeper league (Nov 18, 2026), free to
test with: "The IPA" `1336466264633135104` (16-team dynasty, points, Lock-In, 2 IR + 2 taxi spots, a 3-round rookie draft, picks traded through 2028).
The owner's ESPN test leagues (Nov 19, 2026; public, the owner's team in both is "Eli's Excellent Team"; 10 teams, 8 cats without TO, daily lineups, 10 starters + 3 bench + 1 IR):
"Utah Pro H2H Categories League" `1715452380` (starts Nov 23 as Matchup 6: a late league keeps ESPN's week numbers, as ESPN's own schedule page shows) and
"Sacramento Beginner Roto League" `1299985004` (roto, which the site doesn't do: it loads with no periods, empty W-L standings and no opponent; ESPN's
roto standings are each team's `points`/`pointsByStat`, and its one schedule entry lists `teams`, no home/away).

## Keeping this file up to date (the owner's standing rule, Nov 2026)
Whenever you learn something that any Claude starting on this site for the first time would need, add it here in the
same piece of work, without being asked: a decision the owner made and why, a rule for how something must behave, a
gotcha that cost time (an API's quirk, a limit, something that fails silently), where a new feature lives and which
functions own it, a check done against real data, a step that is the owner's alone. Put it in the section it belongs to
(Layout, Rules settled with the owner, Gotchas), fix or remove a line your change made wrong rather than adding a second
one, and keep it short and specific. Not for here: what only matters to the task at hand, or what the code already says plainly.
Most changes add nothing: a one-off tweak to how something looks (a bigger player card, a moved button, a new size or
spacing) isn't site knowledge unless the owner states it as a rule to keep. The file must stay small enough to read whole,
so when unsure, leave it out, and an addition should be a line or two, not a paragraph.

## Layout
- `index.html`, `styles.css`, `js/*.js`. The js files are ONE script split by area and share one global
  scope; they must load in the order index.html lists: sports, core, nba, info, fantrax, espn, sleeper, football, yahoo, render, history, views,
  dashboard, players, matchups, recap, trends, share, live, draft, leagues, sandbox, actions. Shared builders (Nov 18, 2026): every row of on/off buttons is `segBtns` (core.js), every sortable table's order `sortRows` (views.js: empty cells last), whose a player is `rosterOwners`/`ownerTag`/`faBadge` (players.js, the sandbox's My team included). Top-level code may only use things defined in earlier files (no hoisting across files), and no two files may declare the same function: a later file's silently replaces the earlier one everywhere (history.js's `periodDays` once broke every week's dates; a test checks).
  - sports: `SPORTS` (each sport's positions, slots, stats, categories, team colors, data folder, ESPN feed) and `setSport`, which
    points the plain names the site reads (`POSITIONS`, `ELIG`, `STAT_LABEL`, `COUNT_KEYS`, `TEAM_COLORS`...) at a sport's tables.
    "NBA", `nbaId`, `nbaPlayers` and the like mean "the sport's data" (as "fx" names mean "the league's site")
  - core: constants, the cache registry (`keep(from, reset)` beside each cache's declaration, `changed('sport' | 'box' | 'league' | 'players', leagueId)` wherever one of
    those changes: never clear another file's cache by hand; a new cache signs up with `keep`), `withState(over, fn)` (the one place the page's state is swapped: a draw as
    another team or with next week's lineups, `withViewedTeam`; fn mustn't wait, and `save` refuses meanwhile), `state` (localStorage `league-layer-v1`), `ui`, `store` (every localStorage read and write: blocked or full storage gives the fallback / does nothing), `isPhone()` (the 640 px phone layout), `themeNow()`, helpers (every time of day through `fmtTime`:
    the gear menu's 24-hour toggle, `league-layer-clock`, else the device's own clock), headshots (`headshot`: the team's logo faded
    behind the face, as on the player card, and a thin gray edge, the owner's asks, Nov 2026: no ring in team colors; one `--logo` rule a team from
    `logoRules`, never the logo in each photo's HTML; a logo alone, `teamLogo`, only where there is no player; `hsPx(desktop, phone)` sizes them). `playerBtn(id, name)`: a player's name as the button that opens his card (his photo too: `data-photo` on every headshot, actions.js; not inside a `label`, where the row is a checkbox); `teamBtn(tri)` / `linkTeams(html)`: a team's code (in a line's text, not its tags) as a link to that team's card ('sport-team', `showSportTeamCard` in players.js; its record from `teamRecord`: the box scores' finals, then today's once over on ESPN's scoreboard; hockey W-L-OT from each final's `last`; checked against ESPN's records; then, the owner's ask, "Playoff Games: 3-4-4-3-4", its games in each of the league's playoff periods still to play, `playoffSlate` in nba.js, a row of its own on phones; its foot links to the Players tab filtered by the team, 'team-players'). The player card: `pc-who` (fantasy team and how he got there), `pc-tiles`, `pc-log` (averages and games on one column grid), games sortable (`card-sort`, `ui.cardSort`), picture `playerPhoto` (the full cutout, NBA.com's for basketball, ESPN's by `espn` id otherwise, in front of the team logo; the round photo if it won't load). `sortDesc(list, fn)`: highest first, fn asked once per item (never `sort((a, b) => value(b) - value(a))`)
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
    tab works unchanged; what basketball and football leagues share (fetch, matchups, slots, rosters, standings, draft) is `espnLeagueShape`/`espnLeagueJson`. "fx" names (`fxLeague`, `raw.fx`, `fxTeamSide`) mean "the league's site", either one.
    ESPN football (`fetchEspnFootball`, `sport: 'nfl'`): an ID ESPN answers 404 as basketball is asked for as football (one extra request). Weeks are NFL weeks from
    the file's `weeks` (ESPN's scoring periods), players the file's by `espn` id (the job matches ESPN's player list by name and team: Sleeper's has a quarter of
    them; a D/ST is -16000 less its team's number, `espnFootballId`), scoring `ESPN_FFL_STATS` (ESPN stat id -> the data's names; D/ST-only stats at ESPN's
    D/ST points; a TE/RB/WR reception premium as Sleeper's bonus_rec_*). The job adds ESPN's own points-allowed brackets (14-17, 18-21, 22-27, 35-45, 46+)
    and `def_fum_rec` (special teams' included) to a defense's lines (`espn_defense`). Checked on a real league: 1,169 of 1,170 player-weeks matched ESPN's
    points (the one: a sack counted differently). Live points: ESPN's per week, in `L.slpWeek` like Sleeper's (`espnWeekFresh`, `leagueWeekFresh`, every 30 s).
    Category football isn't read. No Recap, Awards or Season totals.
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
    ride along as `bonus` on game lines (`withBonus`, added by `lineFp`), so weekly scores match the matchups API's within techs and
    stat corrections (not Sleeper's real results: Gotchas). Past seasons stay Fantrax-only. Dynasty: a taxi squad (`r.taxi`) is roster status
    'TAXI', in a side's `il` with the IR (never in a lineup or projection), drawn "Taxi" (`onTaxi`, `slotBadge('TAXI')`); past weeks mark
    today's taxi players `o.taxi` (one promoted can't go back), left out of bench swaps and Benchwarmer Blues. A rookie draft: the board's
    columns are `draft.slots` (slot_to_roster_id) and each pick's slot; Reach/Fall rank among players on no roster (`draft.rostered`, a
    dynasty draft with fewer rounds than spots) and, a rookies-only draft (`player_type` 1), rookies only (`draft.rookies`).
  - football: a player's week (`footballProj`, `footballNow`, `footballEntry`), lineups (`bestFootballIds`), live points (`footballLines`). What a football week is like is said once, in its sport table (sports.js: `weekLineup`, `gameLocks` + `spotLocked`, `oneNumber`, `samePosDrops`; hockey's `steadyMinutes`): other pages read those traits, and branch on `isFootball()` only to call football's own functions.
  - yahoo: Yahoo leagues through a Yahoo login (OAuth): the helper server `worker/yahoo.js` (Cloudflare Worker at
    api.leaguelayer.com, setup in `worker/README.md`) runs the sign-in and passes API requests through (Yahoo's API isn't
    CORS-open); tokens stay in the browser (`league-layer-yahoo`). `yahoo.proxy` empty = Yahoo hidden; while `yahoo.beta`, the sign-in shows only on a device that opened `?yahoo=1` (or is signed in). `yflat` turns Yahoo's
    JSON ("0","1"…+count objects, arrays of one-key objects) into plain lists/objects; `fetchYahooLeague` maps to the league
    shape (`source: 'yahoo'`, ids = league keys `nba.l.N`). Test fixtures are made up in Yahoo's layout
    (`tests/make_yahoo_fixtures.py`): check against a real league once signed in.
  - render: `render()`, the head above the tabs (`.head`, Nov 2026, the owner's ask: `leagueMenu` on the left, leagues and seasons only; on the right `teamMenu`, a jersey icon (+ the team's name on a computer; `team-pick`), and `gearMenu`, which also holds Stats used, Copy league ID (`copy-league-id`, for a friend to connect the same league), Backup and Reset), the tabs (`.topbar`: on phones a bar along the bottom, each with its `TAB_ICONS` icon, the first `TABS_SHOWN` and the rest under More, `.tabs-extra`; the head scrolls away there), notes under the tabs (`ctxBar`: past season, Viewing only, demo), past-season switching (`withSeason`,
    address `#tab/<seasonLeagueId>`), `viewLeague`/`myTeamId()` override
  - history: weekly rosters (`loadRosterWeeks`, cached per league), arrivals (start/trade/pickup), season
    archives (`data/seasons/`), game logs (`loadGameLog`; `'cur'` = this season's box scores via `boxGameLog`),
    all awards (every award but Biggest punt and Even Steven: a team's name opens a breakdown: `awardDetails`, `award-team`), past Rosters
  - views: Standings (+ Categories won, category leagues: each team's categories W-L-T against its real opponent over the finished regular-season weeks, and per category, by the Recap's `weekScore`, `catsWonRecords`/`catsWonCard`; + Season totals; both from one load, `seasonLineups`; the Roster tab is gone, `#roster` and `#lineup` land here), Trades, shared table helpers, box score loading. Trades' Trade proposal: one card, one table under the lists (`tradeCard`, from `tradeModel` and, for your own deal, `tradeForYou`; the owner's ask, Nov 2026: no whitespace, all in one section): Share and an (i) on top (`INFO.trade` says what every column means: the owner's ask, the table carries no notes, no value line, and no labels the layout already says, like Player, Per game or Total; one header row: GP, Missed, Playoff G, MIN...); no verdict, never "you win" or "roughly even" (the owner's rule: whether a trade is fair is for the people trading to judge); for each side its players (photo, team, colored positions, GP and Missed this season: `seasonGp`/`gamesMissed` in nba.js, his team's games before the data's day less his, none for a goalie; playoff games, the per-game line, value; no ranks, the owner removed them), then its total, the better side's marked (a side getting one player has no total row: his row is it, the owner's ask) (green/red only when one side is yours; Value added up with "over waiver" under it, which is what's marked; FG%/FT% show makes-attempts and are marked by makes over the league average on those attempts, not the bare %, the owner's ask: volume matters); last For your team (your active roster's per-game change). Playoff games (the owner's ask: they decide titles): his NBA team's games in the league's playoff periods (`playoffDays`/`playoffGames` in nba.js: periods from `L.playoffPeriod` on, by `periodDates`; only those still to play once they've started; a goalie's expected starts; Sleeper's one-game weeks count weeks); no column without playoffs. A points league's FP is the Value column. Lists show team and positions, not the next game or an injury note (the owner's asks). Future draft picks (the owner's ask, Nov 2026): chips under each list (`leaguePicks`, fantrax.js: read the first time Trades needs them, kept on the league object and its saved copy, so read again only with the league; not via changed('league'), which Sleeper leagues hear on game nights), in the deal as `givePicks`/`getPicks` (`pickKey` year:round:original team; link `&givepicks=&getpicks=`), shown on the getting side's rows, the picture and the text, never valued (next season's order isn't known). Fantrax: `getDraftPicks` futureDraftPicks (checked: your league lists 2027 only, 11 rounds; the points test league answers none; its currentDraftPicks are this draft's, an unmade pick included, not read). Sleeper: `traded_picks` lists only traded ones; the seasons (3 in dynasty, 1 in keeper, none in redraft) are an assumption: the owner's dynasty league has traded 2027 and 2028 picks, none of 2029 yet. ESPN has no pick trading. Share as the Recap's (`tradeShare`, picture `tradeCanvas`, ranks there too), link `?league=&from=&to=&give=&get=#trade` (`tradeUrl`): either team gets the deal in its own pickers, from its side; anyone else sees it as sent, above theirs (`applyTradeLink`, `ui.tradeSeen`). A fantasy team's name anywhere (`teamLink`, core.js; plain in past seasons and inside menus) opens its card in the player card's dialog (`showTeamCard`/`teamCardHtml`, `teamCardTitle`): Category strengths in full (`teamStrengths`, any team's, points leagues too, not football; moved from Standings Nov 2026, the owner's ask: number, league average, bar, rank, every team's dot, the card's team the big one and yours orange, a row opening to who helped and hurt), counting each team's top N (N = its lineup's spots, IR left out: an end-of-bench player or a one-off start doesn't move them), then the roster as the Players tab's table, one list, sortable by any column (`team-sort`, `ui.teamSort`; back to best first each time a card opens). Both team cards (this one and an NBA team's) rank and show each player's value over the season, `seasonTotal` (nba.js: this season's average game × its games), not a game's, so a game or two can't top them.
  - dashboard: the Matchup tab (`#dashboard`, was Dashboard; `dashMatchupCard`): Today / Yesterday show only who plays that day, each side one column by game: on now, finished, to come (starters before the bench in each), then Out/DNP; each player's game in a bubble as on Fantrax (`dashGame`, `.game-pill`; on phones its spaces are kept whole: squeezed, "Q1 37.7" read "Q137.7"; `.mu-score` is the big score). During a basketball game the dot by a player's clock is solid green while he's on the floor and light while he's on the bench or between periods; no green rows; every live dot by a player comes from `liveDot` (`liveStatus(p, d, true)`, `.lv-dot`, `.lv-dot.out`), on every tab. `onFloor` (live.js; takes a row's `nbaId` or the data's `raw.id`): ESPN's box score marks exactly the five on the floor of each team `active` (checked against the play-by-play's substitutions), kept per game in `live.floor` by `espnFloor` from the box score `readBoxes` already fetches (no extra requests); not known between periods, after the buzzer or before a read. "Halftime" reads "Half" everywhere.
    The card's corner button is full screen, not an (i) (the owner's ask, Nov 2026; `dashFull`, `ui.dashFull`): while the card is drawn `.mu-card.full` the CSS hides the rest of the page (`body:has(...)`), so live redraws keep it, plus the browser's own full screen where allowed (not iPhones); off by the button, Esc, or any hash change. Full screen is one sheet, no outline or lines between rows, a size up on a computer, each player's full photo as on his card (`dashPhoto`, the owner's ask; `playerPhoto(raw, cls, true)` skips async decoding so the 30 s redraws don't blink, and `shotMiss` keeps a photo that wouldn't load on the round one).
    This period (the league's own) slot by slot; big score = period so far, ties count half, category table + each starter's game and line; then
    one-line folds that open on tap (`dashFold`, open ones kept in `ui.dashFolds`): this week's waiver
    moves (`periodMoves`: last period's rosters vs this one's, Fantrax only); no injury news or action items (Nov 2026). Your waiver order spot (ESPN, Sleeper: `waiverLine`) is under the Standings table.
  - players: Players tab (`#players`, was Free Agents): one table (`topPerformancesCard`) of every NBA stat line of
    a menu of Today / Yesterday (the last game day) / This period (once it has two game days) / Last period (range 'last') / This season (football: Projected first), and for a period or the season a Totals / Per game toggle (`ui.perfPer`; the season per game is `seasonRows`, averages from the Stats used basis, internally range 'avg'); top 300 for the season ranges, 100 otherwise, ranked by value (pickup ideas are only on Plan Ahead);
    search, then one Filters button (`ui.perfFiltOpen`) opening a panel: Show toggles (`ui.perfWhose`: me, opp, other, fa, any together, never none; Other teams is also a menu of those teams to pick any number of, the owner's ask: `perfOtherMenu`, `ui.perfOthers`, none picked = all), Lineup All / Active / Bench (`ui.perfSpot`, rostered players only: waivers have no lineup), position and NBA team (each a menu to pick any number from, the owner's ask: `perfMenu`, lists `ui.perfPos` / `ui.perfTeam`, empty = all; a player at any picked position), Rookies, Injured. Player card: under his fantasy team, how he got there (`cardHow`: Keeper / Drafted round, pick / Pickup / Traded from, with the week, from the weekly rosters; ESPN: the draft only)
  - matchups: the Plan Ahead tab (`#week`, was Matchups; opens on next period, else the week picked: `planAheadWeek`, `ui.weekChosen`), schedule dots (a game on now: `.dots i.live`, flashing green while he's in it, the owner's ask, never red; a flashing ring until he checks in; listed Out, the red ring; the week underway follows tonight's games, `weekTabLive` in live.js), stat tables, tooltips. The opponent's injured reserve (`state.opp.il`, `oppIlIds`/`oppActive` in nba.js) sits in the board's IR row (tag "IR"; `IL` inside the code), never on their bench or in their projection. A finished week (its last day before today) never shows a projection, the owner's rule: its real
    result and lineups, plus bench swaps that would have changed it (`pastWeekCard`; `benchSwaps`/`weekScore` in history),
    else one line saying why not (`pastNote` in `viewWeek`: the last night's box scores not in yet, with `fillWeekFromEspn` asked meanwhile; no matchup; a league whose past lineups aren't read: ESPN football, Yahoo)
  - A week is over (`periodOver`) at its end or once its last game day's box scores are all in (that day included): Fantrax ends a weekly
    period Monday evening when the next locks, a day after its last games. Recap, awards, past-week cards use it. So the Recap shows the
    night a week ends, not after the daily job, ESPN's finals of the week's unsaved days go into `BOX` (`fillWeekFromEspn`, live.js;
    from the Recap tab, once a minute at most; basketball only: ESPN's hockey lines lack stats). Every basketball final the live update
    reads goes into `BOX` the same way (`readBoxes` -> `addBoxGame`, `boxAdded`), so Plan Ahead's dots and projection count a night as it ends.
  - recap: Recap tab: a finished week across the league (Player/Game of the week, Worst week (worst per game, 2+ G), Worst game, Street clothes (most games missed while starting), with full lines in the league's cats,
    bench regret, best all-play week (categories only); points leagues add Carried (biggest share of a team's points, 20%+), Tough luck / Lucky win (best losing / worst winning score, on the wrong side of the middle) and Nail-biter (closest final under 5% of the winner, not a game already told as luck); hockey Goalie of the week and Hat trick, football Defense of the week; then every final, the week's top and bottom team marked with a Best / Worst badge, in the picture too (`X.rank`, `recapMark`/`recapMarkTip`: most/fewest points in points leagues, best/worst all-play record in category leagues; a tie marks each)) from `benchSwaps` on the shared `pastWeeksOf` data. No emoji anywhere in the recap, tab, picture or text, and the tab looks like the picture, titled Period N recap (the owner's asks, Nov 2026: `recapCard`, a player on `playerPhoto(raw, 'rx-ph')`, his team's color itself, `teamTint` in core.js); Share (`shareWith`/`sharePopup`/`shareText` and the pictures in share.js, also the Draft Retrospective's and a trade's: `recapShare`, `draftShare`, `tradeShare`; the picture `shareCanvas`, every picture drawn with `sharePad`: each player on his NBA team's color in front of its logo, his cutout ESPN's by `espn` id (`shotImg`: NBA.com's can't go on a canvas, its server sends no CORS header; the round sheet photo where ESPN has none), every player alike beside his photo, his numbers bold (`lineTiles`, which `fullLine` is built from); kept short, the owner's asks: no larger card for the first player, the recap's top "Period N Recap" and the league, no dates, Inter as on the page) opens a popup with the
    recap as a picture (`recapCanvas`: 1080 px PNG on a canvas, headshots from the sheet `IMG.sheet`; Share image / Copy image / Save
    image) or the text: the standouts + a link `?league=<id>&week=<n>#recap` (`openSharedLink` connects the league, asks for the team, then shows it).
    Fantrax, Sleeper and ESPN basketball (`hasWeekLineups`; the Matchup tab doesn't point to it, Nov 2026). Trends, a tab of its own after Players (`#trends`, `viewTrends`/`trendsCard`, trends.js; under the Recap until Nov 2026, the owner's ask; not football: in its `soonTabs`): Heating up / Cooling off (`ui.trendDir`), each player's last 5 games
    through the latest day of saved box scores against his median game before them (5+ earlier games; a regular: 15+ minutes, hockey 10), one top-5 list per
    counting category (points leagues: fantasy points), shooting % with volume, Minutes and Shot attempts, ranked by the change per game; first by Value
    (`lineValue` now and its change): Rostered and Waivers (unowned). Notes from the box scores only (`teammateOut`: a 24+ minute teammate missing most of those games;
    minutes moved 4+). Owners are today's rosters. Info text `trends`. A list's name (every category, Rostered, Waivers) opens its card (the owner's ask, Nov 2026: `trend-cat`,
    `trendCardHtml`/`showTrendCard`, in the player card's dialog; `trendKit` is what the tab and the card share): everyone the list takes, 25 at a time, each one's last 5 games
    one by one (green above his usual, red below), Avg / Usual / Season / MIN / Change, sortable (`ui.trendSort`), direction and whose (All / Rostered / Waivers; the
    sandbox's My team / Everyone else) picked in it (`ui.trendCard`). The full-draw test never reaches it (the fixtures' season is too young for a trend): its own test checks names
  - live: live box scores for the Dashboard matchup's and Performances' Today (and This week). Live scores come first from the Worker's live feed (`liveFeedGet`: `/live/<sport>/<league>`, worker/yahoo.js: today's scoreboard and each game's box score cut to what the page reads, ~8 KB compressed a night, built once and kept 5 s at the edge, at most 3 box scores read a build for the free plan's 10 ms of CPU; `readBoxes(games, feed)` uses a game's box score from it when under 45 s old, else asks ESPN if due; the feed failing = ESPN directly for 10 minutes; keep `liveScoreboard`/`liveBox` in step with what espnGames/espnLines/espnHockeyLines/espnFloor/espnPlayer read). The injury report and finished days go through `/espn/` first (`espnSite(path, tries, pooled)`). Every other ESPN site-feed request goes through `espnSite(path)`:
    direct from the browser; after `ESPN_SWITCH` (2) misses in a row while leaguelayer.com answers, through the Worker's cached `/espn/` route (worker/yahoo.js)
    for 6 hours on that device (`league-layer-espn-route`), logged once. Failing feeds back off (`feedWait`: ×2 per miss, 5 min at most) for live scores,
    ESPN/Sleeper league points and the late finals. Fantrax and Sleeper stay direct on purpose: their limits are per IP, and a proxy would pool everyone's. The browser polls ESPN's site API
    (`site.api.espn.com`, CORS-open; NBA.com's live CDN isn't) every 30 s (60 s with Save-Data) while the Dashboard or Players tab is visible,
    it isn't set to the last game day (`ui.dashRange` / `ui.perfRange`), and games are on: scoreboard + the box score of each game in progress
    (`live.lines`: date -> NBA id -> line). ESPN's undated scoreboard (and so the live feed's) stays on last night's games until late morning
    (still at 11 a.m. ET, Nov 17, 2026): `pollLive` adds today's from `scoreboard?dates=` meanwhile, or the Matchup tab has no tip-offs. ESPN players matched by `espn` id (from the daily job) else initial + last
    name + team. Yesterday and this week's earlier days missing from `data/boxscores.json` are asked for once.
  - draft: Draft tab/board. Draft Retrospective (was Draft awards) at the bottom (`draftAwards`, this season only: today's ADP says nothing about a past draft; shared as the Recap's standouts): each pick against consensus ADP (`adpOf`: a Fantrax league's own, else the daily file's, kept as `raw.adp` for ESPN/Sleeper), the league's keepers off the board first (a player's consensus spot is his place in ADP order among the players not kept: in a keeper league comparing raw pick numbers made the typical pick a 20-spot reach). Reach (was The Reach): furthest ahead of his spot; Fall (was The Fall): furthest past it (Value Meal, the team whose typical pick went latest, was dropped, the owner's ask, Nov 2026). An award's title opens its breakdown (`detail`, `draftAwardDetails`, 'draft-award'). From the players themselves (no ADP needed): Glass (games missed a season the last two seasons: `SPORT.seasonGames` less his games from the season archives, `glassSeasons`/`missedSeasons`; a season before he was in the league, by `raw.exp`, isn't his, one he sat out whole is all missed; goalies left out), Youngins / Uncs (average age on draft day, `born`), Homer (was The Homer: most picks from one real team, by each player's team now; its card shows their faces) / Passport (was The Globalist, then Frequent Flyer: most countries, `raw.nat`). Trigger Finger / Clock Milker: each team's average pick time (the owner's ask, Nov 2026: one number, the median beside it confused), its card naming the winner's quickest / longest pick with his face, as Youngins / Uncs its youngest / oldest player (`standout` in `draftAwardKit`), from Fantrax's pick times (`league.draft.picks[i][5]`, `league.draft.start`, written by js/fantrax.js and, for the site's own league, by update_data.py (`fx_ms`): the page uses the daily file's copy of that league; a pick's time is the wait since the one before; a draft whose picks share one time, as Fantrax rewrites old drafts, has none; ESPN/Sleeper/Yahoo give none). Fantrax has no pick-clock length or auto-pick flag (Sleeper has the clock, ESPN marks auto-picks: `autoDraftTypeId`). Glass, Youngins, Uncs, Homer and Passport count each team's keepers with its picks (its draft-day roster); the ADP and pick-time awards are picks only; team awards need half the most players; a tie names each team. No emoji on any award, and the Draft tab draws them as the Recap's cards (`standoutCard`, recap.js; the owner's asks, Nov 2026). Drafts are graded on the games of the league's own season
    (`leagueSeason`: first week to last, playoffs included; `draftSeason`/`windowStats` from that season's game log), not
    the NBA's full season: past seasons always, this season once the league is over or if it started late.
  - leagues: saved leagues (`rememberLeague`; each one's own team and lineup kept in `state.leagueStates`), connecting and switching
    (`connectLeague`, `switchLeague`), making a team yours (`adoptTeam`), the demo and the landing page (`viewLanding`; in draft.js until Nov 2026).
    Seasons: the league menu lists the current league's seasons
    under it (`season-pick`/`season-add`); the team menu only picks a team. The league form (`connectLeague`)
    files an earlier season (year < `NBA.season`, or a later season of the same Fantrax `historyId` is here) under its
    league in `state.pastSeasons[historyId]`, never as a league; `foldPastSeasons` moves old duplicates there
  - actions: `actions` (data-action handlers), event wiring, `route()`, `init()`
  - Demo (`state.demo`, the landing page's "Explore a basketball demo league"): the daily file's site league, seen as a team (`demoTeam`: the
    best record with a matchup) so every tab has something to show, it and its teams under made-up names (`demoNames`, in memory only); never in `savedLeagues`, the team picker changes the team, `demo-exit` or
    connecting any league ends it and keeps nothing (`switchLeague`'s `fromDemo`).
  - sandbox: the Sandbox (`state.browse`, Nov 2026, the owner's ask; was "Just browse players"; the landing page's "try the sandbox" and the league menu's
    "Sandbox: any players, no league"): `fxLeague()` is null (the daily file's site league, or your own, stays loaded underneath), `clearLeaguePlayers()`
    drops its rosters/positions from the players. No bar under the tabs (the owner's ask: people may stay in the sandbox): two menus in the head where a league's
    team picker is (`sbMenus`, drawn by `teamMenu`; icons on a phone) pick the sport (basketball or hockey, `sbSetSport`: `useSport`,
    each sport its own team, watch list and scoring) and the scoring (`sbSetScoring`): the sport's standard categories (`CATS`), a site's standard points
    (`SB_POINTS`: basketball's ESPN default since 2020 and Yahoo's head-to-head points, both checked Nov 2026; hockey none, ESPN doesn't publish its whole table)
    or your own points (a popup, `sbPointsForm`). `leaguePoints()` asks `sbPoints()` with no league, and `scoreCats` keys its memo on the points too. Tabs (`TABS_BROWSE`): My team (`#team`: any players, up to `SANDBOX_MAX`),
    Live (`#watch`: up to `WATCH_MAX` 12 followed live, `watchTabLive` in live.js; cells built from the Matchup tab's `dashGame`/`lineChips`; Today / Yesterday / Week,
    Monday to Sunday so far; a full list or team says Max by its count, no sentence, the owner's ask), Players, Trends
    (My team / Everyone else lists), Trades (`#trade`: give My team's players, get anyone found by name; `tradeCard` drawn inside `withState` with My team as
    `state.players`; shared with the site's address, no league link). Kept in `state.sandbox` { sport, nba: {roster, watch, scoring, points}, nhl: {...} } (`sandboxClean`
    in core.js; `sbState()` is this sport's), apart from any league. My team is the team id `SB_ME`: `myTeamId()` and `fxTeamName` know it, so `teamLink` draws "My team" in orange. Add / Follow live also on every
    player's card (`sbCardLine` via `cardOwner`), and + / ✓ on each Players tab row (`sbAddBtn`, the owner's ask); searches are `sbSearch` (`ui.sbQ`). Leaving: pick a league in the league menu (`switchLeague`, which reads it again and
    puts its players' league details back, then the Matchup tab). The league underneath stays in `state` (players, lineup, slots), maybe another
    sport's: `validateLineup` and `loadNba`'s startup checks leave it alone in the sandbox (they threw on basketball's PG in hockey's table, and a reload on
    hockey dropped the basketball league's team pick, Nov 18, 2026), the league to go back to is named on entry (`state.sandbox.back`: the other sport's data
    doesn't know the site's own league), and `switchLeague` stashes its state under it first (a pick already lost comes back from that copy). Code reading `state.fxTeam` must expect undefined there (a first visit), not only null.
- `scripts/update_data.py`: daily data job (GitHub Actions, started at 08:00 UTC = 4 a.m. ET, 3 a.m. in winter, by the Worker's Cron Trigger through
  GitHub's API, `startDataJob` in worker/yahoo.js: GitHub ran the workflow's own schedule hours late, 14:54-18:12 UTC on Nov 11-16, 2026;
  the workflow's 09:23 UTC schedule is the backstop. Set up Nov 17, 2026 (the owner's fine-grained `GITHUB_TOKEN`, Actions read/write on
  this repo only; renewing it: worker/README.md "Daily data job"; an expired one shows in the error log as "Daily data job not started").
  The page still mustn't wait on the job for last night's games) builds `data/players.json` and
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
- NHL (Fantrax leagues only; every tab and past seasons, as basketball; the sandbox and the demo are NBA only). Goalies: a team's game isn't each
  goalie's. `startChance(p, d)` (nba.js) is 1 for skaters; a goalie's comes from `startChain(team)`, game by game from the team's last
  (`teams[t].lg`): his share of recent starts (`raw.st`, `goalie_shares` in the job; roster goalies only, anyone Out shares nothing), cut
  for whoever started the game before (×0.1 on a back-to-back: the same goalie started the second night 7% of the time in 2025-26;
  ×0.8 otherwise), and ESPN's named starter (`g.goalies` from the scoreboard's `probables`: Confirmed is certain, Expected counts
  75%). `projectSide`, `weeklyPriority`, `weekGames` (to a tenth) and the Dashboard's pace use it; value stays per game played
  (`gameWorth` for a trade or lineup: value × share). Street Clothes and Missed skip goalies: a healthy backup sits most games. Checked on 48
  real team-weeks: goalies scored 4.7 a week, every-game projected 8.1, this 5.2 (average miss 3.8 to 2.0). Category leagues were
  only tested on a made-up scoring setup: no real hockey category league yet. A Fantrax league's sport comes from its scoring groups (`fxSport`:
  `HOCKEY_SKATING`, Fantrax doesn't name it; `BASKETBALL_PLAYER` or no groups is basketball, any other sport, e.g. `GOLF_GOLFER`,
  is refused with a plain message, `FANTRAX_SPORTS`, and logged as tried, never loaded as basketball). `fetchFantraxLeague` reads a league against that sport's data file
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
- Logo ("Sheet" in "Ink" colors, chosen for now): `scripts/build_icons.py` draws it and writes `icons/logo.svg`,
  `icons/favicon.svg` (also inline in index.html, and drawn by `sharePad`'s `mark` on the share pictures: copy it to both if it changes) and the three PNGs. On a home screen the mark stays inside the middle 80% circle.
  It also draws `icons/og.png` (1200 x 630), the picture a shared link shows: index.html's `og:`/`twitter:` tags, the same for every address (crawlers don't run the script).
- `404.html`: GitHub Pages' page for any address that doesn't exist ("Jahlil Okafor-o-four": his jersey in SVG, Philadelphia's colors only, no team logo or wordmark), self-contained (inline styles, root-relative font and links: it shows at any depth).
- Home screen: `manifest.webmanifest` + `icons/` + the tags in index.html make the site install full screen (`canInstall`, the settings menu's Install the app:
  the browser's offer, or steps for an iPhone, which keeps the app's storage apart from Safari's, so a league is connected once more there). No service worker on purpose: every
  visit is the live site. An installed app has no refresh button, so returning after 3 hours reloads it (`appStale`).
- `tests/`: `node --test tests/app.test.js` (Node built-ins only). `harness.js` loads the js files in a vm
  in page order with fake fetch (fixtures) and a fixed clock (2026-10-26 20:00 ET). Fixtures in
  `tests/fixtures` (refresh: `python tests/capture_fixtures.py`). Every run of the site workflow, data runs too, tests
  what's on main in its `test` job, and publishes exactly that commit only if they pass (`site.yml`; `tests.yml` covers pull requests).

## Rules settled with the owner (keep them)
- How the owner works (Nov 17, 2026): several sessions at once, and the owner doesn't read code. No pull requests: a session lands
  its own work on main once it's tested and checked, rebasing onto origin/main and fixing any conflict itself, keeping both sides' changes (Deploy, under Gotchas).
- Every session that changes files works in a worktree of its own (the owner's rule, Nov 18, 2026): the app starts sessions in the main folder, so before
  its first edit a session there calls EnterWorktree (named for the task; it branches from origin/main) and keeps every edit, test, preview and commit,
  this request's and later ones', in it. Only reading and answering stay in the main folder. Sessions sharing the main folder tested each other's
  half-done code and couldn't commit apart in a file both had changed (core.js and actions.js take most changes).
- Everything follows each league's own settings on Fantrax or ESPN (category list or point values, slots, daily
  vs weekly lineups, playoffs). Never hard-code the owner's league.
- Weekly lineups lock when the week starts, so the lineup people are setting is next week's: Fantrax leagues with weekly
  lineups also load next period's rosters (`L.nextRosters`, one more request; the daily job too), and the Matchups tab
  shows them on next week (`withViewedTeam(viewWeek, true)`, `nextRosterPeriod()`, `fxTeamSide(tid, period)`). Every
  other tab and the saved lineup stay on this week's.
- Fantrax: minimize requests. League data cached on the device; manual ↻ Reload (gear menu) instead of
  loading fresh each visit (no ↻ Reload within 2 minutes of the league's last read: `RELOAD_COOL`, `reloadWait`, the menu says "read just now"); the one automatic reload is 10-20 minutes before a matchup period's first game and 2-6 minutes after, each page at its own random moment in each window (`autoReload.spread`, Nov 2026: a site's worth of visitors mustn't reach Fantrax in the same minute, its busiest)
  (`checkAutoReload`, actions.js: Fantrax starts a period at its first tip-off, else ESPN's scoreboard, else 7 PM ET; only when the
  league was read before that moment; checked once a minute and on coming back to the page), so the lock's lineups and the new
  period show without a manual Reload. Weekly rosters fetched once per finished period. Shared player list/ADP once a day.
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
- Stats used (smart blend / this season / last season / last 10, `state.basis`) is a choice only early in a season: once the typical team has played more than 10 games (`seasonSettled`, nba.js) every projection and value uses this season's averages alone (`basisNow` 'now': last season's only for a player yet to play), and the settings menu's picker is gone. So a player 1-2 games in is read from those games.
- Static explanations go in (i) popups; on-screen text stays short and specific.
- A pick on Matchup's or Players' When menu (Totals / Per game too), the sandbox Live's Today / Yesterday / Week (`picks.watch`) and Plan Ahead's week holds over a refresh until the default is new (Nov 2026): a new day for Matchup, Players and Live, a new matchup week or league for Plan Ahead; then the default, and the next pick holds again (`picks`/`savePick` in core.js, `league-layer-picks`; `dropOldPicks`, `planAheadWeek` in render.js). A page opening on a kept pick still makes one live update (`liveWanted`: `!live.tried`), which reads last night's games the saved box scores lack. A matchup's span is a "period" in labels (This / Last / Next period), not a week.
- Makes and attempts are always written with a slash, "10/19 FG", never a dash (the owner's ask, Nov 2026; a dash is for records and scores). A points league scoring both halves of a shooting pair (FGM with FGA or FG misses, the same for FT and 3PM) draws it as one "10/19 FG" / "4/5 FT" / "3/7 3PM", not a bubble each: `lineCats` (core.js) over `SPORT.shotPairs`, read by `lineChips` and `lineTiles`, and Plan Ahead's tables (one "11.9/25.6 FG" column, 2.5 columns wide: `colShares`; shaded, sorted and given a win chance by the pair's own points, `shotPoints`/`shotChance`). The Players tab, team cards and Trades still show the halves apart.
- Mobile matters: check phone width (375px); no page-level sideways scroll. Popups keep their scrolling (`overscroll-behavior: contain` on `.modal`/`.modal-body`, not on tables inside them) and the page behind is frozen while one is open (`html:has(dialog[open])`, with its scrollbar's gutter kept).
- The look (Nov 2026, chosen from a mock): shadcn/ui-style, in styles.css alone: zinc neutrals (`--bg`, `--surface`, `--border`, `--text`, `--muted`, `--ring`), Inter served from `fonts/` (OFL). Orange (`--accent`) is only for your own team and team things; player names stay black; your own fantasy team's name is orange wherever `teamLink` draws it (`.team-link.mine`, `.team-mine`). Lineup-spot tags take Fantrax's own colors (`slotColors` in sports.js, per sport, `.pc-*`); a player's positions always take them, everywhere, share pictures too (the owner's ask, Nov 2026): `posTags` is the only way positions are drawn and `slotColor` the only place a color comes from (`slotInk` reads it from styles.css for a canvas); a test fails on a position drawn plain or any file making its own. Hockey's C/LW/RW and football's positions have no color yet. Phones: sections run edge to edge with a line between, and those after a tab's first one with a heading roll up to it (`rollCards`, render.js; open ones in `ui.rollOpen`; not Trades or award cards).

## Gotchas
- ESPN (phase 1, Oct 2026): public leagues only; API is `lm-api-reads.fantasy.espn.com/apis/v3/games/fba/...`
  (the old `/apps/fantasy/v3` path answers 403). One league request (views in `ESPN_LEAGUE_VIEWS`) plus ESPN's
  player list (daily, needs the `X-Fantasy-Filter` header). ESPN sends no dates: day 1 = NBA opening night; weeks
  Monday-Sunday with the All-Star week joined to the next (verified on ESPN's schedule page: 2027 Matchup 18 =
  Feb 15-28), checked against `status.finalScoringPeriod`. Matchup numbers are ESPN's week numbers; weeks before
  `status.firstScoringPeriod` aren't the league's. Past lineups: `mRoster&scoringPeriodId=N` answers with
  the rosters and slots as they stood on day N, so the Recap and Plan Ahead's finished week read ESPN basketball too
  (`hasWeekLineups`, `espnWeekLineups` in espn.js: each day a lineup period, as a Fantrax daily league's; `pastWeeksOf(L, period)`
  keeps them per week). A day is 1.5 MB (270 KB compressed) and the filter header doesn't trim it, so only the shown week's
  days are asked for, once (`league-layer-espn-days-v1`). Checked on a real points league: 18 of 20 team-weeks matched
  ESPN's finals exactly, the other two within 4 points. Season totals, Awards and past seasons stay Fantrax/Sleeper-only
  (`hasLineupHistory`): they'd need every day of the season (40 MB by spring). A category league loads on every tab (the Utah test league, Nov 19, 2026),
  but no finished week of one is checked against ESPN's results yet; ESPN football isn't checked. ESPN doesn't say waivers vs free agent in the league data: unrostered = 'A'.
- Escaping: a shared link opens any league on leaguelayer.com, so text a league's members type (its name, team names) goes through `esc()`
  wherever it's drawn. A `data-tip` is HTML put in the page again as HTML (`showTip`), so text inside one is escaped twice: `esc()` in the tip, `esc()` on the attribute.
  The full-draw test in app.test.js draws every tab and popup of nine leagues with names made to break out of HTML (audited Nov 17, 2026: none did); it also checks every position is in its color.
- `python serve.py [port]` (preview config "site", port 5173) refreshes `data/` locally: never commit
  `data/players.json` / `data/boxscores.json` from a local run (`git checkout -- data/players.json data/boxscores.json`).
  `.claude/` is git-ignored, so a worktree has no `launch.json` (and the preview tool reads the main folder's, which a worktree session may not edit: its "site" serves the main folder's code; if so, run the worktree's `python serve.py 5176` in the background and open its URL): write one there whose port no other session uses (5174, 5175...: `runtimeArgs` `["serve.py", "5174"]`;
  serve.py refuses a port in use, as Windows would otherwise let two servers share one; keep to 5174-5179). Another port is another origin, with its own empty storage: open it as
  `http://localhost:<port>/?league=my19c8mwmoipvhon#dashboard` (`openSharedLink` connects the league; pick "Eli's SGAteam" if it asks), not by typing the ID in the form. The Worker
  answers localhost:5173-5179 (`SITE_ORIGINS`, worker/wrangler.toml; 5174-5179 added Nov 18, 2026, live once the owner deploys the Worker: until then those ports fall back to ESPN directly).
- cdn.nba.com answers GitHub runners 403: `get_json` falls back to the same files on NBA's S3 storage (`CDN_MIRROR`), so box
  scores stay NBA.com's (official; ESPN keeps stats the NBA later takes away, Fantrax follows the NBA). The last 3 days'
  games are downloaded again each run for stat corrections; ESPN copies are dropped once the NBA copy is cached.
- stats.nba.com blocks GitHub runners. Past seasons live in `data/seasons/<season>.json` + `-games.json`
  (2016-17..2025-26), made on the owner's PC. Each fall archive the season just ended:
  `python scripts/archive_season.py 2026-27`.
- Deploy: push to main triggers the site workflow (deploy only); `gh workflow run site.yml` refreshes data. It publishes only what the page reads
  (`index.html`, `404.html`, `styles.css`, `manifest.webmanifest`, `js/`, `data/`, `fonts/`, `icons/`: the deploy job's "Gather" step): a new top-level file or folder the page needs must be added there. Each sport's refresh
  runs apart; one that fails (or NFL projections failing) fails the run at the end, so GitHub says so, and the rest still publishes.
  Commit flow used: `git pull --rebase -q origin main && git push -q origin main`, then `gh run watch`. In a worktree (its own branch) the push is
  `git push -q origin HEAD:main` (plain `main` there is the stale local branch, not the work), and the tests run again after the rebase, before it.
  Then bring the main folder up to it (`git -C <main folder> merge --ff-only -q origin/main`, which never overwrites uncommitted edits): new sessions read this file from there.
  A session that edited in the main folder anyway may find other sessions' unfinished edits beside its own: commit only your own files (`git commit <files>`), and never `git stash`
  theirs (or `--autostash`): every session shares one stash list, and another's pop or drop took a stashed Trends edit (Nov 18, 2026; got back from
  `git fsck --unreachable`). There: `git fetch`; origin/main already in HEAD (`git merge-base --is-ancestor origin/main HEAD`): push; else rebase in a temporary worktree.
  Commit messages end with the Co-Authored-By line.
- The repo must stay public on GitHub's free plan: making it private deletes the Pages site at once (leaguelayer.com answered 404, Nov 16, 2026), and
  making it public again doesn't bring it back. To restore: `gh api -X POST repos/Eli-CB/league-layer/pages -f build_type=workflow`, then
  `gh api -X PUT .../pages -f cname=leaguelayer.com`, then `gh workflow run site.yml`. Private needs GitHub Pro, and Actions minutes then count.
- `__BUILD__` in index.html and js/core.js is replaced at deploy with the hash of the last commit that changed `index.html`, `styles.css` or `js/` (cache busting; not the latest commit: the daily data commits mustn't make visitors download the code again).
- ESPN load (Nov 15, 2026, the owner's ask: thousands of visitors without ESPN blocking the site): every visitor's browser
  used to ask ESPN itself, about 10 requests a minute on a busy night (the scoreboard every 30 s, each live game's
  400 KB box score about once a minute), all marked as from leaguelayer.com, while the page reads about 1% of each box
  score. Now the Worker's live feed (`/live/<sport>/<league>`, see the live bullet above and worker/README.md "Live feed")
  builds today's scores once for everyone (~8 KB compressed a night, kept 5 s at the edge): ESPN is asked a few times a
  minute per Cloudflare data center whatever the number of visitors, each visitor makes one small request every 30 s, and
  the injury report and finished days go through `/espn/` first. Direct ESPN stays the fallback, so the site works with
  the Worker down or not yet deployed. The Worker is the owner's to deploy (`npx wrangler deploy` in worker/; never run
  it or `wrangler secret put` yourself): the /live route was written Nov 15, 2026; until it's deployed, pages ask for it,
  get a 404 and go to ESPN for 10 minutes. Measured on a real night: the feed matched ESPN's raw answers exactly through
  the page's own parsers (games, lines, who's on the floor). Cost: the free plan's 100,000 Worker requests a day are about
  800 hours of live viewing; past that the $5 Workers Paid plan. A build reads at most 3 box scores (LIVE_BOX_PER_BUILD,
  ~3 ms CPU each against the free plan's 10 ms). Watch it in Cloudflare's dashboard: Workers & Pages, leaguelayer-yahoo,
  Metrics (requests, errors incl. exceeded CPU, CPU time, subrequests), or `npx wrangler tail` (worker/README.md
  "Watching it"). Fantrax and Sleeper stay direct on purpose (per-IP limits: a proxy would pool everyone's).
- Errors: on leaguelayer.com, `reportError` (core.js, from window `error` / `unhandledrejection` in our own js files,
  each once a visit, 5 at most), never from a crawler (`CRAWLER`: Googlebot renders the page and sometimes skips a script, so every one after it fails, a burst of "ui is not defined"-style reports, seen Nov 15, 2026) posts to the Worker's `/errors` (KV `ERRORS`, 30 days); the owner reads
  `api.leaguelayer.com/errors?key=<ERRORS_KEY>` (setup in `worker/README.md`). The footer says so, with the not-affiliated line.
  Caught errors don't reach it by themselves: ESPN's live feed failing 3 updates in a row does, as "ESPN live scores failing" (`noteLiveFailure`:
  a block, or a new format the site can't read; not the visitor's own connection). If that shows up: `SPORT.espn` in sports.js is where the feed is read.
- Traffic: Cloudflare Web Analytics (no cookies), its beacon added at the end of index.html on leaguelayer.com only
  (the domain is DNS-only, so Cloudflare can't inject it). Stats: dash.cloudflare.com → Web Analytics. An ad blocker stops it ("beacon.min.js
  net::ERR_BLOCKED_BY_CLIENT" in the console, the browser's own line): harmless, nothing reads it and `reportError` skips it; that visit just isn't counted, so the numbers run low.
- Fantrax rate limits answer 200 OK with `{ error: { code: 'RATE_LIMITED', message: '... at most once every 5 seconds per
  IP address.' } }` (getDraftResults: 5 s): `getJson` waits what it says and asks again; a draft that still doesn't come
  marks the league `draftFailed` (not kept on the device; Draft tab offers Try again), never "no draft".
- Box score cache holds NBA.com and ESPN copies of games: always dedupe by date+teams (`loadBoxes` does). A load that finishes after a sport switch
  is dropped for the new sport's (`loadBoxes` checks `SPORT`: it used to put basketball's games on hockey's page, Nov 18, 2026); a tab with only box
  scores to show waits through `boxWait` (views.js: the loading card, or the failure with Try again, never "Loading" for ever).
- Box scores reach the site by month: each job keeps `boxscores.json` as its own working copy and also writes `box/<YYYY-MM>.json` beside it
  (`box_months`, update_data.py), with `box: {month: version}` in the players file; the site asks for `box/<month>.json?v=<version>` (`boxFiles`, views.js), so a
  finished month is downloaded once and only the month underway each day. A players file without `box` falls back to the one file. Nothing on the site reads `boxscores.json` otherwise.
- ESPN's injury report: the morning job's, then the page reads ESPN's feed itself (`refreshInjuries`/`applyInjuries`, live.js; from `render` and on coming back
  on screen, at most every 15 min, no timer; ~50 KB; same Out/DTD rules as the jobs; one it can't place keeps the morning's entry; under 5 matched = not believed).
  A player listed questionable who then plays loses the tag once he's played on or after his entry's date (`playedSince`/`dropPlayedInjuries`, nba.js:
  saved box scores, or ESPN's live lines of tonight's game).
- The site has no percentages in its data: FG%, FT% and 3P% are a player's average makes ÷ average attempts (`cur`, `l10`, `prev`), so the job keeps those
  five columns to three decimals (`season_from_boxes`; at one decimal 4-8 over 3 games read .481). The archives' (`prev`, past seasons) are NBA.com's one-decimal averages
  with those columns recomputed from the season's game lines (`fine_shooting`, archive_season.py, run with every archive).
- A line cut with `text-overflow: ellipsis` can't cut into a button (`teamLink`, `playerBtn`, `teamBtn`): one that doesn't fit turns into a lone "…" (the Players tab's
  long team names did). Give the button its own ellipsis and the room left over, as `.pmeta:has(> .perf-owner)` in styles.css does.
- Sleeper basketball's past weeks (Nov 18, 2026): the matchups API's points don't add up to Sleeper's own standings (rosters'
  `fpts`, `wins`, `metadata.record`), in the owner's league and the fixtures' (every team off, 5 of 12 records differ), and the
  same week's answer varies between requests (some show a locked-in game, some the last one): it names the wrong winner in 8 of 32 matchups
  (The IPA, weeks 1-4) and 3 of 24 (fixtures). Each roster's `metadata.record` ("WLLW") is its real result week by week, from `start_week`
  (both sides of every matchup agree). The owner's team r00k5 really scored 112.5, 166, 95, 126: week 4 matched the API, weeks 1-3 were one
  starter off each (an earlier game the API shows counted as his last, or as 0). Likely (not confirmed): Lock-In scores a lineup slot day by
  day, and a slot's game can come from a player moved out since; the public API has only the week's final starters (Sleeper's GraphQL has more, sign-in only).
  So (the owner's choice, Nov 18, 2026): `L.results` (week -> team -> 'W'/'L'/'T', `sleeperResults`) decides every winner; `L.totals` (season
  total through week n) is saved per device each read (`slpTotalsSave`, `league-layer-slp-totals`, first seen kept), so a week's real score is
  the growth (`slpWeekPts`; regular season only). `benchSwaps` carries `res`/`exact`/`fix` (real minus the lineups' games, added as `bonus`).
  A week without it (`slpEstimated`, before the site saw it end) is marked ≈, without Tough luck/Lucky win/Nail-biter/Carried/bench regret/Best-Worst
  or Plan Ahead's bench swaps; Best manager, Week of the Year and Heartbreak Hotel count only real-score weeks; Season totals drop FP. (i): `slpScores`.
  The Matchup tab's live score still comes from the matchups API.
- Fantrax names can differ from NBA.com ("Nicolas"/"Nic"): `matchNicknames` (initial + last name + team).
- The preview browser sometimes loses localStorage on restart (back to the landing page): reconnect the
  league by ID in the form, then pick "Eli's SGAteam".
