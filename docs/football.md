# Football: js/football.js, scripts/update_nfl.py

Part of the repo's notes: CLAUDE.md says which file covers what and how to keep them current. Read this before changing anything football (ESPN football: docs/espn.md).

- football: a player's week (`footballProj`, `footballNow`, `footballEntry`), lineups (`bestFootballIds`), live points (`footballLines`). What a football week is like is said once, in its sport table (sports.js: `weekLineup`, `gameLocks` + `spotLocked`, `oneNumber`, `samePosDrops`; hockey's `steadyMinutes`): other pages read those traits, and branch on `isFootball()` only to call football's own functions.
- NFL (Sleeper leagues only; stages 1-3 of 5 done: data; Standings, Dashboard scores, Recap, Awards, past weeks; then projections on Matchups, Roster and
  Players. `soonTabs` hides Draft and Trades. Next: Draft, Trades, past seasons, then Fantrax; not announced, the landing page doesn't mention football: ask the owner before stage 4 or announcing it). `scripts/update_nfl.py` (own step in the daily job, as hockey's) builds `data/nfl/`: players from Sleeper's list (too big for a browser: 14 MB), schedule
  from ESPN, stats by week from Sleeper's undocumented `api.sleeper.com/stats`. A game counts only with its `gp`: `gms_active` is on for anyone on an active roster, injured starters included. A line's stats keep Sleeper's names, the same as a league's `scoring_settings`, so
  `L.points` is simply those settings and `lineFp` gives the league's exact points, bonuses and defense brackets included: 80 team-weeks of a real league matched Sleeper's
  to the hundredth. `statKeys` come from the file (`fetchSport` fills `countKeys`, `playerKeys`). A league is `oneGame`, which already means one game a week per slot, with no
  Game of the period. Weeks are Tuesday to Monday (`weekShift`, in `dayOffset`), from the file's `weeks`. During a game the points come from Sleeper's matchups (`footballLines`:
  lines holding only `bonus`), every 30 s; ESPN gives only the game clock (scoreboard, no box scores). A team defense is a player, id 900000 + its team's index, `slp` its code.
  Projections: the job adds Sleeper's weekly feed (Rotowire's numbers, also undocumented) as `raw.proj[week]`, in `projKeys` order, for 3 weeks (`projWeeks`), with the stat names of a
  league's scoring, so `footballPts` is exact in any scoring; kicks are renamed to match (`projected`). A week not in the file uses season averages, and so does a failed feed.
  `perGame` isn't used: `footballEntry` is a player's week (`footballProj`, `footballNow`: real points, plus the projection for the time left), `oneGameSide` adds them up, `fpTotals` takes the
  spread from `projSd` (sports.js; real misses × 0.8, to match 40 real matchups' margins). Matchups counts as weekly lineups, but `bestFootballIds` locks player by player as each game starts;
  the page follows the week's games live, as the Dashboard does. Adds and pickups replace the weakest at the same position. Checked on a real league's 80 team-weeks, weeks 1-8: projected
  110.8 a week, scored 110.1, team-week miss 19.5, favorites won 25 of 40. (i) texts: `infoOver` in sports.js.
