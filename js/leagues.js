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
// A first visit: what the site does around the form, and the ways in without a league
function landHome(form) {
  const demo = NBA && NBA.siteLeague;
  const option = (action, icon, title, line) => `<button type="button" class="land-option" data-action="${action}">${lineIcon(icon, 'lo-ico')}<span><b>${title}</b><small>${line}</small></span>${lineIcon('<path d="m9 6 6 6-6 6"/>', 'lo-go')}</button>`;
  return `<div class="landing-wrap land-home">
    <section class="land-hero">
      <div class="land-copy">
        <p class="land-pill">Free · No sign-up</p>
        <h1>Plan your fantasy basketball or hockey week</h1>
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
      <p class="muted">Connected to <b>${esc(fxLeague().name)}</b>. ${ui.afterPick === '#recap' ? `Pick your team to see the week${ui.recapWeek ? ` ${ui.recapWeek}` : ''} recap a league mate shared.` : ui.afterPick === '#trade' && ui.tradeLink ? 'Pick your team to see the trade a league mate shared.' : afterSeason ? `Pick your team to see the ${afterSeason.label} season.` : "Pick your team to load your roster and this week's matchup."}</p>
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
