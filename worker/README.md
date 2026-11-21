# League Layer's Worker

`index.js` is the site's one server, a Cloudflare Worker at `api.leaguelayer.com` on Cloudflare's free plan, for what
a static page can't do alone: the live feed (Live feed), ESPN's feeds through Cloudflare (ESPN fallback), the error log
(Error log), the daily data job's start (Daily data job) and Yahoo's sign-in (Yahoo sign-in, waiting on Yahoo). The
owner deploys it, from this folder: `npx wrangler deploy` (Claude never runs wrangler).

It's deployed under the name `leaguelayer-yahoo` (`name` in `wrangler.toml`, from its first job): that's the name in
Cloudflare's dashboard. Renaming it there would make a new Worker, so its secrets would need setting again and the old
one deleting (or it keeps starting the daily data job too).

## Yahoo sign-in

Yahoo leagues load through each visitor's Yahoo login. Yahoo's fantasy API needs a server for two things a static
page can't do: trade the sign-in code for tokens (that takes the app's secret) and pass API requests through
(Yahoo doesn't allow requests from other sites' pages). The Worker does both and stores nothing: each visitor's tokens
stay in their browser.

### One-time setup

1. **Yahoo app** (needs a Yahoo account): go to https://developer.yahoo.com/apps/create/ and fill in
   - Application name: League Layer
   - Application type: Web Application
   - Redirect URI(s): `https://api.leaguelayer.com/yahoo/callback`
   - API permissions: Fantasy Sports, Read

   Create it, then keep the **Client ID** and **Client Secret** it shows.

2. **Cloudflare Worker** (needs the Cloudflare account that has leaguelayer.com, and Node.js). From this folder:

   ```
   npx wrangler login
   npx wrangler secret put YAHOO_CLIENT_ID
   npx wrangler secret put YAHOO_CLIENT_SECRET
   npx wrangler deploy
   ```

   `wrangler deploy` also sets up `api.leaguelayer.com` (see `wrangler.toml`).

3. **Turn it on in the site**: in `js/yahoo.js`, set `proxy: 'https://api.leaguelayer.com'` and deploy the site.
   The "Sign in with Yahoo" button appears on the league form.

### When Yahoo approves

Since July 2026 Yahoo lets only approved apps read fantasy data: until then every Fantasy API call answers 403 "This
application is not authorized", whatever the code does. Apply at https://sports.yahoo.com/developer/access/ (sign the
agreement, confirm the Client ID; some apps had to be made again). Yahoo turned the first application down (Nov 10, 2026)
for missing details: every field filled in, a full first and last name, and a clear description of the use (read-only
`fspt-r`, tokens only in the visitor's browser, the Worker stores nothing, reads kept 6 hours on the device). The owner
applied again. Once Yahoo approves, in order:

1. The owner sets the Worker's secrets (it has none yet: its sign-in sends `client_id=undefined`), from this folder:
   `npx wrangler secret put YAHOO_CLIENT_ID`, then `npx wrangler secret put YAHOO_CLIENT_SECRET`, from the Yahoo app's page.
   If Yahoo made a new app on approval, use its ID and check its redirect URI is `https://api.leaguelayer.com/yahoo/callback`.
   Claude never asks for or handles the secret and never runs wrangler.
2. Check https://api.leaguelayer.com/yahoo/login?return=https://leaguelayer.com/ sends you to Yahoo with a real `client_id`.
3. The owner signs in on leaguelayer.com/?yahoo=1 with their real Yahoo league. Test every tab against it (the fixtures
   were made up in Yahoo's layout, `tests/make_yahoo_fixtures.py`), fix what maps differently, and remake the fixtures
   from the real answers, names anonymized.
4. Only basketball is read (`game_keys=nba`); hockey would need adding.
5. Before everyone gets it, fix the two sign-in weaknesses from the Nov 15, 2026 security review (harmless while the
   Worker has no Yahoo secrets; both need the owner's Worker deploy):
   - The OAuth `state` is only the return address, and the page keeps whatever comes after `#yahoo=`, so a made-up link
     can sign a visitor into someone else's Yahoo account. Add a random value kept in sessionStorage, sent in `state`
     and checked on the way back.
   - `SITE_ORIGINS` (wrangler.toml) lists localhost ports for testing the live feed, and the sign-in accepts each of
     them as a return address for tokens. The deployed sign-in should return only to https://leaguelayer.com.
6. Then drop `yahoo.beta` in `js/yahoo.js` so everyone sees the sign-in, and update CLAUDE.md.

## Error log

The same Worker keeps the site's error log: when a page breaks in someone's browser on leaguelayer.com, the site sends
the error (message, where in the code, page, league site and ID, version, browser) to `POST /errors`, and it's kept for
30 days in a KV namespace. One-time setup, from this folder:

```
npx wrangler kv namespace create ERRORS
```

Put the `id` it prints into the `[[kv_namespaces]]` block at the end of `wrangler.toml` (done: League Layer's is there). Then
pick a password for the log page and deploy:

```
npx wrangler secret put ERRORS_KEY
npx wrangler deploy
```

The log: `https://api.leaguelayer.com/errors?key=<that password>` (each error once, with how many times, when, and on
which pages and leagues). Until this is set up the site's reports are dropped.

One address adds at most 20 reports an hour (`ERRORS_PER_IP_HOUR`, Nov 20, 2026): each is a KV write, the free plan
allows 1,000 a day, and the site's Origin is only what a request says, so anyone could send it. A page sends 5 at most a
visit, so visitors never reach it. Needs `npx wrangler deploy` to take effect.

## Requests from outside the site

The routes only answer the site's own pages (`SITE_ORIGINS`), but a request's Origin is only its word: a script
anywhere can send `Origin: https://leaguelayer.com` and spend this Worker's requests (100,000 a day on the free plan;
$0.30 a million on the $5 plan). Nothing inside the Worker can stop that, as the request is counted once it arrives.
Cloudflare can, before it arrives, for free. One-time setup, in the dashboard (the owner's; nothing to deploy):

1. https://dash.cloudflare.com, the leaguelayer.com domain, **Security**, **Security rules** (older dashboards:
   **WAF**, **Rate limiting rules**), **Create rule**, **Rate limiting rule**.
2. Name: `api.leaguelayer.com per visitor`. If incoming requests match: Field **Hostname**, equals,
   `api.leaguelayer.com`.
3. With the same characteristics: **IP**. When rate exceeds: **100** requests per **10 seconds**. Then: **Block**, for
   **10 seconds** (the free plan's choices).
4. Deploy.

A visitor's page makes about one request every 30 seconds, plus a burst of 10-20 on a morning before the daily data
(last night's box scores through `/espn/`), so 100 in 10 seconds is only ever a script, or many people behind one
address (an office). Blocked requests show under Security, Events.

## ESPN fallback

The site's live scores, late box scores and injury report come from ESPN's site feed, asked by each visitor's
browser. Should ESPN stop answering the site directly, the page switches by itself (after two misses in a row while
leaguelayer.com still answers) to `GET /espn/<sport>/<league>/<scoreboard|summary|injuries>` here, which asks ESPN once
for everyone and keeps each answer at Cloudflare's edge for 10 seconds (an earlier day's scoreboard 10 minutes, the
injury report 5), rebuilt by one request at a time as the live feed is (Live feed). With ESPN's own servers' copies already a few seconds old, a live score is at most about 30 s behind. Only those feeds, only for the site's own pages (`SITE_ORIGINS`). Nothing to set up beyond deploying:

```
npx wrangler deploy
```

Check: `https://api.leaguelayer.com/espn/basketball/nba/scoreboard` answers 404 in a browser tab (no page origin) and
the scoreboard from the site. If it's ever used, the error log says so once per visitor: "ESPN not answering the site
directly ... its feeds come through the Worker". The free plan counts each page's request (100,000 a day); a watching
visitor makes about 2,000 an evening, so a busy night on the fallback may need the $5 plan.

## Live feed (the site's live scores)

`GET /live/<sport>/<league>` (`basketball/nba`, `hockey/nhl`, `football/nfl`): today's scoreboard and each game's box
score in one answer, cut to what the page reads (scores, clocks, every player's line, who's on the floor): about
8 KB compressed for a night of games, where asking ESPN directly is a 16 KB scoreboard plus 37 KB per game. Built once
and kept at Cloudflare's edge for 5 seconds; once it's older, one request rebuilds it while the others take the old copy
(under 15 s old) or wait for the new one (`sharedCopy`), so ESPN is asked a few times a minute per Cloudflare data
center however many people are watching, even when they ask together (every open page asks at a game's tip-off, then
every 30 s from it), and each visitor's update every 30 seconds is one request. A build reads at most 3 box scores
(each takes ~3 ms of CPU, and the free plan allows 10 ms a request), the oldest first; each game keeps its last one in
the cache between builds, and a finished game is read once. The page reads this first and asks ESPN directly for a game
whose box score here is over 45 s old (few people watching: builds are rare then), and for everything when this doesn't
answer (not deployed yet, or down), trying it again 10 minutes later. Only for the site's own pages (`SITE_ORIGINS`).
Nothing to set up beyond deploying:

```
npx wrangler deploy
```

Check: `https://api.leaguelayer.com/live/basketball/nba` answers 404 in a browser tab (no page origin), and the site's
Matchup tab during games asks it once every 30 seconds and ESPN for nothing else (the browser's Network tab). The
injury report and finished days' scoreboards and box scores also come through `/espn/` first now (one copy for
everyone), with ESPN directly when the Worker can't answer.

Cost: the free plan counts each request (100,000 a day): two a minute per visitor watching live is about 800
visitor-hours a day. Past that, the $5 Workers Paid plan (10 million a month; then $0.30 a million) covers roughly a
thousand people watching three hours a night all season. If the free plan's CPU limit ever trips a build (an error in
Cloudflare's dashboard for this Worker), the page just asks ESPN directly for that update.

## Daily data job

The site's data (box scores, players, leagues) comes from the GitHub workflow `.github/workflows/site.yml`. GitHub runs
a workflow's own schedule late when it's busy: the job set for 08:00 UTC started between 14:54 and 18:12 UTC on Nov
11-16, 2026, so last night's games reached the site around midday. A run asked for through GitHub's API starts at once,
so this Worker asks for one every day at 08:00 UTC (a Cron Trigger, in `wrangler.toml`). The workflow keeps a schedule
of its own at 09:23 UTC as the backstop; when both come, the data is just refreshed twice.

One-time setup:

1. **A GitHub token** that can start the workflow and nothing else: on GitHub, Settings, Developer settings, Personal
   access tokens, **Fine-grained tokens**, Generate new token.
   - Token name: League Layer data job
   - Expiration: the longest offered (GitHub emails before it ends; once it has, the error log says
     "Daily data job not started: GitHub answered 401", and the workflow's own schedule still runs)
   - Repository access: Only select repositories, `league-layer`
   - Permissions, Repository permissions: **Actions: Read and write** (nothing else)

   Generate it and copy it.

2. From this folder:

   ```
   npx wrangler secret put GITHUB_TOKEN
   npx wrangler deploy
   ```

   (paste the token when asked). `wrangler deploy` also sets up the 08:00 UTC trigger.

Check: in Cloudflare's dashboard, this Worker's Settings list the cron trigger `0 8 * * *`. The next morning, the
repository's Actions tab shows a run of "Refresh data and publish site" started by `workflow_dispatch` a minute or two
after 08:00 UTC. A run it couldn't start is in the error log (Error log above) as "Daily data job not started", with why.
To renew the token: make a new one the same way, then `npx wrangler secret put GITHUB_TOKEN` again (no deploy needed).

## Checking the Yahoo sign-in

`https://api.leaguelayer.com/yahoo/login?return=https://leaguelayer.com/` should open Yahoo's sign-in. After
allowing access you land back on the site with your Yahoo leagues listed.

## Watching it

Cloudflare's dashboard: https://dash.cloudflare.com, then **Workers & Pages** and **leaguelayer-yahoo** (this Worker's
`name` in `wrangler.toml`). Its **Metrics** tab shows requests, errors, CPU time and subrequests (its own requests to
ESPN and Yahoo) over the last hours and days, nothing to set up. During games, look for:

- **Requests** against the free plan's 100,000 a day (the account's Workers & Pages overview shows the day's total).
  About two a minute per person watching live, plus the injury report and the odd fallback.
- **Errors**, and in them **exceeded CPU**: a live feed build over the free plan's 10 ms. The page then asks ESPN
  directly for that update, so nothing breaks, but many of them mean the $5 plan (or a lower LIVE_BOX_PER_BUILD).
- **CPU time**: most requests are cache hits, well under 1 ms; builds a few ms each.
- **Subrequests**: the ESPN requests. With the live feed on, a handful a minute per Cloudflare data center, whatever
  the number of visitors.

Live, request by request, from this folder (Ctrl+C to stop):

```
npx wrangler tail
```

And the site's own error log (pages that broke in someone's browser, ESPN not answering): see Error log above.
