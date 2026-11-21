# Yahoo leagues: js/yahoo.js

Part of the repo's notes: CLAUDE.md says which file covers what and how to keep them current. Read this before changing js/yahoo.js or the Worker's sign-in (see also worker/README.md).

- yahoo: Yahoo leagues through a Yahoo login (OAuth): the Worker `worker/index.js` (Cloudflare Worker at
  api.leaguelayer.com, setup in `worker/README.md`) runs the sign-in and passes API requests through (Yahoo's API isn't
  CORS-open); tokens stay in the browser (`league-layer-yahoo`). `yahoo.proxy` empty = Yahoo hidden; while `yahoo.beta`, the sign-in shows only on a device that opened `?yahoo=1` (or is signed in). `yflat` turns Yahoo's
  JSON ("0","1"…+count objects, arrays of one-key objects) into plain lists/objects; `fetchYahooLeague` maps to the league
  shape (`source: 'yahoo'`, ids = league keys `nba.l.N`). Test fixtures are made up in Yahoo's layout
  (`tests/make_yahoo_fixtures.py`): check against a real league once signed in. Blocked on Yahoo, not code: since July 2026 Yahoo
  answers unapproved apps 403, and the owner applied again Nov 10, 2026. Don't work on it until the owner says it's approved, then
  follow worker/README.md "When Yahoo approves" (two sign-in weaknesses to fix before everyone gets it).
