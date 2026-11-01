// League Layer: Yahoo leagues, through a Yahoo login.
// The site loads js/*.js in order (see index.html); they share one scope, like one file.
'use strict';

// ----- Yahoo leagues -----
// Yahoo's fantasy API needs each visitor's Yahoo login and doesn't take requests from other sites' pages, so
// the site's small helper server (worker/yahoo.js, a Cloudflare Worker) runs the sign-in and passes requests
// through. Each visitor's tokens stay in their own browser. A league becomes the shape fetchFantraxLeague
// returns, so every tab works the same. League IDs are Yahoo's league keys: "nba.l.12345" (this season's game)
// or "466.l.12345".
// proxy: the helper's address (empty hides Yahoo). While Yahoo is being tried out, the sign-in shows only on a
// device that opened the site with ?yahoo=1 once (or is already signed in)
const yahoo = { proxy: 'https://api.leaguelayer.com', leagues: null, beta: true };
const YAHOO_KEY = 'courtside-yahoo'; // { access, refresh, until } on this device
const YAHOO_BETA_KEY = 'courtside-yahoo-beta';
try { if (/[?&]yahoo=1/.test(location.search)) localStorage.setItem(YAHOO_BETA_KEY, '1'); } catch (e) { /* blocked */ }
const yahooTokens = () => { try { return JSON.parse(localStorage.getItem(YAHOO_KEY)); } catch (e) { return null; } };
const yahooSave = t => { try { if (t) localStorage.setItem(YAHOO_KEY, JSON.stringify(t)); else localStorage.removeItem(YAHOO_KEY); } catch (e) { /* blocked */ } };
const yahooOn = () => !!yahoo.proxy && (!yahoo.beta || yahooSignedIn() || (() => { try { return localStorage.getItem(YAHOO_BETA_KEY) === '1'; } catch (e) { return false; } })());
const yahooSignedIn = () => !!(yahooTokens() || {}).refresh;

// Back from Yahoo's sign-in: the helper puts the tokens after #yahoo= (never sent to any server); keep them and
// tidy the address. Returns 'in', an error message, or null when the address has neither.
function yahooFromAddress() {
  const h = location.hash || '';
  const m = h.match(/^#yahoo=(.+)$/), err = h.match(/^#yahoo-error=(.*)$/);
  if (!m && !err) return null;
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { location.hash = ''; }
  if (err) return decodeURIComponent(err[1]) === 'access_denied' ? 'Yahoo sign-in was cancelled.' : "Yahoo sign-in didn't go through. Try again.";
  try { yahooSave(JSON.parse(atob(decodeURIComponent(m[1])))); return 'in'; } catch (e) { return "Yahoo sign-in didn't go through. Try again."; }
}
const yahooSignIn = () => { location.href = `${yahoo.proxy}/yahoo/login?return=${encodeURIComponent(location.origin + location.pathname)}`; };
function yahooSignOut() { yahooSave(null); yahoo.leagues = null; }

// One request to Yahoo's fantasy API, through the helper. An expired access token is renewed once.
async function yahooGet(path) {
  let t = yahooTokens();
  if (!t || !t.refresh) throw new Error('yahoo sign-in');
  const renew = async () => {
    const r = await fetch(`${yahoo.proxy}/yahoo/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh: t.refresh }) });
    if (!r.ok) { yahooSave(null); throw new Error('yahoo sign-in'); }
    t = await r.json();
    yahooSave(t);
  };
  if (!t.access || Date.now() > (t.until || 0) - 60e3) await renew();
  for (let i = 0; ; i++) {
    const r = await fetch(`${yahoo.proxy}/yahoo/api/${path}`, { headers: { Authorization: `Bearer ${t.access}` } }).catch(() => null);
    if (r && r.ok) return yflat(JSON.parse(await r.text())).fantasy_content;
    if (r && r.status === 401 && !i) { await renew(); continue; }
    if (r && (r.status === 429 || r.status >= 500) && i < 2) { await pause(800 * 3 ** i); continue; }
    throw new Error(r ? `Yahoo answered ${r.status}` : "couldn't reach Yahoo");
  }
}

// Yahoo's JSON spells lists two odd ways: objects keyed "0", "1"... with a count, and arrays of one-key objects
// that together make one object. Both become what they mean; a list of objects that share their key stays a list.
function yflat(x) {
  if (Array.isArray(x)) {
    const items = x.map(yflat).filter(v => !(Array.isArray(v) && !v.length));
    if (items.length && items.every(v => v && typeof v === 'object' && !Array.isArray(v))) {
      const keys = items.flatMap(v => Object.keys(v));
      if (new Set(keys).size === keys.length) return Object.assign({}, ...items);
    }
    return items;
  }
  if (x && typeof x === 'object') {
    const keys = Object.keys(x), nums = keys.filter(k => k !== 'count');
    if ('count' in x && nums.length && nums.every(k => /^\d+$/.test(k))) return nums.sort((a, b) => a - b).map(k => yflat(x[k]));
    return Object.fromEntries(keys.map(k => [k, yflat(x[k])]));
  }
  return x;
}
const ylist = v => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);
// a list of one-key wrappers ([{ team: {...} }]) as the things themselves
const yunwrap = (v, key) => ylist(v).map(x => (x && x[key] !== undefined ? x[key] : x)).filter(Boolean);
// a part Yahoo sometimes tucks under "0" (a roster's players, a matchup's teams, a scoreboard's matchups)
const yin = (o, key) => (!o ? undefined : o[key] !== undefined ? o[key] : o['0'] && o['0'][key]);

// The visitor's Yahoo NBA leagues this season: [{ key, name, teams }]
async function yahooLeagues() {
  const c = await yahooGet('users;use_login=1/games;game_keys=nba/leagues');
  const games = yunwrap((yunwrap(c.users, 'user')[0] || {}).games, 'game');
  return games.flatMap(g => yunwrap(g.leagues, 'league')).map(l => ({ key: l.league_key, name: l.name, teams: +l.num_teams || 0, season: +l.season || null }));
}

// Yahoo's NBA team abbreviations -> NBA.com's
const YAHOO_TEAMS = { GS: 'GSW', NY: 'NYK', NO: 'NOP', SA: 'SAS', PHO: 'PHX', UTAH: 'UTA', WSH: 'WAS', BRK: 'BKN', CHO: 'CHA', NOR: 'NOP' };
// Yahoo's NBA stat ids -> our stat keys
const YAHOO_STATS = { 0: 'gp1', 2: 'min', 3: 'fga', 4: 'fgm', 5: 'fgPct', 6: 'fta', 7: 'ftm', 8: 'ftPct', 9: 'tpa', 10: 'tpm', 11: 'tpPct', 12: 'pts', 13: 'oreb',
  14: 'dreb', 15: 'reb', 16: 'ast', 17: 'stl', 18: 'blk', 19: 'to', 21: 'pf', 27: 'dd', 28: 'td' };
const YAHOO_BENCH = new Set(['BN']), YAHOO_IR = new Set(['IL', 'IL+', 'IR']);

// Points per stat, or the categories; display-only stats (FGM/A) are skipped, and anything we can't project listed
function yahooScoring(st, points) {
  const other = [];
  const stats = yunwrap(st.stat_categories && st.stat_categories.stats, 'stat').filter(s => s.enabled !== '0' && s.is_only_display_stat !== '1');
  if (points) {
    const out = {};
    for (const m of yunwrap(st.stat_modifiers && st.stat_modifiers.stats, 'stat')) {
      const key = YAHOO_STATS[m.stat_id], v = +m.value;
      if (!v) continue;
      if (key && !PCT_CATS[key]) out[key] = (out[key] || 0) + v;
      else other.push((stats.find(s => +s.stat_id === +m.stat_id) || {}).display_name || `stat ${m.stat_id}`);
    }
    return Object.keys(out).length ? { points: out, pointsOther: other } : {};
  }
  const keys = new Set();
  for (const s of stats) {
    const key = YAHOO_STATS[s.stat_id];
    if (key && (PCT_CATS[key] || STAT_LABEL[key])) keys.add(key);
    else other.push(s.display_name || s.name || `stat ${s.stat_id}`);
  }
  return keys.size ? { cats: inCatOrder(keys), catsOther: other } : {};
}

// Yahoo's player as matching needs it, from a roster or player list entry
const yahooPlayer = p => ({ key: p.player_key, name: (p.name && p.name.full) || '', team: YAHOO_TEAMS[String(p.editorial_team_abbr || '').toUpperCase()] || String(p.editorial_team_abbr || '').toUpperCase(),
  pos: POSITIONS.filter(x => yunwrap(p.eligible_positions, 'position').includes(x)), slot: (p.selected_position || {}).position || '' });

async function fetchYahooLeague(id) {
  // the league with its settings, standings and draft in one request; every team's roster in another
  const [lg, withRosters] = await Promise.all([
    yahooGet(`league/${id};out=settings,standings,draftresults`),
    yahooGet(`league/${id}/teams/roster`),
  ]);
  const L = lg.league;
  if (!L || !L.league_key) throw new Error('League not found');
  const st = L.settings || {};
  const points = /point/.test(L.scoring_type || st.scoring_type || '');
  const teamsIn = yunwrap((L.standings || {}).teams, 'team');
  const rosterTeams = yunwrap((withRosters.league || {}).teams, 'team');

  // every rostered player, matched to NBA.com's
  const info = {}, names = {}, rostered = new Set();
  for (const t of rosterTeams) for (const p of yunwrap(yin(t.roster, 'players'), 'player').map(yahooPlayer)) {
    info[p.key] = p; names[p.key] = p.name; rostered.add(p.key);
  }

  // the matchup weeks, with their dates and pairings, from each week's scoreboard (a few at a time)
  const first = +L.start_week || 1, last = +L.end_week || first;
  const weeks = Array.from({ length: last - first + 1 }, (x, i) => first + i);
  const boards = [];
  for (let i = 0; i < weeks.length; i += 4) {
    boards.push(...await Promise.all(weeks.slice(i, i + 4).map(w => yahooGet(`league/${id}/scoreboard;week=${w}`).then(c => (c.league || {}).scoreboard || null).catch(() => null))));
  }
  const periods = [], matchups = {};
  for (const sb of boards.filter(Boolean)) {
    const ms = yunwrap(yin(sb, 'matchups'), 'matchup');
    const n = +(sb.week || (ms[0] && ms[0].week));
    const m0 = ms[0] || {};
    if (!n || !m0.week_start) continue;
    periods.push({ n, start: m0.week_start, end: m0.week_end, lock: `${m0.week_start}T00:00:00`, endAt: `${m0.week_end}T23:59:00` });
    matchups[n] = ms.map(m => yunwrap(yin(m, 'teams'), 'team').map(t => t.team_key)).filter(p => p.length === 2);
  }
  periods.sort((a, b) => a.n - b.n);

  // the draft: picks of players no roster holds need their names, 25 at a time
  const picks = yunwrap(L.draft_results, 'draft_result').filter(d => d.player_key);
  const missing = [...new Set(picks.map(d => d.player_key).filter(k => !info[k]))];
  for (let i = 0; i < missing.length; i += 25) {
    const c = await yahooGet(`league/${id}/players;player_keys=${missing.slice(i, i + 25).join(',')}`).catch(() => null);
    for (const p of yunwrap(c && c.league && c.league.players, 'player').map(yahooPlayer)) { info[p.key] = p; names[p.key] = p.name; }
  }
  const toNba = matchPlayers(info, names);

  // rostered players are taken; every other NBA player is available (Yahoo's free-agent list would be many more requests)
  const fxPlayers = {};
  for (const [k, p] of Object.entries(info)) if (toNba[k] && rostered.has(k)) fxPlayers[toNba[k]] = { id: k, st: 'T', pos: p.pos };
  for (const raw of NBA.players) if (!fxPlayers[raw.id]) fxPlayers[raw.id] = { id: null, st: 'A', pos: raw.pos };

  // lineup slots, bench and IR in the shape slotsFromLeague reads
  const slots = yunwrap(st.roster_positions, 'roster_position').map(r => [r.position, +r.count || 0]).filter(([, n]) => n > 0);
  const starters = slots.filter(([p]) => !YAHOO_BENCH.has(p) && !YAHOO_IR.has(p));
  const active = sum(starters.map(([, n]) => n));
  const benchN = sum(slots.filter(([p]) => YAHOO_BENCH.has(p)).map(([, n]) => n)), irN = sum(slots.filter(([p]) => YAHOO_IR.has(p)).map(([, n]) => n));
  const rosterInfo = {
    positionConstraints: starters.reduce((o, [p, n]) => { o[p] = { maxActive: ((o[p] || {}).maxActive || 0) + n }; return o; }, {}),
    maxTotalActivePlayers: active, maxTotalReservePlayers: benchN, maxTotalPlayers: active + benchN + irN,
  };
  const status = slot => (YAHOO_BENCH.has(slot) ? 'RESERVE' : YAHOO_IR.has(slot) ? 'INJURED_RESERVE' : 'ACTIVE');
  const rosters = Object.fromEntries(rosterTeams.map(t => [t.team_key, yunwrap(yin(t.roster, 'players'), 'player').map(yahooPlayer)
    .map(p => ({ fid: p.key, nba: toNba[p.key] || null, name: p.name, slot: YAHOO_BENCH.has(p.slot) || YAHOO_IR.has(p.slot) ? '' : p.slot, st: status(p.slot) }))]));

  const teams = (teamsIn.length ? teamsIn : rosterTeams).map(t => ({ id: t.team_key, name: String(t.name || '').trim() }));
  const standings = teamsIn.map(t => {
    const s = t.team_standings || {}, o = s.outcome_totals || {};
    return { id: t.team_key, name: String(t.name || '').trim(), rank: +s.rank || null, w: +o.wins || 0, l: +o.losses || 0, t: +o.ties || 0, gb: +s.games_back || 0, pf: points ? +s.points_for || 0 : null };
  }).sort((a, b) => (a.rank || 99) - (b.rank || 99));

  const league = {
    id, source: 'yahoo', name: String(L.name || '').trim(), scoring: points ? 'POINTS' : 'H2H_MOST_CATEGORIES',
    historyId: null, year: +L.season || null,
    ...yahooScoring(st, points),
    teams, periods,
    lockDays: st.weekly_deadline && st.weekly_deadline !== 'intraday' ? 7 : 1, // NBA lineups on Yahoo are usually daily
    playoffPeriod: st.uses_playoff === '1' && st.playoff_start_week ? +st.playoff_start_week : null,
    matchups, rosterPeriod: null, rosterPeriods: [], rosters, openingRosters: null, rosterInfo,
    draft: null, draftAt: st.draft_time ? new Date(+st.draft_time * 1000).toISOString() : null,
    standings,
  };
  if (picks.length) {
    const perTeam = picks.reduce((n, d) => { n[d.team_key] = (n[d.team_key] || 0) + 1; return n; }, {});
    league.draft = {
      date: (league.draftAt || '').slice(0, 10), type: String(st.draft_type || '').toLowerCase(), state: L.draft_status === 'postdraft' ? 'completed' : '',
      perRound: teams.length, rounds: Math.max(...Object.values(perTeam)), keepers: {},
      picks: picks.map(d => [+d.round, +d.pick, d.team_key, toNba[d.player_key] || null, names[d.player_key] || '']),
    };
  }
  return { league, fxPlayers, idMap: { toNba, names } };
}
