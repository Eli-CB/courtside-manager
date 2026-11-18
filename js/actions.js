// League Layer: Button actions, event wiring and start-up.
// The site loads js/*.js in order (see index.html); they share one scope, like one file.
'use strict';

/* =========================================================
   Actions
   ========================================================= */
// Show another week on Plan Ahead (one of weekShifts), kept for a refresh until this matchup week is over (planAheadWeek)
function goWeek(shift) {
  ui.weekChosen = true;
  const shifts = weekShifts();
  ui.weekShift = Math.max(shifts[0], Math.min(shifts[shifts.length - 1], shift));
  if (fxLeague()) { ui.weekAt = weekPickAt(); savePick('week', { v: ui.weekShift, at: ui.weekAt }); }
  // a new week brings its real opponent: a hypothetical belongs to the week it was set up in
  if (viewingOther()) { ui.viewB = null; render(); return; }
  const opp = fxOpponentFor(weekStart());
  if (!opp) render();
  else if (opp.id !== state.opp.fxId) loadFxTeam(opp.id);
  else { state.opp.week = weekStart(); commit(); }
}

// The Players tab's When pick and Totals / Per game, kept for a refresh until the day is over (core.js, picks)
const pickPerf = () => savePick('perf', { v: ui.perfRange, per: ui.perfPer, at: todayIso() });

// The league and the recap a button's week is for
const recapOn = el => { const L = fxLeague(); return { L, X: L && recaps.get(`${L.id}|${+el.dataset.week}`) }; };

const actions = {
  'nav-toggle'(el) { setNav(!document.body.classList.contains('nav-open')); },
  'clear-saved'() {
    for (const k of SAVED_LEAGUE_DATA) store.drop(k);
    fxShared = null; espnShared = null;
    changed('league'); // every league's weekly rosters are asked for again
    gearMenu();
    toast('Cleared saved league data');
  },
  'toggle-theme'() {
    const root = document.documentElement;
    const next = themeNow() === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    store.set(THEME_KEY, next);
    gearMenu();
  },
  'toggle-scores'() {
    ui.hideScores = !ui.hideScores;
    store.set(SCORES_KEY, ui.hideScores ? '1' : '0');
    render();
  },
  'toggle-clock'() {
    ui.clock24 = !ui.clock24;
    store.set(CLOCK_KEY, ui.clock24 ? '24' : '12');
    render();
  },
  'fx-load-opp'() {
    const opp = fxOpponentFor(weekStart());
    if (!opp) return toast(`No ${sourceName()} matchup found for this week`);
    loadFxTeam(opp.id);
  },
  'fx-view-mine'() { ui.viewA = null; ui.viewB = null; render(); },
  // the team menu's choice: a past season's roster, the demo's team to play as, your team (none picked yet), or a
  // team to look at, read only
  'team-pick'(el) {
    $('#teamMenu details')?.removeAttribute('open');
    const id = el.dataset.id;
    if (ui.season) {
      ui.pastTeam = id || null;
      if (ui.tab !== 'rosters') location.hash = seasonHash('rosters', ui.season); else render();
    } else if (state.demo) { // the demo's team is whichever is picked
      adoptTeam(id);
      commit(`Now playing as ${state.teamName}`);
    } else if (!state.fxTeam) {
      adoptTeam(id);
      commit(`Welcome, ${state.teamName}`);
    } else {
      ui.viewA = id !== state.fxTeam ? id : null;
      ui.viewB = null;
      if (ui.viewA && !VIEW_TABS.includes(ui.tab)) location.hash = '#dashboard';
      else render();
    }
  },
  'fx-view-actual'() { ui.viewB = null; render(); },
  'stat-sort'(el) {
    const key = el.dataset.key;
    if (key === 'slot') Object.assign(ui.statSort, { key, dir: 1 }); // lineup order has one direction
    else nextSort(ui.statSort, key, key === 'name' ? 1 : -1);
    render();
  },
  info(el) {
    const item = (SPORT.infoOver || {})[el.dataset.key] || INFO[el.dataset.key];
    if (!item) return;
    $('#infoTitle').textContent = item[0];
    // some are written from live numbers; they're worded for basketball, the league's sport named here
    let html = (typeof item[1] === 'function' ? item[1]() : item[1]).replace(/\bNBA\b/g, SPORT.name);
    if (isFootball()) html = html.replace(/<p><b>Sleeper leagues<\/b>[\s\S]*?<\/p>/g, ''); // (about one game among several, in basketball)
    $('#infoBody').innerHTML = html + ((SPORT.infoMore || {})[el.dataset.key] || '');
    const d = $('#infoDialog');
    if (!d.open) d.showModal();
  },
  // Install the app: the browser's own offer where it has one, else how to on an iPhone
  async 'install-app'() {
    $('#gearMenu details')?.removeAttribute('open');
    const offer = ui.installPrompt;
    if (offer) {
      ui.installPrompt = null;
      offer.prompt();
      await offer.userChoice.catch(() => null);
      render();
      return;
    }
    $('#infoTitle').textContent = 'Install League Layer';
    $('#infoBody').innerHTML = `<ol class="install-steps"><li>In Safari, tap the <b>Share</b> button.</li><li>Tap <b>Add to Home Screen</b>, then <b>Add</b>.</li><li>Open League Layer from your home screen.</li></ol>
      <p class="muted small">It opens full screen. Your iPhone keeps it apart from the browser, so you'll connect your league once more there.</p>`;
    const d = $('#infoDialog');
    if (!d.open) d.showModal();
  },
  'go-week'() { location.hash = '#week'; },
  // the Recap's Trends: heating up or cooling off
  'trend-dir'(el) { ui.trendDir = el.dataset.dir; render(); },
  // the previous or next finished week's recap
  'recap-step'(el) {
    const done = finishedPeriods(fxLeague()).map(p => p.n);
    const at = done.indexOf(ui.recapWeek != null && done.includes(ui.recapWeek) ? ui.recapWeek : done[done.length - 1]);
    const n = done[at + +el.dataset.step];
    if (n != null) { ui.recapWeek = n; render(); }
  },
  // the recap as a picture, in a popup: share it, copy it, save it, or send the text and link instead (shareWith, recap.js)
  async 'recap-share'(el) {
    const { L, X } = recapOn(el);
    if (X) await shareWith(el, recapShare(L, X));
  },
  // this season's Draft Retrospective, the same way
  async 'draft-share'(el) {
    const L = fxLeague(), d = draftData(), items = d && !d.loading ? draftAwards(d) : [];
    if (L && items.length) await shareWith(el, draftShare(L, d, items));
  },
  // the Trades tab's deal (or the one a league mate's link brought), the same way: the picture opens on both sides
  async 'trade-share'(el) {
    if (state.browse) { const S = sbTradeShare(); if (S) await shareWith(el, S); return; } // the sandbox's (sandbox.js)
    const L = fxLeague(), T = tradeDeal();
    if (L && T) await shareWith(el, tradeShare(L, T));
  },
  'trade-seen-close'() { ui.tradeSeen = null; render(); },
  // the league's draft picks didn't come: ask once more (leaguePicks, fantrax.js)
  'trade-picks-retry'() { const L = fxLeague(); if (L) { delete L.futurePicks; render(); } },
  // the popup's buttons: the picture to the share sheet, copied, or the text and link
  async 'share-img'() {
    const S = ui.share;
    if (!S || !S.blob) return;
    const data = { files: [new File([S.blob], S.file, { type: 'image/png' })], title: S.name, text: `${S.link}: ${S.url}` };
    if (!navigator.canShare(data)) { toast("This browser can't share images: use Copy or Save"); return; }
    try { await navigator.share(data); } catch (e) { if (e.name !== 'AbortError') toast("Couldn't share the image: use Copy or Save"); }
  },
  async 'share-copy'() {
    const S = ui.share;
    if (!S || !S.blob) return;
    try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': S.blob })]); toast('Image copied: paste it in your league chat'); } catch (e) { toast("Couldn't copy the image: use Save instead"); }
  },
  async 'share-text'() { if (ui.share) await shareText(ui.share); },
  'cs-toggle'(el) {
    const open = !ui.csOpen.delete(el.dataset.cat);
    if (open) ui.csOpen.add(el.dataset.cat);
    el.setAttribute('aria-expanded', open);
    el.nextElementSibling.hidden = !open;
  },
  'close-info'() { $('#infoDialog').close(); },
  'waiver-order'() {
    $('#infoTitle').textContent = 'Waiver order';
    $('#infoBody').innerHTML = waiverPopup();
    const d = $('#infoDialog');
    if (!d.open) d.showModal();
  },
  // Send feedback: Gmail, the email app, or copy it (in the popup the (i) buttons use)
  feedback() {
    $('#gearMenu details').removeAttribute('open');
    $('#infoTitle').textContent = 'Send feedback';
    $('#infoBody').innerHTML = feedbackPopup();
    const d = $('#infoDialog');
    if (!d.open) d.showModal();
  },
  async 'feedback-copy'() {
    try { await navigator.clipboard.writeText(`To: ${FEEDBACK_EMAIL}\nSubject: ${FEEDBACK_SUBJECT}\n\n${feedbackBody()}`); toast(`Copied: paste it into an email to ${FEEDBACK_EMAIL}`); } catch (e) { toast(`Couldn't copy. The address is ${FEEDBACK_EMAIL}`); }
  },
  // the league's ID, to send to a friend in the league: pasted into the league form, it connects the same league
  async 'copy-league-id'() {
    const id = fxLeague().id;
    try { await navigator.clipboard.writeText(id); toast('League ID copied: a friend connects the league with it'); } catch (e) { toast(`Couldn't copy. The league ID is ${id}`); }
  },
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
  // the draft didn't load with the league: load the league (or the past season) again
  async 'draft-retry'(el) {
    el.disabled = true;
    try {
      if (ui.season) { delete pastCache[ui.season]; await loadSeason(ui.season); } else await refreshLeague(true);
    } catch (e) { toast(`Couldn't reach ${sourceName()} (${e.message})`); }
    render();
  },
  // a draft award's breakdown, from its title on the Draft tab
  'draft-award'(el) {
    const D = draftAwardDetails.get(el.dataset.key);
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
    store.set(DRAFT_MODE_KEY, ui.draftMode);
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
  // the sandbox: no league, a team of your own (sandbox.js), valued for a standard 9-category league. From the landing
  // page or the league menu (a league stays underneath, to go back to; the demo's borrowed team doesn't)
  'land-browse'() {
    $('#leagueMenu details')?.removeAttribute('open');
    // the league to go back to, named before another sport's data comes in (that sport's data doesn't know it); the demo's
    // borrowed team isn't kept
    const L = !state.browse && !state.demo && state.fxTeam ? fxLeague() : null;
    if (!state.browse) state.sandbox.back = L ? { id: currentLeagueId(), name: L.name } : null;
    const go = () => {
      if (state.demo) Object.assign(state, { fxTeam: null, players: [], il: [], lineup: [], opp: emptyOpp(), leagueChosen: false });
      state.browse = true; state.demo = false; ui.addingLeague = false; ui.viewA = null; ui.viewB = null;
      clearLeaguePlayers();
      commit();
      if (location.hash === '#team') route(); else location.hash = '#team'; // (already there, coming back: no hash change to route it)
    };
    const sport = state.sandbox.sport; // (the sport it was last on: basketball the first time)
    if (SPORT.key === sport) go(); else useSport(sport).then(go).catch(() => toast(`Couldn't load ${SPORTS[sport].name} data`));
  },
  // out of the sandbox: back to your league, read again (its players' league positions too), else the landing page. Its
  // team, lineup and the rest are kept under it first, so they come back whichever sport the sandbox was on. (A sandbox
  // entered before the league was named: your own league's ID, else the site's own league, which basketball's data names)
  async 'browse-exit'() {
    const B = state.sandbox.back;
    let back = state.fxTeam ? (B && B.id) || state.fxLeagueId : null;
    if (state.fxTeam && !back) back = ((await fetchSport('nba').catch(() => null)) || {}).siteLeague?.id || null;
    state.browse = false; state.leagueChosen = false; state.sandbox.back = null;
    if (back) {
      stashLeague(back);
      try { await switchLeague(back); } catch (e) { toast(e.message); }
      location.hash = '#dashboard';
    }
    commit();
  },
  // the sandbox's lists (sandbox.js): My team and the Live tab, from a search, a player's card or a ✕
  'sb-add'(el) { ui.sbQ.team = ''; sbToggle('roster', +el.dataset.id, true); },
  'sb-drop'(el) { sbToggle('roster', +el.dataset.id, false); },
  'sb-watch'(el) { ui.sbQ.watch = ''; sbToggle('watch', +el.dataset.id, true); },
  'sb-unwatch'(el) { sbToggle('watch', +el.dataset.id, false); },
  // the Live tab: My team's players not followed yet, best first, as many as there's room for
  'sb-watch-team'() {
    const add = sortDesc(sbRoster().filter(p => !sbWatching(p.nbaId)), sbWorth).slice(0, WATCH_MAX - sbState().watch.length).map(p => p.nbaId);
    if (!add.length) return;
    sbState().watch = [...sbState().watch, ...add];
    commit(`Following ${add.length} of your players`);
  },
  async 'sb-clear'() {
    if (!(await askConfirm('Start My team over?', 'Takes every player off My team on this device. The players you follow on Live stay.', 'Start over'))) return;
    sbState().roster = []; ui.sbGive.clear();
    commit('My team is empty');
  },
  // a trade's incoming player, found by name
  'sb-get'(el) {
    const id = +el.dataset.id;
    if (!ui.sbGet.includes(id) && !sbOwns(id) && ui.sbGet.length < SB_GET_MAX) ui.sbGet = [...ui.sbGet, id];
    ui.sbQ.get = '';
    render();
  },
  'watch-range'(el) { ui.watchRange = el.dataset.range; render(); },
  // the box scores didn't load (boxWait, views.js): ask again
  'box-retry'() { boxFail = ''; render(); },
  // the sandbox's own points (sandbox.js): edit them, or fill the form with a site's standard
  'sb-points'() { sbCloseMenus(); sbPointsOpen(); },
  // the sandbox's sport and scoring menus in the head (sbMenus)
  'sb-sport-pick'(el) { sbCloseMenus(); sbSetSport(el.dataset.sport); },
  'sb-scoring-pick'(el) { sbCloseMenus(); sbSetScoring(el.dataset.k); },
  'sb-points-from'(el) {
    const P = (SB_POINTS[SPORT.key] || {})[el.dataset.preset], f = el.closest('form');
    if (P && f) for (const box of f.querySelectorAll('input[name]')) box.value = P[box.name] != null ? P[box.name] : '';
  },
  async 'land-demo'() {
    const site = NBA && NBA.siteLeague;
    if (!site) return;
    try {
      await switchLeague(site.id);
      ui.addingLeague = false;
      if (!state.fxTeam) { state.demo = true; demoNames(fxLeague()); adoptTeam(demoTeam()); }
      commit(`Exploring ${fxLeague().name}`);
      location.hash = '#dashboard';
    } catch (e) { toast(e.message); }
  },
  // out of the demo, to connect a league of their own
  'demo-exit'() {
    Object.assign(state, { demo: false, leagueChosen: false, fxTeam: null, players: [], il: [], lineup: [], opp: emptyOpp() });
    ui.viewA = null; ui.viewB = null;
    location.hash = '';
    commit();
  },
  async 'league-switch'(el) {
    const id = el.dataset.id;
    $('#leagueMenu details')?.removeAttribute('open');
    if (id === currentLeagueId() && state.fxTeam && !state.browse) return;
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
    const wait = reloadWait();
    if (wait > 0) { toast(`Just read from ${sourceName()}: reload again in ${Math.ceil(wait / 1000)} s`); return; }
    el.disabled = true;
    const label = el.textContent;
    el.textContent = 'Reloading…';
    try {
      await reloadLeague();
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
    store.set(BOARD_KEY, ui.boardMode);
    render();
  },
  // the next or previous week in the picker (a two-week matchup is one step)
  'week-shift'(el) {
    const s = weekShifts(), next = +el.dataset.step > 0 ? s.find(x => x > ui.weekShift) : s.filter(x => x < ui.weekShift).pop();
    if (next != null) goWeek(next);
  },
  'player-detail'(el) { showPlayerDetail(+el.dataset.nba); },

  'close-detail'() { $('#detailDialog').close(); },
  'team-card'(el) { showTeamCard(el.dataset.team); },
  // a team from its card as Plan Ahead's opponent: the week Plan Ahead opens on, this team in place of the real one
  'team-compare'(el) {
    $('#detailDialog').close();
    if (!ui.weekChosen) Object.assign(ui, { weekShift: planAheadShift(), weekChosen: true, weekAt: weekPickAt() });
    location.hash = '#week';
    loadFxTeam(el.dataset.team);
  },
  async 'refresh-data'(el) {
    el.disabled = true;
    el.textContent = 'Refreshing…';
    let live = false;
    try { live = (await fetch('api/refresh', { method: 'POST' })).ok; } catch (e) { /* server not running */ }
    const ok = await loadNba(true);
    el.disabled = false;
    el.textContent = 'Refresh stats';
    toast(!ok ? `Couldn't load ${SPORT.name} data` : live ? `Pulled the latest ${SPORT.name} stats` : "Couldn't reach the local data server");
  },
  'dash-range'(el) {
    ui.dashRange = el.dataset.range;
    savePick('dash', { v: ui.dashRange, at: todayIso() });
    render();
  },
  'dash-bench'() {
    ui.dashBench = !ui.dashBench;
    render();
  },
  'dash-full'() { dashFull(!ui.dashFull); },
  'perf-per'(el) {
    ui.perfPer = el.dataset.per === '1';
    if (ui.perfRange === 'avg') ui.perfRange = 'year';
    pickPerf();
    render();
  },
  'perf-only'(el) {
    ui.perfOnly[el.dataset.key] = !ui.perfOnly[el.dataset.key];
    render();
  },
  'perf-more'() { ui.perfMore.n += 100; render(); },
  'perf-filt'() { ui.perfFiltOpen = !ui.perfFiltOpen; ui.perfMenu = null; render(); },
  // the position and team menus: one open at a time, each choice on or off (no value: all of them again)
  'perf-menu'(el) { ui.perfMenu = ui.perfMenu === el.dataset.menu ? null : el.dataset.menu; render(); },
  'perf-pick'(el) {
    const k = el.dataset.menu, v = el.dataset.val;
    ui[k] = !v ? [] : ui[k].includes(v) ? ui[k].filter(x => x !== v) : [...ui[k], v];
    render();
  },
  // the Other teams menu: a team in or out (the last one out = all of them again), all of them, or none (never when
  // nothing else is shown)
  'perf-other'(el) {
    const v = el.dataset.val, w = ui.perfWhose;
    if (v === 'none') { if (!['me', 'opp', 'fa'].some(k => w[k])) return; ui.perfWhose = { ...w, other: false }; ui.perfOthers = []; }
    else {
      const now = w.other ? perfOtherTeams().picked : [];
      ui.perfOthers = v === 'all' ? [] : now.includes(v) ? now.filter(x => x !== v) : [...now, v];
      ui.perfWhose = { ...w, other: true };
    }
    render();
  },
  // whose players: any of them, but never none
  'perf-whose'(el) {
    const k = el.dataset.key, next = { ...ui.perfWhose, [k]: !ui.perfWhose[k] };
    if (!perfWhoseKeys().some(x => next[x])) return;
    ui.perfWhose = next;
    render();
  },
  // a team's code anywhere: its card (schedule, players by value), in the popup, without leaving the page
  'sport-team'(el) { showSportTeamCard(el.dataset.team); },
  // the foot of that card: the Players tab showing that team's players over the season (a day could have no game of
  // theirs; football keeps its projections), every other filter off and the panel open to say so
  'team-players'(el) {
    const d = $('#detailDialog');
    if (d && d.open) d.close();
    Object.assign(ui, { perfWhose: { ...PERF_WHOSE }, perfOthers: [], perfSpot: 'all', perfPos: [], perfTeam: [el.dataset.team], perfMenu: null, perfQ: '', perfFiltOpen: true });
    if (!isFootball()) { Object.assign(ui, { perfRange: 'year', perfMore: { sig: '', n: 0 } }); pickPerf(); }
    Object.assign(ui.perfOnly, { rookie: false, inj: false });
    if (location.hash === '#players') render(); else location.hash = '#players';
    window.scrollTo(0, 0);
  },
  'perf-clear'() {
    Object.assign(ui, { perfWhose: { ...PERF_WHOSE }, perfOthers: [], perfSpot: 'all', perfPos: [], perfTeam: [], perfMenu: null });
    Object.assign(ui.perfOnly, { rookie: false, inj: false });
    render();
  },
  'perf-spot'(el) {
    ui.perfSpot = el.dataset.spot;
    render();
  },
  // the player card's Games: by a column (again: the other way), the popup kept where it was scrolled
  'card-sort'(el) {
    if (cardOpen == null) return;
    const body = $('#detailBody'), wrap = () => (body.querySelector ? body.querySelector('.pc-games-wrap') : null);
    const top = body.scrollTop, inner = (wrap() || {}).scrollTop || 0;
    nextSort(ui.cardSort, el.dataset.key, -1);
    showPlayerDetail(cardOpen);
    body.scrollTop = top;
    if (wrap()) wrap().scrollTop = inner;
  },
  // a fantasy team's card: its players by a column (again: the other way), the popup kept where it was scrolled
  'team-sort'(el) {
    if (teamCardOpen == null) return;
    const body = $('#detailBody'), wrap = () => (body.querySelector ? body.querySelector('.perf-wrap') : null);
    const top = body.scrollTop, left = (wrap() || {}).scrollLeft || 0;
    const k = el.dataset.key;
    nextSort(ui.teamSort, /^[0-9]+$/.test(k) ? +k : k, k === 'name' ? 1 : -1);
    showTeamCard(teamCardOpen, true);
    body.scrollTop = top;
    if (wrap()) wrap().scrollLeft = left;
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
    $('#gearMenu details')?.removeAttribute('open');
    if (!(await askConfirm('Reset and start over?', 'Removes your leagues, teams and matchup logs from this device. Copy a backup first if you want to keep anything.', 'Reset'))) return;
    await useSport('nba');
    state = emptyState();
    ui.tradeGive.clear(); ui.tradeGet.clear(); ui.tradeGivePicks.clear(); ui.tradeGetPicks.clear(); ui.sbGive.clear(); ui.sbGet = [];
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
    btn.disabled = true; btn.textContent = 'Connecting…';
    msg.className = 'form-note'; msg.innerHTML = `${loaderMark('sm')}Reading your league…`;
    try {
      const wait = await connectLeague(id);
      if (!wait) { msg.textContent = ''; return; }
      msg.className = 'form-note';
      msg.textContent = `That's the ${wait.label} season of ${wait.name}. Enter this season's league ID and ${wait.label} will be under it.`;
      f.leagueId.value = '';
    } catch (e) {
      msg.className = 'form-error';
      msg.textContent = e.message;
    }
    btn.disabled = false; btn.textContent = label;
  },
  // the sandbox's searches (sandbox.js): Enter takes the first match, and the box stays ready for the next name
  // the sandbox's own points: each stat's (blank or 0 isn't scored), then scored by them
  'sb-points'(f) {
    const pts = {};
    for (const box of f.querySelectorAll('input[name]')) { const v = parseFloat(box.value); if (Number.isFinite(v) && v) pts[box.name] = v; }
    if (!Object.keys(pts).length) { toast('Give at least one stat some points'); return; }
    Object.assign(sbState(), { points: pts, scoring: 'custom' });
    $('#infoDialog').close();
    sbRescore('Scoring: your own points');
  },
  'sb-find'(f) {
    const key = f.dataset.key, S = SB_SEARCH[key], hit = $('.sb-hits [data-action]', f.parentNode);
    if (!S || !hit) return;
    actions[S.action](hit);
    ui.sbQ[key] = '';
    render();
    $(`#sbQ-${key}`)?.focus();
  },

};

/* =========================================================
   Wiring
   ========================================================= */
// phones: the bottom bar's More opens the rest of the sections above it, and closes on any choice or outside tap
function setNav(open) {
  document.body.classList.toggle('nav-open', open);
  $('.tab-more')?.setAttribute('aria-expanded', open);
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('nav-open')) setNav(false); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && ui.perfMenu) { ui.perfMenu = null; render(); } });

// The browser's offer to install, kept for the settings menu's Install the app
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); ui.installPrompt = e; if (state) render(); });
window.addEventListener('appinstalled', () => { ui.installPrompt = null; if (state) render(); });
// An installed app has no refresh button and can sit open for days: coming back to it after a few hours, it loads again
// for the day's stats and any new version. A browser tab is left alone.
const OPENED_AT = Date.now(), APP_STALE = 3 * 36e5;
const appStale = () => isInstalled() && Date.now() - OPENED_AT > APP_STALE;
document.addEventListener('visibilitychange', () => { if (!document.hidden && appStale()) location.reload(); else if (!document.hidden) checkAutoReload(); });
// a player card's big photo that won't load: its small round one instead (errors don't bubble, so this listens on the way down)
document.addEventListener('error', e => { const t = e.target; if (t && t.classList && t.classList.contains('pc-shot')) t.parentNode.classList.add('no-shot'); }, true);

// ----- The league read again as a matchup period starts -----
// The league is kept on the device (6 hours, or until ↻ Reload) and a page can sit open for days, so across a lock last
// week's period and lineups would stay on screen. It's read again from its site 10 to 20 minutes before a period's first
// game (the lineups as finally set, next week's too on Plan Ahead) and 2 to 6 minutes after it (the new period and its
// locked lineups), when what's here was read before that moment: twice a period at most on a device, quietly, on a visit
// or while the page is open. Not in a past season, the demo, browsing, or before a team is picked. Each page draws its
// own moment in each window (spread), so a site's worth of visitors doesn't reach the league's site in the same minute,
// its busiest (lineups locking): the same requests, the peak about ten times lower (the owner's ask, Nov 2026).
const AUTO_BEFORE = [20 * 60e3, 10 * 60e3], AUTO_AFTER = [2 * 60e3, 6 * 60e3]; // (from, to, around the first game)
const autoReload = { timer: null, busy: false, done: new Set(), spread: [Math.random(), Math.random()] };
// ↻ Reload once in a while: lineups don't change faster, and each is several requests to the league's site; within
// RELOAD_COOL of the league's last read (by hand, automatic, or on connecting) the menu says so and nothing is asked
const RELOAD_COOL = 2 * 60e3;
const reloadWait = () => { const L = fxLeague(); return L ? RELOAD_COOL - (Date.now() - leagueReadAt(L.id)) : 0; };

// Reload the league from its site and everything read from it (↻ Reload, and the automatic one)
async function reloadLeague() {
  await refreshLeague();
  if (state.fxTeam && fxRoster(state.fxTeam).length) {
    const side = fxTeamSide(state.fxTeam);
    Object.assign(state, { players: side.players, il: side.il, lineup: side.lineup, teamName: side.name || state.teamName });
  }
  syncLinked();
  changed('league', fxLeague().id);
}

// 7 PM in New York that day (the data file has no tip-off times)
function etEvening(d) {
  const hour = t => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(t);
  return ['-05:00', '-04:00'].map(o => Date.parse(`${d}T19:00:00${o}`)).find(t => hour(t) === '19') || Date.parse(`${d}T19:00:00-05:00`);
}
// When a period's first game starts: Fantrax starts a period at its first tip-off (its lock); ESPN's scoreboard says
// once that day's is here; else 7 PM ET on the period's first game day
function periodFirstGame(p) {
  const day = matchDates(String(p.start).slice(0, 10)).find(d => [...teamDates.values()].some(ds => ds.has(d)));
  if (!day) return null;
  const lock = /T\d/.test(String(p.lock || '')) && fxTime(p.lock);
  const times = [...live.games.filter(g => g.d === day).map(g => +g.start), ...(lock ? [+lock] : [])].filter(Number.isFinite);
  return times.length ? Math.min(...times) : etEvening(day);
}
// The moments to read the league again, for the periods starting from two days ago to a week ahead
function autoReloadMarks(L = fxLeague()) {
  if (!L || !L.periods) return [];
  const today = todayIso(), from = addDays(today, -2), to = addDays(today, 8);
  return L.periods.filter(p => { const s = String(p.start).slice(0, 10); return s >= from && s <= to; })
    .flatMap(p => {
      const t = periodFirstGame(p), [b, a] = autoReload.spread;
      return t == null ? [] : [Math.round(t - AUTO_BEFORE[0] + b * (AUTO_BEFORE[0] - AUTO_BEFORE[1])), Math.round(t + AUTO_AFTER[0] + a * (AUTO_AFTER[1] - AUTO_AFTER[0]))];
    }).sort((a, b) => a - b);
}
// When the league here was read from its site (the site's own league: this morning's file, or a reload since)
function leagueReadAt(id) {
  const c = readLeagueCache()[id], site = NBA && NBA.siteLeague && NBA.siteLeague.id === id;
  return Math.max(c ? c.at : 0, site ? Date.parse(NBA.updated || 0) || 0 : 0);
}
// The moment passed since the league was read, if any
function autoReloadDue(now = Date.now()) {
  const L = fxLeague();
  if (!L || !state.fxTeam || state.demo || state.browse || ui.season) return null;
  const at = leagueReadAt(L.id);
  return autoReloadMarks(L).filter(m => m <= now && at < m && !autoReload.done.has(m)).pop() ?? null;
}
async function checkAutoReload() {
  if (!state || !NBA || document.hidden || autoReload.busy || autoReloadDue() == null) return;
  autoReload.busy = true;
  autoReloadMarks().filter(x => x <= Date.now()).forEach(x => autoReload.done.add(x)); // once each, even if it fails
  try { await reloadLeague(); commit(); } catch (e) { /* quietly: ↻ Reload is still in the menu */ } finally { autoReload.busy = false; }
}
// looked at once a minute while the page is open (a cheap sum), and on coming back to it
(function autoReloadTick() {
  checkAutoReload();
  autoReload.timer = setTimeout(autoReloadTick, 60e3);
  if (autoReload.timer.unref) autoReload.timer.unref(); // (tests: don't keep Node waiting)
})();

// Phones: a rolled-up section's heading opens or closes it (its own buttons and menus still work as they are)
document.addEventListener('click', e => {
  const head = e.target.closest && e.target.closest('.card.rollable > .card-head');
  if (head && !e.target.closest('.info-btn') && (!e.target.closest('button, a, select, input, label, summary') || head.parentElement.classList.contains('rolled'))) toggleRoll(head.parentElement);
});
document.addEventListener('keydown', e => {
  const h = (e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('.card.rollable > .card-head > h2');
  if (h) { e.preventDefault(); toggleRoll(h.parentElement.parentElement); }
});
document.addEventListener('click', e => {
  // a tap outside a popup (on its backdrop) closes it
  if (e.target instanceof HTMLDialogElement && e.target.open) { const r = e.target.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) { e.target.close(); return; } }
  if (document.body.classList.contains('nav-open') && !e.target.closest('.tab-more') && (!e.target.closest('.tabs-extra') || e.target.closest('#tabs a'))) setNav(false);
  const menu = $('#leagueMenu details');
  if (menu && menu.open && !e.target.closest('#leagueMenu')) menu.removeAttribute('open');
  // (the team picker, or the sandbox's sport and scoring menus: a tap outside one, or on the other, closes it)
  document.querySelectorAll('#teamMenu details[open]').forEach(d => { if (!d.contains(e.target)) d.removeAttribute('open'); });
  const gear = $('#gearMenu details');
  if (gear && gear.open && !e.target.closest('#gearMenu') && !e.target.closest('#infoDialog')) gear.removeAttribute('open');
  // the Players tab's position or team menu shuts on a tap anywhere else
  if (ui.perfMenu && !e.target.closest('.pm')) { ui.perfMenu = null; if (ui.tab === 'players') render(); }
  const el = e.target.closest('[data-action]');
  // a player's photo opens his card, as his name does (not in a trade list, where the row is a checkbox, or on the card itself)
  const photo = !el && e.target.closest('[data-photo]');
  if (photo && !photo.closest('label, #detailBody')) { e.preventDefault(); showPlayerDetail(+photo.dataset.photo); return; }
  if (!el || !actions[el.dataset.action]) return;
  e.preventDefault();
  actions[el.dataset.action](el, e);
});

// the Dashboard's folds remember which are open, so a redraw (live updates every 30 s) doesn't shut them
document.addEventListener('toggle', e => {
  const k = e.target.dataset && e.target.dataset.fold;
  if (!k) return;
  ui.dashFolds = ui.dashFolds || new Set();
  ui.dashFolds[e.target.open ? 'add' : 'delete'](k);
}, true);

document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.change === 'set-basis') {
    actions['set-basis']({ dataset: { basis: el.value } });
  } else if (el.dataset.change === 'recap-week') {
    ui.recapWeek = +el.value;
    render();
  } else if (el.dataset.change === 'week-pick') {
    goWeek(+el.value);
  } else if (el.dataset.change === 'perf-range') {
    ui.perfRange = el.value;
    pickPerf();
    render();
  } else if (el.dataset.change === 'fx-opp') {
    if (!el.value) return;
    if (viewingOther()) { ui.viewB = el.value; render(); } else loadFxTeam(el.value);
  } else if (el.dataset.change === 'trade-team') {
    ui.tradeTeam = el.value;
    ui.tradeGet.clear(); ui.tradeGetPicks.clear(); ui.tradeSeen = null; // (a league mate's deal gives way to your own)
    render();
  } else if (el.dataset.change === 'trade-pick') { // a draft pick, either side
    const set = el.dataset.side === 'give' ? ui.tradeGivePicks : ui.tradeGetPicks;
    if (el.checked) set.add(el.value); else set.delete(el.value);
    ui.tradeSeen = null;
    render();
  } else if (el.dataset.change === 'sb-scoring') { // the sandbox's scoring and sport (sandbox.js)
    if (!sbSetScoring(el.value)) el.value = sbState().scoring;
  } else if (el.dataset.change === 'sb-sport') {
    sbSetSport(el.value).then(ok => { if (!ok) el.value = SPORT.key; }); // (its data didn't load: it says so, and the sport stays)
  } else if (el.dataset.change === 'sb-give') { // the sandbox's trade (sandbox.js)
    if (el.checked) ui.sbGive.add(+el.value); else ui.sbGive.delete(+el.value);
    render();
  } else if (el.dataset.change === 'sb-get') {
    if (!el.checked) ui.sbGet = ui.sbGet.filter(id => id !== +el.value);
    render();
  } else if (el.dataset.change === 'trade') {
    const set = el.dataset.side === 'give' ? ui.tradeGive : ui.tradeGet;
    if (el.checked) set.add(el.value); else set.delete(el.value);
    ui.tradeSeen = null;
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
  } else if (el.dataset.input === 'sb-q') { // a sandbox search (sandbox.js): its matches as it's typed
    const key = el.dataset.key, at = el.selectionStart;
    ui.sbQ[key] = el.value;
    render();
    const box = $(`#sbQ-${key}`);
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

// A link someone shared (?league=<id>&week=<n>#recap, or a trade: &from=<team>&to=<team>&give=<ids>&get=<ids>, its draft picks in &givepicks= &getpicks=, #trade, kept
// until your team is known: applyTradeLink): open that league, or connect it and ask for the team first
async function openSharedLink() {
  if (!location.search) return;
  const q = new URLSearchParams(location.search), id = q.get('league');
  if (!id) return;
  history.replaceState(null, '', location.pathname + location.hash);
  if (+q.get('week')) ui.recapWeek = +q.get('week');
  const ids = k => (q.get(k) || '').split(',').filter(Boolean);
  if (q.get('from') && q.get('to')) { ui.tradeLink = { from: q.get('from'), to: q.get('to'), give: ids('give'), get: ids('get'), givePicks: ids('givepicks'), getPicks: ids('getpicks') }; ui.tradeSeen = null; }
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
  if (tab === 'lineup' || tab === 'roster') tab = 'standings'; // the old Lineup and Roster tabs: Category strengths is on a team's card now
  if (tab === 'live') tab = 'dashboard'; // and the old Live tab on Performances (Today)
  if (tab === 'rosters' && !ui.season) tab = 'standings';
  ui.tab = tabList().some(([k]) => k === tab) ? tab : ui.season ? 'standings' : state.browse ? 'team' : 'dashboard';
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
  const t = store.get(THEME_KEY);
  if (t) document.documentElement.dataset.theme = t;
  state = load();
  validateLineup();
  const back = yahooFromAddress(); // just signed in with Yahoo: show the leagues to pick from
  if (back === 'in') { yahoo.leagues = null; if (state.fxTeam) ui.addingLeague = true; } else if (back) setTimeout(() => toast(back), 500);
  route();
  nbaLoading = loadNba();
  loadImages();
  openSharedLink();
})();
