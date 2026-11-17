// League Layer: Roster, Standings, Season totals, Trades.
// The site loads js/*.js in order (see index.html); they share one scope, like one file.
'use strict';

const DRAFT_MODE_KEY = 'league-layer-draft-mode';
ui.draftMode = store.get(DRAFT_MODE_KEY) || 'game';

const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');

// A team's real per-game numbers: counting stats per player, FG%/FT% from makes ÷ attempts
function teamRaw(players) {
  const n = players.length || 1;
  const out = {};
  for (const c of scoreCats()) {
    if (c.fp) out.fp = sum(players.map(p => fantasyPoints(p))) / n;
    else if (c.pct) {
      const att = sum(players.map(p => statVal(p, c.att)));
      out[c.key] = att ? sum(players.map(p => statVal(p, c.made))) / att : 0;
    } else out[c.key] = sum(players.map(p => statVal(p, c.key))) / n;
  }
  return out;
}

const fmtRaw = (c, v) => (c.pct ? fmtPct(v) : fmt(v, 1));

// ----- A fantasy team's card: category strengths (was a card on Standings, for your own team only) -----
// Each team's best players by their season's value (seasonTotal), as many as the league starts (injured reserve left out):
// an end-of-bench player, a one-off start or a game or two doesn't move it. Per category: the team's number, the league's
// average, how far from it (in team-to-team spreads), its rank and every team on one line; a row opens to who helped and hurt
function teamStrengths(tid) {
  const N = state.slots.length;
  const top = id => { const s = fxTeamSide(id), il = new Set(s.il); return sortDesc(s.players.filter(p => !il.has(p.id)), p => seasonTotal(nbaById.get(p.nbaId)).v).slice(0, N); };
  const teams = fxPickable().map(t => { const ps = top(t.id); return { id: t.id, name: t.name, ps, raw: teamRaw(ps) }; }).filter(t => t.ps.length);
  const me = teams.find(t => t.id === tid), n = teams.length;
  if (!me || n < 2) return '';
  const rows = scoreCats().map(c => {
    const vals = teams.map(t => t.raw[c.key]);
    const mean = sum(vals) / n;
    const sd = Math.sqrt(sum(vals.map(v => (v - mean) ** 2)) / n) || 1e-9;
    // how far each team is from the league average, in team-to-team spreads (fewer TO is better)
    const gap = v => (c.neg ? -1 : 1) * (v - mean) / sd;
    const z = gap(me.raw[c.key]);
    const rank = teams.filter(t => gap(t.raw[c.key]) - z > 1e-9).length + 1;
    // who helps or hurts: each player's own number against the league average shown in this row.
    // For FG%/FT% that's makes above or below average at the player's volume.
    const att = c.att;
    const num = p => (c.fp ? fantasyPoints(p) : statOf(p, c));
    const impact = p => (c.neg ? -1 : 1) * (c.pct ? (pctOf(p, c) - mean) * statVal(p, att) : num(p) - mean);
    const byImpact = sortDesc(me.ps.map(p => ({ p, d: impact(p) })), x => x.d);
    const big = c.pct ? 0.1 : Math.max(0.1, Math.abs(mean) * 0.1);
    const drivers = byImpact.filter(x => x.d > big).slice(0, 2);
    const drag = byImpact.filter(x => x.d < -big).slice(-1);
    const tip = x => c.pct
      ? `${x.p.name}: ${fmtPct(pctOf(x.p, c))} on ${fmt(statVal(x.p, att), 1)} attempts a game, ${fmt(Math.abs(x.d), 1)} ${x.d > 0 ? 'more' : 'fewer'} makes a game than the league average of ${fmtPct(mean)} would give`
      : `${x.p.name}: ${fmt(num(x.p), 1)} ${c.label} a game vs the league average of ${fmt(mean, 1)} per player`;
    const csName = x => `<button type="button" class="link-btn cs-name" data-action="player-detail" data-nba="${x.p.nbaId}">${inlinePlayer(x.p, esc(lastName(x.p.name)))}</button>`;
    const csNum = x => `<b class="${x.d > 0 ? 'pos-good' : 'pos-bad'}">${c.pct ? fmtPct(pctOf(x.p, c)) : fmt(num(x.p), 1)}</b>`;
    const csAtt = x => (c.pct ? `<span class="muted small"> on ${fmt(statVal(x.p, att), 1)} ${att.toUpperCase()}</span>` : '');
    const who = list => list.map(x => `<span class="cs-p" title="${esc(tip(x))}">${csName(x)}${csNum(x)}${csAtt(x)}</span>`).join('');
    const w = Math.min(Math.abs(z) / 2, 1) * 50; // bar edge = 2 spreads from the league average
    const pos = v => ((Math.max(-2.5, Math.min(2.5, gap(v))) + 2.5) / 5) * 100;
    const open = ui.csOpen.has(c.key);
    // every team on one line: this card's team the big dot, your own team orange (orange is only ever your team)
    const dot = t => `<span class="sdot${t.id === tid ? ' this' : ''}${t.id === state.fxTeam ? ' me' : ''}" style="left:${pos(t.raw[c.key]).toFixed(1)}%" title="${esc(t.name)}${t.id === state.fxTeam ? ' (you)' : ''}: ${fmtRaw(c, t.raw[c.key])}"></span>`;
    return `<tr class="cs-row" data-action="cs-toggle" data-cat="${c.key}" aria-expanded="${open}" title="Show who helped (green) and hurt (red) most">
      <td><span class="cs-chev" aria-hidden="true">▸</span><b>${c.label}</b></td>
      <td class="num"><b>${fmtRaw(c, me.raw[c.key])}</b><span class="cs-avg">avg ${fmtRaw(c, mean)}</span></td>
      <td class="num muted cs-lavg">${fmtRaw(c, mean)}</td>
      <td class="cs-bar" title="${signed(z, 2)} spreads from the league average"><span class="track"><span class="fill ${z >= 0 ? 'up' : 'down'}" style="width:${w}%"></span></span></td>
      <td class="num cs-rank ${rank <= 3 ? 'pos-good' : rank > n - 3 ? 'pos-bad' : ''}"><b>${ordinal(rank)}</b><span class="muted hide-sm"> / ${n}</span></td>
      <td class="cs-strip"><div class="strip">${teams.map(dot).join('')}</div></td>
    </tr>
    <tr class="cs-detail"${open ? '' : ' hidden'}><td colspan="6"><div class="cs-who">
      ${drivers.length || drag.length ? `${drivers.length ? `<div class="cs-grp">${who(drivers)}</div>` : ''}${drag.length ? `<div class="cs-grp">${who(drag)}</div>` : ''}` : '<span class="muted small">No one stands out</span>'}
    </div></td></tr>`;
  });
  const mine = tid === state.fxTeam;
  return `<div><h3 class="sub" style="margin-top:0">By category <span class="muted small" title="Each team's ${N} best players by their value this season (injured reserve left out), as many as a lineup starts">top ${N}, against every team</span> ${infoBtn('strengths')}</h3>
    <div class="table-wrap"><table class="cs-table">
      <thead><tr><th>Cat</th><th class="num">Per player</th><th class="num cs-lavg">League avg</th><th class="cs-bar">Below · league avg · above</th><th class="num">Rank</th><th class="cs-strip"><span class="hide-sm">Every team (${mine ? 'you in orange' : state.fxTeam ? 'this one bigger, you in orange' : 'this one bigger'})</span><span class="show-sm-inline">All ${n} teams</span></th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table></div></div>`;
}

function slotBadge(slot) {
  const pc = slot !== 'IL' && slotColor(slot);
  const cls = slot === 'IL' ? 'il' : `slot-${slot}${pc ? ` pc pc-${pc}` : ''}`;
  return `<span class="slot-label ${cls}">${slot === 'FLX' ? 'Flx' : slot === 'BN' ? 'Res' : slot === 'IL' ? 'IR' : slot}</span>`;
}

// A sortable column header. down: whether this column is currently sorted biggest-first
function sortTh(action, key, label, sort, { cls = 'num', tip = '', down, attrs = '', arrow = true } = {}) {
  const on = sort.key === key;
  return `<th class="sortable ${cls}${on ? ' sorted' : ''}" data-action="${action}" data-key="${key}"${attrs}${tip ? ` title="${tip}"` : ''} aria-sort="${on ? (down ? 'descending' : 'ascending') : 'none'}">${label}${on && arrow ? (down ? ' ↓' : ' ↑') : ''}</th>`;
}
// Clicking a header: the same column flips; a new one starts at firstDir
function nextSort(sort, key, firstDir) {
  if (sort.key === key) sort.dir *= -1;
  else { sort.key = key; sort.dir = firstDir; }
}

function statCells(p) {
  return `${SPORT.tableStats.map(([k], i) => `<td class="num">${fmt(p[k] || 0, i ? 1 : 0)}</td>`).join('')}
    ${SPORT.tablePct.map(([, , m, a]) => `<td class="num">${fmtPct(p[a] ? statVal(p, m) / p[a] : 0)}</td>`).join('')}<td class="num"><b>${fmtValue(value(p))}</b></td>`;
}

/* ---------- Standings ---------- */

function viewStandings() {
  const L = fxLeague();
  const rows = (L && L.standings) || [];
  return `
  <div class="card">
    ${rows.length ? `<div class="table-wrap"><table>
      <thead><tr><th class="num">#</th><th>Team</th><th class="num">W</th><th class="num">L</th><th class="num">T</th><th class="num">Win %</th><th class="num">GB</th>${rows.some(r => r.pf != null) ? '<th class="num">Pts for</th>' : ''}</tr></thead>
      <tbody>${rows.map(r => {
        const g = r.w + r.l + r.t;
        return `<tr${r.id === myTeamId() ? ' class="me-row"' : ''}><td class="num">${r.rank}</td><td><b>${teamLink(r.id, esc(r.name))}</b>${r.id === myTeamId() ? ' <span class="muted small">(you)</span>' : ''}</td>
          <td class="num">${r.w}</td><td class="num">${r.l}</td><td class="num">${r.t}</td><td class="num">${g ? fmt(((r.w + r.t / 2) / g) * 100, 0) + '%' : '—'}</td><td class="num">${r.gb ? fmt(r.gb, 1) : '—'}</td>${rows.some(x => x.pf != null) ? `<td class="num">${r.pf != null ? fmtFp(r.pf) : '—'}</td>` : ''}</tr>`;
      }).join('')}</tbody>
    </table></div>${waiverLine()}` : `<div class="empty"><strong>No standings yet</strong>${sourceName()} didn't return standings for this league.</div>`}
  </div>
  ${L ? seasonTotalsCard(L, rows) : ''}`;
}

// ----- A fantasy team's card: its record and this week's opponent (the title), its category strengths (teamStrengths), its roster -----
let teamCardOpen = null; // the fantasy team whose card is showing, for its table's sort (team-sort)
function showTeamCard(tid, sorting) {
  if (!sorting) ui.teamSort = { key: 'v', dir: -1 }; // (a card just opened: best first by the last column)
  const html = teamCardHtml(tid);
  if (!html) return;
  teamCardOpen = tid;
  $('#detailBody').innerHTML = html;
  $('#detailTitle').innerHTML = teamCardTitle(tid);
  cardOpen = null;
  sportCardOpen = null;
  const d = $('#detailDialog');
  if (!d.open) d.showModal();
  if (!sorting) $('#detailBody').scrollTop = 0;
}
// the card's title: the team's name, (you) on your own, then its record, standing, points for and this week's opponent
// (as an NBA team's card)
function teamCardTitle(tid) {
  const L = fxLeague(), r = L && (L.standings || []).find(x => x.id === tid), opp = L && fxOpponentFor(weekStartAt(0), tid);
  const bio = [r && `<span class="dt-rec">${r.w}-${r.l}${r.t ? '-' + r.t : ''}</span> · ${ordinal(r.rank || 0)} of ${fxPickable().length}${r.pf != null ? ` · ${fmtFp(r.pf)} points for` : ''}`,
    `<span class="dt-vs">${opp ? `This week vs <span class="dt-rec">${teamLink(opp.id)}</span>` : 'No matchup this week'}</span>`].filter(Boolean).join(' · ');
  return `<span class="dt-name">${esc(fxTeamName(tid))}${tid === state.fxTeam ? ' <span class="muted small">(you)</span>' : ''}</span><span class="dt-bio">${bio}</span>`;
}

function teamCardHtml(tid) {
  const L = fxLeague();
  if (!L || !fxPickable().some(t => t.id === tid)) return '';
  const side = fxTeamSide(tid), me = tid === state.fxTeam;
  const football = isFootball(), week = matchDates(weekStartAt(0));
  // each player's worth: football's projection this week, else his value over the whole season (seasonTotal: a game or
  // two can't top the list), with its games
  const tot = new Map(side.players.map(p => [p.id, seasonTotal(nbaById.get(p.nbaId))]));
  const worth = p => (football ? (gamesIn(p, week) ? `${fmt(footballPts(p, week), 1)}` : '<span class="muted">Bye</span>') : tot.get(p.id).gp ? fmtTotal(tot.get(p.id).v) : '—');
  const unit = football ? 'Proj' : totalLabel();
  // each player's season a game, as the Players tab's Per game shows it (the stats chosen under Stats used): games, minutes,
  // then the league's categories (a points league: every stat it scores); football shows its projection alone
  const cols = football ? [] : scoreCats().filter(c => !c.fp);
  const cell = (p, c) => {
    if (!p.gp) return '<td class="sc muted">—</td>';
    if (!c.pct) return `<td class="sc">${fmt(statVal(p, c.key), c.dec || 1)}</td>`;
    const m = statVal(p, c.made), a = statVal(p, c.att);
    return `<td class="sc"${c.rate ? '' : ` title="${c.label}: ${fmt(m, 1)}-${fmt(a, 1)} a game"`}>${!a ? '—' : c.rate ? fmt(m / a, 2) : fmtPct(m / a)}</td>`;
  };
  // the player: photo, name, then his positions in their lineup-spot colors and his NBA team; any injury under it
  const who = p => {
    const raw = nbaById.get(p.nbaId) || {};
    const inj = p.inj ? `<div class="pmeta inj" title="${esc(p.inj.note)}">${esc(p.inj.label)}${p.inj.note ? ': ' + esc(p.inj.note) : ''}</div>` : '';
    return `<td class="pf-name"><div class="bplayer">${headshot(p, 34)}<div class="bmain">
      <div class="bname">${p.nbaId ? playerBtn(p.nbaId, p.name) : `<span class="pname">${esc(p.name)}</span>`}${rookieBadge(raw, 'by-name')}</div>
      <div class="pmeta">${rookieBadge(raw, 'in-meta')}${[posTags(p.pos), p.team && teamBtn(p.team)].filter(Boolean).join(' · ')}</div>${inj}</div></div></td>`;
  };
  // every player in one list, best first by what the last column shows (football: this week's projection, a bye last),
  // or by the column whose heading was clicked (ui.teamSort; a player with nothing in that column always last);
  // injured reserve greyed where it falls (the owner's ask: no starters / bench split)
  const il = new Set(side.il);
  const order = p => (football ? (gamesIn(p, week) ? footballPts(p, week) : -1) : tot.get(p.id).gp ? tot.get(p.id).v : -1e9);
  const row = p => `<tr${il.has(p.id) ? ' class="muted-row"' : ''}>${who(p)}${football ? '' : `<td class="sc">${tot.get(p.id).gp || '—'}</td><td class="sc">${p.gp ? fmt(p.min, 1) : '—'}</td>`}${cols.map(c => cell(p, c)).join('')}<td class="num pf-v">${worth(p)}</td></tr>`;
  const so = ui.teamSort;
  const pctOf = (p, c) => { const a = statVal(p, c.att); return a ? statVal(p, c.made) / a : null; };
  const sortVal = p => (so.key === 'v' ? ((football ? gamesIn(p, week) : tot.get(p.id).gp) ? order(p) : null) : so.key === 'name' ? p.name.toLowerCase() : so.key === 'gp' ? tot.get(p.id).gp || null
    : !p.gp || (so.key !== 'min' && !cols[so.key]) ? null : so.key === 'min' ? p.min : cols[so.key].pct ? pctOf(p, cols[so.key]) : statVal(p, cols[so.key].key));
  const vals = new Map(side.players.map(p => [p, sortVal(p)]));
  const rows = sortDesc(side.players, order).sort((a, b) => { // (ties and empty cells stay best first)
    const x = vals.get(a), y = vals.get(b);
    return x == null || y == null ? (x == null) - (y == null) : (x < y ? -1 : x > y ? 1 : 0) * so.dir;
  }).map(row).join('');
  const th = (key, label, cls, tip, attrs) => sortTh('team-sort', key, label, so, { cls, tip, attrs, down: so.dir < 0 });
  const cats = football ? '' : teamStrengths(tid);
  // (each part 16 px below the one before: .tc-body)
  return `<div class="tc-body">
    ${!me && state.fxTeam ? `<div><button type="button" class="btn sm" data-action="team-compare" data-team="${esc(tid)}">Compare on Plan Ahead</button></div>` : ''}
    ${cats}
    <div class="perf-wrap"><table class="perf-table tc-roster"><thead><tr>${th('name', 'Player', 'pf-name')}${football ? '' : th('gp', 'GP', 'sc', 'Games played') + th('min', 'MIN', 'sc', 'Minutes a game')}${cols.map((c, i) => th(i, c.label, 'sc')).join('')}${th('v', unit, 'num pf-v', '', football ? '' : ` data-tip="${esc(seasonTotalTip())}"`)}</tr></thead>
      <tbody>${rows}</tbody></table></div></div>`;
}

// ----- Season totals: what each team's starters actually produced -----
// Fantrax returns every lineup period's rosters. A player's games count for a team only in periods he
// was ACTIVE there, using this season's box scores (data/boxscores.json, loaded when Standings opens).
let boxLoad = null;
let BOX = null; // { byPlayer, finals } once data/boxscores.json has loaded
keep('sport', () => { BOX = null; boxLoad = null; });
const seasonTot = {}; // league id -> { state: 'loading' | 'ready' | 'error', teams, msg }
keep('box league', id => dropKept(seasonTot, id));

function rosterPeriodsOf(L) {
  if (L.rosterPeriods && L.rosterPeriods.length) return L.rosterPeriods.map(([n, start, end]) => ({ n, start, end }));
  return (L.periods || []).map(p => ({ n: p.n, start: p.lock, end: p.endAt })); // weekly leagues lock by scoring period
}
// a game day belongs to a period from its first day; the last day only if the period runs into the night
const periodHas = (p, d) => d >= p.start.slice(0, 10) && (d < p.end.slice(0, 10) || (d === p.end.slice(0, 10) && +p.end.slice(11, 13) >= 21));

// a box score line with the counts some leagues score: double-doubles, triple-doubles, games
function boxCounts(st) {
  const tens = ['pts', 'reb', 'ast', 'stl', 'blk'].filter(k => st[k] >= 10).length;
  return Object.assign(st, { dd: +(tens >= 2), td: +(tens >= 3), gp1: 1 });
}

// The season's box scores as the daily job publishes them: one file per month (NBA.box: month -> its version, which is in
// the file's address), so the browser keeps a finished month and downloads only the month underway each day. A data file
// from before months had the whole season in boxscores.json, new every day.
async function boxFiles() {
  const dir = SPORT.data, months = Object.entries(NBA.box || {});
  const get = async url => { const r = await fetch(url); if (!r.ok) throw new Error(`box scores ${r.status}`); return r.json(); };
  if (!months.length) return get(`${dir}boxscores.json?v=${encodeURIComponent(NBA.updated || '')}`);
  const parts = await Promise.all(months.map(([month, v]) => get(`${dir}box/${month}.json?v=${v}`)));
  return { ...parts[0], games: Object.assign({}, ...parts.map(p => p.games)) };
}

function loadBoxes() {
  boxLoad = boxLoad || boxFiles().then(data => {
    const unique = new Map(), cols = data.keys || SPORT.boxCols; // (a box row's columns, as boxGameLog reads them too)
    for (const [gid, g] of Object.entries(data.games || {})) {
      const key = `${g.d} ${g.home} ${g.away}`;
      if (!unique.has(key) || !gid.startsWith('espn:')) unique.set(key, g);
    }
    const byPlayer = new Map(); // NBA id -> [[date, stats]]
    const finals = new Set(); // "date team" for every finished game
    const scores = new Map(); // "date team" -> { home, away, hs, as, last } (last: hockey's REG / OT / SO)
    for (const g of unique.values()) {
      finals.add(`${g.d} ${g.home}`).add(`${g.d} ${g.away}`);
      const s = { home: g.home, away: g.away, hs: g.hs, as: g.as, last: g.last };
      scores.set(`${g.d} ${g.home}`, s).set(`${g.d} ${g.away}`, s);
      for (const row of g.rows) {
        const st = boxCounts(Object.fromEntries(cols.map((k, i) => [k, +row[i + 2] || 0])));
        const margin = row[1] === g.home ? g.hs - g.as : g.as - g.hs;
        if (!byPlayer.has(row[0])) byPlayer.set(row[0], []);
        byPlayer.get(row[0]).push([g.d, st, margin, row[1]]);
      }
    }
    BOX = { cols, byPlayer, finals, scores, day: new Map([...byPlayer].map(([id, games]) => [id, new Map(games.map(([d, st, margin]) => [d, { ...st, margin }]))])) };
    dropPlayedInjuries();
    return BOX;
  }).catch(e => { boxLoad = null; throw e; });
  return boxLoad;
}

// This season's Season totals and Awards: the shared weekly rosters (Fantrax ids) mapped to NBA players
const currentFidNba = () => { const m = new Map(NBA.players.filter(r => r.fx).map(r => [r.fx.id, r.id])); return f => m.get(f) || null; };
async function buildSeasonTotals(L) {
  const [weeks, G] = await Promise.all([loadRosterWeeks(L), loadGameLog('cur')]);
  if (!weeks || !G) return {};
  return pastSeasonTotals({ ...L, weeks, fidNba: currentFidNba() }, G);
}

// A season's totals: every game each starter played in a week he was in the lineup, from the weekly
// rosters (kept on this device) and that season's game log (archived, or this season's box scores)
function pastSeasonTotals(L, G) {
  const teams = {};
  for (const w of L.weeks) {
    const wd = periodDays(G, w);
    for (const [f, o] of w.owner) {
      if (!o.on) continue;
      const T = teams[o.tid] = teams[o.tid] || { gp: 0, s: {} };
      const nba = L.fidNba(f);
      // one-game leagues: only the game that counted
      for (const r of countedRows(L, G, w, f, ((nba && G.players.get(nba)) || []).filter(r => wd.has(r[0])))) {
        T.gp++;
        for (const [k, v] of Object.entries(gameLine(G, r))) T.s[k] = (T.s[k] || 0) + v;
      }
    }
  }
  return teams;
}

function seasonTotalsCard(L, standings) {
  const head = `<div class="card-head"><h2>Season totals ${infoBtn('totals')}</h2><span class="muted small">from each ${leagueLineupMode(L) === 'daily' && !isFootball() ? "day's" : "week's"} starting lineups</span></div>`;
  const note = msg => `<div class="card" style="margin-top:16px">${head}<p class="muted small" style="margin:0">${msg}</p></div>`;
  let teams;
  if (seasonCtx) {
    // a past season: its weekly lineups and its game log (loaded the first time it's needed)
    if (!L.weeks) return note("Fantrax didn't return this season's weekly rosters.");
    if (!L.season || !(L.season in gameLogs)) {
      if (L.season) loadGameLog(L.season).then(() => { if (ui.tab === 'standings' && ui.season) render(); });
      return L.season ? note(`${loaderMark('sm')}Loading the season’s games…`) : note(`No ${SPORT.name} game logs are saved for this season.`);
    }
    if (!gameLogs[L.season]) return note(`No ${SPORT.name} game logs are saved for this season (the site has 2016-17 on).`);
    teams = pastSeasonTotals(L, gameLogs[L.season]);
  } else if (!hasLineupHistory(L)) {
    return note(`Season totals need every day's lineups, which the site reads from Fantrax and Sleeper only for now, not ${sourceName(L)}.`);
  } else {
    const id = L.id;
    const S = seasonTot[id];
    if (!S) {
      seasonTot[id] = { state: 'loading' };
      buildSeasonTotals(L).then(t => { seasonTot[id] = { state: 'ready', teams: t }; })
        .catch(e => { seasonTot[id] = { state: 'error', msg: e.message }; })
        .finally(() => { if (ui.tab === 'standings' && !ui.season) render(); });
    }
    if (!S || S.state === 'loading') return note(`${loaderMark('sm')}Loading every lineup from Fantrax…`);
    if (S.state === 'error') return note(`Couldn't load season totals (${esc(S.msg)}).`);
    teams = S.teams;
  }

  // totals of any scored stat, derived ones included
  const tot = (T, k) => (DERIVED[k] ? sum(Object.entries(DERIVED[k]).map(([b, c]) => (T.s[b] || 0) * c)) : T.s[k] || 0);
  const sc = leaguePoints();
  const cols = sc
    ? [...Object.keys(STAT_LABEL).filter(k => sc[k]).map(k => ({ label: STAT_LABEL[k], neg: sc[k] < 0, val: T => tot(T, k), fmt: v => fmt(v, 0) })),
      { label: 'FP', val: T => sum(Object.entries(sc).map(([k, v]) => tot(T, k) * v)), fmt: v => fmtFp(v) }]
    : scoreCats().map(c => ({ label: c.label, neg: c.neg,
      val: c.pct ? (T => (tot(T, c.att) ? tot(T, c.made) / tot(T, c.att) : 0)) : T => tot(T, c.key),
      fmt: c.pct ? fmtPct : v => fmt(v, c.dec ? 1 : 0) }));
  const order = standings.length ? standings.map(r => r.id) : fxPickable().map(t => t.id);
  const list = order.map(tid => ({ tid, T: teams[tid] || { gp: 0, s: {} } }));
  const stats = cols.map(c => {
    const vals = list.map(x => c.val(x.T));
    const m = sum(vals) / vals.length;
    const sd = Math.sqrt(sum(vals.map(v => (v - m) ** 2)) / vals.length) || 1e-9;
    return { vals, z: v => (c.neg ? -1 : 1) * (v - m) / sd, rank: v => 1 + vals.filter(x => (c.neg ? x < v : x > v)).length };
  });
  const avgRank = i => sum(stats.map(st => st.rank(st.vals[i]))) / cols.length;
  // sort by any column: best first (clicking again flips it); standings order until a column is picked, or when the one
  // picked isn't in this league's table (picked in a league with more columns: a 9-category one, then a points one)
  const so = ui.totSort;
  if (so.key != null && !['team', 'gp', 'rank'].includes(so.key) && !cols[so.key]) so.key = null;
  const sortVal = i => (so.key === 'team' ? (fxTeamName(list[i].tid) || '').toLowerCase() : so.key === 'gp' ? list[i].T.gp
    : so.key === 'rank' ? -avgRank(i) : (cols[so.key].neg ? -1 : 1) * stats[so.key].vals[i]);
  const idx = list.map((x, i) => i);
  if (so.key != null) idx.sort((a, b) => { const x = sortVal(a), y = sortVal(b); return (x < y ? 1 : x > y ? -1 : 0) * so.dir; });
  const th = (key, label, cls = 'num', tip = '') => sortTh('tot-sort', key, label, so, { cls, tip, down: so.dir > 0 });
  return `<div class="card" style="margin-top:16px">
    ${head}
    <div class="table-wrap"><table class="season-tot">
      <thead><tr>${th('team', 'Team', '')}${th('gp', 'Player games', 'num', 'Games played by the players in each starting lineup, added up')}${cols.map((c, j) => th(j, c.label)).join('')}${sc ? '' : th('rank', 'Avg rank', 'num', 'Average rank across the categories')}</tr></thead>
      <tbody>${idx.map(i => { const x = list[i]; return `<tr${x.tid === myTeamId() ? ' class="me-row"' : ''}><td><b>${teamLink(x.tid, esc(fxTeamName(x.tid) || ''))}</b></td><td class="num muted">${x.T.gp}</td>
        ${cols.map((c, j) => { const v = stats[j].vals[i]; return `<td class="num" style="${shade(stats[j].z(v))}" title="${c.label}: ${ordinal(stats[j].rank(v))} of ${list.length}">${c.fmt(v)}</td>`; }).join('')}
        ${sc ? '' : `<td class="num"><b>${fmt(avgRank(i), 1)}</b></td>`}</tr>`; }).join('')}</tbody>
    </table></div>
  </div>`;
}

/* ---------- Trade ---------- */
function viewTrade() {
  if (ui.tradeLink && state.fxTeam && NBA) applyTradeLink(); // (a shared trade, once your team is known)
  if (ui.tradeSeen && !fxPickable().some(t => t.id === ui.tradeSeen.from)) ui.tradeSeen = null; // (another league's)
  // the other side of the deal is another team's Fantrax roster
  const others = fxPickable().filter(t => t.id !== state.fxTeam);
  if (!others.some(t => t.id === ui.tradeTeam)) { ui.tradeTeam = others.length ? others[0].id : null; ui.tradeGet.clear(); }
  const theirs = ui.tradeTeam ? fxTeamSide(ui.tradeTeam).players : [];
  // prune selections that no longer exist (their players are picked by NBA id: they're rebuilt every render)
  for (const id of ui.tradeGive) if (!state.players.some(p => p.id === id)) ui.tradeGive.delete(id);
  for (const id of ui.tradeGet) if (!theirs.some(p => String(p.nbaId) === id)) ui.tradeGet.delete(id);

  const pick = (list, set, side, key) => list.length ? `<ul class="pick-list">${sortDesc(list, value).map(p => `
    <li><label><input type="checkbox" data-change="trade" data-side="${side}" value="${key(p)}" ${set.has(key(p)) ? 'checked' : ''}>
      <span class="grow">${playerCell(p)}</span>${p.status !== 'Healthy' ? statusBadge(p) : ''}<span class="val">${fmtValue(value(p))}</span></label></li>`).join('')}</ul>`
    : `<p class="muted small">${side === 'get' ? (others.length ? 'This team has no players yet.' : 'Connect a league to trade with its teams.') : 'Your roster is empty.'}</p>`;

  const give = [...ui.tradeGive].map(byId).filter(Boolean);
  const get = theirs.filter(p => ui.tradeGet.has(String(p.nbaId)));
  let result = `<div class="empty"><strong>Pick players on both sides</strong>See how the deal changes your team's per-game production.</div>`;

  if (give.length || get.length) {
    const active = state.players.filter(p => !state.il.includes(p.id));
    const before = totals(active);
    const after = totals([...active.filter(p => !ui.tradeGive.has(p.id)), ...get]);
    // over a waiver player: each player in a deal takes a roster spot someone off waivers could fill
    const wv = waiverValue(), over = p => gameWorth(p) - wv; // (a goalie for his share of his team's games, as the waiver player's)
    const vGive = sum(give.map(over)), vGet = sum(get.map(over));
    const diff = vGet - vGive;
    const tradeCats = scoreCats();
    const rows = tradeCats.map(c => {
      const d = after[c.key] - before[c.key];
      const good = c.neg ? d < 0 : d > 0;
      const shown = c.pct ? signed(d * 100, 1) + '%' : signed(d, 1);
      return `<tr><td><b>${c.label}</b></td><td class="num">${c.pct ? fmtPct(before[c.key]) : fmt(before[c.key])}</td><td class="num">${c.pct ? fmtPct(after[c.key]) : fmt(after[c.key])}</td><td class="num ${Math.abs(d) < 1e-9 ? 'muted' : good ? 'pos-good' : 'pos-bad'}">${shown}</td></tr>`;
    }).join('');
    const rosterAfter = activeCount() - give.length + get.length;
    const verdict = Math.abs(diff) < (isPoints() ? 2 : 0.04) ? ['Roughly even', 'muted'] : diff > 0 ? ['You win this trade', 'pos-good'] : ['You lose this trade', 'pos-bad'];
    const won = tradeCats.filter(c => { const d = after[c.key] - before[c.key]; return c.neg ? d < -1e-9 : d > 1e-9; }).length;
    result = `
      <div class="card-head"><div><div class="verdict ${verdict[1]}">${verdict[0]}</div><div class="muted small">${valueLabel()} over a waiver player ${infoBtn('tradeValue')}: give ${fmtValue(vGive)} · get ${fmtValue(vGet)} · net <b>${fmtValue(diff)}</b>${isPoints() ? '' : ` · improves ${won} of ${tradeCats.length} cats`}</div></div></div>
      ${rosterAfter > rosterLimit() ? `<p class="alert warn small" style="margin:0 0 12px">This puts you at ${rosterAfter}/${rosterLimit()} — you'd need to drop ${rosterAfter - rosterLimit()}.</p>` : ''}
      <div class="table-wrap"><table class="delta-table">
        <thead><tr><th>Category</th><th class="num">Now</th><th class="num">After</th><th class="num">Change</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <p class="small muted" style="margin:10px 0 0">Totals are per game across your active (non-IL) roster.</p>`;
  }

  // the deal for both sides, to share: under the pickers, or above them when a league mate's link brought someone else's
  const deal = tradeDeal(), proposal = deal ? tradeCard(deal) : '';
  return `${ui.tradeSeen ? proposal : ''}
  <div class="trade-grid">
    <div class="card"><div class="card-head"><h2>You give</h2><span class="muted small">${give.length} selected</span></div>${pick(state.players, ui.tradeGive, 'give', p => p.id)}</div>
    <div class="card"><div class="card-head"><h2>You get</h2>${others.length ? `<select class="trade-team" data-change="trade-team" aria-label="Team to trade with">${others.map(t => `<option value="${esc(t.id)}" ${t.id === ui.tradeTeam ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>` : ''}<span class="muted small">${get.length} selected</span></div>${pick(theirs, ui.tradeGet, 'get', p => String(p.nbaId))}</div>
  </div>
  ${ui.tradeSeen ? '' : proposal}
  <div class="card" style="margin-top:16px">${result}</div>`;
}

/* ---------- Trade proposal: both sides of a deal, with photos and per-game numbers, to share with the other team ---------- */
// A deal: { from, to, give, get }: team `from` sends `give` and receives `get` (players by data id, as text). The pickers
// make one (you are `from`, with players picked on both sides); a shared link carries one (tradeUrl, openSharedLink).
function tradeDeal() {
  if (ui.tradeSeen) return ui.tradeSeen;
  const give = [...ui.tradeGive].map(byId).filter(p => p && p.nbaId != null).map(p => String(p.nbaId)), get = [...ui.tradeGet];
  return state.fxTeam && ui.tradeTeam && give.length && get.length ? { from: state.fxTeam, to: ui.tradeTeam, give, get } : null;
}

// A shared trade, once your team is known: either of its teams gets it in the pickers, from their side (what they'd send
// on the left); anyone else sees it as it was sent, above the pickers (ui.tradeSeen, until they pick or close it)
function applyTradeLink() {
  const T = ui.tradeLink, me = state.fxTeam, teams = fxPickable().map(t => t.id);
  ui.tradeLink = null;
  if (!teams.includes(T.from) || !teams.includes(T.to) || T.from === T.to) return;
  ui.tradeGive.clear(); ui.tradeGet.clear(); ui.tradeSeen = null;
  if (me !== T.from && me !== T.to) { ui.tradeSeen = T; return; }
  const [mine, theirs] = me === T.from ? [T.give, T.get] : [T.get, T.give];
  ui.tradeTeam = me === T.from ? T.to : T.from;
  for (const p of state.players) if (mine.includes(String(p.nbaId))) ui.tradeGive.add(p.id);
  const onTheirs = new Set(fxTeamSide(ui.tradeTeam).players.map(p => String(p.nbaId)));
  for (const id of theirs) if (onTheirs.has(id)) ui.tradeGet.add(id);
  // a player who has changed teams since the link was made drops out of the deal: say so
  const gone = mine.length + theirs.length - ui.tradeGive.size - ui.tradeGet.size;
  if (gone) toast(`${gone === 1 ? 'A player' : `${gone} players`} in the shared trade ${gone === 1 ? 'is' : 'are'} on another team now`);
}

// The league's categories, fantasy points first in a points league
const dealCats = () => { const cs = scoreCats(); return [...cs.filter(c => c.fp), ...cs.filter(c => !c.fp)]; };
// a category's number as the site shows it; null (no attempts: a side without a goalie has no GAA) is a dash
const dealShow = (c, v) => (v == null ? '—' : c.rate ? fmt(v, 2) : c.pct ? fmtPct(v) : fmt(v, c.dec || 1));
// a shooting category's volume: makes and attempts a game ("7.2-14.5")
const dealVol = (made, att) => `${fmt(made, 1)}-${fmt(att, 1)}`;
// One player's average game in the league's categories (a goalie's in the goalie ones), minutes first; a percentage with
// its makes and attempts, as the Recap's lines show them ("7.2-14.5 FG (.496)")
function dealLine(p) {
  const goalie = isGoalie(p), parts = p.min ? [`${fmt(p.min, 1)} MIN`] : [];
  for (const c of dealCats()) {
    if (isHockey() && SPORT.goalieCats.includes(c.key) !== goalie) continue;
    const m = c.pct && statVal(p, c.made), a = c.pct && statVal(p, c.att);
    if (c.pct && !c.rate) parts.push(`${dealVol(m, a)} ${c.label.replace('%', '')} (${a ? fmtPct(m / a) : '—'})`);
    else parts.push(`${dealShow(c, c.pct ? (a ? pctOf(p, c) : null) : statOf(p, c))} ${c.label}`);
  }
  return parts;
}

// Both sides of a deal, for the card, the picture and the text: what each team gets (players as the Players tab has
// them, best first), its value over a waiver player (as the verdict counts it) and its per-game totals, then the
// comparison's rows: { key, label, sa, sb (as shown), lead: 1 (the first side's is better), -1, or 0 (even, or no number),
// and for a shooting percentage va, vb (makes-attempts a game) and ta, tb (what the volume adds, for a tip) }
function tradeModel(T) {
  const rawOf = id => nbaById.get(+id) || nbaById.get(id);
  const wv = waiverValue(), over = p => gameWorth(p) - wv;
  const side = (tid, ids) => {
    const players = sortDesc(ids.map(rawOf).filter(Boolean).map(raw => playerFromRaw(raw)), value);
    return { tid, name: fxTeamName(tid) || 'Team', players, value: sum(players.map(over)), tot: totals(players) };
  };
  const A = side(T.from, T.get), B = side(T.to, T.give);
  const row = (key, label, a, b, show, neg) => {
    const sa = show(a), sb = show(b);
    return { key, label, sa, sb, lead: a == null || b == null || sa === sb ? 0 : (neg ? a < b : a > b) ? 1 : -1 };
  };
  const catOf = (t, c) => (c.fp ? t.fp : c.pct ? (t[c.att] ? t[c.made] / t[c.att] : null) : lineStat(t, c.key));
  // a shooting percentage counts its volume, as Value does: the better side adds more makes over what the league's
  // average percentage would give on its attempts (a .513 on 4 shots a game isn't better than a .498 on 15)
  const shotRow = c => {
    const r = row(c.key, c.label, catOf(A.tot, c), catOf(B.tot, c), v => dealShow(c, v), c.neg), avg = BASE[c.key] && BASE[c.key][0];
    const what = c.made === 'sv' ? 'saves' : c.made === 'fow' ? 'faceoffs won' : 'makes';
    const over = t => (t[c.att] && avg ? (c.neg ? -1 : 1) * (t[c.made] - avg * t[c.att]) : null);
    const tip = t => (over(t) == null ? '' : `${dealVol(t[c.made], t[c.att])} a game: ${fmt(Math.abs(over(t)), 1)} ${over(t) >= 0 ? 'more' : 'fewer'} ${what} than the league's average of ${fmtPct(avg)} would give`);
    const [oa, ob] = [over(A.tot), over(B.tot)];
    return { ...r, va: A.tot[c.att] ? dealVol(A.tot[c.made], A.tot[c.att]) : '', vb: B.tot[c.att] ? dealVol(B.tot[c.made], B.tot[c.att]) : '', ta: tip(A.tot), tb: tip(B.tot),
      lead: oa == null || ob == null ? r.lead : Math.abs(oa - ob) < 0.05 ? 0 : oa > ob ? 1 : -1 };
  };
  const rows = [row('value', valueLabel(), A.value, B.value, v => fmtValue(v)),
    ...dealCats().map(c => (c.pct && !c.rate ? shotRow(c) : row(c.key, c.label, catOf(A.tot, c), catOf(B.tot, c), v => dealShow(c, v), c.neg)))];
  return { A, B, rows };
}

// The proposal on the Trades tab: each side's players with their photos and lines, then the sides compared per game.
// In your own deal your side's better numbers are green and the other side's red; a league mate's deal stays neutral.
function tradeCard(T) {
  const M = tradeModel(T), seen = ui.tradeSeen === T, me = myTeamId();
  const mineAt = M.A.tid === me ? 1 : M.B.tid === me ? -1 : 0;
  const sideHtml = S => `<section class="tp-side"><h3 class="tp-who">${teamLink(S.tid)} gets</h3>
    <ul class="tp-list">${S.players.map(p => `<li>
      <div class="bplayer">${headshot(p, hsPx(40, 36))}<div class="bmain"><div>${playerBtn(p.nbaId, p.name)}${p.inj ? ` ${injBadge(p.inj)}` : ''}</div>
        <div class="pmeta">${p.team ? teamBtn(p.team) : 'FA'} · ${posTags(p.pos)} · ${p.gp} GP</div></div><span class="val" title="${valueLabel()} per game">${fmtValue(value(p))}</span></div>
      <div class="rc-stats tp-line">${dealLine(p).map(x => `<span>${x}</span>`).join(' · ')}</div></li>`).join('')}</ul></section>`;
  const cls = (r, col) => (r.lead !== col ? '' : ` tp-lead${mineAt ? (col === mineAt ? ' pos-good' : ' pos-bad') : ''}`);
  const cell = (r, col, v, vol, tip) => `<td class="num${cls(r, col)}"${tip ? ` title="${esc(tip)}"` : ''}>${v}${vol ? `<div class="tp-vol">${vol}</div>` : ''}</td>`;
  const rows = M.rows.map(r => `<tr${r.key === 'value' ? ' class="tp-val"' : ''}><td><b>${r.label}</b>${r.key === 'value' ? ` ${infoBtn('tradeValue')}<div class="muted small">over a waiver player</div>` : ''}</td>
    ${cell(r, 1, r.sa, r.va, r.ta)}${cell(r, -1, r.sb, r.vb, r.tb)}</tr>`).join('');
  const shots = M.rows.some(r => r.va || r.vb);
  return `<div class="card tp">
    <div class="card-head"><h2>Trade proposal</h2><div class="tp-btns">${seen ? '<button type="button" class="btn sm" data-action="trade-seen-close">Close</button>' : ''}<button type="button" class="btn sm primary" data-action="trade-share">Share</button></div></div>
    ${seen ? `<p class="muted small tp-note">A trade a league mate shared, between ${teamLink(M.A.tid)} and ${teamLink(M.B.tid)}.</p>` : ''}
    <div class="tp-sides">${sideHtml(M.A)}${sideHtml(M.B)}</div>
    <h3 class="sub tp-sub">Per game, side by side</h3>
    <div class="table-wrap"><table class="tp-cmp">
      <thead><tr><th></th><th class="num">${esc(M.A.name)} gets</th><th class="num">${esc(M.B.name)} gets</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p class="small muted tp-foot">Each player's average game (${basisLabel().toLowerCase()}), each side's added up.${shots ? ` ${TRADE_SHOTS}` : ''}</p>
  </div>`;
}
// what a percentage row says about volume (the card's and the picture's)
const TRADE_SHOTS = 'Percentages count volume: makes-attempts a game under each, and the better side is the one with more makes over the league average on its attempts.';

// Sharing it (shareWith, recap.js): a picture, or the text and a link that opens the deal on the Trades tab
const tradeUrl = (L, T) => `${location.origin}${location.pathname}?league=${encodeURIComponent(L.id)}&from=${encodeURIComponent(T.from)}&to=${encodeURIComponent(T.to)}`
  + `&give=${T.give.map(encodeURIComponent).join(',')}&get=${T.get.map(encodeURIComponent).join(',')}#trade`;
const tradeText = (L, M) => [`${SPORT.emoji} ${L.name} · Trade proposal`,
  ...[M.A, M.B].map(S => `${S.name} gets: ${S.players.map(p => `${p.name} (${p.team || 'FA'})`).join(', ')}`)].join('\n\n');
function tradeShare(L, T) {
  const M = tradeModel(T);
  return {
    title: 'Trade proposal', name: `${L.name} · Trade proposal`, what: 'Trade proposal', link: 'Side by side', text: tradeText(L, M), url: tradeUrl(L, T),
    file: `${L.name.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'league'}-trade.png`, alt: `Trade proposal between ${M.A.name} and ${M.B.name}`,
    draw: () => tradeCanvas(L, M),
  };
}

// The picture: each side in a card (what it gets: photos, positions, each player's average game), a swap mark between
// them, then the comparison with each row's better number picked out, and what Value means
async function tradeCanvas(L, M) {
  const n = M.A.players.length + M.B.players.length;
  const K = await sharePad(Math.max(5000, 1400 + n * 300 + M.rows.length * 64)), { C, W, inner, ctx, font, text, round, photo } = K;
  let y = K.top({ kicker: 'TRADE PROPOSAL', title: L.name, sub: `${fmtDay(todayIso())} · per game, ${basisLabel().toLowerCase()}` });
  const d = 104, x0 = C.pad + 32, right = W - C.pad - 32, tx = x0 + d + 28;
  let swapY = 0;
  for (const S of [M.A, M.B]) {
    // measured first: each player's stats wrap to the width beside his photo
    const rows = S.players.map(p => {
      font(27); const stats = wrapText(ctx, dealLine(p).join(' · '), right - tx, ' · ');
      return { p, stats, h: Math.max(d, 88 + stats.length * 37) };
    });
    const h = 28 + 52 + sum(rows.map(r => r.h)) + (rows.length - 1) * 36 + 30;
    round(C.pad, y, inner, h, 24, C.card);
    let ty = y + 28;
    font(26, 800); text(fitText(ctx, `${S.name} gets`.toUpperCase(), right - x0), x0, ty, C.accent);
    ty += 52;
    rows.forEach((r, i) => {
      if (i) { ctx.fillStyle = C.line; ctx.fillRect(x0, ty + 16, right - x0, 2); ty += 36; }
      const p = r.p;
      photo(p, x0, ty, d);
      font(30, 800); const pv = fmtValue(value(p)), pvW = ctx.measureText(pv).width;
      text(pv, right, ty + 6, C.text, 'right');
      font(38, 800); text(fitText(ctx, p.name, right - tx - pvW - 20), tx, ty);
      // his team, his positions in their colors (as on the site: slotInk), games, and an injury in red
      const runs = [[`${p.team || 'FA'} · `, C.muted], ...p.pos.flatMap((x, j) => [...(j ? [[',', C.muted]] : []), [x, slotInk(x) || C.muted, 700]]),
        [` · ${p.gp} GP`, C.muted], ...(p.inj ? [[` · ${p.status.toUpperCase()}`, '#f87171']] : [])];
      let rx = tx;
      for (const [t, color, weight] of runs) { font(26, weight || 400); text(t, rx, ty + 48, color); rx += ctx.measureText(t).width; }
      font(27); r.stats.forEach((l, j) => text(l, tx, ty + 88 + j * 37, '#d5d9e0'));
      ty += r.h;
    });
    y += h;
    if (!swapY) { swapY = y + 22; y += 44; }
  }
  // the swap mark: an up and a down arrow in a circle, over the gap between the sides
  ctx.fillStyle = C.accent; ctx.beginPath(); ctx.arc(W / 2, swapY, 34, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = C.bg; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const [x, dir] of [[W / 2 - 9, -1], [W / 2 + 9, 1]]) {
    ctx.beginPath(); ctx.moveTo(x, swapY - 14 * dir); ctx.lineTo(x, swapY + 14 * dir);
    ctx.moveTo(x - 7, swapY + 7 * dir); ctx.lineTo(x, swapY + 14 * dir); ctx.lineTo(x + 7, swapY + 7 * dir); ctx.stroke();
  }

  // side by side: the row's name, then each side's number, the better one on an orange pill
  y += 48;
  font(28, 800); text('SIDE BY SIDE · PER GAME', C.pad, y, C.accent); y += 52;
  // (a shooting row is taller: its makes-attempts a game under each number)
  const labW = 230, colW = (right - x0 - labW) / 2, mid = [x0 + labW + colW / 2, x0 + labW + colW * 1.5], rowH = r => (r.va || r.vb ? 92 : 60);
  const h = 28 + 48 + sum(M.rows.map(rowH)) + 16;
  round(C.pad, y, inner, h, 24, C.card);
  let ty = y + 28;
  font(26, 800);
  [M.A, M.B].forEach((S, i) => text(fitText(ctx, S.name, colW - 16), mid[i], ty, C.text, 'center'));
  ty += 48;
  for (const r of M.rows) {
    ctx.fillStyle = C.line; ctx.fillRect(x0, ty, right - x0, 2);
    font(28, 700); text(r.label, x0, ty + 16, '#d5d9e0');
    [[r.sa, r.va], [r.sb, r.vb]].forEach(([v, vol], i) => {
      const lead = r.lead === (i ? -1 : 1);
      font(31, lead ? 800 : 500);
      if (lead) { const w = ctx.measureText(v).width + 32; ctx.globalAlpha = 0.2; round(mid[i] - w / 2, ty + 8, w, 46, 23, C.accent); ctx.globalAlpha = 1; }
      text(v, mid[i], ty + 15, lead ? C.accent : r.lead ? C.muted : C.text, 'center');
      if (vol) { font(23); text(vol, mid[i], ty + 58, C.muted, 'center'); }
    });
    ty += rowH(r);
  }
  y += h + 22;
  font(24);
  const notes = [`${valueLabel()}: what each side's players add per game${isPoints() ? ' in fantasy points' : ' to winning categories'}, less a waiver player for each roster spot they take.`];
  if (M.rows.some(r => r.va || r.vb)) notes.push(TRADE_SHOTS);
  for (const note of notes) { for (const l of wrapText(ctx, note, inner)) { text(l, C.pad, y, C.muted); y += 34; } y += 8; }
  return K.done(y);
}
