// Courtside Manager: Draft, saved leagues and the landing page.
// The site loads js/*.js in order (see index.html); they share one scope, like one file.
'use strict';

/* ---------- Draft: how every pick is playing so far ---------- */
// Each drafted player is ranked by his value per game this season (this season's stats only).
// Gain = draft slot − current rank: a #40 pick playing like the #5 player is +35.
const KEEPER_SLOTS = [5, 15];

function draftData() {
  const L = fxLeague();
  if (!L || !L.draft || !L.draft.picks.length) return null;
  // this season so far, or the full season for a past draft (when the site has those stats)
  const basis = seasonCtx ? seasonCtx.basis : 'cur';
  const picks = L.draft.picks.map(([round, pick, teamId, nba, name]) => {
    const raw = nba ? nbaById.get(nba) : null;
    const s = raw && basis ? nbaStats(raw, basis) : null;
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
  // keepers: where each would slot among this year's picks, by value per game so far
  const keepers = {};
  for (const [tid, ids] of Object.entries(L.draft.keepers || {})) {
    if (seasonCtx) {
      keepers[tid] = ids.map(nba => ({ nbaId: nba, name: (nbaById.get(nba) || {}).name || '', past: true })).sort((a, b) => a.name.localeCompare(b.name));
      continue;
    }
    keepers[tid] = ids.map(nba => {
      const raw = nbaById.get(nba);
      const s = raw && basis ? nbaStats(raw, basis) : null;
      const gp = s ? Math.round(s.gp) : 0;
      const val = s && gp ? value({ ...s, pos: raw.pos }) : null;
      const sc = score(val, gp);
      const like = sc == null ? null : played.filter(p => p.score > sc).length + 1;
      return { nbaId: nba, name: raw ? raw.name : '', gp, val, like, adp: (raw && raw.fx && raw.fx.adp) || 999 };
    }).sort((a, b) => a.adp - b.adp);
    // the better keeper (lower ADP) counts as the #5 pick, the other as #15
    keepers[tid].forEach((k, i) => { k.slot = KEEPER_SLOTS[i] || 25; k.gain = k.like == null ? null : k.slot - k.like; });
  }
  return { picks, played: played.length, maxGp, graded: !!basis, date: L.draft.date, type: L.draft.type, perRound: L.draft.perRound || 10, keepers, totals };
}

function draftRow(p, mine) {
  const gainCls = p.gain > 0 ? 'pos-good' : p.gain < 0 ? 'pos-bad' : 'muted';
  return `<tr class="${p.teamId === mine ? 'dr-mine' : ''}">
    <td class="st-name"><div class="bplayer">${headshot({ nbaId: p.nbaId, name: p.name }, 28)}<div class="bmain"><div class="bname">${p.nbaId ? `<button class="link-btn pname" data-action="player-detail" data-nba="${p.nbaId}">${esc(p.name)}</button>` : esc(p.name)}</div>
      <div class="pmeta">${esc(p.team)}${p.teamId === mine ? ' <span class="badge accent">you</span>' : ''}</div></div></div></td>
    <td class="num">R${p.round} · <b>#${p.pick}</b></td>
    <td class="num">${p.gp ? `#${p.rank}` : '<span class="muted">—</span>'}</td>
    <td class="num"><b class="${gainCls}">${p.gp ? signed(p.gain, 0) : 'DNP'}</b></td>
    <td class="num hide-sm">${p.gp}</td>
    <td class="num hide-sm">${p.score != null ? (ui.draftMode === 'total' ? fmt(p.score, isPoints() ? 0 : 1) : fmtValue(p.score)) : '—'}</td>
  </tr>`;
}

const draftValueLabel = () => (ui.draftMode === 'total' ? (isPoints() ? 'Total FP' : 'Total value') : valueLabel());

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
  <div class="page-sub-row">${modeSeg}<p class="page-sub">${d.type ? d.type[0].toUpperCase() + d.type.slice(1) + ' draft' : 'Draft'}${d.date ? `, ${fmtDay(d.date)}` : ''} · ${d.picks.length} picks · ${!d.graded ? 'not graded: the site has no NBA stats for that season' : seasonCtx ? `graded by ${seasonCtx.label} full-season stats` : `compared with this season so far (up to ${d.maxGp} game${d.maxGp === 1 ? '' : 's'} played)`} ${infoBtn('draft')}</p></div>
  ${!seasonCtx && d.maxGp < 10 ? `<div class="sample-banner"><span>It's early: players have ${d.maxGp} game${d.maxGp === 1 ? '' : 's'} at most, so one big night can swing a ranking a lot. This settles down after a few weeks.</span></div>` : ''}
  ${d.graded ? `<div class="trade-grid">
    ${draftList(seasonCtx ? 'Best picks' : 'Best picks so far', best, mine, true)}
    ${draftList(seasonCtx ? 'Worst picks' : 'Worst picks so far', worst, mine, false)}
  </div>` : ''}
  <div class="card" style="margin-top:16px">
    <div class="card-head"><h2>Team drafts</h2><span class="muted small">ranked by average +/− per pick</span></div>
    <div class="table-wrap"><table class="dr-teams">
      <thead><tr><th class="num">#</th><th>Team</th><th class="num">Avg +/−</th><th class="num">${d.totals ? draftValueLabel() : `Total ${valueLabel()}`}</th><th>Best pick</th><th>Worst pick</th></tr></thead>
      <tbody>${teamRows.map((t, i) => `<tr class="${t.id === mine ? 'dr-mine' : ''}"><td class="num">${i + 1}</td><td><b>${esc(t.name)}</b>${t.id === mine ? ' <span class="badge accent">you</span>' : ''}</td>
        <td class="num"><b class="${t.avg > 0 ? 'pos-good' : t.avg < 0 ? 'pos-bad' : ''}">${signed(t.avg, 1)}</b></td><td class="num">${fmtValue(t.total)}</td>
        <td>${inlinePlayer(t.top, esc(lastName(t.top.name)))} <span class="muted small">#${t.top.pick}</span> <span class="pos-good small">${t.top.gp ? signed(t.top.gain, 0) : ''}</span></td>
        <td>${inlinePlayer(t.low, esc(lastName(t.low.name)))} <span class="muted small">#${t.low.pick}</span> <span class="pos-bad small">${t.low.gp ? signed(t.low.gain, 0) : 'DNP'}</span></td></tr>`).join('')}</tbody>
    </table></div>
  </div>
  <div class="card" style="margin-top:16px">
    <div class="card-head"><h2>Draft board ${infoBtn('board')}</h2></div>
    <div class="table-wrap"><table class="dr-board">
      <thead><tr><th></th>${cols.map(t => `<th class="${t === mine ? 'dr-mine-col' : ''}">${esc(fxTeamName(t))}</th>`).join('')}</tr></thead>
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

function rememberLeague(id, name) {
  const list = (state.savedLeagues || []).filter(l => l.id !== id);
  const at = (state.savedLeagues || []).findIndex(l => l.id === id);
  list.splice(at === -1 ? list.length : at, 0, { id, name });
  state.savedLeagues = list;
}

function stashLeague() {
  const id = currentLeagueId();
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

// Switch the whole app to a Fantrax or ESPN league by ID (or the league's address). Throws a readable message.
async function switchLeague(input) {
  const id = parseLeagueId(input);
  if (!id) throw new Error(BAD_LEAGUE_ID);
  if (!NBA) await nbaLoading;
  if (!NBA) throw new Error("Couldn't load NBA data. Check your connection and try again.");
  let res;
  try {
    res = await getLeague(id);
  } catch (e) {
    const site = SOURCE_NAME[leagueSourceOf(id)];
    if (e.message === 'private league') throw new Error("That ESPN league is private, so ESPN won't share it. Only public ESPN leagues can be loaded; the league manager can make it viewable to the public in the league's settings.");
    throw new Error(`${site} didn't find that league (${e.message}). Check the ID in your league's address.${site === 'ESPN' ? ' Only public ESPN leagues can be loaded.' : ''}`);
  }
  const wasCurrent = currentLeagueId() === id;
  ui.season = null; ui.addingSeason = false; ui.pastTeam = null;
  if (!wasCurrent) stashLeague();
  applyFantraxLeague(withSiteExtras(res));
  state.fxLeagueId = NBA.siteLeague && NBA.siteLeague.id === id ? null : id;
  state.demo = false;
  state.leagueChosen = true;
  ui.viewA = null; ui.viewB = null;
  if (!wasCurrent) {
    const saved = state.leagueStates && state.leagueStates[id];
    if (saved) Object.assign(state, JSON.parse(JSON.stringify(saved)));
    else {
      Object.assign(state, { fxTeam: null, players: [], il: [], lineup: [], opp: emptyOpp(), teamName: res.league.name });
      applyLeagueRules(res.league);
    }
  }
  if (state.fxTeam) { rememberLeague(id, res.league.name); syncLeagueRules(); }
  syncLinked();
  validateLineup();
  return res.league;
}

// Make a league team "yours": load its roster and lineup, and this week's opponent
function adoptTeam(teamId) {
  const side = fxTeamSide(teamId);
  state.fxTeam = teamId;
  if (fxLeague()) rememberLeague(currentLeagueId(), fxLeague().name);
  state.players = side.players;
  state.il = side.il;
  state.lineup = side.lineup;
  state.teamName = side.name || state.teamName;
  const opp = fxOpponentFor(weekStart());
  if (opp) {
    const o = fxTeamSide(opp.id);
    state.opp = { name: o.name, week: weekStart(), fxId: opp.id, players: o.players, starters: o.starters };
  } else {
    state.opp = { name: '', week: null, players: [], starters: null, fxId: null };
  }
}

/* ---------- Landing page: connect a league, then pick your team ---------- */
const needsLanding = () => ui.addingLeague || (!state.fxTeam && !state.demo);

function viewLanding() {
  const chosen = !ui.addingLeague && state.leagueChosen && fxLeague() && !state.fxTeam;
  const step2 = chosen ? `
      <p class="land-step">Step 2 of 2</p>
      <h1>Which team is yours?</h1>
      <p class="muted">Connected to <b>${esc(fxLeague().name)}</b>. Pick your team to load your roster and this week's matchup.</p>
      ${preDraft() ? `<p class="land-note">This league hasn't drafted yet${draftWhen(fxLeague()) ? ` (draft: ${esc(draftWhen(fxLeague()))})` : ''}, so rosters are empty for now.</p>` : ''}
      <div class="land-teams">${fxPickable().map(t => `<button type="button" class="land-team" data-action="land-team" data-id="${esc(t.id)}">${esc(t.name)}</button>`).join('')}</div>
      <p class="small muted" style="margin:16px 0 0"><button class="link-btn" data-action="land-back">Use a different league</button>${(state.savedLeagues || []).length ? ' · <button class="link-btn" data-action="land-cancel">Cancel</button>' : ''}</p>` : '';
  const step1 = chosen ? '' : `
      <p class="land-step">${ui.addingLeague && state.fxTeam ? 'Add a league' : 'Courtside Manager'}</p>
      <h1>${ui.addingLeague && state.fxTeam ? 'Connect another league' : 'Plan your fantasy basketball week'}</h1>
      <p class="muted">${ui.addingLeague && state.fxTeam ? "Enter its league ID. Each league keeps its own team and notes, and you can switch between them from the menu at the top." : "Connect your Fantrax or ESPN league to see your odds for this week's matchup, the best starters for the week, how your categories stack up against the league, and how your draft is holding up."}</p>
      <form class="land-form" data-form="land-league">
        <label class="field" for="landLeague">League ID or address
          <input id="landLeague" name="leagueId" placeholder="Fantrax or ESPN league ID" autocomplete="off" spellcheck="false" autofocus>
        </label>
        <button class="btn primary" type="submit">Connect league</button>
      </form>
      <p class="form-error" id="landMsg" role="alert"></p>
      <details class="land-help">
        <summary>Where do I find my league ID?</summary>
        <p><b>Fantrax:</b> open your league on fantrax.com. The ID is the part of the address right after <b>/league/</b>:<br>
        <span class="land-url">fantrax.com/fantasy/league/<b>abc123def456</b>/home</span></p>
        <p><b>ESPN:</b> open your league on espn.com. The ID is the number after <b>leagueId=</b>:<br>
        <span class="land-url">fantasy.espn.com/basketball/league?leagueId=<b>12345678</b></span><br>
        Only public ESPN leagues can be loaded.</p>
        <p>Pasting the whole address works too.</p>
      </details>
      <p class="small muted land-foot">Built for head-to-head leagues on Fantrax and ESPN. ${ui.addingLeague && state.fxTeam ? '<button class="link-btn" data-action="land-cancel">Cancel</button>' : NBA && NBA.siteLeague ? '<button class="link-btn" data-action="land-demo">Explore a demo league instead</button>' : ''}</p>`;
  return `<div class="landing-wrap"><div class="landing-card">${step1}${step2}</div></div>`;
}
