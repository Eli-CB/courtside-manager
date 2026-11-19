// League Layer: The Draft tab: the board, how every pick is playing, each team's draft and the Draft Retrospective.
// The site loads js/*.js in order (see index.html); they share one scope, like one file.
'use strict';

/* ---------- Draft: how every pick is playing so far ---------- */
// Each drafted player is ranked by his value per game this season (this season's stats only).
// Gain = draft slot − current rank: a #40 pick playing like the #5 player is +35.
const KEEPER_SLOTS = [5, 15];

// The league's own season: its first week's first day to its last week's last game day, playoffs included
function leagueSeason(L) {
  const ps = L.periods || [];
  if (!ps.length) return null;
  const last = ps[ps.length - 1], end = String(last.endAt || last.end);
  // a period that ends in the morning (Fantrax's, the Monday after) ends with the day before
  return { from: ps[0].start.slice(0, 10), to: end.length <= 10 || +end.slice(11, 13) >= 21 ? end.slice(0, 10) : addDays(end.slice(0, 10), -1) };
}
// Each player's per-game stats from a season's games between two days, in nbaStats's shape: NBA id -> stats
function windowStats(G, from, to) {
  const d0 = Date.parse(G.start + 'T12:00:00'), day = iso => Math.round((Date.parse(iso + 'T12:00:00') - d0) / 864e5);
  const a = day(from), b = day(to), out = new Map();
  for (const [pid, rows] of G.players) {
    const t = {};
    let n = 0;
    for (const r of rows) {
      if (r[0] < a || r[0] > b) continue;
      n++;
      for (const [k, v] of Object.entries(gameLine(G, r))) t[k] = (t[k] || 0) + v;
    }
    if (!n) continue;
    const s = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v / n]));
    out.set(+pid, { ...s, gp: n, fgPct: t.fga ? t.fgm / t.fga : 0, ftPct: t.fta ? t.ftm / t.fta : 0 });
  }
  return out;
}
// What a draft is graded by: the games of the league's own season, not the NBA's (a league can end weeks before the
// NBA does, or start after it). A past season's archived game log; this season's box scores once the league is over
// or if it started late (until then, the season so far is the league's). { win, stats }, { loading }, or null for the
// season's averages (nbaStats)
const draftSeasons = new Map();
function draftSeason(L, basis) {
  const win = leagueSeason(L);
  const season = basis === 'cur' ? 'cur' : String(basis || '').startsWith('arch:') ? basis.slice(5) : null;
  if (!win || !season) return null;
  if (season === 'cur' && !(todayIso() > win.to || win.from > (nbaGameDays()[0] || win.from))) return null;
  if (!(season in gameLogs)) {
    loadGameLog(season).then(() => { if (ui.tab === 'draft') render(); });
    return { loading: true };
  }
  const G = gameLogs[season];
  if (!G) return null;
  const key = `${season}|${win.from}|${win.to}`;
  if (!draftSeasons.has(key)) draftSeasons.set(key, { win, stats: windowStats(G, win.from, win.to) });
  return draftSeasons.get(key);
}

function draftData() {
  const L = fxLeague();
  if (!L || !L.draft || !L.draft.picks.length) return null;
  // this season so far, or a past season (when the site has its stats); only games inside the league's own season
  const basis = seasonCtx ? seasonCtx.basis : 'cur';
  const W = draftSeason(L, basis);
  if (W && W.loading) return { loading: true };
  const statsOf = raw => (W ? W.stats.get(raw.id) || null : nbaStats(raw, basis));
  const picks = L.draft.picks.map(([round, pick, teamId, nba, name, at, slot]) => {
    const raw = nba ? nbaById.get(nba) : null;
    const s = raw && basis ? statsOf(raw) : null;
    const gp = s ? Math.round(s.gp) : 0;
    const p = { round, pick, teamId, team: fxTeamName(teamId), raw, nbaId: nba, name: raw ? raw.name : name, gp, val: null, s, at: at || null, slot: slot || null };
    if (s && gp) p.val = value({ ...s, pos: raw.pos });
    return p;
  });
  // Totals: points leagues add up fantasy points; cats leagues add up value above a replacement-level starter
  // (the per-game value of the last player who'd start in this league), so games only help players worth starting
  const totals = ui.draftMode === 'total';
  const perGame = picks.filter(p => p.val != null).map(p => p.val).sort((a, b) => b - a);
  const repl = isPoints() || !perGame.length ? 0 : perGame[Math.min(perGame.length, Math.max(1, fxPickable().length * state.slots.length)) - 1];
  const score = (val, gp) => (val == null ? null : totals ? (val - repl) * gp : val);
  picks.forEach(p => { p.score = score(p.val, p.gp); });
  const played = picks.filter(p => p.score != null).sort((a, b) => b.score - a.score);
  played.forEach((p, i) => { p.rank = i + 1; });
  // players who haven't played yet rank below everyone who has, in draft order
  picks.filter(p => p.val == null).sort((a, b) => a.pick - b.pick).forEach((p, i) => { p.rank = played.length + i + 1; });
  picks.forEach(p => { p.gain = p.pick - p.rank; });
  const maxGp = Math.max(0, ...picks.map(p => p.gp));
  // keepers: where each would slot among this year's picks, by value per game so far. The better keeper counts as the
  // #5 pick, the other as #15: this season by Fantrax ADP; a past season by the season before's value per game (today's
  // ADP says nothing about a past draft), a keeper without one (a rookie) last
  const prior = seasonCtx && L.priorSeason && archives[L.priorSeason] ? L.priorSeason : null;
  const keepers = {};
  for (const [tid, ids] of Object.entries(L.draft.keepers || {})) {
    if (seasonCtx && (!basis || !prior)) { // no stats to grade by, or none to say which keeper was the better one
      keepers[tid] = ids.map(nba => ({ nbaId: nba, name: (nbaById.get(nba) || {}).name || '', past: true })).sort((a, b) => a.name.localeCompare(b.name));
      continue;
    }
    keepers[tid] = ids.map(nba => {
      const raw = nbaById.get(nba) || { id: nba, pos: [] };
      const s = basis ? statsOf(raw) : null;
      const gp = s ? Math.round(s.gp) : 0;
      const val = s && gp ? value({ ...s, pos: raw.pos }) : null;
      const sc = score(val, gp);
      const like = sc == null ? null : played.filter(p => p.score > sc).length + 1;
      const before = prior ? archivedStats(raw, prior) : null;
      const rank = prior ? -(before && before.gp ? value({ ...before, pos: raw.pos }) : -1e9) : (raw.fx && raw.fx.adp) || 999;
      const old = [basis && basis.startsWith('arch:') && basis.slice(5), prior].map(x => x && archives[x] && archives[x].players.get(nba)).find(Boolean);
      return { nbaId: nba, name: raw.name || (old && old.n) || '', gp, val, like, rank }; // a player gone from the NBA: his archived name
    }).sort((a, b) => a.rank - b.rank);
    keepers[tid].forEach((k, i) => { k.slot = KEEPER_SLOTS[i] || 25; k.gain = k.like == null ? null : k.slot - k.like; });
  }
  return { picks, played: played.length, maxGp, graded: !!basis, date: L.draft.date, start: L.draft.start || null, type: L.draft.type, perRound: L.draft.perRound || 10, keepers, totals, season: W && W.win,
    slots: L.draft.slots || null, rostered: L.draft.rostered || null, rookies: !!L.draft.rookies }; // (Sleeper: its draft order; a dynasty rookie draft's kept players; rookies only)
}

// ----- Draft Retrospective (was Draft awards): this season's draft, for the league to share -----
// The ADP ones (Reach, Fall) go against consensus ADP (Fantrax's average draft position over its
// drafts): a pick is compared with where consensus would take its player in this draft. The league's keepers come off the
// board first (in a keeper league pick #1 is the first player after them), so a player's consensus spot is his place in
// ADP order among the players not kept. Trigger Finger and Clock Milker come from how long each pick took (Fantrax's pick
// times). The rest come from the players themselves: Glass (games missed the last two seasons), Youngins and Uncs (age
// on draft day), Homer (their real teams now) and Passport (their countries), each team's keepers counted with
// its picks (the owner's ask: a draft-day roster); the ADP and pick-time ones are picks only. Team awards count
// only teams with at least half as many picks as the most of any team, and a tie names every team in it. Not for a past
// season: today's ADP, ages and teams say nothing about a draft from another year. Each award is { label, html, text,
// p, tid, stats, faces }, as the Recap's standouts, so the same cards, picture and Share work for both (no emoji, the
// owner's ask), and detail: { title, html }, the breakdown its title opens (as the Awards tab's).
const adpOf = raw => (raw && ((raw.fx && raw.fx.adp) || raw.adp)) || null;
// Glass's seasons: the two before this one, from the season archives (loaded the first time they're asked for: null until then)
const glassLoading = new Set();
function glassSeasons() {
  const y = +String(NBA.season || '').slice(0, 4);
  if (!y) return null;
  const seasons = [seasonOf(y - 1), seasonOf(y - 2)];
  for (const s of seasons) {
    if (s in archives || glassLoading.has(s)) continue;
    glassLoading.add(s);
    loadArchive(s).then(() => { glassLoading.delete(s); if (ui.tab === 'draft') render(); });
  }
  return seasons.every(s => s in archives) ? seasons : null;
}
// A player's games missed in each of those seasons: his team's season (SPORT.seasonGames) less his games. A season he
// wasn't in the league yet (by his years in it, raw.exp) isn't his; one he was in but isn't in its archive he missed
// whole (out hurt all year). Goalies are left out: a healthy backup sits most games. null: no seasons to count (a rookie).
function missedSeasons(raw, seasons) {
  if (!raw || isGoalie(raw)) return null;
  const out = [];
  seasons.forEach((s, i) => {
    if (!archives[s]) return; // (a season with no archive counts for nobody)
    const st = archivedStats(raw, s);
    if (st) out.push(Math.max(0, SPORT.seasonGames - st.gp));
    else if ((raw.exp || 0) > i) out.push(SPORT.seasonGames);
  });
  return out.length ? out : null;
}
function draftAwards(d) {
  if (seasonCtx || !d || !d.picks || !d.picks.length) return [];
  const kit = draftAwardKit();
  draftAdpAwards(d, kit);
  draftClockAwards(d, kit);
  // ----- from the players themselves: each team's draft-day roster, its picks and its keepers, as the players they are now -----
  const keepers = Object.entries(d.keepers || {}).flatMap(([tid, ks]) => ks.map(k => ({ p: { teamId: tid, nbaId: k.nbaId, name: k.name, raw: nbaById.get(k.nbaId), pick: 0, keeper: true } })));
  const squads = kit.byTeam([...d.picks.map(p => ({ p })), ...keepers].filter(x => x.p.raw));
  if (squads.length) {
    draftGlassAward(squads, kit);
    draftAgeAwards(d, squads, kit);
    draftOriginAwards(squads, kit);
  }
  return kit.out;
}

// What every award is made of, around the list they go in (out): a player award, a team award (its winners, all of them on
// a tie), a breakdown's rows as the Awards tab's, the teams on top, and the teams with enough picks to count
function draftAwardKit() {
  const out = [];
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  // "A, B and C", "A, B, C and 2 others"
  const and = (list, max = 3) => (list.length <= 1 ? list[0] || '' : list.length <= max ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : `${list.slice(0, max).join(', ')} and ${plural(list.length - max, 'other')}`);
  const who = p => playerBtn(p.nbaId, lastName(p.name)); // (a name inside a line: his card)
  const named = p => `${who(p)}${p.keeper ? ' (keeper)' : ''}`; // (a breakdown's name, a keeper marked)
  // (a player award is drawn as the Recap's player standouts: standoutCard, recap.js; no emoji on any award, the owner's ask)
  const award = (label, x, said) => out.push({
    label, text: `${x.p.name} (${fxTeamName(x.p.teamId)}): ${said[0].toLowerCase()}${said.slice(1)}`, p: { nbaId: x.p.nbaId, name: x.p.name }, tid: x.p.teamId, stats: said,
  });
  // a breakdown's rows, as the Awards tab's: photo (or not), name, a line under it, its number on the right
  const row = (whoHtml, meta, v, cls = '') => `<li><div class="bplayer">${whoHtml}<div class="muted small">${meta}</div></div></div><b class="aw-break-v ${cls}">${v}</b></li>`;
  const teamWho = t => `<div class="bmain"><b>${teamLink(t.tid)}</b>`;
  const breakdown = (label, head, rows) => ({ title: label, html: `<p class="aw-break-total">${head}</p><ul class="aw-break">${rows}</ul>` });
  // a team award: the winners (all of them on a tie), what they did, the breakdown
  // (said: the same words for both, or [html, text] where a name in it opens his card; more: { faces } of the players it names)
  const teamAward = (label, winners, said, head, rows, more) => {
    const [sh, st] = Array.isArray(said) ? said : [said, said];
    out.push({
      label, html: `${and(winners.map(t => `<b>${teamLink(t.tid)}</b>`))}${winners.length > 1 ? ' tied' : ''}${sh}`,
      text: `${and(winners.map(t => fxTeamName(t.tid)))}${winners.length > 1 ? ' tied' : ''}${st}`, detail: breakdown(label, head, rows), ...more,
    });
  };
  // Each winner's player who stands out (its quickest pick, its youngest player...): named after the award's line and
  // shown as a face on its card (the owner's ask). pick: a winner -> { p, v } (v: what's said in brackets)
  const standout = (said, winners, word, pick) => {
    const ps = winners.map(pick), line = name => `; ${word}: ${and(ps.map(y => `${name(y.p)} (${y.v})`))}`;
    return [[`${said}${line(who)}`, `${said}${line(p => lastName(p.name))}`], { faces: ps.map(y => y.p) }];
  };
  // the teams on top by f (then by g on a tie), or none when the top isn't worth an award
  const best = (list, f, g = () => 0) => {
    const top = Math.max(...list.map(f)), at = list.filter(t => f(t) === top), top2 = Math.max(...at.map(g));
    return at.filter(t => g(t) === top2);
  };
  const tenth = v => Math.round(v * 10);
  const byTeam = list => {
    const m = new Map();
    for (const x of list) m.set(x.p.teamId, [...(m.get(x.p.teamId) || []), x]);
    const most = Math.max(0, ...[...m.values()].map(xs => xs.length));
    return [...m].filter(([, xs]) => xs.length >= most / 2).map(([tid, xs]) => ({ tid, xs, n: xs.length }));
  };
  return { out, plural, and, who, named, award, row, teamWho, breakdown, teamAward, standout, best, tenth, byTeam };
}

// ----- against consensus ADP: Reach, Fall (Value Meal, the team whose typical pick went latest, is gone: the owner's ask) -----
function draftAdpAwards(d, { out, plural, award, row, breakdown }) {
  // (a dynasty rookie draft: everyone already on a roster, d.rostered)
  const kept = new Set([...Object.values(d.keepers || {}).flat().map(k => k.nbaId), ...(d.rostered || [])]);
  const board = NBA.players.filter(r => adpOf(r) && !kept.has(r.id) && (!d.rookies || isRookie(r))).sort((a, b) => adpOf(a) - adpOf(b));
  const spot = new Map(board.map((r, i) => [r.id, i + 1]));
  const rated = d.picks.filter(p => p.nbaId && spot.has(p.nbaId)).map(p => ({ p, adp: adpOf(p.raw), cons: spot.get(p.nbaId), early: spot.get(p.nbaId) - p.pick }));
  if (rated.length < d.picks.length / 2) return; // (too few picks with an ADP to say otherwise)
  const pickWho = x => `${headshot({ nbaId: x.p.nbaId, name: x.p.name }, hsPx(32, 28))}<div class="bmain">${playerBtn(x.p.nbaId, x.p.name)}`;
  const spotsLine = x => `${esc(fxTeamName(x.p.teamId))} · taken #${x.p.pick} · consensus #${x.cons} (ADP ${fmt(x.adp, 1)})`;
  const said = (x, n, way) => `Taken #${x.p.pick}, ${plural(n, 'pick')} ${way}: consensus #${x.cons} (ADP ${fmt(x.adp, 1)})`;
  // Reach: taken furthest ahead of consensus; Fall, its inverse: taken furthest past it. Each breakdown, the 10 furthest
  const reaches = sortDesc(rated, x => x.early).filter(x => x.early > 0);
  if (reaches.length) {
    award('Reach', reaches[0], said(reaches[0], reaches[0].early, 'early'));
    out[out.length - 1].detail = breakdown('Reach', `The ${Math.min(10, reaches.length)} picks taken furthest ahead of consensus`,
      reaches.slice(0, 10).map(x => row(pickWho(x), spotsLine(x), `${x.early} early`)).join(''));
  }
  const falls = sortDesc(rated, x => -x.early).filter(x => x.early < 0);
  if (falls.length) {
    award('Fall', falls[0], said(falls[0], -falls[0].early, 'late'));
    out[out.length - 1].detail = breakdown('Fall', `The ${Math.min(10, falls.length)} picks taken furthest past consensus`,
      falls.slice(0, 10).map(x => row(pickWho(x), spotsLine(x), `${-x.early} late`)).join(''));
  }
}

// ----- how long each pick took, from Fantrax's pick times (ESPN, Sleeper and Yahoo give none): Trigger Finger, Clock Milker -----
// A pick's time is the wait since the pick before (the first pick's, since the draft opened). Only real times: a draft
// whose picks all carry one time (Fantrax rewrites an old draft's) has none. Each team's average pick time (the owner's
// ask, Nov 2026: one number; the median beside the average read as a mistake), a pause in the draft (a break, the
// commissioner's) included; with the winner's quickest pick (Trigger Finger) or longest (Clock Milker) on its card.
function draftClockAwards(d, { plural, who, row, teamWho, teamAward, standout, best, tenth, byTeam }) {
  const timed = d.picks.filter(p => p.at).sort((a, b) => a.pick - b.pick);
  if (timed.length < d.picks.length / 2 || new Set(timed.map(p => p.at)).size < timed.length / 2) return;
  const waits = [];
  let prev = d.start;
  for (const p of timed) { if (prev && p.at >= prev) waits.push({ p, s: (p.at - prev) / 1000 }); prev = p.at; }
  const clocks = byTeam(waits).map(t => { const ss = t.xs.map(x => x.s); return { ...t, avg: sum(ss) / ss.length, quick: sortDesc(t.xs, x => -x.s)[0], long: sortDesc(t.xs, x => x.s)[0] }; });
  if (clocks.length < 2) return;
  const sec = s => `${Math.round(s)} s`;
  // each award: its winners by their average, their quickest (or longest) pick, and every team's in the breakdown
  const give = (label, sign, word, end, order) => {
    const won = best(clocks, t => sign * tenth(t.avg));
    const rows = sortDesc(clocks, t => sign * t.avg).map(t => row(teamWho(t), `${word}: ${who(t[end].p)}, ${sec(t[end].s)}`, sec(t.avg))).join('');
    const [said, more] = standout(`: their picks took ${plural(Math.round(won[0].avg), 'second')} on average`, won, word, t => ({ p: t[end].p, v: sec(t[end].s) }));
    teamAward(label, won, said, `Each team's average pick time, ${order} first. A pause in the draft counts as pick time.`, rows, more);
  };
  give('Trigger Finger', -1, 'quickest', 'quick', 'fastest');
  give('Clock Milker', 1, 'longest', 'long', 'slowest');
}

// Glass: the most games missed a season, the last two seasons, by the team's players (each player-season counted once;
// a rookie has none). Shown once the two seasons' archives are in.
function draftGlassAward(squads, { row, teamWho, teamAward, best, tenth, named }) {
  const seasons = glassSeasons();
  if (!seasons) return;
  const glass = squads.map(t => {
    const each = t.xs.map(x => ({ x, m: missedSeasons(x.p.raw, seasons) })).filter(y => y.m);
    const all = each.flatMap(y => y.m);
    return all.length ? { ...t, each, avg: sum(all) / all.length } : null;
  }).filter(Boolean);
  const won = glass.length ? best(glass, t => tenth(t.avg)) : [];
  if (!won.length || won[0].avg <= 0) return;
  const rows = sortDesc(glass, t => t.avg).map(t => {
    const worst = sortDesc(t.each, y => sum(y.m) / y.m.length)[0];
    return row(teamWho(t), `most: ${named(worst.x.p)}, ${Math.round(sum(worst.m) / worst.m.length)} a season`, `${Math.round(t.avg)} a season`);
  }).join('');
  teamAward('Glass', won, `: their players missed ${Math.round(won[0].avg)} games a season, the last two seasons`,
    `Games each team's players (picks and keepers) missed a season, the last two seasons (${esc(seasons[1])} and ${esc(seasons[0])}). Rookies have none to count.`, rows);
}

// Youngins and Uncs: the youngest and oldest players on average, by age on draft day; the winner's youngest (oldest)
// player on its card
function draftAgeAwards(d, squads, { row, teamWho, teamAward, standout, best, tenth, named }) {
  const day = Date.parse(`${d.date || todayIso()}T12:00:00`);
  const ageOf = raw => (raw.born ? (day - Date.parse(`${raw.born}T12:00:00`)) / (365.25 * 864e5) : null);
  const ages = squads.map(t => {
    const each = t.xs.map(x => ({ x, a: ageOf(x.p.raw) })).filter(y => y.a != null);
    return each.length ? { ...t, each, avg: sum(each.map(y => y.a)) / each.length } : null;
  }).filter(Boolean);
  if (ages.length < 2) return;
  const endOf = (t, sign) => sortDesc(t.each, y => sign * y.a)[0]; // (a team's youngest, sign -1, or oldest player)
  const give = (label, sign, word) => {
    const won = best(ages, t => sign * tenth(t.avg));
    const rows = sortDesc(ages, t => sign * t.avg).map(t => { const end = endOf(t, sign); return row(teamWho(t), `${word}: ${named(end.x.p)}, ${Math.floor(end.a)}`, fmt(t.avg, 1)); }).join('');
    const [said, more] = standout(`: their players averaged ${fmt(won[0].avg, 1)} years old`, won, word, t => { const end = endOf(t, sign); return { p: end.x.p, v: Math.floor(end.a) }; });
    teamAward(label, won, said, `Each team's players' average age on draft day (picks and keepers), ${word} first`, rows, more);
  };
  give('Youngins', -1, 'youngest');
  give('Uncs', 1, 'oldest');
}

// Homer: the most players from one real team (by each player's team now); Passport (was The Globalist, then Frequent Flyer): the most
// countries (the owner's ask: players' nationalities, from the daily file's ISO codes)
function draftOriginAwards(squads, { out, and, who, row, teamWho, breakdown, teamAward, best, named }) {
  const stacks = squads.map(t => {
    const by = new Map();
    for (const x of t.xs) if (x.p.raw.team) by.set(x.p.raw.team, [...(by.get(x.p.raw.team) || []), x.p]);
    const top = sortDesc([...by], ([, ps]) => ps.length - Math.min(...ps.map(p => p.pick)) / 1e4)[0]; // (on a tie, the stack taken first: keepers count as before the draft)
    const nats = new Map();
    for (const x of t.xs) if (x.p.raw.nat) nats.set(x.p.raw.nat, (nats.get(x.p.raw.nat) || 0) + 1);
    return { ...t, teams: by.size, club: top && top[0], ps: (top && top[1]) || [], nats };
  });
  const homers = best(stacks, t => t.ps.length);
  if (homers.length && homers[0].ps.length >= 2) {
    const n = homers[0].ps.length, one = homers.length === 1 && homers[0], full = tri => (SPORT.teamNames || {})[tri] || tri;
    const rows = sortDesc(stacks, t => t.ps.length * 100 + t.teams).map(t => row(teamWho(t), t.ps.length > 1 ? `${teamBtn(t.club)}: ${t.ps.map(named).join(', ')}` : 'one player from each team', String(t.ps.length))).join('');
    out.push({
      label: 'Homer',
      // one team: whose players and who; a tie: each team and its real team
      html: one ? `<b>${teamLink(one.tid)}</b> has ${n} ${esc(full(one.club))} players: ${and(one.ps.map(who), Infinity)}` : `${and(homers.map(t => `<b>${teamLink(t.tid)}</b> (${teamBtn(t.club)})`))} tied: ${n} players each from one team`,
      text: one ? `${fxTeamName(one.tid)} has ${n} ${full(one.club)} players: ${and(one.ps.map(p => lastName(p.name)), Infinity)}` : `${and(homers.map(t => `${fxTeamName(t.tid)} (${t.club})`))} tied: ${n} players each from one team`,
      detail: breakdown('Homer', 'The most players each team has from one real team, picks and keepers (by his team now)', rows),
      ...(one ? { faces: one.ps } : {}), // (the players it names, as the Recap's cards show them)
    });
  }
  const globe = best(stacks, t => t.nats.size);
  if (globe.length && globe[0].nats.size > 1) {
    // each team's countries as flags, the most picks first (×2 for two)
    const flags = t => sortDesc([...t.nats], ([, k]) => k).map(([c, k]) => `${flagImg(c)}${k > 1 ? `×${k}` : ''}`).join(' ');
    const rows = sortDesc(stacks, t => t.nats.size * 100 - t.n).map(t => row(teamWho(t), flags(t) || 'no countries known', `${t.nats.size} ${t.nats.size === 1 ? 'country' : 'countries'}`)).join('');
    teamAward('Passport', globe, `: their players came from ${globe[0].nats.size} countries${globe.length > 1 ? ' each' : ''}`,
      "How many countries each team's players come from, picks and keepers", rows);
  }
}

// The card at the bottom of the Draft tab (set once the draft is over: the sections above change as the season goes on, the
// owner's ask), with Share; an award's title opens its breakdown ('draft-award', in the popup the
// (i) buttons use)
const draftAwardDetails = new Map(); // award label -> { title, html }, written as the card draws
function draftAwardsCard(d) {
  const items = draftAwards(d);
  draftAwardDetails.clear();
  if (!items.length) return '';
  const label = x => {
    if (!x.detail) return `<div class="rx-label">${x.label}</div>`;
    draftAwardDetails.set(x.label, x.detail);
    return `<button type="button" class="link-btn rx-label dr-award-btn" data-action="draft-award" data-key="${esc(x.label)}" title="${esc(x.label)}: the breakdown">${x.label}</button>`;
  };
  // (drawn as the Recap's standouts and the share picture: the owner's ask; each player still beside his big photo)
  return `<div class="card dr-awards dr-gap">
    <div class="card-head"><h2>Draft Retrospective ${infoBtn('draftAwards')}</h2>${shareBtn('draft-share')}</div>
    <div class="rx-grid">${items.map(x => standoutCard(x, label(x), true)).join('')}</div>
  </div>`;
}
// Sharing them (shareWith, recap.js): a picture, or the text and a link that opens the league's Draft tab
const draftUrl = L => `${location.origin}${location.pathname}?league=${encodeURIComponent(L.id)}#draft`;
const draftText = (L, items) => [`${L.name} · ${L.year ? `${seasonLabel(L.year)} ` : ''}Draft Retrospective`, ...items.map(x => `${x.label}: ${x.text}`)].join('\n\n');
function draftShare(L, d, items) {
  const kind = d.type ? `${d.type[0].toUpperCase()}${d.type.slice(1)} draft` : 'Draft';
  return {
    title: 'Draft Retrospective', name: `${L.name} · Draft Retrospective`, what: 'Draft Retrospective', link: 'Full draft', text: draftText(L, items), url: draftUrl(L),
    file: `${L.name.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'league'}-draft-retrospective.png`, alt: `Draft Retrospective for ${L.name}`,
    draw: () => shareCanvas({ kicker: `${L.year ? `${seasonLabel(L.year)} ` : ''}DRAFT RETROSPECTIVE`, title: L.name, items, sub: `${kind}${d.date ? `, ${fmtDay(d.date)}` : ''} · ${d.picks.length} picks` }),
  };
}

function draftRow(p, mine) {
  const gainCls = p.gain > 0 ? 'pos-good' : p.gain < 0 ? 'pos-bad' : 'muted';
  return `<tr class="${p.teamId === mine ? 'dr-mine' : ''}">
    <td class="st-name"><div class="bplayer">${headshot({ nbaId: p.nbaId, name: p.name }, hsPx(32, 28))}<div class="bmain"><div class="bname">${p.nbaId ? `${playerBtn(p.nbaId, p.name)}` : esc(p.name)}</div>
      <div class="pmeta">${teamLink(p.teamId)}${p.teamId === mine ? ' <span class="badge accent">you</span>' : ''}</div></div></div></td>
    <td class="num dr-at">R${p.round} · <b>#${p.pick}</b></td>
    <td class="num">${p.gp ? `#${p.rank}` : '<span class="muted">—</span>'}</td>
    <td class="num"><b class="${gainCls}">${p.gp ? signed(p.gain, 0) : 'DNP'}</b></td>
    <td class="num hide-sm">${p.gp}</td>
    <td class="num hide-sm">${p.score != null ? (ui.draftMode === 'total' ? fmt(p.score, isPoints() ? 0 : 1) : fmtValue(p.score)) : '—'}</td>
  </tr>`;
}

const draftValueLabel = () => (ui.draftMode === 'total' ? (isPoints() ? 'Total FP' : 'Total value') : valueLabel());

// ----- One team's draft: its keepers and every pick, opened from its name in Team drafts -----
const draftTeamCards = new Map(); // team id -> { title, html }, written as the Draft tab draws
function draftTeamCard(d, tid, ps) {
  const L = fxLeague();
  const year = seasonCtx ? seasonCtx.label : L && L.year ? seasonLabel(L.year) : '';
  const gain = (g, gp) => (!d.graded ? '' : gp ? `<b class="aw-break-v ${g > 0 ? 'pos-good' : g < 0 ? 'pos-bad' : 'muted'}">${signed(g, 0)}</b>` : '<b class="aw-break-v muted">DNP</b>');
  const row = (p, meta, right) => `<li><div class="bplayer">${headshot({ nbaId: p.nbaId, name: p.name }, hsPx(32, 28))}<div class="bmain">${p.nbaId ? `${playerBtn(p.nbaId, p.name)}` : `<span class="pname">${esc(p.name)}</span>`}<div class="muted small">${meta}</div></div></div>${right}</li>`;
  const ks = d.keepers[tid] || [];
  const keepers = ks.map(k => row(k, k.past ? 'Keeper' : `Keeper · graded as pick #${k.slot}${k.like ? ` · ${seasonCtx ? 'finished as' : 'playing like'} #${k.like}` : ''}`, k.past ? '' : gain(k.gain, k.gp))).join('');
  const picks = [...ps].sort((a, b) => a.pick - b.pick).map(p => row(p, `R${p.round} · pick #${p.pick}${d.graded && p.gp ? ` · ${seasonCtx ? 'finished as' : 'playing like'} #${p.rank}` : ''}`, gain(p.gain, p.gp))).join('');
  const avg = sum(ps.map(p => p.gain)) / ps.length;
  return {
    title: `${fxTeamName(tid)}: ${year ? `${year} ` : ''}draft`,
    html: `${d.graded ? `<p class="aw-break-total"><b class="${avg > 0 ? 'pos-good' : avg < 0 ? 'pos-bad' : ''}">${signed(avg, 1)}</b> a pick on average, from ${ps.length} pick${ps.length === 1 ? '' : 's'}</p>` : ''}
      ${keepers ? `<h3 class="sub">Keepers</h3><ul class="aw-break">${keepers}</ul>` : ''}
      <h3 class="sub">Picks</h3><ul class="aw-break">${picks}</ul>`,
  };
}

function draftList(title, list, mine, info) {
  return `<div class="card">
    <div class="card-head"><h2>${title} ${info ? infoBtn('draft') : ''}</h2></div>
    <div class="table-wrap"><table class="dr-table">
      <thead><tr><th>Player</th><th class="num">Drafted</th><th class="num">${seasonCtx ? 'Finished' : 'Now'}</th><th class="num">+/−</th><th class="num hide-sm">GP</th><th class="num hide-sm">${draftValueLabel()}</th></tr></thead>
      <tbody>${list.map(p => draftRow(p, mine)).join('')}</tbody>
    </table></div>
  </div>`;
}

function viewDraft() {
  const d = draftData();
  if (d && d.loading) return loadingCard("Loading the season's games…", "The draft is graded by the games inside your league's season.");
  if (!d && fxLeague() && fxLeague().draftFailed) {
    return `<div class="card"><div class="empty"><strong>Couldn't load the draft</strong>${sourceName()} didn't answer when the league loaded.<br><br><button type="button" class="btn primary" data-action="draft-retry">Try again</button></div></div>`;
  }
  if (!d) {
    return `<div class="card"><div class="empty"><strong>No draft results</strong>${sourceName()} didn't return draft picks for this league. Leagues that skipped the draft or started from imported rosters won't have any.</div></div>`;
  }
  const mine = myTeamId();
  const best = [...d.picks].filter(p => p.gp).sort((a, b) => (b.gain - a.gain) || (b.score - a.score)).slice(0, 10);
  const worst = [...d.picks].sort((a, b) => (a.gain - b.gain) || (a.pick - b.pick)).slice(0, 10);

  // team rankings: average +/− of every pick, plus best and worst pick
  const byTeam = {};
  for (const p of d.picks) (byTeam[p.teamId] = byTeam[p.teamId] || []).push(p);
  const teamRows = Object.entries(byTeam).map(([id, ps]) => {
    const avg = sum(ps.map(p => p.gain)) / ps.length;
    const top = ps.reduce((a, b) => (b.gain > a.gain ? b : a));
    const low = ps.reduce((a, b) => (b.gain < a.gain ? b : a));
    const total = sum(ps.filter(p => p.score != null).map(p => p.score));
    return { id, name: fxTeamName(id), n: ps.length, avg, top, low, total };
  }).sort((a, b) => b.avg - a.avg);
  draftTeamCards.clear();
  const pickName = p => (p.nbaId ? playerBtn(p.nbaId, lastName(p.name)) : esc(lastName(p.name))); // (his card, by his last name)
  for (const [id, ps] of Object.entries(byTeam)) draftTeamCards.set(id, draftTeamCard(d, id, ps));

  // board: one column per draft slot (round-1 order), one row per round. Traded picks stay in
  // their original slot, marked with the team that made them; keepers fill two rows on top.
  const T = d.perRound;
  const rounds = Math.max(...d.picks.map(p => p.round));
  const order = d.picks.filter(p => p.round === 1).sort((a, b) => a.pick - b.pick).map(p => p.teamId);
  // read each round's direction from the picks themselves (this league's order isn't a plain snake)
  const inRound = p => p.pick - (p.round - 1) * T;
  const forward = {};
  for (let r = 1; r <= rounds; r++) {
    const rp = d.picks.filter(p => p.round === r);
    forward[r] = rp.filter(p => order[inRound(p) - 1] === p.teamId).length >= rp.filter(p => order[T - inRound(p)] === p.teamId).length;
  }
  const colOf = p => (p.slot ? p.slot - 1 : forward[p.round] ? inRound(p) - 1 : T - inRound(p)); // (Sleeper says each pick's slot)
  const grid = {};
  for (const p of d.picks) grid[`${p.round}|${colOf(p)}`] = p;
  // each column belongs to the team whose draft slot it is (Sleeper says), else the team that picked there most often,
  // so a traded first-rounder doesn't move it
  const cols = d.slots && d.slots.length === T ? d.slots : order.map((first, c) => {
    const n = {};
    for (let r = 1; r <= rounds; r++) { const p = grid[`${r}|${c}`]; if (p) n[p.teamId] = (n[p.teamId] || 0) + 1; }
    const top = Object.entries(n).sort((a, b) => b[1] - a[1])[0];
    return top ? top[0] : first;
  });
  const nameBtn = (nbaId, name) => nbaId ? `<button class="link-btn" data-action="player-detail" data-nba="${nbaId}"><span class="n-full">${esc(name)}</span><span class="n-short">${esc(shortName(name))}</span></button>` : esc(name);
  const gainTag = (gain, gp) => !d.graded ? '' : `<span class="dr-gain ${gain > 0 ? 'pos-good' : gain < 0 ? 'pos-bad' : 'muted'}">${gp ? signed(gain, 0) : 'DNP'}</span>`;
  const keeperRows = !Object.values(d.keepers).some(k => k.length) ? '' : [0, 1].map(i => `<tr class="dr-krow"><th scope="row">K${i + 1}</th>${cols.map(t => {
    const k = (d.keepers[t] || [])[i];
    if (!k) return '<td class="dr-cell dr-keeper"></td>';
    if (k.past) return `<td class="dr-cell dr-keeper" title="${esc(k.name)} · keeper (not graded)"><span class="dr-pick">Keeper</span> ${nameBtn(k.nbaId, k.name)}</td>`;
    return `<td class="dr-cell dr-keeper" style="${k.gain != null ? shade(k.gain / 15) : ''}" title="${esc(k.name)} · keeper, graded as pick #${k.slot} · ${k.like ? `${seasonCtx ? 'finished as' : 'playing like'} #${k.like} (${signed(k.gain, 0)})` : "hasn't played"}">
      <span class="dr-pick">Keeper · as #${k.slot}</span> ${nameBtn(k.nbaId, k.name)} ${gainTag(k.gain, k.gp)}</td>`;
  }).join('')}</tr>`).join('');
  const board = keeperRows + Array.from({ length: rounds }, (_, r) => `<tr><th scope="row" class="num">R${r + 1}</th>${cols.map((t, c) => {
    const p = grid[`${r + 1}|${c}`];
    if (!p) return '<td class="dr-cell"><span class="dr-pick">No pick</span></td>';
    const via = p.teamId !== t ? `<span class="dr-via">by ${esc(p.team)}</span>` : '';
    return `<td class="dr-cell" style="${p.gp ? shade(p.gain / 15) : ''}" title="${esc(p.name)} · pick #${p.pick}${via ? ` (traded, made by ${esc(p.team)})` : ''} · ${p.gp ? `${seasonCtx ? 'finished as' : 'playing like'} #${p.rank} (${signed(p.gain, 0)})` : "hasn't played"}">
      <span class="dr-pick">#${p.pick}</span> ${nameBtn(p.nbaId, p.name)} ${gainTag(p.gain, p.gp)}${via}</td>`;
  }).join('')}</tr>`).join('');

  const modeSeg = !d.graded ? '' : segBtns('Rank picks by', 'draft-mode', 'mode', [['game', 'Per game'], ['total', 'Season totals']], ui.draftMode);
  const kind = d.type ? d.type[0].toUpperCase() + d.type.slice(1) + ' draft' : 'Draft';
  const gradedBy = !d.graded ? `not graded: the site has no ${SPORT.name} stats for that season`
    : d.season ? `graded by the games of the league's season, ${fmtDay(d.season.from)} – ${fmtDay(d.season.to)}`
    : seasonCtx ? `graded by ${seasonCtx.label} full-season stats`
    : `compared with this season so far (up to ${d.maxGp} game${d.maxGp === 1 ? '' : 's'} played)`;
  return `
  <div class="page-sub-row">${modeSeg}<p class="page-sub">${kind}${d.date ? `, ${fmtDay(d.date)}` : ''} · ${d.picks.length} picks · ${gradedBy} ${infoBtn('draft')}</p></div>
  ${!seasonCtx && d.maxGp < 10 ? `<div class="sample-banner"><span>It's early: players have ${d.maxGp} game${d.maxGp === 1 ? '' : 's'} at most, so one big night can swing a ranking a lot. This settles down after a few weeks.</span></div>` : ''}
  ${d.graded ? `<div class="trade-grid">
    ${draftList(seasonCtx ? 'Best picks' : 'Best picks so far', best, mine, true)}
    ${draftList(seasonCtx ? 'Worst picks' : 'Worst picks so far', worst, mine, false)}
  </div>` : ''}
  <div class="card dr-gap">
    <div class="card-head"><h2>Team drafts</h2><span class="muted small">ranked by average +/− per pick</span></div>
    <div class="table-wrap"><table class="dr-teams">
      <thead><tr><th class="num">#</th><th>Team</th><th class="num">Avg +/−</th><th class="num">${d.totals ? draftValueLabel() : `Total ${valueLabel()}`}</th><th>Best pick</th><th>Worst pick</th></tr></thead>
      <tbody>${teamRows.map((t, i) => `<tr class="${t.id === mine ? 'dr-mine' : ''}"><td class="num">${i + 1}</td><td><button type="button" class="link-btn aw-team" data-action="draft-team" data-team="${esc(t.id)}" title="See ${esc(t.name)}'s picks and keepers"><b>${esc(t.name)}</b></button>${t.id === mine ? ' <span class="badge accent">you</span>' : ''}</td>
        <td class="num"><b class="${t.avg > 0 ? 'pos-good' : t.avg < 0 ? 'pos-bad' : ''}">${signed(t.avg, 1)}</b></td><td class="num">${fmtValue(t.total)}</td>
        <td>${inlinePlayer(t.top, pickName(t.top))} <span class="muted small">#${t.top.pick}</span> <span class="pos-good small">${t.top.gp ? signed(t.top.gain, 0) : ''}</span></td>
        <td>${inlinePlayer(t.low, pickName(t.low))} <span class="muted small">#${t.low.pick}</span> <span class="pos-bad small">${t.low.gp ? signed(t.low.gain, 0) : 'DNP'}</span></td></tr>`).join('')}</tbody>
    </table></div>
  </div>
  <div class="card dr-gap">
    <div class="card-head"><h2>Draft board ${infoBtn('board')}</h2></div>
    <div class="table-wrap"><table class="dr-board">
      <thead><tr><th></th>${cols.map(t => `<th class="${t === mine ? 'dr-mine-col' : ''}">${teamLink(t)}</th>`).join('')}</tr></thead>
      <tbody>${board}</tbody>
    </table></div>
  </div>
  ${draftAwardsCard(d)}`;
}
