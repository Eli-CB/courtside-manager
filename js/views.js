// Courtside Manager: Dashboard, Roster, Standings, Trades, Free Agents.
// The site loads js/*.js in order (see index.html); they share one scope, like one file.
'use strict';

// ----- Dashboard: category strengths vs your league -----
const STR_KEY = 'courtside-strengths';
const DRAFT_MODE_KEY = 'courtside-draft-mode';
ui.draftMode = (() => { try { return localStorage.getItem(DRAFT_MODE_KEY) || 'game'; } catch (e) { return 'game'; } })();
ui.strBasis = (() => { try { return localStorage.getItem(STR_KEY) || 'starters'; } catch (e) { return 'starters'; } })();

function teamCatAvg(players) {
  const zs = players.map(catZ);
  return Object.fromEntries(scoreCats().map(c => [c.key, zs.length ? sum(zs.map(z => z[c.key] || 0)) / zs.length : 0]));
}

const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');

// "Viewing" picker shown on Dashboard and Roster: look at any league team, read-only
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
    const impact = p => (c.pct ? (pctOf(p, c) - ref) * statVal(p, att) : (c.neg ? -1 : 1) * (statOf(p, c) - ref));
    const byImpact = mine.map(p => ({ p, d: impact(p) })).sort((a, b) => b.d - a.d);
    const big = c.pct ? 0.1 : Math.max(0.1, ref * 0.1);
    const drivers = byImpact.filter(x => x.d > big).slice(0, 2);
    const drag = byImpact.filter(x => x.d < -big).slice(-1);
    const tip = x => c.pct
      ? `${x.p.name}: ${fmtPct(pctOf(x.p, c))} on ${fmt(statVal(x.p, att), 1)} attempts a game, ${fmt(Math.abs(x.d), 1)} ${x.d > 0 ? 'more' : 'fewer'} makes a game than the ${league ? 'league' : 'typical'} average of ${fmtPct(ref)} would give`
      : `${x.p.name}: ${fmt(statOf(x.p, c), 1)} ${c.label} a game vs the ${league ? 'league' : 'typical'} average of ${fmt(ref, 1)} per ${starterBasis ? 'starter' : 'player'}`;
    const who = list => list.map(x => `<span title="${esc(tip(x))}">${inlinePlayer(x.p, esc(lastName(x.p.name)))} <b class="${x.d > 0 ? 'pos-good' : 'pos-bad'}">${c.pct ? fmtPct(pctOf(x.p, c)) : fmt(statOf(x.p, c), 1)}</b>${c.pct ? `<span class="muted"> on ${fmt(statVal(x.p, att), 1)} ${att.toUpperCase()}</span>` : ''}</span>`).join(', ') || '<span class="muted">—</span>';
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
      ${drivers.length || drag.length ? `${drivers.length ? `<span>${who(drivers)}</span>` : ''}${drag.length ? `<span>${who(drag)}</span>` : ''}` : '<span class="muted">No one stands out</span>'}
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

/* ---------- Dashboard ---------- */
function viewDashboard() {
  // the latest games come from the box scores, loaded on first need
  if (!BOX && NBA) loadBoxes().then(() => { if (ui.tab === 'dashboard') render(); }).catch(() => {});
  if (NBA) startLive(); // today's games, as they're played (when Performances shows them)
  return `
  <div class="dash-grid">
    <div>${topPerformancesCard()}</div>
    <div class="dash-side">
      <div class="card">
        <div class="card-head"><h2>Action items</h2></div>
        <ul class="alerts">
          ${buildAlerts().map(x => `<li class="alert ${x.lvl}"><span class="dot"></span><span class="grow">${x.msg}</span>${x.action ? `<button class="btn sm" data-action="${x.action}">${x.label}</button>` : ''}</li>`).join('')}
        </ul>
      </div>
      ${newsCard()}
    </div>
  </div>`;
}

// ----- Performances: every NBA stat line from today, the last game day or this week so far, in one sortable table -----
// Today's games come from ESPN as they're played (live.js). Category leagues rank what the games added to winning a
// week's categories against not playing (lineWins), so a week adds them up; points leagues use fantasy points.
const lineStat = (line, k) => (DERIVED[k] ? sum(Object.entries(DERIVED[k]).map(([b, c]) => (line[b] || 0) * c)) : line[k] || 0);
const lineFp = line => sum(Object.entries(leaguePoints() || {}).map(([k, v]) => lineStat(line, k) * v));
const lineZ = line => catZ({ ...line, fgPct: line.fga ? line.fgm / line.fga : 0, ftPct: line.fta ? line.ftm / line.fta : 0 });
// a game's value: fantasy points, or categories won against not playing (catWins), as player value counts an average game
const lineValue = line => (isPoints() ? lineFp(line) : sum(Object.values(catWins(line))));

// Values add up linearly, so an average line (statLine of per-game stats) is worth the average of its games
const statLine = s => Object.fromEntries(COUNT_KEYS.map(k => [k, s[k] != null ? s[k] : statVal(s, k)])); // season rows have makes, projections FG%

// The days Performances can show: today (when there are games), the latest earlier day with games, and the days of
// this week's matchup that have them. The week is only offered once it holds more than one day.
function perfDays() {
  const today = todayIso();
  const played = new Set([...BOX.finals].map(x => x.slice(0, 10)));
  for (const [d, lines] of live.lines) if (lines.size) played.add(d);
  const day = [...played].filter(x => x < today).sort().pop() || null;
  const games = played.has(today) || [...teamDates.values()].some(ds => ds.has(today)) || live.games.some(g => g.d === today);
  const week = matchDates(mondayOf(today)).filter(x => x <= today && played.has(x));
  return { today: games ? today : null, started: played.has(today) || live.games.some(g => g.d === today && g.state !== 'pre'), day, week: week.length > 1 ? week : null };
}

// Each player's lines over those days (the saved box scores, else ESPN's), added up, with what they added: fantasy
// points, or categories won (lineWins), so every game counts. z sorts each category: per game against an average
// rostered player's game (a game still on: for the minutes played so far, liveZ).
function perfRows(dates) {
  const byId = new Map();
  const add = (id, d, line) => { if (!byId.has(id)) byId.set(id, []); byId.get(id).push([d, line]); };
  for (const [id, byDay] of BOX.day) for (const d of dates) if (byDay.has(d)) add(id, d, byDay.get(d));
  for (const d of dates) for (const [id, line] of liveLines(d)) if (!(BOX.day.has(id) && BOX.day.get(id).has(d))) add(id, d, line);
  const rows = [];
  for (const [id, lines] of byId) {
    const raw = nbaById.get(id);
    if (!raw) continue;
    const tot = {}, z = {};
    let v = 0;
    for (const [d, line] of lines) {
      for (const [k, x] of Object.entries(line)) if (k !== 'margin') tot[k] = (tot[k] || 0) + x;
      if (isPoints()) { v += lineFp(line); continue; }
      for (const [k, x] of Object.entries(liveZ(line, liveOn(raw, d)))) z[k] = (z[k] || 0) + x;
      v += lineValue(line);
    }
    rows.push({ raw, g: lines.length, tot, z, v, on: lines.some(([d]) => liveOn(raw, d)) });
  }
  return rows;
}

function topPerformancesCard() {
  const today = todayIso(), yesterday = addDays(today, -1);
  const card = (head, body) => `<div class="card"><div class="card-head"><h2>Performances ${infoBtn('perf')}</h2>${head}</div>${body}</div>`;
  if (!BOX) return card('', '<p class="muted small" style="margin:0">Loading the latest box scores…</p>');
  const P = perfDays();
  // the buttons: Today, the last game day before it, This week. Until one is picked: today once its games have
  // started, else the last game day
  const opts = [P.today && ['today', 'Today'], P.day && ['day', P.day === yesterday ? 'Yesterday' : fmtDay(P.day)], P.week && ['week', 'This week']].filter(Boolean);
  if (!opts.length) return card('', '<p class="muted small" style="margin:0">No games have been played yet.</p>');
  const range = opts.some(([k]) => k === ui.perfRange) ? ui.perfRange : P.started || !P.day ? opts[0][0] : 'day';
  const weekly = range === 'week';
  const dates = weekly ? P.week : [range === 'today' ? today : P.day];
  const day = dates[0];
  const updated = range === 'day' ? '' : live.error ? ` · <span class="pos-bad">ESPN: ${esc(live.error)}</span>`
    : live.at ? ` · updated ${new Date(live.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : '';
  const when = (weekly ? `${fmtDay(P.week[0])} – ${fmtDay(P.week[P.week.length - 1])}` : `${day === yesterday ? 'Last night' : day === today ? 'Today' : ''} ${fmtDay(day)}`.trim()) + updated;
  const toggle = opts.length > 1 ? `<div class="seg seg-sm" role="group" aria-label="Show games from">${opts.map(([k, l]) => `<button type="button" class="${k === range ? 'on' : ''}" data-action="perf-range" data-range="${k}" aria-pressed="${k === range}">${l}</button>`).join('')}</div>` : '';

  // who rosters each player, and where in that team's lineup he is now (active or on the bench)
  const owner = new Map(), spot = new Map();
  const L = fxLeague();
  for (const [tid, r] of Object.entries((L && L.rosters) || {})) for (const x of r) if (x.nba) { owner.set(x.nba, tid); spot.set(x.nba, x); }
  const mine = ui.viewing ? ui.viewA : state.fxTeam;
  const opp = owner.size && mine ? fxOpponentFor(dates[0], mine) : null; // this matchup's opponent
  // where a player is: in a team's starting lineup (active), on its bench (IR included), or on no roster (waivers)
  const statusOf = id => (!spot.has(id) ? 'fa' : spot.get(id).st === 'ACTIVE' ? 'active' : 'bench');
  const lineupBadge = id => {
    const x = spot.get(id);
    if (x.st === 'ACTIVE') return `<span class="badge active" title="In the starting lineup${x.slot ? ` at ${esc(x.slot)}` : ''}">Active</span>`;
    return x.st === 'INJURED_RESERVE' ? '<span class="badge bench" title="On injured reserve">IR</span>' : '<span class="badge bench" title="On the bench">Bench</span>';
  };
  // your players and the opponent's are tinted rows instead (see the row classes), so they only need the lineup badge
  const who = id => {
    const tid = owner.get(id);
    if (tid === mine || (opp && tid === opp.id)) return lineupBadge(id);
    if (tid) return `<span class="perf-owner">${esc(fxTeamName(tid))}</span> ${lineupBadge(id)}`;
    const raw = nbaById.get(id);
    return raw && raw.fx ? `<span class="badge good">${FX_STATUS[raw.fx.st] || 'Free agent'}</span>` : '';
  };

  const pts = leaguePoints();
  const expected = weekly ? WEEK_GAMES * dates.length / 7 : 1; // an average starter's games over these days
  const par = pts ? fpBase()[0] * expected : 0;
  const cats = scoreCats().filter(c => !c.fp);
  // a column sorts by what it adds: its category contribution, or its fantasy points, so best-first works for TO too
  const sortVal = (r, key) => (key === 'name' ? r.raw.name.toLowerCase() : key === 'v' ? r.v : pts ? lineStat(r.tot, key) * (pts[key] || 0) : r.z[key] || 0);
  const cell = (r, c) => {
    const b = badges.get(`${r.raw.id}|${c.key}`);
    const emo = b ? `<span class="pf-emo" aria-hidden="true">${b[0]}</span>` : '', tip = b ? ` · ${b[1]}` : '';
    if (c.pct) {
      const [m, a] = [r.tot[c.made] || 0, r.tot[c.att] || 0];
      return `<td class="sc" title="${c.label}: ${a ? `${fmt(m / a * 100, 1)}%` : 'no attempts'}${tip}">${emo}${m}-${a}</td>`;
    }
    return `<td class="sc"${b ? ` title="${b[1]}"` : ''}>${emo}${fmt(lineStat(r.tot, c.key), 0)}</td>`;
  };
  // only Value is colored: greener up to a monster night (+0.7 a game, over an average starter's games on these days),
  // red below 0 (the team was better off without it: rare, so −0.25 is full red); points leagues around an average
  // starter's points
  const valShade = r => { const g = r.v / expected; return shade(pts ? (r.v - par) / (fpBase()[1] * Math.sqrt(expected)) : g / (g < 0 ? 0.1 : 0.28), 'var(--surface)'); };
  const e = +expected.toFixed(1);
  const over = weekly ? `${e} game${e === 1 ? '' : 's'} over these days` : 'a game';
  const valTip = esc(pts ? `Fantasy points in your league; an average starter scores ${fmt(par, 1)} in ${over}`
    : `Categories won: what ${weekly ? 'his games' : 'the game'} added to winning a week's categories, against not playing (an even matchup). Below 0: his team would have done better without ${weekly ? 'them' : 'it'}`);

  // everyone who played, ranked by value; the column sorted on picks which 50 show (Value ↑ for the worst)
  const rows = perfRows(dates);
  // a finished day, among everyone who played: 🚀 the best in each category and 🔥 the second best (as many as 3
  // tied), 🧊 the worst shooting and 🧈 the most turnovers. Shooting by what it added (makes over the league's
  // average, so volume counts), everything else by the number.
  const badges = new Map();
  if (range === 'day') {
    const night = day === yesterday ? 'last night' : `on ${fmtDay(day)}`;
    const wins = new Map(pts ? [] : rows.map(r => [r, lineWins(r.tot)]));
    const tiers = (list, f) => { const m = new Map(); for (const r of list) { const v = +f(r).toFixed(6); m.set(v, [...(m.get(v) || []), r]); } return [...m].sort((a, b) => b[0] - a[0]).map(x => x[1]); };
    const give = (rs, c, e, tip) => { if (rs && rs.length <= 3) for (const r of rs) badges.set(`${r.raw.id}|${c.key}`, [e, `${tip} ${night}`]); };
    for (const c of cats) {
      if (c.pct) {
        const g = tiers(rows.filter(r => r.tot[c.att] && wins.has(r) && wins.get(r)[c.key] != null), r => wins.get(r)[c.key]);
        const low = g[g.length - 1];
        if (low && g.length > 1 && wins.get(low[0])[c.key] < 0) give(low, c, '🧊', `Worst ${c.label} shooting`);
        give(g[0], c, '🚀', `Best ${c.label} shooting`);
        if (g[0] && g[0].length === 1) give(g[1], c, '🔥', `2nd best ${c.label} shooting`);
        continue;
      }
      const g = tiers(rows.filter(r => lineStat(r.tot, c.key) > 0), r => lineStat(r.tot, c.key));
      if (c.neg) { give(g[0], c, '🧈', `Most ${c.label}`); continue; }
      give(g[0], c, '🚀', `Most ${c.label}`);
      if (g[0] && g[0].length === 1) give(g[1], c, '🔥', `2nd most ${c.label}`);
    }
  }
  const legend = badges.size ? '<p class="muted small pf-legend">🚀 best · 🔥 2nd best in a category · 🧊 worst shooting · 🧈 most turnovers</p>' : '';
  const rank = new Map([...rows].sort((a, b) => b.v - a.v).map((r, i) => [r, i + 1]));
  // filter by team (yours, this matchup's opponent's, the others') and by where players are: active, bench, or
  // waivers (no team, so the team filters don't hide them)
  const teamOf = r => { const tid = owner.get(r.raw.id); return !tid ? null : tid === mine ? 'me' : opp && tid === opp.id ? 'opp' : 'other'; };
  // My team and Opponent show their row tint, so they double as the legend
  const pill = ([k, l, title]) => `<button type="button" class="pill${ui.perfShow[k] ? ' on' : ''}" data-action="perf-show" data-group="${k}" aria-pressed="${!!ui.perfShow[k]}"${title ? ` title="${esc(title)}"` : ''}>${k === 'me' || k === 'opp' ? `<span class="pf-swatch pf-${k}"></span>` : ''}${l}</button>`;
  const teams = [['me', 'My team'], ...(opp ? [['opp', 'Opponent', opp.name]] : []), ['other', 'Other teams']];
  const where = [['active', 'Active', 'In their team\'s starting lineup'], ['bench', 'Bench', 'On their team\'s bench or IR'], ['fa', 'Waivers', 'Not on a roster in your league']];
  const filters = !owner.size || !rows.length ? '' : `<div class="perf-filters" role="group" aria-label="Show players">${teams.map(pill).join('')}<span class="pf-sep" aria-hidden="true"></span>${where.map(pill).join('')}</div>`;
  const picked = owner.size ? rows.filter(r => { const t = teamOf(r); return (!t || ui.perfShow[t]) && ui.perfShow[statusOf(r.raw.id)]; }) : rows;
  const so = ui.perfSort;
  const th = (key, label, cls) => sortTh('perf-sort', key, label, so, { cls, down: so.dir < 0 });
  const shown = [...picked].sort((a, b) => { const x = sortVal(a, so.key), y = sortVal(b, so.key); return (x < y ? -1 : x > y ? 1 : 0) * so.dir; }).slice(0, 50);
  const count = `${picked.length > shown.length ? `${shown.length} of ` : ''}${picked.length} player${picked.length === 1 ? '' : 's'}`;
  // today before tip-off: when the first game starts
  const first = live.games.filter(g => g.d === day && g.state === 'pre').sort((a, b) => a.start - b.start)[0];
  const waiting = range === 'today' && !rows.length ? `<p class="muted small" style="margin:0">${live.at || live.error ? `No games have started yet.${first ? ` First tip-off ${first.start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` : ''}` : "Loading today's games…"}</p>` : '';
  const table = !rows.length ? waiting : !shown.length ? '<p class="muted small" style="margin:0">No players match these filters.</p>' : `<div class="perf-wrap${shown.length > 5 ? ' scroll' : ''}"><table class="perf-table">
      <thead><tr>${th('name', 'Player', 'pf-name')}${cats.map(c => th(c.key, c.label, 'sc')).join('')}${th('v', pts ? 'FP' : 'Value', 'num pf-v')}</tr></thead>
      <tbody>${shown.map(r => `<tr class="${teamOf(r) === 'me' ? 'pf-me' : teamOf(r) === 'opp' ? 'pf-opp' : ''}">
        <td class="pf-name"${teamOf(r) === 'me' ? ' title="Your team"' : teamOf(r) === 'opp' ? ` title="Opponent: ${esc(opp.name)}"` : ''}><div class="bplayer"><span class="perf-rank">${rank.get(r)}</span>${headshot({ nbaId: r.raw.id, name: r.raw.name }, 28)}<div class="bmain">
          <div class="bname"><button class="link-btn pname" data-action="player-detail" data-nba="${r.raw.id}">${esc(r.raw.name)}</button></div>
          <div class="pmeta">${weekly ? `${r.on ? '<span class="lv-dot" aria-hidden="true"></span>' : ''}${r.g} G · ` : day === today && liveStatus(r.raw, day) ? `${liveStatus(r.raw, day)} · ` : ''}${Math.round(r.tot.min || 0)} min · ${who(r.raw.id)}</div></div></div></td>
        ${cats.map(c => cell(r, c)).join('')}
        <td class="num pf-v" style="${valShade(r)}" data-tip="${valTip}">${pts ? fmt(r.v, 1) : signed(r.v, 2)}</td>
      </tr>`).join('')}</tbody>
    </table></div>${legend}`;
  return card(toggle, `<p class="muted small perf-when">${when}${rows.length ? ` · ${count}` : ''}</p>${filters}${table}`);
}

function newsCard() {
  const mine = state.players.filter(p => p.inj);
  mine.sort((a, b) => (b.inj.date || '').localeCompare(a.inj.date || ''));
  const body = mine.length ? `<ul class="alerts">${mine.slice(0, 6).map(p => `<li class="alert ${p.inj.status === 'Out' ? 'bad' : 'warn'}">${headshot(p, 32)}<span class="grow"><b>${esc(p.name)}</b> <span class="badge ${p.inj.status === 'Out' ? 'bad' : 'warn'}">${esc(p.inj.label)}</span><br><span class="small">${esc(p.inj.note)}</span> <span class="muted small">${p.inj.date ? fmtDay(p.inj.date) : ''}</span></span></li>`).join('')}</ul>`
    : `<p class="muted small" style="margin:0">${NBA ? 'None of your players are on the injury report.' : 'Injury news appears here when live NBA data is available.'}</p>`;
  return `<div class="card"><div class="card-head"><h2>Injury news</h2><span class="muted small">your players · ESPN</span></div>${body}</div>`;
}

function slotBadge(slot) {
  const cls = slot === 'IL' ? 'il' : `slot-${slot}`;
  return `<span class="slot-label ${cls}">${slot === 'FLX' ? 'Flx' : slot === 'BN' ? 'Res' : slot}</span>`;
}

/* ---------- Roster ---------- */

function sortList(list, sortState) {
  const { key, dir } = sortState;
  const slotRank = p => { const s = slotOf(p); return s === 'IL' ? 99 : s === 'BN' ? 50 : state.lineup.indexOf(p.id); };
  const get = p => key === 'value' ? value(p) : key === 'slot' ? slotRank(p) : key === 'name' ? p.name.toLowerCase() : key === 'status' ? STATUSES.indexOf(p.status) : key === 'tag' ? p.tag.toLowerCase() : key === 'fp' ? fantasyPoints(p) : statVal(p, key);
  return [...list].sort((a, b) => { const x = get(a), y = get(b); return (x < y ? -1 : x > y ? 1 : 0) * dir; });
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

function headerRow(cols, sortState, scope) {
  return cols.map(([k, l]) => {
    const isNum = !['name', 'status', 'slot', 'tag'].includes(k);
    return sortTh('sort', k, k === 'value' ? valueLabel() : l, sortState, { cls: isNum ? 'num' : '', down: sortState.dir < 0, attrs: ` data-scope="${scope}"` });
  }).join('');
}

function statCells(p) {
  return `<td class="num">${fmt(p.min, 0)}</td><td class="num">${fmt(p.pts)}</td><td class="num">${fmt(p.reb)}</td><td class="num">${fmt(p.ast)}</td>
    <td class="num">${fmt(p.stl)}</td><td class="num">${fmt(p.blk)}</td><td class="num">${fmt(p.tpm)}</td><td class="num">${fmt(p.to)}</td>
    <td class="num">${fmtPct(p.fgPct)}</td><td class="num">${fmtPct(p.ftPct)}</td><td class="num"><b>${fmtValue(value(p))}</b></td>`;
}

// The roster as a team profile: minutes, then whatever the league scores, each cell shaded by how
// much the player helps (green) or hurts (red) it next to an average rostered player
function rosterCols() {
  return [['name', 'Player'], ['status', 'Status'], ['slot', 'Slot'], ['min', 'MIN'], ...scoreCats().map(c => [c.key, c.label]), ...(isPoints() ? [] : [['value', '']])];
}

function viewRoster() {
  const list = sortList(state.players, ui.rosterSort);
  const act = state.players.filter(p => !state.il.includes(p.id));
  const cats = scoreCats();
  const fmtC = (c, v) => (c.pct ? fmtPct(v) : fmt(v, c.dec || 1));
  const total = c => {
    if (!c.pct) return sum(act.map(p => statOf(p, c)));
    const att = sum(act.map(p => statVal(p, c.att)));
    return att ? sum(act.map(p => statVal(p, c.made))) / att : 0;
  };
  return `
  <div class="week-stack">
  ${strengthsCard()}
  <div class="card">
    <div class="card-head"><h2>Players ${infoBtn('value')}</h2><span class="muted small">${activeCount()} of ${rosterLimit()} active · ${state.il.length}/${state.ilSize} on IR · per game, green helps, red hurts</span></div>
    ${list.length ? `<div class="table-wrap"><table class="roster-table">
      <thead><tr>${headerRow(rosterCols(), ui.rosterSort, 'roster')}</tr></thead>
      <tbody>${list.map(p => `<tr${state.il.includes(p.id) ? ' class="muted-row"' : ''}>
        <td class="player">${playerCell(p)}</td>
        <td>${statusBadge(p)}</td><td>${slotBadge(slotOf(p))}</td>
        <td class="num">${fmt(p.min, 0)}</td>
        ${cats.map(c => `<td class="num rc" style="${shade(contribZ(p, c.key, 1, false))}" title="${esc(statTip(p, c, 1, false))}">${fmtC(c, statOf(p, c))}</td>`).join('')}
        ${isPoints() ? '' : `<td class="num"><b>${fmtValue(value(p))}</b></td>`}
        </tr>`).join('')}
      </tbody>
      <tfoot><tr><td colspan="4"><b>Active totals</b></td>
        ${cats.map(c => `<td class="num"><b>${fmtC(c, total(c))}</b></td>`).join('')}${isPoints() ? '' : '<td></td>'}</tr></tfoot>
    </table></div>` : `<div class="empty"><strong>No players on this roster</strong>Rosters come from ${sourceName()}. Use ↻ Reload from ${sourceName()} in the ⚙ menu to pull the latest.</div>`}
  </div>
  </div>`;
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
        return `<tr${r.id === myTeamId() ? ' class="me-row"' : ''}><td class="num">${r.rank}</td><td><b>${esc(r.name)}</b>${r.id === myTeamId() ? ' <span class="muted small">(you)</span>' : ''}</td>
          <td class="num">${r.w}</td><td class="num">${r.l}</td><td class="num">${r.t}</td><td class="num">${g ? fmt(((r.w + r.t / 2) / g) * 100, 0) + '%' : '—'}</td><td class="num">${r.gb ? fmt(r.gb, 1) : '—'}</td>${rows.some(x => x.pf != null) ? `<td class="num">${r.pf != null ? fmt(r.pf, 1) : '—'}</td>` : ''}</tr>`;
      }).join('')}</tbody>
    </table></div>` : `<div class="empty"><strong>No standings yet</strong>${sourceName()} didn't return standings for this league.</div>`}
  </div>
  ${L ? seasonTotalsCard(L, rows) : ''}`;
}

// ----- Season totals: what each team's starters actually produced -----
// Fantrax returns every lineup period's rosters. A player's games count for a team only in periods he
// was ACTIVE there, using this season's box scores (data/boxscores.json, loaded when Standings opens).
const BOX_COLS = ['min', 'pts', 'reb', 'ast', 'stl', 'blk', 'tpm', 'to', 'fgm', 'fga', 'ftm', 'fta', 'oreb', 'dreb', 'tpa', 'pf', 'pm'];
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
  boxLoad = boxLoad || fetch(`data/boxscores.json?v=${encodeURIComponent(NBA.updated || '')}`).then(r => {
    if (!r.ok) throw new Error(`box scores ${r.status}`);
    return r.json();
  }).then(data => {
    const unique = new Map();
    for (const [gid, g] of Object.entries(data.games || {})) {
      const key = `${g.d} ${g.home} ${g.away}`;
      if (!unique.has(key) || !gid.startsWith('espn:')) unique.set(key, g);
    }
    const byPlayer = new Map(); // NBA id -> [[date, stats]]
    const finals = new Set(); // "date team" for every finished game
    for (const g of unique.values()) {
      finals.add(`${g.d} ${g.home}`).add(`${g.d} ${g.away}`);
      for (const row of g.rows) {
        const st = boxCounts(Object.fromEntries(BOX_COLS.map((k, i) => [k, +row[i + 2] || 0])));
        const margin = row[1] === g.home ? g.hs - g.as : g.as - g.hs;
        if (!byPlayer.has(row[0])) byPlayer.set(row[0], []);
        byPlayer.get(row[0]).push([g.d, st, margin, row[1]]);
      }
    }
    BOX = { byPlayer, finals, day: new Map([...byPlayer].map(([id, games]) => [id, new Map(games.map(([d, st, margin]) => [d, { ...st, margin }]))])) };
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
      for (const r of (nba && G.players.get(nba)) || []) {
        if (!wd.has(r[0])) continue;
        T.gp++;
        for (const [k, v] of Object.entries(gameLine(G, r))) T.s[k] = (T.s[k] || 0) + v;
      }
    }
  }
  return teams;
}

function seasonTotalsCard(L, standings) {
  const head = `<div class="card-head"><h2>Season totals ${infoBtn('totals')}</h2><span class="muted small">from each ${leagueLineupMode(L) === 'daily' ? "day's" : "week's"} starting lineups</span></div>`;
  const note = msg => `<div class="card" style="margin-top:16px">${head}<p class="muted small" style="margin:0">${msg}</p></div>`;
  let teams;
  if (seasonCtx) {
    // a past season: its weekly lineups and its game log (loaded the first time it's needed)
    if (!L.weeks) return note("Fantrax didn't return this season's weekly rosters.");
    if (!L.season || !(L.season in gameLogs)) {
      if (L.season) loadGameLog(L.season).then(() => { if (ui.tab === 'standings' && ui.season) render(); });
      return L.season ? note('Loading the season’s games…') : note('No NBA game logs are saved for this season.');
    }
    if (!gameLogs[L.season]) return note('No NBA game logs are saved for this season (the site has 2016-17 on).');
    teams = pastSeasonTotals(L, gameLogs[L.season]);
  } else if (!hasLineupHistory(L)) {
    return note(`Season totals need every day's lineups, which the site reads from Fantrax only for now, not ${sourceName(L)}.`);
  } else {
    const id = L.id;
    const S = seasonTot[id];
    if (!S) {
      seasonTot[id] = { state: 'loading' };
      buildSeasonTotals(L).then(t => { seasonTot[id] = { state: 'ready', teams: t }; })
        .catch(e => { seasonTot[id] = { state: 'error', msg: e.message }; })
        .finally(() => { if (ui.tab === 'standings' && !ui.season) render(); });
    }
    if (!S || S.state === 'loading') return note('Loading every lineup from Fantrax…');
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
      <tbody>${idx.map(i => { const x = list[i]; return `<tr${x.tid === myTeamId() ? ' class="me-row"' : ''}><td><b>${esc(fxTeamName(x.tid) || '')}</b></td><td class="num muted">${x.T.gp}</td>
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
    const wv = waiverValue(), over = p => value(p) - wv;
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

/* ---------- NBA players ---------- */
const PF_SORTS = { val: 'Value', pts: 'PTS', reb: 'REB', ast: 'AST', stl: 'STL', blk: 'BLK', tpm: '3PM', min: 'MIN', games: 'Games left this week' };

function ownedNbaIds() {
  return { roster: new Set(state.players.map(p => p.nbaId).filter(Boolean)) };
}

function filteredPlayers() {
  const f = ui.pf;
  const q = normName(f.q);
  const owned = ownedNbaIds();
  let list = nbaPlayers().filter(p =>
    (!q || normName(p.name).includes(q)) &&
    (!f.pos || p.pos.includes(f.pos)) &&
    (!f.team || p.team === f.team) &&
    (f.show !== 'available' || !owned.roster.has(p.nbaId)) &&
    (f.show !== 'fa' || (fxLeague() ? fxAvailable(nbaById.get(p.nbaId)) : !owned.roster.has(p.nbaId))) &&
    (f.show !== 'injured' || p.inj) &&
    (f.show !== 'healthy' || !p.inj));
  const k = f.sort;
  list = [...list].sort((a, b) => (b[k] - a[k]) || (b.val - a.val));
  return list;
}

function playerRows() {
  const owned = ownedNbaIds();
  const all = filteredPlayers();
  const list = all.slice(0, ui.pf.limit);
  if (!all.length) return `<div class="empty"><strong>No players match</strong>Try a different name or clear the filters.</div>`;
  const rows = list.map((p, i) => {
    const onRoster = owned.roster.has(p.nbaId);
    return `<tr>
      <td class="num muted">${i + 1}</td>
      <td class="player">${playerCell(p, true, false)}</td>
      <td>${statusBadge(p)}</td>
      <td class="num">${p.gp || '—'}</td>${p.gp ? statCells(p) : `<td class="num muted" colspan="11">No NBA stats yet</td>`}
      <td class="num">${p.games}</td>
      <td class="row-actions">${(() => { const raw = nbaById.get(p.nbaId); return raw && raw.fx && !onRoster ? `<span class="badge ${raw.fx.st === 'T' ? '' : 'good'}">${FX_STATUS[raw.fx.st] || raw.fx.st}</span> ` : ''; })()}${onRoster ? '<span class="badge accent">On roster</span>' : ''}</td>
    </tr>`;
  }).join('');
  return `<div class="table-wrap"><table>
    <thead><tr><th class="num">#</th><th>Player</th><th>Status</th><th class="num">GP</th><th class="num">MIN</th><th class="num">PTS</th><th class="num">REB</th><th class="num">AST</th><th class="num">STL</th><th class="num">BLK</th><th class="num">3PM</th><th class="num">TO</th><th class="num">FG%</th><th class="num">FT%</th><th class="num">${valueLabel()}</th><th class="num" title="Games left this week">Wk G</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table></div>
    <div class="list-foot"><span class="muted small">Showing ${list.length} of ${all.length}</span>${all.length > list.length ? '<button class="btn sm" data-action="more-players">Show 50 more</button>' : ''}</div>`;
}

function viewPlayers() {
  if (!NBA) {
    return `<div class="card"><div class="empty"><strong>Loading player data…</strong>If this doesn't load, the data file is missing. Run <code>python scripts/update_data.py</code> and reload.</div></div>`;
  }
  const f = ui.pf;
  const teams = [...new Set(NBA.players.map(p => p.team).filter(Boolean))].sort();
  return `
  ${ui.viewing ? '' : recommendedCard()}
  <div class="card">
    <div class="card-head"><h2>${f.show === 'fa' ? 'Available players' : 'NBA players'} ${infoBtn('projection')}</h2><span class="muted small">${BASIS_LABELS[state.basis]} stats</span>${LOCAL ? '<button class="btn sm" data-action="refresh-data">Refresh stats</button>' : ''}</div>
    <div class="filters">
      <label class="field grow" for="pfQ">Search<input id="pfQ" type="search" placeholder="Player name" value="${esc(f.q)}" data-input="pf" data-key="q" autocomplete="off"></label>
      <label class="field" for="pfPos">Position<select id="pfPos" data-change="pf" data-key="pos"><option value="">All</option>${POSITIONS.map(x => `<option ${f.pos === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <label class="field" for="pfTeam">Team<select id="pfTeam" data-change="pf" data-key="team"><option value="">All</option>${teams.map(t => `<option ${f.team === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="field" for="pfShow">Show<select id="pfShow" data-change="pf" data-key="show">${[['fa', 'Available'], ['all', 'Every NBA player'], ['available', 'Not on my roster'], ['healthy', 'Healthy only'], ['injured', 'Injured only']].map(([v, l]) => `<option value="${v}" ${f.show === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field" for="pfSort">Sort by<select id="pfSort" data-change="pf" data-key="sort">${Object.entries(PF_SORTS).map(([v, l]) => `<option value="${v}" ${f.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    <div id="playerResults">${playerRows()}</div>
  </div>`;
}

// ----- Recommended adds -----
// How far your team is from the league average in each category, in team-to-team spreads (+ is good)
function catGaps() {
  const raws = [teamRaw(state.players.filter(p => !state.il.includes(p.id)))];
  for (const t of fxPickable()) {
    if (t.id === state.fxTeam) continue;
    const side = fxTeamSide(t.id);
    const ps = side.players.filter(p => !side.il.includes(p.id));
    if (ps.length) raws.push(teamRaw(ps));
  }
  const out = {};
  for (const c of scoreCats()) {
    const vals = raws.map(r => r[c.key]);
    const m = sum(vals) / vals.length;
    const sd = Math.sqrt(sum(vals.map(v => (v - m) ** 2)) / vals.length) || 1e-9;
    out[c.key] = (c.neg ? -1 : 1) * (vals[0] - m) / sd;
  }
  return out;
}

// When the league's playoffs start (Fantrax's first playoff period), else the last few weeks of the season
function playoffStart(L = fxLeague()) {
  const per = (L && L.periods) || [];
  const p = L && L.playoffPeriod ? per.find(x => x.n === L.playoffPeriod) : per[per.length - 3];
  return p ? p.start : null;
}

// Up to three free agents worth adding, each against the player they'd replace (none with an open spot).
// Points leagues go by fantasy points per game; in cats, your weak categories count extra and strong ones less.
// With an open IR spot and nobody to put there, also the best injured free agent due back before the playoffs.
function recommendedAdds() {
  if (!NBA || !state.players.length) return null;
  const act = state.players.filter(p => !state.il.includes(p.id));
  const w = isPoints() ? null : Object.fromEntries(Object.entries(catGaps()).map(([k, g]) => [k, Math.max(0.5, Math.min(1.5, 1 - 0.25 * g))]));
  const worth = p => (w ? sum(scoreCats().map(c => (catWins(p)[c.key] || 0) * w[c.key])) : fantasyPoints(p));
  const open = activeCount() < rosterLimit();
  const drop = open || !act.length ? null : act.reduce((a, b) => (worth(a) <= worth(b) ? a : b));
  const base = drop ? worth(drop) : -Infinity;
  const pool = nbaPlayers()
    .filter(x => x.gp && (fxLeague() ? fxAvailable(nbaById.get(x.nbaId)) : !state.players.some(p => p.nbaId === x.nbaId)))
    .sort((a, b) => b.val - a.val).slice(0, 120)
    .map(x => playerFromRaw(nbaById.get(x.nbaId)));
  const helps = p => (w && drop ? scoreCats().filter(c => (catWins(p)[c.key] || 0) - (catWins(drop)[c.key] || 0) > 0.01).map(c => c.label) : []);
  const adds = pool.filter(p => p.status !== 'Out')
    .map(p => ({ p, gain: worth(p) - base, helps: helps(p) }))
    .filter(x => x.gain > 0).sort((a, b) => b.gain - a.gain).slice(0, 3);

  let stash = null;
  const ends = playoffStart(), today = todayIso();
  if (state.il.length < state.ilSize && !act.some(p => p.status === 'Out') && ends) {
    const best = pool.filter(p => p.status === 'Out' && p.inj && p.inj.back && p.inj.back > today && p.inj.back < ends && worth(p) > base)
      .sort((a, b) => worth(b) - worth(a))[0];
    if (best) stash = { p: best, back: best.inj.back, ends };
  }
  return { adds, drop, stash };
}

function recommendedCard() {
  const r = recommendedAdds();
  if (!r) return '';
  const fx = p => { const raw = nbaById.get(p.nbaId); return raw && raw.fx ? `<span class="badge good">${FX_STATUS[raw.fx.st] || raw.fx.st}</span>` : ''; };
  const gainTxt = g => (isPoints() ? `${signed(g, 1)} FP/G` : `${fmtValue(g)} value`);
  const rows = r.adds.map(x => `<li class="rec">
      <div class="rec-who">${playerCell(x.p)}</div>
      <div class="rec-why">${fx(x.p)} ${r.drop ? `<span>for ${inlinePlayer(r.drop, esc(r.drop.name))}</span> <b class="pos-good">${gainTxt(x.gain)}</b>` : '<span>open roster spot</span>'}${x.helps.length ? `<div class="muted small">helps ${x.helps.join(', ')}</div>` : ''}</div>
    </li>`);
  if (r.stash) rows.push(`<li class="rec">
      <div class="rec-who">${playerCell(r.stash.p)}</div>
      <div class="rec-why">${fx(r.stash.p)} <span class="badge">IR stash</span> <span>back about <b>${fmtDay(r.stash.back)}</b></span>
        <div class="muted small">For your open IR spot, no drop needed. Expected back before the playoffs (${fmtDay(r.stash.ends)}), per ESPN.</div></div>
    </li>`);
  return `<div class="card">
    <div class="card-head"><h2>Recommended adds</h2><span class="muted small">${isPoints() ? 'by fantasy points per game' : 'weighted toward your weaker categories'}</span></div>
    ${rows.length ? `<ul class="recs">${rows.join('')}</ul>` : `<p class="muted small" style="margin:0">No free agent is better than ${r.drop ? esc(r.drop.name) + ', your weakest player' : 'anyone on your roster'}.</p>`}
  </div>`;
}

function showPlayerDetail(nbaId) {
  const raw = nbaById.get(nbaId);
  if (!raw) return;
  const owned = ownedNbaIds();
  const t = teamInfo(raw.team);
  const lines = [['Projection', 'Proj', nbaStats(raw)], [NBA.season, String(NBA.season).slice(2), statObj(raw.cur)], ['Last 10', 'L10', statObj(raw.l10)], [NBA.prevSeason, String(NBA.prevSeason).slice(2), statObj(raw.prev)]]
    .filter(([, , s]) => s && s.gp);
  // value as Performances counts it (categories won against not playing, or fantasy points): per game, and this season's games added up
  const VAL = isPoints() ? 'FP' : 'Value';
  const valTip = esc(isPoints() ? 'Fantasy points in your league' : "Categories won: what a game adds to winning a week's categories, against not playing (an even matchup). Below 0: his team would have done better without it");
  const valCell = (v, d) => `<td class="num${v < 0 && !isPoints() ? ' pos-bad' : ''}" data-tip="${valTip}"><b>${fmtValue(v, d)}</b></td>`;
  const perGameVal = s => lineValue(statLine(s));
  const cur = statObj(raw.cur);
  const season = cur && cur.gp ? { per: perGameVal(cur), gp: Math.round(cur.gp) } : null;
  // phones: stats down the side, seasons across
  const AVG = [['GP', s => Math.round(s.gp)], ['MIN', s => fmt(s.min, 1)], ['PTS', s => fmt(s.pts)], ['REB', s => fmt(s.reb)], ['AST', s => fmt(s.ast)], ['STL', s => fmt(s.stl)], ['BLK', s => fmt(s.blk)], ['3PM', s => fmt(s.tpm)], ['TO', s => fmt(s.to)], ['FG%', s => fmtPct(s.fga ? s.fgm / s.fga : 0)], ['FT%', s => fmtPct(s.fta ? s.ftm / s.fta : 0)]];
  const avgNarrow = lines.length ? `<table class="pc-avg show-sm"><thead><tr><th></th>${lines.map(([, short]) => `<th class="num">${esc(short)}</th>`).join('')}</tr></thead>
    <tbody>${AVG.map(([label, f]) => `<tr><td><b>${label}</b></td>${lines.map(([, , st]) => `<td class="num">${f(st)}</td>`).join('')}</tr>`).join('')}
    <tr><td><b>${VAL}</b></td>${lines.map(([, , st]) => valCell(perGameVal(st))).join('')}</tr></tbody></table>` : '';
  const rows = lines.map(([l, , s]) => [l, s])
    .map(([l, s]) => `<tr><td><b>${l}</b></td><td class="num">${Math.round(s.gp)}</td><td class="num">${fmt(s.min, 1)}</td><td class="num">${fmt(s.pts)}</td><td class="num">${fmt(s.reb)}</td><td class="num">${fmt(s.ast)}</td><td class="num">${fmt(s.stl)}</td><td class="num">${fmt(s.blk)}</td><td class="num">${fmt(s.tpm)}</td><td class="num">${fmt(s.to)}</td><td class="num">${fmtPct(s.fga ? s.fgm / s.fga : 0)}</td><td class="num">${fmtPct(s.fta ? s.ftm / s.fta : 0)}</td>${valCell(perGameVal(s))}</tr>`).join('');
  const games = (raw.log || []).map(g => { const o = {}; NBA.logKeys.forEach((k, i) => { o[k] = g[i]; }); return o; });
  // phones: each game as a short block
  const gamesNarrow = games.length ? `<ul class="pc-games show-sm">${games.map(o => { const v = lineValue(o); return `<li>
      <div class="pc-g-top"><b>${esc(fmtDay(o.date))}</b>${o.type === 'PRE' ? ' <span class="badge">Pre</span>' : ''} <span class="muted">${esc(o.matchup)}</span>${o.wl ? ` <span class="badge ${o.wl === 'W' ? 'good' : 'bad'}">${o.wl}</span>` : ''}<span class="pc-g-min">${Math.round(o.min)} min · <span class="${v < 0 && !isPoints() ? 'pos-bad' : ''}" data-tip="${valTip}">${fmtValue(v)} ${isPoints() ? 'FP' : 'value'}</span></span></div>
      <div>${[`${o.pts} PTS`, `${o.reb} REB`, `${o.ast} AST`, `${o.stl} STL`, `${o.blk} BLK`, `${o.tpm} 3PM`, `${o.to} TO`].map(x => `<span>${x}</span>`).join(' · ')}</div>
      <div class="muted">${o.fgm}-${o.fga} FG · ${o.ftm}-${o.fta} FT</div></li>`; }).join('')}</ul>` : '';
  const logs = games.map(o => `<tr><td>${esc(fmtDay(o.date))}${o.type === 'PRE' ? ' <span class="badge">Pre</span>' : ''}</td><td>${esc(o.matchup)}</td><td>${o.wl ? `<span class="badge ${o.wl === 'W' ? 'good' : 'bad'}">${o.wl}</span>` : ''}</td><td class="num">${o.min}</td><td class="num">${o.pts}</td><td class="num">${o.reb}</td><td class="num">${o.ast}</td><td class="num">${o.stl}</td><td class="num">${o.blk}</td><td class="num">${o.tpm}</td><td class="num">${o.to}</td><td class="num">${o.fgm}-${o.fga}</td><td class="num">${o.ftm}-${o.fta}</td>${valCell(lineValue(o))}</tr>`).join('');
  const onRoster = owned.roster.has(raw.id);
  $('#detailBody').innerHTML = `
    <div class="detail-head">
      <div class="detail-id">${headshot({ nbaId: raw.id, name: raw.name }, 64)}<div><h2>${esc(raw.name)}</h2><p class="muted" style="margin:2px 0 0">${esc(raw.team)}${raw.jersey ? ' · #' + esc(raw.jersey) : ''} · ${posTags(raw.pos)} (NBA: ${esc(raw.nbaPos || '—')}) · ${raw.exp ? raw.exp + ' yrs in league' : 'Rookie'}</p></div></div>
      <div>${raw.inj ? `<span class="badge ${raw.inj.status === 'Out' ? 'bad' : 'warn'}">${esc(raw.inj.label)}</span>` : '<span class="badge good">Healthy</span>'}</div>
    </div>
    ${raw.inj ? `<div class="alert ${raw.inj.status === 'Out' ? 'bad' : 'warn'}" style="margin-top:12px"><span class="dot"></span><span class="grow small">${esc(raw.inj.note)} <span class="muted">${raw.inj.date ? fmtDay(raw.inj.date) : ''} · ESPN</span></span></div>` : ''}
    <div class="proj-grid" style="margin-top:12px">
      <div class="proj"><div class="k">Next game</div><div class="v">${t && t.next ? nextGame(t.next) : '—'}</div></div>
      <div class="proj"><div class="k">Games left this week</div><div class="v">${t ? t.left : '—'}</div></div>
      <div class="proj" data-tip="${valTip}"><div class="k">${VAL} per game</div><div class="v${season && season.per < 0 && !isPoints() ? ' pos-bad' : ''}">${season ? fmtValue(season.per) : '—'}</div></div>
      <div class="proj" data-tip="${valTip}"><div class="k">${VAL} this season</div><div class="v">${season ? `${fmtValue(season.per * season.gp, 1)} <span class="muted small">in ${season.gp} G</span>` : '—'}</div></div>
    </div>
    <h3 class="sub" style="margin-top:16px">Per-game averages</h3>
    ${avgNarrow}${rows ? `<div class="table-wrap hide-sm"><table><thead><tr><th></th><th class="num">GP</th><th class="num">MIN</th><th class="num">PTS</th><th class="num">REB</th><th class="num">AST</th><th class="num">STL</th><th class="num">BLK</th><th class="num">3PM</th><th class="num">TO</th><th class="num">FG%</th><th class="num">FT%</th><th class="num">${VAL}</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted small">No NBA regular-season stats yet.</p>'}
    <h3 class="sub" style="margin-top:16px">Recent games</h3>
    ${gamesNarrow}${logs ? `<div class="table-wrap hide-sm"><table><thead><tr><th>Date</th><th>Matchup</th><th></th><th class="num">MIN</th><th class="num">PTS</th><th class="num">REB</th><th class="num">AST</th><th class="num">STL</th><th class="num">BLK</th><th class="num">3PM</th><th class="num">TO</th><th class="num">FG</th><th class="num">FT</th><th class="num">${VAL}</th></tr></thead><tbody>${logs}</tbody></table></div>` : '<p class="muted small">No games played yet this season.</p>'}`;
  $('#detailFoot').innerHTML = `
    <button type="button" class="btn ghost" data-action="close-detail">Close</button>
    ${onRoster ? '<span class="badge accent">On your roster</span>' : ''}`;
  const d = $('#detailDialog');
  if (!d.open) d.showModal();
}
