// Courtside Manager: Constants, saved state, helpers, headshots and team logos.
// The site loads js/*.js in order (see index.html); they share one scope, like one file.

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
const ui = { weekShift: 0, pf: { q: '', pos: '', team: '', show: 'fa', sort: 'val', limit: 50 }, tab: 'dashboard', rosterSort: { key: 'value', dir: -1 }, tradeGive: new Set(), tradeGet: new Set(), tradeTeam: null, totSort: { key: null, dir: 1 }, csOpen: new Set(),
  perfRange: 'day', perfSort: { key: 'v', dir: -1 } };

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
const leaguePoints = () => { const L = fxLeague(); return L && L.points && /POINTS/.test(L.scoring || '') ? L.points : null; };
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
  const L = fxLeague();
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
    cropLogos(IMG.logos);
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

// Each team's primary and secondary colors, for the ring and background of a player's photo
const TEAM_COLORS = {
  ATL: ['#E03A3E', '#C1D32F'], BOS: ['#007A33', '#BA9653'], BKN: ['#000000', '#FFFFFF'], CHA: ['#1D1160', '#00788C'],
  CHI: ['#CE1141', '#000000'], CLE: ['#860038', '#FDBB30'], DAL: ['#00538C', '#B8C4CA'], DEN: ['#0E2240', '#FEC524'],
  DET: ['#C8102E', '#1D42BA'], GSW: ['#1D428A', '#FFC72C'], HOU: ['#CE1141', '#000000'], IND: ['#002D62', '#FDBB30'],
  LAC: ['#12173F', '#C8102E'], LAL: ['#552583', '#FDB927'], MEM: ['#5D76A9', '#12173F'], MIA: ['#98002E', '#F9A01B'],
  MIL: ['#00471B', '#EEE1C6'], MIN: ['#0C2340', '#78BE20'], NOP: ['#0C2340', '#B4975A'], NYK: ['#006BB6', '#F58426'],
  OKC: ['#007AC1', '#EF3B24'], ORL: ['#0077C0', '#C4CED4'], PHI: ['#006BB6', '#ED174C'], PHX: ['#1D1160', '#E56020'],
  POR: ['#E03A3E', '#000000'], SAC: ['#5A2D81', '#63727A'], SAS: ['#000000', '#C4CED4'], TOR: ['#CE1141', '#000000'],
  UTA: ['#4E008E', '#000000'], WAS: ['#002B5C', '#E31837'],
};

function headshot(p, px = 28) {
  const i = IMG && p && p.nbaId != null ? IMG_INDEX.get(p.nbaId) : undefined;
  // the ring shows the player's current team, like the jersey in the photo
  const raw = p && p.nbaId != null ? nbaById.get(p.nbaId) : null;
  const tc = TEAM_COLORS[(raw && raw.team) || (p && p.team)];
  const box = `width:${px}px;height:${px}px${tc ? `;--t1:${tc[0]};--t2:${tc[1]};--rw:${Math.max(1.25, +(px / 24).toFixed(2))}px` : ''}`;
  const tm = tc ? ' tm' : '';
  if (i === undefined) return `<span class="hs hs-none${tm}" style="${box}" aria-hidden="true">${esc(initials(p && p.name))}</span>`;
  const col = i % IMG.cols, row = Math.floor(i / IMG.cols);
  return `<span class="hs${tm}" style="${box};background-size:${IMG.cols * px}px auto;background-position:-${col * px}px -${row * px}px" aria-hidden="true"></span>`;
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
  // the photo's ring shows the team; without a photo the logo does
  const body = `<div>${name}</div><div class="pmeta">${photo ? '' : teamLogo(p.team, 14) + ' '}${posTags(p.pos)}${next}</div>${inj}`;
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
