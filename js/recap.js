// League Layer: the weekly recap: every matchup's result and the week's standouts, to share with the league.
// The site loads js/*.js in order (see index.html); they share one scope, like one file.
'use strict';

// ----- Weekly recap -----
// A finished week across the whole league, counted from the week's real lineups and box scores as How week N ended
// counts one matchup: every final, then the standouts. Fantrax, Sleeper and ESPN basketball leagues (hasWeekLineups);
// in Sleeper's one-game weeks a starter's week is the game that counted, so Player of the week is the best such game.
const recaps = new Map(); // "league|period" -> recap, or null when the week's lineups aren't there
keep('box league', id => dropKept(recaps, id));

// weeks whose games are all played (a Fantrax week ends officially when the next locks, a day after its last games)
const finishedPeriods = L => (L.periods || []).filter(p => periodOver(p) && ((L.matchups || {})[String(p.n)] || []).length);

// A game's or a week's full line in the league's own categories (a week per game; shooting as makes-attempts, a
// week's with its %), minutes first
function fullLine(s, perGame) {
  if (isFootball()) { const w = footballWords(s, perGame ? s.gp1 || 1 : 1); return w.length ? w : ['played, no stats']; }
  return lineTiles(s, perGame).map(t => (t.made != null ? `${t.made} ${t.k.replace('%', '')}${perGame && t.att ? ` (${fmtPct(t.pct)})` : ''}` : `${t.v} ${t.k}`));
}
// The same line as numbers and their labels (the share pictures' tiles): { v, k }, a percentage also { made: makes-attempts,
// att, pct }; null in football (its lines are words)
function lineTiles(s, perGame) {
  if (isFootball()) return null;
  const g = perGame ? s.gp1 || 1 : 1, v = (k, d) => fmt(lineStat(s, k) / g, perGame ? 1 : d);
  const out = [{ v: v('min', 0), k: 'MIN' }];
  const goalie = isHockey() && !!(s.sa || s.gs); // hockey: a skater's line or a goalie's, not both
  for (const c of scoreCats()) {
    if (c.fp || (isHockey() && SPORT.goalieCats.includes(c.key) !== goalie)) continue;
    if (c.rate) out.push({ v: fmt(s[c.att] ? (s[c.made] || 0) / s[c.att] : 0, 2), k: c.label });
    else if (c.pct) {
      const m = s[c.made] || 0, a = s[c.att] || 0;
      out.push({ v: a ? (m / a).toFixed(3).replace(/^0/, '') : '—', k: c.label, made: `${fmt(m / g, perGame ? 1 : 0)}-${fmt(a / g, perGame ? 1 : 0)}`, att: a, pct: a ? m / a : 0 });
    } else out.push({ v: v(c.key, c.dec || 0), k: c.label });
  }
  return out;
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
    rank,
  };
}

// The week's top and bottom team in the results (and the picture's): 'top', 'bottom' or '' (a badge, Top or Bottom: no
// emoji in the recap, the owner's ask), and why, for its tooltip
const recapMark = (X, tid) => (!X.rank ? '' : X.rank.top.includes(tid) ? 'top' : X.rank.bottom.includes(tid) ? 'bottom' : '');
const RECAP_MARK = { top: 'Top', bottom: 'Bottom' };
function recapMarkTip(X, tid) {
  const top = X.rank.top.includes(tid);
  if (isPoints()) return `${top ? 'Most' : 'Fewest'} points this week: ${fmtFp(X.rank.score[tid])}`;
  const a = X.rank.rec[tid];
  return `${top ? 'Best' : 'Worst'} week in the league: ${a.w}-${a.l}${a.t ? `-${a.t}` : ''} against every other team`;
}

const scoreLine = sc => (isPoints() ? `${fmtFp(sc.me)}–${fmtFp(sc.opp)}` : `${sc.me}–${sc.opp}${sc.ties ? `–${sc.ties}` : ''}`);

// The standouts as { label, html, text for sharing } (no emoji, the owner's ask); a player's instead { label, text, p, tid,
// stats (his line in words), tiles (lineTiles), per (the games a week's line is a game of), score: [value or points, unit] },
// drawn as a card with his photo; one naming players also { faces }. Names in a line are plain links, in line with the text.
function recapItems(X) {
  const team = tid => fxTeamName(tid);
  const out = [];
  const add = (label, html, text, more) => out.push({ label, html, text, ...more });
  const name = (p, bold) => `<button class="link-btn pname" data-action="player-detail" data-nba="${p.nbaId}">${bold ? `<b>${esc(p.name)}</b>` : esc(p.name)}</button>`;
  const unit = isPoints() ? 'FP' : 'value';
  const stand = (label, x, perGame) => {
    const parts = fullLine(x.line, perGame), head = perGame ? `${x.line.gp1} G, per game: ` : '';
    add(label, '', `${x.p.name} (${team(x.tid)}): ${head}${parts.join(', ')}`, { p: x.p, tid: x.tid, stats: `${head}${parts.join(' · ')}`,
      tiles: lineTiles(x.line, perGame), per: perGame ? x.line.gp1 : 0, score: [isPoints() && !perGame ? fmtFp(x.v) : fmtValue(x.v, perGame ? 1 : 2), unit] });
  };
  if (X.mvp) stand('Player of the week', X.mvp, !isOneGame());
  if (X.goalie) stand('Goalie of the week', X.goalie, true);
  if (X.defense) stand('Defense of the week', X.defense, false);
  if (X.game) stand('Game of the week', X.game, false);
  if (X.brick) stand('Worst week', X.brick, true);
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
  // Best week: a category week is hard to read from the finals; a points week is just the top score, there for all to see
  if (X.allPlay && X.teams > 2 && !isPoints()) {
    // matchups won against every other team's week, not categories
    const a = X.allPlay, n = X.teams - 1;
    const beat = `${a.w === n ? `every other team (${n} of ${n})` : `${a.w} of ${n} teams`}${a.t ? `, tied ${a.t}` : ''}`;
    add('Best week', `<b>${teamLink(a.tid)}</b> would have beaten ${beat}`, `${team(a.tid)} would have beaten ${beat}`);
  }
  return out;
}

// The address that opens this recap in the league: anyone in it can pick their team and land here
const recapUrl = (L, n) => `${location.origin}${location.pathname}?league=${encodeURIComponent(L.id)}&week=${n}#recap`;

// What Share sends: the standouts only (everyone already has the results in their league)
function recapText(L, X) {
  return [`${L.name} · Period ${X.period.n} recap`, '', ...recapItems(X).map(x => `${x.label}: ${x.text}`)].join('\n\n');
}

// A standout on the Recap tab, as the share picture draws it (the owner's ask: the tab matches the picture): a player
// beside his photo on his team's color (the player card's playerPhoto), the award, his name, his fantasy team, his NBA team
// and positions, his numbers (his value or points first); any other the award and its line, with the faces of the players
// it names
function recapCard(x) {
  if (!x.p) {
    const faces = (x.faces || []).filter(f => f && f.nbaId != null).slice(0, 3);
    return `<article class="rx-card rx-note"><div class="rx-body"><div class="rx-label">${x.label}</div><div class="rx-text">${x.html}</div></div>`
      + `${faces.length ? `<div class="rx-faces">${faces.map(f => headshot(f, hsPx(44, 36))).join('')}</div>` : ''}</article>`;
  }
  const raw = nbaById.get(x.p.nbaId) || { id: x.p.nbaId, name: x.p.name }, pos = x.p.pos || raw.pos || [];
  const stats = x.tiles
    ? [[x.score[0], x.score[1], isBelowZero(x.score[0]) ? 'pos-bad' : ''], ...x.tiles.map(t => [t.v, `${t.k}${t.made ? ` ${t.made}` : ''}`, ''])]
      .map(([v, k, cls]) => `<span><b${cls ? ` class="${cls}"` : ''}>${esc(v)}</b> ${esc(k)}</span>`).join('')
    : `<span class="rx-words">${esc(x.stats)}</span>`; // (football: its line in words)
  return `<article class="rx-card rx-player">${playerPhoto(raw, 'rx-ph')}<div class="rx-body">
    <div class="rx-label">${x.label}</div>
    <div class="rx-name">${playerBtn(x.p.nbaId, x.p.name)}</div>
    <div class="rx-team">${teamLink(x.tid)}</div>
    <div class="rx-meta">${raw.team ? teamBtn(raw.team) : 'FA'}${pos.length ? ` · ${posTags(pos)}` : ''}${x.per ? ` · ${x.per} G, per game` : ''}</div>
    <div class="rx-stats">${stats}</div>
  </div></article>`;
}

function viewRecap() {
  const L = fxLeague();
  if (!L || !NBA) return '';
  const empty = (t, m) => `<div class="card"><div class="empty"><strong>${t}</strong>${m}</div></div>`;
  if (!hasWeekLineups(L)) return empty(`No recaps for ${esc(sourceName(L))}${isFootball() ? ' football' : ''} leagues yet`, "Recaps come from each week's real lineups, which the site doesn't read from those yet.");
  // the last game day's box scores tell whether a week is over before Fantrax says so
  if (!BOX) loadBoxes().then(() => { if (ui.tab === 'recap') render(); }).catch(() => {});
  else fillWeekFromEspn(L); // (the night a week ends, its last games from ESPN before the daily job saves them)
  const done = finishedPeriods(L);
  if (!done.length) return empty('No finished periods yet', 'The first recap appears once period 1 is over.');
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
  const picker = done.length > 1 ? stepper('recap-step', 'week', `<select class="ctx-team" data-change="recap-week" aria-label="Period">${done.map(p => `<option value="${p.n}" ${p.n === period.n ? 'selected' : ''}>Period ${p.n}</option>`).join('')}</select>`,
    { first: period.n === done[0].n, last: period.n === done[done.length - 1].n }) : '';
  // the finals, the week's top and bottom teams marked on the row's outer edge (before the left team, after the right)
  const mark = tid => { const k = recapMark(X, tid); return k ? `<span class="rc-badge rc-${k}" title="${esc(recapMarkTip(X, tid))}">${RECAP_MARK[k]}</span>` : ''; };
  const finals = X.games.map(g => `<li class="rc-final${g.a === me || g.b === me ? ' me' : ''}"><span class="rc-t${g.margin ? ' won' : ''}">${mark(g.a)}${teamLink(g.a)}</span><span class="rc-score">${scoreLine(g.sc)}</span><span class="rc-t">${teamLink(g.b)}${mark(g.b)}</span></li>`).join('');
  const items = recapItems(X).map(recapCard).join('');
  return `<div class="card">
    <div class="card-head"><h2>Period ${period.n} recap ${infoBtn('recap')}</h2>${picker}${items ? `<button type="button" class="btn sm primary" data-action="recap-share" data-week="${period.n}">Share</button>` : ''}</div>
    <p class="muted small rc-when">${esc(L.name)} · ${fmtDay(period.start)} – ${fmtDay(matchDates(period.start).slice(-1)[0] || period.end)} · starters only</p>
    ${items ? `<div class="rx-grid">${items}</div>` : '<p class="muted small" style="margin:0">Nothing stood out.</p>'}
  </div>
  <div class="card"><div class="card-head"><h2>Results</h2></div>
    <ul class="rc-finals">${finals}</ul>
  </div>`;
}

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
    const row = { raw, id, recent, minNow: mean(R.map(s => s.min || 0)), minBefore: median(B.map(s => s.min || 0)), stats: {} };
    for (const st of stats) {
      if (st.pct) {
        const att = xs => sum(xs.map(s => lineStat(s, st.pct.att))), made = xs => sum(xs.map(s => lineStat(s, st.pct.made)));
        const aN = att(R), aB = att(B);
        if (aN / R.length < st.minAtt || aB / B.length < st.minAtt / 2) continue;
        const now = made(R) / aN, was = made(B) / aB;
        row.stats[st.key] = { now, was, move: (now - was) * aN / R.length }; // the makes a game above (or below) his usual rate
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

// Through a day (end), for a league's teams, or everyone in the sandbox (L null: My team, then everyone else)
function trendsCard(L, end) {
  if (!BOX || isFootball()) return '';
  const up = ui.trendDir !== 'down';
  const { stats, players } = trendPlayers(end);
  const owner = new Map();
  for (const [tid, r] of Object.entries((L && L.rosters) || {})) for (const x of r) if (x.nba) owner.set(x.nba, tid);
  if (!L && state.browse) for (const id of sbState().roster) owner.set(id, SB_ME); // (sandbox.js)
  const mine = myTeamId(), regulars = up ? teamRegulars(end) : null;
  const whose = raw => {
    const tid = owner.get(raw.id);
    if (tid) return `<span class="perf-owner${tid === mine ? ' mine' : ''}">${teamLink(tid)}</span>`;
    return raw.fx ? `<span class="badge fa">${FX_STATUS[raw.fx.st] || 'Free agent'}</span>` : '';
  };
  const minutesNote = row => (Math.abs(row.minNow - row.minBefore) >= 4 ? `minutes ${Math.round(row.minBefore)} → ${Math.round(row.minNow)}` : '');
  const fmtOf = st => (st.pct ? v => fmtPct(v) : v => fmt(v, 1));
  const change = (st, x) => (st.pct ? `${x.move > 0 ? '+' : '−'}${fmt(Math.abs(x.move), 1)} makes`
    : x.was > 0 ? `${x.move > 0 ? '+' : '−'}${Math.round(Math.abs(x.move) / x.was * 100)}%` : `${x.move > 0 ? '+' : '−'}${fmt(Math.abs(x.move), 1)}`);
  const rowHtml = (row, i, num, note) => `<li class="tr-row"><span class="tr-rank">${i + 1}</span>${headshot({ nbaId: row.id, name: row.raw.name }, 28)}
      <div class="tr-main"><div class="tr-name">${playerBtn(row.id, row.raw.name)} <span class="muted small">${teamBtn(row.raw.team)}</span></div>
      <div class="tr-meta">${[whose(row.raw), note].filter(Boolean).join(' · ')}</div></div>${num}</li>`;

  const lists = stats.map(st => {
    const fm = fmtOf(st);
    const ok = row => {
      const x = row.stats[st.key];
      if (!x || !(up ? x.move > 0 : x.move < 0)) return false;
      if (up ? row.minNow < trendMinutes() : row.minBefore < trendMinutes()) return false; // a regular, now (or before a drop)
      return st.pct || x.was <= 0 || Math.abs(x.move) / x.was >= 0.15; // (a small wobble isn't a trend)
    };
    const top = players.filter(ok).sort((a, b) => (up ? b.stats[st.key].move - a.stats[st.key].move : a.stats[st.key].move - b.stats[st.key].move)).slice(0, TREND_TOP);
    if (!top.length) return '';
    const rows = top.map((row, i) => {
      const x = row.stats[st.key];
      const notes = [up ? teammateOut(row, regulars) : '', st.role ? '' : minutesNote(row)].filter(Boolean).join(' · ');
      const num = `<div class="tr-num"><b>${fm(x.now)}</b> <span class="muted">vs ${fm(x.was)}</span><div class="small ${up ? 'pos-good' : 'pos-bad'}">${change(st, x)}</div></div>`;
      return rowHtml(row, i, num, notes);
    }).join('');
    return `<section class="tr-cat"><h3 class="sub">${esc(st.label)}</h3><ol class="tr-list">${rows}</ol></section>`;
  }).filter(Boolean);

  // By what a player's games are worth (categories won, or fantasy points, a game): the rostered players who moved most
  // either way, and the same for the ones a league can still have (no fantasy team). Value is the column's label, said once.
  const VAL = isPoints() ? 'FP' : 'Value';
  const byValue = (list, n) => list.filter(row => (up ? row.gain > 0 && row.minNow >= trendMinutes() : row.gain < 0 && row.minBefore >= trendMinutes()))
    .sort((a, b) => (up ? b.gain - a.gain : a.gain - b.gain)).slice(0, n);
  const rostered = fxLeague() ? byValue(players.filter(row => owner.has(row.id)), TREND_TOP) : [];
  const waivers = fxLeague() ? byValue(players.filter(row => !owner.has(row.id) && row.raw.fx && row.raw.fx.st !== 'T'), TREND_WAIVERS) : [];
  // (the sandbox: My team's, then everyone else's; one list while My team is empty)
  const mineList = fxLeague() ? [] : byValue(players.filter(row => owner.has(row.id)), TREND_TOP);
  const everyone = fxLeague() ? [] : byValue(players.filter(row => !owner.has(row.id)), TREND_TOP);
  const valueRows = list => list.map((row, i) => {
    // why: a teammate out (heating up), and the two stats that moved most his way
    const moved = stats.filter(st => !st.pct && !st.role && row.stats[st.key] && (up ? row.stats[st.key].move > 0 : row.stats[st.key].move < 0) && row.stats[st.key].was > 0)
      .sort((a, b) => Math.abs(row.stats[b.key].move / row.stats[b.key].was) - Math.abs(row.stats[a.key].move / row.stats[a.key].was)).slice(0, 2)
      .map(st => `${esc(STAT_LABEL[st.key] || st.label)} ${fmt(row.stats[st.key].now, 1)} vs ${fmt(row.stats[st.key].was, 1)}`);
    const note = [up ? teammateOut(row, regulars) : '', ...moved].filter(Boolean).join(' · ');
    // his value a game now, and the change under it (from his usual game: the (i) and the hover say so)
    const num = `<div class="tr-num" title="${esc(`${VAL} a game: ${fmtValue(row.valueNow)} in his last ${TREND_GAMES}, ${fmtValue(row.valueWas)} usually`)}"><b>${fmtValue(row.valueNow)}</b><div class="small ${up ? 'pos-good' : 'pos-bad'}">${fmtValue(row.gain)}</div></div>`;
    return rowHtml(row, i, num, note);
  }).join('');
  const valueList = (title, list) => (list.length ? `<section class="tr-cat"><h3 class="sub tr-head"><span>${title}</span><span class="tr-col">${VAL}</span></h3><ol class="tr-list">${valueRows(list)}</ol></section>` : '');
  const valueLists = [valueList('Rostered', rostered), valueList('Waivers', waivers), valueList('My team', mineList), valueList(owner.size ? 'Everyone else' : 'All players', everyone)].filter(Boolean);

  const seg = `<div class="seg seg-sm" role="group" aria-label="Trending">${[['up', 'Heating up'], ['down', 'Cooling off']].map(([k, l]) =>
    `<button type="button" class="${(k === 'up') === up ? 'on' : ''}" data-action="trend-dir" data-dir="${k}" aria-pressed="${(k === 'up') === up}">${l}</button>`).join('')}</div>`;
  const body = lists.length || valueLists.length
    ? `${valueLists.length ? `<div class="tr-grid tr-value">${valueLists.join('')}</div>` : ''}
       <div class="tr-grid">${lists.join('')}</div>`
    : `<p class="muted small" style="margin:0">Not enough games yet: a trend compares a player's last ${TREND_GAMES} games with at least ${TREND_BEFORE} before them.</p>`;
  return `<div class="card trends">
    <div class="card-head"><h2>Trends ${infoBtn('trends')}</h2>${seg}</div>
    ${body}
  </div>`;
}

// The Trends tab: every player's last games through the latest day the saved box scores have. In a league, its teams and
// scoring; in the sandbox (state.browse), a standard 9-category league, My team's list by value and everyone else's
function viewTrends() {
  if (!NBA) return '';
  const L = fxLeague(), note = L ? '' : browseNote();
  if (!BOX) return `${note}${boxWait('trends', 'Trends', "Loading the season's box scores…")}`;
  const end = [...BOX.finals].map(k => k.slice(0, 10)).sort().pop();
  return `${note}${end ? trendsCard(L, end) : `<div class="card"><div class="empty"><strong>No trends yet</strong>They start once the season's first games are in.</div></div>`}`;
}

// ----- The recap as a picture, for the league chat -----
// 1080 px wide, as tall as it needs: the league and week, the standouts, every final, the site's name. Each player stands
// on his NBA team's colors in front of its logo, as the player card shows him (ESPN's cutout; the round photo from the
// site's own sheet where there's none). Drawn on a canvas from the same recap.
const RC_IMG = { w: 1080, pad: 56, bg: '#0b0c0f', card: '#16181d', card2: '#1f2229', line: '#2a2e36', text: '#f4f4f5', soft: '#d4d8df', muted: '#9aa3b2', accent: '#f07a2a', good: '#4ade80', bad: '#f87171' };
const RC_FONT = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

// An image for a canvas, or null if it won't load in 8 s. cors: from another site, which must allow it (a canvas that
// drew an image its site didn't allow can't be saved)
const canvasImg = (src, cors) => new Promise(res => {
  const im = new Image(), t = setTimeout(() => res(null), 8000);
  if (cors) im.crossOrigin = 'anonymous';
  im.onload = () => { clearTimeout(t); res(im); };
  im.onerror = () => { clearTimeout(t); res(null); };
  im.src = src;
});
const loadSheet = () => (IMG && IMG.sheet ? canvasImg(IMG.sheet) : Promise.resolve(null));
// A player's cutout for the pictures: ESPN's by his ESPN id, every sport (ESPN's photo server lets a canvas use it;
// NBA.com's, the player card's, doesn't), 520 x 380; asked once a visit (one that failed, again the next time)
const shotImgs = new Map();
function shotImg(raw) {
  if (!raw || !raw.espn || (raw.pos && raw.pos[0] === 'DEF')) return Promise.resolve(null);
  const src = `https://a.espncdn.com/combiner/i?img=/i/headshots/${SPORT.key}/players/full/${raw.espn}.png&w=520&h=380`;
  if (!shotImgs.has(src)) shotImgs.set(src, canvasImg(src, true).then(im => { if (!im) shotImgs.delete(src); return im; }));
  return shotImgs.get(src);
}
// A team's logo for the pictures: the site's own (an SVG), given a size first (Firefox won't draw an SVG without one)
const logoImgs = new Map();
function logoImg(team) {
  const src = IMG && team && IMG.logos[team];
  if (!src) return Promise.resolve(null);
  if (!logoImgs.has(src)) {
    let url = src;
    const m = /^data:image\/svg\+xml;base64,(.*)$/.exec(src);
    if (m) {
      try {
        const svg = atob(m[1]);
        if (!/<svg[^>]*\swidth=/.test(svg)) url = `data:image/svg+xml;base64,${btoa(svg.replace('<svg', '<svg width="400" height="400"'))}`;
      } catch (e) { url = src; }
    }
    logoImgs.set(src, canvasImg(url));
  }
  return logoImgs.get(src);
}
// a color as rgba, darkened (dark 0-1), at an opacity (a team's color: teamTint, core.js)
function hexA(hex, a = 1, dark = 0) {
  const n = parseInt(hex.slice(1), 16), k = 1 - dark;
  return `rgba(${Math.round((n >> 16) * k)},${Math.round(((n >> 8) & 255) * k)},${Math.round((n & 255) * k)},${a})`;
}

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
// Text in styled pieces ([text, style]: 'b' bold, 'm' gray, 'a' orange, '' plain) as units that stay on one line: each
// word, its pieces joined where no space parts them ("face" + ":")
function wordUnits(list) {
  const units = [];
  let cur = null, space = true;
  for (const [t, st] of list) {
    for (const piece of String(t).split(/(\s+)/)) {
      if (!piece) continue;
      if (/^\s+$/.test(piece)) { space = true; continue; }
      if (space || !cur) units.push(cur = []);
      cur.push([piece, st]);
      space = false;
    }
  }
  return units;
}
// A standout's line from its HTML, styled as the page shows it: names bold, a player's fantasy team after him gray (in
// brackets: the page sets it apart by its color alone)
function htmlRuns(html) {
  const out = [];
  const walk = (node, st) => {
    for (const c of node.childNodes) {
      if (c.nodeType === 3) out.push([c.textContent, st]);
      else if (c.nodeType !== 1) continue;
      else if (st !== 'm' && c.classList.contains('muted')) { out.push(['(', 'm']); walk(c, 'm'); out.push([')', 'm']); }
      else walk(c, st === 'm' ? 'm' : ['B', 'STRONG', 'BUTTON'].includes(c.tagName) || c.classList.contains('team-mine') ? 'b' : st);
    }
  };
  walk(new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body, '');
  return out;
}
// numbers as units: each number bold (hot: orange, red below zero), its label gray after it ("27.5 PTS", ".623 FG% 10.8-17.3")
const statUnits = tiles => tiles.map(t => [[t.v, t.hot ? (isBelowZero(t.v) ? 'r' : 'a') : 'b'], [` ${t.k}${t.made ? ` ${t.made}` : ''}`, 'm']]);
const isBelowZero = v => /^[-−]/.test(String(v));

// The picture of a week's recap: its standouts, then every final (no dates under the league's name: kept short, the owner's ask)
const recapCanvas = (L, X) => shareCanvas({
  kicker: `PERIOD ${X.period.n} RECAP`, title: L.name, items: recapItems(X), games: X.games, mark: tid => recapMark(X, tid),
});

// What every share picture is drawn with (the recap's, the draft's, a trade's): a canvas `tall` px high in the share
// colors, and its tools (K): fonts, text, rounded cards, styled lines (lay, drawLay), a player on his team's colors
// (prep loads the photos and logos first; panel, face, photo), his team and positions (meta), the top (a kicker, a
// title, a line under it), then done(y): the site's name at the bottom and the canvas cut to what was drawn
async function sharePad(tall = 5000) {
  const C = RC_IMG, W = C.w;
  // (the site's own font: the page has it, a picture waits for it, Latin Extended too: Jokić)
  const fonts = typeof document !== 'undefined' && document.fonts ? Promise.all([400, 500, 600, 700].map(w => document.fonts.load(`${w} 40px Inter`, 'Ać'))).catch(() => {}) : null;
  const [sheet] = await Promise.all([loadSheet(), fonts]);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = tall;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, cv.height);
  // a warm glow from the top corner
  const glow = ctx.createRadialGradient(W * 0.12, -80, 0, W * 0.12, -80, 980);
  glow.addColorStop(0, hexA(C.accent, 0.22)); glow.addColorStop(1, hexA(C.accent, 0));
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, 1000);
  ctx.textBaseline = 'top';
  const spacing = 'letterSpacing' in ctx;
  const font = (px, weight = 400, ls = 0) => { ctx.font = `${weight} ${px}px ${RC_FONT}`; if (spacing) ctx.letterSpacing = `${ls}px`; };
  const text = (t, x, y, color = C.text, align = 'left') => { ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(t, x, y); };
  const round = (x, y, w, h, r, color) => { ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill(); };
  const clip = (x, y, w, h, r) => { ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.clip(); };
  // a player's round photo in a ring of his NBA team's colors (as on the site); his initials without one
  const photo = (p, x, y, d) => {
    const raw = nbaById.get(p.nbaId), tc = TEAM_COLORS[raw && raw.team], cx = x + d / 2, cy = y + d / 2, i = IMG_INDEX.get(p.nbaId);
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, d / 2, 0, Math.PI * 2); ctx.fillStyle = C.line; ctx.fill(); ctx.clip();
    if (sheet && i !== undefined) ctx.drawImage(sheet, (i % IMG.cols) * IMG.size, Math.floor(i / IMG.cols) * IMG.size, IMG.size, IMG.size, x, y, d, d);
    else { font(d * 0.36, 700); ctx.textBaseline = 'middle'; text(initials(p.name), cx, cy, C.muted, 'center'); ctx.textBaseline = 'top'; }
    ctx.restore();
    if (tc) {
      ctx.lineWidth = Math.max(4, d / 22);
      const a0 = (240 - 90) * Math.PI / 180;
      for (const [c, from, to] of [[tc[0], 0, 2 / 3], [tc[1], 2 / 3, 1]]) {
        ctx.strokeStyle = c; ctx.beginPath(); ctx.arc(cx, cy, d / 2 - ctx.lineWidth / 2, a0 + from * Math.PI * 2, a0 + to * Math.PI * 2); ctx.stroke();
      }
    }
  };
  // the cutouts and logos of the players a picture shows, loaded before it's drawn (8 s at most each)
  const shots = new Map(), logos = new Map();
  const prep = ps => Promise.all(ps.filter(p => p && p.nbaId != null).map(async p => {
    const raw = nbaById.get(p.nbaId);
    const [shot, logo] = await Promise.all([shotImg(raw), logoImg(raw && raw.team)]);
    if (shot) shots.set(p.nbaId, shot);
    if (logo) logos.set(raw.team, logo);
  }));
  // A player on his team's colors in a rounded box (r as roundRect takes it): its color, its logo faint behind him, his
  // cutout standing on the bottom edge; his round photo where there's no cutout
  const panel = (p, x, y, w, h, r) => {
    const raw = nbaById.get(p.nbaId) || {}, tint = teamTint(raw.team), shot = shots.get(p.nbaId), logo = logos.get(raw.team);
    clip(x, y, w, h, r);
    const g = ctx.createLinearGradient(x, y, x + w * 0.5, y + h);
    g.addColorStop(0, hexA(tint, 1, 0.1)); g.addColorStop(1, hexA(tint, 1, 0.62));
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    if (logo) { const s = Math.max(w, h) * 1.05; ctx.globalAlpha = 0.2; ctx.drawImage(logo, x + (w - s) / 2, y + (h - s) / 2, s, s); ctx.globalAlpha = 1; }
    if (shot) { const sh = h * 0.92, sw = sh * shot.width / shot.height; ctx.drawImage(shot, x + (w - sw) / 2, y + h - sh, sw, sh); }
    else standIn(p, raw, logo, x, y, w, h);
    ctx.restore();
  };
  // where there's no cutout, in the middle of a box: a team defense's logo, else his round photo
  const standIn = (p, raw, logo, x, y, w, h) => {
    if (logo && raw.pos && raw.pos[0] === 'DEF') { const s = Math.min(w, h) * 0.72; ctx.drawImage(logo, x + (w - s) / 2, y + (h - s) / 2, s, s); return; }
    const d = Math.min(w, h) * 0.62;
    photo(p, x + (w - d) / 2, y + (h - d) / 2, d);
  };
  // a player's face in a circle on his team's color (his cutout's head and shoulders), ringed in `ring` so faces that
  // overlap stand apart
  const face = (p, cx, cy, d, ring) => {
    const raw = nbaById.get(p.nbaId) || {}, shot = shots.get(p.nbaId);
    if (!shot) { photo(p, cx - d / 2, cy - d / 2, d); return; }
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, d / 2, 0, Math.PI * 2); ctx.fillStyle = hexA(teamTint(raw.team), 1, 0.3); ctx.fill(); ctx.clip();
    const s = shot.height * 0.84;
    ctx.drawImage(shot, (shot.width - s) / 2, shot.height * 0.04, s, s, cx - d / 2, cy - d / 2, d, d);
    ctx.restore();
    ctx.lineWidth = 6; ctx.strokeStyle = ring; ctx.beginPath(); ctx.arc(cx, cy, d / 2, 0, Math.PI * 2); ctx.stroke();
  };
  // styled units (wordUnits, statUnits) in lines that fit maxW at px, `gap` apart (a space by default); then drawn from
  // (x, y), lh apart, returning the y under them
  const STYLE = { b: [700, C.text], m: [500, C.muted], a: [700, C.accent], r: [700, C.bad], '': [400, C.soft] };
  const unitW = (u, px) => sum(u.map(([t, st]) => { font(px, STYLE[st][0]); return ctx.measureText(t).width; }));
  const lay = (units, maxW, px, gap) => {
    font(px);
    const g = gap ?? ctx.measureText(' ').width, lines = [];
    let line = null, w = 0;
    for (const u of units) {
      const uw = unitW(u, px);
      if (!line || (line.length && w + g + uw > maxW)) { lines.push(line = []); w = -g; }
      line.push({ u, x: w + g }); w += g + uw;
    }
    return lines;
  };
  const drawLay = (lines, x, y, px, lh) => {
    for (const line of lines) {
      for (const { u, x: ux } of line) {
        let cx = x + ux;
        for (const [t, st] of u) { font(px, STYLE[st][0]); text(t, cx, y, STYLE[st][1]); cx += ctx.measureText(t).width; }
      }
      y += lh;
    }
    return y;
  };
  // his NBA team and his positions in their colors (as on the site: slotInk), then any more ([text, color, weight])
  const meta = (x, y, px, team, pos, more = []) => {
    const runs = [[team || 'FA', C.muted, 600], ...(pos || []).flatMap((q, j) => [[j ? ',' : ' · ', C.muted], [q, slotInk(q) || C.muted, 700]]), ...more];
    let cx = x;
    for (const [t, color, weight] of runs) { font(px, weight || 500); text(t, cx, y, color); cx += ctx.measureText(t).width; }
  };
  const inner = W - C.pad * 2;
  // the top: what it is (an orange tab), the league, when (if said); the y below it
  const top = H => {
    let y = C.pad + 8;
    font(22, 700, 2.5);
    round(C.pad, y, ctx.measureText(H.kicker).width + 40, 48, 24, C.accent);
    text(H.kicker, C.pad + 20, y + 13, '#16181d');
    y += 48 + 30;
    font(80, 700, -2);
    for (const l of wrapText(ctx, H.title, inner).slice(0, 2)) { text(fitText(ctx, l, inner), C.pad, y); y += 92; }
    if (!H.sub) return y + 34;
    font(30, 500); text(H.sub, C.pad, y, C.muted);
    return y + 84;
  };
  // the site's mark, as icons/logo.svg draws it (its shapes: copy them here if it changes)
  const mark = (x, y, s) => {
    const k = s / 64;
    round(x, y, s, s, s * 0.2, '#161a22');
    for (const [pts, color] of [[[36.09, 39.16, 56.56, 28.93, 44.28, 22.78, 36.09, 26.88, 19.71, 18.69, 7.42, 24.83], '#ffffff'],
      [[7.42, 28.93, 36.09, 43.26, 56.56, 33.02, 56.56, 39.16, 36.09, 49.4, 7.42, 35.07], '#7f8a9c']]) {
      ctx.fillStyle = color; ctx.beginPath();
      for (let i = 0; i < pts.length; i += 2) ctx[i ? 'lineTo' : 'moveTo'](x + pts[i] * k, y + pts[i + 1] * k);
      ctx.closePath(); ctx.fill();
    }
  };
  // the bottom: where it came from
  const done = y => {
    y += 44;
    ctx.fillStyle = C.line; ctx.fillRect(C.pad, y, inner, 2); y += 36;
    mark(C.pad, y, 52);
    font(30, 700, -0.3); text('League Layer', C.pad + 70, y + 10, C.text);
    font(26, 500); text('leaguelayer.com', W - C.pad, y + 13, C.muted, 'right');
    y += 52 + C.pad;
    const out = document.createElement('canvas');
    out.width = W; out.height = Math.ceil(y);
    out.getContext('2d').drawImage(cv, 0, 0);
    return out;
  };
  return { C, W, inner, ctx, font, text, round, photo, prep, panel, face, lay, drawLay, meta, top, done };
}

// A picture to share in a league chat (1080 px wide): a kicker, the league's name and any line under it, then the
// standouts (each player beside his photo, every one alike: no larger card for the first, the owner's ask; the rest beside
// their emoji, with the faces of any players they name), then any finals. H: { kicker, title, sub, items, games, mark: tid
// -> its emoji }.
// An item: { e, label, html, text }, a player's also { p, tid, stats (words), tiles (lineTiles), per (games a week's
// numbers are a game of), score: [number, unit] }, one naming players { faces }
async function shareCanvas(H) {
  const items = H.items, games = H.games || [];
  const K = await sharePad(900 + sum(items.map(it => (it.p ? 440 : 340))) + games.length * 100);
  const { C, W, inner, ctx, font, text, round, panel, face, lay, drawLay, meta } = K;
  await K.prep([...items.filter(it => it.p).map(it => it.p), ...items.flatMap(it => it.faces || [])]);
  const x0 = C.pad, w = inner;
  const posOf = p => p.pos || (nbaById.get(p.nbaId) || {}).pos;
  const labelText = (it, x, y, max) => { font(22, 700, 2); text(fitText(ctx, `${it.e ? `${it.e}  ` : ''}${it.label.toUpperCase()}`, max), x, y, C.accent); };

  // A player: his photo on his team's colors at the left, the award, his name, his teams, his numbers (his value or points
  // first, in orange)
  const player = (it, y) => {
    const p = it.p, raw = nbaById.get(p.nbaId) || {}, pw = 300, tx = x0 + pw + 40, tw = x0 + w - 40 - tx;
    const units = it.tiles ? statUnits([{ v: it.score[0], k: it.score[1], hot: true }, ...it.tiles]) : wordUnits([[it.stats || '', '']]);
    const lines = lay(units, tw, 27, it.tiles ? 22 : undefined), h = Math.max(300, 214 + lines.length * 40 + 26);
    round(x0, y, w, h, 28, C.card);
    panel(p, x0, y, pw, h, [28, 0, 0, 28]);
    labelText(it, tx, y + 36, tw);
    font(44, 700, -0.5); text(fitText(ctx, p.name, tw), tx, y + 74, C.text);
    font(27, 600); text(fitText(ctx, fxTeamName(it.tid), tw), tx, y + 132, C.soft);
    meta(tx, y + 172, 23, raw.team, posOf(p), it.per ? [[` · ${it.per} G, per game`, C.muted]] : []);
    drawLay(lines, tx, y + 216, 27, 40);
    return y + h;
  };

  // The rest: any emoji, the award, its line (names bold), and the faces of the players it names
  const note = (it, y) => {
    const faces = (it.faces || []).filter(f => f && f.nbaId != null).slice(0, 3), fd = 104, step = 72;
    const fw = faces.length ? fd + (faces.length - 1) * step + 28 : 0, ex = x0 + 30, tx = it.e ? ex + 88 + 28 : x0 + 40, tw = x0 + w - 32 - fw - tx;
    const lines = lay(wordUnits(htmlRuns(it.html)), tw, 31), block = 40 + lines.length * 44 - 8;
    const h = Math.max(block + 64, faces.length ? fd + 60 : 0, 148), ty = y + (h - block) / 2;
    round(x0, y, w, h, 28, C.card);
    if (it.e) { // (the Draft Retrospective's awards have one; the recap's don't)
      ctx.fillStyle = hexA(C.accent, 0.14); ctx.beginPath(); ctx.arc(ex + 44, y + h / 2, 44, 0, Math.PI * 2); ctx.fill();
      font(42); ctx.textBaseline = 'middle'; text(it.e, ex + 44, y + h / 2 + 2, C.text, 'center'); ctx.textBaseline = 'top';
    }
    labelText({ ...it, e: '' }, tx, ty, tw);
    drawLay(lines, tx, ty + 40, 31, 44);
    faces.forEach((f, i) => face(f, x0 + w - 32 - fd / 2 - (faces.length - 1 - i) * step, y + h / 2, fd, C.card));
    return y + h;
  };

  let y = K.top(H);
  items.forEach(it => { y = (it.p ? player : note)(it, y) + 22; });

  // every final, winner on the left in bold, the score in the middle
  if (games.length) {
    y += 30;
    font(22, 700, 2); text('RESULTS', x0, y, C.accent);
    const lw = ctx.measureText('RESULTS').width;
    ctx.fillStyle = C.line; ctx.fillRect(x0 + lw + 20, y + 12, w - lw - 20, 2);
    y += 52;
  }
  for (const g of games) {
    font(32, 700); const sc = scoreLine(g.sc), sw = ctx.measureText(sc).width + 44, colW = (w - 64 - sw - 40) / 2; // (the names share what the score leaves)
    round(x0, y, w, 84, 22, C.card);
    round(W / 2 - sw / 2, y + 15, sw, 54, 27, C.bg);
    text(sc, W / 2, y + 26, C.accent, 'center');
    // a team's name cut to fit, its badge (Top, Bottom) kept whole on the outer edge
    const side = (tid, left, weight, color) => {
      const k = H.mark ? H.mark(tid) : '', edge = left ? x0 + 32 : x0 + w - 32;
      font(17, 700, 1.5);
      const label = k ? RECAP_MARK[k].toUpperCase() : '', bw = k ? ctx.measureText(label).width + 24 : 0, room = bw ? bw + 12 : 0;
      if (k) {
        const ink = k === 'top' ? C.good : C.bad, bx = left ? edge : edge - bw;
        round(bx, y + 26, bw, 32, 16, hexA(ink, 0.16)); text(label, bx + bw / 2, y + 34, ink, 'center');
      }
      font(30, weight); text(fitText(ctx, fxTeamName(tid), colW - room), left ? edge + room : edge - room, y + 26, color, left ? 'left' : 'right');
    };
    side(g.a, true, g.margin ? 700 : 500, C.text);
    side(g.b, false, 500, C.muted);
    y += 96;
  }

  return K.done(y - 22);
}

const recapBlob = cv => new Promise(res => cv.toBlob(res, 'image/png'));
const recapFileName = (L, X) => `${L.name.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'league'}-week-${X.period.n}.png`;

// ----- Sharing: the Recap's week and the Draft tab's awards, as a picture in a popup, or as text and a link -----
// S: { title (the popup's), name (the share sheet's), what ('Recap': the toast's), text, url, link ('Full recap': before
// the url), file, alt, draw: () => its canvas }
const recapShare = (L, X) => ({
  title: `Period ${X.period.n} recap`, name: `${L.name} · Period ${X.period.n} recap`, what: 'Recap', link: 'Full recap',
  text: recapText(L, X), url: recapUrl(L, X.period.n), file: recapFileName(L, X), alt: `Period ${X.period.n} recap for ${L.name}`,
  draw: () => recapCanvas(L, X),
});
// The picture in the popup; the text and link (copied, or the share sheet) where a picture can't be made
async function shareWith(el, S) {
  if (el) el.disabled = true;
  try {
    const blob = await recapBlob(await S.draw());
    if (!blob) throw new Error('no image');
    if (ui.share && ui.share.img) URL.revokeObjectURL(ui.share.img);
    ui.share = { ...S, blob, img: URL.createObjectURL(blob) };
    $('#infoTitle').textContent = S.title;
    $('#infoBody').innerHTML = sharePopup(ui.share);
    const d = $('#infoDialog');
    if (!d.open) d.showModal();
  } catch (e) { ui.share = S; await shareText(S); } finally { if (el) el.disabled = false; }
}
// The popup: the picture, then Share (the share sheet, with the picture, where the browser can), Copy, Save, or the
// text and link
function sharePopup(S) {
  const canFiles = !!(navigator.canShare && navigator.share);
  return `<img class="rc-img" src="${S.img}" alt="${esc(S.alt)}">
    <div class="fb-actions">
      ${canFiles ? '<button type="button" class="btn primary" data-action="share-img">Share image</button>' : ''}
      ${window.ClipboardItem ? `<button type="button" class="btn${canFiles ? '' : ' primary'}" data-action="share-copy">Copy image</button>` : ''}
      <a class="btn" href="${S.img}" download="${esc(S.file)}">Save image</a>
      <button type="button" class="btn" data-action="share-text">Copy text and link</button>
    </div>`;
}
// the text and link: on phones the share sheet (the league chat is one tap away); elsewhere copied
async function shareText(S) {
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ title: S.name, text: S.text, url: S.url }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(`${S.text}\n\n${S.link}: ${S.url}`); toast(`${S.what} copied: paste it in your league chat`); } catch (e) { toast(`Couldn't copy the ${S.what.toLowerCase()}`); }
}

