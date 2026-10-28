// Courtside Manager: Alerts, page rendering, the league and season bar, past seasons.
// The site loads js/*.js in order (see index.html); they share one scope, like one file.
'use strict';

/* =========================================================
   Alerts
   ========================================================= */
function buildAlerts() {
  const a = [];
  state.lineup.forEach((id, i) => {
    const p = byId(id);
    if (!p) a.push({ lvl: 'warn', msg: `Empty <b>${state.slots[i]}</b> slot in your starting lineup.` });
    else if (p.status === 'Out') a.push({ lvl: 'bad', msg: `<b>${esc(p.name)}</b> is Out but starting at ${state.slots[i]}.` });
    else if (p.status === 'DTD') a.push({ lvl: 'warn', msg: `<b>${esc(p.name)}</b> is day-to-day — confirm before lock.` });
  });
  for (const p of ilPlayers()) {
    if (p.status === 'Healthy') a.push({ lvl: 'warn', msg: `<b>${esc(p.name)}</b> is healthy but sitting on IL.` });
  }
  if (state.il.length > state.ilSize) a.push({ lvl: 'bad', msg: `IL has ${state.il.length} players but only ${state.ilSize} spots.` });
  const over = activeCount() - rosterLimit();
  if (over > 0) a.push({ lvl: 'bad', msg: `Roster is ${over} over the ${rosterLimit()}-player limit. Drop or IL someone.` });
  // lineup advice lives on Matchups, where it plays to the actual matchup
  if (NBA && state.opp.players.length && state.lineupMode === 'weekly') {
    const ctx = weekContext();
    const better = ctx.bestIds && [...ctx.bestIds].some(id => !ctx.setIds.has(id));
    if (better) a.push({ lvl: 'warn', msg: `A better lineup for this week takes you from <b>${pctTxt(ctx.oSet.win)}</b> to <b>${pctTxt(ctx.oBest.win)}</b> to win.`, action: 'go-week', label: 'See it' });
  }
  if (!a.length) a.push({ lvl: 'good', msg: 'Lineup is set and everyone starting is healthy.' });
  return a;
}

/* =========================================================
   Rendering
   ========================================================= */
function leagueMenu() {
  const el = $('#leagueMenu');
  if (!el) return;
  const L = fxLeague();
  if (!L || needsLanding()) { el.innerHTML = ''; return; }
  const cur = currentLeagueId();
  const saved = state.savedLeagues || [];
  const site = NBA && NBA.siteLeague;
  const wasOpen = el.querySelector('details') && el.querySelector('details').open;
  el.innerHTML = `<details class="lm"${wasOpen ? ' open' : ''}>
    <summary aria-label="League menu"><span class="lm-name">${esc(L.name)}</span><span class="lm-caret" aria-hidden="true">▾</span></summary>
    <div class="lm-pop">
      <div class="lm-sec">Leagues</div>
      ${saved.map(l => `<div class="lm-row"><button type="button" class="lm-item${l.id === cur ? ' on' : ''}" data-action="league-switch" data-id="${esc(l.id)}">${l.id === cur ? '✓ ' : ''}${esc(l.name)}</button>${l.id !== cur ? `<button type="button" class="icon-btn xs" data-action="league-remove" data-id="${esc(l.id)}" aria-label="Remove ${esc(l.name)}" title="Remove">✕</button>` : ''}</div>`).join('')}
      ${state.demo ? `<div class="lm-row"><span class="lm-item on">✓ ${esc(L.name)} <span class="muted">(demo)</span></span></div>` : ''}
      <button type="button" class="lm-item" data-action="league-add">+ Add a league</button>
      ${site && !saved.some(l => l.id === site.id) && !state.demo ? '<button type="button" class="lm-item" data-action="land-demo">Explore the demo league</button>' : ''}
      <div class="lm-sec">Stats used ${infoBtn('projection')}</div>
      ${Object.entries(BASIS_LABELS).map(([k, l]) => `<button type="button" class="lm-item${state.basis === k ? ' on' : ''}" data-action="set-basis" data-basis="${k}">${state.basis === k ? '✓ ' : ''}${l}</button>`).join('')}
      <div class="lm-sec">This device</div>
      <button type="button" class="lm-item" data-action="export">Backup &amp; restore</button>
      <button type="button" class="lm-item danger" data-action="start-fresh">Reset and start over</button>
      <div class="lm-sec">Version ${BUILD.startsWith('__') ? 'local' : esc(BUILD)}</div>
    </div>
  </details>`;
}

// ----- Past seasons -----
// Each Fantrax season is its own league. Past seasons are added by league ID and kept per league
// (keyed by Fantrax's league history id); a past season gets its own tabs. Fantrax leagues only, so far.
const TABS_NOW = [['dashboard', 'Dashboard'], ['week', 'Matchups'], ['roster', 'Roster'], ['players', 'Free Agents'], ['draft', 'Draft'], ['standings', 'Standings'], ['awards', 'Awards'], ['trade', 'Trades']];
const TABS_PAST = [['standings', 'Standings'], ['awards', 'Awards'], ['draft', 'Draft'], ['rosters', 'Rosters']];
const tabList = () => (ui.season ? TABS_PAST : TABS_NOW);
const seasonLabel = y => `${y}-${String(y + 1).slice(2)}`;
const pastCache = {};
let seasonCtx = null; // set while a past season renders: { basis, label }
const pastSeason = () => (ui.season ? pastCache[ui.season] || null : null);

function seasonsFor(L) {
  const saved = state.pastSeasons || {};
  const all = [...(L.pastSeasons || []), ...(saved[L.historyId] || []), ...(saved[L.id] || [])];
  const seen = new Set();
  return all.filter(x => x.id !== L.id && !seen.has(x.id) && seen.add(x.id)).sort((a, b) => (b.year || 0) - (a.year || 0));
}

async function loadSeason(id) {
  if (pastCache[id]) return pastCache[id];
  const { league, idMap } = await fetchFantraxLeague(id, { opening: true });
  // that season's NBA stats, if saved, grade its draft, awards and rosters
  const season = league.year ? seasonOf(league.year) : null;
  const A = season ? await loadArchive(season) : null;
  const findOld = A ? matchInactive(league, A) : () => null;
  league.fidNba = fid => idMap.toNba[fid] || (idMap.names[fid] ? findOld(idMap.names[fid]) : null);
  // keepers again, now that players no longer in the NBA are matched (shown on the board, not graded)
  if (league.draft) league.draft.keepers = keepersOf(league);
  league.weeks = await loadRosterWeeks(league).catch(() => null);
  league.season = season; // its game log loads when Awards opens
  const prevStart = NBA && NBA.prevSeason ? +String(NBA.prevSeason).slice(0, 4) : null;
  const basis = A ? 'arch:' + season : league.year && league.year === prevStart ? 'prev' : null;
  return (pastCache[id] = { league, basis, label: league.year ? seasonLabel(league.year) : 'Past season' });
}

// Tabs that can show another team's version (read-only); the rest are league-wide or yours
const VIEW_TABS = ['week', 'dashboard', 'roster'];

// League and team bar shown above every tab
function ctxBar() {
  const bar = $('#ctxBar');
  if (!bar) return;
  const L = fxLeague();
  bar.hidden = !L || needsLanding();
  if (bar.hidden) return;
  const P = pastSeason();
  const seasons = seasonsFor(L);
  const seasonSel = `<select class="ctx-team ctx-season" data-change="season" aria-label="Season">
      <option value="">${esc(L.year ? seasonLabel(L.year) : NBA ? NBA.season : 'This season')}</option>${seasons.map(x => `<option value="${esc(x.id)}" ${x.id === ui.season ? 'selected' : ''}>${x.year ? seasonLabel(x.year) : 'Past season'}</option>`).join('')}
      ${hasLineupHistory(L) ? '<option value="add">+ Add season…</option>' : ''}</select>`;
  const addForm = ui.addingSeason ? `<form class="ctx-add" data-form="add-season">
      <input name="sid" placeholder="Past season's league ID" autocomplete="off" spellcheck="false" aria-label="Past season's Fantrax league ID" title="Open that season on Fantrax; the ID is the part of the address after /league/">
      <button class="btn sm primary" type="submit">Add</button><button class="btn sm ghost" type="button" data-action="season-cancel">Cancel</button></form>` : '';
  let teamSel;
  if (P) {
    const myName = fxTeamName(state.fxTeam);
    const teams = P.league.teams;
    const me = teams.find(t => t.name === myName);
    const shownId = ui.pastTeam || (me ? me.id : '');
    teamSel = `<select class="ctx-team" data-change="past-team" aria-label="Team">${shownId ? '' : '<option value="">Pick a team</option>'}${teams.map(t => `<option value="${esc(t.id)}" ${t.id === shownId ? 'selected' : ''}>${esc(t.name)}${me && t.id === me.id ? ' (you)' : ''}</option>`).join('')}</select>`;
  } else {
    const viewing = ui.viewA && VIEW_TABS.includes(ui.tab);
    const shown = viewing ? ui.viewA : state.fxTeam;
    teamSel = `<select class="ctx-team" data-change="${state.fxTeam ? 'fx-view' : 'fx-team'}" aria-label="${state.fxTeam ? 'Team to view' : 'Your team'}">
      ${state.fxTeam ? '' : '<option value="">Pick your team</option>'}${fxPickable().map(t => `<option value="${esc(t.id)}" ${t.id === shown ? 'selected' : ''}>${esc(t.name)}${t.id === state.fxTeam ? ' (you)' : ''}</option>`).join('')}
    </select>${viewing ? '<span class="badge">Viewing only</span><button class="link-btn small" data-action="fx-view-mine">Back to my team</button>' : ''}`;
  }
  $('#ctxTeam').innerHTML = `${seasonSel}<span class="ctx-sep" aria-hidden="true">/</span>${teamSel}${addForm}`;
  document.body.classList.toggle('past', !!P);
  if (P) {
    $('#ctxMeta').innerHTML = [
      '<span class="badge accent">Past season</span>',
      'standings and weekly lineups from Fantrax',
    ].join(' · ');
    $('#ctxMeta').hidden = false;
    return;
  }
  const notes = [
    isPoints() && L.pointsOther && L.pointsOther.length ? `<span title="Not projected: ${esc(L.pointsOther.join(', '))}">some scoring stats not projected</span>` : '',
    !isPoints() && L.catsOther && L.catsOther.length ? `<span title="Not projected: ${esc(L.catsOther.join(', '))}">${L.catsOther.length === 1 ? 'one category' : 'some categories'} not projected</span>` : '',
  ].filter(Boolean);
  $('#ctxMeta').innerHTML = notes.length ? `<span>${notes.join(' · ')}</span>` : '';
  $('#ctxMeta').hidden = !notes.length;
}

// Settings (the gear at the right of the tab bar): data freshness, reloading the league, the theme
// What this site keeps in the browser (about 5 MB is allowed), counted in characters
// (league data from Fantrax and ESPN: what "Clear saved league data" removes)
const SAVED_LEAGUE_DATA = ['courtside-fantrax-v2', 'courtside-fantrax-shared-v1', 'courtside-espn-shared-v1', 'courtside-roster-weeks-v2'];
function savedSize() {
  let n = 0;
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('courtside-')) n += k.length + (localStorage.getItem(k) || '').length; } } catch (e) { return 'unknown'; }
  return n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`;
}

function gearMenu() {
  const el = $('#gearMenu');
  if (!el) return;
  const wasOpen = el.querySelector('details') && el.querySelector('details').open;
  const dark = (document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
  const league = fxLeague() && !needsLanding() && !state.demo;
  el.innerHTML = `<details class="gear"${wasOpen ? ' open' : ''}>
    <summary class="icon-btn" aria-label="Settings" title="Settings">⚙</summary>
    <div class="gear-pop">
      <div class="lm-sec">Data</div>
      <div class="gear-row">${NBA ? `NBA stats updated ${ago(NBA.updated)} ${infoBtn('data')}` : 'NBA data unavailable'}</div>
      ${league ? `<button type="button" class="lm-item" data-action="league-reload">↻ Reload from ${sourceName()}<span class="gear-sub">rosters, lineups, matchups and standings</span></button>` : ''}
      <div class="gear-row">Saved on this device: ${savedSize()} ${infoBtn('storage')}</div>
      <button type="button" class="lm-item" data-action="clear-saved">Clear saved league data<span class="gear-sub">leagues, weekly lineups and player lists; fetched again when needed</span></button>
      <div class="lm-sec">Appearance</div>
      <button type="button" class="lm-item gear-toggle" data-action="toggle-theme" role="switch" aria-checked="${dark}">Dark mode<span class="gear-switch${dark ? ' on' : ''}" aria-hidden="true"></span></button>
    </div>
  </details>`;
}

function render() {
  const landing = needsLanding();
  document.body.classList.toggle('landing', landing);
  leagueMenu();
  gearMenu();
  ctxBar();
  if (landing) { $('#view').innerHTML = viewLanding(); return; }
  if (ui.pendingSeason) { $('#view').innerHTML = '<div class="card"><div class="empty"><strong>Loading that season…</strong></div></div>'; return; }
  const nav = $('#tabs');
  const mode = ui.season ? 'past:' + ui.season : 'now';
  if (nav.dataset.mode !== mode) {
    nav.innerHTML = tabList().map(([k, l]) => `<a href="${seasonHash(k, ui.season)}" data-tab="${k}">${l}</a>`).join('');
    nav.dataset.mode = mode;
  }
  document.querySelectorAll('#tabs a').forEach(a => a.classList.toggle('active', a.dataset.tab === ui.tab));
  const cur = tabList().find(([k]) => k === ui.tab);
  $('#navCurrent').textContent = cur ? cur[1] : 'Menu';
  if (ui.season) {
    const past = { standings: viewStandings, awards: viewAwards, draft: viewDraft, rosters: viewPastRosters };
    $('#view').innerHTML = pastSeason() ? withSeason(past[ui.tab] || viewStandings) : '<div class="card"><div class="empty"><strong>Loading that season…</strong></div></div>';
    return;
  }
  const early = preDraft();
  if (early && ['week', 'dashboard', 'roster', 'draft', 'standings', 'trade'].includes(ui.tab)) { $('#view').innerHTML = viewPreDraft(early); return; }
  const views = { week: () => withViewedTeam(viewWeek), draft: viewDraft, players: viewPlayers, dashboard: () => withViewedTeam(viewDashboard), roster: () => withViewedTeam(viewRoster), standings: viewStandings, awards: viewAwardsSoFar, trade: viewTrade };
  // keep scroll position of inner lists (e.g. trade picker, performances) across re-renders
  const inner = '.pick-list, .perf.scroll';
  const scrolls = [...document.querySelectorAll(inner)].map(el => el.scrollTop);
  $('#view').innerHTML = (views[ui.tab] || viewDashboard)();
  fitPerfLists();
  document.querySelectorAll(inner).forEach((el, i) => { el.scrollTop = scrolls[i] || 0; });
}

// Long performance lists show their first 5 rows (and a peek of the 6th, so it's clear they scroll).
// Rows change height when stat lines wrap, so this measures them; it runs again when the window resizes.
function fitPerfLists() {
  document.querySelectorAll('.perf.scroll').forEach(ul => {
    const sixth = ul.children[5];
    if (sixth) ul.style.maxHeight = `${sixth.offsetTop + 22}px`;
  });
}

// A league that hasn't drafted: no picks made and every roster empty
function preDraft() {
  const L = fxLeague();
  if (!L || (L.draft && L.draft.picks.length)) return null;
  return Object.values(L.rosters || {}).some(r => r.length) ? null : L;
}

// Fantrax sends "2026-10-25T19:00:00.0-0400"
function fxTime(str) {
  const dt = new Date(String(str || '').replace(/\.\d+(?=[-+])/, '').replace(/([-+]\d\d)(\d\d)$/, '$1:$2'));
  return Number.isNaN(dt.getTime()) ? null : dt;
}
const draftTime = L => fxTime(L.draftAt);

// Weekly lineups lock when the Fantrax scoring period starts (else at the start of the first matchup day)
function lockTime(start) {
  const p = fxPeriodFor(start);
  return (p && fxTime(p.lock)) || new Date(matchDates(start)[0] + 'T00:00:00');
}

function draftWhen(L) {
  const dt = draftTime(L);
  return dt ? `${dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} at ${dt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : '';
}


function viewPreDraft(L) {
  const when = draftWhen(L);
  const past = draftTime(L) && draftTime(L) < new Date();
  return `<div class="card"><div class="empty"><strong>${past ? 'Waiting on the draft' : "This league hasn't drafted yet"}</strong>
      ${when ? `${past ? 'The draft was set for' : 'The draft is set for'} <b>${esc(when)}</b>. ` : ''}Rosters, matchups and the draft board fill in here once teams have players.
      In the meantime, the <a href="#players">Free Agents</a> tab ranks every NBA player (set Show to Every NBA player).</div></div>`;
}

function standingOf(teamId) {
  const L = fxLeague();
  return L && L.standings ? L.standings.find(r => r.id === teamId) || null : null;
}
