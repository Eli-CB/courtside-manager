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

// A keeper or dynasty league's future picks (leaguePicks, fantrax.js). Sleeper lists only the ones traded (traded_picks:
// season, round, roster_id = the team whose pick it was, owner_id = the team with it now); every other pick is still its
// own team's. The seasons: from the next draft (this season's while its draft is to come), three in a dynasty league and
// one in a keeper league (Sleeper's own limits as understood, not yet checked on a real league), and any season a trade names.
async function fetchSleeperPicks(L) {
  const I = L.pickInfo, traded = await slpGet(`league/${encodeURIComponent(L.id)}/traded_picks`);
  if (!I.rounds) return [];
  const first = I.drafted ? I.season + 1 : I.season;
  const years = new Set(Array.from({ length: I.type === 2 ? 3 : 1 }, (x, i) => first + i));
  for (const t of traded || []) if (+t.season >= first) years.add(+t.season);
  const owner = new Map((traded || []).map(t => [`${t.season}|${t.round}|${t.roster_id}`, String(t.owner_id)]));
  return [...years].sort().flatMap(y => Array.from({ length: I.rounds }, (x, i) => i + 1)
    .flatMap(r => L.teams.map(t => ({ year: y, round: r, from: t.id, owner: owner.get(`${y}|${r}|${t.id}`) || t.id }))));
}

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
  const onRoster = new Set(rosters.flatMap(r => r.players || []));
  const fxPlayers = {};
  // Sleeper's own positions (its lineups follow them), else NBA.com's
  for (const [sid, nba] of Object.entries(toNba)) fxPlayers[nba] = { id: sid, st: onRoster.has(sid) ? 'T' : 'A', pos: (byId.get(nba) || {}).slpPos || [] };

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
  // a dynasty league's taxi squad (r.taxi, in r.players too): kept like IR, never in a lineup (Sleeper won't start them)
  const taxi = rosters.flatMap(r => r.taxi || []);
  const leagueRosters = Object.fromEntries(rosters.map(r => {
    const starters = r.starters || [], ir = new Set(r.reserve || []), tx = new Set(r.taxi || []);
    const out = starters.map((sid, i) => (sid && sid !== '0' ? item(sid, sleeperSlot(startSlots[i] || 'UTIL', sport), 'ACTIVE') : null)).filter(Boolean);
    const seen = new Set(out.map(x => x.fid));
    for (const sid of r.players || []) if (!seen.has(sid)) out.push(item(sid, '', ir.has(sid) ? 'INJURED_RESERVE' : tx.has(sid) ? 'TAXI' : 'RESERVE'));
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

  const pf = slpPf;
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
    rosters: leagueRosters, openingRosters: null, rosterInfo, ...(taxi.length ? { taxi } : {}),
    draft: null, draftAt, standings,
    slpWeek: { n: cur, pts: weekPts, at: Date.now() },
    // the waiver order (1 = first claim); a budget league (waiver_type 2, FAAB) also has each team's budget left
    waivers: rosters.some(r => +r.settings.waiver_position > 0) ? rosters.filter(r => +r.settings.waiver_position > 0)
      .map(r => ({ id: String(r.roster_id), rank: +r.settings.waiver_position, left: +s.waiver_type === 2 ? (+s.waiver_budget || 0) - (+r.settings.waiver_budget_used || 0) : null }))
      .sort((a, b) => a.rank - b.rank) : null,
    ...(draftPicks ? {} : { draftFailed: true }), // the picks didn't come: asked for again next time
    // what its future picks need (fetchSleeperPicks): its type (0 redraft, 1 keeper, 2 dynasty), rounds, season, drafted yet
    pickInfo: { type: +s.type || 0, rounds: +s.draft_rounds || 0, season: +lg.season || 0, drafted: !['pre_draft', 'drafting'].includes(lg.status) },
  };
  // basketball: each finished week's real result, and the season totals that give its real score (sleeperResults)
  if (sport === 'nba' && periods.length) {
    Object.assign(league, sleeperResults(rosters, periods[0].n, league.playoffPeriod));
    if (league.totals) slpTotalsSave(id, league.totals);
  }
  const picks = (draftPicks || []).filter(p => p.player_id);
  if (picks.length) {
    const keepers = {};
    for (const p of picks.filter(x => x.is_keeper)) { const nba = toNba[p.player_id], tid = String(p.roster_id); if (nba) (keepers[tid] = keepers[tid] || []).push(nba); }
    const drafted = picks.filter(p => !p.is_keeper);
    const perRound = +((draft && draft.settings) || {}).teams || teams.length, rounds = Math.max(...drafted.map(p => p.round));
    // the board's columns: whose each draft slot is (slot_to_roster_id), traded picks or not; each pick says its slot
    const slotTeam = (draft && draft.slot_to_roster_id) || {};
    const slots = Array.from({ length: perRound }, (x, i) => (slotTeam[i + 1] != null ? String(slotTeam[i + 1]) : null));
    // a dynasty league's rookie draft (fewer rounds than lineup and bench spots): everyone else on a roster was kept, so
    // Reach and Fall rank a pick among the players on no roster (today's rosters stand in for draft day's)
    const taken = new Set(drafted.map(p => p.player_id));
    const rostered = +s.type === 2 && rounds < startSlots.length + nBench
      ? [...onRoster].filter(sid => !taken.has(sid) && toNba[sid]).map(sid => toNba[sid]) : null;
    league.draft = {
      date: (draftAt || '').slice(0, 10), type: String((draft && draft.type) || '').toLowerCase(), state: draft && draft.status === 'complete' ? 'completed' : '',
      perRound,
      picks: drafted.map(p => [p.round, p.pick_no, String(p.roster_id), toNba[p.player_id] || null, names[p.player_id] || '', null, +p.draft_slot || null]),
      rounds,
      keepers,
      ...(slots.every(Boolean) ? { slots } : {}),
      ...(rostered ? { rostered } : {}),
      ...(+((draft && draft.settings) || {}).player_type === 1 ? { rookies: true } : {}), // (a rookies-only draft)
    };
  }
  return { league, fxPlayers, idMap: { toNba, names } };
}

// ----- Sleeper basketball's real weekly results -----
// Its matchups (the weekly lineups the site counts) can't give Lock-In's real scores: they show only the week's final
// lineups, and a lineup spot's game can come from a player moved out since (CLAUDE.md, Gotchas). Its standings can: each
// team's record, week by week from the league's first week ('WLLW'), and its season total so far, which the site keeps on
// the device each time it reads the league, so a finished week's real score is how much the total grew. Regular season
// only (the playoffs' aren't known to be in either).
const SLP_TOTALS_KEY = 'league-layer-slp-totals', SLP_TOTALS_KEEP = 8;
const slpPf = r => (+r.settings.fpts || 0) + (+r.settings.fpts_decimal || 0) / 100;
// { results: week -> team id -> 'W' | 'L' | 'T', totals: { n: the weeks they cover, through week n; pts: team id -> } }
function sleeperResults(rosters, first, playoff) {
  const recs = rosters.map(r => [String(r.roster_id), String((r.metadata || {}).record || '')]);
  if (!recs.length || !recs.every(([, x]) => /^[WLT]*$/.test(x))) return {};
  const reg = playoff ? playoff - first : Infinity;
  const n = Math.min(reg, ...recs.map(([, x]) => x.length));
  if (!n) return {};
  const results = {};
  for (let i = 0; i < n; i++) results[first + i] = Object.fromEntries(recs.map(([tid, x]) => [tid, x[i]]));
  // a total covers exactly the weeks every record has, all of them regular-season ones
  const len = recs[0][1].length, whole = recs.every(([, x]) => x.length === len) && len <= reg;
  return { results, ...(whole ? { totals: { n: first - 1 + len, pts: Object.fromEntries(rosters.map(r => [String(r.roster_id), slpPf(r)])) } } : {}) };
}
// Kept per league: week n -> the totals through it, the first ones seen (a later read can't move a finished week; the
// 8 leagues used most recently)
function slpTotalsSave(id, T) {
  const all = store.json(SLP_TOTALS_KEY, {}), mine = all[id] = all[id] && all[id].w ? all[id] : { w: {} };
  if (!mine.w[T.n]) mine.w[T.n] = T.pts;
  mine.at = Date.now();
  store.setJson(SLP_TOTALS_KEY, Object.fromEntries(Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, SLP_TOTALS_KEEP)));
}
// A finished week's real score for each team (team id -> points), once the totals after it and before it are known; else null
function slpWeekPts(L, n) {
  if (!L || !L.results || !L.results[n]) return null;
  const w = { ...((store.json(SLP_TOTALS_KEY, {})[L.id] || {}).w || {}) };
  if (L.totals && !w[L.totals.n]) w[L.totals.n] = L.totals.pts;
  const first = Math.min(...Object.keys(L.results).map(Number));
  const after = w[n], before = n === first ? {} : w[n - 1];
  if (!after || !before) return null;
  return Object.fromEntries(Object.keys(after).map(tid => [tid, Math.round(((after[tid] || 0) - (before[tid] || 0)) * 100) / 100]));
}
// A league whose weekly scores the site can only estimate unless Sleeper's totals say them (Sleeper basketball)
const slpEstimated = L => !!(L && L.source === 'sleeper' && L.sport === 'nba');

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
// On his team's taxi squad (a Sleeper dynasty league's; with the IR in a team's il, drawn as "Taxi")
function onTaxi(p) {
  const L = fxLeague(), raw = p && nbaById.get(p.nbaId);
  return !!(L && L.taxi && raw && raw.slp && L.taxi.includes(raw.slp));
}
