# Live scores and ESPN's feeds: js/live.js, the Worker's /live and /espn/

Part of the repo's notes: CLAUDE.md says which file covers what and how to keep them current. Read this before changing js/live.js or the Worker's live feed.

- live: live box scores for the Dashboard matchup's and Performances' Today (and This week). Live scores come first from the Worker's live feed (`liveFeedGet`: `/live/<sport>/<league>`, worker/yahoo.js: today's scoreboard and each game's box score cut to what the page reads, ~8 KB compressed a night, built once and kept 5 s at the edge, at most 3 box scores read a build for the free plan's 10 ms of CPU; `readBoxes(games, feed)` uses a game's box score from it when under 45 s old, else asks ESPN if due; the feed failing = ESPN directly for 10 minutes; keep `liveScoreboard`/`liveBox` in step with what espnGames/espnLines/espnHockeyLines/espnFloor/espnPlayer read). The injury report and finished days go through `/espn/` first (`espnSite(path, tries, pooled)`). Every other ESPN site-feed request goes through `espnSite(path)`:
  direct from the browser; after `ESPN_SWITCH` (2) misses in a row while leaguelayer.com answers, through the Worker's cached `/espn/` route (worker/yahoo.js)
  for 6 hours on that device (`league-layer-espn-route`), logged once. Failing feeds back off (`feedWait`: ×2 per miss, 5 min at most) for live scores,
  ESPN/Sleeper league points and the late finals. Fantrax and Sleeper stay direct on purpose: their limits are per IP, and a proxy would pool everyone's. The browser polls ESPN's site API
  (`site.api.espn.com`, CORS-open; NBA.com's live CDN isn't) every 30 s (60 s with Save-Data) while the Dashboard or Players tab is visible,
  it isn't set to the last game day (`ui.dashRange` / `ui.perfRange`), and games are on: scoreboard + the box score of each game in progress
  (`live.lines`: date -> NBA id -> line). ESPN's undated scoreboard (and so the live feed's) stays on last night's games until late morning
  (still at 11 a.m. ET, Nov 17, 2026): `pollLive` adds today's from `scoreboard?dates=` meanwhile, or the Matchup tab has no tip-offs. ESPN players matched by `espn` id (from the daily job) else initial + last
  name + team. Yesterday and this week's earlier days missing from `data/boxscores.json` are asked for once.

## Gotchas
- ESPN load (Nov 15, 2026, the owner's ask: thousands of visitors without ESPN blocking the site): every visitor's browser
  used to ask ESPN itself, about 10 requests a minute on a busy night (the scoreboard every 30 s, each live game's
  400 KB box score about once a minute), all marked as from leaguelayer.com, while the page reads about 1% of each box
  score. Now the Worker's live feed (`/live/<sport>/<league>`, see the live bullet above and worker/README.md "Live feed")
  builds today's scores once for everyone (~8 KB compressed a night, kept 5 s at the edge): ESPN is asked a few times a
  minute per Cloudflare data center (until hundreds watch through one: nothing stops requests that arrive while the
  expired copy is rebuilt from each building it too, so ESPN's count then grows with them), each visitor makes one small request every 30 s, and
  the injury report and finished days go through `/espn/` first. Direct ESPN stays the fallback, so the site works with
  the Worker down or not yet deployed. The Worker is the owner's to deploy (`npx wrangler deploy` in worker/; never run
  it or `wrangler secret put` yourself): the /live route was written Nov 15, 2026; until it's deployed, pages ask for it,
  get a 404 and go to ESPN for 10 minutes. Measured on a real night: the feed matched ESPN's raw answers exactly through
  the page's own parsers (games, lines, who's on the floor). Cost: the free plan's 100,000 Worker requests a day are about
  800 hours of live viewing; past that the $5 Workers Paid plan. A build reads at most 3 box scores (LIVE_BOX_PER_BUILD,
  ~3 ms CPU each against the free plan's 10 ms). Watch it in Cloudflare's dashboard: Workers & Pages, leaguelayer-yahoo,
  Metrics (requests, errors incl. exceeded CPU, CPU time, subrequests), or `npx wrangler tail` (worker/README.md
  "Watching it"). Fantrax and Sleeper stay direct on purpose (per-IP limits: a proxy would pool everyone's).
- ESPN's injury report: the morning job's, then the page reads ESPN's feed itself (`refreshInjuries`/`applyInjuries`, live.js; from `render` and on coming back
  on screen, at most every 15 min, no timer; ~50 KB; same Out/DTD rules as the jobs; one it can't place keeps the morning's entry; under 5 matched = not believed).
  A player listed questionable who then plays loses the tag once he's played on or after his entry's date (`playedSince`/`dropPlayedInjuries`, nba.js:
  saved box scores, or ESPN's live lines of tonight's game).
