// Courtside Manager: Weekly lineups, archived seasons, game logs and awards.
// The site loads js/*.js in order (see index.html); they share one scope, like one file.
'use strict';

// ----- A past season week by week: who each team had, who started, and how they got them -----
// Fantrax shares every lineup period's rosters but no transaction log. A player's stint on a team,
// walked back to its first week: there from week 1 = drafted or kept; the week before on another
// team's roster = a trade; on nobody's roster = a free-agent or waiver pickup. Finished seasons never
// change, so the weekly rosters are fetched once and kept on this device.
// Kept per league with when it was last used; only the 8 most recently used leagues and seasons stay
const ROSTER_WEEKS_KEY = 'courtside-roster-weeks-v2';
const ROSTER_WEEKS_KEEP = 8;
function readRosterWeeks() {
  try {
    const all = JSON.parse(localStorage.getItem(ROSTER_WEEKS_KEY));
    if (all) return all;
    // the earlier format ({ league: { period: rosters } }) carries over, so nothing is fetched again
    const old = JSON.parse(localStorage.getItem('courtside-roster-weeks-v1')) || {};
    localStorage.removeItem('courtside-roster-weeks-v1');
    return Object.fromEntries(Object.entries(old).map(([id, p]) => [id, { at: Date.now(), p }]));
  } catch (e) { return {}; }
}
try { localStorage.removeItem('courtside-roster-history-v1'); } catch (e) { /* older format, no statuses */ }
// one load per league at a time, shared by Season totals and Awards
const rosterWeeksLoad = {};
function loadRosterWeeks(L) {
  if (!rosterWeeksLoad[L.id]) rosterWeeksLoad[L.id] = fetchRosterWeeks(L).catch(e => { delete rosterWeeksLoad[L.id]; throw e; });
  return rosterWeeksLoad[L.id];
}
async function fetchRosterWeeks(L) {
  const all = readRosterWeeks();
  const have = { ...((all[L.id] || {}).p || {}) };
  const today = todayIso();
  const periods = rosterPeriodsOf(L).filter(p => p.start.slice(0, 10) <= today);
  // the period underway comes with the league (when its roster entries carry Fantrax ids)
  const cur = L.rosterPeriod && Object.values(L.rosters || {}).flat().every(x => x.fid) ? L.rosterPeriod : null;
  if (cur && periods.some(p => p.n === cur)) {
    have[cur] = Object.fromEntries(Object.entries(L.rosters).map(([tid, items]) => [tid, items.map(x => [x.fid, x.st === 'ACTIVE' ? 1 : 0])]));
  }
  // and the opening week was fetched with the league too
  const open = L.openingRosters && Object.values(L.openingRosters).flat();
  if (!have[1] && open && open.length && open.every(x => x.fid && x.st)) {
    have[1] = Object.fromEntries(Object.entries(L.openingRosters).map(([tid, items]) => [tid, items.map(x => [x.fid, x.st === 'ACTIVE' ? 1 : 0])]));
  }
  const want = periods.map(p => p.n).filter(n => !have[n]);
  // [Fantrax id, 1 if in the starting lineup]
  const parse = d => Object.fromEntries(Object.entries(d.rosters || {}).map(([tid, r]) => [tid, (r.rosterItems || []).map(it => [it.id, it.status === 'ACTIVE' ? 1 : 0])]));
  const q = encodeURIComponent(L.id);
  try { await fxGetAll(want.map(n => `getTeamRosters?leagueId=${q}&period=${n}`), (path, d) => { have[+path.split('period=')[1]] = parse(d); }); } finally {
    // a period still underway can change, so only finished ones are kept
    const now = Date.now();
    all[L.id] = { at: now, p: Object.fromEntries(Object.entries(have).filter(([n]) => { const p = periods.find(x => String(x.n) === n); return p && fxTime(p.end) < now; })) };
    const keep = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, ROSTER_WEEKS_KEEP);
    try { localStorage.setItem(ROSTER_WEEKS_KEY, JSON.stringify(Object.fromEntries(keep))); } catch (e) { /* storage full or blocked */ }
  }
  const weeks = periods.filter(p => have[p.n]).map(p => {
    const owner = new Map();
    for (const [tid, items] of Object.entries(have[p.n])) for (const [f, on] of items) owner.set(f, { tid, on: !!on });
    return { ...p, owner };
  });
  return weeks.length ? weeks : null;
}

// How a player came to be on a team in week k: 'start', 'trade' or 'pickup'
function arrivalAt(weeks, k, f) {
  const tid = weeks[k].owner.get(f).tid;
  let j = k;
  while (j > 0 && (weeks[j - 1].owner.get(f) || {}).tid === tid) j--;
  return j === 0 ? 'start' : weeks[j - 1].owner.has(f) ? 'trade' : 'pickup';
}

// This season's box scores in the same shape as a past season's game log, so the awards run on either
const BOX_KEYS = ['min', 'pts', 'reb', 'ast', 'stl', 'blk', 'tpm', 'to', 'fgm', 'fga', 'ftm', 'fta', 'oreb', 'dreb', 'tpa', 'pf', 'pm'];
function boxGameLog(B) {
  const dates = [...B.finals].map(x => x.slice(0, 10)).sort();
  const start = dates[0] || todayIso();
  const d0 = new Date(start + 'T12:00:00');
  const dayOf = d => Math.round((new Date(d + 'T12:00:00') - d0) / 864e5);
  const teams = [...new Set([...B.finals].map(x => x.slice(11)))].sort();
  const ix = new Map(teams.map((t, i) => [t, i]));
  const days = new Map(teams.map(t => [t, new Set()]));
  for (const x of B.finals) days.get(x.slice(11)).add(dayOf(x.slice(0, 10)));
  const players = new Map();
  for (const [pid, games] of B.byPlayer) {
    players.set(pid, games.filter(g => ix.has(g[3])).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([d, st, , team]) => [dayOf(d), ix.get(team), ...BOX_KEYS.map(k => st[k] || 0)]));
  }
  return { start, teams, keys: BOX_KEYS, players, days };
}

// A past season's game lines (data/seasons/<season>-games.json), kept as the plain number arrays they
// arrive in ([day, team, ...stats], oldest first). A team's schedule is every day any of its players played.
const gameLogs = {};
async function loadGameLog(season) {
  if (season in gameLogs) return gameLogs[season];
  if (season === 'cur') { // this season: the daily box scores
    try { gameLogs.cur = boxGameLog(await loadBoxes()); } catch (e) { gameLogs.cur = null; }
    return gameLogs.cur;
  }
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
    // that season's per-game numbers: this season's so far, or a past season's archive
    const A = archives[L.season];
    const stats = L.season === 'cur' ? NBA.players.map(r => nbaStats(r, 'cur')) : A ? [...A.players.keys()].map(pid => archivedStats({ id: pid }, L.season)) : [];
    const minGp = L.season === 'cur' ? 2 : 10;
    const vals = stats.filter(x => x && x.gp >= minGp).map(x => value(x)).sort((a, b) => b - a);
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

// All-play record: every finished regular-season week, each team's real totals (its starters' games)
// against every other team's, as if it had played them all. Expected wins = the weekly share of those
// matchups won (ties half), added up; in leagues where each category counts, the share of categories.
// Team id -> { exp, pct, weeks }
function allPlayRecords(L, G, each) {
  if (!L.weeks || !G) return null;
  const now = Date.now();
  const weeks = L.weeks.filter(w => (!L.playoffPeriod || w.n < L.playoffPeriod) && fxTime(w.end) < now && (L.matchups[String(w.n)] || []).length);
  if (!weeks.length) return null;
  const cats = scoreCats();
  const sc = leaguePoints();
  const val = (R, c) => (!R ? 0 : c.fp ? sum(Object.entries(sc).map(([k, v]) => lineStat(R.s, k) * v)) : c.pct ? (R.s[c.att] ? R.s[c.made] / R.s[c.att] : 0) : lineStat(R.s, c.key));
  const ids = fxPickable().map(t => t.id);
  const out = Object.fromEntries(ids.map(id => [id, { exp: 0, won: 0, games: 0, weeks: weeks.length }]));
  for (const w of weeks) {
    const tot = pastSeasonTotals({ ...L, weeks: [w] }, G);
    for (const a of ids) {
      let share = 0;
      const opp = ids.filter(b => b !== a);
      for (const b of opp) {
        let wa = 0, wb = 0, n = 0;
        for (const c of sc ? [{ fp: true }] : cats) {
          const x = val(tot[a], c), y = val(tot[b], c);
          n++;
          if (Math.abs(x - y) < 1e-9) { wa += 0.5; wb += 0.5; } else if (c.neg ? x < y : x > y) wa++; else wb++;
        }
        share += each && !sc ? wa : wa > wb ? 1 : wa < wb ? 0 : 0.5;
      }
      out[a].exp += share / opp.length;
      out[a].won += share; out[a].games += opp.length * (each && !sc ? cats.length : 1);
    }
  }
  for (const A of Object.values(out)) A.pct = A.games ? A.won / A.games : 0;
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

// The address names a past season as #<tab>/<that season's league id>, so a refresh stays on it
const seasonHash = (tab, id) => `#${tab}${id ? '/' + id : ''}`;
async function switchSeason(id, wantTab) {
  ui.addingSeason = false; ui.pastTeam = null; ui.viewA = null; ui.viewB = null;
  if (id) {
    try {
      await loadSeason(id);
    } catch (e) {
      toast(`Couldn't load that season (${e.message})`);
      ui.season = null;
      location.hash = seasonHash(wantTab && tabList().some(([k]) => k === wantTab) ? wantTab : 'dashboard');
      render();
      return;
    }
  }
  ui.season = id || null;
  const pick = wantTab || ui.tab;
  const tab = pick === 'rosters' && !id ? 'roster' : pick;
  const want = seasonHash(tabList().some(([k]) => k === tab) ? tab : id ? 'standings' : 'dashboard', id);
  if (location.hash !== want) location.hash = want; else route();
}

// Render a past season's tab with the app pointed at that season's league
function withSeason(fn) {
  const P = pastSeason();
  if (!P) return fn();
  const myName = fxTeamName(state.fxTeam);
  const me = P.league.teams.find(t => t.name === myName);
  seasonCtx = { basis: P.basis, label: P.label };
  try { return viewingLeague(P.league, me ? me.id : null, fn); } finally { seasonCtx = null; }
}

// Everyone a team started at some point in a past season, with what he did while starting: weeks in the
// lineup, games played and missed (his NBA team played without him), stat totals and game value.
// NBA id -> { nba, name, how ('start' | 'keeper' | 'trade' | 'pickup'), weeks, gp, missed, s, v }
function activeStints(L, G, tid) {
  const out = new Map();
  const kept = new Set(((L.draft && L.draft.keepers) || {})[tid] || []);
  L.weeks.forEach((w, k) => {
    const wd = periodDays(G, w);
    for (const [f, o] of w.owner) {
      if (!o.on || o.tid !== tid) continue;
      const nba = L.fidNba(f);
      if (!nba) continue;
      const rows = G.players.get(nba) || [];
      const came = arrivalAt(L.weeks, k, f);
      const P = out.get(nba) || { nba, name: (nbaById.get(nba) || {}).name || '', how: came === 'start' && kept.has(nba) ? 'keeper' : came, weeks: 0, gp: 0, missed: 0, s: {}, v: 0 };
      P.weeks++;
      const played = new Set();
      for (const r of rows) {
        if (!wd.has(r[0])) continue;
        played.add(r[0]);
        const line = gameLine(G, r);
        P.gp++;
        P.v += lineValue(line);
        for (const [key, val] of Object.entries(line)) P.s[key] = (P.s[key] || 0) + val;
      }
      const now = (nbaById.get(nba) || {}).team;
      for (const day of wd) {
        const team = teamOn(G, rows, day) || now;
        if (!played.has(day) && team && G.days.has(team) && G.days.get(team).has(day)) P.missed++;
      }
      out.set(nba, P);
    }
  });
  return out;
}

ui.pastRosterMode = 'total';
ui.pastRosterSort = { key: 'value', dir: 1 }; // dir 1: biggest first; clicking again flips it
function viewPastRosters() {
  const L = fxLeague();
  const teams = fxPickable();
  const tid = ui.pastTeam && teams.some(t => t.id === ui.pastTeam) ? ui.pastTeam : myTeamId() || (teams[0] && teams[0].id);
  const r = standingOf(tid);
  // with the weekly lineups and the season's game log: everyone the team started, and what he did while starting
  if (L.weeks && L.season && seasonCtx.basis) {
    if (!(L.season in gameLogs)) {
      loadGameLog(L.season).then(() => { if (ui.tab === 'rosters' && ui.season) render(); });
      return '<div class="card"><div class="empty"><strong>Loading the season’s games…</strong></div></div>';
    }
    if (gameLogs[L.season]) return pastStarters(L, gameLogs[L.season], tid, r, teams);
  }
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

function pastStarters(L, G, tid, r, teams) {
  const total = ui.pastRosterMode === 'total';
  const how = { start: ['Drafted', ''], keeper: ['Keeper', 'accent'], trade: ['Trade', 'warn'], pickup: ['Pickup', 'good'] };
  const per = (P, k) => (total ? P.s[k] || 0 : P.gp ? (P.s[k] || 0) / P.gp : 0);
  // any column sorts, following the Totals / Per game choice
  const so = ui.pastRosterSort;
  const sortVal = P => (so.key === 'name' ? P.name.toLowerCase() : so.key === 'how' ? ['keeper', 'start', 'pickup', 'trade'].indexOf(P.how)
    : so.key === 'weeks' || so.key === 'gp' || so.key === 'missed' ? P[so.key]
    : so.key === 'fgPct' ? (P.s.fga ? P.s.fgm / P.s.fga : -1) : so.key === 'ftPct' ? (P.s.fta ? P.s.ftm / P.s.fta : -1)
    : so.key === 'value' ? (total ? P.v : P.gp ? P.v / P.gp : -1e9) : per(P, so.key));
  const list = [...activeStints(L, G, tid).values()].sort((a, b) => { const x = sortVal(a), y = sortVal(b); return (x < y ? 1 : x > y ? -1 : 0) * so.dir; });
  const th = (key, label, cls = 'num', tip = '') => sortTh('past-roster-sort', key, label, so, { cls, tip, down: so.dir > 0 });
  const num = (P, k) => (P.gp ? (total ? Math.round(per(P, k)) : fmt(per(P, k), 1)) : '—');
  const pct = (P, m, a) => (P.s[a] ? fmtPct(P.s[m] / P.s[a]) : '—');
  const val = P => (!P.gp ? '—' : isPoints() ? fmt(total ? P.v : P.v / P.gp, total ? 0 : 1) : signed(total ? P.v : P.v / P.gp, 1));
  const seg = `<div class="seg seg-sm" role="group" aria-label="Show stats as">${[['total', 'Totals'], ['game', 'Per game']].map(([k, l]) => `<button type="button" class="${ui.pastRosterMode === k ? 'on' : ''}" data-action="past-roster-mode" data-mode="${k}" aria-pressed="${ui.pastRosterMode === k}">${l}</button>`).join('')}</div>`;
  const STATS = [['min', 'MIN'], ['pts', 'PTS'], ['reb', 'REB'], ['ast', 'AST'], ['stl', 'STL'], ['blk', 'BLK'], ['tpm', '3PM'], ['to', 'TO']];
  return `
  <div class="page-sub-row">${seg}<p class="page-sub">${esc(fxTeamName(tid))}${r ? ` · ${r.w}-${r.l}${r.t ? '-' + r.t : ''}, ${ordinal(r.rank)} of ${teams.length}` : ''} · everyone who started, and what he did while starting ${infoBtn('pastRoster')}</p></div>
  <div class="card">
    ${list.length ? `<div class="table-wrap"><table>
      <thead><tr>${th('name', 'Player', '')}${th('how', 'How', '')}${th('weeks', 'Wks', 'num', 'Weeks in the starting lineup')}${th('gp', 'GP', 'num', 'Games played while starting')}${th('missed', 'Missed', 'num', 'Games his NBA team played without him while he was starting')}${STATS.map(([k, l]) => th(k, l)).join('')}${th('fgPct', 'FG%')}${th('ftPct', 'FT%')}${th('value', isPoints() ? (total ? 'FP' : 'FP/G') : 'Value')}</tr></thead>
      <tbody>${list.map(P => {
        const raw = nbaById.get(P.nba);
        const [label, cls] = how[P.how];
        return `<tr>
        <td class="player"><div class="bplayer">${headshot({ nbaId: P.nba, name: P.name }, 28)}<div class="bmain"><div class="bname">${raw && !raw.inactive ? `<button class="link-btn pname" data-action="player-detail" data-nba="${P.nba}">${esc(P.name)}</button>` : esc(P.name)}</div></div></div></td>
        <td><span class="badge ${cls}">${label}</span></td>
        <td class="num">${P.weeks}</td><td class="num"><b>${P.gp}</b></td><td class="num ${P.missed ? 'pos-bad' : 'muted'}">${P.missed}</td>
        ${STATS.map(([k]) => `<td class="num">${num(P, k)}</td>`).join('')}
        <td class="num">${pct(P, 'fgm', 'fga')}</td><td class="num">${pct(P, 'ftm', 'fta')}</td><td class="num"><b>${val(P)}</b></td>
      </tr>`;
      }).join('')}</tbody>
    </table></div>` : `<div class="empty"><strong>No starters</strong>Fantrax's weekly rosters show nobody starting for this team.</div>`}
  </div>`;
}

// ----- Season awards -----
// Every award comes from Fantrax's weekly lineups and the season's games (a past season's archived game
// log, or this season's box scores). Without both there are no awards.
function seasonAwards() {
  const L = fxLeague();
  const G = L.season ? gameLogs[L.season] : null;
  if (!L.weeks || !G) return null;
  const teams = fxPickable().map(t => ({ id: t.id, name: t.name }));
  const each = matchupScoring() === 'each' || !/SINGLE_WIN/.test(L.scoring || '');

  // Best manager: actual wins against an all-play record
  const allPlay = allPlayRecords(L, G, each);
  for (const T of teams) {
    const A = allPlay && allPlay[T.id], r = standingOf(T.id);
    if (!A || !r) continue;
    T.record = `${r.w}-${r.l}${r.t ? '-' + r.t : ''}`;
    T.expW = A.exp;
    T.allPct = A.pct;
    T.luck = r.w + r.t / 2 - A.exp;
  }

  // Biggest punt and Even Steven: each category of the real season totals vs the league, in team-to-team spreads
  const real = pastSeasonTotals(L, G);
  const val = (T, c) => { const R = real[T.id] || { s: {} }; return c.pct ? (R.s[c.att] ? R.s[c.made] / R.s[c.att] : 0) : lineStat(R.s, c.key); };
  const cats = isPoints() ? [] : scoreCats();
  for (const c of cats) {
    const xs = teams.map(T => val(T, c));
    const m = sum(xs) / xs.length, sd = Math.sqrt(sum(xs.map(x => (x - m) ** 2)) / xs.length) || 1;
    teams.forEach((T, i) => { (T.z = T.z || {})[c.key] = ((xs[i] - m) / sd) * (c.neg ? -1 : 1); });
  }
  for (const T of cats.length ? teams : []) {
    const zs = cats.map(c => T.z[c.key]);
    const low = cats.reduce((a, c) => (T.z[c.key] < T.z[a.key] ? c : a));
    T.punt = { cat: low.label, z: T.z[low.key] };
    const mz = sum(zs) / zs.length;
    T.spread = Math.sqrt(sum(zs.map(z => (z - mz) ** 2)) / zs.length);
  }

  // the per-player awards: each team's list of contributors, its total and its top name
  const tally = (byTeam, key, amount) => {
    if (!byTeam) return;
    for (const T of teams) {
      const ps = byTeam[T.id] || [];
      T[key] = sum(ps.map(amount));
      T[key + 'N'] = ps.length;
      T[key + 'Top'] = ps.length ? ps.reduce((a, b) => (amount(b) > amount(a) ? b : a)) : null;
    }
  };
  const d = draftData();
  tally(d && d.graded ? draftImpact(L, G, d.picks) : null, 'draft', p => p.v);
  tally(pickupImpact(L, G), 'waiver', p => p.v);
  tally(startersMissed(L, G), 'missed', p => p.games);
  const olds = startersAge(L) || {};
  for (const T of teams) { T.age = olds[T.id] ? olds[T.id].age : null; T.oldest = olds[T.id] ? olds[T.id].oldest : null; }

  const total = v => (isPoints() ? `${Math.round(v).toLocaleString()} FP` : `${v >= 0 ? '+' : '−'}${Math.round(Math.abs(v)).toLocaleString()} value`);
  const ranked = (key, dir, fmtFn, note) => teams.filter(T => T[key] != null).sort((a, b) => (b[key] - a[key]) * dir).map(T => ({ T, txt: fmtFn(T), note: note ? note(T) : '' }));
  const pickupNote = T => {
    const b = T.waiverTop;
    if (!b) return 'no pickups';
    return `${T.waiverN} pickup${T.waiverN === 1 ? '' : 's'}, best: ${b.name} (${isPoints() ? `${fmt(b.v, 0)} FP` : signed(b.v, 1)} in ${b.weeks} wk${b.weeks === 1 ? '' : 's'})`;
  };
  return [
    { title: 'Best draft', info: 'awDraft', list: ranked('draft', 1, T => total(T.draft), T => (T.draftTop ? `best: ${T.draftTop.name} (${total(T.draftTop.v)} over ${T.draftTop.games} games)` : '')) },
    { title: 'Best manager', info: 'awManager', list: ranked('luck', 1, T => `${signed(T.luck, 1)} ${each ? 'cats' : 'wins'}`, T => `${T.record}, all-play ${Math.round(T.allPct * 100)}% (${fmt(T.expW, 1)} expected)`) },
    { title: 'Waiver Wire Wizard', info: 'awWaiver', list: ranked('waiver', 1, T => (isPoints() ? `${fmt(T.waiver, 0)} FP` : `${signed(T.waiver, 1)} value`), pickupNote) },
    { title: 'Street Clothes', info: 'awStreet', list: ranked('missed', 1, T => `${T.missed} games`, T => (T.missedTop ? `most: ${T.missedTop.name} (${T.missedTop.games})` : '')) },
    ...(cats.length ? [{ title: 'Biggest punt', info: 'awPunt', list: ranked('punt', 1, T => T.punt.cat, T => `${fmt(-T.punt.z, 1)} spreads below average`).sort((a, b) => a.T.punt.z - b.T.punt.z) },
      { title: 'Even Steven', info: 'awSteven', list: ranked('spread', -1, T => `${fmt(T.spread, 2)} spread`, T => { const order = [...cats].sort((a, b) => T.z[b.key] - T.z[a.key]); return `best: ${order[0].label} · worst: ${order[order.length - 1].label}`; }) }] : []),
    { title: 'Unc Status', info: 'awUnc', list: ranked('age', 1, T => `${fmt(T.age, 1)} yrs`, T => (T.oldest ? `oldest regular: ${T.oldest.name} (${Math.floor(T.oldest.age)}, ${T.oldest.weeks} wks)` : '')) },
  ].filter(a => a.list.length);
}

// The season underway: the same awards, from this season's weekly lineups and box scores so far
const curAwards = {}; // league id -> { weeks, fidNba } once loaded
function viewAwardsSoFar() {
  const L = fxLeague();
  if (!L || !NBA) return '';
  const C = curAwards[L.id];
  if (!C) {
    curAwards[L.id] = { loading: true };
    Promise.all([loadRosterWeeks(L).catch(() => null), loadGameLog('cur')]).then(([weeks]) => {
      curAwards[L.id] = { weeks, fidNba: currentFidNba() };
    }).finally(() => { if (ui.tab === 'awards' && !ui.season) render(); });
  }
  if (!C || C.loading) return '<div class="card"><div class="empty"><strong>Loading this season’s lineups and games…</strong></div></div>';
  if (!C.weeks || !gameLogs.cur) return '<div class="card"><div class="empty"><strong>No awards yet</strong>They start once the season’s first week of lineups and games is in.</div></div>';
  // run the awards on a copy of the league that carries this season's weeks
  const L2 = { ...L, weeks: C.weeks, season: 'cur', fidNba: C.fidNba };
  const done = C.weeks.filter(w => fxTime(w.end) < Date.now()).length;
  return viewingLeague(L2, state.fxTeam, () => {
    return `<p class="page-sub">So far: ${done} finished week${done === 1 ? '' : 's'}${done < 3 ? ', so these will move a lot' : ''} (the week underway counts toward everything but Best manager)</p>${viewAwards()}`;
  });
}

function viewAwards() {
  if (seasonCtx && !seasonCtx.basis) {
    return `<div class="card"><div class="empty"><strong>No awards for this season</strong>No NBA stats are saved for this season (the site has 2016-17 on), and every award needs that season's numbers.</div></div>`;
  }
  // the season's game log (about 350 KB) loads the first time Awards opens
  const L = fxLeague();
  if (L.weeks && L.season && !(L.season in gameLogs)) {
    loadGameLog(L.season).then(() => { if (ui.tab === 'awards') render(); });
    return '<div class="card"><div class="empty"><strong>Loading the season’s games…</strong></div></div>';
  }
  const me = myTeamId();
  const awards = seasonAwards();
  if (!awards) return `<div class="card"><div class="empty"><strong>No awards for this season</strong>Awards need Fantrax's weekly lineups and that season's NBA game logs (the site has 2016-17 on).</div></div>`;
  return `
  <div class="awards">${awards.map(a => {
    const [win, ...rest] = a.list;
    return `<div class="card award">
      <div class="aw-title">${a.title} ${infoBtn(a.info)}</div>
      <div class="aw-win${win.T.id === me ? ' me' : ''}"><span class="aw-name">${esc(win.T.name)}${win.T.id === me ? ' <span class="badge accent">you</span>' : ''}</span><span class="aw-val">${esc(win.txt)}</span></div>
      ${win.note ? `<div class="small muted">${esc(win.note)}</div>` : ''}
      <ol class="aw-list" start="2">${rest.map(x => `<li class="${x.T.id === me ? 'me' : ''}" title="${esc(x.note)}"><span>${esc(x.T.name)}</span><span class="muted">${esc(x.txt)}</span></li>`).join('')}</ol>
    </div>`;
  }).join('')}</div>`;
}
