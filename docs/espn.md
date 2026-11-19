# ESPN leagues: js/espn.js, js/roto.js

Part of the repo's notes: CLAUDE.md says which file covers what and how to keep them current. Read this before changing js/espn.js or js/roto.js.

- espn: `fetchEspnLeague` turns a public ESPN league into the same league shape (`source: 'espn'`), so every
  tab works unchanged; what basketball and football leagues share (fetch, matchups, slots, rosters, standings, draft) is `espnLeagueShape`/`espnLeagueJson`. "fx" names (`fxLeague`, `raw.fx`, `fxTeamSide`) mean "the league's site", either one.
  ESPN football (`fetchEspnFootball`, `sport: 'nfl'`): an ID ESPN answers 404 as basketball is asked for as football (one extra request). Weeks are NFL weeks from
  the file's `weeks` (ESPN's scoring periods), players the file's by `espn` id (the job matches ESPN's player list by name and team: Sleeper's has a quarter of
  them; a D/ST is -16000 less its team's number, `espnFootballId`), scoring `ESPN_FFL_STATS` (ESPN stat id -> the data's names; D/ST-only stats at ESPN's
  D/ST points; a TE/RB/WR reception premium as Sleeper's bonus_rec_*). The job adds ESPN's own points-allowed brackets (14-17, 18-21, 22-27, 35-45, 46+)
  and `def_fum_rec` (special teams' included) to a defense's lines (`espn_defense`). Checked on a real league: 1,169 of 1,170 player-weeks matched ESPN's
  points (the one: a sack counted differently). Live points: ESPN's per week, in `L.slpWeek` like Sleeper's (`espnWeekFresh`, `leagueWeekFresh`, every 30 s).
  Category football isn't read. No Recap, Awards or Season totals.
  ESPN roto (`scoringType` 'ROTO', Nov 19, 2026, both stages; `espnRoto`, `L.roto`, `isRoto()` in core.js, the rest in roto.js): no periods or matchups (ESPN's one
  matchup is the season; a roto "week" is the calendar's, `spanWord()`); `L.standings` are ESPN's own points (`pointsByStat`, `points`) with each team's totals (`tot`,
  from `valuesByStat`, games as `gp1`), ranked by points, ties sharing; `gpMax`/`gpSpot` from `lineupSlotStatLimits`. Value (`rotoWeights`, nba.js): a game's
  standings gain points, the stat over 2√π × a team's season spread (`rotoSpread`: G²/S × b² + game swings, G = the games limit) ÷ (teams − 1). The projected
  finish (`rotoOutlook`, a day's memo): totals so far + each roster's games from tomorrow (`rotoRest`: daily best lineups, Out until ESPN's `inj.back` or 2 weeks,
  past the limit only the best games), expected points = 1 + chances of finishing ahead (unsure by `ROTO_DRIFT` 0.5: a judgment, not checked on a real season).
  Standings (Now / Projected, `ui.rotoView`), the Matchup head, Plan Ahead's Season outlook (`rotoOutlookCard`, games pace `rotoPace`) and Trades' For your team
  (`rotoTradeChange`, `rotoTradeRow`) read it. No opponent's column on Plan Ahead or the Matchup rows (`solo`), no Recap tab. ESPN's real roto numbers aren't
  checked yet (the test league hadn't played).

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
