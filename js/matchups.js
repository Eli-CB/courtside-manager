// Courtside Manager: Matchups: the matchup projector, lineup boards and stat tables.
// The site loads js/*.js in order (see index.html); they share one scope, like one file.
'use strict';

/* ---------- Matchups (matchup projector) ---------- */
function oddsLabel(p) {
  return p >= 0.9 ? ['Locked', 'good'] : p >= 0.7 ? ['Likely win', 'good'] : p >= 0.55 ? ['Lean win', 'good'] : p > 0.45 ? ['Toss-up', ''] : p > 0.3 ? ['Lean loss', 'bad'] : p > 0.1 ? ['Likely loss', 'bad'] : ['Punt', 'bad'];
}

function fmtCat(c, v) { return c.pct ? fmtPct(v) : fmt(v, 0); }

// Everything the week page (and pickup ideas) needs, computed once per render
function weekContext(start = weekStart()) {
  const dates = matchDates(start);
  const weekly = state.lineupMode === 'weekly';
  const mine = state.players.filter(p => !state.il.includes(p.id));
  const opp = state.opp.players;
  const hasOpp = opp.length > 0;
  const setIds = new Set(state.lineup.filter(Boolean));
  const oppIds = weekly ? oppStarterIds(dates) : null;
  const them = projectSide(opp, dates, oppIds);
  const asSet = projectSide(mine, dates, setIds);
  const locked = weekly && new Date() >= lockTime(start);
  const bestIds = weekly && !locked ? bestWeeklyIds(mine, dates, hasOpp ? them : null) : null;
  const best = weekly && !bestIds ? asSet : projectSide(mine, dates, bestIds);
  const catsSet = compareCats(asSet, them), catsBest = compareCats(best, them);
  return { start, dates, weekly, locked, mine, opp, hasOpp, setIds, oppIds, them, asSet, bestIds, best, catsSet, catsBest, oSet: matchOdds(catsSet), oBest: matchOdds(catsBest) };
}

function catValue(proj, c) {
  if (c.fp) return fpTotals(proj).a;
  if (!c.pct) return totStat(proj, c.key);
  return proj.tot[c.att] ? proj.tot[c.made] / proj.tot[c.att] : 0;
}
const fmtCatDelta = (c, d) => (c.pct ? (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(3).replace(/^0/, '') : signed(d, Math.abs(d) < 10 ? 1 : 0));
const pctTxt = p => `${Math.round(p * 100)}%`;
// a change in the matchup goal: categories won, or projected fantasy points
const goalDelta = v => (isPoints() ? `${signed(v, 1)} FP` : `${signed(v, 2)} cats`);
const weekGames = (p, dates) => (p.status === 'Out' ? 0 : gamesIn(p, dates));
function gamesLeftTip(p, dates) {
  const played = dates.filter(d => playsOn(p, d) && gameFinal(p, d) && actualLine(p, d)).length;
  const left = dates.filter(d => playsOn(p, d) && !gameFinal(p, d)).length;
  return `${played} played, ${p.status === 'Out' ? 0 : left} left this week`;
}

// What changes, category by category, when your starters go from fromIds to toIds
function explainChange(ctx, fromIds, toIds, outP, inP) {
  const a = projectSide(ctx.mine, ctx.dates, fromIds), b = projectSide(ctx.mine, ctx.dates, toIds);
  const ca = compareCats(a, ctx.them), cb = compareCats(b, ctx.them);
  const oa = matchOdds(ca), ob = matchOdds(cb);
  const rows = ca.map((c, i) => {
    const d = catValue(b, c) - catValue(a, c);
    return { c, d, good: c.neg ? d < 0 : d > 0, pA: ca[i].p, pB: cb[i].p };
  });
  const score = ctx.hasOpp ? objective(ob) - objective(oa)
    : (inP ? weeklyPriority(inP, ctx.dates) : 0) - (outP ? weeklyPriority(outP, ctx.dates) : 0);
  return { outP, inP, toIds, rows, score, dExp: ob.expected - oa.expected, dWin: ob.win - oa.win, dGames: b.games - a.games };
}

// Break the suggested lineup into one-for-one swaps, best first
function pairSwaps(ctx) {
  if (!ctx.bestIds) return { steps: [], rest: null };
  let cur = new Set(ctx.setIds);
  const steps = [];
  for (let guard = 0; guard < 10; guard++) {
    const ins = [...ctx.bestIds].filter(id => !cur.has(id));
    if (!ins.length) break;
    const outs = [...cur].filter(id => !ctx.bestIds.has(id));
    let pick = null;
    for (const inId of ins) {
      const options = [...outs];
      if (cur.size < state.slots.length) options.push(null); // fill an empty slot
      for (const outId of options) {
        const trial = new Set(cur);
        if (outId) trial.delete(outId);
        trial.add(inId);
        if (!fitsSlots(trial, ctx.mine)) continue;
        const ex = explainChange(ctx, cur, trial, outId ? byId(outId) : null, byId(inId));
        if (!pick || ex.score > pick.score) pick = ex;
      }
    }
    if (!pick) break;
    steps.push(pick);
    cur = pick.toIds;
  }
  const done = [...ctx.bestIds].every(id => cur.has(id)) && cur.size === ctx.bestIds.size;
  return { steps, rest: done ? null : explainChange(ctx, cur, ctx.bestIds, null, null) };
}

// Next-best single swaps from the suggested lineup, so you can see why they lost out
function nearMisses(ctx, base) {
  const out = [];
  for (const b of ctx.mine) {
    if (base.has(b.id) || b.status === 'Out' || !gamesIn(b, ctx.dates)) continue;
    let bestFor = null;
    for (const sId of base) {
      const trial = new Set(base); trial.delete(sId); trial.add(b.id);
      if (!fitsSlots(trial, ctx.mine)) continue;
      const ex = explainChange(ctx, base, trial, byId(sId), b);
      if (!bestFor || ex.score > bestFor.score) bestFor = ex;
    }
    if (bestFor) out.push(bestFor);
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 3);
}

function whySentence(ex, ctx) {
  const parts = [];
  const gi = ex.inP ? weekGames(ex.inP, ctx.dates) : 0, go = ex.outP ? weekGames(ex.outP, ctx.dates) : 0;
  const inN = ex.inP ? esc(lastName(ex.inP.name)) : '', outN = ex.outP ? esc(lastName(ex.outP.name)) : '';
  if (ex.inP && ex.outP) {
    parts.push(gi > go ? `${inN} plays ${gi} games to ${outN}'s ${go}.` : gi === go ? `Both play ${gi} games, so it comes down to fit.` : `${inN} plays fewer games (${gi} vs ${go}) but helps where this matchup is close.`);
  } else if (ex.inP) parts.push(`Fills an open slot with ${gi} more games.`);
  if (ctx.hasOpp && isPoints()) {
    const fp = ex.rows.find(r => r.c.fp);
    if (fp) parts.push(`${signed(fp.d, 1)} projected points, ${pctTxt(fp.pA)}→${pctTxt(fp.pB)} to win.`);
  } else if (ctx.hasOpp) {
    const lifts = ex.rows.filter(r => r.pB - r.pA > 0.015).sort((x, y) => (y.pB - y.pA) - (x.pB - x.pA)).slice(0, 3);
    const costs = ex.rows.filter(r => r.pA - r.pB > 0.015).sort((x, y) => (y.pA - y.pB) - (x.pA - x.pB)).slice(0, 2);
    if (lifts.length) parts.push(`Biggest lift: ${lifts.map(r => `${r.c.label} ${pctTxt(r.pA)}→${pctTxt(r.pB)}`).join(', ')}.`);
    if (costs.length) parts.push(`Costs: ${costs.map(r => `${r.c.label} ${pctTxt(r.pA)}→${pctTxt(r.pB)}${r.pB >= 0.7 ? ' (still safe)' : r.pB <= 0.3 ? ' (likely lost anyway)' : ''}`).join(', ')}.`);
    if (!costs.length && lifts.length) parts.push('No category gets worse in a way that matters.');
  }
  return parts.join(' ');
}

function catChips(ex) {
  return `<div class="cat-chips">${ex.rows.map(r => {
    // in points leagues only total points decide the week, so only FP shows a win chance
    const moved = Math.abs(r.pB - r.pA) >= 0.01 && (!isPoints() || r.c.fp);
    const cls = Math.abs(r.d) < 1e-6 ? '' : r.good ? 'good' : 'bad';
    return `<span class="cchip ${cls}"><b>${r.c.label}</b> ${fmtCatDelta(r.c, r.d)}${moved ? `<span class="cchip-p">${pctTxt(r.pA)}→${pctTxt(r.pB)}</span>` : ''}</span>`;
  }).join('')}</div>`;
}

function swapBlock(ex, ctx, kind) {
  const g = p => `<span class="muted small">${posTags(p.pos)} · ${weekGames(p, ctx.dates)} G</span>`;
  const net = ctx.hasOpp
    ? `<span class="swap-net ${ex.score >= 0 ? 'pos-good' : 'pos-bad'}">${isPoints() || matchupScoring() === 'most' ? `${signed(ex.dWin * 100, 1)}% win · ${goalDelta(ex.dExp)}` : `${signed(ex.dExp, 2)} cats · ${signed(ex.dWin * 100, 1)}% win`}</span>`
    : `<span class="swap-net ${ex.dGames >= 0 ? 'pos-good' : 'pos-bad'}">${signed(ex.dGames, 0)} games</span>`;
  const head = ex.inP
    ? `<span class="swap-in">↑ Start <b>${esc(ex.inP.name)}</b> ${g(ex.inP)}</span>${ex.outP ? `<span class="swap-out">↓ Bench <b>${esc(ex.outP.name)}</b> ${g(ex.outP)}</span>` : ''}`
    : '<span class="swap-in">Other moves needed to fit everyone into slots</span>';
  return `<div class="swap ${kind}"><div class="swap-head">${head}${net}</div>${catChips(ex)}<p class="small swap-why">${whySentence(ex, ctx)}</p></div>`;
}

// Either night of a back-to-back (the team also plays the day before or after)
const isB2B = (p, d) => playsOn(p, d) && (playsOn(p, addDays(d, -1)) || playsOn(p, addDays(d, 1)));

// A played game well under his usual minutes, and the likely reason: an injury (he's been on the injury
// report since that game), a blowout, foul trouble, or unknown. Null for a normal game.
function shortMinutes(p, line, d) {
  const usual = p.min || 0;
  if (usual < 20 || line.min > usual * 0.7 || usual - line.min < 8) return null;
  const why = [];
  if (p.inj && p.inj.date && p.inj.date >= d) {
    const note = p.inj.note ? `: ${p.inj.note.length > 90 ? p.inj.note.slice(0, 90) + '…' : p.inj.note}` : '';
    why.push(`injury (listed ${p.inj.label} since ${fmtDay(p.inj.date)}${note})`);
  }
  if (Math.abs(line.margin) >= 20) why.push(`blowout (${line.margin > 0 ? 'won' : 'lost'} by ${Math.abs(line.margin)})`);
  if (line.pf >= 5) why.push(`foul trouble (${line.pf} fouls)`);
  return why.length ? why.join(' and ') : "fewer minutes than usual, with no blowout, foul trouble or injury report (maybe the coach's call)";
}

// A played game's box score for the tooltip: minutes, the stat line, shooting, and fantasy points in points leagues
function gameTip(p, line, d, bench) {
  const short = shortMinutes(p, line, d);
  return `<div class="tip-head">${Math.round(line.min)} min${bench ? ' <span class="tip-tag">bench, didn\'t count</span>' : ''}</div>
    <div>${line.pts} PTS · ${line.reb} REB · ${line.ast} AST</div>
    <div>${line.stl} STL · ${line.blk} BLK · ${line.tpm} 3PM · ${line.to} TO</div>
    <div class="tip-dim">${line.fgm}-${line.fga} FG · ${line.ftm}-${line.fta} FT</div>
    ${isPoints() ? `<div class="tip-head">${fmt(lineFp(line), 1)} FP</div>` : ''}
    ${short ? `<div class="tip-warn">Usually ${Math.round(p.min)} min: ${esc(short)}</div>` : ''}`;
}

function dayDots(p, ctx, counts) {
  const dot = (cls, tip) => `<i class="${cls}" data-tip="${esc(tip)}"></i>`;
  return `<span class="dots">${ctx.dates.map(d => {
    if (!playsOn(p, d)) return dot('none', 'No game');
    const bench = counts ? '' : ' bench';
    if (gameFinal(p, d)) {
      const line = actualLine(p, d);
      if (!line) return dot('dnp', "His team played, but he didn't");
      return dot(`done${bench}${shortMinutes(p, line, d) ? ' short' : ''}`, gameTip(p, line, d, bench));
    }
    if (p.status === 'Out') return dot('out', `Upcoming, but he's listed Out${p.inj && p.inj.note ? `<div class="tip-dim">${esc(p.inj.note)}</div>` : ''}`);
    const b2b = isB2B(p, d);
    return dot(`up${bench}${b2b ? ' b2b' : ''}`, `Upcoming game${b2b ? ', on a back-to-back' : ''}${bench ? '<div class="tip-dim">On the bench, so it won\'t count</div>' : ''}`);
  }).join('')}</span>`;
}

// ----- Tooltips: any element with data-tip (trusted HTML) shows a readable box on hover, focus or tap -----
const tipEl = $('#tip');
function showTip(el) {
  tipEl.innerHTML = el.dataset.tip;
  tipEl.hidden = false;
  const r = el.getBoundingClientRect(), t = tipEl.getBoundingClientRect();
  const left = Math.max(8, Math.min(window.innerWidth - t.width - 8, r.left + r.width / 2 - t.width / 2));
  const above = r.top - t.height - 8;
  tipEl.style.left = `${left}px`;
  tipEl.style.top = `${above >= 8 ? above : r.bottom + 8}px`;
}
const hideTip = () => { tipEl.hidden = true; };
document.addEventListener('mouseover', e => { const el = e.target.closest('[data-tip]'); if (el) showTip(el); else if (!tipEl.hidden) hideTip(); });
document.addEventListener('focusin', e => { const el = e.target.closest('[data-tip]'); if (el) showTip(el); });
document.addEventListener('click', e => { const el = e.target.closest('[data-tip]'); if (el) showTip(el); else hideTip(); }, true);
window.addEventListener('scroll', hideTip, { passive: true });

// ----- Lineups board views: schedule dots, or category stats shaded by contribution -----
const BOARD_KEY = 'courtside-board';
ui.boardMode = (() => { try { return localStorage.getItem(BOARD_KEY) || 'sched'; } catch (e) { return 'sched'; } })();

// Smooth shading: strength grows with the size of the contribution, so close values look alike
function shade(z) {
  if (!Number.isFinite(z) || Math.abs(z) < 0.2) return '';
  const pct = Math.round(Math.min(Math.abs(z) / 2.5, 1) * 50);
  return `background: color-mix(in srgb, var(${z > 0 ? '--good' : '--bad'}) ${pct}%, transparent);${Math.abs(z) >= 1.5 ? ' font-weight: 700;' : ''}`;
}
const shadeProb = p => shade((p - 0.5) * 5); // 90% to win ≈ as strong as a +2 contribution

// How much a player helps (+) or hurts (−) a category. Per game: vs an average rostered
// player. Week total: the player's weekly number vs an average starter's week (~3.5 games),
// so the same weekly total always gets the same shade. FG%/FT% count shot volume.
const WEEK_GAMES = 3.5;
function contribZ(p, key, g, week) {
  if (key === 'fp') {
    const [m, sd] = fpBase();
    return week ? (fantasyPoints(p) * g - m * WEEK_GAMES) / (sd * WEEK_GAMES) : (fantasyPoints(p) - m) / sd;
  }
  if (!BASE[key]) return 0;
  if (!week) return catZ(p)[key] || 0;
  const c = scoreCats().find(x => x.key === key) || catDef(key);
  if (c.pct) { const att = statVal(p, c.att); return att ? (pctOf(p, c) - BASE[key][0]) * att * g / (BASE[key][1] * WEEK_GAMES) : 0; }
  const z = (statVal(p, key) * g - BASE[key][0] * WEEK_GAMES) / (BASE[key][1] * WEEK_GAMES);
  return c.neg ? -z : z;
}

function boardModes() {
  const opts = [['sched', 'Schedule'], ['game', 'Per game'], ['week', 'Week total']];
  return `<div class="seg seg-sm" role="group" aria-label="Lineup view">${opts.map(([k, l]) => `<button type="button" class="${ui.boardMode === k ? 'on' : ''}" data-action="board-mode" data-mode="${k}" aria-pressed="${ui.boardMode === k}">${l}</button>`).join('')}</div>`;
}

// How many active NBA players share each short form of a name, so short names never hide who's who
const nameUses = new Map();
function countNames() {
  nameUses.clear();
  const bump = k => nameUses.set(k, (nameUses.get(k) || 0) + 1);
  for (const raw of NBA.players) { bump('s:' + normName(lastName(raw.name, true))); bump('i:' + normName(shortName(raw.name, true))); }
}
const clashes = (kind, short) => (nameUses.get(kind + normName(short)) || 0) > 1;

// Surname without suffixes: "Trey Murphy III" -> "Murphy". Shared surnames get the initial
// ("D. Murray", "J. Murray"), and the full name if that's shared too.
function lastName(name, plain) {
  const parts = String(name).split(' ').filter(w => !/^(jr\.?|sr\.?|ii|iii|iv|v)$/i.test(w));
  const last = parts[parts.length - 1] || String(name);
  if (plain || !clashes('s:', last)) return last;
  const init = parts.length > 1 ? `${parts[0][0]}. ${last}` : last;
  return clashes('i:', shortName(name, true)) ? String(name) : init;
}

// "Jaime Jaquez Jr." -> "J. Jaquez Jr." for tight spaces on phones; the full name if another player shortens the same way
function shortName(name, plain) {
  const parts = String(name).split(' ');
  const short = parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(' ')}` : String(name);
  return plain || !clashes('i:', short) ? short : String(name);
}

function playerName(p) {
  const label = `<span class="n-full">${esc(p.name)}</span><span class="n-short">${esc(shortName(p.name))}</span>`;
  return p.nbaId ? `<button class="link-btn pname" data-action="player-detail" data-nba="${p.nbaId}" title="${esc(p.name)}">${label}</button>` : `<span class="pname">${label}</span>`;
}

// ↑ Start / ↓ Bench hints on your players
function rowTags(p, ctx, side, starter) {
  if (side === 'me') {
    if (!ctx.bestIds) return '';
    if (starter && !ctx.bestIds.has(p.id)) return '<span class="tag down">↓ Bench</span>';
    if (!starter && ctx.bestIds.has(p.id)) return '<span class="tag up">↑ Start</span>';
    return '';
  }
  return '';
}

// Schedule view: one cell per player, slot-aligned with the opponent
function boardCell(p, ctx, side, starter) {
  if (!p) return `<td class="bcell"><span class="muted small">${side === 'them' && !ctx.hasOpp ? '' : 'Empty'}</span></td>`;
  const tags = rowTags(p, ctx, side, starter);
  return `<td class="bcell${starter ? '' : ' bench'}"><div class="bplayer">${headshot(p, matchMedia('(max-width: 640px)').matches ? 22 : 28)}<div class="bmain"><div class="bname">${playerName(p)}${p.status !== 'Healthy' ? ' ' + statusBadge(p) : ''}${tags ? ' ' + tags : ''}</div>
    <div class="bmeta"><span class="bmeta-info">${teamLogo(p.team)} ${posTags(p.pos)}</span>${dayDots(p, ctx, starter)}<b class="bmeta-g" data-tip="${esc(gamesLeftTip(p, ctx.dates))}">${weekGames(p, ctx.dates)}G</b></div></div></div></td>`;
}

// ----- Per game / Week total: two sortable stat tables side by side -----
ui.statSort = { key: 'slot', dir: 1 };

function statSortValue(p, ctx, key) {
  const g = weekGames(p, ctx.dates);
  if (key === 'name') return p.name.toLowerCase();
  if (key === 'g') return g;
  // categories sort by contribution, so "best first" works for TO and the percentages too
  return contribZ(p, key, g, ui.boardMode === 'week');
}

function sortStatRows(list, ctx) {
  const { key, dir } = ui.statSort;
  if (key === 'slot') return list;
  return [...list].sort((a, b) => {
    const x = statSortValue(a, ctx, key), y = statSortValue(b, ctx, key);
    return (x < y ? -1 : x > y ? 1 : 0) * dir;
  });
}

// Hover text with the unrounded numbers behind a stat cell
function statTip(p, c, g, week) {
  const games = `${g} game${g === 1 ? '' : 's'}`;
  if (c.pct) {
    const [m, a] = [statVal(p, c.made), statVal(p, c.att)];
    const k = week ? g : 1;
    return `${c.label}: ${(pctOf(p, c) * 100).toFixed(1)}% · ${(m * k).toFixed(1)}/${(a * k).toFixed(1)} ${week ? `over ${games}` : 'per game'}`;
  }
  const v = statOf(p, c);
  return week ? `${c.label}: ${(v * g).toFixed(1)} (${v.toFixed(2)} × ${games})` : `${c.label}: ${v.toFixed(2)} per game`;
}

// Projected-week totals, unrounded, with the matching win chance
function totalTip(c, v, p, who) {
  const amount = c.pct ? `${(v * 100).toFixed(1)}%` : v.toFixed(1);
  return `${c.label}: ${amount} · ${pctTxt(p)} ${who}`;
}

function stabCells(p, ctx) {
  const g = weekGames(p, ctx.dates);
  const week = ui.boardMode === 'week';
  const noStats = !p.min && !p.pts && !p.reb; // e.g. a player with no NBA stats on record
  return scoreCats().map(c => {
    const none = noStats || (week && !g);
    const v = none ? '—' : c.pct ? fmtPct(pctOf(p, c)) : fmt(statOf(p, c) * (week ? g : 1), c.dec && !week ? c.dec : week ? (c.dec ? 1 : 0) : 1);
    return `<td class="sc" style="${none ? '' : shade(contribZ(p, c.key, g, week))}" title="${none ? `${c.label}: no projection` : statTip(p, c, g, week)}">${v}</td>`;
  }).join('');
}

function statRow(p, ctx, side, starter) {
  // opponent start/bench/remove buttons stay on the Schedule view to keep these tables clean
  const tags = side === 'me' ? rowTags(p, ctx, side, starter) : '';
  return `<tr class="${starter ? '' : 'bench'}"><td class="st-name"><div class="bplayer">${headshot(p, 24)}<div class="bmain"><div class="bname">${playerName(p)}${p.status !== 'Healthy' ? ' ' + statusBadge(p) : ''}${tags ? ' ' + tags : ''}</div></div></div></td>
    <td class="num st-g">${weekGames(p, ctx.dates)}</td>${stabCells(p, ctx)}</tr>`;
}

function statTable(ctx, side, title, rows, { bench = false, totals = '', games = 0 } = {}) {
  const s = ui.statSort;
  const th = (key, label, cls = '') => sortTh('stat-sort', key, label, s, { cls, down: s.dir < 0, arrow: key !== 'slot' });
  return `<table class="stab">
    <thead><tr>${th('name', bench ? `${esc(title)} <span class="muted">bench</span>` : esc(title), 'st-name')}${th('g', 'G', 'num')}${scoreCats().map(c => th(c.key, c.label, 'sc')).join('')}</tr></thead>
    <tbody>${sortStatRows(rows, ctx).map(p => statRow(p, ctx, side, !bench)).join('') || `<tr><td colspan="11" class="muted small">${bench ? 'Nobody on the bench' : side === 'them' ? 'No opponent loaded' : 'No starters'}</td></tr>`}</tbody>
    ${totals ? `<tfoot><tr><td class="st-name"><b>Projected week</b></td><td class="num st-g"><b>${games}</b></td>${totals}</tr></tfoot>` : ''}
  </table>`;
}

function statsBoard(ctx, myStarters, myBench, oppStarters, oppBench) {
  const mine = ctx.hasOpp ? ctx.catsSet.map(c => `<td class="sc" style="${shadeProb(c.p)}" title="${totalTip(c, c.a, c.p, 'to win')}">${fmtCat(c, c.a)}</td>`).join('') : '';
  const theirs = ctx.hasOpp ? ctx.catsSet.map(c => `<td class="sc" style="${shadeProb(1 - c.p)}" title="${totalTip(c, c.b, 1 - c.p, 'for them')}">${fmtCat(c, c.b)}</td>`).join('') : '';
  const oppName = state.opp.name || 'Opponent';
  return `<div class="table-wrap"><div class="stat-boards">
    ${statTable(ctx, 'me', state.teamName, myStarters, { totals: mine, games: ctx.asSet.games })}
    ${statTable(ctx, 'them', oppName, oppStarters, { totals: theirs, games: ctx.them.games })}
  </div>
  <div class="stat-boards bench-boards">
    ${statTable(ctx, 'me', state.teamName, myBench, { bench: true })}
    ${ctx.hasOpp ? statTable(ctx, 'them', oppName, oppBench, { bench: true }) : '<div></div>'}
  </div></div>`;
}

function matchupBoard(ctx) {
  const mySlots = state.slots.map((_, i) => byId(state.lineup[i]));
  // weekly lineups: the starters the projection uses; daily: their lineup as set now (like yours), while
  // each day's best lineup is what's projected
  const oppOn = ctx.oppIds || new Set(Array.isArray(state.opp.starters) ? state.opp.starters : []);
  const oppStarters = ctx.opp.filter(p => oppOn.has(p.id)).sort((a, b) => value(b) - value(a));
  const oppSlotIds = fillSlots(oppStarters, state.slots);
  const oppById = new Map(ctx.opp.map(p => [p.id, p]));
  const prio = p => weeklyPriority(p, ctx.dates);
  const myBench = benchPlayers().sort((a, b) => prio(b) - prio(a));
  const oppBench = ctx.opp.filter(p => !oppOn.has(p.id)).sort((a, b) => prio(b) - prio(a));
  const sched = ui.boardMode === 'sched';
  const legend = sched
    ? ''
    : `<span class="sw zp2"></span> helps <span class="sw zn2"></span> hurts · click a column to sort${ui.statSort.key !== 'slot' ? ' · <button class="link-btn" data-action="stat-sort" data-key="slot">back to lineup order</button>' : ''}`;

  let body;
  if (sched) {
    const benchRows = Math.max(myBench.length, oppBench.length, ctx.hasOpp ? 0 : 1);
    const rows = state.slots.map((slot, i) => `<tr><th scope="row">${slotBadge(slot)}</th>${boardCell(mySlots[i], ctx, 'me', true)}${boardCell(oppById.get(oppSlotIds[i]), ctx, 'them', true)}</tr>`).join('');
    const bench = Array.from({ length: benchRows }, (_, i) => `<tr><th scope="row">${slotBadge('BN')}</th>${boardCell(myBench[i], ctx, 'me', false)}${boardCell(oppBench[i], ctx, 'them', false)}</tr>`).join('');
    const irRows = ilPlayers().map(p => `<tr><th scope="row">${slotBadge('IL')}</th>${boardCell(p, ctx, 'me', false)}<td class="bcell"></td></tr>`).join('');
    body = `<div class="table-wrap"><table class="board">
        <colgroup><col class="c-slot"><col><col></colgroup>
        <thead><tr><th></th><th>${esc(state.teamName)}</th><th>${esc(state.opp.name || 'Opponent')}</th></tr></thead>
        <tbody>${rows}
          <tr class="board-tot"><th scope="row"></th><td><b>${ctx.asSet.games}</b> starter games${ctx.bestIds && ctx.best.games !== ctx.asSet.games ? ` <span class="muted">(${ctx.best.games} suggested)</span>` : ''}</td><td>${ctx.hasOpp ? `<b>${ctx.them.games}</b> starter games` : ''}</td></tr>
          <tr class="board-sep"><td colspan="3">Bench</td></tr>${bench}${irRows}
        </tbody>
      </table></div>`;
  } else {
    body = statsBoard(ctx, mySlots.filter(Boolean), myBench, oppSlotIds.map(id => oppById.get(id)).filter(Boolean), oppBench);
  }
  return `
    <div class="card board-card">
      <div class="card-head"><h2>Lineups ${infoBtn(sched ? 'dots' : 'shading')}</h2>${boardModes()}</div>
      ${legend ? `<p class="muted small board-legend">${legend}</p>` : ''}
      ${body}
    </div>`;
}

function catCompareTable(ctx, changed) {
  return `<div class="table-wrap"><table class="cat-table">
    <thead><tr><th>Cat</th><th class="num">Them</th><th class="num">${changed ? 'As set' : 'You'}</th>${changed ? '<th class="num">Suggested</th>' : ''}<th>Win chance${changed ? ': now vs suggested' : ''}</th></tr></thead>
    <tbody>${ctx.catsBest.map((c, i) => {
      const s = ctx.catsSet[i];
      const [lbl, cls] = oddsLabel(c.p);
      const pct = Math.round(c.p * 100);
      const moved = changed && Math.abs(c.p - s.p) >= 0.01;
      const [, sCls] = oddsLabel(s.p);
      const bars = changed
        ? `<span class="pbars"><span class="pbar-row"><span class="pbar-k">Now</span><span class="pbar thin"><span class="asset" style="width:${Math.round(s.p * 100)}%"></span></span><span class="num small">${pctTxt(s.p)}</span></span>
           <span class="pbar-row"><span class="pbar-k">New</span><span class="pbar thin"><span class="${cls || 'mid'}" style="width:${pct}%"></span></span><span class="num small"><b>${pct}%</b></span></span></span>`
        : `<span class="pbar"><span class="${sCls || 'mid'}" style="width:${pct}%"></span></span><span class="num small"><b>${pct}%</b></span>`;
      return `<tr class="${moved ? 'moved' : ''}"><td><b>${c.label}</b></td><td class="num">${fmtCat(c, c.b)}</td><td class="num">${fmtCat(c, s.a)}</td>${changed ? `<td class="num">${fmtCat(c, c.a)}</td>` : ''}
        <td class="pbar-cell">${bars}<span class="badge ${cls}">${lbl}</span></td></tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

function lineupSection(ctx) {
  if (ctx.locked) return ''; // the matchup bar says so, with a way to plan next week
  const { steps, rest } = pairSwaps(ctx);
  const changed = steps.length > 0 || !!rest;
  const base = ctx.bestIds;
  const misses = nearMisses(ctx, base);
  const intro = !ctx.mine.length ? 'Add players to your roster first.'
    : !ctx.hasOpp ? 'Add your opponent to optimize for this matchup. Until then, suggestions just favor more games from better players.'
    : changed ? `Making ${steps.length === 1 ? 'this change' : 'these changes'} moves your win chance from <b>${pctTxt(ctx.oSet.win)}</b> to <b>${pctTxt(ctx.oBest.win)}</b> and your projected score from <b>${fmt(ctx.oSet.expected, isPoints() ? 0 : 1)}</b> to <b>${fmt(ctx.oBest.expected, isPoints() ? 0 : 1)}</b> ${isPoints() ? 'fantasy points' : 'categories'}.`
    : `Your lineup as set is the best one we found for this matchup (${pctTxt(ctx.oSet.win)} to win, ${fmt(ctx.oSet.expected, isPoints() ? 0 : 1)} projected ${isPoints() ? 'fantasy points' : 'categories'}).`;
  const swing = ctx.catsSet.filter(c => c.p > 0.1 && c.p < 0.9).map(c => c.label);
  const punt = ctx.catsSet.filter(c => c.p <= 0.1).map(c => c.label);
  const locked = ctx.catsSet.filter(c => c.p >= 0.9).map(c => c.label);
  const how = ctx.hasOpp && !isPoints() && (punt.length || locked.length)
    ? `<p class="small muted" style="margin:-6px 0 12px">${swing.length ? `Swing: <b>${swing.join(', ')}</b>` : 'No category is close'}${punt.length ? ` · Punt: <b>${punt.join(', ')}</b>` : ''}${locked.length ? ` · Locked: <b>${locked.join(', ')}</b>` : ''}</p>` : '';
  return `
    <div class="card">
      <div class="card-head"><h2>${ui.viewing ? `Best lineup for ${esc(state.teamName)}` : ui.weekShift === 1 ? 'Lineup for next week' : ui.weekShift ? 'Lineup for that week' : 'Lineup for this week'} ${infoBtn('suggest')}</h2>${changed && !ui.viewing ? '<button class="btn sm primary" data-action="apply-best">Use suggested lineup</button>' : ''}</div>
      <p class="small" style="margin:0 0 12px">${intro}</p>
      ${how}
      ${changed ? `<h3 class="sub">Suggested changes</h3>${steps.map(ex => swapBlock(ex, ctx, 'suggested')).join('')}${rest ? swapBlock(rest, ctx, 'suggested') : ''}` : ''}
      ${ctx.hasOpp && !isPoints() ? `<h3 class="sub" style="margin-top:16px">Categories ${infoBtn('win')}</h3>${catCompareTable(ctx, changed)}` : ''}
      ${misses.length ? `<h3 class="sub" style="margin-top:16px">Other swaps we checked</h3>${misses.map(ex => swapBlock(ex, ctx, 'miss')).join('')}` : ''}
    </div>`;
}

function pickupIdeas(ctx) {
  const { dates, them, oBest: baseOdds } = ctx;
  const mine = ctx.mine;
  if (!mine.length) return [];
  const weekly = ctx.weekly;
  const worth = p => (weekly ? weeklyPriority(p, dates) : value(p));
  const drop = mine.reduce((a, b) => (worth(a) <= worth(b) ? a : b));
  const taken = new Set([...state.players, ...state.opp.players].map(p => p.nbaId).filter(Boolean));
  const cands = nbaPlayers()
    .filter(x => !taken.has(x.nbaId) && x.gp && x.status !== 'Out' && gamesIn(x, dates) && (!fxLeague() || fxAvailable(nbaById.get(x.nbaId))))
    .sort((a, b) => b.val - a.val)
    .slice(0, 70);
  const out = [];
  for (const x of cands) {
    const p = playerFromRaw(nbaById.get(x.nbaId));
    const team = [...mine.filter(m => m !== drop), p];
    const proj = projectSide(team, dates, weekly ? bestWeeklyIds(team, dates, null) : null);
    const cats = compareCats(proj, them);
    const odds = matchOdds(cats);
    out.push({ p, drop, gain: odds.expected - baseOdds.expected, score: objective(odds) - objective(baseOdds), win: odds.win, games: gamesIn(p, dates), cats });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 5);
}

function pickupsCard() {
  if (!NBA) return '';
  const ctx = weekContext();
  if (!ctx.hasOpp) return '';
  const ideas = pickupIdeas(ctx).filter(x => x.score > 0.001);
  return `
    <div class="card">
      <div class="card-head"><h2>Pickup ideas for this week</h2><span class="muted small">vs ${esc(state.opp.name || 'your opponent')} · ${fxLeague() ? 'free agents and waivers in your league' : 'if available in your league'}</span></div>
      ${ideas.length ? `<ul class="alerts">${ideas.map(x => {
        const better = x.cats.filter((c, i) => c.p - ctx.catsBest[i].p > 0.03).map(c => c.label);
        return `<li class="alert">${headshot(x.p, 32)}<span class="grow"><button class="link-btn pname" data-action="player-detail" data-nba="${x.p.nbaId}">${esc(x.p.name)}</button> <span class="muted small">${esc(x.p.team)} · ${posTags(x.p.pos)} · ${x.games} games</span><br>
          <span class="small">For ${esc(x.drop.name)}: <b class="pos-good">${goalDelta(x.gain)}</b>, ${Math.round(x.win * 100)}% to win${better.length ? ` · helps ${better.join(', ')}` : ''}</span></span></li>`;
      }).join('')}</ul>` : '<p class="muted small" style="margin:0">No free agent clearly improves this matchup.</p>'}
    </div>`;
}

function viewWeek() {
  if (!NBA) {
    return `<div class="card"><div class="empty"><strong>Loading schedule and stats…</strong>The matchup projector needs the NBA data file.</div></div>`;
  }
  // once the week has started, finished games count their real box scores (loaded on first need)
  if (!BOX && matchDates()[0] <= todayIso()) loadBoxes().then(() => { if (ui.tab === 'week') render(); }).catch(() => {});
  const ctx = weekContext();
  const { start, dates, weekly, hasOpp, asSet, best, oSet, oBest, mine } = ctx;
  ui.bestIds = ctx.bestIds ? [...ctx.bestIds] : null;
  const today = todayIso();
  const staleOpp = hasOpp && state.opp.week && state.opp.week !== start;
  const range = `${fmtDay(dates[0])} – ${fmtDay(dates[dates.length - 1])}`;
  const winPct = Math.round(oBest.win * 100);
  const changed = weekly ? ctx.bestIds && ([...ctx.bestIds].some(id => !ctx.setIds.has(id)) || ctx.bestIds.size !== ctx.setIds.size) : best.games !== asSet.games;

  const scoreboard = hasOpp ? `
    <div class="card scoreboard">
      <div class="sb-main">
        <div class="sb-side"><div class="sb-label">${esc(state.teamName)}</div><div class="sb-score">${fmt(oBest.expected, isPoints() ? 0 : 1)}</div></div>
        <div class="sb-vs">projected<br>${isPoints() ? 'points' : 'cats'}${changed ? '<span class="sb-vs-extra"><br>with suggested lineup</span>' : ''}</div>
        <div class="sb-side right"><div class="sb-label">${esc(state.opp.name || 'Opponent')}</div><div class="sb-score">${isPoints() ? fmt(oBest.opp, 0) : fmt(oBest.n - oBest.expected, 1)}</div></div>
      </div>
      <div class="odds" role="img" aria-label="Win chance ${winPct}%"><span class="odds-you" style="width:${winPct}%"></span></div>
      <div class="odds-legend"><span><b>${winPct}%</b> to win the week ${infoBtn('win')}</span><span>${100 - winPct}%</span></div>
      ${changed ? `<div class="sb-foot one"><div><span class="muted small">Lineup as set</span><br><b>${fmt(oSet.expected, isPoints() ? 0 : 1)}</b> ${isPoints() ? 'points' : 'cats'} · ${pctTxt(oSet.win)} to win · ${asSet.games} starter games</div></div>` : ''}
    </div>` : `<div class="card"><div class="empty"><strong>Load your opponent to see who's favored</strong>${fxOpponentFor(start) ? `This week you play <b>${esc(fxOpponentFor(start).name)}</b>.<br><br><button class="btn primary" data-action="fx-load-opp">Load ${esc(fxOpponentFor(start).name)} from ${sourceName()}</button>` : `${sourceName()} has no matchup for you this week.`}</div></div>`;

  // Daily-lineup leagues keep the day-by-day swap list
  let dailyCards = '';
  if (!weekly) {
    const swaps = dates.map((d, i) => {
      const s = asSet.days[i], b = best.days[i];
      return { d, start: [...b.active].filter(id => !s.active.has(id)).map(byId), sit: [...s.active].filter(id => !b.active.has(id)).map(byId), past: d < today };
    }).filter(x => x.start.length || x.sit.length);
    dailyCards = `
    <div class="card">
      <div class="card-head"><h2>Daily bench swaps</h2><span class="muted small">${best.games - asSet.games > 0 ? `+${best.games - asSet.games} games over your lineup as set` : 'lineup as set'}</span></div>
      ${swaps.length ? `<ul class="alerts">${swaps.map(x => `<li class="alert ${x.past ? '' : 'good'}"><span class="dot"></span><span class="grow"><b>${fmtDay(x.d)}</b>${x.past ? ' <span class="muted small">(already played)</span>' : ''}<br>
        Start ${x.start.map(p => `<b>${esc(p.name)}</b>`).join(', ')}${x.sit.length ? `; sit ${x.sit.map(p => esc(p.name)).join(', ')}` : ''}</span></li>`).join('')}</ul>`
        : `<p class="muted small" style="margin:0">${mine.length ? 'Your lineup as set already uses every game your bench could add.' : 'Your roster is empty.'}</p>`}
      ${hasOpp && !isPoints() ? `<h3 class="sub" style="margin-top:16px">Categories ${infoBtn('win')}</h3>${catCompareTable(ctx, changed)}` : ''}
    </div>`;
  }

  return `
  <div class="page-head">
    <div>
      <div class="week-nav">
        <button class="icon-btn" data-action="week-shift" data-step="-1" aria-label="Previous week">‹</button>
        <h1>${ui.weekShift === 0 ? 'This week' : ui.weekShift === 1 ? 'Next week' : 'Week of ' + fmtDay(start)}</h1>
        <button class="icon-btn" data-action="week-shift" data-step="1" aria-label="Next week">›</button>
      </div>
      <p>${range}</p>
    </div>
  </div>
  ${staleOpp && fxOpponentFor(start) ? `<div class="sample-banner"><span>Showing your opponent from the week of <b>${fmtDay(state.opp.week)}</b>.</span><button class="btn sm" data-action="fx-load-opp">Load this week's opponent</button></div>` : ''}
  <div class="week-stack">
    ${fxStrip(ctx)}
    ${scoreboard}
    ${matchupBoard(ctx)}
    ${weekly ? lineupSection(ctx) : dailyCards}
    ${ctx.locked && weekly ? '' : pickupsCard()}
  </div>`;
}
