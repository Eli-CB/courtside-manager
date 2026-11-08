// League Layer: Players tab, recommended adds and the player card.
// The site loads js/*.js in order (see index.html); they share one scope, like one file.
'use strict';

// ----- Performances: every NBA stat line from today, the last game day or this week so far, in one sortable table -----
// Today's games come from ESPN as they're played (live.js). Category leagues rank what the games added to winning a
// week's categories against not playing (catWins), so a week adds them up; points leagues use fantasy points.
const lineStat = (line, k) => (DERIVED[k] ? sum(Object.entries(DERIVED[k]).map(([b, c]) => (line[b] || 0) * c)) : line[k] || 0);
// (with any one-game bonuses its games carry: Sleeper's 40-point games and the like, gameBonus)
const lineFp = line => sum(Object.entries(leaguePoints() || {}).map(([k, v]) => lineStat(line, k) * v)) + (line.bonus || 0);
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
  const year = [...played].filter(x => x <= today).sort(); // every game day of the season so far
  return { today: games ? today : null, started: played.has(today) || live.games.some(g => g.d === today && g.state !== 'pre'), day, week: week.length > 1 ? week : null, year };
}

// Each player's lines over those days (the saved box scores, else ESPN's), added up, with what they added: fantasy
// points, or categories won (catWins), so every game counts. z: each category's share, which its column sorts by.
function perfRows(dates) {
  const byId = new Map();
  const add = (id, d, line) => { if (!byId.has(id)) byId.set(id, []); byId.get(id).push([d, line]); };
  const want = new Set(dates);
  for (const [id, byDay] of BOX.day) for (const [d, line] of byDay) if (want.has(d)) add(id, d, line);
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
      for (const [k, x] of Object.entries(catWins(line))) { z[k] = (z[k] || 0) + x; v += x; }
    }
    rows.push({ raw, g: lines.length, tot, z, v, on: lines.some(([d]) => liveOn(raw, d)) });
  }
  return rows;
}

// Per game: every NBA player's average game (the stats chosen under Stats used), valued as one game
function seasonRows() {
  return nbaPlayers().filter(p => (isFootball() ? p.gp : p.min)).map(p => ({ raw: nbaById.get(p.nbaId), g: p.gp || 0, tot: statLine(p), z: isPoints() ? {} : catWins(p), v: value(p), per: true }))
    .filter(r => r.raw);
}

let perfOrder = { sig: '', ids: [] }; // the rows last shown, in order
// every range, among everyone in it: 🚀 the best in each category and 🔥 the second best (as many as 3 tied),
// 🧊 the worst shooting and 🧈 the most turnovers. Shooting by what it added (makes over the league's average, so
// volume counts), everything else by the number. Per game only counts regulars (3+ games, 15+ minutes a game).
function perfBadges(rows, { range, day, avg, perWeek }) {
  const today = todayIso(), yesterday = addDays(today, -1), cats = scoreCats().filter(c => !c.fp);
  const badges = new Map();
  const night = range === 'avg' ? 'per game' : range === 'year' ? 'this season' : range === 'week' ? (perWeek ? 'per game this period' : 'this period')
    : day === today ? 'today' : day === yesterday ? 'last night' : `on ${fmtDay(day)}`;
  const pool = avg ? rows.filter(r => r.g >= 3 && r.tot.min >= 15) : rows;
  const tiers = (list, f) => { const m = new Map(); for (const r of list) { const v = +f(r).toFixed(6); m.set(v, [...(m.get(v) || []), r]); } return [...m].sort((a, b) => b[0] - a[0]).map(x => x[1]); };
  const give = (rs, c, e, tip) => { if (rs && rs.length <= 3) for (const r of rs) badges.set(`${r.raw.id}|${c.key}`, [e, `${tip} ${night}`]); };
  for (const c of cats) {
    if (c.pct) {
      const g = tiers(pool.filter(r => r.tot[c.att] && r.z[c.key] != null), r => r.z[c.key]);
      const low = g[g.length - 1];
      give(g[0], c, '🚀', `Best ${c.label} shooting`);
      if (g[0] && g[0].length === 1) give(g[1], c, '🔥', `2nd best ${c.label} shooting`);
      if (low && g.length > 1 && low[0].z[c.key] < 0) give(low, c, '🧊', `Worst ${c.label} shooting`);
      continue;
    }
    const g = tiers(pool.filter(r => lineStat(r.tot, c.key) > 0), r => lineStat(r.tot, c.key));
    if (c.neg) { give(g[0], c, '🧈', `Most ${c.label}`); continue; }
    give(g[0], c, '🚀', `Most ${c.label}`);
    if (g[0] && g[0].length === 1) give(g[1], c, '🔥', `2nd most ${c.label}`);
  }
  return badges;
}

// My team and Opponent show their row tint, so they double as the legend
function perfFilters(owner, opp, rows) {
  const pill = ([k, l, title]) => `<button type="button" class="pill${ui.perfShow[k] ? ' on' : ''}" data-action="perf-show" data-group="${k}" aria-pressed="${!!ui.perfShow[k]}"${title ? ` title="${esc(title)}"` : ''}>${k === 'me' || k === 'opp' ? `<span class="pf-swatch pf-${k}"></span>` : ''}${l}</button>`;
  const teams = [['me', 'My team'], ...(opp ? [['opp', 'Opponent', opp.name]] : []), ['other', 'Other teams']];
  const where = [['active', 'Active', 'In their team\'s starting lineup'], ['bench', 'Bench', 'On their team\'s bench or IR'], ['fa', 'Waivers', 'Not on a roster in your league']];
  // search, then pill buttons: position and NBA team (menus dressed as pills), only rookies, only injured; then
  // the fantasy teams and where players are
  const menu = (action, label, val, opts) => `<select class="pill pill-menu${val ? ' on' : ''}" data-change="${action}" aria-label="${label}"><option value="">${label === 'Position' ? 'All positions' : 'All teams'}</option>${opts.map(x => `<option ${val === x ? 'selected' : ''}>${x}</option>`).join('')}</select>`;
  const only = (k, l, title) => `<button type="button" class="pill${ui.perfOnly[k] ? ' on' : ''}" data-action="perf-only" data-key="${k}" aria-pressed="${!!ui.perfOnly[k]}" title="${title}">${l}</button>`;
  const find = `<input id="perfQ" class="perf-q" type="search" placeholder="Find a player" aria-label="Find a player" value="${esc(ui.perfQ)}" data-input="perf-q" autocomplete="off">
    <div class="perf-filters" role="group" aria-label="Narrow the list">${menu('perf-pos', 'Position', ui.perfPos, POSITIONS)}${menu('perf-team', `${SPORT.name} team`, ui.perfTeam, [...new Set(NBA.players.map(p => p.team).filter(Boolean))].sort())}${only('rookie', 'Rookies', 'Only first-year players')}${only('inj', 'Injured', 'Only players on the injury report')}</div>`;
  return find + (!owner.size || !rows.length ? '' : `<div class="perf-filters" role="group" aria-label="Show players">${teams.map(pill).join('')}<span class="pf-sep" aria-hidden="true"></span>${where.map(pill).join('')}</div>`);
}

function topPerformancesCard() {
  const today = todayIso(), yesterday = addDays(today, -1);
  const card = (head, body) => `<div class="card"><div class="card-head"><h2>Players ${infoBtn('perf')}</h2>${head}${LOCAL ? '<button class="btn sm" data-action="refresh-data">Refresh stats</button>' : ''}</div>${body}</div>`;
  if (!BOX) return card('', loadingLine('Loading the latest box scores…'));
  const P = perfDays();
  // When: a menu of Today, the last game day before it, This period (the matchup's days so far) and This season (football:
  // Projected first). Until one is picked: today once its games have started, else the last game day. A period or the
  // season adds the games up, or (Per game) shows each player's average game: the season's from the stats chosen under
  // Stats used (range 'avg', as projections use them), a period's from its games.
  const football = isFootball();
  const opts = [football && ['proj', 'Projected'], P.today && ['today', 'Today'], P.day && ['day', P.day === yesterday ? 'Yesterday' : fmtDay(P.day)], P.week && ['week', 'This period'], ['year', 'This season']].filter(Boolean);
  const want = ui.perfRange === 'avg' ? 'year' : ui.perfRange;
  const chosen = opts.some(([k]) => k === want) ? want : football && !P.started ? 'proj' : P.started || !P.day ? opts.find(([k]) => k !== 'proj')[0] : 'day';
  const many = chosen === 'week' || chosen === 'year';
  const per = many && (ui.perfRange === 'avg' || ui.perfPer || (chosen === 'year' && !P.year.length)); // (no games yet: averages)
  const range = chosen === 'year' && per ? 'avg' : chosen, perWeek = chosen === 'week' && per;
  const proj = range === 'proj', avg = range === 'avg' || proj, weekly = !perWeek && (range === 'week' || range === 'year'); // weekly: several days added up
  const dates = avg ? [] : range === 'year' ? P.year : range === 'week' ? P.week : [range === 'today' ? today : P.day];
  const day = dates[0];
  const updated = range === 'day' || avg ? '' : live.error ? ` · <span class="pos-bad">ESPN: ${esc(live.error)}</span>`
    : live.at ? ` · updated ${fmtTime(live.at)}` : '';
  const when = proj ? 'Sleeper\'s projections for this week, in your league\'s scoring' : football && avg ? 'This season' : avg ? `${BASIS_LABELS[state.basis]} stats ${infoBtn('projection')}` : (weekly || perWeek ? `${fmtDay(dates[0])} – ${fmtDay(dates[dates.length - 1])}${perWeek ? ' · per game' : ''}` : `${day === yesterday ? 'Last night' : day === today ? 'Today' : ''} ${fmtDay(day)}`.trim()) + updated;
  const toggle = `<div class="perf-when-pick"><select class="ctx-team perf-range" data-change="perf-range" aria-label="Show games from">${opts.map(([k, l]) => `<option value="${k}" ${k === chosen ? 'selected' : ''}>${l}</option>`).join('')}</select>${many
    ? `<div class="seg seg-sm" role="group" aria-label="Totals or per game">${[['0', 'Totals'], ['1', 'Per game']].map(([v, l]) => `<button type="button" class="${String(+per) === v ? 'on' : ''}" data-action="perf-per" data-per="${v}" aria-pressed="${String(+per) === v}">${l}</button>`).join('')}</div>` : ''}</div>`;

  // who rosters each player, and where in that team's lineup he is now (active or on the bench)
  const owner = new Map(), spot = new Map();
  const L = fxLeague();
  for (const [tid, r] of Object.entries((L && L.rosters) || {})) for (const x of r) if (x.nba) { owner.set(x.nba, tid); spot.set(x.nba, x); }
  const mine = ui.viewing ? ui.viewA : state.fxTeam;
  // this matchup's opponent (the Dashboard's), whatever days are shown: the rosters are today's
  const opp = owner.size && mine ? fxOpponentFor(weekStartAt(0), mine) : null;
  // where a player is: in a team's starting lineup (active), on its bench (IR included), or on no roster (waivers)
  const statusOf = id => (!spot.has(id) ? 'fa' : spot.get(id).st === 'ACTIVE' ? 'active' : 'bench');
  const lineupBadge = id => {
    const x = spot.get(id);
    if (x.st === 'ACTIVE') return `<span class="badge active" title="In the starting lineup${x.slot ? ` at ${esc(x.slot)}` : ''}">Active</span>`;
    return x.st === 'INJURED_RESERVE' ? '<span class="badge bad" title="On injured reserve">IR</span>' : '<span class="badge bench" title="On the bench">Bench</span>';
  };
  // your players and the opponent's are tinted rows instead (see the row classes), so they only need the lineup badge,
  // except on IR (out of the lineup, so whose he is helps)
  const who = id => {
    const tid = owner.get(id);
    if (tid && (tid === mine || (opp && tid === opp.id)) && spot.get(id).st !== 'INJURED_RESERVE') return lineupBadge(id);
    if (tid) return `<span class="perf-owner">${teamLink(tid)}</span> ${lineupBadge(id)}`;
    const raw = nbaById.get(id);
    return raw && raw.fx ? `<span class="badge good">${FX_STATUS[raw.fx.st] || 'Free agent'}</span>` : '';
  };

  const pts = leaguePoints();
  // an average starter's games over these days (the season: every day since opening night; Per game: one)
  const span = range === 'year' ? Math.round((Date.parse(today) - Date.parse(dates[0])) / 864e5) + 1 : dates.length;
  const expected = weekly ? (football ? 1 : WEEK_GAMES) * span / 7 : 1;
  const par = pts ? fpBase()[0] * expected : 0;
  const cats = scoreCats().filter(c => !c.fp);
  // a column sorts by what it adds: its category contribution, or its fantasy points, so best-first works for TO too
  const sortVal = (r, key) => (key === 'name' ? r.raw.name.toLowerCase() : key === 'v' ? r.v : pts ? lineStat(r.tot, key) * (pts[key] || 0) : r.z[key] || 0);
  const cell = (r, c) => {
    const b = badges.get(`${r.raw.id}|${c.key}`);
    const emo = b ? `<span class="pf-emo" aria-hidden="true">${b[0]}</span>` : '', tip = b ? ` · ${b[1]}` : '';
    if (c.pct) {
      const [m, a] = [r.tot[c.made] || 0, r.tot[c.att] || 0];
      if (r.per) return `<td class="sc" title="${c.label}: ${fmt(m, 1)}-${fmt(a, 1)} a game${tip}">${emo}${a ? fmtPct(m / a) : '—'}</td>`;
      return `<td class="sc" title="${c.label}: ${a ? `${fmt(m / a * 100, 1)}%` : 'no attempts'}${tip}">${emo}${m}-${a}</td>`;
    }
    return `<td class="sc"${b ? ` title="${b[1]}"` : ''}>${emo}${fmt(lineStat(r.tot, c.key), r.per ? 1 : 0)}</td>`;
  };
  // only Value is colored: greener up to a monster night (+0.7 a game, over an average starter's games on these days),
  // red below 0 (the team was better off without it: rare, so −0.25 is full red); points leagues around an average
  // starter's points
  const valShade = r => { const g = r.v / expected; return shade(pts ? (r.v - par) / (fpBase()[1] * Math.sqrt(expected)) : g / (g < 0 ? 0.1 : 0.28), 'var(--surface)'); };
  const e = +expected.toFixed(1);
  const over = weekly ? `${e} game${e === 1 ? '' : 's'} over these days` : 'a game';
  const valTip = esc(pts ? `Fantasy points in your league; an average starter scores ${fmt(par, 1)} in ${over}`
    : avg || perWeek ? "Categories won by his average game: what it adds to winning a week's categories, against not playing"
    : `Categories won: what ${weekly ? 'his games' : 'the game'} added to winning a week's categories, against not playing (an even matchup). Below 0: his team would have done better without ${weekly ? 'them' : 'it'}`);

  // everyone who played, ranked by value; the column sorted on picks which 50 show (Value ↑ for the worst)
  // a period per game: each player's games there, averaged (makes and attempts too, so his percentages stand)
  const perGame = r => { const g = r.g || 1, by = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v / g])); return { ...r, tot: by(r.tot), z: by(r.z), v: r.v / g, per: true }; };
  const rows = proj ? projRows() : avg ? seasonRows() : perWeek ? perfRows(dates).map(perGame) : perfRows(dates);
  const badges = perfBadges(rows, { range, day, avg, perWeek });
  const legend = badges.size ? '<p class="muted small pf-legend">🚀 best · 🔥 2nd best in a category · 🧊 worst shooting · 🧈 most turnovers</p>' : '';
  const rank = new Map([...rows].sort((a, b) => b.v - a.v).map((r, i) => [r, i + 1]));
  // filter by team (yours, this matchup's opponent's, the others') and by where players are: active, bench, or
  // waivers (no team, so the team filters don't hide them)
  const teamOf = r => { const tid = owner.get(r.raw.id); return !tid ? null : tid === mine ? 'me' : opp && tid === opp.id ? 'opp' : 'other'; };
  const filters = perfFilters(owner, opp, rows);
  const q = normName(ui.perfQ);
  const picked = rows.filter(r => {
    const t = teamOf(r);
    return (!owner.size || ((!t || ui.perfShow[t]) && ui.perfShow[statusOf(r.raw.id)])) && (!q || normName(r.raw.name).includes(q))
      && (!ui.perfPos || (r.raw.pos || []).includes(ui.perfPos)) && (!ui.perfTeam || r.raw.team === ui.perfTeam)
      && (!ui.perfOnly.rookie || !r.raw.exp) && (!ui.perfOnly.inj || !!r.raw.inj);
  });
  const so = ui.perfSort;
  const th = (key, label, cls) => sortTh('perf-sort', key, label, so, { cls, down: so.dir < 0 });
  const sorted = [...picked].sort((a, b) => { const x = sortVal(a, so.key), y = sortVal(b, so.key); return (x < y ? -1 : x > y ? 1 : 0) * so.dir; });
  // a live update keeps the rows where they were (numbers and ranks change in place; anyone new goes below) so the
  // table doesn't jump while it's read; anything you do sorts it again
  const sig = [range, perWeek, dates.join(), so.key, so.dir, JSON.stringify(ui.perfShow), mine, ui.perfQ, ui.perfPos, ui.perfTeam, JSON.stringify(ui.perfOnly)].join('|');
  const cap = avg || range === 'year' ? 300 : 100; // rows shown: the top 300 over the season, 100 for a day or week
  let shown = sorted.slice(0, cap);
  if (live.hold && perfOrder.sig === sig) {
    const byId = new Map(picked.map(r => [r.raw.id, r])), was = new Set(perfOrder.ids);
    shown = [...perfOrder.ids.map(id => byId.get(id)).filter(Boolean), ...sorted.filter(r => !was.has(r.raw.id))].slice(0, cap);
  }
  perfOrder = { sig, ids: shown.map(r => r.raw.id) };
  const count = `${picked.length > shown.length ? `${shown.length} of ` : ''}${picked.length} player${picked.length === 1 ? '' : 's'}`;
  // today before tip-off: when the first game starts
  const first = live.games.filter(g => g.d === day && g.state === 'pre').sort((a, b) => a.start - b.start)[0];
  const waiting = range === 'today' && !rows.length ? `<p class="muted small" style="margin:0">${live.at || live.error ? `No games have started yet.${first ? ` First tip-off ${fmtTime(first.start)}.` : ''}` : "Loading today's games…"}</p>` : '';
  const table = !rows.length ? waiting : !shown.length ? '<p class="muted small" style="margin:0">No players match these filters.</p>' : `<div class="perf-wrap${shown.length > 5 ? ' scroll' : ''}"><table class="perf-table">
      <thead><tr>${th('name', 'Player', 'pf-name')}${cats.map(c => th(c.key, c.label, 'sc')).join('')}${th('v', proj ? 'Proj' : pts ? 'FP' : 'Value', 'num pf-v')}</tr></thead>
      <tbody>${shown.map(r => `<tr class="${teamOf(r) === 'me' ? 'pf-me' : teamOf(r) === 'opp' ? 'pf-opp' : ''}">
        <td class="pf-name"${teamOf(r) === 'me' ? ' title="Your team"' : teamOf(r) === 'opp' ? ` title="Opponent: ${esc(opp.name)}"` : ''}><div class="bplayer"><span class="perf-rank">${rank.get(r)}</span>${headshot({ nbaId: r.raw.id, name: r.raw.name }, 28)}<div class="bmain">
          <div class="bname"><button class="link-btn pname" data-action="player-detail" data-nba="${r.raw.id}">${esc(r.raw.name)}</button>${injBadge(r.raw.inj, 'by-name')}</div>
          <div class="pmeta">${injBadge(r.raw.inj, 'in-meta')}${proj ? `${esc(r.game)} · ` : avg || perWeek ? `${r.g} GP · ` : weekly ? `${r.on ? '<span class="lv-dot" aria-hidden="true"></span>' : ''}${r.g} G · ` : day === today && liveStatus(r.raw, day) ? `${liveStatus(r.raw, day)} · ` : ''}${football ? '' : `${Math.round(r.tot.min || 0)} min${avg ? '/g' : ''} · `}${who(r.raw.id)}</div></div></div></td>
        ${cats.map(c => cell(r, c)).join('')}
        <td class="num pf-v" style="${valShade(r)}" data-tip="${valTip}">${pts ? fmt(r.v, 1) : signed(r.v, 2)}</td>
      </tr>`).join('')}</tbody>
    </table></div>${legend}`;
  return card(toggle, `<p class="muted small perf-when">${when}${rows.length ? ` · ${count}` : ''}</p>${filters}${table}`);
}

/* ---------- NBA players ---------- */
function viewPlayers() {
  if (!NBA) {
    return loadingCard('Loading player data…', "If this doesn't load, the data file is missing. Run <code>python scripts/update_data.py</code> and reload.");
  }
  // the latest games come from the box scores, loaded on first need; today's as they're played
  if (!BOX) loadBoxes().then(() => { if (ui.tab === 'players') render(); }).catch(() => {});
  startLive();
  if (!fxLeague()) { // browsing without a league
    return `<div class="sample-banner browse-note"><span>No league connected: values are for a standard 9-category league.</span><button type="button" class="btn sm" data-action="browse-exit">Connect a league</button></div>
  ${topPerformancesCard()}`;
  }
  return topPerformancesCard(); // (ideas for pickups: the Matchups tab's, made against this week's matchup)
}

// A country's flag (ISO code from the daily data job), named on hover
const flag = iso => {
  if (!iso) return '';
  let name = iso;
  try { name = new Intl.DisplayNames(['en'], { type: 'region' }).of(iso); } catch (e) { /* the code, then */ }
  const c = iso.toLowerCase();
  return ` · <img class="flag" src="https://flagcdn.com/w20/${c}.png" srcset="https://flagcdn.com/w40/${c}.png 2x" width="20" height="15" alt="${esc(name)}" title="${esc(name)}" loading="lazy">`;
};
// Whose he is in the league: the fantasy team and where in its lineup, else free agent or waivers
function cardOwner(raw) {
  const L = fxLeague();
  if (!L || !L.rosters) return '';
  for (const [tid, r] of Object.entries(L.rosters)) {
    const x = r.find(y => y.nba === raw.id);
    if (!x) continue;
    const how = cardHow(L, raw, tid, x.fid);
    return `<p class="pc-owner"><b>${teamLink(tid)}</b> <span class="badge ${x.st === 'ACTIVE' ? 'active' : x.st === 'INJURED_RESERVE' ? 'bad' : 'bench'}">${x.st === 'ACTIVE' ? 'Active' : x.st === 'INJURED_RESERVE' ? 'IR' : 'Bench'}</span>${how ? `<span class="pc-how muted">${esc(how)}</span>` : ''}</p>`;
  }
  return raw.fx ? `<p class="pc-owner"><span class="badge good">${FX_STATUS[raw.fx.st] || 'Free agent'}</span></p>` : '';
}

// How a rostered player came to his fantasy team: kept, drafted (round and pick), a waiver add or a trade, and when.
// Weekly rosters (Fantrax, Sleeper) follow him back to the week he joined; elsewhere the draft is all there is.
function cardHow(L, raw, tid, fid) {
  const d = L.draft;
  const pick = d && d.picks.find(p => p[3] === raw.id && p[2] === tid);
  const fromDraft = d && d.keepers && (d.keepers[tid] || []).includes(raw.id) ? 'Keeper' : pick ? `Drafted · round ${pick[0]}, pick ${pick[1]}` : null;
  if (!hasLineupHistory(L) || fid == null) return fromDraft || (d && d.picks.length ? 'Added after the draft' : '');
  const P = rosterWeeksLoad[L.id];
  if (!P) loadRosterWeeks(L).catch(() => null).then(() => { if ($('#detailDialog').open && cardOpen === raw.id) showPlayerDetail(raw.id); });
  const weeks = P && P.done;
  if (!weeks) return fromDraft || '';
  // a weekly lineup period's matchup week; a daily one's day
  const when = w => {
    const d = w.start.slice(0, 10), weekly = w.end && Date.parse(w.end.slice(0, 10)) - Date.parse(d) >= 4 * 864e5;
    const mid = addDays(d, 3); // a Fantrax week's lineups start the evening before its first matchup day
    const p = weekly && (L.periods || []).find(x => x.start <= mid && mid <= x.end);
    return p ? `week ${p.n}` : fmtDay(d);
  };
  const on = w => (w.owner.get(fid) || {}).tid === tid;
  const last = weeks[weeks.length - 1];
  if (!on(last)) { // joined since the latest rosters
    const was = last.owner.get(fid);
    return was ? `Traded from ${fxTeamName(was.tid)} · this week` : 'Waiver add · this week';
  }
  let j = weeks.length - 1;
  while (j > 0 && on(weeks[j - 1])) j--;
  if (!j) return fromDraft || `On the team since ${when(weeks[0])}`;
  const prev = weeks[j - 1].owner.get(fid);
  return prev ? `Traded from ${fxTeamName(prev.tid)} · ${when(weeks[j])}` : `Waiver add · ${when(weeks[j])}`;
}
// Every game he's played this season, newest first: the saved box scores (and today's, as they're played), else
// the few the daily file keeps (preseason ones too, before the season starts)
function cardGames(raw) {
  const box = BOX && BOX.byPlayer.get(raw.id);
  if (!box || !box.length) return (raw.log || []).map(g => { const o = {}; NBA.logKeys.forEach((k, i) => { o[k] = g[i]; }); return o; });
  const out = box.map(([d, st, margin, team]) => {
    const s = BOX.scores && BOX.scores.get(`${d} ${team}`);
    const matchup = s ? (s.home === team ? `vs ${s.away}` : `@ ${s.home}`) : '';
    return { ...st, date: d, matchup, wl: margin > 0 ? 'W' : margin < 0 ? 'L' : '' };
  });
  for (const [d, lines] of live.lines) if (lines.has(raw.id) && !box.some(g => g[0] === d)) out.push({ ...lines.get(raw.id), date: d, matchup: 'live', wl: '' });
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

// Where each player's season ranks among everyone's, by value per game and by this season's value added up. Per game
// counts regulars only: half the games of whoever has played the most. Kept until the stats or the scoring change.
let rankMemo = { key: null };
function valueRanks() {
  const key = `${NBA.updated}|${JSON.stringify(leaguePoints() || scoreCats().map(c => c.key))}`;
  if (rankMemo.key === key) return rankMemo;
  const rows = NBA.players.map(raw => ({ id: raw.id, s: statObj(raw.cur) })).filter(x => x.s && x.s.gp)
    .map(x => ({ id: x.id, gp: Math.round(x.s.gp), per: lineValue(statLine(x.s)) }));
  const minGp = Math.max(1, Math.floor(Math.max(0, ...rows.map(x => x.gp)) / 2));
  const order = (list, f) => new Map([...list].sort((a, b) => f(b) - f(a)).map((x, i) => [x.id, i + 1]));
  const regulars = rows.filter(x => x.gp >= minGp);
  rankMemo = { key, minGp, per: order(regulars, x => x.per), perN: regulars.length, tot: order(rows, x => x.per * x.gp), totN: rows.length };
  return rankMemo;
}

// The player card's columns: [label, a season's per-game average, a game's number, the games table's label if it's another]
function cardStats(raw) {
  if (isFootball()) return (SPORT.card[raw.pos[0]] || SPORT.card.other).map(([label, k]) => [label, s => fmt(s[k] || 0), o => o[k] || 0]);
  const n = k => [k.toUpperCase(), s => fmt(s[k]), o => o[k]];
  const two = (label, k) => [label, s => fmt(s[k], 2), o => o[k]];
  if (isGoalie(raw)) {
    return [['GS', s => fmt(s.gs, 2), o => o.gs], ['MIN', s => fmt(s.min, 1), o => Math.round(o.min)], two('W', 'w'), two('L', 'l'), two('OTL', 'otl'), two('SO', 'so'), ['GA', s => fmt(s.ga, 2), o => o.ga],
      ['SV%', s => fmtPct(s.sa ? s.sv / s.sa : 0), o => `${o.sv}-${o.sa}`, 'SV'], ['GAA', s => fmt(s.gt ? s.ga / s.gt : 0, 2), o => fmt(o.gt ? o.ga / o.gt : 0, 2)]];
  }
  if (isHockey()) {
    return [['MIN', s => fmt(s.min, 1), o => Math.round(o.min)], two('G', 'g'), two('A', 'a'), two('PTS', 'pts'), ['+/−', s => fmt(s.pm, 2), o => o.pm], two('SOG', 'sog'), two('HIT', 'hit'), two('BLK', 'blk'),
      two('PIM', 'pim'), ['PPP', s => fmt(s.ppg + s.ppa, 2), o => (o.ppg || 0) + (o.ppa || 0)]];
  }
  return [['MIN', s => fmt(s.min, 1), o => Math.round(o.min)], n('pts'), n('reb'), n('ast'), n('stl'), n('blk'), ['3PM', s => fmt(s.tpm), o => o.tpm], n('to'),
    ['FG%', s => fmtPct(s.fga ? s.fgm / s.fga : 0), o => `${o.fgm}-${o.fga}`, 'FG'], ['FT%', s => fmtPct(s.fta ? s.ftm / s.fta : 0), o => `${o.ftm}-${o.fta}`, 'FT']];
}
// A game's numbers as words: [the main ones, the ones in gray]
function gameStats(raw, o) {
  if (isFootball()) return [footballWords(o), []];
  if (isGoalie(raw)) return [[`${o.sv || 0} saves on ${o.sa || 0}`, `${o.ga || 0} GA`], [o.w ? 'Win' : o.l ? 'Loss' : o.otl ? 'OT loss' : o.sol ? 'Shootout loss' : o.so ? 'Shutout' : ''].filter(Boolean)];
  if (isHockey()) return [[`${o.g || 0} G`, `${o.a || 0} A`, `${o.sog || 0} SOG`, `${o.hit || 0} HIT`, `${o.blk || 0} BLK`], [`${(o.pm > 0 ? '+' : '') + (o.pm || 0)}`, `${o.pim || 0} PIM`]];
  return [[`${o.pts} PTS`, `${o.reb} REB`, `${o.ast} AST`, `${o.stl} STL`, `${o.blk} BLK`, `${o.tpm} 3PM`, `${o.to} TO`], [`${o.fgm}-${o.fga} FG`, `${o.ftm}-${o.fta} FT`]];
}

let cardOpen = null; // the player whose card is showing
function showPlayerDetail(nbaId) {
  // the season's box scores, the first time a card needs them
  if (!BOX && NBA) loadBoxes().then(() => { if ($('#detailDialog').open && cardOpen === nbaId) showPlayerDetail(nbaId); }).catch(() => {});
  const raw = nbaById.get(nbaId);
  if (!raw) return;
  const t = teamInfo(raw.team);
  const lines = [[NBA.season, String(NBA.season).slice(2), statObj(raw.cur)], ['Last 10', 'L10', statObj(raw.l10)], [NBA.prevSeason, String(NBA.prevSeason).slice(2), statObj(raw.prev)]]
    .filter(([, , s]) => s && s.gp);
  // value as Performances counts it (categories won against not playing, or fantasy points): per game, and this season's games added up
  const VAL = isPoints() ? 'FP' : 'Value';
  const valTip = esc(isPoints() ? 'Fantasy points in your league' : "Categories won: what a game adds to winning a week's categories, against not playing (an even matchup). Below 0: his team would have done better without it");
  const valCell = (v, d) => `<td class="num${v < 0 && !isPoints() ? ' pos-bad' : ''}" data-tip="${valTip}"><b>${fmtValue(v, d)}</b></td>`;
  const perGameVal = s => lineValue(statLine(s));
  const cur = statObj(raw.cur);
  const season = cur && cur.gp ? { per: perGameVal(cur), gp: Math.round(cur.gp) } : null;
  // phones: stats down the side, seasons across
  const CS = cardStats(raw), AVG = [['GP', s => Math.round(s.gp)], ...CS];
  const avgNarrow = lines.length ? `<table class="pc-avg show-sm"><thead><tr><th></th>${lines.map(([, short]) => `<th class="num">${esc(short)}</th>`).join('')}</tr></thead>
    <tbody>${AVG.map(([label, f]) => `<tr><td><b>${label}</b></td>${lines.map(([, , st]) => `<td class="num">${f(st)}</td>`).join('')}</tr>`).join('')}
    <tr><td><b>${VAL}</b></td>${lines.map(([, , st]) => valCell(perGameVal(st))).join('')}</tr></tbody></table>` : '';
  const rows = lines.map(([l, , s]) => [l, s])
    .map(([l, s]) => `<tr><td><b>${l}</b></td>${AVG.map(([, f]) => `<td class="num">${f(s)}</td>`).join('')}${valCell(perGameVal(s))}</tr>`).join('');
  const games = cardGames(raw);
  // phones: each game as a short block
  const gamesNarrow = games.length ? `<ul class="pc-games show-sm pc-games-wrap">${games.map(o => { const v = lineValue(o); return `<li>
      <div class="pc-g-top"><b>${esc(fmtDay(o.date))}</b>${o.type === 'PRE' ? ' <span class="badge">Pre</span>' : ''} <span class="muted">${esc(o.matchup)}</span>${o.wl ? ` <span class="badge ${o.wl === 'W' ? 'good' : 'bad'}">${o.wl}</span>` : ''}<span class="pc-g-min">${Math.round(o.min)} min · <span class="${v < 0 && !isPoints() ? 'pos-bad' : ''}" data-tip="${valTip}">${fmtValue(v)} ${isPoints() ? 'FP' : 'value'}</span></span></div>
      <div>${gameStats(raw, o)[0].map(x => `<span>${x}</span>`).join(' · ')}</div>
      <div class="muted">${gameStats(raw, o)[1].join(' · ')}</div></li>`; }).join('')}</ul>` : '';
  const logs = games.map(o => `<tr><td>${esc(fmtDay(o.date))}${o.type === 'PRE' ? ' <span class="badge">Pre</span>' : ''}</td><td>${esc(o.matchup)}</td><td>${o.wl ? `<span class="badge ${o.wl === 'W' ? 'good' : 'bad'}">${o.wl}</span>` : ''}</td>${CS.map(([, , g]) => `<td class="num">${g(o)}</td>`).join('')}${valCell(lineValue(o))}</tr>`).join('');
  $('#detailBody').innerHTML = `
    <div class="detail-head">
      <div class="detail-id">${headshot({ nbaId: raw.id, name: raw.name }, 64)}<div><h2>${esc(raw.name)}</h2><p class="muted" style="margin:2px 0 0">${esc(raw.team)}${raw.jersey ? ' · #' + esc(raw.jersey) : ''} · ${posTags(raw.pos)}${raw.born ? ` · age ${Math.floor((Date.now() - Date.parse(raw.born + 'T12:00:00')) / (365.25 * 864e5))}` : ''}${flag(raw.nat)}${raw.pos[0] === 'DEF' ? '' : ` · ${raw.exp ? raw.exp + ' yrs in league' : 'Rookie'}`}</p>${cardOwner(raw)}</div></div>
      <div>${raw.inj ? `<span class="badge ${raw.inj.status === 'Out' ? 'bad' : 'warn'}">${esc(raw.inj.label)}</span>` : '<span class="badge good">Healthy</span>'}</div>
    </div>
    ${raw.inj ? `<div class="alert ${raw.inj.status === 'Out' ? 'bad' : 'warn'}" style="margin-top:12px"><span class="dot"></span><span class="grow small">${esc(raw.inj.note)} <span class="muted">${raw.inj.date ? fmtDay(raw.inj.date) : ''} · ESPN</span></span></div>` : ''}
    <div class="proj-grid" style="margin-top:12px">
      <div class="proj"><div class="k">Next game</div><div class="v">${t && t.next ? nextGame(t.next) : '—'}</div>${isGoalie(raw) && t && t.next ? `<div class="pc-rank">${startWords(raw, t.next.date)}</div>` : ''}</div>
      ${isGoalie(raw) ? `<div class="proj" data-tip="${esc("From his share of his team's recent starts, and who played the night before")}"><div class="k">Starts left this week</div><div class="v">${t ? `about ${fmt(raw.inj && raw.inj.status === 'Out' ? 0 : expectedGames({ ...raw, nbaId: raw.id }, matchDates(weekStartAt(0)).filter(d => d >= todayIso() && !gameFinal(raw, d))), 1)}` : '—'}</div><div class="pc-rank">${t ? `of ${t.left} games` : ''}</div></div>`
    : isFootball() ? (() => { const week = matchDates(weekStartAt(0)), p = playerFromRaw(raw); return `<div class="proj"><div class="k">Projected this week</div><div class="v">${gamesIn(p, week) ? fmt(footballPts(p, week), 1) : 'Bye'}</div></div>`; })()
    : `<div class="proj"><div class="k">Games left this week</div><div class="v">${t ? t.left : '—'}</div></div>`}
      ${(() => {
        // his value, and under it his rank among every NBA player this season (per game: regulars only)
        const R = valueRanks(), per = R.per.get(raw.id), tot = R.tot.get(raw.id);
        const rank = (n, of, tip) => `<div class="pc-rank" data-tip="${esc(tip)}">${n ? `#${n} of ${of}` : season ? `ranked with ${R.minGp}+ G` : ''}</div>`;
        return `<div class="proj" data-tip="${valTip}"><div class="k">${VAL} per game</div><div class="v${season && season.per < 0 && !isPoints() ? ' pos-bad' : ''}">${season ? fmtValue(season.per) : '—'}</div>${rank(per, R.perN, `Among the ${R.perN} ${SPORT.name} players with ${R.minGp}+ games this season, keepers and free agents included (the Draft tab ranks only the league's draft picks)`)}</div>
      <div class="proj" data-tip="${valTip}"><div class="k">${VAL} this season</div><div class="v">${season ? `${fmtValue(season.per * season.gp, 1)} <span class="muted small">in ${season.gp} G</span>` : '—'}</div>${tot ? rank(tot, R.totN, `Among the ${R.totN} ${SPORT.name} players who've played this season, by ${VAL.toLowerCase()} added up`) : ''}</div>`;
      })()}
    </div>
    <h3 class="sub" style="margin-top:16px">Per-game averages</h3>
    ${avgNarrow}${rows ? `<div class="table-wrap hide-sm"><table><thead><tr><th></th>${AVG.map(([h]) => `<th class="num">${h}</th>`).join('')}<th class="num">${VAL}</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="muted small">No ${SPORT.name} regular-season stats yet.</p>`}
    <h3 class="sub" style="margin-top:16px">Games${games.length ? ` <span class="muted small">${games.length}</span>` : ''}</h3>
    ${gamesNarrow}${logs ? `<div class="table-wrap hide-sm pc-games-wrap"><table><thead><tr><th>Date</th><th>Matchup</th><th></th>${CS.map(([h, , , gh]) => `<th class="num">${gh || h}</th>`).join('')}<th class="num">${VAL}</th></tr></thead><tbody>${logs}</tbody></table></div>` : '<p class="muted small">No games played yet this season.</p>'}`;
  const d = $('#detailDialog');
  cardOpen = nbaId;
  $('#detailKind').textContent = 'Player card';
  if (!d.open) d.showModal();
}
