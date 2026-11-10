# Yahoo sign-in helper

Yahoo leagues load through each visitor's Yahoo login. Yahoo's fantasy API needs a server for two things a static
page can't do: trade the sign-in code for tokens (that takes the app's secret) and pass API requests through
(Yahoo doesn't allow requests from other sites' pages). `yahoo.js` is that server, a Cloudflare Worker, free on
Cloudflare's plan. It stores nothing: each visitor's tokens stay in their browser.

## One-time setup

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

## ESPN fallback

The site's live scores, late box scores and injury report come from ESPN's site feed, asked by each visitor's
browser. Should ESPN stop answering the site directly, the page switches by itself (after two misses in a row while
leaguelayer.com still answers) to `GET /espn/<sport>/<league>/<scoreboard|summary|injuries>` here, which asks ESPN once
for everyone and keeps each answer at Cloudflare's edge for 20 seconds (an earlier day's scoreboard 10 minutes, the
injury report 5). Only those feeds, only for the site's own pages (`SITE_ORIGINS`). Nothing to set up beyond deploying:

```
npx wrangler deploy
```

Check: `https://api.leaguelayer.com/espn/basketball/nba/scoreboard` answers 404 in a browser tab (no page origin) and
the scoreboard from the site. If it's ever used, the error log says so once per visitor: "ESPN not answering the site
directly ... its feeds come through the Worker". The free plan counts each page's request (100,000 a day); a watching
visitor makes about 2,000 an evening, so a busy night on the fallback may need the $5 plan.

## Checking it

`https://api.leaguelayer.com/yahoo/login?return=https://leaguelayer.com/` should open Yahoo's sign-in. After
allowing access you land back on the site with your Yahoo leagues listed.
