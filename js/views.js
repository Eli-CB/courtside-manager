// League Layer: Roster, Standings, Season totals, Trades.
// The site loads js/*.js in order (see index.html); they share one scope, like one file.
'use strict';

// ----- Roster: category strengths vs your league -----
const STR_KEY = 'courtside-strengths';
const DRAFT_MODE_KEY = 'courtside-draft-mode';
ui.draftMode = (() => { try { return localStorage.getItem(DRAFT_MODE_KEY) || 'game'; } catch (e) { return 'game'; } })();
ui.strBasis = (() => { try { return localStorage.getItem(STR_KEY) || 'starters'; } catch (e) { return 'starters'; } })();

function teamCatAvg(players) {
  const zs = players.map(catZ);
  return Object.fromEntries(scoreCats().map(c => [c.key, zs.length ? sum(zs.map(z => z[c.key] || 0)) / zs.length : 0]));
}

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

function strengthsCard() {
  const starterBasis = ui.strBasis === 'starters';
  const mine = starterBasis ? starters() : state.players.filter(p => !state.il.includes(p.id));
  const toggle = `<div class="seg seg-sm" role="group" aria-label="Players to include">${[['starters', 'Starters'], ['active', 'Active roster']].map(([k, l]) => `<button type="button" class="${ui.strBasis === k ? 'on' : ''}" data-action="str-basis" data-basis="${k}" aria-pressed="${ui.strBasis === k}">${l}</button>`).join('')}</div>`;
  const head = `<div class="card-head"><h2>Category strengths ${infoBtn('strengths')}</h2>${toggle}</div>`;
  if (!mine.length) return `<div class="card">${head}<div class="empty"><strong>No players yet</strong>Load your roster to see your category profile.</div></div>`;

  const me = { name: state.teamName, raw: teamRaw(mine), avg: teamCatAvg(mine), mine: true };
  const teams = [me];
  if (fxLeague()) {
    for (const t of fxPickable()) {
      if (t.id === (ui.viewing ? ui.viewA : state.fxTeam)) continue;
      const side = fxTeamSide(t.id);
      const ps = starterBasis ? side.players.filter(p => side.starters.includes(p.id)) : side.players.filter(p => !side.il.includes(p.id));
      if (ps.length) teams.push({ name: t.id === state.fxTeam ? `${t.name} (you)` : t.name, raw: teamRaw(ps), avg: teamCatAvg(ps) });
    }
  }
  const league = teams.length > 1;
  const n = teams.length;

  const rows = scoreCats().map(c => {
    const vals = teams.map(t => t.raw[c.key]);
    const mean = sum(vals) / n;
    const sd = Math.sqrt(sum(vals.map(v => (v - mean) ** 2)) / n) || 1e-9;
    // how far each team is from the league average, in team-to-team spreads (fewer TO is better)
    const gap = v => (league ? (c.neg ? -1 : 1) * (v - mean) / sd : 0);
    const z = league ? gap(me.raw[c.key]) : me.avg[c.key];
    const ranked = [...teams].sort((a, b) => gap(b.raw[c.key]) - gap(a.raw[c.key]));
    const rank = ranked.indexOf(me) + 1;
    // who helps or hurts: each player's own number against the league average shown in this row.
    // For FG%/FT% that's makes above or below average at the player's volume.
    const ref = league ? mean : (BASE[c.key] || [0])[0];
    const att = c.att;
    const impact = p => (c.neg ? -1 : 1) * (c.pct ? (pctOf(p, c) - ref) * statVal(p, att) : statOf(p, c) - ref);
    const byImpact = mine.map(p => ({ p, d: impact(p) })).sort((a, b) => b.d - a.d);
    const big = c.pct ? 0.1 : Math.max(0.1, ref * 0.1);
    const drivers = byImpact.filter(x => x.d > big).slice(0, 2);
    const drag = byImpact.filter(x => x.d < -big).slice(-1);
    const tip = x => c.pct
      ? `${x.p.name}: ${fmtPct(pctOf(x.p, c))} on ${fmt(statVal(x.p, att), 1)} attempts a game, ${fmt(Math.abs(x.d), 1)} ${x.d > 0 ? 'more' : 'fewer'} makes a game than the ${league ? 'league' : 'typical'} average of ${fmtPct(ref)} would give`
      : `${x.p.name}: ${fmt(statOf(x.p, c), 1)} ${c.label} a game vs the ${league ? 'league' : 'typical'} average of ${fmt(ref, 1)} per ${starterBasis ? 'starter' : 'player'}`;
    const who = list => list.map(x => `<span class="cs-p" title="${esc(tip(x))}"><button type="button" class="link-btn cs-name" data-action="player-detail" data-nba="${x.p.nbaId}">${inlinePlayer(x.p, esc(lastName(x.p.name)))}</button><b class="${x.d > 0 ? 'pos-good' : 'pos-bad'}">${c.pct ? fmtPct(pctOf(x.p, c)) : fmt(statOf(x.p, c), 1)}</b>${c.pct ? `<span class="muted small"> on ${fmt(statVal(x.p, att), 1)} ${att.toUpperCase()}</span>` : ''}</span>`).join('');
    const w = Math.min(Math.abs(z) / 2, 1) * 50; // bar edge = 2 spreads from the league average
    const pos = v => ((Math.max(-2.5, Math.min(2.5, gap(v))) + 2.5) / 5) * 100;
    const open = ui.csOpen.has(c.key);
    return { c, z, rank, html: `<tr class="cs-row" data-action="cs-toggle" data-cat="${c.key}" aria-expanded="${open}" title="Show who helped (green) and hurt (red) most">
      <td><span class="cs-chev" aria-hidden="true">▸</span><b>${c.label}</b></td>
      <td class="num"><b>${fmtRaw(c, me.raw[c.key])}</b>${league ? `<span class="cs-avg">avg ${fmtRaw(c, mean)}</span>` : ''}</td>
      ${league ? `<td class="num muted cs-lavg">${fmtRaw(c, mean)}</td>` : ''}
      <td class="cs-bar" title="${signed(z, 2)} spreads ${league ? 'from the league average' : 'from a typical player'}"><span class="track"><span class="fill ${z >= 0 ? 'up' : 'down'}" style="width:${w}%"></span></span></td>
      ${league ? `<td class="num cs-rank ${rank <= 3 ? 'pos-good' : rank > n - 3 ? 'pos-bad' : ''}"><b>${ordinal(rank)}</b><span class="muted hide-sm"> / ${n}</span></td>
      <td class="cs-strip"><div class="strip">${teams.map(t => `<span class="sdot${t.mine ? ' me' : ''}" style="left:${pos(t.raw[c.key]).toFixed(1)}%" title="${esc(t.name)}: ${fmtRaw(c, t.raw[c.key])}"></span>`).join('')}</div></td>` : ''}
    </tr>
    <tr class="cs-detail"${open ? '' : ' hidden'}><td colspan="${league ? 6 : 3}"><div class="cs-who">
      ${drivers.length || drag.length ? `${drivers.length ? `<div class="cs-grp"><span class="cs-tag up">Helped</span>${who(drivers)}</div>` : ''}${drag.length ? `<div class="cs-grp"><span class="cs-tag down">Hurt</span>${who(drag)}</div>` : ''}` : '<span class="muted small">No one stands out</span>'}
    </div></td></tr>` };
  });

  // with a league, strengths and weaknesses are about rank; without one, about the gap
  const strong = rows.filter(r => (league ? r.rank <= 3 : r.z > 0.2)).sort((a, b) => (a.rank - b.rank) || (b.z - a.z));
  const weak = rows.filter(r => (league ? r.rank > n - 3 : r.z < 0)).sort((a, b) => (b.rank - a.rank) || (a.z - b.z));
  const label = r => `<b>${r.c.label}</b>${league ? ` (${ordinal(r.rank)})` : ''}`;
  const unit = starterBasis ? 'per starter' : 'per player';
  const summary = `<div class="cs-summary">
      <div><span class="muted small">Strengths</span><br>${strong.slice(0, 4).map(label).join(', ') || '—'}</div>
      <div><span class="muted small">Weaknesses</span><br>${weak.slice(0, 4).map(label).join(', ') || '—'}</div>
    </div>`;
  return `<div class="card">
    ${head}
    <div class="table-wrap"><table class="cs-table">
      <thead><tr><th>Cat</th><th class="num">You <span class="muted hide-sm">${unit}</span></th>${league ? '<th class="num cs-lavg">League avg</th>' : ''}<th class="cs-bar">${league ? 'Below · league avg · above' : 'Below · typical · above'}</th>${league ? `<th class="num">Rank</th><th class="cs-strip"><span class="hide-sm">Every team (you in orange)</span><span class="show-sm-inline">All ${n} teams</span></th>` : ''}</tr></thead>
      <tbody>${rows.map(r => r.html).join('')}</tbody>
    </table></div>
    ${summary}
  </div>`;
}

function slotBadge(slot) {
  const cls = slot === 'IL' ? 'il' : `slot-${slot}`;
  return `<span class="slot-label ${cls}">${slot === 'FLX' ? 'Flx' : slot === 'BN' ? 'Res' : slot}</span>`;
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
          <td class="num">${r.w}</td><td class="num">${r.l}</td><td class="num">${r.t}</td><td class="num">${g ? fmt(((r.w + r.t / 2) / g) * 100, 0) + '%' : '—'}</td><td class="num">${r.gb ? fmt(r.gb, 1) : '—'}</td>${rows.some(x => x.pf != null) ? `<td class="num">${r.pf != null ? fmt(r.pf, 1) : '—'}</td>` : ''}</tr>`;
      }).join('')}</tbody>
    </table></div>${waiverLine()}` : `<div class="empty"><strong>No standings yet</strong>${sourceName()} didn't return standings for this league.</div>`}
  </div>
  ${!ui.season && !isFootball() && state.players.length ? strengthsCard() : ''}
  ${L ? seasonTotalsCard(L, rows) : ''}`;
}

// ----- A fantasy team's card: its record, this week's opponent, its roster by lineup spot, and how it ranks in each category -----
function showTeamCard(tid) {
  const html = teamCardHtml(tid);
  if (!html) return;
  $('#detailBody').innerHTML = html;
  $('#detailTitle').innerHTML = teamCardTitle(tid);
  cardOpen = null;
  const d = $('#detailDialog');
  if (!d.open) d.showModal();
  $('#detailBody').scrollTop = 0;
}
// the card's title: the team's name, and (you) on your own
const teamCardTitle = tid => `${esc(fxTeamName(tid))}${tid === state.fxTeam ? ' <span class="muted small">(you)</span>' : ''}`;

function teamCardHtml(tid) {
  const L = fxLeague();
  if (!L || !fxPickable().some(t => t.id === tid)) return '';
  const side = fxTeamSide(tid), me = tid === state.fxTeam;
  const r = (L.standings || []).find(x => x.id === tid), n = fxPickable().length;
  const opp = fxOpponentFor(weekStartAt(0), tid);
  const football = isFootball(), week = matchDates(weekStartAt(0));
  const byId = new Map(side.players.map(p => [p.id, p]));
  // each player's worth: football's projection this week, points per game, or categories won per game
  const worth = p => (football ? (gamesIn(p, week) ? `${fmt(footballPts(p, week), 1)}` : '<span class="muted">Bye</span>') : isPoints() ? fmt(fantasyPoints(p), 1) : fmtValue(value(p)));
  const unit = football ? 'Proj' : isPoints() ? 'FP/G' : valueLabel();
  const row = (p, slot) => `<tr${slot === 'IL' ? ' class="muted-row"' : ''}><td>${slotBadge(slot)}</td><td>${playerCell(p)}</td><td>${p.status !== 'Healthy' ? statusBadge(p) : ''}</td><td class="num"><b>${worth(p)}</b></td></tr>`;
  const starters = side.lineup.map((id, i) => (id && byId.get(id) ? row(byId.get(id), state.slots[i]) : '')).join('');
  const on = new Set([...side.lineup, ...side.il]);
  const bench = side.players.filter(p => !on.has(p.id)).sort((a, b) => value(b) - value(a)).map(p => row(p, 'BN')).join('');
  const ir = side.il.map(id => byId.get(id)).filter(Boolean).map(p => row(p, 'IL')).join('');
  // its starters' totals in each category against every team's, ranked (as Category strengths ranks them)
  let cats = '';
  if (!football && !isPoints()) {
    const raws = fxPickable().map(t => { const s = fxTeamSide(t.id); return { id: t.id, raw: teamRaw(s.players.filter(p => s.starters.includes(p.id))) }; }).filter(x => Object.keys(x.raw).length);
    const mine = raws.find(x => x.id === tid);
    if (mine && raws.length > 1) {
      cats = `<h3 class="sub" style="margin-top:16px">By category <span class="muted small">starters, against every team</span></h3><div class="tc-cats">${scoreCats().map(c => {
        const better = raws.filter(x => (c.neg ? x.raw[c.key] < mine.raw[c.key] : x.raw[c.key] > mine.raw[c.key]) && Math.abs(x.raw[c.key] - mine.raw[c.key]) > 1e-9).length;
        const rank = better + 1;
        return `<span class="tc-cat ${rank <= 3 ? 'pos-good' : rank > raws.length - 3 ? 'pos-bad' : ''}"><b>${c.label}</b> ${ordinal(rank)}</span>`;
      }).join('')}</div>`;
    }
  }
  const record = r ? `${r.w}-${r.l}${r.t ? '-' + r.t : ''} · ${ordinal(r.rank || 0)} of ${n}${r.pf != null ? ` · ${fmt(r.pf, 1)} points for` : ''}` : '';
  return `
    <div class="detail-head">
      <div><p class="muted" style="margin:0">${record}</p>
        <p style="margin:6px 0 0">${opp ? `This week vs <b>${teamLink(opp.id)}</b>` : '<span class="muted">No matchup this week</span>'}</p></div>
      ${!me && state.fxTeam ? `<button type="button" class="btn sm" data-action="team-compare" data-team="${esc(tid)}">Compare on Plan Ahead</button>` : ''}
    </div>
    ${cats}
    <h3 class="sub" style="margin-top:16px">Roster</h3>
    <div class="table-wrap"><table class="tc-roster"><thead><tr><th></th><th>Player</th><th></th><th class="num">${unit}</th></tr></thead>
      <tbody>${starters}${bench}${ir}</tbody></table></div>`;
}

// ----- Season totals: what each team's starters actually produced -----
// Fantrax returns every lineup period's rosters. A player's games count for a team only in periods he
// was ACTIVE there, using this season's box scores (data/boxscores.json, loaded when Standings opens).
let boxLoad = null;
let BOX = null; // { byPlayer, finals } once data/boxscores.json has loaded
const seasonTot = {}; // league id -> { state: 'loading' | 'ready' | 'error', teams, msg }

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

function loadBoxes() {
  boxLoad = boxLoad || fetch(`${SPORT.data}boxscores.json?v=${encodeURIComponent(NBA.updated || '')}`).then(r => {
    if (!r.ok) throw new Error(`box scores ${r.status}`);
    return r.json();
  }).then(data => {
    const unique = new Map(), cols = data.keys || SPORT.boxCols; // (a box row's columns, as boxGameLog reads them too)
    for (const [gid, g] of Object.entries(data.games || {})) {
      const key = `${g.d} ${g.home} ${g.away}`;
      if (!unique.has(key) || !gid.startsWith('espn:')) unique.set(key, g);
    }
    const byPlayer = new Map(); // NBA id -> [[date, stats]]
    const finals = new Set(); // "date team" for every finished game
    const scores = new Map(); // "date team" -> { home, away, hs, as }
    for (const g of unique.values()) {
      finals.add(`${g.d} ${g.home}`).add(`${g.d} ${g.away}`);
      const s = { home: g.home, away: g.away, hs: g.hs, as: g.as };
      scores.set(`${g.d} ${g.home}`, s).set(`${g.d} ${g.away}`, s);
      for (const row of g.rows) {
        const st = boxCounts(Object.fromEntries(cols.map((k, i) => [k, +row[i + 2] || 0])));
        const margin = row[1] === g.home ? g.hs - g.as : g.as - g.hs;
        if (!byPlayer.has(row[0])) byPlayer.set(row[0], []);
        byPlayer.get(row[0]).push([g.d, st, margin, row[1]]);
      }
    }
    BOX = { cols, byPlayer, finals, scores, day: new Map([...byPlayer].map(([id, games]) => [id, new Map(games.map(([d, st, margin]) => [d, { ...st, margin }]))])) };
    return BOX;
  }).catch(e => { boxLoad = null; throw e; });
  return boxLoad;
}

// This season's Season totals and Awards: the shared weekly rosters (Fantrax ids) mapped to NBA players
const currentFidNba = () => { const m = new Map(NBA.players.filter(r => r.fx).map(r => [r.fx.id, r.id])); return f => m.get(f) || null; };
try { localStorage.removeItem('courtside-lineups-v1'); } catch (e) { /* replaced by the shared weekly rosters */ }
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
      { label: 'FP', val: T => sum(Object.entries(sc).map(([k, v]) => tot(T, k) * v)), fmt: v => fmt(v, 1) }]
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
  // sort by any column: best first (clicking again flips it); standings order until a column is picked
  const so = ui.totSort;
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
  // the other side of the deal is another team's Fantrax roster
  const others = fxPickable().filter(t => t.id !== state.fxTeam);
  if (!others.some(t => t.id === ui.tradeTeam)) { ui.tradeTeam = others.length ? others[0].id : null; ui.tradeGet.clear(); }
  const theirs = ui.tradeTeam ? fxTeamSide(ui.tradeTeam).players : [];
  // prune selections that no longer exist (their players are picked by NBA id: they're rebuilt every render)
  for (const id of ui.tradeGive) if (!state.players.some(p => p.id === id)) ui.tradeGive.delete(id);
  for (const id of ui.tradeGet) if (!theirs.some(p => String(p.nbaId) === id)) ui.tradeGet.delete(id);

  const pick = (list, set, side, key) => list.length ? `<ul class="pick-list">${[...list].sort((a, b) => value(b) - value(a)).map(p => `
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

  return `
  <div class="trade-grid">
    <div class="card"><div class="card-head"><h2>You give</h2><span class="muted small">${give.length} selected</span></div>${pick(state.players, ui.tradeGive, 'give', p => p.id)}</div>
    <div class="card"><div class="card-head"><h2>You get</h2>${others.length ? `<select class="trade-team" data-change="trade-team" aria-label="Team to trade with">${others.map(t => `<option value="${esc(t.id)}" ${t.id === ui.tradeTeam ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>` : ''}<span class="muted small">${get.length} selected</span></div>${pick(theirs, ui.tradeGet, 'get', p => String(p.nbaId))}</div>
  </div>
  <div class="card" style="margin-top:16px">${result}</div>`;
}
