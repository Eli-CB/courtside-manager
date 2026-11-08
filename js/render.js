// League Layer: Alerts, page rendering, the league and season bar, past seasons.
// The site loads js/*.js in order (see index.html); they share one scope, like one file.
'use strict';

// Whether a menu's fold was open, so drawing it again keeps it that way
const isOpen = (el, sel = 'details') => !!(el.querySelector(sel) && el.querySelector(sel).open);

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
  if (NBA && state.opp.players.length && (state.lineupMode === 'weekly' || isFootball())) {
    const ctx = weekContext();
    const better = ctx.bestIds && [...ctx.bestIds].some(id => !ctx.setIds.has(id));
    if (better) a.push({ lvl: 'warn', msg: `A better lineup for this week takes you from <b>${pctTxt(ctx.oSet.win)}</b> to <b>${pctTxt(ctx.oBest.win)}</b> to win.`, action: 'go-week', label: 'See it' });
  }
  if (!a.length) a.push({ lvl: 'good', msg: 'Lineup is set and everyone starting is healthy.' });
  // the waiver order, where the league's site shares it (ESPN, Sleeper; Fantrax doesn't): this season only
  const W = !ui.season && !seasonCtx && fxLeague() && fxLeague().waivers, mine = W && W.find(w => w.id === state.fxTeam);
  if (mine) a.push({ lvl: '', msg: `You're <b>#${mine.rank}</b> of ${W.length} on waivers${mine.left != null ? `, with $${mine.left} of budget left` : ''}.`, action: 'waiver-order', label: 'See waiver order' });
  // a fresh recap has its own line under the matchup (recapFold)
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
  const wasOpen = isOpen(el);
  const P = pastSeason();
  // the current league's seasons, under it (Fantrax leagues: the others don't share past seasons)
  let seasons = '';
  if (!state.demo && (L.source || 'fantrax') === 'fantrax') {
    const past = seasonsFor(L);
    const rows = past.length ? [{ id: '', year: L.year }, ...past] : [];
    seasons = rows.map(x => {
      const on = (x.id || null) === (ui.season || null);
      return `<button type="button" class="lm-item lm-sub${on ? ' on' : ''}" data-action="season-pick" data-id="${esc(x.id)}">${on ? '✓ ' : ''}${x.year ? seasonLabel(x.year) : x.id ? 'Past season' : 'This season'}</button>`;
    }).join('') + '<button type="button" class="lm-item lm-sub" data-action="season-add">+ Add an earlier season</button>';
  }
  el.innerHTML = `<details class="lm"${wasOpen ? ' open' : ''}>
    <summary aria-label="League menu"><span class="lm-name">${esc(L.name)}${P ? ` · ${esc(P.label)}` : ''}</span><span class="lm-caret" aria-hidden="true">▾</span></summary>
    <div class="lm-pop">
      <div class="lm-sec">Leagues</div>
      ${saved.map(l => `<div class="lm-row"><button type="button" class="lm-item${l.id === cur ? ' on' : ''}" data-action="league-switch" data-id="${esc(l.id)}">${l.id === cur ? '✓ ' : ''}${esc(l.name)}</button>${l.id !== cur ? `<button type="button" class="icon-btn xs" data-action="league-remove" data-id="${esc(l.id)}" aria-label="Remove ${esc(l.name)}" title="Remove">✕</button>` : ''}</div>${l.id === cur ? seasons : ''}`).join('')}
      ${state.demo ? `<div class="lm-row"><span class="lm-item on">✓ ${esc(L.name)}</span></div>` : ''}
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
// Each Fantrax season is its own league. Past seasons are added by league ID (the league menu, or the league form,
// which knows one) and kept per league (keyed by Fantrax's league history id); a past season gets its own tabs.
// Fantrax leagues only, so far.
// (the addresses keep the tabs' old names, dashboard and week, so saved links still work)
const TABS_NOW = [['dashboard', 'Matchup'], ['week', 'Plan Ahead'], ['recap', 'Recap'], ['players', 'Players'], ['draft', 'Draft'], ['standings', 'Standings'], ['awards', 'Awards'], ['trade', 'Trades']];
const TABS_PAST = [['standings', 'Standings'], ['awards', 'Awards'], ['draft', 'Draft'], ['rosters', 'Rosters']];
const TABS_BROWSE = [['players', 'Players']]; // browsing without a league
// A tab's own (i), on the tab bar next to its name (phones: next to the menu button) rather than over its first card
const TAB_INFO = { dashboard: 'dashmatch', players: 'perf' };
const tabInfo = (tab, label) => (TAB_INFO[tab] ? `<button type="button" class="info-btn tab-info" data-action="info" data-key="${TAB_INFO[tab]}" aria-label="About ${label}" title="About ${label}">i</button>` : '');
const tabList = () => (ui.season ? TABS_PAST : state.browse ? TABS_BROWSE : TABS_NOW.filter(([k]) => !SPORT.soonTabs.includes(k)));
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

async function loadSeason(id, fetched) {
  if (pastCache[id]) return pastCache[id];
  const { league, idMap } = fetched || await fetchFantraxLeague(id, { opening: true });
  // that season's NBA stats, if saved, grade its draft, awards and rosters
  const season = league.year ? seasonOf(league.year) : null;
  const A = season ? await loadArchive(season) : null;
  const findOld = A ? matchInactive(league, A) : () => null;
  league.fidNba = fid => idMap.toNba[fid] || (idMap.names[fid] ? findOld(idMap.names[fid]) : null);
  // keepers again, now that players no longer in the NBA are matched; the season before's stats say which was the
  // better keeper (graded as the #5 pick, the other as #15)
  if (league.draft) league.draft.keepers = keepersOf(league);
  if (league.draft && league.year) { league.priorSeason = seasonOf(league.year - 1); await loadArchive(league.priorSeason); }
  league.weeks = await loadRosterWeeks(league).catch(() => null);
  league.season = season; // its game log loads when Awards opens
  const prevStart = NBA && NBA.prevSeason ? +String(NBA.prevSeason).slice(0, 4) : null;
  const basis = A ? 'arch:' + season : league.year && league.year === prevStart ? 'prev' : null;
  return (pastCache[id] = { league, basis, label: league.year ? seasonLabel(league.year) : 'Past season' });
}

// Tabs that can show another team's version (read-only); the rest are league-wide or yours
const VIEW_TABS = ['week', 'dashboard'];

// League and team bar shown above every tab
function ctxBar() {
  const bar = $('#ctxBar');
  if (!bar) return;
  const L = fxLeague();
  bar.hidden = !L || needsLanding();
  if (bar.hidden) return;
  const P = pastSeason();
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
      ${state.fxTeam ? '' : '<option value="">Pick your team</option>'}${fxPickable().map(t => `<option value="${esc(t.id)}" ${t.id === shown ? 'selected' : ''}>${esc(t.name)}${t.id === state.fxTeam && !state.demo ? ' (you)' : ''}</option>`).join('')}
    </select>${viewing ? '<span class="badge">Viewing only</span><button class="link-btn small" data-action="fx-view-mine">Back to my team</button>' : ''}`;
  }
  $('#ctxTeam').innerHTML = teamSel;
  document.body.classList.toggle('past', !!P);
  if (P) {
    $('#ctxMeta').innerHTML = `<span class="badge accent">${esc(P.label)} season</span><button class="link-btn" data-action="season-pick" data-id="">Back to ${esc(L.year ? seasonLabel(L.year) : 'this season')}</button>`;
    $('#ctxMeta').hidden = false;
    return;
  }
  const notes = [
    isPoints() && L.pointsOther && L.pointsOther.length ? `<span title="Not projected: ${esc(L.pointsOther.join(', '))}">some scoring stats not projected</span>` : '',
    !isPoints() && L.catsOther && L.catsOther.length ? `<span title="Not projected: ${esc(L.catsOther.join(', '))}">${L.catsOther.length === 1 ? 'one category' : 'some categories'} not projected</span>` : '',
  ].filter(Boolean);
  const demo = demoNote();
  $('#ctxMeta').innerHTML = `${demo}${notes.length ? `<span>${notes.join(' · ')}</span>` : ''}`;
  $('#ctxMeta').hidden = !notes.length && !demo;
}

// ----- On a phone's home screen -----
// The site installs as it is (manifest.webmanifest): no app store, and no service worker, so every visit is the live site.
// Android and desktop Chrome offer to install it and say so (beforeinstallprompt); an iPhone only does it from its Share menu.
const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIos = () => /iP(hone|ad|od)/.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const canInstall = () => !isInstalled() && (!!ui.installPrompt || isIos());

// Settings (the gear at the right of the tab bar): data freshness, reloading the league, the theme
// What this site keeps in the browser (about 5 MB is allowed), counted in characters
// (league data from Fantrax and ESPN: what "Clear saved league data" removes)
const SAVED_LEAGUE_DATA = ['courtside-fantrax-v2', 'courtside-fantrax-shared-v1', 'courtside-espn-shared-v1', 'courtside-roster-weeks-v2'];
function savedSize() {
  let n = 0;
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('courtside-')) n += k.length + (localStorage.getItem(k) || '').length; } } catch (e) { return 'unknown'; }
  return n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`;
}

// Feedback by email (Cloudflare forwards feedback@leaguelayer.com), with what's needed to look into it already filled
// in: the league (its site and ID), the page, this version and the browser. A plain email link does nothing on a
// computer without an email app, so the menu opens a popup: Gmail in the browser, the email app, or copy it all.
const TIP_URL = 'https://ko-fi.com/leaguelayerdev'; // tips (also in index.html's footer)
// The settings menu's icons, drawn as lines so they match on every device (emoji differ by phone and computer)
const menuIcon = d => `<svg class="lm-ico" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICON_RELOAD = menuIcon('<path d="M20 12a8 8 0 1 1-2.34-5.66L20 8.5"/><path d="M20 3.5v5h-5"/>');
const ICON_MAIL = menuIcon('<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/>');
const ICON_PHONE = menuIcon('<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/>');
const ICON_COFFEE = menuIcon('<path d="M4 10h12v4.5a4.5 4.5 0 0 1-4.5 4.5h-3A4.5 4.5 0 0 1 4 14.5z"/><path d="M16 11h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 3.5c-.8 1 .8 2-.1 3M12 3.5c-.8 1 .8 2-.1 3"/>');
const FEEDBACK_EMAIL = 'feedback@leaguelayer.com', FEEDBACK_SUBJECT = 'League Layer feedback';
function feedbackDetails() {
  const L = fxLeague();
  return [`League: ${L ? `${L.name} (${sourceName(L)} ${L.id})` : 'none connected'}`, `Page: ${location.hash || '#dashboard'}`,
    `Version: ${BUILD}`, `Browser: ${navigator.userAgent}`].join('\n');
}
const feedbackBody = () => `What happened, or what would you like to see?\n\n\n\n--- (this helps look into it)\n${feedbackDetails()}`;
const feedbackHref = () => `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(FEEDBACK_SUBJECT)}&body=${encodeURIComponent(feedbackBody())}`;
const feedbackGmail = () => `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(FEEDBACK_EMAIL)}&su=${encodeURIComponent(FEEDBACK_SUBJECT)}&body=${encodeURIComponent(feedbackBody())}`;
function feedbackPopup() {
  return `<p style="margin-top:0">Email <b>${FEEDBACK_EMAIL}</b>: a problem, an idea, a league that doesn't look right. These details come along, to help look into it:</p>
    <pre class="fb-details">${esc(feedbackDetails())}</pre>
    <div class="fb-actions">
      <a class="btn primary" href="${esc(feedbackGmail())}" target="_blank" rel="noopener">Open in Gmail</a>
      <a class="btn" href="${esc(feedbackHref())}">Your email app</a>
      <button type="button" class="btn" data-action="feedback-copy">Copy address and details</button>
    </div>`;
}

// The league's waiver order, in the popup the (i) buttons use
function waiverPopup() {
  const L = fxLeague(), W = (L && L.waivers) || [], budget = W.some(w => w.left != null);
  const rows = W.map(w => `<li class="${w.id === state.fxTeam ? 'me' : ''}"><span class="wo-rank">${w.rank}</span><span class="wo-team">${esc(fxTeamName(w.id))}${w.id === state.fxTeam ? ' <span class="badge accent">you</span>' : ''}</span>${budget ? `<span class="wo-left">$${w.left}</span>` : ''}</li>`).join('');
  return `<ol class="wo-list">${rows}</ol>
    <p class="muted small">${budget ? 'Budget left for bids beside each team. ' : ''}From ${sourceName(L)}, as of when the league loaded: ↻ Reload in the settings menu for the latest, after claims go through.</p>`;
}

function gearMenu() {
  const el = $('#gearMenu');
  if (!el) return;
  const wasOpen = isOpen(el);
  const advOpen = isOpen(el, '.gear-adv');
  // the phone's status bar follows the site's theme, as chosen here, not only the device's
  const colorNow = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => { m.content = colorNow === 'dark' ? '#09090b' : '#ffffff'; });
  const dark = (document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
  const league = fxLeague() && !needsLanding() && !state.demo;
  el.innerHTML = `<details class="gear"${wasOpen ? ' open' : ''}>
    <summary class="icon-btn" aria-label="Settings" title="Settings">⚙</summary>
    <div class="gear-pop">
      ${league ? `<div class="lm-sec">League</div>
      <button type="button" class="lm-item" data-action="league-reload">${ICON_RELOAD}Reload from ${sourceName()}<span class="gear-sub">rosters, lineups, matchups and standings</span></button>` : ''}
      <div class="lm-sec">Appearance</div>
      <button type="button" class="lm-item gear-toggle" data-action="toggle-theme" role="switch" aria-checked="${dark}">Dark mode<span class="gear-switch${dark ? ' on' : ''}" aria-hidden="true"></span></button>
      <button type="button" class="lm-item gear-toggle" data-action="toggle-scores" role="switch" aria-checked="${ui.hideScores}"><span>Hide game scores<span class="gear-sub">no spoilers on the Matchup tab</span></span><span class="gear-switch${ui.hideScores ? ' on' : ''}" aria-hidden="true"></span></button>
      <button type="button" class="lm-item gear-toggle" data-action="toggle-clock" role="switch" aria-checked="${ui.clock24}"><span>24-hour time<span class="gear-sub">tip-offs and update times as ${fmtTime('2026-11-02T19:30:00')}</span></span><span class="gear-switch${ui.clock24 ? ' on' : ''}" aria-hidden="true"></span></button>
      <div class="lm-sec">Help</div>
      <button type="button" class="lm-item" data-action="feedback">${ICON_MAIL}Send feedback<span class="gear-sub">a problem, an idea, a league that doesn't look right</span></button>
      ${canInstall() ? `<button type="button" class="lm-item" data-action="install-app">${ICON_PHONE}Install the app<span class="gear-sub">on your home screen, full screen with no browser bars</span></button>` : ''}
      <a class="lm-item" href="${TIP_URL}" target="_blank" rel="noopener">${ICON_COFFEE}Buy me a coffee<span class="gear-sub">tips keep League Layer free, on Ko-fi</span></a>
      <details class="gear-adv"${advOpen ? ' open' : ''}><summary class="lm-sec">Advanced</summary>
        <div class="gear-row">${NBA ? `${SPORT.name} stats updated ${ago(NBA.updated)} ${infoBtn('data')}` : `${SPORT.name} data unavailable`}</div>
        <div class="gear-row">Saved on this device: ${savedSize()} ${infoBtn('storage')}</div>
        <button type="button" class="lm-item" data-action="clear-saved">Clear saved league data<span class="gear-sub">leagues, weekly lineups and player lists; fetched again when needed</span></button>
      </details>
    </div>
  </details>`;
}

// Plan Ahead opens on next week (the lineup still to set), until a week is picked there; a new league starts over
function planAheadWeek() {
  if (ui.tab !== 'week' || ui.weekChosen || ui.season || !fxLeague() || !NBA) return;
  ui.weekChosen = true;
  const shifts = weekShifts();
  const next = shifts.includes(1) ? 1 : 0; // (after the last week: that one)
  if (ui.weekShift !== next) goWeek(next);
}

function render() {
  if (ui.hold) return; // changing sports: the league isn't in place yet
  planAheadWeek();
  const landing = needsLanding();
  document.body.classList.toggle('landing', landing);
  leagueMenu();
  gearMenu();
  ctxBar();
  const cur = !landing && tabList().find(([k]) => k === ui.tab);
  const info = cur && !ui.season ? tabInfo(ui.tab, cur[1]) : '';
  $('#tabInfo').innerHTML = info;
  if (landing) { $('#view').innerHTML = viewLanding(); return; }
  if (ui.pendingSeason) { $('#view').innerHTML = loadingCard('Loading that season…'); return; }
  const nav = $('#tabs');
  const mode = `${ui.season ? 'past:' + ui.season : state.browse ? 'browse' : `now:${SPORT.key}`}|${info && ui.tab}`;
  if (nav.dataset.mode !== mode) {
    const x = nav.scrollLeft || 0;
    nav.innerHTML = tabList().map(([k, l]) => `<a href="${seasonHash(k, ui.season)}" data-tab="${k}">${l}</a>${k === ui.tab ? info : ''}`).join('');
    nav.dataset.mode = mode;
    nav.scrollLeft = x;
  }
  document.querySelectorAll('#tabs a').forEach(a => a.classList.toggle('active', a.dataset.tab === ui.tab));
  $('#navCurrent').textContent = cur ? cur[1] : 'Menu';
  if (ui.season) {
    const past = { standings: viewStandings, awards: viewAwards, draft: viewDraft, rosters: viewPastRosters };
    $('#view').innerHTML = pastSeason() ? withSeason(past[ui.tab] || viewStandings) : loadingCard('Loading that season…');
    return;
  }
  const early = preDraft();
  if (early && ['week', 'dashboard', 'draft', 'standings', 'trade'].includes(ui.tab)) { $('#view').innerHTML = viewPreDraft(early); return; }
  const views = { week: () => withViewedTeam(viewWeek, true), draft: viewDraft, players: viewPlayers, dashboard: () => withViewedTeam(viewDashboard), standings: viewStandings, awards: viewAwardsSoFar, trade: viewTrade, recap: viewRecap };
  // keep scroll position of inner lists (e.g. trade picker, performances) across re-renders
  const inner = '.pick-list, .perf-wrap.scroll';
  const scrolls = [...document.querySelectorAll(inner)].map(el => [el.scrollTop, el.scrollLeft]);
  $('#view').innerHTML = (views[ui.tab] || viewDashboard)();
  rollCards();
  fitPerfLists();
  document.querySelectorAll(inner).forEach((el, i) => { [el.scrollTop, el.scrollLeft] = scrolls[i] || [0, 0]; });
}

// Phones: the sections after a tab's first one with a heading roll up to that heading, opened by a tap (which ones are
// open is kept for the visit: ui.rollOpen, by tab and heading). Trades keeps both sides open; award cards don't roll.
const flatPhone = () => typeof matchMedia === 'function' && (matchMedia('(max-width: 640px)').matches || document.documentElement.classList.contains('flat')); // MOCK: ?flat=1 everywhere
function rollCards() {
  if (!flatPhone() || ui.tab === 'trade') return;
  let first = true;
  document.querySelectorAll('#view .card').forEach(card => {
    const h = card.querySelector(':scope > .card-head > h2');
    if (!h || card.closest('dialog') || card.closest('.awards')) return;
    if (first) { first = false; return; }
    // wider screens: a section beside another (Draft's best and worst picks) stays open, or its column would sit empty
    const top = card.getBoundingClientRect().top;
    if ([...card.parentElement.children].some(c => c !== card && c.classList.contains('card') && Math.abs(c.getBoundingClientRect().top - top) < 2)) return;
    const key = `${ui.tab}|${h.textContent.trim()}`, open = ui.rollOpen.has(key);
    card.classList.add('rollable');
    card.classList.toggle('rolled', !open);
    card.dataset.roll = key;
    h.setAttribute('role', 'button');
    h.tabIndex = 0;
    h.setAttribute('aria-expanded', String(open));
  });
}
function toggleRoll(card) {
  const key = card.dataset.roll, open = card.classList.contains('rolled');
  if (open) ui.rollOpen.add(key); else ui.rollOpen.delete(key);
  card.classList.toggle('rolled', !open);
  card.querySelector(':scope > .card-head > h2').setAttribute('aria-expanded', String(open));
  fitPerfLists();
}

// The Players table, the tab's one card, is as tall as the screen under the top bar: scrolled up to it, it fills the page
// and scrolls inside (its header and the name and value columns stay put). Never under 5 rows and a peek of the 6th,
// measured, as rows change height when names or stats wrap. Runs again when the window resizes.
function fitPerfLists() {
  const wraps = [...document.querySelectorAll('.perf-wrap.scroll')];
  if (!wraps.length) return;
  const bar = $('.topbar'), room = window.innerHeight - (bar ? bar.getBoundingClientRect().height : 0) - 16;
  wraps.forEach(wrap => {
    const sixth = wrap.querySelectorAll('tbody tr')[5];
    const least = sixth ? sixth.getBoundingClientRect().top - wrap.getBoundingClientRect().top + wrap.scrollTop + 22 : 0;
    wrap.style.maxHeight = `${Math.max(least, room)}px`;
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
  return dt ? `${dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} at ${fmtTime(dt)}` : '';
}


function viewPreDraft(L) {
  const when = draftWhen(L);
  const past = draftTime(L) && draftTime(L) < new Date();
  return `<div class="card"><div class="empty"><strong>${past ? 'Waiting on the draft' : "This league hasn't drafted yet"}</strong>
      ${when ? `${past ? 'The draft was set for' : 'The draft is set for'} <b>${esc(when)}</b>. ` : ''}Rosters, matchups and the draft board fill in here once teams have players.
      In the meantime, the <a href="#players">Players</a> tab ranks every ${SPORT.name} player (Per game).</div></div>`;
}

function standingOf(teamId) {
  const L = fxLeague();
  return L && L.standings ? L.standings.find(r => r.id === teamId) || null : null;
}
