// League Layer: Weekly lineups, archived seasons, game logs and awards.
// The site loads js/*.js in order (see index.html); they share one scope, like one file.
'use strict';

// ----- A past season week by week: who each team had, who started, and how they got them -----
// Fantrax shares every lineup period's rosters but no transaction log; Sleeper each week's matchups, with every
// player's points (sleeperWeekRosters). A player's stint on a team,
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
  if (!hasLineupHistory(L)) return null; // only Fantrax and Sleeper share each period's rosters, so far
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
  // (a Sleeper week saved before its pairings were kept is asked for again)
  const want = periods.map(p => p.n).filter(n => !have[n] || (L.source === 'sleeper' && !have[n]['#m']));
  // [Fantrax id, 1 if in the starting lineup]
  const parse = d => Object.fromEntries(Object.entries(d.rosters || {}).map(([tid, r]) => [tid, (r.rosterItems || []).map(it => [it.id, it.status === 'ACTIVE' ? 1 : 0])]));
  const q = encodeURIComponent(L.id);
  const fetching = L.source === 'sleeper'
    ? fxGetAll(want.map(n => `league/${q}/matchups/${n}`), (path, d) => { have[+path.split('/').pop()] = sleeperWeekRosters(d); }, 4, slpGet)
    : fxGetAll(want.map(n => `getTeamRosters?leagueId=${q}&period=${n}`), (path, d) => { have[+path.split('period=')[1]] = parse(d); });
  try { await fetching; } finally {
    // a period still underway can change, so only finished ones are kept
    const now = Date.now();
    all[L.id] = { at: now, p: Object.fromEntries(Object.entries(have).filter(([n]) => { const p = periods.find(x => String(x.n) === n); return p && fxTime(p.end) < now; })) };
    const keep = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, ROSTER_WEEKS_KEEP);
    try { localStorage.setItem(ROSTER_WEEKS_KEY, JSON.stringify(Object.fromEntries(keep))); } catch (e) { /* storage full or blocked */ }
  }
  const weeks = periods.filter(p => have[p.n]).map(p => {
    const owner = new Map();
    // pts: Sleeper's points for him that week (one-game leagues: what tells which game counted)
    for (const [tid, items] of Object.entries(have[p.n])) {
      if (tid === '#m') { if (items.length && !(L.matchups || {})[p.n]) (L.matchups = L.matchups || {})[p.n] = items; continue; } // Sleeper's pairings
      for (const [f, on, pts] of items) owner.set(f, { tid, on: !!on, pts: pts == null ? null : pts });
    }
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

// One-game leagues (Sleeper): of a starter's games in a week (oldest first), the one that counted, as Sleeper's points
// for him that week tell (countedIndex). Other leagues: all of them.
function countedRows(L, G, w, f, rows) {
  if (!L.oneGame || !rows.length) return rows;
  const o = w.owner.get(f), i = countedIndex(rows.map(r => gameLine(G, r)), o ? o.pts : null);
  return i < 0 ? [] : [rows[i]];
}
// and his best game, for a bench player swapped in (he'd have locked in his best)
const bestRow = (G, rows) => (rows.length ? [rows.reduce((b, r) => (lineFp(gameLine(G, r)) > lineFp(gameLine(G, b)) ? r : b))] : []);

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
  return withBonus({ ...line, dd: +(tens >= 2), td: +(tens >= 3), gp1: 1 }); // Sleeper's one-game bonuses, if any
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
      const games = countedRows(L, G, w, f, (G.players.get(nba) || []).filter(r => wd.has(r[0])));
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
// Players without a birth date on record are left out. Team id -> { age, n, oldest, players: [{ nba, name, age,
// weeks, moved }] }, moved = how much older the team's average is with him than without him
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
      const P = T.players.get(raw.id) || { nba: raw.id, name: raw.name, age, weeks: 0, sum: 0 };
      P.age = Math.max(P.age, age);
      P.weeks++;
      P.sum += age;
      T.players.set(raw.id, P);
    }
  }
  // the oldest player a team started regularly (3+ weeks)
  const oldest = T => [...T.players.values()].filter(p => p.weeks >= 3).sort((a, b) => b.age - a.age)[0] || null;
  const moved = (T, P) => (T.n > P.weeks ? T.total / T.n - (T.total - P.sum) / (T.n - P.weeks) : 0);
  return Object.fromEntries(Object.entries(out).map(([tid, T]) => [tid, {
    age: T.total / T.n, n: T.n, oldest: oldest(T),
    players: [...T.players.values()].map(P => ({ ...P, moved: moved(T, P) })),
  }]));
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
    // dropped: the week he was first on nobody's roster (null: never dropped, or never on one)
    const P = { nba: p.nbaId, name: p.name, round: p.round, pick: p.pick, v: 0, games: 0, dropped: null };
    if (f) {
      const rows = G.players.get(p.nbaId) || [];
      let k = 0;
      for (; k < L.weeks.length && L.weeks[k].owner.has(f); k++) {
        for (const r of rows) if (weekDays[k].has(r[0])) { P.v += lineValue(gameLine(G, r)) - repl; P.games++; }
      }
      if (k && k < L.weeks.length) P.dropped = L.weeks[k].n || k + 1;
    }
    (out[p.teamId] = out[p.teamId] || []).push(P);
  }
  return out;
}

// All-play record: every finished regular-season week, each team's real totals (its starters' games)
// against every other team's, as if it had played them all. Expected wins = the weekly share of those
// matchups won (ties half), added up; in leagues where each category counts, the share of categories.
// Team id -> { exp, pct, weeks, list: [{ n, opp, res, exp, wa, wb, beat, of }] }: each week, the result against the
// real opponent (res: 1, 0.5 or 0, or the share of categories; wa-wb: categories, or 1-0 on points) and the
// all-play share expected (beat: teams beaten, ties half, of of)
function allPlayRecords(L, G, each) {
  if (!L.weeks || !G) return null;
  const now = Date.now();
  const weeks = L.weeks.filter(w => (!L.playoffPeriod || w.n < L.playoffPeriod) && periodOver(w) && (L.matchups[String(w.n)] || []).length);
  if (!weeks.length) return null;
  const cats = scoreCats();
  const sc = leaguePoints();
  const val = (R, c) => (!R ? 0 : c.fp ? sum(Object.entries(sc).map(([k, v]) => lineStat(R.s, k) * v)) : c.pct ? (R.s[c.att] ? R.s[c.made] / R.s[c.att] : 0) : lineStat(R.s, c.key));
  const ids = fxPickable().map(t => t.id);
  const out = Object.fromEntries(ids.map(id => [id, { exp: 0, won: 0, games: 0, weeks: weeks.length, list: [] }]));
  for (const w of weeks) {
    const tot = pastSeasonTotals({ ...L, weeks: [w] }, G);
    const face = (a, b) => {
      let wa = 0, wb = 0;
      for (const c of sc ? [{ fp: true }] : cats) {
        const x = val(tot[a], c), y = val(tot[b], c);
        if (Math.abs(x - y) < 1e-9) { wa += 0.5; wb += 0.5; } else if (c.neg ? x < y : x > y) wa++; else wb++;
      }
      // edge: categories won minus lost, or the fantasy points margin
      const fa = sc ? val(tot[a], { fp: true }) : 0, fb = sc ? val(tot[b], { fp: true }) : 0;
      const edge = sc ? fa - fb : wa - wb;
      return { wa, wb, edge, fb, share: each && !sc ? wa : wa > wb ? 1 : wa < wb ? 0 : 0.5 };
    };
    const pairs = L.matchups[String(w.n)] || [];
    for (const a of ids) {
      let share = 0, beat = 0, edge = 0;
      const opp = ids.filter(b => b !== a);
      for (const b of opp) {
        const f = face(a, b);
        share += f.share;
        beat += f.wa > f.wb ? 1 : f.wa < f.wb ? 0 : 0.5;
        edge += f.edge / opp.length;
      }
      const per = each && !sc ? cats.length : 1;
      out[a].exp += share / opp.length;
      out[a].won += share; out[a].games += opp.length * per;
      const pair = pairs.find(m => m.length === 2 && m.includes(a));
      if (pair) {
        const o = pair[0] === a ? pair[1] : pair[0], f = face(a, o);
        // margin: against the real opponent; edge: on average against everyone; s: the week's totals
        out[a].list.push({ n: w.n, opp: o, res: f.share / per, exp: share / opp.length / per, wa: f.wa, wb: f.wb, beat, of: opp.length, margin: f.edge, theirs: f.fb, edge, s: (tot[a] || { s: {} }).s });
      }
    }
  }
  for (const A of Object.values(out)) A.pct = A.games ? A.won / A.games : 0;
  return out;
}

// Benchwarmer Blues: every game a player played in a week he sat on a team's bench (IR included: an injured player
// has no games), valued like a single game on the Dashboard. Team id -> [{ nba, name, v, games, weeks }]
function benchValue(L, G) {
  if (!L.weeks || !G) return null;
  const out = {};
  for (const w of L.weeks) {
    const wd = periodDays(G, w);
    for (const [f, o] of w.owner) {
      if (o.on) continue;
      const nba = L.fidNba(f);
      const games = ((nba && G.players.get(nba)) || []).filter(r => wd.has(r[0]));
      if (!games.length) continue;
      const team = out[o.tid] = out[o.tid] || new Map();
      const P = team.get(nba) || { nba, name: (nbaById.get(nba) || {}).name || '', v: 0, games: 0, weeks: 0 };
      P.v += sum(games.map(r => lineValue(gameLine(G, r))));
      P.games += games.length;
      P.weeks++;
      team.set(nba, P);
    }
  }
  return Object.fromEntries(Object.entries(out).map(([tid, m]) => [tid, [...m.values()]]));
}

// Fan Boy: each team's starts (a starter for a week) by the NBA team he played for that week.
// Team id -> { n, teams: [{ team, n, share, players: [{ nba, name, weeks }] }] }, biggest share first
function startsByNbaTeam(L, G) {
  if (!L.weeks || !G) return null;
  const out = {};
  for (const w of L.weeks) {
    const day = Math.min(...periodDays(G, w));
    for (const [f, o] of w.owner) {
      if (!o.on) continue;
      const nba = L.fidNba(f);
      if (!nba) continue;
      const team = teamOn(G, G.players.get(nba) || [], day) || (nbaById.get(nba) || {}).team;
      if (!team) continue;
      const T = out[o.tid] = out[o.tid] || { n: 0, by: {} };
      T.n++;
      const B = T.by[team] = T.by[team] || { n: 0, players: new Map() };
      B.n++;
      const P = B.players.get(nba) || { nba, name: (nbaById.get(nba) || {}).name || '', weeks: 0 };
      P.weeks++;
      B.players.set(nba, P);
    }
  }
  return Object.fromEntries(Object.entries(out).map(([tid, T]) => [tid, {
    n: T.n,
    teams: Object.entries(T.by).map(([team, B]) => ({ team, n: B.n, share: B.n / T.n, players: [...B.players.values()].sort((a, b) => b.weeks - a.weeks) })).sort((a, b) => b.n - a.n),
  }]));
}

// Steal and Bust of the Draft: every pick against where he ranks among the draft's players over the season
// (as the Draft tab's Season totals ranks them). Team id -> [{ nba, name, round, pick, rank, gain }]
function draftSteals() {
  const was = ui.draftMode;
  ui.draftMode = 'total';
  let d;
  try { d = draftData(); } finally { ui.draftMode = was; }
  if (!d || !d.graded || !d.played) return null;
  const out = {};
  for (const p of d.picks) (out[p.teamId] = out[p.teamId] || []).push({ nba: p.nbaId, name: p.name, round: p.round, pick: p.pick, rank: p.rank, gain: p.gain });
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
      let n = 0, sched = 0;
      for (const day of wd) {
        const team = teamOn(G, rows, day) || now;
        if (!(team && G.days.has(team) && G.days.get(team).has(day))) continue;
        sched++;
        if (!played.has(day)) n++;
      }
      if (!sched) continue;
      // one-game leagues: a missed game costs nothing while another counts, so a start is lost only with no game at all
      if (L.oneGame) { n = n === sched ? 1 : 0; sched = 1; }
      const team = out[o.tid] = out[o.tid] || new Map();
      // games: missed while starting; sched: his team's games while he started; weeks: weeks he missed any
      const P = team.get(nba) || { nba, name: (nbaById.get(nba) || {}).name || '', games: 0, sched: 0, weeks: 0 };
      P.games += n;
      P.sched += sched;
      if (n) P.weeks++;
      team.set(nba, P);
    }
  }
  return Object.fromEntries(Object.entries(out).map(([tid, m]) => [tid, [...m.values()].filter(P => P.games)]));
}

// ----- A finished matchup replayed: bench swaps that would have changed it -----
// Each team's starters' games that week, counted as Season totals counts them, and every single swap of a bench
// player for a starter: the bench player's games in place of the starter's in each lineup period of the week
// where one started and the other sat, as long as the lineup could still be filled from their positions.
// period: the matchup period; tids: its two teams. Returns [{ tid, tot, swaps: [{ inP, outP, tot }], starters, bench }]
// or null; starters and bench: [{ p, line }], a player's games while starting (bench: his games that week).
function benchSwaps(L, G, weeks, period, tids) {
  // the lineup periods that start within it (by time: the next one starts the evening this one ends)
  const rps = weeks.filter(w => fxTime(w.start) >= fxTime(period.lock) && fxTime(w.start) < fxTime(period.endAt));
  if (!rps.length) return null;
  const known = new Map();
  const playerOf = f => {
    if (!known.has(f)) { const nba = L.fidNba(f), raw = nba && nbaById.get(nba); known.set(f, raw ? playerFromRaw(raw, { fid: f }) : null); }
    return known.get(f);
  };
  // a player's games in one lineup period, added up (one-game leagues: a starter's that counted, a bench player's best)
  const lineMemo = new Map();
  const linesIn = (f, rp, on) => {
    const k = `${f}|${rp.n}|${L.oneGame && on ? 1 : 0}`;
    if (!lineMemo.has(k)) {
      const days = periodDays(G, rp), nba = L.fidNba(f), out = {};
      let rows = ((nba && G.players.get(nba)) || []).filter(r => days.has(r[0]));
      if (L.oneGame) rows = on ? countedRows(L, G, rp, f, rows) : bestRow(G, rows);
      for (const r of rows) for (const [s, v] of Object.entries(gameLine(G, r))) out[s] = (out[s] || 0) + v;
      lineMemo.set(k, out);
    }
    return lineMemo.get(k);
  };
  const add = (tot, line, sign) => { for (const [k, v] of Object.entries(line)) tot[k] = (tot[k] || 0) + sign * v; };
  const filled = ps => fillSlots(ps, state.slots).filter(Boolean).length;
  return tids.map(tid => {
    const tot = {}, started = new Map(), sat = new Map();
    const per = rps.map(rp => {
      const on = [], off = [];
      for (const [f, o] of rp.owner) if (o.tid === tid) (o.on ? on : off).push(f);
      for (const f of on) { add(tot, linesIn(f, rp, true), 1); if (!started.has(f)) started.set(f, {}); add(started.get(f), linesIn(f, rp, true), 1); }
      for (const f of off) { if (!sat.has(f)) sat.set(f, {}); add(sat.get(f), linesIn(f, rp, false), 1); }
      const starters = on.map(playerOf).filter(Boolean);
      return { rp, on, off, starters, n: filled(starters) };
    });
    // every bench player for every starter, in the periods where that swap was possible
    const swaps = new Map(); // "in|out" -> swap
    for (const P of per) {
      for (const fin of P.off) {
        const inP = playerOf(fin);
        if (!inP) continue;
        for (const fout of P.on) {
          const outP = playerOf(fout);
          if (!outP || filled([...P.starters.filter(p => p !== outP), inP]) < P.n) continue;
          const k = `${fin}|${fout}`;
          if (!swaps.has(k)) swaps.set(k, { inP, outP, tot: { ...tot } });
          add(swaps.get(k).tot, linesIn(fout, P.rp, true), -1);
          add(swaps.get(k).tot, linesIn(fin, P.rp, false), 1);
        }
      }
    }
    const list = m => [...m].map(([f, line]) => ({ p: playerOf(f), line })).filter(x => x.p);
    return { tid, tot, swaps: [...swaps.values()], starters: list(started), bench: list(sat).filter(x => !started.has(x.p.fid)) };
  });
}

// One team's week against another's: categories won, lost and tied (or fantasy points), and who led each
function weekScore(a, b) {
  const pts = leaguePoints();
  if (pts) { const x = lineFp(a), y = lineFp(b); return { me: x, opp: y, ties: 0, lead: [Math.sign(Math.round((x - y) * 10))] }; }
  const val = (s, c) => (c.pct ? (s[c.att] ? s[c.made] / s[c.att] : null) : lineStat(s, c.key));
  const lead = scoreCats().map(c => {
    const x = val(a, c), y = val(b, c);
    if (x == null || y == null) return x == null && y == null ? 0 : x == null ? -1 : 1;
    const d = c.pct ? Math.round((x - y) * 1e5) : Math.round((x - y) * 100);
    return Math.sign(c.neg ? -d : d);
  });
  return { me: lead.filter(x => x > 0).length, opp: lead.filter(x => x < 0).length, ties: lead.filter(x => !x).length, lead };
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
  ui.pastTeam = null; ui.viewA = null; ui.viewB = null;
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
  try { return viewingLeague(P.league, me ? me.id : null, fn); } finally { seasonCtx = null; BASE = baseNow(); } // back to this season's baselines
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
  const val = P => (!P.gp ? '—' : isPoints() ? fmt(total ? P.v : P.v / P.gp, total ? 0 : 1) : signed(total ? P.v : P.v / P.gp, total ? 1 : 2));
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
// ----- What made a team's award number (Waiver Wire Wizard, Unc Status), opened from its name -----
const awardDetails = new Map(); // "award|team" -> { title, html }, written as the awards draw
function awardRows(list, val, meta) {
  return `<ul class="aw-break">${list.map(p => `<li><div class="bplayer">${headshot({ nbaId: p.nba, name: p.name }, 28)}<div class="bmain"><button type="button" class="link-btn pname" data-action="player-detail" data-nba="${p.nba}">${esc(p.name)}</button><div class="muted small">${meta(p)}</div></div></div><b class="aw-break-v">${val(p)}</b></li>`).join('')}</ul>`;
}
function waiverDetail(T, txt) {
  const ps = [...(T.waiverList || [])].sort((a, b) => b.v - a.v);
  if (!ps.length) return '<p class="muted">No pickups started yet.</p>';
  const amount = p => (isPoints() ? `${fmt(p.v, 0)} FP` : signed(p.v, 1));
  const meta = p => `${p.games} G · ${p.weeks} wk${p.weeks === 1 ? '' : 's'}`;
  const up = ps.filter(p => p.v > 0), down = ps.filter(p => p.v <= 0).reverse();
  return `<p class="aw-break-total"><b>${esc(txt)}</b> from ${ps.length} pickup${ps.length === 1 ? '' : 's'} who started</p>
    ${up.length ? `<h3 class="sub">Helped</h3>${awardRows(up.slice(0, 10), amount, meta)}` : ''}
    ${down.length ? `<h3 class="sub">Hurt or did nothing</h3>${awardRows(down.slice(0, 10), amount, meta)}` : ''}
    <p class="muted small">Games in the weeks each pickup started (G · weeks started).</p>`;
}
function heartDetail(T, txt) {
  const ws = T.heart || [];
  if (!ws.length) return '<p class="muted">No close losses yet.</p>';
  const score = x => (isPoints() ? `${fmt(-x.margin, 1)} FP short` : `L ${x.wa}–${x.wb}`);
  return `<p class="aw-break-total"><b>${esc(txt)}</b> ${isPoints() ? 'by less than 5% of the winning score' : 'by a single category'}</p>
    <ul class="aw-break">${ws.map(x => `<li><div class="bmain"><b>Week ${x.n}</b> <span class="muted">${score(x)} vs ${esc(fxTeamName(x.opp))}</span>
      <div class="muted small">would have beaten ${fmt(x.beat, x.beat % 1 ? 1 : 0)} of ${x.of} teams that week</div></div></li>`).join('')}</ul>
    <p class="muted small">From the box scores, so a week can differ slightly from ${sourceName()}'s.</p>`;
}
function weekDetail(T, txt) {
  const W = T.bestWeek;
  if (!W) return '<p class="muted">No finished weeks yet.</p>';
  const rows = W.cats.map(c => `<li><div class="bmain"><b>${c.label}</b> <span class="muted">${c.rank === 1 ? 'best in the league' : `${ordinal(c.rank)} of ${W.of + 1}`}</span></div><b class="aw-break-v">${c.val}</b></li>`).join('');
  return `<p class="aw-break-total">Week ${W.n}: would have beaten <b>${fmt(W.beat, W.beat % 1 ? 1 : 0)} of ${W.of}</b> teams${isPoints() ? '' : `, ${signed(W.edge, 1)} categories a matchup on average`}. The real result: ${W.wa > W.wb ? 'won' : W.wa < W.wb ? 'lost' : 'tied'}${isPoints() ? '' : ` ${W.wa}–${W.wb}`} vs ${esc(fxTeamName(W.opp))}.</p>
    ${rows ? `<ul class="aw-break">${rows}</ul>` : ''}`;
}
function benchDetail(T, txt) {
  const ps = [...(T.benchList || [])].sort((a, b) => b.v - a.v).slice(0, 10);
  if (!ps.length) return '<p class="muted">No bench games yet.</p>';
  return `<p class="aw-break-total"><b>${esc(txt)}</b> from games played on the bench</p>
    ${awardRows(ps, p => (isPoints() ? `${fmt(p.v, 0)} FP` : signed(p.v, 1)), p => `${p.games} G · ${p.weeks} wk${p.weeks === 1 ? '' : 's'} benched`)}
    <p class="muted small">Every game a player played in a week he wasn't in the starting lineup (games · weeks benched).</p>`;
}
function fanDetail(T) {
  const F = T.fan;
  if (!F) return '<p class="muted">No starts yet.</p>';
  const top = F.teams[0];
  return `<p class="aw-break-total"><b>${Math.round(top.share * 100)}%</b> of ${F.n} starts were ${esc(top.team)} players</p>
    <ul class="aw-break">${F.teams.slice(0, 5).map(x => `<li><div class="bplayer">${teamLogo(x.team, 24)}<div class="bmain"><b>${esc(x.team)}</b><div class="muted small">${x.players.slice(0, 3).map(p => esc(p.name)).join(', ')}${x.players.length > 3 ? ` +${x.players.length - 3}` : ''}</div></div></div><b class="aw-break-v">${Math.round(x.share * 100)}%</b></li>`).join('')}</ul>
    <p class="muted small">A start is a player in the starting lineup for a week, counted for the NBA team he played for that week.</p>`;
}
const pickRows = list => awardRows(list, p => signed(p.gain, 0), p => `Rd ${p.round}, pick ${p.pick} · ranked ${ordinal(p.rank)}`);
function stealDetail(T) {
  const ps = [...(T.picksList || [])].sort((a, b) => b.gain - a.gain).slice(0, 5);
  return ps.length ? `<p class="aw-break-total">Its best picks against where each ranks among the draft's players over the season</p>${pickRows(ps)}` : '<p class="muted">No picks.</p>';
}
function bustDetail(T) {
  const ps = [...(T.picksList || [])].sort((a, b) => a.gain - b.gain).slice(0, 5);
  return ps.length ? `<p class="aw-break-total">Its worst picks against where each ranks among the draft's players over the season</p>${pickRows(ps)}` : '<p class="muted">No picks.</p>';
}
function managerDetail(T, txt) {
  const ws = T.weeksPlayed || [];
  if (!ws.length) return '<p class="muted">No finished weeks yet.</p>';
  const each = matchupScoring() === 'each' || !mostCatsWins(fxLeague().scoring);
  const res = x => (isPoints() ? (x.wa > x.wb ? 'W' : x.wa < x.wb ? 'L' : 'T') : `${x.wa > x.wb ? 'W' : x.wa < x.wb ? 'L' : 'T'} ${x.wa}–${x.wb}`); // a tied category counts half, as on the Dashboard
  const luck = x => x.res - x.exp; // a week's share of a win (or of the categories) above what the all-play said
  const rows = [...ws].reverse().map(x => `<li><div class="bmain"><b>Week ${x.n}</b> <span class="muted">${res(x)} vs ${esc(fxTeamName(x.opp))}</span>
      <div class="muted small">${each ? `${Math.round(x.exp * 100)}% of categories against everyone` : `would have beaten ${fmt(x.beat, x.beat % 1 ? 1 : 0)} of ${x.of}`}</div></div>
      <b class="aw-break-v ${luck(x) > 0.05 ? 'pos-good' : luck(x) < -0.05 ? 'pos-bad' : ''}">${signed(luck(x), 2)}</b></li>`).join('');
  return `<p class="aw-break-total"><b>${esc(txt)}</b>: ${esc(T.record)} against ${fmt(T.expW, 1)} expected from the all-play record</p>
    <ul class="aw-break">${rows}</ul>
    <p class="muted small">Each week: the real result, then how the team's totals did against every team. + is luck (won more than the week deserved), − bad luck. Results come from the box scores, so a week can differ slightly from ${sourceName()}'s.</p>`;
}
function draftDetail(T, txt) {
  const ps = [...(T.draftList || [])].sort((a, b) => b.v - a.v);
  if (!ps.length) return '<p class="muted">No picks to grade.</p>';
  const amount = p => (isPoints() ? `${fmt(p.v, 0)} FP` : signed(p.v, 1));
  const meta = p => `Rd ${p.round}, #${p.pick} · ${p.games} G${p.dropped ? ` · dropped wk ${p.dropped}` : ''}`;
  const best = ps.filter(p => p.v > 0).slice(0, 10), worst = ps.filter(p => p.v <= 0 && !best.includes(p)).reverse().slice(0, 5);
  return `<p class="aw-break-total"><b>${esc(txt)}</b> from ${ps.length} pick${ps.length === 1 ? '' : 's'}</p>
    ${best.length ? `<h3 class="sub">Best picks</h3>${awardRows(best, amount, meta)}` : ''}
    ${worst.length ? `<h3 class="sub">Worst picks</h3>${awardRows(worst, amount, meta)}` : ''}
    <p class="muted small">${isPoints() ? 'Fantasy points' : "Value above a replacement-level starter"} from each pick's games until he was first dropped, through trades (round and pick · games).</p>`;
}
function streetDetail(T, txt) {
  const ps = [...(T.missedList || [])].sort((a, b) => b.games - a.games || a.sched - b.sched).slice(0, 10);
  if (!ps.length) return '<p class="muted">No starter has missed a game yet.</p>';
  if (isOneGame()) {
    return `<p class="aw-break-total"><b>${esc(txt)}</b> by ${T.missedN} starter${T.missedN === 1 ? '' : 's'}. ${T.missedN > 10 ? 'The 10 with the most:' : ''}</p>
    ${awardRows(ps, p => `${p.games} wk${p.games === 1 ? '' : 's'}`, p => `started ${p.sched} wk${p.sched === 1 ? '' : 's'}`)}
    <p class="muted small">Weeks he was in the starting lineup without playing a game while his NBA team did (out of his weeks starting).</p>`;
  }
  return `<p class="aw-break-total"><b>${esc(txt)}</b> missed by ${T.missedN} starter${T.missedN === 1 ? '' : 's'}. ${T.missedN > 10 ? 'The 10 who missed most:' : ''}</p>
    ${awardRows(ps, p => `${p.games} G`, p => `out ${p.games} of ${p.sched} · ${p.weeks} wk${p.weeks === 1 ? '' : 's'}`)}
    <p class="muted small">Games his NBA team played without him in weeks he was in the starting lineup (out of his team's games those weeks · weeks he missed any).</p>`;
}
function uncDetail(T, txt) {
  const ps = [...(T.ageList || [])].sort((a, b) => b.moved - a.moved).slice(0, 10);
  if (!ps.length) return '<p class="muted">No starters with a birth date on record.</p>';
  return `<p class="aw-break-total">Starters' average age <b>${esc(txt)}</b>. These moved it most:</p>
    ${awardRows(ps, p => `${p.moved >= 0 ? '+' : '−'}${fmt(Math.abs(p.moved), 2)} yrs`, p => `age ${Math.floor(p.age)} · ${p.weeks} wk${p.weeks === 1 ? '' : 's'}`)}
    <p class="muted small">How much older (+) or younger (−) the team's average is with each player than without him (age · weeks started).</p>`;
}

function seasonAwards() {
  const L = fxLeague();
  const G = L.season ? gameLogs[L.season] : null;
  if (!L.weeks || !G) return null;
  const teams = fxPickable().map(t => ({ id: t.id, name: t.name }));
  const each = !isPoints() && (matchupScoring() === 'each' || !mostCatsWins(L.scoring));

  // Best manager: actual wins against an all-play record
  const allPlay = allPlayRecords(L, G, each);
  for (const T of teams) {
    const A = allPlay && allPlay[T.id], r = standingOf(T.id);
    if (!A || !r) continue;
    T.record = `${r.w}-${r.l}${r.t ? '-' + r.t : ''}`;
    T.expW = A.exp;
    T.allPct = A.pct;
    T.luck = r.w + r.t / 2 - A.exp;
    T.weeksPlayed = A.list;
  }
  // Week of the Year: each team's best week against everyone; Heartbreak Hotel: its losses by one category
  // (points leagues: by under 5% of the winning score)
  for (const T of teams) {
    const ws = (allPlay && allPlay[T.id] && allPlay[T.id].list) || [];
    if (!ws.length) continue;
    const b = ws.reduce((x, y) => (y.beat > x.beat || (y.beat === x.beat && y.edge > x.edge) ? y : x));
    const rivals = Object.values(allPlay).map(A => (A.list.find(x => x.n === b.n) || {}).s).filter(Boolean);
    const catRank = c => {
      const v = s => (c.pct ? (s[c.att] ? s[c.made] / s[c.att] : 0) : lineStat(s, c.key));
      const mine = v(b.s);
      return { label: c.label, val: c.pct ? fmtPct(mine) : fmt(mine, 0), rank: 1 + rivals.filter(s => (c.neg ? v(s) < mine : v(s) > mine) && Math.abs(v(s) - mine) > 1e-9).length };
    };
    T.bestWeek = { ...b, cats: isPoints() ? [] : scoreCats().map(catRank) };
    T.weekBeat = b.beat + b.edge / 100; // ranks by teams beaten, then the margin
    T.heart = ws.filter(x => (isPoints() ? x.margin < 0 && -x.margin < 0.05 * x.theirs : x.wb - x.wa > 0 && x.wb - x.wa <= 1));
    T.heartN = T.heart.length || null; // no close loss: not in the running
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
      T[key + 'List'] = ps;
    }
  };
  const d = draftData();
  tally(d && d.graded ? draftImpact(L, G, d.picks) : null, 'draft', p => p.v);
  tally(pickupImpact(L, G), 'waiver', p => p.v);
  tally(startersMissed(L, G), 'missed', p => p.games);
  tally(benchValue(L, G), 'bench', p => p.v);
  const fans = startsByNbaTeam(L, G) || {};
  for (const T of teams) { const F = fans[T.id]; T.fan = F && F.teams.length ? F : null; T.fanShare = T.fan ? T.fan.teams[0].share : null; }
  const steals = draftSteals();
  for (const T of teams) {
    const ps = (steals && steals[T.id]) || [];
    T.picksList = ps;
    T.steal = ps.length ? ps.reduce((a, b) => (b.gain > a.gain ? b : a)) : null;
    T.bust = ps.length ? ps.reduce((a, b) => (b.gain < a.gain ? b : a)) : null;
    T.stealGain = T.steal ? T.steal.gain : null;
    T.bustGain = T.bust ? T.bust.gain : null;
  }
  const olds = startersAge(L) || {};
  for (const T of teams) { const O = olds[T.id]; T.age = O ? O.age : null; T.oldest = O ? O.oldest : null; T.ageList = O ? O.players : []; }

  const total = v => (isPoints() ? `${Math.round(v).toLocaleString()} FP` : `${signed(v, 1)} value`);
  const ranked = (key, dir, fmtFn, note) => teams.filter(T => T[key] != null).sort((a, b) => (b[key] - a[key]) * dir).map(T => ({ T, txt: fmtFn(T), note: note ? note(T) : '' }));
  const pickupNote = T => {
    const b = T.waiverTop;
    if (!b) return 'no pickups';
    return `${T.waiverN} pickup${T.waiverN === 1 ? '' : 's'}, best: ${b.name} (${isPoints() ? `${fmt(b.v, 0)} FP` : signed(b.v, 1)} in ${b.weeks} wk${b.weeks === 1 ? '' : 's'})`;
  };
  return [
    { title: 'Best draft', info: 'awDraft', detail: draftDetail, list: ranked('draft', 1, T => total(T.draft), T => (T.draftTop ? `best: ${T.draftTop.name} (${total(T.draftTop.v)} over ${T.draftTop.games} games)` : '')) },
    ...(steals ? [
      { title: 'Steal of the Draft', info: 'awSteal', detail: stealDetail, list: ranked('stealGain', 1, T => signed(T.stealGain, 0), T => `${T.steal.name}: pick ${T.steal.pick}, ranked ${ordinal(T.steal.rank)}`) },
      { title: 'Bust of the Draft', info: 'awBust', detail: bustDetail, list: ranked('bustGain', -1, T => signed(T.bustGain, 0), T => `${T.bust.name}: pick ${T.bust.pick}, ranked ${ordinal(T.bust.rank)}`) }] : []),
    { title: 'Best manager', info: 'awManager', detail: managerDetail, list: ranked('luck', 1, T => `${signed(T.luck, 1)} ${each ? 'cats' : 'wins'}`, T => `${T.record}, all-play ${Math.round(T.allPct * 100)}% (${fmt(T.expW, 1)} expected)`) },
    { title: 'Week of the Year', info: 'awWeek', detail: weekDetail, list: ranked('weekBeat', 1, T => `week ${T.bestWeek.n}: beat ${fmt(T.bestWeek.beat, T.bestWeek.beat % 1 ? 1 : 0)} of ${T.bestWeek.of}`, T => (isPoints() ? `${signed(T.bestWeek.edge, 1)} FP a matchup on average` : `${signed(T.bestWeek.edge, 1)} categories a matchup on average`)) },
    { title: 'Heartbreak Hotel', info: 'awHeart', detail: heartDetail, list: ranked('heartN', 1, T => `${T.heartN} close loss${T.heartN === 1 ? '' : 'es'}`, T => (T.heartN ? `weeks ${T.heart.map(x => x.n).join(', ')}` : '')) },
    { title: 'Waiver Wire Wizard', info: 'awWaiver', detail: waiverDetail, list: ranked('waiver', 1, T => (isPoints() ? `${fmt(T.waiver, 0)} FP` : `${signed(T.waiver, 1)} value`), pickupNote) },
    { title: 'Benchwarmer Blues', info: 'awBench', detail: benchDetail, list: ranked('bench', 1, T => total(T.bench), T => (T.benchTop ? `most: ${T.benchTop.name} (${total(T.benchTop.v)} in ${T.benchTop.games} games)` : '')) },
    { title: 'Street Clothes', info: 'awStreet', detail: streetDetail, list: ranked('missed', 1, T => (isOneGame() ? `${T.missed} empty start${T.missed === 1 ? '' : 's'}` : `${T.missed} game${T.missed === 1 ? '' : 's'}`), T => (T.missedTop ? `most: ${T.missedTop.name} (${T.missedTop.games})` : '')) },
    ...(cats.length ? [{ title: 'Biggest punt', info: 'awPunt', list: ranked('punt', 1, T => T.punt.cat, T => `${fmt(-T.punt.z, 1)} spreads below average`).sort((a, b) => a.T.punt.z - b.T.punt.z) },
      { title: 'Even Steven', info: 'awSteven', list: ranked('spread', -1, T => `${fmt(T.spread, 2)} spread`, T => { const order = [...cats].sort((a, b) => T.z[b.key] - T.z[a.key]); return `best: ${order[0].label} · worst: ${order[order.length - 1].label}`; }) }] : []),
    { title: 'Fan Boy', info: 'awFan', detail: fanDetail, list: ranked('fanShare', 1, T => `${Math.round(T.fanShare * 100)}% ${T.fan.teams[0].team}`, T => `${T.fan.teams[0].n} of ${T.fan.n} starts`) },
    { title: 'Unc Status', info: 'awUnc', detail: uncDetail, list: ranked('age', 1, T => `${fmt(T.age, 1)} yrs`, T => (T.oldest ? `oldest regular: ${T.oldest.name} (${Math.floor(T.oldest.age)}, ${T.oldest.weeks} wks)` : '')) },
  ].filter(a => a.list.length);
}

// The season underway: the same awards, from this season's weekly lineups and box scores so far
const curAwards = {}; // league id -> { weeks, fidNba } once loaded
function viewAwardsSoFar() {
  const L = fxLeague();
  if (!L || !NBA) return '';
  if (!hasLineupHistory(L)) return `<div class="card"><div class="empty"><strong>No awards for ${esc(sourceName(L))} leagues yet</strong>Awards come from every day's lineups, which the site reads from Fantrax and Sleeper only for now.</div></div>`;
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
  const done = C.weeks.filter(periodOver).length;
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
  awardDetails.clear();
  if (!awards) return `<div class="card"><div class="empty"><strong>No awards for this season</strong>Awards need Fantrax's weekly lineups and that season's NBA game logs (the site has 2016-17 on).</div></div>`;
  // awards with a breakdown: each team's name opens what made its number (written now, in this season's context)
  const name = (a, x, place) => {
    if (!a.detail) return esc(x.T.name);
    const key = `${a.title}|${x.T.id}`;
    awardDetails.set(key, { title: `${a.title}: ${place}. ${x.T.name}`, html: a.detail(x.T, x.txt) });
    return `<button type="button" class="link-btn aw-team" data-action="award-team" data-key="${esc(key)}">${esc(x.T.name)}</button>`;
  };
  return `
  <div class="awards">${awards.map(a => {
    const [win, ...rest] = a.list;
    return `<div class="card award">
      <div class="aw-title">${a.title} ${infoBtn(a.info)}</div>
      <div class="aw-win${win.T.id === me ? ' me' : ''}"><span class="aw-name">${name(a, win, 1)}${win.T.id === me ? ' <span class="badge accent">you</span>' : ''}</span><span class="aw-val">${esc(win.txt)}</span></div>
      ${win.note ? `<div class="small muted">${esc(win.note)}</div>` : ''}
      <ol class="aw-list" start="2">${rest.map((x, i) => `<li class="${x.T.id === me ? 'me' : ''}" title="${esc(x.note)}"><span>${name(a, x, i + 2)}</span><span class="muted">${esc(x.txt)}</span></li>`).join('')}</ol>
    </div>`;
  }).join('')}</div>`;
}
