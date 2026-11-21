# Saved leagues, seasons and the demo: js/leagues.js

Part of the repo's notes: CLAUDE.md says which file covers what and how to keep them current. Read this before changing js/leagues.js.

- leagues: saved leagues (`rememberLeague`; each one's own team and lineup kept in `state.leagueStates`), connecting and switching
  (`connectLeague`, `switchLeague`), making a team yours (`adoptTeam`), the demo and the landing page (`viewLanding`; in draft.js until Nov 2026).
  Seasons: the league menu lists the current league's seasons
  under it (`season-pick`/`season-add`); the team menu only picks a team. The league form (`connectLeague`)
  files an earlier season (year < `NBA.season`, or a later season of the same Fantrax `historyId` is here) under its
  league in `state.pastSeasons[historyId]`, never as a league; `foldPastSeasons` moves old duplicates there
- A league that can't load says why (`leagueError`; Nov 20, 2026): a `plainError` (fantrax.js) is shown as it is; a sport a site isn't read for is
  `sportNotRead`, from `SITE_SPORTS` (fantrax.js: keep it in step when a site gains a sport). A link's sport is read before anything's asked
  (`connectLeague`: ESPN hockey/baseball, Yahoo's subdomain); a bare ESPN ID that's neither basketball nor football is asked for as hockey, then baseball
  (`espnOtherSport`). Yahoo, until its sign-in is open to all (`yahooOn`), is `YAHOO_CLOSED`, never "Sign in with Yahoo" with no button. A private
  Fantrax league has never been tried: if Fantrax refuses one, it reads as "didn't find that league".
- Demo (`state.demo`, the landing page's "Explore a basketball demo league"): the daily file's site league, seen as a team (`demoTeam`: the
  best record with a matchup) so every tab has something to show, it and its teams under made-up names (`demoNames`, in memory only); never in `savedLeagues`, the team picker changes the team, `demo-exit` or
  connecting any league ends it and keeps nothing (`switchLeague`'s `fromDemo`).
- Landing page (Nov 20, 2026): a first visit gets `landHome` (the headline beside the form, the demo and sandbox as option cards; no picture
  in the hero, the owner's ask: the "This week, Win odds 68%" card was removed; the `LAND_FEATURES` grid at the foot with the tabs' own icons,
  Trends among them, the owner's ask); adding a league or season and Step 2 (each team with its initials) stay one card. The head shows the site's mark and name there (`leagueMenu`).
  Under the hero, `landShow`'s rows (Nov 20, 2026, the owner's ask): the Matchup tab live, Plan Ahead, the player card (Trends named under it, the
  owner's ask), the draft board and the Recap's picture, made up too but drawn with each tab's own classes (`.mu-chip`, `.game-pill`, `.bmeta`/`.dots`,
  `.swap`, `.pc-photo`/`.cp-row`, `.dr-cell` + `shade`, `RC_IMG`), so check its row after restyling one of those. Players there are real, with their
  real photos (the owner's ask): `landFace`/`playerPhoto` by NBA.com id, `data-photo` taken off so a photo isn't a way to his card. A row's moment (a
  basket turning PTS and the score, the swap going in, the picks coming in) plays once its picture is half in view (`landReveal`, run by `render` after the landing; `.in`);
  its button is `land-demo` with `data-tab`, the demo opened at that tab (`data-player`: with his card open). The pill says "Free · No sign-up" and the footer "League Layer is free." (never "forever", the owner's ask).
  The headline's sport rolls through `LAND_SPORTS` (a sport there when the site announces one, with its solid icon and its own way in,
  `[data-sport]` in styles.css: the ball dribbles in, the puck slides), on its own line so nothing re-wraps; each turn is
  the `animationiteration` of its CSS `land-tick`, not a timer (the harness's `querySelector` always finds an element, so a timer loop never ends in the tests).
