// League Layer: Constants, saved state, helpers, headshots and team logos.
// The site loads js/*.js in order (see index.html); they share one scope, like one file.

'use strict';

/* =========================================================
   Constants
   ========================================================= */
const STORAGE_KEY = 'league-layer-v1';
const THEME_KEY = 'league-layer-theme';
const SCORES_KEY = 'league-layer-hide-scores'; // this device hides game scores (no spoilers)
const CLOCK_KEY = 'league-layer-clock'; // '24' or '12': this device's choice of clock; unset = the device's own
const PICKS_KEY = 'league-layer-picks'; // what was last picked on the Matchup and Players tabs' When menus and Plan Ahead's week (picks)
const STATUSES = ['Healthy', 'DTD', 'Out'];
// The sandbox (no league, sandbox.js): a team of any players, up to SANDBOX_MAX, and up to WATCH_MAX followed live (each sport its own)
const SANDBOX_MAX = 30, WATCH_MAX = 12;
// this deploy's version (the commit), stamped in by the publish workflow; '__BUILD__' when run locally
const BUILD = '__BUILD__';

// Errors in someone's browser go to the error log on the helper server (worker/yahoo.js: POST /errors), so a page
// that breaks for a visitor is known without waiting for them to say so: the message, where in the code, the page,
// the league's site and ID, this version and the browser. Only on the live site; each error once a visit, 5 at most.
// League Layer's Cloudflare Worker (worker/): the error log, Yahoo's sign-in, and ESPN's feeds should ESPN stop answering
// the site directly (espnSite, live.js)
const WORKER = 'https://api.leaguelayer.com';
const ERROR_LOG = `${WORKER}/errors`;
const errorsSent = new Set();
// (not a search engine's crawler: Googlebot renders the page and sometimes skips a script, and every one after it fails)
const CRAWLER = /bot\b|crawl|spider|slurp|headless|lighthouse/i;
function reportError(msg, at, stack) {
  if (location.hostname !== 'leaguelayer.com' || CRAWLER.test(navigator.userAgent || '') || errorsSent.size >= 5 || errorsSent.has(msg + at)) return;
  errorsSent.add(msg + at);
  let L = null, browse = false;
  try { L = fxLeague(); browse = !!state.browse; } catch (e) { /* the league is what broke, or it hasn't loaded */ }
  const body = JSON.stringify({ msg, at, stack, page: location.hash.split('/')[0] || '#', source: L ? L.source || 'fantrax' : browse ? 'browse' : '',
    league: L ? L.id : '', build: BUILD, ua: navigator.userAgent });
  try { fetch(ERROR_LOG, { method: 'POST', mode: 'no-cors', keepalive: true, headers: { 'Content-Type': 'text/plain' }, body }).catch(() => {}); } catch (e) { /* offline */ }
}
if (typeof window.addEventListener === 'function') {
  // our own scripts' errors only: a browser extension's come as "Script error." from elsewhere
  window.addEventListener('error', e => {
    if (!e.filename || !e.filename.startsWith(location.origin)) return;
    reportError(String(e.message), `${e.filename.replace(location.origin + '/', '').replace(/\?.*$/, '')}:${e.lineno}:${e.colno}`, e.error && e.error.stack);
  });
  window.addEventListener('unhandledrejection', e => {
    const r = e.reason;
    // ours, and not just a dropped connection (no bug of ours)
    if (!(r instanceof Error) || !/\/js\/\w+\.js/.test(r.stack || '') || /Failed to fetch|Load failed|NetworkError/.test(r.message)) return;
    const at = (r.stack.match(/js\/(\w+\.js)[^:]*:(\d+):(\d+)/) || []).slice(1).join(':');
    reportError(`${r.name}: ${r.message}`, at, r.stack);
  });
}

let BASE = { ...BASE_DEFAULT };


// the local app (python serve.py) can re-pull NBA data on demand; the website updates daily on its own
const LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

const uid = () => Math.random().toString(36).slice(2, 10);

function emptyState() {
  return {
    version: 2, sport: 'nba', teamName: 'My Team', basis: 'blend',
    matchDays: [0, 1, 2, 3, 4, 5, 6], opp: { name: '', week: null, players: [] }, savedLeagues: [], leagueStates: {}, pastSeasons: {},
    slots: [...DEFAULT_SLOTS], benchSize: 5, ilSize: 1, slotsSet: true, lineupMode: 'weekly',
    players: [], lineup: [], il: [],
    sandbox: sandboxClean(), // the sandbox's sport, and each sport's team, watch list and scoring (sandbox.js)
  };
}

/* =========================================================
   What's kept, and when it's thrown away
   ========================================================= */
// Anything worked out and kept (a cache, a memo) signs up here, where it's declared, with what it was worked out from:
//   'sport'    the sport on the page (its data file, box scores, photos)
//   'box'      the box scores (games added to the saved ones)
//   'league'   a league as read from its site: rosters, lineups, matchups
//   'players'  the players' own details: injuries, the league's positions and rosters, its categories
// changed('box', leagueId) then empties everything that used the box scores (for that league, where a thing is kept by
// league; all of them without an id). Nothing clears another file's cache by hand.
const kept = [];
const keep = (from, reset) => { kept.push({ from: from.split(' '), reset }); };
function changed(what, id) { for (const k of kept) if (k.from.includes(what)) k.reset(id); }
// one league's entries out of a thing kept by league id (or by "league id|..."); all of them without an id
function dropKept(memo, id) {
  const isMap = memo instanceof Map;
  for (const k of isMap ? [...memo.keys()] : Object.keys(memo)) {
    if (id != null && k !== id && !String(k).startsWith(`${id}|`)) continue;
    if (isMap) memo.delete(k); else delete memo[k];
  }
}

// This device's storage (localStorage), which a browser can block or find full: then a read gives the fallback and a
// write or removal does nothing, so the setting or copy lasts this visit only. json: a missing or unreadable value is the fallback
const store = {
  get: (key, fallback = null) => { try { return localStorage.getItem(key) ?? fallback; } catch (e) { return fallback; } },
  json: (key, fallback = null) => { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (e) { return fallback; } },
  set: (key, text) => { try { localStorage.setItem(key, text); } catch (e) { /* blocked or full */ } },
  setJson: (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* blocked or full */ } },
  drop: key => { try { localStorage.removeItem(key); } catch (e) { /* blocked */ } },
};
// A phone's screen: as wide as styles.css lays out for phones (max-width: 640px)
const isPhone = () => typeof matchMedia === 'function' && matchMedia('(max-width: 640px)').matches;
// The site's look now: 'dark' or 'light', as picked in the settings menu, else as the device is set
const themeNow = () => document.documentElement.dataset.theme || (typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

/* =========================================================
   State + persistence
   ========================================================= */
let state = null;
const ui = { weekShift: 0, weekChosen: false, tab: 'dashboard', recapWeek: null, afterPick: null, tradeGive: new Set(), tradeGet: new Set(), tradeTeam: null, tradeLink: null, tradeSeen: null, tradeGivePicks: new Set(), tradeGetPicks: new Set(), totSort: { key: null, dir: 1 }, cwSort: { key: null, dir: 1 }, csOpen: new Set(),
  dashRange: null, dashBench: false, trendDir: 'up', trendCard: null, trendSort: { key: 'move', dir: -1 }, cardSort: { key: 'date', dir: -1 }, teamSort: { key: 'v', dir: -1 }, perfRange: null, perfPer: false, perfMore: { sig: '', n: 0 }, rollOpen: new Set(), perfQ: '', perfPos: [], perfTeam: [], perfMenu: null, perfOnly: { rookie: false, inj: false }, perfSort: { key: 'v', dir: -1 },
  perfWhose: { me: true, opp: true, other: true, fa: true }, perfOthers: [], perfSpot: 'all', perfFiltOpen: false,
  sbQ: {}, sbGive: new Set(), sbGet: [], watchRange: null }; // (the sandbox's searches, its trade, its Live tab's day: sandbox.js)
ui.hideScores = store.get(SCORES_KEY) === '1';
// 24-hour clock: as chosen in the settings menu, else as the device shows times
ui.clock24 = (() => {
  const c = store.get(CLOCK_KEY);
  if (c) return c === '24';
  try { return !/h1[12]/.test(new Intl.DateTimeFormat([], { hour: 'numeric' }).resolvedOptions().hourCycle || 'h12'); } catch (e) { return false; }
})();
// What was last picked on the Matchup and Players tabs' When menus (Today, Yesterday, This period...) and Plan Ahead's
// week holds over a refresh until what the tab opens on by itself is new (the owner's ask, Nov 2026): Matchup and Players
// at a new day (Yesterday is another night, This period may be another period), Plan Ahead at a new matchup week or in
// another league. Each pick is kept on the device with that day or week (`at`); one from an earlier day or week is
// dropped, there and then (`dropOldPicks`, render.js; `planAheadWeek`), and the tab opens on its default again.
// (k: 'dash' { v: ui.dashRange }, 'perf' { v: ui.perfRange, per: ui.perfPer }, 'week' { v: ui.weekShift }, 'watch' { v: ui.watchRange }, the sandbox's Live; no pick = forget it)
const picks = (p => (typeof p === 'object' ? p : {}))(store.json(PICKS_KEY, {}));
function savePick(k, pick) {
  if (pick) picks[k] = pick; else delete picks[k];
  store.setJson(PICKS_KEY, picks);
}
if (picks.dash && typeof picks.dash.v === 'string') ui.dashRange = picks.dash.v;
if (picks.perf) Object.assign(ui, { perfRange: typeof picks.perf.v === 'string' ? picks.perf.v : null, perfPer: !!picks.perf.per });
if (picks.watch && typeof picks.watch.v === 'string') ui.watchRange = picks.watch.v;
// A time of day ("7:30 PM" or "19:30"); more = other parts to show with it (weekday)
const fmtTime = (t, more) => new Date(t).toLocaleString([], { ...more, hour: ui.clock24 ? '2-digit' : 'numeric', minute: '2-digit', hourCycle: ui.clock24 ? 'h23' : 'h12' });

function load() {
  const s = store.json(STORAGE_KEY); // (null when unavailable or corrupt)
  setSport(s && s.sport); // the saved league's sport: its positions and slots, and which data set loads
  return normalize(s && Array.isArray(s.players) ? s : emptyState());
}

function normalize(s) {
  const base = emptyState();
  const migrateSlots = !s.slotsSet;
  s = { ...base, ...s };
  // fields from the hand-entry days; everything here now comes from Fantrax
  for (const k of ['sample', 'format', 'scoring', 'scoringType', 'leagueName', 'matchups', 'matchDaysSet', 'pool']) delete s[k];
  for (const ls of Object.values(s.leagueStates || {})) for (const k of ['sample', 'scoringType', 'leagueName', 'matchups', 'pool']) delete ls[k];
  s.players = (s.players || []).map(normalizePlayer);
  s.il = (s.il || []).filter(id => s.players.some(p => p.id === id));
  if (!Array.isArray(s.slots) || !s.slots.length) s.slots = [...DEFAULT_SLOTS];
  s.slots = s.slots.map(x => (x === 'UTIL' ? 'FLX' : x)).filter(x => SLOT_TYPES.includes(x));
  // league setup from the owner: 8 starters (FLX = anyone), 5 bench, 1 IR
  if (migrateSlots) {
    s.slots = [...DEFAULT_SLOTS]; s.benchSize = 5; s.ilSize = 1; s.slotsSet = true;
    s.lineup = autoLineupIds(s);
  }
  if (s.lineupMode !== 'daily') s.lineupMode = 'weekly';
  if (!BASIS_LABELS[s.basis]) s.basis = 'blend';
  if (!Array.isArray(s.matchDays) || !s.matchDays.length || s.matchDays.join() === '0,1,2,3,4') s.matchDays = [0, 1, 2, 3, 4, 5, 6];
  s.opp = { name: '', week: null, starters: null, fxId: null, ...(s.opp || {}) };
  s.opp.players = (s.opp.players || []).map(normalizePlayer);
  s.sandbox = sandboxClean(s.sandbox);
  return s;
}

// The sandbox's saved state (sandbox.js): its sport, and for each sport its team and watch list (data ids, each once, as many
// as each holds), its scoring ('cats', a preset's name, or 'custom') and its own point values (stats the sport has, numbers).
// A copy from before sports were apart (one roster and watch list) is basketball's.
const SB_SPORTS = ['nba', 'nhl'];
function sandboxClean(sb) {
  sb = sb && typeof sb === 'object' ? sb : {};
  const ids = (list, n) => [...new Set((Array.isArray(list) ? list : []).filter(Number.isFinite))].slice(0, n);
  const pts = (k, o) => {
    const out = Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {}).filter(([x, v]) => SPORTS[k].statLabel[x] && Number.isFinite(v) && v));
    return Object.keys(out).length ? out : null;
  };
  const one = (k, o) => ({ roster: ids(o.roster, SANDBOX_MAX), watch: ids(o.watch, WATCH_MAX), scoring: typeof o.scoring === 'string' ? o.scoring : 'cats', points: pts(k, o.points) });
  const old = Array.isArray(sb.roster) ? sb : {};
  // (back: the league it was entered from, to go back to: { id, name })
  const back = sb.back && typeof sb.back.id === 'string' ? { id: sb.back.id, name: String(sb.back.name || '') } : null;
  return { sport: SB_SPORTS.includes(sb.sport) ? sb.sport : 'nba', back, ...Object.fromEntries(SB_SPORTS.map(k => [k, one(k, sb[k] && typeof sb[k] === 'object' ? sb[k] : k === 'nba' ? old : {})])) };
}

function normalizePlayer(p) {
  const out = { id: p.id || uid(), name: String(p.name || 'Unnamed'), team: String(p.team || '').toUpperCase(), pos: Array.isArray(p.pos) ? p.pos.filter(x => POSITIONS.includes(x)) : [], status: STATUSES.includes(p.status) ? p.status : 'Healthy', tag: p.tag || '' };
  if (!out.pos.length) out.pos = [POSITIONS[0]];
  for (const k of STAT_FIELDS) out[k] = Number.isFinite(+p[k]) ? +p[k] : 0;
  if (!p.games && p.games !== 0) out.games = 3;
  if (p.nbaId) out.nbaId = p.nbaId;
  out.gp = +p.gp || 0;
  out.inj = p.inj || null;
  out.next = p.next || null;
  return out;
}

function save() {
  if (standIn) { reportError('a save during a stand-in draw (withState)', 'js/core.js'); return; } // it would keep the stand-in as your own team
  store.setJson(STORAGE_KEY, state);
}

// A draw as another team, or with another week's lineups: the page's state stands in for it while fn runs and is back
// when it returns (the one place state is swapped). over: the fields that differ, or saved state -> the whole stand-in.
// fn must finish in one go: whatever it leaves waiting would read your own team again; and nothing saves meanwhile.
let standIn = 0;
function withState(over, fn) {
  const saved = state;
  state = typeof over === 'function' ? over(saved) : { ...saved, ...over };
  standIn++;
  try {
    const out = fn();
    if (out && typeof out.then === 'function') reportError('a stand-in draw that waits (withState)', 'js/core.js');
    return out;
  } finally { state = saved; standIn--; }
}

function restoreFrom(data) {
  if (!data || !Array.isArray(data.players)) throw new Error('bad backup');
  if ((data.sport || 'nba') !== SPORT.key) { // the other sport's data set: start over from the restored copy
    state = data;
    save();
    location.reload();
    return;
  }
  state = normalize(data);
  ui.tradeGive.clear(); ui.tradeGet.clear(); ui.tradeGivePicks.clear(); ui.tradeGetPicks.clear();
  commit(`Restored ${state.players.length} players`);
}

// In-page confirm (native confirm() is blocked in some embeds)
function askConfirm(title, body, okLabel = 'Confirm') {
  const d = $('#confirmDialog');
  $('#confirmTitle').textContent = title;
  $('#confirmBody').textContent = body;
  $('#confirmOk').textContent = okLabel;
  d.showModal();
  // resolve from the buttons themselves; 'close' alone isn't fired reliably in every embed
  return new Promise(resolve => {
    const done = ok => {
      d.removeEventListener('click', onClick);
      d.removeEventListener('close', onClose);
      if (d.open) d.close();
      resolve(ok);
    };
    const onClick = e => {
      const b = e.target.closest('button[value]');
      if (b) { e.preventDefault(); done(b.value === 'ok'); }
    };
    const onClose = () => done(false);
    d.addEventListener('click', onClick);
    d.addEventListener('close', onClose);
  });
}

function commit(msg) {
  validateLineup();
  save();
  render();
  if (msg) toast(msg);
}

/* =========================================================
   Helpers
   ========================================================= */
const $ = (sel, root = document) => root.querySelector(sel);
// Loading: the logo's two Ls drop in from above and stack, the thin one first (styles.css: .ll-loader). Visitors who
// ask for less motion see them fade in place instead.
const LOGO_LS = '<polygon class="ll-edge" points="8,30 36,44 56,34 56,40 36,50 8,36"/><polygon class="ll-main" points="36,40 56,30 44,24 36,28 20,20 8,26"/>';
const loaderMark = (cls = '') => `<svg class="ll-loader${cls ? ' ' + cls : ''}" viewBox="4 14 56 40" aria-hidden="true">${LOGO_LS}</svg>`;
// a card that's waiting on something: the mark, what's loading, and anything more to say
const loadingCard = (title, more = '') => `<div class="card"><div class="empty loading" role="status">${loaderMark()}<strong>${title}</strong>${more}</div></div>`;
// one line inside a card, with a small mark
const loadingLine = text => `<p class="muted small loading-line" role="status">${loaderMark('sm')}${text}</p>`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '—');
const fmtPct = n => (Number.isFinite(n) && n > 0 ? n.toFixed(3).replace(/^0/, '') : '—');
const signed = (n, d = 1) => { const t = Math.abs(n).toFixed(d); return (+t === 0 ? '' : n > 0 ? '+' : '−') + t; }; // 0.00, never −0.00
const sum = arr => arr.reduce((a, b) => a + b, 0);

const byId = id => state.players.find(p => p.id === id);
const canPlay = (p, slot) => p.pos.some(x => (ELIG[slot] || []).includes(x)); // (a spot this sport doesn't have: nobody)

// A player's contribution to each category the league counts, against an average rostered player.
// Percentages count shot volume: (his % − average %) × his attempts.
function catZ(p) {
  const z = {};
  for (const c of scoreCats()) {
    if (c.fp || !BASE[c.key]) continue;
    const [m, sd] = BASE[c.key];
    if (c.pct) { const att = statVal(p, c.att); z[c.key] = att ? (c.neg ? -1 : 1) * (pctOf(p, c) - m) * att / sd : 0; } else z[c.key] = (c.neg ? -1 : 1) * (statVal(p, c.key) - m) / sd;
  }
  return z;
}
// a percentage category for one player (or any stat line): makes ÷ attempts
const pctOf = (p, c) => { const att = statVal(p, c.att); return att ? statVal(p, c.made) / att : 0; };

// Points leagues score fantasy points from the league's own values; category leagues their own categories
// (the sandbox: its points scoring, when one's picked: sbPoints, sandbox.js)
const leaguePoints = () => { const L = fxLeague(); if (!L && state && state.browse) return sbPoints(); return L && L.points && /POINTS/.test(L.scoring || '') ? L.points : null; };
const isPoints = () => !!leaguePoints();
// A roto league (ESPN's, so far: espnRoto): categories ranked over the whole season, no weekly opponents; its "week" is the calendar's
const isRoto = () => { const L = fxLeague(); return !!(L && L.roto); };
const spanWord = () => (isRoto() ? 'week' : 'period'); // (a matchup's span is a "period" in labels: a roto league has none)
// Real fantasy points, as the league counts them: a league whose every point value is a whole number only ever scores whole
// points, so its scores show no ".0" (projections and averages keep their decimal everywhere)
const wholePoints = () => { const P = leaguePoints(); return !!P && Object.values(P).every(v => typeof v === 'number' && Number.isInteger(v)); };
const fmtFp = n => fmt(n, wholePoints() ? 0 : 1);
function statVal(p, k) {
  if (k === 'fgm' && !isFootball()) return p.fgPct * p.fga; // (football's fgm: field goals made)
  if (k === 'ftm') return p.ftPct * p.fta;
  if (k === 'gp1') return p.min || p.pts ? 1 : 0;
  if (DERIVED[k]) return sum(Object.entries(DERIVED[k]).map(([b, c]) => statVal(p, b) * c));
  return p[k] || 0;
}
// a week's projected total (and spread) of any stat, derived ones included
const totStat = (S, k) => (DERIVED[k] ? sum(Object.entries(DERIVED[k]).map(([b, c]) => (S.tot[b] || 0) * c)) : S.tot[k] || 0);
const vrStat = (S, k) => (DERIVED[k] ? sum(Object.keys(DERIVED[k]).map(b => S.vr[b] || 0)) : S.vr[k] || 0);
// a league's points per stat, with derived stats folded onto the ones we project
function foldPoints(sc) {
  const out = {};
  for (const [k, v] of Object.entries(sc)) {
    if (DERIVED[k]) for (const [b, c] of Object.entries(DERIVED[k])) out[b] = (out[b] || 0) + v * c;
    else out[k] = (out[k] || 0) + v;
  }
  return out;
}

function fantasyPoints(p, sc = leaguePoints()) {
  return sc ? sum(Object.entries(sc).map(([k, v]) => statVal(p, k) * v)) : 0;
}

// The columns a matchup is decided on: the league's categories, or each scored stat plus total fantasy points
function catDef(key) {
  if (PCT_CATS[key]) { const [label, made, att, more] = PCT_CATS[key]; return { key, label, pct: true, made, att, ...more }; }
  return { key, label: STAT_LABEL[key] || key.toUpperCase(), neg: NEG_CATS.has(key), dec: key === 'dd' || key === 'td' ? 1 : null };
}
let catsMemo = { L: undefined, cats: CATS };
keep('sport', () => { catsMemo = { L: undefined, cats: CATS }; });
function scoreCats() {
  const L = fxLeague(), sc = leaguePoints(); // (the sandbox's scoring can change with no league: its points are part of the key)
  if (catsMemo.L !== L || catsMemo.sc !== sc) {
    catsMemo = { L, sc, cats: sc
      ? [...Object.keys(STAT_LABEL).filter(k => sc[k]).map(k => ({ key: k, label: STAT_LABEL[k], neg: sc[k] < 0, dec: k === 'dd' || k === 'td' ? 1 : null })), { key: 'fp', label: 'FP', fp: true }]
      : L && L.cats && L.cats.length ? L.cats.map(catDef) : CATS };
    BASE = baseNow(); // and on the league's size (and, for a past season, that season's stats)
    changed('players'); // player values depend on the categories
  }
  return catsMemo.cats;
}

// The categories as a game's line draws them (bubbles, the recap's numbers): in a points league each shooting pair it scores
// both halves of (SPORT.shotPairs) is one { shot: true, made, att, label } at the first one's place, "5/12 FG" (the owner's
// ask, Nov 2026: not a bubble each)
let lineCatsMemo = { cats: null, out: null };
function lineCats() {
  const cats = scoreCats();
  if (lineCatsMemo.cats === cats) return lineCatsMemo.out;
  const has = new Set(cats.map(c => c.key)), pairOf = new Map();
  for (const [made, att, miss, label] of isPoints() ? SPORT.shotPairs || [] : []) {
    if (!has.has(made) || !(has.has(att) || has.has(miss))) continue;
    const pair = { key: made, label, shot: true, made, att, miss };
    for (const k of [made, att, miss]) pairOf.set(k, pair);
  }
  const out = [];
  for (const c of cats) {
    const pair = pairOf.get(c.key);
    if (!pair) out.push(c);
    else if (!out.includes(pair)) out.push(pair);
  }
  lineCatsMemo = { cats, out };
  return out;
}
// a shooting pair's own points (lineCats): its makes, attempts and misses as the league scores them
const shotPoints = c => { const sc = leaguePoints() || {}; return Object.fromEntries([c.made, c.att, c.miss].filter(k => sc[k]).map(k => [k, sc[k]])); };
// those points for a stat line or a total (makes as they are, misses from attempts: lineStat); and a pair's numbers, "11.9/25.6"
const shotFp = (line, c) => sum(Object.entries(shotPoints(c)).map(([k, v]) => lineStat(line, k) * v));
const shotVol = (made, att, d = 1) => `${fmt(made, d)}/${fmt(att, d)}`;

// Player value: what an average game of his adds, against not playing (catWins, the same as a single game on the Dashboard):
// categories won in a week (head-to-head), roto points over the season (roto), or fantasy points in points leagues
function value(p) {
  return isPoints() ? fantasyPoints(p) : sum(Object.values(catWins(p)));
}
// Highest first by what fn says of each: worked out once per item, not at every comparison (a sort by value(p) asked
// for it some 37,000 times in one draw of Plan Ahead). A new list; ties keep their order.
const sortDesc = (list, fn) => list.map(x => [fn(x), x]).sort((a, b) => b[0] - a[0]).map(x => x[1]);
const valueLabel = () => (isPoints() ? 'FP/G' : 'Value');
const fmtValue = (v, d = 2) => (isPoints() ? fmt(v, 1) : signed(v, d));
const statOf = (p, c) => (c.fp ? fantasyPoints(p) : c.pct ? pctOf(p, c) : statVal(p, c.key));

// Typical fantasy points per game for a rostered player (the 200 who score the most), for shading the FP column; with part,
// the points of those stats alone (a shooting pair's column on Plan Ahead: shotPoints)
let fpBaseCache = null;
keep('sport', () => { fpBaseCache = null; });
function fpBase(part) {
  const sc = leaguePoints();
  if (!fpBaseCache || fpBaseCache.sc !== sc) {
    const top = sortDesc(NBA.players.map(raw => nbaStats(raw)).filter(x => x && x.gp >= 3), x => fantasyPoints(x, sc)).slice(0, 200);
    fpBaseCache = { sc, top, v: new Map() };
  }
  const key = part ? JSON.stringify(part) : '';
  if (!fpBaseCache.v.has(key)) {
    const fps = fpBaseCache.top.map(x => fantasyPoints(x, part || sc));
    const m = sum(fps) / (fps.length || 1), sd = Math.sqrt(sum(fps.map(x => (x - m) ** 2)) / (fps.length || 1)) || 1;
    fpBaseCache.v.set(key, [m, sd]);
  }
  return fpBaseCache.v.get(key);
}

// Aggregate per-game totals for a group of players (counting stats summed, % weighted by attempts)
function totals(list, mult = () => 1) {
  const t = Object.fromEntries(COUNT_KEYS.map(k => [k, 0]));
  for (const p of list) {
    const m = mult(p);
    for (const k of COUNT_KEYS) t[k] += statVal(p, k) * m;
    t.gp1 += m - statVal(p, 'gp1') * m;
  }
  for (const k of Object.keys(DERIVED)) t[k] = sum(Object.entries(DERIVED[k]).map(([b, c]) => (t[b] || 0) * c));
  for (const [k, [, made, att]] of Object.entries(PCT_CATS)) t[k] = t[att] ? t[made] / t[att] : 0;
  if (isPoints()) t.fp = sum(list.map(p => fantasyPoints(p) * mult(p)));
  return t;
}

// The injury report in a few letters, for tight rows (the full word and the news on hover): Q, D, IR, SUS, PUP, else OUT or DTD
function injBadge(inj, where = '') {
  if (!inj) return '';
  const l = String(inj.label || '').toLowerCase();
  const short = l === 'ir' || l.includes('reserve') ? 'IR' : l.startsWith('quest') ? 'Q' : l.startsWith('doubt') ? 'D' : l.startsWith('sus') ? 'SUS' : l === 'pup' ? 'PUP'
    : inj.status === 'Out' ? 'OUT' : 'DTD';
  const tip = [inj.label || inj.status, inj.note].filter(Boolean).join(': ');
  return `<span class="badge inj ${inj.status === 'Out' ? 'bad' : 'warn'}${where ? ' ' + where : ''}" title="${esc(tip)}">${short}</span>`;
}

// A first-year player (no seasons in the league before this one; a football team defense isn't one), and his R by the name
const isRookie = raw => !raw.exp && !(raw.pos && raw.pos[0] === 'DEF');
const rookieBadge = (raw, where = '') => (isRookie(raw) ? `<span class="badge rk${where ? ' ' + where : ''}" title="Rookie">R</span>` : '');

function statusBadge(p) {
  const cls = p.status === 'Out' ? 'bad' : p.status === 'DTD' ? 'warn' : 'good';
  return `<span class="badge ${cls}">${esc(p.status)}</span>`;
}

// ‹ [dropdown] ›: step buttons joined to a picker (a select that looks like the league bar's). The buttons call
// `action` with data-step -1 / 1; `ends` disables them at the first or last choice.
const chev = dir => `<svg viewBox="0 0 8 14" width="8" height="14" aria-hidden="true"><path d="${dir < 0 ? 'M6.5 1.5 1.5 7l5 5.5' : 'M1.5 1.5 6.5 7l-5 5.5'}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
function stepper(action, what, select, ends = {}) {
  const btn = dir => `<button type="button" class="step-btn" data-action="${action}" data-step="${dir}" aria-label="${dir < 0 ? 'Previous' : 'Next'} ${what}" title="${dir < 0 ? 'Previous' : 'Next'} ${what}"${(dir < 0 ? ends.first : ends.last) ? ' disabled' : ''}>${chev(dir)}</button>`;
  return `<span class="stepper">${btn(-1)}${select}${btn(1)}</span>`;
}

// ----- Headshots and team logos (headshots.webp + images.json in the sport's data folder, built by scripts/build_images.py) -----
let IMG = null;
const IMG_INDEX = new Map();
keep('sport', () => { IMG = null; IMG_INDEX.clear(); document.documentElement.style.removeProperty('--hs-sheet'); logoRules(null); });

async function loadImages() {
  const sport = SPORT;
  try {
    const r = await fetch(`${sport.data}images.json`, { cache: 'no-cache' });
    if (!r.ok) return;
    const got = await r.json();
    if (sport !== SPORT) return; // the sport changed while this came
    IMG = got;
    IMG_INDEX.clear();
    IMG.ids.forEach((id, i) => IMG_INDEX.set(id, i));
    // the sheet's address carries its layout, so a browser never pairs a cached old sheet with a new index (every
    // face shifted after the monthly rebuild)
    let h = 2166136261;
    for (const c of IMG.ids.join()) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
    IMG.sheet = `${sport.data}headshots.webp?v=${h.toString(36)}`; // also drawn into the recap image
    document.documentElement.style.setProperty('--hs-sheet', `url(${IMG.sheet})`);
    cropLogos(IMG.logos);
    logoRules(IMG.logos);
    render();
  } catch (e) { /* images are optional */ }
}

// The NBA's logo files leave about a quarter of their box empty, so a 14px logo was drawn in about 10 screen
// pixels and looked blocky. Crop each to its drawing (measured once, off screen) so it fills its box.
function cropLogos(logos) {
  const box = document.createElement('div');
  box.style.cssText = 'position:absolute;left:-9999px;top:0;width:100px;height:100px';
  document.body.appendChild(box);
  for (const [team, src] of Object.entries(logos)) {
    try {
      box.innerHTML = new TextDecoder().decode(Uint8Array.from(atob(src.split(',')[1]), c => c.charCodeAt(0)));
      const svg = box.querySelector('svg'), b = svg.getBBox();
      if (!b.width || !b.height) continue;
      const pad = Math.max(b.width, b.height) * 0.03; // strokes reach a little past the measured shapes
      svg.setAttribute('viewBox', [b.x - pad, b.y - pad, b.width + 2 * pad, b.height + 2 * pad].map(n => +n.toFixed(2)).join(' '));
      svg.removeAttribute('width');
      svg.removeAttribute('height');
      logos[team] = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg));
    } catch (e) { /* keep the logo as it came */ }
  }
  box.remove();
}

const initials = name => String(name || '?').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();

// Each team's logo behind its players' round photos (.hs.lg in styles.css): one rule a team in one style element, so a
// page of 300 photos doesn't carry 300 copies of a logo (6-11 KB each)
const logoKey = team => String(team).replace(/[^\w]/g, '');
function logoRules(logos) {
  let el = document.getElementById('hs-logos');
  if (!el && logos) {
    el = document.createElement('style');
    el.id = 'hs-logos';
    document.head.appendChild(el);
  }
  if (el) el.textContent = Object.entries(logos || {}).map(([t, src]) => `.hs.lg-${logoKey(t)}{--logo:url("${src}")}`).join('\n');
}

function headshot(p, px = 28) {
  const i = IMG && p && p.nbaId != null ? IMG_INDEX.get(p.nbaId) : undefined;
  // the faded logo behind the face shows the player's current team, like the jersey in the photo (the edge stays a thin
  // gray line: a ring in the team's colors was dropped, the owner's ask, Nov 2026)
  const raw = p && p.nbaId != null ? nbaById.get(p.nbaId) : null;
  const team = (raw && raw.team) || (p && p.team);
  const box = `width:${px}px;height:${px}px`;
  const lg = IMG && team && IMG.logos[team] ? ` lg lg-${logoKey(team)}` : '';
  // data-photo: a tap on the photo opens his card, as his name does (actions.js; the name stays the button for keyboards)
  const who = p && p.nbaId != null ? ` data-photo="${p.nbaId}"` : '';
  if (i === undefined) return `<span class="hs hs-none${lg}" style="${box}"${who} aria-hidden="true">${esc(initials(p && p.name))}</span>`;
  const col = i % IMG.cols, row = Math.floor(i / IMG.cols);
  // the photo's spot on the sheet (--hs-sz, --hs-pos): styles.css puts it over the logo
  return `<span class="hs${lg}" style="${box};--hs-sz:${IMG.cols * px}px auto;--hs-pos:-${col * px}px -${row * px}px"${who} aria-hidden="true"></span>`;
}

// a photo's size: bigger where there's room (desktop), the phone's otherwise (the sheet's 80 px stay sharp up to 40)
const hsPx = (desk, phone = desk) => (isPhone() ? phone : desk);

// A player's full photo (a cutout), for the player card: NBA.com's for basketball, ESPN's (by ESPN id) for the others.
// [1x, 2x] or null (a team defense; no ESPN id)
function photoSrcs(raw) {
  if (!raw || (raw.pos && raw.pos[0] === 'DEF')) return null;
  if (SPORT.key === 'nba') return [260, 1040].map(w => `https://cdn.nba.com/headshots/nba/latest/${w}x${w === 260 ? 190 : 760}/${raw.id}.png`);
  if (!raw.espn) return null;
  return [260, 520].map(w => `https://a.espncdn.com/combiner/i?img=/i/headshots/${SPORT.key}/players/full/${raw.espn}.png&w=${w}&h=${Math.round(w * 190 / 260)}`);
}
// The player card's picture, as ESPN shows one: the player in front of his team's logo on a tint of its color; the
// small round photo if the big one won't load (marked by the page's error listener, actions.js). cls: another look (the
// Recap's cards: rx-ph, on his team's color itself, --tint); a tap on it opens his card (data-photo). redrawn: drawn
// again on each live update (the Matchup tab's full screen), so it's shown as soon as it's in, never a blank moment
const shotMiss = new Set(); // big photos that wouldn't load (actions.js): drawn again, they go straight to the round one
function playerPhoto(raw, cls = '', redrawn = false) {
  const small = headshot({ nbaId: raw.id, name: raw.name }, 64), src = photoSrcs(raw);
  if (!src) return small;
  const tc = TEAM_COLORS[raw.team], logo = IMG && IMG.logos[raw.team], miss = shotMiss.has(src[0]);
  return `<div class="pc-photo${cls ? ` ${cls}` : ''}${miss ? ' no-shot' : ''}" data-photo="${raw.id}" style="--tint:${teamTint(raw.team)}${tc ? `;--t1:${tc[0]};--t2:${tc[1]}` : ''}">${logo ? `<img class="pc-logo" src="${logo}" alt="" aria-hidden="true">` : ''}${miss ? '' : `<img class="pc-shot" src="${src[0]}" srcset="${src[0]} 1x, ${src[1]} 2x" alt="${esc(raw.name)}"${redrawn ? '' : ' decoding="async"'}>`}${small}</div>`;
}

// A team's color to tint a photo or picture with: its first, or its second where the first is too dark to show (Brooklyn's
// black) or too light, else a gray
const lumOf = hex => { const n = parseInt(hex.slice(1), 16); return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255; };
const teamTint = team => (TEAM_COLORS[team] || []).find(c => /^#[0-9a-f]{6}$/i.test(c) && lumOf(c) > 0.07 && lumOf(c) < 0.8) || '#3a404c';

function teamLogo(team, px = 16) {
  const src = IMG && team && IMG.logos[team];
  return src ? `<img class="tlogo" src="${src}" alt="${esc(team)}" title="${esc(team)}" width="${px}" height="${px}">` : esc(team || 'FA');
}

// A position's or lineup spot's color, as Fantrax shows it: a pc-* class in styles.css, from the sport's slotColors ('' for
// one without a color: hockey's C, LW, RW until seen, football's). The one place a position's color comes from.
const slotColor = x => (SPORT.slotColors || {})[x] || '';
// A player's positions, each in its color: the only way the site draws positions (a test holds every tab and popup to it)
const posTags = pos => pos.map(x => { const c = slotColor(x); return `<span class="pt pt-${esc(x)}${c ? ` pc pc-${c}` : ''}">${esc(x)}</span>`; }).join(',');
// The same color on a canvas (the share pictures, drawn dark: --pc-dark), read from styles.css so it's kept in one place
function slotInk(x) {
  const c = slotColor(x);
  if (!c || typeof getComputedStyle !== 'function') return '';
  const el = document.createElement('span');
  el.className = `pc-${c}`;
  document.body.appendChild(el);
  const ink = getComputedStyle(el).getPropertyValue('--pc-dark').trim();
  el.remove();
  return ink;
}

// A fantasy team's name that opens its card (this season's teams; names in a past season stay plain)
function teamLink(tid, label) {
  const name = label ?? esc(fxTeamName(tid));
  const mine = !!tid && tid === myTeamId(); // (your own team: its name in orange everywhere)
  if (!tid || ui.season || !fxLeague() || !fxPickable().some(t => t.id === tid)) return mine ? `<span class="team-mine">${name}</span>` : name;
  return `<button type="button" class="link-btn team-link${mine ? ' mine' : ''}" data-action="team-card" data-team="${esc(tid)}">${name}</button>`;
}

// A player in the Trades lists: his photo, his name (his card), his NBA team and positions, as the trade proposal shows
// them (the owner's asks: not his next game, a trade isn't about this week's schedule; no injury note either, the row's
// status badge says it and his card has the news)
function playerCell(p) {
  const name = p.nbaId ? playerBtn(p.nbaId, p.name) : `<span class="pname">${esc(p.name)}</span>`;
  return `<div class="bplayer">${headshot(p, hsPx(36, 32))}<div class="bmain"><div>${name}</div><div class="pmeta">${p.team ? teamBtn(p.team) : 'FA'} · ${posTags(p.pos)}</div></div></div>`;
}

// A team's code (UTA, CLE) as a link to its card: its schedule and players by value, in the player card's popup ('sport-team')
const teamBtn = (tri, label = esc(tri)) => `<button type="button" class="link-btn tm-link" data-action="sport-team" data-team="${esc(tri)}" title="${esc((SPORT.teamNames || {})[tri] || tri)}">${label}</button>`;
// Every team code in a line's text (not inside its tags) as that link: "Tue @ POR", "OKC vs. WAS", "W 112-100 @MEM"
function linkTeams(html) {
  const teams = NBA && NBA.teams;
  if (!teams || !html) return html;
  return String(html).replace(/(^|>)([^<]+)/g, (m, open, text) => open + text.replace(/\b[A-Z]{2,4}\b/g, t => (teams[t] ? teamBtn(t) : t)));
}

// A player's name as the button that opens his card (label: HTML in place of his plain name)
const playerBtn = (id, name, label = esc(name)) => `<button type="button" class="link-btn pname" data-action="player-detail" data-nba="${id}">${label}</button>`;

// A row of buttons with one of them on (Today / Yesterday, Totals / Per game...): opts [value, label, tip?], on: the value
// that's on. Each button's data-action is action, its value in data-<attr>; extra: more attributes on every button
const segBtns = (label, action, attr, opts, on, extra = '') => `<div class="seg seg-sm" role="group" aria-label="${label}">${opts.map(([k, l, tip]) =>
  `<button type="button" class="${k === on ? 'on' : ''}" data-action="${action}" data-${attr}="${k}" aria-pressed="${k === on}"${tip ? ` title="${tip}"` : ''}${extra}>${l}</button>`).join('')}</div>`;

// a small photo and name for use inside a line of text
const inlinePlayer = (p, text, px = 20) => `<span class="inl-p">${headshot(p, px)}${text}</span>`;

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}
