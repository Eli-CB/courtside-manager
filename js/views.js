// League Layer: Dashboard, Roster, Standings, Trades, Players.
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
  if (NBA) startLive(); // today's games, as they're played (when the matchup shows them)
  return `
  <div class="dash-grid">
    ${NBA ? dashMatchupCard() : ''}
    <div class="dash-folds">${recapFold()}${NBA ? movesCard() : ''}${newsCard()}</div>
    <div class="card">
      <div class="card-head"><h2>Action items</h2></div>
      <ul class="alerts">
        ${buildAlerts().map(x => `<li class="alert ${x.lvl}"><span class="dot"></span><span class="grow">${x.msg}</span>${x.action ? `<button class="btn sm" data-action="${x.action}">${x.label}</button>` : ''}</li>`).join('')}
      </ul>
    </div>
  </div>`;
}

// Under the matchup, one line each (the recap, the waiver wire, injury news): the line says what's inside, a tap opens
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
    `<p class="muted small">Player and game of the week, bench regret, the best all-play week and every final, ready to share with the league.</p><button type="button" class="btn sm primary" data-action="go-recap">See the recap</button>`, 'good') : '';
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
  const out = isPoints() ? [`<span class="mu-chip fp${flash('fp', lineFp(line))}"><b>${fmt(lineFp(line), 1)}</b> FP</span>`] : [];
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

function dashMatchupCard() {
  const L = fxLeague(), today = todayIso(), yesterday = addDays(today, -1);
  const card = (head, body) => `<div class="card mu-card"><div class="card-head"><h2>Matchup ${infoBtn('dashmatch')}</h2>${head}</div>${body}</div>`;
  const me = ui.viewing ? ui.viewA : state.fxTeam;
  if (!L) return '';
  if (!me) return card('', '<p class="muted small" style="margin:0">Pick your team at the top to see your matchup.</p>');
  if (!BOX) return card('', '<p class="muted small" style="margin:0">Loading the latest box scores…</p>');
  sleeperWeekFresh(L);
  const one = isOneGame(); // Sleeper: one game a week counts for each starter
  const D = dashDays();
  // Today, the last game day before it, the matchup period (the league's, from its schedule) so far. Until one is picked: today once its games have started,
  // else the last game day. Today stays on the toggle on a day without NBA games (Election Day), to say so.
  const opts = [D.all.includes(today) && ['today', 'Today'], D.day && ['day', D.day === yesterday ? 'Yesterday' : fmtDay(D.day)], ['week', 'This period', `${fmtDay(D.all[0])} – ${fmtDay(D.all[D.all.length - 1])}`]].filter(Boolean);
  const range = opts.some(([k]) => k === ui.dashRange) ? ui.dashRange : D.today && (D.started || !D.day) ? 'today' : D.day ? 'day' : 'week';
  const dates = range === 'week' ? D.week : [range === 'today' ? today : D.day];
  const toggle = `<div class="seg seg-sm" role="group" aria-label="Show games from">${opts.map(([k, l, tip]) => `<button type="button" class="${k === range ? 'on' : ''}" data-action="dash-range" data-range="${k}" aria-pressed="${k === range}"${tip ? ` title="${tip}"` : ''}>${l}</button>`).join('')}</div>`;

  const opp = ui.viewing && ui.viewB ? { id: ui.viewB } : fxOpponentFor(weekStartAt(0), me);
  const side = tid => {
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
      bench: S.players.filter(p => !on.has(p.id) && !il.has(p.id)).sort((a, b) => value(b) - value(a)),
      ir: S.players.filter(p => il.has(p.id)),
    };
  };
  const A = side(me), B = opp ? side(opp.id) : null;
  const pts = isPoints(), cats = scoreCats().filter(c => !c.fp);
  // a tied category counts half to each side: 7.5–1.5
  const half = (sc, k) => sc[k] + sc.ties / 2;
  // the big numbers are the matchup's: the period so far; the table and the players, the days picked
  const sc = B ? weekScore(A.tot, B.tot) : null, wk = B ? weekScore(A.week, B.week) : null;
  // each side's starter games this period: played, on now, still to come; and the game minutes still to be played
  // (48 a game to come, what's left of each game on now)
  const pace = S => {
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
  };
  const ICON_GAMES = '<svg viewBox="0 0 20 16" width="15" height="12" aria-hidden="true"><circle cx="7" cy="4.5" r="3" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M1.5 15c0-3.2 2.5-5.3 5.5-5.3s5.5 2.1 5.5 5.3" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M13 1.8a3 3 0 0 1 0 5.6M15.5 10.2c1.8.7 3 2.4 3 4.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
  const ICON_CLOCK = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><circle cx="8" cy="9" r="6" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 5.8V9l2 1.6M6 1.2h4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
  const paceChips = S => {
    const n = pace(S);
    return `<div class="mu-pace">
      <span class="mu-pc" title="${one ? `Starters with a game in: ${n.played}, playing their first now: ${n.now}, yet to play: ${n.left}` : `Starter games this period: ${n.played} played, ${n.now} on now, ${n.left} to come`}">${ICON_GAMES}<b>${n.played}</b><span class="${n.now ? 'pos-good' : ''}">${n.now}</span><span class="muted">${n.left}</span></span>
      ${one ? '' : `<span class="mu-pc" title="Game minutes left for your starters this period: ${SPORT.game.minutes} a game to come, less what's been played of games on now">${ICON_CLOCK}<b>${n.min}</b></span>`}
    </div>`;
  };
  const big = (S, n) => `<div class="mu-team${S === B ? ' right' : ''}"><div class="mu-name">${esc(S.name)}</div><div class="mu-line"><div class="mu-score">${B ? (pts ? fmt(n, 1) : n) : ''}</div>${paceChips(S)}</div></div>`;
  const head = `<div class="mu-board">
      ${big(A, wk && (pts ? wk.me : half(wk, 'me')))}
      <div class="mu-mid"></div>
      ${B ? big(B, pts ? wk.opp : half(wk, 'opp')) : `<div class="mu-team right"><div class="mu-name muted">No opponent this week</div></div>`}
    </div>
    ${range !== 'day' && live.error ? `<p class="small pos-bad mu-when">ESPN: ${esc(live.error)}</p>` : ''}`;

  // who leads each category over these days
  const catVal = (t, c) => (c.pct ? (t[c.att] ? fmtPct(t[c.made] / t[c.att]) : '—') : fmt(lineStat(t, c.key), c.dec || 0));
  // the row's color says whose it is (orange: the left team, as in the scoreboard); the toggle says which days
  const catRow = (S, i) => `<tr class="${S === A ? 'pf-me' : 'mu-opp'}" title="${esc(S.name)}">${cats.map((c, j) => `<td class="${sc.lead[j] === i ? 'mu-lead' : ''}">${catVal(S.tot, c)}</td>`).join('')}</tr>`;
  const catTable = B && !pts ? `<div class="mu-cats-wrap"><table class="mu-cats"><thead><tr>${cats.map(c => `<th>${c.label}</th>`).join('')}</tr></thead>
      <tbody>${catRow(A, 1)}${catRow(B, -1)}</tbody></table></div>` : '';

  // Today: each bubble flashes when a live update moves it
  const isToday = range === 'today', chipNext = new Map();
  const chipsNow = (p, tot) => { const f = chipFlash(p.nbaId, tot); chipNext.set(p.nbaId, f.now); return f.flash; };
  // one player's cell: who, his game (or the week's games), and what he's put up
  const cell = (p, right, counts, tag = '', cls = '') => {
    if (!p) return `<div class="mu-p${right ? ' right' : ''}"><span class="muted small">${B || !right ? 'Empty' : ''}</span></div>`;
    const lines = dates.map(d => lineOn(p, d)).filter(Boolean);
    // a one-game league's period shows the game that counts (for a starter; the bench's latest)
    const counted = one && range === 'week' ? oneGameLine(p, lines) : null;
    const tot = counted ? { ...counted } : lines.map(withBonus).reduce(addLine, {});
    let game;
    if (range === 'week') {
      const left = D.all.filter(d => playsOn(p, d) && !lineOn(p, d) && (d > today || (d === today && !gameFinal(p, d) && !(liveGame(p, d) && liveGame(p, d).state === 'post')))).length;
      const toCome = isGoalie(p) ? `about ${fmt(expectedGames(p, D.all.filter(d => d >= today && !gameFinal(p, d))), 1)}` : left;
      game = `${lines.length} G${counted && lines.length > 1 ? `, ${counts ? 'this one counts' : 'latest'}` : ''}${left && p.status !== 'Out' ? ` · ${toCome} left` : ''}${liveOn(p, today) && lineOn(p, today) ? ` · ${liveStatus(p, today)}` : ''}`;
    } else game = dashGame(p, dates[0]);
    const on = dates.some(d => liveOn(p, d) && lineOn(p, d)); // playing right now
    return `<div class="mu-p${right ? ' right' : ''}${on ? ' live' : ''}${counts ? '' : ' bench'}${cls}">
      <div class="bplayer">${headshot(p, 32)}<div class="bmain"><div class="bname">${playerName(p)}${p.status !== 'Healthy' ? ' ' + statusBadge(p) : ''}${tag}</div></div></div>
      <div class="mu-game">${game}</div>
      ${lines.length ? `<div class="mu-chips">${lineChips(tot, isToday ? chipsNow(p, tot) : undefined)}</div>` : ''}
    </div>`;
  };
  // one day: just who's playing (or played), each side in one column with no gaps: starters, then the bench (its
  // games didn't count, tagged), then anyone Out or who sat out a finished game
  if (range !== 'week') {
    const d = dates[0];
    const sits = p => !lineOn(p, d) && (p.status === 'Out' || gameFinal(p, d) || !!(liveGame(p, d) && liveGame(p, d).state === 'post') || startWords(p, d) === 'not starting');
    // within each group: games on now first, then finished ones, then the rest by tip-off (lineup order otherwise)
    const stage = p => {
      const g = liveGame(p, d);
      if (g && g.state === 'in') return [0, 0];
      if (gameFinal(p, d) || (g && g.state === 'post')) return [1, 0];
      return [2, g && g.start ? +g.start : Infinity];
    };
    const byStage = list => list.map((p, i) => ({ p, i, s: stage(p) })).sort((a, b) => a.s[0] - b.s[0] || a.s[1] - b.s[1] || a.i - b.i).map(x => x.p);
    const plays = (list, out = false) => byStage(list.filter(p => p && playsOn(p, d) && sits(p) === out));
    const BENCH_TAG = ' <span class="badge bench">Bench</span>';
    const column = S => {
      if (!S) return [];
      const bench = [...S.bench, ...S.ir];
      return [...plays(S.starters).map(p => [p, 'start']), ...plays(bench).map(p => [p, 'bench']),
        ...plays(S.starters, true).map(p => [p, 'out']), ...plays(bench, true).map(p => [p, 'out bench'])];
    };
    const a = column(A), b = column(B);
    const one = (x, right) => (x ? cell(x[0], right, x[1] === 'start', x[1].endsWith('bench') ? BENCH_TAG : '', x[1].startsWith('out') ? ' out' : '') : '<div></div>');
    const rows = Array.from({ length: Math.max(a.length, b.length) }, (x, i) => `<div class="mu-row day">${one(a[i], false)}${one(b[i], true)}</div>`).join('');
    const none = rows ? '' : d === today && !D.today ? `<p class="muted small mu-none">No ${SPORT.name} games today.</p>`
      : `<p class="muted small mu-none">No games ${d === today ? 'today' : 'that day'} for either team.</p>`;
    chipWas = isToday ? chipNext : new Map();
    return card(toggle, `${head}${catTable}<div class="mu-rows">${rows}</div>${none}`);
  }
  const row = (slot, a, b, counts) => `<div class="mu-row${counts ? '' : ' bench'}">${cell(a, false, counts)}<div class="mu-slot">${slotBadge(slot)}</div>${B ? cell(b, true, counts) : '<div></div>'}</div>`;
  const rows = state.slots.map((s, i) => row(s, A.starters[i], B && B.starters[i], true)).join('');
  const nb = Math.max(A.bench.length, B ? B.bench.length : 0), ni = Math.max(A.ir.length, B ? B.ir.length : 0);
  const bench = ui.dashBench ? Array.from({ length: nb }, (x, i) => row('BN', A.bench[i], B && B.bench[i], false)).join('')
    + Array.from({ length: ni }, (x, i) => row('IL', A.ir[i], B && B.ir[i], false)).join('') : '';
  const benchBtn = nb + ni ? `<button type="button" class="link-btn mu-bench-btn" data-action="dash-bench" aria-expanded="${!!ui.dashBench}">${ui.dashBench ? 'Hide the bench' : `Show the bench (${nb + ni})`}</button>` : '';
  chipWas = new Map();
  return card(toggle, `${head}${catTable}<div class="mu-rows">${rows}${bench}</div>${benchBtn}`);
}

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
  return nbaPlayers().filter(p => p.min).map(p => ({ raw: nbaById.get(p.nbaId), g: p.gp || 0, tot: statLine(p), z: isPoints() ? {} : catWins(p), v: value(p), per: true }))
    .filter(r => r.raw);
}

let perfOrder = { sig: '', ids: [] }; // the rows last shown, in order
function topPerformancesCard() {
  const today = todayIso(), yesterday = addDays(today, -1);
  const card = (head, body) => `<div class="card"><div class="card-head"><h2>Players ${infoBtn('perf')}</h2>${head}${LOCAL ? '<button class="btn sm" data-action="refresh-data">Refresh stats</button>' : ''}</div>${body}</div>`;
  if (!BOX) return card('', '<p class="muted small" style="margin:0">Loading the latest box scores…</p>');
  const P = perfDays();
  // the buttons: Today, the last game day before it, This week. Until one is picked: today once its games have
  // started, else the last game day
  // ... This season (every game so far, added up) and Per game: everyone's average game, for finding anyone
  const opts = [P.today && ['today', 'Today'], P.day && ['day', P.day === yesterday ? 'Yesterday' : fmtDay(P.day)], P.week && ['week', 'This week'], P.year.length && ['year', 'This season'], ['avg', 'Per game']].filter(Boolean);
  const range = opts.some(([k]) => k === ui.perfRange) ? ui.perfRange : P.started || !P.day ? opts[0][0] : 'day';
  const avg = range === 'avg', weekly = range === 'week' || range === 'year'; // weekly: several days added up
  const dates = avg ? [] : range === 'year' ? P.year : range === 'week' ? P.week : [range === 'today' ? today : P.day];
  const day = dates[0];
  const updated = range === 'day' || avg ? '' : live.error ? ` · <span class="pos-bad">ESPN: ${esc(live.error)}</span>`
    : live.at ? ` · updated ${fmtTime(live.at)}` : '';
  const when = avg ? `${BASIS_LABELS[state.basis]} stats ${infoBtn('projection')}` : (weekly ? `${fmtDay(dates[0])} – ${fmtDay(dates[dates.length - 1])}` : `${day === yesterday ? 'Last night' : day === today ? 'Today' : ''} ${fmtDay(day)}`.trim()) + updated;
  const toggle = opts.length > 1 ? `<div class="seg seg-sm" role="group" aria-label="Show games from">${opts.map(([k, l]) => `<button type="button" class="${k === range ? 'on' : ''}" data-action="perf-range" data-range="${k}" aria-pressed="${k === range}">${l}</button>`).join('')}</div>` : '';

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
    if (tid) return `<span class="perf-owner">${esc(fxTeamName(tid))}</span> ${lineupBadge(id)}`;
    const raw = nbaById.get(id);
    return raw && raw.fx ? `<span class="badge good">${FX_STATUS[raw.fx.st] || 'Free agent'}</span>` : '';
  };

  const pts = leaguePoints();
  // an average starter's games over these days (the season: every day since opening night; Per game: one)
  const span = range === 'year' ? Math.round((Date.parse(today) - Date.parse(dates[0])) / 864e5) + 1 : dates.length;
  const expected = weekly ? WEEK_GAMES * span / 7 : 1;
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
    : avg ? "Categories won by his average game: what it adds to winning a week's categories, against not playing"
    : `Categories won: what ${weekly ? 'his games' : 'the game'} added to winning a week's categories, against not playing (an even matchup). Below 0: his team would have done better without ${weekly ? 'them' : 'it'}`);

  // everyone who played, ranked by value; the column sorted on picks which 50 show (Value ↑ for the worst)
  const rows = avg ? seasonRows() : perfRows(dates);
  // every range, among everyone in it: 🚀 the best in each category and 🔥 the second best (as many as 3 tied),
  // 🧊 the worst shooting and 🧈 the most turnovers. Shooting by what it added (makes over the league's average, so
  // volume counts), everything else by the number. Per game only counts regulars (3+ games, 15+ minutes a game).
  const badges = new Map();
  {
    const night = range === 'avg' ? 'per game' : range === 'year' ? 'this season' : range === 'week' ? 'this week'
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
  // search, then pill buttons: position and NBA team (menus dressed as pills), only rookies, only injured; then
  // the fantasy teams and where players are
  const menu = (action, label, val, opts) => `<select class="pill pill-menu${val ? ' on' : ''}" data-change="${action}" aria-label="${label}"><option value="">${label === 'Position' ? 'All positions' : 'All teams'}</option>${opts.map(x => `<option ${val === x ? 'selected' : ''}>${x}</option>`).join('')}</select>`;
  const only = (k, l, title) => `<button type="button" class="pill${ui.perfOnly[k] ? ' on' : ''}" data-action="perf-only" data-key="${k}" aria-pressed="${!!ui.perfOnly[k]}" title="${title}">${l}</button>`;
  const find = `<input id="perfQ" class="perf-q" type="search" placeholder="Find a player" aria-label="Find a player" value="${esc(ui.perfQ)}" data-input="perf-q" autocomplete="off">
    <div class="perf-filters" role="group" aria-label="Narrow the list">${menu('perf-pos', 'Position', ui.perfPos, POSITIONS)}${menu('perf-team', `${SPORT.name} team`, ui.perfTeam, [...new Set(NBA.players.map(p => p.team).filter(Boolean))].sort())}${only('rookie', 'Rookies', 'Only first-year players')}${only('inj', 'Injured', 'Only players on the injury report')}</div>`;
  const filters = find + (!owner.size || !rows.length ? '' : `<div class="perf-filters" role="group" aria-label="Show players">${teams.map(pill).join('')}<span class="pf-sep" aria-hidden="true"></span>${where.map(pill).join('')}</div>`);
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
  const sig = [range, dates.join(), so.key, so.dir, JSON.stringify(ui.perfShow), mine, ui.perfQ, ui.perfPos, ui.perfTeam, JSON.stringify(ui.perfOnly)].join('|');
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
      <thead><tr>${th('name', 'Player', 'pf-name')}${cats.map(c => th(c.key, c.label, 'sc')).join('')}${th('v', pts ? 'FP' : 'Value', 'num pf-v')}</tr></thead>
      <tbody>${shown.map(r => `<tr class="${teamOf(r) === 'me' ? 'pf-me' : teamOf(r) === 'opp' ? 'pf-opp' : ''}">
        <td class="pf-name"${teamOf(r) === 'me' ? ' title="Your team"' : teamOf(r) === 'opp' ? ` title="Opponent: ${esc(opp.name)}"` : ''}><div class="bplayer"><span class="perf-rank">${rank.get(r)}</span>${headshot({ nbaId: r.raw.id, name: r.raw.name }, 28)}<div class="bmain">
          <div class="bname"><button class="link-btn pname" data-action="player-detail" data-nba="${r.raw.id}">${esc(r.raw.name)}</button></div>
          <div class="pmeta">${avg ? `${r.g} GP · ` : weekly ? `${r.on ? '<span class="lv-dot" aria-hidden="true"></span>' : ''}${r.g} G · ` : day === today && liveStatus(r.raw, day) ? `${liveStatus(r.raw, day)} · ` : ''}${Math.round(r.tot.min || 0)} min${avg ? '/g' : ''} · ${who(r.raw.id)}</div></div></div></td>
        ${cats.map(c => cell(r, c)).join('')}
        <td class="num pf-v" style="${valShade(r)}" data-tip="${valTip}">${pts ? fmt(r.v, 1) : signed(r.v, 2)}</td>
      </tr>`).join('')}</tbody>
    </table></div>${legend}`;
  return card(toggle, `<p class="muted small perf-when">${when}${rows.length ? ` · ${count}` : ''}</p>${filters}${table}`);
}

function newsCard() {
  const mine = state.players.filter(p => p.inj);
  mine.sort((a, b) => (b.inj.date || '').localeCompare(a.inj.date || ''));
  const out = mine.filter(p => p.inj.status === 'Out').length;
  const body = mine.length ? `<ul class="alerts">${mine.slice(0, 6).map(p => `<li class="alert ${p.inj.status === 'Out' ? 'bad' : 'warn'}">${headshot(p, 32)}<span class="grow"><b>${esc(p.name)}</b> <span class="badge ${p.inj.status === 'Out' ? 'bad' : 'warn'}">${esc(p.inj.label)}</span><br><span class="small">${esc(p.inj.note)}</span> <span class="muted small">${p.inj.date ? fmtDay(p.inj.date) : ''}</span></span></li>`).join('')}</ul>`
    : `<p class="muted small" style="margin:0">${NBA ? 'None of your players are on the injury report.' : 'Injury news appears here when live NBA data is available.'}</p>`;
  const sub = !NBA ? 'when NBA data is available' : !mine.length ? 'none of your players' : `${mine.length} of your players${out ? ` · ${out} out` : ''}`;
  return dashFold('news', 'Injury news', sub, `${body}<p class="muted small df-src">Your players · from ESPN</p>`, mine.length ? (out ? 'bad' : 'warn') : '');
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
  if (!weeks) return dashFold('moves', title, 'loading…', `<p class="muted small" style="margin:0">Loading last week's rosters…</p>`);
  const moves = periodMoves(L, weeks);
  if (!moves) return '';
  const me = ui.viewing ? ui.viewA : state.fxTeam;
  const order = { add: 0, trade: 1, away: 2, drop: 3 };
  const tids = Object.keys(moves).sort((a, b) => (b === me) - (a === me) || moves[b].length - moves[a].length);
  const at = (readLeagueCache()[L.id] || {}).at;
  const move = m => `<li class="mv mv-${m.kind}"><span class="mv-k" aria-hidden="true">${m.kind === 'add' ? '+' : m.kind === 'drop' ? '−' : '⇄'}</span>${m.nba ? inlinePlayer({ nbaId: m.nba, name: m.name }, `<button type="button" class="link-btn pname" data-action="player-detail" data-nba="${m.nba}">${esc(m.name)}</button>`) : esc(m.name)}${m.kind === 'trade' ? ` <span class="muted small">from ${esc(fxTeamName(m.from))}</span>` : m.kind === 'away' ? ` <span class="muted small">to ${esc(fxTeamName(m.to))}</span>` : ''}<span class="sr-only">${m.kind === 'add' ? 'added' : m.kind === 'drop' ? 'dropped' : m.kind === 'trade' ? 'traded for' : 'traded away'}</span></li>`;
  const body = tids.length ? `<div class="mv-teams">${tids.map(tid => `<div class="mv-team${tid === me ? ' me' : ''}"><div class="mv-name">${esc(fxTeamName(tid))}</div>
      <ul class="mv-list">${[...moves[tid]].sort((a, b) => order[a.kind] - order[b.kind]).map(move).join('')}</ul></div>`).join('')}</div>`
    : '<p class="muted small" style="margin:0">No adds or drops since last week.</p>';
  // the line: how many adds and drops (a trade counts once), and yours
  const all = Object.values(moves).flat().filter(m => m.kind !== 'away'), n = all.length;
  const mineM = !ui.viewing && moves[me] ? moves[me] : [], cnt = k => mineM.filter(m => m.kind === k).length;
  const yours = [cnt('add') && `+${cnt('add')}`, cnt('trade') && `⇄${cnt('trade')}`, cnt('drop') && `−${cnt('drop')}`].filter(Boolean).join(' ');
  const sub = !n ? 'no adds or drops this week' : `${yours ? `you ${yours} · ` : ''}${n} move${n === 1 ? '' : 's'} this week`;
  return dashFold('moves', title, sub, `${body}${at ? `<p class="muted small mv-when">Week ${L.rosterPeriod} · rosters as of ${fmtTime(at, { weekday: 'short' })} · ↻ Reload in ⚙ for the latest</p>` : ''}`);
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
  return `${SPORT.tableStats.map(([k], i) => `<td class="num">${fmt(p[k] || 0, i ? 1 : 0)}</td>`).join('')}
    ${SPORT.tablePct.map(([, , m, a]) => `<td class="num">${fmtPct(p[a] ? statVal(p, m) / p[a] : 0)}</td>`).join('')}<td class="num"><b>${fmtValue(value(p))}</b></td>`;
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
  const head = `<div class="card-head"><h2>Season totals ${infoBtn('totals')}</h2><span class="muted small">from each ${leagueLineupMode(L) === 'daily' ? "day's" : "week's"} starting lineups</span></div>`;
  const note = msg => `<div class="card" style="margin-top:16px">${head}<p class="muted small" style="margin:0">${msg}</p></div>`;
  let teams;
  if (seasonCtx) {
    // a past season: its weekly lineups and its game log (loaded the first time it's needed)
    if (!L.weeks) return note("Fantrax didn't return this season's weekly rosters.");
    if (!L.season || !(L.season in gameLogs)) {
      if (L.season) loadGameLog(L.season).then(() => { if (ui.tab === 'standings' && ui.season) render(); });
      return L.season ? note('Loading the season’s games…') : note(`No ${SPORT.name} game logs are saved for this season.`);
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

/* ---------- NBA players ---------- */
function viewPlayers() {
  if (!NBA) {
    return `<div class="card"><div class="empty"><strong>Loading player data…</strong>If this doesn't load, the data file is missing. Run <code>python scripts/update_data.py</code> and reload.</div></div>`;
  }
  // the latest games come from the box scores, loaded on first need; today's as they're played
  if (!BOX) loadBoxes().then(() => { if (ui.tab === 'players') render(); }).catch(() => {});
  startLive();
  if (!fxLeague()) { // browsing without a league
    return `<div class="sample-banner browse-note"><span>No league connected: values are for a standard 9-category league.</span><button type="button" class="btn sm" data-action="browse-exit">Connect a league</button></div>
  ${topPerformancesCard()}`;
  }
  return `
  ${topPerformancesCard()}
  ${ui.viewing ? '' : recommendedCard()}`;
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
  const dropWins = drop && w ? catWins(drop) : null;
  const helps = p => { if (!dropWins) return []; const pw = catWins(p); return scoreCats().filter(c => (pw[c.key] || 0) - (dropWins[c.key] || 0) > 0.01).map(c => c.label); };
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
    return `<p class="pc-owner"><b>${esc(fxTeamName(tid))}</b> <span class="badge ${x.st === 'ACTIVE' ? 'active' : x.st === 'INJURED_RESERVE' ? 'bad' : 'bench'}">${x.st === 'ACTIVE' ? 'Active' : x.st === 'INJURED_RESERVE' ? 'IR' : 'Bench'}</span>${how ? `<span class="pc-how muted">${esc(how)}</span>` : ''}</p>`;
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
      <div class="detail-id">${headshot({ nbaId: raw.id, name: raw.name }, 64)}<div><h2>${esc(raw.name)}</h2><p class="muted" style="margin:2px 0 0">${esc(raw.team)}${raw.jersey ? ' · #' + esc(raw.jersey) : ''} · ${posTags(raw.pos)}${raw.born ? ` · age ${Math.floor((Date.now() - Date.parse(raw.born + 'T12:00:00')) / (365.25 * 864e5))}` : ''}${flag(raw.nat)} · ${raw.exp ? raw.exp + ' yrs in league' : 'Rookie'}</p>${cardOwner(raw)}</div></div>
      <div>${raw.inj ? `<span class="badge ${raw.inj.status === 'Out' ? 'bad' : 'warn'}">${esc(raw.inj.label)}</span>` : '<span class="badge good">Healthy</span>'}</div>
    </div>
    ${raw.inj ? `<div class="alert ${raw.inj.status === 'Out' ? 'bad' : 'warn'}" style="margin-top:12px"><span class="dot"></span><span class="grow small">${esc(raw.inj.note)} <span class="muted">${raw.inj.date ? fmtDay(raw.inj.date) : ''} · ESPN</span></span></div>` : ''}
    <div class="proj-grid" style="margin-top:12px">
      <div class="proj"><div class="k">Next game</div><div class="v">${t && t.next ? nextGame(t.next) : '—'}</div>${isGoalie(raw) && t && t.next ? `<div class="pc-rank">${startWords(raw, t.next.date)}</div>` : ''}</div>
      ${isGoalie(raw) ? `<div class="proj" data-tip="${esc("From his share of his team's recent starts, and who played the night before")}"><div class="k">Starts left this week</div><div class="v">${t ? `about ${fmt(raw.inj && raw.inj.status === 'Out' ? 0 : expectedGames({ ...raw, nbaId: raw.id }, matchDates(weekStartAt(0)).filter(d => d >= todayIso() && !gameFinal(raw, d))), 1)}` : '—'}</div><div class="pc-rank">${t ? `of ${t.left} games` : ''}</div></div>`
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
  if (!d.open) d.showModal();
}
