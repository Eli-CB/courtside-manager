// League Layer: the weekly recap: every matchup's result and the week's standouts, to share with the league.
// The site loads js/*.js in order (see index.html); they share one scope, like one file.
'use strict';

// ----- Weekly recap -----
// A finished week across the whole league, counted from the week's real lineups and box scores as How week N ended
// counts one matchup: every final, then the standouts. Fantrax and Sleeper leagues (the others don't share past lineups);
// in Sleeper's one-game weeks a starter's week is the game that counted, so Player of the week is the best such game.
const recaps = new Map(); // "league|period" -> recap, or null when the week's lineups aren't there

// weeks whose games are all played (a Fantrax week ends officially when the next locks, a day after its last games)
const finishedPeriods = L => (L.periods || []).filter(p => periodOver(p) && ((L.matchups || {})[String(p.n)] || []).length);

// A game's or a week's full line in the league's own categories (a week per game; shooting as makes-attempts, a
// week's with its %), minutes first
function fullLine(s, perGame) {
  const g = perGame ? s.gp1 || 1 : 1, v = (k, d) => fmt(lineStat(s, k) / g, perGame ? 1 : d);
  if (isFootball()) { const w = footballWords(s, g); return w.length ? w : ['played, no stats']; }
  const parts = [`${v('min', 0)} MIN`];
  const goalie = isHockey() && !!(s.sa || s.gs); // hockey: a skater's line or a goalie's, not both
  for (const c of scoreCats()) {
    if (c.fp || (isHockey() && SPORT.goalieCats.includes(c.key) !== goalie)) continue;
    if (c.rate) parts.push(`${fmt(s[c.att] ? (s[c.made] || 0) / s[c.att] : 0, 2)} ${c.label}`);
    else if (c.pct) {
      const m = s[c.made] || 0, a = s[c.att] || 0;
      parts.push(`${fmt(m / g, perGame ? 1 : 0)}-${fmt(a / g, perGame ? 1 : 0)} ${c.label.replace('%', '')}${perGame && a ? ` (${fmtPct(m / a)})` : ''}`);
    } else parts.push(`${v(c.key, c.dec || 0)} ${c.label}`);
  }
  return parts;
}

function buildRecap(L, P, period) {
  const pairs = L.matchups[String(period.n)].filter(m => m.length === 2);
  const R = benchSwaps({ ...L, fidNba: currentFidNba() }, P.G, P.weeks, period, pairs.flat());
  if (!R) return null;
  const by = new Map(R.map(x => [x.tid, x]));
  const outcome = sc => Math.sign(Math.round((sc.me - sc.opp) * 10));
  // the finals, winner first
  const games = pairs.map(([a, b]) => {
    let sc = weekScore(by.get(a).tot, by.get(b).tot);
    if (outcome(sc) < 0) { [a, b] = [b, a]; sc = weekScore(by.get(a).tot, by.get(b).tot); }
    return { a, b, sc, margin: sc.me - sc.opp };
  });
  const order = [...games].sort((x, y) => y.margin - x.margin);
  // every starter's week and every game he started, valued as Performances values them
  const weeks = [], single = [];
  for (const S of R) for (const x of S.starters) if (x.line.gp1) weeks.push({ ...x, tid: S.tid, v: lineValue(x.line) });
  const rps = P.weeks.filter(w => fxTime(w.start) >= fxTime(period.lock) && fxTime(w.start) < fxTime(period.endAt));
  for (const rp of rps) {
    const days = periodDays(P.G, rp);
    for (const [f, o] of rp.owner) {
      if (!o.on || !by.has(o.tid)) continue;
      const nba = currentFidNba()(f), raw = nba && nbaById.get(nba);
      for (const r of countedRows(L, P.G, rp, f, ((raw && P.G.players.get(nba)) || []).filter(r => days.has(r[0])))) {
        const line = gameLine(P.G, r);
        single.push({ p: playerFromRaw(raw), tid: o.tid, line, v: lineValue(line) });
      }
    }
  }
  const best = (list, f) => list.reduce((a, b) => (!a || f(b) > f(a) ? b : a), null);
  // the bench swap that would have changed a result the most
  let regret = null;
  for (const g of games) {
    for (const [S, O] of [[by.get(g.a), by.get(g.b)], [by.get(g.b), by.get(g.a)]]) {
      const base = weekScore(S.tot, O.tot);
      for (const w of S.swaps) {
        const sc = weekScore(w.tot, O.tot), up = outcome(sc) - outcome(base);
        const gain = (sc.me - sc.opp) - (base.me - base.opp);
        if (up > 0 && (!regret || up > regret.up || (up === regret.up && gain > regret.gain))) regret = { tid: S.tid, w, sc, up, gain };
      }
    }
  }
  // each team's week against every other team's
  const allPlay = R.map(S => {
    const rec = R.filter(O => O !== S).map(O => outcome(weekScore(S.tot, O.tot)));
    return { tid: S.tid, w: rec.filter(x => x > 0).length, l: rec.filter(x => x < 0).length, t: rec.filter(x => !x).length };
  });
  // the starters who missed the most of their NBA team's games while in a starting lineup that week
  const missedBy = Object.entries(startersMissed({ ...L, weeks: rps, fidNba: currentFidNba() }, P.G) || {}).flatMap(([tid, ps]) => ps.filter(x => x.games).map(x => ({ ...x, tid })));
  const most = Math.max(0, ...missedBy.map(x => x.games));
  // Points leagues: every team's score, ranked, for the luck of the draw: the best score that lost, the worst that won
  // (each only when it was on the wrong side of the league's middle), the closest final (under 5% of the winner's score,
  // as Heartbreak Hotel counts a close loss; not a game already told as luck), and the starter who carried his team (the
  // biggest share of its points)
  let pointsBits = {};
  if (isPoints() && R.length > 2) {
    const score = new Map(R.map(S => [S.tid, lineFp(S.tot)]));
    const sorted = [...score.values()].sort((a, b) => b - a), place = v => sorted.findIndex(x => x <= v + 1e-9) + 1;
    const mid = R.length / 2, decided = games.filter(g => g.margin > 0);
    const lost = best(decided, g => g.sc.opp), won = best(decided, g => -g.sc.me);
    const tight = best(decided, g => -g.margin);
    const carry = best(weeks.map(x => ({ ...x, share: lineFp(x.line) / score.get(x.tid) })).filter(x => score.get(x.tid) > 0), x => x.share);
    const unlucky = lost && place(lost.sc.opp) <= mid ? { ...lost, place: place(lost.sc.opp) } : null;
    const lucky = won && place(won.sc.me) > mid ? { ...won, place: place(won.sc.me) } : null;
    pointsBits = {
      unlucky, lucky,
      close: tight && tight.margin < 0.05 * tight.sc.me && ![unlucky, lucky].some(x => x && x.a === tight.a) ? tight : null,
      carry: carry && carry.share >= 0.2 ? { ...carry, pts: lineFp(carry.line), of: score.get(carry.tid) } : null,
    };
  }
  // Hockey: the best goalie's week (when Player of the week isn't one), and every starter's three-goal game
  const isGoalie = line => !!(line.sa || line.gs);
  const goalie = isHockey() ? best(weeks.filter(x => isGoalie(x.line)), x => x.v) : null;
  const mvp = best(weeks, x => x.v);
  // Football: the best team defense started
  const defense = isFootball() ? best(weeks.filter(x => x.p.pos[0] === 'DEF'), x => x.v) : null;
  return {
    ...pointsBits,
    goalie: goalie && goalie !== mvp ? goalie : null,
    hats: isHockey() ? single.filter(x => !isGoalie(x.line) && lineStat(x.line, 'g') >= 3) : [],
    defense: defense && defense !== mvp ? defense : null,
    period, games: order,
    mvp,
    game: L.oneGame ? null : best(single, x => x.v), // one-game weeks: the player of the week's game
    // the least a starter did a game over the week, among those with 2 or more games (one short night isn't a week)
    brick: L.oneGame ? null : best(weeks.filter(x => x.line.gp1 >= 2), x => -x.v / x.line.gp1),
    dud: best(single, x => -x.v), // the single worst game
    // the most games missed; a tie lists up to three (the ones whose team played least first) and counts the rest
    missed: most ? missedBy.filter(x => x.games === most).sort((a, b) => a.sched - b.sched) : [],
    regret,
    allPlay: best(allPlay, x => x.w + x.t / 2),
    teams: R.length,
  };
}

const scoreLine = sc => (isPoints() ? `${fmt(sc.me, 1)}–${fmt(sc.opp, 1)}` : `${sc.me}–${sc.opp}${sc.ties ? `–${sc.ties}` : ''}`);

// The standouts as { emoji, label, html, text for sharing }; a player's also { p, tid, stats } for the image. Names
// are plain links (no photo), so they sit on the line with the text around them.
function recapItems(X) {
  const team = tid => fxTeamName(tid);
  const out = [];
  const add = (e, label, html, text, more) => out.push({ e, label, html, text, ...more });
  const name = (p, bold) => `<button class="link-btn pname" data-action="player-detail" data-nba="${p.nbaId}">${bold ? `<b>${esc(p.name)}</b>` : esc(p.name)}</button>`;
  const unit = isPoints() ? 'FP' : 'value';
  const stand = (e, label, x, perGame, cls = '') => {
    const parts = fullLine(x.line, perGame), head = perGame ? `${x.line.gp1} G, per game: ` : '';
    add(e, label, `${name(x.p, true)} <span class="muted">${teamLink(x.tid)}</span><div class="rc-stats">${head}${parts.map(t => `<span>${t}</span>`).join(' · ')} · <span><b class="${cls}">${fmtValue(x.v, perGame ? 1 : 2)}</b> ${unit}</span></div>`,
      `${x.p.name} (${team(x.tid)}): ${head}${parts.join(', ')}`, { p: x.p, tid: x.tid, stats: `${head}${parts.join(' · ')}` });
  };
  if (X.mvp) stand('🏆', 'Player of the week', X.mvp, !isOneGame());
  if (X.goalie) stand('🥅', 'Goalie of the week', X.goalie, true);
  if (X.defense) stand('🛡️', 'Defense of the week', X.defense, false);
  if (X.game) stand('🚀', 'Game of the week', X.game, false);
  if (X.brick) stand('🧱', 'Worst week', X.brick, true, X.brick.v < 0 ? 'pos-bad' : '');
  if (X.dud) stand('🗑️', 'Worst game', X.dud, false, X.dud.v < 0 ? 'pos-bad' : '');
  if (X.missed && X.missed.length) {
    // nobody's photo: names in line with the text, as the others
    const who = (x, html) => (html ? `${name({ nbaId: x.nba, name: x.name }, true)} <span class="muted">${teamLink(x.tid)}</span>` : `${x.name} (${team(x.tid)})`);
    const g = X.missed[0].games, shown = X.missed.slice(0, 3), more = X.missed.length - shown.length;
    const list = html => shown.map(x => who(x, html)).join(', ') + (more ? ` and ${more} other${more === 1 ? '' : 's'}` : '');
    const tail = isOneGame() ? (X.missed.length > 1 ? 'each started without playing a game' : 'started without playing a game')
      : X.missed.length > 1 ? `each missed ${g} game${g === 1 ? '' : 's'} while starting` : `missed ${g} of ${X.missed[0].sched} games while starting`;
    add('🤕', 'Street clothes', `${list(true)} ${tail}`, `${list(false)} ${tail}`);
  }
  if (X.regret) {
    const r = X.regret, o = Math.sign(Math.round((r.sc.me - r.sc.opp) * 10)), res = o > 0 ? 'won' : 'tied';
    add('🪑', 'Bench regret', `<b>${teamLink(r.tid)}</b>: starting ${name(r.w.inP)} over ${name(r.w.outP)} would have ${res} ${scoreLine(r.sc)}`,
      `${team(r.tid)}: starting ${r.w.inP.name} over ${r.w.outP.name} would have ${res} ${scoreLine(r.sc)}`);
  }
  if (X.hats && X.hats.length) {
    const who = html => X.hats.map(x => (html ? `${name(x.p, true)} <span class="muted">${teamLink(x.tid)}</span>` : `${x.p.name} (${team(x.tid)})`)).join(', ');
    const tail = X.hats.length > 1 ? 'each scored three goals in a game' : `scored ${fmt(lineStat(X.hats[0].line, 'g'), 0)} goals in a game`;
    add('🎩', 'Hat trick', `${who(true)} ${tail}`, `${who(false)} ${tail}`);
  }
  if (X.carry) {
    const c = X.carry, pct = Math.round(c.share * 100);
    add('🎒', 'Carried', `${name(c.p, true)} scored ${fmt(c.pts, 1)} of <b>${teamLink(c.tid)}</b>'s ${fmt(c.of, 1)} (${pct}%)`,
      `${c.p.name} scored ${fmt(c.pts, 1)} of ${team(c.tid)}'s ${fmt(c.of, 1)} (${pct}%)`);
  }
  const final = g => `${fmt(g.sc.me, 1)}–${fmt(g.sc.opp, 1)}`;
  if (X.unlucky) {
    const g = X.unlucky, said = `scored ${fmt(g.sc.opp, 1)}, the ${g.place === 1 ? 'most' : ordinal(g.place) + ' most'} in the league, and still lost`;
    add('😩', 'Tough luck', `<b>${teamLink(g.b)}</b> ${said} to ${teamLink(g.a)} ${final(g)}`, `${team(g.b)} ${said} to ${team(g.a)} ${final(g)}`);
  }
  if (X.lucky) {
    const g = X.lucky, said = `won with ${fmt(g.sc.me, 1)}, the ${g.place === X.teams ? 'fewest' : ordinal(g.place) + ' most'} in the league`;
    add('🍀', 'Lucky win', `<b>${teamLink(g.a)}</b> ${said}, over ${teamLink(g.b)} ${final(g)}`, `${team(g.a)} ${said}, over ${team(g.b)} ${final(g)}`);
  }
  if (X.close) {
    const g = X.close, by = `by ${fmt(g.margin, g.margin < 1 ? 2 : 1)}`;
    add('😬', 'Nail-biter', `<b>${teamLink(g.a)}</b> beat ${teamLink(g.b)} ${final(g)}, ${by}`, `${team(g.a)} beat ${team(g.b)} ${final(g)}, ${by}`);
  }
  // Best week: a category week is hard to read from the finals; a points week is just the top score, there for all to see
  if (X.allPlay && X.teams > 2 && !isPoints()) {
    // matchups won against every other team's week, not categories
    const a = X.allPlay, n = X.teams - 1;
    const beat = `${a.w === n ? `every other team (${n} of ${n})` : `${a.w} of ${n} teams`}${a.t ? `, tied ${a.t}` : ''}`;
    add('📈', 'Best week', `<b>${teamLink(a.tid)}</b> would have beaten ${beat}`, `${team(a.tid)} would have beaten ${beat}`);
  }
  return out;
}

// The address that opens this recap in the league: anyone in it can pick their team and land here
const recapUrl = (L, n) => `${location.origin}${location.pathname}?league=${encodeURIComponent(L.id)}&week=${n}#recap`;

// What Share sends: the standouts only (everyone already has the results in their league)
function recapText(L, X) {
  return [`${SPORT.emoji} ${L.name} · Week ${X.period.n} standouts`, '', ...recapItems(X).map(x => `${x.e} ${x.label}: ${x.text}`)].join('\n\n');
}

function viewRecap() {
  const L = fxLeague();
  if (!L || !NBA) return '';
  const empty = (t, m) => `<div class="card"><div class="empty"><strong>${t}</strong>${m}</div></div>`;
  if (!hasLineupHistory(L)) return empty(`No recaps for ${esc(sourceName(L))} leagues yet`, "Recaps come from each week's real lineups, which the site reads from Fantrax and Sleeper only for now.");
  // the last game day's box scores tell whether a week is over before Fantrax says so
  if (!BOX) loadBoxes().then(() => { if (ui.tab === 'recap') render(); }).catch(() => {});
  const done = finishedPeriods(L);
  if (!done.length) return empty('No finished weeks yet', 'The first recap appears once week 1 is over.');
  const period = done.find(p => p.n === ui.recapWeek) || done[done.length - 1];
  const P = pastWeeksOf(L);
  if (P.state === 'loading') return loadingCard(`Week ${period.n} recap`, `Loading the week's lineups from ${sourceName(L)}…`);
  if (P.state === 'error') return empty(`Week ${period.n} recap`, `Couldn't load the week's lineups (${esc(P.msg)}).`);
  const key = `${L.id}|${period.n}`;
  if (!recaps.has(key)) recaps.set(key, P.weeks && P.G ? buildRecap(L, P, period) : null);
  const X = recaps.get(key);
  if (!X) return empty(`Week ${period.n} recap`, `${sourceName(L)} hasn't shared this week's lineups.`);

  const me = myTeamId();
  // every finished week, newest by default: ‹ Week 2 › steps back through the earlier ones
  const picker = done.length > 1 ? stepper('recap-step', 'week', `<select class="ctx-team" data-change="recap-week" aria-label="Week">${done.map(p => `<option value="${p.n}" ${p.n === period.n ? 'selected' : ''}>Week ${p.n}</option>`).join('')}</select>`,
    { first: period.n === done[0].n, last: period.n === done[done.length - 1].n }) : '';
  const finals = X.games.map(g => `<li class="rc-final${g.a === me || g.b === me ? ' me' : ''}"><span class="rc-t${g.margin ? ' won' : ''}">${teamLink(g.a)}</span><span class="rc-score">${scoreLine(g.sc)}</span><span class="rc-t">${teamLink(g.b)}</span></li>`).join('');
  const items = recapItems(X).map(x => `<li class="rc-item"><span class="rc-e" aria-hidden="true">${x.e}</span><div><div class="rc-label">${x.label}</div>${x.html}</div></li>`).join('');
  return `<div class="card">
    <div class="card-head"><h2>Week ${period.n} standouts ${infoBtn('recap')}</h2>${picker}${items ? `<button type="button" class="btn sm primary" data-action="recap-share" data-week="${period.n}">Share</button>` : ''}</div>
    <p class="muted small rc-when">${esc(L.name)} · ${fmtDay(period.start)} – ${fmtDay(matchDates(period.start).slice(-1)[0] || period.end)} · starters only</p>
    ${items ? `<ul class="rc-items">${items}</ul>` : '<p class="muted small" style="margin:0">Nothing stood out.</p>'}
  </div>
  <div class="card"><div class="card-head"><h2>Results</h2></div>
    <ul class="rc-finals">${finals}</ul>
  </div>`;
}

// ----- The recap as a picture, for the league chat -----
// 1080 px wide, as tall as it needs: the league and week, the standouts (photos for the players), every final, the
// site's address. Drawn on a canvas from the same recap; the headshots come from the site's own sheet.
const RC_IMG = { w: 1080, pad: 64, bg: '#15171b', card: '#1f2228', line: '#2c3038', text: '#f3f4f6', muted: '#9aa3b2', accent: '#f07a2a' };
const RC_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

const loadSheet = () => new Promise(res => {
  if (!IMG || !IMG.sheet) return res(null);
  const im = new Image();
  im.onload = () => res(im);
  im.onerror = () => res(null);
  im.src = IMG.sheet;
});

// lines of text that fit the width, at the font already set, broken between words (or between stats: sep ' · ')
function wrapText(ctx, text, max, sep = ' ') {
  const lines = [];
  let cur = '';
  for (const w of String(text).split(sep)) {
    const next = cur ? `${cur}${sep}${w}` : w;
    if (cur && ctx.measureText(next).width > max) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}
// one line, cut with … to fit
function fitText(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text;
  let t = String(text);
  while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t.trimEnd() + '…';
}

async function recapCanvas(L, X) {
  const C = RC_IMG, W = C.w, inner = W - C.pad * 2, sheet = await loadSheet();
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = 5000;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, cv.height);
  ctx.textBaseline = 'top';
  const font = (px, weight = 400) => { ctx.font = `${weight} ${px}px ${RC_FONT}`; };
  const text = (t, x, y, color = C.text, align = 'left') => { ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(t, x, y); };
  const round = (x, y, w, h, r, color) => { ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill(); };
  // a player's photo in a ring of his NBA team's colors (as on the site); his initials without one
  const photo = (p, x, y, d) => {
    const raw = nbaById.get(p.nbaId), tc = TEAM_COLORS[raw && raw.team], cx = x + d / 2, cy = y + d / 2, i = IMG_INDEX.get(p.nbaId);
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, d / 2, 0, Math.PI * 2); ctx.fillStyle = C.line; ctx.fill(); ctx.clip();
    if (sheet && i !== undefined) ctx.drawImage(sheet, (i % IMG.cols) * IMG.size, Math.floor(i / IMG.cols) * IMG.size, IMG.size, IMG.size, x, y, d, d);
    else { font(d * 0.36, 700); ctx.textBaseline = 'middle'; text(initials(p.name), cx, cy, C.muted, 'center'); ctx.textBaseline = 'top'; }
    ctx.restore();
    if (tc) {
      ctx.lineWidth = 5;
      const a0 = (240 - 90) * Math.PI / 180;
      for (const [c, from, to] of [[tc[0], 0, 2 / 3], [tc[1], 2 / 3, 1]]) {
        ctx.strokeStyle = c; ctx.beginPath(); ctx.arc(cx, cy, d / 2 - 2.5, a0 + from * Math.PI * 2, a0 + to * Math.PI * 2); ctx.stroke();
      }
    }
  };

  let y = C.pad;
  // the top: week, league, days
  font(28, 800); text(`WEEK ${X.period.n} RECAP`, C.pad, y, C.accent); y += 44;
  font(58, 800);
  for (const l of wrapText(ctx, L.name, inner).slice(0, 2)) { text(l, C.pad, y); y += 70; }
  font(30); text(`${fmtDay(X.period.start)} – ${fmtDay(matchDates(X.period.start).slice(-1)[0] || X.period.end)}`, C.pad, y, C.muted); y += 64;

  // the standouts, each in a card
  for (const it of recapItems(X)) {
    const d = it.p ? 112 : 0, tx = C.pad + 32 + (d ? d + 28 : 0), tw = W - C.pad - 32 - tx;
    let body;
    if (it.p) {
      font(40, 800); const name = fitText(ctx, it.p.name, tw);
      font(28); const team = fitText(ctx, fxTeamName(it.tid), tw);
      font(27); const stats = wrapText(ctx, it.stats, tw, ' · ');
      body = { name, team, stats, h: 44 + 50 + 42 + stats.length * 38 };
    } else {
      font(32, 500); const lines = wrapText(ctx, it.text, tw);
      body = { lines, h: 44 + 4 + lines.length * 44 };
    }
    const h = Math.max(body.h, d) + 56;
    round(C.pad, y, inner, h, 24, C.card);
    let ty = y + 28;
    if (d) photo(it.p, C.pad + 32, y + (h - d) / 2, d);
    font(26, 800); text(`${it.e}  ${it.label.toUpperCase()}`, tx, ty, C.accent); ty += 44;
    if (it.p) {
      font(40, 800); text(body.name, tx, ty); ty += 50;
      font(28); text(body.team, tx, ty, C.muted); ty += 42;
      font(27); for (const l of body.stats) { text(l, tx, ty, '#d5d9e0'); ty += 38; }
    } else { ty += 4; font(32, 500); for (const l of body.lines) { text(l, tx, ty); ty += 44; } }
    y += h + 20;
  }

  // every final, winner on the left in bold
  y += 28;
  font(28, 800); text('RESULTS', C.pad, y, C.accent); y += 52;
  for (const g of X.games) {
    font(34, 800); const colW = (inner - 64 - ctx.measureText(scoreLine(g.sc)).width - 48) / 2; // the names share what the score leaves
    round(C.pad, y, inner, 76, 18, C.card);
    font(31, g.margin ? 800 : 500); text(fitText(ctx, fxTeamName(g.a), colW), C.pad + 32, y + 21);
    font(34, 800); text(scoreLine(g.sc), W / 2, y + 19, C.accent, 'center');
    font(31, 500); text(fitText(ctx, fxTeamName(g.b), colW), W - C.pad - 32, y + 21, C.muted, 'right');
    y += 88;
  }

  // the bottom: where it came from
  y += 32;
  ctx.fillStyle = C.line; ctx.fillRect(C.pad, y, inner, 2); y += 30;
  font(30, 800); text('League Layer', C.pad, y, C.text);
  font(28); text('leaguelayer.com', W - C.pad, y + 2, C.muted, 'right');
  y += 40 + C.pad - 10;

  const out = document.createElement('canvas');
  out.width = W; out.height = Math.ceil(y);
  out.getContext('2d').drawImage(cv, 0, 0);
  return out;
}

const recapBlob = cv => new Promise(res => cv.toBlob(res, 'image/png'));
const recapFileName = (L, X) => `${L.name.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'league'}-week-${X.period.n}.png`;

// The popup: the picture, then Share (the share sheet, with the picture, where the browser can), Copy, Save, or the
// text and link as before
function recapSharePopup(L, X, url) {
  const canFiles = !!(navigator.canShare && navigator.share);
  return `<img class="rc-img" src="${url}" alt="Week ${X.period.n} recap for ${esc(L.name)}">
    <div class="fb-actions">
      ${canFiles ? `<button type="button" class="btn primary" data-action="recap-img-share" data-week="${X.period.n}">Share image</button>` : ''}
      ${window.ClipboardItem ? `<button type="button" class="btn${canFiles ? '' : ' primary'}" data-action="recap-img-copy">Copy image</button>` : ''}
      <a class="btn" href="${url}" download="${esc(recapFileName(L, X))}">Save image</a>
      <button type="button" class="btn" data-action="recap-text" data-week="${X.period.n}">Copy text and link</button>
    </div>`;
}

// A week that ended in the last three days: offered on the Dashboard
function freshRecap(L = fxLeague()) {
  if (!L || !hasLineupHistory(L)) return null;
  const p = finishedPeriods(L).pop();
  return p && Date.now() - fxTime(p.endAt) < 3 * 864e5 ? p : null;
}
