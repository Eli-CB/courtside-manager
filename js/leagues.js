// League Layer: Leagues: saved leagues and their seasons, connecting and switching leagues, picking your team, the demo and the landing page.
// The site loads js/*.js in order (see index.html); they share one scope, like one file.
'use strict';

// ----- Saved leagues -----
// Each league you add keeps its own team, roster, opponent, lineup settings, matchup log and
// lineup; switching stashes the current league's and restores the other's.
const LEAGUE_FIELDS = ['fxTeam', 'players', 'il', 'lineup', 'opp', 'teamName', 'slots', 'benchSize', 'ilSize',
  'slotsSet', 'lineupMode', 'matchDays'];
const emptyOpp = () => ({ name: '', week: null, players: [], starters: null, fxId: null });
const currentLeagueId = () => state.fxLeagueId || (NBA && NBA.siteLeague && NBA.siteLeague.id) || null;

function rememberLeague(id, lg) {
  const list = (state.savedLeagues || []).filter(l => l.id !== id);
  const at = (state.savedLeagues || []).findIndex(l => l.id === id);
  list.splice(at === -1 ? list.length : at, 0, { id, name: lg.name, hid: lg.historyId || null, year: lg.year || null });
  state.savedLeagues = list;
}

// ----- Seasons -----
// Each Fantrax season is its own league with its own ID; Fantrax's league history id ties a league's seasons together.
// A season before the NBA season on now (or before a later season of the same league) is a past season: it goes
// under its league in the league menu, never in the league list.
const nowYear = () => (NBA && NBA.season ? +String(NBA.season).slice(0, 4) : null);
// What's known of a league without asking its site: { hid, year }
function leagueFacts(id) {
  if (NBA && NBA.league && NBA.league.id === id) return { hid: NBA.league.historyId || null, year: NBA.league.year || null };
  const s = (state.savedLeagues || []).find(l => l.id === id);
  if (s && s.year) return { hid: s.hid || null, year: s.year };
  const c = readLeagueCache()[id];
  return c ? { hid: c.res.league.historyId || null, year: c.res.league.year || null } : { hid: null, year: null };
}
function isPastSeason(f, others = (state.savedLeagues || []).map(l => leagueFacts(l.id))) {
  if (!f.year) return false;
  return !!(nowYear() && f.year < nowYear()) || (!!f.hid && others.some(o => o.hid === f.hid && o.year > f.year));
}
// The league a past season goes under: the latest season of its league that's here
function homeLeague(hid) {
  if (!hid) return null;
  const ids = [...new Set([currentLeagueId(), ...(state.savedLeagues || []).map(l => l.id)])].filter(Boolean);
  const all = ids.map(id => ({ id, ...leagueFacts(id) }));
  const home = all.filter(f => f.hid === hid && !isPastSeason(f, all)).sort((a, b) => (b.year || 0) - (a.year || 0))[0];
  return home ? home.id : null;
}
// Keep a past season with its league's other seasons, and out of the league list
function fileSeason(id, lg) {
  const key = lg.historyId || id;
  state.pastSeasons = state.pastSeasons || {};
  const list = state.pastSeasons[key] = state.pastSeasons[key] || [];
  if (!list.some(x => x.id === id)) list.push({ id, year: lg.year || null });
  state.savedLeagues = (state.savedLeagues || []).filter(l => l.id !== id);
  if (state.leagueStates) delete state.leagueStates[id];
}
// Past seasons added as leagues (before seasons had their own place) move under their league once it's here
function foldPastSeasons() {
  const all = (state.savedLeagues || []).map(l => ({ id: l.id, ...leagueFacts(l.id) }));
  let moved = false;
  for (const f of all) {
    if (f.id === currentLeagueId() || !isPastSeason(f, all) || !homeLeague(f.hid)) continue;
    fileSeason(f.id, { historyId: f.hid, year: f.year });
    moved = true;
  }
  return moved;
}

// What the league form connects: a league, or an earlier season of one, opened under its league. A past season
// whose league isn't here yet is kept for when it is, and returned as { label, name } so the form can ask for it.
async function connectLeague(input) {
  // (only Fantrax has hockey here; an ESPN hockey league's ID would be read as a basketball one)
  if (/espn\.com\/hockey/i.test(String(input))) throw new Error("ESPN hockey leagues aren't supported yet. Hockey works with Fantrax leagues.");
  const id = parseLeagueId(input);
  if (!id) throw new Error(BAD_LEAGUE_ID);
  if (leagueSourceOf(id) === 'fantrax') {
    await needNba();
    let f = pastCache[id] ? { hid: pastCache[id].league.historyId, year: pastCache[id].league.year } : leagueFacts(id), fetched = null;
    if (!f.year) {
      // one fetch serves either way: as the league, or as the season
      fetched = await fetchFantraxLeague(id, { opening: true }).catch(e => { throw leagueError(id, e); });
      f = { hid: fetched.league.historyId || null, year: fetched.league.year || null };
      // a past season opens under its league, on that sport's data
      if ((fetched.league.sport || 'nba') !== SPORT.key && isPastSeason(f)) throw new Error(`That's a past season of a ${SPORTS[fetched.league.sport || 'nba'].name} league. Connect this season's league first, then add it from the league menu.`);
    }
    if (isPastSeason(f)) {
      const P = await loadSeason(id, fetched).catch(e => { throw leagueError(id, e); });
      fileSeason(id, P.league);
      const home = homeLeague(P.league.historyId);
      if (!home) { commit(); return { label: P.label, name: P.league.name }; }
      if (home !== currentLeagueId() || !state.leagueChosen) await switchLeague(home);
      ui.addingLeague = false;
      if (!state.fxTeam) { ui.afterPick = seasonHash('standings', id); commit(); return null; } // your team first, then the season
      commit(`Added the ${P.label} season`);
      await switchSeason(id);
      return null;
    }
    if (fetched) saveLeague(id, fetched);
  }
  await switchLeague(id);
  ui.addingLeague = false;
  commit();
  return null;
}

function stashLeague(id = currentLeagueId()) {
  if (!id || !state.fxTeam) return;
  state.leagueStates = state.leagueStates || {};
  state.leagueStates[id] = JSON.parse(JSON.stringify(Object.fromEntries(LEAGUE_FIELDS.map(k => [k, state[k]]))));
}

// Lineup rules read from the league: slots, bench and IR sizes, weekly or daily lineups
function applyLeagueRules(league) {
  const cfg = slotsFromLeague(league);
  if (cfg) {
    state.slots = cfg.slots;
    if (cfg.bench != null) state.benchSize = cfg.bench;
    if (cfg.ir != null) state.ilSize = cfg.ir;
    state.slotsSet = true;
  }
  state.lineupMode = leagueLineupMode(league);
  state.matchDays = [0, 1, 2, 3, 4, 5, 6];
}

// Daily or weekly lineups: from the league's lineup lock periods, else from its matchup length
function leagueLineupMode(league) {
  if (league.lockDays != null) return league.lockDays < 2 ? 'daily' : 'weekly';
  const p = (league.periods || [])[0];
  const days = p ? (new Date(p.end) - new Date(p.start)) / 86400000 : 7;
  return days >= 5 ? 'weekly' : 'daily';
}

// Yahoo leagues come through a Yahoo login (js/yahoo.js): a sign-in button, then the visitor's leagues to pick from
function yahooLanding() {
  if (!yahooOn()) return '';
  if (!yahooSignedIn()) return `<div class="land-yahoo"><button type="button" class="btn yahoo-btn" data-action="yahoo-signin">Sign in with Yahoo</button><span class="small muted">for a Yahoo league</span></div>`;
  if (yahoo.leagues == null) {
    yahoo.leagues = 'loading';
    yahooLeagues().then(l => { yahoo.leagues = l; }).catch(e => { yahoo.leagues = { error: e.message }; }).finally(() => { if (needsLanding()) render(); });
  }
  const L = yahoo.leagues;
  const body = L === 'loading' ? loadingLine('Loading your Yahoo leagues…')
    : L.error ? `<p class="form-error">${L.error === 'yahoo sign-in' ? 'Yahoo signed you out. Sign in again.' : `Couldn't load your Yahoo leagues (${esc(L.error)}).`}</p>`
    : !L.length ? '<p class="small muted">No Yahoo basketball leagues this season on that account.</p>'
    : `<div class="land-teams">${L.map(l => `<button type="button" class="land-team" data-action="yahoo-pick" data-id="${esc(l.key)}">${esc(l.name)} <span class="muted small">${l.teams} teams</span></button>`).join('')}</div>`;
  return `<div class="land-yahoo"><p class="small"><b>Your Yahoo leagues</b> · <button type="button" class="link-btn" data-action="yahoo-signout">Sign out of Yahoo</button></p>${body}</div>`;
}

// Switch the whole app to a Fantrax or ESPN league by ID (or the league's address). Throws a readable message.
async function needNba() {
  if (!NBA) await nbaLoading;
  if (!NBA) throw new Error(`Couldn't load ${SPORT.name} data. Check your connection and try again.`);
}
// A league that didn't load, as a readable message
function leagueError(id, e) {
  const site = SOURCE_NAME[leagueSourceOf(id)];
  if (e.message === 'yahoo sign-in') return new Error('Sign in with Yahoo to load Yahoo leagues.');
  if (e.message === 'private league') return new Error("That ESPN league is private, so ESPN won't share it. Only public ESPN leagues can be loaded; the league manager can make it viewable to the public in the league's settings.");
  if (/not basketball/.test(e.message)) return new Error(`That league isn't basketball (${e.message.replace(/^that's /, '')}).`);
  if (/^not supported: /.test(e.message)) return new Error(`That's a Fantrax ${e.message.replace(/^not supported: /, '')} league. League Layer covers basketball and hockey leagues on Fantrax (and football on Sleeper) for now.`);
  return new Error(`${site} didn't find that league (${e.message}). Check the ID in your league's address.${site === 'ESPN' ? ' Only public ESPN leagues can be loaded.' : ''}`);
}

async function switchLeague(input) {
  const id = parseLeagueId(input);
  if (!id) throw new Error(BAD_LEAGUE_ID);
  await needNba();
  // the league's sport has to be on screen before the league can be: nothing's drawn until both are (ui.hold), and
  // a league that doesn't load leaves the sport as it was. Fantrax and Sleeper leagues say their sport; the other sites are basketball.
  // (coming from the demo, nothing is kept: its team was only borrowed, even if this is the same league)
  // (out of the sandbox, picked in the league menu or its way back: the league underneath is the one it was entered from,
  // which the sandbox's sport may not know, and its team and lineup are kept under it first, so they come back with it)
  let back = state.browse && state.fxTeam && state.sandbox && state.sandbox.back;
  // (a sandbox saved before it named that league: your own league's ID, else the site's own league, which basketball's data names)
  if (state.browse && state.fxTeam && !back) { const id0 = state.fxLeagueId || ((await fetchSport('nba').catch(() => null)) || {}).siteLeague?.id; if (id0) back = { id: id0 }; }
  if (back) stashLeague(back.id);
  const cur = back ? back.id : currentLeagueId(), was = SPORT.key, fromDemo = !!state.demo;
  let res;
  ui.hold = true;
  try {
    if (!['fantrax', 'sleeper'].includes(leagueSourceOf(id))) await useSport('nba');
    res = await getLeague(id);
    await useSport(res.league.sport || 'nba');
  } catch (e) {
    await useSport(was).catch(() => {});
    throw leagueError(id, e);
  } finally {
    ui.hold = false;
  }
  const wasCurrent = cur === id && !fromDemo;
  ui.season = null; ui.pastTeam = null;
  if (!wasCurrent && !fromDemo) stashLeague(cur);
  applyFantraxLeague(withSiteExtras(res));
  state.fxLeagueId = NBA.siteLeague && NBA.siteLeague.id === id ? null : id;
  state.demo = false;
  state.browse = false; // a league again, after browsing without one
  state.leagueChosen = true;
  ui.viewA = null; ui.viewB = null;
  if (!wasCurrent) { ui.weekShift = 0; ui.weekChosen = false; } // Plan Ahead: next week again
  // (the same league with no team picked, where a team was kept for it: that team again. A reload in the sandbox on the
  // other sport once dropped the pick: loadNba)
  const lost = wasCurrent && !state.fxTeam && state.leagueStates && state.leagueStates[id] && state.leagueStates[id].fxTeam;
  if (!wasCurrent || lost) {
    const saved = state.leagueStates && state.leagueStates[id];
    if (saved) Object.assign(state, JSON.parse(JSON.stringify(saved)));
    else {
      Object.assign(state, { fxTeam: null, players: [], il: [], lineup: [], opp: emptyOpp(), teamName: res.league.name });
      applyLeagueRules(res.league);
    }
  }
  if (state.fxTeam) { rememberLeague(id, res.league); syncLeagueRules(); }
  foldPastSeasons();
  syncLinked();
  validateLineup();
  if (!tabList().some(([k]) => k === ui.tab)) location.hash = '#dashboard'; // (out of the sandbox, on one of its own tabs: the Matchup tab)
  return res.league;
}

// Make a league team "yours": load its roster and lineup, and this week's opponent
function adoptTeam(teamId) {
  const side = fxTeamSide(teamId);
  state.fxTeam = teamId;
  if (fxLeague() && !state.demo) rememberLeague(currentLeagueId(), fxLeague());
  state.players = side.players;
  state.il = side.il;
  state.lineup = side.lineup;
  state.teamName = side.name || state.teamName;
  const opp = fxOpponentFor(weekStart());
  if (opp) {
    const o = fxTeamSide(opp.id);
    state.opp = { name: o.name, week: weekStart(), fxId: opp.id, players: o.players, starters: o.starters, il: o.il };
  } else {
    state.opp = { name: '', week: null, players: [], starters: null, fxId: null };
  }
}

/* ---------- The demo: the site's own league, seen as one of its teams ---------- */
// Every tab needs a team, so the demo starts as one: the best record with a matchup this week. It stays out of the
// visitor's own leagues, and the team picker just changes which team it's seen as.
// It's a real league, so it and its teams go by made-up names, on the copy on this page only: connecting the league for
// real loads it afresh with its own.
const DEMO_TEAMS = ['Buzzer Beaters', 'Fast Breakers', 'Glass Cleaners', 'Rim Rockers', 'Triple Threats', 'Sharpshooters', 'Bench Mob',
  'Alley Oops', 'Pick and Rollers', 'Full Court Press', 'Crossover Kings', 'Sixth Men', 'Baseline Bombers', 'Paint Patrol', 'Shot Clocks', 'Backboard Bullies'];
function demoNames(L) {
  const names = new Map(L.teams.map((t, i) => [t.id, DEMO_TEAMS[i] || `Team ${i + 1}`]));
  for (const t of [...L.teams, ...(L.standings || [])]) t.name = names.get(t.id) || t.name;
  L.name = 'Demo League';
}
function demoTeam() {
  const L = fxLeague(), order = [...(L.standings || []).map(s => s.id), ...L.teams.map(t => t.id)];
  return order.find(id => fxRoster(id).length && fxOpponentFor(weekStart(), id)) || order.find(id => fxRoster(id).length) || order[0];
}
const demoNote = () => (state.demo && state.fxTeam ? `<span><b>Demo league.</b> You're playing as ${esc(fxTeamName(state.fxTeam))}. Pick any team above.</span><button type="button" class="btn sm primary" data-action="demo-exit">Connect your league</button>` : '');

/* ---------- Landing page: connect a league, then pick your team ---------- */
const needsLanding = () => ui.addingLeague || (!state.fxTeam && !state.demo && !state.browse);

// The front page's picture of a week's matchup, drawn as the shared link's picture is (icons/og.png): made-up numbers, for the look only.
// Each category: its label, your bar, your opponent's (TO: fewer wins), so 6 won and 3 lost
const LAND_PREVIEW = [['PTS', 92, 80], ['REB', 69, 85], ['AST', 88, 61], ['3PM', 73, 65], ['STL', 55, 71], ['BLK', 64, 40], ['TO', 46, 59], ['FG%', 81, 78], ['FT%', 69, 83]];
const LAND_FEATURES = [
  ['dashboard', 'Matchup odds', 'Your chance to win the week and each category, live during games.'],
  ['week', 'Best lineup', 'Who plays when, and the starters that give you the best chance to win.'],
  ['standings', 'Standings', 'How your categories stack up against every team in the league.'],
  ['recap', 'Weekly recap', "The week's awards, as a picture ready for the league chat."],
  ['trade', 'Trades', 'What a deal does to each side, category by category.'],
  ['draft', 'Draft retrospective', 'Which picks paid off, and how your draft is holding up.'],
];
function landPreview() {
  const rows = LAND_PREVIEW.map(([k, a, b], i) => `<div class="lp-row" style="--i:${i}"><span>${k}</span><i style="--w:${a}%"></i><i class="opp" style="--w:${b}%"></i></div>`).join('');
  return `<div class="land-preview" aria-hidden="true"><div class="lp-card">
      <div class="lp-head"><div><b>This week</b><span>Win odds</span></div><strong>68%</strong></div>
      <div class="lp-legend"><span class="you">You</span><span>Opponent</span></div>
      <div class="lp-rows">${rows}</div>
      <div class="lp-foot"><span>Projected <b>6–3</b></span><span class="lp-live">Live</span></div>
    </div></div>`;
}
/* ---------- A look inside: three tabs as they look, under the hero ---------- */
// Made-up numbers, as landPreview's, drawn with each tab's own pieces (.mu-cats, .mu-chip, .game-pill, .lv-dot, the board's
// .dr-cell and shade, the share picture's RC_IMG colors), so a restyle of a tab carries here. Each row's moment (a basket
// going in, the picks coming in) plays once it's in view: landReveal puts .in on it. Its button opens that tab in the demo.
const landFlip = (was, now) => `<span class="pv-sw"><span>${was}</span><span>${now}</span></span>`; // (a number before, then after the basket)
// [category, yours, theirs, who leads (1 you, -1 them), then after the basket: yours, who leads]: 4–5 down, then 5–4 up on PTS
const LAND_LIVE_CATS = [['FG%', '.468', '.455', 1, '.474'], ['FT%', '.750', '.800', -1], ['3PM', '7', '6', 1, '8'], ['PTS', '99', '101', -1, '102', 1],
  ['REB', '41', '45', -1], ['AST', '22', '19', 1], ['STL', '6', '8', -1], ['BLK', '8', '5', 1], ['TO', '15', '12', -1]];
// each side's players today: name, the game, and his line ([number, stat, number after the basket])
const LAND_LIVE_ROWS = [
  [['V. Wembanyama', `<span class="gp-part">SAS 78 @ LAL 74</span> <span class="gp-part"><span class="lv-dot"></span>${landFlip('Q3 4:12', 'Q3 3:48')}</span>`, [['7/14', 'FG', '8/15'], ['3/4', 'FT'], ['1', '3PM', '2'], ['18', 'PTS', '21'], ['9', 'REB'], ['3', 'BLK']]],
    ['J. Brunson', '<span class="gp-part">NYK 61 @ BOS 66</span> <span class="gp-part"><span class="lv-dot out"></span>Q3 9:30</span>', [['5/11', 'FG'], ['4/4', 'FT'], ['2', '3PM'], ['16', 'PTS'], ['6', 'AST'], ['2', 'TO']]]],
  [['T. Maxey', 'PHI 118 @ MIA 109', [['11/22', 'FG'], ['6/6', 'FT'], ['4', '3PM'], ['32', 'PTS'], ['7', 'AST'], ['2', 'STL']], ' gp-w'],
    ['K. Durant', 'HOU 102 @ DEN 111', [['9/17', 'FG'], ['5/5', 'FT'], ['3', '3PM'], ['26', 'PTS'], ['6', 'REB'], ['1', 'BLK']], ' gp-l']],
];
function landLive() {
  const cell = (v, after, lead, leadAfter, me) => {
    const on = me ? lead > 0 : lead < 0, then = leadAfter == null ? on : me ? leadAfter > 0 : leadAfter < 0;
    return `<td class="${on ? 'mu-lead' : ''}${on !== then ? (then ? ' pv-gain' : ' pv-lose') : ''}">${after ? landFlip(v, after) : v}</td>`;
  };
  const side = ([name, game, line, end = ''], right) => `<div class="pvl-p${right ? ' right' : ''}"><b>${name}</b><span class="game-pill${end}">${game}</span>
    <span class="mu-chips">${line.map(([v, k, after]) => `<span class="mu-chip${after ? ' pv-flash' : ''}"><b>${after ? landFlip(v, after) : v}</b> ${k}</span>`).join('')}</span></div>`;
  return `<div class="pv-card pv-live" aria-hidden="true">
    <div class="pvl-seg"><span class="on">Today</span><span>Yesterday</span><span>This period</span></div>
    <div class="pvl-board"><div><span>Alley Oops</span><b class="mu-score">${landFlip(4, 5)}</b></div><div class="right"><span>Rim Rockers</span><b class="mu-score">${landFlip(5, 4)}</b></div></div>
    <table class="mu-cats"><thead><tr>${LAND_LIVE_CATS.map(c => `<th>${c[0]}</th>`).join('')}</tr></thead><tbody>
      <tr class="pf-me">${LAND_LIVE_CATS.map(([, a, , lead, after, leadAfter]) => cell(a, after, lead, leadAfter, true)).join('')}</tr>
      <tr class="mu-opp">${LAND_LIVE_CATS.map(([, , b, lead, , leadAfter]) => cell(b, '', lead, leadAfter, false)).join('')}</tr>
    </tbody></table>
    ${LAND_LIVE_ROWS.map(([me, them]) => `<div class="pvl-row">${side(me)}${side(them, true)}</div>`).join('')}
  </div>`;
}
// A snake draft's first three rounds, four teams (yours the second): each pick by his last name and how far ahead (+) or
// behind (−) of his draft spot he's playing, in the board's own green and red (short names: four columns fit a phone)
const LAND_BOARD = { teams: ['Rim Rockers', 'Alley Oops', 'Bench Mob', 'Sixth Men'], me: 1,
  picks: [['Jokić', 2], ['Dončić', 5], ['Edwards', -3], ['Booker', -9], ['Mitchell', 11], ['Banchero', -6], ['Brunson', 4], ['Sengun', -14], ['Fox', -21], ['Maxey', 38], ['Harden', 17], ['Murray', -8]] };
function landBoard() {
  const { teams, me, picks } = LAND_BOARD, T = teams.length, grid = {};
  picks.forEach((p, i) => { const r = Math.floor(i / T), c = r % 2 ? T - 1 - (i % T) : i % T; grid[`${r}|${c}`] = [...p, i]; });
  const rows = Array.from({ length: picks.length / T }, (_, r) => `<tr><th scope="row">R${r + 1}</th>${teams.map((t, c) => {
    const [name, gain, i] = grid[`${r}|${c}`];
    return `<td class="dr-cell" style="--n:${i};${shade(gain / 15)}"><span class="dr-pick">#${i + 1}</span><b>${name}</b><span class="dr-gain ${gain > 0 ? 'pos-good' : 'pos-bad'}">${signed(gain, 0)}</span></td>`;
  }).join('')}</tr>`).join('');
  const best = [...picks].sort((a, b) => b[1] - a[1]);
  return `<div class="pv-card pv-board" aria-hidden="true">
    <div class="pvd-head"><b>Draft board</b><span>Snake draft</span></div>
    <table><thead><tr><th></th>${teams.map((t, c) => `<th${c === me ? ' class="dr-mine-col"' : ''}>${t}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>
    <div class="lp-foot"><span>Best pick <b>${best[0][0]} <span class="pos-good">${signed(best[0][1], 0)}</span></b></span><span>Worst <b>${best.at(-1)[0]} <span class="pos-bad">${signed(best.at(-1)[1], 0)}</span></b></span></div>
  </div>`;
}
// The Recap's picture as it goes to the league chat (recapCanvas in share.js), in its own colors, its photos as initials
const LAND_RECAP = [
  ['Player of the period', '4 G, per game', 'V. Wembanyama', 'Alley Oops', [['29.5', 'PTS'], ['11.3', 'REB'], ['4.8', 'BLK'], ['.561', 'FG%']]],
  ['Game of the period', '', 'J. Brunson', 'Bench Mob', [['44', 'PTS'], ['6', '3PM'], ['9', 'AST'], ['.684', 'FG%']]],
  ['Bench regret', '', '', '', '<b>Sixth Men</b>: starting <b>D. Vassell</b> over <b>B. Hield</b> would have won 5–4'],
];
function landRecap() {
  const C = RC_IMG, card = ([award, per, name, team, line]) => `<div class="pvr-card"><div><small>${award}${per ? ` <i>· ${per}</i>` : ''}</small>
    ${name ? `<p><b>${name}</b> <span${team === 'Alley Oops' ? ' class="pvr-me"' : ''}>${team}</span></p><p class="pvr-line">${line.map(([v, k]) => `<b>${v}</b> ${k}`).join(' ')}</p>` : `<p class="pvr-note">${line}</p>`}</div>
    ${name ? `<span class="pvr-face">${initials(name.replace('. ', ' '))}</span>` : ''}</div>`;
  // each final: a team, the score, the other team, each with the week's Best or Worst badge on its outer side, as the picture has it
  const badge = m => (m ? `<i class="${m === 'Best' ? 'good' : 'bad'}">${m}</i>` : '');
  const finals = [['Alley Oops', '6–3', 'Rim Rockers', 'Best', ''], ['Bench Mob', '5–4', 'Sixth Men', '', ''], ['Glass Cleaners', '3–6', 'Fast Breakers', '', 'Worst']];
  return `<div class="pv-pic" aria-hidden="true" style="--r-bg:${C.bg};--r-card:${C.card};--r-line:${C.line};--r-text:${C.text};--r-soft:${C.soft};--r-muted:${C.muted};--r-accent:${C.accent};--r-good:${C.good};--r-bad:${C.bad}">
    <span class="pvr-kicker">Period 6 recap</span><b class="pvr-title">Monday Night Hoops</b>
    ${LAND_RECAP.map(card).join('')}
    <small class="pvr-sec">Results</small>
    ${finals.map(([a, s, b, ma, mb]) => `<div class="pvr-final"><span>${badge(ma)}<b>${a}</b></span><strong>${s}</strong><span><b>${b}</b>${badge(mb)}</span></div>`).join('')}
    <div class="pvr-foot">${LOGO_MARK}<b>League Layer</b><span>leaguelayer.com</span></div>
  </div>
  <div class="pvr-share" aria-hidden="true"><span class="on">Share image</span><span>Copy text and link</span></div>`;
}
// The rows: the tab's icon and name, what it does, the picture, and a way into the demo at that tab
const LAND_SHOW = [
  ['dashboard', 'Matchup', 'Every game, live', "Each starter's game and line as it happens, who's on the floor, and the categories and the score moving as the games go.", landLive],
  ['draft', 'Draft', 'Every pick on one board', "Your league's whole draft, each pick green or red by how he's playing against where he went. Then the Draft Retrospective's awards, from the biggest reach to the quickest trigger finger.", landBoard],
  ['recap', 'Recap', 'A recap for the league chat', 'The period in awards, from the player of the period to the bench regret, with every final. Share it as a picture, or as a link that opens with no sign-up.', landRecap],
];
function landShow(demo) {
  return `<section class="land-shows" aria-label="A look inside">${LAND_SHOW.map(([tab, name, title, line, draw], i) => `
    <div class="land-show${i % 2 ? ' flip' : ''}">
      <div class="lsh-copy">
        <p class="lsh-tab">${lineIcon(TAB_ICONS[tab], 'lsh-ico')}${name}</p>
        <h2>${title}</h2>
        <p class="lsh-line">${line}</p>
        ${demo ? `<button type="button" class="btn sm" data-action="land-demo" data-tab="${tab}">See it in the demo</button>` : ''}
      </div>
      <div class="lsh-pic">${draw()}</div>
    </div>`).join('')}
  </section>`;
}
// each row's moment plays once half its picture is on screen (on phones the words come first), where there's no
// IntersectionObserver at once
function landReveal() {
  const pics = [...document.querySelectorAll('.land-show:not(.in) .lsh-pic')], row = el => el.closest('.land-show');
  if (!pics.length) return;
  if (typeof IntersectionObserver !== 'function') { pics.forEach(p => row(p).classList.add('in')); return; }
  const io = new IntersectionObserver(seen => seen.forEach(e => { if (e.isIntersecting) { row(e.target).classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.5 });
  pics.forEach(p => io.observe(p));
}

// The headline's sport takes each in turn (a screen reader hears them all, in one line), each with its line icon and its own
// way in (styles.css: the ball dribbles in, the puck slides in on the ice). Its CSS animation ticks (land-tick): each loop
// the word rolls away for the next, and the box eases to the next one's width so "week" follows it.
// The event, not a timer: it stops with the page, waits in a background tab, and never fires in the tests.
const LAND_SPORTS = [ // (solid, to stand beside the headline's heavy type: the ball's seams and the puck's rim cut out in the page's color)
  ['basketball', '<circle cx="12" cy="12" r="10"/><path class="ls-seam" d="M12 2v20M2 12h20M4.9 4.9a10 10 0 0 1 0 14.2M19.1 4.9a10 10 0 0 0 0 14.2"/>'],
  ['hockey', '<path class="ls-fx" d="M-11 8h6M-14 12.5h9M-10 17h5"/><path d="M2 9v6c0 2.2 4.5 4 10 4s10-1.8 10-4V9c0-2.2-4.5-4-10-4S2 6.8 2 9z"/><path class="ls-seam" d="M2.6 10.4c1.4 1.5 5 2.6 9.4 2.6s8-1.1 9.4-2.6"/>'],
];
document.addEventListener('animationiteration', e => {
  const box = e.target;
  if (e.animationName !== 'land-tick' || !box.classList || !box.classList.contains('land-sport')) return;
  const words = [...box.children], cur = words.findIndex(w => w.classList.contains('on')), next = words[(cur + 1) % words.length], em = parseFloat(getComputedStyle(box).fontSize);
  box.style.width = `${box.offsetWidth / em}em`; // (from auto, which doesn't ease, to its own width first)
  void box.offsetWidth;
  box.style.width = `${next.offsetWidth / em}em`;
  next.style.transition = 'none'; // (out of its rolled-away place at once, to come in its own way)
  next.classList.remove('out');
  void next.offsetWidth;
  next.style.transition = '';
  if (words[cur]) words[cur].classList.replace('on', 'out');
  next.classList.add('on');
});
// A first visit: what the site does around the form, and the ways in without a league
function landHome(form) {
  const demo = NBA && NBA.siteLeague;
  const option = (action, icon, title, line) => `<button type="button" class="land-option" data-action="${action}">${lineIcon(icon, 'lo-ico')}<span><b>${title}</b><small>${line}</small></span>${lineIcon('<path d="m9 6 6 6-6 6"/>', 'lo-go')}</button>`;
  return `<div class="landing-wrap land-home">
    <section class="land-hero">
      <div class="land-copy">
        <p class="land-pill">Free forever · No sign-up</p>
        <h1><span class="sr-only">Plan your fantasy ${LAND_SPORTS.map(s => s[0]).join(' or ')} week</span><span aria-hidden="true">Plan your fantasy<br><span class="land-sport">${LAND_SPORTS.map(([s, icon], i) => `<span data-sport="${s}"${i ? '' : ' class="on"'}>${lineIcon(icon, 'ls-ico')}<span class="ls-w">${s}</span></span>`).join('')}</span> week</span></h1>
        <p class="land-lead">Your odds for this week's matchup, the best starters, how your categories stack up and a recap the whole league can share.</p>
        <div class="land-connect">${form}</div>
        <div class="land-alt">
          <p class="land-alt-title">No league to connect?</p>
          <div class="land-options">
            ${demo ? option('land-demo', TAB_ICONS.dashboard, 'Explore a basketball demo league', 'Every tab filled in, as one of its teams') : ''}
            ${option('land-browse', TAB_ICONS.team, 'Try the sandbox', 'A team of any NBA or NHL players, followed live')}
          </div>
        </div>
      </div>
      ${landPreview()}
    </section>
    ${landShow(demo)}
    <section class="land-features" aria-labelledby="landFeat">
      <h2 id="landFeat">Built around your league's own rules</h2>
      <p class="muted">Categories or points, daily or weekly lineups, its own slots and playoffs.</p>
      <div class="lf-grid">${LAND_FEATURES.map(([icon, title, line]) => `<div class="lf">${lineIcon(TAB_ICONS[icon], 'lf-ico')}<div><h3>${title}</h3><p>${line}</p></div></div>`).join('')}</div>
    </section>
  </div>`;
}

function viewLanding() {
  const chosen = !ui.addingLeague && state.leagueChosen && fxLeague() && !state.fxTeam;
  const afterSeason = ui.afterPick && pastCache[ui.afterPick.split('/')[1]];
  const step2 = chosen ? `
      <p class="land-step">Step 2 of 2</p>
      <h1>Which team is yours?</h1>
      <p class="muted">Connected to <b>${esc(fxLeague().name)}</b>. ${ui.afterPick === '#recap' ? `Pick your team to see the ${ui.recapWeek ? `period ${ui.recapWeek}` : 'period'} recap a league mate shared.` : ui.afterPick === '#trade' && ui.tradeLink ? 'Pick your team to see the trade a league mate shared.' : afterSeason ? `Pick your team to see the ${afterSeason.label} season.` : "Pick your team to load your roster and this week's matchup."}</p>
      ${preDraft() ? `<p class="land-note">This league hasn't drafted yet${draftWhen(fxLeague()) ? ` (draft: ${esc(draftWhen(fxLeague()))})` : ''}, so rosters are empty for now.</p>` : ''}
      <div class="land-teams">${fxPickable().map(t => `<button type="button" class="land-team" data-action="land-team" data-id="${esc(t.id)}"><span class="lt-tag" aria-hidden="true">${esc(initials(t.name))}</span><span class="lt-name">${esc(t.name)}</span></button>`).join('')}</div>
      <p class="small muted" style="margin:16px 0 0"><button class="link-btn" data-action="land-back">Use a different league</button>${(state.savedLeagues || []).length ? ' · <button class="link-btn" data-action="land-cancel">Cancel</button>' : ''}</p>` : '';
  const adding = ui.addingLeague && state.fxTeam, forSeason = adding && ui.addingLeague === 'season' && fxLeague();
  const form = `
      <form class="land-form" data-form="land-league">
        <label class="field" for="landLeague">${forSeason ? "That season's league ID or address" : 'League ID or address'}
          <input id="landLeague" name="leagueId" placeholder="${forSeason ? 'Fantrax league ID' : 'Fantrax, ESPN or Sleeper league ID'}" autocomplete="off" spellcheck="false" autofocus>
        </label>
        <button class="btn primary" type="submit">${forSeason ? 'Add season' : 'Connect league'}</button>
      </form>
      <p class="form-error" id="landMsg" role="alert"></p>
      ${forSeason ? '' : yahooLanding()}
      <details class="land-help">
        <summary>Where do I find my league ID?</summary>
        <p><b>Fantrax:</b> open your league on fantrax.com. The ID is the part of the address right after <b>/league/</b>:<br>
        <span class="land-url">fantrax.com/fantasy/league/<b>abc123def456</b>/home</span></p>
        <p><b>ESPN:</b> open your league on espn.com. The ID is the number after <b>leagueId=</b>:<br>
        <span class="land-url">fantasy.espn.com/basketball/league?leagueId=<b>12345678</b></span><br>
        Only public ESPN leagues can be loaded.</p>
        <p><b>Sleeper:</b> open your league at sleeper.com. The ID is the long number after <b>/leagues/</b>:<br>
        <span class="land-url">sleeper.com/leagues/<b>1234567890123456789</b>/matchup</span></p>
        <p>Pasting the whole address works too.</p>
      </details>
      <p class="small muted land-foot">Built for head-to-head leagues: basketball on Fantrax, ESPN and Sleeper, hockey on Fantrax. ${adding ? '<button class="link-btn" data-action="land-cancel">Cancel</button>' : ''}</p>`;
  if (!chosen && !adding) return landHome(form);
  const step1 = chosen ? '' : `
      <p class="land-step">${forSeason ? 'Add a season' : 'Add a league'}</p>
      <h1>${forSeason ? 'Add an earlier season' : 'Connect another league'}</h1>
      <p class="muted">${forSeason ? `Each season of <b>${esc(forSeason.name)}</b> has its own Fantrax league ID: open that season on Fantrax and copy the part of the address after <b>/league/</b>.`
        : 'Enter its league ID. Each league keeps its own team and notes, and earlier seasons go under their league in the menu at the top.'}</p>${form}`;
  return `<div class="landing-wrap"><div class="landing-card">${step1}${step2}</div></div>`;
}
