// League Layer: the Matchup tab.
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
  </div>`;
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

// A player's game that day, in a bubble as Fantrax shows it: tip-off, the score then the clock while it's on, the final
// score ("DET 144 @ WAS 140 F"; just the opponent with Hide game scores on). DNP and a goalie's start come after the bubble.
// The score stays in one piece: on a phone only the clock goes to a second line.
function dashGame(p, d) {
  if (!playsOn(p, d)) return '<span class="muted">No game</span>';
  const g = liveGame(p, d), s = g || (BOX.scores && BOX.scores.get(`${d} ${p.team}`));
  const vs = x => (x.home === p.team ? `vs ${x.away}` : `@${x.home}`);
  const bubble = (x, cls = '') => `<span class="game-pill${cls}">${x}</span>`, whole = x => `<span class="gp-part">${x}</span>`;
  const inGoal = isGoalie(p) && !lineOn(p, d) ? ` · ${startWords(p, d)}` : '';
  if (g && g.state === 'pre') return `${bubble(`${vs(g)} ${fmtTime(g.start)}`)}${inGoal}`;
  const score = !s ? '' : ui.hideScores ? vs(s) : `${s.away} ${s.as} @ ${s.home} ${s.hs}`;
  if (g && g.state === 'in') return bubble(`${whole(score)} ${whole(liveStatus(p, d))}`); // (its dot: on the floor or not)
  const dnp = gameFinal(p, d) || (g && g.state === 'post') ? (lineOn(p, d) ? '' : ' · <b>DNP</b>') : '';
  // a final needs no "F": the bubble is tinted green or red for his team's win or loss (none for a tie, or with scores hidden)
  if (s && ui.hideScores) return `${bubble(`${score} · Final`)}${dnp}`;
  if (s) {
    const us = +(s.home === p.team ? s.hs : s.as), them = +(s.home === p.team ? s.as : s.hs);
    return `${bubble(score, us > them ? ' gp-w' : us < them ? ' gp-l' : '')}${dnp}`;
  }
  const nx = NBA.teams && NBA.teams[p.team] && NBA.teams[p.team].next;
  return nx && nx.date === d ? `${bubble(nx.home ? `vs ${nx.opp}` : `@${nx.opp}`)}${inGoal}` : `${bubble('Final')}${dnp}`;
}

// A line in the league's own categories: makes/attempts for the percentages and a points league's shooting ("5/12 FG",
// lineCats), fantasy points first in points leagues; nothing for a stat he didn't put up (no attempts, 0 blocks)
// flash(key, value, makes): a class for a bubble whose number just changed (a live update)
function lineChips(line, flash = () => '') {
  const out = isPoints() ? [`<span class="mu-chip fp${flash('fp', lineFp(line))}"><b>${fmtFp(lineFp(line))}</b> FP</span>`] : [];
  for (const c of lineCats()) {
    if (c.fp || !(c.pct || c.shot ? line[c.att] : Math.round(lineStat(line, c.key) * 100))) continue;
    const m = line[c.made] || 0, a = line[c.att] || 0;
    out.push(c.pct || c.shot ? `<span class="mu-chip${flash(c.key, a, m)}"><b>${m}/${a}</b> ${c.label.replace('%', '')}</span>`
      : `<span class="mu-chip${flash(c.key, lineStat(line, c.key))}"><b>${fmt(lineStat(line, c.key), 0)}</b> ${c.label}</span>`);
  }
  return out.join('');
}

// Today's lines as last drawn (NBA id -> stat -> [number, makes]): a live update flashes each bubble that moved,
// green for what helps (a make, a rebound) and red for what hurts (a miss, a turnover)
let chipWas = new Map();
function chipFlash(id, line) {
  const was = chipWas.get(id);
  const now = { fp: [isPoints() ? lineFp(line) : 0, 0] };
  for (const c of lineCats()) if (!c.fp) now[c.key] = c.pct || c.shot ? [line[c.att] || 0, line[c.made] || 0] : [lineStat(line, c.key), 0];
  const flash = (k, v, made = 0) => {
    if (!live.hold || !was || !was[k] || Math.abs(was[k][0] - v) < 1e-9) return '';
    const c = lineCats().find(x => x.key === k);
    const good = c && (c.pct || c.shot) ? made > was[k][1] : c && c.neg ? v < was[k][0] : v > was[k][0];
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
    ir: S.players.filter(p => il.has(p.id) && !onTaxi(p)), taxi: S.players.filter(p => il.has(p.id) && onTaxi(p)),
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
  const catVal = (t, c) => (c.pct ? (t[c.att] ? fmtPct(t[c.made] / t[c.att]) : '—') : fmt(lineStat(t, c.key), 0));
  // the row's color says whose it is (orange: the left team, as in the scoreboard); the toggle says which days
  const catRow = (S, i) => `<tr class="${S === A ? 'pf-me' : 'mu-opp'}" title="${esc(S.name)}">${cats.map((c, j) => `<td class="${sc.lead[j] === i ? 'mu-lead' : ''}">${catVal(S.tot, c)}</td>`).join('')}</tr>`;
  return `<div class="mu-cats-wrap"><table class="mu-cats"><thead><tr>${cats.map(c => `<th>${c.label}</th>`).join('')}</tr></thead>
    <tbody>${catRow(A, 1)}${catRow(B, -1)}</tbody></table></div>`;
}

// His photo: in full screen his full one as on his card, on his team's colors (the owner's ask, Nov 2026), else the round one
function dashPhoto(p) {
  const raw = ui.dashFull && p.nbaId != null ? nbaById.get(p.nbaId) : null;
  return raw && photoSrcs(raw) ? playerPhoto(raw, 'mu-ph', true) : headshot(p, ui.dashFull ? hsPx(56, 40) : hsPx(38, 32));
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
    game = `${lines.length} G${counted && lines.length > 1 ? `, ${counts ? 'this one counts' : 'latest'}` : ''}${left && p.status !== 'Out' ? ` · ${toCome} left` : ''}${liveOn(p, today) && (lineOn(p, today) || onFloor(p, today)) ? ` · ${liveStatus(p, today)}` : ''}`;
    // football: his one game, or his bye
    if (isFootball()) game = fbDay ? `${fmtDay(fbDay).split(',')[0]} ${dashGame(p, fbDay)}` : 'Bye';
  } else game = dashGame(p, dates[0]);
  game = linkTeams(game); // (its opponent's code opens that team's players)
  // (in a game on now, the dot by its clock says whether he's on the floor: liveStatus; no green row, the owner's ask)
  return `<div class="mu-p${right ? ' right' : ''}${counts ? '' : ' bench'}${cls}">
    <div class="bplayer">${dashPhoto(p)}<div class="bmain"><div class="bname">${playerName(p)}${p.status !== 'Healthy' ? ' ' + statusBadge(p) : ''}${tag}</div></div></div>
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
  const benchTag = p => (onTaxi(p) ? ' <span class="badge bench">Taxi</span>' : BENCH_TAG);
  const column = S => {
    if (!S) return [];
    const bench = [...S.bench, ...S.ir, ...S.taxi];
    const on = p => p && playsOn(p, d) && !sits(p);
    const playing = [...S.starters.filter(on).map(p => [p, 'start']), ...bench.filter(on).map(p => [p, 'bench'])]
      .map((x, i) => ({ x, i, s: stage(x[0]) }))
      .sort((a, b) => a.s[0] - b.s[0] || (a.x[1] === 'bench') - (b.x[1] === 'bench') || a.s[1] - b.s[1] || a.i - b.i).map(y => y.x);
    return [...playing, ...plays(S.starters, true).map(p => [p, 'out']), ...plays(bench, true).map(p => [p, 'out bench'])];
  };
  const a = column(A), b = column(B);
  const person = (x, right) => (x ? dashCell(C, x[0], right, x[1] === 'start', x[1].endsWith('bench') && x[0].status !== 'Out' ? benchTag(x[0]) : '', x[1].startsWith('out') ? ' out' : '') : '<div></div>');
  // (no second column when there's never an opponent: C.solo)
  const rows = Array.from({ length: Math.max(a.length, b.length) }, (x, i) => `<div class="mu-row day">${person(a[i], false)}${C.solo ? '' : person(b[i], true)}</div>`).join('');
  const none = rows ? '' : d === today && !D.today ? `<p class="muted small mu-none">No ${SPORT.name} games today.</p>`
    : `<p class="muted small mu-none">No games ${d === today ? 'today' : 'that day'} for either team.</p>`;
  return { rows, none };
}

// The period: every lineup spot, slot by slot, with the bench below on request
function dashWeekRows(C, A, B) {
  const row = (slot, a, b, counts) => `<div class="mu-row${counts ? '' : ' bench'}">${dashCell(C, a, false, counts)}<div class="mu-slot">${slotBadge(slot)}</div>${B ? dashCell(C, b, true, counts) : C.solo ? '' : '<div></div>'}</div>`;
  const rows = state.slots.map((s, i) => row(s, A.starters[i], B && B.starters[i], true)).join('');
  const nb = Math.max(A.bench.length, B ? B.bench.length : 0), ni = Math.max(A.ir.length, B ? B.ir.length : 0), nt = Math.max(A.taxi.length, B ? B.taxi.length : 0);
  const bench = ui.dashBench ? Array.from({ length: nb }, (x, i) => row('BN', A.bench[i], B && B.bench[i], false)).join('')
    + Array.from({ length: ni }, (x, i) => row('IL', A.ir[i], B && B.ir[i], false)).join('')
    + Array.from({ length: nt }, (x, i) => row('TAXI', A.taxi[i], B && B.taxi[i], false)).join('') : '';
  const benchBtn = nb + ni + nt ? `<button type="button" class="link-btn mu-bench-btn" data-action="dash-bench" aria-expanded="${!!ui.dashBench}">${ui.dashBench ? 'Hide the bench' : `Show the bench (${nb + ni + nt})`}</button>` : '';
  return `<div class="mu-rows${C.solo ? ' solo' : ''}">${rows}${bench}</div>${benchBtn}`;
}

// The matchup alone on the screen (the card's button, in place of its (i): the owner's ask, Nov 2026). While the card is
// drawn `full` the CSS hides the head, the tabs and everything else, so a live update keeps it; where the browser
// allows (not an iPhone) the browser's own full screen comes with it. Ends with the button, Esc or leaving the tab.
const FULL_ICON = { on: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>', off: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>' };
const browserFull = () => document.fullscreenElement || document.webkitFullscreenElement;
function dashFull(on, draw = true) {
  ui.dashFull = on;
  const el = document.documentElement;
  const go = on ? !browserFull() && (el.requestFullscreen || el.webkitRequestFullscreen) : browserFull() && (document.exitFullscreen || document.webkitExitFullscreen);
  try { if (go) Promise.resolve(go.call(on ? el : document)).catch(() => {}); } catch (e) { /* not allowed here: the page's own still shows */ }
  if (!draw) return;
  render();
  window.scrollTo(0, 0);
}
for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) document.addEventListener(ev, () => { if (ui.dashFull && !browserFull()) dashFull(false); });
// (in the browser's full screen, Esc leaves it and the page never sees the key: the line above. A popup's Esc closes the popup)
document.addEventListener('keydown', e => { if (e.key === 'Escape' && ui.dashFull && !document.querySelector('dialog[open]')) dashFull(false); });
window.addEventListener('hashchange', () => { if (ui.dashFull) dashFull(false, false); }); // (route draws the new tab)

// The When toggle of the Matchup tab and the sandbox's Live: Today, the last game day before it, the week. D: { today (when
// it has games), started, day } (dashDays, perfDays); hasToday: Today on the toggle; week: [its label, its days]; picked: the
// pick kept (ui.dashRange, ui.watchRange). Until one is picked: today once its games have started, else the last game
// day, else fallback -> { range, toggle }
function dayToggle({ D, hasToday, week: [label, days], picked, fallback, action }) {
  const opts = [hasToday && ['today', 'Today'], D.day && ['day', D.day === addDays(todayIso(), -1) ? 'Yesterday' : fmtDay(D.day)],
    ['week', label, `${fmtDay(days[0])} – ${fmtDay(days[days.length - 1])}`]].filter(Boolean);
  const range = opts.some(([k]) => k === picked) ? picked : D.today && (D.started || !D.day) ? 'today' : D.day ? 'day' : fallback;
  return { range, toggle: segBtns('Show games from', action, 'range', opts, range) };
}

function dashMatchupCard() {
  const L = fxLeague(), today = todayIso();
  const fullBtn = `<button type="button" class="mu-full-btn" data-action="dash-full" aria-pressed="${!!ui.dashFull}" aria-label="Full screen" title="${ui.dashFull ? 'Exit full screen (Esc)' : 'Full screen'}">${lineIcon(FULL_ICON[ui.dashFull ? 'on' : 'off'], 'mu-full-ico')}</button>`;
  const card = (head, body, full) => `<div class="card mu-card${full && ui.dashFull ? ' full' : ''}"><div class="card-head">${head || '<span></span>'}${full ? fullBtn : ''}</div>${body}</div>`;
  const me = ui.viewing ? ui.viewA : state.fxTeam;
  if (!L) return '';
  if (!me) return card('', '<p class="muted small" style="margin:0">Pick your team at the top to see your matchup.</p>');
  if (!BOX) return card('', loadingLine('Loading the latest box scores…'));
  leagueWeekFresh(L);
  footballLines(L);
  const D = dashDays();
  // Today, the last game day before it, the matchup period (the league's, from its schedule; a roto league's calendar week)
  // so far. Today stays on the toggle on a day without NBA games (Election Day), to say so.
  const { range, toggle } = dayToggle({ D, hasToday: D.all.includes(today), week: [`This ${spanWord()}`, D.all], picked: ui.dashRange, fallback: 'week', action: 'dash-range' });
  const dates = range === 'week' ? D.week : [range === 'today' ? today : D.day];

  const roto = isRoto(); // (no opponent ever: the head is your standing, and your players get the whole width)
  const opp = roto ? null : ui.viewing && ui.viewB ? { id: ui.viewB } : fxOpponentFor(weekStartAt(0), me);
  const A = dashSide(me, dates, range, D), B = opp ? dashSide(opp.id, dates, range, D) : null;
  const pts = isPoints();
  // a tied category counts half to each side: 7.5–1.5
  const half = (sc, k) => sc[k] + sc.ties / 2;
  // the big numbers are the matchup's: the period so far; the table and the players, the days picked
  const sc = B ? weekScore(A.tot, B.tot) : null, wk = B ? weekScore(A.week, B.week) : null;
  const big = (S, n) => `<div class="mu-team${S === B ? ' right' : ''}"><div class="mu-name">${teamLink(S.tid, esc(S.name))}</div><div class="mu-line"><div class="mu-score">${B ? (pts ? fmtFp(n) : n) : ''}</div>${dashPaceChips(S, D)}</div></div>`;
  const head = `${roto ? rotoBoard(A, D) : `<div class="mu-board">
      ${big(A, wk && (pts ? wk.me : half(wk, 'me')))}
      <div class="mu-mid"></div>
      ${B ? big(B, pts ? wk.opp : half(wk, 'opp')) : `<div class="mu-team right"><div class="mu-name muted">No opponent this week</div></div>`}
    </div>`}
    ${range !== 'day' && live.error ? `<p class="small pos-bad mu-when">ESPN: ${esc(live.error)}</p>` : ''}`;

  const catTable = roto ? rotoStandTable(me) : B && !pts ? dashCatTable(A, B, sc) : '';

  // Today: each bubble flashes when a live update moves it
  const isToday = range === 'today', chipNext = new Map();
  const chipsNow = (p, tot) => { const f = chipFlash(p.nbaId, tot); chipNext.set(p.nbaId, f.now); return f.flash; };
  const C = { D, dates, range, today, hasOpp: !!B, solo: roto, flash: isToday ? chipsNow : undefined };
  if (range !== 'week') {
    const { rows, none } = dashDayRows(C, A, B);
    chipWas = isToday ? chipNext : new Map();
    return card(toggle, `${head}${catTable}<div class="mu-rows${roto ? ' solo' : ''}">${rows}</div>${none}`, true);
  }
  chipWas = new Map();
  return card(toggle, `${head}${catTable}${dashWeekRows(C, A, B)}`, true);
}
