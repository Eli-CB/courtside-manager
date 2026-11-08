// League Layer: Loading public ESPN leagues, basketball and football.
// The site loads js/*.js in order (see index.html); they share one scope, like one file.
'use strict';

// ----- Public ESPN leagues, fetched in the browser -----
// ESPN's league API answers any site for public leagues (a private league needs its members' ESPN login,
// which a page on another site can't use). Each league becomes the shape fetchFantraxLeague returns, so
// every tab works the same whichever site a league is on.
// ESPN counts the season in days ("scoring periods", day 1 = opening night) and weeks, and sends no dates
// for either, so dates come from the NBA schedule in the daily data file.
const espnApi = (game = 'fba') => `https://lm-api-reads.fantasy.espn.com/apis/v3/games/${game}/seasons/`;
const ESPN_LEAGUE_VIEWS = ['mSettings', 'mTeam', 'mRoster', 'mMatchupScore', 'mDraftDetail', 'mStatus'];
// ESPN's numbers for NBA teams -> NBA.com abbreviations
const ESPN_TEAMS = { 1: 'ATL', 2: 'BOS', 3: 'NOP', 4: 'CHI', 5: 'CLE', 6: 'DAL', 7: 'DEN', 8: 'DET', 9: 'GSW', 10: 'HOU', 11: 'IND', 12: 'LAC',
  13: 'LAL', 14: 'MIA', 15: 'MIL', 16: 'MIN', 17: 'BKN', 18: 'NYK', 19: 'ORL', 20: 'PHI', 21: 'PHX', 22: 'POR', 23: 'SAC', 24: 'SAS', 25: 'OKC',
  26: 'UTA', 27: 'WAS', 28: 'TOR', 29: 'MEM', 30: 'CHA' };
// Lineup slots -> names fxSlot understands; the bench and IR aren't lineup slots
const ESPN_SLOTS = { 0: 'PG', 1: 'SG', 2: 'SF', 3: 'PF', 4: 'C', 5: 'G', 6: 'F', 7: 'SG/SF', 8: 'G/F', 9: 'PF/C', 10: 'F/C', 11: 'Util' };
const ESPN_BENCH = 12, ESPN_IR = 13;
// Scored stats -> our stat keys (the three percentages only ever as categories)
const ESPN_STATS = { 0: 'pts', 1: 'blk', 2: 'stl', 3: 'ast', 4: 'oreb', 5: 'dreb', 6: 'reb', 9: 'pf', 11: 'to', 13: 'fgm', 14: 'fga', 15: 'ftm',
  16: 'fta', 17: 'tpm', 18: 'tpa', 19: 'fgPct', 20: 'ftPct', 21: 'tpPct', 23: 'fgmi', 24: 'ftmi', 25: 'tpmi', 37: 'dd', 38: 'td', 40: 'min', 42: 'gp1' };

const espnGet = (path, filter, game) => getJson(espnApi(game) + path, 'ESPN', filter ? { headers: { 'X-Fantasy-Filter': JSON.stringify(filter) } } : undefined);
// ESPN names a season by the year it ends: 2026-27 is 2027
const espnSeason = () => (NBA && NBA.season ? +NBA.season.slice(0, 4) + 1 : new Date().getFullYear() + (new Date().getMonth() >= 8 ? 1 : 0));

// ESPN's list of NBA players (about 250 KB) is the same for every league: fetched at most once a day and
// kept on this device, small: { ESPN id: [name, NBA team, eligible slots] }
const ESPN_SHARED_KEY = 'courtside-espn-shared-v1';
let espnShared = null;
async function espnPlayerList(season) {
  if (!espnShared) { try { espnShared = JSON.parse(localStorage.getItem(ESPN_SHARED_KEY)); } catch (e) { espnShared = null; } }
  if (espnShared && espnShared.season === season && Date.now() - espnShared.at < 864e5) return espnShared.p;
  const list = await espnGet(`${season}/players?scoringPeriodId=0&view=players_wl`, { filterActive: { value: true } });
  const p = Object.fromEntries((Array.isArray(list) ? list : []).map(x => [x.id, [x.fullName || '', ESPN_TEAMS[x.proTeamId] || '', x.eligibleSlots || []]]));
  espnShared = { at: Date.now(), season, p };
  try { localStorage.setItem(ESPN_SHARED_KEY, JSON.stringify(espnShared)); } catch (e) { /* storage full or blocked */ }
  return p;
}

// Points per stat, or the categories, from ESPN's scoring settings; stats we can't project are listed
function espnScoring(ss) {
  const other = [];
  const named = id => (ESPN_STATS[id] ? STAT_LABEL[ESPN_STATS[id]] || ESPN_STATS[id] : `stat ${id}`);
  if (/POINTS/.test(ss.scoringType || '')) {
    const points = {};
    for (const it of ss.scoringItems || []) {
      const key = ESPN_STATS[it.statId];
      if (it.pointsOverrides && Object.keys(it.pointsOverrides).length) other.push(`position-specific ${named(it.statId)}`);
      if (!+it.points) continue;
      if (key && !PCT_CATS[key]) points[key] = (points[key] || 0) + +it.points;
      else other.push(named(it.statId));
    }
    return Object.keys(points).length ? { points, pointsOther: other } : {};
  }
  const keys = new Set();
  for (const it of ss.scoringItems || []) {
    const key = ESPN_STATS[it.statId];
    if (key && (PCT_CATS[key] || STAT_LABEL[key])) keys.add(key);
    else other.push(named(it.statId));
  }
  return keys.size ? { cats: inCatOrder(keys), catsOther: other } : {};
}

// Every date with an NBA game this season, from the daily data file
const nbaGameDays = () => [...new Set([...teamDates.values()].flatMap(s => [...s]))].sort();
// The first day of the February All-Star break (the longest run of days without games that month)
function allStarBreak(days) {
  let best = null, len = 0;
  for (let i = 1; i < days.length; i++) {
    const off = addDays(days[i - 1], 1);
    const gap = Math.round((Date.parse(days[i]) - Date.parse(days[i - 1])) / 864e5) - 1;
    if (off.slice(5, 7) === '02' && gap > len) { best = off; len = gap; }
  }
  return len >= 3 ? best : null;
}
// ESPN's weeks, numbered from 1, as [first day, last day]: Monday to Sunday from opening night, except
// that the All-Star break's week runs on through the next one (Feb 15 - 28 in 2027)
function espnWeeks(dayOne, breakDay, lastDay = 200) {
  const weeks = [];
  for (let start = 1; start <= lastDay;) {
    const iso = addDays(dayOne, start - 1);
    const dow = new Date(iso + 'T12:00:00').getDay(); // 0 = Sunday
    let end = start + (dow === 0 ? 0 : 7 - dow);
    if (breakDay && iso <= breakDay && breakDay <= addDays(dayOne, end - 1)) end += 7;
    weeks.push([start, end]);
    start = end + 1;
  }
  return weeks;
}
// The league's matchups with their dates. A matchup can span several weeks (playoffs); weeks before the
// league's first day aren't the league's. ESPN's last scored day checks the All-Star rule: if the weeks
// only line up without it, they're used without it.
function espnPeriods(j, dayOne) {
  const byWeeks = (j.settings.scheduleSettings || {}).matchupPeriods || {};
  const { firstScoringPeriod: first = 1, finalScoringPeriod: last } = j.status || {};
  const days = nbaGameDays();
  const build = breakDay => {
    const weeks = espnWeeks(dayOne, breakDay);
    return Object.entries(byWeeks).map(([n, ws]) => {
      const a = weeks[Math.min(...ws) - 1], b = weeks[Math.max(...ws) - 1];
      return a && b ? { n: +n, from: Math.max(a[0], first), to: b[1] } : null;
    }).filter(p => p && p.to >= first).sort((x, y) => x.n - y.n);
  };
  const fits = ps => !last || (ps.length && ps[ps.length - 1].to === last);
  const withBreak = build(allStarBreak(days)), without = build(null);
  const ps = fits(withBreak) || !fits(without) ? withBreak : without;
  return ps.map(p => {
    const start = addDays(dayOne, p.from - 1), end = addDays(dayOne, p.to - 1);
    return { n: p.n, start, end, lock: `${start}T00:00:00`, endAt: `${end}T23:59:00` };
  });
}

// The waiver order: each team's rank (1 = first claim), with its budget left when the league bids for players
function espnWaivers(j) {
  const acq = (j.settings && j.settings.acquisitionSettings) || {};
  const ranked = j.teams.filter(t => t.waiverRank > 0);
  if (!ranked.length) return null;
  const budget = acq.isUsingAcquisitionBudget ? +acq.acquisitionBudget || 0 : null;
  return ranked.map(t => ({ id: String(t.id), rank: t.waiverRank, left: budget == null ? null : budget - (+((t.transactionCounter || {}).acquisitionBudgetSpent) || 0) }))
    .sort((a, b) => a.rank - b.rank);
}
const espnTeamName = t => String(t.name || [t.location, t.nickname].filter(Boolean).join(' ') || `Team ${t.id}`).trim();
const espnPositions = slots => POSITIONS.filter(x => slots.some(n => ESPN_SLOTS[n] === x));

async function fetchEspnLeague(id) {
  const season = espnSeason();
  let j;
  const players = espnPlayerList(season); // alongside the league; awaited once the league is in
  players.catch(() => {});
  try {
    j = await espnGet(`${season}/segments/0/leagues/${encodeURIComponent(id)}?${ESPN_LEAGUE_VIEWS.map(v => 'view=' + v).join('&')}`);
  } catch (e) {
    if (/\b40[13]\b/.test(e.message)) throw new Error('private league');
    if (/\b404\b/.test(e.message)) return fetchEspnFootball(id); // not a basketball league: its ID doesn't say which sport
    throw e;
  }
  if (!j || !j.settings || !Array.isArray(j.teams)) throw new Error('League not found');
  const list = await players;
  const s = j.settings, sched = s.scheduleSettings || {}, rs = s.rosterSettings || {};

  // every player ESPN listed or a team rosters, matched to NBA.com players
  const info = {};
  for (const [pid, [name, team, slots]] of Object.entries(list)) info[pid] = { name, team, slots };
  const rostered = new Set();
  for (const t of j.teams) {
    for (const e of (t.roster && t.roster.entries) || []) {
      const pl = (e.playerPoolEntry && e.playerPoolEntry.player) || {};
      rostered.add(String(e.playerId));
      info[e.playerId] = info[e.playerId] || { name: pl.fullName || '', team: ESPN_TEAMS[pl.proTeamId] || '', slots: pl.eligibleSlots || [] };
    }
  }
  const names = Object.fromEntries(Object.entries(info).map(([pid, v]) => [pid, v.name]));
  const toNba = matchPlayers(info, names);
  const fxPlayers = {};
  for (const [pid, v] of Object.entries(info)) {
    if (toNba[pid]) fxPlayers[toNba[pid]] = { id: pid, st: rostered.has(pid) ? 'T' : 'A', pos: espnPositions(v.slots) };
  }

  const dayOne = nbaGameDays()[0] || addDays(todayIso(), 1 - (j.scoringPeriodId || 1));
  const periods = espnPeriods(j, dayOne);
  const inLeague = new Set(periods.map(p => p.n));
  const matchups = {};
  for (const m of j.schedule || []) {
    if (!inLeague.has(m.matchupPeriodId) || !m.home || !m.away) continue; // a team without an opponent has a bye
    (matchups[m.matchupPeriodId] = matchups[m.matchupPeriodId] || []).push([String(m.away.teamId), String(m.home.teamId)]);
  }

  // lineup slots, bench and IR in the shape slotsFromLeague reads
  const counts = Object.entries(rs.lineupSlotCounts || {}).map(([k, n]) => [+k, +n]).filter(([, n]) => n > 0);
  const starters = counts.filter(([k]) => ESPN_SLOTS[k]);
  const count = slot => (counts.find(([k]) => k === slot) || [0, 0])[1];
  const active = sum(starters.map(([, n]) => n));
  const rosterInfo = {
    positionConstraints: Object.fromEntries(starters.map(([k, n]) => [ESPN_SLOTS[k], { maxActive: n }])),
    maxTotalActivePlayers: active, maxTotalReservePlayers: count(ESPN_BENCH), maxTotalPlayers: active + count(ESPN_BENCH) + count(ESPN_IR),
  };
  const statusOf = slot => (slot === ESPN_BENCH ? 'RESERVE' : slot === ESPN_IR ? 'INJURED_RESERVE' : 'ACTIVE');
  const rosters = Object.fromEntries(j.teams.map(t => [String(t.id), ((t.roster && t.roster.entries) || []).map(e => {
    const pid = String(e.playerId);
    return { fid: pid, nba: toNba[pid] || null, name: names[pid] || '', slot: ESPN_SLOTS[e.lineupSlotId] || '', st: statusOf(e.lineupSlotId) };
  })]));

  const points = /POINTS/.test((s.scoringSettings || {}).scoringType || '');
  const standings = espnStandings(j, points);

  const ds = s.draftSettings || {};
  const draftAt = ds.date ? new Date(ds.date).toISOString() : null;
  const league = {
    id, source: 'espn', name: String(s.name || '').trim(), scoring: (s.scoringSettings || {}).scoringType || '',
    historyId: null, year: j.seasonId ? j.seasonId - 1 : null,
    ...espnScoring(s.scoringSettings || {}),
    teams: j.teams.map(t => ({ id: String(t.id), name: espnTeamName(t) })),
    periods,
    lockDays: /WEEK/i.test(rs.lineupLocktimeType || '') ? 7 : 1, // lineups lock game by game: daily
    playoffPeriod: sched.playoffTeamCount ? sched.matchupPeriodCount + 1 : null,
    matchups,
    rosterPeriod: null,
    rosterPeriods: [],
    rosters,
    openingRosters: null,
    rosterInfo,
    draft: null,
    draftAt,
    standings,
    waivers: espnWaivers(j),
  };
  league.draft = espnDraft(j, toNba, names, draftAt);
  return { league, fxPlayers, idMap: { toNba, names } };
}

const espnStandings = (j, points) => j.teams.map(t => {
  const r = (t.record && t.record.overall) || {};
  return { id: String(t.id), name: espnTeamName(t), rank: t.playoffSeed || null, w: r.wins || 0, l: r.losses || 0, t: r.ties || 0, gb: +r.gamesBack || 0, pf: points ? +r.pointsFor || 0 : null };
}).sort((a, b) => (a.rank || 99) - (b.rank || 99));

// ESPN marks keepers among the picks; here, like Fantrax, they're listed apart from the players drafted (a D/ST's id is
// below 0: football's teams are players too)
function espnDraft(j, toNba, names, draftAt) {
  const ds = j.settings.draftSettings || {};
  const picks = ((j.draftDetail || {}).picks || []).filter(p => p.playerId > 0 || (p.playerId < 0 && toNba[p.playerId]));
  if (!picks.length) return null;
  const perTeam = picks.reduce((n, p) => { n[p.teamId] = (n[p.teamId] || 0) + 1; return n; }, {});
  const keepers = {};
  for (const p of picks.filter(x => x.keeper)) { const nba = toNba[p.playerId], tid = String(p.teamId); if (nba) (keepers[tid] = keepers[tid] || []).push(nba); }
  return {
    date: (draftAt || '').slice(0, 10), type: String(ds.type || '').toLowerCase(), state: j.draftDetail.drafted ? 'completed' : '',
    perRound: Math.max(...picks.map(p => p.roundPickNumber || 0)),
    picks: picks.filter(p => !p.keeper).map(p => [p.roundId, p.overallPickNumber, String(p.teamId), toNba[p.playerId] || null, names[p.playerId] || '']),
    rounds: Math.max(...Object.values(perTeam)),
    keepers,
  };
}

// ----- ESPN football -----
// A football league's ID looks like a basketball one: an ID ESPN doesn't know as basketball is asked for as football. Its
// weeks are the NFL's (the daily file's, as Sleeper's are), its players the daily file's by ESPN id (Sleeper's player list
// carries each one's), and its scoring the same stats under ESPN's numbers: checked against ESPN's own points for 1,170
// player-weeks of a real league (2026 weeks 1-8), every one exact but a sack ESPN and the NFL counted differently. The
// daily job adds what ESPN scores and Sleeper doesn't: points-allowed brackets of ESPN's, and fumble recoveries counting
// special teams' (update_nfl.py, espn_defense). Live points come from ESPN, as Sleeper's come from Sleeper.
const ESPN_NFL_TEAMS = { 1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN', 8: 'DET', 9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV',
  14: 'LAR', 15: 'MIA', 16: 'MIN', 17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI', 23: 'PIT', 24: 'LAC', 25: 'SF', 26: 'SEA', 27: 'TB',
  28: 'WAS', 29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU' };
const ESPN_NFL_TEAM_NUM = Object.fromEntries(Object.entries(ESPN_NFL_TEAMS).map(([n, t]) => [t, +n]));
// lineup slots: OP is ESPN's superflex. IDP, head coach and punter slots aren't read
const ESPN_FFL_SLOTS = { 0: 'QB', 2: 'RB', 3: 'WRRB', 4: 'WR', 5: 'WRTE', 6: 'TE', 7: 'SFLX', 16: 'DEF', 17: 'K', 23: 'Flx' };
const ESPN_FFL_BENCH = 20, ESPN_FFL_IR = 21, ESPN_DST = '16';
// ESPN's stat -> the data's (Sleeper's names). Several ESPN stats that are parts of one here (a punt or kick return TD)
// count once, at the first one's points
const ESPN_FFL_STATS = {
  0: ['pass_att'], 1: ['pass_cmp'], 2: ['pass_inc'], 3: ['pass_yd'], 4: ['pass_td'], 15: ['pass_td_40p'], 16: ['pass_td_50p'], 19: ['pass_2pt'], 20: ['pass_int'],
  22: ['pass_yd'], 23: ['rush_att'], 24: ['rush_yd'], 25: ['rush_td'], 26: ['rush_2pt'], 41: ['rec'], 42: ['rec_yd'], 43: ['rec_td'], 44: ['rec_2pt'], 45: ['rec_td_40p'],
  53: ['rec'], 58: ['rec_tgt'], 63: ['fum_rec_td'], 64: ['pass_sack'], 68: ['fum'], 72: ['fum_lost'],
  74: ['fgm_50_59', 'fgm_60p'], 76: ['fgmiss_50_59', 'fgmiss_60p'], 77: ['fgm_40_49'], 79: ['fgmiss_40_49'], 80: ['fgm_0_19', 'fgm_20_29', 'fgm_30_39'],
  82: ['fgmiss_0_19', 'fgmiss_20_29', 'fgmiss_30_39'], 83: ['fgm'], 84: ['fga'], 85: ['fgmiss'], 86: ['xpm'], 87: ['xpa'], 88: ['xpmiss'], 198: ['fgm_50_59'],
  200: ['fgmiss_50_59'], 201: ['fgm_60p'],
  89: ['pts_allow_0'], 90: ['pts_allow_1_6'], 91: ['pts_allow_7_13'], 92: ['pts_allow_14_17'], 121: ['pts_allow_18_21'], 122: ['pts_allow_22_27'],
  123: ['pts_allow_28_34'], 124: ['pts_allow_35_45'], 125: ['pts_allow_46p'], 120: ['pts_allow'], 127: ['yds_allow'],
  128: ['yds_allow_0_100'], 129: ['yds_allow_100_199'], 130: ['yds_allow_200_299'], 131: ['yds_allow_300_349'], 132: ['yds_allow_350_399'],
  133: ['yds_allow_400_449'], 134: ['yds_allow_450_499'], 135: ['yds_allow_500_549'], 136: ['yds_allow_550p'],
  93: ['def_st_td'], 101: ['def_st_td'], 102: ['def_st_td'], 94: ['def_td'], 103: ['def_td'], 104: ['def_td'],
  95: ['int'], 96: ['def_fum_rec'], 97: ['blk_kick'], 98: ['safe'], 99: ['sack'], 113: ['def_pass_def'], 206: ['def_2pt'],
};
// stats only a team defense has: scored at ESPN's points for the D/ST slot
const ESPN_DST_ONLY = new Set(['pts_allow', 'yds_allow', 'def_st_td', 'def_td', 'int', 'def_fum_rec', 'blk_kick', 'safe', 'sack', 'def_pass_def', 'def_2pt']);
const isDstStat = k => ESPN_DST_ONLY.has(k) || /^(pts|yds)_allow_/.test(k);
// a reception worth more at one position: Sleeper's bonus for it
const ESPN_REC_BONUS = { 2: 'bonus_rec_rb', 4: 'bonus_rec_wr', 6: 'bonus_rec_te' };

function espnFootballScoring(ss) {
  const points = {}, other = [];
  for (const it of ss.scoringItems || []) {
    const keys = ESPN_FFL_STATS[it.statId], over = it.pointsOverrides || {};
    if (!keys) { if (+it.points || Object.values(over).some(v => +v)) other.push(`ESPN stat ${it.statId}`); continue; }
    for (const k of keys) {
      if (k in points) continue;
      if (isDstStat(k)) { points[k] = +(over[ESPN_DST] ?? it.points) || 0; continue; }
      points[k] = +it.points || 0;
      for (const [slot, v] of Object.entries(over)) {
        if (+v === points[k]) continue;
        if (k === 'rec' && ESPN_REC_BONUS[slot]) points[ESPN_REC_BONUS[slot]] = +v - points[k];
        else other.push(`${k} at one position`);
      }
    }
  }
  for (const k of Object.keys(points)) if (!points[k]) delete points[k];
  return { points, pointsOther: [...new Set(other)] };
}

// A player's ESPN id: a D/ST's is its team's number below -16000
const espnFootballId = raw => (raw.pos[0] === 'DEF' ? (ESPN_NFL_TEAM_NUM[raw.team] ? -16000 - ESPN_NFL_TEAM_NUM[raw.team] : null) : raw.espn || null);

// Each player's points this week, as ESPN has them: a game in progress counts so far, as on ESPN
function espnWeekPoints(j, n) {
  const pts = {};
  for (const t of j.teams || []) {
    for (const e of (t.roster && t.roster.entries) || []) {
      const s = (((e.playerPoolEntry || {}).player || {}).stats || []).find(x => x.scoringPeriodId === n && x.statSourceId === 0 && x.statSplitTypeId === 1);
      if (s && s.appliedTotal != null) pts[e.playerId] = +s.appliedTotal;
    }
  }
  return pts;
}

async function fetchEspnFootball(id) {
  const D = SPORT.key === 'nfl' && NBA ? NBA : await fetchSport('nfl');
  const season = +D.season;
  let j;
  try {
    j = await espnGet(`${season}/segments/0/leagues/${encodeURIComponent(id)}?${ESPN_LEAGUE_VIEWS.map(v => 'view=' + v).join('&')}`, null, 'ffl');
  } catch (e) {
    if (/\b40[13]\b/.test(e.message)) throw new Error('private league');
    if (/\b404\b/.test(e.message)) throw new Error('League not found');
    throw e;
  }
  if (!j || !j.settings || !Array.isArray(j.teams)) throw new Error('League not found');
  const s = j.settings, sched = s.scheduleSettings || {}, rs = s.rosterSettings || {}, ss = s.scoringSettings || {};
  if (!/POINTS/.test(ss.scoringType || '')) throw new Error("ESPN football leagues scored by categories aren't supported yet: points leagues are");

  // the data's players by ESPN id; anyone rostered who isn't there keeps ESPN's name
  const toNba = {}, names = {};
  for (const raw of D.players) { const fid = espnFootballId(raw); if (fid != null) { toNba[fid] = raw.id; names[fid] = raw.name; } }
  const rostered = new Set();
  for (const t of j.teams) {
    for (const e of (t.roster && t.roster.entries) || []) {
      rostered.add(String(e.playerId));
      if (!names[e.playerId]) names[e.playerId] = (((e.playerPoolEntry || {}).player || {}).fullName) || `Player ${e.playerId}`;
    }
  }
  const fxPlayers = {};
  for (const raw of D.players) {
    const fid = espnFootballId(raw);
    if (fid != null) fxPlayers[raw.id] = { id: String(fid), st: rostered.has(String(fid)) ? 'T' : 'A', pos: raw.pos };
  }

  // matchups are NFL weeks (ESPN's scoring periods); weeks before the league began aren't its
  const first = (j.status || {}).firstScoringPeriod || 1;
  const periods = Object.entries(sched.matchupPeriods || {}).map(([n, ws]) => {
    const a = (D.weeks || {})[Math.min(...ws)], b = (D.weeks || {})[Math.max(...ws)];
    return a && b && Math.max(...ws) >= first ? { n: +n, start: a[0], end: b[1], lock: `${a[0]}T00:00:00`, endAt: `${b[1]}T23:59:00` } : null;
  }).filter(Boolean).sort((x, y) => x.n - y.n);
  const inLeague = new Set(periods.map(p => p.n));
  const matchups = {};
  for (const m of j.schedule || []) {
    if (!inLeague.has(m.matchupPeriodId) || !m.home || !m.away) continue;
    (matchups[m.matchupPeriodId] = matchups[m.matchupPeriodId] || []).push([String(m.away.teamId), String(m.home.teamId)]);
  }

  // lineup slots, bench and IR in the shape slotsFromLeague reads
  const counts = Object.entries(rs.lineupSlotCounts || {}).map(([k, n]) => [+k, +n]).filter(([, n]) => n > 0);
  const starters = counts.filter(([k]) => ESPN_FFL_SLOTS[k]);
  const count = slot => (counts.find(([k]) => k === slot) || [0, 0])[1];
  const active = sum(starters.map(([, n]) => n));
  const constraints = {};
  for (const [k, n] of starters) constraints[ESPN_FFL_SLOTS[k]] = { maxActive: ((constraints[ESPN_FFL_SLOTS[k]] || {}).maxActive || 0) + n };
  const rosterInfo = {
    positionConstraints: constraints, maxTotalActivePlayers: active,
    maxTotalReservePlayers: count(ESPN_FFL_BENCH), maxTotalPlayers: active + count(ESPN_FFL_BENCH) + count(ESPN_FFL_IR),
  };
  const statusOf = slot => (slot === ESPN_FFL_IR ? 'INJURED_RESERVE' : ESPN_FFL_SLOTS[slot] ? 'ACTIVE' : 'RESERVE');
  const rosters = Object.fromEntries(j.teams.map(t => [String(t.id), ((t.roster && t.roster.entries) || []).map(e => {
    const pid = String(e.playerId);
    return { fid: pid, nba: toNba[pid] || null, name: names[pid] || '', slot: ESPN_FFL_SLOTS[e.lineupSlotId] || '', st: statusOf(e.lineupSlotId) };
  })]));

  const cur = sleeperWeekNow(periods);
  const ds = s.draftSettings || {};
  const draftAt = ds.date ? new Date(ds.date).toISOString() : null;
  const league = {
    id, source: 'espn', sport: 'nfl', name: String(s.name || '').trim(), scoring: ss.scoringType || '',
    historyId: null, year: j.seasonId || season, espnSeason: season,
    ...espnFootballScoring(ss),
    oneGame: true,
    teams: j.teams.map(t => ({ id: String(t.id), name: espnTeamName(t) })),
    periods,
    lockDays: 1, // each player locks as his game starts
    playoffPeriod: sched.playoffTeamCount ? sched.matchupPeriodCount + 1 : null,
    matchups,
    rosterPeriod: null, rosterPeriods: [],
    rosters, openingRosters: null, rosterInfo,
    draft: null, draftAt,
    standings: espnStandings(j, true),
    waivers: espnWaivers(j),
    slpWeek: { n: cur, pts: espnWeekPoints(j, cur), at: Date.now() }, // this week's points, ESPN's (named for Sleeper's, which came first)
  };
  league.draft = espnDraft(j, toNba, names, draftAt);
  return { league, fxPlayers, idMap: { toNba, names } };
}

// This week's points again, at most every 30 s while football's Dashboard or Matchups is open (as Sleeper's are)
let espnWeekLoad = null;
function espnWeekFresh(L) {
  if (!L || L.source !== 'espn' || !isFootball() || espnWeekLoad || (L.slpWeek && Date.now() - L.slpWeek.at < 30000)) return;
  const n = sleeperWeekNow(L.periods);
  espnWeekLoad = espnGet(`${L.espnSeason}/segments/0/leagues/${encodeURIComponent(L.id)}?view=mRoster&scoringPeriodId=${n}`, null, 'ffl').then(j => {
    L.slpWeek = { n, pts: espnWeekPoints(j, n), at: Date.now() };
    noteLiveOk('ESPN live points');
    if (ui.tab === 'dashboard' || ui.tab === 'week') { live.hold = true; try { render(); } finally { live.hold = false; } }
  }).catch(e => {
    L.slpWeek = { ...(L.slpWeek || { n, pts: {} }), at: Date.now() };
    noteLiveFailure(e.message || "couldn't reach ESPN", 'ESPN live points');
  }).finally(() => { espnWeekLoad = null; });
}
