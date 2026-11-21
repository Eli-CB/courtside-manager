# Fantrax: js/fantrax.js

Part of the repo's notes: CLAUDE.md says which file covers what and how to keep them current. Read this before changing js/fantrax.js or anything that asks Fantrax.

- fantrax: `fxGet` (retries/backoff), `fxGetAll`, `fetchFantraxLeague`, league cache (`getLeague`, 6h), shared
  player list/ADP (`fxPlayerLists`: read from the daily job's `data/fantrax.json`, `data/nhl/fantrax.json`, Fantrax itself only when that's missing or over 2 days old), scoring (`fxScoring`: points or categories), keepers (`keepersOf`), name matching
  (`matchPlayers`), which site an ID is on (`leagueSourceOf`, `parseLeagueId`, `sourceName`), `getJson` (shared retries)

## Rules settled with the owner (keep them)
- Fantrax: minimize requests. League data cached on the device; manual ↻ Reload (gear menu) instead of
  loading fresh each visit (no ↻ Reload within 2 minutes of the league's last read: `RELOAD_COOL`, `reloadWait`, the menu says "read just now"); the one automatic reload is 10-20 minutes before a matchup period's first game and 2-6 minutes after, each page at its own random moment in each window (`autoReload.spread`, Nov 2026: a site's worth of visitors mustn't reach Fantrax in the same minute, its busiest)
  (`checkAutoReload`, actions.js: Fantrax starts a period at its first tip-off, else ESPN's scoreboard, else 7 PM ET; only when the
  league was read before that moment; checked once a minute and on coming back to the page), so the lock's lineups and the new
  period show without a manual Reload. Weekly rosters fetched once per finished period. Shared player list/ADP: never from each browser (Nov 20, 2026: thousands of
  visitors each asking Fantrax for the same large lists daily, all from leaguelayer.com, is what gets a site noticed); the daily job saves them.

## Gotchas
- Fantrax rate limits answer 200 OK with `{ error: { code: 'RATE_LIMITED', message: '... at most once every 5 seconds per
  IP address.' } }` (getDraftResults: 5 s): `getJson` waits what it says and asks again; a draft that still doesn't come
  marks the league `draftFailed` (not kept on the device; Draft tab offers Try again), never "no draft".
- Fantrax names can differ from NBA.com ("Nicolas"/"Nic"): `matchNicknames` (initial + last name + team).
