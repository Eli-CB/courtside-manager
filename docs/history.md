# Weekly rosters, awards and finished weeks: js/history.js

Part of the repo's notes: CLAUDE.md says which file covers what and how to keep them current. Read this before changing js/history.js, the awards, or when a week counts as over.

- history: weekly rosters (`loadRosterWeeks`, cached per league), arrivals (start/trade/pickup), season
  archives (`data/seasons/`), game logs (`loadGameLog`; `'cur'` = this season's box scores via `boxGameLog`),
  all awards (every award but Biggest punt and Even Steven: a team's name opens a breakdown: `awardDetails`, `award-team`), past Rosters
- A week is over (`periodOver`) at its end or once its last game day's box scores are all in (that day included): Fantrax ends a weekly
  period Monday evening when the next locks, a day after its last games. Recap, awards, past-week cards use it. So the Recap shows the
  night a week ends, not after the daily job, ESPN's finals of the week's unsaved days go into `BOX` (`fillWeekFromEspn`, live.js;
  from the Recap tab, once a minute at most; basketball only: ESPN's hockey lines lack stats). Every basketball final the live update
  reads goes into `BOX` the same way (`readBoxes` -> `addBoxGame`, `boxAdded`), so Plan Ahead's dots and projection count a night as it ends.

## Rules settled with the owner (keep them)
- Awards (current season "so far" + past seasons) all come from weekly starters (ACTIVE status) and game logs:
  Best draft (picks' games until first dropped, through trades, above replacement in cats), Best manager
  (actual wins vs all-play record), Waiver Wire Wizard (pickups' games while starting; trades excluded),
  Street Clothes (games starters missed while starting), Biggest punt / Even Steven (real season totals),
  Old (was Unc Status: starters' ages, week-weighted), Steal / Bust of the Draft (one pick vs its rank over the season, Draft
  tab's Season totals; keepers excluded), Week of the Year (best all-play week), Heartbreak Hotel (losses by one
  category; points: under 5% of the winner), Benchwarmer Blues (bench players' games), Fan Boy (biggest share of
  starts from one NBA team). Seasons never mix.
