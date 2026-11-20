// League Layer: page rendering, the league and season bar, past seasons.
// The site loads js/*.js in order (see index.html); they share one scope, like one file.
'use strict';

// Whether a menu's fold was open, so drawing it again keeps it that way
const isOpen = (el, sel = 'details') => !!(el.querySelector(sel) && el.querySelector(sel).open);

// Where you are in the waiver order, where the league's site shares it (ESPN, Sleeper; Fantrax doesn't): this season
// only. On Standings, with the full order a tap away.
function waiverLine() {
  const W = !ui.season && !seasonCtx && fxLeague() && fxLeague().waivers, mine = W && W.find(w => w.id === state.fxTeam);
  return mine ? `<p class="muted small waiver-line">You're <b>#${mine.rank}</b> of ${W.length} on waivers${mine.left != null ? `, with $${mine.left} of budget left` : ''} · <button type="button" class="link-btn quiet" data-action="waiver-order">See waiver order</button></p>` : '';
}

// Icons drawn as lines, so they match on every device (emoji differ by phone and computer)
const lineIcon = (d, cls = 'lm-ico') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const menuIcon = d => lineIcon(d);
// (the box is the mark's own, 48 × 36, drawn at two thirds, 32 × 24 px (24 × 18 still read as jagged: slopes this shallow need the pixels): its upright edges fall on
// whole screen pixels. At 22 × 17 in a looser box they fell between them and the mark looked blurred)
const LOGO_MARK = '<svg class="lm-mark" viewBox="8 18 48 36" aria-hidden="true"><polygon class="m-a" points="36,37 56,27 46,22 36,27 18,18 8,23"/><polygon class="m-b" points="8,31 36,45 56,35 56,43 36,53 8,39"/></svg>';
const ICON_JERSEY_D = '<path d="M8.5 3 3 6l2 4.5 2.5-1V21h9V9.5l2.5 1L21 6l-5.5-3a3.5 3.5 0 0 1-7 0z"/>';
const ICON_GEAR_D = '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>';
// each section's icon, for the phone's bottom bar
const TAB_ICONS = {
  dashboard: '<path d="M13 2.5 4.5 13.5H11l-1 8 8.5-11H12z"/>',
  week: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  recap: '<path d="M6 3h9l4 4v14H6z"/><path d="M9 12h7M9 16h7M9 8h3"/>',
  players: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/>',
  draft: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
  standings: '<path d="M5 20.5V11M12 20.5V4M19 20.5V14.5"/>',
  awards: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 5.5H5A3 3 0 0 0 8.2 10M16 5.5h3a3 3 0 0 1-3.2 4.5M12 13v4M8.5 20.5h7M10 17h4v3.5h-4z"/>',
  trade: '<path d="M4 8h15.5L16 4.5M20 16H4.5L8 19.5"/>',
  rosters: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/>',
  trends: '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  team: ICON_JERSEY_D, // (the sandbox's My team and Live)
  watch: '<circle cx="12" cy="12" r="2.2"/><path d="M8 8a5.7 5.7 0 0 0 0 8M16 8a5.7 5.7 0 0 1 0 8M5 5a9.9 9.9 0 0 0 0 14M19 5a9.9 9.9 0 0 1 0 14"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
};
const TABS_SHOWN = 4; // phones: past 5 sections, the bottom bar shows this many and the rest sit under More

/* =========================================================
   Rendering
   ========================================================= */
function leagueMenu() {
  const el = $('#leagueMenu');
  if (!el) return;
  const L = fxLeague(), sb = !L && state.browse; // (the sandbox: no league on the page, its leagues to go back to)
  if (needsLanding()) { el.innerHTML = `<span class="lm-brand">${LOGO_MARK}League Layer</span>`; return; } // (no league yet: the site's name)
  if (!L && !sb) { el.innerHTML = ''; return; }
  const cur = sb ? null : currentLeagueId();
  const saved = state.savedLeagues || [];
  const site = NBA && NBA.siteLeague;
  const wasOpen = isOpen(el);
  const P = pastSeason();
  // the current league's seasons, under it (Fantrax leagues: the others don't share past seasons)
  let seasons = '';
  if (!sb && !state.demo && (L.source || 'fantrax') === 'fantrax') {
    const past = seasonsFor(L);
    const rows = past.length ? [{ id: '', year: L.year }, ...past] : [];
    seasons = rows.map(x => {
      const on = (x.id || null) === (ui.season || null);
      return `<button type="button" class="lm-item lm-sub${on ? ' on' : ''}" data-action="season-pick" data-id="${esc(x.id)}">${on ? '✓ ' : ''}${x.year ? seasonLabel(x.year) : x.id ? 'Past season' : 'This season'}</button>`;
    }).join('') + '<button type="button" class="lm-item lm-sub" data-action="season-add">+ Add an earlier season</button>';
  }
  el.innerHTML = `<details class="lm"${wasOpen ? ' open' : ''}>
    <summary aria-label="League menu">${LOGO_MARK}<span class="lm-name">${sb ? 'Sandbox' : esc(L.name)}${P ? ` · ${esc(P.label)}` : ''}</span>${lineIcon('<path d="m8 9.5 4-4 4 4M8 14.5l4 4 4-4"/>', 'lm-caret')}</summary>
    <div class="lm-pop">
      <div class="lm-sec">Leagues</div>
      ${saved.map(l => {
        const on = l.id === cur; // (the one on the page: ticked, its seasons under it, and no Remove)
        const pick = `<button type="button" class="lm-item${on ? ' on' : ''}" data-action="league-switch" data-id="${esc(l.id)}">${on ? '✓ ' : ''}${esc(l.name)}</button>`;
        const remove = on ? '' : `<button type="button" class="icon-btn xs" data-action="league-remove" data-id="${esc(l.id)}" aria-label="Remove ${esc(l.name)}" title="Remove">✕</button>`;
        return `<div class="lm-row">${pick}${remove}</div>${on ? seasons : ''}`;
      }).join('')}
      ${state.demo ? `<div class="lm-row"><span class="lm-item on">✓ ${esc(L.name)}</span></div>` : ''}
      <button type="button" class="lm-item" data-action="league-add">+ Add a league</button>
      ${site && !saved.some(l => l.id === site.id) && !state.demo ? '<button type="button" class="lm-item" data-action="land-demo">Explore the demo league</button>' : ''}
      ${sb ? '<div class="lm-row"><span class="lm-item on">✓ Sandbox</span></div>' : '<button type="button" class="lm-item" data-action="land-browse">Sandbox: any players, no league</button>'}
    </div>
  </details>`;
}

// The team picker, an icon beside the settings gear (its name too where there's room): the team whose Matchup and Plan
// Ahead to look at (read only), the demo's team to play as, a past season's roster, or your team before one is picked
function teamMenu() {
  const el = $('#teamMenu');
  if (!el) return;
  const L = fxLeague();
  // the sandbox: its sport and scoring menus here instead (sbMenus, sandbox.js), whichever was open kept open
  if (!L && state.browse && !needsLanding()) { const open = el.querySelector('details[open]'); el.innerHTML = sbMenus(open ? open.dataset.m : ''); return; }
  if (!L || needsLanding()) { el.innerHTML = ''; return; }
  const wasOpen = isOpen(el);
  const P = pastSeason();
  let teams, mine, shown, head;
  if (P) {
    const myName = fxTeamName(state.fxTeam), me = P.league.teams.find(t => t.name === myName);
    teams = P.league.teams; mine = me ? me.id : null; shown = ui.pastTeam || mine; head = 'Team';
  } else {
    teams = fxPickable(); mine = state.demo ? null : state.fxTeam;
    shown = ui.viewA && VIEW_TABS.includes(ui.tab) ? ui.viewA : state.fxTeam;
    head = state.demo ? 'Play as' : state.fxTeam ? 'View as' : 'Your team';
  }
  const cur = teams.find(t => t.id === shown), label = cur ? cur.name : 'Pick your team';
  el.innerHTML = `<details class="tm${shown && mine && shown !== mine ? ' viewing' : ''}"${wasOpen ? ' open' : ''}>
    <summary aria-label="Team: ${esc(label)}" title="Team">${lineIcon(ICON_JERSEY_D, 'hd-ico')}<span class="tm-name">${esc(label)}</span></summary>
    <div class="gear-pop tm-pop">
      <div class="lm-sec">${head}</div>
      ${teams.map(t => `<button type="button" class="lm-item${t.id === shown ? ' on' : ''}" data-action="team-pick" data-id="${esc(t.id)}">${t.id === shown ? '✓ ' : ''}${esc(t.name)}${t.id === mine ? ' <span class="tm-you">you</span>' : ''}</button>`).join('')}
    </div>
  </details>`;
}

// ----- Past seasons -----
// Each Fantrax season is its own league. Past seasons are added by league ID (the league menu, or the league form,
// which knows one) and kept per league (keyed by Fantrax's league history id); a past season gets its own tabs.
// Fantrax leagues only, so far.
// (the addresses keep the tabs' old names, dashboard and week, so saved links still work)
const TABS_NOW = [['dashboard', 'Matchup'], ['week', 'Plan Ahead'], ['recap', 'Recap'], ['players', 'Players'], ['trends', 'Trends'], ['draft', 'Draft'], ['standings', 'Standings'], ['awards', 'Awards'], ['trade', 'Trades']];
const TABS_PAST = [['standings', 'Standings'], ['awards', 'Awards'], ['draft', 'Draft'], ['rosters', 'Rosters']];
const TABS_BROWSE = [['team', 'My team'], ['watch', 'Live'], ['players', 'Players'], ['trends', 'Trends'], ['trade', 'Trades']]; // the sandbox: no league (sandbox.js)
// (a roto league has no weekly matchups, so no Recap of one)
const tabList = () => (ui.season ? TABS_PAST : state.browse ? TABS_BROWSE : TABS_NOW.filter(([k]) => !SPORT.soonTabs.includes(k) && !(k === 'recap' && isRoto())));
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

// The notes under the tabs, when there are any: a past season and the way back, another team being viewed, the demo,
// what the league scores that isn't projected
function ctxBar() {
  const bar = $('#ctxBar');
  if (!bar) return;
  const L = fxLeague();
  let html = '';
  if (L && !needsLanding()) {
    const P = pastSeason();
    document.body.classList.toggle('past', !!P);
    if (P) html = `<span class="badge accent">${esc(P.label)} season</span><button class="link-btn" data-action="season-pick" data-id="">Back to ${esc(L.year ? seasonLabel(L.year) : 'this season')}</button>`;
    else {
      const viewing = ui.viewA && VIEW_TABS.includes(ui.tab);
      const notes = [
        isPoints() && L.pointsOther && L.pointsOther.length ? `<span title="Not projected: ${esc(L.pointsOther.join(', '))}">some scoring stats not projected</span>` : '',
        !isPoints() && L.catsOther && L.catsOther.length ? `<span title="Not projected: ${esc(L.catsOther.join(', '))}">${L.catsOther.length === 1 ? 'one category' : 'some categories'} not projected</span>` : '',
      ].filter(Boolean);
      html = `${viewing ? `<span class="ctx-view"><span class="badge">Viewing only</span> ${esc(fxTeamName(ui.viewA))}</span><button class="link-btn" data-action="fx-view-mine">Back to my team</button>` : ''}${demoNote()}${notes.length ? `<span>${notes.join(' · ')}</span>` : ''}`;
    }
  }
  $('#ctxMeta').innerHTML = html;
  bar.hidden = !html;
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
const SAVED_LEAGUE_DATA = ['league-layer-fantrax-v2', 'league-layer-fantrax-shared-v1', 'league-layer-espn-shared-v1', 'league-layer-roster-weeks-v2'];
function savedSize() {
  let n = 0;
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('league-layer-')) n += k.length + (localStorage.getItem(k) || '').length; } } catch (e) { return 'unknown'; }
  return n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`;
}

// Feedback by email (Cloudflare forwards feedback@leaguelayer.com), with what's needed to look into it already filled
// in: the league (its site and ID), the page, this version and the browser. A plain email link does nothing on a
// computer without an email app, so the menu opens a popup: Gmail in the browser, the email app, or copy it all.
const TIP_URL = 'https://ko-fi.com/leaguelayerdev'; // tips (also in index.html's footer)
// The settings menu's icons
const ICON_RELOAD = menuIcon('<path d="M20 12a8 8 0 1 1-2.34-5.66L20 8.5"/><path d="M20 3.5v5h-5"/>');
const ICON_MAIL = menuIcon('<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/>');
const ICON_PHONE = menuIcon('<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/>');
const GEAR_COPY = menuIcon('<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5v-3a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3"/>');
const ICON_COFFEE = menuIcon('<path d="M4 10h12v4.5a4.5 4.5 0 0 1-4.5 4.5h-3A4.5 4.5 0 0 1 4 14.5z"/><path d="M16 11h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 3.5c-.8 1 .8 2-.1 3M12 3.5c-.8 1 .8 2-.1 3"/>');
const GEAR_STATS = menuIcon('<path d="M5 20v-8M12 20V5M19 20v-5"/>');
const GEAR_MOON = menuIcon('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>');
const GEAR_EYE_OFF = menuIcon('<path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.5"/><path d="m4 4 16 16"/>');
const GEAR_CLOCK = menuIcon('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>');
const GEAR_NAME = menuIcon('<rect x="3" y="5.5" width="18" height="13" rx="2"/><circle cx="8.5" cy="11" r="2"/><path d="M5.5 16c.6-1.4 1.6-2 3-2s2.4.6 3 2M14.5 10h4M14.5 13.5h3"/>');
const GEAR_TRASH = menuIcon('<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5"/>');
const GEAR_BACKUP = menuIcon('<path d="M12 4v11m0 0-4-4m4 4 4-4"/><path d="M4.5 16.5v2A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5v-2"/>');
const GEAR_RESET = menuIcon('<path d="M4 12a8 8 0 1 0 2.34-5.66L4 8.5"/><path d="M4 3.5v5h5"/>');
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
  const dark = themeNow() === 'dark';
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => { m.content = dark ? '#141416' : '#ffffff'; });
  const hasLeague = fxLeague() && !needsLanding(), league = hasLeague && !state.demo;
  // every row the same shape: icon, label (a line of small print under it), and a switch at the right where there is one
  const row = (attrs, icon, label, sub, tail = '', tag = 'button') => `<${tag} class="lm-item gear-item${tail ? ' gear-toggle' : ''}" ${tag === 'button' ? 'type="button" ' : ''}${attrs}>${icon}<span class="gear-text">${label}${sub ? `<span class="gear-sub">${sub}</span>` : ''}</span>${tail}</${tag}>`;
  const toggle = (action, icon, label, sub, on) => row(`data-action="${action}" role="switch" aria-checked="${!!on}"`, icon, label, sub, `<span class="gear-switch${on ? ' on' : ''}" aria-hidden="true"></span>`);
  el.innerHTML = `<details class="gear"${wasOpen ? ' open' : ''}>
    <summary class="icon-btn" aria-label="Settings" title="Settings">${lineIcon(ICON_GEAR_D, 'hd-ico')}</summary>
    <div class="gear-pop">
      ${hasLeague && (league || !seasonSettled()) ? `<div class="lm-sec">League</div>
      ${league ? row('data-action="league-reload"', ICON_RELOAD, `Reload from ${sourceName()}`, reloadWait() > 0 ? 'read just now' : 'rosters, lineups and standings') : ''}
      ${seasonSettled() ? '' : `<div class="gear-row gear-pick">${GEAR_STATS}<span class="gear-text">Stats used ${infoBtn('projection')}</span><select class="ctx-team" data-change="set-basis" aria-label="Stats used">${Object.entries(BASIS_LABELS).map(([k, l]) => `<option value="${k}" ${state.basis === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`}
      ${league ? row('data-action="copy-league-id" title="Copy it, to send to a friend who connects the same league"', GEAR_COPY, 'Copy league ID', esc(fxLeague().id)) : ''}` : ''}
      <div class="lm-sec">Appearance</div>
      ${toggle('toggle-theme', GEAR_MOON, 'Dark mode', '', dark)}
      ${toggle('toggle-scores', GEAR_EYE_OFF, 'Hide game scores', 'no spoilers on the Matchup tab', ui.hideScores)}
      ${toggle('toggle-clock', GEAR_CLOCK, '24-hour time', `tip-offs as ${fmtTime('2026-11-02T19:30:00')}`, ui.clock24)}
      ${NICKNAMES[SPORT.key] ? `<div class="gear-row gear-pick">${GEAR_NAME}<span class="gear-text">Player names</span>${segBtns('Player names', 'set-names', 'names', Object.entries(NAME_STYLES).map(([k, [l, tip]]) => [k, l, tip]), ui.names)}</div>` : ''}
      <div class="lm-sec">Help</div>
      ${row('data-action="feedback"', ICON_MAIL, 'Send feedback', 'a problem, an idea, a wrong number')}
      ${canInstall() ? row('data-action="install-app"', ICON_PHONE, 'Install the app', 'full screen, on your home screen') : ''}
      ${row(`href="${TIP_URL}" target="_blank" rel="noopener"`, ICON_COFFEE, 'Buy me a coffee', 'tips keep League Layer free', '', 'a')}
      <details class="gear-adv"${advOpen ? ' open' : ''}><summary class="lm-sec">Advanced</summary>
        ${row('data-action="clear-saved"', GEAR_TRASH, 'Clear saved league data', 'fetched again when needed')}
        ${row('data-action="export"', GEAR_BACKUP, 'Backup &amp; restore', '')}
        ${row('data-action="start-fresh"', GEAR_RESET, 'Reset and start over', '').replace('lm-item ', 'lm-item danger ')}
        <div class="gear-info">
          <div>${NBA ? `${SPORT.name} stats updated ${ago(NBA.updated)} ${infoBtn('data')}` : `${SPORT.name} data unavailable`}</div>
          <div>Saved on this device: ${savedSize()} ${infoBtn('storage')}</div>
          <div>Version ${BUILD.startsWith('__') ? 'local' : esc(BUILD)}</div>
        </div>
      </details>
    </div>
  </details>`;
}

// Plan Ahead opens on next week (the lineup still to set; after the last week, that one), or on the week last picked
// there, over a refresh too, until a new matchup week or another league (core.js, picks): then next week again
const weekPickAt = () => `${fxLeague().id}|${weekStartAt(0)}`;
function planAheadShift() {
  const shifts = weekShifts(), kept = picks.week && picks.week.at === weekPickAt() ? picks.week.v : null;
  return shifts.includes(kept) ? kept : shifts.includes(1) ? 1 : 0;
}
function planAheadWeek() {
  if (ui.tab !== 'week' || ui.season || !fxLeague() || !NBA) return;
  if (ui.weekChosen && (!ui.weekAt || ui.weekAt === weekPickAt())) return; // (a week picked, and still this week's)
  const next = planAheadShift();
  ui.weekChosen = true; ui.weekAt = weekPickAt();
  if (ui.weekShift !== next) goWeek(next);
}
// The Matchup and Players tabs' When picks hold for the day they were made in (core.js, picks): a new day, their default again
function dropOldPicks() {
  const today = todayIso();
  if (picks.dash && picks.dash.at !== today) { ui.dashRange = null; savePick('dash'); }
  if (picks.perf && picks.perf.at !== today) { Object.assign(ui, { perfRange: null, perfPer: false }); savePick('perf'); }
  if (picks.watch && picks.watch.at !== today) { ui.watchRange = null; savePick('watch'); } // (the sandbox's Live: its default, once, for the new day's games)
}

function render() {
  if (ui.hold) return; // changing sports: the league isn't in place yet
  // a live update waits while a menu or a text box on the page is in use: redrawing would close the menu (a phone's
  // picker shuts and the choice is lost) or drop the typing; the next update, or the choice itself, redraws
  const busy = document.activeElement;
  if (live.hold && busy && busy.closest && busy.closest('#view') && /^(SELECT|INPUT|TEXTAREA)$/.test(busy.tagName)) return;
  planAheadWeek();
  dropOldPicks();
  const landing = needsLanding();
  document.body.classList.toggle('landing', landing);
  leagueMenu();
  teamMenu();
  gearMenu();
  ctxBar();
  if (landing) { $('#view').innerHTML = viewLanding(); landReveal(); return; }
  refreshInjuries(); // (ESPN's injury report as it is now: at most every 15 minutes)
  if (ui.pendingSeason) { $('#view').innerHTML = loadingCard('Loading that season…'); return; }
  const nav = $('#tabs');
  // (drawn again whenever its tabs change: a past season, the sandbox, a sport's or a league's own, as a roto league's lack of a Recap)
  const list = tabList(), mode = `${ui.season || ''}|${list.map(([k]) => k).join()}`;
  if (nav.dataset.mode !== mode) {
    const x = nav.scrollLeft || 0;
    // (phones: a bar along the bottom, each section with its icon; past 5, the rest under More)
    const link = ([k, l]) => `<a href="${seasonHash(k, ui.season)}" data-tab="${k}">${lineIcon(TAB_ICONS[k] || TAB_ICONS.more, 'tab-ico')}<span>${l}</span></a>`;
    nav.innerHTML = list.length <= TABS_SHOWN + 1 ? list.map(link).join('')
      : `${list.slice(0, TABS_SHOWN).map(link).join('')}<div class="tabs-extra">${list.slice(TABS_SHOWN).map(link).join('')}</div><button type="button" class="tab-more" data-action="nav-toggle" aria-expanded="false">${lineIcon(TAB_ICONS.more, 'tab-ico')}<span>More</span></button>`;
    nav.dataset.mode = mode;
    nav.scrollLeft = x;
  }
  document.querySelectorAll('#tabs a').forEach(a => a.classList.toggle('active', a.dataset.tab === ui.tab));
  const more = $('.tab-more');
  if (more) more.classList.toggle('active', !!document.querySelector('.tabs-extra a.active'));
  if (ui.season) {
    const past = { standings: viewStandings, awards: viewAwards, draft: viewDraft, rosters: viewPastRosters };
    $('#view').innerHTML = pastSeason() ? withSeason(past[ui.tab] || viewStandings) : loadingCard('Loading that season…');
    return;
  }
  const early = preDraft();
  if (early && ['week', 'dashboard', 'draft', 'standings', 'trade'].includes(ui.tab)) { $('#view').innerHTML = viewPreDraft(early); return; }
  const views = { week: () => withViewedTeam(viewWeek, true), draft: viewDraft, players: viewPlayers, dashboard: () => withViewedTeam(viewDashboard), standings: viewStandings, awards: viewAwardsSoFar, trade: viewTrade, recap: viewRecap, trends: viewTrends };
  if (state.browse) Object.assign(views, { team: viewSandboxTeam, watch: viewSandboxWatch, trade: viewSandboxTrade }); // the sandbox's own (sandbox.js)
  // keep scroll position of inner lists (e.g. trade picker, performances) across re-renders
  const inner = '.pick-list, .perf-wrap.scroll, .perf-wrap.sb-wrap';
  const scrolls = [...document.querySelectorAll(inner)].map(el => [el.scrollTop, el.scrollLeft]);
  $('#view').innerHTML = (views[ui.tab] || viewDashboard)();
  rollCards();
  fitPerfLists();
  document.querySelectorAll(inner).forEach((el, i) => { [el.scrollTop, el.scrollLeft] = scrolls[i] || [0, 0]; });
}

// Phones: the sections after a tab's first one with a heading roll up to that heading, opened by a tap (which ones are
// open is kept for the visit: ui.rollOpen, by tab and heading). Trades keeps both sides open; award cards don't roll.
// A card marked "rolls" rolls up wherever it is, and isn't the first (Standings' Moves this period: news, a tap away).
function rollCards() {
  if (!isPhone() || ui.tab === 'trade') return;
  let first = true;
  document.querySelectorAll('#view .card').forEach(card => {
    const h = card.querySelector(':scope > .card-head > h2');
    if (!h || card.closest('dialog') || card.closest('.awards')) return;
    if (first && !card.classList.contains('rolls')) { first = false; return; }
    // a section beside another (two columns) stays open, or its column would sit empty
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
