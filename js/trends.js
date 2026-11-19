// League Layer: the Trends tab: who's playing above or below his usual line, and each list's card.
// The site loads js/*.js in order (see index.html); they share one scope, like one file.
'use strict';

// ----- Trends: who's playing above or below his usual line -----
// On a tab of their own (viewTrends; under the Recap until Nov 2026, the owner's ask). Each player's last TREND_GAMES games
// through the latest day of saved box scores, against his median game before
// them (at least TREND_BEFORE of those). One list per counting category the league has (fantasy points in a points
// league), its shooting percentages with real volume, then minutes and shot attempts, the role changes that come first.
// A list ranks by the change per game, not the percentage (1 to 2.6 threes is +160% but a small change); the
// percentage is shown. Owners are today's rosters: who has him now. Football: a week is one game, too few to trend.
const TREND_GAMES = 5, TREND_BEFORE = 5, TREND_TOP = 5, TREND_WAIVERS = 5;
const TREND_NAMES = { pts: 'Points', reb: 'Rebounds', ast: 'Assists', stl: 'Steals', blk: 'Blocks', tpm: 'Threes', oreb: 'Offensive rebounds',
  dreb: 'Defensive rebounds', g: 'Goals', a: 'Assists', sog: 'Shots on goal', hit: 'Hits', pim: 'Penalty minutes', ppp: 'Power-play points',
  ppg: 'Power-play goals', ppa: 'Power-play assists', pm: 'Plus/minus', fow: 'Faceoffs won', shp: 'Short-handed points' };
const median = xs => { const s = [...xs].sort((a, b) => a - b), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
const mean = xs => (xs.length ? sum(xs) / xs.length : 0);
const trendMinutes = () => (isHockey() ? 10 : 15); // a regular's minutes (hockey: ice time) a game

// The lists: [{ key, label, get(line) }] (pct: a shooting category, with the attempts it needs a game; role: minutes, shots)
function trendStats() {
  const cols = new Set(BOX.cols || []), has = k => cols.has(k) || !!DERIVED[k];
  const out = [], shooting = [];
  if (isPoints()) out.push({ key: 'fp', label: 'Fantasy points', get: s => lineFp(s) });
  else for (const c of scoreCats()) {
    if (c.fp || c.neg || ['dd', 'td', 'gp1'].includes(c.key)) continue; // (turnovers: more isn't heating up; a double-double is yes or no)
    if (c.pct && !c.rate) { if (!isHockey() && has(c.made) && has(c.att)) shooting.push({ key: c.key, label: c.label, pct: c, minAtt: c.att === 'fta' ? 3 : 8 }); continue; }
    if (c.rate || !has(c.key)) continue;
    out.push({ key: c.key, label: TREND_NAMES[c.key] || c.label, get: s => lineStat(s, c.key) });
  }
  out.push(...shooting); // (minutes first, then the counting categories in the league's order, shooting, and shot attempts)
  if (has('min')) out.unshift({ key: 'min', label: isHockey() ? 'Ice time' : 'Minutes', get: s => s.min || 0, role: true });
  if (has('fga') && !isHockey()) out.push({ key: 'fga', label: 'Shot attempts', get: s => s.fga || 0, role: true });
  return out;
}

// Every player with enough games: his recent games and the ones before, each stat's now and before (and how far it moved)
function trendPlayers(end) {
  const stats = trendStats(), keys = BOX.cols || [], out = [];
  for (const [id, games] of BOX.byPlayer) {
    const raw = nbaById.get(id);
    if (!raw || isGoalie(raw)) continue;
    const played = games.filter(g => g[0] <= end && (g[1].min || 0) > 0).sort((a, b) => (a[0] < b[0] ? -1 : 1));
    if (played.length < TREND_GAMES + TREND_BEFORE) continue;
    const recent = played.slice(-TREND_GAMES), before = played.slice(0, -TREND_GAMES);
    if (Date.parse(end) - Date.parse(recent[recent.length - 1][0]) > 7 * 864e5) continue; // hasn't played lately: not a trend
    const R = recent.map(g => g[1]), B = before.map(g => g[1]);
    const row = { raw, id, recent, played, minNow: mean(R.map(s => s.min || 0)), minBefore: median(B.map(s => s.min || 0)), stats: {} };
    for (const st of stats) {
      if (st.pct) {
        const att = xs => sum(xs.map(s => lineStat(s, st.pct.att))), made = xs => sum(xs.map(s => lineStat(s, st.pct.made)));
        const aN = att(R), aB = att(B);
        if (aN / R.length < st.minAtt || aB / B.length < st.minAtt / 2) continue;
        const now = made(R) / aN, was = made(B) / aB;
        // the makes a game above (or below) his usual rate; his attempts a game now and before (the card's)
        row.stats[st.key] = { now, was, move: (now - was) * aN / R.length, attNow: aN / R.length, attWas: median(B.map(s => lineStat(s, st.pct.att))) };
      } else {
        const now = mean(R.map(st.get)), was = median(B.map(st.get));
        row.stats[st.key] = { now, was, move: now - was };
      }
    }
    // his whole line now and before, for what it's worth (the waiver list)
    const line = xs => Object.fromEntries(keys.map(k => [k, mean(xs.map(s => s[k] || 0))]));
    row.valueNow = lineValue(line(R));
    row.valueWas = lineValue(Object.fromEntries(keys.map(k => [k, median(B.map(s => s[k] || 0))])));
    row.gain = row.valueNow - row.valueWas;
    out.push(row);
  }
  return { stats, players: out };
}

// A regular teammate (24+ minutes a game) who missed most of these games: "with Edwards out"
function teammateOut(row, regulars) {
  const team = row.recent[row.recent.length - 1][3], dates = row.recent.filter(g => g[3] === team).map(g => g[0]);
  if (dates.length < 3) return '';
  const gone = (regulars.get(team) || []).filter(m => m.id !== row.id && dates.filter(d => !m.days.has(d)).length >= Math.ceil(dates.length * 0.6));
  if (!gone.length) return '';
  const m = gone.sort((a, b) => b.min - a.min)[0];
  return `with ${esc(lastName(m.name, true))} out`;
}
function teamRegulars(end) {
  const out = new Map();
  for (const [id, games] of BOX.byPlayer) {
    const g = games.filter(x => x[0] <= end && (x[1].min || 0) > 0);
    if (g.length < TREND_BEFORE) continue;
    const min = median(g.map(x => x[1].min || 0));
    if (min < (isHockey() ? 18 : 24)) continue;
    const team = g.reduce((a, b) => (a[0] > b[0] ? a : b))[3], raw = nbaById.get(id);
    if (!raw) continue;
    if (!out.has(team)) out.set(team, []);
    out.get(team).push({ id, name: raw.name, min, days: new Set(games.map(x => x[0])) }); // (a game anywhere: traded isn't "out")
  }
  return out;
}

// What the tab and a list's card share, through a day (end): every player's trend, who has him (a league's teams today,
// or the sandbox's My team: L null), which players a list takes, and why they moved
function trendKit(L, end) {
  const up = ui.trendDir !== 'down';
  const { stats, players } = trendPlayers(end);
  const { owner } = rosterOwners(L), regulars = up ? teamRegulars(end) : null;
  const whose = raw => ownerTag(owner, raw.id);
  const regular = row => (up ? row.minNow >= trendMinutes() : row.minBefore >= trendMinutes()); // a regular, now (or before a drop)
  // a category's list: moved this way, and by enough (a small wobble isn't a trend); the value lists: moved this way
  const takes = (st, row) => {
    if (st.value) return (up ? row.gain > 0 : row.gain < 0) && regular(row);
    const x = row.stats[st.key];
    if (!x || !(up ? x.move > 0 : x.move < 0) || !regular(row)) return false;
    return st.pct || x.was <= 0 || Math.abs(x.move) / x.was >= 0.15;
  };
  // why, where the box scores can say: a regular teammate out (heating up), then his minutes moving (a category's
  // list), or the n stats that moved most his way (by value)
  const minutesNote = row => (Math.abs(row.minNow - row.minBefore) >= 4 ? `minutes ${Math.round(row.minBefore)} → ${Math.round(row.minNow)}` : '');
  const moved = (row, n) => stats.filter(st => !st.pct && !st.role && row.stats[st.key] && (up ? row.stats[st.key].move > 0 : row.stats[st.key].move < 0) && row.stats[st.key].was > 0)
    .sort((a, b) => Math.abs(row.stats[b.key].move / row.stats[b.key].was) - Math.abs(row.stats[a.key].move / row.stats[a.key].was)).slice(0, n)
    .map(st => `${esc(STAT_LABEL[st.key] || st.label)} ${fmt(row.stats[st.key].now, 1)} vs ${fmt(row.stats[st.key].was, 1)}`);
  const why = (row, st, n = 2) => [up ? teammateOut(row, regulars) : '', ...(st.value ? moved(row, n) : [st.role ? '' : minutesNote(row)])].filter(Boolean).join(' · ');
  // whose players: a league's teams (Rostered) or the ones it can still have (Waivers); the sandbox's My team or everyone else
  const groups = {
    all: () => true, rostered: row => owner.has(row.id), mine: row => owner.has(row.id), others: row => !owner.has(row.id),
    waivers: row => !owner.has(row.id) && !!row.raw.fx && row.raw.fx.st !== 'T',
  };
  return { up, stats, players, owner, whose, takes, why, groups };
}
// The value lists' stat: what a game of his is worth (categories won, or fantasy points)
const trendValueStat = () => ({ key: 'value', label: isPoints() ? 'Fantasy points' : 'Value', value: true });
// A list's heading: the button that opens its card (trend-cat; a value list also says whose players it's of)
const trendOpen = (key, label, whose = '') => `<button type="button" class="tr-open" data-action="trend-cat" data-key="${key}"${whose ? ` data-whose="${whose}"` : ''} title="Every player in this list, game by game">${esc(label)}<span class="tr-chev" aria-hidden="true">›</span></button>`;

// Through a day (end), for a league's teams, or everyone in the sandbox (L null: My team, then everyone else)
function trendsCard(L, end) {
  if (!BOX || isFootball()) return '';
  const K = trendKit(L, end), { up, stats, players } = K;
  const fmtOf = st => (st.pct ? v => fmtPct(v) : v => fmt(v, 1));
  const change = (st, x) => (st.pct ? `${x.move > 0 ? '+' : '−'}${fmt(Math.abs(x.move), 1)} makes`
    : x.was > 0 ? `${x.move > 0 ? '+' : '−'}${Math.round(Math.abs(x.move) / x.was * 100)}%` : `${x.move > 0 ? '+' : '−'}${fmt(Math.abs(x.move), 1)}`);
  const rowHtml = (row, i, num, note) => `<li class="tr-row"><span class="tr-rank">${i + 1}</span>${headshot({ nbaId: row.id, name: row.raw.name }, 28)}
      <div class="tr-main"><div class="tr-name">${playerBtn(row.id, row.raw.name)} <span class="muted small">${teamBtn(row.raw.team)}</span></div>
      <div class="tr-meta">${[K.whose(row.raw), note].filter(Boolean).join(' · ')}</div></div>${num}</li>`;

  const lists = stats.map(st => {
    const fm = fmtOf(st);
    const top = players.filter(row => K.takes(st, row)).sort((a, b) => (up ? b.stats[st.key].move - a.stats[st.key].move : a.stats[st.key].move - b.stats[st.key].move)).slice(0, TREND_TOP);
    if (!top.length) return '';
    const rows = top.map((row, i) => {
      const x = row.stats[st.key];
      const num = `<div class="tr-num"><b>${fm(x.now)}</b> <span class="muted">vs ${fm(x.was)}</span><div class="small ${up ? 'pos-good' : 'pos-bad'}">${change(st, x)}</div></div>`;
      return rowHtml(row, i, num, K.why(row, st));
    }).join('');
    return `<section class="tr-cat"><h3 class="sub">${trendOpen(st.key, st.label)}</h3><ol class="tr-list">${rows}</ol></section>`;
  }).filter(Boolean);

  // By what a player's games are worth (categories won, or fantasy points, a game): the rostered players who moved most
  // either way, and the same for the ones a league can still have (no fantasy team). Value is the column's label, said once.
  const VAL = isPoints() ? 'FP' : 'Value', VS = trendValueStat(), G = K.groups;
  const byValue = (list, n) => list.filter(row => K.takes(VS, row)).sort((a, b) => (up ? b.gain - a.gain : a.gain - b.gain)).slice(0, n);
  const rostered = L ? byValue(players.filter(G.rostered), TREND_TOP) : [];
  const waivers = L ? byValue(players.filter(G.waivers), TREND_WAIVERS) : [];
  // (the sandbox: My team's, then everyone else's; one list while My team is empty)
  const mineList = L ? [] : byValue(players.filter(G.mine), TREND_TOP);
  const everyone = L ? [] : byValue(players.filter(G.others), TREND_TOP);
  const valueRows = list => list.map((row, i) => {
    // his value a game now, and the change under it (from his usual game: the (i) and the hover say so)
    const num = `<div class="tr-num" title="${esc(`${VAL} a game: ${fmtValue(row.valueNow)} in his last ${TREND_GAMES}, ${fmtValue(row.valueWas)} usually`)}"><b>${fmtValue(row.valueNow)}</b><div class="small ${up ? 'pos-good' : 'pos-bad'}">${fmtValue(row.gain)}</div></div>`;
    return rowHtml(row, i, num, K.why(row, VS));
  }).join('');
  const valueList = (title, whose, list) => (list.length ? `<section class="tr-cat"><h3 class="sub tr-head">${trendOpen('value', title, whose)}<span class="tr-col">${VAL}</span></h3><ol class="tr-list">${valueRows(list)}</ol></section>` : '');
  const valueLists = [valueList('Rostered', 'rostered', rostered), valueList('Waivers', 'waivers', waivers), valueList('My team', 'mine', mineList),
    K.owner.size ? valueList('Everyone else', 'others', everyone) : valueList('All players', 'all', everyone)].filter(Boolean);

  const seg = segBtns('Trending', 'trend-dir', 'dir', [['up', 'Heating up'], ['down', 'Cooling off']], up ? 'up' : 'down');
  const body = lists.length || valueLists.length
    ? `${valueLists.length ? `<div class="tr-grid tr-value">${valueLists.join('')}</div>` : ''}
       <div class="tr-grid">${lists.join('')}</div>`
    : `<p class="muted small" style="margin:0">Not enough games yet: a trend compares a player's last ${TREND_GAMES} games with at least ${TREND_BEFORE} before them.</p>`;
  return `<div class="card trends">
    <div class="card-head"><h2>Trends ${infoBtn('trends')}</h2>${seg}</div>
    ${body}
  </div>`;
}

// ----- A list's card: everyone trending that way, game by game -----
// A list's heading on the Trends tab opens it ('trend-cat'), in the player card's popup: every player the list takes,
// not just its top 5, TREND_CARD at a time. Each one's last TREND_GAMES games one by one (above his usual game green,
// below red), their average, his usual (the median game before them), his season, his minutes, and the change, by which
// they're ranked; a column's heading sorts by it instead (ui.trendSort). The direction and whose players (All, a
// league's Rostered or Waivers, the sandbox's My team or Everyone else) are picked in the card (ui.trendCard).
const TREND_CARD = 25;
const trendEnd = () => (BOX ? [...BOX.finals].map(k => k.slice(0, 10)).sort().pop() || null : null);
const trendSortStart = () => ({ key: 'move', dir: ui.trendDir === 'down' ? 1 : -1 }); // (the way it's going first)

function trendCardHtml() {
  const C = ui.trendCard, end = trendEnd();
  if (!C || !end || isFootball()) return null;
  const L = fxLeague(), K = trendKit(L, end), { up } = K;
  const st = C.key === 'value' ? trendValueStat() : K.stats.find(s => s.key === C.key);
  if (!st) return null;
  const choices = L ? [['all', 'All'], ['rostered', 'Rostered'], ['waivers', 'Waivers']]
    : K.owner.size ? [['all', 'All'], ['mine', 'My team'], ['others', 'Everyone else']] : [['all', 'All']];
  const whose = choices.some(c => c[0] === C.whose) ? C.whose : 'all';
  // a game's number for this list (a shooting percentage: its makes and attempts), and his season's
  const get = st.value ? s => lineValue(s) : st.get;
  const seasonOf = row => {
    const G = row.played.map(g => g[1]);
    if (st.value) return lineValue(Object.fromEntries((BOX.cols || []).map(k => [k, mean(G.map(s => s[k] || 0))])));
    if (st.pct) { const a = sum(G.map(s => lineStat(s, st.pct.att))); return a ? sum(G.map(s => lineStat(s, st.pct.made))) / a : 0; }
    return mean(G.map(get));
  };
  const list = K.players.filter(row => K.groups[whose](row) && K.takes(st, row))
    .map(row => ({ row, x: st.value ? { now: row.valueNow, was: row.valueWas, move: row.gain } : row.stats[st.key], season: seasonOf(row) }));
  // ranked by the change, the way it's going (the tab's order: the number by each name), then by the column picked
  const ranked = list.sort((a, b) => (up ? b.x.move - a.x.move : a.x.move - b.x.move));
  const rank = new Map(ranked.map((r, i) => [r, i + 1]));
  const so = ui.trendSort;
  const sortVal = r => (so.key === 'season' ? r.season : so.key === 'min' ? r.row.minNow : so.key === 'pct' ? (r.x.was > 0 ? r.x.move / r.x.was : null) : r.x[so.key] ?? null);
  const rows = sortRows(ranked, sortVal, so.dir); // (ties in rank order)

  const fm = st.value ? v => fmtValue(v) : st.pct ? v => fmtPct(v) : v => fmt(v, 1);
  const one = v => (st.value ? fmtValue(v) : st.key === 'min' ? String(Math.round(v)) : Number.isInteger(v) ? String(v) : fmt(v, 1));
  // one of his last games: its number, green above his usual game and red below; its date, opponent and minutes on hover
  const gameCell = (x, g) => {
    const s = g[1], sc = BOX.scores && BOX.scores.get(`${g[0]} ${g[3]}`);
    let txt, v;
    if (st.pct) { const m = lineStat(s, st.pct.made), a = lineStat(s, st.pct.att); txt = `${m}/${a}`; v = a ? m / a : null; } else { v = get(s); txt = one(v); }
    const cls = v == null || Math.abs(v - x.was) < 1e-9 ? '' : v > x.was ? ' hi' : ' lo';
    const tip = [fmtDay(g[0]), sc ? (sc.home === g[3] ? `vs ${sc.away}` : `@ ${sc.home}`) : '', `${Math.round(s.min || 0)} ${isHockey() ? 'min of ice time' : 'min'}`].filter(Boolean).join(' · ');
    return `<td class="sc tr-g" title="${esc(tip)}"><span class="tr-gv${cls}">${txt}</span></td>`;
  };
  const MIN = isHockey() ? 'TOI' : 'MIN', ATT = st.pct ? STAT_LABEL[st.pct.att] || 'Att' : '';
  const arrow = (a, b, d) => `${fmt(a, d)}<span class="muted">→</span>${fmt(b, d)}`;
  const tr = r => {
    const { row, x } = r, raw = row.raw, notes = K.why(row, st, 3);
    const move = st.value && !isPoints() ? signed(x.move, 2) : signed(x.move, 1);
    const sub = st.pct ? 'makes' : !st.value && x.was > 0 ? `${x.move > 0 ? '+' : '−'}${Math.round(Math.abs(x.move) / x.was * 100)}%` : '';
    return `<tr><td class="pf-name"><div class="bplayer"><span class="perf-rank">${rank.get(r)}</span>${headshot({ nbaId: row.id, name: raw.name }, 34)}<div class="bmain">
        <div class="bname">${playerBtn(row.id, raw.name)}</div>
        <div class="pmeta">${[raw.team && teamBtn(raw.team), (raw.pos || []).length && posTags(raw.pos), K.whose(raw)].filter(Boolean).join(' · ')}</div>
        ${notes ? `<div class="pmeta tr-why">${notes}</div>` : ''}</div></div></td>
      ${row.recent.map(g => gameCell(x, g)).join('')}
      <td class="sc"><b>${fm(x.now)}</b></td><td class="sc">${fm(x.was)}</td><td class="sc">${fm(r.season)}</td>
      ${st.pct ? `<td class="sc">${arrow(x.attWas, x.attNow, 1)}</td>` : ''}${st.key === 'min' ? '' : `<td class="sc">${arrow(row.minBefore, row.minNow, 0)}</td>`}
      <td class="num pf-v"><span class="${x.move > 0 ? 'pos-good' : x.move < 0 ? 'pos-bad' : ''}">${move}</span>${sub ? `<div class="tr-sub">${sub}</div>` : ''}</td></tr>`;
  };
  const th = (key, label, tip, cls = 'sc') => sortTh('trend-sort', key, label, so, { cls, tip, down: so.dir < 0 });
  const head = `<tr><th class="pf-name">Player</th><th class="sc" colspan="${TREND_GAMES}" title="His last ${TREND_GAMES} games, oldest first: green above his usual game, red below">Last ${TREND_GAMES} games</th>
    ${th('now', 'Avg', `Those ${TREND_GAMES} games' average`)}${th('was', 'Usual', 'His median game before those')}${th('season', 'Season', 'Every game he has played this season')}
    ${st.pct ? th('attNow', ATT, `${ATT} a game: usual → last ${TREND_GAMES}`) : ''}${st.key === 'min' ? '' : th('min', MIN, `Minutes a game: usual → last ${TREND_GAMES}`)}${th('move', 'Change', st.pct ? 'Makes a game above (or below) his usual rate' : 'The average less his usual game', 'num pf-v')}</tr>`;

  const bar = `<div class="tr-card-bar">${segBtns('Trending', 'trend-dir', 'dir', [['up', 'Heating up'], ['down', 'Cooling off']], up ? 'up' : 'down', ' data-card="1"')}
    ${choices.length > 1 ? segBtns('Whose players', 'trend-whose', 'whose', choices, whose) : ''}</div>`;
  const shown = rows.slice(0, C.n);
  const html = `${bar}${shown.length ? `<div class="perf-wrap"><table class="perf-table tr-table"><thead>${head}</thead><tbody>${shown.map(tr).join('')}</tbody></table>
    ${rows.length > shown.length ? `<div class="pf-more"><button type="button" class="btn sm" data-action="trend-more">Show ${Math.min(TREND_CARD, rows.length - shown.length)} more</button></div>` : ''}</div>`
    : `<p class="muted small">No one ${up ? 'heating up' : 'cooling off'} here${whose === 'all' ? '' : ` (${choices.find(c => c[0] === whose)[1]})`}.</p>`}`;
  const title = `<span class="dt-name">${esc(st.label)} ${infoBtn('trendCard')}</span><span class="dt-bio">${list.length} ${list.length === 1 ? 'player' : 'players'} · through ${fmtMonthDay(end)}</span>`;
  return { title, html };
}
// Draws the card (keep: where it was scrolled, as a sort or Show more leaves it)
function showTrendCard(keep) {
  const C = trendCardHtml();
  if (!C) return;
  const body = $('#detailBody'), wrap = () => (body.querySelector ? body.querySelector('.perf-wrap') : null);
  const top = body.scrollTop, left = (wrap() || {}).scrollLeft || 0;
  body.innerHTML = C.html;
  $('#detailTitle').innerHTML = C.title;
  cardOpen = null;
  sportCardOpen = null;
  const d = $('#detailDialog');
  if (!d.open) d.showModal();
  if (!keep) { body.scrollTop = 0; return; }
  body.scrollTop = top;
  const w = wrap();
  if (w) w.scrollLeft = left;
}

// The Trends tab: every player's last games through the latest day the saved box scores have. In a league, its teams and
// scoring; in the sandbox (state.browse), a standard 9-category league, My team's list by value and everyone else's
function viewTrends() {
  if (!NBA) return '';
  const L = fxLeague(), note = ''; // (the sandbox's sport and scoring are menus in the head: sbMenus)
  if (!BOX) return `${note}${boxWait('trends', 'Trends', "Loading the season's box scores…")}`;
  const end = trendEnd();
  return `${note}${end ? trendsCard(L, end) : `<div class="card"><div class="empty"><strong>No trends yet</strong>They start once the season's first games are in.</div></div>`}`;
}
