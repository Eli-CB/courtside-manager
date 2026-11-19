# The numbers: js/nba.js

Part of the repo's notes: CLAUDE.md says which file covers what and how to keep them current. Read this before changing js/nba.js (data load, projections, value, the category model).

- nba: NBA data load (`data/players.json`), projections (`projectSide`, `compareCats`, `matchOdds`), category
  model (`scoreCats`, `catZ`, `BASE`: each stat's mean/spread from the data via `baseNow`, the league's teams × roster
  spots by minutes, smart blend, or a past season's archive inside `withSeason`), lineup optimizer. Player value
  (`value`, `lineValue` for a game) everywhere = categories won per game against not playing (`catWins`: each
  category's share of an average team's week over the spread of weekly margins; roto: roto points over the season, `rotoWeights`); trades count it over a waiver
  player (`waiverValue`). `catZ` (vs an average rostered player) is only for shading

## Rules settled with the owner (keep them)
- Stats used (smart blend / this season / last season / last 10, `state.basis`) is a choice only early in a season: once the typical team has played more than 10 games (`seasonSettled`, nba.js) every projection and value uses this season's averages alone (`basisNow` 'now': last season's only for a player yet to play), and the settings menu's picker is gone. So a player 1-2 games in is read from those games.
