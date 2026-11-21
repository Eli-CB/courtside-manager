# The site's files and hosting

Part of the repo's notes: CLAUDE.md says which file covers what and how to keep them current. Read this before changing the logo, 404 page, home-screen install, deploy setup, error log or analytics.

- Logo ("Sheet" in "Ink" colors, chosen for now): `scripts/build_icons.py` draws it and writes `icons/logo.svg`,
  `icons/favicon.svg` (also inline in index.html, and drawn by `sharePad`'s `mark` on the share pictures: copy it to both if it changes) and the three PNGs. On a home screen the mark stays inside the middle 80% circle.
  It also draws `icons/og.png` (1200 x 630), the picture a shared link shows: index.html's `og:`/`twitter:` tags, the same for every address (crawlers don't run the script).
- `404.html`: GitHub Pages' page for any address that doesn't exist ("Jahlil Okafor-o-four": his jersey in SVG, Philadelphia's colors only, no team logo or wordmark), self-contained (inline styles, root-relative font and links: it shows at any depth).
- Home screen: `manifest.webmanifest` + `icons/` + the tags in index.html make the site install full screen (`canInstall`, the settings menu's Install the app:
  the browser's offer, or steps for an iPhone, which keeps the app's storage apart from Safari's, so a league is connected once more there). No service worker on purpose: every
  visit is the live site. An installed app has no refresh button, so returning after 3 hours reloads it (`appStale`).

## Gotchas
- The repo must stay public on GitHub's free plan: making it private deletes the Pages site at once (leaguelayer.com answered 404, Nov 16, 2026), and
  making it public again doesn't bring it back. To restore: `gh api -X POST repos/Eli-CB/league-layer/pages -f build_type=workflow`, then
  `gh api -X PUT .../pages -f cname=leaguelayer.com`, then `gh workflow run site.yml`. Private needs GitHub Pro, and Actions minutes then count.
- `__BUILD__` in index.html and js/core.js is replaced at deploy with the hash of the last commit that changed `index.html`, `styles.css` or `js/` (cache busting; not the latest commit: the daily data commits mustn't make visitors download the code again).
- Errors: on leaguelayer.com, `reportError` (core.js, from window `error` / `unhandledrejection` in our own js files,
  each once a visit, 5 at most), never from a crawler (`CRAWLER`: Googlebot renders the page and sometimes skips a script, so every one after it fails, a burst of "ui is not defined"-style reports, seen Nov 15, 2026) posts to the Worker's `/errors` (KV `ERRORS`, 30 days); the owner reads
  `api.leaguelayer.com/errors?key=<ERRORS_KEY>` (setup in `worker/README.md`). The footer says so, with the not-affiliated line.
  Caught errors don't reach it by themselves: ESPN's live feed failing 3 updates in a row does, as "ESPN live scores failing" (`noteLiveFailure`:
  a block, or a new format the site can't read; not the visitor's own connection). If that shows up: `SPORT.espn` in sports.js is where the feed is read.
- Traffic: Cloudflare Web Analytics (no cookies), its beacon added by core.js on leaguelayer.com only (not inline in index.html: the
  Content-Security-Policy allows no inline script; the domain is DNS-only, so Cloudflare can't inject it). Stats: dash.cloudflare.com → Web Analytics. An ad blocker stops it ("beacon.min.js
  net::ERR_BLOCKED_BY_CLIENT" in the console, the browser's own line): harmless, nothing reads it and `reportError` skips it; that visit just isn't counted, so the numbers run low.
- Capacity (measured Nov 21, 2026: the published files in Chromium, leagues from the fixtures): a first visit downloads ~1.5 MB
  compressed from GitHub Pages (hockey and football 1.9; each month of box scores adds 50-85 KB), about half of it `headshots.webp`
  (740 KB, NHL 900, NFL 1,010, since the sheets went to quality 72 that day: 1.0, 1.2 and 1.4 MB before).
  Count it once per visitor per day: a deploy (the daily data run, any push) can make browsers fetch every file again. Pages' soft
  limit, 100 GB a month, is then ~60,000 visits (~2,000 daily visitors), with no published limit on visitors at once; Cloudflare's
  static hosting has no bandwidth charge or cap. The Worker's side: worker/README.md "Live feed" (its free plan, ~800 hours of live scores a day).
