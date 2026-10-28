// Courtside Manager: NBA data, lineup logic, the weekly matchup engine.
// The site loads js/*.js in order (see index.html); they share one scope, like one file.
'use strict';

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
    baseMemo.clear(); // new stats, new baselines
    BASE = baseNow();
    NBA.siteLeague = NBA.league;
    // a reload from Fantrax since this morning's file beats the file (the site's own league is on Fantrax)
    const fresher = NBA.league && !state.fxLeagueId ? cachedLeague(NBA.league.id) : null;
    if (fresher) applyFantraxLeague(withSiteExtras(fresher));
    const other = state.fxLeagueId && (!NBA.league || NBA.league.id !== state.fxLeagueId);
    if (other) {
      // someone else's league: from this device if it's fresh, else from its site
      try {
        await refreshLeague(false);
      } catch (e) {
        toast(`Couldn't load your ${SOURCE_NAME[leagueSourceOf(state.fxLeagueId)]} league right now. Showing ${NBA.league ? NBA.league.name : 'the site league'}.`);
      }
    }
    if (state.fxTeam && !(NBA.league && NBA.league.teams.some(t => t.id === state.fxTeam))) state.fxTeam = null;
    if (state.fxTeam) syncLeagueRules();
    const migrate = state.fxTeam && NBA.league && !(state.savedLeagues || []).some(l => l.id === NBA.league.id);
    if (migrate) rememberLeague(NBA.league.id, NBA.league.name);
    if (syncLinked() || migrate) commit(); else render();
    if (ui.pendingSeason) route(); // a refresh on a past season waited for this data
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
  const p = fxLeague() && fxLeague().periods ? fxPeriodFor(start) : null;
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

// Baselines for "value": each category's mean and spread among the players a league rosters (its teams × roster
// spots, the ones with the most minutes), from that season's per-game stats: this season's smart blend, or a past
// season's archive while one shows, so seasons never mix. Percentages measure (% − average) × attempts.
const baseMemo = new Map(); // "season|pool size" -> BASE
function baseNow() {
  const season = seasonCtx && String(seasonCtx.basis || '').startsWith('arch:') ? seasonCtx.basis.slice(5) : 'cur';
  const n = (fxPickable().length || 12) * (state.slots.length + (state.benchSize ?? 5));
  const key = `${season}|${n}`;
  if (baseMemo.has(key)) return baseMemo.get(key);
  const A = season !== 'cur' ? archives[season] : null;
  if (season !== 'cur' && !A) return baseMemo.get(`cur|${n}`) || { ...BASE_DEFAULT }; // archive still loading
  if (!A && !NBA) return { ...BASE_DEFAULT };
  // each player's sample: his games, plus the 10 games of last season the smart blend mixes in
  const stats = A ? [...A.players.keys()].map(id => { const s = archivedStats({ id }, season); return s && { ...s, sample: s.gp }; })
    : NBA.players.map(raw => {
      const s = nbaStats(raw, 'blend'), cur = statObj(raw.cur), prev = statObj(raw.prev);
      return s && { ...s, sample: cur && cur.gp && prev && prev.gp ? cur.gp + 10 : s.gp };
    });
  const base = computeBase(stats, n);
  baseMemo.set(key, base);
  return base;
}

function computeBase(stats, n) {
  const pool = stats.filter(x => x && x.sample >= 3).sort((a, b) => b.min - a.min).slice(0, n);
  if (pool.length < 20) return { ...BASE_DEFAULT };
  const spread = (xs, m) => Math.max(Math.sqrt(sum(xs.map(x => (x - m) ** 2)) / xs.length), 0.02);
  const out = {};
  for (const k of [...COUNT_KEYS, ...Object.keys(DERIVED)]) {
    const xs = pool.map(x => statVal(x, k));
    const m = sum(xs) / xs.length;
    out[k] = [m, spread(xs, m)];
  }
  for (const [k, [, made, att]] of Object.entries(PCT_CATS)) {
    const a = sum(pool.map(x => statVal(x, att)));
    const m = a ? sum(pool.map(x => statVal(x, made))) / a : 0;
    out[k] = [m, spread(pool.map(x => { const v = statVal(x, att); return v ? (statVal(x, made) / v - m) * v : 0; }), 0)];
  }
  out.pool = pool.length; // for the explanation
  return out;
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
// HEAD_TO_HEAD_ROTI_SINGLE_WIN, ESPN H2H_MOST_CATEGORIES). "each": every category counts in the standings.
const mostCatsWins = scoring => /SINGLE_WIN|MOST_CATEGORIES/.test(scoring || '');
function matchupScoring() {
  const L = fxLeague();
  if (L && L.scoring) return mostCatsWins(L.scoring) ? 'most' : 'each';
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
