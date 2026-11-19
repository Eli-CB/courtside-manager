# Saved leagues, seasons and the demo: js/leagues.js

Part of the repo's notes: CLAUDE.md says which file covers what and how to keep them current. Read this before changing js/leagues.js.

- leagues: saved leagues (`rememberLeague`; each one's own team and lineup kept in `state.leagueStates`), connecting and switching
  (`connectLeague`, `switchLeague`), making a team yours (`adoptTeam`), the demo and the landing page (`viewLanding`; in draft.js until Nov 2026).
  Seasons: the league menu lists the current league's seasons
  under it (`season-pick`/`season-add`); the team menu only picks a team. The league form (`connectLeague`)
  files an earlier season (year < `NBA.season`, or a later season of the same Fantrax `historyId` is here) under its
  league in `state.pastSeasons[historyId]`, never as a league; `foldPastSeasons` moves old duplicates there
- Demo (`state.demo`, the landing page's "Explore a basketball demo league"): the daily file's site league, seen as a team (`demoTeam`: the
  best record with a matchup) so every tab has something to show, it and its teams under made-up names (`demoNames`, in memory only); never in `savedLeagues`, the team picker changes the team, `demo-exit` or
  connecting any league ends it and keeps nothing (`switchLeague`'s `fromDemo`).
