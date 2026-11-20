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
- Landing page (Nov 20, 2026): a first visit gets `landHome` (the form, the demo and sandbox as option cards, `landPreview`, the
  `LAND_FEATURES` grid with the tabs' own icons); adding a league or season and Step 2 (each team with its initials) stay one card. `landPreview`'s
  numbers are made up, the same picture as icons/og.png: change both together. The head shows the site's mark and name there (`leagueMenu`).
