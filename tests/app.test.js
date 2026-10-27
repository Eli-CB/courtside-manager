// Run with: node --test tests/
// Fixtures (tests/fixtures) are saved Fantrax and NBA responses; refresh them with tests/capture_fixtures.py.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, readFixture } = require('./harness');

const CATS9 = 'my19c8mwmoipvhon'; // 9-cat H2H, most categories wins, weekly lineups
const POINTS = 'la2a76bkmt6aqekb'; // H2H points, weekly lineups
const DAILY = 'frapfs43mutrff0g'; // H2H points with double/triple-doubles, daily lineups, not drafted yet

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
  const boxes = await app.loadBoxes();
  const lineups = await app.loadLineups(L);
  const p1 = app.rosterPeriodsOf(L).find(p => p.n === 1);
  const tot = {}, games = {};
  for (const [tid, ids] of Object.entries(lineups[1])) {
    const s = {}; games[tid] = 0;
    for (const id of ids) for (const [d, st] of boxes.byPlayer.get(id) || []) {
      if (!app.periodHas(p1, d)) continue;
      games[tid]++;
      for (const [k, v] of Object.entries(st)) s[k] = (s[k] || 0) + v;
    }
    tot[tid] = s;
  }
  for (const n of Object.values(games)) assert.ok(between(n, 15, 32), `${n} player games: each game counted once`);
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
  const lineups = await app.loadLineups(L);
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
