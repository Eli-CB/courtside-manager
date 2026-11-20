# Sleeper leagues: js/sleeper.js

Part of the repo's notes: CLAUDE.md says which file covers what and how to keep them current. Read this before changing js/sleeper.js or anything a Sleeper league reads differently.

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
- Transactions (Standings' Moves this period, `sleeperMoves` in views.js; the owner's ask, Nov 20, 2026): `league/<id>/transactions/<week>`, one request
  when Standings first draws the league. Only `status: 'complete'` (failed waiver claims are listed too); a trade's `adds`/`drops` say who got each player from
  whom, `draft_picks` (`roster_id` = whose pick it was) and `waiver_budget` too; a waiver's bid is `settings.waiver_bid`. Sleeper files a dynasty league's whole
  offseason under week 1 (The IPA: 276 back to March, 29 trades), so moves count from a week before the period starts (`status_updated`). Checked on The IPA,
  weeks 1-5: 5 of 87 players weren't in the data file, players with no NBA team (Jeremy Sochan, Cam Thomas, Rob Dillingham, Nov 2026), drawn "A player":
  Sleeper's own list names them, but it is 414 KB compressed (2.5 MB), too much for the page to fetch for a name.

## Gotchas
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
