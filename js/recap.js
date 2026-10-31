// League Layer: the weekly recap: every matchup's result and the week's standouts, to share with the league.
// The site loads js/*.js in order (see index.html); they share one scope, like one file.
'use strict';

// ----- Weekly recap -----
// A finished week across the whole league, counted from the week's real lineups and box scores as How week N ended
// counts one matchup: every final, then the standouts. Fantrax leagues only (the others don't share past lineups).
const recaps = new Map(); // "league|period" -> recap, or null when the week's lineups aren't there

const finishedPeriods = L => (L.periods || []).filter(p => fxTime(p.endAt) < Date.now() && ((L.matchups || {})[String(p.n)] || []).length);

// A game or a week as a short line: points, rebounds, assists, then anything big
function lineSummary(s, perGame) {
  const g = perGame ? s.gp1 || 1 : 1, v = k => fmt((s[k] || 0) / g, perGame ? 1 : 0);
  const extra = [['stl', 'stl', 3], ['blk', 'blk', 3], ['tpm', '3PM', 4]].filter(([k, , at]) => (s[k] || 0) / g >= at).map(([k, l]) => `${v(k)} ${l}`);
  return [`${v('pts')} pts`, `${v('reb')} reb`, `${v('ast')} ast`, ...extra].join(', ');
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
    blowout: order.length > 1 ? order[0] : null,
    close: order.length > 1 ? order[order.length - 1] : null,
    regret,
    allPlay: best(allPlay, x => x.w + x.t / 2),
    teams: R.length,
  };
}

const scoreLine = sc => (isPoints() ? `${fmt(sc.me, 1)}–${fmt(sc.opp, 1)}` : `${sc.me}–${sc.opp}${sc.ties ? `–${sc.ties}` : ''}`);

// The standouts as [emoji, label, html, text for sharing]
function recapItems(X) {
  const team = tid => fxTeamName(tid);
  const out = [];
  const add = (e, label, html, text) => out.push({ e, label, html, text });
  const who = x => `${inlinePlayer(x.p, `<b>${esc(x.p.name)}</b>`)} <span class="muted">${esc(team(x.tid))}</span>`;
  if (X.mvp) add('🏆', 'Player of the week', `${who(X.mvp)}<br><span class="small">${lineSummary(X.mvp.line, true)} in ${X.mvp.line.gp1} G · <b>${fmtValue(X.mvp.v, 1)}</b> ${isPoints() ? 'FP' : 'value'}</span>`,
    `${X.mvp.p.name} (${team(X.mvp.tid)}), ${lineSummary(X.mvp.line, true)} in ${X.mvp.line.gp1} games`);
  if (X.game) add('🚀', 'Game of the week', `${who(X.game)}<br><span class="small">${lineSummary(X.game.line)} · <b>${fmtValue(X.game.v)}</b> ${isPoints() ? 'FP' : 'value'}</span>`,
    `${X.game.p.name} (${team(X.game.tid)}), ${lineSummary(X.game.line)}`);
  if (X.brick) {
    const s = X.brick.line, shots = `${s.fgm}-${s.fga} FG${s.to ? `, ${s.to} TO` : ''}`;
    add('🧱', 'Brick of the week', `${who(X.brick)}<br><span class="small">${shots}, ${s.pts} pts · <b class="pos-bad">${fmtValue(X.brick.v)}</b> value</span>`, `${X.brick.p.name} (${team(X.brick.tid)}), ${shots}`);
  }
  const final = g => `<b>${esc(team(g.a))}</b> over ${esc(team(g.b))} ${scoreLine(g.sc)}`;
  if (X.blowout && X.blowout.margin > 0) add('💥', 'Biggest win', final(X.blowout), `${team(X.blowout.a)} over ${team(X.blowout.b)} ${scoreLine(X.blowout.sc)}`);
  if (X.close && X.close !== X.blowout) add('🤏', 'Closest', X.close.margin ? final(X.close) : `<b>${esc(team(X.close.a))}</b> and <b>${esc(team(X.close.b))}</b> tied ${scoreLine(X.close.sc)}`,
    X.close.margin ? `${team(X.close.a)} over ${team(X.close.b)} ${scoreLine(X.close.sc)}` : `${team(X.close.a)} and ${team(X.close.b)} tied ${scoreLine(X.close.sc)}`);
  if (X.regret) {
    const r = X.regret, res = outcome => (outcome > 0 ? 'won' : 'tied');
    const o = Math.sign(Math.round((r.sc.me - r.sc.opp) * 10));
    add('🪑', 'Bench regret', `<b>${esc(team(r.tid))}</b>: starting ${inlinePlayer(r.w.inP, esc(r.w.inP.name))} over ${inlinePlayer(r.w.outP, esc(r.w.outP.name))} would have ${res(o)} ${scoreLine(r.sc)}`,
      `${team(r.tid)}, starting ${r.w.inP.name} over ${r.w.outP.name} would have ${res(o)} ${scoreLine(r.sc)}`);
  }
  if (X.allPlay && X.teams > 2) {
    const a = X.allPlay, rec = `${a.w}-${a.l}${a.t ? `-${a.t}` : ''}`;
    add('📈', 'Best week', `<b>${esc(team(a.tid))}</b> would have gone ${rec} against every team`, `${team(a.tid)}, ${rec} against every team`);
  }
  return out;
}

// The address that opens this recap in the league: anyone in it can pick their team and land here
const recapUrl = (L, n) => `${location.origin}${location.pathname}?league=${encodeURIComponent(L.id)}&week=${n}#recap`;

function recapText(L, X) {
  return [`🏀 ${L.name} · Week ${X.period.n} recap`, '',
    ...X.games.map(g => (g.margin ? `${fxTeamName(g.a)} ${scoreLine(g.sc)} ${fxTeamName(g.b)}` : `${fxTeamName(g.a)} ${scoreLine(g.sc)} ${fxTeamName(g.b)} (tie)`)), '',
    ...recapItems(X).map(x => `${x.e} ${x.label}: ${x.text}`)].join('\n');
}

function viewRecap() {
  const L = fxLeague();
  if (!L || !NBA) return '';
  const empty = (t, m) => `<div class="card"><div class="empty"><strong>${t}</strong>${m}</div></div>`;
  if (!hasLineupHistory(L)) return empty(`No recaps for ${esc(sourceName(L))} leagues yet`, "Recaps come from each week's real lineups, which the site reads from Fantrax only for now.");
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
  const picker = done.length > 1 ? `<select class="ctx-team" data-change="recap-week" aria-label="Week">${done.map(p => `<option value="${p.n}" ${p.n === period.n ? 'selected' : ''}>Week ${p.n}</option>`).join('')}</select>` : '';
  const finals = X.games.map(g => `<li class="rc-final${g.a === me || g.b === me ? ' me' : ''}"><span class="rc-t${g.margin ? ' won' : ''}">${esc(fxTeamName(g.a))}</span><span class="rc-score">${scoreLine(g.sc)}</span><span class="rc-t">${esc(fxTeamName(g.b))}</span></li>`).join('');
  const items = recapItems(X).map(x => `<li class="rc-item"><span class="rc-e" aria-hidden="true">${x.e}</span><div><div class="rc-label">${x.label}</div>${x.html}</div></li>`).join('');
  return `<div class="card">
    <div class="card-head"><h2>Week ${period.n} recap ${infoBtn('recap')}</h2>${picker}<button type="button" class="btn sm primary" data-action="recap-share" data-week="${period.n}">Share</button></div>
    <p class="muted small rc-when">${esc(L.name)} · ${fmtDay(period.start)} – ${fmtDay(period.end)}</p>
    <ul class="rc-finals">${finals}</ul>
  </div>
  <div class="card"><div class="card-head"><h2>Standouts</h2><span class="muted small">starters only</span></div>
    ${items ? `<ul class="rc-items">${items}</ul>` : '<p class="muted small" style="margin:0">Nothing stood out.</p>'}
  </div>`;
}

// A week that ended in the last three days: offered on the Dashboard
function freshRecap(L = fxLeague()) {
  if (!L || !hasLineupHistory(L)) return null;
  const p = finishedPeriods(L).pop();
  return p && Date.now() - fxTime(p.endAt) < 3 * 864e5 ? p : null;
}
