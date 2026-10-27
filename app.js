'use strict';

/* =========================================================
   Constants
   ========================================================= */
const STORAGE_KEY = 'courtside-manager-v1';
const THEME_KEY = 'courtside-theme';
const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];
const SLOT_TYPES = ['PG', 'SG', 'G', 'SF', 'PF', 'F', 'C', 'FLX'];
const ELIG = {
  PG: ['PG'], SG: ['SG'], SF: ['SF'], PF: ['PF'], C: ['C'],
  G: ['PG', 'SG'], F: ['SF', 'PF'], FLX: POSITIONS,
};
const STATUSES = ['Healthy', 'DTD', 'Out'];
// this deploy's version (the commit), stamped in by the publish workflow; '__BUILD__' when run locally
const BUILD = '__BUILD__';

// The standard 9 categories, in the order most leagues display them (used when a league's own list is unknown).
// Percentage categories name the makes and attempts they're built from.
const CATS = [
  { key: 'fgPct', label: 'FG%', pct: true, made: 'fgm', att: 'fga' },
  { key: 'ftPct', label: 'FT%', pct: true, made: 'ftm', att: 'fta' },
  { key: 'tpm', label: '3PM' },
  { key: 'pts', label: 'PTS' },
  { key: 'reb', label: 'REB' },
  { key: 'ast', label: 'AST' },
  { key: 'stl', label: 'STL' },
  { key: 'blk', label: 'BLK' },
  { key: 'to', label: 'TO', neg: true },
];

// Rough mean / spread of a rostered player in a standard 12-team league, for turning stats into
// "value" (a z-score sum). Other categories a league might count get theirs from the data (fillBase).
const BASE = {
  pts: [15, 6], reb: [6, 3], ast: [3.8, 2.3], stl: [1.0, 0.4], blk: [0.6, 0.5],
  tpm: [1.7, 1.0], to: [1.9, 0.9],
  fgPct: [0.47, 0.9], // impact = (FG% - mean) * FGA
  ftPct: [0.78, 0.7], // impact = (FT% - mean) * FTA
};


const STAT_FIELDS = [
  ['min', 'MIN'], ['pts', 'PTS'], ['reb', 'REB'], ['ast', 'AST'], ['stl', 'STL'], ['blk', 'BLK'],
  ['tpm', '3PM'], ['to', 'TO'], ['fgPct', 'FG%'], ['fga', 'FGA'], ['ftPct', 'FT%'], ['fta', 'FTA'],
  ['games', 'Games / wk'],
];

const DEFAULT_SLOTS = ['PG', 'SG', 'G', 'SF', 'PF', 'F', 'C', 'FLX'];
// the local app (python serve.py) can re-pull NBA data on demand; the website updates daily on its own
const LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

const uid = () => Math.random().toString(36).slice(2, 10);

function emptyState() {
  return {
    version: 2, teamName: 'My Team', basis: 'blend',
    matchDays: [0, 1, 2, 3, 4, 5, 6], opp: { name: '', week: null, players: [] }, savedLeagues: [], leagueStates: {}, pastSeasons: {},
    slots: [...DEFAULT_SLOTS], benchSize: 5, ilSize: 1, slotsSet: true, lineupMode: 'weekly',
    players: [], lineup: [], il: [],
  };
}

/* =========================================================
   State + persistence
   ========================================================= */
let state = null;
const ui = { weekShift: 0, pf: { q: '', pos: '', team: '', show: 'fa', sort: 'val', limit: 50 }, tab: 'dashboard', rosterSort: { key: 'value', dir: -1 }, tradeGive: new Set(), tradeGet: new Set(), tradeTeam: null, totSort: { key: null, dir: 1 }, csOpen: new Set() };

function load() {
  let s = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) s = JSON.parse(raw);
  } catch (e) { /* storage unavailable or corrupt */ }
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
  return s;
}

function normalizePlayer(p) {
  const out = { id: p.id || uid(), name: String(p.name || 'Unnamed'), team: String(p.team || '').toUpperCase(), pos: Array.isArray(p.pos) ? p.pos.filter(x => POSITIONS.includes(x)) : [], status: STATUSES.includes(p.status) ? p.status : 'Healthy', tag: p.tag || '' };
  if (!out.pos.length) out.pos = ['SF'];
  for (const [k] of STAT_FIELDS) out[k] = Number.isFinite(+p[k]) ? +p[k] : 0;
  if (!p.games && p.games !== 0) out.games = 3;
  if (p.nbaId) out.nbaId = p.nbaId;
  out.gp = +p.gp || 0;
  out.inj = p.inj || null;
  out.next = p.next || null;
  return out;
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
}

function restoreFrom(data) {
  if (!data || !Array.isArray(data.players)) throw new Error('bad backup');
  state = normalize(data);
  ui.tradeGive.clear(); ui.tradeGet.clear();
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
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '—');
const fmtPct = n => (Number.isFinite(n) && n > 0 ? n.toFixed(3).replace(/^0/, '') : '—');
const signed = (n, d = 1) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(d);
const sum = arr => arr.reduce((a, b) => a + b, 0);

const byId = id => state.players.find(p => p.id === id);
const canPlay = (p, slot) => p.pos.some(x => ELIG[slot].includes(x));

// A player's contribution to each category the league counts, against an average rostered player.
// Percentages count shot volume: (his % − average %) × his attempts.
function catZ(p) {
  const z = {};
  for (const c of scoreCats()) {
    if (c.fp || !BASE[c.key]) continue;
    const [m, sd] = BASE[c.key];
    if (c.pct) { const att = statVal(p, c.att); z[c.key] = att ? (pctOf(p, c) - m) * att / sd : 0; } else z[c.key] = (c.neg ? -1 : 1) * (statVal(p, c.key) - m) / sd;
  }
  return z;
}
// a percentage category for one player (or any stat line): makes ÷ attempts
const pctOf = (p, c) => { const att = statVal(p, c.att); return att ? statVal(p, c.made) / att : 0; };

// Points leagues score fantasy points from the league's own values; category leagues their own categories
const leaguePoints = () => { const L = NBA && NBA.league; return L && L.points && /POINTS/.test(L.scoring || '') ? L.points : null; };
const isPoints = () => !!leaguePoints();
const STAT_LABEL = { pts: 'PTS', reb: 'REB', oreb: 'OREB', dreb: 'DREB', ast: 'AST', stl: 'STL', blk: 'BLK', tpm: '3PM', tpa: '3PA', tpmi: '3P miss',
  fg2m: '2PM', fg2a: '2PA', to: 'TO', fgm: 'FGM', fga: 'FGA', fgmi: 'FG miss', ftm: 'FTM', fta: 'FTA', ftmi: 'FT miss', dd: 'DD', td: 'TD',
  pf: 'PF', pm: '+/−', min: 'MIN', gp1: 'GP' };
// stats a league can score that are combinations of ones we project
const DERIVED = { fgmi: { fga: 1, fgm: -1 }, ftmi: { fta: 1, ftm: -1 }, tpmi: { tpa: 1, tpm: -1 }, fg2m: { fgm: 1, tpm: -1 }, fg2a: { fga: 1, tpa: -1 } };
function statVal(p, k) {
  if (k === 'fgm') return p.fgPct * p.fga;
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
const PCT_CATS = { fgPct: ['FG%', 'fgm', 'fga'], ftPct: ['FT%', 'ftm', 'fta'], tpPct: ['3P%', 'tpm', 'tpa'] };
const NEG_CATS = new Set(['to', 'pf', 'fgmi', 'ftmi', 'tpmi']); // fewer is better
const CAT_ORDER = ['fgPct', 'ftPct', 'tpPct', 'tpm', 'tpa', 'pts', 'reb', 'oreb', 'dreb', 'ast', 'stl', 'blk', 'to', 'dd', 'td'];
function catDef(key) {
  if (PCT_CATS[key]) { const [label, made, att] = PCT_CATS[key]; return { key, label, pct: true, made, att }; }
  return { key, label: STAT_LABEL[key] || key.toUpperCase(), neg: NEG_CATS.has(key), dec: key === 'dd' || key === 'td' ? 2 : null };
}
let catsMemo = { L: undefined, cats: CATS };
function scoreCats() {
  const L = NBA && NBA.league;
  if (catsMemo.L !== L) {
    const sc = leaguePoints();
    catsMemo = { L, cats: sc
      ? [...Object.keys(STAT_LABEL).filter(k => sc[k]).map(k => ({ key: k, label: STAT_LABEL[k], neg: sc[k] < 0, dec: k === 'dd' || k === 'td' ? 2 : null })), { key: 'fp', label: 'FP', fp: true }]
      : L && L.cats && L.cats.length ? L.cats.map(catDef) : CATS };
    nbaCache = null; // player values depend on the categories
  }
  return catsMemo.cats;
}

function value(p) {
  return isPoints() ? fantasyPoints(p) : sum(Object.values(catZ(p)));
}
const valueLabel = () => (isPoints() ? 'FP/G' : 'Value');
const fmtValue = v => (isPoints() ? fmt(v, 1) : signed(v, 1));
const statOf = (p, c) => (c.fp ? fantasyPoints(p) : c.pct ? pctOf(p, c) : statVal(p, c.key));

// Typical fantasy points per game for a rostered player, for shading the FP column
let fpBaseCache = null;
function fpBase() {
  const sc = leaguePoints();
  if (fpBaseCache && fpBaseCache.sc === sc) return fpBaseCache.v;
  const fps = NBA.players.map(raw => nbaStats(raw)).filter(x => x && x.gp >= 3).map(x => fantasyPoints(x, sc)).sort((a, b) => b - a).slice(0, 200);
  const m = sum(fps) / (fps.length || 1), sd = Math.sqrt(sum(fps.map(x => (x - m) ** 2)) / (fps.length || 1)) || 1;
  fpBaseCache = { sc, v: [m, sd] };
  return fpBaseCache.v;
}

// Aggregate per-game totals for a group of players (counting stats summed, % weighted by attempts)
function totals(list, mult = () => 1) {
  const t = { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tpm: 0, to: 0, fgm: 0, fga: 0, ftm: 0, fta: 0 };
  for (const p of list) {
    const m = mult(p);
    for (const k of ['pts', 'reb', 'ast', 'stl', 'blk', 'tpm', 'to', 'fga', 'fta', 'min', ...EXTRA_KEYS]) t[k] = (t[k] || 0) + (p[k] || 0) * m;
    t.gp1 = (t.gp1 || 0) + m;
    t.fgm += p.fgPct * p.fga * m;
    t.ftm += p.ftPct * p.fta * m;
  }
  for (const k of Object.keys(DERIVED)) t[k] = sum(Object.entries(DERIVED[k]).map(([b, c]) => (t[b] || 0) * c));
  for (const [k, [, made, att]] of Object.entries(PCT_CATS)) t[k] = t[att] ? t[made] / t[att] : 0;
  if (isPoints()) t.fp = sum(list.map(p => fantasyPoints(p) * mult(p)));
  return t;
}

function statusBadge(p) {
  const cls = p.status === 'Out' ? 'bad' : p.status === 'DTD' ? 'warn' : 'good';
  return `<span class="badge ${cls}">${esc(p.status)}</span>`;
}

// ----- Headshots and team logos (data/headshots.webp + data/images.json, built by scripts/build_images.py) -----
let IMG = null;
const IMG_INDEX = new Map();

async function loadImages() {
  try {
    const r = await fetch('data/images.json', { cache: 'no-cache' });
    if (!r.ok) return;
    IMG = await r.json();
    IMG.ids.forEach((id, i) => IMG_INDEX.set(id, i));
    render();
  } catch (e) { /* images are optional */ }
}

const initials = name => String(name || '?').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();

function headshot(p, px = 28) {
  const i = IMG && p && p.nbaId != null ? IMG_INDEX.get(p.nbaId) : undefined;
  const box = `width:${px}px;height:${px}px`;
  if (i === undefined) return `<span class="hs hs-none" style="${box}" aria-hidden="true">${esc(initials(p && p.name))}</span>`;
  const col = i % IMG.cols, row = Math.floor(i / IMG.cols);
  return `<span class="hs" style="${box};background-size:${IMG.cols * px}px auto;background-position:-${col * px}px -${row * px}px" aria-hidden="true"></span>`;
}

function teamLogo(team, px = 16) {
  const src = IMG && team && IMG.logos[team];
  return src ? `<img class="tlogo" src="${src}" alt="${esc(team)}" title="${esc(team)}" width="${px}" height="${px}">` : esc(team || 'FA');
}

// Position labels in Fantrax's colors
const posTags = pos => pos.map(x => `<span class="pt pt-${esc(x)}">${esc(x)}</span>`).join(',');

// a player's name and team line, with their photo unless the list is too long for them (the Free Agents tab)
function playerCell(p, link = true, photo = true) {
  const name = link && p.nbaId ? `<button class="link-btn pname" data-action="player-detail" data-nba="${p.nbaId}">${esc(p.name)}</button>` : `<span class="pname">${esc(p.name)}</span>`;
  const next = p.next ? ` · ${nextGame(p.next)}` : '';
  const inj = p.inj ? `<div class="pmeta inj" title="${esc(p.inj.note)}">${esc(p.inj.label)}${p.inj.note ? ': ' + esc(p.inj.note.length > 60 ? p.inj.note.slice(0, 60) + '…' : p.inj.note) : ''}</div>` : '';
  const body = `<div>${name}</div><div class="pmeta">${teamLogo(p.team, 14)} ${posTags(p.pos)}${next}</div>${inj}`;
  return photo ? `<div class="bplayer">${headshot(p, 32)}<div class="bmain">${body}</div></div>` : body;
}

// a small photo and name for use inside a line of text
const inlinePlayer = (p, text, px = 20) => `<span class="inl-p">${headshot(p, px)}${text}</span>`;

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

/* =========================================================
   Real NBA data (data/players.json, built by scripts/update_data.py)
   ========================================================= */
let NBA = null;
let nbaLoading = Promise.resolve(false);
const nbaById = new Map();
const nbaByName = new Map();
let nbaCache = null; // player-like objects for the Free Agents tab
const BASIS_LABELS = { blend: 'Smart blend', cur: 'This season', prev: 'Last season', l10: 'Last 10 games' };

const normName = s => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/-/g, ' ').replace(/[^a-z ]/g, '').replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '').replace(/\s+/g, ' ').trim();

function statObj(arr) {
  if (!arr) return null;
  const o = {};
  NBA.statKeys.forEach((k, i) => { if (i < arr.length) o[k] = +arr[i] || 0; });
  return o;
}

// Per-game stats for a player under the chosen basis. "Smart blend" shrinks a small
// current-season sample toward last season (10 games of weight), then trusts this season.
function nbaStats(raw, basis = state.basis) {
  if (String(basis).startsWith('arch:')) return archivedStats(raw, basis.slice(5));
  const cur = statObj(raw.cur), prev = statObj(raw.prev), l10 = statObj(raw.l10);
  let s;
  if (basis === 'cur') s = cur;
  else if (basis === 'prev') s = prev;
  else if (basis === 'l10') s = l10 || cur;
  else if (cur && cur.gp && prev && prev.gp) {
    const K = 10, w = cur.gp + K;
    s = {};
    for (const k of NBA.statKeys) s[k] = prev[k] == null ? cur[k] : cur[k] == null ? prev[k] : (cur[k] * cur.gp + prev[k] * K) / w;
    s.gp = cur.gp;
  } else s = (cur && cur.gp) ? cur : prev;
  if (!s) return null;
  return { ...s, fgPct: s.fga ? s.fgm / s.fga : 0, ftPct: s.fta ? s.ftm / s.fta : 0 };
}

function teamInfo(team) { return (NBA && NBA.teams && NBA.teams[team]) || null; }

// Copy live data onto a rostered player
function applyNba(p, raw) {
  p.nbaId = raw.id;
  p.team = raw.team;
  if (raw.fx && raw.pos && raw.pos.length) p.pos = [...raw.pos]; // your league's eligibility
  const s = nbaStats(raw);
  for (const k of ['min', 'pts', 'reb', 'ast', 'stl', 'blk', 'tpm', 'to', 'fga', 'fta', 'fgPct', 'ftPct', ...EXTRA_KEYS]) p[k] = s && s[k] != null ? +(+s[k]).toFixed(3) : 0;
  p.gp = s ? Math.round(s.gp) : 0;
  p.status = raw.inj ? raw.inj.status : 'Healthy';
  p.inj = raw.inj || null;
  const t = teamInfo(raw.team);
  p.games = t ? t.left : p.games;
  p.next = t ? t.next : null;
}

function syncLinked() {
  if (!NBA) return false;
  const before = JSON.stringify([state.players, state.opp.players]);
  for (const p of [...state.players, ...state.opp.players]) {
    let raw = p.nbaId ? nbaById.get(p.nbaId) : null;
    if (!raw && !p.nbaId) {
      const id = nbaByName.get(normName(p.name));
      raw = id ? nbaById.get(id) : null;
    }
    if (raw) applyNba(p, raw);
  }
  nbaCache = null;
  return before !== JSON.stringify([state.players, state.opp.players]);
}

async function loadNba(fresh = false) {
  try {
    const r = await fetch('data/players.json' + (fresh ? '?t=' + Date.now() : ''), { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    const data = await r.json();
    if (!data || !Array.isArray(data.players)) throw new Error('bad data');
    NBA = data;
    nbaById.clear(); nbaByName.clear();
    for (const raw of NBA.players) { nbaById.set(raw.id, raw); nbaByName.set(normName(raw.name), raw.id); }
    teamDates = new Map(Object.entries(NBA.teams || {}).map(([t, v]) => [t, new Set(v.dates || [])]));
    for (const raw of NBA.players) raw.basePos = NBA_POS_MAP[raw.nbaPos] || raw.pos;
    countNames();
    if (NBA.league && NBA.league.scoringSystem) Object.assign(NBA.league, fxScoring(NBA.league.scoringSystem));
    fillBase();
    NBA.siteLeague = NBA.league;
    // a reload from Fantrax since this morning's file beats the file
    const fresher = NBA.league && !state.fxLeagueId ? cachedLeague(NBA.league.id) : null;
    if (fresher) applyFantraxLeague(withSiteExtras(fresher));
    const other = state.fxLeagueId && (!NBA.league || NBA.league.id !== state.fxLeagueId);
    if (other) {
      // someone else's league: wait for it, since the file's league isn't theirs
      try {
        await refreshLeague();
      } catch (e) {
        toast(`Couldn't load your Fantrax league right now. Showing ${NBA.league ? NBA.league.name : 'the site league'}.`);
      }
    }
    if (state.fxTeam && !(NBA.league && NBA.league.teams.some(t => t.id === state.fxTeam))) state.fxTeam = null;
    if (state.fxTeam) syncLeagueRules();
    const migrate = state.fxTeam && NBA.league && !(state.savedLeagues || []).some(l => l.id === NBA.league.id);
    if (migrate) rememberLeague(NBA.league.id, NBA.league.name);
    if (syncLinked() || migrate) commit(); else render();
    return true;
  } catch (e) {
    render();
    return false;
  }
}

function nbaPlayers() {
  if (!NBA) return [];
  if (nbaCache && nbaCache.basis === state.basis) return nbaCache.list;
  const list = NBA.players.map(raw => {
    const s = nbaStats(raw) || {};
    const t = teamInfo(raw.team);
    const p = {
      id: 'nba' + raw.id, nbaId: raw.id, name: raw.name, team: raw.team, pos: raw.pos,
      status: raw.inj ? raw.inj.status : 'Healthy', inj: raw.inj || null, next: t ? t.next : null, games: t ? t.left : 0,
      gp: Math.round(s.gp || 0), min: s.min || 0, pts: s.pts || 0, reb: s.reb || 0, ast: s.ast || 0, stl: s.stl || 0,
      blk: s.blk || 0, tpm: s.tpm || 0, to: s.to || 0, fga: s.fga || 0, fta: s.fta || 0, fgPct: s.fgPct || 0, ftPct: s.ftPct || 0,
      ...Object.fromEntries(EXTRA_KEYS.map(k => [k, s[k] || 0])),
    };
    p.val = p.gp ? value(p) : -99;
    return p;
  });
  nbaCache = { basis: state.basis, list };
  return list;
}

function ago(iso) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(m)) return '';
  if (m < 60) return `${Math.max(m, 1)} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} hr ago`;
  return `${Math.round(m / 1440)} days ago`;
}

function fmtDay(d) {
  const dt = new Date(d + 'T12:00:00');
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function nextGame(next) {
  return next ? `${fmtDay(next.date).split(',')[0]} ${next.home ? 'vs' : '@'} ${esc(next.opp)}` : '';
}

/* =========================================================
   Lineup logic
   ========================================================= */
function starters() { return state.lineup.map(byId).filter(Boolean); }
function ilPlayers() { return state.il.map(byId).filter(Boolean); }
function benchPlayers() {
  const used = new Set([...state.lineup.filter(Boolean), ...state.il]);
  return state.players.filter(p => !used.has(p.id));
}
function slotOf(p) {
  if (state.il.includes(p.id)) return 'IL';
  const i = state.lineup.indexOf(p.id);
  return i === -1 ? 'BN' : state.slots[i];
}

// Max-value lineup. Eligible players form a transversal matroid, so taking players
// greedily by value and keeping each one an augmenting path can fit is optimal.
function autoLineupIds(s = state) {
  const prevState = state;
  state = s;
  try {
    const slots = s.slots;
    const ilSet = new Set(s.il);
    const cand = s.players
      .filter(p => !ilSet.has(p.id) && p.status !== 'Out')
      .map(p => ({ p, v: value(p) * (p.status === 'DTD' ? 0.85 : 1) }))
      .sort((a, b) => b.v - a.v)
      .map(x => x.p);
    return fillSlots(cand, slots);
  } finally {
    state = prevState;
  }
}

// Assign candidates (in priority order) to slots; returns player id per slot (null = empty)
function fillSlots(cands, slots) {
  const match = Array(slots.length).fill(null);
  const order = slots.map((_, i) => i).sort((a, b) => ELIG[slots[a]].length - ELIG[slots[b]].length);
  const find = new Map(cands.map(p => [p.id, p]));
  const tryAssign = (p, seen) => {
    for (const i of order) {
      if (seen.has(i) || !canPlay(p, slots[i])) continue;
      seen.add(i);
      if (match[i] === null || tryAssign(find.get(match[i]), seen)) { match[i] = p.id; return true; }
    }
    return false;
  };
  for (const p of cands) tryAssign(p, new Set());
  return match;
}

/* =========================================================
   Weekly matchup engine
   ========================================================= */
// Per-game stats we project. The first 11 have spreads from game logs (raw.sd, same order); the rest are
// for points leagues that score them (dd/td are per-game rates; gp1 is one per game played).
const COUNT_KEYS = ['pts', 'reb', 'ast', 'stl', 'blk', 'tpm', 'to', 'fgm', 'fga', 'ftm', 'fta', 'oreb', 'dreb', 'tpa', 'pf', 'pm', 'dd', 'td', 'min', 'gp1'];
const EXTRA_KEYS = ['oreb', 'dreb', 'tpa', 'pf', 'pm', 'dd', 'td'];
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
let teamDates = new Map();

const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayIso = () => isoDay(new Date());
function addDays(iso, n) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return isoDay(d); }
const dayOffset = iso => (new Date(iso + 'T12:00:00').getDay() + 6) % 7; // Mon = 0
const mondayOf = iso => addDays(iso, -dayOffset(iso));

// The matchup week to show: this week, or next week once this week's matchup days are over
function weekStart() {
  const t = todayIso();
  const base = dayOffset(t) > Math.max(...state.matchDays) ? addDays(mondayOf(t), 7) : mondayOf(t);
  return addDays(base, 7 * ui.weekShift);
}
function matchDates(start = weekStart()) {
  const p = NBA && NBA.league && NBA.league.periods ? fxPeriodFor(start) : null;
  if (p) {
    // a period ending in the evening (Fantrax's usual 6:59 PM) leaves that day's games to the next one
    const endHour = +(String(p.endAt || '').match(/T(\d\d)/) || [0, 23])[1];
    const out = [];
    for (let d = p.start; d < p.end || (d === p.end && endHour >= 21); d = addDays(d, 1)) out.push(d);
    if (out.length) return out;
  }
  return [...state.matchDays].sort((a, b) => a - b).map(o => addDays(start, o));
}
const playsOn = (p, d) => !!(teamDates.get(p.team) && teamDates.get(p.team).has(d));
const gamesIn = (p, dates) => dates.filter(d => playsOn(p, d)).length;

// Baselines for any category beyond the usual nine (3P%, OREB, DD...): the mean and spread among
// likely-rostered players, the 160 with the most minutes. Percentages measure (% − average) × attempts.
function fillBase() {
  const pool = NBA.players.map(raw => nbaStats(raw)).filter(x => x && x.gp >= 3).sort((a, b) => b.min - a.min).slice(0, 160);
  if (pool.length < 20) return;
  const spread = (xs, m) => Math.max(Math.sqrt(sum(xs.map(x => (x - m) ** 2)) / xs.length), 0.02);
  for (const k of [...COUNT_KEYS, ...Object.keys(DERIVED)]) {
    if (BASE[k]) continue;
    const xs = pool.map(x => statVal(x, k));
    const m = sum(xs) / xs.length;
    BASE[k] = [m, spread(xs, m)];
  }
  for (const [k, [, made, att]] of Object.entries(PCT_CATS)) {
    if (BASE[k]) continue;
    const a = sum(pool.map(x => statVal(x, att)));
    const m = a ? sum(pool.map(x => statVal(x, made))) / a : 0;
    BASE[k] = [m, spread(pool.map(x => { const n = statVal(x, att); return n ? (statVal(x, made) / n - m) * n : 0; }), 0)];
  }
}

// Per-game means and spreads. Spreads come from the player's real game logs when available.
function perGame(p) {
  const m = Object.fromEntries(COUNT_KEYS.map(k => [k, statVal(p, k)]));
  const raw = p.nbaId ? nbaById.get(p.nbaId) : null;
  const sd = {};
  COUNT_KEYS.forEach((k, i) => {
    sd[k] = raw && raw.sd && raw.sd[i] != null ? raw.sd[i]
      : k === 'pts' ? 0.3 * m.pts + 2.5
      : k === 'dd' || k === 'td' ? Math.sqrt(m[k] * (1 - m[k])) // happens or not, game to game
      : k === 'pm' ? 9 : k === 'min' ? 4 : k === 'gp1' ? 0
      : 1.1 * Math.sqrt(Math.max(m[k], 0.1));
  });
  return { m, sd };
}

// Finished games: whether a player's team has played that day, and his real line (null: he didn't play)
const gameFinal = (p, d) => !!(BOX && p.team && BOX.finals.has(`${d} ${p.team}`));
const actualLine = (p, d) => (BOX && p.nbaId ? (BOX.day.get(p.nbaId) || new Map()).get(d) || null : null);

// Project one side's week. fixedIds = that lineup as set; null = best lineup every day.
// Days whose games are over count the real box score (or nothing, for a player who sat).
function projectSide(players, dates, fixedIds) {
  const tot = Object.fromEntries(COUNT_KEYS.map(k => [k, 0]));
  const vr = Object.fromEntries(COUNT_KEYS.map(k => [k, 0]));
  const left = Object.fromEntries(COUNT_KEYS.map(k => [k, 0])); // the part still to be played
  const ranked = [...players].sort((a, b) => value(b) - value(a));
  const days = [];
  let games = 0;
  for (const d of dates) {
    // a finished game: available means he played; otherwise anyone not ruled Out whose team plays
    const avail = ranked.filter(p => playsOn(p, d) && (gameFinal(p, d) ? !!actualLine(p, d) : p.status !== 'Out'));
    let active;
    if (fixedIds) active = avail.filter(p => fixedIds.has(p.id));
    else {
      const ids = new Set(fillSlots(avail, state.slots).filter(Boolean));
      active = avail.filter(p => ids.has(p.id));
    }
    for (const p of active) {
      const line = gameFinal(p, d) ? actualLine(p, d) : null;
      if (line) { for (const k of COUNT_KEYS) tot[k] += line[k] || 0; continue; }
      const g = perGame(p);
      for (const k of COUNT_KEYS) { tot[k] += g.m[k]; vr[k] += g.sd[k] ** 2; left[k] += g.m[k]; }
    }
    games += active.length;
    days.push({ date: d, active: new Set(active.map(p => p.id)), avail: new Set(avail.map(p => p.id)) });
  }
  return { tot, vr, left, games, days };
}

function phi(x) { // standard normal CDF
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

// A side's projected fantasy points, and their spread. Stats in one game move together (a big
// scoring night brings rebounds and assists too), so spreads are combined with a 0.35 correlation.
const FP_RHO = 0.35;
function fpTotals(S) {
  const sc = foldPoints(leaguePoints());
  const a = sum(Object.entries(sc).map(([k, v]) => (S.tot[k] || 0) * v));
  const parts = Object.entries(sc).map(([k, v]) => v * Math.sqrt(S.vr[k] || 0));
  const vr = (1 - FP_RHO) * sum(parts.map(x => x * x)) + FP_RHO * sum(parts) ** 2;
  return { a, vr };
}

function compareCats(A, B) {
  return scoreCats().map(c => {
    let a, b, sd;
    if (c.fp) {
      const fa = fpTotals(A), fb = fpTotals(B);
      a = fa.a; b = fb.a; sd = Math.sqrt(fa.vr + fb.vr);
    } else if (c.pct) {
      const mk = c.made, at = c.att;
      a = A.tot[at] ? A.tot[mk] / A.tot[at] : 0;
      b = B.tot[at] ? B.tot[mk] / B.tot[at] : 0;
      // shot-making noise on the attempts still to come, a bit wider than pure binomial
      const noise = (S, x) => (S.tot[at] ? 1.3 * x * (1 - x) * (S.left ? S.left[at] : S.tot[at]) / S.tot[at] ** 2 : 0);
      const va = noise(A, a), vb = noise(B, b);
      sd = Math.sqrt(va + vb);
    } else {
      a = totStat(A, c.key); b = totStat(B, c.key);
      sd = Math.sqrt(vrStat(A, c.key) + vrStat(B, c.key));
    }
    let p = sd > 0 ? phi((a - b) / sd) : (a > b ? 1 : a < b ? 0 : 0.5);
    if (c.neg) p = 1 - p;
    return { ...c, a, b, p };
  });
}

// Odds of winning the week. Points leagues: the chance of outscoring them (expected = your projected FP)
function matchOdds(cats) {
  const fp = cats.find(c => c.fp);
  if (fp) return { win: fp.p, expected: fp.a, opp: fp.b, n: 1, points: true };
  let dist = [1];
  for (const c of cats) {
    const next = Array(dist.length + 1).fill(0);
    dist.forEach((q, k) => { next[k] += q * (1 - c.p); next[k + 1] += q * c.p; });
    dist = next;
  }
  const n = cats.length;
  let win = 0;
  dist.forEach((q, k) => { if (k * 2 > n) win += q; else if (k * 2 === n) win += q / 2; });
  return { win, expected: sum(cats.map(c => c.p)), n };
}

// How a week is decided. "most": one win for taking more categories (Fantrax
// HEAD_TO_HEAD_ROTI_SINGLE_WIN). "each": every category counts in the standings.
function matchupScoring() {
  const L = NBA && NBA.league;
  if (L && L.scoring) return /SINGLE_WIN/.test(L.scoring) ? 'most' : 'each';
  return 'most';
}

// What the lineup optimizer maximizes. Because each category's win chance is a bell
// curve, adding stats to a category that's already lost (or already won) barely moves
// it, so those categories get effectively punted without any special rule.
function objective(odds) {
  // points: win chance first, then a bigger projected margin (also the goal with no opponent loaded)
  if (odds.points) return odds.win + 1e-5 * (odds.expected - odds.opp);
  return matchupScoring() === 'most' ? odds.win + 0.01 * odds.expected / odds.n : odds.expected + 0.01 * odds.win;
}

function playerFromRaw(raw, extra = {}) {
  const p = { id: uid(), name: raw.name, pos: [...raw.pos], tag: '', ...extra };
  applyNba(p, raw);
  return p;
}

// ----- Locked weekly lineups -----
// Rough worth of starting a player for the week: games × (value above a deep-bench player)
function weeklyPriority(p, dates) {
  return p.status === 'Out' ? -1 : gamesIn(p, dates) * Math.max(value(p) + 4, 0.2);
}

function fitsSlots(ids, players) {
  const chosen = players.filter(p => ids.has(p.id));
  return fillSlots(chosen, state.slots).filter(Boolean).length === chosen.length;
}

// Best set of starters for a locked week. With an opponent, polish it by trying
// starter/bench swaps that raise the expected category score.
function bestWeeklyIds(players, dates, them) {
  const cands = players.filter(p => p.status !== 'Out').sort((a, b) => weeklyPriority(b, dates) - weeklyPriority(a, dates));
  let cur = new Set(fillSlots(cands, state.slots).filter(Boolean));
  if (!them) return cur;
  const score = ids => objective(matchOdds(compareCats(projectSide(players, dates, ids), them)));
  let curScore = score(cur);
  for (let iter = 0; iter < 6; iter++) {
    let bestMove = null;
    for (const outId of cur) {
      for (const p of cands) {
        if (cur.has(p.id) || !gamesIn(p, dates)) continue;
        const trial = new Set(cur); trial.delete(outId); trial.add(p.id);
        if (!fitsSlots(trial, players)) continue;
        const sc = score(trial);
        if (sc > curScore + 1e-4 && (!bestMove || sc > bestMove.sc)) bestMove = { trial, sc };
      }
    }
    // an open slot (not enough healthy players) can also take any eligible bench player
    if (!bestMove) break;
    cur = bestMove.trial; curScore = bestMove.sc;
  }
  return cur;
}

// The opponent's starters: the ones you marked, or our best guess
function oppStarterIds(dates) {
  const opp = state.opp.players;
  if (Array.isArray(state.opp.starters)) {
    const ids = new Set(state.opp.starters.filter(id => opp.some(p => p.id === id)));
    if (ids.size) return ids;
  }
  return bestWeeklyIds(opp, dates, null);
}

// ----- ⓘ explanations of how things are calculated -----
const INFO = {
  win: ['Win chances', `
    <p><b>Projected totals.</b> For each category we add up every starter's per-game average × the games they play on your matchup days (from the NBA schedule). Players who are Out count zero. Bench games never count while lineups are locked for the week.</p>
    <p><b>Uncertainty.</b> Each player's game-to-game spread (standard deviation) comes from his NBA game logs: last season plus this season, games of 10+ minutes, at least 8 games. Spreads add up across every starter game, so a team's weekly total has a known range.</p>
    <p><b>Category win chance.</b> For counting stats: the chance your total beats theirs, using a bell curve with the gap divided by the combined spread. Turnovers are reversed (fewer wins). FG% and FT% use team makes ÷ attempts, with shot-making luck (binomial, widened 30%) as the spread.</p>
    <p><b>Lineups.</b> Both teams' starters as set on Fantrax. Projections use the stats chosen in the league menu (smart blend by default).</p>
    <p><b>Points leagues.</b> Each side's projected fantasy points come from those totals × your league's points per stat. The spread combines every stat's spread, assuming stats in a game move together somewhat (correlation 0.35), and the win chance is the chance of outscoring them on that bell curve. The suggested lineup maximizes that chance, then projected points. We project points, rebounds (offensive and defensive too), assists, steals, blocks, turnovers, threes made and attempted, field goals and free throws made, attempted and missed, two-pointers, double-doubles and triple-doubles (as how often a player gets one), fouls, plus/minus, minutes and games played. Anything else your league scores, like technicals, percentages or position-specific points, is left out and listed in the top bar.</p>
    <p><b>Winning the week.</b> Categories are treated as independent, and we add up the chances of every way to take more than half of them. The projected category score is the sum of the category win chances.</p>`],
  suggest: ['How lineup suggestions work', `
    <p><b>Starting point.</b> Starters are ranked by games this week × (player value + 4), then fitted into your slots (PG, SG, G, SF, PF, F, C, Flx) so every slot gets an eligible player.</p>
    <p><b>Search.</b> We try every single swap of a starter for a bench player that still fits the slots and keep the one that improves the goal most, repeating up to 6 times until nothing helps.</p>
    <p><b>The goal.</b> Your league gives one win to whoever takes more categories, so the goal is your chance of winning the week. Total categories won only breaks ties.</p>
    <p><b>Punting.</b> A category's win chance follows a bell curve, so adding stats to one you're far behind in (or far ahead in) barely moves it. Those categories effectively get ignored, and players are used where the matchup is close.</p>
    <p><b>Explaining it.</b> The suggested lineup is broken into one-for-one swaps, best first. Each swap's numbers assume the swaps above it are already made.</p>`],
  shading: ['Stat shading', `
    <p><b>Per game.</b> Each stat is compared with an average rostered player in a 12-team league:</p>
    <ul><li>PTS 15 ± 6, REB 6 ± 3, AST 3.8 ± 2.3, STL 1.0 ± 0.4, BLK 0.6 ± 0.5, 3PM 1.7 ± 1.0, TO 1.9 ± 0.9 (fewer is better)</li>
    <li>FG%: (FG% − 47%) × attempts ÷ 0.9 · FT%: (FT% − 78%) × attempts ÷ 0.7, so shot volume counts</li></ul>
    <p><b>Week total.</b> The player's weekly number is compared with an average starter's week of about 3.5 games: (weekly total − average × 3.5) ÷ (spread × 3.5). The same weekly total always gets the same shade.</p>
    <p><b>Colors.</b> Green helps the category, red hurts it, getting stronger up to ±2.5 spreads. The Projected week row is shaded by your chance to win each category instead. Hover any number for the exact value.</p>`],
  dots: ['Schedule dots', `
    <p>One dot per matchup day, from the NBA schedule. <b>Filled</b> dots are games already played; <b>rings</b> are games still to come.</p>
    <ul><li><b>Green:</b> a game that counts (a starter).</li><li><b>Grey:</b> a game on the bench, which doesn't count.</li>
    <li><b>Yellow:</b> a regular (20+ minutes a game) played well under his usual minutes: under 70% of his average and at least 8 fewer. Hover it for his minutes and the likely reason: an <b>injury</b> (he's been on the ESPN injury report since that game), a <b>blowout</b> (decided by 20 or more), <b>foul trouble</b> (5 or more fouls), or none of those, which usually means the coach's call.</li>
    <li><b>Light green ring:</b> an upcoming back-to-back night (the team also plays the day before or after). Players sometimes rest one of those nights.</li>
    <li><b>Red:</b> filled, his team played but he didn't; a ring, he's listed Out.</li></ul>
    <p>Hover any played game for his minutes and stat line. The number on the right is games this week; hover it for played and left. Projections use the real box score for games already played and project only the rest.</p>`],
  value: ['Player value', `
    <p>Value is the sum of a player's contributions per game in each of your league's categories, each measured against an average rostered player (see Stat shading for the exact averages). +5 is an elite all-around player; around 0 is replacement level in a 12-team league.</p>
    <p>FG% and FT% count shot volume, and turnovers count against.</p>
    <p><b>Points leagues:</b> value is fantasy points per game (FP/G), using your league's points for each stat from Fantrax.</p>`],
  projection: ['Which stats are used', `
    <p><b>Smart blend (default):</b> this season's averages with 10 games of last season mixed in: (this season × games played + last season × 10) ÷ (games played + 10). Early on it leans on last season; after a month or two it's mostly this season.</p>
    <p>Switch to this season only, last season only, or the last 10 games from the league menu at the top.</p>`],
  strengths: ['Category strengths', `
    <p><b>You.</b> Your players' real per-game numbers: the average per player for counting stats (starters, or your whole active roster), and team FG% and FT% as total makes ÷ total attempts.</p>
    <p><b>League avg.</b> The same number averaged across every team in your Fantrax league, using each team's current roster and lineup.</p>
    <p><b>Bar.</b> How far you are from that league average, measured in the typical gap between teams (one standard deviation across the league). The bar reaches the edge at two gaps above or below. Fewer turnovers counts as above average.</p>
    <p><b>Rank and dots.</b> Your place among the teams in that category, and every team on the same scale, with you in orange.</p>
    <p><b>Who helped and hurt.</b> Click a category's row to show the players who helped most (green) and hurt most (red). Each player's own per-game number in that category, compared with the league average in the same row. For FG% and FT% it's their percentage and attempts a game ("<b>.700</b> on 6.2 FTA"), ranked by makes above or below what the league average would give at that volume, so a poor shooter who takes a lot of shots hurts more than one who rarely shoots. Hover a name for the detail.</p>
    <p><b>Strengths and weaknesses.</b> Your top-three and bottom-three categories by league rank.</p>`],
  totals: ['Season totals', `
    <p><b>Who counts.</b> Fantrax keeps every team's lineup for each lineup period (a week, or a day in daily leagues). A player's games count for the team that had him <b>starting</b> in that period. Bench and IR games don't count, and a player who changed teams counts for whoever was starting him at the time.</p>
    <p><b>Player games.</b> Every starter's games added up, so it depends on how many starters your league has and how often their NBA teams played. A team with more player games has had more chances to pile up counting stats.</p>
    <p><b>Totals.</b> Counting stats are added up from this season's box scores. FG% and FT% are total makes ÷ total attempts.</p>
    <p><b>Colors.</b> Each column is shaded from best in the league (green) to worst (red); fewer turnovers counts as better. Hover a number for its rank. <b>Avg rank</b> is a team's average rank across the categories.</p>
    <p><b>Sorting.</b> Click a column to sort it best first, and again to flip it. Until then, teams follow the standings.</p>`],
  awDraft: ['Best draft', `
    <p>Everything a team's draft picks produced over the season: every game each pick played from the draft until he was first <b>dropped</b> to free agency, whether he was starting or on the bench. A pick who's <b>traded</b> keeps counting for the team that drafted him; one who's dropped stops counting (if someone picks him up later, that's their Waiver Wire Wizard).</p>
    <p>In category leagues each game is valued against a <b>replacement-level starter</b> (the per-game value of the last player who'd start in your league), so every game by a player worth starting adds to the total and staying healthy pays. Points leagues add up fantasy points.</p>
    <p>Totals don't adjust for draft slot, so a great first-round pick usually out-produces a late-round steal. The Draft tab grades each pick against its slot (+/−).</p>`],
  awManager: ['Best manager', `
    <p>Wins above what the roster should have produced: <b>actual wins</b> (ties count half) minus <b>expected wins</b>.</p>
    <p>Expected wins: each team's typical week (its best lineup by per-game value, each starter counted for the share of the season's games he played, using that season's full per-game stats and the team's final roster) is matched against every other team's with the same win-chance math as Matchups. The average win chance × games played is the expected record.</p>
    <p>Fantrax's public data has no weekly scores, so this is an estimate from rosters, not actual week-by-week luck.</p>`],
  awWaiver: ['Waiver Wire Wizard', `
    <p>What free-agent and waiver pickups did for the team that picked them up: every game a pickup played in a week he was in that team's <b>starting lineup</b>, each valued like a single game on the Dashboard (fantasy points in points leagues), added up.</p>
    <p>A pickup who started one week counts for that week only, and he counts even if he was dropped later. A pickup who played below an average rostered player lowers the total.</p>
    <p>Fantrax has no public transaction log, so this follows each player through every week's rosters: on his team from week 1 means drafted or kept; on another team's roster the week before he arrived means a <b>trade</b>, which doesn't count; on nobody's roster means a <b>pickup</b>. A player dropped and claimed by another team in the same week looks like a trade.</p>`],
  awStreet: ['Street Clothes', `
    <p>Games a team lost to players sitting while they were in its <b>starting lineup</b>. For each week, Fantrax's rosters say who started; for each starter, every game his NBA team played that week without him counts one.</p>
    <p>Bench and IR players don't count, and neither do games before a player joined the team or after he left it, so a player traded or dropped mid-season counts only for the weeks a team started him. Injuries, rest and coach's decisions all count the same: the game logs can't tell them apart.</p>
    <p>A team's schedule comes from that season's NBA game logs (every day any of its players played). A player who didn't play at all that season is placed on his current team.</p>`],
  awPunt: ['Biggest punt', `
    <p>Each team's typical week (its best lineup by per-game value, each starter counted for the share of the season's games he played, using that season's full per-game stats and the team's final roster), compared with the league's other teams category by category, in team-to-team spreads. The award goes to the single category furthest below the league average.</p>`],
  awSteven: ['Even Steven', `
    <p>Each team's typical week (its best lineup by per-game value, each starter counted for the share of the season's games he played, using that season's full per-game stats and the team's final roster), compared with the league's other teams category by category, in team-to-team spreads. The most balanced team has the smallest spread between its best and worst categories.</p>`],
  awUnc: ['Unc Status', `
    <p>The oldest <b>starting lineups</b>. Every week, Fantrax's rosters say who each team started; each starter's age that week is averaged over all of the team's starter-weeks, so a player who started 20 weeks counts 20 times as much as one who started once. Bench and IR players don't count.</p>
    <p>Ages come from ESPN birth dates. Players without one on record (mostly those no longer in the NBA) are left out.</p>`],
  draft: ['How draft picks are graded', `
    <p><b>Now.</b> Every drafted player is ranked using only this season's stats (see Player value). Players who haven't played yet rank below everyone who has.</p>
    <p><b>Per game or season totals.</b> The toggle at the top re-ranks the whole tab. <b>Per game</b> ranks by value per game, so a player who's missed time isn't held against his pick. <b>Season totals</b> also counts games played: in points leagues it's total fantasy points; in category leagues it's value above a replacement-level starter (the last player who'd start in your league) times games played, so playing more only helps players worth starting.</p>
    <p><b>+/−.</b> Draft slot minus current rank. A #40 pick who's playing like the #5 player is +35; a #3 pick playing like #50 is −47.</p>
    <p><b>Past seasons.</b> A past draft is graded the same way, but on that season's full per-game stats, so the rank is where each player finished.</p>
    <p><b>Team drafts.</b> The average +/− across all of a team's picks. Total value adds up the per-game value of every pick who has played.</p>
    <p><b>Colors.</b> Each pick and keeper is shaded green (outplaying his slot) to red (underplaying it). Early in the season, a single game can move these a lot.</p>
    <p><b>Keepers</b> fill the top two rows. The one with the better Fantrax ADP is graded as if he were the #5 pick, the other as the #15 pick, against where he ranks among this year's picks.</p>
    <p><b>Board.</b> One row per round, one column per draft slot. Traded picks stay in their original slot, marked with the team that made the pick. "No pick" means the slot went unused.</p>`],
  board: ['Reading the draft board', `
    <p><b>Each cell</b> is one pick: the pick number, the player, and his <b>+/−</b>.</p>
    <p><b>How a pick is ranked.</b> Every drafted player is ranked against the others using this season's stats so far, or that season's full stats for a past draft. #1 is the best player of the whole draft class. Players who haven't played rank below everyone who has.</p>
    <p><b>Per game or season totals</b> (the toggle at the top of the tab). Per game ranks by value per game (fantasy points per game in points leagues). Season totals also counts games played, so missed games pull a player down: total fantasy points in points leagues, or value above a replacement-level starter times games in category leagues.</p>
    <p><b>+/−</b> is the pick number minus that rank. A #40 pick playing like the #5 player is <b>+35</b>; a #3 pick playing like #50 is <b>−47</b>. "DNP" means he hasn't played.</p>
    <p><b>Colors.</b> Green is outplaying the slot, red is underplaying it, getting stronger the bigger the gap. Hover a cell for the player's rank.</p>
    <p><b>Layout.</b> One row per round, one column per draft slot. A traded pick stays in its original slot, marked "by" the team that made it. "No pick" means the slot went unused.</p>
    <p><b>Keepers</b> fill the K rows at the top. The one with the better Fantrax ADP is graded as if he were the #5 pick, the other as the #15 pick.</p>`],
  data: ['Where the data comes from', `
    <ul><li><b>NBA.com:</b> active players, last season's stats and game-to-game spreads, and (when reachable) the schedule and box scores.</li>
    <li><b>ESPN:</b> the injury report, plus the schedule and box scores on the website's daily refresh, since NBA.com blocks the cloud servers that run it. Both give identical numbers.</li>
    <li><b>Fantrax:</b> your league's position eligibility, every team's roster and lineup, matchups, and who's available.</li></ul>
    <p>NBA stats refresh every morning (7 a.m. Eastern). Your league's Fantrax data (rosters, lineups, matchups, draft) loads fresh each time you open the site.</p>`],
};

const infoBtn = key => `<button type="button" class="info-btn" data-action="info" data-key="${key}" aria-label="How this is calculated" title="How this is calculated">i</button>`;

// ----- Any visitor's Fantrax league, fetched in the browser -----
// The daily data file carries NBA stats for everyone plus the site's default league. Fantrax's
// public league API allows requests from any site, so a visitor's own league can be loaded here.
const FX_API = 'https://www.fantrax.com/fxea/general/';
const NBA_POS_MAP = { G: ['PG', 'SG'], F: ['SF', 'PF'], C: ['C'], 'G-F': ['SG', 'SF'], 'F-G': ['SG', 'SF'], 'F-C': ['PF', 'C'], 'C-F': ['PF', 'C'] };
const FX_SLOT_MAP = { PG: 'PG', SG: 'SG', G: 'G', SF: 'SF', PF: 'PF', F: 'F', C: 'C', Flx: 'FLX', Util: 'FLX', UT: 'FLX' };

async function fxGet(path) {
  const r = await fetch(FX_API + path);
  if (!r.ok) throw new Error(`Fantrax answered ${r.status}`);
  return JSON.parse(await r.text()); // served as text/plain
}

// Second pass for names written differently ("Cameron Thomas" on Fantrax, "Cam Thomas" on NBA.com):
// same last name, first initial and team. How Fantrax abbreviates teams (GS for GSW, say) is learned
// from the players that matched exactly. A player two Fantrax entries point to is left unmatched.
const nameKey = n => { const w = normName(n).split(' '); return w.length > 1 ? `${w[0][0]} ${w.slice(1).join(' ')}` : w[0]; };
function matchNicknames(ids, names, toNba) {
  const votes = {};
  for (const [fid, id] of Object.entries(toNba)) {
    const t = ids[fid].team, nt = (nbaById.get(id) || {}).team;
    if (t && nt) (votes[t] = votes[t] || {})[nt] = (votes[t][nt] || 0) + 1;
  }
  const team = Object.fromEntries(Object.entries(votes).map(([t, v]) => [t, Object.entries(v).sort((a, b) => b[1] - a[1])[0][0]]));
  const taken = new Set(Object.values(toNba));
  const open = new Map();
  for (const raw of NBA.players) if (!taken.has(raw.id)) { const k = `${nameKey(raw.name)}|${raw.team}`; open.set(k, open.has(k) ? null : raw.id); }
  const found = {}, claims = {};
  for (const [fid, v] of Object.entries(ids)) {
    if (toNba[fid] || !team[v.team]) continue;
    const id = open.get(`${nameKey(names[fid])}|${team[v.team]}`);
    if (id) { found[fid] = id; claims[id] = (claims[id] || 0) + 1; }
  }
  for (const [fid, id] of Object.entries(found)) if (claims[id] === 1) toNba[fid] = id;
}

// "Last, First" -> "First Last"
const fxName = n => { const [last, first] = String(n).split(', '); return first ? `${first} ${last}` : String(n); };

// [{id, name, rank, w, l, t, gb}] from Fantrax's standings ("points" is "W-L-T")
function parseStandings(rows) {
  return (Array.isArray(rows) ? rows : []).filter(r => r.teamId).map(r => {
    const [w, l, t] = String(r.points || '').split('-').map(n => +n || 0);
    return { id: r.teamId, name: r.teamName || '', rank: r.rank, w, l, t, gb: +r.gamesBack || 0, pf: r.totalPointsFor != null ? +r.totalPointsFor : null };
  });
}

// Points leagues: Fantrax's points per stat, mapped onto stats we can project. Matched by short name
// first, then by Fantrax's category code; anything else is listed as not projected.
const FX_PTS_SHORT = { PTS: 'pts', REB: 'reb', OREB: 'oreb', DREB: 'dreb', AST: 'ast', ST: 'stl', STL: 'stl', BLK: 'blk', TO: 'to',
  '3PTM': 'tpm', '3PM': 'tpm', '3PTA': 'tpa', '3PA': 'tpa', FGM: 'fgm', FGA: 'fga', FTM: 'ftm', FTA: 'fta', '2D': 'dd', DD: 'dd',
  '3D': 'td', TD: 'td', PF: 'pf', MIN: 'min', '+/-': 'pm', GP: 'gp1' };
const FX_PTS_CODES = [
  [/PERCENT|PCT/, null], [/OFFENSIVE_REB/, 'oreb'], [/DEFENSIVE_REB/, 'dreb'], [/REBOUND/, 'reb'],
  [/THREE.*MISS/, 'tpmi'], [/THREE.*ATTEMPT/, 'tpa'], [/THREE/, 'tpm'],
  [/TWO_POINT.*ATTEMPT/, 'fg2a'], [/TWO_POINT/, 'fg2m'],
  [/FREE_THROW.*MISS/, 'ftmi'], [/FREE_THROW.*ATTEMPT/, 'fta'], [/FREE_THROW/, 'ftm'],
  [/FIELD_GOAL.*MISS/, 'fgmi'], [/FIELD_GOAL.*ATTEMPT/, 'fga'], [/FIELD_GOAL/, 'fgm'],
  [/QUADRUPLE/, null], [/TRIPLE_DOUBLE/, 'td'], [/DOUBLE_DOUBLE/, 'dd'],
  [/ASSIST/, 'ast'], [/STEAL/, 'stl'], [/BLOCK/, 'blk'], [/TURNOVER/, 'to'],
  [/TECHNICAL|FLAGRANT|EJECT/, null], [/FOUL/, 'pf'], [/PLUS_MINUS/, 'pm'], [/MINUTE/, 'min'],
  [/GAMES?_PLAYED/, 'gp1'], [/POINTS$/, 'pts'],
];
function fxStatKey(cat) {
  const short = String(cat.shortName || '').toUpperCase();
  if (FX_PTS_SHORT[short]) return FX_PTS_SHORT[short];
  const code = String(cat.code || '').toUpperCase();
  for (const [re, key] of FX_PTS_CODES) if (re.test(code)) return key;
  return null;
}

function fxPointsScoring(ss) {
  if (!ss || !/POINTS/.test(ss.type || '')) return {};
  const points = {}, other = [];
  let byPosition = false;
  for (const cat of ss.scoringCategorySettings || []) {
    for (const cfg of cat.configs || []) {
      const sc = cfg.scoringCategory || {};
      if (cfg.position && cfg.position.code !== 'DEFAULT') { byPosition = true; continue; }
      if (!+cfg.points) continue;
      const key = fxStatKey(sc);
      if (key) points[key] = (points[key] || 0) + +cfg.points;
      else other.push(sc.shortName || sc.name || sc.code);
    }
  }
  if (byPosition) other.push('position-specific points');
  return Object.keys(points).length ? { points, pointsOther: other } : {};
}

// Category leagues: which categories count, in display order, plus any the site can't project (like A/TO)
function fxCategories(ss) {
  if (!ss || /POINTS/.test(ss.type || '')) return {};
  const keys = new Set(), other = [];
  for (const cat of ss.scoringCategorySettings || []) {
    for (const cfg of cat.configs || []) {
      if (cfg.position && cfg.position.code !== 'DEFAULT') continue;
      const sc = cfg.scoringCategory || {};
      const short = String(sc.shortName || '').toUpperCase(), code = String(sc.code || '').toUpperCase();
      const is = (shorts, re) => shorts.includes(short) || re.test(code);
      // three-point first: its code also says FIELD_GOAL
      const key = is(['3PT%', '3P%', '3PM%'], /THREE.*(PERCENT|PCT)/) ? 'tpPct'
        : is(['FG%'], /FIELD_GOAL.*(PERCENT|PCT)/) ? 'fgPct'
        : is(['FT%'], /FREE_THROW.*(PERCENT|PCT)/) ? 'ftPct'
        : /PERCENT|PCT|%|RATIO|\//.test(`${short} ${code}`) ? null : fxStatKey(sc);
      if (key && (PCT_CATS[key] || STAT_LABEL[key])) keys.add(key);
      else other.push(sc.shortName || sc.name || sc.code);
    }
  }
  const cats = [...keys].sort((a, b) => (CAT_ORDER.indexOf(a) + 1 || 99) - (CAT_ORDER.indexOf(b) + 1 || 99));
  return cats.length ? { cats, catsOther: other } : {};
}
const fxScoring = ss => ({ ...fxPointsScoring(ss), ...fxCategories(ss) });

// Typical length in days of a league's lineup lock periods: about 1 for daily lineups, 7 for weekly
function rosterPeriodDays(periods) {
  const lens = periods.slice(0, 6).map(p => (fxTime(p.endDate) - fxTime(p.startDate)) / 864e5).filter(Number.isFinite).sort((a, b) => a - b);
  return lens.length ? Math.round(lens[Math.floor(lens.length / 2)] * 100) / 100 : null;
}

async function fetchFantraxLeague(id, opts = {}) {
  const q = encodeURIComponent(id);
  const [ids, info, rosters, draft, adpList, standings] = await Promise.all([
    fxGet('getPlayerIds?sport=NBA'), fxGet(`getLeagueInfo?leagueId=${q}`), fxGet(`getTeamRosters?leagueId=${q}`),
    fxGet(`getDraftResults?leagueId=${q}`).catch(() => ({})), fxGet('getAdp?sport=NBA').catch(() => []),
    fxGet(`getStandings?leagueId=${q}`).catch(() => []),
  ]);
  if (info.error || !info.teamInfo) throw new Error((info.error && info.error.message) || 'League not found');
  const opening = opts.opening ? await fxGet(`getTeamRosters?leagueId=${q}&period=1`).catch(() => null) : null;

  // match Fantrax players to NBA.com players by name (team breaks ties)
  const byName = new Map();
  for (const raw of NBA.players) {
    const n = normName(raw.name);
    if (!byName.has(n)) byName.set(n, []);
    byName.get(n).push(raw);
  }
  const toNba = {}, names = {};
  for (const [fid, v] of Object.entries(ids)) {
    names[fid] = fxName(v.name || '');
    const hits = byName.get(normName(names[fid])) || [];
    const hit = hits.length > 1 ? (hits.find(h => h.team === v.team) || hits[0]) : hits[0];
    if (hit) toNba[fid] = hit.id;
  }
  matchNicknames(ids, names, toNba);
  const adp = Object.fromEntries((Array.isArray(adpList) ? adpList : []).filter(a => a.id).map(a => [a.id, a.ADP]));
  const fxPlayers = {};
  for (const [fid, pi] of Object.entries(info.playerInfo || {})) {
    const nba = toNba[fid];
    if (!nba) continue;
    const elig = new Set((pi.eligiblePos || '').split(','));
    // leagues with broad positions list G / F instead of PG,SG / SF,PF
    if (elig.has('G') && !elig.has('PG') && !elig.has('SG')) { elig.add('PG'); elig.add('SG'); }
    if (elig.has('F') && !elig.has('SF') && !elig.has('PF')) { elig.add('SF'); elig.add('PF'); }
    fxPlayers[nba] = { id: fid, st: pi.status || '', pos: POSITIONS.filter(x => elig.has(x)), adp: adp[fid] };
  }
  const league = {
    id, name: info.leagueName || '', scoring: (info.scoringSystem || {}).type || '',
    historyId: info.leagueHistoryId || null, year: info.seasonYear || null,
    ...fxScoring(info.scoringSystem),
    teams: Object.entries(info.teamInfo).map(([k, v]) => ({ id: k, name: v.name || '' })),
    periods: (info.scoringPeriods || []).map(p => ({ n: p.number, start: String(p.startDate).slice(0, 10), end: String(p.endDate).slice(0, 10), lock: String(p.startDate), endAt: String(p.endDate) })),
    lockDays: rosterPeriodDays(info.rosterPeriods || []),
    playoffPeriod: info.playoffs && info.playoffs.used ? info.playoffs.firstPlayoffPeriod : null,
    matchups: Object.fromEntries((info.matchups || []).map(m => [String(m.period),
      (m.matchupList || []).filter(x => x.away && x.away.id && x.home && x.home.id).map(x => [x.away.id, x.home.id])])),
    rosterPeriod: rosters.period,
    rosterPeriods: (info.rosterPeriods || []).map(p => [p.number, String(p.startDate), String(p.endDate)]),
    rosters: Object.fromEntries(Object.entries(rosters.rosters || {}).map(([tid, r]) => [tid,
      (r.rosterItems || []).map(it => ({ fid: it.id, nba: toNba[it.id] || null, name: names[it.id] || '', slot: it.position || '', st: it.status || '' }))])),
    openingRosters: opening ? Object.fromEntries(Object.entries(opening.rosters || {}).map(([tid, r]) => [tid,
      (r.rosterItems || []).map(it => ({ nba: toNba[it.id] || null, name: names[it.id] || '' }))])) : null,
    rosterInfo: info.rosterInfo || null,
    draft: null,
    draftAt: draft.draftDate || null,
    standings: parseStandings(standings),
  };
  const picks = (draft.draftPicks || []).filter(d => d.playerId);
  if (picks.length) {
    const drafted = new Set(picks.map(d => toNba[d.playerId]).filter(Boolean));
    league.draft = {
      date: String(draft.draftDate || '').slice(0, 10), type: draft.draftType || '', state: draft.draftState || '',
      perRound: Math.max(...draft.draftPicks.map(d => d.pickInRound || 0)),
      picks: picks.map(d => [d.round, d.pick, d.teamId, toNba[d.playerId] || null, names[d.playerId] || '']),
      // keepers: rostered players who weren't drafted (later pickups show up here too)
      keepers: Object.fromEntries(Object.entries(league.rosters).map(([tid, items]) => [tid, items.map(it => it.nba).filter(n => n && !drafted.has(n))])),
    };
  }
  return { league, fxPlayers, idMap: { toNba, names } };
}

// Swap the league the whole app works from; NBA stats stay as they are
function applyFantraxLeague({ league, fxPlayers }) {
  for (const raw of NBA.players) {
    const fx = fxPlayers[raw.id];
    raw.pos = fx && fx.pos.length ? fx.pos : raw.basePos;
    if (fx) raw.fx = { id: fx.id, st: fx.st, ...(fx.adp ? { adp: fx.adp } : {}) };
    else delete raw.fx;
  }
  NBA.league = league;
  nbaCache = null;
}

// Roster slots from the league's settings (8 starters, bench and IR sizes)
// Our slot type for a Fantrax slot name; combo slots ("G/F", "F-C") are added on the fly
function fxSlot(name) {
  if (FX_SLOT_MAP[name]) return FX_SLOT_MAP[name];
  const parts = String(name).toUpperCase().split(/[\/-]/).filter(Boolean);
  const elig = [...new Set(parts.flatMap(x => ELIG[x] || []))];
  if (!elig.length) return 'FLX';
  if (parts.length === 1) return parts[0];
  const type = parts.join('/');
  if (!ELIG[type]) { ELIG[type] = POSITIONS.filter(x => elig.includes(x)); SLOT_TYPES.splice(SLOT_TYPES.indexOf('FLX'), 0, type); }
  return type;
}

function slotsFromLeague(league) {
  const ri = league && league.rosterInfo;
  if (!ri || !ri.positionConstraints) return null;
  const slots = [];
  const types = Object.entries(ri.positionConstraints).map(([k, v]) => [fxSlot(k), v.maxActive || 0]);
  for (const type of SLOT_TYPES) {
    for (const [t, n] of types) if (t === type) for (let i = 0; i < n; i++) slots.push(type);
  }
  if (!slots.length || (ri.maxTotalActivePlayers && slots.length !== ri.maxTotalActivePlayers)) return null;
  let bench = ri.maxTotalReservePlayers ?? null;
  let ir = ri.maxTotalPlayers && bench != null ? Math.max(0, ri.maxTotalPlayers - slots.length - bench) : null;
  if (bench == null && ri.maxTotalPlayers) {
    // no reserve count: the rest of the roster is bench, and IR spots sit outside the limit
    bench = Math.max(0, ri.maxTotalPlayers - slots.length);
    ir = Math.max(1, ...Object.values(league.rosters || {}).map(r => r.filter(it => it.st === 'INJURED_RESERVE').length));
  }
  return { slots, bench, ir };
}

// ----- Fantrax league (positions, rosters, matchups) -----
const fxLeague = () => (NBA && NBA.league) || null;
const FX_STATUS = { T: 'Taken', W: 'Waivers', WW: 'Waivers', FA: 'Free agent' };
const fxAvailable = raw => !!(raw && raw.fx && raw.fx.st !== 'T');

function fxPeriodFor(start) {
  const L = fxLeague();
  if (!L) return null;
  const mid = addDays(start, 3);
  return L.periods.find(p => p.start <= mid && mid <= p.end) || null;
}

// Every team in the league
const fxPickable = () => (fxLeague() ? fxLeague().teams : []);

function fxTeamName(id) {
  const L = fxLeague();
  const t = L && L.teams.find(x => x.id === id);
  return t ? t.name : '';
}

function fxOpponentFor(start, teamId = state.fxTeam) {
  const L = fxLeague(), period = fxPeriodFor(start);
  if (!L || !period || !teamId) return null;
  const pair = (L.matchups[String(period.n)] || []).find(m => m.includes(teamId));
  if (!pair) return null;
  const id = pair[0] === teamId ? pair[1] : pair[0];
  return { id, name: fxTeamName(id), period: period.n };
}

// A Fantrax roster as players, with each one's lineup slot and status
function fxRoster(teamId) {
  const L = fxLeague();
  return ((L && L.rosters[teamId]) || [])
    .map(it => ({ raw: it.nba ? nbaById.get(it.nba) : null, name: it.name, slot: it.slot === 'Flx' ? 'FLX' : it.slot, st: it.st }))
    .filter(x => x.raw);
}

// A league team as players, with Fantrax starters in their own slots and IR players on IR
function fxTeamSide(teamId) {
  const roster = fxRoster(teamId);
  const players = roster.map(x => playerFromRaw(x.raw));
  const lineup = Array(state.slots.length).fill(null);
  const leftover = [];
  roster.forEach((x, i) => {
    if (x.st !== 'ACTIVE') return;
    const slot = fxSlot(x.slot); // e.g. Fantrax "Flx" is our FLX
    const idx = state.slots.findIndex((s, j) => s === slot && !lineup[j]);
    if (idx !== -1) lineup[idx] = players[i].id; else leftover.push(players[i]);
  });
  for (const p of leftover) {
    const j = state.slots.findIndex((s, k) => !lineup[k] && canPlay(p, s));
    if (j !== -1) lineup[j] = p.id;
  }
  return {
    name: fxTeamName(teamId), players, lineup,
    il: players.filter((p, i) => roster[i].st === 'INJURED_RESERVE').map(p => p.id),
    starters: players.filter((p, i) => roster[i].st === 'ACTIVE').map(p => p.id),
  };
}

// Compare against any team in the league: their roster and current Fantrax lineup
// For the site's own league, keep what only the daily file knows: keepers frozen at draft time
// (live rosters can't tell them from pickups) and the past seasons listed in league.json
function withSiteExtras(res) {
  const site = NBA.siteLeague;
  if (site && site.id === res.league.id) {
    if (site.pastSeasons) res.league.pastSeasons = site.pastSeasons;
    if (res.league.draft && site.draft && site.draft.date === res.league.draft.date && site.draft.keepers) res.league.draft.keepers = site.draft.keepers;
  }
  return res;
}

// Roster slots, bench and IR from the league's settings (they're the league's, not yours to edit)
function syncLeagueRules() {
  if (fxLeague()) state.lineupMode = leagueLineupMode(fxLeague());
  const cfg = slotsFromLeague(fxLeague());
  if (!cfg) return;
  state.slots = cfg.slots;
  if (cfg.bench != null) state.benchSize = cfg.bench;
  if (cfg.ir != null) state.ilSize = cfg.ir;
}

// A reloaded league is kept on this device and used until the daily data file is newer
const FX_CACHE_KEY = 'courtside-fantrax-v1';
function cachedLeague(id) {
  try {
    const c = JSON.parse(localStorage.getItem(FX_CACHE_KEY) || 'null');
    return c && c.id === id && c.at > Date.parse(NBA.updated || 0) ? c.res : null;
  } catch (e) { return null; }
}

// Pull the league fresh from Fantrax: matchups, rosters and lineups change during the week
async function refreshLeague() {
  const id = state.fxLeagueId || (NBA.siteLeague && NBA.siteLeague.id);
  if (!id) return false;
  const same = NBA.league && NBA.league.id === id;
  const before = same && state.fxTeam ? fxOpponentFor(weekStart()) : null;
  const res = await fetchFantraxLeague(id);
  try { localStorage.setItem(FX_CACHE_KEY, JSON.stringify({ id, at: Date.now(), res })); } catch (e) { /* storage full or blocked */ }
  applyFantraxLeague(withSiteExtras(res));
  if (!state.fxTeam || !NBA.league.teams.some(t => t.id === state.fxTeam)) return true;
  // follow your real opponent (and their latest roster) unless you'd picked someone else to scout
  const after = fxOpponentFor(weekStart());
  const cur = state.opp.fxId;
  if (after && (!cur || cur === after.id || (before && cur === before.id))) {
    const o = fxTeamSide(after.id);
    state.opp = { name: o.name, week: weekStart(), fxId: after.id, players: o.players, starters: o.starters };
  }
  return true;
}

function loadFxTeam(teamId) {
  const side = fxTeamSide(teamId);
  const name = side.name;
  state.opp = { name, week: weekStart(), fxId: teamId, players: side.players, starters: side.starters };
  const opp = fxOpponentFor(weekStart());
  commit(opp && opp.id === teamId ? `Loaded ${name}, your week ${opp.period} opponent` : `Scouting ${name}`);
}

// Viewing someone else's team: draw the week page from a throwaway copy of their matchup,
// so nothing about your own saved roster or opponent changes.
ui.viewA = null; // team whose side is on the left (null = yours)
ui.viewB = null; // who they're compared against (null = their real opponent)
const viewingOther = () => !!(ui.viewA && ui.viewA !== state.fxTeam && fxLeague());

function withViewedTeam(fn) {
  if (!viewingOther()) return fn();
  const a = fxTeamSide(ui.viewA);
  const real = fxOpponentFor(weekStart(), ui.viewA);
  const bId = ui.viewB || (real && real.id);
  const b = bId ? fxTeamSide(bId) : null;
  const saved = state;
  state = {
    ...saved, teamName: a.name, players: a.players, lineup: a.lineup, il: a.il, sample: false,
    opp: b ? { name: b.name, week: weekStart(), fxId: bId, players: b.players, starters: b.starters } : { name: '', week: null, fxId: null, players: [], starters: null },
  };
  ui.viewing = true;
  try { return fn(); } finally { state = saved; ui.viewing = false; }
}

function fxStrip(ctx) {
  const L = fxLeague();
  if (!L) return '';
  if (!state.fxTeam) return `<div class="fx-strip"><span>Pick your team at the top to load your roster and matchup.</span></div>`;
  const leftId = ui.viewing ? ui.viewA : state.fxTeam;
  const opp = fxOpponentFor(ctx.start, leftId); // the left team's real opponent this week
  const stale = L.rosterPeriod && opp && opp.period !== L.rosterPeriod;
  const teams = fxPickable();
  const cur = state.opp.fxId;
  const hypo = cur && (!opp || cur !== opp.id);
  const back = ui.viewing ? 'fx-view-actual' : 'fx-load-opp';
  return `<div class="fx-strip">
    <span class="fx-vs">
      <b>${esc(fxTeamName(leftId))}</b>
      <span class="muted">vs</span>
      <span class="fx-cycle">
        <button class="icon-btn xs" data-action="fx-cycle" data-step="-1" aria-label="Previous team" title="Previous team">‹</button>
        <select data-change="fx-opp" aria-label="Compare against">${cur ? '' : '<option value="">Pick a team</option>'}${teams.filter(t => t.id !== leftId).map(t => `<option value="${esc(t.id)}" ${t.id === cur ? 'selected' : ''}>${esc(t.name)}${opp && t.id === opp.id ? ' (this week)' : ''}</option>`).join('')}</select>
        <button class="icon-btn xs" data-action="fx-cycle" data-step="1" aria-label="Next team" title="Next team">›</button>
      </span>
      ${hypo ? `<span class="badge warn">Hypothetical</span>${opp ? ` <button class="link-btn small" data-action="${back}">Back to ${esc(opp.name)}</button>` : ''}` : opp && cur ? `<span class="badge accent">Week ${opp.period} matchup</span>` : ''}
      ${stale ? `<span class="muted small">rosters as of week ${L.rosterPeriod}</span>` : ''}
    </span>${ctx.locked ? lockNote(ctx) : ''}</div>`;
}

// Weekly lineups locked: when, and a jump to next week, at the right of the matchup bar
function lockNote(ctx) {
  const t = lockTime(ctx.start);
  const when = `${t.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} at ${t.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  return `<span class="actions fx-lock"><span class="muted small" title="Starters locked ${esc(when)}, so this shows the lineups as set. Suggestions pick up again for next week.">Lineups locked</span>${ui.weekShift < 4 ? '<button class="btn sm" data-action="week-shift" data-step="1">Plan next week →</button>' : ''}</span>`;
}

function validateLineup() {
  const ids = new Set(state.players.map(p => p.id));
  state.il = state.il.filter(id => ids.has(id));
  const lu = Array(state.slots.length).fill(null);
  state.lineup.forEach((id, i) => {
    if (i >= lu.length || !id || !ids.has(id) || state.il.includes(id)) return;
    if (lu.includes(id)) return;
    if (canPlay(byId(id), state.slots[i])) lu[i] = id;
  });
  state.lineup = lu;
}

function rosterLimit() { return state.slots.length + state.benchSize; }
function activeCount() { return state.players.length - state.il.length; }

/* =========================================================
   Alerts
   ========================================================= */
function buildAlerts() {
  const a = [];
  state.lineup.forEach((id, i) => {
    const p = byId(id);
    if (!p) a.push({ lvl: 'warn', msg: `Empty <b>${state.slots[i]}</b> slot in your starting lineup.` });
    else if (p.status === 'Out') a.push({ lvl: 'bad', msg: `<b>${esc(p.name)}</b> is Out but starting at ${state.slots[i]}.` });
    else if (p.status === 'DTD') a.push({ lvl: 'warn', msg: `<b>${esc(p.name)}</b> is day-to-day — confirm before lock.` });
  });
  for (const p of ilPlayers()) {
    if (p.status === 'Healthy') a.push({ lvl: 'warn', msg: `<b>${esc(p.name)}</b> is healthy but sitting on IL.` });
  }
  if (state.il.length > state.ilSize) a.push({ lvl: 'bad', msg: `IL has ${state.il.length} players but only ${state.ilSize} spots.` });
  const over = activeCount() - rosterLimit();
  if (over > 0) a.push({ lvl: 'bad', msg: `Roster is ${over} over the ${rosterLimit()}-player limit. Drop or IL someone.` });
  // lineup advice lives on Matchups, where it plays to the actual matchup
  if (NBA && state.opp.players.length && state.lineupMode === 'weekly') {
    const ctx = weekContext();
    const better = ctx.bestIds && [...ctx.bestIds].some(id => !ctx.setIds.has(id));
    if (better) a.push({ lvl: 'warn', msg: `A better lineup for this week takes you from <b>${pctTxt(ctx.oSet.win)}</b> to <b>${pctTxt(ctx.oBest.win)}</b> to win.`, action: 'go-week', label: 'See it' });
  }
  if (!a.length) a.push({ lvl: 'good', msg: 'Lineup is set and everyone starting is healthy.' });
  return a;
}

/* =========================================================
   Rendering
   ========================================================= */
function leagueMenu() {
  const el = $('#leagueMenu');
  if (!el) return;
  const L = fxLeague();
  if (!L || needsLanding()) { el.innerHTML = ''; return; }
  const cur = currentLeagueId();
  const saved = state.savedLeagues || [];
  const site = NBA && NBA.siteLeague;
  const wasOpen = el.querySelector('details') && el.querySelector('details').open;
  el.innerHTML = `<details class="lm"${wasOpen ? ' open' : ''}>
    <summary aria-label="League menu"><span class="lm-name">${esc(L.name)}</span><span class="lm-caret" aria-hidden="true">▾</span></summary>
    <div class="lm-pop">
      <div class="lm-sec">Leagues</div>
      ${saved.map(l => `<div class="lm-row"><button type="button" class="lm-item${l.id === cur ? ' on' : ''}" data-action="league-switch" data-id="${esc(l.id)}">${l.id === cur ? '✓ ' : ''}${esc(l.name)}</button>${l.id !== cur ? `<button type="button" class="icon-btn xs" data-action="league-remove" data-id="${esc(l.id)}" aria-label="Remove ${esc(l.name)}" title="Remove">✕</button>` : ''}</div>`).join('')}
      ${state.demo ? `<div class="lm-row"><span class="lm-item on">✓ ${esc(L.name)} <span class="muted">(demo)</span></span></div>` : ''}
      <button type="button" class="lm-item" data-action="league-add">+ Add a league</button>
      ${site && !saved.some(l => l.id === site.id) && !state.demo ? '<button type="button" class="lm-item" data-action="land-demo">Explore the demo league</button>' : ''}
      <div class="lm-sec">Stats used ${infoBtn('projection')}</div>
      ${Object.entries(BASIS_LABELS).map(([k, l]) => `<button type="button" class="lm-item${state.basis === k ? ' on' : ''}" data-action="set-basis" data-basis="${k}">${state.basis === k ? '✓ ' : ''}${l}</button>`).join('')}
      <div class="lm-sec">This device</div>
      <button type="button" class="lm-item" data-action="export">Backup &amp; restore</button>
      <button type="button" class="lm-item danger" data-action="start-fresh">Reset and start over</button>
      <div class="lm-sec">Version ${BUILD.startsWith('__') ? 'local' : esc(BUILD)}</div>
    </div>
  </details>`;
}

// ----- Past seasons -----
// Each Fantrax season is its own league. Past seasons are added by league ID and kept per league
// (keyed by Fantrax's league history id); a past season gets its own tabs.
const TABS_NOW = [['dashboard', 'Dashboard'], ['week', 'Matchups'], ['roster', 'Roster'], ['players', 'Free Agents'], ['draft', 'Draft'], ['standings', 'Standings'], ['trade', 'Trades']];
const TABS_PAST = [['standings', 'Standings'], ['awards', 'Awards'], ['draft', 'Draft'], ['rosters', 'Rosters']];
const tabList = () => (ui.season ? TABS_PAST : TABS_NOW);
const seasonLabel = y => `${y}-${String(y + 1).slice(2)}`;
const pastCache = {};
let seasonCtx = null; // set while a past season renders: { basis, label }
const pastSeason = () => (ui.season ? pastCache[ui.season] || null : null);

function seasonsFor(L) {
  const saved = state.pastSeasons || {};
  const all = [...(L.pastSeasons || []), ...(saved[L.historyId] || []), ...(saved[L.id] || [])];
  const seen = new Set();
  return all.filter(x => x.id !== L.id && !seen.has(x.id) && seen.add(x.id)).sort((a, b) => (b.year || 0) - (a.year || 0));
}

async function loadSeason(id) {
  if (pastCache[id]) return pastCache[id];
  const { league, idMap } = await fetchFantraxLeague(id, { opening: true });
  // end-of-season rosters can't tell keepers from waiver pickups, so past drafts show picks only
  if (league.draft) league.draft.keepers = {};
  // that season's NBA stats, if saved, grade its draft, awards and rosters
  const season = league.year ? seasonOf(league.year) : null;
  const A = season ? await loadArchive(season) : null;
  const findOld = A ? matchInactive(league, A) : () => null;
  league.fidNba = fid => idMap.toNba[fid] || (idMap.names[fid] ? findOld(idMap.names[fid]) : null);
  league.weeks = await loadRosterWeeks(league).catch(() => null);
  league.arrivals = league.weeks ? arrivalsOf(league.weeks) : null;
  league.season = season; // its game log loads when Awards opens
  const prevStart = NBA && NBA.prevSeason ? +String(NBA.prevSeason).slice(0, 4) : null;
  const basis = A ? 'arch:' + season : league.year && league.year === prevStart ? 'prev' : null;
  return (pastCache[id] = { league, basis, label: league.year ? seasonLabel(league.year) : 'Past season' });
}

// ----- A past season week by week: who each team had, who started, and how they got them -----
// Fantrax shares every lineup period's rosters but no transaction log. A player's stint on a team,
// walked back to its first week: there from week 1 = drafted or kept; the week before on another
// team's roster = a trade; on nobody's roster = a free-agent or waiver pickup. Finished seasons never
// change, so the weekly rosters are fetched once and kept on this device.
const ROSTER_WEEKS_KEY = 'courtside-roster-weeks-v1';
try { localStorage.removeItem('courtside-roster-history-v1'); } catch (e) { /* older format, no statuses */ }
async function loadRosterWeeks(L) {
  let all = {};
  try { all = JSON.parse(localStorage.getItem(ROSTER_WEEKS_KEY)) || {}; } catch (e) { /* none saved */ }
  const have = all[L.id] || {};
  const today = todayIso();
  const periods = rosterPeriodsOf(L).filter(p => p.start.slice(0, 10) <= today);
  const want = periods.map(p => p.n).filter(n => !have[n]);
  let next = 0;
  const worker = async () => {
    while (next < want.length) {
      const n = want[next++];
      const d = await fxGet(`getTeamRosters?leagueId=${encodeURIComponent(L.id)}&period=${n}`);
      // [Fantrax id, 1 if in the starting lineup]
      have[n] = Object.fromEntries(Object.entries(d.rosters || {}).map(([tid, r]) => [tid, (r.rosterItems || []).map(it => [it.id, it.status === 'ACTIVE' ? 1 : 0])]));
    }
  };
  try { await Promise.all(Array.from({ length: Math.min(6, want.length) }, worker)); } finally {
    all[L.id] = have;
    try { localStorage.setItem(ROSTER_WEEKS_KEY, JSON.stringify(all)); } catch (e) { /* storage full or blocked */ }
  }
  const weeks = periods.filter(p => have[p.n]).map(p => {
    const owner = new Map();
    for (const [tid, items] of Object.entries(have[p.n])) for (const [f, on] of items) owner.set(f, { tid, on: !!on });
    return { ...p, owner };
  });
  return weeks.length > 1 ? weeks : null;
}

// How a player came to be on a team in week k: 'start', 'trade' or 'pickup'
function arrivalAt(weeks, k, f) {
  const tid = weeks[k].owner.get(f).tid;
  let j = k;
  while (j > 0 && (weeks[j - 1].owner.get(f) || {}).tid === tid) j--;
  return j === 0 ? 'start' : weeks[j - 1].owner.has(f) ? 'trade' : 'pickup';
}
// for the final rosters: team id -> Fantrax id -> how he got there
function arrivalsOf(weeks) {
  const out = {}, k = weeks.length - 1;
  for (const [f, o] of weeks[k].owner) (out[o.tid] = out[o.tid] || {})[f] = arrivalAt(weeks, k, f);
  return out;
}

// A past season's game lines (data/seasons/<season>-games.json), kept as the plain number arrays they
// arrive in ([day, team, ...stats], oldest first). A team's schedule is every day any of its players played.
const gameLogs = {};
async function loadGameLog(season) {
  if (season in gameLogs) return gameLogs[season];
  try {
    const r = await fetch(`data/seasons/${season}-games.json`);
    if (!r.ok) throw new Error(r.status);
    const d = await r.json();
    const players = new Map(Object.entries(d.players).map(([pid, rows]) => [+pid, rows]));
    const days = new Map();
    for (const rows of players.values()) {
      for (const [day, t] of rows) {
        if (!days.has(d.teams[t])) days.set(d.teams[t], new Set());
        days.get(d.teams[t]).add(day);
      }
    }
    gameLogs[season] = { start: d.start, teams: d.teams, keys: d.keys, players, days };
  } catch (e) { gameLogs[season] = null; }
  return gameLogs[season];
}
// one game row as a stat line (for valuing it)
function gameLine(G, row) {
  const line = Object.fromEntries(G.keys.map((k, i) => [k, row[i + 2]]));
  const tens = ['pts', 'reb', 'ast', 'stl', 'blk'].filter(k => line[k] >= 10).length;
  return { ...line, dd: +(tens >= 2), td: +(tens >= 3), gp1: 1 };
}
// the season's day numbers a lineup period covers
function periodDays(G, w) {
  const d0 = new Date(G.start + 'T12:00:00');
  const out = new Set();
  for (let d = w.start.slice(0, 10); d <= w.end.slice(0, 10); d = addDays(d, 1)) {
    if (periodHas(w, d)) out.add(Math.round((new Date(d + 'T12:00:00') - d0) / 864e5));
  }
  return out;
}
// the team a player was on that day: his latest game on or before it, else his first game
function teamOn(G, rows, day) {
  if (!rows.length) return null;
  let r = rows[0];
  for (const x of rows) { if (x[0] > day) break; r = x; }
  return G.teams[r[1]];
}

// What each team's pickups did for it: every game a picked-up player played in a week he was in that
// team's starting lineup, valued like a single game on the Dashboard. Team id -> [{ nba, name, v, weeks, games }]
function pickupImpact(L, G) {
  if (!L.weeks || !G) return null;
  const out = {};
  L.weeks.forEach((w, k) => {
    const wd = periodDays(G, w);
    for (const [f, o] of w.owner) {
      if (!o.on || arrivalAt(L.weeks, k, f) !== 'pickup') continue;
      const nba = L.fidNba(f);
      if (!nba) continue;
      const games = (G.players.get(nba) || []).filter(r => wd.has(r[0]));
      const team = out[o.tid] = out[o.tid] || new Map();
      const P = team.get(f) || { nba, name: (nbaById.get(nba) || {}).name || '', v: 0, weeks: 0, games: 0 };
      P.v += sum(games.map(r => lineValue(gameLine(G, r))));
      P.weeks++;
      P.games += games.length;
      team.set(f, P);
    }
  });
  return Object.fromEntries(Object.entries(out).map(([tid, m]) => [tid, [...m.values()]]));
}

// How old each team's starters were: every week, each starter's age that week, averaged over all of a
// team's starter-weeks (so a player who started 20 weeks counts 20 times as much as one who started one).
// Players without a birth date on record are left out. Team id -> { age, n }
function startersAge(L) {
  if (!L.weeks) return null;
  const out = {};
  for (const w of L.weeks) {
    const day = new Date(w.start.slice(0, 10) + 'T12:00:00');
    for (const [f, o] of w.owner) {
      if (!o.on) continue;
      const raw = nbaById.get(L.fidNba(f));
      if (!raw || !raw.born) continue;
      const T = out[o.tid] = out[o.tid] || { total: 0, n: 0, players: new Map() };
      const age = (day - new Date(raw.born + 'T12:00:00')) / (365.25 * 864e5);
      T.total += age;
      T.n++;
      const P = T.players.get(raw.id) || { name: raw.name, age, weeks: 0 };
      P.age = Math.max(P.age, age);
      P.weeks++;
      T.players.set(raw.id, P);
    }
  }
  // the oldest player a team started regularly (3+ weeks)
  const oldest = T => [...T.players.values()].filter(p => p.weeks >= 3).sort((a, b) => b.age - a.age)[0] || null;
  return Object.fromEntries(Object.entries(out).map(([tid, T]) => [tid, { age: T.total / T.n, n: T.n, oldest: oldest(T) }]));
}

// What each team's draft produced: every game a drafted player played from the draft until he was first
// dropped to free agency, starting or on the bench, and through any trades (the drafting team keeps the
// credit). Category leagues value each game above a replacement-level starter (the per-game value of the
// last player who'd start in this league), so every game by a player worth starting adds; points leagues
// use fantasy points. Team id -> [{ nba, name, v, games }]
function draftImpact(L, G, picks) {
  if (!L.weeks || !G || !picks.length) return null;
  const fidOf = new Map();
  for (const w of L.weeks) for (const f of w.owner.keys()) { const nba = L.fidNba(f); if (nba && !fidOf.has(nba)) fidOf.set(nba, f); }
  let repl = 0;
  if (!isPoints()) {
    const A = archives[L.season];
    const vals = A ? [...A.players.keys()].map(pid => archivedStats({ id: pid }, L.season)).filter(x => x && x.gp >= 10).map(x => value(x)).sort((a, b) => b - a) : [];
    repl = vals.length ? vals[Math.min(vals.length, fxPickable().length * state.slots.length) - 1] : 0;
  }
  const weekDays = L.weeks.map(w => periodDays(G, w));
  const out = {};
  for (const p of picks) {
    const f = p.nbaId && fidOf.get(p.nbaId);
    const P = { nba: p.nbaId, name: p.name, v: 0, games: 0 };
    if (f) {
      const rows = G.players.get(p.nbaId) || [];
      for (let k = 0; k < L.weeks.length && L.weeks[k].owner.has(f); k++) {
        for (const r of rows) if (weekDays[k].has(r[0])) { P.v += lineValue(gameLine(G, r)) - repl; P.games++; }
      }
    }
    (out[p.teamId] = out[p.teamId] || []).push(P);
  }
  return out;
}

// Games lost to players sitting while in the starting lineup: each week, every game a starter's NBA team
// played without him. Bench and IR don't count, and neither do games before or after he was on the team.
// A player with no games all season is placed on his current team. Team id -> [{ nba, name, games }]
function startersMissed(L, G) {
  if (!L.weeks || !G) return null;
  const out = {};
  for (const w of L.weeks) {
    const wd = periodDays(G, w);
    for (const [f, o] of w.owner) {
      if (!o.on) continue;
      const nba = L.fidNba(f);
      if (!nba) continue;
      const rows = G.players.get(nba) || [];
      const played = new Set(rows.map(r => r[0]));
      const now = (nbaById.get(nba) || {}).team;
      let n = 0;
      for (const day of wd) {
        if (played.has(day)) continue;
        const team = teamOn(G, rows, day) || now;
        if (team && G.days.has(team) && G.days.get(team).has(day)) n++;
      }
      if (!n) continue;
      const team = out[o.tid] = out[o.tid] || new Map();
      const P = team.get(nba) || { nba, name: (nbaById.get(nba) || {}).name || '', games: 0 };
      P.games += n;
      team.set(nba, P);
    }
  }
  return Object.fromEntries(Object.entries(out).map(([tid, m]) => [tid, [...m.values()]]));
}

// ----- Archived seasons: data/seasons/<season>.json, saved once by scripts/archive_season.py -----
const archives = {}; // season -> { keys, players: Map(id -> { n, s }) }, or null when not saved
const seasonOf = year => `${year}-${String(year + 1).slice(2)}`;
async function loadArchive(season) {
  if (season in archives) return archives[season];
  try {
    const r = await fetch(`data/seasons/${season}.json`);
    if (!r.ok) throw new Error(r.status);
    const d = await r.json();
    archives[season] = { keys: d.statKeys, players: new Map(Object.entries(d.players).map(([pid, p]) => [+pid, p])) };
  } catch (e) { archives[season] = null; }
  return archives[season];
}
function archivedStats(raw, season) {
  const A = archives[season], p = A && A.players.get(raw.id);
  if (!p) return null;
  const s = Object.fromEntries(A.keys.map((k, i) => [k, +p.s[i] || 0]));
  return { ...s, fgPct: s.fga ? s.fgm / s.fga : 0, ftPct: s.fta ? s.ftm / s.fta : 0 };
}
// Players no longer on an NBA roster aren't in today's data, so a past league's picks and rosters
// left unmatched are matched by name against that season's archive (positions unknown: any slot)
function matchInactive(league, A) {
  const byName = new Map(), byKey = new Map();
  for (const [pid, p] of A.players) {
    if (nbaById.has(pid) || !p.n) continue;
    byName.set(normName(p.n), pid);
    const k = nameKey(p.n);
    byKey.set(k, byKey.has(k) ? null : pid); // "Cameron" vs "Cam": initial and last name, if only one fits
  }
  const find = name => {
    const pid = byName.get(normName(name)) || byKey.get(nameKey(name));
    if (pid && !nbaById.has(pid)) nbaById.set(pid, { id: pid, name: A.players.get(pid).n, team: '', pos: [...POSITIONS], inactive: true });
    return pid || null;
  };
  for (const pick of (league.draft && league.draft.picks) || []) if (!pick[3] && pick[4]) pick[3] = find(pick[4]);
  for (const r of [...Object.values(league.rosters || {}), ...Object.values(league.openingRosters || {})]) for (const x of r) if (!x.nba && x.name) x.nba = find(x.name);
  return find;
}

async function switchSeason(id) {
  ui.addingSeason = false; ui.pastTeam = null; ui.viewA = null; ui.viewB = null;
  if (id) {
    try {
      await loadSeason(id);
    } catch (e) {
      toast(`Couldn't load that season (${e.message})`);
      render();
      return;
    }
  }
  ui.season = id || null;
  const tab = ui.tab === 'rosters' && !id ? 'roster' : ui.tab;
  const want = '#' + (tabList().some(([k]) => k === tab) ? tab : id ? 'standings' : 'dashboard');
  if (location.hash !== want) location.hash = want; else route();
}

// Render a past season's tab with the app pointed at that season's league
function withSeason(fn) {
  const P = pastSeason();
  if (!P) return fn();
  const myName = fxTeamName(state.fxTeam);
  const me = P.league.teams.find(t => t.name === myName);
  const savedLeague = NBA.league, saved = state;
  NBA.league = P.league;
  state = { ...saved, fxTeam: me ? me.id : null };
  seasonCtx = { basis: P.basis, label: P.label };
  try { return fn(); } finally { NBA.league = savedLeague; state = saved; seasonCtx = null; }
}

function viewPastRosters() {
  const L = fxLeague();
  const teams = fxPickable();
  const tid = ui.pastTeam && teams.some(t => t.id === ui.pastTeam) ? ui.pastTeam : state.fxTeam || (teams[0] && teams[0].id);
  const r = standingOf(tid);
  const slotOfItem = it => (it.st === 'INJURED_RESERVE' ? 'IL' : it.st === 'RESERVE' ? 'BN' : FX_SLOT_MAP[it.slot] || it.slot || 'BN');
  const rows = (L.rosters[tid] || []).map(it => {
    const raw = it.nba ? nbaById.get(it.nba) : null;
    const s = raw && seasonCtx.basis ? nbaStats(raw, seasonCtx.basis) : null;
    const gp = s ? Math.round(s.gp) : 0;
    return { it, raw, name: raw ? raw.name : it.name, s: gp ? { ...s, pos: raw.pos } : null, gp, val: gp ? value({ ...s, pos: raw.pos }) : null };
  }).sort((a, b) => (b.val ?? -99) - (a.val ?? -99));
  const graded = !!seasonCtx.basis;
  return `
  <p class="page-sub">${esc(fxTeamName(tid))}${r ? ` · ${r.w}-${r.l}${r.t ? '-' + r.t : ''}, ${ordinal(r.rank)} of ${teams.length}` : ''}${graded ? ` · ${seasonCtx.label} per-game stats ${infoBtn('value')}` : ''}</p>
  <div class="card">
    ${rows.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Player</th><th>Slot</th>${graded ? '<th class="num">GP</th><th class="num">MIN</th><th class="num">PTS</th><th class="num">REB</th><th class="num">AST</th><th class="num">STL</th><th class="num">BLK</th><th class="num">3PM</th><th class="num">TO</th><th class="num">FG%</th><th class="num">FT%</th><th class="num">Value</th>' : ''}</tr></thead>
      <tbody>${rows.map(x => `<tr>
        <td class="player"><div class="bplayer">${headshot({ nbaId: x.raw ? x.raw.id : null, name: x.name }, 28)}<div class="bmain"><div class="bname">${x.raw ? `<button class="link-btn pname" data-action="player-detail" data-nba="${x.raw.id}">${esc(x.name)}</button>` : esc(x.name)}</div></div></div></td>
        <td>${slotBadge(slotOfItem(x.it))}</td>
        ${graded ? `<td class="num">${x.gp || '—'}</td>${x.s ? statCells(x.s) : '<td class="num muted" colspan="11">No NBA stats that season</td>'}` : ''}
      </tr>`).join('')}</tbody>
    </table></div>` : `<div class="empty"><strong>No roster</strong>Fantrax didn't return a roster for this team.</div>`}
  </div>
  ${graded ? '' : `<p class="small muted">No NBA stats are saved for this season (the site has 2016-17 on), so players show without stats.</p>`}`;
}

// ----- Season awards (past seasons) -----
// Built from each team's end-of-season roster and that season's full per-game stats.
const SEASON_GAMES = 82;

// One team's season: roster players with stats, a typical week's category totals, age and games missed
function seasonTeam(t, L, basis, endDate) {
  const players = (L.rosters[t.id] || []).map(it => {
    const raw = it.nba ? nbaById.get(it.nba) : null;
    const s = raw ? nbaStats(raw, basis) : null;
    const gp = s ? Math.round(s.gp) : 0;
    const age = raw && raw.born ? (new Date(endDate) - new Date(raw.born)) / (365.25 * 864e5) : null;
    return { raw, gp, age, p: gp ? { ...s, id: raw.id, nbaId: raw.id, pos: raw.pos, status: 'Healthy' } : null };
  });
  // a typical week: the best lineup by value, each starter counted for the share of games he played
  const withStats = players.filter(x => x.p);
  const avail = x => Math.min(1, x.gp / SEASON_GAMES);
  const ranked = [...withStats].sort((a, b) => (value(b.p) + 4) * avail(b) - (value(a.p) + 4) * avail(a));
  const ids = new Set(fillSlots(ranked.map(x => x.p), state.slots).filter(Boolean));
  const tot = Object.fromEntries(COUNT_KEYS.map(k => [k, 0])), vr = Object.fromEntries(COUNT_KEYS.map(k => [k, 0]));
  for (const x of ranked.filter(x => ids.has(x.p.id))) {
    const g = perGame(x.p), n = WEEK_GAMES * avail(x);
    for (const k of COUNT_KEYS) { tot[k] += g.m[k] * n; vr[k] += g.sd[k] ** 2 * n; }
  }
  const ages = players.map(x => x.age).filter(a => a != null);
  // players on the books who played little or not at all that season
  const missed = sum(players.filter(x => x.raw).map(x => Math.max(0, SEASON_GAMES - x.gp)));
  // pickups: from the weekly rosters, players who came off free agency or waivers (not trades, drafts or keepers);
  // without them, anyone on the final roster but not the opening week's
  let pickups = null;
  const how = L.arrivals ? L.arrivals[t.id] || {} : null;
  if (how) {
    pickups = players.filter((x, i) => x.p && how[L.rosters[t.id][i].fid] === 'pickup').map(x => ({ name: x.raw.name, v: value(x.p) }));
  } else if (L.openingRosters) {
    const start = new Set((L.openingRosters[t.id] || []).map(x => x.nba || x.name));
    pickups = players.filter((x, i) => x.p && !start.has(L.rosters[t.id][i].nba || L.rosters[t.id][i].name)).map(x => ({ name: x.raw.name, v: value(x.p) }));
  }
  return { id: t.id, name: t.name, week: { tot, vr }, age: ages.length ? sum(ages) / ages.length : null, ages: ages.length, missed,
    waiver: pickups && pickups.length ? sum(pickups.map(x => x.v)) : pickups ? 0 : null,
    waiverN: pickups ? pickups.length : 0, waiverBest: pickups && pickups.length ? pickups.reduce((a, b) => (b.v > a.v ? b : a)) : null };
}

function seasonAwards() {
  const L = fxLeague();
  const basis = seasonCtx.basis;
  const end = (L.periods[L.periods.length - 1] || {}).end || `${L.year + 1}-04-15`;
  const teams = fxPickable().map(t => seasonTeam(t, L, basis, end));
  const each = matchupScoring() === 'each' || !/SINGLE_WIN/.test(L.scoring || '');
  // expected record: average chance of beating every other team in a typical week
  for (const T of teams) {
    const vs = teams.filter(o => o !== T).map(o => matchOdds(compareCats(T.week, o.week)));
    T.expPct = vs.length ? sum(vs.map(o => (each ? o.expected / o.n : o.win))) / vs.length : 0.5;
    const r = standingOf(T.id);
    if (r) {
      const g = r.w + r.l + r.t;
      T.record = `${r.w}-${r.l}${r.t ? '-' + r.t : ''}`;
      T.expW = T.expPct * g;
      T.luck = r.w + r.t / 2 - T.expW;
    }
  }
  // category profile: each category vs the league's teams, in team-to-team spreads
  const val = (T, c) => catValue(T.week, c);
  const cats = isPoints() ? [] : scoreCats();
  for (const c of cats) {
    const xs = teams.map(T => val(T, c));
    const m = sum(xs) / xs.length, sd = Math.sqrt(sum(xs.map(x => (x - m) ** 2)) / xs.length) || 1;
    teams.forEach((T, i) => { (T.z = T.z || {})[c.key] = ((xs[i] - m) / sd) * (c.neg ? -1 : 1); });
  }
  for (const T of isPoints() ? [] : teams) {
    const zs = cats.map(c => T.z[c.key]);
    const low = cats.reduce((a, c) => (T.z[c.key] < T.z[a.key] ? c : a));
    T.punt = { cat: low.label, z: T.z[low.key] };
    const mz = sum(zs) / zs.length;
    T.spread = Math.sqrt(sum(zs.map(z => (z - mz) ** 2)) / zs.length);
  }
  // drafting: what the picks produced over the season (or, without the weekly rosters and game log, average +/− per pick)
  const d = draftData();
  const GL = L.season ? gameLogs[L.season] : null;
  const drafted = d && d.graded ? draftImpact(L, GL, d.picks) : null;
  if (drafted) {
    for (const T of teams) {
      const ps = drafted[T.id] || [];
      T.draft = ps.length ? sum(ps.map(p => p.v)) : null;
      T.draftBest = ps.length ? ps.reduce((a, b) => (b.v > a.v ? b : a)) : null;
    }
  } else if (d && d.graded) {
    for (const T of teams) {
      const ps = d.picks.filter(p => p.teamId === T.id);
      T.draft = ps.length ? sum(ps.map(p => p.gain)) / ps.length : null;
      T.draftBest = ps.length ? ps.reduce((a, b) => (b.gain > a.gain ? b : a)) : null;
    }
  }
  const total = v => (isPoints() ? `${Math.round(v).toLocaleString()} FP` : `${v >= 0 ? '+' : '−'}${Math.round(Math.abs(v)).toLocaleString()} value`);
  // Waiver Wire Wizard and Street Clothes come from the weekly lineups and the season's game log
  // (the final-roster estimates in seasonTeam are the fallback)
  const G = L.season ? gameLogs[L.season] : null;
  const impact = pickupImpact(L, G);
  const sat = startersMissed(L, G);
  const olds = startersAge(L);
  if (olds) for (const T of teams) { T.age = olds[T.id] ? olds[T.id].age : null; T.oldest = olds[T.id] ? olds[T.id].oldest : null; }
  if (sat) {
    for (const T of teams) {
      const ps = sat[T.id] || [];
      T.missed = sum(ps.map(p => p.games));
      T.missedMost = ps.length ? ps.reduce((a, b) => (b.games > a.games ? b : a)) : null;
    }
  }
  if (impact) {
    for (const T of teams) {
      const ps = impact[T.id] || [];
      T.waiver = sum(ps.map(p => p.v));
      T.waiverN = ps.length;
      T.waiverBest = ps.length ? ps.reduce((a, b) => (b.v > a.v ? b : a)) : null;
    }
  }
  const pickupNote = T => {
    if (!T.waiverBest) return 'no pickups';
    const b = T.waiverBest;
    const amount = isPoints() ? `${fmt(b.v, 0)} FP` : signed(b.v, 1);
    return `${T.waiverN} pickup${T.waiverN === 1 ? '' : 's'}, best: ${b.name} (${amount}${b.weeks ? ` in ${b.weeks} wk${b.weeks === 1 ? '' : 's'}` : ''})`;
  };
  const ranked = (key, dir, fmtFn, note) => teams.filter(T => T[key] != null).sort((a, b) => (b[key] - a[key]) * dir).map(T => ({ T, txt: fmtFn(T), note: note ? note(T) : '' }));
  return [
    drafted
      ? { title: 'Best draft', info: 'awDraft', list: ranked('draft', 1, T => total(T.draft), T => (T.draftBest ? `best: ${T.draftBest.name} (${total(T.draftBest.v)} over ${T.draftBest.games} games)` : '')) }
      : { title: 'Best draft', info: 'awDraft', list: ranked('draft', 1, T => `${signed(T.draft, 1)} per pick`, T => T.draftBest ? `best: ${T.draftBest.name} (${signed(T.draftBest.gain, 0)})` : '') },
    { title: 'Best manager', info: 'awManager', list: ranked('luck', 1, T => `${signed(T.luck, 1)} wins`, T => `${T.record} vs ${fmt(T.expW, 1)} expected`) },
    impact
      ? { title: 'Waiver Wire Wizard', info: 'awWaiver', list: ranked('waiver', 1, T => (isPoints() ? `${fmt(T.waiver, 0)} FP` : `${signed(T.waiver, 1)} value`), pickupNote) }
      : { title: 'Waiver Wire Wizard', info: 'awWaiver', list: ranked('waiver', 1, T => (isPoints() ? `${fmt(T.waiver, 1)} FP/G` : `${signed(T.waiver, 1)} value`), T => (T.waiverBest ? `${T.waiverN} pickup${T.waiverN === 1 ? '' : 's'}, best: ${T.waiverBest.name} (${fmtValue(T.waiverBest.v)})` : 'no pickups on the final roster')) },
    sat
      ? { title: 'Street Clothes', info: 'awStreet', list: ranked('missed', 1, T => `${T.missed} games`, T => (T.missedMost ? `most: ${T.missedMost.name} (${T.missedMost.games})` : '')) }
      : { title: 'Street Clothes', info: 'awStreet', list: ranked('missed', 1, T => `${T.missed} games`) },
    ...(isPoints() ? [] : [{ title: 'Biggest punt', info: 'awPunt', list: ranked('punt', 1, T => T.punt.cat, T => `${fmt(-T.punt.z, 1)} spreads below average`).sort((a, b) => a.T.punt.z - b.T.punt.z) },
    { title: 'Even Steven', info: 'awSteven', list: ranked('spread', -1, T => `${fmt(T.spread, 2)} spread`, T => { const order = [...cats].sort((a, b) => T.z[b.key] - T.z[a.key]); return `best: ${order[0].label} · worst: ${order[order.length - 1].label}`; }) }]),
    olds
      ? { title: 'Unc Status', info: 'awUnc', list: ranked('age', 1, T => `${fmt(T.age, 1)} yrs`, T => (T.oldest ? `oldest regular: ${T.oldest.name} (${Math.floor(T.oldest.age)}, ${T.oldest.weeks} wks)` : '')) }
      : { title: 'Unc Status', info: 'awUnc', list: ranked('age', 1, T => `${fmt(T.age, 1)} yrs`) },
  ].filter(a => a.list.length);
}

function viewAwards() {
  if (!seasonCtx.basis) {
    return `<div class="card"><div class="empty"><strong>No awards for this season</strong>No NBA stats are saved for this season (the site has 2016-17 on), and every award needs that season's numbers.</div></div>`;
  }
  // the season's game log (about 350 KB) loads the first time Awards opens
  const L = fxLeague();
  if (L.weeks && L.season && !(L.season in gameLogs)) {
    loadGameLog(L.season).then(() => { if (ui.tab === 'awards' && ui.season) render(); });
    return '<div class="card"><div class="empty"><strong>Loading the season’s games…</strong></div></div>';
  }
  const me = state.fxTeam;
  return `
  <div class="awards">${seasonAwards().map(a => {
    const [win, ...rest] = a.list;
    return `<div class="card award">
      <div class="aw-title">${a.title} ${infoBtn(a.info)}</div>
      <div class="aw-win${win.T.id === me ? ' me' : ''}"><span class="aw-name">${esc(win.T.name)}${win.T.id === me ? ' <span class="badge accent">you</span>' : ''}</span><span class="aw-val">${esc(win.txt)}</span></div>
      ${win.note ? `<div class="small muted">${esc(win.note)}</div>` : ''}
      <ol class="aw-list" start="2">${rest.map(x => `<li class="${x.T.id === me ? 'me' : ''}" title="${esc(x.note)}"><span>${esc(x.T.name)}</span><span class="muted">${esc(x.txt)}</span></li>`).join('')}</ol>
    </div>`;
  }).join('')}</div>`;
}

// Tabs that can show another team's version (read-only); the rest are league-wide or yours
const VIEW_TABS = ['week', 'dashboard', 'roster'];

// League and team bar shown above every tab
function ctxBar() {
  const bar = $('#ctxBar');
  if (!bar) return;
  const L = fxLeague();
  bar.hidden = !L || needsLanding();
  if (bar.hidden) return;
  const P = pastSeason();
  const seasons = seasonsFor(L);
  const seasonSel = `<select class="ctx-team ctx-season" data-change="season" aria-label="Season">
      <option value="">${esc(L.year ? seasonLabel(L.year) : NBA ? NBA.season : 'This season')}</option>${seasons.map(x => `<option value="${esc(x.id)}" ${x.id === ui.season ? 'selected' : ''}>${x.year ? seasonLabel(x.year) : 'Past season'}</option>`).join('')}
      <option value="add">+ Add season…</option></select>`;
  const addForm = ui.addingSeason ? `<form class="ctx-add" data-form="add-season">
      <input name="sid" placeholder="Past season's league ID" autocomplete="off" spellcheck="false" aria-label="Past season's Fantrax league ID" title="Open that season on Fantrax; the ID is the part of the address after /league/">
      <button class="btn sm primary" type="submit">Add</button><button class="btn sm ghost" type="button" data-action="season-cancel">Cancel</button></form>` : '';
  let teamSel;
  if (P) {
    const myName = fxTeamName(state.fxTeam);
    const teams = P.league.teams;
    const me = teams.find(t => t.name === myName);
    const shownId = ui.pastTeam || (me ? me.id : '');
    teamSel = `<select class="ctx-team" data-change="past-team" aria-label="Team">${shownId ? '' : '<option value="">Pick a team</option>'}${teams.map(t => `<option value="${esc(t.id)}" ${t.id === shownId ? 'selected' : ''}>${esc(t.name)}${me && t.id === me.id ? ' (you)' : ''}</option>`).join('')}</select>`;
  } else {
    const viewing = ui.viewA && VIEW_TABS.includes(ui.tab);
    const shown = viewing ? ui.viewA : state.fxTeam;
    teamSel = `<select class="ctx-team" data-change="${state.fxTeam ? 'fx-view' : 'fx-team'}" aria-label="${state.fxTeam ? 'Team to view' : 'Your team'}">
      ${state.fxTeam ? '' : '<option value="">Pick your team</option>'}${fxPickable().map(t => `<option value="${esc(t.id)}" ${t.id === shown ? 'selected' : ''}>${esc(t.name)}${t.id === state.fxTeam ? ' (you)' : ''}</option>`).join('')}
    </select>${viewing ? '<span class="badge">Viewing only</span><button class="link-btn small" data-action="fx-view-mine">Back to my team</button>' : ''}`;
  }
  $('#ctxTeam').innerHTML = `${seasonSel}<span class="ctx-sep" aria-hidden="true">/</span>${teamSel}${addForm}`;
  document.body.classList.toggle('past', !!P);
  if (P) {
    $('#ctxMeta').innerHTML = [
      '<span class="badge accent">Past season</span>',
      'final standings and rosters from Fantrax',
    ].join(' · ');
    return;
  }
  $('#ctxMeta').innerHTML = `<span>${[
    NBA ? `stats updated ${ago(NBA.updated)} ${infoBtn('data')}` : 'NBA data unavailable',
    isPoints() && L.pointsOther && L.pointsOther.length ? `<span title="Not projected: ${esc(L.pointsOther.join(', '))}">some scoring stats not projected</span>` : '',
    !isPoints() && L.catsOther && L.catsOther.length ? `<span title="Not projected: ${esc(L.catsOther.join(', '))}">${L.catsOther.length === 1 ? 'one category' : 'some categories'} not projected</span>` : '',
  ].filter(Boolean).join(' · ')}</span>${state.demo ? '' : '<button type="button" class="btn sm" data-action="league-reload" title="Pull the latest rosters, matchups and standings">↻ Reload from Fantrax</button>'}`;
}

function render() {
  const landing = needsLanding();
  document.body.classList.toggle('landing', landing);
  leagueMenu();
  ctxBar();
  if (landing) { $('#view').innerHTML = viewLanding(); return; }
  const nav = $('#tabs');
  const mode = ui.season ? 'past' : 'now';
  if (nav.dataset.mode !== mode) {
    nav.innerHTML = tabList().map(([k, l]) => `<a href="#${k}" data-tab="${k}">${l}</a>`).join('');
    nav.dataset.mode = mode;
  }
  document.querySelectorAll('#tabs a').forEach(a => a.classList.toggle('active', a.dataset.tab === ui.tab));
  const cur = tabList().find(([k]) => k === ui.tab);
  $('#navCurrent').textContent = cur ? cur[1] : 'Menu';
  if (ui.season) {
    const past = { standings: viewStandings, awards: viewAwards, draft: viewDraft, rosters: viewPastRosters };
    $('#view').innerHTML = pastSeason() ? withSeason(past[ui.tab] || viewStandings) : '<div class="card"><div class="empty"><strong>Loading that season…</strong></div></div>';
    return;
  }
  const early = preDraft();
  if (early && ['week', 'dashboard', 'roster', 'draft', 'standings', 'trade'].includes(ui.tab)) { $('#view').innerHTML = viewPreDraft(early); return; }
  const views = { week: () => withViewedTeam(viewWeek), draft: viewDraft, players: viewPlayers, dashboard: () => withViewedTeam(viewDashboard), roster: () => withViewedTeam(viewRoster), standings: viewStandings, trade: viewTrade };
  // keep scroll position of inner lists (e.g. trade picker) across re-renders
  const scrolls = [...document.querySelectorAll('.pick-list')].map(el => el.scrollTop);
  $('#view').innerHTML = (views[ui.tab] || viewDashboard)();
  document.querySelectorAll('.pick-list').forEach((el, i) => { el.scrollTop = scrolls[i] || 0; });
}

// A league that hasn't drafted: no picks made and every roster empty
function preDraft() {
  const L = fxLeague();
  if (!L || (L.draft && L.draft.picks.length)) return null;
  return Object.values(L.rosters || {}).some(r => r.length) ? null : L;
}

// Fantrax sends "2026-10-25T19:00:00.0-0400"
function fxTime(str) {
  const dt = new Date(String(str || '').replace(/\.\d+(?=[-+])/, '').replace(/([-+]\d\d)(\d\d)$/, '$1:$2'));
  return Number.isNaN(dt.getTime()) ? null : dt;
}
const draftTime = L => fxTime(L.draftAt);

// Weekly lineups lock when the Fantrax scoring period starts (else at the start of the first matchup day)
function lockTime(start) {
  const p = fxPeriodFor(start);
  return (p && fxTime(p.lock)) || new Date(matchDates(start)[0] + 'T00:00:00');
}

function draftWhen(L) {
  const dt = draftTime(L);
  return dt ? `${dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} at ${dt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : '';
}


function viewPreDraft(L) {
  const when = draftWhen(L);
  const past = draftTime(L) && draftTime(L) < new Date();
  return `<div class="card"><div class="empty"><strong>${past ? 'Waiting on the draft' : "This league hasn't drafted yet"}</strong>
      ${when ? `${past ? 'The draft was set for' : 'The draft is set for'} <b>${esc(when)}</b>. ` : ''}Rosters, matchups and the draft board fill in here once teams have players.
      In the meantime, the <a href="#players">Free Agents</a> tab ranks every NBA player (set Show to Every NBA player).</div></div>`;
}

function standingOf(teamId) {
  const L = fxLeague();
  return L && L.standings ? L.standings.find(r => r.id === teamId) || null : null;
}


// ----- Dashboard: category strengths vs your league -----
const STR_KEY = 'courtside-strengths';
const DRAFT_MODE_KEY = 'courtside-draft-mode';
ui.draftMode = (() => { try { return localStorage.getItem(DRAFT_MODE_KEY) || 'game'; } catch (e) { return 'game'; } })();
ui.strBasis = (() => { try { return localStorage.getItem(STR_KEY) || 'starters'; } catch (e) { return 'starters'; } })();

function teamCatAvg(players) {
  const zs = players.map(catZ);
  return Object.fromEntries(scoreCats().map(c => [c.key, zs.length ? sum(zs.map(z => z[c.key] || 0)) / zs.length : 0]));
}

const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');

// "Viewing" picker shown on Dashboard and Roster: look at any league team, read-only
// A team's real per-game numbers: counting stats per player, FG%/FT% from makes ÷ attempts
function teamRaw(players) {
  const n = players.length || 1;
  const out = {};
  for (const c of scoreCats()) {
    if (c.fp) out.fp = sum(players.map(p => fantasyPoints(p))) / n;
    else if (c.pct) {
      const att = sum(players.map(p => statVal(p, c.att)));
      out[c.key] = att ? sum(players.map(p => statVal(p, c.made))) / att : 0;
    } else out[c.key] = sum(players.map(p => statVal(p, c.key))) / n;
  }
  return out;
}

const fmtRaw = (c, v) => (c.pct ? fmtPct(v) : fmt(v, 1));

function strengthsCard() {
  const starterBasis = ui.strBasis === 'starters';
  const mine = starterBasis ? starters() : state.players.filter(p => !state.il.includes(p.id));
  const toggle = `<div class="seg seg-sm" role="group" aria-label="Players to include">${[['starters', 'Starters'], ['active', 'Active roster']].map(([k, l]) => `<button type="button" class="${ui.strBasis === k ? 'on' : ''}" data-action="str-basis" data-basis="${k}" aria-pressed="${ui.strBasis === k}">${l}</button>`).join('')}</div>`;
  const head = `<div class="card-head"><h2>Category strengths ${infoBtn('strengths')}</h2>${toggle}</div>`;
  if (!mine.length) return `<div class="card">${head}<div class="empty"><strong>No players yet</strong>Load your roster to see your category profile.</div></div>`;

  const me = { name: state.teamName, raw: teamRaw(mine), avg: teamCatAvg(mine), mine: true };
  const teams = [me];
  if (fxLeague()) {
    for (const t of fxPickable()) {
      if (t.id === (ui.viewing ? ui.viewA : state.fxTeam)) continue;
      const side = fxTeamSide(t.id);
      const ps = starterBasis ? side.players.filter(p => side.starters.includes(p.id)) : side.players.filter(p => !side.il.includes(p.id));
      if (ps.length) teams.push({ name: t.id === state.fxTeam ? `${t.name} (you)` : t.name, raw: teamRaw(ps), avg: teamCatAvg(ps) });
    }
  }
  const league = teams.length > 1;
  const n = teams.length;

  const rows = scoreCats().map(c => {
    const vals = teams.map(t => t.raw[c.key]);
    const mean = sum(vals) / n;
    const sd = Math.sqrt(sum(vals.map(v => (v - mean) ** 2)) / n) || 1e-9;
    // how far each team is from the league average, in team-to-team spreads (fewer TO is better)
    const gap = v => (league ? (c.neg ? -1 : 1) * (v - mean) / sd : 0);
    const z = league ? gap(me.raw[c.key]) : me.avg[c.key];
    const ranked = [...teams].sort((a, b) => gap(b.raw[c.key]) - gap(a.raw[c.key]));
    const rank = ranked.indexOf(me) + 1;
    // who helps or hurts: each player's own number against the league average shown in this row.
    // For FG%/FT% that's makes above or below average at the player's volume.
    const ref = league ? mean : (BASE[c.key] || [0])[0];
    const att = c.att;
    const impact = p => (c.pct ? (pctOf(p, c) - ref) * statVal(p, att) : (c.neg ? -1 : 1) * (statOf(p, c) - ref));
    const byImpact = mine.map(p => ({ p, d: impact(p) })).sort((a, b) => b.d - a.d);
    const big = c.pct ? 0.1 : Math.max(0.1, ref * 0.1);
    const drivers = byImpact.filter(x => x.d > big).slice(0, 2);
    const drag = byImpact.filter(x => x.d < -big).slice(-1);
    const tip = x => c.pct
      ? `${x.p.name}: ${fmtPct(pctOf(x.p, c))} on ${fmt(statVal(x.p, att), 1)} attempts a game, ${fmt(Math.abs(x.d), 1)} ${x.d > 0 ? 'more' : 'fewer'} makes a game than the ${league ? 'league' : 'typical'} average of ${fmtPct(ref)} would give`
      : `${x.p.name}: ${fmt(statOf(x.p, c), 1)} ${c.label} a game vs the ${league ? 'league' : 'typical'} average of ${fmt(ref, 1)} per ${starterBasis ? 'starter' : 'player'}`;
    const who = list => list.map(x => `<span title="${esc(tip(x))}">${inlinePlayer(x.p, esc(lastName(x.p.name)))} <b class="${x.d > 0 ? 'pos-good' : 'pos-bad'}">${c.pct ? fmtPct(pctOf(x.p, c)) : fmt(statOf(x.p, c), 1)}</b>${c.pct ? `<span class="muted"> on ${fmt(statVal(x.p, att), 1)} ${att.toUpperCase()}</span>` : ''}</span>`).join(', ') || '<span class="muted">—</span>';
    const w = Math.min(Math.abs(z) / 2, 1) * 50; // bar edge = 2 spreads from the league average
    const pos = v => ((Math.max(-2.5, Math.min(2.5, gap(v))) + 2.5) / 5) * 100;
    const open = ui.csOpen.has(c.key);
    return { c, z, rank, html: `<tr class="cs-row" data-action="cs-toggle" data-cat="${c.key}" aria-expanded="${open}" title="Show who helped (green) and hurt (red) most">
      <td><span class="cs-chev" aria-hidden="true">▸</span><b>${c.label}</b></td>
      <td class="num"><b>${fmtRaw(c, me.raw[c.key])}</b></td>
      ${league ? `<td class="num muted">${fmtRaw(c, mean)}</td>` : ''}
      <td class="cs-bar" title="${signed(z, 2)} spreads ${league ? 'from the league average' : 'from a typical player'}"><span class="track"><span class="fill ${z >= 0 ? 'up' : 'down'}" style="width:${w}%"></span></span></td>
      ${league ? `<td class="num cs-rank ${rank <= 3 ? 'pos-good' : rank > n - 3 ? 'pos-bad' : ''}"><b>${ordinal(rank)}</b> <span class="muted">/ ${n}</span></td>
      <td class="cs-strip"><div class="strip">${teams.map(t => `<span class="sdot${t.mine ? ' me' : ''}" style="left:${pos(t.raw[c.key]).toFixed(1)}%" title="${esc(t.name)}: ${fmtRaw(c, t.raw[c.key])}"></span>`).join('')}</div></td>` : ''}
    </tr>
    <tr class="cs-detail"${open ? '' : ' hidden'}><td colspan="${league ? 6 : 3}"><div class="cs-who">
      ${drivers.length || drag.length ? `${drivers.length ? `<span>${who(drivers)}</span>` : ''}${drag.length ? `<span>${who(drag)}</span>` : ''}` : '<span class="muted">No one stands out</span>'}
    </div></td></tr>` };
  });

  // with a league, strengths and weaknesses are about rank; without one, about the gap
  const strong = rows.filter(r => (league ? r.rank <= 3 : r.z > 0.2)).sort((a, b) => (a.rank - b.rank) || (b.z - a.z));
  const weak = rows.filter(r => (league ? r.rank > n - 3 : r.z < 0)).sort((a, b) => (b.rank - a.rank) || (a.z - b.z));
  const label = r => `<b>${r.c.label}</b>${league ? ` (${ordinal(r.rank)})` : ''}`;
  const unit = starterBasis ? 'per starter' : 'per player';
  const summary = `<div class="cs-summary">
      <div><span class="muted small">Strengths</span><br>${strong.slice(0, 4).map(label).join(', ') || '—'}</div>
      <div><span class="muted small">Weaknesses</span><br>${weak.slice(0, 4).map(label).join(', ') || '—'}</div>
    </div>`;
  return `<div class="card">
    ${head}
    <div class="table-wrap"><table class="cs-table">
      <thead><tr><th>Cat</th><th class="num">You <span class="muted">${unit}</span></th>${league ? '<th class="num">League avg</th>' : ''}<th class="cs-bar">${league ? 'Below · league avg · above' : 'Below · typical · above'}</th>${league ? '<th class="num">Rank</th><th class="cs-strip">Every team<span class="hide-sm"> (you in orange)</span></th>' : ''}</tr></thead>
      <tbody>${rows.map(r => r.html).join('')}</tbody>
    </table></div>
    ${summary}
  </div>`;
}

/* ---------- Dashboard ---------- */
function viewDashboard() {
  // the latest games come from the box scores, loaded on first need
  if (!BOX && NBA) loadBoxes().then(() => { if (ui.tab === 'dashboard') render(); }).catch(() => {});
  return `
  <div class="dash-grid">
    <div>${topPerformancesCard()}</div>
    <div class="dash-side">
      <div class="card">
        <div class="card-head"><h2>Action items</h2></div>
        <ul class="alerts">
          ${buildAlerts().map(x => `<li class="alert ${x.lvl}"><span class="dot"></span><span class="grow">${x.msg}</span>${x.action ? `<button class="btn sm" data-action="${x.action}">${x.label}</button>` : ''}</li>`).join('')}
        </ul>
      </div>
      ${newsCard()}
    </div>
  </div>`;
}

// ----- Top performances: the best single games across the NBA on the latest game days -----
// Ranked like player value but for one game (each category against an average rostered player's game),
// or by fantasy points in points leagues. Each shows who has him in your league.
const lineStat = (line, k) => (DERIVED[k] ? sum(Object.entries(DERIVED[k]).map(([b, c]) => (line[b] || 0) * c)) : line[k] || 0);
const lineFp = line => sum(Object.entries(leaguePoints() || {}).map(([k, v]) => lineStat(line, k) * v));
const lineValue = line => (isPoints() ? lineFp(line) : sum(Object.values(catZ({ ...line, fgPct: line.fga ? line.fgm / line.fga : 0, ftPct: line.fta ? line.ftm / line.fta : 0 }))));

function topPerformancesCard() {
  const today = todayIso(), yesterday = addDays(today, -1);
  const card = (sub, body) => `<div class="card"><div class="card-head"><h2>Performances</h2><span class="muted small">${sub}</span></div>${body}</div>`;
  if (!BOX) return card('', '<p class="muted small" style="margin:0">Loading the latest box scores…</p>');
  // the latest day with finished games
  const d = [...new Set([...BOX.finals].map(x => x.slice(0, 10)))].filter(x => x <= today).sort().pop();
  if (!d) return card('', '<p class="muted small" style="margin:0">No games have been played yet.</p>');
  const owner = new Map();
  const L = fxLeague();
  for (const [tid, r] of Object.entries((L && L.rosters) || {})) for (const x of r) if (x.nba) owner.set(x.nba, tid);
  const mine = ui.viewing ? ui.viewA : state.fxTeam;
  const who = id => {
    const tid = owner.get(id);
    if (tid) return tid === mine ? '<span class="badge accent">Your team</span>' : `<span class="perf-owner">${esc(fxTeamName(tid))}</span>`;
    const raw = nbaById.get(id);
    return raw && raw.fx ? `<span class="badge good">${FX_STATUS[raw.fx.st] || 'Free agent'}</span>` : '';
  };
  const statLine = l => [`${l.pts} PTS`, `${l.reb} REB`, `${l.ast} AST`, ...[['stl', 'STL'], ['blk', 'BLK'], ['tpm', '3PM'], ['to', 'TO']].filter(([k]) => l[k] >= (k === 'to' ? 4 : 2)).map(([k, n]) => `${l[k]} ${n}`)].map(x => `<span>${x}</span>`).join(' · ');
  const tip = esc(isPoints() ? 'Fantasy points in your league' : "Value for the game: each of your league's categories against an average rostered player's game");
  const games = [];
  for (const [id, m] of BOX.day) { const line = m.get(d); if (line && nbaById.has(id)) games.push({ raw: nbaById.get(id), line, v: lineValue(line) }); }
  const list = rows => `<ul class="perf">${rows.map(({ raw, line, v }) => `<li>
      ${headshot({ nbaId: raw.id, name: raw.name }, 40)}
      <div class="perf-main"><div><button class="link-btn pname" data-action="player-detail" data-nba="${raw.id}">${esc(raw.name)}</button></div>
        <div class="perf-line">${statLine(line)}</div>
        <div class="pmeta">${teamLogo(raw.team, 14)} ${Math.round(line.min)} min · ${line.fgm}-${line.fga} FG · ${line.ftm}-${line.fta} FT · ${who(raw.id)}</div></div>
      <div class="perf-val ${v < 0 ? 'pos-bad' : ''}" data-tip="${tip}">${isPoints() ? `${fmt(v, 1)} FP` : signed(v, 1)}</div>
    </li>`).join('')}</ul>`;
  // best: anyone, so free agents worth adding show up; worst: only players someone in your league rosters
  const best = [...games].sort((a, b) => b.v - a.v).slice(0, 6);
  const worst = games.filter(g => owner.has(g.raw.id)).sort((a, b) => a.v - b.v).slice(0, 6);
  return card(`${d === today ? 'Today' : d === yesterday ? 'Last night' : ''} ${fmtDay(d)}`.trim(), `
    <h3 class="sub">Best <span class="muted small">every NBA player</span></h3>${list(best)}
    ${worst.length ? `<h3 class="sub">Worst <span class="muted small">players rostered in your league</span></h3>${list(worst)}` : ''}`);
}

function newsCard() {
  const mine = state.players.filter(p => p.inj);
  mine.sort((a, b) => (b.inj.date || '').localeCompare(a.inj.date || ''));
  const body = mine.length ? `<ul class="alerts">${mine.slice(0, 6).map(p => `<li class="alert ${p.inj.status === 'Out' ? 'bad' : 'warn'}">${headshot(p, 32)}<span class="grow"><b>${esc(p.name)}</b> <span class="badge ${p.inj.status === 'Out' ? 'bad' : 'warn'}">${esc(p.inj.label)}</span><br><span class="small">${esc(p.inj.note)}</span> <span class="muted small">${p.inj.date ? fmtDay(p.inj.date) : ''}</span></span></li>`).join('')}</ul>`
    : `<p class="muted small" style="margin:0">${NBA ? 'None of your players are on the injury report.' : 'Injury news appears here when live NBA data is available.'}</p>`;
  return `<div class="card"><div class="card-head"><h2>Injury news</h2><span class="muted small">your players · ESPN</span></div>${body}</div>`;
}

function slotBadge(slot) {
  const cls = slot === 'IL' ? 'il' : `slot-${slot}`;
  return `<span class="slot-label ${cls}">${slot === 'FLX' ? 'Flx' : slot === 'BN' ? 'Res' : slot}</span>`;
}

/* ---------- Roster ---------- */

function sortList(list, sortState) {
  const { key, dir } = sortState;
  const slotRank = p => { const s = slotOf(p); return s === 'IL' ? 99 : s === 'BN' ? 50 : state.lineup.indexOf(p.id); };
  const get = p => key === 'value' ? value(p) : key === 'slot' ? slotRank(p) : key === 'name' ? p.name.toLowerCase() : key === 'status' ? STATUSES.indexOf(p.status) : key === 'tag' ? p.tag.toLowerCase() : key === 'fp' ? fantasyPoints(p) : statVal(p, key);
  return [...list].sort((a, b) => { const x = get(a), y = get(b); return (x < y ? -1 : x > y ? 1 : 0) * dir; });
}

function headerRow(cols, sortState, scope) {
  return cols.map(([k, l]) => {
    const label = k === 'value' ? valueLabel() : l;
    const isNum = !['name', 'status', 'slot', 'tag'].includes(k);
    const sorted = sortState.key === k;
    return `<th class="sortable ${isNum ? 'num' : ''} ${sorted ? 'sorted' : ''}" data-action="sort" data-scope="${scope}" data-key="${k}" aria-sort="${sorted ? (sortState.dir > 0 ? 'ascending' : 'descending') : 'none'}">${label}${sorted ? (sortState.dir > 0 ? ' ↑' : ' ↓') : ''}</th>`;
  }).join('');
}

function statCells(p) {
  return `<td class="num">${fmt(p.min, 0)}</td><td class="num">${fmt(p.pts)}</td><td class="num">${fmt(p.reb)}</td><td class="num">${fmt(p.ast)}</td>
    <td class="num">${fmt(p.stl)}</td><td class="num">${fmt(p.blk)}</td><td class="num">${fmt(p.tpm)}</td><td class="num">${fmt(p.to)}</td>
    <td class="num">${fmtPct(p.fgPct)}</td><td class="num">${fmtPct(p.ftPct)}</td><td class="num"><b>${fmtValue(value(p))}</b></td>`;
}

// The roster as a team profile: minutes, then whatever the league scores, each cell shaded by how
// much the player helps (green) or hurts (red) it next to an average rostered player
function rosterCols() {
  return [['name', 'Player'], ['status', 'Status'], ['slot', 'Slot'], ['min', 'MIN'], ...scoreCats().map(c => [c.key, c.label]), ...(isPoints() ? [] : [['value', '']])];
}

function viewRoster() {
  const list = sortList(state.players, ui.rosterSort);
  const act = state.players.filter(p => !state.il.includes(p.id));
  const cats = scoreCats();
  const fmtC = (c, v) => (c.pct ? fmtPct(v) : fmt(v, c.dec || 1));
  const total = c => {
    if (!c.pct) return sum(act.map(p => statOf(p, c)));
    const att = sum(act.map(p => statVal(p, c.att)));
    return att ? sum(act.map(p => statVal(p, c.made))) / att : 0;
  };
  return `
  <div class="week-stack">
  ${strengthsCard()}
  <div class="card">
    <div class="card-head"><h2>Players ${infoBtn('value')}</h2><span class="muted small">${activeCount()} of ${rosterLimit()} active · ${state.il.length}/${state.ilSize} on IR · per game, green helps, red hurts</span></div>
    ${list.length ? `<div class="table-wrap"><table class="roster-table">
      <thead><tr>${headerRow(rosterCols(), ui.rosterSort, 'roster')}</tr></thead>
      <tbody>${list.map(p => `<tr${state.il.includes(p.id) ? ' class="muted-row"' : ''}>
        <td class="player">${playerCell(p)}</td>
        <td>${statusBadge(p)}</td><td>${slotBadge(slotOf(p))}</td>
        <td class="num">${fmt(p.min, 0)}</td>
        ${cats.map(c => `<td class="num rc" style="${shade(contribZ(p, c.key, 1, false))}" title="${esc(statTip(p, c, 1, false))}">${fmtC(c, statOf(p, c))}</td>`).join('')}
        ${isPoints() ? '' : `<td class="num"><b>${fmtValue(value(p))}</b></td>`}
        </tr>`).join('')}
      </tbody>
      <tfoot><tr><td colspan="4"><b>Active totals</b></td>
        ${cats.map(c => `<td class="num"><b>${fmtC(c, total(c))}</b></td>`).join('')}${isPoints() ? '' : '<td></td>'}</tr></tfoot>
    </table></div>` : `<div class="empty"><strong>No players on this roster</strong>Rosters come from Fantrax. Use ↻ Reload from Fantrax in the league menu to pull the latest.</div>`}
  </div>
  </div>`;
}

/* ---------- Standings ---------- */

function viewStandings() {
  const L = fxLeague();
  const rows = (L && L.standings) || [];
  return `
  <div class="card">
    ${rows.length ? `<div class="table-wrap"><table>
      <thead><tr><th class="num">#</th><th>Team</th><th class="num">W</th><th class="num">L</th><th class="num">T</th><th class="num">Win %</th><th class="num">GB</th>${rows.some(r => r.pf != null) ? '<th class="num">Pts for</th>' : ''}</tr></thead>
      <tbody>${rows.map(r => {
        const g = r.w + r.l + r.t;
        return `<tr${r.id === state.fxTeam ? ' class="me-row"' : ''}><td class="num">${r.rank}</td><td><b>${esc(r.name)}</b>${r.id === state.fxTeam ? ' <span class="muted small">(you)</span>' : ''}</td>
          <td class="num">${r.w}</td><td class="num">${r.l}</td><td class="num">${r.t}</td><td class="num">${g ? fmt(((r.w + r.t / 2) / g) * 100, 0) + '%' : '—'}</td><td class="num">${r.gb ? fmt(r.gb, 1) : '—'}</td>${rows.some(x => x.pf != null) ? `<td class="num">${r.pf != null ? fmt(r.pf, 1) : '—'}</td>` : ''}</tr>`;
      }).join('')}</tbody>
    </table></div>` : `<div class="empty"><strong>No standings yet</strong>Fantrax didn't return standings for this league.</div>`}
  </div>
  ${seasonCtx || !L ? '' : seasonTotalsCard(L, rows)}`;
}

// ----- Season totals: what each team's starters actually produced -----
// Fantrax returns every lineup period's rosters. A player's games count for a team only in periods he
// was ACTIVE there, using this season's box scores (data/boxscores.json, loaded when Standings opens).
const LINEUP_CACHE_KEY = 'courtside-lineups-v1';
const BOX_COLS = ['min', 'pts', 'reb', 'ast', 'stl', 'blk', 'tpm', 'to', 'fgm', 'fga', 'ftm', 'fta', 'oreb', 'dreb', 'tpa', 'pf', 'pm'];
let boxLoad = null;
let BOX = null; // { byPlayer, finals } once data/boxscores.json has loaded
const seasonTot = {}; // league id -> { state: 'loading' | 'ready' | 'error', teams, msg }

function rosterPeriodsOf(L) {
  if (L.rosterPeriods && L.rosterPeriods.length) return L.rosterPeriods.map(([n, start, end]) => ({ n, start, end }));
  return (L.periods || []).map(p => ({ n: p.n, start: p.lock, end: p.endAt })); // weekly leagues lock by scoring period
}
// a game day belongs to a period from its first day; the last day only if the period runs into the night
const periodHas = (p, d) => d >= p.start.slice(0, 10) && (d < p.end.slice(0, 10) || (d === p.end.slice(0, 10) && +p.end.slice(11, 13) >= 21));

function loadBoxes() {
  boxLoad = boxLoad || fetch(`data/boxscores.json?v=${encodeURIComponent(NBA.updated || '')}`).then(r => {
    if (!r.ok) throw new Error(`box scores ${r.status}`);
    return r.json();
  }).then(data => {
    const unique = new Map();
    for (const [gid, g] of Object.entries(data.games || {})) {
      const key = `${g.d} ${g.home} ${g.away}`;
      if (!unique.has(key) || !gid.startsWith('espn:')) unique.set(key, g);
    }
    const byPlayer = new Map(); // NBA id -> [[date, stats]]
    const finals = new Set(); // "date team" for every finished game
    for (const g of unique.values()) {
      finals.add(`${g.d} ${g.home}`).add(`${g.d} ${g.away}`);
      for (const row of g.rows) {
        const st = Object.fromEntries(BOX_COLS.map((k, i) => [k, +row[i + 2] || 0]));
        const tens = ['pts', 'reb', 'ast', 'stl', 'blk'].filter(k => st[k] >= 10).length;
        Object.assign(st, { dd: +(tens >= 2), td: +(tens >= 3), gp1: 1 });
        const margin = row[1] === g.home ? g.hs - g.as : g.as - g.hs;
        if (!byPlayer.has(row[0])) byPlayer.set(row[0], []);
        byPlayer.get(row[0]).push([g.d, st, margin]);
      }
    }
    BOX = { byPlayer, finals, day: new Map([...byPlayer].map(([id, games]) => [id, new Map(games.map(([d, st, margin]) => [d, { ...st, margin }]))])) };
    return BOX;
  }).catch(e => { boxLoad = null; throw e; });
  return boxLoad;
}

// completed periods never change, so their lineups are fetched once and kept on this device
async function loadLineups(L) {
  let all = {};
  try { all = JSON.parse(localStorage.getItem(LINEUP_CACHE_KEY)) || {}; } catch (e) { /* none saved */ }
  const have = all[L.id] || {};
  const toNba = new Map(NBA.players.filter(r => r.fx).map(r => [r.fx.id, r.id]));
  const want = rosterPeriodsOf(L).filter(p => p.n < L.rosterPeriod && !have[p.n]).map(p => p.n);
  let next = 0;
  const worker = async () => {
    while (next < want.length) {
      const n = want[next++];
      const d = await fxGet(`getTeamRosters?leagueId=${encodeURIComponent(L.id)}&period=${n}`);
      have[n] = Object.fromEntries(Object.entries(d.rosters || {}).map(([tid, r]) =>
        [tid, (r.rosterItems || []).filter(it => it.status === 'ACTIVE').map(it => toNba.get(it.id)).filter(Boolean)]));
    }
  };
  try { await Promise.all(Array.from({ length: Math.min(6, want.length) }, worker)); } finally {
    all[L.id] = have;
    try { localStorage.setItem(LINEUP_CACHE_KEY, JSON.stringify(all)); } catch (e) { /* storage full or blocked */ }
  }
  // the current period comes with the league
  return { ...have, [L.rosterPeriod]: Object.fromEntries(Object.entries(L.rosters || {}).map(([tid, r]) => [tid, r.filter(x => x.st === 'ACTIVE' && x.nba).map(x => x.nba)])) };
}

async function buildSeasonTotals(L) {
  const [boxes, lineups] = await Promise.all([loadBoxes(), loadLineups(L)]);
  const teams = {};
  for (const p of rosterPeriodsOf(L)) {
    for (const [tid, ids] of Object.entries(lineups[p.n] || {})) {
      const T = teams[tid] || (teams[tid] = { gp: 0, s: {} });
      for (const id of ids) {
        for (const [d, st] of boxes.byPlayer.get(id) || []) {
          if (!periodHas(p, d)) continue;
          T.gp++;
          for (const [k, v] of Object.entries(st)) T.s[k] = (T.s[k] || 0) + v;
        }
      }
    }
  }
  return teams;
}

function seasonTotalsCard(L, standings) {
  const id = L.id;
  const S = seasonTot[id];
  if (!S) {
    seasonTot[id] = { state: 'loading' };
    buildSeasonTotals(L).then(teams => { seasonTot[id] = { state: 'ready', teams }; })
      .catch(e => { seasonTot[id] = { state: 'error', msg: e.message }; })
      .finally(() => { if (ui.tab === 'standings' && !ui.season) render(); });
  }
  const head = `<div class="card-head"><h2>Season totals ${infoBtn('totals')}</h2><span class="muted small">from each ${state.lineupMode === 'daily' ? "day's" : "week's"} starting lineups</span></div>`;
  if (!S || S.state === 'loading') return `<div class="card" style="margin-top:16px">${head}<p class="muted small" style="margin:0">Loading every lineup from Fantrax…</p></div>`;
  if (S.state === 'error') return `<div class="card" style="margin-top:16px">${head}<p class="muted small" style="margin:0">Couldn't load season totals (${esc(S.msg)}).</p></div>`;

  // totals of any scored stat, derived ones included
  const tot = (T, k) => (DERIVED[k] ? sum(Object.entries(DERIVED[k]).map(([b, c]) => (T.s[b] || 0) * c)) : T.s[k] || 0);
  const sc = leaguePoints();
  const cols = sc
    ? [...Object.keys(STAT_LABEL).filter(k => sc[k]).map(k => ({ label: STAT_LABEL[k], neg: sc[k] < 0, val: T => tot(T, k), fmt: v => fmt(v, 0) })),
      { label: 'FP', val: T => sum(Object.entries(sc).map(([k, v]) => tot(T, k) * v)), fmt: v => fmt(v, 1) }]
    : scoreCats().map(c => ({ label: c.label, neg: c.neg,
      val: c.pct ? (T => (tot(T, c.att) ? tot(T, c.made) / tot(T, c.att) : 0)) : T => tot(T, c.key),
      fmt: c.pct ? fmtPct : v => fmt(v, c.dec ? 1 : 0) }));
  const order = standings.length ? standings.map(r => r.id) : fxPickable().map(t => t.id);
  const list = order.map(tid => ({ tid, T: S.teams[tid] || { gp: 0, s: {} } }));
  const stats = cols.map(c => {
    const vals = list.map(x => c.val(x.T));
    const m = sum(vals) / vals.length;
    const sd = Math.sqrt(sum(vals.map(v => (v - m) ** 2)) / vals.length) || 1e-9;
    return { vals, z: v => (c.neg ? -1 : 1) * (v - m) / sd, rank: v => 1 + vals.filter(x => (c.neg ? x < v : x > v)).length };
  });
  const avgRank = i => sum(stats.map(st => st.rank(st.vals[i]))) / cols.length;
  // sort by any column: best first (clicking again flips it); standings order until a column is picked
  const so = ui.totSort;
  const sortVal = i => (so.key === 'team' ? (fxTeamName(list[i].tid) || '').toLowerCase() : so.key === 'gp' ? list[i].T.gp
    : so.key === 'rank' ? -avgRank(i) : (cols[so.key].neg ? -1 : 1) * stats[so.key].vals[i]);
  const idx = list.map((x, i) => i);
  if (so.key != null) idx.sort((a, b) => { const x = sortVal(a), y = sortVal(b); return (x < y ? 1 : x > y ? -1 : 0) * so.dir; });
  const th = (key, label, cls = 'num', tip = '') => `<th class="sortable ${cls}${so.key === key ? ' sorted' : ''}" data-action="tot-sort" data-key="${key}"${tip ? ` title="${tip}"` : ''} aria-sort="${so.key === key ? (so.dir > 0 ? 'descending' : 'ascending') : 'none'}">${label}${so.key === key ? (so.dir > 0 ? ' ↓' : ' ↑') : ''}</th>`;
  return `<div class="card" style="margin-top:16px">
    ${head}
    <div class="table-wrap"><table class="season-tot">
      <thead><tr>${th('team', 'Team', '')}${th('gp', 'Player games', 'num', 'Games played by the players in each starting lineup, added up')}${cols.map((c, j) => th(j, c.label)).join('')}${sc ? '' : th('rank', 'Avg rank', 'num', 'Average rank across the categories')}</tr></thead>
      <tbody>${idx.map(i => { const x = list[i]; return `<tr${x.tid === state.fxTeam ? ' class="me-row"' : ''}><td><b>${esc(fxTeamName(x.tid) || '')}</b></td><td class="num muted">${x.T.gp}</td>
        ${cols.map((c, j) => { const v = stats[j].vals[i]; return `<td class="num" style="${shade(stats[j].z(v))}" title="${c.label}: ${ordinal(stats[j].rank(v))} of ${list.length}">${c.fmt(v)}</td>`; }).join('')}
        ${sc ? '' : `<td class="num"><b>${fmt(avgRank(i), 1)}</b></td>`}</tr>`; }).join('')}</tbody>
    </table></div>
  </div>`;
}

/* ---------- Trade ---------- */
function viewTrade() {
  // the other side of the deal is another team's Fantrax roster
  const others = fxPickable().filter(t => t.id !== state.fxTeam);
  if (!others.some(t => t.id === ui.tradeTeam)) { ui.tradeTeam = others.length ? others[0].id : null; ui.tradeGet.clear(); }
  const theirs = ui.tradeTeam ? fxTeamSide(ui.tradeTeam).players : [];
  // prune selections that no longer exist (their players are picked by NBA id: they're rebuilt every render)
  for (const id of ui.tradeGive) if (!state.players.some(p => p.id === id)) ui.tradeGive.delete(id);
  for (const id of ui.tradeGet) if (!theirs.some(p => String(p.nbaId) === id)) ui.tradeGet.delete(id);

  const pick = (list, set, side, key) => list.length ? `<ul class="pick-list">${[...list].sort((a, b) => value(b) - value(a)).map(p => `
    <li><label><input type="checkbox" data-change="trade" data-side="${side}" value="${key(p)}" ${set.has(key(p)) ? 'checked' : ''}>
      <span class="grow">${playerCell(p)}</span>${p.status !== 'Healthy' ? statusBadge(p) : ''}<span class="val">${fmtValue(value(p))}</span></label></li>`).join('')}</ul>`
    : `<p class="muted small">${side === 'get' ? (others.length ? 'This team has no players yet.' : 'Connect a Fantrax league to trade with its teams.') : 'Your roster is empty.'}</p>`;

  const give = [...ui.tradeGive].map(byId).filter(Boolean);
  const get = theirs.filter(p => ui.tradeGet.has(String(p.nbaId)));
  let result = `<div class="empty"><strong>Pick players on both sides</strong>See how the deal changes your team's per-game production.</div>`;

  if (give.length || get.length) {
    const active = state.players.filter(p => !state.il.includes(p.id));
    const before = totals(active);
    const after = totals([...active.filter(p => !ui.tradeGive.has(p.id)), ...get]);
    const vGive = sum(give.map(value)), vGet = sum(get.map(value));
    const diff = vGet - vGive;
    const tradeCats = scoreCats();
    const rows = tradeCats.map(c => {
      const d = after[c.key] - before[c.key];
      const good = c.neg ? d < 0 : d > 0;
      const shown = c.pct ? signed(d * 100, 1) + '%' : signed(d, 1);
      return `<tr><td><b>${c.label}</b></td><td class="num">${c.pct ? fmtPct(before[c.key]) : fmt(before[c.key])}</td><td class="num">${c.pct ? fmtPct(after[c.key]) : fmt(after[c.key])}</td><td class="num ${Math.abs(d) < 1e-9 ? 'muted' : good ? 'pos-good' : 'pos-bad'}">${shown}</td></tr>`;
    }).join('');
    const rosterAfter = activeCount() - give.length + get.length;
    const verdict = Math.abs(diff) < (isPoints() ? 2 : 0.5) ? ['Roughly even', 'muted'] : diff > 0 ? ['You win this trade', 'pos-good'] : ['You lose this trade', 'pos-bad'];
    const won = tradeCats.filter(c => { const d = after[c.key] - before[c.key]; return c.neg ? d < -1e-9 : d > 1e-9; }).length;
    result = `
      <div class="card-head"><div><div class="verdict ${verdict[1]}">${verdict[0]}</div><div class="muted small">${valueLabel()}: give ${fmtValue(vGive)} · get ${fmtValue(vGet)} · net <b>${fmtValue(diff)}</b>${isPoints() ? '' : ` · improves ${won} of ${tradeCats.length} cats`}</div></div></div>
      ${rosterAfter > rosterLimit() ? `<p class="alert warn small" style="margin:0 0 12px">This puts you at ${rosterAfter}/${rosterLimit()} — you'd need to drop ${rosterAfter - rosterLimit()}.</p>` : ''}
      <div class="table-wrap"><table class="delta-table">
        <thead><tr><th>Category</th><th class="num">Now</th><th class="num">After</th><th class="num">Change</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <p class="small muted" style="margin:10px 0 0">Totals are per game across your active (non-IL) roster.</p>`;
  }

  return `
  <div class="trade-grid">
    <div class="card"><div class="card-head"><h2>You give</h2><span class="muted small">${give.length} selected</span></div>${pick(state.players, ui.tradeGive, 'give', p => p.id)}</div>
    <div class="card"><div class="card-head"><h2>You get</h2>${others.length ? `<select class="trade-team" data-change="trade-team" aria-label="Team to trade with">${others.map(t => `<option value="${esc(t.id)}" ${t.id === ui.tradeTeam ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>` : ''}<span class="muted small">${get.length} selected</span></div>${pick(theirs, ui.tradeGet, 'get', p => String(p.nbaId))}</div>
  </div>
  <div class="card" style="margin-top:16px">${result}</div>`;
}

/* ---------- NBA players ---------- */
const PF_SORTS = { val: 'Value', pts: 'PTS', reb: 'REB', ast: 'AST', stl: 'STL', blk: 'BLK', tpm: '3PM', min: 'MIN', games: 'Games left this week' };

function ownedNbaIds() {
  return { roster: new Set(state.players.map(p => p.nbaId).filter(Boolean)) };
}

function filteredPlayers() {
  const f = ui.pf;
  const q = normName(f.q);
  const owned = ownedNbaIds();
  let list = nbaPlayers().filter(p =>
    (!q || normName(p.name).includes(q)) &&
    (!f.pos || p.pos.includes(f.pos)) &&
    (!f.team || p.team === f.team) &&
    (f.show !== 'available' || !owned.roster.has(p.nbaId)) &&
    (f.show !== 'fa' || (fxLeague() ? fxAvailable(nbaById.get(p.nbaId)) : !owned.roster.has(p.nbaId))) &&
    (f.show !== 'injured' || p.inj) &&
    (f.show !== 'healthy' || !p.inj));
  const k = f.sort;
  list = [...list].sort((a, b) => (b[k] - a[k]) || (b.val - a.val));
  return list;
}

function playerRows() {
  const owned = ownedNbaIds();
  const all = filteredPlayers();
  const list = all.slice(0, ui.pf.limit);
  if (!all.length) return `<div class="empty"><strong>No players match</strong>Try a different name or clear the filters.</div>`;
  const rows = list.map((p, i) => {
    const onRoster = owned.roster.has(p.nbaId);
    return `<tr>
      <td class="num muted">${i + 1}</td>
      <td class="player">${playerCell(p, true, false)}</td>
      <td>${statusBadge(p)}</td>
      <td class="num">${p.gp || '—'}</td>${p.gp ? statCells(p) : `<td class="num muted" colspan="11">No NBA stats yet</td>`}
      <td class="num">${p.games}</td>
      <td class="row-actions">${(() => { const raw = nbaById.get(p.nbaId); return raw && raw.fx && !onRoster ? `<span class="badge ${raw.fx.st === 'T' ? '' : 'good'}">${FX_STATUS[raw.fx.st] || raw.fx.st}</span> ` : ''; })()}${onRoster ? '<span class="badge accent">On roster</span>' : ''}</td>
    </tr>`;
  }).join('');
  return `<div class="table-wrap"><table>
    <thead><tr><th class="num">#</th><th>Player</th><th>Status</th><th class="num">GP</th><th class="num">MIN</th><th class="num">PTS</th><th class="num">REB</th><th class="num">AST</th><th class="num">STL</th><th class="num">BLK</th><th class="num">3PM</th><th class="num">TO</th><th class="num">FG%</th><th class="num">FT%</th><th class="num">${valueLabel()}</th><th class="num" title="Games left this week">Wk G</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table></div>
    <div class="list-foot"><span class="muted small">Showing ${list.length} of ${all.length}</span>${all.length > list.length ? '<button class="btn sm" data-action="more-players">Show 50 more</button>' : ''}</div>`;
}

function viewPlayers() {
  if (!NBA) {
    return `<div class="card"><div class="empty"><strong>Loading player data…</strong>If this doesn't load, the data file is missing. Run <code>python scripts/update_data.py</code> and reload.</div></div>`;
  }
  const f = ui.pf;
  const teams = [...new Set(NBA.players.map(p => p.team).filter(Boolean))].sort();
  return `
  ${ui.viewing ? '' : recommendedCard()}
  <div class="card">
    <div class="card-head"><h2>${f.show === 'fa' ? 'Available players' : 'NBA players'} ${infoBtn('projection')}</h2><span class="muted small">${BASIS_LABELS[state.basis]} stats</span>${LOCAL ? '<button class="btn sm" data-action="refresh-data">Refresh stats</button>' : ''}</div>
    <div class="filters">
      <label class="field grow" for="pfQ">Search<input id="pfQ" type="search" placeholder="Player name" value="${esc(f.q)}" data-input="pf" data-key="q" autocomplete="off"></label>
      <label class="field" for="pfPos">Position<select id="pfPos" data-change="pf" data-key="pos"><option value="">All</option>${POSITIONS.map(x => `<option ${f.pos === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <label class="field" for="pfTeam">Team<select id="pfTeam" data-change="pf" data-key="team"><option value="">All</option>${teams.map(t => `<option ${f.team === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="field" for="pfShow">Show<select id="pfShow" data-change="pf" data-key="show">${[['fa', 'Available'], ['all', 'Every NBA player'], ['available', 'Not on my roster'], ['healthy', 'Healthy only'], ['injured', 'Injured only']].map(([v, l]) => `<option value="${v}" ${f.show === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field" for="pfSort">Sort by<select id="pfSort" data-change="pf" data-key="sort">${Object.entries(PF_SORTS).map(([v, l]) => `<option value="${v}" ${f.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    <div id="playerResults">${playerRows()}</div>
  </div>`;
}

// ----- Recommended adds -----
// How far your team is from the league average in each category, in team-to-team spreads (+ is good)
function catGaps() {
  const raws = [teamRaw(state.players.filter(p => !state.il.includes(p.id)))];
  for (const t of fxPickable()) {
    if (t.id === state.fxTeam) continue;
    const side = fxTeamSide(t.id);
    const ps = side.players.filter(p => !side.il.includes(p.id));
    if (ps.length) raws.push(teamRaw(ps));
  }
  const out = {};
  for (const c of scoreCats()) {
    const vals = raws.map(r => r[c.key]);
    const m = sum(vals) / vals.length;
    const sd = Math.sqrt(sum(vals.map(v => (v - m) ** 2)) / vals.length) || 1e-9;
    out[c.key] = (c.neg ? -1 : 1) * (vals[0] - m) / sd;
  }
  return out;
}

// When the league's playoffs start (Fantrax's first playoff period), else the last few weeks of the season
function playoffStart(L = fxLeague()) {
  const per = (L && L.periods) || [];
  const p = L && L.playoffPeriod ? per.find(x => x.n === L.playoffPeriod) : per[per.length - 3];
  return p ? p.start : null;
}

// Up to three free agents worth adding, each against the player they'd replace (none with an open spot).
// Points leagues go by fantasy points per game; in cats, your weak categories count extra and strong ones less.
// With an open IR spot and nobody to put there, also the best injured free agent due back before the playoffs.
function recommendedAdds() {
  if (!NBA || !state.players.length) return null;
  const act = state.players.filter(p => !state.il.includes(p.id));
  const w = isPoints() ? null : Object.fromEntries(Object.entries(catGaps()).map(([k, g]) => [k, Math.max(0.5, Math.min(1.5, 1 - 0.25 * g))]));
  const worth = p => (w ? sum(scoreCats().map(c => (catZ(p)[c.key] || 0) * w[c.key])) : fantasyPoints(p));
  const open = activeCount() < rosterLimit();
  const drop = open || !act.length ? null : act.reduce((a, b) => (worth(a) <= worth(b) ? a : b));
  const base = drop ? worth(drop) : -Infinity;
  const pool = nbaPlayers()
    .filter(x => x.gp && (fxLeague() ? fxAvailable(nbaById.get(x.nbaId)) : !state.players.some(p => p.nbaId === x.nbaId)))
    .sort((a, b) => b.val - a.val).slice(0, 120)
    .map(x => playerFromRaw(nbaById.get(x.nbaId)));
  const helps = p => (w && drop ? scoreCats().filter(c => (catZ(p)[c.key] || 0) - (catZ(drop)[c.key] || 0) > 0.5).map(c => c.label) : []);
  const adds = pool.filter(p => p.status !== 'Out')
    .map(p => ({ p, gain: worth(p) - base, helps: helps(p) }))
    .filter(x => x.gain > 0).sort((a, b) => b.gain - a.gain).slice(0, 3);

  let stash = null;
  const ends = playoffStart(), today = todayIso();
  if (state.il.length < state.ilSize && !act.some(p => p.status === 'Out') && ends) {
    const best = pool.filter(p => p.status === 'Out' && p.inj && p.inj.back && p.inj.back > today && p.inj.back < ends && worth(p) > base)
      .sort((a, b) => worth(b) - worth(a))[0];
    if (best) stash = { p: best, back: best.inj.back, ends };
  }
  return { adds, drop, stash };
}

function recommendedCard() {
  const r = recommendedAdds();
  if (!r) return '';
  const fx = p => { const raw = nbaById.get(p.nbaId); return raw && raw.fx ? `<span class="badge good">${FX_STATUS[raw.fx.st] || raw.fx.st}</span>` : ''; };
  const gainTxt = g => (isPoints() ? `${signed(g, 1)} FP/G` : `${signed(g, 1)} value`);
  const rows = r.adds.map(x => `<li class="rec">
      <div class="rec-who">${playerCell(x.p)}</div>
      <div class="rec-why">${fx(x.p)} ${r.drop ? `<span>for ${inlinePlayer(r.drop, esc(r.drop.name))}</span> <b class="pos-good">${gainTxt(x.gain)}</b>` : '<span>open roster spot</span>'}${x.helps.length ? `<div class="muted small">helps ${x.helps.join(', ')}</div>` : ''}</div>
    </li>`);
  if (r.stash) rows.push(`<li class="rec">
      <div class="rec-who">${playerCell(r.stash.p)}</div>
      <div class="rec-why">${fx(r.stash.p)} <span class="badge">IR stash</span> <span>back about <b>${fmtDay(r.stash.back)}</b></span>
        <div class="muted small">For your open IR spot, no drop needed. Expected back before the playoffs (${fmtDay(r.stash.ends)}), per ESPN.</div></div>
    </li>`);
  return `<div class="card">
    <div class="card-head"><h2>Recommended adds</h2><span class="muted small">${isPoints() ? 'by fantasy points per game' : 'weighted toward your weaker categories'}</span></div>
    ${rows.length ? `<ul class="recs">${rows.join('')}</ul>` : `<p class="muted small" style="margin:0">No free agent is better than ${r.drop ? esc(r.drop.name) + ', your weakest player' : 'anyone on your roster'}.</p>`}
  </div>`;
}

function showPlayerDetail(nbaId) {
  const raw = nbaById.get(nbaId);
  if (!raw) return;
  const owned = ownedNbaIds();
  const t = teamInfo(raw.team);
  const lines = [['Projection', 'Proj', nbaStats(raw)], [NBA.season, String(NBA.season).slice(2), statObj(raw.cur)], ['Last 10', 'L10', statObj(raw.l10)], [NBA.prevSeason, String(NBA.prevSeason).slice(2), statObj(raw.prev)]]
    .filter(([, , s]) => s && s.gp);
  // phones: stats down the side, seasons across
  const AVG = [['GP', s => Math.round(s.gp)], ['MIN', s => fmt(s.min, 1)], ['PTS', s => fmt(s.pts)], ['REB', s => fmt(s.reb)], ['AST', s => fmt(s.ast)], ['STL', s => fmt(s.stl)], ['BLK', s => fmt(s.blk)], ['3PM', s => fmt(s.tpm)], ['TO', s => fmt(s.to)], ['FG%', s => fmtPct(s.fga ? s.fgm / s.fga : 0)], ['FT%', s => fmtPct(s.fta ? s.ftm / s.fta : 0)]];
  const avgNarrow = lines.length ? `<table class="pc-avg show-sm"><thead><tr><th></th>${lines.map(([, short]) => `<th class="num">${esc(short)}</th>`).join('')}</tr></thead>
    <tbody>${AVG.map(([label, f]) => `<tr><td><b>${label}</b></td>${lines.map(([, , st]) => `<td class="num">${f(st)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '';
  const rows = lines.map(([l, , s]) => [l, s])
    .map(([l, s]) => `<tr><td><b>${l}</b></td><td class="num">${Math.round(s.gp)}</td><td class="num">${fmt(s.min, 1)}</td><td class="num">${fmt(s.pts)}</td><td class="num">${fmt(s.reb)}</td><td class="num">${fmt(s.ast)}</td><td class="num">${fmt(s.stl)}</td><td class="num">${fmt(s.blk)}</td><td class="num">${fmt(s.tpm)}</td><td class="num">${fmt(s.to)}</td><td class="num">${fmtPct(s.fga ? s.fgm / s.fga : 0)}</td><td class="num">${fmtPct(s.fta ? s.ftm / s.fta : 0)}</td></tr>`).join('');
  const games = (raw.log || []).map(g => { const o = {}; NBA.logKeys.forEach((k, i) => { o[k] = g[i]; }); return o; });
  // phones: each game as a short block
  const gamesNarrow = games.length ? `<ul class="pc-games show-sm">${games.map(o => `<li>
      <div class="pc-g-top"><b>${esc(fmtDay(o.date))}</b>${o.type === 'PRE' ? ' <span class="badge">Pre</span>' : ''} <span class="muted">${esc(o.matchup)}</span>${o.wl ? ` <span class="badge ${o.wl === 'W' ? 'good' : 'bad'}">${o.wl}</span>` : ''}<span class="pc-g-min">${Math.round(o.min)} min</span></div>
      <div>${[`${o.pts} PTS`, `${o.reb} REB`, `${o.ast} AST`, `${o.stl} STL`, `${o.blk} BLK`, `${o.tpm} 3PM`, `${o.to} TO`].map(x => `<span>${x}</span>`).join(' · ')}</div>
      <div class="muted">${o.fgm}-${o.fga} FG · ${o.ftm}-${o.fta} FT</div></li>`).join('')}</ul>` : '';
  const logs = (raw.log || []).map(g => {
    const o = {}; NBA.logKeys.forEach((k, i) => { o[k] = g[i]; });
    return `<tr><td>${esc(fmtDay(o.date))}${o.type === 'PRE' ? ' <span class="badge">Pre</span>' : ''}</td><td>${esc(o.matchup)}</td><td>${o.wl ? `<span class="badge ${o.wl === 'W' ? 'good' : 'bad'}">${o.wl}</span>` : ''}</td><td class="num">${o.min}</td><td class="num">${o.pts}</td><td class="num">${o.reb}</td><td class="num">${o.ast}</td><td class="num">${o.stl}</td><td class="num">${o.blk}</td><td class="num">${o.tpm}</td><td class="num">${o.to}</td><td class="num">${o.fgm}-${o.fga}</td><td class="num">${o.ftm}-${o.fta}</td></tr>`;
  }).join('');
  const onRoster = owned.roster.has(raw.id);
  $('#detailBody').innerHTML = `
    <div class="detail-head">
      <div class="detail-id">${headshot({ nbaId: raw.id, name: raw.name }, 64)}<div><h2>${esc(raw.name)}</h2><p class="muted" style="margin:2px 0 0">${teamLogo(raw.team, 18)} ${esc(raw.team)}${raw.jersey ? ' · #' + esc(raw.jersey) : ''} · ${posTags(raw.pos)} (NBA: ${esc(raw.nbaPos || '—')}) · ${raw.exp ? raw.exp + ' yrs in league' : 'Rookie'}</p></div></div>
      <div>${raw.inj ? `<span class="badge ${raw.inj.status === 'Out' ? 'bad' : 'warn'}">${esc(raw.inj.label)}</span>` : '<span class="badge good">Healthy</span>'}</div>
    </div>
    ${raw.inj ? `<div class="alert ${raw.inj.status === 'Out' ? 'bad' : 'warn'}" style="margin-top:12px"><span class="dot"></span><span class="grow small">${esc(raw.inj.note)} <span class="muted">${raw.inj.date ? fmtDay(raw.inj.date) : ''} · ESPN</span></span></div>` : ''}
    <div class="proj-grid" style="margin-top:12px">
      <div class="proj"><div class="k">Next game</div><div class="v">${t && t.next ? nextGame(t.next) : '—'}</div></div>
      <div class="proj"><div class="k">Games left this week</div><div class="v">${t ? t.left : '—'}</div></div>
      <div class="proj"><div class="k">${valueLabel()}</div><div class="v">${(() => { const s = nbaStats(raw); return s && s.gp ? fmtValue(value({ ...s, pos: raw.pos })) : '—'; })()}</div></div>
    </div>
    <h3 class="sub" style="margin-top:16px">Per-game averages</h3>
    ${avgNarrow}${rows ? `<div class="table-wrap hide-sm"><table><thead><tr><th></th><th class="num">GP</th><th class="num">MIN</th><th class="num">PTS</th><th class="num">REB</th><th class="num">AST</th><th class="num">STL</th><th class="num">BLK</th><th class="num">3PM</th><th class="num">TO</th><th class="num">FG%</th><th class="num">FT%</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted small">No NBA regular-season stats yet.</p>'}
    <h3 class="sub" style="margin-top:16px">Recent games</h3>
    ${gamesNarrow}${logs ? `<div class="table-wrap hide-sm"><table><thead><tr><th>Date</th><th>Matchup</th><th></th><th class="num">MIN</th><th class="num">PTS</th><th class="num">REB</th><th class="num">AST</th><th class="num">STL</th><th class="num">BLK</th><th class="num">3PM</th><th class="num">TO</th><th class="num">FG</th><th class="num">FT</th></tr></thead><tbody>${logs}</tbody></table></div>` : '<p class="muted small">No games played yet this season.</p>'}`;
  $('#detailFoot').innerHTML = `
    <button type="button" class="btn ghost" data-action="close-detail">Close</button>
    ${onRoster ? '<span class="badge accent">On your roster</span>' : ''}`;
  const d = $('#detailDialog');
  if (!d.open) d.showModal();
}

/* ---------- Matchups (matchup projector) ---------- */
function oddsLabel(p) {
  return p >= 0.9 ? ['Locked', 'good'] : p >= 0.7 ? ['Likely win', 'good'] : p >= 0.55 ? ['Lean win', 'good'] : p > 0.45 ? ['Toss-up', ''] : p > 0.3 ? ['Lean loss', 'bad'] : p > 0.1 ? ['Likely loss', 'bad'] : ['Punt', 'bad'];
}

function fmtCat(c, v) { return c.pct ? fmtPct(v) : fmt(v, 0); }

// Everything the week page (and pickup ideas) needs, computed once per render
function weekContext(start = weekStart()) {
  const dates = matchDates(start);
  const weekly = state.lineupMode === 'weekly';
  const mine = state.players.filter(p => !state.il.includes(p.id));
  const opp = state.opp.players;
  const hasOpp = opp.length > 0;
  const setIds = new Set(state.lineup.filter(Boolean));
  const oppIds = weekly ? oppStarterIds(dates) : null;
  const them = projectSide(opp, dates, oppIds);
  const asSet = projectSide(mine, dates, setIds);
  const locked = weekly && new Date() >= lockTime(start);
  const bestIds = weekly && !locked ? bestWeeklyIds(mine, dates, hasOpp ? them : null) : null;
  const best = weekly && !bestIds ? asSet : projectSide(mine, dates, bestIds);
  const catsSet = compareCats(asSet, them), catsBest = compareCats(best, them);
  return { start, dates, weekly, locked, mine, opp, hasOpp, setIds, oppIds, them, asSet, bestIds, best, catsSet, catsBest, oSet: matchOdds(catsSet), oBest: matchOdds(catsBest) };
}

function catValue(proj, c) {
  if (c.fp) return fpTotals(proj).a;
  if (!c.pct) return totStat(proj, c.key);
  return proj.tot[c.att] ? proj.tot[c.made] / proj.tot[c.att] : 0;
}
const fmtCatDelta = (c, d) => (c.pct ? (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(3).replace(/^0/, '') : signed(d, Math.abs(d) < 10 ? 1 : 0));
const pctTxt = p => `${Math.round(p * 100)}%`;
// a change in the matchup goal: categories won, or projected fantasy points
const goalDelta = v => (isPoints() ? `${signed(v, 1)} FP` : `${signed(v, 2)} cats`);
const weekGames = (p, dates) => (p.status === 'Out' ? 0 : gamesIn(p, dates));
function gamesLeftTip(p, dates) {
  const played = dates.filter(d => playsOn(p, d) && gameFinal(p, d) && actualLine(p, d)).length;
  const left = dates.filter(d => playsOn(p, d) && !gameFinal(p, d)).length;
  return `${played} played, ${p.status === 'Out' ? 0 : left} left this week`;
}

// What changes, category by category, when your starters go from fromIds to toIds
function explainChange(ctx, fromIds, toIds, outP, inP) {
  const a = projectSide(ctx.mine, ctx.dates, fromIds), b = projectSide(ctx.mine, ctx.dates, toIds);
  const ca = compareCats(a, ctx.them), cb = compareCats(b, ctx.them);
  const oa = matchOdds(ca), ob = matchOdds(cb);
  const rows = ca.map((c, i) => {
    const d = catValue(b, c) - catValue(a, c);
    return { c, d, good: c.neg ? d < 0 : d > 0, pA: ca[i].p, pB: cb[i].p };
  });
  const score = ctx.hasOpp ? objective(ob) - objective(oa)
    : (inP ? weeklyPriority(inP, ctx.dates) : 0) - (outP ? weeklyPriority(outP, ctx.dates) : 0);
  return { outP, inP, toIds, rows, score, dExp: ob.expected - oa.expected, dWin: ob.win - oa.win, dGames: b.games - a.games };
}

// Break the suggested lineup into one-for-one swaps, best first
function pairSwaps(ctx) {
  if (!ctx.bestIds) return { steps: [], rest: null };
  let cur = new Set(ctx.setIds);
  const steps = [];
  for (let guard = 0; guard < 10; guard++) {
    const ins = [...ctx.bestIds].filter(id => !cur.has(id));
    if (!ins.length) break;
    const outs = [...cur].filter(id => !ctx.bestIds.has(id));
    let pick = null;
    for (const inId of ins) {
      const options = [...outs];
      if (cur.size < state.slots.length) options.push(null); // fill an empty slot
      for (const outId of options) {
        const trial = new Set(cur);
        if (outId) trial.delete(outId);
        trial.add(inId);
        if (!fitsSlots(trial, ctx.mine)) continue;
        const ex = explainChange(ctx, cur, trial, outId ? byId(outId) : null, byId(inId));
        if (!pick || ex.score > pick.score) pick = ex;
      }
    }
    if (!pick) break;
    steps.push(pick);
    cur = pick.toIds;
  }
  const done = [...ctx.bestIds].every(id => cur.has(id)) && cur.size === ctx.bestIds.size;
  return { steps, rest: done ? null : explainChange(ctx, cur, ctx.bestIds, null, null) };
}

// Next-best single swaps from the suggested lineup, so you can see why they lost out
function nearMisses(ctx, base) {
  const out = [];
  for (const b of ctx.mine) {
    if (base.has(b.id) || b.status === 'Out' || !gamesIn(b, ctx.dates)) continue;
    let bestFor = null;
    for (const sId of base) {
      const trial = new Set(base); trial.delete(sId); trial.add(b.id);
      if (!fitsSlots(trial, ctx.mine)) continue;
      const ex = explainChange(ctx, base, trial, byId(sId), b);
      if (!bestFor || ex.score > bestFor.score) bestFor = ex;
    }
    if (bestFor) out.push(bestFor);
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 3);
}

function whySentence(ex, ctx) {
  const parts = [];
  const gi = ex.inP ? weekGames(ex.inP, ctx.dates) : 0, go = ex.outP ? weekGames(ex.outP, ctx.dates) : 0;
  const inN = ex.inP ? esc(lastName(ex.inP.name)) : '', outN = ex.outP ? esc(lastName(ex.outP.name)) : '';
  if (ex.inP && ex.outP) {
    parts.push(gi > go ? `${inN} plays ${gi} games to ${outN}'s ${go}.` : gi === go ? `Both play ${gi} games, so it comes down to fit.` : `${inN} plays fewer games (${gi} vs ${go}) but helps where this matchup is close.`);
  } else if (ex.inP) parts.push(`Fills an open slot with ${gi} more games.`);
  if (ctx.hasOpp && isPoints()) {
    const fp = ex.rows.find(r => r.c.fp);
    if (fp) parts.push(`${signed(fp.d, 1)} projected points, ${pctTxt(fp.pA)}→${pctTxt(fp.pB)} to win.`);
  } else if (ctx.hasOpp) {
    const lifts = ex.rows.filter(r => r.pB - r.pA > 0.015).sort((x, y) => (y.pB - y.pA) - (x.pB - x.pA)).slice(0, 3);
    const costs = ex.rows.filter(r => r.pA - r.pB > 0.015).sort((x, y) => (y.pA - y.pB) - (x.pA - x.pB)).slice(0, 2);
    if (lifts.length) parts.push(`Biggest lift: ${lifts.map(r => `${r.c.label} ${pctTxt(r.pA)}→${pctTxt(r.pB)}`).join(', ')}.`);
    if (costs.length) parts.push(`Costs: ${costs.map(r => `${r.c.label} ${pctTxt(r.pA)}→${pctTxt(r.pB)}${r.pB >= 0.7 ? ' (still safe)' : r.pB <= 0.3 ? ' (likely lost anyway)' : ''}`).join(', ')}.`);
    if (!costs.length && lifts.length) parts.push('No category gets worse in a way that matters.');
  }
  return parts.join(' ');
}

function catChips(ex) {
  return `<div class="cat-chips">${ex.rows.map(r => {
    // in points leagues only total points decide the week, so only FP shows a win chance
    const moved = Math.abs(r.pB - r.pA) >= 0.01 && (!isPoints() || r.c.fp);
    const cls = Math.abs(r.d) < 1e-6 ? '' : r.good ? 'good' : 'bad';
    return `<span class="cchip ${cls}"><b>${r.c.label}</b> ${fmtCatDelta(r.c, r.d)}${moved ? `<span class="cchip-p">${pctTxt(r.pA)}→${pctTxt(r.pB)}</span>` : ''}</span>`;
  }).join('')}</div>`;
}

function swapBlock(ex, ctx, kind) {
  const g = p => `<span class="muted small">${posTags(p.pos)} · ${weekGames(p, ctx.dates)} G</span>`;
  const net = ctx.hasOpp
    ? `<span class="swap-net ${ex.score >= 0 ? 'pos-good' : 'pos-bad'}">${isPoints() || matchupScoring() === 'most' ? `${signed(ex.dWin * 100, 1)}% win · ${goalDelta(ex.dExp)}` : `${signed(ex.dExp, 2)} cats · ${signed(ex.dWin * 100, 1)}% win`}</span>`
    : `<span class="swap-net ${ex.dGames >= 0 ? 'pos-good' : 'pos-bad'}">${signed(ex.dGames, 0)} games</span>`;
  const head = ex.inP
    ? `<span class="swap-in">↑ Start <b>${esc(ex.inP.name)}</b> ${g(ex.inP)}</span>${ex.outP ? `<span class="swap-out">↓ Bench <b>${esc(ex.outP.name)}</b> ${g(ex.outP)}</span>` : ''}`
    : '<span class="swap-in">Other moves needed to fit everyone into slots</span>';
  return `<div class="swap ${kind}"><div class="swap-head">${head}${net}</div>${catChips(ex)}<p class="small swap-why">${whySentence(ex, ctx)}</p></div>`;
}

// Either night of a back-to-back (the team also plays the day before or after)
const isB2B = (p, d) => playsOn(p, d) && (playsOn(p, addDays(d, -1)) || playsOn(p, addDays(d, 1)));

// A played game well under his usual minutes, and the likely reason: an injury (he's been on the injury
// report since that game), a blowout, foul trouble, or unknown. Null for a normal game.
function shortMinutes(p, line, d) {
  const usual = p.min || 0;
  if (usual < 20 || line.min > usual * 0.7 || usual - line.min < 8) return null;
  const why = [];
  if (p.inj && p.inj.date && p.inj.date >= d) {
    const note = p.inj.note ? `: ${p.inj.note.length > 90 ? p.inj.note.slice(0, 90) + '…' : p.inj.note}` : '';
    why.push(`injury (listed ${p.inj.label} since ${fmtDay(p.inj.date)}${note})`);
  }
  if (Math.abs(line.margin) >= 20) why.push(`blowout (${line.margin > 0 ? 'won' : 'lost'} by ${Math.abs(line.margin)})`);
  if (line.pf >= 5) why.push(`foul trouble (${line.pf} fouls)`);
  return why.length ? why.join(' and ') : "fewer minutes than usual, with no blowout, foul trouble or injury report (maybe the coach's call)";
}

// A played game's box score for the tooltip: minutes, the stat line, shooting, and fantasy points in points leagues
function gameTip(p, line, d, bench) {
  const short = shortMinutes(p, line, d);
  return `<div class="tip-head">${Math.round(line.min)} min${bench ? ' <span class="tip-tag">bench, didn\'t count</span>' : ''}</div>
    <div>${line.pts} PTS · ${line.reb} REB · ${line.ast} AST</div>
    <div>${line.stl} STL · ${line.blk} BLK · ${line.tpm} 3PM · ${line.to} TO</div>
    <div class="tip-dim">${line.fgm}-${line.fga} FG · ${line.ftm}-${line.fta} FT</div>
    ${isPoints() ? `<div class="tip-head">${fmt(lineFp(line), 1)} FP</div>` : ''}
    ${short ? `<div class="tip-warn">Usually ${Math.round(p.min)} min: ${esc(short)}</div>` : ''}`;
}

function dayDots(p, ctx, counts) {
  const dot = (cls, tip) => `<i class="${cls}" data-tip="${esc(tip)}"></i>`;
  return `<span class="dots">${ctx.dates.map(d => {
    if (!playsOn(p, d)) return dot('none', 'No game');
    const bench = counts ? '' : ' bench';
    if (gameFinal(p, d)) {
      const line = actualLine(p, d);
      if (!line) return dot('dnp', "His team played, but he didn't");
      return dot(`done${bench}${shortMinutes(p, line, d) ? ' short' : ''}`, gameTip(p, line, d, bench));
    }
    if (p.status === 'Out') return dot('out', `Upcoming, but he's listed Out${p.inj && p.inj.note ? `<div class="tip-dim">${esc(p.inj.note)}</div>` : ''}`);
    const b2b = isB2B(p, d);
    return dot(`up${bench}${b2b ? ' b2b' : ''}`, `Upcoming game${b2b ? ', on a back-to-back' : ''}${bench ? '<div class="tip-dim">On the bench, so it won\'t count</div>' : ''}`);
  }).join('')}</span>`;
}

// ----- Tooltips: any element with data-tip (trusted HTML) shows a readable box on hover, focus or tap -----
const tipEl = $('#tip');
function showTip(el) {
  tipEl.innerHTML = el.dataset.tip;
  tipEl.hidden = false;
  const r = el.getBoundingClientRect(), t = tipEl.getBoundingClientRect();
  const left = Math.max(8, Math.min(window.innerWidth - t.width - 8, r.left + r.width / 2 - t.width / 2));
  const above = r.top - t.height - 8;
  tipEl.style.left = `${left}px`;
  tipEl.style.top = `${above >= 8 ? above : r.bottom + 8}px`;
}
const hideTip = () => { tipEl.hidden = true; };
document.addEventListener('mouseover', e => { const el = e.target.closest('[data-tip]'); if (el) showTip(el); else if (!tipEl.hidden) hideTip(); });
document.addEventListener('focusin', e => { const el = e.target.closest('[data-tip]'); if (el) showTip(el); });
document.addEventListener('click', e => { const el = e.target.closest('[data-tip]'); if (el) showTip(el); else hideTip(); }, true);
window.addEventListener('scroll', hideTip, { passive: true });

// ----- Lineups board views: schedule dots, or category stats shaded by contribution -----
const BOARD_KEY = 'courtside-board';
ui.boardMode = (() => { try { return localStorage.getItem(BOARD_KEY) || 'sched'; } catch (e) { return 'sched'; } })();

// Smooth shading: strength grows with the size of the contribution, so close values look alike
function shade(z) {
  if (!Number.isFinite(z) || Math.abs(z) < 0.2) return '';
  const pct = Math.round(Math.min(Math.abs(z) / 2.5, 1) * 50);
  return `background: color-mix(in srgb, var(${z > 0 ? '--good' : '--bad'}) ${pct}%, transparent);${Math.abs(z) >= 1.5 ? ' font-weight: 700;' : ''}`;
}
const shadeProb = p => shade((p - 0.5) * 5); // 90% to win ≈ as strong as a +2 contribution

// How much a player helps (+) or hurts (−) a category. Per game: vs an average rostered
// player. Week total: the player's weekly number vs an average starter's week (~3.5 games),
// so the same weekly total always gets the same shade. FG%/FT% count shot volume.
const WEEK_GAMES = 3.5;
function contribZ(p, key, g, week) {
  if (key === 'fp') {
    const [m, sd] = fpBase();
    return week ? (fantasyPoints(p) * g - m * WEEK_GAMES) / (sd * WEEK_GAMES) : (fantasyPoints(p) - m) / sd;
  }
  if (!BASE[key]) return 0;
  if (!week) return catZ(p)[key] || 0;
  const c = scoreCats().find(x => x.key === key) || catDef(key);
  if (c.pct) { const att = statVal(p, c.att); return att ? (pctOf(p, c) - BASE[key][0]) * att * g / (BASE[key][1] * WEEK_GAMES) : 0; }
  const z = (statVal(p, key) * g - BASE[key][0] * WEEK_GAMES) / (BASE[key][1] * WEEK_GAMES);
  return c.neg ? -z : z;
}

function boardModes() {
  const opts = [['sched', 'Schedule'], ['game', 'Per game'], ['week', 'Week total']];
  return `<div class="seg seg-sm" role="group" aria-label="Lineup view">${opts.map(([k, l]) => `<button type="button" class="${ui.boardMode === k ? 'on' : ''}" data-action="board-mode" data-mode="${k}" aria-pressed="${ui.boardMode === k}">${l}</button>`).join('')}</div>`;
}

// How many active NBA players share each short form of a name, so short names never hide who's who
const nameUses = new Map();
function countNames() {
  nameUses.clear();
  const bump = k => nameUses.set(k, (nameUses.get(k) || 0) + 1);
  for (const raw of NBA.players) { bump('s:' + normName(lastName(raw.name, true))); bump('i:' + normName(shortName(raw.name, true))); }
}
const clashes = (kind, short) => (nameUses.get(kind + normName(short)) || 0) > 1;

// Surname without suffixes: "Trey Murphy III" -> "Murphy". Shared surnames get the initial
// ("D. Murray", "J. Murray"), and the full name if that's shared too.
function lastName(name, plain) {
  const parts = String(name).split(' ').filter(w => !/^(jr\.?|sr\.?|ii|iii|iv|v)$/i.test(w));
  const last = parts[parts.length - 1] || String(name);
  if (plain || !clashes('s:', last)) return last;
  const init = parts.length > 1 ? `${parts[0][0]}. ${last}` : last;
  return clashes('i:', shortName(name, true)) ? String(name) : init;
}

// "Jaime Jaquez Jr." -> "J. Jaquez Jr." for tight spaces on phones; the full name if another player shortens the same way
function shortName(name, plain) {
  const parts = String(name).split(' ');
  const short = parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(' ')}` : String(name);
  return plain || !clashes('i:', short) ? short : String(name);
}

function playerName(p) {
  const label = `<span class="n-full">${esc(p.name)}</span><span class="n-short">${esc(shortName(p.name))}</span>`;
  return p.nbaId ? `<button class="link-btn pname" data-action="player-detail" data-nba="${p.nbaId}" title="${esc(p.name)}">${label}</button>` : `<span class="pname">${label}</span>`;
}

// ↑ Start / ↓ Bench hints on your players
function rowTags(p, ctx, side, starter) {
  if (side === 'me') {
    if (!ctx.bestIds) return '';
    if (starter && !ctx.bestIds.has(p.id)) return '<span class="tag down">↓ Bench</span>';
    if (!starter && ctx.bestIds.has(p.id)) return '<span class="tag up">↑ Start</span>';
    return '';
  }
  return '';
}

// Schedule view: one cell per player, slot-aligned with the opponent
function boardCell(p, ctx, side, starter) {
  if (!p) return `<td class="bcell"><span class="muted small">${side === 'them' && !ctx.hasOpp ? '' : 'Empty'}</span></td>`;
  const tags = rowTags(p, ctx, side, starter);
  return `<td class="bcell${starter ? '' : ' bench'}"><div class="bplayer">${headshot(p, matchMedia('(max-width: 640px)').matches ? 22 : 28)}<div class="bmain"><div class="bname">${playerName(p)}${p.status !== 'Healthy' ? ' ' + statusBadge(p) : ''}${tags ? ' ' + tags : ''}</div>
    <div class="bmeta"><span class="bmeta-info">${teamLogo(p.team)} ${posTags(p.pos)}</span>${dayDots(p, ctx, starter)}<b class="bmeta-g" data-tip="${esc(gamesLeftTip(p, ctx.dates))}">${weekGames(p, ctx.dates)}G</b></div></div></div></td>`;
}

// ----- Per game / Week total: two sortable stat tables side by side -----
ui.statSort = { key: 'slot', dir: 1 };

function statSortValue(p, ctx, key) {
  const g = weekGames(p, ctx.dates);
  if (key === 'name') return p.name.toLowerCase();
  if (key === 'g') return g;
  // categories sort by contribution, so "best first" works for TO and the percentages too
  return contribZ(p, key, g, ui.boardMode === 'week');
}

function sortStatRows(list, ctx) {
  const { key, dir } = ui.statSort;
  if (key === 'slot') return list;
  return [...list].sort((a, b) => {
    const x = statSortValue(a, ctx, key), y = statSortValue(b, ctx, key);
    return (x < y ? -1 : x > y ? 1 : 0) * dir;
  });
}

// Hover text with the unrounded numbers behind a stat cell
function statTip(p, c, g, week) {
  const games = `${g} game${g === 1 ? '' : 's'}`;
  if (c.pct) {
    const [m, a] = [statVal(p, c.made), statVal(p, c.att)];
    const k = week ? g : 1;
    return `${c.label}: ${(pctOf(p, c) * 100).toFixed(1)}% · ${(m * k).toFixed(1)}/${(a * k).toFixed(1)} ${week ? `over ${games}` : 'per game'}`;
  }
  const v = statOf(p, c);
  return week ? `${c.label}: ${(v * g).toFixed(1)} (${v.toFixed(2)} × ${games})` : `${c.label}: ${v.toFixed(2)} per game`;
}

// Projected-week totals, unrounded, with the matching win chance
function totalTip(c, v, p, who) {
  const amount = c.pct ? `${(v * 100).toFixed(1)}%` : v.toFixed(1);
  return `${c.label}: ${amount} · ${pctTxt(p)} ${who}`;
}

function stabCells(p, ctx) {
  const g = weekGames(p, ctx.dates);
  const week = ui.boardMode === 'week';
  const noStats = !p.min && !p.pts && !p.reb; // e.g. a player with no NBA stats on record
  return scoreCats().map(c => {
    const none = noStats || (week && !g);
    const v = none ? '—' : c.pct ? fmtPct(pctOf(p, c)) : fmt(statOf(p, c) * (week ? g : 1), c.dec && !week ? c.dec : week ? (c.dec ? 1 : 0) : 1);
    return `<td class="sc" style="${none ? '' : shade(contribZ(p, c.key, g, week))}" title="${none ? `${c.label}: no projection` : statTip(p, c, g, week)}">${v}</td>`;
  }).join('');
}

function statRow(p, ctx, side, starter) {
  // opponent start/bench/remove buttons stay on the Schedule view to keep these tables clean
  const tags = side === 'me' ? rowTags(p, ctx, side, starter) : '';
  return `<tr class="${starter ? '' : 'bench'}"><td class="st-name"><div class="bplayer">${headshot(p, 24)}<div class="bmain"><div class="bname">${playerName(p)}${p.status !== 'Healthy' ? ' ' + statusBadge(p) : ''}${tags ? ' ' + tags : ''}</div></div></div></td>
    <td class="num st-g">${weekGames(p, ctx.dates)}</td>${stabCells(p, ctx)}</tr>`;
}

function statTable(ctx, side, title, rows, { bench = false, totals = '', games = 0 } = {}) {
  const s = ui.statSort;
  const th = (key, label, cls = '') => {
    const on = s.key === key;
    return `<th class="sortable ${cls} ${on ? 'sorted' : ''}" data-action="stat-sort" data-key="${key}" aria-sort="${on ? (s.dir > 0 ? 'ascending' : 'descending') : 'none'}">${label}${on && key !== 'slot' ? (s.dir > 0 ? ' ↑' : ' ↓') : ''}</th>`;
  };
  return `<table class="stab">
    <thead><tr>${th('name', bench ? `${esc(title)} <span class="muted">bench</span>` : esc(title), 'st-name')}${th('g', 'G', 'num')}${scoreCats().map(c => th(c.key, c.label, 'sc')).join('')}</tr></thead>
    <tbody>${sortStatRows(rows, ctx).map(p => statRow(p, ctx, side, !bench)).join('') || `<tr><td colspan="11" class="muted small">${bench ? 'Nobody on the bench' : side === 'them' ? 'No opponent loaded' : 'No starters'}</td></tr>`}</tbody>
    ${totals ? `<tfoot><tr><td class="st-name"><b>Projected week</b></td><td class="num st-g"><b>${games}</b></td>${totals}</tr></tfoot>` : ''}
  </table>`;
}

function statsBoard(ctx, myStarters, myBench, oppStarters, oppBench) {
  const mine = ctx.hasOpp ? ctx.catsSet.map(c => `<td class="sc" style="${shadeProb(c.p)}" title="${totalTip(c, c.a, c.p, 'to win')}">${fmtCat(c, c.a)}</td>`).join('') : '';
  const theirs = ctx.hasOpp ? ctx.catsSet.map(c => `<td class="sc" style="${shadeProb(1 - c.p)}" title="${totalTip(c, c.b, 1 - c.p, 'for them')}">${fmtCat(c, c.b)}</td>`).join('') : '';
  const oppName = state.opp.name || 'Opponent';
  return `<div class="table-wrap"><div class="stat-boards">
    ${statTable(ctx, 'me', state.teamName, myStarters, { totals: mine, games: ctx.asSet.games })}
    ${statTable(ctx, 'them', oppName, oppStarters, { totals: theirs, games: ctx.them.games })}
  </div>
  <div class="stat-boards bench-boards">
    ${statTable(ctx, 'me', state.teamName, myBench, { bench: true })}
    ${ctx.hasOpp ? statTable(ctx, 'them', oppName, oppBench, { bench: true }) : '<div></div>'}
  </div></div>`;
}

function matchupBoard(ctx) {
  const mySlots = state.slots.map((_, i) => byId(state.lineup[i]));
  const oppStarters = ctx.opp.filter(p => ctx.oppIds && ctx.oppIds.has(p.id)).sort((a, b) => value(b) - value(a));
  const oppSlotIds = fillSlots(oppStarters, state.slots);
  const oppById = new Map(ctx.opp.map(p => [p.id, p]));
  const prio = p => weeklyPriority(p, ctx.dates);
  const myBench = benchPlayers().sort((a, b) => prio(b) - prio(a));
  const oppBench = ctx.opp.filter(p => !(ctx.oppIds && ctx.oppIds.has(p.id))).sort((a, b) => prio(b) - prio(a));
  const sched = ui.boardMode === 'sched';
  const legend = sched
    ? ''
    : `<span class="sw zp2"></span> helps <span class="sw zn2"></span> hurts · click a column to sort${ui.statSort.key !== 'slot' ? ' · <button class="link-btn" data-action="stat-sort" data-key="slot">back to lineup order</button>' : ''}`;

  let body;
  if (sched) {
    const benchRows = Math.max(myBench.length, oppBench.length, ctx.hasOpp ? 0 : 1);
    const rows = state.slots.map((slot, i) => `<tr><th scope="row">${slotBadge(slot)}</th>${boardCell(mySlots[i], ctx, 'me', true)}${boardCell(oppById.get(oppSlotIds[i]), ctx, 'them', true)}</tr>`).join('');
    const bench = Array.from({ length: benchRows }, (_, i) => `<tr><th scope="row">${slotBadge('BN')}</th>${boardCell(myBench[i], ctx, 'me', false)}${boardCell(oppBench[i], ctx, 'them', false)}</tr>`).join('');
    const irRows = ilPlayers().map(p => `<tr><th scope="row">${slotBadge('IL')}</th>${boardCell(p, ctx, 'me', false)}<td class="bcell"></td></tr>`).join('');
    body = `<div class="table-wrap"><table class="board">
        <colgroup><col class="c-slot"><col><col></colgroup>
        <thead><tr><th></th><th>${esc(state.teamName)}</th><th>${esc(state.opp.name || 'Opponent')}</th></tr></thead>
        <tbody>${rows}
          <tr class="board-tot"><th scope="row"></th><td><b>${ctx.asSet.games}</b> starter games${ctx.bestIds && ctx.best.games !== ctx.asSet.games ? ` <span class="muted">(${ctx.best.games} suggested)</span>` : ''}</td><td>${ctx.hasOpp ? `<b>${ctx.them.games}</b> starter games` : ''}</td></tr>
          <tr class="board-sep"><td colspan="3">Bench</td></tr>${bench}${irRows}
        </tbody>
      </table></div>`;
  } else {
    body = statsBoard(ctx, mySlots.filter(Boolean), myBench, oppSlotIds.map(id => oppById.get(id)).filter(Boolean), oppBench);
  }
  return `
    <div class="card board-card">
      <div class="card-head"><h2>Lineups ${infoBtn(sched ? 'dots' : 'shading')}</h2>${boardModes()}</div>
      ${legend ? `<p class="muted small board-legend">${legend}</p>` : ''}
      ${body}
    </div>`;
}

function catCompareTable(ctx, changed) {
  return `<div class="table-wrap"><table class="cat-table">
    <thead><tr><th>Cat</th><th class="num">Them</th><th class="num">${changed ? 'As set' : 'You'}</th>${changed ? '<th class="num">Suggested</th>' : ''}<th>Win chance${changed ? ': now vs suggested' : ''}</th></tr></thead>
    <tbody>${ctx.catsBest.map((c, i) => {
      const s = ctx.catsSet[i];
      const [lbl, cls] = oddsLabel(c.p);
      const pct = Math.round(c.p * 100);
      const moved = changed && Math.abs(c.p - s.p) >= 0.01;
      const [, sCls] = oddsLabel(s.p);
      const bars = changed
        ? `<span class="pbars"><span class="pbar-row"><span class="pbar-k">Now</span><span class="pbar thin"><span class="asset" style="width:${Math.round(s.p * 100)}%"></span></span><span class="num small">${pctTxt(s.p)}</span></span>
           <span class="pbar-row"><span class="pbar-k">New</span><span class="pbar thin"><span class="${cls || 'mid'}" style="width:${pct}%"></span></span><span class="num small"><b>${pct}%</b></span></span></span>`
        : `<span class="pbar"><span class="${sCls || 'mid'}" style="width:${pct}%"></span></span><span class="num small"><b>${pct}%</b></span>`;
      return `<tr class="${moved ? 'moved' : ''}"><td><b>${c.label}</b></td><td class="num">${fmtCat(c, c.b)}</td><td class="num">${fmtCat(c, s.a)}</td>${changed ? `<td class="num">${fmtCat(c, c.a)}</td>` : ''}
        <td class="pbar-cell">${bars}<span class="badge ${cls}">${lbl}</span></td></tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

function lineupSection(ctx) {
  if (ctx.locked) return ''; // the matchup bar says so, with a way to plan next week
  const { steps, rest } = pairSwaps(ctx);
  const changed = steps.length > 0 || !!rest;
  const base = ctx.bestIds;
  const misses = nearMisses(ctx, base);
  const intro = !ctx.mine.length ? 'Add players to your roster first.'
    : !ctx.hasOpp ? 'Add your opponent to optimize for this matchup. Until then, suggestions just favor more games from better players.'
    : changed ? `Making ${steps.length === 1 ? 'this change' : 'these changes'} moves your win chance from <b>${pctTxt(ctx.oSet.win)}</b> to <b>${pctTxt(ctx.oBest.win)}</b> and your projected score from <b>${fmt(ctx.oSet.expected, isPoints() ? 0 : 1)}</b> to <b>${fmt(ctx.oBest.expected, isPoints() ? 0 : 1)}</b> ${isPoints() ? 'fantasy points' : 'categories'}.`
    : `Your lineup as set is the best one we found for this matchup (${pctTxt(ctx.oSet.win)} to win, ${fmt(ctx.oSet.expected, isPoints() ? 0 : 1)} projected ${isPoints() ? 'fantasy points' : 'categories'}).`;
  const swing = ctx.catsSet.filter(c => c.p > 0.1 && c.p < 0.9).map(c => c.label);
  const punt = ctx.catsSet.filter(c => c.p <= 0.1).map(c => c.label);
  const locked = ctx.catsSet.filter(c => c.p >= 0.9).map(c => c.label);
  const how = ctx.hasOpp && !isPoints() && (punt.length || locked.length)
    ? `<p class="small muted" style="margin:-6px 0 12px">${swing.length ? `Swing: <b>${swing.join(', ')}</b>` : 'No category is close'}${punt.length ? ` · Punt: <b>${punt.join(', ')}</b>` : ''}${locked.length ? ` · Locked: <b>${locked.join(', ')}</b>` : ''}</p>` : '';
  return `
    <div class="card">
      <div class="card-head"><h2>${ui.viewing ? `Best lineup for ${esc(state.teamName)}` : ui.weekShift === 1 ? 'Lineup for next week' : ui.weekShift ? 'Lineup for that week' : 'Lineup for this week'} ${infoBtn('suggest')}</h2>${changed && !ui.viewing ? '<button class="btn sm primary" data-action="apply-best">Use suggested lineup</button>' : ''}</div>
      <p class="small" style="margin:0 0 12px">${intro}</p>
      ${how}
      ${changed ? `<h3 class="sub">Suggested changes</h3>${steps.map(ex => swapBlock(ex, ctx, 'suggested')).join('')}${rest ? swapBlock(rest, ctx, 'suggested') : ''}` : ''}
      ${ctx.hasOpp && !isPoints() ? `<h3 class="sub" style="margin-top:16px">Categories ${infoBtn('win')}</h3>${catCompareTable(ctx, changed)}` : ''}
      ${misses.length ? `<h3 class="sub" style="margin-top:16px">Other swaps we checked</h3>${misses.map(ex => swapBlock(ex, ctx, 'miss')).join('')}` : ''}
    </div>`;
}

function pickupIdeas(ctx) {
  const { dates, them, oBest: baseOdds } = ctx;
  const mine = ctx.mine;
  if (!mine.length) return [];
  const weekly = ctx.weekly;
  const worth = p => (weekly ? weeklyPriority(p, dates) : value(p));
  const drop = mine.reduce((a, b) => (worth(a) <= worth(b) ? a : b));
  const taken = new Set([...state.players, ...state.opp.players].map(p => p.nbaId).filter(Boolean));
  const cands = nbaPlayers()
    .filter(x => !taken.has(x.nbaId) && x.gp && x.status !== 'Out' && gamesIn(x, dates) && (!fxLeague() || fxAvailable(nbaById.get(x.nbaId))))
    .sort((a, b) => b.val - a.val)
    .slice(0, 70);
  const out = [];
  for (const x of cands) {
    const p = playerFromRaw(nbaById.get(x.nbaId));
    const team = [...mine.filter(m => m !== drop), p];
    const proj = projectSide(team, dates, weekly ? bestWeeklyIds(team, dates, null) : null);
    const cats = compareCats(proj, them);
    const odds = matchOdds(cats);
    out.push({ p, drop, gain: odds.expected - baseOdds.expected, score: objective(odds) - objective(baseOdds), win: odds.win, games: gamesIn(p, dates), cats });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 5);
}

function pickupsCard() {
  if (!NBA) return '';
  const ctx = weekContext();
  if (!ctx.hasOpp) return '';
  const ideas = pickupIdeas(ctx).filter(x => x.score > 0.001);
  return `
    <div class="card">
      <div class="card-head"><h2>Pickup ideas for this week</h2><span class="muted small">vs ${esc(state.opp.name || 'your opponent')} · ${fxLeague() ? 'free agents and waivers in your league' : 'if available in your league'}</span></div>
      ${ideas.length ? `<ul class="alerts">${ideas.map(x => {
        const better = x.cats.filter((c, i) => c.p - ctx.catsBest[i].p > 0.03).map(c => c.label);
        return `<li class="alert">${headshot(x.p, 32)}<span class="grow"><button class="link-btn pname" data-action="player-detail" data-nba="${x.p.nbaId}">${esc(x.p.name)}</button> <span class="muted small">${esc(x.p.team)} · ${posTags(x.p.pos)} · ${x.games} games</span><br>
          <span class="small">For ${esc(x.drop.name)}: <b class="pos-good">${goalDelta(x.gain)}</b>, ${Math.round(x.win * 100)}% to win${better.length ? ` · helps ${better.join(', ')}` : ''}</span></span></li>`;
      }).join('')}</ul>` : '<p class="muted small" style="margin:0">No free agent clearly improves this matchup.</p>'}
    </div>`;
}

function viewWeek() {
  if (!NBA) {
    return `<div class="card"><div class="empty"><strong>Loading schedule and stats…</strong>The matchup projector needs the NBA data file.</div></div>`;
  }
  // once the week has started, finished games count their real box scores (loaded on first need)
  if (!BOX && matchDates()[0] <= todayIso()) loadBoxes().then(() => { if (ui.tab === 'week') render(); }).catch(() => {});
  const ctx = weekContext();
  const { start, dates, weekly, hasOpp, asSet, best, oSet, oBest, mine } = ctx;
  ui.bestIds = ctx.bestIds ? [...ctx.bestIds] : null;
  const today = todayIso();
  const staleOpp = hasOpp && state.opp.week && state.opp.week !== start;
  const range = `${fmtDay(dates[0])} – ${fmtDay(dates[dates.length - 1])}`;
  const winPct = Math.round(oBest.win * 100);
  const changed = weekly ? ctx.bestIds && ([...ctx.bestIds].some(id => !ctx.setIds.has(id)) || ctx.bestIds.size !== ctx.setIds.size) : best.games !== asSet.games;

  const scoreboard = hasOpp ? `
    <div class="card scoreboard">
      <div class="sb-main">
        <div class="sb-side"><div class="sb-label">${esc(state.teamName)}</div><div class="sb-score">${fmt(oBest.expected, isPoints() ? 0 : 1)}</div></div>
        <div class="sb-vs">projected<br>${isPoints() ? 'points' : 'cats'}${changed ? '<span class="sb-vs-extra"><br>with suggested lineup</span>' : ''}</div>
        <div class="sb-side right"><div class="sb-label">${esc(state.opp.name || 'Opponent')}</div><div class="sb-score">${isPoints() ? fmt(oBest.opp, 0) : fmt(oBest.n - oBest.expected, 1)}</div></div>
      </div>
      <div class="odds" role="img" aria-label="Win chance ${winPct}%"><span class="odds-you" style="width:${winPct}%"></span></div>
      <div class="odds-legend"><span><b>${winPct}%</b> to win the week ${infoBtn('win')}</span><span>${100 - winPct}%</span></div>
      ${changed ? `<div class="sb-foot one"><div><span class="muted small">Lineup as set</span><br><b>${fmt(oSet.expected, isPoints() ? 0 : 1)}</b> ${isPoints() ? 'points' : 'cats'} · ${pctTxt(oSet.win)} to win · ${asSet.games} starter games</div></div>` : ''}
    </div>` : `<div class="card"><div class="empty"><strong>Load your opponent to see who's favored</strong>${fxOpponentFor(start) ? `This week you play <b>${esc(fxOpponentFor(start).name)}</b>.<br><br><button class="btn primary" data-action="fx-load-opp">Load ${esc(fxOpponentFor(start).name)} from Fantrax</button>` : 'Fantrax has no matchup for you this week.'}</div></div>`;

  // Daily-lineup leagues keep the day-by-day swap list
  let dailyCards = '';
  if (!weekly) {
    const swaps = dates.map((d, i) => {
      const s = asSet.days[i], b = best.days[i];
      return { d, start: [...b.active].filter(id => !s.active.has(id)).map(byId), sit: [...s.active].filter(id => !b.active.has(id)).map(byId), past: d < today };
    }).filter(x => x.start.length || x.sit.length);
    dailyCards = `
    <div class="card">
      <div class="card-head"><h2>Daily bench swaps</h2><span class="muted small">${best.games - asSet.games > 0 ? `+${best.games - asSet.games} games over your lineup as set` : 'lineup as set'}</span></div>
      ${swaps.length ? `<ul class="alerts">${swaps.map(x => `<li class="alert ${x.past ? '' : 'good'}"><span class="dot"></span><span class="grow"><b>${fmtDay(x.d)}</b>${x.past ? ' <span class="muted small">(already played)</span>' : ''}<br>
        Start ${x.start.map(p => `<b>${esc(p.name)}</b>`).join(', ')}${x.sit.length ? `; sit ${x.sit.map(p => esc(p.name)).join(', ')}` : ''}</span></li>`).join('')}</ul>`
        : `<p class="muted small" style="margin:0">${mine.length ? 'Your lineup as set already uses every game your bench could add.' : 'Your roster is empty.'}</p>`}
      ${hasOpp && !isPoints() ? `<h3 class="sub" style="margin-top:16px">Categories ${infoBtn('win')}</h3>${catCompareTable(ctx, changed)}` : ''}
    </div>`;
  }

  return `
  <div class="page-head">
    <div>
      <div class="week-nav">
        <button class="icon-btn" data-action="week-shift" data-step="-1" aria-label="Previous week">‹</button>
        <h1>${ui.weekShift === 0 ? 'This week' : ui.weekShift === 1 ? 'Next week' : 'Week of ' + fmtDay(start)}</h1>
        <button class="icon-btn" data-action="week-shift" data-step="1" aria-label="Next week">›</button>
      </div>
      <p>${range}</p>
    </div>
  </div>
  ${staleOpp && fxOpponentFor(start) ? `<div class="sample-banner"><span>Showing your opponent from the week of <b>${fmtDay(state.opp.week)}</b>.</span><button class="btn sm" data-action="fx-load-opp">Load this week's opponent</button></div>` : ''}
  <div class="week-stack">
    ${fxStrip(ctx)}
    ${scoreboard}
    ${matchupBoard(ctx)}
    ${weekly ? lineupSection(ctx) : dailyCards}
    ${ctx.locked && weekly ? '' : pickupsCard()}
  </div>`;
}

/* ---------- Draft: how every pick is playing so far ---------- */
// Each drafted player is ranked by his value per game this season (this season's stats only).
// Gain = draft slot − current rank: a #40 pick playing like the #5 player is +35.
const KEEPER_SLOTS = [5, 15];

function draftData() {
  const L = fxLeague();
  if (!L || !L.draft || !L.draft.picks.length) return null;
  // this season so far, or the full season for a past draft (when the site has those stats)
  const basis = seasonCtx ? seasonCtx.basis : 'cur';
  const picks = L.draft.picks.map(([round, pick, teamId, nba, name]) => {
    const raw = nba ? nbaById.get(nba) : null;
    const s = raw && basis ? nbaStats(raw, basis) : null;
    const gp = s ? Math.round(s.gp) : 0;
    const p = { round, pick, teamId, team: fxTeamName(teamId), raw, nbaId: nba, name: raw ? raw.name : name, gp, val: null, s };
    if (s && gp) p.val = value({ ...s, pos: raw.pos });
    return p;
  });
  // Totals: points leagues add up fantasy points; cats leagues add up value above a replacement-level starter
  // (the per-game value of the last player who'd start in this league), so games only help players worth starting
  const totals = ui.draftMode === 'total';
  const perGame = picks.filter(p => p.val != null).map(p => p.val).sort((a, b) => b - a);
  const repl = isPoints() || !perGame.length ? 0 : perGame[Math.min(perGame.length, Math.max(1, fxPickable().length * state.slots.length)) - 1];
  const score = (val, gp) => (val == null ? null : totals ? (val - repl) * gp : val);
  picks.forEach(p => { p.score = score(p.val, p.gp); });
  const played = picks.filter(p => p.score != null).sort((a, b) => b.score - a.score);
  played.forEach((p, i) => { p.rank = i + 1; });
  // players who haven't played yet rank below everyone who has, in draft order
  picks.filter(p => p.val == null).sort((a, b) => a.pick - b.pick).forEach((p, i) => { p.rank = played.length + i + 1; });
  picks.forEach(p => { p.gain = p.pick - p.rank; });
  const maxGp = Math.max(0, ...picks.map(p => p.gp));
  // keepers: where each would slot among this year's picks, by value per game so far
  const keepers = {};
  for (const [tid, ids] of Object.entries(L.draft.keepers || {})) {
    keepers[tid] = ids.map(nba => {
      const raw = nbaById.get(nba);
      const s = raw && basis ? nbaStats(raw, basis) : null;
      const gp = s ? Math.round(s.gp) : 0;
      const val = s && gp ? value({ ...s, pos: raw.pos }) : null;
      const sc = score(val, gp);
      const like = sc == null ? null : played.filter(p => p.score > sc).length + 1;
      return { nbaId: nba, name: raw ? raw.name : '', gp, val, like, adp: (raw && raw.fx && raw.fx.adp) || 999 };
    }).sort((a, b) => a.adp - b.adp);
    // the better keeper (lower ADP) counts as the #5 pick, the other as #15
    keepers[tid].forEach((k, i) => { k.slot = KEEPER_SLOTS[i] || 25; k.gain = k.like == null ? null : k.slot - k.like; });
  }
  return { picks, played: played.length, maxGp, graded: !!basis, date: L.draft.date, type: L.draft.type, perRound: L.draft.perRound || 10, keepers, totals };
}

function draftRow(p, mine) {
  const gainCls = p.gain > 0 ? 'pos-good' : p.gain < 0 ? 'pos-bad' : 'muted';
  return `<tr class="${p.teamId === mine ? 'dr-mine' : ''}">
    <td class="st-name"><div class="bplayer">${headshot({ nbaId: p.nbaId, name: p.name }, 28)}<div class="bmain"><div class="bname">${p.nbaId ? `<button class="link-btn pname" data-action="player-detail" data-nba="${p.nbaId}">${esc(p.name)}</button>` : esc(p.name)}</div>
      <div class="pmeta">${esc(p.team)}${p.teamId === mine ? ' <span class="badge accent">you</span>' : ''}</div></div></div></td>
    <td class="num">R${p.round} · <b>#${p.pick}</b></td>
    <td class="num">${p.gp ? `#${p.rank}` : '<span class="muted">—</span>'}</td>
    <td class="num"><b class="${gainCls}">${p.gp ? signed(p.gain, 0) : 'DNP'}</b></td>
    <td class="num hide-sm">${p.gp}</td>
    <td class="num hide-sm">${p.score != null ? (ui.draftMode === 'total' ? fmt(p.score, isPoints() ? 0 : 1) : fmtValue(p.score)) : '—'}</td>
  </tr>`;
}

const draftValueLabel = () => (ui.draftMode === 'total' ? (isPoints() ? 'Total FP' : 'Total value') : valueLabel());

function draftList(title, list, mine, info) {
  return `<div class="card">
    <div class="card-head"><h2>${title} ${info ? infoBtn('draft') : ''}</h2></div>
    <div class="table-wrap"><table class="dr-table">
      <thead><tr><th>Player</th><th class="num">Drafted</th><th class="num">${seasonCtx ? 'Finished' : 'Now'}</th><th class="num">+/−</th><th class="num hide-sm">GP</th><th class="num hide-sm">${draftValueLabel()}</th></tr></thead>
      <tbody>${list.map(p => draftRow(p, mine)).join('')}</tbody>
    </table></div>
  </div>`;
}

function viewDraft() {
  const d = draftData();
  if (!d) {
    return `<div class="card"><div class="empty"><strong>No draft results</strong>Fantrax didn't return draft picks for this league. Leagues that skipped the draft or started from imported rosters won't have any.</div></div>`;
  }
  const mine = state.fxTeam;
  const best = [...d.picks].filter(p => p.gp).sort((a, b) => (b.gain - a.gain) || (b.score - a.score)).slice(0, 10);
  const worst = [...d.picks].sort((a, b) => (a.gain - b.gain) || (a.pick - b.pick)).slice(0, 10);

  // team rankings: average +/− of every pick, plus best and worst pick
  const byTeam = {};
  for (const p of d.picks) (byTeam[p.teamId] = byTeam[p.teamId] || []).push(p);
  const teamRows = Object.entries(byTeam).map(([id, ps]) => {
    const avg = sum(ps.map(p => p.gain)) / ps.length;
    const top = ps.reduce((a, b) => (b.gain > a.gain ? b : a));
    const low = ps.reduce((a, b) => (b.gain < a.gain ? b : a));
    const total = sum(ps.filter(p => p.score != null).map(p => p.score));
    return { id, name: fxTeamName(id), n: ps.length, avg, top, low, total };
  }).sort((a, b) => b.avg - a.avg);

  // board: one column per draft slot (round-1 order), one row per round. Traded picks stay in
  // their original slot, marked with the team that made them; keepers fill two rows on top.
  const T = d.perRound;
  const rounds = Math.max(...d.picks.map(p => p.round));
  const order = d.picks.filter(p => p.round === 1).sort((a, b) => a.pick - b.pick).map(p => p.teamId);
  // read each round's direction from the picks themselves (this league's order isn't a plain snake)
  const inRound = p => p.pick - (p.round - 1) * T;
  const forward = {};
  for (let r = 1; r <= rounds; r++) {
    const rp = d.picks.filter(p => p.round === r);
    forward[r] = rp.filter(p => order[inRound(p) - 1] === p.teamId).length >= rp.filter(p => order[T - inRound(p)] === p.teamId).length;
  }
  const colOf = p => (forward[p.round] ? inRound(p) - 1 : T - inRound(p));
  const grid = {};
  for (const p of d.picks) grid[`${p.round}|${colOf(p)}`] = p;
  const nameBtn = (nbaId, name) => nbaId ? `<button class="link-btn" data-action="player-detail" data-nba="${nbaId}"><span class="n-full">${esc(name)}</span><span class="n-short">${esc(shortName(name))}</span></button>` : esc(name);
  const gainTag = (gain, gp) => !d.graded ? '' : `<span class="dr-gain ${gain > 0 ? 'pos-good' : gain < 0 ? 'pos-bad' : 'muted'}">${gp ? signed(gain, 0) : 'DNP'}</span>`;
  const keeperRows = !Object.values(d.keepers).some(k => k.length) ? '' : [0, 1].map(i => `<tr class="dr-krow"><th scope="row">K${i + 1}</th>${order.map(t => {
    const k = (d.keepers[t] || [])[i];
    if (!k) return '<td class="dr-cell dr-keeper"></td>';
    return `<td class="dr-cell dr-keeper" style="${k.gain != null ? shade(k.gain / 15) : ''}" title="${esc(k.name)} · keeper, graded as pick #${k.slot} · ${k.like ? `${seasonCtx ? 'finished as' : 'playing like'} #${k.like} (${signed(k.gain, 0)})` : "hasn't played"}">
      <span class="dr-pick">Keeper · as #${k.slot}</span> ${nameBtn(k.nbaId, k.name)} ${gainTag(k.gain, k.gp)}</td>`;
  }).join('')}</tr>`).join('');
  const board = keeperRows + Array.from({ length: rounds }, (_, r) => `<tr><th scope="row" class="num">R${r + 1}</th>${order.map((t, c) => {
    const p = grid[`${r + 1}|${c}`];
    if (!p) return '<td class="dr-cell"><span class="dr-pick">No pick</span></td>';
    const via = p.teamId !== t ? `<span class="dr-via">by ${esc(p.team)}</span>` : '';
    return `<td class="dr-cell" style="${p.gp ? shade(p.gain / 15) : ''}" title="${esc(p.name)} · pick #${p.pick}${via ? ` (traded, made by ${esc(p.team)})` : ''} · ${p.gp ? `${seasonCtx ? 'finished as' : 'playing like'} #${p.rank} (${signed(p.gain, 0)})` : "hasn't played"}">
      <span class="dr-pick">#${p.pick}</span> ${nameBtn(p.nbaId, p.name)} ${gainTag(p.gain, p.gp)}${via}</td>`;
  }).join('')}</tr>`).join('');

  const modeSeg = !d.graded ? '' : `<div class="seg seg-sm" role="group" aria-label="Rank picks by">${[['game', 'Per game'], ['total', 'Season totals']].map(([k, l]) => `<button type="button" class="${ui.draftMode === k ? 'on' : ''}" data-action="draft-mode" data-mode="${k}" aria-pressed="${ui.draftMode === k}">${l}</button>`).join('')}</div>`;
  return `
  <div class="page-sub-row">${modeSeg}<p class="page-sub">${d.type ? d.type[0].toUpperCase() + d.type.slice(1) + ' draft' : 'Draft'}${d.date ? `, ${fmtDay(d.date)}` : ''} · ${d.picks.length} picks · ${!d.graded ? 'not graded: the site has no NBA stats for that season' : seasonCtx ? `graded by ${seasonCtx.label} full-season stats` : `compared with this season so far (up to ${d.maxGp} game${d.maxGp === 1 ? '' : 's'} played)`} ${infoBtn('draft')}</p></div>
  ${!seasonCtx && d.maxGp < 10 ? `<div class="sample-banner"><span>It's early: players have ${d.maxGp} game${d.maxGp === 1 ? '' : 's'} at most, so one big night can swing a ranking a lot. This settles down after a few weeks.</span></div>` : ''}
  ${d.graded ? `<div class="trade-grid">
    ${draftList(seasonCtx ? 'Best picks' : 'Best picks so far', best, mine, true)}
    ${draftList(seasonCtx ? 'Worst picks' : 'Worst picks so far', worst, mine, false)}
  </div>` : ''}
  <div class="card" style="margin-top:16px">
    <div class="card-head"><h2>Team drafts</h2><span class="muted small">ranked by average +/− per pick</span></div>
    <div class="table-wrap"><table class="dr-teams">
      <thead><tr><th class="num">#</th><th>Team</th><th class="num">Avg +/−</th><th class="num">${d.totals ? draftValueLabel() : `Total ${valueLabel()}`}</th><th>Best pick</th><th>Worst pick</th></tr></thead>
      <tbody>${teamRows.map((t, i) => `<tr class="${t.id === mine ? 'dr-mine' : ''}"><td class="num">${i + 1}</td><td><b>${esc(t.name)}</b>${t.id === mine ? ' <span class="badge accent">you</span>' : ''}</td>
        <td class="num"><b class="${t.avg > 0 ? 'pos-good' : t.avg < 0 ? 'pos-bad' : ''}">${signed(t.avg, 1)}</b></td><td class="num">${fmtValue(t.total)}</td>
        <td>${inlinePlayer(t.top, esc(lastName(t.top.name)))} <span class="muted small">#${t.top.pick}</span> <span class="pos-good small">${t.top.gp ? signed(t.top.gain, 0) : ''}</span></td>
        <td>${inlinePlayer(t.low, esc(lastName(t.low.name)))} <span class="muted small">#${t.low.pick}</span> <span class="pos-bad small">${t.low.gp ? signed(t.low.gain, 0) : 'DNP'}</span></td></tr>`).join('')}</tbody>
    </table></div>
  </div>
  <div class="card" style="margin-top:16px">
    <div class="card-head"><h2>Draft board ${infoBtn('board')}</h2></div>
    <div class="table-wrap"><table class="dr-board">
      <thead><tr><th></th>${order.map(t => `<th class="${t === mine ? 'dr-mine-col' : ''}">${esc(fxTeamName(t))}</th>`).join('')}</tr></thead>
      <tbody>${board}</tbody>
    </table></div>
  </div>`;
}

// ----- Saved leagues -----
// Each league you add keeps its own team, roster, opponent, lineup settings, matchup log and
// lineup; switching stashes the current league's and restores the other's.
const LEAGUE_FIELDS = ['fxTeam', 'players', 'il', 'lineup', 'opp', 'teamName', 'slots', 'benchSize', 'ilSize',
  'slotsSet', 'lineupMode', 'matchDays'];
const emptyOpp = () => ({ name: '', week: null, players: [], starters: null, fxId: null });
const currentLeagueId = () => state.fxLeagueId || (NBA && NBA.siteLeague && NBA.siteLeague.id) || null;

function rememberLeague(id, name) {
  const list = (state.savedLeagues || []).filter(l => l.id !== id);
  const at = (state.savedLeagues || []).findIndex(l => l.id === id);
  list.splice(at === -1 ? list.length : at, 0, { id, name });
  state.savedLeagues = list;
}

function stashLeague() {
  const id = currentLeagueId();
  if (!id || !state.fxTeam) return;
  state.leagueStates = state.leagueStates || {};
  state.leagueStates[id] = JSON.parse(JSON.stringify(Object.fromEntries(LEAGUE_FIELDS.map(k => [k, state[k]]))));
}

// Lineup rules read from the league: slots, bench and IR sizes, weekly or daily lineups
function applyLeagueRules(league) {
  const cfg = slotsFromLeague(league);
  if (cfg) {
    state.slots = cfg.slots;
    if (cfg.bench != null) state.benchSize = cfg.bench;
    if (cfg.ir != null) state.ilSize = cfg.ir;
    state.slotsSet = true;
  }
  state.lineupMode = leagueLineupMode(league);
  state.matchDays = [0, 1, 2, 3, 4, 5, 6];
}

// Daily or weekly lineups: from the league's lineup lock periods, else from its matchup length
function leagueLineupMode(league) {
  if (league.lockDays != null) return league.lockDays < 2 ? 'daily' : 'weekly';
  const p = (league.periods || [])[0];
  const days = p ? (new Date(p.end) - new Date(p.start)) / 86400000 : 7;
  return days >= 5 ? 'weekly' : 'daily';
}

// Switch the whole app to a Fantrax league by ID. Throws a readable message.
async function switchLeague(id) {
  if (!/^[A-Za-z0-9]{6,32}$/.test(id || '')) throw new Error("That doesn't look like a Fantrax league ID. It's letters and numbers only.");
  if (!NBA) await nbaLoading;
  if (!NBA) throw new Error("Couldn't load NBA data. Check your connection and try again.");
  let res;
  try {
    res = await fetchFantraxLeague(id);
  } catch (e) {
    throw new Error(`Fantrax didn't find that league (${e.message}). Check the ID in your league's address.`);
  }
  const wasCurrent = currentLeagueId() === id;
  ui.season = null; ui.addingSeason = false; ui.pastTeam = null;
  if (!wasCurrent) stashLeague();
  applyFantraxLeague(withSiteExtras(res));
  state.fxLeagueId = NBA.siteLeague && NBA.siteLeague.id === id ? null : id;
  state.demo = false;
  state.leagueChosen = true;
  ui.viewA = null; ui.viewB = null;
  if (!wasCurrent) {
    const saved = state.leagueStates && state.leagueStates[id];
    if (saved) Object.assign(state, JSON.parse(JSON.stringify(saved)));
    else {
      Object.assign(state, { fxTeam: null, players: [], il: [], lineup: [], opp: emptyOpp(), teamName: res.league.name });
      applyLeagueRules(res.league);
    }
  }
  if (state.fxTeam) { rememberLeague(id, res.league.name); syncLeagueRules(); }
  syncLinked();
  validateLineup();
  return res.league;
}

// Make a league team "yours": load its roster and lineup, and this week's opponent
function adoptTeam(teamId) {
  const side = fxTeamSide(teamId);
  state.fxTeam = teamId;
  if (fxLeague()) rememberLeague(currentLeagueId(), fxLeague().name);
  state.players = side.players;
  state.il = side.il;
  state.lineup = side.lineup;
  state.teamName = side.name || state.teamName;
  const opp = fxOpponentFor(weekStart());
  if (opp) {
    const o = fxTeamSide(opp.id);
    state.opp = { name: o.name, week: weekStart(), fxId: opp.id, players: o.players, starters: o.starters };
  } else {
    state.opp = { name: '', week: null, players: [], starters: null, fxId: null };
  }
}

/* ---------- Landing page: connect a league, then pick your team ---------- */
const needsLanding = () => ui.addingLeague || (!state.fxTeam && !state.demo);

function viewLanding() {
  const chosen = !ui.addingLeague && state.leagueChosen && fxLeague() && !state.fxTeam;
  const step2 = chosen ? `
      <p class="land-step">Step 2 of 2</p>
      <h1>Which team is yours?</h1>
      <p class="muted">Connected to <b>${esc(fxLeague().name)}</b>. Pick your team to load your roster and this week's matchup.</p>
      ${preDraft() ? `<p class="land-note">This league hasn't drafted yet${draftWhen(fxLeague()) ? ` (draft: ${esc(draftWhen(fxLeague()))})` : ''}, so rosters are empty for now.</p>` : ''}
      <div class="land-teams">${fxPickable().map(t => `<button type="button" class="land-team" data-action="land-team" data-id="${esc(t.id)}">${esc(t.name)}</button>`).join('')}</div>
      <p class="small muted" style="margin:16px 0 0"><button class="link-btn" data-action="land-back">Use a different league</button>${(state.savedLeagues || []).length ? ' · <button class="link-btn" data-action="land-cancel">Cancel</button>' : ''}</p>` : '';
  const step1 = chosen ? '' : `
      <p class="land-step">${ui.addingLeague && state.fxTeam ? 'Add a league' : 'Courtside Manager'}</p>
      <h1>${ui.addingLeague && state.fxTeam ? 'Connect another Fantrax league' : 'Plan your fantasy basketball week'}</h1>
      <p class="muted">${ui.addingLeague && state.fxTeam ? "Enter its league ID. Each league keeps its own team and notes, and you can switch between them from the menu at the top." : "Connect your Fantrax league to see your odds for this week's matchup, the best starters for the week, how your categories stack up against the league, and how your draft is holding up."}</p>
      <form class="land-form" data-form="land-league">
        <label class="field" for="landLeague">Fantrax league ID
          <input id="landLeague" name="leagueId" placeholder="e.g. abc123def456" autocomplete="off" spellcheck="false" autofocus>
        </label>
        <button class="btn primary" type="submit">Connect league</button>
      </form>
      <p class="form-error" id="landMsg" role="alert"></p>
      <details class="land-help">
        <summary>Where do I find my league ID?</summary>
        <p>Open your league on fantrax.com. The ID is the part of the address right after <b>/league/</b>:<br>
        <span class="land-url">fantrax.com/fantasy/league/<b>abc123def456</b>/home</span></p>
      </details>
      <p class="small muted land-foot">Built for head-to-head category leagues on Fantrax. ${ui.addingLeague && state.fxTeam ? '<button class="link-btn" data-action="land-cancel">Cancel</button>' : NBA && NBA.siteLeague ? '<button class="link-btn" data-action="land-demo">Explore a demo league instead</button>' : ''}</p>`;
  return `<div class="landing-wrap"><div class="landing-card">${step1}${step2}</div></div>`;
}

/* =========================================================
   Actions
   ========================================================= */
const actions = {
  'nav-toggle'(el) { setNav(!document.body.classList.contains('nav-open')); },
  'toggle-theme'() {
    const root = document.documentElement;
    const cur = root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignore */ }
  },
  'fx-load-opp'() {
    const opp = fxOpponentFor(weekStart());
    if (!opp) return toast('No Fantrax matchup found for this week');
    loadFxTeam(opp.id);
  },
  'fx-cycle'(el) {
    const leftId = viewingOther() ? ui.viewA : state.fxTeam;
    const others = fxPickable().filter(t => t.id !== leftId);
    if (!others.length) return;
    const curId = viewingOther() ? (ui.viewB || (fxOpponentFor(weekStart(), ui.viewA) || {}).id) : state.opp.fxId;
    const i = others.findIndex(t => t.id === curId);
    const step = +el.dataset.step;
    const next = others[i === -1 ? (step > 0 ? 0 : others.length - 1) : (i + step + others.length) % others.length];
    if (viewingOther()) { ui.viewB = next.id; render(); } else loadFxTeam(next.id);
  },
  'fx-view-mine'() { ui.viewA = null; ui.viewB = null; render(); },
  'fx-view-actual'() { ui.viewB = null; render(); },
  'stat-sort'(el) {
    const key = el.dataset.key;
    const s = ui.statSort;
    if (key === 'slot') { s.key = 'slot'; s.dir = 1; }
    else if (s.key === key) s.dir *= -1;
    else { s.key = key; s.dir = key === 'name' ? 1 : -1; }
    render();
  },
  info(el) {
    const item = INFO[el.dataset.key];
    if (!item) return;
    $('#infoTitle').textContent = item[0];
    $('#infoBody').innerHTML = item[1];
    const d = $('#infoDialog');
    if (!d.open) d.showModal();
  },
  'go-week'() { location.hash = '#week'; },
  'cs-toggle'(el) {
    const open = !ui.csOpen.delete(el.dataset.cat);
    if (open) ui.csOpen.add(el.dataset.cat);
    el.setAttribute('aria-expanded', open);
    el.nextElementSibling.hidden = !open;
  },
  'close-info'() { $('#infoDialog').close(); },
  'draft-mode'(el) {
    ui.draftMode = el.dataset.mode;
    try { localStorage.setItem(DRAFT_MODE_KEY, ui.draftMode); } catch (e) { /* ignore */ }
    render();
  },
  'str-basis'(el) {
    ui.strBasis = el.dataset.basis;
    try { localStorage.setItem(STR_KEY, ui.strBasis); } catch (e) { /* ignore */ }
    render();
  },
  'land-team'(el) {
    adoptTeam(el.dataset.id);
    commit(`Welcome, ${state.teamName}`);
    location.hash = '#week';
  },
  'season-cancel'() { ui.addingSeason = false; render(); },
  'land-back'() { state.leagueChosen = false; ui.addingLeague = true; commit(); },
  async 'land-cancel'() {
    ui.addingLeague = false;
    const back = (state.savedLeagues || [])[0];
    if (!state.fxTeam && back) await actions['league-switch']({ dataset: { id: back.id } });
    else commit();
  },
  async 'land-demo'() {
    const site = NBA && NBA.siteLeague;
    if (!site) return;
    try {
      await switchLeague(site.id);
      ui.addingLeague = false;
      if (!state.fxTeam) state.demo = true;
      commit(`Exploring ${site.name}`);
      location.hash = '#week';
    } catch (e) { toast(e.message); }
  },
  async 'league-switch'(el) {
    const id = el.dataset.id;
    $('#leagueMenu details')?.removeAttribute('open');
    if (id === currentLeagueId() && state.fxTeam) return;
    try {
      const league = await switchLeague(id);
      ui.addingLeague = false;
      commit(`Switched to ${league.name}`);
    } catch (e) { toast(e.message); }
  },
  async 'league-reload'(el) {
    $('#leagueMenu details')?.removeAttribute('open');
    if (el.disabled) return;
    el.disabled = true;
    const label = el.textContent;
    el.textContent = 'Reloading…';
    try {
      await refreshLeague();
      if (state.fxTeam && fxRoster(state.fxTeam).length) {
        const side = fxTeamSide(state.fxTeam);
        Object.assign(state, { players: side.players, il: side.il, lineup: side.lineup, teamName: side.name || state.teamName });
      }
      syncLinked();
      delete seasonTot[fxLeague().id];
      commit(`Reloaded ${fxLeague().name} from Fantrax`);
    } catch (e) {
      toast(`Couldn't reach Fantrax (${e.message})`);
      el.disabled = false; el.textContent = label;
    }
  },
  'league-add'() {
    $('#leagueMenu details')?.removeAttribute('open');
    ui.addingLeague = true;
    render();
  },
  async 'league-remove'(el) {
    const id = el.dataset.id;
    const l = (state.savedLeagues || []).find(x => x.id === id);
    if (!l || !(await askConfirm(`Remove ${l.name}?`, 'Removes it from your list on this device, along with your team and notes for it. You can add it again any time.', 'Remove'))) return;
    state.savedLeagues = state.savedLeagues.filter(x => x.id !== id);
    if (state.leagueStates) delete state.leagueStates[id];
    commit(`Removed ${l.name}`);
  },
  'set-basis'(el) {
    state.basis = el.dataset.basis;
    syncLinked();
    commit(`Using ${BASIS_LABELS[state.basis].toLowerCase()} stats`);
  },
  'board-mode'(el) {
    ui.boardMode = el.dataset.mode;
    try { localStorage.setItem(BOARD_KEY, ui.boardMode); } catch (e) { /* ignore */ }
    render();
  },
  'apply-best'() {
    if (!ui.bestIds) return;
    const chosen = state.players.filter(p => ui.bestIds.includes(p.id)).sort((a, b) => value(b) - value(a));
    state.lineup = fillSlots(chosen, state.slots);
    commit('Lineup updated for this week');
  },
  'week-shift'(el) {
    ui.weekShift = Math.max(-4, Math.min(4, ui.weekShift + +el.dataset.step));
    // a new week brings its real opponent: a hypothetical belongs to the week it was set up in
    if (viewingOther()) { ui.viewB = null; render(); return; }
    const opp = fxOpponentFor(weekStart());
    if (!opp) render();
    else if (opp.id !== state.opp.fxId) loadFxTeam(opp.id);
    else { state.opp.week = weekStart(); commit(); }
  },
  'player-detail'(el) { showPlayerDetail(+el.dataset.nba); },
  'close-detail'() { $('#detailDialog').close(); },
  'more-players'() { ui.pf.limit += 50; $('#playerResults').innerHTML = playerRows(); },
  async 'refresh-data'(el) {
    el.disabled = true;
    el.textContent = 'Refreshing…';
    let live = false;
    try { live = (await fetch('api/refresh', { method: 'POST' })).ok; } catch (e) { /* server not running */ }
    const ok = await loadNba(true);
    el.disabled = false;
    el.textContent = 'Refresh stats';
    toast(!ok ? "Couldn't load NBA data" : live ? 'Pulled the latest NBA stats' : "Couldn't reach the local data server");
  },
  'tot-sort'(el) {
    const k = el.dataset.key;
    const key = /^\d+$/.test(k) ? +k : k;
    const so = ui.totSort;
    if (so.key === key) so.dir *= -1;
    else { so.key = key; so.dir = key === 'team' ? -1 : 1; }
    render();
  },
  sort(el) {
    const s = ui.rosterSort;
    const k = el.dataset.key;
    if (s.key === k) s.dir *= -1;
    else { s.key = k; s.dir = ['name', 'slot', 'status', 'tag', 'to'].includes(k) ? 1 : -1; }
    render();
  },
  export() {
    const box = $('#backupText');
    box.value = JSON.stringify(state);
    $('#backupDialog').showModal();
    box.select();
  },
  async 'copy-backup'() {
    const box = $('#backupText');
    try { await navigator.clipboard.writeText(box.value); toast('Backup copied'); }
    catch (e) { box.select(); toast('Press Ctrl+C to copy the selected text'); }
  },
  'restore-backup'() {
    try {
      restoreFrom(JSON.parse($('#backupText').value));
      $('#backupDialog').close();
    } catch (e) { toast("That text isn't a Courtside backup"); }
  },
  'close-backup'() { $('#backupDialog').close(); },
  import() { $('#importFile').click(); },
  async 'start-fresh'() {
    $('#leagueMenu details')?.removeAttribute('open');
    if (!(await askConfirm('Reset and start over?', 'Removes your leagues, teams and matchup logs from this device. Copy a backup first if you want to keep anything.', 'Reset'))) return;
    state = emptyState();
    ui.tradeGive.clear(); ui.tradeGet.clear();
    ui.addingLeague = false; ui.viewA = null; ui.viewB = null;
    location.hash = '';
    await loadNba(true);
    commit();
  },
};

const forms = {
  async 'add-season'(f) {
    const id = f.sid.value.trim();
    const L = fxLeague();
    if (!/^[A-Za-z0-9]{6,32}$/.test(id)) return toast("That doesn't look like a Fantrax league ID. It's letters and numbers only.");
    if (id === L.id) return toast("That's this season's league.");
    const btn = f.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Adding…';
    try {
      const P = await loadSeason(id);
      if ((L.historyId && P.league.historyId !== L.historyId) || (L.year && P.league.year && P.league.year >= L.year)) {
        delete pastCache[id];
        throw new Error(`that league isn't an earlier season of ${L.name}`);
      }
      const key = L.historyId || L.id;
      state.pastSeasons = state.pastSeasons || {};
      const list = state.pastSeasons[key] = state.pastSeasons[key] || [];
      if (!list.some(x => x.id === id)) list.push({ id, year: P.league.year });
      save();
      await switchSeason(id);
      toast(`Added the ${P.label} season`);
    } catch (e) {
      toast(`Couldn't add that season: ${e.message}`);
      btn.disabled = false; btn.textContent = 'Add';
    }
  },
  async 'land-league'(f) {
    const id = f.leagueId.value.trim();
    const msg = $('#landMsg');
    const btn = f.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Connecting…'; msg.textContent = '';
    try {
      await switchLeague(id);
      ui.addingLeague = false;
      commit();
    } catch (e) {
      msg.textContent = e.message;
      btn.disabled = false; btn.textContent = 'Connect league';
    }
  },

};

/* =========================================================
   Wiring
   ========================================================= */
// phones: the sections menu opens under the top bar and closes on any choice or outside tap
function setNav(open) {
  document.body.classList.toggle('nav-open', open);
  $('.nav-btn').setAttribute('aria-expanded', open);
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('nav-open')) setNav(false); });

document.addEventListener('click', e => {
  if (document.body.classList.contains('nav-open') && !e.target.closest('.nav-btn') && (!e.target.closest('#tabs') || e.target.closest('#tabs a'))) setNav(false);
  const menu = $('#leagueMenu details');
  if (menu && menu.open && !e.target.closest('#leagueMenu')) menu.removeAttribute('open');
  const el = e.target.closest('[data-action]');
  if (!el || !actions[el.dataset.action]) return;
  e.preventDefault();
  actions[el.dataset.action](el, e);
});

document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.change === 'fx-view') {
    ui.viewA = el.value && el.value !== state.fxTeam ? el.value : null;
    ui.viewB = null;
    if (ui.viewA && !VIEW_TABS.includes(ui.tab)) location.hash = '#dashboard';
    else render();
  } else if (el.dataset.change === 'fx-opp') {
    if (!el.value) return;
    if (viewingOther()) { ui.viewB = el.value; render(); } else loadFxTeam(el.value);
  } else if (el.dataset.change === 'season') {
    if (el.value === 'add') { ui.addingSeason = true; render(); $('.ctx-add input')?.focus(); return; }
    switchSeason(el.value);
  } else if (el.dataset.change === 'past-team') {
    ui.pastTeam = el.value || null;
    if (ui.tab !== 'rosters') location.hash = '#rosters'; else render();
  } else if (el.dataset.change === 'fx-team') {
    if (!el.value) return;
    adoptTeam(el.value);
    state.demo = false;
    commit(`Welcome, ${state.teamName}`);
  } else if (el.dataset.change === 'pf') {
    ui.pf[el.dataset.key] = el.value;
    ui.pf.limit = 50;
    $('#playerResults').innerHTML = playerRows();
  } else if (el.dataset.change === 'trade-team') {
    ui.tradeTeam = el.value;
    ui.tradeGet.clear();
    render();
  } else if (el.dataset.change === 'trade') {
    const set = el.dataset.side === 'give' ? ui.tradeGive : ui.tradeGet;
    if (el.checked) set.add(el.value); else set.delete(el.value);
    render();
  }
});

document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.input === 'pf') {
    ui.pf[el.dataset.key] = el.value;
    ui.pf.limit = 50;
    $('#playerResults').innerHTML = playerRows();
  }
});

document.addEventListener('submit', e => {
  const f = e.target;
  if (f.dataset.form && forms[f.dataset.form]) {
    e.preventDefault();
    forms[f.dataset.form](f);
  }
});

$('#importFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    restoreFrom(JSON.parse(await file.text()));
  } catch (err) {
    toast("That file doesn't look like a Courtside backup");
  }
});

function route() {
  let tab = location.hash.replace('#', '') || 'dashboard';
  if (tab === 'lineup') tab = 'roster'; // the old Lineup tab now lives on Roster
  if (tab === 'rosters' && !ui.season) tab = 'roster';
  ui.tab = tabList().some(([k]) => k === tab) ? tab : ui.season ? 'standings' : 'dashboard';
  if (!VIEW_TABS.includes(ui.tab)) { ui.viewA = null; ui.viewB = null; }
  render();
  window.scrollTo(0, 0);
  // on phones the tab bar scrolls sideways; keep the current tab visible
  const active = document.querySelector('#tabs a.active');
  if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
window.addEventListener('hashchange', route);

(function init() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t) document.documentElement.dataset.theme = t;
  } catch (e) { /* ignore */ }
  state = load();
  validateLineup();
  route();
  nbaLoading = loadNba();
  loadImages();
})();
