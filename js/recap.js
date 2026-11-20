// League Layer: the weekly recap: every matchup's result and the week's standouts, to share with the league.
// The site loads js/*.js in order (see index.html); they share one scope, like one file.
'use strict';

// ----- Weekly recap -----
// A finished week across the whole league, counted from the week's real lineups and box scores as How week N ended
// counts one matchup: every final, then the standouts. Fantrax, Sleeper and ESPN basketball leagues (hasWeekLineups);
// in Sleeper's one-game weeks a starter's week is the game that counted, so Player of the period is the best such game.
const recaps = new Map(); // "league|period" -> recap, or null when the week's lineups aren't there
keep('box league', id => dropKept(recaps, id));

// weeks whose games are all played (a Fantrax week ends officially when the next locks, a day after its last games)
const finishedPeriods = L => (L.periods || []).filter(p => periodOver(p) && ((L.matchups || {})[String(p.n)] || []).length);

// A game's or a week's full line in the league's own categories (a week per game; shooting as makes/attempts, a
// week's with its %), minutes first
function fullLine(s, perGame) {
  if (isFootball()) { const w = footballWords(s, perGame ? s.gp1 || 1 : 1); return w.length ? w : ['played, no stats']; }
  return lineTiles(s, perGame).map(t => (t.made != null ? `${t.made} ${t.k.replace('%', '')}${perGame && t.att ? ` (${fmtPct(t.pct)})` : ''}` : `${t.v} ${t.k}`));
}
// The same line as numbers and their labels (the share pictures' tiles): { v, k }, a percentage also { made: makes/attempts,
// att, pct }; a points league's shooting pair one { v: "5/12", k: "FG" } (lineCats); null in football (its lines are words)
function lineTiles(s, perGame) {
  if (isFootball()) return null;
  const g = perGame ? s.gp1 || 1 : 1, v = (k, d) => fmt(lineStat(s, k) / g, perGame ? 1 : d);
  const out = [{ v: v('min', 0), k: 'MIN' }];
  const goalie = isHockey() && !!(s.sa || s.gs); // hockey: a skater's line or a goalie's, not both
  for (const c of lineCats()) {
    if (c.fp || (isHockey() && SPORT.goalieCats.includes(c.key) !== goalie)) continue;
    if (c.shot) out.push({ v: `${v(c.made, 0)}/${v(c.att, 0)}`, k: c.label });
    else if (c.rate) out.push({ v: fmt(s[c.att] ? (s[c.made] || 0) / s[c.att] : 0, 2), k: c.label });
    else if (c.pct) {
      const m = s[c.made] || 0, a = s[c.att] || 0;
      out.push({ v: a ? (m / a).toFixed(3).replace(/^0/, '') : '—', k: c.label, made: `${fmt(m / g, perGame ? 1 : 0)}/${fmt(a / g, perGame ? 1 : 0)}`, att: a, pct: a ? m / a : 0 });
    } else out.push({ v: v(c.key, 0), k: c.label });
  }
  return out;
}

// what a standout's card shows of his line (the tab's, the picture's), kept short (the owner's ask, Nov 2026): not his
// minutes, and a week's percentages without makes/attempts a game (a game's keep theirs: "17/30")
const cardTiles = (tiles, per) => tiles.filter(t => t.k !== 'MIN').map(t => (per && t.made ? { ...t, made: '' } : t));

function buildRecap(L, P, period) {
  const pairs = L.matchups[String(period.n)].filter(m => m.length === 2);
  const R = benchSwaps({ ...L, fidNba: currentFidNba() }, P.G, P.weeks, period, pairs.flat());
  if (!R) return null;
  const by = new Map(R.map(x => [x.tid, x]));
  const outcome = sc => Math.sign(Math.round((sc.me - sc.opp) * 10));
  // Sleeper basketball: the winners are Sleeper's own, and a week whose real scores the site hasn't seen is estimated
  // from its final lineups (benchSwaps): its scores marked, and nothing that hangs on a close score told
  const est = weekEstimated(R);
  // the finals, winner first
  const games = pairs.map(([a, b]) => {
    let sc = weekScore(by.get(a).tot, by.get(b).tot);
    const res = by.get(a).res;
    if (res ? res === 'L' : outcome(sc) < 0) { [a, b] = [b, a]; sc = weekScore(by.get(a).tot, by.get(b).tot); }
    return { a, b, sc: est ? { ...sc, est: true } : sc, margin: sc.me - sc.opp, won: res ? res !== 'T' : !!outcome(sc) };
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
  // the week's top and bottom teams, crowned and pooped in the results: points leagues by score, category leagues by the
  // all-play record (the week against every other team's); a tie marks each. { top, bottom: [tid], score/rec: tid -> }
  let rank = null;
  if (R.length > 2) {
    const val = new Map(isPoints() ? R.map(S => [S.tid, lineFp(S.tot)]) : allPlay.map(a => [a.tid, a.w + a.t / 2]));
    const hi = Math.max(...val.values()), lo = Math.min(...val.values()), at = v => [...val].filter(([, x]) => Math.abs(x - v) < 1e-9).map(([t]) => t);
    if (hi > lo) rank = { top: at(hi), bottom: at(lo), score: Object.fromEntries(val), rec: Object.fromEntries(allPlay.map(a => [a.tid, a])) };
  }
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
  // Hockey: the best goalie's week (when Player of the period isn't one), and every starter's three-goal game
  const isGoalie = line => !!(line.sa || line.gs);
  const goalie = isHockey() ? best(weeks.filter(x => isGoalie(x.line)), x => x.v) : null;
  const mvp = best(weeks, x => x.v);
  // Football: the best team defense started
  const defense = isFootball() ? best(weeks.filter(x => x.p.pos[0] === 'DEF'), x => x.v) : null;
  if (est) { pointsBits = {}; regret = null; rank = null; }
  return {
    ...pointsBits, est,
    goalie: goalie && goalie !== mvp ? goalie : null,
    hats: isHockey() ? single.filter(x => !isGoalie(x.line) && lineStat(x.line, 'g') >= 3) : [],
    defense: defense && defense !== mvp ? defense : null,
    period, games: order,
    mvp,
    game: L.oneGame ? null : best(single, x => x.v), // one-game weeks: the player of the period's game
    // the least a starter did a game over the week, among those with 2 or more games (one short night isn't a week)
    brick: L.oneGame ? null : best(weeks.filter(x => x.line.gp1 >= 2), x => -x.v / x.line.gp1),
    dud: best(single, x => -x.v), // the single worst game
    // the most games missed; a tie lists up to three (the ones whose team played least first) and counts the rest
    missed: most ? missedBy.filter(x => x.games === most).sort((a, b) => a.sched - b.sched) : [],
    regret,
    allPlay: best(allPlay, x => x.w + x.t / 2),
    teams: R.length,
    rank,
  };
}

// The week's top and bottom team in the results (and the picture's): 'top', 'bottom' or '' (a badge, Best or Worst: no
// emoji in the recap, the owner's ask), and why, for its tooltip
const recapMark = (X, tid) => (!X.rank ? '' : X.rank.top.includes(tid) ? 'top' : X.rank.bottom.includes(tid) ? 'bottom' : '');
const RECAP_MARK = { top: 'Best', bottom: 'Worst' }; // (the owner's words)
function recapMarkTip(X, tid) {
  const top = X.rank.top.includes(tid);
  if (isPoints()) return `${top ? 'Most' : 'Fewest'} points this period: ${fmtFp(X.rank.score[tid])}`;
  const a = X.rank.rec[tid];
  return `${top ? 'Best' : 'Worst'} period in the league: ${a.w}-${a.l}${a.t ? `-${a.t}` : ''} against every other team`;
}

// (≈: a Sleeper week the site could only estimate, buildRecap)
const scoreLine = sc => (sc.est ? '≈ ' : '') + (isPoints() ? `${fmtFp(sc.me)}–${fmtFp(sc.opp)}` : `${sc.me}–${sc.opp}${sc.ties ? `–${sc.ties}` : ''}`);

// The standouts as { label, html, text for sharing } (no emoji, the owner's ask); a player's instead { label, text, p, tid,
// stats (his line in words), tiles (lineTiles), per (the games a week's line is a game of), score: [value or points, unit] },
// drawn as a card with his photo; one naming players also { faces }. Names in a line are plain links, in line with the text.
function recapItems(X) {
  const team = tid => fxTeamName(tid);
  const out = [];
  const add = (label, html, text, more) => out.push({ label, html, text, ...more });
  const name = (p, bold) => playerBtn(p.nbaId, p.name, bold ? `<b>${esc(nameShown(p.name, p.nbaId))}</b>` : undefined);
  const unit = isPoints() ? 'FP' : 'value';
  const stand = (label, x, perGame) => {
    const parts = fullLine(x.line, perGame), head = perGame ? `${x.line.gp1} G, per game: ` : '';
    add(label, '', `${x.p.name} (${team(x.tid)}): ${head}${parts.join(', ')}`, { p: x.p, tid: x.tid, stats: `${head}${parts.join(' · ')}`,
      tiles: lineTiles(x.line, perGame), per: perGame ? x.line.gp1 : 0, score: [isPoints() && !perGame ? fmtFp(x.v) : fmtValue(x.v, perGame ? 1 : 2), unit] });
  };
  if (X.mvp) stand('Player of the period', X.mvp, !isOneGame());
  if (X.goalie) stand('Goalie of the period', X.goalie, true);
  if (X.defense) stand('Defense of the period', X.defense, false);
  if (X.game) stand('Game of the period', X.game, false);
  if (X.brick) stand('Worst period', X.brick, true);
  if (X.dud) stand('Worst game', X.dud, false);
  if (X.missed && X.missed.length) {
    // nobody's photo: names in line with the text, as the others
    const who = (x, html) => (html ? `${name({ nbaId: x.nba, name: x.name }, true)} <span class="muted">${teamLink(x.tid)}</span>` : `${x.name} (${team(x.tid)})`);
    const g = X.missed[0].games, shown = X.missed.slice(0, 3), more = X.missed.length - shown.length;
    const list = html => shown.map(x => who(x, html)).join(', ') + (more ? ` and ${more} other${more === 1 ? '' : 's'}` : '');
    const tail = isOneGame() ? (X.missed.length > 1 ? 'each started without playing a game' : 'started without playing a game')
      : X.missed.length > 1 ? `each missed ${g} game${g === 1 ? '' : 's'} while starting` : `missed ${g} of ${X.missed[0].sched} games while starting`;
    add('Street clothes', `${list(true)} ${tail}`, `${list(false)} ${tail}`, { faces: shown.map(x => ({ nbaId: x.nba, name: x.name })) });
  }
  if (X.regret) {
    const r = X.regret, o = Math.sign(Math.round((r.sc.me - r.sc.opp) * 10)), res = o > 0 ? 'won' : 'tied';
    add('Bench regret', `<b>${teamLink(r.tid)}</b>: starting ${name(r.w.inP)} over ${name(r.w.outP)} would have ${res} ${scoreLine(r.sc)}`,
      `${team(r.tid)}: starting ${r.w.inP.name} over ${r.w.outP.name} would have ${res} ${scoreLine(r.sc)}`, { faces: [r.w.inP, r.w.outP] });
  }
  if (X.hats && X.hats.length) {
    const who = html => X.hats.map(x => (html ? `${name(x.p, true)} <span class="muted">${teamLink(x.tid)}</span>` : `${x.p.name} (${team(x.tid)})`)).join(', ');
    const tail = X.hats.length > 1 ? 'each scored three goals in a game' : `scored ${fmt(lineStat(X.hats[0].line, 'g'), 0)} goals in a game`;
    add('Hat trick', `${who(true)} ${tail}`, `${who(false)} ${tail}`, { faces: X.hats.map(x => x.p) });
  }
  if (X.carry) {
    const c = X.carry, pct = Math.round(c.share * 100);
    add('Carried', `${name(c.p, true)} scored ${fmtFp(c.pts)} of <b>${teamLink(c.tid)}</b>'s ${fmtFp(c.of)} (${pct}%)`,
      `${c.p.name} scored ${fmtFp(c.pts)} of ${team(c.tid)}'s ${fmtFp(c.of)} (${pct}%)`, { faces: [c.p] });
  }
  const final = g => `${fmtFp(g.sc.me)}–${fmtFp(g.sc.opp)}`;
  if (X.unlucky) {
    const g = X.unlucky, said = `scored ${fmtFp(g.sc.opp)}, the ${g.place === 1 ? 'most' : ordinal(g.place) + ' most'} in the league, and still lost`;
    add('Tough luck', `<b>${teamLink(g.b)}</b> ${said} to ${teamLink(g.a)} ${final(g)}`, `${team(g.b)} ${said} to ${team(g.a)} ${final(g)}`);
  }
  if (X.lucky) {
    const g = X.lucky, said = `won with ${fmtFp(g.sc.me)}, the ${g.place === X.teams ? 'fewest' : ordinal(g.place) + ' most'} in the league`;
    add('Lucky win', `<b>${teamLink(g.a)}</b> ${said}, over ${teamLink(g.b)} ${final(g)}`, `${team(g.a)} ${said}, over ${team(g.b)} ${final(g)}`);
  }
  if (X.close) {
    const g = X.close, by = `by ${fmt(g.margin, g.margin < 1 ? 2 : 1)}`;
    add('Nail-biter', `<b>${teamLink(g.a)}</b> beat ${teamLink(g.b)} ${final(g)}, ${by}`, `${team(g.a)} beat ${team(g.b)} ${final(g)}, ${by}`);
  }
  // Best period: a category week is hard to read from the finals; a points week is just the top score, there for all to see
  if (X.allPlay && X.teams > 2 && !isPoints()) {
    // matchups won against every other team's week, not categories
    const a = X.allPlay, n = X.teams - 1;
    const beat = `${a.w === n ? `every other team (${n} of ${n})` : `${a.w} of ${n} teams`}${a.t ? `, tied ${a.t}` : ''}`;
    add('Best period', `<b>${teamLink(a.tid)}</b> would have beaten ${beat}`, `${team(a.tid)} would have beaten ${beat}`);
  }
  return out;
}

// The address that opens this recap in the league: anyone in it can pick their team and land here
const recapUrl = (L, n) => `${location.origin}${location.pathname}?league=${encodeURIComponent(L.id)}&period=${n}#recap`;

// What Share sends: the standouts only (everyone already has the results in their league)
function recapText(L, X) {
  return [`${L.name} · Period ${X.period.n} recap`, '', ...recapItems(X).map(x => `${x.label}: ${x.text}`)].join('\n\n');
}

// A standout on the Recap tab or the Draft Retrospective: a player award the award, his name (one initial: "T. Maxey") with
// his fantasy team after it, his numbers (his value or points first, then the league's stats, not minutes; a week's "4 G,
// per game" beside the award) or the award's words, kept short (the owner's ask, Nov 2026: no NBA team or positions, his photo's logo shows
// the team); any other the award and its line, with the faces of the players it names (or its flags: Passport's, a row a team; or its real teams' logos: a tied Homer's), and any aside under its line in
// the lighter text (a team award's standout player: "Quickest: Hart (5 s)"). Every face the small round photo on the right, a player award's too (the owner's ask, Nov
// 2026; the share picture, shareCanvas, is laid out the same). label: the award's title as HTML (the Draft tab's opens its
// breakdown)
const standoutFaces = faces => `<div class="rx-faces">${faces.map(f => headshot(f, hsPx(44, 36))).join('')}</div>`;
function standoutCard(x, label = `<div class="rx-label"><span class="rx-award">${x.label}</span>${x.tiles && x.per ? ` <span class="rx-per">· ${x.per} G, per game</span>` : ''}</div>`) {
  if (!x.p) {
    const faces = (x.faces || []).filter(f => f && f.nbaId != null).slice(0, 3);
    const flags = (x.flags || []).filter(r => r.length), logos = (x.logos || []).filter(t => IMG && IMG.logos[t]).slice(0, 3); // (only logos the site has)
    return `<article class="rx-card rx-note"><div class="rx-body">${label}<div class="rx-text">${x.html}</div>${x.aside ? `<div class="rx-aside">${x.aside}</div>` : ''}</div>`
      + `${faces.length ? standoutFaces(faces) : ''}${flags.length ? `<div class="rx-flags">${flags.map(r => `<div>${r.map(flagImg).join('')}</div>`).join('')}</div>` : ''}`
      + `${logos.length ? `<div class="rx-logos">${logos.map(t => teamLogo(t, hsPx(44, 36))).join('')}</div>` : ''}</article>`;
  }
  const stats = x.tiles
    ? [[x.score[0], x.score[1], isBelowZero(x.score[0]) ? 'pos-bad' : ''], ...cardTiles(x.tiles, x.per).map(t => [t.v, `${t.k}${t.made ? ` ${t.made}` : ''}`, ''])]
      .map(([v, k, cls]) => `<span><b${cls ? ` class="${cls}"` : ''}>${esc(v)}</b> ${esc(k)}</span>`).join('')
    : `<span class="rx-words">${esc(x.stats)}</span>`; // (football's line, a draft award's: words)
  return `<article class="rx-card rx-player"><div class="rx-body">
    ${label}
    <div class="rx-name">${playerBtn(x.p.nbaId, x.p.name, esc(nameShown(x.p.name, x.p.nbaId, 'short')))}<span class="rx-team">${teamLink(x.tid)}</span></div>
    <div class="rx-stats">${stats}</div>
  </div>${standoutFaces([x.p])}</article>`;
}

function viewRecap() {
  const L = fxLeague();
  if (!L || !NBA) return '';
  const empty = (t, m) => `<div class="card"><div class="empty"><strong>${t}</strong>${m}</div></div>`;
  if (!hasWeekLineups(L)) return empty(`No recaps for ${esc(sourceName(L))}${isFootball() ? ' football' : ''} leagues yet`, "Recaps come from each period's real lineups, which the site doesn't read from those yet.");
  // the last game day's box scores tell whether a week is over before Fantrax says so
  if (!BOX) loadBoxes().then(() => { if (ui.tab === 'recap') render(); }).catch(() => {});
  else fillWeekFromEspn(L); // (the night a week ends, its last games from ESPN before the daily job saves them)
  const done = finishedPeriods(L);
  // (a league that starts late begins at ESPN's matchup for that week, not 1; a roto league has no weekly matchups)
  const first = Math.min(...(L.periods || []).map(p => p.n));
  if (!done.length) return empty('No finished periods yet', isFinite(first) ? `The first recap appears once period ${first} is over.` : 'This league has no weekly matchups to recap.');
  const period = done.find(p => p.n === ui.recapWeek) || done[done.length - 1];
  const P = pastWeeksOf(L, period);
  if (P.state === 'loading') return loadingCard(`Period ${period.n} recap`, `Loading the period's lineups from ${sourceName(L)}…`);
  if (P.state === 'error') return empty(`Period ${period.n} recap`, `Couldn't load the period's lineups (${esc(P.msg)}).`);
  const key = `${L.id}|${period.n}`;
  if (!recaps.has(key)) recaps.set(key, P.weeks && P.G ? buildRecap(L, P, period) : null);
  const X = recaps.get(key);
  if (!X) return empty(`Period ${period.n} recap`, `${sourceName(L)} hasn't shared this period's lineups.`);

  const me = myTeamId();
  // every finished period, newest by default: ‹ Period 2 › steps back through the earlier ones
  const picker = done.length > 1 ? stepper('recap-step', 'period', `<select class="ctx-team" data-change="recap-week" aria-label="Period">${done.map(p => `<option value="${p.n}" ${p.n === period.n ? 'selected' : ''}>Period ${p.n}</option>`).join('')}</select>`,
    { first: period.n === done[0].n, last: period.n === done[done.length - 1].n }) : '';
  // the finals, the week's top and bottom teams marked on the row's outer edge (before the left team, after the right)
  const mark = tid => { const k = recapMark(X, tid); return k ? `<span class="rc-badge rc-${k}" title="${esc(recapMarkTip(X, tid))}">${RECAP_MARK[k]}</span>` : ''; };
  const finals = X.games.map(g => `<li class="rc-final${g.a === me || g.b === me ? ' me' : ''}"><span class="rc-t${g.won ? ' won' : ''}">${mark(g.a)}${teamLink(g.a)}</span><span class="rc-score">${scoreLine(g.sc)}</span><span class="rc-t">${teamLink(g.b)}${mark(g.b)}</span></li>`).join('');
  const items = recapItems(X).map(x => standoutCard(x)).join('');
  return `<div class="card">
    <div class="card-head"><h2>Period ${period.n} recap ${infoBtn('recap')}</h2>${picker}${items ? shareBtn('recap-share', ` data-week="${period.n}"`) : ''}</div>
    ${items ? `<div class="rx-grid">${items}</div>` : '<p class="muted small" style="margin:0">Nothing stood out.</p>'}
  </div>
  <div class="card"><div class="card-head"><h2>Results</h2></div>
    <ul class="rc-finals">${finals}</ul>
    ${X.est ? `<p class="muted small" style="margin:8px 0 0">≈ estimated: Sleeper doesn't share this period's scores. The winners are Sleeper's. ${infoBtn('slpScores')}</p>` : ''}
  </div>`;
}

// ----- The recap's picture and its share (share.js draws and shares them) -----
// The picture of a week's recap: its standouts, then every final (no dates under the league's name: kept short, the owner's ask)
const recapCanvas = (L, X) => shareCanvas({
  kicker: `PERIOD ${X.period.n} RECAP`, title: L.name, items: recapItems(X), games: X.games, mark: tid => recapMark(X, tid),
});
const recapFileName = (L, X) => `${L.name.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'league'}-period-${X.period.n}.png`;
// The Recap's share (shareWith, share.js)
const recapShare = (L, X) => ({
  title: `Period ${X.period.n} recap`, name: `${L.name} · Period ${X.period.n} recap`, what: 'Recap', link: 'Full recap',
  text: recapText(L, X), url: recapUrl(L, X.period.n), file: recapFileName(L, X), alt: `Period ${X.period.n} recap for ${L.name}`,
  draw: () => recapCanvas(L, X),
});
