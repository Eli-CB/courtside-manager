// Courtside Manager: Loading public ESPN leagues.
// The site loads js/*.js in order (see index.html); they share one scope, like one file.
'use strict';

// ----- Public ESPN leagues, fetched in the browser -----
// ESPN's league API answers any site for public leagues (a private league needs its members' ESPN login,
// which a page on another site can't use). Each league becomes the shape fetchFantraxLeague returns, so
// every tab works the same whichever site a league is on.
// ESPN counts the season in days ("scoring periods", day 1 = opening night) and weeks, and sends no dates
// for either, so dates come from the NBA schedule in the daily data file.
const ESPN_API = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/';
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

const espnGet = (path, filter) => getJson(ESPN_API + path, 'ESPN', filter ? { headers: { 'X-Fantasy-Filter': JSON.stringify(filter) } } : undefined);
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
  const standings = j.teams.map(t => {
    const r = (t.record && t.record.overall) || {};
    return { id: String(t.id), name: espnTeamName(t), rank: t.playoffSeed || null, w: r.wins || 0, l: r.losses || 0, t: r.ties || 0, gb: +r.gamesBack || 0, pf: points ? +r.pointsFor || 0 : null };
  }).sort((a, b) => (a.rank || 99) - (b.rank || 99));

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
  };
  // ESPN marks keepers among the picks; here, like Fantrax, they're listed apart from the players drafted
  const picks = ((j.draftDetail || {}).picks || []).filter(p => p.playerId > 0);
  if (picks.length) {
    const perTeam = picks.reduce((n, p) => { n[p.teamId] = (n[p.teamId] || 0) + 1; return n; }, {});
    const keepers = {};
    for (const p of picks.filter(x => x.keeper)) { const nba = toNba[p.playerId], tid = String(p.teamId); if (nba) (keepers[tid] = keepers[tid] || []).push(nba); }
    league.draft = {
      date: (draftAt || '').slice(0, 10), type: String(ds.type || '').toLowerCase(), state: j.draftDetail.drafted ? 'completed' : '',
      perRound: Math.max(...picks.map(p => p.roundPickNumber || 0)),
      picks: picks.filter(p => !p.keeper).map(p => [p.roundId, p.overallPickNumber, String(p.teamId), toNba[p.playerId] || null, names[p.playerId] || '']),
      rounds: Math.max(...Object.values(perTeam)),
      keepers,
    };
  }
  return { league, fxPlayers, idMap: { toNba, names } };
}
