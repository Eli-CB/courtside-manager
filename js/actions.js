// Courtside Manager: Button actions, event wiring and start-up.
// The site loads js/*.js in order (see index.html); they share one scope, like one file.
'use strict';

/* =========================================================
   Actions
   ========================================================= */
const actions = {
  'nav-toggle'(el) { setNav(!document.body.classList.contains('nav-open')); },
  'clear-saved'() {
    for (const k of SAVED_LEAGUE_DATA) { try { localStorage.removeItem(k); } catch (e) { /* blocked */ } }
    fxShared = null; espnShared = null;
    for (const id of Object.keys(rosterWeeksLoad)) delete rosterWeeksLoad[id];
    gearMenu();
    toast('Cleared saved league data');
  },
  'toggle-theme'() {
    const root = document.documentElement;
    const cur = root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignore */ }
    gearMenu();
  },
  'fx-load-opp'() {
    const opp = fxOpponentFor(weekStart());
    if (!opp) return toast(`No ${sourceName()} matchup found for this week`);
    loadFxTeam(opp.id);
  },
  'fx-cycle'(el) {
    const leftId = viewingOther() ? ui.viewA : state.fxTeam;
    const others = fxPickable().filter(t => t.id !== leftId);
    if (!others.length) return;
    const curId = viewingOther() ? (ui.viewB || (fxOpponentFor(weekStart(), ui.viewA) || {}).id) : state.opp.fxId;
    const i = others.findIndex(t => t.id === curId);
    const step = +el.dataset.step;
    const next = others[i === -1 ? (step > 0 ? 0 : others.length - 1) : (i + step + others.length) % others.length];
    if (viewingOther()) { ui.viewB = next.id; render(); } else loadFxTeam(next.id);
  },
  'fx-view-mine'() { ui.viewA = null; ui.viewB = null; render(); },
  'fx-view-actual'() { ui.viewB = null; render(); },
  'stat-sort'(el) {
    const key = el.dataset.key;
    if (key === 'slot') Object.assign(ui.statSort, { key, dir: 1 }); // lineup order has one direction
    else nextSort(ui.statSort, key, key === 'name' ? 1 : -1);
    render();
  },
  info(el) {
    const item = INFO[el.dataset.key];
    if (!item) return;
    $('#infoTitle').textContent = item[0];
    $('#infoBody').innerHTML = item[1];
    const d = $('#infoDialog');
    if (!d.open) d.showModal();
  },
  'go-week'() { location.hash = '#week'; },
  'cs-toggle'(el) {
    const open = !ui.csOpen.delete(el.dataset.cat);
    if (open) ui.csOpen.add(el.dataset.cat);
    el.setAttribute('aria-expanded', open);
    el.nextElementSibling.hidden = !open;
  },
  'close-info'() { $('#infoDialog').close(); },
  'past-roster-mode'(el) { ui.pastRosterMode = el.dataset.mode; render(); },
  'past-roster-sort'(el) {
    const k = el.dataset.key;
    nextSort(ui.pastRosterSort, k, k === 'name' || k === 'how' ? -1 : 1);
    render();
  },
  'draft-mode'(el) {
    ui.draftMode = el.dataset.mode;
    try { localStorage.setItem(DRAFT_MODE_KEY, ui.draftMode); } catch (e) { /* ignore */ }
    render();
  },
  'str-basis'(el) {
    ui.strBasis = el.dataset.basis;
    try { localStorage.setItem(STR_KEY, ui.strBasis); } catch (e) { /* ignore */ }
    render();
  },
  'land-team'(el) {
    adoptTeam(el.dataset.id);
    commit(`Welcome, ${state.teamName}`);
    location.hash = '#week';
  },
  'season-cancel'() { ui.addingSeason = false; render(); },
  'land-back'() { state.leagueChosen = false; ui.addingLeague = true; commit(); },
  async 'land-cancel'() {
    ui.addingLeague = false;
    const back = (state.savedLeagues || [])[0];
    if (!state.fxTeam && back) await actions['league-switch']({ dataset: { id: back.id } });
    else commit();
  },
  async 'land-demo'() {
    const site = NBA && NBA.siteLeague;
    if (!site) return;
    try {
      await switchLeague(site.id);
      ui.addingLeague = false;
      if (!state.fxTeam) state.demo = true;
      commit(`Exploring ${site.name}`);
      location.hash = '#week';
    } catch (e) { toast(e.message); }
  },
  async 'league-switch'(el) {
    const id = el.dataset.id;
    $('#leagueMenu details')?.removeAttribute('open');
    if (id === currentLeagueId() && state.fxTeam) return;
    try {
      const league = await switchLeague(id);
      ui.addingLeague = false;
      commit(`Switched to ${league.name}`);
    } catch (e) { toast(e.message); }
  },
  async 'league-reload'(el) {
    $('#leagueMenu details')?.removeAttribute('open');
    if (el.disabled) return;
    el.disabled = true;
    const label = el.textContent;
    el.textContent = 'Reloading…';
    try {
      await refreshLeague();
      if (state.fxTeam && fxRoster(state.fxTeam).length) {
        const side = fxTeamSide(state.fxTeam);
        Object.assign(state, { players: side.players, il: side.il, lineup: side.lineup, teamName: side.name || state.teamName });
      }
      syncLinked();
      delete seasonTot[fxLeague().id];
      delete curAwards[fxLeague().id];
      if (gameLogs.cur) delete gameLogs.cur;
      commit(`Reloaded ${fxLeague().name} from ${sourceName()}`);
    } catch (e) {
      toast(`Couldn't reload from ${sourceName()} (${e.message})`);
      el.disabled = false; el.textContent = label;
    }
  },
  'league-add'() {
    $('#leagueMenu details')?.removeAttribute('open');
    ui.addingLeague = true;
    render();
  },
  async 'league-remove'(el) {
    const id = el.dataset.id;
    const l = (state.savedLeagues || []).find(x => x.id === id);
    if (!l || !(await askConfirm(`Remove ${l.name}?`, 'Removes it from your list on this device, along with your team and notes for it. You can add it again any time.', 'Remove'))) return;
    state.savedLeagues = state.savedLeagues.filter(x => x.id !== id);
    if (state.leagueStates) delete state.leagueStates[id];
    commit(`Removed ${l.name}`);
  },
  'set-basis'(el) {
    state.basis = el.dataset.basis;
    syncLinked();
    commit(`Using ${BASIS_LABELS[state.basis].toLowerCase()} stats`);
  },
  'board-mode'(el) {
    ui.boardMode = el.dataset.mode;
    try { localStorage.setItem(BOARD_KEY, ui.boardMode); } catch (e) { /* ignore */ }
    render();
  },
  'apply-best'() {
    if (!ui.bestIds) return;
    const chosen = state.players.filter(p => ui.bestIds.includes(p.id)).sort((a, b) => value(b) - value(a));
    state.lineup = fillSlots(chosen, state.slots);
    commit('Lineup updated for this week');
  },
  'week-shift'(el) {
    ui.weekShift = Math.max(-4, Math.min(4, ui.weekShift + +el.dataset.step));
    // a new week brings its real opponent: a hypothetical belongs to the week it was set up in
    if (viewingOther()) { ui.viewB = null; render(); return; }
    const opp = fxOpponentFor(weekStart());
    if (!opp) render();
    else if (opp.id !== state.opp.fxId) loadFxTeam(opp.id);
    else { state.opp.week = weekStart(); commit(); }
  },
  'player-detail'(el) { showPlayerDetail(+el.dataset.nba); },
  'close-detail'() { $('#detailDialog').close(); },
  'more-players'() { ui.pf.limit += 50; $('#playerResults').innerHTML = playerRows(); },
  async 'refresh-data'(el) {
    el.disabled = true;
    el.textContent = 'Refreshing…';
    let live = false;
    try { live = (await fetch('api/refresh', { method: 'POST' })).ok; } catch (e) { /* server not running */ }
    const ok = await loadNba(true);
    el.disabled = false;
    el.textContent = 'Refresh stats';
    toast(!ok ? "Couldn't load NBA data" : live ? 'Pulled the latest NBA stats' : "Couldn't reach the local data server");
  },
  'tot-sort'(el) {
    const k = el.dataset.key;
    const key = /^\d+$/.test(k) ? +k : k;
    nextSort(ui.totSort, key, key === 'team' ? -1 : 1);
    render();
  },
  sort(el) {
    const k = el.dataset.key;
    nextSort(ui.rosterSort, k, ['name', 'slot', 'status', 'tag', 'to'].includes(k) ? 1 : -1);
    render();
  },
  export() {
    const box = $('#backupText');
    box.value = JSON.stringify(state);
    $('#backupDialog').showModal();
    box.select();
  },
  async 'copy-backup'() {
    const box = $('#backupText');
    try { await navigator.clipboard.writeText(box.value); toast('Backup copied'); }
    catch (e) { box.select(); toast('Press Ctrl+C to copy the selected text'); }
  },
  'restore-backup'() {
    try {
      restoreFrom(JSON.parse($('#backupText').value));
      $('#backupDialog').close();
    } catch (e) { toast("That text isn't a Courtside backup"); }
  },
  'close-backup'() { $('#backupDialog').close(); },
  import() { $('#importFile').click(); },
  async 'start-fresh'() {
    $('#leagueMenu details')?.removeAttribute('open');
    if (!(await askConfirm('Reset and start over?', 'Removes your leagues, teams and matchup logs from this device. Copy a backup first if you want to keep anything.', 'Reset'))) return;
    state = emptyState();
    ui.tradeGive.clear(); ui.tradeGet.clear();
    ui.addingLeague = false; ui.viewA = null; ui.viewB = null;
    location.hash = '';
    await loadNba(true);
    commit();
  },
};

const forms = {
  async 'add-season'(f) {
    const id = f.sid.value.trim();
    const L = fxLeague();
    if (leagueSourceOf(id) !== 'fantrax' || !parseLeagueId(id)) return toast("That doesn't look like a Fantrax league ID. It's letters and numbers only.");
    if (id === L.id) return toast("That's this season's league.");
    const btn = f.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Adding…';
    try {
      const P = await loadSeason(id);
      if ((L.historyId && P.league.historyId !== L.historyId) || (L.year && P.league.year && P.league.year >= L.year)) {
        delete pastCache[id];
        throw new Error(`that league isn't an earlier season of ${L.name}`);
      }
      const key = L.historyId || L.id;
      state.pastSeasons = state.pastSeasons || {};
      const list = state.pastSeasons[key] = state.pastSeasons[key] || [];
      if (!list.some(x => x.id === id)) list.push({ id, year: P.league.year });
      save();
      await switchSeason(id);
      toast(`Added the ${P.label} season`);
    } catch (e) {
      toast(`Couldn't add that season: ${e.message}`);
      btn.disabled = false; btn.textContent = 'Add';
    }
  },
  async 'land-league'(f) {
    const id = f.leagueId.value.trim();
    const msg = $('#landMsg');
    const btn = f.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Connecting…'; msg.textContent = '';
    try {
      await switchLeague(id);
      ui.addingLeague = false;
      commit();
    } catch (e) {
      msg.textContent = e.message;
      btn.disabled = false; btn.textContent = 'Connect league';
    }
  },

};

/* =========================================================
   Wiring
   ========================================================= */
// phones: the sections menu opens under the top bar and closes on any choice or outside tap
function setNav(open) {
  document.body.classList.toggle('nav-open', open);
  $('.nav-btn').setAttribute('aria-expanded', open);
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('nav-open')) setNav(false); });

document.addEventListener('click', e => {
  if (document.body.classList.contains('nav-open') && !e.target.closest('.nav-btn') && (!e.target.closest('#tabs') || e.target.closest('#tabs a'))) setNav(false);
  const menu = $('#leagueMenu details');
  if (menu && menu.open && !e.target.closest('#leagueMenu')) menu.removeAttribute('open');
  const gear = $('#gearMenu details');
  if (gear && gear.open && !e.target.closest('#gearMenu') && !e.target.closest('#infoDialog')) gear.removeAttribute('open');
  const el = e.target.closest('[data-action]');
  if (!el || !actions[el.dataset.action]) return;
  e.preventDefault();
  actions[el.dataset.action](el, e);
});

document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.change === 'fx-view') {
    ui.viewA = el.value && el.value !== state.fxTeam ? el.value : null;
    ui.viewB = null;
    if (ui.viewA && !VIEW_TABS.includes(ui.tab)) location.hash = '#dashboard';
    else render();
  } else if (el.dataset.change === 'fx-opp') {
    if (!el.value) return;
    if (viewingOther()) { ui.viewB = el.value; render(); } else loadFxTeam(el.value);
  } else if (el.dataset.change === 'season') {
    if (el.value === 'add') { ui.addingSeason = true; render(); $('.ctx-add input')?.focus(); return; }
    switchSeason(el.value);
  } else if (el.dataset.change === 'past-team') {
    ui.pastTeam = el.value || null;
    if (ui.tab !== 'rosters') location.hash = '#rosters'; else render();
  } else if (el.dataset.change === 'fx-team') {
    if (!el.value) return;
    adoptTeam(el.value);
    state.demo = false;
    commit(`Welcome, ${state.teamName}`);
  } else if (el.dataset.change === 'pf') {
    ui.pf[el.dataset.key] = el.value;
    ui.pf.limit = 50;
    $('#playerResults').innerHTML = playerRows();
  } else if (el.dataset.change === 'trade-team') {
    ui.tradeTeam = el.value;
    ui.tradeGet.clear();
    render();
  } else if (el.dataset.change === 'trade') {
    const set = el.dataset.side === 'give' ? ui.tradeGive : ui.tradeGet;
    if (el.checked) set.add(el.value); else set.delete(el.value);
    render();
  }
});

document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.input === 'pf') {
    ui.pf[el.dataset.key] = el.value;
    ui.pf.limit = 50;
    $('#playerResults').innerHTML = playerRows();
  }
});

document.addEventListener('submit', e => {
  const f = e.target;
  if (f.dataset.form && forms[f.dataset.form]) {
    e.preventDefault();
    forms[f.dataset.form](f);
  }
});

$('#importFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    restoreFrom(JSON.parse(await file.text()));
  } catch (err) {
    toast("That file doesn't look like a Courtside backup");
  }
});

function route() {
  const [hashTab, sid] = location.hash.replace('#', '').split('/');
  // a past season in the address (after a refresh, or a shared link): load it, once the NBA data it needs is in
  if (sid && sid !== ui.season) {
    if (!NBA) { ui.pendingSeason = sid; render(); return; }
    ui.pendingSeason = null;
    switchSeason(sid, hashTab);
    return;
  }
  if (!sid && ui.season) { ui.season = null; ui.pastTeam = null; }
  let tab = hashTab || 'dashboard';
  if (tab === 'lineup') tab = 'roster'; // the old Lineup tab now lives on Roster
  if (tab === 'rosters' && !ui.season) tab = 'roster';
  ui.tab = tabList().some(([k]) => k === tab) ? tab : ui.season ? 'standings' : 'dashboard';
  if (!VIEW_TABS.includes(ui.tab)) { ui.viewA = null; ui.viewB = null; }
  render();
  window.scrollTo(0, 0);
  // on phones the tab bar scrolls sideways; keep the current tab visible
  const active = document.querySelector('#tabs a.active');
  if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
window.addEventListener('hashchange', route);

(function init() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t) document.documentElement.dataset.theme = t;
  } catch (e) { /* ignore */ }
  state = load();
  validateLineup();
  route();
  nbaLoading = loadNba();
  loadImages();
})();
