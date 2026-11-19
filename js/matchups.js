// League Layer: Matchups: the matchup projector, lineup boards and stat tables.
// The site loads js/*.js in order (see index.html); they share one scope, like one file.
'use strict';

/* ---------- Matchups (matchup projector) ---------- */
function oddsLabel(p) {
  return p >= 0.9 ? ['Locked', 'good'] : p >= 0.7 ? ['Likely win', 'good'] : p >= 0.55 ? ['Lean win', 'good'] : p > 0.45 ? ['Toss-up', ''] : p > 0.3 ? ['Lean loss', 'bad'] : p > 0.1 ? ['Likely loss', 'bad'] : ['Punt', 'bad'];
}

// (a points league's shooting pair, lineCats: v is [makes, attempts], "33/68")
function fmtCat(c, v) { return c.shot ? `${fmt(v[0], 0)}/${fmt(v[1], 0)}` : c.pct ? fmtPct(v) : fmt(v, 0); }

// Everything the week page (and pickup ideas) needs, computed once per render
function weekContext(start = weekStart()) {
  const dates = matchDates(start);
  const weekly = state.lineupMode === 'weekly' || !!SPORT.weekLineup; // (football: one lineup for the week, locking player by player)
  const mine = state.players.filter(p => !state.il.includes(p.id));
  const opp = oppActive(); // (their injured reserve apart, as yours)
  const hasOpp = state.opp.players.length > 0;
  const setIds = new Set(state.lineup.filter(Boolean));
  const oppIds = weekly ? oppStarterIds(dates) : null;
  const them = projectSide(opp, dates, oppIds);
  const asSet = projectSide(mine, dates, setIds);
  const locked = weekly && !SPORT.gameLocks && new Date() >= lockTime(start);
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
const fmtCatDelta = (c, d) => (c.shot ? d.map(x => signed(x, 1)).join('/') : c.pct ? (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(3).replace(/^0/, '') : signed(d, Math.abs(d) < 10 ? 1 : 0));
const pctTxt = p => `${Math.round(p * 100)}%`;
// a change in the matchup goal: categories won, or projected fantasy points
const goalDelta = v => (isPoints() ? `${signed(v, 1)} FP` : `${signed(v, 2)} cats`);
// a player's games that count this week (one at most in one-game leagues)
// (a goalie: the starts he's expected to play, to a tenth)
const weekGames = (p, dates) => (p.status === 'Out' ? 0 : isOneGame() ? Math.min(1, gamesIn(p, dates)) : isGoalie(p) ? Math.round(expectedGames(p, dates) * 10) / 10 : gamesIn(p, dates));
function gamesLeftTip(p, dates) {
  const played = dates.filter(d => playsOn(p, d) && gameFinal(p, d) && actualLine(p, d)).length;
  const left = dates.filter(d => playsOn(p, d) && !gameFinal(p, d)).length;
  if (isGoalie(p)) return `${played} played, about ${fmt(p.status === 'Out' ? 0 : expectedGames(p, dates.filter(d => !gameFinal(p, d))), 1)} more starts in his team's ${left} games left`;
  return `${played} played, ${p.status === 'Out' ? 0 : left} left this week`;
}

// What changes, category by category, when your starters go from fromIds to toIds
function explainChange(ctx, fromIds, toIds, outP, inP) {
  const a = projectSide(ctx.mine, ctx.dates, fromIds), b = projectSide(ctx.mine, ctx.dates, toIds);
  const ca = compareCats(a, ctx.them), cb = compareCats(b, ctx.them);
  const oa = matchOdds(ca), ob = matchOdds(cb);
  // (a points league's shooting pair is one row, lineCats: d is [makes, attempts], good if its points go up)
  const rows = lineCats().map(l => {
    if (l.shot) {
      const pts = sum(Object.entries(foldPoints(shotPoints(l))).map(([k, v]) => ((b.tot[k] || 0) - (a.tot[k] || 0)) * v));
      return { c: l, d: [totStat(b, l.made) - totStat(a, l.made), totStat(b, l.att) - totStat(a, l.att)], pts, good: pts > 0, pA: null, pB: null };
    }
    const i = ca.findIndex(x => x.key === l.key), c = ca[i], d = catValue(b, c) - catValue(a, c);
    return { c, d, good: c.neg ? d < 0 : d > 0, pA: c.p, pB: cb[i].p };
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
    if (base.has(b.id) || b.status === 'Out' || !gamesIn(b, ctx.dates) || spotLocked(b, ctx.dates)) continue;
    let bestFor = null;
    for (const sId of base) {
      if (spotLocked(byId(sId), ctx.dates)) continue;
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
  if (SPORT.oneNumber) {
    const pts = p => fmt(footballPts(p, ctx.dates), 1);
    if (ex.inP && ex.outP) parts.push(`${inN} projects ${pts(ex.inP)} to ${outN}'s ${pts(ex.outP)}.`);
    else if (ex.inP) parts.push(`Fills an open slot with ${pts(ex.inP)} projected points.`);
  } else if (ex.inP && ex.outP) {
    parts.push(gi > go ? `${inN} plays ${gi} games to ${outN}'s ${go}.` : gi === go ? `Both play ${gi} games, so it comes down to fit.` : `${inN} plays fewer games (${gi} vs ${go}) but helps where this matchup is close.`);
  } else if (ex.inP) parts.push(`Fills an open slot with ${gi} more games.`);
  if (ctx.hasOpp && isPoints() && !SPORT.oneNumber) {
    const fp = ex.rows.find(r => r.c.fp);
    if (fp) parts.push(`${signed(fp.d, 1)} projected points, ${pctTxt(fp.pA)}→${pctTxt(fp.pB)} to win.`);
  } else if (ctx.hasOpp && !SPORT.oneNumber) {
    const lifts = ex.rows.filter(r => r.pB - r.pA > 0.015).sort((x, y) => (y.pB - y.pA) - (x.pB - x.pA)).slice(0, 3);
    const costs = ex.rows.filter(r => r.pA - r.pB > 0.015).sort((x, y) => (y.pA - y.pB) - (x.pA - x.pB)).slice(0, 2);
    if (lifts.length) parts.push(`Biggest lift: ${lifts.map(r => `${r.c.label} ${pctTxt(r.pA)}→${pctTxt(r.pB)}`).join(', ')}.`);
    if (costs.length) parts.push(`Costs: ${costs.map(r => `${r.c.label} ${pctTxt(r.pA)}→${pctTxt(r.pB)}${r.pB >= 0.7 ? ' (still safe)' : r.pB <= 0.3 ? ' (likely lost anyway)' : ''}`).join(', ')}.`);
    if (!costs.length && lifts.length) parts.push('No category gets worse in a way that matters.');
  }
  return parts.join(' ');
}

function catChips(ex) {
  if (SPORT.oneNumber) return ''; // points are all that counts, and the swap's line says so
  return `<div class="cat-chips">${ex.rows.map(r => {
    // in points leagues only total points decide the week, so only FP shows a win chance
    const moved = Math.abs(r.pB - r.pA) >= 0.01 && (!isPoints() || r.c.fp);
    const cls = Math.abs(r.c.shot ? r.pts : r.d) < 1e-6 ? '' : r.good ? 'good' : 'bad';
    return `<span class="cchip ${cls}"><b>${r.c.label}</b> ${fmtCatDelta(r.c, r.d)}${moved ? `<span class="cchip-p">${pctTxt(r.pA)}→${pctTxt(r.pB)}</span>` : ''}</span>`;
  }).join('')}</div>`;
}

function swapBlock(ex, ctx, kind) {
  const g = p => `<span class="muted small">${posTags(p.pos)} · ${SPORT.oneNumber ? `${fmt(footballPts(p, ctx.dates), 1)} proj` : `${weekGames(p, ctx.dates)} G`}</span>`;
  const net = ctx.hasOpp
    ? `<span class="swap-net ${ex.score >= 0 ? 'pos-good' : 'pos-bad'}">${isPoints() || matchupScoring() === 'most' ? `${signed(ex.dWin * 100, 1)}% win · ${goalDelta(ex.dExp)}` : `${signed(ex.dExp, 2)} cats · ${signed(ex.dWin * 100, 1)}% win`}</span>`
    : `<span class="swap-net ${ex.dGames >= 0 ? 'pos-good' : 'pos-bad'}">${SPORT.oneNumber ? goalDelta(ex.dExp) : `${signed(ex.dGames, 0)} games`}</span>`;
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
  if (SPORT.steadyMinutes) return null; // ice time doesn't swing with blowouts and fouls (or a goalie's by much)
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
    <div>${gameStats(p, line)[0].join(' · ')}</div>
    <div class="tip-dim">${gameStats(p, line)[1].join(' · ')}</div>
    ${isPoints() ? `<div class="tip-head">${fmtFp(lineFp(line))} FP</div>` : ''}
    ${short ? `<div class="tip-warn">Usually ${Math.round(p.min)} min: ${esc(short)}</div>` : ''}`;
}

function dayDots(p, ctx, counts) {
  const dot = (cls, tip) => `<i class="${cls}" data-tip="${esc(tip)}"></i>`;
  return `<span class="dots">${ctx.dates.map(d => {
    if (!playsOn(p, d)) return dot('none', 'No game');
    const bench = counts ? '' : ' bench';
    // a game on now pulses green while he's in it (a line in tonight's box score, or on the floor), a green ring until he
    // checks in; listed Out, the red ring of a game he'll miss (the owner's ask: not red while he's playing)
    const on = liveGame(p, d);
    if (on && on.state === 'in' && !gameFinal(p, d)) {
      const clock = esc(String(on.detail || '')), benchTip = bench ? '<div class="tip-dim">On the bench, so it won&rsquo;t count</div>' : '';
      if (lineOn(p, d) || onFloor(p, d)) return dot(`live${bench}`, `Playing now: ${clock}${benchTip}`);
      if (p.status === 'Out') return dot('out', `Game on now: ${clock}<div class="tip-dim">He's listed Out</div>`);
      return dot(`live wait${bench}`, `Game on now: ${clock}<div class="tip-dim">He hasn't played yet</div>${benchTip}`);
    }
    if (gameFinal(p, d)) {
      const line = actualLine(p, d);
      if (!line) return dot('dnp', "His team played, but he didn't");
      return dot(`done${bench}${shortMinutes(p, line, d) ? ' short' : ''}`, gameTip(p, line, d, bench));
    }
    if (p.status === 'Out') return dot('out', `Upcoming, but he's listed Out${p.inj && p.inj.note ? `<div class="tip-dim">${esc(p.inj.note)}</div>` : ''}`);
    const b2b = isB2B(p, d), goalie = isGoalie(p) ? ` (${startWords(p, d)})` : '';
    return dot(`up${bench}${b2b ? ' b2b' : ''}`, `Upcoming game${b2b ? ', on a back-to-back' : ''}${goalie}${bench ? '<div class="tip-dim">On the bench, so it won\'t count</div>' : ''}`);
  }).join('')}</span>`;
}

// ----- Tooltips: any element with data-tip (trusted HTML) shows a readable box on hover, focus or tap -----
const tipEl = $('#tip');
function showTip(el) {
  // (inside a popup the box goes in it: an open dialog is drawn above everything else on the page, any z-index included)
  const host = el.closest('dialog[open]') || document.body;
  if (tipEl.parentNode !== host) host.append(tipEl);
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
const BOARD_KEY = 'league-layer-board';
ui.boardMode = store.get(BOARD_KEY) || 'sched';

// Smooth shading: strength grows with the size of the contribution, so close values look alike (base: an opaque
// background for sticky cells)
function shade(z, base = 'transparent') {
  if (!Number.isFinite(z) || Math.abs(z) < 0.2) return '';
  const pct = Math.round(Math.min(Math.abs(z) / 2.5, 1) * 50);
  return `background: color-mix(in srgb, var(${z > 0 ? '--good' : '--bad'}) ${pct}%, ${base});${Math.abs(z) >= 1.5 ? ' font-weight: 700;' : ''}`;
}
const shadeProb = p => shade((p - 0.5) * 5); // 90% to win ≈ as strong as a +2 contribution

// How much a player helps (+) or hurts (−) a category. Per game: vs an average rostered
// player. Week total: the player's weekly number vs an average starter's week (~3.5 games),
// so the same weekly total always gets the same shade. FG%/FT% count shot volume.
const WEEK_GAMES = 3.5;
function contribZ(p, key, g, week) {
  const c = lineCats().find(x => x.key === key) || catDef(key);
  // fantasy points; a points league's shooting pair ("8.2/17.1 FG", lineCats) by its own points (shotPoints)
  if (key === 'fp' || c.shot) {
    const part = c.shot ? shotPoints(c) : null, [m, sd] = fpBase(part), fp = part ? fantasyPoints(p, part) : fantasyPoints(p);
    return week ? (fp * g - m * WEEK_GAMES) / (sd * WEEK_GAMES) : (fp - m) / sd;
  }
  if (!BASE[key]) return 0;
  if (!week) return catZ(p)[key] || 0;
  if (c.pct) { const att = statVal(p, c.att); return att ? (c.neg ? -1 : 1) * (pctOf(p, c) - BASE[key][0]) * att * g / (BASE[key][1] * WEEK_GAMES) : 0; }
  const z = (statVal(p, key) * g - BASE[key][0] * WEEK_GAMES) / (BASE[key][1] * WEEK_GAMES);
  return c.neg ? -z : z;
}

function boardModes() {
  return segBtns('Lineup view', 'board-mode', 'mode', [['sched', 'Schedule'], ['game', 'Per game'], ['week', 'Week total']], ui.boardMode);
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
// (a player's positions in their lineup-spot colors on this tab, as its lineup spots and the Matchup tab's are: the owner's ask)
function boardCell(p, ctx, side, starter) {
  if (!p) return `<td class="bcell"><span class="muted small">${side === 'them' && !ctx.hasOpp ? '' : 'Empty'}</span></td>`;
  const tags = rowTags(p, ctx, side, starter);
  if (SPORT.oneNumber) return `<td class="bcell${starter ? '' : ' bench'}"><div class="bplayer">${headshot(p, hsPx(36, 22))}<div class="bmain"><div class="bname">${playerName(p)}${p.status !== 'Healthy' ? ' ' + statusBadge(p) : ''}${tags ? ' ' + tags : ''}</div>${footballMeta(p, ctx)}</div></div></td>`;
  return `<td class="bcell${starter ? '' : ' bench'}"><div class="bplayer">${headshot(p, hsPx(36, 22))}<div class="bmain"><div class="bname">${playerName(p)}${p.status !== 'Healthy' ? ' ' + statusBadge(p) : ''}${tags ? ' ' + tags : ''}</div>
    <div class="bmeta"><span class="bmeta-info">${posTags(p.pos)}</span>${dayDots(p, ctx, starter)}<b class="bmeta-g" data-tip="${esc(gamesLeftTip(p, ctx.dates))}">${weekGames(p, ctx.dates)}G</b></div></div></div></td>`;
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

// a percentage in words; a rate (goals against average) as it is
const pctWords = (c, v) => (c.rate ? v.toFixed(2) : `${(v * 100).toFixed(1)}%`);

// Hover text with the unrounded numbers behind a stat cell
function statTip(p, c, g, week) {
  const games = `${g} game${g === 1 ? '' : 's'}`;
  if (c.shot) {
    const k = week ? g : 1;
    return `${c.label}: ${(statVal(p, c.made) * k).toFixed(1)}/${(statVal(p, c.att) * k).toFixed(1)} ${week ? `over ${games}` : 'per game'} · ${signed(fantasyPoints(p, shotPoints(c)) * k, 1)} FP`;
  }
  if (c.pct) {
    const [m, a] = [statVal(p, c.made), statVal(p, c.att)];
    const k = week ? g : 1;
    return `${c.label}: ${pctWords(c, pctOf(p, c))} · ${(m * k).toFixed(1)}/${(a * k).toFixed(1)} ${week ? `over ${games}` : 'per game'}`;
  }
  const v = statOf(p, c);
  return week ? `${c.label}: ${(v * g).toFixed(1)} (${v.toFixed(2)} × ${games})` : `${c.label}: ${v.toFixed(2)} per game`;
}

// Projected-week totals, unrounded, with the matching win chance
function totalTip(c, v, p, who) {
  const amount = c.shot ? `${v[0].toFixed(1)}/${v[1].toFixed(1)}` : c.pct ? pctWords(c, v) : v.toFixed(1);
  return `${c.label}: ${amount} · ${pctTxt(p)} ${who}`;
}

function stabCells(p, ctx) {
  const g = weekGames(p, ctx.dates);
  const week = ui.boardMode === 'week';
  const noStats = !p.min && !p.pts && !p.reb; // e.g. a player with no NBA stats on record
  return lineCats().map(c => {
    const none = noStats || (week && !g);
    const d = week ? 0 : 1, shot = k => fmt(statVal(p, k) * (week ? g : 1), d);
    const v = none ? '—' : c.shot ? `${shot(c.made)}/${shot(c.att)}` : c.pct ? fmtPct(pctOf(p, c)) : fmt(statOf(p, c) * (week ? g : 1), c.dec && !week ? c.dec : week ? (c.dec ? 1 : 0) : 1);
    return `<td class="sc" style="${none ? '' : shade(contribZ(p, c.key, g, week))}" title="${none ? `${c.label}: no projection` : statTip(p, c, g, week)}">${v}</td>`;
  }).join('');
}

function statRow(p, ctx, side, starter) {
  // opponent start/bench/remove buttons stay on the Schedule view to keep these tables clean
  const tags = side === 'me' ? rowTags(p, ctx, side, starter) : '';
  return `<tr class="${starter ? '' : 'bench'}"><td class="st-name"><div class="bplayer">${headshot(p, hsPx(30, 24))}<div class="bmain"><div class="bname">${playerName(p)}${p.status !== 'Healthy' ? ' ' + statusBadge(p) : ''}${tags ? ' ' + tags : ''}</div></div></div></td>
    <td class="num st-g">${weekGames(p, ctx.dates)}</td>${stabCells(p, ctx)}</tr>`;
}

// A stat table's room: its stat columns share what the name (31%) and G (6%) leave, a shooting pair's "11.9/25.6" taking 2.5
// shares; two tables side by side are at least 100 px a share wide together (.stat-boards, --cols), so 12 columns don't run into each other
const colShares = cols => sum(cols.map(c => (c.shot ? 2.5 : 1)));
const colWidth = (c, shares) => (c.shot ? ` style="width:${(63 * 2.5 / shares).toFixed(1)}%"` : '');

function statTable(ctx, side, title, rows, { bench = false, totals = '', games = 0 } = {}) {
  const s = ui.statSort, shares = colShares(lineCats());
  const th = (key, label, cls = '', attrs = '') => sortTh('stat-sort', key, label, s, { cls, attrs, down: s.dir < 0, arrow: key !== 'slot' });
  return `<table class="stab">
    <thead><tr>${th('name', bench ? `${esc(title)} <span class="muted">bench</span>` : esc(title), 'st-name')}${th('g', 'G', 'num st-g')}${lineCats().map(c => th(c.key, c.label, 'sc', colWidth(c, shares))).join('')}</tr></thead>
    <tbody>${sortStatRows(rows, ctx).map(p => statRow(p, ctx, side, !bench)).join('') || `<tr><td colspan="11" class="muted small">${bench ? 'Nobody on the bench' : side === 'them' ? 'No opponent loaded' : 'No starters'}</td></tr>`}</tbody>
    ${totals ? `<tfoot><tr><td class="st-name"><b>Projected week</b></td><td class="num st-g"><b>${games}</b></td>${totals}</tr></tfoot>` : ''}
  </table>`;
}

// The chance a points league's shooting pair (lineCats) scores more points (shotPoints) for projection A than for B
function shotChance(c, A, B) {
  const sc = Object.entries(foldPoints(shotPoints(c)));
  const pts = S => sum(sc.map(([k, v]) => (S.tot[k] || 0) * v)), vr = S => sum(sc.map(([k, v]) => ((S.vr || {})[k] || 0) * v * v));
  const d = pts(A) - pts(B), sd = Math.sqrt(vr(A) + vr(B));
  return sd > 0 ? phi(d / sd) : d > 0 ? 1 : d < 0 ? 0 : 0.5;
}
// The projected week under each column (compareCats'); a shooting pair as its makes/attempts
function boardTotals(ctx) {
  return lineCats().map(c => {
    if (!c.shot) return ctx.catsSet.find(x => x.key === c.key);
    const pair = S => [totStat(S, c.made), totStat(S, c.att)];
    return { ...c, a: pair(ctx.asSet), b: pair(ctx.them), p: shotChance(c, ctx.asSet, ctx.them) };
  });
}

function statsBoard(ctx, myStarters, myBench, oppStarters, oppBench) {
  const cats = ctx.hasOpp ? boardTotals(ctx) : [];
  const mine = cats.map(c => `<td class="sc" style="${shadeProb(c.p)}" title="${totalTip(c, c.a, c.p, 'to win')}">${fmtCat(c, c.a)}</td>`).join('');
  const theirs = ctx.hasOpp ? cats.map(c => `<td class="sc" style="${shadeProb(1 - c.p)}" title="${totalTip(c, c.b, 1 - c.p, 'for them')}">${fmtCat(c, c.b)}</td>`).join('') : '';
  const oppName = state.opp.name || 'Opponent', cols = `style="--cols:${colShares(lineCats())}"`;
  return `<div class="table-wrap"><div class="stat-boards" ${cols}>
    ${statTable(ctx, 'me', state.teamName, myStarters, { totals: mine, games: ctx.asSet.games })}
    ${statTable(ctx, 'them', oppName, oppStarters, { totals: theirs, games: ctx.them.games })}
  </div>
  <div class="stat-boards bench-boards" ${cols}>
    ${statTable(ctx, 'me', state.teamName, myBench, { bench: true })}
    ${ctx.hasOpp ? statTable(ctx, 'them', oppName, oppBench, { bench: true }) : '<div></div>'}
  </div></div>`;
}

function matchupBoard(ctx) {
  const mySlots = state.slots.map((_, i) => byId(state.lineup[i]));
  // weekly lineups: the starters the projection uses; daily: their lineup as set now (like yours), while
  // each day's best lineup is what's projected
  const oppOn = ctx.oppIds || new Set(Array.isArray(state.opp.starters) ? state.opp.starters : []);
  const oppStarters = sortDesc(ctx.opp.filter(p => oppOn.has(p.id)), value);
  const oppSlotIds = fillSlots(oppStarters, state.slots);
  const oppById = new Map(ctx.opp.map(p => [p.id, p]));
  const prio = p => weeklyPriority(p, ctx.dates);
  const myBench = sortDesc(benchPlayers(), prio);
  const oppBench = sortDesc(ctx.opp.filter(p => !oppOn.has(p.id)), prio);
  const sched = ui.boardMode === 'sched' || !!SPORT.oneNumber; // (football: its one number)
  const legend = isFootball() ? ((NBA.projWeeks || []).includes(footballWeek(ctx.dates[0])) ? '' : 'No projections for this week yet: season averages')
    : sched ? ''
    : ui.statSort.key !== 'slot' ? '<button class="link-btn quiet" data-action="stat-sort" data-key="slot">Back to lineup order</button>' : ''; // (green helps, red hurts: plain to see)

  let body;
  if (sched) {
    const benchRows = Math.max(myBench.length, oppBench.length, ctx.hasOpp ? 0 : 1);
    const rows = state.slots.map((slot, i) => `<tr><th scope="row">${slotBadge(slot)}</th>${boardCell(mySlots[i], ctx, 'me', true)}${boardCell(oppById.get(oppSlotIds[i]), ctx, 'them', true)}</tr>`).join('');
    const bench = Array.from({ length: benchRows }, (_, i) => `<tr><th scope="row">${slotBadge('BN')}</th>${boardCell(myBench[i], ctx, 'me', false)}${boardCell(oppBench[i], ctx, 'them', false)}</tr>`).join('');
    // injured reserve: yours and theirs, side by side; then a Sleeper taxi squad, the same way
    const myIr = ilPlayers(), oppIl = oppIlIds(), oppIr = ctx.hasOpp ? state.opp.players.filter(p => oppIl.has(p.id)) : [];
    const outRows = (slot, a, b) => Array.from({ length: Math.max(a.length, b.length) }, (_, i) => `<tr><th scope="row">${slotBadge(slot)}</th>${boardCell(a[i], ctx, 'me', false)}${boardCell(b[i], ctx, 'them', false)}</tr>`).join('');
    const notTaxi = p => !onTaxi(p);
    const irRows = outRows('IL', myIr.filter(notTaxi), oppIr.filter(notTaxi)) + outRows('TAXI', myIr.filter(onTaxi), oppIr.filter(onTaxi));
    body = `<div class="table-wrap"><table class="board">
        <colgroup><col class="c-slot"><col><col></colgroup>
        <thead><tr><th></th><th>${teamLink(ui.viewing ? ui.viewA : state.fxTeam, esc(state.teamName))}</th><th>${state.opp.fxId ? teamLink(state.opp.fxId, esc(state.opp.name)) : esc(state.opp.name || 'Opponent')}</th></tr></thead>
        <tbody>${rows}
          ${SPORT.oneNumber ? `<tr class="board-tot"><th scope="row"></th><td><b>${fmt(fpTotals(ctx.asSet).a, 1)}</b> projected</td><td>${ctx.hasOpp ? `<b>${fmt(fpTotals(ctx.them).a, 1)}</b> projected` : ''}</td></tr>`
    : `<tr class="board-tot"><th scope="row"></th><td><b>${ctx.asSet.games}</b> starter games${ctx.bestIds && ctx.best.games !== ctx.asSet.games ? ` <span class="muted">(${ctx.best.games} suggested)</span>` : ''}</td><td>${ctx.hasOpp ? `<b>${ctx.them.games}</b> starter games` : ''}</td></tr>`}
          <tr class="board-sep"><td colspan="3">Bench</td></tr>${bench}${irRows}
        </tbody>
      </table></div>`;
  } else {
    body = statsBoard(ctx, mySlots.filter(Boolean), myBench, oppSlotIds.map(id => oppById.get(id)).filter(Boolean), oppBench);
  }
  return `
    <div class="card board-card">
      <div class="card-head"><h2>Lineups ${infoBtn(sched ? 'dots' : 'shading')}</h2>${SPORT.oneNumber ? '' : boardModes()}</div>
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
      // 🔒 a category that's all but won (90%+, "Locked")
      const lock = lbl === 'Locked' ? ' <span class="cat-lock" role="img" aria-label="Locked" title="Locked: 90% or better to win">🔒</span>' : '';
      return `<tr class="${moved ? 'moved' : ''}"><td><b>${c.label}</b>${lock}</td><td class="num">${fmtCat(c, c.b)}</td><td class="num">${fmtCat(c, s.a)}</td>${changed ? `<td class="num">${fmtCat(c, c.a)}</td>` : ''}
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
    : !ctx.hasOpp ? (SPORT.oneNumber ? 'Add your opponent to see your win chance. Until then, suggestions just favor the most projected points.' : 'Add your opponent to optimize for this matchup. Until then, suggestions just favor more games from better players.')
    : changed ? `Making ${steps.length === 1 ? 'this change' : 'these changes'} moves your win chance from <b>${pctTxt(ctx.oSet.win)}</b> to <b>${pctTxt(ctx.oBest.win)}</b> and your projected score from <b>${fmt(ctx.oSet.expected, isPoints() ? 0 : 1)}</b> to <b>${fmt(ctx.oBest.expected, isPoints() ? 0 : 1)}</b> ${isPoints() ? 'fantasy points' : 'categories'}.`
    : `Your lineup as set is the best one we found for this matchup (${pctTxt(ctx.oSet.win)} to win, ${fmt(ctx.oSet.expected, isPoints() ? 0 : 1)} projected ${isPoints() ? 'fantasy points' : 'categories'}).`;
  const swing = ctx.catsSet.filter(c => c.p > 0.1 && c.p < 0.9).map(c => c.label);
  const punt = ctx.catsSet.filter(c => c.p <= 0.1).map(c => c.label);
  const locked = ctx.catsSet.filter(c => c.p >= 0.9).map(c => c.label);
  const how = ctx.hasOpp && !isPoints() && (punt.length || locked.length)
    ? `<p class="small muted" style="margin:-6px 0 12px">${swing.length ? `Swing: <b>${swing.join(', ')}</b>` : 'No category is close'}${punt.length ? ` · Punt: <b>${punt.join(', ')}</b>` : ''}${locked.length ? ` · Locked: <b>${locked.join(', ')}</b>` : ''}</p>` : '';
  return `
    <div class="card">
      <div class="card-head"><h2>${ui.viewing ? `Best lineup for ${esc(state.teamName)}` : ui.weekShift === 1 ? 'Lineup for next week' : ui.weekShift ? 'Lineup for that week' : 'Lineup for this week'} ${infoBtn('suggest')}</h2></div>
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
  const lowest = list => list.reduce((a, b) => (worth(a) <= worth(b) ? a : b));
  // football: for the weakest at his position whose game hasn't started (by the season: a star on a bye isn't the one to drop)
  const open = p => footballNow(p, dates).state !== 'in' && footballNow(p, dates).state !== 'post';
  const weakest = p => { const list = mine.filter(m => m.pos[0] === p.pos[0] && open(m)); return list.length ? list.reduce((a, b) => (value(a) <= value(b) ? a : b)) : null; };
  const anyDrop = lowest(mine);
  const taken = new Set([...state.players, ...state.opp.players].map(p => p.nbaId).filter(Boolean));
  const cands = nbaPlayers()
    .filter(x => !taken.has(x.nbaId) && (x.gp || SPORT.oneNumber) && x.status !== 'Out' && gamesIn(x, dates) && (!fxLeague() || fxAvailable(nbaById.get(x.nbaId))))
    .filter(x => !spotLocked(x, dates))
    .sort((a, b) => (SPORT.oneNumber ? footballPts(b, dates) - footballPts(a, dates) : b.val - a.val))
    .slice(0, 70);
  const out = [];
  for (const x of cands) {
    const p = playerFromRaw(nbaById.get(x.nbaId));
    const drop = SPORT.samePosDrops ? weakest(p) : anyDrop;
    if (!drop) continue;
    const team = [...mine.filter(m => m !== drop), p];
    const proj = projectSide(team, dates, weekly ? bestWeeklyIds(team, dates, null) : null);
    const cats = compareCats(proj, them);
    const odds = matchOdds(cats);
    out.push({ p, drop, gain: odds.expected - baseOdds.expected, score: objective(odds) - objective(baseOdds), win: odds.win, games: weekGames(p, dates), cats, proj });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 5);
}

// Trying a free agent means setting a whole lineup with him, and football's Matchups redraws every 30 s during games:
// a live redraw keeps the list it has, as the same players are still out there
let pickMemo = { key: '', ideas: [] };
function pickupsCard(ctx) { // (ctx: the week as the page has just worked it out, so it isn't worked out twice a draw)
  if (!NBA) return '';
  ctx = ctx || weekContext();
  if (!ctx.hasOpp) return '';
  const key = [ctx.dates[0], state.opp.fxId, ...ctx.mine.map(p => p.id)].join();
  const ideas = live.hold && pickMemo.key === key ? pickMemo.ideas : pickupIdeas(ctx).filter(x => x.score > 0.001);
  pickMemo = { key, ideas };
  return `
    <div class="card">
      <div class="card-head"><h2>Pickup ideas</h2><span class="muted small">vs ${esc(state.opp.name || 'your opponent')} · ${fxLeague() ? 'free agents and waivers in your league' : 'if available in your league'}</span></div>
      ${ideas.length ? `<ul class="alerts">${ideas.map(x => {
        // (a points league's shooting pair as one, "FG": lineCats)
        const lift = c => (c.shot ? shotChance(c, x.proj, ctx.them) - shotChance(c, ctx.best, ctx.them) : x.cats.find(y => y.key === c.key).p - ctx.catsBest.find(y => y.key === c.key).p);
        const better = SPORT.oneNumber ? [] : lineCats().filter(c => lift(c) > 0.03).map(c => c.label);
        return `<li class="alert">${headshot(x.p, 32)}<span class="grow">${playerBtn(x.p.nbaId, x.p.name)} <span class="muted small">${teamBtn(x.p.team)} · ${posTags(x.p.pos)} · ${isFootball() ? `${fmt(footballPts(x.p, ctx.dates), 1)} proj` : `${x.games} games`}</span><br>
          <span class="small">For ${esc(x.drop.name)}: <b class="pos-good">${goalDelta(x.gain)}</b>, ${Math.round(x.win * 100)}% to win${better.length ? ` · helps ${better.join(', ')}` : ''}</span></span></li>`;
      }).join('')}</ul>` : '<p class="muted small" style="margin:0">No free agent clearly improves this matchup.</p>'}
    </div>`;
}

// ----- A finished week: the final score, and bench swaps that would have changed it -----
// The weekly rosters and box scores load once (shared with Season totals and Awards); each matchup's replay is kept
const pastWeeks = {}; // league id -> { state, weeks, G } ; replays: "league|period|team" -> result
const pastReplays = new Map();
keep('box league', id => { dropKept(pastWeeks, id); dropKept(pastReplays, id); });
// The league's weekly rosters and this season's box scores, loading the first time (Matchups and Recap redraw when in)
// (ESPN: only the days of the week asked about, espnWeekLineups, so they're kept per week)
function pastWeeksOf(L, period) {
  const days = espnDaysRead(L), key = days ? `${L.id}|${period.n}` : L.id;
  let P = pastWeeks[key];
  if (!P) {
    const mine = P = pastWeeks[key] = { state: 'loading' };
    const still = () => pastWeeks[key] === mine; // (dropped while loading, by changed('box' or 'league'): the next ask loads again)
    Promise.all([days ? espnWeekLineups(L, period) : loadRosterWeeks(L), loadGameLog('cur')])
      .then(([weeks, G]) => { if (still()) pastWeeks[key] = { state: 'ready', weeks, G }; })
      .catch(e => { if (still()) pastWeeks[key] = { state: 'error', msg: e.message }; })
      .finally(() => { if (ui.tab === 'week' || ui.tab === 'recap') render(); });
  }
  return P;
}
function pastWeekCard(start) {
  const L = fxLeague(), period = fxPeriodFor(start);
  if (!L || !period || !hasWeekLineups(L) || !periodOver(period)) return '';
  const leftId = ui.viewing ? ui.viewA : state.fxTeam;
  const pair = (L.matchups[String(period.n)] || []).find(m => m.includes(leftId));
  if (!pair) return '';
  const head = ''; // (no heading: the week's name is at the top of the page)
  const note = msg => `<div class="card">${head}<p class="muted small" style="margin:0">${msg}</p></div>`;
  const P = pastWeeksOf(L, period);
  if (P.state === 'loading') return note(`${loaderMark('sm')}Loading the week's lineups from ${sourceName(L)}…`);
  if (P.state === 'error') return note(`Couldn't load the week's lineups (${esc(P.msg)}).`);
  const key = `${L.id}|${period.n}|${leftId}`;
  if (!pastReplays.has(key)) {
    const R = P.weeks && P.G ? benchSwaps({ ...L, fidNba: currentFidNba() }, P.G, P.weeks, period, [leftId, pair[0] === leftId ? pair[1] : pair[0]]) : null;
    pastReplays.set(key, R);
  }
  const R = pastReplays.get(key);
  if (!R) return note(`${sourceName(L)} hasn't shared this week's lineups.`);

  const pts = leaguePoints();
  const cats = pts ? [{ label: 'FP' }] : scoreCats();
  const name = tid => teamLink(tid);
  const [A, B] = R;
  // Sleeper basketball: the result is Sleeper's own; a week whose real scores the site hasn't seen is estimated from its
  // final lineups (benchSwaps): marked ≈, and no bench swaps (they'd hang on the estimate)
  const est = weekEstimated(R);
  const scoreTxt = sc => (est ? '≈ ' : '') + (pts ? `${fmtFp(sc.me)}–${fmtFp(sc.opp)}` : `${sc.me}–${sc.opp}${sc.ties ? `–${sc.ties}` : ''}`);
  const outcome = sc => Math.sign(Math.round((sc.me - sc.opp) * 10));
  const verb = o => (o > 0 ? 'won' : o < 0 ? 'lost' : 'tied');
  const RES_VERB = { W: 'won', L: 'lost', T: 'tied' };
  const final = weekScore(A.tot, B.tot);
  const side = (S, O) => {
    const base = weekScore(S.tot, O.tot), o = outcome(base);
    const margin = sc => sc.me - sc.opp;
    // the swaps that do better, best first, one per bench player
    const better = S.swaps.map(w => ({ w, sc: weekScore(w.tot, O.tot) })).filter(x => margin(x.sc) > margin(base) + 1e-9)
      .sort((x, y) => margin(y.sc) - margin(x.sc));
    const seen = new Set();
    const top = better.filter(x => !seen.has(x.w.inP.fid) && seen.add(x.w.inP.fid)).slice(0, 3);
    // categories that change hands: + now won, = now tied, − now lost
    const changed = x => cats.map((c, i) => ({ c, now: x.sc.lead[i], was: base.lead[i] })).filter(y => y.now !== y.was)
      .map(y => `<span class="${y.now > 0 ? 'pos-good' : y.now < 0 ? 'pos-bad' : 'muted'}" title="${y.now > 0 ? 'won' : y.now < 0 ? 'lost' : 'tied'} instead of ${y.was > 0 ? 'won' : y.was < 0 ? 'lost' : 'tied'}">${y.now > 0 ? '+' : y.now < 0 ? '−' : '='}${esc(y.c.label)}</span>`).join(' ');
    const item = x => {
      const flip = outcome(x.sc) > o;
      return `<li class="alert${flip ? ' good' : ''}"><span class="dot"></span><span class="grow">Start ${inlinePlayer(x.w.inP, `<b>${esc(x.w.inP.name)}</b>`)} for ${inlinePlayer(x.w.outP, esc(x.w.outP.name))}<br>
        <span class="small">${flip ? `<b>Would have ${verb(outcome(x.sc))} ${scoreTxt(x.sc)}</b>` : `${scoreTxt(x.sc)}`}${pts ? '' : ` · ${changed(x)}`}</span></span></li>`;
    };
    return `<h3 class="sub">${name(S.tid)} <span class="muted small">${RES_VERB[S.res] || verb(o)} ${scoreTxt(base)}</span></h3>
      ${top.length ? `<ul class="alerts">${top.map(item).join('')}</ul>` : `<p class="muted small" style="margin:0 0 4px">No bench swap would have done better.</p>`}`;
  };

  // each team's lineup that week: starters' games (what counted), the week total, then the bench's games
  // (a points league's shooting pair is one "8/17 FG": lineCats)
  // (the FP column two shares: a week's total, "≈ 160.5")
  const cols = lineCats().filter(c => !c.fp), shares = colShares(cols) + (pts ? 2 : 0);
  const cell = (s, c, cls = '') => {
    if (c.shot) return `<td class="sc${cls}">${fmt(lineStat(s, c.made), 0)}/${fmt(lineStat(s, c.att), 0)}</td>`;
    if (c.pct) return `<td class="sc${cls}" title="${s[c.att] ? `${s[c.made] || 0}/${s[c.att]}` : 'no attempts'}">${s[c.att] ? fmtPct(s[c.made] / s[c.att]) : '—'}</td>`;
    return `<td class="sc${cls}">${fmt(lineStat(s, c.key), 0)}</td>`;
  };
  const row = (x, bench) => `<tr class="${bench ? 'bench' : ''}"><td class="st-name"><div class="bplayer">${headshot(x.p, hsPx(30, 24))}<div class="bmain"><div class="bname">${playerName(x.p)}</div></div></div></td>
    <td class="num st-g">${x.line.gp1 || 0}</td>${cols.map(c => cell(x.line, c)).join('')}${pts ? `<td class="sc">${fmtFp(lineFp(x.line))}</td>` : ''}</tr>`;
  const table = (S, O) => {
    const sc = weekScore(S.tot, O.tot);
    const lead = i => (sc.lead[i] > 0 ? ' pos-good' : sc.lead[i] < 0 ? ' pos-bad' : '');
    const byG = list => [...list].sort((a, b) => (b.line.gp1 || 0) - (a.line.gp1 || 0) || lineFp(b.line) - lineFp(a.line));
    return `<table class="stab pw-table">
      <thead><tr><th class="st-name">${name(S.tid)}</th><th class="num st-g">G</th>${cols.map(c => `<th class="sc"${colWidth(c, shares)}>${c.label}</th>`).join('')}${pts ? `<th class="sc" style="width:${(63 * 2 / shares).toFixed(1)}%">FP</th>` : ''}</tr></thead>
      <tbody>${byG(S.starters).map(x => row(x, false)).join('')}</tbody>
      <tbody class="pw-total">${S.fix && Math.abs(S.fix) >= 0.05 ? `<tr class="bench"><td class="st-name" title="Sleeper's own score for the week, less these lineups' games: Lock-In counts a lineup spot's game day by day, and these are the week's final lineups">Rest of Sleeper's score</td><td class="num st-g"></td>${cols.map(() => '<td class="sc"></td>').join('')}<td class="sc">${signed(S.fix, 1)}</td></tr>` : ''}
        <tr><td class="st-name"><b>Week total</b></td><td class="num st-g"><b>${S.tot.gp1 || 0}</b></td>${cols.map((c, i) => cell(S.tot, c, pts ? '' : lead(i))).join('')}${pts ? `<td class="sc${lead(0)}">${est ? '≈ ' : ''}${fmtFp(lineFp(S.tot))}</td>` : ''}</tr></tbody>
      ${S.bench.length ? `<tbody>${byG(S.bench).map(x => row(x, true)).join('')}</tbody>` : ''}
    </table>`;
  };
  return `<div class="card">${head}
    <p class="pw-final"><b>${name(A.tid)}</b> ${scoreTxt(final)} <b>${name(B.tid)}</b></p>
    <div class="table-wrap"><div class="stat-boards" style="--cols:${shares}">${table(A, B)}${table(B, A)}</div></div>
    <p class="muted small" style="margin:8px 0 0">Bench rows (muted) are games that didn't count.</p>
  </div>
  <div class="card"><div class="card-head"><h2>Bench swaps ${infoBtn('benchswaps')}</h2><span class="muted small">one bench player for one starter</span></div>
    ${est ? `<p class="muted small" style="margin:0">≈ estimated: Sleeper doesn't share this week's scores, so no bench swaps. ${RES_VERB[A.res] ? `${name(A.tid)} ${RES_VERB[A.res]}, as Sleeper has it.` : ''} ${infoBtn('slpScores')}</p>` : `${side(A, B)}${side(B, A)}`}
  </div>`;
}

// The weeks to step through: the league's matchup numbers (else the week's Monday), this one marked like the
// opponent picker marks this week's opponent
function weekPicker() {
  const shifts = weekShifts();
  // (phones: just the week, so the picker fits beside the heading, which already says this period or next)
  const phone = isPhone();
  const opts = shifts.map(s => {
    const p = fxLeague() && fxLeague().periods ? fxPeriodFor(weekStartAt(s)) : null;
    const playoffs = p && fxLeague().playoffPeriod && p.n >= fxLeague().playoffPeriod;
    return `<option value="${s}" ${s === ui.weekShift ? 'selected' : ''}>${p ? `Week ${p.n}` : `Week of ${fmtMonthDay(weekStartAt(s))}`}${phone ? '' : s === 0 ? ' (this period)' : playoffs ? ' (playoffs)' : ''}</option>`;
  });
  return stepper('week-shift', 'week', `<select class="ctx-team" data-change="week-pick" aria-label="Week">${opts.join('')}</select>`,
    { first: ui.weekShift <= shifts[0], last: ui.weekShift >= shifts[shifts.length - 1] });
}

function viewWeek() {
  if (!NBA) {
    return loadingCard('Loading schedule and stats…', `The matchup projector needs the ${SPORT.name} data file.`);
  }
  // once the week has started, finished games count their real box scores (loaded on first need)
  if (!BOX && matchDates()[0] <= todayIso()) loadBoxes().then(() => { if (ui.tab === 'week') render(); }).catch(() => {});
  if (isFootball() && fxLeague()) { // the week's games as they're played: the league site's points, ESPN's clock
    startLive();
    leagueWeekFresh(fxLeague());
    footballLines(fxLeague());
  }
  const ctx = weekContext();
  const { start, dates, weekly, hasOpp, asSet, best, oSet, oBest, mine } = ctx;
  const today = todayIso();
  const staleOpp = hasOpp && state.opp.week && state.opp.week !== start;
  // the week's days (phones: Nov 9 – 15, short enough for the week picker beside it)
  const first = dates[0], last = dates[dates.length - 1];
  const range = isPhone()
    ? `${fmtMonthDay(first)} – ${first.slice(0, 7) === last.slice(0, 7) ? +last.slice(8) : fmtMonthDay(last)}` : `${fmtDay(first)} – ${fmtDay(last)}`;
  const winPct = Math.round(oBest.win * 100);
  const changed = weekly ? ctx.bestIds && ([...ctx.bestIds].some(id => !ctx.setIds.has(id)) || ctx.bestIds.size !== ctx.setIds.size) : best.games !== asSet.games;

  // A finished week: nothing left to project, so no projections at all (the owner's rule). Its real result and lineups
  // where the league shares them, else a line saying why not: the last night's box scores aren't in yet (ESPN's finals
  // are asked for meanwhile, as the Recap does), no matchup that week, or a league site whose past lineups aren't read.
  const over = dates[dates.length - 1] < today;
  if (over && BOX) fillWeekFromEspn(fxLeague());
  const pastNote = () => {
    const L = fxLeague(), period = L && fxPeriodFor(start);
    const msg = !L || !hasWeekLineups(L) ? `That week is over, so there's nothing to project.${L ? ` Past weeks' results come from each week's real lineups, which the site doesn't read from ${esc(sourceName(L))}${isFootball() ? ' football' : ''} leagues yet.` : ''}`
      : period && !periodOver(period) ? `That week's games are over. Its result and lineups show here once the last night's box scores are in.`
      : `That week is over, and ${ui.viewing ? 'this team' : 'you'} had no matchup in it.`;
    return `<div class="card"><p class="muted small" style="margin:0">${msg}</p></div>`;
  };
  const past = over ? pastWeekCard(start) || pastNote() : '';
  const unit = isPoints() ? 'points' : 'cats';
  const when = ui.weekShift === 1 ? 'next week' : ui.weekShift ? 'that week' : 'this week';
  const real = hasOpp ? null : fxOpponentFor(start); // (no opponent loaded: who the league says you play)
  const noOpp = () => `<div class="card"><div class="empty"><strong>Load your opponent to see who's favored</strong>${real
    ? `${when[0].toUpperCase() + when.slice(1)} you play <b>${esc(real.name)}</b>.<br><br><button class="btn primary" data-action="fx-load-opp">Load ${esc(real.name)} from ${sourceName()}</button>`
    : `${sourceName()} has no matchup for you ${when}.`}${fxLeague() && state.fxTeam ? `<div class="sb-pick">Or compare against ${fxOppPicker(ctx)}</div>` : ''}</div></div>`;
  const asSetLine = () => `<div class="sb-foot"><span class="muted">Lineup as set</span> <span class="sb-foot-n"><b>${fmt(oSet.expected, isPoints() ? 0 : 1)}</b> ${unit} · <b>${pctTxt(oSet.win)}</b> to win${isFootball() ? '' : ` · <b>${asSet.games}</b> starter games`}</span></div>`;
  const scoreboard = hasOpp ? `
    <div class="card scoreboard">
      <div class="sb-main">
        <div class="sb-side"><div class="sb-label">${teamLink(ui.viewing ? ui.viewA : state.fxTeam, esc(state.teamName))}</div><div class="sb-score">${fmt(oBest.expected, isPoints() ? 0 : 1)}</div></div>
        <div class="sb-vs">projected ${unit}${changed ? '<span class="sb-vs-extra"> with suggested lineup</span>' : ''}</div>
        <div class="sb-side right"><div class="sb-label">${fxLeague() && state.fxTeam ? fxOppPicker(ctx) : esc(state.opp.name || 'Opponent')}</div>${fxLeague() && state.fxTeam ? fxOppNote(ctx) : ''}<div class="sb-score">${isPoints() ? fmt(oBest.opp, 0) : fmt(oBest.n - oBest.expected, 1)}</div></div>
      </div>
      <div class="odds" role="img" aria-label="Win chance ${winPct}%"><span class="odds-you" style="width:${winPct}%"></span></div>
      <div class="odds-legend"><span><b>${winPct}%</b> to win the week ${infoBtn('win')}</span><span>${100 - winPct}%</span></div>
      ${changed ? asSetLine() : ''}
    </div>` : noOpp();

  // Daily-lineup leagues keep the day-by-day swap list (not one-game leagues: more games don't count there)
  let dailyCards = '';
  if (!weekly && !isOneGame()) {
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
      <h1>${ui.weekShift === 0 ? 'This period' : ui.weekShift === 1 ? 'Next period' : ui.weekShift === -1 ? 'Last period' : 'Week of ' + fmtDay(start)}</h1>
      <p>${range}${fxWeekNotes(ctx)}</p>
    </div>
    <div class="week-nav">${weekPicker()}</div>
  </div>
  ${staleOpp && fxOpponentFor(start) ? `<div class="sample-banner"><span>Showing your opponent from the week of <b>${fmtDay(state.opp.week)}</b>.</span><button class="btn sm" data-action="fx-load-opp">Load this week's opponent</button></div>` : ''}
  <div class="week-stack">
    ${fxNoTeam()}
    ${past || `${scoreboard}
    ${matchupBoard(ctx)}
    ${weekly ? lineupSection(ctx) : dailyCards}
    ${ctx.locked && weekly ? '' : pickupsCard(ctx)}`}
  </div>`;
}
