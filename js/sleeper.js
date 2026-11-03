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

function sleeperScoring(ss) {
  const points = {}, other = [];
  for (const [k, v] of Object.entries(ss || {})) {
    if (!+v) continue;
    if (SLEEPER_STATS[k]) points[SLEEPER_STATS[k]] = (points[SLEEPER_STATS[k]] || 0) + +v;
    else other.push(SLEEPER_OTHER[k] || k);
  }
  return Object.keys(points).length ? { points, pointsOther: other } : {};
}

// The league's weeks with their dates: Sleeper's week n is the n-th Monday-to-Sunday week from opening night. A league
// plays from its start week through the playoffs, a week a round.
function sleeperPeriods(s, dayOne) {
  const first = Math.max(1, +s.start_week || 1);
  const rounds = +s.playoff_teams > 1 ? Math.ceil(Math.log2(+s.playoff_teams)) : 0;
  const last = (+s.playoff_week_start || 22) - 1 + rounds;
  const out = [];
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
const sleeperSlot = x => (x === 'UTIL' ? 'Util' : String(x).replace(/_/g, '/'));

async function fetchSleeperLeague(id) {
  let lg;
  try { lg = await slpGet(`league/${encodeURIComponent(id)}`); } catch (e) { throw e; }
  if (!lg || !lg.league_id) throw new Error('League not found');
  if (lg.sport && lg.sport !== 'nba') throw new Error(`that's a Sleeper ${String(lg.sport).toUpperCase()} league, not basketball`);
  const s = lg.settings || {};
  const dayOne = nbaGameDays()[0] || todayIso();
  const periods = sleeperPeriods(s, dayOne);
  const cur = sleeperWeekNow(periods);
  const weeksWanted = [cur - 1, cur, cur + 1].filter(n => periods.some(p => p.n === n));
  const [rostersRaw, users, draftPicks, draft, ...weeks] = await Promise.all([
    slpGet(`league/${id}/rosters`), slpGet(`league/${id}/users`),
    lg.draft_id ? slpGet(`draft/${lg.draft_id}/picks`).catch(() => []) : [],
    lg.draft_id ? slpGet(`draft/${lg.draft_id}`).catch(() => null) : null,
    ...weeksWanted.map(n => slpGet(`league/${id}/matchups/${n}`).catch(() => [])),
  ]);
  const rosters = Array.isArray(rostersRaw) ? rostersRaw : [];

  // Sleeper ids -> NBA.com players (the daily data file carries each player's), names for anyone not matched
  const toNba = {}, names = {};
  for (const raw of NBA.players) if (raw.slp) { toNba[raw.slp] = raw.id; names[raw.slp] = raw.name; }
  for (const p of draftPicks || []) {
    const m = p.metadata || {};
    if (p.player_id && !names[p.player_id]) names[p.player_id] = `${m.first_name || ''} ${m.last_name || ''}`.trim();
  }
  const rostered = new Set(rosters.flatMap(r => r.players || []));
  const fxPlayers = {};
  // Sleeper's own positions (its lineups follow them), else NBA.com's
  for (const [sid, nba] of Object.entries(toNba)) fxPlayers[nba] = { id: sid, st: rostered.has(sid) ? 'T' : 'A', pos: (nbaById.get(nba) || {}).slpPos || [] };

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
  for (const x of startSlots) { const k = sleeperSlot(x); constraints[k] = { maxActive: ((constraints[k] || {}).maxActive || 0) + 1 }; }
  const rosterInfo = {
    positionConstraints: constraints, maxTotalActivePlayers: startSlots.length, maxTotalReservePlayers: nBench,
    maxTotalPlayers: startSlots.length + nBench + (+s.reserve_slots || 0),
  };
  const item = (sid, slot, st) => ({ fid: sid, nba: toNba[sid] || null, name: names[sid] || `Player ${sid}`, slot, st });
  const leagueRosters = Object.fromEntries(rosters.map(r => {
    const starters = r.starters || [], ir = new Set(r.reserve || []);
    const out = starters.map((sid, i) => (sid && sid !== '0' ? item(sid, sleeperSlot(startSlots[i] || 'UTIL'), 'ACTIVE') : null)).filter(Boolean);
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
    id, source: 'sleeper', name: String(lg.name || '').trim(), scoring: 'POINTS',
    historyId: null, year: +lg.season || null,
    ...sleeperScoring(lg.scoring_settings),
    oneGame: true, gameMode: +s.game_mode === 0 ? 'pick' : 'lockin',
    teams, periods,
    lockDays: 1, // lineups change day by day until a game is locked in
    playoffPeriod: +s.playoff_teams > 1 ? +s.playoff_week_start || null : null,
    matchups,
    rosterPeriod: null, rosterPeriods: [],
    rosters: leagueRosters, openingRosters: null, rosterInfo,
    draft: null, draftAt, standings,
    slpWeek: { n: cur, pts: weekPts, at: Date.now() },
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

// ----- This week's counted games, kept current while the Dashboard is open -----
// Sleeper's points for each player this week are the game that counts for him so far; asked for again at most every
// 2 minutes (it's one small request), so a game locked in shows up without a full reload.
let slpWeekLoad = null;
function sleeperWeekFresh(L) {
  if (!L || L.source !== 'sleeper' || slpWeekLoad || (L.slpWeek && Date.now() - L.slpWeek.at < 120000)) return;
  const n = sleeperWeekNow(L.periods);
  slpWeekLoad = slpGet(`league/${L.id}/matchups/${n}`).then(ms => {
    const pts = {};
    for (const m of ms || []) Object.assign(pts, m.players_points || {});
    L.slpWeek = { n, pts, at: Date.now() };
    if (ui.tab === 'dashboard') render();
  }).catch(() => { L.slpWeek = { ...(L.slpWeek || { n, pts: {} }), at: Date.now() }; }).finally(() => { slpWeekLoad = null; });
}

// One-game leagues: the one game of a player's that counts among his lines this period (oldest first). Sleeper's
// points for him this week say which: the game nearest them (bonuses and technicals aren't in our fantasy points).
// Without them, his latest game, as Sleeper counts an unlocked one.
function oneGameLine(p, lines) {
  if (!lines.length) return null;
  const L = fxLeague(), raw = nbaById.get(p.nbaId);
  const pts = L && L.slpWeek && raw && raw.slp ? L.slpWeek.pts[raw.slp] : null;
  if (!pts) return lines[lines.length - 1];
  return lines.reduce((best, l) => (Math.abs(lineFp(l) - pts) < Math.abs(lineFp(best) - pts) ? l : best));
}
const isOneGame = () => !!(fxLeague() && fxLeague().oneGame);
