// League Layer: the sandbox: no league connected (state.browse). A team of any players (My team), up to 12 players
// followed live (Live), trades for anyone (Trades), and the Players and Trends tabs with your team marked. Values are
// for a standard 9-category league. The site loads js/*.js in order (see index.html); they share one scope, like one file.
'use strict';

// Its two sides of a trade, as team ids (fxTeamName and myTeamId know them: fantrax.js). "My team" is also the tab's name.
const SB_ME = 'sb-me', SB_THEM = 'sb-them';
const SANDBOX_SIDES = { [SB_ME]: 'My team', [SB_THEM]: 'Other team' };
const SB_GET_MAX = 10; // players a trade can bring in
const SB_HITS = 8; // a search's matches shown

// Its players as the Players tab has them (nbaPlayers: each one's average game under Stats used), by data id
let sbMemo = { list: null, by: null };
function sbById() {
  const list = nbaPlayers();
  if (sbMemo.list !== list) sbMemo = { list, by: new Map(list.map(p => [p.nbaId, p])) };
  return sbMemo.by;
}
const sbPlayers = ids => ids.map(id => sbById().get(id)).filter(Boolean);
const sbRoster = () => sbPlayers(state.sandbox.roster);
const sbOwns = id => state.sandbox.roster.includes(id);
const sbWatching = id => state.sandbox.watch.includes(id);
const sbWorth = p => (p.gp ? p.val : -99); // (best first; a player yet to play last)

// A player onto (or off) the team or the Live tab, and saved. Says so when a list is full. -> whether anything changed
function sbToggle(list, id, on) {
  const S = state.sandbox, max = list === 'roster' ? SANDBOX_MAX : WATCH_MAX, raw = nbaById.get(id);
  if (!raw || on === S[list].includes(id)) return false;
  if (on && S[list].length >= max) { toast(list === 'roster' ? `My team holds ${max} players: remove one first` : `Live follows ${max} players at most: remove one first`); return false; }
  S[list] = on ? [...S[list], id] : S[list].filter(x => x !== id);
  if (list === 'roster' && on) ui.sbGet = ui.sbGet.filter(x => x !== id); // (not traded for any more: he's yours)
  if (list === 'roster' && !on) ui.sbGive.delete(id);
  commit(`${on ? (list === 'roster' ? 'Added' : 'Watching') : list === 'roster' ? 'Removed' : 'Stopped watching'} ${raw.name}`);
  if ($('#detailDialog').open && cardOpen === id) showPlayerDetail(id); // (his card's buttons say so)
  return true;
}

// ----- A search for any player -----
// A box, and under it the best matches by value, each a button. key: which search (ui.sbQ[key]): 'team' adds to My team,
// 'watch' to the Live tab, 'get' to a trade's incoming side; skip: the ids it leaves out. Enter takes the first match.
const SB_SEARCH = {
  team: { hint: 'Add any player to your team', action: 'sb-add', verb: 'Add' },
  watch: { hint: 'Follow a player live', action: 'sb-watch', verb: 'Watch' },
  get: { hint: 'Find any player to get', action: 'sb-get', verb: 'Get' },
};
function sbHits(key, skip) {
  const q = normName(ui.sbQ[key] || '');
  if (q.length < 2) return [];
  return sortDesc(nbaPlayers().filter(p => !skip.has(p.nbaId) && normName(p.name).includes(q)), sbWorth).slice(0, SB_HITS);
}
function sbSearch(key, skip) {
  const S = SB_SEARCH[key], q = ui.sbQ[key] || '', hits = sbHits(key, skip);
  const hit = p => `<li><button type="button" class="sb-hit" data-action="${S.action}" data-id="${p.nbaId}">${headshot(p, hsPx(32, 30))}
    <span class="sb-hit-main"><span class="sb-hit-name">${esc(p.name)}${p.inj ? ` ${injBadge(p.inj)}` : ''}</span><span class="pmeta">${esc(p.team || 'FA')} · ${posTags(p.pos)}${p.gp ? ` · ${fmtValue(p.val)} a game` : ''}</span></span>
    <span class="sb-hit-add">+ ${S.verb}</span></button></li>`;
  const list = hits.length ? `<ul class="sb-hits">${hits.map(hit).join('')}</ul>` : q.trim().length >= 2 ? `<p class="muted small sb-none">No ${SPORT.name} player matches “${esc(q.trim())}”.</p>` : '';
  return `<form class="sb-find" data-form="sb-find" data-key="${key}" role="search"><input id="sbQ-${key}" class="sb-q" type="search" placeholder="${S.hint}" aria-label="${S.hint}" value="${esc(q)}" data-input="sb-q" data-key="${key}" autocomplete="off" spellcheck="false"></form>${list}`;
}

// ----- My team -----
// Every player on it, best first: photo, name, positions and team (any injury under it), games, minutes, his average game in
// the categories, value a game; then the team's per-game totals. The ✕ beside the name takes him off.
function sbTeamTable(list) {
  const cats = scoreCats().filter(c => !c.fp);
  const cell = (p, c) => {
    if (!p.gp) return '<td class="sc muted">—</td>';
    if (!c.pct) return `<td class="sc">${fmt(statVal(p, c.key), 1)}</td>`;
    const m = statVal(p, c.made), a = statVal(p, c.att);
    return `<td class="sc" title="${c.label}: ${fmt(m, 1)}-${fmt(a, 1)} a game">${a ? fmtPct(m / a) : '—'}</td>`;
  };
  const row = p => {
    const raw = nbaById.get(p.nbaId) || {};
    const inj = p.inj ? `<div class="pmeta inj" title="${esc(p.inj.note)}">${esc(p.inj.label)}${p.inj.note ? ': ' + esc(p.inj.note) : ''}</div>` : '';
    return `<tr><td class="pf-name"><div class="bplayer">${headshot(p, 34)}<div class="bmain">
      <div class="bname">${playerBtn(p.nbaId, p.name)}${rookieBadge(raw, 'by-name')}${sbWatching(p.nbaId) ? ' <span class="badge sb-live" title="Followed on the Live tab">Live</span>' : ''}</div>
      <div class="pmeta">${rookieBadge(raw, 'in-meta')}${[posTags(p.pos), p.team && teamBtn(p.team)].filter(Boolean).join(' · ')}</div>${inj}</div>
      <button type="button" class="icon-btn xs sb-x" data-action="sb-drop" data-id="${p.nbaId}" aria-label="Remove ${esc(p.name)}" title="Remove from my team">✕</button></div></td>
      <td class="sc">${p.gp || '—'}</td><td class="sc">${p.gp ? fmt(p.min, 1) : '—'}</td>${cats.map(c => cell(p, c)).join('')}<td class="num pf-v"><b>${p.gp ? fmtValue(value(p)) : '—'}</b></td></tr>`;
  };
  // the team a game: every player's average game added up (a percentage from the makes and attempts)
  const played = list.filter(p => p.gp), t = totals(played);
  const tot = c => (c.pct ? `<td class="sc" title="${c.label}: ${fmt(t[c.made], 1)}-${fmt(t[c.att], 1)} a game">${t[c.att] ? fmtPct(t[c.made] / t[c.att]) : '—'}</td>` : `<td class="sc">${fmt(lineStat(t, c.key), 1)}</td>`);
  return `<div class="perf-wrap"><table class="perf-table sb-table"><thead><tr><th class="pf-name">Player</th><th class="sc" title="Games played">GP</th><th class="sc" title="Minutes a game">MIN</th>${cats.map(c => `<th class="sc">${c.label}</th>`).join('')}<th class="num pf-v" title="${esc(valueTip())}">${valueLabel()}</th></tr></thead>
    <tbody>${list.map(row).join('')}</tbody>
    ${played.length > 1 ? `<tfoot><tr class="sb-tot"><td class="pf-name"><b>My team</b> <span class="muted small">a game</span></td><td class="sc"></td><td class="sc">${fmt(t.min, 1)}</td>${cats.map(tot).join('')}<td class="num pf-v"><b>${fmtValue(sum(played.map(value)))}</b></td></tr></tfoot>` : ''}
  </table></div>`;
}
const valueTip = () => "Categories won by his average game: what it adds to winning a week's categories, against not playing";

function viewSandboxTeam() {
  if (!NBA) return loadingCard('Loading player data…');
  const R = state.sandbox.roster, list = sortDesc(sbRoster(), sbWorth);
  const head = `<div class="card-head"><h2>My team ${infoBtn('sandbox')}</h2><span class="muted small">${R.length} of ${SANDBOX_MAX}</span>${R.length ? '<button type="button" class="link-btn quiet sb-clear" data-action="sb-clear">Start over</button>' : ''}</div>`;
  const find = R.length >= SANDBOX_MAX ? `<p class="muted small">My team is full: remove a player to add another.</p>` : sbSearch('team', new Set(R));
  const body = list.length ? sbTeamTable(list)
    : `<div class="empty"><strong>Build a team from any ${SPORT.name} players</strong>Find them above. Your team shows on the Players and Trends tabs, follow anyone on Live, and trade any of them for anyone on Trades.</div>`;
  return `${browseNote()}<div class="card sb-team">${head}${find}${body}</div>`;
}

// ----- Live: up to 12 players, each one's game and line as it's played -----
// Today, or the last game day (until today's games start, as the Matchup tab does): each player's game in its bubble
// (tip-off, the score and clock, the final), his line in the categories and its value, a bubble flashing as it moves. On
// now first, then finished, then still to come by tip-off, then no game (his next one).
function viewSandboxWatch() {
  if (!NBA) return loadingCard('Loading player data…');
  if (!BOX) { loadBoxes().then(() => { if (ui.tab === 'watch') render(); }).catch(() => {}); return `${browseNote()}${loadingCard('Live', 'Loading the latest box scores…')}`; }
  startLive(); // (today's games, as they're played)
  const W = state.sandbox.watch, P = perfDays(), today = todayIso(), yesterday = addDays(today, -1);
  const opts = [P.today && ['today', 'Today'], P.day && ['day', P.day === yesterday ? 'Yesterday' : fmtDay(P.day)]].filter(Boolean);
  const range = opts.some(([k]) => k === ui.watchRange) ? ui.watchRange : P.today && (P.started || !P.day) ? 'today' : P.day ? 'day' : 'today';
  const d = range === 'day' ? P.day : today;
  const toggle = opts.length > 1 ? `<div class="seg seg-sm" role="group" aria-label="Show games from">${opts.map(([k, l]) => `<button type="button" class="${k === range ? 'on' : ''}" data-action="watch-range" data-range="${k}" aria-pressed="${k === range}">${l}</button>`).join('')}</div>` : '';
  const room = WATCH_MAX - W.length, unwatched = sortDesc(sbRoster().filter(p => !sbWatching(p.nbaId)), sbWorth);
  const addTeam = room > 0 && unwatched.length ? `<button type="button" class="btn sm" data-action="sb-watch-team">Follow my team${unwatched.length > room ? ` (best ${room})` : ''}</button>` : '';
  const find = room > 0 ? sbSearch('watch', new Set(W)) : `<p class="muted small">Following ${WATCH_MAX}, the most there's room for: remove one to follow another.</p>`;
  const when = d === today ? (live.error ? `<span class="pos-bad">ESPN: ${esc(live.error)}</span>` : live.at ? `${fmtDay(d)} · updated ${fmtTime(live.at)}` : fmtDay(d)) : `${d === yesterday ? 'Last night' : ''} ${fmtDay(d)}`.trim();
  const head = `<div class="card-head"><h2>Live ${infoBtn('watch')}</h2><span class="muted small">${W.length} of ${WATCH_MAX}</span>${toggle}</div>`;
  const tools = `<div class="sb-tools">${find}${addTeam ? `<div class="sb-team-btn">${addTeam}</div>` : ''}</div>`;
  if (!W.length) return `${browseNote()}<div class="card sb-watch-card">${head}${tools}<div class="empty"><strong>Follow up to ${WATCH_MAX} players</strong>Each one's game and stat line as it's played, updated every 30 seconds while games are on.</div></div>`;

  const stage = p => {
    if (!playsOn(p, d)) return [3, 0];
    const g = liveGame(p, d);
    if (g && g.state === 'in') return [0, 0];
    if (gameFinal(p, d) || (g && g.state === 'post')) return [1, 0];
    return [2, g && g.start ? +g.start : Infinity];
  };
  const players = sbPlayers(W).map((p, i) => ({ p, i, s: stage(p) })).sort((a, b) => a.s[0] - b.s[0] || a.s[1] - b.s[1] || a.i - b.i).map(x => x.p);
  // today's bubbles flash when a live update moves them (chipFlash, dashboard.js)
  const isToday = d === today, chipNext = new Map();
  const flash = (p, line) => { if (!isToday) return undefined; const f = chipFlash(p.nbaId, line); chipNext.set(p.nbaId, f.now); return f.flash; };
  const cell = p => {
    const plays = playsOn(p, d), line = lineOn(p, d);
    const over = gameFinal(p, d) || !!(liveGame(p, d) && liveGame(p, d).state === 'post');
    const game = plays ? linkTeams(dashGame(p, d)) : `<span class="muted">No game${d === today && p.next ? ` · next ${linkTeams(nextGame(p.next))}` : ''}</span>`;
    const v = line ? `<span class="mu-chip sb-val" title="${esc(valueTip().replace('his average game', 'this game'))}"><b>${fmtValue(lineValue(line))}</b> ${isPoints() ? 'FP' : 'value'}</span>` : '';
    return `<div class="mu-p sb-w${!plays || (over && !line) ? ' out' : ''}">
      <div class="bplayer">${headshot(p, hsPx(38, 32))}<div class="bmain"><div class="bname">${playerName(p)}${p.status !== 'Healthy' ? ' ' + statusBadge(p) : ''}${sbOwns(p.nbaId) ? ' <span class="badge accent sb-mine" title="On My team">Mine</span>' : ''}</div></div>
        <button type="button" class="icon-btn xs sb-x" data-action="sb-unwatch" data-id="${p.nbaId}" aria-label="Stop following ${esc(p.name)}" title="Stop following">✕</button></div>
      <div class="mu-game">${game}</div>
      ${line ? `<div class="mu-chips">${lineChips(line, flash(p, line))}${v}</div>` : ''}
    </div>`;
  };
  const grid = players.map(cell).join('');
  chipWas = isToday ? chipNext : new Map();
  return `${browseNote()}<div class="card sb-watch-card">${head}${tools}<p class="muted small sb-when">${when}</p><div class="sb-watch">${grid}</div></div>`;
}

// ----- Trades: your team's players for anyone -----
// You give: My team's players to tick. You get: any player, found by name. Then the proposal as a league's (tradeCard), its
// "For your team" from My team's per-game totals, drawn with My team standing in as your roster (withState).
const SB_SHARE_LEAGUE = { name: 'League Layer', id: '' }; // (a picture and text with no league in them)
function sbDeal() {
  const give = sbRoster().filter(p => ui.sbGive.has(p.nbaId)), get = sbPlayers(ui.sbGet.filter(id => !sbOwns(id)));
  return { give, get, T: { from: SB_ME, to: SB_THEM, give: give.map(p => String(p.nbaId)), get: get.map(p => String(p.nbaId)), givePicks: [], getPicks: [] } };
}
const sbStandIn = fn => withState({ players: sbRoster(), il: [], benchSize: SANDBOX_MAX }, fn); // (no roster limit's warning)
function viewSandboxTrade() {
  if (!NBA) return loadingCard('Loading player data…');
  const roster = sbRoster();
  for (const id of ui.sbGive) if (!sbOwns(id)) ui.sbGive.delete(id);
  ui.sbGet = ui.sbGet.filter(id => !sbOwns(id) && sbById().has(id));
  const { give, get, T } = sbDeal();
  const item = (p, on, change) => `<li><label><input type="checkbox" data-change="${change}" value="${p.nbaId}"${on ? ' checked' : ''}>
      <span class="grow">${playerCell(p)}</span>${p.status !== 'Healthy' ? statusBadge(p) : ''}<span class="val">${fmtValue(value(p))}</span></label></li>`;
  const giveList = roster.length ? `<ul class="pick-list">${sortDesc(roster, value).map(p => item(p, ui.sbGive.has(p.nbaId), 'sb-give')).join('')}</ul>`
    : '<p class="muted small">My team is empty: add players on <a href="#team">My team</a>, then pick who to send.</p>';
  const getList = get.length ? `<ul class="pick-list sb-get-list">${get.map(p => item(p, true, 'sb-get')).join('')}</ul>` : '';
  const find = get.length >= SB_GET_MAX ? '' : sbSearch('get', new Set([...state.sandbox.roster, ...ui.sbGet]));
  const card = give.length || get.length ? sbStandIn(() => tradeCard(T, tradeForYou(give, get)))
    : `<div class="card"><div class="empty"><strong>Pick who you'd give and who you'd get</strong>See how the deal changes My team's per-game numbers, and share it.</div></div>`;
  return `${browseNote()}<div class="trade-grid">
    <div class="card"><div class="card-head"><h2>You give</h2><span class="muted small">${give.length} selected</span></div>${giveList}</div>
    <div class="card"><div class="card-head"><h2>You get</h2><span class="muted small">${get.length} selected</span></div>${find}${getList}</div>
  </div>
  ${card}`;
}
// Share, as a league's trade: the picture and the text, with the site's address in place of a league's link
function sbTradeShare() {
  const { give, get, T } = sbDeal();
  if (!give.length || !get.length) return null;
  return { ...tradeShare(SB_SHARE_LEAGUE, T), url: `${location.origin}${location.pathname}`, link: 'Try your own on League Layer' };
}

// The player card's line in the sandbox (cardOwner, players.js): whether he's on My team and followed live, each a button
function sbCardLine(raw) {
  const id = raw.id, mine = sbOwns(id), w = sbWatching(id);
  return `<p class="pc-owner sb-card">${mine ? `<span class="team-mine"><b>My team</b></span> <button type="button" class="btn sm" data-action="sb-drop" data-id="${id}">Remove</button>`
    : `<button type="button" class="btn sm primary" data-action="sb-add" data-id="${id}">+ Add to my team</button>`}
    <button type="button" class="btn sm${w ? ' on' : ''}" data-action="${w ? 'sb-unwatch' : 'sb-watch'}" data-id="${id}" aria-pressed="${w}">${w ? '✓ Following live' : 'Follow live'}</button></p>`;
}
