// Courtside Manager: Loading leagues from Fantrax.
// The site loads js/*.js in order (see index.html); they share one scope, like one file.
'use strict';

// ----- Any visitor's Fantrax league, fetched in the browser -----
// The daily data file carries NBA stats for everyone plus the site's default league. Fantrax's
// public league API allows requests from any site, so a visitor's own league can be loaded here.
// Public ESPN leagues load the same way (js/espn.js) into the same league shape, so the rest of the
// site doesn't care where a league came from; "fx" names (fxLeague, raw.fx, fxTeamSide) cover both.
const FX_API = 'https://www.fantrax.com/fxea/general/';
const NBA_POS_MAP = { G: ['PG', 'SG'], F: ['SF', 'PF'], C: ['C'], 'G-F': ['SG', 'SF'], 'F-G': ['SG', 'SF'], 'F-C': ['PF', 'C'], 'C-F': ['PF', 'C'] };
const FX_SLOT_MAP = { PG: 'PG', SG: 'SG', G: 'G', SF: 'SF', PF: 'PF', F: 'F', C: 'C', Flx: 'FLX', Util: 'FLX', UT: 'FLX' };

// Which site a league is on. ESPN league IDs are all digits; Fantrax's mix letters and digits.
const SOURCE_NAME = { fantrax: 'Fantrax', espn: 'ESPN' };
const leagueSourceOf = id => (/^\d+$/.test(String(id || '')) ? 'espn' : 'fantrax');
const sourceName = (L = fxLeague()) => SOURCE_NAME[(L && L.source) || 'fantrax'];
// A league ID from what someone typed or pasted: the ID itself, or the league's address on either site
function parseLeagueId(text) {
  const s = String(text || '').trim();
  const m = s.match(/[?&]leagueId=(\d+)/i) || s.match(/fantrax\.com\/fantasy\/league\/([A-Za-z0-9]+)/i);
  const id = m ? m[1] : s;
  return /^\d{3,12}$/.test(id) || /^[A-Za-z0-9]{6,32}$/.test(id) ? id : null;
}
const BAD_LEAGUE_ID = "That doesn't look like a league ID. Paste your league's address from Fantrax or ESPN, or just its ID.";
// Weekly lineup history (Season totals, Awards, past seasons) is read from Fantrax only, so far
const hasLineupHistory = L => !!L && (L.source || 'fantrax') === 'fantrax';

// One request to a league site. "Too many requests", server errors and dropped connections are retried
// after a growing wait (the site's Retry-After when it sends one); anything else fails straight away.
const pause = ms => new Promise(res => setTimeout(res, ms));
async function getJson(url, site, init, tries = 3) {
  for (let i = 0; ; i++) {
    let r = null;
    try { r = await fetch(url, init); } catch (e) { if (i >= tries - 1) throw new Error(`couldn't reach ${site}`); }
    if (r && r.ok) return JSON.parse(await r.text()); // Fantrax serves JSON as text/plain
    if (r && r.status !== 429 && r.status < 500) throw new Error(`${site} answered ${r.status}`);
    if (i >= tries - 1) throw new Error(`${site} answered ${r ? r.status : 'nothing'}`);
    const after = r && r.headers && +r.headers.get('Retry-After');
    await pause(Math.min(after ? after * 1000 : 600 * 3 ** i, 10000));
  }
}
const fxGet = (path, tries) => getJson(FX_API + path, 'Fantrax', undefined, tries);
// Many requests at once (weekly rosters): a few at a time, and stop as soon as one fails for good
async function fxGetAll(paths, each, width = 4) {
  let next = 0, failed = null;
  const worker = async () => {
    while (next < paths.length && !failed) {
      const path = paths[next++];
      try { each(path, await fxGet(path)); } catch (e) { failed = failed || e; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, paths.length) }, worker));
  if (failed) throw failed;
}

// Keepers: only in leagues whose draft gives each team fewer picks than it has roster spots (starters
// plus bench; IR isn't filled at the draft). Then they're the players on a team's opening-week roster it
// didn't draft (before week 1 is over, its current roster). Team id -> [NBA ids]
function keepersOf(league) {
  const cfg = slotsFromLeague(league) || {};
  const ri = league.rosterInfo || {};
  const spots = ri.maxTotalActivePlayers != null && ri.maxTotalReservePlayers != null
    ? ri.maxTotalActivePlayers + ri.maxTotalReservePlayers : (cfg.slots || []).length + (cfg.bench || 0);
  if (!spots || !league.draft.rounds || league.draft.rounds >= spots) return {};
  const start = league.openingRosters || league.rosters;
  const out = {};
  for (const [tid, items] of Object.entries(start)) {
    const drafted = new Set(league.draft.picks.filter(p => p[2] === tid).map(p => p[3]));
    const kept = items.map(x => x.nba).filter(n => n && !drafted.has(n));
    if (kept.length) out[tid] = kept;
  }
  return out;
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

// A league site's players matched to NBA.com players by name (team breaks ties), then by nickname.
// ids: { site id: { team } }, names: { site id: "First Last" } -> { site id: NBA id }
function matchPlayers(ids, names) {
  const byName = new Map();
  for (const raw of NBA.players) {
    const n = normName(raw.name);
    if (!byName.has(n)) byName.set(n, []);
    byName.get(n).push(raw);
  }
  const toNba = {};
  for (const [fid, v] of Object.entries(ids)) {
    const hits = byName.get(normName(names[fid])) || [];
    const hit = hits.length > 1 ? (hits.find(h => h.team === v.team) || hits[0]) : hits[0];
    if (hit) toNba[fid] = hit.id;
  }
  matchNicknames(ids, names, toNba);
  return toNba;
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
  return keys.size ? { cats: inCatOrder(keys), catsOther: other } : {};
}
// Categories in the usual display order (FG%, FT%, 3PM, PTS...), any others after
const inCatOrder = keys => [...keys].sort((a, b) => (CAT_ORDER.indexOf(a) + 1 || 99) - (CAT_ORDER.indexOf(b) + 1 || 99));
const fxScoring = ss => ({ ...fxPointsScoring(ss), ...fxCategories(ss) });

// Typical length in days of a league's lineup lock periods: about 1 for daily lineups, 7 for weekly
function rosterPeriodDays(periods) {
  const lens = periods.slice(0, 6).map(p => (fxTime(p.endDate) - fxTime(p.startDate)) / 864e5).filter(Number.isFinite).sort((a, b) => a - b);
  return lens.length ? Math.round(lens[Math.floor(lens.length / 2)] * 100) / 100 : null;
}

// Fantrax's player list (about 200 KB) and ADP are the same for every league and barely change:
// fetched at most once a day and kept on this device
const FX_SHARED_KEY = 'courtside-fantrax-shared-v1';
let fxShared = null;
async function fxPlayerLists() {
  if (!fxShared) { try { fxShared = JSON.parse(localStorage.getItem(FX_SHARED_KEY)); } catch (e) { fxShared = null; } }
  if (fxShared && Date.now() - fxShared.at < 864e5 && fxShared.ids) return fxShared;
  const [ids, adp] = await Promise.all([fxGet('getPlayerIds?sport=NBA'), fxGet('getAdp?sport=NBA').catch(() => [])]);
  fxShared = { at: Date.now(), ids, adp };
  try { localStorage.setItem(FX_SHARED_KEY, JSON.stringify(fxShared)); } catch (e) { /* storage full or blocked */ }
  return fxShared;
}

async function fetchFantraxLeague(id, opts = {}) {
  const q = encodeURIComponent(id);
  const [{ ids, adp: adpList }, info, rosters, draft, standings] = await Promise.all([
    fxPlayerLists(), fxGet(`getLeagueInfo?leagueId=${q}`), fxGet(`getTeamRosters?leagueId=${q}`),
    fxGet(`getDraftResults?leagueId=${q}`).catch(() => ({})), fxGet(`getStandings?leagueId=${q}`).catch(() => []),
  ]);
  if (info.error || !info.teamInfo) throw new Error((info.error && info.error.message) || 'League not found');
  // the opening week's rosters: past seasons use them for keepers and pickups, and so does this season once week 1 is over
  const opening = opts.opening || (rosters.period || 1) > 1 ? await fxGet(`getTeamRosters?leagueId=${q}&period=1`).catch(() => null) : null;

  const names = Object.fromEntries(Object.entries(ids).map(([fid, v]) => [fid, fxName(v.name || '')]));
  const toNba = matchPlayers(ids, names);
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
    id, source: 'fantrax', name: info.leagueName || '', scoring: (info.scoringSystem || {}).type || '',
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
      (r.rosterItems || []).map(it => ({ fid: it.id, nba: toNba[it.id] || null, name: names[it.id] || '', st: it.status || '' }))])) : null,
    rosterInfo: info.rosterInfo || null,
    draft: null,
    draftAt: draft.draftDate || null,
    standings: parseStandings(standings),
  };
  const picks = (draft.draftPicks || []).filter(d => d.playerId);
  if (picks.length) {
    league.draft = {
      date: String(draft.draftDate || '').slice(0, 10), type: draft.draftType || '', state: draft.draftState || '',
      perRound: Math.max(...draft.draftPicks.map(d => d.pickInRound || 0)),
      picks: picks.map(d => [d.round, d.pick, d.teamId, toNba[d.playerId] || null, names[d.playerId] || '']),
      // pick slots per team, unused ones included
      rounds: Math.max(0, ...Object.values((draft.draftPicks || []).reduce((n, d) => { n[d.teamId] = (n[d.teamId] || 0) + 1; return n; }, {}))),
    };
    league.draft.keepers = keepersOf(league);
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
// The league on screen: a past season (or this season's awards) can be viewed without touching the
// loaded league or your saved team, which stay as they are underneath.
let viewLeague = null, viewTeam = null;
const fxLeague = () => viewLeague || (NBA && NBA.league) || null;
const myTeamId = () => (viewLeague ? viewTeam : state.fxTeam);
function viewingLeague(L, me, fn) {
  const was = [viewLeague, viewTeam];
  viewLeague = L; viewTeam = me;
  try { return fn(); } finally { [viewLeague, viewTeam] = was; }
}
// A = not on any roster (ESPN: free agent or on waivers; the league data doesn't say which)
const FX_STATUS = { T: 'Taken', W: 'Waivers', WW: 'Waivers', FA: 'Free agent', A: 'Available' };
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

// Every league loaded from Fantrax or ESPN is kept on this device (the five most recent). The site's own
// league uses it until the daily data file is newer; any other league for 6 hours, or until ↻ Reload.
const FX_CACHE_KEY = 'courtside-fantrax-v2';
const LEAGUE_FRESH_MS = 6 * 36e5;
try { localStorage.removeItem('courtside-fantrax-v1'); } catch (e) { /* the old one-league copy */ }
const readLeagueCache = () => { try { return JSON.parse(localStorage.getItem(FX_CACHE_KEY)) || {}; } catch (e) { return {}; } };
function cachedLeague(id) {
  const c = readLeagueCache()[id];
  if (!c) return null;
  const site = NBA && NBA.siteLeague && NBA.siteLeague.id === id;
  return (site ? c.at > Date.parse(NBA.updated || 0) : Date.now() - c.at < LEAGUE_FRESH_MS) ? c.res : null;
}
function saveLeague(id, res) {
  const all = readLeagueCache();
  all[id] = { at: Date.now(), res: { league: res.league, fxPlayers: res.fxPlayers } };
  const keep = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, 5);
  try { localStorage.setItem(FX_CACHE_KEY, JSON.stringify(Object.fromEntries(keep))); } catch (e) { /* storage full or blocked */ }
}
// A league from this device if it's fresh enough, else from its site (force: always from its site)
async function getLeague(id, force) {
  const kept = force ? null : cachedLeague(id);
  if (kept) return kept;
  const res = await (leagueSourceOf(id) === 'espn' ? fetchEspnLeague(id) : fetchFantraxLeague(id));
  saveLeague(id, res);
  delete rosterWeeksLoad[id]; // the current period's lineups may have changed
  return res;
}

// Pull the league fresh from its site: matchups, rosters and lineups change during the week
async function refreshLeague(force = true) {
  const id = state.fxLeagueId || (NBA.siteLeague && NBA.siteLeague.id);
  if (!id) return false;
  const same = NBA.league && NBA.league.id === id;
  const before = same && state.fxTeam ? fxOpponentFor(weekStart()) : null;
  const res = await getLeague(id, force);
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

function loadFxTeam(teamId, week = weekStart()) {
  const side = fxTeamSide(teamId);
  const name = side.name;
  state.opp = { name, week, fxId: teamId, players: side.players, starters: side.starters };
  const opp = fxOpponentFor(week);
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
      ${stepper('fx-cycle', 'team', `<select class="ctx-team" data-change="fx-opp" aria-label="Compare against">${cur ? '' : '<option value="">Pick a team</option>'}${teams.filter(t => t.id !== leftId).map(t => `<option value="${esc(t.id)}" ${t.id === cur ? 'selected' : ''}>${esc(t.name)}${opp && t.id === opp.id ? ' (this week)' : ''}</option>`).join('')}</select>`)}
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
