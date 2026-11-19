# Hockey: scripts/update_nhl.py and goalies

Part of the repo's notes: CLAUDE.md says which file covers what and how to keep them current. Read this before changing anything hockey.

- NHL (Fantrax leagues only; every tab and past seasons, as basketball; the sandbox and the demo are NBA only). Goalies: a team's game isn't each
  goalie's. `startChance(p, d)` (nba.js) is 1 for skaters; a goalie's comes from `startChain(team)`, game by game from the team's last
  (`teams[t].lg`): his share of recent starts (`raw.st`, `goalie_shares` in the job; roster goalies only, anyone Out shares nothing), cut
  for whoever started the game before (×0.1 on a back-to-back: the same goalie started the second night 7% of the time in 2025-26;
  ×0.8 otherwise), and ESPN's named starter (`g.goalies` from the scoreboard's `probables`: Confirmed is certain, Expected counts
  75%). `projectSide`, `weeklyPriority`, `weekGames` (to a tenth) and the Dashboard's pace use it; value stays per game played
  (`gameWorth` for a trade or lineup: value × share). Street Clothes and Missed skip goalies: a healthy backup sits most games. Checked on 48
  real team-weeks: goalies scored 4.7 a week, every-game projected 8.1, this 5.2 (average miss 3.8 to 2.0). Category leagues were
  only tested on a made-up scoring setup: no real hockey category league yet, nor a real past hockey season (only a simulated one). A Fantrax league's sport comes from its scoring groups (`fxSport`:
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
