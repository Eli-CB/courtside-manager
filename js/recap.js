// League Layer: the weekly recap: every matchup's result and the week's standouts, to share with the league.
// The site loads js/*.js in order (see index.html); they share one scope, like one file.
'use strict';

// ----- Weekly recap -----
// A finished week across the whole league, counted from the week's real lineups and box scores as How week N ended
// counts one matchup: every final, then the standouts. Fantrax leagues only (the others don't share past lineups).
const recaps = new Map(); // "league|period" -> recap, or null when the week's lineups aren't there

// weeks whose games are all played (a Fantrax week ends officially when the next locks, a day after its last games)
const finishedPeriods = L => (L.periods || []).filter(p => periodOver(p) && ((L.matchups || {})[String(p.n)] || []).length);

// A game's or a week's full line in the league's own categories (a week per game; shooting as makes-attempts, a
// week's with its %), minutes first
function fullLine(s, perGame) {
  const g = perGame ? s.gp1 || 1 : 1, v = (k, d) => fmt(lineStat(s, k) / g, perGame ? 1 : d);
  const parts = [`${v('min', 0)} MIN`];
  for (const c of scoreCats()) {
    if (c.fp) continue;
    if (c.pct) {
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
      for (const r of (raw && P.G.players.get(nba)) || []) {
        if (!days.has(r[0])) continue;
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
  const brick = best(single, x => -x.v);
  return {
    period, games: order,
    mvp: best(weeks, x => x.v),
    game: best(single, x => x.v),
    brick: !isPoints() && brick && brick.v < 0 ? brick : null,
    regret,
    allPlay: best(allPlay, x => x.w + x.t / 2),
    teams: R.length,
  };
}

const scoreLine = sc => (isPoints() ? `${fmt(sc.me, 1)}–${fmt(sc.opp, 1)}` : `${sc.me}–${sc.opp}${sc.ties ? `–${sc.ties}` : ''}`);

// The standouts as { emoji, label, html, text for sharing }. Names are plain links (no photo), so they sit on the
// line with the text around them.
function recapItems(X) {
  const team = tid => fxTeamName(tid);
  const out = [];
  const add = (e, label, html, text) => out.push({ e, label, html, text });
  const name = (p, bold) => `<button class="link-btn pname" data-action="player-detail" data-nba="${p.nbaId}">${bold ? `<b>${esc(p.name)}</b>` : esc(p.name)}</button>`;
  const unit = isPoints() ? 'FP' : 'value';
  const stand = (e, label, x, perGame, cls = '') => {
    const parts = fullLine(x.line, perGame), head = perGame ? `${x.line.gp1} G, per game: ` : '';
    add(e, label, `${name(x.p, true)} <span class="muted">${esc(team(x.tid))}</span><div class="rc-stats">${head}${parts.map(t => `<span>${t}</span>`).join(' · ')} · <span><b class="${cls}">${fmtValue(x.v, perGame ? 1 : 2)}</b> ${unit}</span></div>`,
      `${x.p.name} (${team(x.tid)}): ${head}${parts.join(', ')}`);
  };
  if (X.mvp) stand('🏆', 'Player of the week', X.mvp, true);
  if (X.game) stand('🚀', 'Game of the week', X.game, false);
  if (X.brick) stand('🧱', 'Brick of the week', X.brick, false, 'pos-bad');
  if (X.regret) {
    const r = X.regret, o = Math.sign(Math.round((r.sc.me - r.sc.opp) * 10)), res = o > 0 ? 'won' : 'tied';
    add('🪑', 'Bench regret', `<b>${esc(team(r.tid))}</b>: starting ${name(r.w.inP)} over ${name(r.w.outP)} would have ${res} ${scoreLine(r.sc)}`,
      `${team(r.tid)}: starting ${r.w.inP.name} over ${r.w.outP.name} would have ${res} ${scoreLine(r.sc)}`);
  }
  if (X.allPlay && X.teams > 2) {
    // matchups won against every other team's week, not categories
    const a = X.allPlay, n = X.teams - 1;
    const beat = `${a.w === n ? `every other team (${n} of ${n})` : `${a.w} of ${n} teams`}${a.t ? `, tied ${a.t}` : ''}`;
    add('📈', 'Best week', `<b>${esc(team(a.tid))}</b> would have beaten ${beat}`, `${team(a.tid)} would have beaten ${beat}`);
  }
  return out;
}

// The address that opens this recap in the league: anyone in it can pick their team and land here
const recapUrl = (L, n) => `${location.origin}${location.pathname}?league=${encodeURIComponent(L.id)}&week=${n}#recap`;

// What Share sends: the standouts only (everyone already has the results in their league)
function recapText(L, X) {
  return [`🏀 ${L.name} · Week ${X.period.n} standouts`, '', ...recapItems(X).map(x => `${x.e} ${x.label}: ${x.text}`)].join('\n\n');
}

function viewRecap() {
  const L = fxLeague();
  if (!L || !NBA) return '';
  const empty = (t, m) => `<div class="card"><div class="empty"><strong>${t}</strong>${m}</div></div>`;
  if (!hasLineupHistory(L)) return empty(`No recaps for ${esc(sourceName(L))} leagues yet`, "Recaps come from each week's real lineups, which the site reads from Fantrax only for now.");
  // the last game day's box scores tell whether a week is over before Fantrax says so
  if (!BOX) loadBoxes().then(() => { if (ui.tab === 'recap') render(); }).catch(() => {});
  const done = finishedPeriods(L);
  if (!done.length) return empty('No finished weeks yet', 'The first recap appears once week 1 is over.');
  const period = done.find(p => p.n === ui.recapWeek) || done[done.length - 1];
  const P = pastWeeksOf(L);
  if (P.state === 'loading') return empty(`Week ${period.n} recap`, `Loading the week's lineups from ${sourceName(L)}…`);
  if (P.state === 'error') return empty(`Week ${period.n} recap`, `Couldn't load the week's lineups (${esc(P.msg)}).`);
  const key = `${L.id}|${period.n}`;
  if (!recaps.has(key)) recaps.set(key, P.weeks && P.G ? buildRecap(L, P, period) : null);
  const X = recaps.get(key);
  if (!X) return empty(`Week ${period.n} recap`, `${sourceName(L)} hasn't shared this week's lineups.`);

  const me = myTeamId();
  // every finished week, newest by default: ‹ Week 2 › steps back through the earlier ones
  const picker = done.length > 1 ? stepper('recap-step', 'week', `<select class="ctx-team" data-change="recap-week" aria-label="Week">${done.map(p => `<option value="${p.n}" ${p.n === period.n ? 'selected' : ''}>Week ${p.n}</option>`).join('')}</select>`,
    { first: period.n === done[0].n, last: period.n === done[done.length - 1].n }) : '';
  const finals = X.games.map(g => `<li class="rc-final${g.a === me || g.b === me ? ' me' : ''}"><span class="rc-t${g.margin ? ' won' : ''}">${esc(fxTeamName(g.a))}</span><span class="rc-score">${scoreLine(g.sc)}</span><span class="rc-t">${esc(fxTeamName(g.b))}</span></li>`).join('');
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

// A week that ended in the last three days: offered on the Dashboard
function freshRecap(L = fxLeague()) {
  if (!L || !hasLineupHistory(L)) return null;
  const p = finishedPeriods(L).pop();
  return p && Date.now() - fxTime(p.endAt) < 3 * 864e5 ? p : null;
}
