// Run with: node --test tests/
// Fixtures (tests/fixtures) are saved Fantrax, ESPN and NBA responses; refresh them with tests/capture_fixtures.py.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, readFixture } = require('./harness');

const CATS9 = 'my19c8mwmoipvhon'; // 9-cat H2H, most categories wins, weekly lineups
const POINTS = 'la2a76bkmt6aqekb'; // H2H points, weekly lineups
const DAILY = 'frapfs43mutrff0g'; // H2H points with double/triple-doubles, daily lineups, not drafted yet
const ESPN = '794342666'; // public ESPN league: H2H points, daily lineups, starts in week 3 (Nov 2)

let app;
test.before(async () => { app = loadApp(); await app.ready(); });

// Make a Fantrax team the one being managed, the way the site does after picking a team
function useTeam(teamId) {
  const side = app.fxTeamSide(teamId);
  Object.assign(app.get('state'), { fxTeam: teamId, players: side.players, il: side.il, lineup: side.lineup, teamName: side.name });
  return side;
}
const leagueInfo = id => JSON.parse(readFixture(`fantrax/${id}/getLeagueInfo.json`));
const between = (x, lo, hi) => Number.isFinite(x) && x >= lo && x <= hi;

test('reads each league format from Fantrax', async () => {
  const cats = await app.useLeague(CATS9);
  assert.equal(cats.name, 'Keepers and Creepers');
  assert.deepEqual([...cats.cats], ['fgPct', 'ftPct', 'tpm', 'pts', 'reb', 'ast', 'stl', 'blk', 'to']);
  assert.equal(cats.points, undefined);
  assert.equal(app.leagueLineupMode(cats), 'weekly');
  assert.deepEqual(JSON.parse(JSON.stringify(app.slotsFromLeague(cats))), { slots: ['PG', 'SG', 'G', 'SF', 'PF', 'F', 'C', 'FLX'], bench: 5, ir: 1 });
  assert.equal(cats.playoffPeriod, 19);
  assert.equal(cats.standings.length, 10);

  const pts = await app.useLeague(POINTS);
  assert.deepEqual({ ...pts.points }, { ast: 1.5, blk: 2, pts: 1, reb: 1.25, stl: 2, to: -1 });
  assert.equal(app.leagueLineupMode(pts), 'weekly');
  assert.ok(app.slotsFromLeague(pts).slots.filter(s => s === 'FLX').length === 5, 'Flx slots map to FLX');

  const daily = await app.useLeague(DAILY);
  assert.equal(daily.points.dd, 3);
  assert.equal(daily.points.td, 6);
  assert.equal(app.leagueLineupMode(daily), 'daily');
  assert.ok(daily.rosterPeriods.length > 150, 'one lineup period per day');
});

test('the columns a matchup is decided on follow the league', async () => {
  await app.useLeague(CATS9);
  assert.equal(app.scoreCats().map(c => c.key).join(), 'fgPct,ftPct,tpm,pts,reb,ast,stl,blk,to');
  await app.useLeague(POINTS);
  assert.equal(app.scoreCats().map(c => c.key).join(), 'pts,reb,ast,stl,blk,to,fp');
  assert.ok(app.scoreCats().find(c => c.key === 'to').neg, 'negative points make a stat count against you');
});

test('category lists other than the standard nine', () => {
  const base = leagueInfo(CATS9).scoringSystem;
  const withCats = list => ({ ...base, scoringCategorySettings: [{ ...base.scoringCategorySettings[0], configs: list.map(([shortName, code]) => ({ position: { code: 'DEFAULT' }, scoringCategory: { shortName, code } })) }] });
  const cfgs = base.scoringCategorySettings[0].configs.map(c => [c.scoringCategory.shortName, c.scoringCategory.code]);

  const eight = app.fxCategories(withCats(cfgs.filter(([s]) => s !== 'TO')));
  assert.equal(eight.cats.join(), 'fgPct,ftPct,tpm,pts,reb,ast,stl,blk');

  const eleven = app.fxCategories(withCats([...cfgs, ['3PT%', 'INDIVIDUAL_THREE_POINT_FIELD_GOAL_PERCENTAGE'], ['DD', 'INDIVIDUAL_DOUBLE_DOUBLES'], ['A/TO', 'INDIVIDUAL_ASSIST_TO_TURNOVER_RATIO']]));
  assert.equal(eleven.cats.join(), 'fgPct,ftPct,tpPct,tpm,pts,reb,ast,stl,blk,to,dd');
  assert.deepEqual([...eleven.catsOther], ['A/TO'], "ratios aren't projected, and say so");

  assert.deepEqual({ ...app.fxCategories(leagueInfo(POINTS).scoringSystem) }, {}, 'points leagues have no category list');
});

test('an 11-category league projects every category', async () => {
  const L = await app.useLeague(CATS9);
  L.cats = ['fgPct', 'ftPct', 'tpPct', 'tpm', 'pts', 'reb', 'ast', 'stl', 'blk', 'to', 'dd'];
  app.set('catsMemo', { L: null, cats: [] }); // forget the league's nine
  assert.equal(app.scoreCats().length, 11);
  const [a, b] = app.fxPickable();
  const A = app.fxTeamSide(a.id), B = app.fxTeamSide(b.id);
  for (const p of A.players) {
    const z = app.catZ(p);
    assert.equal(Object.keys(z).length, 11);
    assert.ok(Number.isFinite(app.value(p)), `${p.name} has a value`);
  }
  const dates = app.matchDates();
  const cats = app.compareCats(app.projectSide(A.players, dates, null), app.projectSide(B.players, dates, null));
  assert.equal(cats.length, 11);
  for (const c of cats) assert.ok(between(c.p, 0, 1), `${c.label} win chance ${c.p}`);
  const tp = cats.find(c => c.key === 'tpPct');
  assert.ok(between(tp.a, 0.2, 0.5), `team 3P% ${tp.a}`);
  assert.ok(between(app.matchOdds(cats).win, 0, 1));
  delete L.cats;
});

test('points leagues: unusual scoring codes and position-specific points', () => {
  const ss = {
    type: 'HEAD_TO_HEAD_POINTS_BASED',
    scoringCategorySettings: [{ configs: [
      { position: { code: 'DEFAULT' }, points: '1', scoringCategory: { code: 'INDIVIDUAL_POINTS', shortName: 'PTS' } },
      { position: { code: 'DEFAULT' }, points: '-0.5', scoringCategory: { code: 'INDIVIDUAL_FIELD_GOALS_MISSED', shortName: 'FGMI' } },
      { position: { code: 'DEFAULT' }, points: '1', scoringCategory: { code: 'INDIVIDUAL_OFFENSIVE_REBOUNDS', shortName: 'OR' } },
      { position: { code: 'DEFAULT' }, points: '-2', scoringCategory: { code: 'INDIVIDUAL_TECHNICAL_FOULS', shortName: 'TF' } },
      { position: { code: 'C' }, points: '1', scoringCategory: { code: 'INDIVIDUAL_BLOCKS', shortName: 'BLK' } },
    ] }],
  };
  const r = app.fxPointsScoring(ss);
  assert.deepEqual({ ...r.points }, { pts: 1, fgmi: -0.5, oreb: 1 });
  assert.deepEqual([...r.pointsOther], ['TF', 'position-specific points']);
});

test('Fantrax slot names', () => {
  assert.deepEqual(['Flx', 'Util', 'UT', 'PG', 'G/F', 'F/C'].map(s => app.fxSlot(s)), ['FLX', 'FLX', 'FLX', 'PG', 'G/F', 'F/C']);
});

test('which game days belong to a lineup period', () => {
  const weekly = { start: '2026-10-20T15:00:00.0-0400', end: '2026-10-26T18:59:59.0-0400' };
  assert.ok(app.periodHas(weekly, '2026-10-20'));
  assert.ok(app.periodHas(weekly, '2026-10-25'));
  assert.ok(!app.periodHas(weekly, '2026-10-26'), "Monday's games after the 7 PM lock count for the next week");
  const daily = { start: '2026-11-03T00:00:00.0-0500', end: '2026-11-03T23:59:59.0-0500' };
  assert.ok(app.periodHas(daily, '2026-11-03'));
  assert.ok(!app.periodHas(daily, '2026-11-04'));
});

test('season totals reproduce every week-1 result on Fantrax', async () => {
  const L = await app.useLeague(CATS9);
  const weeks = await app.loadRosterWeeks(L);
  const G = await app.loadGameLog('cur');
  const w1 = weeks.find(w => w.n === 1);
  const totals = app.pastSeasonTotals({ ...L, weeks: [w1], fidNba: app.currentFidNba() }, G);
  const tot = Object.fromEntries(Object.entries(totals).map(([tid, T]) => [tid, T.s]));
  for (const T of Object.values(totals)) assert.ok(between(T.gp, 15, 32), `${T.gp} player games: each game counted once`);
  const val = (s, c) => (c.pct ? s[c.made] / s[c.att] : s[c.key]);
  for (const [a, b] of L.matchups['1']) {
    let wa = 0, wb = 0;
    for (const c of app.scoreCats()) {
      const x = val(tot[a], c), y = val(tot[b], c);
      if (Math.abs(x - y) < 1e-9) continue;
      if (c.neg ? x < y : x > y) wa++; else wb++;
    }
    const ra = L.standings.find(r => r.id === a);
    const result = ra.w ? 'win' : ra.l ? 'loss' : 'tie';
    assert.equal(wa > wb ? 'win' : wa < wb ? 'loss' : 'tie', result, `${app.fxTeamName(a)} ${wa}-${wb} vs ${app.fxTeamName(b)}`);
  }
});

test('a finished week: its real result, and the bench swaps that would have changed it', async () => {
  const L = await app.useLeague(CATS9);
  const weeks = await app.loadRosterWeeks(L);
  const G = await app.loadGameLog('cur');
  const fidNba = app.currentFidNba();
  const period = L.periods.find(p => p.n === 1);
  const pair = L.matchups['1'].find(m => m.some(t => app.fxTeamName(t).startsWith('Team Sincere')));
  const me = pair.find(t => app.fxTeamName(t).startsWith('Team Sincere')), them = pair.find(t => t !== me);
  // a game the evening week 1 ends (Monday Oct 26, 7 p.m.) belongs to week 2, as does week 2's lineup
  const w2 = weeks.find(w => w.n === 2);
  const late = [...w2.owner].find(([, o]) => o.tid === me && o.on)[0];
  const day = Math.round((new Date('2026-10-26T12:00:00') - new Date(G.start + 'T12:00:00')) / 864e5);
  const G2 = { ...G, players: new Map(G.players) };
  G2.players.set(fidNba(late), [...(G.players.get(fidNba(late)) || []), [day, 0, ...G.keys.map(k => (k === 'pts' ? 50 : 1))]]);
  const [A, B] = app.benchSwaps({ ...L, fidNba }, G2, weeks, period, [me, them]);
  // the final counts what Season totals counts: week 1 here was a tie
  const tot = app.pastSeasonTotals({ ...L, weeks: [weeks.find(w => w.n === 1)], fidNba }, G);
  assert.equal(A.tot.pts, tot[me].s.pts);
  assert.equal(B.tot.reb, tot[them].s.reb);
  const sc = app.weekScore(A.tot, B.tot);
  assert.equal(sc.me, sc.opp, 'tied');
  // a swap: the bench player's games that week in, the starter's out
  const days = app.periodDays(G, weeks.find(w => w.n === 1));
  const pts = p => (G.players.get(fidNba(p.fid)) || []).filter(r => days.has(r[0])).reduce((t, r) => t + app.gameLine(G, r).pts, 0);
  const w = A.swaps.find(x => pts(x.inP) !== pts(x.outP));
  assert.equal(w.tot.pts, A.tot.pts - pts(w.outP) + pts(w.inP));
  // the card: for a team with a winning swap, it says so
  useTeam(me);
  const ui = app.get('ui');
  ui.weekShift = -1;
  try {
    app.pastWeekCard(app.weekStart()); // starts loading the week's lineups and box scores
    await new Promise(r => setTimeout(r, 10));
    const html = app.pastWeekCard(app.weekStart());
    assert.ok(html.includes('How week 1 ended') && html.includes('class="alert good"') && html.includes('Would have won'), html.slice(0, 400));
    // the page shows the week as it was played, with nothing projected
    const page = app.viewWeek();
    assert.ok(page.includes('Week total') && !/project|win chance|to win the week|Plan next week/i.test(page), 'a finished week, not a projection');
    assert.equal((page.match(/<tr class="bench">/g) || []).length, A.bench.length + B.bench.length, "both teams' benches that week");
  } finally { ui.weekShift = 0; }
  assert.equal(app.pastWeekCard(app.weekStart()), '', 'not for a week still being played');
});

test('points matchups project fantasy points with sensible odds', async () => {
  await app.useLeague(POINTS);
  const [a, b] = app.fxPickable();
  const A = app.fxTeamSide(a.id), B = app.fxTeamSide(b.id);
  const dates = app.matchDates();
  const cats = app.compareCats(app.projectSide(A.players, dates, null), app.projectSide(B.players, dates, null));
  const fp = cats.find(c => c.fp);
  assert.ok(fp.a > 100 && fp.b > 100, `projected FP ${fp.a} vs ${fp.b}`);
  const odds = app.matchOdds(cats);
  assert.ok(between(odds.win, 0, 1) && odds.points);
});

test('a matchup week covers the league period, and daily leagues still project', async () => {
  await app.useLeague(CATS9);
  assert.equal(app.matchDates().length, 7);
  await app.useLeague(DAILY);
  const dates = app.matchDates();
  assert.ok(dates.length >= 6, `${dates.length} days`);
  const pool = app.nbaPlayers().slice(0, 13).map(x => app.playerFromRaw(app.nbaById.get(x.nbaId)));
  const S = app.projectSide(pool, dates, null);
  assert.ok(Number.isFinite(app.fpTotals(S).a) && app.fpTotals(S).a > 0, 'double/triple-double points included without NaN');
});

test("Matchups steps through the league's matchup weeks and its teams", async () => {
  const L = await app.useLeague(CATS9);
  useTeam(L.teams[0].id);
  assert.deepEqual([...app.weekShifts()], [-1, 0, 1, 2, 3, 4], 'week 1 began Oct 20: no stepping back into the preseason');
  const ui = app.get('ui');
  ui.weekShift = -1;
  try {
    const nav = app.weekPicker();
    assert.equal((nav.match(/<option /g) || []).length, 6);
    assert.ok(nav.includes('>Week 2 (this week)<') && nav.includes('selected>Week 1<'), nav);
    assert.ok(/data-step="-1"[^>]*disabled/.test(nav) && !/data-step="1"[^>]*disabled/.test(nav), 'the first week: only forward');
  } finally { ui.weekShift = 0; }
  // the opponent picker is the same control: step buttons around a league-bar dropdown
  const strip = app.fxStrip(app.weekContext());
  assert.ok(strip.includes('class="stepper"') && strip.includes('class="ctx-team" data-change="fx-opp"') && strip.includes('data-action="fx-cycle"'), strip);
});

test('short names never collide', () => {
  const players = app.get('NBA').players;
  for (const fn of [app.lastName, app.shortName]) {
    const seen = new Map();
    for (const p of players) {
      const n = fn(p.name);
      assert.ok(!seen.has(n), `${p.name} and ${seen.get(n)} both show as ${n}`);
      seen.set(n, p.name);
    }
  }
  assert.equal(app.lastName('Nikola Jokić'), 'Jokić');
  assert.equal(app.lastName('Jamal Murray'), 'J. Murray');
  assert.equal(app.lastName('Dejounte Murray'), 'D. Murray');
});

test('draft grades per game and by season totals', async () => {
  await app.useLeague(CATS9);
  const ui = app.get('ui');
  for (const mode of ['game', 'total']) {
    ui.draftMode = mode;
    const d = app.draftData();
    const ranks = d.picks.map(p => p.rank).sort((x, y) => x - y);
    assert.deepEqual(ranks, d.picks.map((_, i) => i + 1), `${mode}: every pick gets one rank`);
    for (const p of d.picks) assert.equal(p.gain, p.pick - p.rank);
  }
  ui.draftMode = 'game';
});

test('recommended adds beat the player they replace', async () => {
  const L = await app.useLeague(CATS9);
  useTeam(L.standings[0].id);
  const r = app.recommendedAdds();
  assert.ok(r.adds.length <= 3);
  for (const x of r.adds) {
    assert.ok(x.gain > 0);
    assert.notEqual(x.p.status, 'Out');
    assert.ok(!app.get('state').players.some(p => p.nbaId === x.p.nbaId), `${x.p.name} isn't already on the team`);
  }
});

test('a finished week projects exactly what happened', async () => {
  const L = await app.useLeague(CATS9);
  await app.loadBoxes();
  const weeks = await app.loadRosterWeeks(L);
  const w1 = weeks.find(w => w.n === 1), toNba = app.currentFidNba();
  const lineups = { 1: {} };
  for (const [f, o] of w1.owner) if (o.on && toNba(f)) (lineups[1][o.tid] = lineups[1][o.tid] || []).push(toNba(f));
  const p1 = L.periods.find(p => p.n === 1);
  const dates = app.matchDates(p1.start);
  assert.ok(dates.length >= 6 && !dates.includes('2026-10-26'), 'week 1 ends before Monday night');
  // each team's week-1 starters, projected over week 1: every game is final, so nothing is left to chance
  const side = tid => {
    const players = lineups[1][tid].map(id => app.playerFromRaw(app.nbaById.get(id)));
    return app.projectSide(players, dates, new Set(players.map(p => p.id)));
  };
  for (const [a, b] of L.matchups['1']) {
    const cats = app.compareCats(side(a), side(b));
    for (const c of cats) assert.ok([0, 0.5, 1].includes(c.p), `${c.label} is settled (${c.p})`);
    const won = cats.filter(c => c.p === 1).length, lost = cats.filter(c => c.p === 0).length;
    const ra = L.standings.find(r => r.id === a);
    assert.equal(won > lost ? 'win' : won < lost ? 'loss' : 'tie', ra.w ? 'win' : ra.l ? 'loss' : 'tie', `${app.fxTeamName(a)} ${won}-${lost}`);
  }
});

test('a past season is graded from its archived stats, inactive players included', async () => {
  const P = await app.loadSeason('czqgnyozmf2tbr93');
  assert.equal(P.basis, 'arch:2025-26');
  const picks = P.league.draft.picks;
  const matched = picks.filter(p => p[3]).length;
  const inactive = picks.filter(p => p[3] && app.nbaById.get(p[3]).inactive).length;
  assert.equal(matched, picks.length, 'every pick matched, nicknames and players since out of the NBA included');
  // grade it the way the past-season Draft tab does
  app.set('seasonCtx', { basis: P.basis, label: P.label });
  const savedLeague = app.get('NBA').league;
  app.get('NBA').league = P.league;
  try {
    const d = app.draftData();
    assert.ok(d.graded);
    const played = d.picks.filter(p => p.gp);
    assert.ok(played.length >= picks.length - 10, `${played.length} picks have 2025-26 stats`);
    assert.ok(played.every(p => Number.isFinite(p.val)));
    if (inactive) assert.ok(played.some(p => p.raw && p.raw.inactive), 'a player no longer in the NBA is graded too');
  } finally {
    app.get('NBA').league = savedLeague;
    app.set('seasonCtx', null);
  }
});

test('Fantrax names written differently still match (Nicolas / Nic Claxton)', async () => {
  const { fxPlayers } = await app.fetchFantraxLeague(CATS9);
  const nic = app.get('NBA').players.find(p => p.name === 'Nic Claxton');
  assert.ok(nic, 'fixture has Nic Claxton');
  const ids = JSON.parse(readFixture('fantrax/getPlayerIds.json'));
  const fid = Object.keys(ids).find(k => ids[k].name === 'Claxton, Nicolas');
  assert.equal(fxPlayers[nic.id] && fxPlayers[nic.id].id, fid);
});

test('weekly rosters tell trades from waiver pickups', async () => {
  const P = await app.loadSeason('czqgnyozmf2tbr93');
  const L = P.league;
  assert.ok(L.weeks && L.weeks.length > 15, 'every week of the season loaded');
  const last = L.weeks.length - 1;
  const team = L.teams.find(t => t.name === "Eli's SGAteam");
  const how = name => { const it = L.rosters[team.id].find(x => x.name === name); return it && app.arrivalAt(L.weeks, last, it.fid); };
  assert.equal(how('Lauri Markkanen'), 'trade', 'Markkanen came over from mikeysak in week 17');
  assert.equal(how('VJ Edgecombe'), 'trade');
  const kinds = [...L.weeks[last].owner].filter(([, o]) => o.tid === team.id).map(([f]) => app.arrivalAt(L.weeks, last, f));
  assert.ok(kinds.includes('pickup') && kinds.includes('start'));
  // the award counts only pickups
  const G = await app.loadGameLog('2025-26');
  assert.ok(G && G.days.size === 30, 'game log with every team');
  app.get('ui').season = 'czqgnyozmf2tbr93';
  let awards;
  try { awards = app.withSeason(() => app.seasonAwards()); } finally { app.get('ui').season = null; }
  const wizard = awards.find(a => a.title === 'Waiver Wire Wizard');
  assert.ok(wizard && !/Markkanen|Edgecombe/.test(wizard.list.map(x => x.note).join(' ')), 'traded players are not pickups');
  // impact counts only the weeks a pickup started for that team, dropped players included
  app.get('ui').season = 'czqgnyozmf2tbr93';
  let impact;
  try { impact = app.withSeason(() => app.pickupImpact(L, G)); } finally { app.get('ui').season = null; }
  const mine = impact[team.id];
  assert.ok(!mine.some(p => /Markkanen|Edgecombe/.test(p.name)));
  const kpj = mine.find(p => p.name === 'Kevin Porter Jr.');
  assert.ok(kpj && kpj.weeks < L.weeks.length && kpj.games > 0, `KPJ counted for ${kpj && kpj.weeks} weeks`);
  const finalIds = new Set(Object.values(L.rosters).flat().map(x => x.nba));
  assert.ok(Object.values(impact).flat().some(p => !finalIds.has(p.nba)), 'a pickup dropped before the end still counts');
});

test('Street Clothes counts only games starters missed while starting', async () => {
  const P = await app.loadSeason('czqgnyozmf2tbr93');
  const L = P.league, G = await app.loadGameLog('2025-26');
  const sat = app.startersMissed(L, G);
  const all = Object.values(sat).flat();
  assert.ok(all.length > 0 && all.every(p => p.games > 0));
  // a team's starters can't miss more games than they had lineup weeks with games
  for (const [tid, ps] of Object.entries(sat)) {
    const total = app.sum(ps.map(p => p.games));
    assert.ok(total < L.weeks.length * 8 * 4, `${app.fxTeamName(tid)}: ${total} games`);
  }
  // nobody counts for a team in weeks he wasn't starting there: recount one player by hand
  const team = L.teams.find(t => t.name === "Eli's SGAteam");
  const pick = sat[team.id][0];
  const rows = G.players.get(pick.nba) || [];
  let n = 0;
  for (const w of L.weeks) {
    const o = [...w.owner].find(([f, x]) => x.tid === team.id && x.on && L.fidNba(f) === pick.nba);
    if (!o) continue;
    for (const day of app.periodDays(G, w)) {
      const t = app.teamOn(G, rows, day) || (app.nbaById.get(pick.nba) || {}).team;
      if (!rows.some(r => r[0] === day) && G.days.get(t) && G.days.get(t).has(day)) n++;
    }
  }
  assert.equal(pick.games, n, `${pick.name}: ${pick.games} games`);
});

test('Unc Status averages the ages of the players each team started', async () => {
  const P = await app.loadSeason('czqgnyozmf2tbr93');
  const ages = app.startersAge(P.league);
  const teams = Object.values(ages);
  assert.equal(teams.length, P.league.teams.length);
  for (const T of teams) {
    assert.ok(T.age > 21 && T.age < 34, `average age ${T.age}`);
    assert.ok(T.n > P.league.weeks.length * 4, `${T.n} starter-weeks with a birth date`);
  }
});

test('Best draft credits picks until first dropped, through trades', async () => {
  const P = await app.loadSeason('czqgnyozmf2tbr93');
  const L = P.league, G = await app.loadGameLog('2025-26');
  app.get('ui').season = 'czqgnyozmf2tbr93';
  let imp, picks;
  try {
    app.withSeason(() => { picks = app.draftData().picks; imp = app.draftImpact(L, G, picks); });
  } finally { app.get('ui').season = null; }
  const team = L.teams.find(t => t.name === "Eli's SGAteam");
  const daniels = imp[team.id].find(p => p.name === 'Dyson Daniels');
  // traded to mikeysak in week 17: his later games still count for the team that drafted him
  const f = [...L.weeks[0].owner.keys()].find(k => L.fidNba(k) === daniels.nba);
  const lastOnTeam = L.weeks.reduce((k, w, i) => ((w.owner.get(f) || {}).tid === team.id ? i : k), -1);
  const rows = G.players.get(daniels.nba) || [];
  const gamesWhileMine = L.weeks.slice(0, lastOnTeam + 1).reduce((n, w) => n + rows.filter(r => app.periodDays(G, w).has(r[0])).length, 0);
  assert.ok(lastOnTeam < L.weeks.length - 1, 'he was traded away before the end');
  assert.ok(daniels.games > gamesWhileMine, `${daniels.games} games counted, ${gamesWhileMine} before the trade`);
  // every team's picks are all accounted for
  assert.equal(Object.values(imp).flat().length, picks.length);
});

test('a past season\'s weekly totals replay its final standings', async () => {
  const P = await app.loadSeason('czqgnyozmf2tbr93');
  const L = P.league, G = await app.loadGameLog('2025-26');
  const rec = {};
  app.get('ui').season = 'czqgnyozmf2tbr93';
  try {
    app.withSeason(() => {
      const cats = app.scoreCats();
      const val = (T, c) => (!T ? 0 : c.pct ? (T.s[c.att] ? T.s[c.made] / T.s[c.att] : 0) : T.s[c.key] || 0);
      for (const w of L.weeks.filter(x => x.n < L.playoffPeriod)) {
        const one = app.pastSeasonTotals({ ...L, weeks: [w] }, G);
        for (const [a, b] of L.matchups[String(w.n)] || []) {
          let wa = 0, wb = 0;
          for (const c of cats) { const x = val(one[a], c), y = val(one[b], c); if (Math.abs(x - y) < 1e-9) continue; if (c.neg ? x < y : x > y) wa++; else wb++; }
          for (const [t, r] of [[a, Math.sign(wa - wb)], [b, Math.sign(wb - wa)]]) { rec[t] = rec[t] || { w: 0, l: 0, t: 0 }; rec[t][r > 0 ? 'w' : r < 0 ? 'l' : 't']++; }
        }
      }
    });
  } finally { app.get('ui').season = null; }
  const exact = L.standings.filter(s => rec[s.id] && rec[s.id].w === s.w && rec[s.id].l === s.l && rec[s.id].t === s.t).length;
  // 89 of 90 regular-season matchups agree with Fantrax (one week 17 matchup was decided by 4 points)
  assert.ok(exact >= 8, `${exact} of ${L.standings.length} records match Fantrax exactly`);
});

test('past Rosters list only starters, with games and misses that match the awards', async () => {
  const P = await app.loadSeason('czqgnyozmf2tbr93');
  const L = P.league, G = await app.loadGameLog('2025-26');
  const sat = app.startersMissed(L, G);
  for (const t of L.teams) {
    const st = [...app.activeStints(L, G, t.id).values()];
    assert.ok(st.length >= 8 && st.every(p => p.weeks > 0));
    assert.equal(app.sum(st.map(p => p.missed)), app.sum((sat[t.id] || []).map(p => p.games)), `${t.name}: missed games agree with Street Clothes`);
  }
});

test('a past season shows its keepers without grading them', async () => {
  const P = await app.loadSeason('czqgnyozmf2tbr93');
  const L = P.league;
  const team = L.teams.find(t => t.name === "Eli's SGAteam");
  const names = L.draft.keepers[team.id].map(id => app.nbaById.get(id).name).sort();
  assert.deepEqual(names, ['Karl-Anthony Towns', 'Shai Gilgeous-Alexander']);
  assert.ok(Object.values(L.draft.keepers).every(k => k.length === 2), 'two keepers per team');
  app.get('ui').season = 'czqgnyozmf2tbr93';
  let d;
  try { app.withSeason(() => { d = app.draftData(); }); } finally { app.get('ui').season = null; }
  const ks = d.keepers[team.id];
  assert.ok(ks.every(k => k.past && k.gain === undefined && k.slot === undefined), 'listed, not graded');
  assert.ok(!d.picks.some(p => names.includes(p.name)), 'keepers are not draft picks');
});

test('past Rosters mark keepers', async () => {
  const P = await app.loadSeason('czqgnyozmf2tbr93');
  const L = P.league, G = await app.loadGameLog('2025-26');
  const team = L.teams.find(t => t.name === "Eli's SGAteam");
  const st = [...app.activeStints(L, G, team.id).values()];
  assert.deepEqual(st.filter(p => p.how === 'keeper').map(p => p.name).sort(), ['Karl-Anthony Towns', 'Shai Gilgeous-Alexander']);
  assert.ok(st.some(p => p.how === 'start') && st.some(p => p.how === 'pickup') && st.some(p => p.how === 'trade'));
});

test('keepers only in leagues whose draft leaves roster spots open', async () => {
  const pts = await app.useLeague(POINTS); // 14 rounds for 14 spots
  assert.equal(pts.draft.rounds, 14);
  assert.deepEqual({ ...pts.draft.keepers }, {}, 'a full-roster draft has no keepers, so pickups are not mistaken for them');
  const cats = await app.useLeague(CATS9); // 12 rounds for 13 spots
  assert.ok(cats.draft.rounds < 13);
  const counts = Object.values(cats.draft.keepers).map(k => k.length);
  assert.equal(counts.length, cats.teams.length);
  assert.ok(counts.every(n => n === 2), `keepers per team: ${counts}`);
});

test('Best manager compares actual wins with an all-play record', async () => {
  const P = await app.loadSeason('czqgnyozmf2tbr93');
  const L = P.league, G = await app.loadGameLog('2025-26');
  app.get('ui').season = 'czqgnyozmf2tbr93';
  let ap, awards;
  try { app.withSeason(() => { ap = app.allPlayRecords(L, G, false); awards = app.seasonAwards(); }); } finally { app.get('ui').season = null; }
  const teams = Object.values(ap);
  const weeks = teams[0].weeks;
  assert.equal(weeks, L.weeks.filter(w => w.n < L.playoffPeriod).length, 'every regular-season week');
  // each pairing splits one win, so a week's expected wins add up to half the teams
  assert.ok(Math.abs(app.sum(teams.map(t => t.exp)) - weeks * teams.length / 2) < 1e-6);
  for (const t of teams) assert.ok(t.pct >= 0 && t.pct <= 1);
  const bm = awards.find(a => a.title === 'Best manager');
  assert.match(bm.list[0].note, /all-play \d+%/);
});

test('Fantrax: leagues are reused from the device, shared lists fetched once, failures retried', async () => {
  const calls = [];
  const realFetch = app.fetch;
  app.fetch = url => { calls.push(String(url)); return realFetch(url); };
  try {
    app.localStorage.removeItem('courtside-fantrax-shared-v1');
    app.set('fxShared', null);
    await app.getLeague(POINTS, true);
    await app.getLeague(CATS9, true);
    assert.equal(calls.filter(u => u.includes('getPlayerIds')).length, 1, 'player list once for both leagues');
    assert.equal(calls.filter(u => u.includes('getAdp')).length, 1);
    calls.length = 0;
    await app.getLeague(POINTS);
    assert.equal(calls.length, 0, 'a fresh saved league needs no requests');
  } finally { app.fetch = realFetch; }
  // a server error is retried, then the request succeeds
  let n = 0;
  app.fetch = url => (++n === 1 ? Promise.resolve({ ok: false, status: 503, headers: { get: () => '0' } }) : realFetch(url));
  try {
    const info = await app.fxGet(`getLeagueInfo?leagueId=${POINTS}`);
    assert.ok(info.teamInfo && n === 2, 'one retry after a 503');
  } finally { app.fetch = realFetch; }
  // a "not found" isn't retried
  n = 0;
  app.fetch = () => { n++; return Promise.resolve({ ok: false, status: 404, headers: { get: () => null } }); };
  try { await assert.rejects(app.fxGet('getLeagueInfo?leagueId=nope')); assert.equal(n, 1); } finally { app.fetch = realFetch; }
});

// ----- ESPN -----
test('league IDs and addresses from either site', () => {
  assert.equal(app.parseLeagueId(' my19c8mwmoipvhon '), 'my19c8mwmoipvhon');
  assert.equal(app.parseLeagueId('https://www.fantrax.com/fantasy/league/my19c8mwmoipvhon/home'), 'my19c8mwmoipvhon');
  assert.equal(app.parseLeagueId('794342666'), '794342666');
  assert.equal(app.parseLeagueId('https://fantasy.espn.com/basketball/league?leagueId=794342666&seasonId=2027'), '794342666');
  assert.equal(app.parseLeagueId('fantasy.espn.com/basketball/team?seasonId=2027&leagueId=794342666&teamId=3'), '794342666');
  assert.equal(app.parseLeagueId('not a league'), null);
  assert.equal(app.leagueSourceOf('794342666'), 'espn');
  assert.equal(app.leagueSourceOf('my19c8mwmoipvhon'), 'fantrax');
});

test('reads a public ESPN league into the same shape as a Fantrax one', async () => {
  const L = await app.useLeague(ESPN);
  assert.equal(L.source, 'espn');
  assert.equal(L.name, 'Portland Pro H2H Points League');
  assert.equal(app.sourceName(L), 'ESPN');
  assert.deepEqual({ ...L.points }, { pts: 1, reb: 1, ast: 2, stl: 4, blk: 4, to: -2, fgm: 2, fga: -1, ftm: 1, fta: -1, tpm: 1 });
  assert.equal(app.leagueLineupMode(L), 'daily');
  assert.deepEqual(JSON.parse(JSON.stringify(app.slotsFromLeague(L))), { slots: ['PG', 'SG', 'G', 'SF', 'PF', 'F', 'C', 'FLX', 'FLX', 'FLX'], bench: 3, ir: 1 });
  assert.equal(L.teams.length, 10);
  assert.ok(L.teams.every(t => typeof t.id === 'string' && t.name === t.name.trim()));
  // every roster: 10 starters, 3 bench; nearly everyone matched to an NBA player
  const all = Object.values(L.rosters).flat();
  assert.equal(all.length, 130);
  assert.equal(all.filter(x => x.st === 'ACTIVE').length, 100);
  assert.ok(all.filter(x => x.nba).length >= 125, 'rostered players matched to NBA.com');
  assert.equal(L.draft.picks.length, 130);
  assert.equal(L.draft.perRound, 10);
  assert.equal(L.standings.length, 10);
  assert.equal(L.playoffPeriod, 20);
});

test("ESPN's weeks get dates: Monday to Sunday, All-Star break joined to the next week", async () => {
  const L = await app.useLeague(ESPN);
  const span = n => { const p = L.periods.find(x => x.n === n); return p && `${p.start}..${p.end}`; };
  // as ESPN's own schedule page shows them
  assert.equal(L.periods[0].n, 3, "the league starts in week 3, so weeks 1 and 2 aren't its matchups");
  assert.equal(span(3), '2026-11-02..2026-11-08');
  assert.equal(span(17), '2027-02-08..2027-02-14');
  assert.equal(span(18), '2027-02-15..2027-02-28');
  assert.equal(span(19), '2027-03-01..2027-03-07');
  assert.equal(span(20), '2027-03-08..2027-03-21', 'two-week playoff rounds');
  assert.equal(span(21), '2027-03-22..2027-04-04');
  assert.deepEqual(Object.keys(L.matchups).map(Number), Array.from({ length: 17 }, (_, i) => i + 3), 'matchups only in league weeks; playoffs not set yet');
  assert.equal(app.matchDates('2027-02-15').length, 14);
  const me = L.teams[0].id;
  assert.equal(app.fxOpponentFor('2026-10-26', me), null, 'no matchup before the league starts');
  assert.ok(app.fxOpponentFor('2026-11-02', me), 'an opponent in week 3');
});

test('ESPN category scoring, and how a week is decided', () => {
  const items = [[19, 0], [20, 0], [17, 0], [0, 0], [6, 0], [3, 0], [2, 0], [1, 0], [11, 1], [35, 0]].map(([statId, rev]) => ({ statId, points: 0, isReverseItem: !!rev }));
  const sc = app.espnScoring({ scoringType: 'H2H_MOST_CATEGORIES', scoringItems: items });
  assert.equal(sc.cats.join(), 'fgPct,ftPct,tpm,pts,reb,ast,stl,blk,to');
  assert.deepEqual([...sc.catsOther], ['stat 35'], "a stat the site can't project is listed");
  assert.ok(app.mostCatsWins('H2H_MOST_CATEGORIES') && app.mostCatsWins('HEAD_TO_HEAD_ROTI_SINGLE_WIN'));
  assert.ok(!app.mostCatsWins('H2H_CATEGORY') && !app.mostCatsWins('H2H_POINTS'));
});

test('ESPN matchups project, and unrostered players are available', async () => {
  const L = await app.useLeague(ESPN);
  const [a, b] = L.matchups['3'][0];
  const A = app.fxTeamSide(a), B = app.fxTeamSide(b);
  assert.equal(A.lineup.filter(Boolean).length, 10, 'every starter in a lineup slot');
  const dates = app.matchDates('2026-11-02');
  assert.equal(dates.length, 7);
  const cats = app.compareCats(app.projectSide(A.players, dates, null), app.projectSide(B.players, dates, null));
  const fp = cats.find(c => c.fp);
  assert.ok(fp.a > 300 && fp.b > 300, `projected FP ${fp.a} vs ${fp.b}`);
  assert.ok(between(app.matchOdds(cats).win, 0, 1));

  // ESPN's player list marks who's on a roster; everyone else can be picked up
  const saved = app.NBA.players.map(r => [r, r.fx, r.pos]);
  try {
    app.applyFantraxLeague(await app.getLeague(ESPN, true));
    const owned = app.nbaById.get(Object.values(L.rosters).flat().find(x => x.nba).nba);
    assert.ok(owned.fx && !app.fxAvailable(owned), 'a rostered player is taken');
    const free = app.NBA.players.find(r => r.fx && r.fx.st === 'A');
    assert.ok(free && app.fxAvailable(free), 'an unrostered player is available');
    assert.equal(app.FX_STATUS[free.fx.st], 'Available');
  } finally {
    for (const [r, fx, pos] of saved) { if (fx) r.fx = fx; else delete r.fx; r.pos = pos; }
    app.set('nbaCache', null);
  }
});

test('ESPN: weekly lineup history stays Fantrax-only, and nothing asks Fantrax for it', async () => {
  const L = await app.useLeague(ESPN);
  assert.ok(!app.hasLineupHistory(L));
  assert.ok(app.hasLineupHistory(await app.useLeague(CATS9)));
  const calls = [];
  const realFetch = app.fetch;
  app.fetch = (url, init) => { calls.push(String(url)); return realFetch(url, init); };
  try { assert.equal(await app.fetchRosterWeeks(L), null); } finally { app.fetch = realFetch; }
  assert.equal(calls.length, 0);
});

test('ESPN: leagues are reused from the device, the player list fetched once, private leagues explained', async () => {
  const calls = [];
  const realFetch = app.fetch;
  app.fetch = (url, init) => { calls.push(String(url)); return realFetch(url, init); };
  try {
    app.localStorage.removeItem('courtside-espn-shared-v1');
    app.set('espnShared', null);
    await app.getLeague(ESPN, true);
    await app.getLeague(ESPN, true);
    assert.equal(calls.filter(u => u.includes('/players?')).length, 1, 'player list once a day');
    assert.equal(calls.filter(u => u.includes('/leagues/')).length, 2);
    calls.length = 0;
    await app.getLeague(ESPN);
    assert.equal(calls.length, 0, 'a fresh saved league needs no requests');
  } finally { app.fetch = realFetch; }
  app.fetch = (url, init) => (String(url).includes('/leagues/') ? Promise.resolve({ ok: false, status: 401, headers: { get: () => null } }) : realFetch(url, init));
  try { await assert.rejects(app.fetchEspnLeague('123456'), /private league/); } finally { app.fetch = realFetch; }
});

// run fn as if it were noon Eastern on that day
async function onDay(iso, fn) {
  const RealDate = app.Date;
  const at = Date.parse(`${iso}T12:00:00-04:00`);
  app.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [at])); } static now() { return at; } };
  try { return await fn(); } finally { app.Date = RealDate; }
}

test('performances: today, the last game day before it, and this week once it has more than one day', async () => {
  await app.loadBoxes();
  await app.useLeague(CATS9);
  const days = async iso => JSON.parse(JSON.stringify(await onDay(iso, () => app.perfDays())));
  assert.deepEqual(await days('2026-10-21'), { today: '2026-10-21', started: true, day: '2026-10-20', week: ['2026-10-20', '2026-10-21'] }, 'Wednesday: today, last night, the days played so far');
  // Monday at noon (the same date in any US time zone and UTC)
  assert.deepEqual(await days('2026-10-26'), { today: '2026-10-26', started: false, day: '2026-10-25', week: null }, "Monday before tip-off: last night was last week's");
  await onDay('2026-10-26', () => {
    const html = app.topPerformancesCard();
    assert.ok(html.includes('data-range="today"') && html.includes('>Yesterday<') && !html.includes('data-range="week"'), 'Today and Yesterday; no week yet');
    assert.ok(html.includes('class="on" data-action="perf-range" data-range="day"') && html.includes('Last night'), "before tip-off it opens on last night's games");
    app.ui.perfRange = 'today';
    try {
      assert.ok(app.topPerformancesCard().includes("Loading today's games"), 'today, before ESPN has answered');
    } finally { app.ui.perfRange = null; }
  });
  await onDay('2026-10-21', () => {
    const toggle = app.topPerformancesCard();
    assert.ok(toggle.includes('data-range="week"') && toggle.includes('class="on" data-action="perf-range" data-range="today"'), "all three, on today once its games have started");
  });
});

test("performances: this week adds up each player's games", async () => {
  await app.loadBoxes();
  await app.useLeague(CATS9);
  const dates = ['2026-10-23', '2026-10-24', '2026-10-25'];
  const rows = app.perfRows(dates);
  const r = rows.find(x => x.g >= 2);
  const lines = dates.map(d => app.BOX.day.get(r.raw.id).get(d)).filter(Boolean);
  assert.equal(r.g, lines.length);
  assert.equal(r.tot.pts, lines.reduce((t, l) => t + l.pts, 0));
  // categories won against not playing, so the week is just its games added up
  const games = lines.reduce((t, l) => t + Object.values(app.catWins(l)).reduce((a, b) => a + b, 0), 0);
  assert.ok(Math.abs(r.v - games) < 1e-9);
  app.ui.perfRange = 'week';
  try {
    const html = await onDay('2026-10-25', () => app.topPerformancesCard());
    assert.match(html, /\d G · \d+ min/, 'rows show games played');
  } finally { app.ui.perfRange = null; }
});

test('performances: value is categories won against not playing, every category weighing the same', async () => {
  await app.loadBoxes();
  await app.useLeague(CATS9);
  const v = line => Object.values(app.catWins(line)).reduce((a, b) => a + b, 0);
  const W = app.winWeights();
  assert.equal(v({}), 0, 'not playing adds nothing');
  // counting stats only add; a steal is worth several points (steals decide a category with far smaller totals)
  const pt = app.catWins({ pts: 1 }).pts, stl = app.catWins({ stl: 1 }).stl;
  assert.ok(pt > 0 && stl / pt > 4 && stl / pt < 20, `a steal is worth ${(stl / pt).toFixed(1)} points`);
  assert.ok(app.catWins({ to: 1 }).to < 0, 'turnovers take away');
  // shooting adds only above the league's average
  assert.ok(Math.abs(app.catWins({ fgm: W.fgPct.p * 10, fga: 10 }).fgPct) < 1e-12, 'average shooting: nothing either way');
  assert.ok(app.catWins({ ftm: 0, fta: 2 }).ftPct < 0 && app.catWins({ ftm: 2, fta: 2 }).ftPct > 0);
  // an ordinary starter's game helps; a brick-and-turnover night with little else hurts
  const ordinary = { min: 32, pts: 18, reb: 6, ast: 4, stl: 1, blk: 1, tpm: 2, to: 2, fgm: 7, fga: 15, ftm: 2, fta: 3 };
  assert.ok(v(ordinary) > 0.1 && v(ordinary) < 0.4, `an ordinary game adds ${v(ordinary).toFixed(2)} categories`);
  assert.ok(v({ min: 30, pts: 2, reb: 7, ast: 6, fgm: 1, fga: 10, ftm: 0, fta: 2, to: 5 }) < 0);
  assert.ok(v({ min: 34, pts: 36, reb: 14, ast: 5, stl: 3, blk: 2, tpm: 4, to: 0, fgm: 14, fga: 25, ftm: 4, fta: 4 }) > 2 * v(ordinary));
});

test('player value everywhere is the Dashboard\'s: categories won per game; trades count it over a waiver player', async () => {
  await app.useLeague(CATS9);
  const list = app.nbaPlayers().filter(p => p.gp >= 2).sort((a, b) => b.val - a.val);
  const p = list[0];
  assert.ok(Math.abs(p.val - Object.values(app.catWins(p)).reduce((a, b) => a + b, 0)) < 1e-12);
  // an average game of his is worth his value (FG% × attempts for makes, the same as a game line)
  const line = { ...app.statLine(p) };
  assert.ok(Math.abs(app.lineValue(line) - app.value(p)) < 1e-9);
  assert.ok(list.filter(x => x.val < 0).length < list.length / 10, 'nearly every player adds something when he plays');
  const wv = app.waiverValue();
  assert.ok(wv > 0 && wv < p.val, `the best waiver player is worth ${wv.toFixed(2)} a game`);
  // starting a player for the week: his games × his value
  const raw = app.nbaById.get(p.nbaId), pl = app.playerFromRaw(raw);
  const dates = app.matchDates(app.weekStart());
  if (pl.status !== 'Out') assert.ok(Math.abs(app.weeklyPriority(pl, dates) - app.gamesIn(pl, dates) * Math.max(app.value(pl), 0.01)) < 1e-12);
  // a trade: two for one only wins if they beat the one plus the waiver player you'd otherwise keep
  const mine = app.get('state').players;
  const theirTeam = app.fxPickable().find(t => t.id !== app.get('state').fxTeam);
  const theirs = app.fxTeamSide(theirTeam.id).players.filter(x => x.nbaId);
  const ui = app.get('ui');
  ui.tradeTeam = theirTeam.id; ui.tradeGive.clear(); ui.tradeGet.clear();
  try {
    const give = mine[0], get = theirs.slice(0, 2);
    ui.tradeGive.add(give.id); get.forEach(x => ui.tradeGet.add(String(x.nbaId)));
    const html = app.viewTrade();
    const net = get.reduce((t, x) => t + app.value(x) - wv, 0) - (app.value(give) - wv);
    assert.ok(html.includes(`net <b>${app.fmtValue(net)}</b>`), 'net over a waiver player');
    assert.ok(html.includes('over a waiver player'));
  } finally { ui.tradeGive.clear(); ui.tradeGet.clear(); }
});

test("player profile: value per game (each game, each season's averages) and this season's games added up", async () => {
  await app.useLeague(CATS9);
  const raw = app.NBA.players.find(r => r.log && r.log.length && app.statObj(r.cur) && app.statObj(r.cur).gp >= 2);
  assert.ok(raw, 'a player with games this season');
  const els = {}, doc = app.document, before = doc.querySelector;
  doc.querySelector = sel => (els[sel] = els[sel] || { innerHTML: '', open: false, showModal() { this.open = true; } });
  try {
    app.showPlayerDetail(raw.id);
    const html = els['#detailBody'].innerHTML;
    const cur = app.statObj(raw.cur), per = app.lineValue(app.statLine(cur));
    assert.ok(Math.abs(per - app.lineValue(cur)) < 1e-9, 'makes and attempts as they are (season rows have no FG%)');
    const proj = app.nbaStats(raw);
    assert.ok(Math.abs(app.statLine(proj).fgm - proj.fgPct * proj.fga) < 1e-9, 'projections: makes from FG%');
    assert.ok(html.includes('Value per game') && html.includes(app.signed(per, 2)), 'this season per game');
    assert.ok(html.includes(`${app.signed(per * Math.round(cur.gp), 1)} <span class="muted small">in ${Math.round(cur.gp)} G</span>`), 'this season in all');
    // linear: an average line is worth the average of its games
    const games = raw.log.map(g => Object.fromEntries(app.NBA.logKeys.map((k, i) => [k, g[i]])));
    for (const o of games) assert.ok(html.includes(app.signed(app.lineValue(o), 2)), `${o.date}: its value`);
    const avg = Object.fromEntries(['pts', 'reb', 'ast', 'stl', 'blk', 'tpm', 'to', 'fgm', 'fga', 'ftm', 'fta'].map(k => [k, games.reduce((t, o) => t + o[k], 0) / games.length]));
    assert.ok(Math.abs(app.lineValue(avg) - games.reduce((t, o) => t + app.lineValue(o), 0) / games.length) < 1e-9);
    assert.match(html, /<th class="num">Value<\/th><\/tr><\/thead><tbody><tr><td><b>Projection/, 'a Value column for each season');
  } finally { doc.querySelector = before; }
});

test('performances: the last game day marks each category leader with an emoji', async () => {
  await app.loadBoxes();
  await app.useLeague(CATS9);
  const day = app.perfDays().day;
  const rows = app.perfRows([day]);
  const cats = app.scoreCats().filter(c => !c.fp);
  const cellsOf = html => Object.fromEntries(html.split('<tbody>')[1].split('</tr>').slice(0, -1).map(tr => [tr.match(/data-nba="(\d+)"/)[1], [...tr.matchAll(/<td class="sc"[^>]*>(.*?)<\/td>/g)].map(m => m[1])]));
  app.ui.perfRange = 'day';
  const show = app.ui.perfShow;
  app.ui.perfShow = { me: true, opp: true, other: true, active: true, bench: true, fa: true };
  try {
    const html = app.topPerformancesCard();
    assert.match(html, /pf-legend/, 'a legend');
    app.ui.perfSort = { key: 'v', dir: 1 }; // the worst too
    const cells = { ...cellsOf(html), ...cellsOf(app.topPerformancesCard()) };
    app.ui.perfSort = { key: 'fgPct', dir: 1 }; // the worst shooting
    Object.assign(cells, cellsOf(app.topPerformancesCard()));
    app.ui.perfSort = { key: 'v', dir: -1 };
    const emo = (id, i) => ((cells[id] || [])[i] || '').match(/pf-emo[^>]*>([^<]+)</);
    for (const [i, c] of cats.entries()) {
      if (c.pct) continue;
      const val = r => app.lineStat(r.tot, c.key);
      const top = Math.max(...rows.map(val));
      const leaders = rows.filter(r => val(r) === top);
      const want = c.neg ? '\u{1F9C8}' : '\u{1F680}';
      for (const r of leaders) if (leaders.length <= 3 && cells[r.raw.id]) assert.equal((emo(r.raw.id, i) || [])[1], want, `${c.label}: ${r.raw.name} leads with ${top}`);
      const others = Object.keys(cells).filter(id => !leaders.some(r => String(r.raw.id) === id));
      assert.ok(others.every(id => !emo(id, i) || emo(id, i)[1] === '\u{1F525}'), `${c.label}: only the leaders and the second best are marked`);
    }
    const fg = cats.findIndex(c => c.key === 'fgPct');
    const marks = Object.keys(cells).map(id => emo(id, fg)).filter(Boolean).map(m => m[1]);
    assert.ok(marks.includes('\u{1F680}') && marks.includes('\u{1F9CA}'), `FG%: best and worst shooting marked (${marks})`);
    app.ui.perfRange = 'week';
    if (app.perfDays().week) assert.ok(!app.topPerformancesCard().includes('pf-emo'), 'only for a single finished day');
  } finally { app.ui.perfRange = null; app.ui.perfShow = show; app.ui.perfSort = { key: 'v', dir: -1 }; }
});

test('performances: everyone who played in one table, top 50 by the sorted column, ranked by value', async () => {
  await app.loadBoxes();
  const cell = (tr, i) => [...tr.matchAll(/<td class="sc"[^>]*>(?:<span[^>]*>[^<]*<\/span>)?([^<]*)</g)][i][1];
  const bodyRows = html => html.split('<tbody>')[1].split('</tr>').slice(0, -1);
  const val = tr => parseFloat(tr.match(/class="num pf-v[^"]*"[^>]*>([^<]+)</)[1].replace('\u2212', '-'));
  for (const id of [CATS9, ESPN]) {
    await app.useLeague(id);
    const all = app.perfRows([app.perfDays().day]);
    let rows = bodyRows(app.topPerformancesCard());
    assert.equal(rows.length, Math.min(50, all.length), `${id}: up to 50 rows`);
    assert.ok(!app.topPerformancesCard().includes('<h3 class="sub">'), 'no separate Best and Worst lists');
    const vals = rows.map(val);
    assert.ok(vals.every((v, i) => !i || v <= vals[i - 1]), `${id}: best first`);
    assert.deepEqual(rows.slice(0, 5).map(tr => +tr.match(/perf-rank">(\d+)/)[1]), [1, 2, 3, 4, 5]);
    assert.ok(rows.every(tr => !/<td class="sc"[^>]*style=/.test(tr)), `${id}: stats aren't colored`);
    const top = rows[0].match(/class="num pf-v" style="([^"]*)"/), low = rows.find(tr => val(tr) < -0.05);
    assert.match(top[1], /--good/, `${id}: the best value is green`);
    if (low) assert.match(low, /class="num pf-v" style="[^"]*--bad/, `${id}: a game that hurt is red`);
    app.ui.perfSort = { key: 'v', dir: 1 };
    try {
      rows = bodyRows(app.topPerformancesCard());
      assert.equal(+rows[0].match(/perf-rank">(\d+)/)[1], all.length, `${id}: sorted the other way, the worst line of all ${all.length} comes first`);
    } finally { app.ui.perfSort = { key: 'v', dir: -1 }; }
  }
  await app.useLeague(CATS9);
  const cats = app.scoreCats().map(c => c.key);
  app.ui.perfSort = { key: 'pts', dir: -1 };
  try {
    const rows = bodyRows(app.topPerformancesCard());
    const pts = rows.map(tr => +cell(tr, cats.indexOf('pts')));
    assert.ok(pts.every((v, i) => !i || v <= pts[i - 1]), `points, most first: ${pts.slice(0, 8)}`);
    const fg = rows.map(tr => tr.match(/<td class="sc"[^>]*title="FG%: ([^"]+)">(?:<span[^>]*>[^<]*<\/span>)?([^<]*)</));
    assert.ok(fg.every(m => m && /^\d+-\d+$/.test(m[2]) && /%|no attempts/.test(m[1])), 'shooting shows makes-attempts, the percentage on hover');
    assert.ok(rows.map(tr => +tr.match(/perf-rank">(\d+)/)[1]).some((v, i) => v !== i + 1), 'ranks still by value');
  } finally { app.ui.perfSort = { key: 'v', dir: -1 }; }
});

test('performances: filter by my team, the opponent, waivers and other teams', async () => {
  await app.loadBoxes();
  const L = await app.useLeague(CATS9);
  const day = app.perfDays().day;
  const owned = new Map(Object.entries(L.rosters).flatMap(([tid, r]) => r.filter(x => x.nba).map(x => [x.nba, tid])));
  // my team: whoever has the most players in that day's games
  const played = app.perfRows([day]);
  const per = {};
  for (const r of played) { const t = owned.get(r.raw.id); if (t) per[t] = (per[t] || 0) + 1; }
  const me = Object.keys(per).sort((a, b) => per[b] - per[a])[0];
  const was = app.state.fxTeam;
  app.state.fxTeam = me;
  const ids = html => [...(html.split('<tbody>')[1] || '').matchAll(/data-nba="(\d+)"/g)].map(m => +m[1]);
  const count = html => +html.match(/· (?:\d+ of )?(\d+) players?</)[1];
  try {
    let html = app.topPerformancesCard();
    assert.ok(['me', 'fa', 'other'].every(k => html.includes(`data-group="${k}" aria-pressed="true"`)), 'all on by default');
    assert.equal(count(html), played.length);
    for (const k of ['opp', 'fa', 'other']) app.ui.perfShow[k] = false;
    html = app.topPerformancesCard();
    assert.equal(count(html), per[me]);
    assert.ok(ids(html).every(id => owned.get(id) === me), 'only my players');
    assert.equal((html.match(/<tr class="pf-me">/g) || []).length, ids(html).length, 'my rows are tinted');
    assert.ok(!html.includes('>Your team<'), 'no Your team badge');
    app.ui.perfShow.me = false; app.ui.perfShow.fa = true;
    html = app.topPerformancesCard();
    assert.ok(ids(html).length && ids(html).every(id => !owned.has(id)), 'only players not on a roster');
    app.ui.perfShow.fa = false;
    assert.match(app.topPerformancesCard(), /No players match/);
    const opp = app.fxOpponentFor(day, me);
    if (opp && played.some(r => owned.get(r.raw.id) === opp.id)) {
      app.ui.perfShow.opp = true;
      html = app.topPerformancesCard();
      assert.ok(ids(html).length && ids(html).every(id => owned.get(id) === opp.id), "only the opponent's players");
      assert.ok(html.includes('<tr class="pf-opp">') && html.includes(`title="Opponent: ${opp.name.replace(/'/g, '&#39;')}"`), "the opponent's rows are tinted");
    }
  } finally {
    app.state.fxTeam = was;
    Object.assign(app.ui.perfShow, { me: true, opp: true, fa: true, other: true, active: true, bench: true });
  }
});

test('performances: Active and Bench filters, and an Active badge', async () => {
  await app.loadBoxes();
  const L = await app.useLeague(CATS9);
  const spot = new Map(Object.values(L.rosters).flat().filter(x => x.nba).map(x => [x.nba, x.st]));
  const ids = html => [...(html.split('<tbody>')[1] || '').matchAll(/data-nba="(\d+)"/g)].map(m => +m[1]);
  try {
    let html = app.topPerformancesCard();
    assert.ok(html.includes('data-group="active" aria-pressed="true"') && html.includes('data-group="bench" aria-pressed="true"'));
    const rowsOf = h => h.split('<tbody>')[1].split('</tr>').slice(0, -1);
    const stOf = tr => spot.get(+tr.match(/data-nba="(\d+)"/)[1]);
    assert.ok(rowsOf(html).every(tr => tr.includes('badge active') === (stOf(tr) === 'ACTIVE')), 'Active badge on exactly the active players');
    assert.ok(rowsOf(html).every(tr => tr.includes('badge bench') === (!!stOf(tr) && stOf(tr) !== 'ACTIVE')), 'Bench or IR badge on the rest of the rostered players');
    assert.ok(html.indexOf('data-group="other"') < html.indexOf('pf-sep') && html.indexOf('pf-sep') < html.indexOf('data-group="fa"'), 'Waivers sits with Active and Bench');
    app.ui.perfShow.bench = false;
    html = app.topPerformancesCard();
    assert.ok(ids(html).every(id => !spot.has(id) || spot.get(id) === 'ACTIVE'), 'bench hidden, waivers still shown');
    app.ui.perfShow.bench = true; app.ui.perfShow.active = false; app.ui.perfShow.fa = false;
    html = app.topPerformancesCard();
    assert.ok(ids(html).length && ids(html).every(id => spot.has(id) && spot.get(id) !== 'ACTIVE'), 'only bench players');
  } finally {
    Object.assign(app.ui.perfShow, { me: true, opp: true, fa: true, other: true, active: true, bench: true });
  }
});

test("value baselines come from the data: the league's rostered pool, that season's stats", async () => {
  await app.ready();
  const L = await app.useLeague(CATS9);
  app.scoreCats();
  const B = app.get('BASE');
  assert.equal(B.pool, L.teams.length * (app.state.slots.length + app.state.benchSize), 'teams x roster spots');
  assert.ok(B.pts[0] > 10 && B.pts[0] < 25 && B.pts[1] > 2, `PTS ${B.pts}`);
  assert.notDeepEqual([...B.ftPct], [0.78, 0.7], 'not the old fixed numbers');
  const E = await app.useLeague(ESPN);
  app.scoreCats();
  const BE = app.get('BASE');
  assert.equal(BE.pool, E.teams.length * (app.state.slots.length + app.state.benchSize), 'ESPN too: teams x roster spots');
  const stats = app.get('NBA').players.map(r => app.nbaStats(r, 'blend')).filter(Boolean).map(x => ({ ...x, sample: x.gp }));
  assert.ok(app.computeBase(stats, 60).pts[0] > app.computeBase(stats, 200).pts[0], 'a smaller league rosters better players, so the bar is higher');
  // a past season is judged against its own season's stats
  await app.loadSeason('czqgnyozmf2tbr93');
  app.get('ui').season = 'czqgnyozmf2tbr93';
  let past;
  try { app.withSeason(() => { app.scoreCats(); past = app.get('BASE'); }); } finally { app.get('ui').season = null; }
  assert.notEqual(app.get('BASE'), past, "this season's baselines are back as soon as the past season is done");
  await app.useLeague(CATS9);
  app.scoreCats();
  const now = app.get('BASE');
  assert.ok(past.pool >= 20 && past !== now && past.pts[0] !== now.pts[0], `2025-26 PTS ${past.pts} vs now ${now.pts}`);
});

test("player photos get a ring and background in their NBA team's colors", async () => {
  await app.ready();
  const raw = app.NBA.players.find(r => r.team === 'BOS');
  const html = app.headshot({ nbaId: raw.id, name: raw.name }, 40);
  assert.match(html, /class="hs[^"]* tm"/);
  assert.ok(html.includes('--t1:#007A33;--t2:#BA9653;--rw:1.67px'), html);
  assert.ok(!app.headshot({ name: 'Nobody' }, 28).includes(' tm'), 'no team, no ring');
  assert.equal(Object.keys(app.TEAM_COLORS).length, 30);
});

test("performances: today's games from ESPN's box scores, read in the browser as they're played", async () => {
  await app.loadBoxes();
  await app.useLeague(CATS9);
  const live = app.get('live');
  // one ESPN box score as stat lines, ESPN players matched to NBA.com's (the fixture data has no ESPN ids: by name and team)
  const sm = JSON.parse(readFixture('espn/live/summary-401909882.json'));
  const lines = app.espnLines(sm);
  const played = sm.boxscore.players.flatMap(t => t.statistics[0].athletes.filter(a => !a.didNotPlay && +a.stats[0] > 0));
  assert.ok(lines.size >= played.length - 1 && lines.size <= played.length, `${lines.size} of ${played.length} matched`);
  const top = played.reduce((a, b) => (+b.stats[1] > +a.stats[1] ? b : a));
  const raw = app.NBA.players.find(r => app.nameKey(r.name) === app.nameKey(top.athlete.displayName));
  const line = lines.get(raw.id);
  assert.equal(line.pts, +top.stats[1]);
  assert.equal(`${line.fgm}-${line.fga}`, top.stats[2]);
  assert.equal(line.gp1, 1);

  // Wednesday Oct 28, games under way (the saved box scores end on Oct 25)
  const sb = JSON.parse(readFixture('espn/live/scoreboard.json'));
  const day = '2026-10-28';
  const urls = [];
  const realFetch = app.fetch;
  app.fetch = url => { urls.push(String(url)); return realFetch(url); };
  try {
    app.ui.tab = 'dashboard';
    await onDay(day, () => app.pollLive());
    assert.equal(live.error, '');
    assert.equal(live.day, day);
    assert.ok(live.timer, 'games on: the next update is scheduled');
    // the box score of every game under way or over; the week's earlier days, missing from the saved box scores, once
    const asked = urls.filter(u => u.includes('/summary?')).map(u => u.split('event=')[1]).sort();
    assert.deepEqual(asked, app.espnGames(sb).filter(g => g.state !== 'pre').map(g => g.id).sort());
    assert.ok(['20261026', '20261027'].every(d => urls.some(u => u.endsWith(`scoreboard?dates=${d}`))), urls.join('\n'));

    await onDay(day, () => {
      assert.equal(app.perfDays().today, day);
      const rows = app.perfRows([day]);
      assert.equal(rows.length, app.liveLines(day).size, "everyone who's played today");
      assert.equal(rows.find(r => r.raw.id === raw.id).tot.pts, line.pts);
      const html = app.topPerformancesCard();
      assert.ok(html.includes('class="on" data-action="perf-range" data-range="today"'), 'it opens on today once games have started');
      assert.ok(html.includes('lv-dot') && html.includes('Halftime') && html.includes('Q4 2:08') && html.includes('updated '), 'the clock of each game still on');
    });
    // last night's games picked: no more updates
    app.ui.perfRange = 'day';
    app.scheduleLive();
    assert.equal(live.timer, null);
  } finally {
    app.ui.perfRange = null;
    clearTimeout(live.timer);
    live.timer = null;
    live.lines.clear(); live.games = []; live.done.clear(); live.at = 0;
    app.fetch = realFetch;
  }
});

test('popups scroll inside, without collapsing on older iPhone Safari', () => {
  // flex-basis 0 on a popup's body made Safari before 16 size the popup from 0: a sliver between the header and footer
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'styles.css'), 'utf8');
  const rules = [...css.matchAll(/([^{}]*\.modal-body[^{}]*)\{([^}]*)\}/g)].filter(m => /flex\s*:/.test(m[2]));
  assert.ok(rules.length >= 2, 'the player card and (i) popups both flex their body');
  for (const [, sel, body] of rules) assert.match(body, /flex:\s*1 1 auto/, `${sel.trim()}: flex-basis auto, not 0`);
});

test('value weights follow the league: two leagues of the same size with different categories', async () => {
  const L = await app.useLeague(CATS9);
  const keys = () => Object.keys(app.winWeights()).sort().join();
  const before = keys();
  // the same league without one of its categories: same teams and spots, so the same baselines
  const L2 = { ...L, cats: L.cats.slice(1) };
  app.get('NBA').league = L2;
  app.applyLeagueRules(L2);
  try {
    assert.equal(keys(), app.scoreCats().filter(c => !c.fp).map(c => c.key).sort().join(), 'weights for exactly these categories');
    assert.notEqual(keys(), before);
  } finally { await app.useLeague(CATS9); }
});

test('live box scores: one game ESPN fails on is asked for again, the others still count', async () => {
  const live = app.get('live');
  const realGet = app.getJson;
  const sm = JSON.parse(readFixture('espn/live/summary-401909882.json'));
  await app.useLeague(CATS9);
  app.getJson = async url => { if (url.includes('event=bad')) throw new Error('ESPN 500'); return sm; };
  try {
    const failed = await app.readBoxes([{ id: 'bad', d: '2026-10-28', state: 'post' }, { id: 'good', d: '2026-10-28', state: 'post' }]);
    assert.equal(failed, 1);
    assert.ok(live.lines.get('2026-10-28').size > 5, "the game that answered is read");
    assert.ok(live.done.has('good') && !live.done.has('bad'), 'the failed one is tried again next time');
    await assert.rejects(app.readBoxes([{ id: 'bad', d: '2026-10-28', state: 'post' }]), /ESPN 500/, 'all of them failing is an error');
  } finally { app.getJson = realGet; live.lines.clear(); live.done.clear(); }
});
