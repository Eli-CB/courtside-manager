// League Layer's Yahoo helper: a Cloudflare Worker. Yahoo's fantasy API needs a Yahoo login (OAuth 2.0) and doesn't
// allow requests from other sites' pages, so this small server does the two things the site can't:
//   GET  /yahoo/login?return=<page>   sends the visitor to Yahoo to sign in and allow read access
//   GET  /yahoo/callback              Yahoo sends them back here; trades the code for tokens (that needs the app's
//                                     secret, which only this server has) and returns them to the page, after #yahoo=
//   POST /yahoo/refresh               a fresh access token from the refresh token the page keeps
//   GET  /yahoo/api/<path>            the fantasy API itself, passed through with the visitor's token
// Nothing is stored here: each visitor's tokens live in their own browser.
// Settings (wrangler.toml and `wrangler secret put`): YAHOO_CLIENT_ID, YAHOO_CLIENT_SECRET, SITE_ORIGINS.
//
// It also keeps the site's error log (a page that crashed in someone's browser):
//   POST /errors                      the site sends one error: message, where it came from, page, league, version, browser
//   GET  /errors?key=<ERRORS_KEY>     the last 30 days' errors, newest first, the same ones grouped (for the owner)
// Kept in the KV namespace bound as ERRORS for 30 days; ERRORS_KEY is a secret. Without them errors are dropped.
//
// And ESPN's site feed, should ESPN stop answering the site's pages directly (the page switches here by itself: espnSite
// in js/live.js):
//   GET  /espn/<sport>/<league>/<scoreboard | summary | injuries>?<dates | event>
// Only those three feeds of the three sports, only for the site's own pages, each answer kept at Cloudflare's edge for
// seconds (ESPN_TTL), so ESPN is asked about once per feed every 20-30 seconds however many people are watching.
//
// And today's games for everyone at once, the feed the site's pages read first while games are on (liveFeedGet in
// js/live.js; ESPN directly when this can't answer):
//   GET  /live/<sport>/<league>
// ESPN's scoreboard and each game's box score cut to what the page reads (scores, clocks, every player's line, who's on
// the floor: about 1 KB a game where ESPN's box score is 400), one small answer kept at the edge for LIVE_TTL seconds.
// ESPN is asked a few times a minute per Cloudflare data center however many people are watching, and each visitor's
// update is one request instead of one per game.

const AUTH = 'https://api.login.yahoo.com/oauth2/';
const API = 'https://fantasysports.yahooapis.com/fantasy/v2/';
const ERROR_DAYS = 30;
const ERROR_FIELDS = { msg: 300, at: 300, stack: 1500, page: 120, source: 20, league: 60, build: 20, ua: 200 };
// ESPN's feeds the site reads, and how long one answer is kept (seconds): a game day's scoreboard and a box score while
// games are on, an earlier day's scoreboard (its games are over), the injury report
const ESPN_SITE = 'https://site.api.espn.com/apis/site/v2/sports/';
const ESPN_LEAGUES = new Set(['basketball/nba', 'hockey/nhl', 'football/nfl']);
// (10 s: ESPN's own servers already hand out copies several seconds old, so 20 s here held a live scoreboard about 40 s)
const ESPN_TTL = { scoreboard: 10, pastScoreboard: 600, summary: 10, injuries: 300 };
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

// One ESPN feed, from Cloudflare's cache if it's fresh, else asked of ESPN (and kept, if ESPN answered)
async function espnCached(target, ctx) {
  const cache = caches.default, key = new Request(target.upstream);
  const hit = await cache.match(key);
  if (hit) return hit;
  const r = await fetch(target.upstream, { headers: { Accept: 'application/json' } });
  const res = new Response(r.body, { status: r.status, headers: { 'Content-Type': r.headers.get('Content-Type') || 'application/json', 'Cache-Control': `public, max-age=${target.ttl}` } });
  if (r.ok) ctx.waitUntil(cache.put(key, res.clone()));
  return res;
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

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// One error from the site, cut to size; the newest sort first in KV's listing (keys count down)
async function saveError(req, env, origins) {
  if (!origins.includes(req.headers.get('Origin') || '') || !env.ERRORS) return;
  const text = await req.text();
  if (text.length > 4000) return;
  let e;
  try { e = JSON.parse(text); } catch (x) { return; }
  if (!e || typeof e.msg !== 'string' || !e.msg) return;
  const rec = { t: Date.now(), country: (req.cf && req.cf.country) || '' };
  for (const [k, n] of Object.entries(ERROR_FIELDS)) rec[k] = String(e[k] == null ? '' : e[k]).slice(0, n);
  const key = `${String(1e13 - rec.t).padStart(13, '0')}-${Math.random().toString(36).slice(2, 8)}`;
  await env.ERRORS.put(key, JSON.stringify(rec), { expirationTtl: ERROR_DAYS * 86400 });
}

// The log as a page: each distinct error once (how many times, when last, which leagues and pages), newest first
async function errorPage(env) {
  const keys = [];
  let cursor;
  do {
    const r = await env.ERRORS.list({ cursor, limit: 1000 });
    keys.push(...r.keys.map(k => k.name));
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
      try { await saveError(req, env, origins); } catch (e) { /* a full day's writes, or KV down: drop it */ }
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
      let r;
      try { r = await espnCached(target, ctx); } catch (e) { r = new Response(JSON.stringify({ error: "couldn't reach ESPN" }), { status: 502 }); }
      // to the page: never kept in the browser (its own updates decide when to ask again)
      return new Response(r.body, { status: r.status, headers: { ...cors, 'Content-Type': r.headers.get('Content-Type') || 'application/json', 'Cache-Control': 'no-store' } });
    }

    const live = url.pathname.match(/^\/live\/([a-z]+\/[a-z]+)$/);
    if (live && req.method === 'GET') {
      if (!origins.includes(origin)) return new Response('Not found', { status: 404 }); // (only for the site's own pages)
      const head = { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
      if (!ESPN_LEAGUES.has(live[1])) return new Response(JSON.stringify({ error: 'not a sport the site reads' }), { status: 404, headers: head });
      const key = liveKey(url.origin, live[1]);
      let body = await caches.default.match(key).then(r => (r ? r.text() : null));
      if (!body) {
        try {
          body = JSON.stringify(await liveBuild(live[1], url.origin, ctx));
          ctx.waitUntil(caches.default.put(key, new Response(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${LIVE_TTL}` } })));
        } catch (e) { return new Response(JSON.stringify({ error: "couldn't reach ESPN" }), { status: 502, headers: head }); }
      }
      return new Response(body, { headers: head }); // (never kept in the browser: its own updates decide when to ask again)
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
};
