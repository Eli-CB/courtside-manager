// League Layer: the Matchup tab: the matchup and the folds under it.
// The site loads js/*.js in order (see index.html); they share one scope, like one file.
'use strict';

/* ---------- Dashboard ---------- */
function viewDashboard() {
  // the latest games come from the box scores, loaded on first need
  if (!BOX && NBA) loadBoxes().then(() => { if (ui.tab === 'dashboard') render(); }).catch(() => {});
  if (NBA) startLive(); // today's games, as they're played (when the matchup shows them)
  return `
  <div class="dash-grid">
    ${NBA ? dashMatchupCard() : ''}
    <div class="dash-folds">${recapFold()}${NBA ? movesCard() : ''}</div>
  </div>`;
}

// Under the matchup, one line each (the recap, the waiver wire): the line says what's inside, a tap opens
// the rest. Open ones stay open when the page is drawn again (live updates) and on coming back to the tab, this visit.
// dot: 'bad' / 'warn' / 'good' for a colored dot before the title
function dashFold(key, title, sub, body, dot = '') {
  const open = ui.dashFolds && ui.dashFolds.has(key);
  return `<details class="card dash-fold" data-fold="${key}"${open ? ' open' : ''}><summary>${dot ? `<span class="df-dot ${dot}" aria-hidden="true"></span>` : ''}<span class="df-title">${title}</span><span class="df-sub">${sub}</span></summary><div class="df-body">${body}</div></details>`;
}

// A week that just ended: its recap, for three days
function recapFold() {
  const fresh = freshRecap();
  return fresh ? dashFold('recap', `Week ${fresh.n} recap`, 'is in, ready to share',
    `<p class="muted small">${isOneGame() ? 'Player of the week' : 'Player and game of the week'}, bench regret${isPoints() ? '' : ', the best all-play week'} and every final, ready to share with the league.</p><button type="button" class="btn sm primary" data-action="go-recap">See the recap</button>`, 'good') : '';
}

// ----- The Dashboard's matchup: both lineups slot by slot, for today, the last game day or the week so far -----
// Each side's lineup is the league's as it is now (weekly lineups hold all week; daily ones are today's). Every
// starter shows his game (tip-off, score and clock, or final) and line, and the scoreboard the categories each side
// leads over those days, counted from the starters' lines.
const lineOn = (p, d) => actualLine(p, d) || (p.nbaId && liveLines(d).get(p.nbaId)) || null;
const addLine = (tot, line) => { for (const [k, x] of Object.entries(line)) if (k !== 'margin') tot[k] = (tot[k] || 0) + x; return tot; };

// This matchup's days: today (when there are games), its last earlier day with games, and its days up to today
function dashDays() {
  const today = todayIso(), P = perfDays(), all = matchDates(weekStartAt(0));
  const day = all.filter(d => d < today && [...teamDates.values()].some(ds => ds.has(d))).pop() || null;
  return { today: all.includes(today) && P.today ? today : null, started: P.started, day, week: all.filter(d => d <= today), all };
}

// A player's game that day: tip-off, the score and clock while it's on, the final score (just the opponent with
// Hide game scores on)
function dashGame(p, d) {
  if (!playsOn(p, d)) return '<span class="muted">No game</span>';
  const g = liveGame(p, d), s = g || (BOX.scores && BOX.scores.get(`${d} ${p.team}`));
  const vs = x => (x.home === p.team ? `vs ${x.away}` : `@${x.home}`);
  const inGoal = isGoalie(p) && !lineOn(p, d) ? ` · ${startWords(p, d)}` : '';
  if (g && g.state === 'pre') return `${vs(g)} ${fmtTime(g.start)}${inGoal}`;
  const score = !s ? '' : ui.hideScores ? vs(s) : `${s.away} ${s.as} @ ${s.home} ${s.hs}`;
  if (g && g.state === 'in') return `${liveStatus(p, d)} · ${score}`;
  const dnp = gameFinal(p, d) || (g && g.state === 'post') ? (lineOn(p, d) ? '' : ' · <b>DNP</b>') : '';
  if (s) return `${score}${ui.hideScores ? ' · Final' : ' F'}${dnp}`;
  const nx = NBA.teams && NBA.teams[p.team] && NBA.teams[p.team].next;
  return nx && nx.date === d ? `${nx.home ? `vs ${nx.opp}` : `@${nx.opp}`}${inGoal}` : `Final${dnp}`;
}

// A line in the league's own categories: makes-attempts for the percentages, fantasy points first in points leagues;
// nothing for a stat he didn't put up (no attempts, 0 blocks)
// flash(key, value, makes): a class for a bubble whose number just changed (a live update)
function lineChips(line, flash = () => '') {
  const out = isPoints() ? [`<span class="mu-chip fp${flash('fp', lineFp(line))}"><b>${fmtFp(lineFp(line))}</b> FP</span>`] : [];
  for (const c of scoreCats()) {
    if (c.fp || !(c.pct ? line[c.att] : Math.round(lineStat(line, c.key) * 100))) continue;
    out.push(c.pct ? `<span class="mu-chip${flash(c.key, line[c.att] || 0, line[c.made] || 0)}"><b>${line[c.made] || 0}-${line[c.att] || 0}</b> ${c.label.replace('%', '')}</span>`
      : `<span class="mu-chip${flash(c.key, lineStat(line, c.key))}"><b>${fmt(lineStat(line, c.key), c.dec || 0)}</b> ${c.label}</span>`);
  }
  return out.join('');
}

// Today's lines as last drawn (NBA id -> stat -> [number, makes]): a live update flashes each bubble that moved,
// green for what helps (a make, a rebound) and red for what hurts (a miss, a turnover)
let chipWas = new Map();
function chipFlash(id, line) {
  const was = chipWas.get(id);
  const now = { fp: [isPoints() ? lineFp(line) : 0, 0] };
  for (const c of scoreCats()) if (!c.fp) now[c.key] = c.pct ? [line[c.att] || 0, line[c.made] || 0] : [lineStat(line, c.key), 0];
  const flash = (k, v, made = 0) => {
    if (!live.hold || !was || !was[k] || Math.abs(was[k][0] - v) < 1e-9) return '';
    const c = scoreCats().find(x => x.key === k);
    const good = c && c.pct ? made > was[k][1] : c && c.neg ? v < was[k][0] : v > was[k][0];
    return good ? ' flash-good' : ' flash-bad';
  };
  return { now, flash };
}

// One side of the matchup: its starters, bench and IR, with totals for the days picked and for the period
function dashSide(tid, dates, range, D) {
  const one = isOneGame();
  const S = fxTeamSide(tid), byId = new Map(S.players.map(p => [p.id, p])), on = new Set(S.lineup), il = new Set(S.il);
  const starters = S.lineup.map(id => byId.get(id) || null);
  const total = (ds, week) => {
    const t = {};
    for (const p of starters) {
      if (!p) continue;
      const lines = ds.map(d => lineOn(p, d)).filter(Boolean);
      if (one && week) { const c = oneGameLine(p, lines); if (c) addLine(t, c); } else lines.forEach(l => addLine(t, withBonus(l)));
    }
    return t;
  };
  return {
    tid, name: S.name, starters, tot: total(dates, range === 'week'), week: total(D.week, true),
    bench: sortDesc(S.players.filter(p => !on.has(p.id) && !il.has(p.id)), value),
    ir: S.players.filter(p => il.has(p.id)),
  };
}

// each side's starter games this period: played, on now, still to come; and the game minutes still to be played
  // (48 a game to come, what's left of each game on now)
function dashPace(S, D) {
  const one = isOneGame(), today = todayIso();
  const n = { played: 0, now: 0, left: 0, min: 0 };
  // one-game leagues: starters, not games: with a game in, on now, still to play their first
  if (one) {
    for (const p of S.starters) {
      if (!p) continue;
      if (D.all.some(d => d <= today && lineOn(p, d) && !(d === today && liveOn(p, d)))) n.played++;
      else if (liveOn(p, today) && lineOn(p, today)) n.now++;
      else if (p.status !== 'Out' && D.all.some(d => d >= today && playsOn(p, d) && !gameFinal(p, d))) n.left++;
    }
    return n;
  }
  for (const p of S.starters) if (p) for (const d of D.all) {
    if (!playsOn(p, d)) continue;
    const g = d === today ? liveGame(p, d) : null, line = lineOn(p, d);
    if (g && g.state === 'in') { if (line || (p.status !== 'Out' && startChance(p, d))) { n.now++; n.min += gameMinLeft(g); } continue; }
    if (d < today || gameFinal(p, d) || (g && g.state === 'post')) { if (line) n.played++; continue; }
    if (p.status !== 'Out') { const c = startChance(p, d); n.left += c; n.min += c * SPORT.game.minutes; } // (a goalie by his chance of starting)
  }
  n.min = Math.round(n.min);
  n.left = Math.round(n.left);
  return n;
}

const ICON_GAMES = '<svg viewBox="0 0 20 16" width="15" height="12" aria-hidden="true"><circle cx="7" cy="4.5" r="3" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M1.5 15c0-3.2 2.5-5.3 5.5-5.3s5.5 2.1 5.5 5.3" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M13 1.8a3 3 0 0 1 0 5.6M15.5 10.2c1.8.7 3 2.4 3 4.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
const ICON_CLOCK = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><circle cx="8" cy="9" r="6" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 5.8V9l2 1.6M6 1.2h4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';

function dashPaceChips(S, D) {
  const n = dashPace(S, D), one = isOneGame();
  return `<div class="mu-pace">
    <span class="mu-pc" title="${one ? `Starters with a game in: ${n.played}, playing their first now: ${n.now}, yet to play: ${n.left}` : `Starter games this period: ${n.played} played, ${n.now} on now, ${n.left} to come`}">${ICON_GAMES}<b>${n.played}</b><span class="${n.now ? 'pos-good' : ''}">${n.now}</span><span class="muted">${n.left}</span></span>
    ${one ? '' : `<span class="mu-pc" title="Game minutes left for your starters this period: ${SPORT.game.minutes} a game to come, less what's been played of games on now">${ICON_CLOCK}<b>${n.min}</b></span>`}
  </div>`;
}

// who leads each category over these days
function dashCatTable(A, B, sc) {
  const cats = scoreCats().filter(c => !c.fp);
  const catVal = (t, c) => (c.pct ? (t[c.att] ? fmtPct(t[c.made] / t[c.att]) : '—') : fmt(lineStat(t, c.key), c.dec || 0));
  // the row's color says whose it is (orange: the left team, as in the scoreboard); the toggle says which days
  const catRow = (S, i) => `<tr class="${S === A ? 'pf-me' : 'mu-opp'}" title="${esc(S.name)}">${cats.map((c, j) => `<td class="${sc.lead[j] === i ? 'mu-lead' : ''}">${catVal(S.tot, c)}</td>`).join('')}</tr>`;
  return `<div class="mu-cats-wrap"><table class="mu-cats"><thead><tr>${cats.map(c => `<th>${c.label}</th>`).join('')}</tr></thead>
    <tbody>${catRow(A, 1)}${catRow(B, -1)}</tbody></table></div>`;
}

// One player: who, his game (or the week's games), and what he's put up. C: the card's { D, dates, range, today, hasOpp, flash }
function dashCell(C, p, right, counts, tag = '', cls = '') {
  const { D, dates, range, today } = C, one = isOneGame();
  if (!p) return `<div class="mu-p${right ? ' right' : ''}"><span class="muted small">${C.hasOpp || !right ? 'Empty' : ''}</span></div>`;
  const lines = dates.map(d => lineOn(p, d)).filter(Boolean);
  // a one-game league's period shows the game that counts (for a starter; the bench's latest)
  const counted = one && range === 'week' ? oneGameLine(p, lines) : null;
  const tot = counted ? { ...counted } : lines.map(withBonus).reduce(addLine, {});
  let game;
  if (range === 'week') {
    const left = D.all.filter(d => playsOn(p, d) && !lineOn(p, d) && (d > today || (d === today && !gameFinal(p, d) && !(liveGame(p, d) && liveGame(p, d).state === 'post')))).length;
    const fbDay = isFootball() ? D.all.find(d => playsOn(p, d)) : null;
    const toCome = isGoalie(p) ? `about ${fmt(expectedGames(p, D.all.filter(d => d >= today && !gameFinal(p, d))), 1)}` : left;
    game = `${lines.length} G${counted && lines.length > 1 ? `, ${counts ? 'this one counts' : 'latest'}` : ''}${left && p.status !== 'Out' ? ` · ${toCome} left` : ''}${liveOn(p, today) && lineOn(p, today) ? ` · ${liveStatus(p, today)}` : ''}`;
    // football: his one game, or his bye
    if (isFootball()) game = fbDay ? `${fmtDay(fbDay).split(',')[0]} ${dashGame(p, fbDay)}` : 'Bye';
  } else game = dashGame(p, dates[0]);
  game = linkTeams(game); // (its opponent's code opens that team's players)
  const on = dates.some(d => liveOn(p, d) && lineOn(p, d)); // playing right now
  return `<div class="mu-p${right ? ' right' : ''}${on ? ' live' : ''}${counts ? '' : ' bench'}${cls}">
    <div class="bplayer">${headshot(p, hsPx(38, 32))}<div class="bmain"><div class="bname">${playerName(p)}${p.status !== 'Healthy' ? ' ' + statusBadge(p) : ''}${tag}</div></div></div>
    <div class="mu-game">${game}</div>
    ${lines.length ? `<div class="mu-chips">${lineChips(tot, C.flash && C.flash(p, tot))}</div>` : ''}
  </div>`;
}

// one day: just who's playing (or played), each side in one column with no gaps, by game: on now, then finished, then
// still to come (starters before the bench within each, the bench tagged: its games didn't count), then anyone Out or
// who sat out a finished game. A bench player in a game now is above a starter whose game hasn't begun.
function dashDayRows(C, A, B) {
  const d = C.dates[0], { D, today } = C;
  const sits = p => !lineOn(p, d) && (p.status === 'Out' || gameFinal(p, d) || !!(liveGame(p, d) && liveGame(p, d).state === 'post') || startWords(p, d) === 'not starting');
  // games on now first, then finished ones, then the rest by tip-off (lineup order otherwise)
  const stage = p => {
    const g = liveGame(p, d);
    if (g && g.state === 'in') return [0, 0];
    if (gameFinal(p, d) || (g && g.state === 'post')) return [1, 0];
    return [2, g && g.start ? +g.start : Infinity];
  };
  const byStage = list => list.map((p, i) => ({ p, i, s: stage(p) })).sort((a, b) => a.s[0] - b.s[0] || a.s[1] - b.s[1] || a.i - b.i).map(x => x.p);
  const plays = (list, out = false) => byStage(list.filter(p => p && playsOn(p, d) && sits(p) === out));
  const BENCH_TAG = ' <span class="badge bench">Bench</span>'; // (not beside Out: that says enough, and both crowd the name out)
  const column = S => {
    if (!S) return [];
    const bench = [...S.bench, ...S.ir];
    const on = p => p && playsOn(p, d) && !sits(p);
    const playing = [...S.starters.filter(on).map(p => [p, 'start']), ...bench.filter(on).map(p => [p, 'bench'])]
      .map((x, i) => ({ x, i, s: stage(x[0]) }))
      .sort((a, b) => a.s[0] - b.s[0] || (a.x[1] === 'bench') - (b.x[1] === 'bench') || a.s[1] - b.s[1] || a.i - b.i).map(y => y.x);
    return [...playing, ...plays(S.starters, true).map(p => [p, 'out']), ...plays(bench, true).map(p => [p, 'out bench'])];
  };
  const a = column(A), b = column(B);
  const person = (x, right) => (x ? dashCell(C, x[0], right, x[1] === 'start', x[1].endsWith('bench') && x[0].status !== 'Out' ? BENCH_TAG : '', x[1].startsWith('out') ? ' out' : '') : '<div></div>');
  const rows = Array.from({ length: Math.max(a.length, b.length) }, (x, i) => `<div class="mu-row day">${person(a[i], false)}${person(b[i], true)}</div>`).join('');
  const none = rows ? '' : d === today && !D.today ? `<p class="muted small mu-none">No ${SPORT.name} games today.</p>`
    : `<p class="muted small mu-none">No games ${d === today ? 'today' : 'that day'} for either team.</p>`;
  return { rows, none };
}

// The period: every lineup spot, slot by slot, with the bench below on request
function dashWeekRows(C, A, B) {
  const row = (slot, a, b, counts) => `<div class="mu-row${counts ? '' : ' bench'}">${dashCell(C, a, false, counts)}<div class="mu-slot">${slotBadge(slot)}</div>${B ? dashCell(C, b, true, counts) : '<div></div>'}</div>`;
  const rows = state.slots.map((s, i) => row(s, A.starters[i], B && B.starters[i], true)).join('');
  const nb = Math.max(A.bench.length, B ? B.bench.length : 0), ni = Math.max(A.ir.length, B ? B.ir.length : 0);
  const bench = ui.dashBench ? Array.from({ length: nb }, (x, i) => row('BN', A.bench[i], B && B.bench[i], false)).join('')
    + Array.from({ length: ni }, (x, i) => row('IL', A.ir[i], B && B.ir[i], false)).join('') : '';
  const benchBtn = nb + ni ? `<button type="button" class="link-btn mu-bench-btn" data-action="dash-bench" aria-expanded="${!!ui.dashBench}">${ui.dashBench ? 'Hide the bench' : `Show the bench (${nb + ni})`}</button>` : '';
  return `<div class="mu-rows">${rows}${bench}</div>${benchBtn}`;
}

function dashMatchupCard() {
  const L = fxLeague(), today = todayIso(), yesterday = addDays(today, -1);
  const card = (head, body) => `<div class="card mu-card"><div class="card-head">${head || '<span></span>'}${infoBtn('dashmatch')}</div>${body}</div>`;
  const me = ui.viewing ? ui.viewA : state.fxTeam;
  if (!L) return '';
  if (!me) return card('', '<p class="muted small" style="margin:0">Pick your team at the top to see your matchup.</p>');
  if (!BOX) return card('', loadingLine('Loading the latest box scores…'));
  leagueWeekFresh(L);
  footballLines(L);
  const D = dashDays();
  // Today, the last game day before it, the matchup period (the league's, from its schedule) so far. Until one is picked: today once its games have started,
  // else the last game day. Today stays on the toggle on a day without NBA games (Election Day), to say so.
  const opts = [D.all.includes(today) && ['today', 'Today'], D.day && ['day', D.day === yesterday ? 'Yesterday' : fmtDay(D.day)], ['week', 'This period', `${fmtDay(D.all[0])} – ${fmtDay(D.all[D.all.length - 1])}`]].filter(Boolean);
  const range = opts.some(([k]) => k === ui.dashRange) ? ui.dashRange : D.today && (D.started || !D.day) ? 'today' : D.day ? 'day' : 'week';
  const dates = range === 'week' ? D.week : [range === 'today' ? today : D.day];
  const toggle = `<div class="seg seg-sm" role="group" aria-label="Show games from">${opts.map(([k, l, tip]) => `<button type="button" class="${k === range ? 'on' : ''}" data-action="dash-range" data-range="${k}" aria-pressed="${k === range}"${tip ? ` title="${tip}"` : ''}>${l}</button>`).join('')}</div>`;

  const opp = ui.viewing && ui.viewB ? { id: ui.viewB } : fxOpponentFor(weekStartAt(0), me);
  const A = dashSide(me, dates, range, D), B = opp ? dashSide(opp.id, dates, range, D) : null;
  const pts = isPoints();
  // a tied category counts half to each side: 7.5–1.5
  const half = (sc, k) => sc[k] + sc.ties / 2;
  // the big numbers are the matchup's: the period so far; the table and the players, the days picked
  const sc = B ? weekScore(A.tot, B.tot) : null, wk = B ? weekScore(A.week, B.week) : null;
  const big = (S, n) => `<div class="mu-team${S === B ? ' right' : ''}"><div class="mu-name">${teamLink(S.tid, esc(S.name))}</div><div class="mu-line"><div class="mu-score">${B ? (pts ? fmtFp(n) : n) : ''}</div>${dashPaceChips(S, D)}</div></div>`;
  const head = `<div class="mu-board">
      ${big(A, wk && (pts ? wk.me : half(wk, 'me')))}
      <div class="mu-mid"></div>
      ${B ? big(B, pts ? wk.opp : half(wk, 'opp')) : `<div class="mu-team right"><div class="mu-name muted">No opponent this week</div></div>`}
    </div>
    ${range !== 'day' && live.error ? `<p class="small pos-bad mu-when">ESPN: ${esc(live.error)}</p>` : ''}`;

  const catTable = B && !pts ? dashCatTable(A, B, sc) : '';

  // Today: each bubble flashes when a live update moves it
  const isToday = range === 'today', chipNext = new Map();
  const chipsNow = (p, tot) => { const f = chipFlash(p.nbaId, tot); chipNext.set(p.nbaId, f.now); return f.flash; };
  const C = { D, dates, range, today, hasOpp: !!B, flash: isToday ? chipsNow : undefined };
  if (range !== 'week') {
    const { rows, none } = dashDayRows(C, A, B);
    chipWas = isToday ? chipNext : new Map();
    return card(toggle, `${head}${catTable}<div class="mu-rows">${rows}</div>${none}`);
  }
  chipWas = new Map();
  return card(toggle, `${head}${catTable}${dashWeekRows(C, A, B)}`);
}

// ----- This week's waiver moves: who joined and left each team since last week's rosters -----
// Fantrax shares each period's rosters but no transaction log, so a move is a difference between the last period's
// rosters and this one's as they are now: on no roster before = added, on no roster now = dropped, on another team
// before = traded (on both teams). A player added and dropped in between isn't seen.
// Team id -> [{ kind: 'add' | 'drop' | 'trade' (in) | 'away' (traded out), nba, name, from / to }]
function periodMoves(L, weeks) {
  const cur = L.rosterPeriod;
  const now = cur && weeks && weeks.find(w => w.n === cur), before = now && weeks.find(w => w.n === cur - 1);
  if (!now || !before) return null;
  const fidNba = currentFidNba();
  const names = new Map(Object.values(L.rosters || {}).flat().map(x => [x.fid, x.name]));
  const who = f => { const nba = fidNba(f), raw = nba && nbaById.get(nba); return { nba, name: raw ? raw.name : names.get(f) || 'A player' }; };
  const out = {};
  const add = (tid, m) => (out[tid] = out[tid] || []).push(m);
  for (const [f, o] of now.owner) {
    const b = before.owner.get(f);
    if (!b) add(o.tid, { kind: 'add', ...who(f) });
    else if (b.tid !== o.tid) { add(o.tid, { kind: 'trade', from: b.tid, ...who(f) }); add(b.tid, { kind: 'away', to: o.tid, ...who(f) }); }
  }
  for (const [f, b] of before.owner) if (!now.owner.has(f)) add(b.tid, { kind: 'drop', ...who(f) });
  return out;
}
const movesLoad = new WeakMap(); // league -> its weekly rosters, once loaded
function movesCard() {
  const L = fxLeague();
  if (!L || !hasLineupHistory(L) || !(L.rosterPeriod > 1)) return '';
  if (!movesLoad.has(L)) {
    movesLoad.set(L, null);
    loadRosterWeeks(L).then(w => movesLoad.set(L, w || [])).catch(() => movesLoad.set(L, [])).finally(() => { if (ui.tab === 'dashboard') render(); });
  }
  const weeks = movesLoad.get(L);
  const title = `Waiver wire ${infoBtn('moves')}`;
  if (!weeks) return dashFold('moves', title, 'loading…', loadingLine("Loading last week's rosters…"));
  const moves = periodMoves(L, weeks);
  if (!moves) return '';
  const me = ui.viewing ? ui.viewA : state.fxTeam;
  const order = { add: 0, trade: 1, away: 2, drop: 3 };
  const tids = Object.keys(moves).sort((a, b) => (b === me) - (a === me) || moves[b].length - moves[a].length);
  const at = (readLeagueCache()[L.id] || {}).at;
  const SIGN = { add: '+', drop: '−' }, SAID = { add: 'added', drop: 'dropped', trade: 'traded for' }; // (a trade either way: ⇄)
  const who = m => (m.nba ? inlinePlayer({ nbaId: m.nba, name: m.name }, playerBtn(m.nba, m.name)) : esc(m.name));
  const other = m => (m.kind === 'trade' ? ` <span class="muted small">from ${esc(fxTeamName(m.from))}</span>` : m.kind === 'away' ? ` <span class="muted small">to ${esc(fxTeamName(m.to))}</span>` : '');
  const move = m => `<li class="mv mv-${m.kind}"><span class="mv-k" aria-hidden="true">${SIGN[m.kind] || '⇄'}</span>${who(m)}${other(m)}<span class="sr-only">${SAID[m.kind] || 'traded away'}</span></li>`;
  const body = tids.length ? `<div class="mv-teams">${tids.map(tid => `<div class="mv-team${tid === me ? ' me' : ''}"><div class="mv-name">${teamLink(tid)}</div>
      <ul class="mv-list">${[...moves[tid]].sort((a, b) => order[a.kind] - order[b.kind]).map(move).join('')}</ul></div>`).join('')}</div>`
    : '<p class="muted small" style="margin:0">No adds or drops since last week.</p>';
  // the line: how many adds and drops (a trade counts once), and yours
  const all = Object.values(moves).flat().filter(m => m.kind !== 'away'), n = all.length;
  const mineM = !ui.viewing && moves[me] ? moves[me] : [], cnt = k => mineM.filter(m => m.kind === k).length;
  const yours = [cnt('add') && `+${cnt('add')}`, cnt('trade') && `⇄${cnt('trade')}`, cnt('drop') && `−${cnt('drop')}`].filter(Boolean).join(' ');
  const sub = !n ? 'no adds or drops this week' : `${yours ? `you ${yours} · ` : ''}${n} move${n === 1 ? '' : 's'} this week`;
  return dashFold('moves', title, sub, `${body}${at ? `<p class="muted small mv-when">Week ${L.rosterPeriod} · rosters as of ${fmtTime(at, { weekday: 'short' })} · ↻ Reload in ⚙ for the latest</p>` : ''}`);
}
