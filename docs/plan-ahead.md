# Plan Ahead: js/matchups.js

Part of the repo's notes: CLAUDE.md says which file covers what and how to keep them current. Read this before changing js/matchups.js.

- matchups: the Plan Ahead tab (`#week`, was Matchups; opens on next period, else the week picked: `planAheadWeek`, `ui.weekChosen`), schedule dots (a game on now: `.dots i.live`, flashing green while he's in it, the owner's ask, never red; a flashing ring until he checks in; listed Out, the red ring; the week underway follows tonight's games, `weekTabLive` in live.js), stat tables, tooltips. The opponent's injured reserve (`state.opp.il`, `oppIlIds`/`oppActive` in nba.js) sits in the board's IR row (tag "IR"; `IL` inside the code), never on their bench or in their projection. A finished week (its last day before today) never shows a projection, the owner's rule: its real
  result and lineups, plus bench swaps that would have changed it (`pastWeekCard`; `benchSwaps`/`weekScore` in history),
  else one line saying why not (`pastNote` in `viewWeek`: the last night's box scores not in yet, with `fillWeekFromEspn` asked meanwhile; no matchup; a league whose past lineups aren't read: ESPN football, Yahoo)

## Rules settled with the owner (keep them)
- Weekly lineups lock when the week starts, so the lineup people are setting is next week's: Fantrax leagues with weekly
  lineups also load next period's rosters (`L.nextRosters`, one more request; the daily job too), and the Matchups tab
  shows them on next week (`withViewedTeam(viewWeek, true)`, `nextRosterPeriod()`, `fxTeamSide(tid, period)`). Every
  other tab and the saved lineup stay on this week's.
