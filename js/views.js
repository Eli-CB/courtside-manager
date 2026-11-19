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
  // a points league's shooting pair (lineCats): makes and attempts per player, and its points (what it's ranked on) under `fgm:fp`
  for (const c of lineCats()) {
    if (!c.shot) continue;
    for (const k of [c.made, c.att]) out[k] = sum(players.map(p => statVal(p, k))) / n;
    out[`${c.key}:fp`] = sum(players.map(p => fantasyPoints(p, shotPoints(c)))) / n;
  }
  return out;
}

const fmtRaw = (c, v) => (c.pct ? fmtPct(v) : fmt(v, 1));
// a category's number in a team's per-player line (teamRaw): a shooting pair's as "4.8/10.2"
const rawShown = (c, raw) => (c.shot ? shotVol(raw[c.made], raw[c.att]) : fmtRaw(c, raw[c.key]));

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
  const rows = lineCats().map(c => {
    const key = c.shot ? `${c.key}:fp` : c.key; // (a shooting pair by its points)
    const vals = teams.map(t => t.raw[key]);
    const mean = sum(vals) / n;
    const sd = Math.sqrt(sum(vals.map(v => (v - mean) ** 2)) / n) || 1e-9;
    // how far each team is from the league average, in team-to-team spreads (fewer TO is better)
    const gap = v => (c.neg ? -1 : 1) * (v - mean) / sd;
    const z = gap(me.raw[key]);
    const rank = teams.filter(t => gap(t.raw[key]) - z > 1e-9).length + 1;
    // who helps or hurts: each player's own number against the league average shown in this row.
    // For FG%/FT% that's makes above or below average at the player's volume.
    const att = c.att;
    const num = p => (c.fp ? fantasyPoints(p) : c.shot ? fantasyPoints(p, shotPoints(c)) : statOf(p, c));
    const vol = p => shotVol(statVal(p, c.made), statVal(p, c.att));
    const impact = p => (c.neg ? -1 : 1) * (c.pct ? (pctOf(p, c) - mean) * statVal(p, att) : num(p) - mean);
    const byImpact = sortDesc(me.ps.map(p => ({ p, d: impact(p) })), x => x.d);
    const big = c.pct ? 0.1 : Math.max(0.1, Math.abs(mean) * 0.1);
    const drivers = byImpact.filter(x => x.d > big).slice(0, 2);
    const drag = byImpact.filter(x => x.d < -big).slice(-1);
    const tip = x => c.pct
      ? `${x.p.name}: ${fmtPct(pctOf(x.p, c))} on ${fmt(statVal(x.p, att), 1)} attempts a game, ${fmt(Math.abs(x.d), 1)} ${x.d > 0 ? 'more' : 'fewer'} makes a game than the league average of ${fmtPct(mean)} would give`
      : c.shot ? `${x.p.name}: ${vol(x.p)} ${c.label} a game, ${signed(num(x.p), 1)} FP, vs the league average of ${signed(mean, 1)} per player`
      : `${x.p.name}: ${fmt(num(x.p), 1)} ${c.label} a game vs the league average of ${fmt(mean, 1)} per player`;
    const csName = x => `<button type="button" class="link-btn cs-name" data-action="player-detail" data-nba="${x.p.nbaId}">${inlinePlayer(x.p, esc(lastName(x.p.name)))}</button>`;
    const csNum = x => `<b class="${x.d > 0 ? 'pos-good' : 'pos-bad'}">${c.pct ? fmtPct(pctOf(x.p, c)) : c.shot ? vol(x.p) : fmt(num(x.p), 1)}</b>`;
    const csAtt = x => (c.pct ? `<span class="muted small"> on ${fmt(statVal(x.p, att), 1)} ${att.toUpperCase()}</span>` : '');
    const who = list => list.map(x => `<span class="cs-p" title="${esc(tip(x))}">${csName(x)}${csNum(x)}${csAtt(x)}</span>`).join('');
    const w = Math.min(Math.abs(z) / 2, 1) * 50; // bar edge = 2 spreads from the league average
    const pos = v => ((Math.max(-2.5, Math.min(2.5, gap(v))) + 2.5) / 5) * 100;
    const open = ui.csOpen.has(c.key);
    // the league's average (a shooting pair's: its makes and attempts, averaged over the teams)
    const avgShown = c.shot ? shotVol(sum(teams.map(t => t.raw[c.made])) / n, sum(teams.map(t => t.raw[c.att])) / n) : fmtRaw(c, mean);
    // every team on one line: this card's team the big dot, your own team orange (orange is only ever your team)
    const dot = t => `<span class="sdot${t.id === tid ? ' this' : ''}${t.id === state.fxTeam ? ' me' : ''}" style="left:${pos(t.raw[key]).toFixed(1)}%" title="${esc(t.name)}${t.id === state.fxTeam ? ' (you)' : ''}: ${rawShown(c, t.raw)}"></span>`;
    return `<tr class="cs-row" data-action="cs-toggle" data-cat="${c.key}" aria-expanded="${open}" title="Show who helped (green) and hurt (red) most">
      <td><span class="cs-chev" aria-hidden="true">▸</span><b>${c.label}</b></td>
      <td class="num"><b>${rawShown(c, me.raw)}</b><span class="cs-avg">avg ${avgShown}</span></td>
      <td class="num muted cs-lavg">${avgShown}</td>
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
  const out = slot === 'IL' || slot === 'TAXI', pc = !out && slotColor(slot);
  const cls = out ? 'il' : `slot-${slot}${pc ? ` pc pc-${pc}` : ''}`;
  return `<span class="slot-label ${cls}">${slot === 'FLX' ? 'Flx' : slot === 'BN' ? 'Res' : slot === 'IL' ? 'IR' : slot === 'TAXI' ? 'Taxi' : slot}</span>`;
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
// A sortable table's rows in the column's order: by valueOf (asked once a row), dir 1 smallest first, -1 biggest first;
// an empty cell (null) always last, and ties in the order the rows came in
function sortRows(rows, valueOf, dir) {
  const vals = new Map(rows.map(r => [r, valueOf(r)]));
  return [...rows].sort((a, b) => {
    const x = vals.get(a), y = vals.get(b);
    return x == null || y == null ? (x == null) - (y == null) : (x < y ? -1 : x > y ? 1 : 0) * dir;
  });
}

function statCells(p) {
  return `${SPORT.tableStats.map(([k], i) => `<td class="num">${fmt(p[k] || 0, i ? 1 : 0)}</td>`).join('')}
    ${SPORT.tablePct.map(([, , m, a]) => `<td class="num">${fmtPct(p[a] ? statVal(p, m) / p[a] : 0)}</td>`).join('')}<td class="num"><b>${fmtValue(value(p))}</b></td>`;
}

/* ---------- Standings ---------- */

function viewStandings() {
  const L = fxLeague();
  if (L && L.roto) return rotoStandingsCard(L);
  const rows = (L && L.standings) || [];
  const S = L ? seasonLineups(L) : null; // (the season's lineups and games: Categories won and Season totals)
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
  ${S && S.cw ? catsWonCard(rows, S.cw) : ''}
  ${L ? seasonTotalsCard(rows, S) : ''}`;
}

// ----- Roto (a league ranked over the season in each category: espnRoto) -----
const fmtRotoPts = n => fmt(n, Number.isInteger(n) ? 0 : 1); // (a tie splits points: 5.5)
// A team's season total in a category: a percentage from its makes and attempts (null before any), else the count
const rotoValue = (r, c) => (c.pct ? (r.tot[c.att] ? r.tot[c.made] / r.tot[c.att] : null) : r.tot[c.key] || 0);
const fmtRotoValue = (c, v) => (v == null ? '—' : c.pct ? fmtPct(v) : fmt(v, 0));
// ESPN's points while no one has played: every team tied in every category
const rotoUnplayed = L => L.standings.every(r => !r.tot.gp1);

// Where a team stands, category by category: its total, its points, and the nearest teams above and below it with the gap to
// them (fewer is better for turnovers) -> [{ c, v, pts, above, below }]; above / below: { gap, ids } (every team that close) or null
function rotoStanding(tid) {
  const rows = fxLeague().standings, me = rows.find(r => r.id === tid);
  if (!me) return [];
  return scoreCats().filter(c => !c.fp).map(c => {
    const v = rotoValue(me, c), sign = c.neg ? -1 : 1;
    // each other team's lead over this one (below 0: behind it)
    const leads = v == null ? [] : rows.filter(r => r !== me && rotoValue(r, c) != null).map(r => ({ id: r.id, d: sign * (rotoValue(r, c) - v) }));
    const nearest = list => {
      if (!list.length) return null;
      const gap = Math.min(...list.map(x => Math.abs(x.d)));
      return { gap, ids: list.filter(x => Math.abs(x.d) - gap < 1e-9).map(x => x.id) };
    };
    return { c, v, pts: me.cats[c.key] || 0, above: nearest(leads.filter(x => x.d > 1e-9)), below: nearest(leads.filter(x => x.d < -1e-9)) };
  });
}

// The standings: each team's points in all and in each category (its season total under them) and the games its starters have
// played, against the league's limit
function rotoStandingsCard(L) {
  const rows = L.standings || [], cats = scoreCats().filter(c => !c.fp), { gpMax, gpSpot } = L.roto;
  if (!rows.length) return `<div class="card"><div class="empty"><strong>No standings yet</strong>${sourceName()} didn't return standings for this league.</div></div>`;
  const gpTip = `Games your starters have played${gpMax ? `, of the league's limit of ${gpMax}${gpSpot ? ` (${gpSpot} a lineup spot)` : ''}` : ''}`;
  const cell = (r, c) => {
    const v = fmtRotoValue(c, rotoValue(r, c));
    return `<td class="num rt-c" title="${c.label}: ${v}, ${fmtRotoPts(r.cats[c.key])} points"><b>${fmtRotoPts(r.cats[c.key])}</b><span class="rt-tot">${v}</span></td>`;
  };
  const row = r => `<tr${r.id === myTeamId() ? ' class="me-row"' : ''}><td class="num">${r.rank}</td><td class="rt-team"><b>${teamLink(r.id, esc(r.name))}</b>${r.id === myTeamId() ? ' <span class="muted small">(you)</span>' : ''}</td>
    <td class="num"><b>${fmtRotoPts(r.pts)}</b></td><td class="num">${fmt(r.tot.gp1 || 0, 0)}</td>${cats.map(c => cell(r, c)).join('')}</tr>`;
  return `<div class="card">
    <div class="card-head"><h2>Roto standings ${infoBtn('roto')}</h2></div>
    ${rotoUnplayed(L) ? '<p class="muted small" style="margin:0 0 10px">No games counted yet, so every team is tied.</p>' : ''}
    <div class="table-wrap"><table class="rt-table">
      <thead><tr><th class="num">#</th><th>Team</th><th class="num" title="Roto points: every category's added up">Pts</th><th class="num" title="${esc(gpTip)}">GP</th>${cats.map(c => `<th class="num">${c.label}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(row).join('')}</tbody>
    </table></div>${waiverLine()}
  </div>`;
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
  const of = r && `${ordinal(r.rank || 0)} of ${fxPickable().length}`;
  // (a roto league: its points and standing, and no weekly opponent to name)
  const bio = (isRoto() ? [r && `<span class="dt-rec">${fmtRotoPts(r.pts)}</span> roto points · ${of}`]
    : [r && `<span class="dt-rec">${r.w}-${r.l}${r.t ? '-' + r.t : ''}</span> · ${of}${r.pf != null ? ` · ${fmtFp(r.pf)} points for` : ''}`,
      `<span class="dt-vs">${opp ? `This week vs <span class="dt-rec">${teamLink(opp.id)}</span>` : 'No matchup this week'}</span>`]).filter(Boolean).join(' · ');
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
  // then the league's categories (a points league: every stat it scores, a shooting pair as one "11.9/25.6 FG": lineCats);
  // football shows its projection alone
  const cols = football ? [] : lineCats().filter(c => !c.fp);
  const cell = (p, c) => {
    if (!p.gp) return '<td class="sc muted">—</td>';
    if (c.shot) return `<td class="sc" title="${c.label}: ${signed(fantasyPoints(p, shotPoints(c)), 1)} FP a game">${shotVol(statVal(p, c.made), statVal(p, c.att))}</td>`;
    if (!c.pct) return `<td class="sc">${fmt(statVal(p, c.key), c.dec || 1)}</td>`;
    const m = statVal(p, c.made), a = statVal(p, c.att);
    return `<td class="sc"${c.rate ? '' : ` title="${c.label}: ${fmt(m, 1)}/${fmt(a, 1)} a game"`}>${!a ? '—' : c.rate ? fmt(m / a, 2) : fmtPct(m / a)}</td>`;
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
    : !p.gp || (so.key !== 'min' && !cols[so.key]) ? null : so.key === 'min' ? p.min : cols[so.key].shot ? fantasyPoints(p, shotPoints(cols[so.key])) : cols[so.key].pct ? pctOf(p, cols[so.key]) : statVal(p, cols[so.key].key));
  const rows = sortRows(sortDesc(side.players, order), sortVal, so.dir).map(row).join(''); // (ties stay best first)
  const th = (key, label, cls, tip, attrs) => sortTh('team-sort', key, label, so, { cls, tip, attrs, down: so.dir < 0 });
  const cats = football ? '' : teamStrengths(tid);
  // (each part 16 px below the one before: .tc-body)
  return `<div class="tc-body">
    ${!me && state.fxTeam && !isRoto() ? `<div><button type="button" class="btn sm" data-action="team-compare" data-team="${esc(tid)}">Compare on Plan Ahead</button></div>` : ''}
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
  const get = url => getJson(url, 'League Layer', undefined, 3); // (a dropped connection or a server hiccup: asked again)
  if (!months.length) return get(`${dir}boxscores.json?v=${encodeURIComponent(NBA.updated || '')}`);
  const parts = await Promise.all(months.map(([month, v]) => get(`${dir}box/${month}.json?v=${v}`)));
  return { ...parts[0], games: Object.assign({}, ...parts.map(p => p.games)) };
}

// (a load started for another sport, finishing after a switch, isn't this page's: it gives way to this sport's load. It
// used to land in BOX, the other sport's games under this one's players, and could leave a tab on "Loading" until a click)
let boxFail = ''; // the last load's failure, for a tab with nothing else to show (boxWait)
keep('sport', () => { boxFail = ''; });
function loadBoxes() {
  if (boxLoad) return boxLoad;
  const sport = SPORT;
  const load = boxLoad = boxFiles().then(data => {
    if (SPORT !== sport) return loadBoxes();
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
    boxFail = '';
    dropPlayedInjuries();
    return BOX;
  }).catch(e => { if (boxLoad === load) { boxLoad = null; boxFail = e.message || 'no answer'; } throw e; });
  return load;
}
// A tab that needs the box scores and has nothing to show without them (Live, Trends): loads them (drawn again when
// they're in), and meanwhile a loading card, or what went wrong with Try again ('box-retry')
function boxWait(tab, title, text) {
  if (boxFail && !boxLoad) return `<div class="card"><div class="empty"><strong>Couldn't load the box scores</strong>${esc(boxFail)}. <button type="button" class="link-btn" data-action="box-retry">Try again</button></div></div>`;
  loadBoxes().then(() => { if (ui.tab === tab) render(); }).catch(() => { if (ui.tab === tab) render(); });
  return loadingCard(title, text);
}

// This season's Season totals and Awards: the shared weekly rosters (Fantrax ids) mapped to NBA players
const currentFidNba = () => { const m = new Map(NBA.players.filter(r => r.fx).map(r => [r.fx.id, r.id])); return f => m.get(f) || null; };
async function buildSeasonTotals(L) {
  const [weeks, G] = await Promise.all([loadRosterWeeks(L), loadGameLog('cur')]);
  if (!weeks || !G) return { teams: {}, cw: null };
  const LL = { ...L, weeks, fidNba: currentFidNba() };
  return { teams: pastSeasonTotals(LL, G), LL, G }; // (Categories won is counted when drawn: seasonLineups)
}

// The Standings tab's season so far, for Categories won and Season totals: { teams, cw } once its lineups and games are in
// (teams: pastSeasonTotals; cw: catsWonRecords, null in a points league or before a week is over), else { msg } meanwhile.
// A past season: its weekly lineups and its saved game log; this season: the weekly lineups and box scores, loaded once
function seasonLineups(L) {
  if (seasonCtx) {
    if (!L.weeks) return { msg: "Fantrax didn't return this season's weekly rosters." };
    if (!L.season || !(L.season in gameLogs)) {
      if (L.season) loadGameLog(L.season).then(() => { if (ui.tab === 'standings' && ui.season) render(); });
      return { msg: L.season ? `${loaderMark('sm')}Loading the season’s games…` : `No ${SPORT.name} game logs are saved for this season.` };
    }
    const G = gameLogs[L.season];
    if (!G) return { msg: `No ${SPORT.name} game logs are saved for this season (the site has 2016-17 on).` };
    return { teams: pastSeasonTotals(L, G), cw: catsWonRecords(L, G) };
  }
  if (!hasLineupHistory(L)) return { msg: `Season totals need every day's lineups, which the site reads from Fantrax and Sleeper only for now, not ${sourceName(L)}.` };
  const id = L.id, S = seasonTot[id];
  if (!S) {
    seasonTot[id] = { state: 'loading' };
    buildSeasonTotals(L).then(t => { seasonTot[id] = { state: 'ready', ...t }; })
      .catch(e => { seasonTot[id] = { state: 'error', msg: e.message }; })
      .finally(() => { if (ui.tab === 'standings' && !ui.season) render(); });
  }
  if (!S || S.state === 'loading') return { msg: `${loaderMark('sm')}Loading every lineup from Fantrax…` };
  if (S.state === 'error') return { msg: `Couldn't load season totals (${esc(S.msg)}).` };
  // (counted here, with the league on the page: its categories, and the weeks over by now)
  if (!('cw' in S)) S.cw = catsWonRecords(S.LL, S.G);
  return S;
}

// ----- Categories won: each team's categories won, lost and tied against its opponents, in all and one by one -----
// Every finished regular-season matchup, counted from the week's real lineups and box scores as the Recap counts a final
// (weekScore). Team id -> { w, l, t, weeks, by: [{ w, l, t }] in scoreCats' order }, or null: a points league, or no week
// over yet. L: with its weekly lineups (weeks) and fidNba, as pastSeasonTotals takes it
function catsWonRecords(L, G) {
  if (isPoints() || isFootball() || !L || !L.weeks || !G) return null;
  const cats = scoreCats(), out = {};
  for (const p of (L.periods || []).filter(x => (!L.playoffPeriod || x.n < L.playoffPeriod) && periodOver(x))) {
    const pairs = ((L.matchups || {})[String(p.n)] || []).filter(m => m.length === 2);
    // the lineup periods that start within it (the week, or each of its days in a daily league), as benchSwaps finds them
    const rps = L.weeks.filter(w => fxTime(w.start) >= fxTime(p.lock) && fxTime(w.start) < fxTime(p.endAt));
    if (!pairs.length || !rps.length) continue;
    const tot = pastSeasonTotals({ ...L, weeks: rps }, G);
    for (const [a, b] of pairs) {
      const sc = weekScore((tot[a] || {}).s || {}, (tot[b] || {}).s || {});
      for (const [tid, sign] of [[a, 1], [b, -1]]) {
        const R = out[tid] = out[tid] || { w: 0, l: 0, t: 0, weeks: 0, by: cats.map(() => ({ w: 0, l: 0, t: 0 })) };
        R.weeks++;
        sc.lead.forEach((x, i) => { const k = x * sign > 0 ? 'w' : x * sign < 0 ? 'l' : 't'; R[k]++; R.by[i][k]++; });
      }
    }
  }
  return Object.keys(out).length ? out : null;
}

// The card: categories won, lost and tied and the share won, then each category's weeks won-lost (-tied), shaded by how
// often the team takes it; standings order until a column is picked (ui.cwSort, as Season totals)
function catsWonCard(standings, cw) {
  const cats = scoreCats();
  const order = standings.length ? standings.map(r => r.id) : fxPickable().map(t => t.id);
  const list = order.filter(tid => cw[tid]).map(tid => ({ tid, R: cw[tid] }));
  if (!list.length) return '';
  const share = x => (x.w + x.l + x.t ? (x.w + x.t / 2) / (x.w + x.l + x.t) : 0);
  const rec = x => `${x.w}-${x.l}${x.t ? '-' + x.t : ''}`;
  const ties = list.some(x => x.R.t);
  const so = ui.cwSort;
  if (so.key != null && !['team', 'w', 'l', 't', 'pct'].includes(so.key) && !cats[so.key]) so.key = null;
  if (so.key === 't' && !ties) so.key = null;
  const sortVal = x => (so.key === 'team' ? (fxTeamName(x.tid) || '').toLowerCase() : so.key === 'w' ? x.R.w : so.key === 'l' ? -x.R.l
    : so.key === 't' ? x.R.t : so.key === 'pct' ? share(x.R) : share(x.R.by[so.key]));
  const rows = so.key != null ? sortRows(list, sortVal, -so.dir) : [...list];
  const th = (key, label, cls = 'num', tip = '') => sortTh('cw-sort', key, label, so, { cls, tip, down: so.dir > 0 });
  const weeks = Math.max(...list.map(x => x.R.weeks));
  return `<div class="card" style="margin-top:16px">
    <div class="card-head"><h2>Categories won ${infoBtn('catsWon')}</h2><span class="muted small">${weeks} week${weeks === 1 ? '' : 's'}, against each week's opponent</span></div>
    <div class="table-wrap"><table class="cats-won">
      <thead><tr>${th('team', 'Team', '')}${th('w', 'W', 'num', 'Categories won')}${th('l', 'L', 'num', 'Categories lost')}${ties ? th('t', 'T', 'num', 'Categories tied') : ''}${th('pct', 'Win %', 'num', 'Share of categories won, a tie counting half')}${cats.map((c, i) => th(i, c.label, 'num', `Weeks won-lost in ${c.label}`)).join('')}</tr></thead>
      <tbody>${rows.map(x => `<tr${x.tid === myTeamId() ? ' class="me-row"' : ''}><td><b>${teamLink(x.tid, esc(fxTeamName(x.tid) || ''))}</b></td>
        <td class="num"><b>${x.R.w}</b></td><td class="num">${x.R.l}</td>${ties ? `<td class="num">${x.R.t}</td>` : ''}<td class="num">${fmt(share(x.R) * 100, 0)}%</td>
        ${cats.map((c, i) => { const b = x.R.by[i]; return `<td class="num" style="${shadeProb(share(b))}" title="${c.label}: won ${b.w}, lost ${b.l}${b.t ? `, tied ${b.t}` : ''} of ${x.R.weeks} week${x.R.weeks === 1 ? '' : 's'}">${rec(b)}</td>`; }).join('')}</tr>`).join('')}</tbody>
    </table></div>
  </div>`;
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

// S: seasonLineups' answer (its message while the lineups and games aren't in)
function seasonTotalsCard(standings, S) {
  // Sleeper basketball: its lineups can't give Lock-In's real scores (slpWeekPts, sleeper.js), so these are estimates and
  // its fantasy points are the standings' Pts for, Sleeper's own
  const est = slpEstimated(fxLeague());
  const head = `<div class="card-head"><h2>Season totals ${infoBtn(est ? 'slpScores' : 'totals')}</h2><span class="muted small">${est ? "estimated from each week's final lineups" : `from each ${leagueLineupMode(fxLeague()) === 'daily' && !isFootball() ? "day's" : "week's"} starting lineups`}</span></div>`;
  if (S.msg) return `<div class="card" style="margin-top:16px">${head}<p class="muted small" style="margin:0">${S.msg}</p></div>`;
  const teams = S.teams;

  // totals of any scored stat, derived ones included
  const tot = (T, k) => (DERIVED[k] ? sum(Object.entries(DERIVED[k]).map(([b, c]) => (T.s[b] || 0) * c)) : T.s[k] || 0);
  const sc = leaguePoints();
  const cols = sc
    ? [...Object.keys(STAT_LABEL).filter(k => sc[k]).map(k => ({ label: STAT_LABEL[k], neg: sc[k] < 0, val: T => tot(T, k), fmt: v => fmt(v, 0) })),
      ...(est ? [] : [{ label: 'FP', val: T => sum(Object.entries(sc).map(([k, v]) => tot(T, k) * v)), fmt: v => fmtFp(v) }])]
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
  const idx = so.key != null ? sortRows(list.map((x, i) => i), sortVal, -so.dir) : list.map((x, i) => i);
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
  // the league's future draft picks (read the first time they're needed: leaguePicks); a pick no longer theirs drops out
  const PK = leaguePicks(), owned = tid => (PK.list || []).filter(p => p.owner === tid).sort((a, b) => a.year - b.year || a.round - b.round);
  if (PK.list) {
    for (const k of ui.tradeGivePicks) if (!owned(state.fxTeam).some(p => pickKey(p) === k)) ui.tradeGivePicks.delete(k);
    for (const k of ui.tradeGetPicks) if (!owned(ui.tradeTeam).some(p => pickKey(p) === k)) ui.tradeGetPicks.delete(k);
  }

  const pick = (list, set, side, key) => list.length ? `<ul class="pick-list">${sortDesc(list, value).map(p => `
    <li><label><input type="checkbox" data-change="trade" data-side="${side}" value="${key(p)}" ${set.has(key(p)) ? 'checked' : ''}>
      <span class="grow">${playerCell(p)}</span>${p.status !== 'Healthy' ? statusBadge(p) : ''}<span class="val">${fmtValue(value(p))}</span></label></li>`).join('')}</ul>`
    : `<p class="muted small">${side === 'get' ? (others.length ? 'This team has no players yet.' : 'Connect a league to trade with its teams.') : 'Your roster is empty.'}</p>`;
  // under a team's players, its draft picks to tick ("2027 R1"; one it traded for says whose it was)
  const picksOf = (tid, set, side) => {
    if (!tid) return '';
    if (PK.loading) return '<p class="muted small pp-note">Loading draft picks…</p>';
    if (PK.error) return `<p class="muted small pp-note">Couldn't read the draft picks (${esc(PK.error)}). <button type="button" class="link-btn" data-action="trade-picks-retry">Try again</button></p>`;
    const list = owned(tid);
    return list.length ? `<div class="pp"><div class="pp-head">Draft picks</div><div class="pp-list">${list.map(p => { const k = pickKey(p), on = set.has(k); return `<label class="pp-chip${on ? ' on' : ''}">
      <input type="checkbox" data-change="trade-pick" data-side="${side}" value="${esc(k)}"${on ? ' checked' : ''}><span>${p.year} R${p.round}</span>${p.from !== tid ? `<span class="pp-from">${esc(fxTeamName(p.from))}</span>` : ''}</label>`; }).join('')}</div></div>` : '';
  };

  const give = [...ui.tradeGive].map(byId).filter(Boolean);
  const get = theirs.filter(p => ui.tradeGet.has(String(p.nbaId)));
  const givePicks = [...ui.tradeGivePicks], getPicks = [...ui.tradeGetPicks];
  // the deal in one card: both sides, how they compare, and what it does for your team. Under the lists; a league mate's
  // shared deal above them instead
  const card = ui.tradeSeen ? tradeCard(ui.tradeSeen)
    : give.length || get.length || givePicks.length || getPicks.length
      ? tradeCard({ from: state.fxTeam, to: ui.tradeTeam, give: give.filter(p => p.nbaId != null).map(p => String(p.nbaId)), get: [...ui.tradeGet], givePicks, getPicks }, tradeForYou(give, get))
      : `<div class="card"><div class="empty"><strong>Pick players on both sides</strong>See how the deal changes your team's per-game production, and share it with the other team.</div></div>`;
  return `${ui.tradeSeen ? card : ''}
  <div class="trade-grid">
    <div class="card"><div class="card-head"><h2>You give</h2><span class="muted small">${give.length + givePicks.length} selected</span></div>${pick(state.players, ui.tradeGive, 'give', p => p.id)}${picksOf(state.fxTeam, ui.tradeGivePicks, 'give')}</div>
    <div class="card"><div class="card-head"><h2>You get</h2>${others.length ? `<select class="trade-team" data-change="trade-team" aria-label="Team to trade with">${others.map(t => `<option value="${esc(t.id)}" ${t.id === ui.tradeTeam ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>` : ''}<span class="muted small">${get.length + getPicks.length} selected</span></div>${pick(theirs, ui.tradeGet, 'get', p => String(p.nbaId))}${picksOf(ui.tradeTeam, ui.tradeGetPicks, 'get')}</div>
  </div>
  ${ui.tradeSeen ? '' : card}`;
}

// A draft pick in a deal and its link: "year:round:team whose pick it was"; and in words
const pickKey = p => `${p.year}:${p.round}:${p.from}`;
const pickOf = k => { const [year, round, ...from] = String(k).split(':'); return { year: +year, round: +round, from: from.join(':') }; };
const pickName = p => `${p.year} Round ${p.round}`;

// What a deal does for your team: value over a waiver player each way (each player in a deal takes a roster spot someone
// off waivers could fill; a goalie for his share of his team's games, as the waiver player's), and each category's
// per-game total across your active (non-IR) roster now and after. Numbers only: the site never says who wins a trade or
// whether it's fair, that's for the people trading to judge (the owner's rule)
function tradeForYou(give, get) {
  const active = state.players.filter(p => !state.il.includes(p.id)), out = new Set(give.map(p => p.id));
  const before = totals(active), after = totals([...active.filter(p => !out.has(p.id)), ...get]);
  const wv = waiverValue(), over = p => gameWorth(p) - wv;
  const vGive = sum(give.map(over)), vGet = sum(get.map(over)), diff = vGet - vGive, cats = scoreCats();
  const better = c => { const d = after[c.key] - before[c.key]; return c.neg ? d < -1e-9 : d > 1e-9; };
  return { before, after, vGive, vGet, diff, won: cats.filter(better).length, n: cats.length, rosterAfter: activeCount() - give.length + get.length };
}

/* ---------- Trade proposal: both sides of a deal, with photos and per-game numbers, to share with the other team ---------- */
// A deal: { from, to, give, get, givePicks, getPicks }: team `from` sends `give` and `givePicks`, and receives `get` and
// `getPicks` (players by data id, as text; draft picks by pickKey). The pickers make one (you are `from`, with something
// picked on both sides); a shared link carries one (tradeUrl, openSharedLink).
function tradeDeal() {
  if (ui.tradeSeen) return ui.tradeSeen;
  const give = [...ui.tradeGive].map(byId).filter(p => p && p.nbaId != null).map(p => String(p.nbaId)), get = [...ui.tradeGet];
  const givePicks = [...ui.tradeGivePicks], getPicks = [...ui.tradeGetPicks];
  return state.fxTeam && ui.tradeTeam && (give.length || givePicks.length) && (get.length || getPicks.length) ? { from: state.fxTeam, to: ui.tradeTeam, give, get, givePicks, getPicks } : null;
}

// A shared trade, once your team is known: either of its teams gets it in the pickers, from their side (what they'd send
// on the left); anyone else sees it as it was sent, above the pickers (ui.tradeSeen, until they pick or close it)
function applyTradeLink() {
  const T = ui.tradeLink, me = state.fxTeam, teams = fxPickable().map(t => t.id);
  ui.tradeLink = null;
  if (!teams.includes(T.from) || !teams.includes(T.to) || T.from === T.to) return;
  ui.tradeGive.clear(); ui.tradeGet.clear(); ui.tradeGivePicks.clear(); ui.tradeGetPicks.clear(); ui.tradeSeen = null;
  if (me !== T.from && me !== T.to) { ui.tradeSeen = T; return; }
  const [mine, theirs] = me === T.from ? [T.give, T.get] : [T.get, T.give];
  ui.tradeTeam = me === T.from ? T.to : T.from;
  // its draft picks (one no longer theirs drops out once the league's picks are in: viewTrade)
  for (const k of (me === T.from ? T.givePicks : T.getPicks) || []) ui.tradeGivePicks.add(k);
  for (const k of (me === T.from ? T.getPicks : T.givePicks) || []) ui.tradeGetPicks.add(k);
  for (const p of state.players) if (mine.includes(String(p.nbaId))) ui.tradeGive.add(p.id);
  const onTheirs = new Set(fxTeamSide(ui.tradeTeam).players.map(p => String(p.nbaId)));
  for (const id of theirs) if (onTheirs.has(id)) ui.tradeGet.add(id);
  // a player who has changed teams since the link was made drops out of the deal: say so
  const gone = mine.length + theirs.length - ui.tradeGive.size - ui.tradeGet.size;
  if (gone) toast(`${gone === 1 ? 'A player' : `${gone} players`} in the shared trade ${gone === 1 ? 'is' : 'are'} on another team now`);
}

// The league's categories, fantasy points first in a points league (a shooting pair it scores both halves of as one, "8.2/17.1 FG": lineCats)
const dealCats = () => { const cs = lineCats(); return [...cs.filter(c => c.fp), ...cs.filter(c => !c.fp)]; };
// a category's number as the site shows it; null (no attempts: a side without a goalie has no GAA) is a dash
const dealShow = (c, v) => (v == null ? '—' : c.rate ? fmt(v, 2) : c.pct ? fmtPct(v) : fmt(v, c.dec || 1));
// a shooting category's volume: makes and attempts a game ("7.2/14.5")
const dealVol = (made, att) => `${fmt(made, 1)}/${fmt(att, 1)}`;
// One player's average game in the league's categories (a goalie's in the goalie ones), minutes first; a percentage with
// its makes and attempts, as the Recap's lines show them ("7.2/14.5 FG (.496)")
function dealLine(p) {
  const goalie = isGoalie(p), parts = p.min ? [`${fmt(p.min, 1)} MIN`] : [];
  for (const c of dealCats()) {
    if (isHockey() && SPORT.goalieCats.includes(c.key) !== goalie) continue;
    if (c.shot) { parts.push(`${dealVol(statVal(p, c.made), statVal(p, c.att))} ${c.label}`); continue; }
    const m = c.pct && statVal(p, c.made), a = c.pct && statVal(p, c.att);
    if (c.pct && !c.rate) parts.push(`${dealVol(m, a)} ${c.label.replace('%', '')} (${a ? fmtPct(m / a) : '—'})`);
    else parts.push(`${dealShow(c, c.pct ? (a ? pctOf(p, c) : null) : statOf(p, c))} ${c.label}`);
  }
  return parts;
}

// Both sides of a deal, for the card, the picture and the text: what each team gets (players as the Players tab has
// them, best first), their value added up (sum) and over a waiver player (value, as the value line above the table counts it), and their
// per-game totals, then the
// comparison's rows: { key, label, sa, sb (as shown), lead: 1 (the first side's is better), -1, or 0 (even, or no number),
// and for a shooting percentage va, vb (makes/attempts a game) and ta, tb (what the volume adds, for a tip) }
function tradeModel(T) {
  const rawOf = id => nbaById.get(+id) || nbaById.get(id);
  const wv = waiverValue(), over = p => gameWorth(p) - wv;
  // (and its draft picks, first year and round first; sender: the team sending them, so a pick that was someone else's says so)
  const side = (tid, ids, keys, sender) => {
    const players = sortDesc(ids.map(rawOf).filter(Boolean).map(raw => playerFromRaw(raw)), value);
    const picks = (keys || []).map(pickOf).sort((a, b) => a.year - b.year || a.round - b.round);
    return { tid, sender, name: fxTeamName(tid) || 'Team', players, picks, sum: sum(players.map(value)), value: sum(players.map(over)), tot: totals(players) };
  };
  const A = side(T.from, T.get, T.getPicks, T.to), B = side(T.to, T.give, T.givePicks, T.from);
  const row = (key, label, a, b, show, neg) => {
    const sa = show(a), sb = show(b);
    return { key, label, a, b, sa, sb, lead: a == null || b == null || sa === sb ? 0 : (neg ? a < b : a > b) ? 1 : -1 };
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
    return { ...r, pct: true, va: A.tot[c.att] ? dealVol(A.tot[c.made], A.tot[c.att]) : '', vb: B.tot[c.att] ? dealVol(B.tot[c.made], B.tot[c.att]) : '', ta: tip(A.tot), tb: tip(B.tot),
      lead: oa == null || ob == null ? r.lead : Math.abs(oa - ob) < 0.05 ? 0 : oa > ob ? 1 : -1 };
  };
  // a points league's shooting pair (lineCats): makes/attempts a game, the points they score under them, and the side
  // they score more for marked (a, b: those points)
  const pairRow = c => {
    const a = shotFp(A.tot, c), b = shotFp(B.tot, c), vol = t => dealVol(lineStat(t, c.made), lineStat(t, c.att));
    return { key: c.key, label: c.label, a, b, sa: vol(A.tot), sb: vol(B.tot), va: `${signed(a, 1)} FP`, vb: `${signed(b, 1)} FP`, pct: true, shot: true,
      lead: Math.abs(a - b) < 0.05 ? 0 : a > b ? 1 : -1 };
  };
  // a league with playoffs to come: each side's games in them (more is better: they decide the title)
  const P = playoffDays();
  if (P) for (const S of [A, B]) S.po = sum(S.players.map(p => playoffGames(p, P)));
  const rows = [row('value', valueLabel(), A.value, B.value, v => fmtValue(v)), ...(P ? [row('po', 'Playoff games', A.po, B.po, fmtGames)] : []),
    ...dealCats().map(c => (c.shot ? pairRow(c) : c.pct && !c.rate ? shotRow(c) : row(c.key, c.label, catOf(A.tot, c), catOf(B.tot, c), v => dealShow(c, v), c.neg)))];
  return { A, B, rows, P };
}
// The playoffs in words, for tips and notes: "weeks 19–23 (Mar 1 – Apr 11)"
const playoffWeeks = P => `week${P.ps.length > 1 ? `s ${P.ps[0].n}–${P.ps[P.ps.length - 1].n}` : ` ${P.ps[0].n}`} (${fmtMonthDay(P.from)} – ${fmtMonthDay(P.to)})`;

// The proposal on the Trades tab, all in one table: for each side, what it gets (each player's photo, his games and games
// missed this season, his average game in the league's categories, his value), then that side's total with the better
// side's numbers marked (a side getting one player: his row is its total, not a copy of it under him); last, with Y (your
// own deal: tradeForYou), what it does for your team. In your own deal your side's better numbers are green and the other
// side's red; a league mate's deal (no Y) stays neutral. A points league's FP is the Value column. What it all means is
// in the title's (i) (INFO.trade): the table carries no notes.
function tradeCard(T, Y) {
  const M = tradeModel(T), seen = !Y, me = myTeamId(), P = M.P;
  const mineAt = M.A.tid === me ? 1 : M.B.tid === me ? -1 : 0;
  // the sides with something in the deal (Share once both have); totals compared only when both have players
  const sides = [[M.A, 1], [M.B, -1]].filter(([S]) => S.players.length || S.picks.length), shareable = sides.length === 2;
  const both = !!(M.A.players.length && M.B.players.length);
  const cats = dealCats().filter(c => !c.fp), rowOf = new Map(M.rows.map(r => [r.key, r])), ncol = 5 + cats.length + (P ? 1 : 0);
  // the playoffs' column (a league with playoffs to come): his games in them, each side's added up, your net
  const poTip = P ? `Games in the league's playoffs, ${playoffWeeks(P)}${P.started ? ', still to play' : ''}${isOneGame() ? ': the playoff weeks he plays in, as one game a week counts' : isHockey() ? ': a goalie\'s expected starts' : ''}` : '';
  const poCell = (v, cls = '') => (P ? `<td class="num tp-po${cls}">${v}</td>` : '');
  const mark = (r, col) => (both && r && r.lead === col ? ` tp-lead${mineAt ? (col === mineAt ? ' pos-good' : ' pos-bad') : ''}` : '');
  const vol = v => (v ? `<div class="tp-vol">${v}</div>` : '');
  const skip = (p, c) => isHockey() && SPORT.goalieCats.includes(c.key) !== isGoalie(p); // (a skater has no saves)
  // a category's cell: a player's average game, or a side's total (marked when it's the better side's)
  const gameCell = (p, c) => {
    if (skip(p, c)) return '<td class="num"></td>';
    if (c.shot) return `<td class="num">${dealVol(statVal(p, c.made), statVal(p, c.att))}${vol(`${signed(fantasyPoints(p, shotPoints(c)), 1)} FP`)}</td>`;
    const m = c.pct && statVal(p, c.made), a = c.pct && statVal(p, c.att);
    if (c.pct && !c.rate) return `<td class="num">${a ? fmtPct(m / a) : '—'}${a ? vol(dealVol(m, a)) : ''}</td>`;
    return `<td class="num">${dealShow(c, c.pct ? (a ? pctOf(p, c) : null) : statOf(p, c))}</td>`;
  };
  const totalCell = (c, col) => { const r = rowOf.get(c.key), [v, vl, tip] = col === 1 ? [r.sa, r.va, r.ta] : [r.sb, r.vb, r.tb]; return `<td class="num${mark(r, col)}"${tip ? ` title="${esc(tip)}"` : ''}>${v}${vol(vl)}</td>`; };
  // a side's value: added up, its value over a waiver player for each roster spot under it (what's compared)
  const valueCell = (S, col, shown) => `<td class="num tp-v${mark(M.rows[0], col)}" title="${esc(`${valueLabel()} ${S.players.length > 1 ? 'added up' : 'per game'}; ${fmtValue(S.value)} over a waiver player for each roster spot, which is what's compared`)}"><b>${shown}</b>${vol(`${fmtValue(S.value)} over waiver`)}</td>`;
  const who = p => `<td class="tp-pl"><div class="bplayer">${headshot(p, hsPx(36, 32))}<div class="bmain"><div class="bname">${playerBtn(p.nbaId, p.name)}${p.inj ? ` ${injBadge(p.inj)}` : ''}</div>
      <div class="pmeta">${p.team ? teamBtn(p.team) : 'FA'} · ${posTags(p.pos)}</div></div></div></td>`;
  const games = p => { const n = gamesMissed(p); return `<td class="num">${seasonGp(p)}</td><td class="num${n ? '' : ' muted'}">${n == null ? '' : n}</td>`; };
  // a player; one alone on his side is its total too (S, col): its marks and its value over waiver on his row
  const playerRow = (p, S, col) => (S ? `<tr class="tp-one">${who(p)}${games(p)}${poCell(fmtGames(S.po), mark(rowOf.get('po'), col))}<td class="num">${fmt(p.min || 0, 1)}</td>
      ${cats.map(c => (skip(p, c) ? '<td class="num"></td>' : totalCell(c, col))).join('')}${valueCell(S, col, fmtValue(value(p)))}</tr>`
    : `<tr>${who(p)}${games(p)}${poCell(fmtGames(playoffGames(p, P)))}<td class="num">${fmt(p.min || 0, 1)}</td>${cats.map(c => gameCell(p, c)).join('')}<td class="num tp-v"><b>${fmtValue(value(p))}</b></td></tr>`);
  // a side's total (two players or more): its playoff games and each category added up (a percentage from its makes and attempts), its value
  const totalRow = (S, col) => `<tr class="tp-tot"><td class="tp-pl"></td><td></td><td></td>${poCell(fmtGames(S.po), mark(rowOf.get('po'), col))}<td></td>
    ${cats.map(c => totalCell(c, col)).join('')}${valueCell(S, col, fmtValue(S.sum))}</tr>`;
  // a draft pick: its round in the photo's place, the year and round, and whose it was when that's not the sender's own (no
  // numbers: next season's order isn't known)
  const pickRow = (p, sender) => `<tr class="tp-pick"><td class="tp-pl"><div class="bplayer"><span class="hs hs-none pk-ico" style="width:${hsPx(36, 32)}px;height:${hsPx(36, 32)}px" aria-hidden="true">R${p.round}</span>
      <div class="bmain"><div class="bname"><b>${pickName(p)}</b></div><div class="pmeta">Draft pick${p.from !== sender ? ` · originally ${teamLink(p.from)}` : ''}</div></div></div></td><td colspan="${ncol - 1}"></td></tr>`;
  const sideRows = ([S, col]) => {
    const one = S.players.length === 1;
    return `<tr class="tp-grp"><th colspan="${ncol}" scope="rowgroup"><span class="tp-grp-name">${teamLink(S.tid)} gets</span></th></tr>`
      + `${S.players.map(p => playerRow(p, one ? S : null, col)).join('')}${S.picks.map(p => pickRow(p, S.sender)).join('')}${S.players.length > 1 ? totalRow(S, col) : ''}`;
  };
  // your own deal: what it does to your active roster's per-game totals (now and after on hover), and the net value
  const change = (c, d) => (c.rate ? signed(d, 2) : c.pct ? `${signed(d * 100, 1)}%` : signed(d, 1));
  const zero = shown => !+String(shown).replace(/[^\d.]/g, ''); // (a change that rounds to nothing is gray, not green)
  const poNet = P && M.A.po - M.B.po, poShown = P ? `${poNet > 0.05 ? '+' : poNet < -0.05 ? '−' : ''}${fmtGames(Math.abs(poNet))}` : '';
  const youRow = Y ? `<tr class="tp-you"><td class="tp-pl"><b>For your team</b></td><td></td><td></td>${poCell(poShown, zero(poShown) ? ' muted' : poNet > 0 ? ' pos-good' : ' pos-bad')}<td></td>
    ${cats.map(c => {
      // a shooting pair: its makes and attempts a game, marked by the points they score
      if (c.shot) {
        const d = shotFp(Y.after, c) - shotFp(Y.before, c), vb = dealVol(Y.before[c.made], Y.before[c.att]), va = dealVol(Y.after[c.made], Y.after[c.att]);
        return `<td class="num ${Math.abs(d) < 0.05 ? 'muted' : d > 0 ? 'pos-good' : 'pos-bad'}" title="${c.label}: ${vb} now, ${va} after; ${signed(d, 1)} FP">${signed(Y.after[c.made] - Y.before[c.made], 1)}/${signed(Y.after[c.att] - Y.before[c.att], 1)}</td>`;
      }
      const b = Y.before[c.key], a = Y.after[c.key], d = a - b, shown = change(c, d); return `<td class="num ${zero(shown) ? 'muted' : (c.neg ? d < 0 : d > 0) ? 'pos-good' : 'pos-bad'}" title="${c.label}: ${dealShow(c, b)} now, ${dealShow(c, a)} after">${shown}</td>`; }).join('')}
    <td class="num tp-v ${zero(fmtValue(Y.diff)) ? 'muted' : Y.diff > 0 ? 'pos-good' : 'pos-bad'}" title="Net ${valueLabel().toLowerCase()} over a waiver player"><b>${fmtValue(Y.diff)}</b></td></tr>` : '';
  return `<div class="card tp">
    <div class="card-head"><div class="tp-head"><h2>Trade proposal ${infoBtn('trade')}</h2></div>
      <div class="tp-btns">${seen ? '<button type="button" class="btn sm" data-action="trade-seen-close">Close</button>' : ''}${shareable ? shareBtn('trade-share') : ''}</div></div>
    ${seen ? `<p class="muted small tp-note">A trade a league mate shared, between ${teamLink(M.A.tid)} and ${teamLink(M.B.tid)}.</p>` : ''}
    ${Y && Y.rosterAfter > rosterLimit() ? `<p class="alert warn small tp-warn">This puts you at ${Y.rosterAfter}/${rosterLimit()}: you'd need to drop ${Y.rosterAfter - rosterLimit()}.</p>` : ''}
    <div class="tp-wrap"><table class="tp-table">
      <thead><tr><th class="tp-pl"></th><th class="num" title="Games played this season">GP</th><th class="num" title="Games his team has played this season without him${isHockey() ? ' (none for a goalie: a healthy backup sits most games)' : ''}">Missed</th>${P ? `<th class="num tp-po" title="${esc(poTip)}">Playoff G</th>` : ''}<th class="num">MIN</th>${cats.map(c => `<th class="num">${c.label}</th>`).join('')}<th class="num tp-v">${valueLabel()}</th></tr></thead>
      <tbody>${sides.map(sideRows).join('')}${youRow}</tbody>
    </table></div>
  </div>`;
}

// Sharing it (shareWith, recap.js): a picture, or the text and a link that opens the deal on the Trades tab
const tradeUrl = (L, T) => `${location.origin}${location.pathname}?league=${encodeURIComponent(L.id)}&from=${encodeURIComponent(T.from)}&to=${encodeURIComponent(T.to)}`
  + `&give=${T.give.map(encodeURIComponent).join(',')}&get=${T.get.map(encodeURIComponent).join(',')}`
  + `${(T.givePicks || []).length ? `&givepicks=${T.givePicks.map(encodeURIComponent).join(',')}` : ''}${(T.getPicks || []).length ? `&getpicks=${T.getPicks.map(encodeURIComponent).join(',')}` : ''}#trade`;
// a pick in words, with whose it was when that's not the sender's own ("2027 Round 2 pick (originally Tatum Tots)")
const pickWords = (p, sender) => `${pickName(p)} pick${p.from !== sender ? ` (originally ${fxTeamName(p.from)})` : ''}`;
const tradeText = (L, M) => [`${SPORT.emoji} ${L.name} · Trade proposal`,
  ...[M.A, M.B].map(S => `${S.name} gets: ${[...S.players.map(p => `${p.name} (${p.team || 'FA'})`), ...S.picks.map(p => pickWords(p, S.sender))].join(', ')}`)].join('\n\n');
function tradeShare(L, T) {
  const M = tradeModel(T);
  return {
    title: 'Trade proposal', name: `${L.name} · Trade proposal`, what: 'Trade proposal', link: 'Side by side', text: tradeText(L, M), url: tradeUrl(L, T),
    file: `${L.name.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'league'}-trade.png`, alt: `Trade proposal between ${M.A.name} and ${M.B.name}`,
    draw: () => tradeCanvas(L, M),
  };
}

// The picture: each side in a card (what it gets: each player on his team's colors with his positions, games missed and
// average game; its draft picks), a swap mark between them, then (both sides with players) the comparison, each row's
// two numbers on bars growing from the middle, the better one orange, and what its numbers mean
async function tradeCanvas(L, M) {
  const n = M.A.players.length + M.B.players.length, picks = M.A.picks.length + M.B.picks.length, compare = !!(M.A.players.length && M.B.players.length);
  const K = await sharePad(Math.max(4000, 1400 + n * 300 + picks * 160 + M.rows.length * 100)), { C, W, inner, ctx, font, text, round, panel, lay, drawLay, meta } = K;
  await K.prep([...M.A.players, ...M.B.players]);
  let y = K.top({ kicker: 'TRADE PROPOSAL', title: L.name, sub: `${fmtDay(todayIso())} · per game, ${basisLabel().toLowerCase()}` });
  const x0 = C.pad + 32, right = W - C.pad - 32, pw = 210, ph = 154, tx = x0 + pw + 28;
  let swapY = 0;
  for (const S of [M.A, M.B]) {
    // measured first: each player's numbers wrap to the width beside his photo (the number bold, its label gray); a pick
    // is one or two lines
    const rows = [...S.players.map(p => {
      const units = [...(M.P ? [[[fmtGames(playoffGames(p, M.P)), 'b'], [' playoff G', 'm']]] : []),
        ...dealLine(p).map(s => { const i = s.indexOf(' '); return [[s.slice(0, i), 'b'], [s.slice(i), 'm']]; })];
      const lines = lay(units, right - tx, 25, 20);
      return { p, lines, h: Math.max(ph, 96 + lines.length * 36) };
    }), ...S.picks.map(k => ({ k, h: 110 }))];
    const h = 30 + 50 + sum(rows.map(r => r.h)) + (rows.length - 1) * 36 + 32;
    round(C.pad, y, inner, h, 28, C.card);
    let ty = y + 30;
    font(22, 700, 2); text(fitText(ctx, `${S.name} gets`.toUpperCase(), right - x0), x0, ty, C.accent);
    ty += 50;
    rows.forEach((r, i) => {
      if (i) { ctx.fillStyle = C.line; ctx.fillRect(x0, ty + 17, right - x0, 2); ty += 36; }
      if (r.k) {
        // a draft pick: its round where a photo would be, then the year and round, and whose it was
        const k = r.k, orig = k.from !== S.sender;
        round(x0, ty, pw, r.h, 18, C.card2);
        font(17, 700, 2); text('ROUND', x0 + pw / 2, ty + 16, C.muted, 'center');
        font(52, 700); text(String(k.round), x0 + pw / 2, ty + 40, C.accent, 'center');
        font(36, 700, -0.5); text(fitText(ctx, `${pickName(k)} pick`, right - tx), tx, ty + (orig ? 18 : 36));
        if (orig) { font(25); text(fitText(ctx, `originally ${fxTeamName(k.from)}`, right - tx), tx, ty + 66, C.muted); }
        ty += r.h;
        return;
      }
      const p = r.p;
      panel(p, x0, ty, pw, ph, 18);
      // his value a game over a waiver player, in a pill on the right
      font(27, 700); const pv = fmtValue(value(p)), pvW = ctx.measureText(pv).width + 32;
      round(right - pvW, ty, pvW, 44, 22, 'rgba(255,255,255,0.08)'); text(pv, right - pvW / 2, ty + 9, C.text, 'center');
      font(38, 700, -0.5); text(fitText(ctx, p.name, right - tx - pvW - 16), tx, ty + 2);
      // his team, his positions in their colors, his games and games missed this season, and an injury in red
      const missed = gamesMissed(p);
      meta(tx, ty + 54, 24, p.team, p.pos, [[` · ${seasonGp(p)} GP`, C.muted], ...(missed ? [[` · ${missed} missed`, C.soft, 700]] : []),
        ...(p.inj ? [[` · ${p.status.toUpperCase()}`, C.bad, 700]] : [])]);
      drawLay(r.lines, tx, ty + 96, 25, 36);
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

  const notes = [];
  if (compare) {
    // side by side: each side's number at its edge, a bar from the middle as long as its share of the bigger one (a
    // percentage has none: its marking counts makes, not the bare %), the better one orange
    y += 48;
    font(22, 700, 2); text('SIDE BY SIDE · PER GAME', C.pad, y, C.accent); y += 50;
    const cx = W / 2, lw = 104, maxBar = cx - lw - 14 - (x0 + 132), rowH = r => (r.va || r.vb ? 96 : 74);
    const h = 30 + 54 + sum(M.rows.map(rowH)) + 16;
    round(C.pad, y, inner, h, 28, C.card);
    let ty = y + 30;
    font(26, 700);
    text(fitText(ctx, M.A.name, cx - x0 - 24), x0, ty, C.text);
    text(fitText(ctx, M.B.name, right - cx - 24), right, ty, C.text, 'right');
    ty += 54;
    for (const r of M.rows) {
      const rh = rowH(r), bars = !r.pct && r.a != null && r.b != null && r.a >= 0 && r.b >= 0 && Math.max(r.a, r.b) > 0;
      ctx.fillStyle = C.line; ctx.fillRect(x0, ty, right - x0, 2);
      font(19, 700, 1.5); text(fitText(ctx, r.label.toUpperCase(), lw * 2 - 8), cx, ty + (rh - 18) / 2, C.muted, 'center');
      [[r.sa, r.va, r.a, 1], [r.sb, r.vb, r.b, -1]].forEach(([v, vol, num, side], i) => {
        const lead = r.lead === side, edge = i ? right : x0, align = i ? 'right' : 'left';
        font(32, lead ? 700 : 500); text(v, edge, ty + 19, lead ? C.accent : r.lead ? C.muted : C.text, align);
        if (vol) { font(20); text(vol, edge, ty + 60, C.muted, align); }
        if (bars) {
          const len = Math.max(8, maxBar * num / Math.max(r.a, r.b)), from = i ? cx + lw + 14 : cx - lw - 14, by = ty + (rh - 12) / 2;
          round(i ? from : from - maxBar, by, maxBar, 12, 6, 'rgba(255,255,255,0.06)');
          round(i ? from : from - len, by, len, 12, 6, lead ? C.accent : '#4a505c');
        }
      });
      ty += rh;
    }
    y += h;
    // (short: the picture has no (i), and the site's own card says the rest)
    notes.push(`${valueLabel()}: per game, over a waiver player for each roster spot`);
    if (M.P) notes.push(`playoff games: ${playoffWeeks(M.P)}${M.P.started ? ', still to play' : ''}`);
    if (M.rows.some(r => (r.va || r.vb) && !r.shot)) notes.push('FG% and FT% marked by makes over the league average');
    const pairs = M.rows.filter(r => r.shot).map(r => r.label);
    if (pairs.length) notes.push(`${pairs.join(', ')}: makes/attempts, marked by the points they score`);
  }
  if (picks) notes.push("draft picks aren't valued");
  y += 24;
  font(23);
  const said = notes.join(' · ');
  if (said) for (const l of wrapText(ctx, `${said[0].toUpperCase()}${said.slice(1)}.`, inner)) { text(l, C.pad, y, C.muted); y += 34; }
  return K.done(y);
}
