// League Layer: Draft, saved leagues and the landing page.
// The site loads js/*.js in order (see index.html); they share one scope, like one file.
'use strict';

/* ---------- Draft: how every pick is playing so far ---------- */
// Each drafted player is ranked by his value per game this season (this season's stats only).
// Gain = draft slot − current rank: a #40 pick playing like the #5 player is +35.
const KEEPER_SLOTS = [5, 15];

// The league's own season: its first week's first day to its last week's last game day, playoffs included
function leagueSeason(L) {
  const ps = L.periods || [];
  if (!ps.length) return null;
  const last = ps[ps.length - 1], end = String(last.endAt || last.end);
  // a period that ends in the morning (Fantrax's, the Monday after) ends with the day before
  return { from: ps[0].start.slice(0, 10), to: end.length <= 10 || +end.slice(11, 13) >= 21 ? end.slice(0, 10) : addDays(end.slice(0, 10), -1) };
}
// Each player's per-game stats from a season's games between two days, in nbaStats's shape: NBA id -> stats
function windowStats(G, from, to) {
  const d0 = Date.parse(G.start + 'T12:00:00'), day = iso => Math.round((Date.parse(iso + 'T12:00:00') - d0) / 864e5);
  const a = day(from), b = day(to), out = new Map();
  for (const [pid, rows] of G.players) {
    const t = {};
    let n = 0;
    for (const r of rows) {
      if (r[0] < a || r[0] > b) continue;
      n++;
      for (const [k, v] of Object.entries(gameLine(G, r))) t[k] = (t[k] || 0) + v;
    }
    if (!n) continue;
    const s = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v / n]));
    out.set(+pid, { ...s, gp: n, fgPct: t.fga ? t.fgm / t.fga : 0, ftPct: t.fta ? t.ftm / t.fta : 0 });
  }
  return out;
}
// What a draft is graded by: the games of the league's own season, not the NBA's (a league can end weeks before the
// NBA does, or start after it). A past season's archived game log; this season's box scores once the league is over
// or if it started late (until then, the season so far is the league's). { win, stats }, { loading }, or null for the
// season's averages (nbaStats)
const draftSeasons = new Map();
function draftSeason(L, basis) {
  const win = leagueSeason(L);
  const season = basis === 'cur' ? 'cur' : String(basis || '').startsWith('arch:') ? basis.slice(5) : null;
  if (!win || !season) return null;
  if (season === 'cur' && !(todayIso() > win.to || win.from > (nbaGameDays()[0] || win.from))) return null;
  if (!(season in gameLogs)) {
    loadGameLog(season).then(() => { if (ui.tab === 'draft') render(); });
    return { loading: true };
  }
  const G = gameLogs[season];
  if (!G) return null;
  const key = `${season}|${win.from}|${win.to}`;
  if (!draftSeasons.has(key)) draftSeasons.set(key, { win, stats: windowStats(G, win.from, win.to) });
  return draftSeasons.get(key);
}

function draftData() {
  const L = fxLeague();
  if (!L || !L.draft || !L.draft.picks.length) return null;
  // this season so far, or a past season (when the site has its stats); only games inside the league's own season
  const basis = seasonCtx ? seasonCtx.basis : 'cur';
  const W = draftSeason(L, basis);
  if (W && W.loading) return { loading: true };
  const statsOf = raw => (W ? W.stats.get(raw.id) || null : nbaStats(raw, basis));
  const picks = L.draft.picks.map(([round, pick, teamId, nba, name]) => {
    const raw = nba ? nbaById.get(nba) : null;
    const s = raw && basis ? statsOf(raw) : null;
    const gp = s ? Math.round(s.gp) : 0;
    const p = { round, pick, teamId, team: fxTeamName(teamId), raw, nbaId: nba, name: raw ? raw.name : name, gp, val: null, s };
    if (s && gp) p.val = value({ ...s, pos: raw.pos });
    return p;
  });
  // Totals: points leagues add up fantasy points; cats leagues add up value above a replacement-level starter
  // (the per-game value of the last player who'd start in this league), so games only help players worth starting
  const totals = ui.draftMode === 'total';
  const perGame = picks.filter(p => p.val != null).map(p => p.val).sort((a, b) => b - a);
  const repl = isPoints() || !perGame.length ? 0 : perGame[Math.min(perGame.length, Math.max(1, fxPickable().length * state.slots.length)) - 1];
  const score = (val, gp) => (val == null ? null : totals ? (val - repl) * gp : val);
  picks.forEach(p => { p.score = score(p.val, p.gp); });
  const played = picks.filter(p => p.score != null).sort((a, b) => b.score - a.score);
  played.forEach((p, i) => { p.rank = i + 1; });
  // players who haven't played yet rank below everyone who has, in draft order
  picks.filter(p => p.val == null).sort((a, b) => a.pick - b.pick).forEach((p, i) => { p.rank = played.length + i + 1; });
  picks.forEach(p => { p.gain = p.pick - p.rank; });
  const maxGp = Math.max(0, ...picks.map(p => p.gp));
  // keepers: where each would slot among this year's picks, by value per game so far. The better keeper counts as the
  // #5 pick, the other as #15: this season by Fantrax ADP; a past season by the season before's value per game (today's
  // ADP says nothing about a past draft), a keeper without one (a rookie) last
  const prior = seasonCtx && L.priorSeason && archives[L.priorSeason] ? L.priorSeason : null;
  const keepers = {};
  for (const [tid, ids] of Object.entries(L.draft.keepers || {})) {
    if (seasonCtx && (!basis || !prior)) { // no stats to grade by, or none to say which keeper was the better one
      keepers[tid] = ids.map(nba => ({ nbaId: nba, name: (nbaById.get(nba) || {}).name || '', past: true })).sort((a, b) => a.name.localeCompare(b.name));
      continue;
    }
    keepers[tid] = ids.map(nba => {
      const raw = nbaById.get(nba) || { id: nba, pos: [] };
      const s = basis ? statsOf(raw) : null;
      const gp = s ? Math.round(s.gp) : 0;
      const val = s && gp ? value({ ...s, pos: raw.pos }) : null;
      const sc = score(val, gp);
      const like = sc == null ? null : played.filter(p => p.score > sc).length + 1;
      const before = prior ? archivedStats(raw, prior) : null;
      const rank = prior ? -(before && before.gp ? value({ ...before, pos: raw.pos }) : -1e9) : (raw.fx && raw.fx.adp) || 999;
      const old = [basis && basis.startsWith('arch:') && basis.slice(5), prior].map(x => x && archives[x] && archives[x].players.get(nba)).find(Boolean);
      return { nbaId: nba, name: raw.name || (old && old.n) || '', gp, val, like, rank }; // a player gone from the NBA: his archived name
    }).sort((a, b) => a.rank - b.rank);
    keepers[tid].forEach((k, i) => { k.slot = KEEPER_SLOTS[i] || 25; k.gain = k.like == null ? null : k.slot - k.like; });
  }
  return { picks, played: played.length, maxGp, graded: !!basis, date: L.draft.date, type: L.draft.type, perRound: L.draft.perRound || 10, keepers, totals, season: W && W.win };
}

function draftRow(p, mine) {
  const gainCls = p.gain > 0 ? 'pos-good' : p.gain < 0 ? 'pos-bad' : 'muted';
  return `<tr class="${p.teamId === mine ? 'dr-mine' : ''}">
    <td class="st-name"><div class="bplayer">${headshot({ nbaId: p.nbaId, name: p.name }, hsPx(32, 28))}<div class="bmain"><div class="bname">${p.nbaId ? `<button class="link-btn pname" data-action="player-detail" data-nba="${p.nbaId}">${esc(p.name)}</button>` : esc(p.name)}</div>
      <div class="pmeta">${esc(p.team)}${p.teamId === mine ? ' <span class="badge accent">you</span>' : ''}</div></div></div></td>
    <td class="num">R${p.round} · <b>#${p.pick}</b></td>
    <td class="num">${p.gp ? `#${p.rank}` : '<span class="muted">—</span>'}</td>
    <td class="num"><b class="${gainCls}">${p.gp ? signed(p.gain, 0) : 'DNP'}</b></td>
    <td class="num hide-sm">${p.gp}</td>
    <td class="num hide-sm">${p.score != null ? (ui.draftMode === 'total' ? fmt(p.score, isPoints() ? 0 : 1) : fmtValue(p.score)) : '—'}</td>
  </tr>`;
}

const draftValueLabel = () => (ui.draftMode === 'total' ? (isPoints() ? 'Total FP' : 'Total value') : valueLabel());

// ----- One team's draft: its keepers and every pick, opened from its name in Team drafts -----
const draftTeamCards = new Map(); // team id -> { title, html }, written as the Draft tab draws
function draftTeamCard(d, tid, ps) {
  const L = fxLeague();
  const year = seasonCtx ? seasonCtx.label : L && L.year ? seasonLabel(L.year) : '';
  const gain = (g, gp) => (!d.graded ? '' : gp ? `<b class="aw-break-v ${g > 0 ? 'pos-good' : g < 0 ? 'pos-bad' : 'muted'}">${signed(g, 0)}</b>` : '<b class="aw-break-v muted">DNP</b>');
  const row = (p, meta, right) => `<li><div class="bplayer">${headshot({ nbaId: p.nbaId, name: p.name }, hsPx(32, 28))}<div class="bmain">${p.nbaId ? `<button type="button" class="link-btn pname" data-action="player-detail" data-nba="${p.nbaId}">${esc(p.name)}</button>` : `<span class="pname">${esc(p.name)}</span>`}<div class="muted small">${meta}</div></div></div>${right}</li>`;
  const ks = d.keepers[tid] || [];
  const keepers = ks.map(k => row(k, k.past ? 'Keeper' : `Keeper · graded as pick #${k.slot}${k.like ? ` · ${seasonCtx ? 'finished as' : 'playing like'} #${k.like}` : ''}`, k.past ? '' : gain(k.gain, k.gp))).join('');
  const picks = [...ps].sort((a, b) => a.pick - b.pick).map(p => row(p, `R${p.round} · pick #${p.pick}${d.graded && p.gp ? ` · ${seasonCtx ? 'finished as' : 'playing like'} #${p.rank}` : ''}`, gain(p.gain, p.gp))).join('');
  const avg = sum(ps.map(p => p.gain)) / ps.length;
  return {
    title: `${fxTeamName(tid)}: ${year ? `${year} ` : ''}draft`,
    html: `${d.graded ? `<p class="aw-break-total"><b class="${avg > 0 ? 'pos-good' : avg < 0 ? 'pos-bad' : ''}">${signed(avg, 1)}</b> a pick on average, from ${ps.length} pick${ps.length === 1 ? '' : 's'}</p>` : ''}
      ${keepers ? `<h3 class="sub">Keepers</h3><ul class="aw-break">${keepers}</ul>` : ''}
      <h3 class="sub">Picks</h3><ul class="aw-break">${picks}</ul>`,
  };
}

function draftList(title, list, mine, info) {
  return `<div class="card">
    <div class="card-head"><h2>${title} ${info ? infoBtn('draft') : ''}</h2></div>
    <div class="table-wrap"><table class="dr-table">
      <thead><tr><th>Player</th><th class="num">Drafted</th><th class="num">${seasonCtx ? 'Finished' : 'Now'}</th><th class="num">+/−</th><th class="num hide-sm">GP</th><th class="num hide-sm">${draftValueLabel()}</th></tr></thead>
      <tbody>${list.map(p => draftRow(p, mine)).join('')}</tbody>
    </table></div>
  </div>`;
}

function viewDraft() {
  const d = draftData();
  if (d && d.loading) return loadingCard("Loading the season's games…", "The draft is graded by the games inside your league's season.");
  if (!d && fxLeague() && fxLeague().draftFailed) {
    return `<div class="card"><div class="empty"><strong>Couldn't load the draft</strong>${sourceName()} didn't answer when the league loaded.<br><br><button type="button" class="btn primary" data-action="draft-retry">Try again</button></div></div>`;
  }
  if (!d) {
    return `<div class="card"><div class="empty"><strong>No draft results</strong>${sourceName()} didn't return draft picks for this league. Leagues that skipped the draft or started from imported rosters won't have any.</div></div>`;
  }
  const mine = myTeamId();
  const best = [...d.picks].filter(p => p.gp).sort((a, b) => (b.gain - a.gain) || (b.score - a.score)).slice(0, 10);
  const worst = [...d.picks].sort((a, b) => (a.gain - b.gain) || (a.pick - b.pick)).slice(0, 10);

  // team rankings: average +/− of every pick, plus best and worst pick
  const byTeam = {};
  for (const p of d.picks) (byTeam[p.teamId] = byTeam[p.teamId] || []).push(p);
  const teamRows = Object.entries(byTeam).map(([id, ps]) => {
    const avg = sum(ps.map(p => p.gain)) / ps.length;
    const top = ps.reduce((a, b) => (b.gain > a.gain ? b : a));
    const low = ps.reduce((a, b) => (b.gain < a.gain ? b : a));
    const total = sum(ps.filter(p => p.score != null).map(p => p.score));
    return { id, name: fxTeamName(id), n: ps.length, avg, top, low, total };
  }).sort((a, b) => b.avg - a.avg);
  draftTeamCards.clear();
  for (const [id, ps] of Object.entries(byTeam)) draftTeamCards.set(id, draftTeamCard(d, id, ps));

  // board: one column per draft slot (round-1 order), one row per round. Traded picks stay in
  // their original slot, marked with the team that made them; keepers fill two rows on top.
  const T = d.perRound;
  const rounds = Math.max(...d.picks.map(p => p.round));
  const order = d.picks.filter(p => p.round === 1).sort((a, b) => a.pick - b.pick).map(p => p.teamId);
  // read each round's direction from the picks themselves (this league's order isn't a plain snake)
  const inRound = p => p.pick - (p.round - 1) * T;
  const forward = {};
  for (let r = 1; r <= rounds; r++) {
    const rp = d.picks.filter(p => p.round === r);
    forward[r] = rp.filter(p => order[inRound(p) - 1] === p.teamId).length >= rp.filter(p => order[T - inRound(p)] === p.teamId).length;
  }
  const colOf = p => (forward[p.round] ? inRound(p) - 1 : T - inRound(p));
  const grid = {};
  for (const p of d.picks) grid[`${p.round}|${colOf(p)}`] = p;
  // each column belongs to the team that picked there most often, so a traded first-rounder doesn't move it
  const cols = order.map((first, c) => {
    const n = {};
    for (let r = 1; r <= rounds; r++) { const p = grid[`${r}|${c}`]; if (p) n[p.teamId] = (n[p.teamId] || 0) + 1; }
    const top = Object.entries(n).sort((a, b) => b[1] - a[1])[0];
    return top ? top[0] : first;
  });
  const nameBtn = (nbaId, name) => nbaId ? `<button class="link-btn" data-action="player-detail" data-nba="${nbaId}"><span class="n-full">${esc(name)}</span><span class="n-short">${esc(shortName(name))}</span></button>` : esc(name);
  const gainTag = (gain, gp) => !d.graded ? '' : `<span class="dr-gain ${gain > 0 ? 'pos-good' : gain < 0 ? 'pos-bad' : 'muted'}">${gp ? signed(gain, 0) : 'DNP'}</span>`;
  const keeperRows = !Object.values(d.keepers).some(k => k.length) ? '' : [0, 1].map(i => `<tr class="dr-krow"><th scope="row">K${i + 1}</th>${cols.map(t => {
    const k = (d.keepers[t] || [])[i];
    if (!k) return '<td class="dr-cell dr-keeper"></td>';
    if (k.past) return `<td class="dr-cell dr-keeper" title="${esc(k.name)} · keeper (not graded)"><span class="dr-pick">Keeper</span> ${nameBtn(k.nbaId, k.name)}</td>`;
    return `<td class="dr-cell dr-keeper" style="${k.gain != null ? shade(k.gain / 15) : ''}" title="${esc(k.name)} · keeper, graded as pick #${k.slot} · ${k.like ? `${seasonCtx ? 'finished as' : 'playing like'} #${k.like} (${signed(k.gain, 0)})` : "hasn't played"}">
      <span class="dr-pick">Keeper · as #${k.slot}</span> ${nameBtn(k.nbaId, k.name)} ${gainTag(k.gain, k.gp)}</td>`;
  }).join('')}</tr>`).join('');
  const board = keeperRows + Array.from({ length: rounds }, (_, r) => `<tr><th scope="row" class="num">R${r + 1}</th>${cols.map((t, c) => {
    const p = grid[`${r + 1}|${c}`];
    if (!p) return '<td class="dr-cell"><span class="dr-pick">No pick</span></td>';
    const via = p.teamId !== t ? `<span class="dr-via">by ${esc(p.team)}</span>` : '';
    return `<td class="dr-cell" style="${p.gp ? shade(p.gain / 15) : ''}" title="${esc(p.name)} · pick #${p.pick}${via ? ` (traded, made by ${esc(p.team)})` : ''} · ${p.gp ? `${seasonCtx ? 'finished as' : 'playing like'} #${p.rank} (${signed(p.gain, 0)})` : "hasn't played"}">
      <span class="dr-pick">#${p.pick}</span> ${nameBtn(p.nbaId, p.name)} ${gainTag(p.gain, p.gp)}${via}</td>`;
  }).join('')}</tr>`).join('');

  const modeSeg = !d.graded ? '' : `<div class="seg seg-sm" role="group" aria-label="Rank picks by">${[['game', 'Per game'], ['total', 'Season totals']].map(([k, l]) => `<button type="button" class="${ui.draftMode === k ? 'on' : ''}" data-action="draft-mode" data-mode="${k}" aria-pressed="${ui.draftMode === k}">${l}</button>`).join('')}</div>`;
  return `
  <div class="page-sub-row">${modeSeg}<p class="page-sub">${d.type ? d.type[0].toUpperCase() + d.type.slice(1) + ' draft' : 'Draft'}${d.date ? `, ${fmtDay(d.date)}` : ''} · ${d.picks.length} picks · ${!d.graded ? `not graded: the site has no ${SPORT.name} stats for that season` : d.season ? `graded by the games of the league's season, ${fmtDay(d.season.from)} – ${fmtDay(d.season.to)}` : seasonCtx ? `graded by ${seasonCtx.label} full-season stats` : `compared with this season so far (up to ${d.maxGp} game${d.maxGp === 1 ? '' : 's'} played)`} ${infoBtn('draft')}</p></div>
  ${!seasonCtx && d.maxGp < 10 ? `<div class="sample-banner"><span>It's early: players have ${d.maxGp} game${d.maxGp === 1 ? '' : 's'} at most, so one big night can swing a ranking a lot. This settles down after a few weeks.</span></div>` : ''}
  ${d.graded ? `<div class="trade-grid">
    ${draftList(seasonCtx ? 'Best picks' : 'Best picks so far', best, mine, true)}
    ${draftList(seasonCtx ? 'Worst picks' : 'Worst picks so far', worst, mine, false)}
  </div>` : ''}
  <div class="card" style="margin-top:16px">
    <div class="card-head"><h2>Team drafts</h2><span class="muted small">ranked by average +/− per pick</span></div>
    <div class="table-wrap"><table class="dr-teams">
      <thead><tr><th class="num">#</th><th>Team</th><th class="num">Avg +/−</th><th class="num">${d.totals ? draftValueLabel() : `Total ${valueLabel()}`}</th><th>Best pick</th><th>Worst pick</th></tr></thead>
      <tbody>${teamRows.map((t, i) => `<tr class="${t.id === mine ? 'dr-mine' : ''}"><td class="num">${i + 1}</td><td><button type="button" class="link-btn aw-team" data-action="draft-team" data-team="${esc(t.id)}" title="See ${esc(t.name)}'s picks and keepers"><b>${esc(t.name)}</b></button>${t.id === mine ? ' <span class="badge accent">you</span>' : ''}</td>
        <td class="num"><b class="${t.avg > 0 ? 'pos-good' : t.avg < 0 ? 'pos-bad' : ''}">${signed(t.avg, 1)}</b></td><td class="num">${fmtValue(t.total)}</td>
        <td>${inlinePlayer(t.top, esc(lastName(t.top.name)))} <span class="muted small">#${t.top.pick}</span> <span class="pos-good small">${t.top.gp ? signed(t.top.gain, 0) : ''}</span></td>
        <td>${inlinePlayer(t.low, esc(lastName(t.low.name)))} <span class="muted small">#${t.low.pick}</span> <span class="pos-bad small">${t.low.gp ? signed(t.low.gain, 0) : 'DNP'}</span></td></tr>`).join('')}</tbody>
    </table></div>
  </div>
  <div class="card" style="margin-top:16px">
    <div class="card-head"><h2>Draft board ${infoBtn('board')}</h2></div>
    <div class="table-wrap"><table class="dr-board">
      <thead><tr><th></th>${cols.map(t => `<th class="${t === mine ? 'dr-mine-col' : ''}">${teamLink(t)}</th>`).join('')}</tr></thead>
      <tbody>${board}</tbody>
    </table></div>
  </div>`;
}

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
  return new Error(`${site} didn't find that league (${e.message}). Check the ID in your league's address.${site === 'ESPN' ? ' Only public ESPN leagues can be loaded.' : ''}`);
}

async function switchLeague(input) {
  const id = parseLeagueId(input);
  if (!id) throw new Error(BAD_LEAGUE_ID);
  await needNba();
  // the league's sport has to be on screen before the league can be: nothing's drawn until both are (ui.hold), and
  // a league that doesn't load leaves the sport as it was. Fantrax and Sleeper leagues say their sport; the other sites are basketball.
  // (coming from the demo, nothing is kept: its team was only borrowed, even if this is the same league)
  const cur = currentLeagueId(), was = SPORT.key, fromDemo = !!state.demo;
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
  if (!wasCurrent) {
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

function viewLanding() {
  const chosen = !ui.addingLeague && state.leagueChosen && fxLeague() && !state.fxTeam;
  const afterSeason = ui.afterPick && pastCache[ui.afterPick.split('/')[1]];
  const step2 = chosen ? `
      <p class="land-step">Step 2 of 2</p>
      <h1>Which team is yours?</h1>
      <p class="muted">Connected to <b>${esc(fxLeague().name)}</b>. ${ui.afterPick === '#recap' ? `Pick your team to see the week${ui.recapWeek ? ` ${ui.recapWeek}` : ''} recap a league mate shared.` : afterSeason ? `Pick your team to see the ${afterSeason.label} season.` : "Pick your team to load your roster and this week's matchup."}</p>
      ${preDraft() ? `<p class="land-note">This league hasn't drafted yet${draftWhen(fxLeague()) ? ` (draft: ${esc(draftWhen(fxLeague()))})` : ''}, so rosters are empty for now.</p>` : ''}
      <div class="land-teams">${fxPickable().map(t => `<button type="button" class="land-team" data-action="land-team" data-id="${esc(t.id)}">${esc(t.name)}</button>`).join('')}</div>
      <p class="small muted" style="margin:16px 0 0"><button class="link-btn" data-action="land-back">Use a different league</button>${(state.savedLeagues || []).length ? ' · <button class="link-btn" data-action="land-cancel">Cancel</button>' : ''}</p>` : '';
  const adding = ui.addingLeague && state.fxTeam, forSeason = adding && ui.addingLeague === 'season' && fxLeague();
  const step1 = chosen ? '' : `
      <p class="land-step">${forSeason ? 'Add a season' : adding ? 'Add a league' : 'League Layer'}</p>
      <h1>${forSeason ? 'Add an earlier season' : adding ? 'Connect another league' : 'Plan your fantasy basketball or hockey week'}</h1>
      <p class="muted">${forSeason ? `Each season of <b>${esc(forSeason.name)}</b> has its own Fantrax league ID: open that season on Fantrax and copy the part of the address after <b>/league/</b>.`
        : adding ? 'Enter its league ID. Each league keeps its own team and notes, and earlier seasons go under their league in the menu at the top.'
        : "Connect your league to see your odds for this week's matchup, the best starters for the week, how your categories stack up against the league, and how your draft is holding up."}</p>
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
      <p class="small muted land-foot">Built for head-to-head leagues: basketball on Fantrax, ESPN and Sleeper, hockey on Fantrax. ${adding ? '<button class="link-btn" data-action="land-cancel">Cancel</button>' : ''}</p>
      ${adding ? '' : `<p class="small muted land-browse">No league to connect? ${NBA && NBA.siteLeague ? '<button class="link-btn" data-action="land-demo">Explore a basketball demo league</button> or ' : ''}<button class="link-btn" data-action="land-browse">just browse NBA players</button></p>`}`;
  return `<div class="landing-wrap"><div class="landing-card">${step1}${step2}</div></div>`;
}
