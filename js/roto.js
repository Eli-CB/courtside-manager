// League Layer: roto (rotisserie) leagues: the standings, where you stand, the projected finish, and a trade's change to it.
// The site loads js/*.js in order (see index.html); they share one scope, like one file.
'use strict';

// ----- Roto (a league ranked over the season in each category: espnRoto) -----
// A player's value here is the roto points his average game adds over the season (rotoWeights, nba.js), so the Players
// tab, Trends, the draft's grades and the lineups follow roto without anything of their own.
const fmtRotoPts = n => fmt(n, Number.isInteger(n) ? 0 : 1); // (a tie splits points: 5.5)
// A team's season total in a category ({ tot }: a standings row, or a projected one): a percentage from its makes and
// attempts (null before any), else the count
const rotoValue = (r, c) => (c.pct ? (r.tot[c.att] ? r.tot[c.made] / r.tot[c.att] : null) : lineStat(r.tot, c.key) || 0);
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
// played, against the league's limit. Now (ESPN's) or Projected (rotoOutlook: at the season's end, best projected first)
ui.rotoView = 'now';
function rotoStandingsCard(L) {
  const cats = scoreCats().filter(c => !c.fp), { gpMax, gpSpot } = L.roto;
  if (!(L.standings || []).length) return `<div class="card"><div class="empty"><strong>No standings yet</strong>${sourceName()} didn't return standings for this league.</div></div>`;
  const proj = ui.rotoView === 'proj', O = proj ? rotoOutlook() : null;
  // each team as the table shows it: { r (ESPN's row), rank, pts, cats (points by category), tot (season totals) }
  const rows = proj ? sortDesc(L.standings, r => O.get(r.id).total).map(r => { const o = O.get(r.id); return { r, rank: o.rank, pts: o.total, cats: o.pts, tot: o.fin }; })
    : L.standings.map(r => ({ r, rank: r.rank, pts: r.pts, cats: r.cats, tot: r.tot }));
  const shown = n => (proj ? fmt(n, 1) : fmtRotoPts(n));
  const gpTip = `Games ${proj ? 'its starters will have played by the season\'s end, as projected' : 'its starters have played'}${gpMax ? `, of the league's limit of ${gpMax}${gpSpot ? ` (${gpSpot} a lineup spot)` : ''}` : ''}`;
  const cell = (x, c) => {
    const v = fmtRotoValue(c, rotoValue(x, c));
    return `<td class="num rt-c" title="${c.label}: ${v}, ${shown(x.cats[c.key])} points${proj ? ' at the season\'s end, as projected' : ''}"><b>${shown(x.cats[c.key])}</b><span class="rt-tot">${v}</span></td>`;
  };
  const me = myTeamId();
  const row = x => `<tr${x.r.id === me ? ' class="me-row"' : ''}><td class="num">${x.rank}</td><td class="rt-team"><b>${teamLink(x.r.id, esc(x.r.name))}</b>${x.r.id === me ? ' <span class="muted small">(you)</span>' : ''}</td>
    <td class="num"><b>${shown(x.pts)}</b></td><td class="num">${fmt(x.tot.gp1 || 0, 0)}</td>${cats.map(c => cell(x, c)).join('')}</tr>`;
  return `<div class="card">
    <div class="card-head"><h2>Roto standings ${infoBtn('roto')}</h2>${segBtns('Standings', 'roto-view', 'v', [['now', 'Now'], ['proj', 'Projected', "At the season's end, as projected"]], proj ? 'proj' : 'now')}</div>
    ${proj ? `<p class="muted small" style="margin:0 0 10px">At the season's end, ${fmtMonthDay(L.roto.end)}: each team's totals so far plus its roster's games to come. Points are expected points, so they needn't be whole.</p>`
      : rotoUnplayed(L) ? '<p class="muted small" style="margin:0 0 10px">No games counted yet, so every team is tied.</p>' : ''}
    <div class="table-wrap"><table class="rt-table">
      <thead><tr><th class="num">#</th><th>Team</th><th class="num" title="Roto points: every category's added up">Pts</th><th class="num" title="${esc(gpTip)}">GP</th>${cats.map(c => `<th class="num">${c.label}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(row).join('')}</tbody>
    </table></div>${waiverLine()}
  </div>`;
}

// ----- A roto league's matchup: there's no opponent, so the head is where you stand in the league -----
// The share of the league's season played: its NBA games before today, of all of them from its first day to its last
function rotoSeasonShare(R) {
  if (!R.start || !R.end) return null;
  const today = todayIso();
  let all = 0, done = 0;
  for (const days of teamDates.values()) for (const d of days) if (d >= R.start && d <= R.end) { all++; if (d < today) done++; }
  return all ? done / all : null;
}
// Your points and the week's starter games (as the matchup's score), your standing, and your games against the league's limit
function rotoBoard(S, D) {
  const L = fxLeague(), R = L.roto, r = standingOf(S.tid);
  if (!r) return '';
  const share = rotoSeasonShare(R), gp = r.tot.gp1 || 0, o = rotoOutlook().get(S.tid);
  const games = R.gpMax ? `<b>${fmt(gp, 0)}</b> of ${R.gpMax} games` : `<b>${fmt(gp, 0)}</b> games`;
  const gamesTip = `Games your starters have played${R.gpMax ? `, of the league's limit of ${R.gpMax}${R.gpSpot ? ` (${R.gpSpot} a lineup spot)` : ''}` : ''}${share != null ? `. The league's season is ${Math.round(share * 100)}% played.` : ''}`;
  return `<div class="mu-board">
      <div class="mu-team"><div class="mu-name">${teamLink(S.tid, esc(S.name))}</div><div class="mu-line"><div class="mu-score" title="Roto points: every category's added up">${fmtRotoPts(r.pts)}</div>${dashPaceChips(S, D)}</div></div>
      <div class="mu-mid"></div>
      <div class="mu-team right"><div class="mu-name">${ordinal(r.rank)} <span class="muted">of ${fxPickable().length}</span></div>
        <div class="mu-rt-games small" title="${esc(gamesTip)}">${games}${share != null ? `<span class="muted"> · ${Math.round(share * 100)}% of the season</span>` : ''}</div>
        ${o ? `<div class="mu-rt-games small muted" title="Where you'd finish at the season's end, as projected: Standings, Projected">Projected ${ordinal(o.rank)} · ${fmt(o.total, 1)} pts</div>` : ''}</div>
    </div>`;
}
// Each category: your total, your points, and how far the nearest team above (to pass) and below (your lead) are
function rotoStandTable(tid) {
  const rows = rotoStanding(tid);
  if (!rows.length) return '';
  // (teams tied at that gap: the first named, the rest counted)
  const who = ids => `${teamLink(ids[0])}${ids.length > 1 ? `<span class="muted" title="${esc(ids.slice(1).map(fxTeamName).join(', '))}">+${ids.length - 1}</span>` : ''}`;
  const near = (x, c) => (x ? `<b>${c.pct ? fmtPct(x.gap) : fmt(x.gap, 0)}</b><span class="rt-who">${who(x.ids)}</span>` : '<span class="muted">—</span>');
  return `<div class="table-wrap mu-rt"><table class="rt-table rt-stand">
    <thead><tr><th>Cat</th><th class="num">You</th><th class="num">Pts</th><th class="num" title="How far behind the nearest team above you, and who">To pass</th><th class="num" title="How far ahead of the nearest team below you, and who">Lead</th></tr></thead>
    <tbody>${rows.map(({ c, v, pts, above, below }) => `<tr><td><b>${c.label}</b></td><td class="num">${fmtRotoValue(c, v)}</td><td class="num"><b>${fmtRotoPts(pts)}</b></td>
      <td class="num rt-near">${near(above, c)}</td><td class="num rt-near">${near(below, c)}</td></tr>`).join('')}</tbody>
  </table></div>${rotoUnplayed(fxLeague()) ? '<p class="muted small mu-when">No games counted yet, so every team is tied.</p>' : ''}`;
}

// ----- The projected finish -----
// Each team's season as it will end: ESPN's totals so far, plus its roster's games from tomorrow to the league's last day
// (rotoRest). Each day the best players with a game fill the lineup (fillSlots, by value); a player listed Out sits until
// ESPN's expected return, or two weeks without one. With a games limit, a team that would pass it keeps its best games:
// the weakest are the ones a manager near the limit stops starting. Each category's projected roto points are 1, plus the
// chance of finishing ahead of each other team, from how unsure each projection is (rotoSpread with ROTO_DRIFT: the rest
// of the season's game-to-game swings, and players' averages drifting and injuries coming, as half the spread between
// rostered players: a judgment, not yet checked against a real roto season). Once the season is over that's ESPN's points.
const ROTO_OUT_DAYS = 14, ROTO_DRIFT = 0.5;
const rotoMemo = new Map(); // "league|day" -> { rest: Map(team id -> its rest of the season), outlook }
keep('sport league players', () => rotoMemo.clear());
// the league's game days still to come: from tomorrow (today's games are in ESPN's totals once played) to its last day
const rotoDays = R => nbaGameDays().filter(d => d > todayIso() && (!R.start || d >= R.start) && (!R.end || d <= R.end));

// A roster's games from tomorrow on, with gpUsed of its games limit gone -> { tot (per stat), games (counted), wanted (its
// lineups would start, before the limit), room (games the limit leaves), full (the day the limit runs out at this pace) }
function rotoRest(players, gpUsed) {
  const R = fxLeague().roto, today = todayIso();
  const val = new Map(players.map(p => [p, value(p)])), ranked = sortDesc(players, p => val.get(p)), byId = new Map(players.map(p => [p.id, p]));
  const back = p => (p.status !== 'Out' ? '' : p.inj && p.inj.back > today ? p.inj.back : addDays(today, ROTO_OUT_DAYS));
  const from = new Map(players.map(p => [p, back(p)]));
  const starts = []; // [player, day], day by day
  for (const d of rotoDays(R)) {
    const avail = ranked.filter(p => from.get(p) <= d && playsOn(p, d));
    for (const id of fillSlots(avail, state.slots)) if (id) starts.push([byId.get(id), d]);
  }
  const room = R.gpMax ? Math.max(0, R.gpMax - gpUsed) : Infinity;
  const kept = starts.length > room ? sortDesc(starts, ([p]) => val.get(p)).slice(0, room) : starts;
  const tot = Object.fromEntries(COUNT_KEYS.map(k => [k, 0])), avg = new Map();
  for (const [p, d] of kept) {
    if (!avg.has(p)) avg.set(p, perGame(p).m);
    const m = avg.get(p), c = startChance(p, d);
    for (const k of COUNT_KEYS) tot[k] += c * (m[k] || 0);
  }
  return { tot, games: kept.length, wanted: starts.length, room, full: starts.length > room && room > 0 ? starts[room - 1][1] : null };
}

// Every team's projected finish (swap: { team id: players } in place of a roster, for a trade) -> Map(team id -> { fin (its
// season's totals), rest, pts (projected roto points by category), total, rank })
function rotoOutlook(swap = null) {
  // (the categories first: settling them for a new league resets every player cache, this one included, which mid-way
  // would leave the work done here in a cache no longer kept)
  const cats = scoreCats().filter(x => !x.fp);
  const L = fxLeague(), key = `${L.id}|${todayIso()}`;
  if (!rotoMemo.has(key)) rotoMemo.set(key, { rest: new Map(), outlook: null });
  const M = rotoMemo.get(key);
  if (!swap && M.outlook) return M.outlook;
  const teams = L.standings.map(r => {
    const gp = r.tot.gp1 || 0;
    let rest = swap && swap[r.id] ? rotoRest(swap[r.id], gp) : M.rest.get(r.id);
    if (!rest) M.rest.set(r.id, rest = rotoRest(fxTeamSide(r.id).players, gp));
    const fin = { ...r.tot };
    for (const [k, v] of Object.entries(rest.tot)) fin[k] = (fin[k] || 0) + v;
    fin.gp1 = gp + rest.games;
    return { id: r.id, fin, rest, pts: {}, total: 0 };
  });
  for (const c of cats) {
    const val = t => (c.pct ? (t.fin[c.att] ? t.fin[c.made] / t.fin[c.att] : 0) : lineStat(t.fin, c.key));
    const sd = t => { const s = rotoSpread(c, t.rest.games, ROTO_DRIFT); return c.pct ? (t.fin[c.att] ? s / t.fin[c.att] : 0) : s; };
    const at = teams.map(t => [val(t), sd(t)]);
    teams.forEach((t, i) => {
      let e = 1;
      teams.forEach((u, j) => {
        if (i === j) return;
        const d = (c.neg ? -1 : 1) * (at[i][0] - at[j][0]), s = Math.hypot(at[i][1], at[j][1]);
        e += s > 1e-12 ? phi(d / s) : d > 1e-12 ? 1 : d < -1e-12 ? 0 : 0.5;
      });
      t.pts[c.key] = e;
      t.total += e;
    });
  }
  for (const t of teams) t.rank = 1 + teams.filter(u => u.total > t.total + 1e-9).length;
  const out = new Map(teams.map(t => [t.id, t]));
  if (!swap) M.outlook = out;
  return out;
}

// A trade's change to your projected finish: your roster without give and with get, theirs the other way round (players
// matched by their data id) -> { before, after } (rotoOutlook's entries for your team)
function rotoTradeChange(give, get, partner) {
  const me = myTeamId(), ids = list => new Set(list.map(p => p.nbaId));
  const out = ids(give), inn = ids(get);
  const mine = [...fxTeamSide(me).players.filter(p => !out.has(p.nbaId)), ...get];
  const theirs = [...fxTeamSide(partner).players.filter(p => !inn.has(p.nbaId)), ...give];
  return { before: rotoOutlook().get(me), after: rotoOutlook({ [me]: mine, [partner]: theirs }).get(me) };
}

// The Trades table's For your team row (rotoTradeChange: T): each category's change to your projected roto points at the
// season's end (your projected total and points, before and after, on hover), and the change in all in the Value column.
// po: the playoff games' cell, when the table has one
function rotoTradeRow(T, cats, po) {
  const { before: b, after: a } = T, d = a.total - b.total;
  const cls = x => (Math.abs(x) < 0.05 ? 'muted' : x > 0 ? 'pos-good' : 'pos-bad');
  const finOf = (t, c) => (c.pct ? (t.fin[c.att] ? t.fin[c.made] / t.fin[c.att] : null) : lineStat(t.fin, c.key));
  const cell = c => {
    const x = a.pts[c.key] - b.pts[c.key];
    return `<td class="num ${cls(x)}" title="${c.label}: ${fmtRotoValue(c, finOf(b, c))} by the season's end, ${fmtRotoValue(c, finOf(a, c))} with the deal; ${fmt(b.pts[c.key], 1)} → ${fmt(a.pts[c.key], 1)} roto points">${signed(x, 1)}</td>`;
  };
  return `<tr class="tp-you"><td class="tp-pl"><b>For your team</b><div class="pmeta">projected roto points</div></td><td></td><td></td>${po}<td></td>
    ${cats.map(cell).join('')}<td class="num tp-v ${cls(d)}" title="${esc(`Your projected roto points at the season's end: ${fmt(b.total, 1)} now (${ordinal(b.rank)}), ${fmt(a.total, 1)} with the deal (${ordinal(a.rank)})`)}"><b>${signed(d, 1)}</b></td></tr>`;
}

// Your games against the league's limit, as the rest of the season's lineups would use them (Plan Ahead's outlook)
function rotoPace(R, used, rest) {
  const pace = used + rest.wanted;
  if (!R.gpMax) return `On pace for <b>${fmt(pace, 0)}</b> starter games by ${fmtMonthDay(R.end)}.`;
  if (rest.full) return `On pace for <b>${fmt(pace, 0)}</b> games, past the limit of ${R.gpMax}: it runs out around <b>${fmtMonthDay(rest.full)}</b>. The projection counts your best ${fmt(rest.room, 0)} games still to come.`;
  return `On pace for <b>${fmt(pace, 0)}</b> of ${R.gpMax} games by ${fmtMonthDay(R.end)}${R.gpMax - pace >= 1 ? `: <b>${fmt(R.gpMax - pace, 0)}</b> to spare, room for more starts` : ''}.`;
}

// Plan Ahead's card (no weekly opponent in roto): your projected finish, your games against the limit, and each category now
// and at the season's end
function rotoOutlookCard() {
  const L = fxLeague(), R = L.roto, me = myTeamId(), r = standingOf(me), o = r && rotoOutlook().get(me);
  if (!o) return '';
  const n = L.standings.length, cats = scoreCats().filter(c => !c.fp);
  const finOf = (t, c) => (c.pct ? (t[c.att] ? t[c.made] / t[c.att] : null) : lineStat(t, c.key));
  return `<div class="card rt-outlook">
    <div class="card-head"><h2>Season outlook ${infoBtn('roto')}</h2><span class="muted small">to ${fmtMonthDay(R.end)}</span></div>
    <p class="rt-finish">Projected <b>${ordinal(o.rank)}</b> of ${n} with <b>${fmt(o.total, 1)}</b> roto points <span class="muted">(now ${ordinal(r.rank)}, ${fmtRotoPts(r.pts)})</span></p>
    <p class="muted small rt-pace">${rotoPace(R, r.tot.gp1 || 0, o.rest)}</p>
    <div class="table-wrap"><table class="rt-table">
      <thead><tr><th>Cat</th><th class="num">Now</th><th class="num" title="Your total at the season's end, as projected">Projected</th><th class="num" title="ESPN's roto points now">Pts</th><th class="num" title="Projected roto points at the season's end">Proj. pts</th></tr></thead>
      <tbody>${cats.map(c => `<tr><td><b>${c.label}</b></td><td class="num">${fmtRotoValue(c, rotoValue(r, c))}</td><td class="num">${fmtRotoValue(c, finOf(o.fin, c))}</td>
        <td class="num">${fmtRotoPts(r.cats[c.key] || 0)}</td><td class="num"><b>${fmt(o.pts[c.key], 1)}</b></td></tr>`).join('')}</tbody>
    </table></div>
  </div>`;
}
