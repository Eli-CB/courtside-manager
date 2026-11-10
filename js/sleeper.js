// League Layer: Loading Sleeper leagues.
// The site loads js/*.js in order (see index.html); they share one scope, like one file.
'use strict';

// ----- Sleeper leagues, fetched in the browser -----
// Sleeper's API answers any site with no sign-in. Each league becomes the shape fetchFantraxLeague returns, so every
// tab works the same whichever site a league is on.
// Sleeper basketball is points only, and counts ONE game a week for each starter: in Lock-In mode the game a manager
// locks in after it's played (else his last game of the week), in Game Pick mode the game picked for him. A Sleeper
// league is marked oneGame, and projections and the Dashboard's period score count one game per starter (oneGameLine).
// Weeks run Monday to Sunday from opening night (no All-Star exception: checked against 2025-26's weekly points).
// Players are named only by Sleeper's ids; the daily data job gives each NBA player his ('slp').
const SLEEPER_API = 'https://api.sleeper.app/v1/';
const slpGet = path => getJson(SLEEPER_API + path, 'Sleeper');
// Sleeper's scored stats -> ours (the rest, bonuses and technicals among them, aren't projected)
const SLEEPER_STATS = { pts: 'pts', reb: 'reb', oreb: 'oreb', dreb: 'dreb', ast: 'ast', stl: 'stl', blk: 'blk', to: 'to', tpm: 'tpm', tpa: 'tpa',
  tpmi: 'tpmi', fgm: 'fgm', fga: 'fga', fgmi: 'fgmi', ftm: 'ftm', fta: 'fta', ftmi: 'ftmi', dd: 'dd', td: 'td', pf: 'pf' };
const SLEEPER_OTHER = { bonus_pt_40p: '40+ point games', bonus_pt_50p: '50+ point games', bonus_reb_20p: '20+ rebound games',
  bonus_ast_15p: '15+ assist games', ff: 'flagrant fouls', tf: 'technical fouls', plus_minus: 'plus/minus' };

// One-game bonuses: [Sleeper's key, our stat, at least]. A game's are in its fantasy points (gameBonus), not projected.
const SLEEPER_BONUS = [['bonus_pt_40p', 'pts', 40], ['bonus_pt_50p', 'pts', 50], ['bonus_reb_20p', 'reb', 20], ['bonus_ast_15p', 'ast', 15]];
function sleeperScoring(ss, sport = 'nba') {
  const points = {}, other = [], bonus = [];
  for (const [k, v] of Object.entries(ss || {})) {
    if (!+v) continue;
    if (sport === 'nfl') { // scored by the stat's own name; one not in the data (a stat no game has had yet) is 0 anyway
      points[k] = +v;
      continue;
    }
    const b = SLEEPER_BONUS.find(x => x[0] === k);
    if (b) bonus.push([b[1], b[2], +v]);
    if (SLEEPER_STATS[k]) points[SLEEPER_STATS[k]] = (points[SLEEPER_STATS[k]] || 0) + +v;
    else other.push(SLEEPER_OTHER[k] || k);
  }
  return Object.keys(points).length ? { points, pointsOther: other, bonus } : {};
}
// A single game's bonus points (40-point games and the like; Sleeper adds each one it reaches)
function gameBonus(line) {
  const L = fxLeague();
  return L && L.bonus ? sum(L.bonus.map(([k, at, v]) => ((line[k] || 0) >= at ? v : 0))) : 0;
}
// A single game with its bonus points carried along (as 'bonus', which lineFp adds), so totals of games keep them
const withBonus = line => { const b = gameBonus(line); return b ? { ...line, bonus: b } : line; };

// Which of a starter's games (lines, oldest first) Sleeper counted, from its points for him that week: the nearest
// (technicals and flagrant fouls aren't in our points). None when Sleeper has 0 and no game comes close: he went
// into the lineup after his games. Without Sleeper's points, his last game (what Sleeper counts unless one's locked).
function countedIndex(lines, pts) {
  if (!lines.length) return -1;
  if (pts == null) return lines.length - 1;
  let at = 0;
  lines.forEach((l, i) => { if (Math.abs(lineFp(withBonus(l)) - pts) < Math.abs(lineFp(withBonus(lines[at])) - pts)) at = i; });
  return pts === 0 && Math.abs(lineFp(withBonus(lines[at]))) > 3 ? -1 : at;
}

// The league's weeks with their dates: Sleeper's week n is the n-th Monday-to-Sunday week from opening night. A league
// plays from its start week through the playoffs, a week a round.
// Football: its schedule's weeks (the daily file's), Tuesday to Monday night.
function sleeperPeriods(s, dayOne, weeks) {
  const first = Math.max(1, +s.start_week || 1);
  const rounds = +s.playoff_teams > 1 ? Math.ceil(Math.log2(+s.playoff_teams)) : 0;
  const last = (+s.playoff_week_start || 22) - 1 + rounds;
  const out = [];
  if (weeks) {
    for (const [n, [start, end]] of Object.entries(weeks)) if (+n >= first && +n <= last) out.push({ n: +n, start, end, lock: `${start}T00:00:00`, endAt: `${end}T23:59:00` });
    return out.sort((a, b) => a.n - b.n);
  }
  let start = dayOne;
  for (let n = 1; n <= last; n++) {
    const dow = new Date(start + 'T12:00:00').getDay(); // 0 = Sunday
    const end = addDays(start, dow === 0 ? 0 : 7 - dow);
    if (n >= first) out.push({ n, start, end, lock: `${start}T00:00:00`, endAt: `${end}T23:59:00` });
    start = addDays(end, 1);
  }
  return out;
}

// The week on now (or the next one, between weeks; the last one after the season)
const sleeperWeekNow = periods => (periods.find(p => todayIso() <= p.end) || periods[periods.length - 1] || {}).n || 1;

// Sleeper's slot names -> the ones fxSlot understands ('UTIL' is any position)
const sleeperSlot = (x, sport = 'nba') => (x === 'UTIL' ? 'Util' : (SPORTS[sport].slpSlots || {})[x] || String(x).replace(/_/g, '/'));

async function fetchSleeperLeague(id) {
  let lg;
  try { lg = await slpGet(`league/${encodeURIComponent(id)}`); } catch (e) { throw e; }
  if (!lg || !lg.league_id) throw new Error('League not found');
  if (lg.sport && lg.sport !== 'nba' && lg.sport !== 'nfl') throw new Error(`that's a Sleeper ${String(lg.sport).toUpperCase()} league, not basketball or football`);
  // that sport's data, without changing the page (switchLeague opens it)
  const sport = lg.sport === 'nfl' ? 'nfl' : 'nba', D = SPORT.key === sport && NBA ? NBA : await fetchSport(sport);
  const s = lg.settings || {};
  const dayOne = [...new Set(Object.values(D.teams || {}).flatMap(t => t.dates || []))].sort()[0] || todayIso();
  const periods = sleeperPeriods(s, dayOne, sport === 'nfl' ? D.weeks : null);
  const cur = sleeperWeekNow(periods);
  const weeksWanted = [cur - 1, cur, cur + 1].filter(n => periods.some(p => p.n === n));
  const [rostersRaw, users, draftPicks, draft, ...weeks] = await Promise.all([
    slpGet(`league/${id}/rosters`), slpGet(`league/${id}/users`),
    lg.draft_id ? slpGet(`draft/${lg.draft_id}/picks`).catch(() => null) : [],
    lg.draft_id ? slpGet(`draft/${lg.draft_id}`).catch(() => null) : null,
    ...weeksWanted.map(n => slpGet(`league/${id}/matchups/${n}`).catch(() => [])),
  ]);
  const rosters = Array.isArray(rostersRaw) ? rostersRaw : [];

  // Sleeper ids -> NBA.com players (the daily data file carries each player's), names for anyone not matched
  const toNba = {}, names = {};
  const byId = new Map(D.players.map(r => [r.id, r]));
  for (const raw of D.players) if (raw.slp) { toNba[raw.slp] = raw.id; names[raw.slp] = raw.name; }
  for (const p of draftPicks || []) {
    const m = p.metadata || {};
    if (p.player_id && !names[p.player_id]) names[p.player_id] = `${m.first_name || ''} ${m.last_name || ''}`.trim();
  }
  const rostered = new Set(rosters.flatMap(r => r.players || []));
  const fxPlayers = {};
  // Sleeper's own positions (its lineups follow them), else NBA.com's
  for (const [sid, nba] of Object.entries(toNba)) fxPlayers[nba] = { id: sid, st: rostered.has(sid) ? 'T' : 'A', pos: (byId.get(nba) || {}).slpPos || [] };

  const userOf = new Map((users || []).map(u => [u.user_id, u]));
  const teamName = r => {
    const u = userOf.get(r.owner_id) || {};
    return String((u.metadata && u.metadata.team_name) || u.display_name || `Team ${r.roster_id}`).trim();
  };
  const teams = rosters.map(r => ({ id: String(r.roster_id), name: teamName(r) }));

  // lineup slots, bench and IR in the shape slotsFromLeague reads
  const pos = lg.roster_positions || [];
  const startSlots = pos.filter(x => x !== 'BN' && x !== 'IR');
  const nBench = pos.filter(x => x === 'BN').length;
  const constraints = {};
  for (const x of startSlots) { const k = sleeperSlot(x, sport); constraints[k] = { maxActive: ((constraints[k] || {}).maxActive || 0) + 1 }; }
  const rosterInfo = {
    positionConstraints: constraints, maxTotalActivePlayers: startSlots.length, maxTotalReservePlayers: nBench,
    maxTotalPlayers: startSlots.length + nBench + (+s.reserve_slots || 0),
  };
  const item = (sid, slot, st) => ({ fid: sid, nba: toNba[sid] || null, name: names[sid] || `Player ${sid}`, slot, st });
  const leagueRosters = Object.fromEntries(rosters.map(r => {
    const starters = r.starters || [], ir = new Set(r.reserve || []);
    const out = starters.map((sid, i) => (sid && sid !== '0' ? item(sid, sleeperSlot(startSlots[i] || 'UTIL', sport), 'ACTIVE') : null)).filter(Boolean);
    const seen = new Set(out.map(x => x.fid));
    for (const sid of r.players || []) if (!seen.has(sid)) out.push(item(sid, '', ir.has(sid) ? 'INJURED_RESERVE' : 'RESERVE'));
    return [String(r.roster_id), out];
  }));

  // matchups: the week before, this week and the next (Sleeper pairs teams by matchup_id; none = a bye)
  const matchups = {};
  weeksWanted.forEach((n, i) => {
    const by = {};
    for (const m of weeks[i] || []) if (m.matchup_id != null) (by[m.matchup_id] = by[m.matchup_id] || []).push(String(m.roster_id));
    const pairs = Object.values(by).filter(x => x.length === 2);
    if (pairs.length) matchups[n] = pairs;
  });
  // this week's points so far for each player: the game that counts for him (locked in, picked, or his latest)
  const thisWeek = weeks[weeksWanted.indexOf(cur)] || [];
  const weekPts = {};
  for (const m of thisWeek) Object.assign(weekPts, m.players_points || {});

  const pf = r => (+r.settings.fpts || 0) + (+r.settings.fpts_decimal || 0) / 100;
  const rows = rosters.map(r => ({ r, w: +r.settings.wins || 0, l: +r.settings.losses || 0, t: +r.settings.ties || 0 }))
    .sort((a, b) => (b.w + b.t / 2) - (a.w + a.t / 2) || pf(b.r) - pf(a.r));
  const top = rows[0] || { w: 0, l: 0 };
  const standings = rows.map((x, i) => ({ id: String(x.r.roster_id), name: teamName(x.r), rank: i + 1, w: x.w, l: x.l, t: x.t, gb: ((top.w - x.w) + (x.l - top.l)) / 2, pf: pf(x.r) }));

  const draftAt = draft && draft.start_time ? new Date(draft.start_time).toISOString() : null;
  const league = {
    id, source: 'sleeper', sport, name: String(lg.name || '').trim(), scoring: 'POINTS',
    historyId: null, year: +lg.season || null,
    ...sleeperScoring(lg.scoring_settings, sport),
    oneGame: true, gameMode: +s.game_mode === 0 ? 'pick' : 'lockin',
    teams, periods,
    lockDays: 1, // lineups change day by day until a game is locked in
    playoffPeriod: +s.playoff_teams > 1 ? +s.playoff_week_start || null : null,
    matchups,
    rosterPeriod: null, rosterPeriods: [],
    rosters: leagueRosters, openingRosters: null, rosterInfo,
    draft: null, draftAt, standings,
    slpWeek: { n: cur, pts: weekPts, at: Date.now() },
    // the waiver order (1 = first claim); a budget league (waiver_type 2, FAAB) also has each team's budget left
    waivers: rosters.some(r => +r.settings.waiver_position > 0) ? rosters.filter(r => +r.settings.waiver_position > 0)
      .map(r => ({ id: String(r.roster_id), rank: +r.settings.waiver_position, left: +s.waiver_type === 2 ? (+s.waiver_budget || 0) - (+r.settings.waiver_budget_used || 0) : null }))
      .sort((a, b) => a.rank - b.rank) : null,
    ...(draftPicks ? {} : { draftFailed: true }), // the picks didn't come: asked for again next time
  };
  const picks = (draftPicks || []).filter(p => p.player_id);
  if (picks.length) {
    const keepers = {};
    for (const p of picks.filter(x => x.is_keeper)) { const nba = toNba[p.player_id], tid = String(p.roster_id); if (nba) (keepers[tid] = keepers[tid] || []).push(nba); }
    const drafted = picks.filter(p => !p.is_keeper);
    league.draft = {
      date: (draftAt || '').slice(0, 10), type: String((draft && draft.type) || '').toLowerCase(), state: draft && draft.status === 'complete' ? 'completed' : '',
      perRound: +((draft && draft.settings) || {}).teams || teams.length,
      picks: drafted.map(p => [p.round, p.pick_no, String(p.roster_id), toNba[p.player_id] || null, names[p.player_id] || '']),
      rounds: Math.max(...drafted.map(p => p.round)),
      keepers,
    };
  }
  return { league, fxPlayers, idMap: { toNba, names } };
}

// ----- Weekly lineups (Awards, Recap, Season totals) -----
// Each week's matchups carry every team's players, its starters and each player's points that week (for a starter,
// the game that counted). As loadRosterWeeks keeps them: team id -> [[Sleeper id, 1 if starting, points]], and under
// '#m' the week's pairings (the league itself only brings this week's and its neighbors')
function sleeperWeekRosters(ms) {
  const list = Array.isArray(ms) ? ms : [], by = {};
  for (const m of list) if (m.matchup_id != null) (by[m.matchup_id] = by[m.matchup_id] || []).push(String(m.roster_id));
  const out = Object.fromEntries(list.map(m => {
    const on = new Set(m.starters || []), pts = m.players_points || {};
    return [String(m.roster_id), (m.players || []).map(f => [f, on.has(f) ? 1 : 0, pts[f] != null ? +pts[f] : null])];
  }));
  out['#m'] = Object.values(by).filter(x => x.length === 2);
  return out;
}

// ----- This week's counted games, kept current while the Dashboard is open -----
// Sleeper's points for each player this week are the game that counts for him so far; asked for again at most every
// 2 minutes (it's one small request), so a game locked in shows up without a full reload.
let slpWeekLoad = null;
function sleeperWeekFresh(L) {
  // (football: as often as the rest of its live scores, these being them)
  if (!L || L.source !== 'sleeper' || slpWeekLoad || (L.slpWeek && Date.now() - L.slpWeek.at < feedWait('Sleeper live points', isFootball() ? 30000 : 120000))) return;
  const n = sleeperWeekNow(L.periods);
  slpWeekLoad = slpGet(`league/${L.id}/matchups/${n}`).then(ms => {
    const pts = {};
    for (const m of ms || []) Object.assign(pts, m.players_points || {});
    L.slpWeek = { n, pts, at: Date.now() };
    noteLiveOk('Sleeper live points');
    if (ui.tab === 'dashboard' || (ui.tab === 'week' && isFootball())) { live.hold = true; try { render(); } finally { live.hold = false; } }
  }).catch(e => {
    L.slpWeek = { ...(L.slpWeek || { n, pts: {} }), at: Date.now() };
    noteLiveFailure(e.message || "couldn't reach Sleeper", 'Sleeper live points');
  }).finally(() => { slpWeekLoad = null; });
}

// One-game leagues: the one game of a player's that counts among his lines this period (oldest first), with its
// bonus points: Sleeper's points for him this week say which (countedIndex)
function oneGameLine(p, lines) {
  const L = fxLeague(), raw = nbaById.get(p.nbaId);
  const pts = L && L.slpWeek && raw && raw.slp && L.slpWeek.pts[raw.slp] != null ? +L.slpWeek.pts[raw.slp] : null;
  const i = countedIndex(lines, pts);
  return i < 0 ? null : withBonus(lines[i]);
}
const isOneGame = () => !!(fxLeague() && fxLeague().oneGame);
