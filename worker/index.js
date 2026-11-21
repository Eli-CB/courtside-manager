// League Layer's Worker: the site's one server, a Cloudflare Worker at api.leaguelayer.com (deployed under the name
// leaguelayer-yahoo, from its first job; README.md). It answers only the site's own pages (SITE_ORIGINS). Its jobs:
//
// Today's games for everyone at once, the feed the site's pages read first while games are on (liveFeedGet in
// js/live.js; ESPN directly when this can't answer):
//   GET  /live/<sport>/<league>
// ESPN's scoreboard and each game's box score cut to what the page reads (scores, clocks, every player's line, who's on
// the floor: about 1 KB a game where ESPN's box score is 400), one small answer kept at the edge for LIVE_TTL seconds.
// ESPN is asked a few times a minute per Cloudflare data center however many people are watching (sharedCopy), and each
// visitor's update is one request instead of one per game.
//
// ESPN's site feed, should ESPN stop answering the site's pages directly (the page switches here by itself: espnSite
// in js/live.js), and the feeds the same for everyone (the injury report, finished days), asked here first:
//   GET  /espn/<sport>/<league>/<scoreboard | summary | injuries>?<dates | event>
// Only those three feeds of the three sports, each answer kept at Cloudflare's edge for seconds (ESPN_TTL), so ESPN is
// asked about once per feed every 10 seconds however many people are watching (sharedCopy).
//
// The injury watch: ESPN's injury reports read every few minutes for everyone (Cron Triggers), the page's first source
// for injuries (refreshInjuries in js/live.js; ESPN's own report through /espn/ when this can't answer):
//   GET  /injuries/<sport>/<league>
// The report cut to what the page reads (about 25 KB where ESPN's is 1.2 MB), with when each player's status was first
// seen and what it was before. Kept in KV (the error log's namespace, one key a sport).
//
// The site's error log (a page that crashed in someone's browser):
//   POST /errors                      the site sends one error: message, where it came from, page, league, version, browser
//   GET  /errors?key=<ERRORS_KEY>     the last 30 days' errors, newest first, the same ones grouped (for the owner)
// Kept in the KV namespace bound as ERRORS for 30 days; ERRORS_KEY is a secret. Without them errors are dropped.
//
// The daily data job's start: at 08:00 UTC (a Cron Trigger, wrangler.toml) it asks GitHub to run the site workflow
// (.github/workflows/site.yml), whose own schedule GitHub starts hours late. GITHUB_TOKEN is a secret (README.md);
// without it nothing happens. A run it can't start goes to the error log.
//
// Yahoo's sign-in, waiting on Yahoo's approval (README.md). Yahoo's fantasy API needs a Yahoo login (OAuth 2.0) and
// doesn't allow requests from other sites' pages, so this does the two things the site can't:
//   GET  /yahoo/login?return=<page>   sends the visitor to Yahoo to sign in and allow read access
//   GET  /yahoo/callback              Yahoo sends them back here; trades the code for tokens (that needs the app's
//                                     secret, which only this server has) and returns them to the page, after #yahoo=
//   POST /yahoo/refresh               a fresh access token from the refresh token the page keeps
//   GET  /yahoo/api/<path>            the fantasy API itself, passed through with the visitor's token
// Nothing is stored here: each visitor's tokens live in their own browser.
// Settings (wrangler.toml and `wrangler secret put`): YAHOO_CLIENT_ID, YAHOO_CLIENT_SECRET, SITE_ORIGINS.

const AUTH = 'https://api.login.yahoo.com/oauth2/';
const API = 'https://fantasysports.yahooapis.com/fantasy/v2/';
const ERROR_DAYS = 30;
const ERROR_FIELDS = { msg: 300, at: 300, stack: 1500, page: 120, source: 20, league: 60, build: 20, ua: 200 };
// ESPN's feeds the site reads, and how long one answer is kept (seconds): a game day's scoreboard and a box score while
// games are on, an earlier day's scoreboard (its games are over), the injury report
const ESPN_SITE = 'https://site.api.espn.com/apis/site/v2/sports/';
const ESPN_LEAGUES = new Set(['basketball/nba', 'hockey/nhl', 'football/nfl']);
// (10 s: ESPN's own servers already hand out copies several seconds old, so 20 s here held a live scoreboard about 40 s)
const ESPN_TTL = { scoreboard: 10, pastScoreboard: 600, summary: 10, injuries: 120 };
// The live feed: the whole answer is kept LIVE_TTL seconds; a game's box score is read again once LIVE_BOX_FRESH old, at
// most LIVE_BOX_PER_BUILD of them for one build (reading one of ESPN's takes ~3 ms of CPU, and the free plan allows 10:
// the stalest first, so with people watching every game is read every few seconds), a finished game's once; each game's
// cut box score is kept LIVE_BOX_KEEP seconds between builds
const LIVE_TTL = 5, LIVE_BOX_FRESH = 12e3, LIVE_BOX_PER_BUILD = 3, LIVE_BOX_KEEP = 6 * 3600;

// The ESPN address for /espn/<sport>/<league>/<feed>?<query>, and how long to keep its answer; null for anything else
function espnFeed(url) {
  const m = url.pathname.match(/^\/espn\/([a-z]+\/[a-z]+)\/(scoreboard|summary|injuries)$/);
  if (!m || !ESPN_LEAGUES.has(m[1])) return null;
  const [, league, feed] = m, q = new URLSearchParams();
  const dates = url.searchParams.get('dates'), event = url.searchParams.get('event');
  if (feed === 'scoreboard' && dates) { if (!/^\d{8}$/.test(dates)) return null; q.set('dates', dates); }
  if (feed === 'summary') { if (!/^\d{1,12}$/.test(event || '')) return null; q.set('event', event); }
  const ttl = feed === 'scoreboard' && dates ? ESPN_TTL.pastScoreboard : ESPN_TTL[feed];
  return { upstream: `${ESPN_SITE}${league}/${feed}${q.toString() ? '?' + q : ''}`, ttl };
}

// One ESPN feed as ESPN answers it (an error too: passed on to the page, never kept)
async function espnAnswer(upstream) {
  const r = await fetch(upstream, { headers: { Accept: 'application/json' } });
  return { status: r.status, type: r.headers.get('Content-Type') || 'application/json', body: await r.text() };
}

// ----- One copy for everyone (the live feed, each ESPN feed), rebuilt by one request at a time -----
// Each is one copy per Cloudflare data center, kept in its cache and served while fresh (`fresh` seconds). Once it isn't,
// one request rebuilds it, and the others meanwhile take the copy being replaced if it's at most COPY_SLACK seconds past
// fresh, else wait for the new one (COPY_POLLS looks, COPY_POLL ms apart; then they build it too). Without this, every
// request that came during a rebuild (ESPN's round trips, a few hundred ms) built it as well, so ESPN's count grew with
// the number watching; and pages ask together (every open page at a game's tip-off, then every 30 s from it).
// A rebuild under way is marked on this machine (`rebuilding`: its other requests see it at once) and in the cache, for
// the data center's other machines (when it started, which is later than the copy's X-Built). Every look is a Cache API
// call, and the free plan allows 50 calls and subrequests a request (a live build makes up to ~25), hence few looks.
const COPY_SLACK = 10, COPY_POLL = 250, COPY_POLLS = 8, BUILD_MAX = 10e3;
const rebuilding = new Map(); // this machine's rebuilds under way: the copy's address -> when it started
const copyOf = async hit => ({ status: 200, type: hit.headers.get('Content-Type') || 'application/json', body: await hit.text() });
// key: the copy's cache address; build: () -> { status, type, body } (only a 200 is kept), or throws
async function sharedCopy(key, origin, fresh, build, ctx) {
  const cache = caches.default, mark = new Request(`${origin}/__rebuilding/${encodeURIComponent(key.url)}`);
  let elsewhere = 0; // when another machine's request started rebuilding it (the cache's mark, looked at once)
  for (let i = 0; ; i++) {
    const now = Date.now(), hit = await cache.match(key), at = hit ? +hit.headers.get('X-Built') || 0 : 0;
    if (hit && now - at < fresh * 1e3) return copyOf(hit);
    if (!rebuilding.has(key.url) && !(elsewhere > at && now - elsewhere < BUILD_MAX)) {
      rebuilding.set(key.url, now); // (before any wait, so this machine's other requests leave it to this one)
      if (!i) { const m = await cache.match(mark); elsewhere = m ? +(await m.text()) || 0 : 0; }
      if (!(elsewhere > at && now - elsewhere < BUILD_MAX)) return rebuild(key, mark, fresh, build, ctx, now);
      rebuilding.delete(key.url); // another machine's request has it
    }
    if (hit && now - at < (fresh + COPY_SLACK) * 1e3) return copyOf(hit); // the copy being replaced: seconds older
    if (i >= COPY_POLLS) return rebuild(key, mark, fresh, build, ctx, now); // that rebuild is slow, or failed: this one too
    await new Promise(r => setTimeout(r, COPY_POLL));
  }
}
// This request rebuilds the copy: marked as under way, built, kept (a good answer), then unmarked
async function rebuild(key, mark, fresh, build, ctx, started) {
  const cache = caches.default;
  rebuilding.set(key.url, started);
  const done = () => { if (rebuilding.get(key.url) === started) rebuilding.delete(key.url); };
  let copy;
  try {
    await cache.put(mark, new Response(String(started), { headers: { 'Cache-Control': `public, max-age=${BUILD_MAX / 1e3}` } }));
    copy = await build();
  } catch (e) {
    done();
    ctx.waitUntil(cache.delete(mark)); // (so those waiting build it themselves at their next look)
    throw e;
  }
  ctx.waitUntil((async () => {
    try {
      if (copy.status === 200) await cache.put(key, new Response(copy.body, { headers: { 'Content-Type': copy.type, 'X-Built': String(Date.now()), 'Cache-Control': `public, max-age=${fresh + COPY_SLACK}` } }));
      await cache.delete(mark);
    } finally { done(); } // (once the copy is in: this machine's requests waiting for it find it)
  })());
  return copy;
}

// ----- The live feed (/live/<sport>/<league>) -----
// ESPN's scoreboard and box scores with only what the page reads (espnGames, espnLines, espnHockeyLines, espnFloor and
// espnPlayer in js/live.js): keep these in step with those
const liveAthlete = a => (a ? { id: a.id, displayName: a.displayName, shortName: a.shortName } : a);
const liveTeam = t => ({ id: t.id, abbreviation: t.abbreviation });
function liveScoreboard(sb) {
  return {
    day: sb.day,
    events: (sb.events || []).map(e => ({
      id: e.id, date: e.date,
      status: { period: e.status.period, clock: e.status.clock, type: { state: e.status.type.state, shortDetail: e.status.type.shortDetail } },
      competitions: [{ competitors: e.competitions[0].competitors.map(t => ({
        homeAway: t.homeAway, score: t.score, team: liveTeam(t.team),
        probables: (t.probables || []).map(p => ({ name: p.name, status: p.status && { type: p.status.type }, athlete: liveAthlete(p.athlete) })),
      })) }],
    })),
  };
}
function liveBox(sm) {
  return { boxscore: { players: ((sm.boxscore || {}).players || []).map(t => ({
    team: liveTeam(t.team),
    statistics: (t.statistics || []).map(st => ({ name: st.name, keys: st.keys, athletes: (st.athletes || []).map(a => ({ athlete: liveAthlete(a.athlete), active: a.active, didNotPlay: a.didNotPlay, stats: a.stats })) })),
  })) } };
}
const liveKey = (origin, path) => new Request(`${origin}/__live/${path}`); // (this Worker's own cache entries)
const espnJson = async u => { const r = await fetch(u, { headers: { Accept: 'application/json' } }); if (!r.ok) throw new Error(`ESPN ${r.status}`); return r.json(); };
// One build: today's scoreboard, and each game under way or over with its cut box score, the stalest read again
async function liveBuild(league, origin, ctx) {
  const cache = caches.default, now = Date.now();
  const scoreboard = liveScoreboard(await espnJson(`${ESPN_SITE}${league}/scoreboard`));
  const games = league === 'football/nfl' ? [] : scoreboard.events.filter(e => e.status.type.state !== 'pre'); // (football: points from Sleeper)
  const kept = await Promise.all(games.map(async e => { const hit = await cache.match(liveKey(origin, `${league}/box/${e.id}`)); return hit ? hit.json() : null; }));
  const due = games.map((e, i) => ({ e, k: kept[i] })).filter(({ k }) => !k || (!k.final && now - k.at >= LIVE_BOX_FRESH))
    .sort((x, y) => (x.k ? x.k.at : 0) - (y.k ? y.k.at : 0)).slice(0, LIVE_BOX_PER_BUILD);
  const read = await Promise.all(due.map(async ({ e }) => {
    try {
      const b = { at: now, final: e.status.type.state === 'post', box: liveBox(await espnJson(`${ESPN_SITE}${league}/summary?event=${e.id}`)) };
      ctx.waitUntil(cache.put(liveKey(origin, `${league}/box/${e.id}`), new Response(JSON.stringify(b), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${LIVE_BOX_KEEP}` } })));
      return [e.id, b];
    } catch (err) { return null; } // (its last one, if any, until the next build)
  }));
  const boxes = {};
  games.forEach((e, i) => { if (kept[i]) boxes[e.id] = kept[i]; });
  for (const x of read) if (x) boxes[x[0]] = x[1];
  return { v: 1, at: now, scoreboard, boxes };
}

// ----- The daily data job, started on time -----
// GitHub starts the workflow's own schedule hours late (14:54-18:12 UTC for its 08:00, Nov 11-16, 2026), so last night's
// games reached the site around midday; a run asked for through GitHub's API starts at once. Three tries a minute apart
// while GitHub itself fails; a bad or expired token (401) isn't tried again. The workflow keeps a schedule of its own,
// later in the morning, in case this doesn't run.
const DATA_JOB = 'https://api.github.com/repos/Eli-CB/league-layer/actions/workflows/site.yml/dispatches';
const DATA_JOB_TRIES = 3, DATA_JOB_WAIT = 60e3;
async function startDataJob(env) {
  if (!env.GITHUB_TOKEN) return 'not set up';
  let why = '';
  for (let i = 0; i < DATA_JOB_TRIES; i++) {
    if (i) await new Promise(r => setTimeout(r, DATA_JOB_WAIT));
    try {
      const r = await fetch(DATA_JOB, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'League Layer Worker' },
        body: JSON.stringify({ ref: 'main' }),
      });
      if (r.status === 204) return 'started';
      const m = await r.json().catch(() => ({}));
      why = `GitHub answered ${r.status}${m.message ? ` (${m.message})` : ''}`;
      if (r.status < 500 && r.status !== 429) break; // (the token or the address: asking again won't help)
    } catch (e) { why = e.message || 'GitHub not reached'; }
  }
  if (env.ERRORS) await putError(env, { t: Date.now(), country: '', msg: `Daily data job not started: ${why}`, at: 'worker/index.js startDataJob', stack: '', page: '', source: 'worker', league: '', build: '', ua: '' });
  return why;
}

// ----- The injury watch (/injuries/<sport>/<league>) -----
// Cron Triggers (wrangler.toml) read one sport's report a run: basketball on minutes 0, 3, 6..., hockey on 1, 4, 7...
// ESPN's answer is 1.2 MB, about 4 ms of CPU to read, and the free plan allows 10 ms a run, so never two in one run.
// Every 3 minutes from 14:00 to 04:59 UTC (game days' news: questionable, then ruled out before tip-off), else every 15.
// The copy is kept in KV, in the error log's namespace (no setup beyond deploying) under WATCH_KEY, and written only when
// something changed: a status at once, a note or date at most every WATCH_NOTE_EVERY, and once every WATCH_BEAT anyway
// (so a copy older than WATCH_STALE means the watch has stopped). The free plan allows 1,000 KV writes a day.
// Each entry carries `since`, when the watch first saw that status, and `was`, the status before ('' for newly listed;
// none for entries already listed when the watch started, which take ESPN's time for the entry).
// ESPN failing (an error, blocked, or an answer nearly empty) isn't asked again for WATCH_WAIT, doubling each miss to
// WATCH_WAIT_MAX (a site that keeps asking once refused is how it stays refused), logged once; the page meanwhile reads
// ESPN's report through /espn/, or from ESPN directly.
const WATCH = { '*/3 * * * *': 'basketball/nba', '1-59/3 * * * *': 'hockey/nhl' };
const WATCH_KEY = league => `watch:${league}`;
const WATCH_NOTE_EVERY = 15 * 60e3, WATCH_BEAT = 60 * 60e3, WATCH_STALE = 90 * 60e3, WATCH_WAIT = 15 * 60e3, WATCH_WAIT_MAX = 6 * 36e5;
const WATCH_FRESH = 60; // (seconds a data center keeps its copy of the answer: KV is read about once a minute)
const watchPeak = d => d.getUTCHours() >= 14 || d.getUTCHours() < 5;
// One of ESPN's entries cut to what the page reads (applyInjuries, injuryFrom in js/live.js: keep in step)
function watchEntry(i) {
  const a = i.athlete || {}, id = String(((a.links || [])[0] || {}).href || '').match(/\/id\/(\d+)/);
  return {
    status: i.status, date: i.date, shortComment: i.shortComment, details: { returnDate: (i.details || {}).returnDate },
    athlete: { id: id ? id[1] : undefined, displayName: a.displayName, team: a.team && { id: a.team.id, abbreviation: a.team.abbreviation }, position: a.position && { abbreviation: a.position.abbreviation } },
  };
}
const watchId = e => e.athlete.id || `${e.athlete.displayName}|${e.athlete.team && e.athlete.team.abbreviation}`;
const watchNews = e => JSON.stringify([e.status, e.date, e.shortComment, e.details]);
// ESPN's report against the kept copy (prev, or null the first time) -> { copy, write }, or null for an answer not
// believed (nearly empty where the last had many)
function watchNext(prev, feed, now) {
  const old = new Map(((prev && prev.list) || []).map(e => [watchId(e), e])), at = new Date(now).toISOString();
  const list = [];
  for (const t of feed.injuries || []) for (const i of t.injuries || []) {
    if (!i.athlete || !i.athlete.displayName) continue;
    const e = watchEntry(i), o = old.get(watchId(e));
    if (o && o.status === e.status) { e.since = o.since; if ('was' in o) e.was = o.was; }
    else if (o) { e.since = at; e.was = o.status; }
    else if (prev && prev.list && prev.list.length) { e.since = at; e.was = ''; }
    else e.since = e.date || at;
    list.push(e);
  }
  if (list.length < 5 && old.size >= 20) return null;
  const ids = new Set(list.map(watchId));
  const moved = list.some(e => e.since === at) || [...old.keys()].some(k => !ids.has(k));
  const news = moved || list.some(e => { const o = old.get(watchId(e)); return !o || watchNews(o) !== watchNews(e); });
  const age = prev ? now - prev.at : Infinity;
  return { copy: { v: 1, at: now, list }, write: !prev || !!prev.fails || moved || (news && age >= WATCH_NOTE_EVERY) || age >= WATCH_BEAT };
}
// One run for one sport -> what it did (for the tests and `wrangler tail`)
async function injuryWatch(league, env, now = Date.now()) {
  if (!env.ERRORS) return 'not set up';
  const d = new Date(now);
  if (!watchPeak(d) && Math.floor(d.getUTCMinutes() / 3) % 5) return 'off-peak';
  const key = WATCH_KEY(league), prev = await env.ERRORS.get(key, 'json');
  if (prev && prev.off > now) return 'waiting';
  let next = null, why = '';
  try {
    const r = await fetch(`${ESPN_SITE}${league}/injuries`, { headers: { Accept: 'application/json' } });
    if (!r.ok) why = `answered ${r.status}`;
    else if (!(next = watchNext(prev, await r.json(), now))) why = 'came back nearly empty';
  } catch (e) { why = e.message || 'not reached'; }
  try {
    if (!next) {
      const fails = ((prev && prev.fails) || 0) + 1, wait = Math.min(WATCH_WAIT * 2 ** (fails - 1), WATCH_WAIT_MAX);
      await env.ERRORS.put(key, JSON.stringify({ ...(prev || { v: 1, at: 0, list: [] }), fails, off: now + wait }));
      if (fails === 2) await putError(env, { t: now, country: '', msg: `Injury watch: ESPN's ${league} report ${why}; asked again in ${wait / 60e3} minutes, then less often (6 hours at most)`, at: 'worker/index.js injuryWatch', stack: '', page: '', source: 'worker', league: '', build: '', ua: '' });
      return `failed: ${why}`;
    }
    if (next.write) await env.ERRORS.put(key, JSON.stringify(next.copy));
  } catch (e) { return 'KV refused the write'; } // (the day's 1,000 writes used up: the copy goes stale and the page reads ESPN's)
  return next.write ? 'written' : 'unchanged';
}
// The page's answer: ESPN's shape (applyInjuries reads either), or 503 when the watch has none, is failing or has stopped
async function watchAnswer(env, league) {
  const no = why => ({ status: 503, type: 'application/json', body: JSON.stringify({ error: why }) });
  const w = env.ERRORS ? await env.ERRORS.get(WATCH_KEY(league), 'json') : null;
  if (!w || !w.list || !w.list.length) return no('the injury watch has no report yet');
  if (w.fails) return no("ESPN isn't answering the injury watch");
  if (Date.now() - w.at > WATCH_STALE) return no('the injury watch has stopped');
  return { status: 200, type: 'application/json', body: JSON.stringify({ v: 1, at: w.at, injuries: [{ injuries: w.list }] }) };
}

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// One error in the log; the newest sort first in KV's listing (keys count down)
async function putError(env, rec) {
  const key = `${String(1e13 - rec.t).padStart(13, '0')}-${Math.random().toString(36).slice(2, 8)}`;
  await env.ERRORS.put(key, JSON.stringify(rec), { expirationTtl: ERROR_DAYS * 86400 });
}
// Reports one address may add an hour. Each is a KV write (the free plan allows 1,000 a day), and the Origin a request
// gives is only its word: anyone can send the site's. A page sends 5 at most a visit, so only reports sent on purpose
// reach this. Counted in Cloudflare's cache (per data center, no writes of its own)
const ERRORS_PER_IP_HOUR = 20;
async function errorAllowed(req, url) {
  const ip = req.headers.get('CF-Connecting-IP');
  if (!ip) return true;
  const key = new Request(`${url.origin}/__errors/${encodeURIComponent(ip)}/${Math.floor(Date.now() / 36e5)}`);
  const hit = await caches.default.match(key);
  const n = hit ? +(await hit.text()) || 0 : 0;
  if (n >= ERRORS_PER_IP_HOUR) return false;
  await caches.default.put(key, new Response(String(n + 1), { headers: { 'Cache-Control': 'public, max-age=3600' } }));
  return true;
}
// One error from the site, cut to size
async function saveError(req, env, origins, url) {
  if (!origins.includes(req.headers.get('Origin') || '') || !env.ERRORS || !(await errorAllowed(req, url))) return;
  const text = await req.text();
  if (text.length > 4000) return;
  let e;
  try { e = JSON.parse(text); } catch (x) { return; }
  if (!e || typeof e.msg !== 'string' || !e.msg) return;
  const rec = { t: Date.now(), country: (req.cf && req.cf.country) || '' };
  for (const [k, n] of Object.entries(ERROR_FIELDS)) rec[k] = String(e[k] == null ? '' : e[k]).slice(0, n);
  await putError(env, rec);
}

// The log as a page: each distinct error once (how many times, when last, which leagues and pages), newest first
async function errorPage(env) {
  const keys = [];
  let cursor;
  do {
    const r = await env.ERRORS.list({ cursor, limit: 1000 });
    keys.push(...r.keys.map(k => k.name).filter(k => /^\d/.test(k))); // (errors only: the injury watch's copies share the namespace)
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor && keys.length < 300);
  const recs = (await Promise.all(keys.slice(0, 300).map(k => env.ERRORS.get(k, 'json')))).filter(Boolean);
  const groups = new Map();
  for (const r of recs) {
    const id = `${r.msg}|${r.at}`;
    if (!groups.has(id)) groups.set(id, { ...r, n: 0, pages: new Set(), sources: new Set(), leagues: new Set(), first: r.t });
    const g = groups.get(id);
    g.n++; g.first = Math.min(g.first, r.t);
    if (r.page) g.pages.add(r.page);
    if (r.source) g.sources.add(r.source);
    if (r.league) g.leagues.add(r.league);
  }
  const when = t => new Date(t).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const list = [...groups.values()].map(g => `<li><b>${esc(g.msg)}</b> <span class="n">×${g.n}</span>
    <div class="m">Last ${when(g.t)} ET${g.n > 1 ? `, first ${when(g.first)}` : ''} · ${esc([...g.sources].join(', ') || 'no league')} · ${esc([...g.pages].slice(0, 5).join(' '))}</div>
    <div class="m">${esc(g.at)} · version ${esc(g.build)} · ${esc(g.country)}</div>
    <details><summary>More</summary><div class="m">Leagues: ${esc([...g.leagues].slice(0, 10).join(', ') || 'none')}</div><div class="m">${esc(g.ua)}</div><pre>${esc(g.stack)}</pre></details></li>`).join('');
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>League Layer errors</title>
<style>body{font:15px/1.45 system-ui,sans-serif;max-width:860px;margin:0 auto;padding:16px;color:#1f2328;background:#fff}
@media(prefers-color-scheme:dark){body{color:#e6e6e6;background:#16181c}li{border-color:#333}}
ol{list-style:none;padding:0}li{border-bottom:1px solid #ddd;padding:10px 0;overflow-wrap:anywhere}.n{color:#c2410c;font-weight:700}
.m{font-size:13px;opacity:.75}pre{font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}</style>
<h1>Errors</h1><p class="m">The last ${ERROR_DAYS} days (${recs.length} reports${keys.length > 300 ? ', the newest 300' : ''}), the same error grouped, newest first.</p>
${list ? `<ol>${list}</ol>` : '<p>No errors.</p>'}`;
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const origins = String(env.SITE_ORIGINS || 'https://leaguelayer.com').split(',').map(s => s.trim());
    const origin = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': origins.includes(origin) ? origin : origins[0],
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    if (url.pathname === '/errors' && req.method === 'POST') {
      try { await saveError(req, env, origins, url); } catch (e) { /* a full day's writes, or KV down: drop it */ }
      return new Response(null, { status: 204, headers: cors });
    }
    if (url.pathname === '/errors' && req.method === 'GET') {
      if (!env.ERRORS || !env.ERRORS_KEY || url.searchParams.get('key') !== env.ERRORS_KEY) return new Response('Not found', { status: 404 });
      return new Response(await errorPage(env), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
    }
    if (url.pathname.startsWith('/espn/') && req.method === 'GET') {
      // only for the site's own pages (a browser always says where a page is from); not an open proxy
      if (!origins.includes(origin)) return new Response('Not found', { status: 404 });
      const target = espnFeed(url);
      if (!target) return new Response(JSON.stringify({ error: 'not an ESPN feed the site reads' }), { status: 404, headers: { ...cors, 'Content-Type': 'application/json' } });
      let c;
      try { c = await sharedCopy(new Request(target.upstream), url.origin, target.ttl, () => espnAnswer(target.upstream), ctx); } catch (e) { c = { status: 502, type: 'application/json', body: JSON.stringify({ error: "couldn't reach ESPN" }) }; }
      // to the page: never kept in the browser (its own updates decide when to ask again)
      return new Response(c.body, { status: c.status, headers: { ...cors, 'Content-Type': c.type, 'Cache-Control': 'no-store' } });
    }

    const inj = url.pathname.match(/^\/injuries\/([a-z]+\/[a-z]+)$/);
    if (inj && req.method === 'GET') {
      if (!origins.includes(origin)) return new Response('Not found', { status: 404 }); // (only for the site's own pages)
      const head = { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
      if (!Object.values(WATCH).includes(inj[1])) return new Response(JSON.stringify({ error: 'not a sport the injury watch reads' }), { status: 404, headers: head });
      let c;
      try { c = await sharedCopy(new Request(`${url.origin}/__injuries/${inj[1]}`), url.origin, WATCH_FRESH, () => watchAnswer(env, inj[1]), ctx); } catch (e) { c = { status: 503, body: JSON.stringify({ error: "couldn't read the injury watch" }) }; }
      return new Response(c.body, { status: c.status, headers: head });
    }

    const live = url.pathname.match(/^\/live\/([a-z]+\/[a-z]+)$/);
    if (live && req.method === 'GET') {
      if (!origins.includes(origin)) return new Response('Not found', { status: 404 }); // (only for the site's own pages)
      const head = { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
      if (!ESPN_LEAGUES.has(live[1])) return new Response(JSON.stringify({ error: 'not a sport the site reads' }), { status: 404, headers: head });
      let c;
      try {
        c = await sharedCopy(liveKey(url.origin, live[1]), url.origin, LIVE_TTL, async () => ({ status: 200, type: 'application/json', body: JSON.stringify(await liveBuild(live[1], url.origin, ctx)) }), ctx);
      } catch (e) { return new Response(JSON.stringify({ error: "couldn't reach ESPN" }), { status: 502, headers: head }); }
      return new Response(c.body, { headers: head }); // (never kept in the browser: its own updates decide when to ask again)
    }

    const callback = `${url.origin}/yahoo/callback`;
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
    // the page to send someone back to: only the site's own pages
    const safeReturn = r => { try { const u = new URL(r); return origins.includes(u.origin) ? u.origin + u.pathname : origins[0] + '/'; } catch (e) { return origins[0] + '/'; } };
    const tokens = body => fetch(AUTH + 'get_token', {
      method: 'POST',
      headers: { Authorization: 'Basic ' + btoa(`${env.YAHOO_CLIENT_ID}:${env.YAHOO_CLIENT_SECRET}`), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    });

    if (url.pathname === '/yahoo/login') {
      const state = btoa(safeReturn(url.searchParams.get('return') || ''));
      const to = new URL(AUTH + 'request_auth');
      // fspt-r: read Fantasy Sports (without it Yahoo's API answers 403, "not authorized")
      to.search = new URLSearchParams({ client_id: env.YAHOO_CLIENT_ID, redirect_uri: callback, response_type: 'code', scope: 'fspt-r', language: 'en-us', state }).toString();
      return Response.redirect(to.toString(), 302);
    }

    if (url.pathname === '/yahoo/callback') {
      let back = origins[0] + '/';
      try { back = safeReturn(atob(url.searchParams.get('state') || '')); } catch (e) { /* the site's front page */ }
      const code = url.searchParams.get('code');
      if (!code) return Response.redirect(`${back}#yahoo-error=${encodeURIComponent(url.searchParams.get('error') || 'cancelled')}`, 302);
      const r = await tokens({ grant_type: 'authorization_code', code, redirect_uri: callback });
      if (!r.ok) return Response.redirect(`${back}#yahoo-error=${r.status}`, 302);
      const t = await r.json();
      // in the address's fragment, which browsers never send to any server
      const pass = btoa(JSON.stringify({ access: t.access_token, refresh: t.refresh_token, until: Date.now() + (t.expires_in || 3600) * 1000 }));
      return Response.redirect(`${back}#yahoo=${encodeURIComponent(pass)}`, 302);
    }

    if (url.pathname === '/yahoo/refresh' && req.method === 'POST') {
      const { refresh } = await req.json().catch(() => ({}));
      if (!refresh) return json({ error: 'no refresh token' }, 400);
      const r = await tokens({ grant_type: 'refresh_token', refresh_token: refresh, redirect_uri: callback });
      if (!r.ok) return json({ error: `Yahoo answered ${r.status}` }, 401);
      const t = await r.json();
      return json({ access: t.access_token, refresh: t.refresh_token || refresh, until: Date.now() + (t.expires_in || 3600) * 1000 });
    }

    if (url.pathname.startsWith('/yahoo/api/') && req.method === 'GET') {
      const auth = req.headers.get('Authorization') || '';
      if (!/^Bearer \S+$/.test(auth)) return json({ error: 'sign in with Yahoo' }, 401);
      const path = url.pathname.slice('/yahoo/api/'.length);
      if (!/^[\w.;,=\/-]+$/.test(path)) return json({ error: 'bad path' }, 400);
      const q = new URLSearchParams(url.search);
      q.set('format', 'json');
      const r = await fetch(`${API}${path}?${q}`, { headers: { Authorization: auth, Accept: 'application/json' } });
      return new Response(r.body, { status: r.status, headers: { ...cors, 'Content-Type': r.headers.get('Content-Type') || 'application/json', 'Cache-Control': 'no-store' } });
    }

    return json({ error: 'not found' }, 404);
  },

  // the Cron Triggers (wrangler.toml): every 3 minutes the injury watch, one sport a run; 08:00 UTC the daily data job
  async scheduled(event, env, ctx) {
    if (WATCH[event.cron]) ctx.waitUntil(injuryWatch(WATCH[event.cron], env, event.scheduledTime || Date.now()));
    else ctx.waitUntil(startDataJob(env));
  },
};
