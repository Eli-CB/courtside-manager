// League Layer: Button actions, event wiring and start-up.
// The site loads js/*.js in order (see index.html); they share one scope, like one file.
'use strict';

/* =========================================================
   Actions
   ========================================================= */
// Show another week on Matchups (one of weekShifts)
function goWeek(shift) {
  const shifts = weekShifts();
  ui.weekShift = Math.max(shifts[0], Math.min(shifts[shifts.length - 1], shift));
  // a new week brings its real opponent: a hypothetical belongs to the week it was set up in
  if (viewingOther()) { ui.viewB = null; render(); return; }
  const opp = fxOpponentFor(weekStart());
  if (!opp) render();
  else if (opp.id !== state.opp.fxId) loadFxTeam(opp.id);
  else { state.opp.week = weekStart(); commit(); }
}

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
  'toggle-scores'() {
    ui.hideScores = !ui.hideScores;
    try { localStorage.setItem(SCORES_KEY, ui.hideScores ? '1' : '0'); } catch (e) { /* ignore */ }
    render();
  },
  'toggle-clock'() {
    ui.clock24 = !ui.clock24;
    try { localStorage.setItem(CLOCK_KEY, ui.clock24 ? '24' : '12'); } catch (e) { /* ignore */ }
    render();
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
    $('#infoBody').innerHTML = typeof item[1] === 'function' ? item[1]() : item[1]; // some are written from live numbers
    const d = $('#infoDialog');
    if (!d.open) d.showModal();
  },
  'go-week'() { location.hash = '#week'; },
  'go-recap'() { ui.recapWeek = null; location.hash = '#recap'; },
  // the previous or next finished week's recap
  'recap-step'(el) {
    const done = finishedPeriods(fxLeague()).map(p => p.n);
    const at = done.indexOf(ui.recapWeek != null && done.includes(ui.recapWeek) ? ui.recapWeek : done[done.length - 1]);
    const n = done[at + +el.dataset.step];
    if (n != null) { ui.recapWeek = n; render(); }
  },
  // on phones the share sheet (the league chat is one tap away); elsewhere the text and link, copied
  async 'recap-share'(el) {
    const L = fxLeague(), X = L && recaps.get(`${L.id}|${+el.dataset.week}`);
    if (!X) return;
    const text = recapText(L, X), url = recapUrl(L, X.period.n);
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      try { await navigator.share({ title: `${L.name} · Week ${X.period.n} standouts`, text, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(`${text}\n\nFull recap: ${url}`); toast('Recap copied: paste it in your league chat'); } catch (e) { toast("Couldn't copy the recap"); }
  },
  'cs-toggle'(el) {
    const open = !ui.csOpen.delete(el.dataset.cat);
    if (open) ui.csOpen.add(el.dataset.cat);
    el.setAttribute('aria-expanded', open);
    el.nextElementSibling.hidden = !open;
  },
  'close-info'() { $('#infoDialog').close(); },
  'yahoo-signin'() { yahooSignIn(); },
  'yahoo-signout'() { yahooSignOut(); render(); },
  async 'yahoo-pick'(el) {
    el.disabled = true;
    try { await connectLeague(el.dataset.id); } catch (e) { toast(e.message); el.disabled = false; }
  },
  // an award's breakdown for one team, in the popup the (i) buttons use
  'award-team'(el) {
    const D = awardDetails.get(el.dataset.key);
    if (!D) return;
    $('#infoTitle').textContent = D.title;
    $('#infoBody').innerHTML = D.html;
    const d = $('#infoDialog');
    if (!d.open) d.showModal();
  },
  // one team's keepers and picks from the Draft tab's Team drafts
  'draft-team'(el) {
    const D = draftTeamCards.get(el.dataset.team);
    if (!D) return;
    $('#infoTitle').textContent = D.title;
    $('#infoBody').innerHTML = D.html;
    const d = $('#infoDialog');
    if (!d.open) d.showModal();
  },
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
    const go = ui.afterPick || '#week'; // a shared link: where it pointed
    ui.afterPick = null;
    if (location.hash === go) route(); else location.hash = go;
  },
  'season-pick'(el) {
    $('#leagueMenu details')?.removeAttribute('open');
    switchSeason(el.dataset.id || null);
  },
  'season-add'() {
    $('#leagueMenu details')?.removeAttribute('open');
    ui.addingLeague = 'season';
    render();
  },
  'land-back'() { state.leagueChosen = false; ui.addingLeague = true; ui.afterPick = null; commit(); },
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
      // (one saved before past seasons had their own place may turn out to be one)
      const wait = await connectLeague(id);
      if (wait) toast(`That's the ${wait.label} season of ${wait.name}. Add this season's league and ${wait.label} will be under it.`);
      else if (!ui.season) toast(`Switched to ${fxLeague().name}`);
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
  // the next or previous week in the picker (a two-week matchup is one step)
  'week-shift'(el) {
    const s = weekShifts(), next = +el.dataset.step > 0 ? s.find(x => x > ui.weekShift) : s.filter(x => x < ui.weekShift).pop();
    if (next != null) goWeek(next);
  },
  'player-detail'(el) { showPlayerDetail(+el.dataset.nba); },

  'close-detail'() { $('#detailDialog').close(); },
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
  'dash-range'(el) {
    ui.dashRange = el.dataset.range;
    render();
  },
  'dash-bench'() {
    ui.dashBench = !ui.dashBench;
    render();
  },
  'perf-range'(el) {
    ui.perfRange = el.dataset.range;
    render();
  },
  'perf-only'(el) {
    ui.perfOnly[el.dataset.key] = !ui.perfOnly[el.dataset.key];
    render();
  },
  'perf-show'(el) {
    ui.perfShow[el.dataset.group] = !ui.perfShow[el.dataset.group];
    render();
  },
  'perf-sort'(el) {
    nextSort(ui.perfSort, el.dataset.key, el.dataset.key === 'name' ? 1 : -1);
    render();
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
    } catch (e) { toast("That text isn't a League Layer backup"); }
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
  // a league, or an earlier season of one (which goes under its league)
  async 'land-league'(f) {
    const id = f.leagueId.value.trim();
    const msg = $('#landMsg');
    const btn = f.querySelector('button[type=submit]'), label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Connecting…'; msg.textContent = '';
    try {
      const wait = await connectLeague(id);
      if (!wait) return;
      msg.className = 'form-note';
      msg.textContent = `That's the ${wait.label} season of ${wait.name}. Enter this season's league ID and ${wait.label} will be under it.`;
      f.leagueId.value = '';
    } catch (e) {
      msg.className = 'form-error';
      msg.textContent = e.message;
    }
    btn.disabled = false; btn.textContent = label;
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
  } else if (el.dataset.change === 'recap-week') {
    ui.recapWeek = +el.value;
    render();
  } else if (el.dataset.change === 'week-pick') {
    goWeek(+el.value);
  } else if (el.dataset.change === 'fx-opp') {
    if (!el.value) return;
    if (viewingOther()) { ui.viewB = el.value; render(); } else loadFxTeam(el.value);
  } else if (el.dataset.change === 'past-team') {
    ui.pastTeam = el.value || null;
    if (ui.tab !== 'rosters') location.hash = '#rosters'; else render();
  } else if (el.dataset.change === 'fx-team') {
    if (!el.value) return;
    adoptTeam(el.value);
    state.demo = false;
    commit(`Welcome, ${state.teamName}`);
  } else if (el.dataset.change === 'perf-pos') {
    ui.perfPos = el.value;
    render();
  } else if (el.dataset.change === 'perf-team') {
    ui.perfTeam = el.value;
    render();
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
  if (el.dataset.input === 'perf-q') {
    // the whole tab redraws; the search box keeps focus and the caret
    ui.perfQ = el.value;
    const at = el.selectionStart;
    render();
    const box = $('#perfQ');
    if (box) { box.focus(); box.setSelectionRange(at, at); }
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
    toast("That file doesn't look like a League Layer backup");
  }
});

// A link someone shared (?league=<id>&week=<n>#recap): open that league, or connect it and ask for the team first
async function openSharedLink() {
  if (!location.search) return;
  const q = new URLSearchParams(location.search), id = q.get('league');
  if (!id) return;
  history.replaceState(null, '', location.pathname + location.hash);
  if (+q.get('week')) ui.recapWeek = +q.get('week');
  ui.afterPick = location.hash || '#recap';
  if (currentLeagueId() === id && state.fxTeam) { ui.afterPick = null; route(); return; }
  try {
    await switchLeague(id);
    ui.addingLeague = false;
    commit();
    if (state.fxTeam) { ui.afterPick = null; route(); }
  } catch (e) { ui.afterPick = null; toast(e.message); }
}

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
  if (tab === 'live') tab = 'dashboard'; // and the old Live tab on Performances (Today)
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
window.addEventListener('resize', fitPerfLists);

(function init() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t) document.documentElement.dataset.theme = t;
  } catch (e) { /* ignore */ }
  state = load();
  validateLineup();
  const back = yahooFromAddress(); // just signed in with Yahoo: show the leagues to pick from
  if (back === 'in') { yahoo.leagues = null; if (state.fxTeam) ui.addingLeague = true; } else if (back) setTimeout(() => toast(back), 500);
  route();
  nbaLoading = loadNba();
  loadImages();
  openSharedLink();
})();
