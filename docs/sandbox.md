# The Sandbox: js/sandbox.js

Part of the repo's notes: CLAUDE.md says which file covers what and how to keep them current. Read this before changing js/sandbox.js or anything that must work with no league.

- sandbox: the Sandbox (`state.browse`, Nov 2026, the owner's ask; was "Just browse players"; the landing page's "try the sandbox" and the league menu's
  "Sandbox: any players, no league"): `fxLeague()` is null (the daily file's site league, or your own, stays loaded underneath), `clearLeaguePlayers()`
  drops its rosters/positions from the players. No bar under the tabs (the owner's ask: people may stay in the sandbox): two menus in the head where a league's
  team picker is (`sbMenus`, drawn by `teamMenu`; icons on a phone) pick the sport (basketball or hockey, `sbSetSport`: `useSport`,
  each sport its own team, watch list and scoring) and the scoring (`sbSetScoring`): the sport's standard categories (`CATS`), a site's standard points
  (`SB_POINTS`: basketball's ESPN default since 2020 and Yahoo's head-to-head points, both checked Nov 2026; hockey none, ESPN doesn't publish its whole table)
  or your own points (a popup, `sbPointsForm`). `leaguePoints()` asks `sbPoints()` with no league, and `scoreCats` keys its memo on the points too. Tabs (`TABS_BROWSE`): My team (`#team`: any players, up to `SANDBOX_MAX`),
  Live (`#watch`: up to `WATCH_MAX` 12 followed live, `watchTabLive` in live.js; cells built from the Matchup tab's `dashGame`/`lineChips`; Today / Yesterday / Week,
  Monday to Sunday so far; a full list or team says Max by its count, no sentence, the owner's ask; no "Mine" badge on a cell, the owner's ask Nov 20, 2026;
  a day's player sitting out (Out, not starting, a final without him) dimmed after those playing, as the Matchup tab's day), Players, Trends
  (My team / Everyone else lists; My team's own list and card don't tag each row "My team"), Trades (`#trade`: give My team's players, get anyone found by name; `tradeCard` drawn inside `withState` with My team as
  `state.players`; shared with the site's address, no league link). Kept in `state.sandbox` { sport, nba: {roster, watch, scoring, points}, nhl: {...} } (`sandboxClean`
  in core.js; `sbState()` is this sport's), apart from any league. My team is the team id `SB_ME`: `myTeamId()` and `fxTeamName` know it, so `teamLink` draws "My team" in orange. Add / Follow live also on every
  player's card (`sbCardLine` via `cardOwner`), and + / ✓ on each Players tab row (`sbAddBtn`, the owner's ask); searches are `sbSearch` (`ui.sbQ`). Leaving: pick a league in the league menu (`switchLeague`, which reads it again and
  puts its players' league details back, then the Matchup tab). The league underneath stays in `state` (players, lineup, slots), maybe another
  sport's: `validateLineup` and `loadNba`'s startup checks leave it alone in the sandbox (they threw on basketball's PG in hockey's table, and a reload on
  hockey dropped the basketball league's team pick, Nov 18, 2026), the league to go back to is named on entry (`state.sandbox.back`: the other sport's data
  doesn't know the site's own league), and `switchLeague` stashes its state under it first (a pick already lost comes back from that copy). Code reading `state.fxTeam` must expect undefined there (a first visit), not only null.
