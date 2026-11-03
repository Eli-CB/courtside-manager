// Run with: node --test tests/
// Fixtures (tests/fixtures) are saved Fantrax, ESPN and NBA responses; refresh them with tests/capture_fixtures.py.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, readFixture } = require('./harness');

const CATS9 = 'my19c8mwmoipvhon'; // 9-cat H2H, most categories wins, weekly lineups
const POINTS = 'la2a76bkmt6aqekb'; // H2H points, weekly lineups
const DAILY = 'frapfs43mutrff0g'; // H2H points with double/triple-doubles, daily lineups, not drafted yet
const ESPN = '794342666'; // public ESPN league: H2H points, daily lineups, starts in week 3 (Nov 2)
const YAHOO = 'nba.l.777'; // a made-up Yahoo league in Yahoo's JSON layout (tests/make_yahoo_fixtures.py): 9-cat H2H, 4 teams

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
  assert.deepEqual([...app.weekShifts()].slice(0, 3), [-1, 0, 1], 'week 1 began Oct 20: no stepping back into the preseason');
  const ui = app.get('ui');
  ui.weekShift = -1;
  try {
    const nav = app.weekPicker();
    assert.equal((nav.match(/<option /g) || []).length, L.periods.length, 'every matchup week');
    assert.ok(nav.includes(`>Week ${L.periods.length} (playoffs)<`), nav);
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

test("a past season is graded from its games inside the league's season, inactive players included", async () => {
  const P = await app.loadSeason('czqgnyozmf2tbr93');
  await app.loadGameLog('2025-26');
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
    // the league played Oct 21 to Mar 22 (its last week ends Monday morning); the NBA went on to Apr 12
    assert.deepEqual({ ...d.season }, { from: '2025-10-21', to: '2026-03-22' });
    const full = p => (app.archivedStats(p.raw, '2025-26') || {}).gp || 0;
    assert.ok(d.picks.every(p => !p.raw || p.gp <= full(p)), 'never more games than the NBA season');
    assert.ok(d.picks.filter(p => p.raw && p.gp < full(p) - 5).length > 20, "the games after the league's last week don't count");
    assert.ok(d.maxGp < Math.max(...d.picks.map(full)), `at most ${d.maxGp} games in the league's 22 weeks`);
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
  assert.ok(all.every(p => p.games <= p.sched && p.weeks >= 1), 'missed out of his team\'s games while starting');
});

test('Unc Status averages the ages of the players each team started', async () => {
  const P = await app.loadSeason('czqgnyozmf2tbr93');
  const ages = app.startersAge(P.league);
  const teams = Object.values(ages);
  assert.equal(teams.length, P.league.teams.length);
  for (const T of teams) {
    assert.ok(T.age > 21 && T.age < 34, `average age ${T.age}`);
    assert.ok(T.n > P.league.weeks.length * 4, `${T.n} starter-weeks with a birth date`);
    // each player's pull on the average: the average with him minus without him
    const old = T.players.reduce((a, b) => (b.moved > a.moved ? b : a));
    assert.ok(old.moved > 0 && old.age > T.age, `${old.name} (${old.age.toFixed(1)}) makes the team older`);
    assert.equal(app.sum(T.players.map(x => x.weeks)), T.n);
  }
});

test('Awards: a team name in Waiver Wire Wizard and Unc Status opens its breakdown', async () => {
  await app.loadSeason('czqgnyozmf2tbr93');
  await app.loadGameLog('2025-26');
  const ui = app.get('ui');
  ui.season = 'czqgnyozmf2tbr93';
  let html;
  try { html = app.withSeason(() => app.viewAwards()); } finally { ui.season = null; }
  const keys = [...html.matchAll(/data-action="award-team" data-key="([^"]+)"/g)].map(m => m[1].replace(/&#39;/g, "'").replace(/&amp;/g, '&'));
  assert.ok(keys.some(k => k.startsWith('Waiver Wire Wizard|')) && keys.some(k => k.startsWith('Unc Status|')));
  assert.ok(keys.some(k => k.startsWith('Street Clothes|')));
  const dr = [...app.get('awardDetails').entries()].find(([k]) => k.startsWith('Best draft|'));
  assert.ok(dr, 'Best draft has one');
  assert.ok(/Best picks/.test(dr[1].html) && /Rd \d+, #\d+ · \d+ G/.test(dr[1].html), 'the picks that did most, with round and pick');
  const mg = [...app.get('awardDetails').entries()].find(([k]) => k.startsWith('Best manager|'));
  assert.ok(mg && /Week \d+/.test(mg[1].html) && /would have beaten \d/.test(mg[1].html), 'Best manager: each week, the result and the all-play');
  assert.ok(!keys.some(k => k.startsWith('Even Steven|')), 'not every award has one yet');
  // the newer awards, each with its breakdown
  for (const t of ['Steal of the Draft', 'Bust of the Draft', 'Week of the Year', 'Heartbreak Hotel', 'Benchwarmer Blues', 'Fan Boy']) assert.ok(keys.some(k => k.startsWith(t + '|')), t);
  const detail = t => [...app.get('awardDetails').entries()].find(([k]) => k.startsWith(t + '|'))[1].html;
  assert.match(detail('Steal of the Draft'), /Rd \d+, pick \d+ · ranked \d+(st|nd|rd|th)/);
  assert.match(detail('Week of the Year'), /would have beaten <b>\d+(\.5)? of \d+<\/b> teams/);
  assert.match(detail('Heartbreak Hotel'), /L \d(\.5)?–\d(\.5)? vs /);
  assert.match(detail('Fan Boy'), /%<\/b> of \d+ starts were [A-Z]{3} players/);
  const D = app.get('awardDetails');
  const w = [...D.entries()].find(([k]) => k.startsWith('Waiver Wire Wizard|'))[1];
  assert.match(w.title, /^Waiver Wire Wizard: 1\. /);
  assert.ok(/Helped/.test(w.html) && /data-action="player-detail"/.test(w.html), 'the pickups that helped, each a player link');
  const st = [...D.entries()].find(([k]) => k.startsWith('Street Clothes|'))[1];
  assert.ok((st.html.match(/<li>/g) || []).length <= 10 && /out \d+ of \d+ · \d+ wk/.test(st.html), 'the starters who missed most');
  const u = [...D.entries()].find(([k]) => k.startsWith('Unc Status|'))[1];
  assert.ok((u.html.match(/<li>/g) || []).length <= 10 && /\+\d\.\d\d yrs/.test(u.html), 'up to 10 players and how much each moved the average');
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

test("a past season grades its keepers: the better one by the season before's value", async () => {
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
  const by = Object.fromEntries(ks.map(k => [k.name, k]));
  // today's ADP says nothing about a 2025 draft: 2024-25's value per game picks the better keeper
  assert.equal(by['Shai Gilgeous-Alexander'].slot, 5, 'the 2024-25 MVP is the #5 pick');
  assert.equal(by['Karl-Anthony Towns'].slot, 15);
  assert.ok(ks.every(k => !k.past && Number.isFinite(k.gain) && k.like >= 1), 'graded against where each finished among the picks');
  assert.equal(by['Shai Gilgeous-Alexander'].gain, 5 - by['Shai Gilgeous-Alexander'].like);
  assert.ok(!d.picks.some(p => names.includes(p.name)), 'keepers are not draft picks');
  // Team drafts: a team's name opens its keepers and every pick, in draft order, for that season
  let card;
  app.get('ui').season = 'czqgnyozmf2tbr93';
  try {
    app.withSeason(() => {
      const ps = d.picks.filter(p => p.teamId === team.id);
      card = app.draftTeamCard(d, team.id, ps);
      const at = ps.sort((a, b) => a.pick - b.pick).map(p => card.html.indexOf(`>${p.name}<`));
      assert.ok(at.every((x, i) => x > 0 && (!i || x > at[i - 1])), 'every pick, in draft order');
    });
  } finally { app.get('ui').season = null; }
  assert.equal(card.title, "Eli's SGAteam: 2025-26 draft");
  assert.ok(names.every(n => card.html.indexOf(`>${n}<`) > 0 && card.html.indexOf(`>${n}<`) < card.html.indexOf('Picks</h3>')), 'keepers first');
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
  assert.deepEqual(await days('2026-10-21'), { today: '2026-10-21', started: true, day: '2026-10-20', week: ['2026-10-20', '2026-10-21'], year: ['2026-10-20', '2026-10-21'] }, 'Wednesday: today, last night, the days played so far');
  // Monday at noon (the same date in any US time zone and UTC)
  assert.deepEqual(await days('2026-10-26'), { today: '2026-10-26', started: false, day: '2026-10-25', week: null, year: ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'] }, "Monday before tip-off: last night was last week's");
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

test("the Dashboard's matchup: this matchup's days only", async () => {
  await app.loadBoxes();
  await app.useLeague(CATS9);
  useTeam(app.fxLeague().teams[0].id);
  const days = async iso => JSON.parse(JSON.stringify(await onDay(iso, () => app.dashDays())));
  // Monday before tip-off: last night was last week's matchup, so no Yesterday; it opens on today
  const mon = await days('2026-10-26');
  assert.equal(mon.today, '2026-10-26');
  assert.equal(mon.day, null);
  assert.deepEqual(mon.week, ['2026-10-26']);
  await onDay('2026-10-26', () => {
    const m = app.dashMatchupCard();
    assert.ok(m.includes('class="on" data-action="dash-range" data-range="today"') && !m.includes('data-range="day"'));
    assert.ok(!m.includes('mu-chip'), 'nobody has played yet');
  });
  // Wednesday: yesterday is Tuesday
  assert.equal((await days('2026-10-28')).day, '2026-10-27');
  // a day without NBA games (Election Day): it opens on yesterday, and Today is still there to say so
  const ui = app.get('ui');
  try {
    await onDay('2026-11-03', () => {
      const m = app.dashMatchupCard();
      assert.ok(m.includes('class="on" data-action="dash-range" data-range="day"') && m.includes('data-range="today"'));
      ui.dashRange = 'today';
      assert.match(app.dashMatchupCard(), /No NBA games today\./);
    });
  } finally { ui.dashRange = null; }
  // the tab's new name
  assert.ok(app.tabList().some(([k, l]) => k === 'players' && l === 'Players'));
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
    assert.ok(html.includes(`<th class="num">Value</th></tr></thead><tbody><tr><td><b>${app.NBA.season}</b>`), 'a Value column for each season, this one first');
    assert.ok(!html.includes('Projection') && !html.includes('(NBA:'), 'no projection row, no NBA position');
    // his rank among everyone this season: per game (regulars) and added up
    const R = app.valueRanks();
    const better = app.NBA.players.map(r => app.statObj(r.cur)).filter(s => s && s.gp && app.lineValue(app.statLine(s)) * Math.round(s.gp) > per * Math.round(cur.gp)).length;
    assert.equal(R.tot.get(raw.id), better + 1);
    assert.ok(html.includes(`>#${better + 1} of ${R.totN}</div>`), 'under Value this season');
    if (Math.round(cur.gp) >= R.minGp) assert.ok(html.includes(`>#${R.per.get(raw.id)} of ${R.perN}</div>`), 'under Value per game');
    assert.ok(!html.includes('Rank per game'), 'no separate tiles');
    // the header: age, flag, and whose he is in the league
    if (raw.born) assert.match(html, / · age \d\d/);
    if (raw.nat) assert.ok(html.includes(`flagcdn.com/w20/${raw.nat.toLowerCase()}.png`));
    assert.ok(html.includes('class="pc-owner"'), 'his fantasy team, or free agent');
    // Games: the whole season from the box scores, newest first, scrolling past five
    await app.loadBoxes();
    app.showPlayerDetail(raw.id);
    const full = els['#detailBody'].innerHTML;
    const box = app.get('BOX').byPlayer.get(raw.id) || [];
    assert.ok(full.includes(`Games <span class="muted small">${box.length}</span>`), `all ${box.length} games`);
    assert.ok(full.includes('pc-games-wrap'));
    const dates = [...full.split('pc-games-wrap"><table>')[1].matchAll(/<tr><td>([^<]+)<\/td>/g)].map(m => m[1]);
    assert.equal(dates.length, box.length);
  } finally { doc.querySelector = before; }
});

test('player card: a fantasy team with its lineup spot', async () => {
  const L = await app.useLeague(CATS9);
  const [tid, roster] = Object.entries(L.rosters).find(([, r]) => r.some(x => x.nba && x.st === 'INJURED_RESERVE'));
  const x = roster.find(y => y.nba && y.st === 'INJURED_RESERVE');
  const html = app.cardOwner(app.nbaById.get(x.nba));
  assert.ok(html.includes(app.esc(app.fxTeamName(tid))) && html.includes('badge bad">IR'), 'team and a red IR badge');
  const fa = app.NBA.players.find(r => r.fx && r.fx.st !== 'T' && !Object.values(L.rosters).flat().some(y => y.nba === r.id));
  if (fa) assert.match(app.cardOwner(fa), /badge good">(Waivers|Free agent|Available)</);
});

test('performances: every range marks each category leader with an emoji', async () => {
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
    // every other range marks its own leaders too: the season's points leader, per game's among regulars
    app.ui.perfRange = 'year';
    const year = app.perfRows([...app.perfDays().year]);
    const pts = cats.findIndex(c => c.key === 'pts');
    const yLead = year.reduce((x, y) => (app.lineStat(y.tot, 'pts') > app.lineStat(x.tot, 'pts') ? y : x));
    app.ui.perfSort = { key: 'pts', dir: -1 };
    let yc = cellsOf(app.topPerformancesCard());
    assert.equal((((yc[yLead.raw.id] || [])[pts] || '').match(/pf-emo[^>]*>([^<]+)</) || [])[1], '\u{1F680}', `this season: ${yLead.raw.name} leads in points`);
    app.ui.perfRange = 'avg';
    const reg = app.seasonRows().filter(r => r.g >= 3 && r.tot.min >= 15);
    const aLead = reg.reduce((x, y) => (app.lineStat(y.tot, 'pts') > app.lineStat(x.tot, 'pts') ? y : x));
    yc = cellsOf(app.topPerformancesCard());
    assert.equal((((yc[aLead.raw.id] || [])[pts] || '').match(/pf-emo[^>]*>([^<]+)</) || [])[1], '\u{1F680}', `per game: ${aLead.raw.name} leads in points among regulars`);
    assert.match(app.topPerformancesCard(), /title="Most PTS per game"/);
  } finally { app.ui.perfRange = null; app.ui.perfShow = show; app.ui.perfSort = { key: 'v', dir: -1 }; }
});

test('performances: everyone who played in one table, top 100 by the sorted column, ranked by value', async () => {
  await app.loadBoxes();
  const cell = (tr, i) => [...tr.matchAll(/<td class="sc"[^>]*>(?:<span[^>]*>[^<]*<\/span>)?([^<]*)</g)][i][1];
  const bodyRows = html => html.split('<tbody>')[1].split('</tr>').slice(0, -1);
  const val = tr => parseFloat(tr.match(/class="num pf-v[^"]*"[^>]*>([^<]+)</)[1].replace('\u2212', '-'));
  for (const id of [CATS9, ESPN]) {
    await app.useLeague(id);
    const all = app.perfRows([app.perfDays().day]);
    let rows = bodyRows(app.topPerformancesCard());
    assert.equal(rows.length, Math.min(100, all.length), `${id}: up to 100 rows`);
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

test('Players: one table; Per game ranks every NBA player, with search and position', async () => {
  await app.loadBoxes();
  await app.useLeague(CATS9);
  const ui = app.get('ui');
  const ids = html => [...(html.split('<tbody>')[1] || '').matchAll(/data-nba="(\d+)"/g)].map(m => +m[1]);
  const count = html => +html.match(/· (?:\d+ of )?(\d+) players?</)[1];
  try {
    let html = app.topPerformancesCard();
    assert.ok(html.includes('data-range="avg"') && html.includes('>Per game<'), 'Per game is one of the ranges');
    assert.ok(html.indexOf('>This week<') < html.indexOf('>This season<') && html.indexOf('>This season<') < html.indexOf('>Per game<'), 'This season after This week');
    ui.perfRange = 'avg';
    html = app.topPerformancesCard();
    const rows = app.seasonRows();
    assert.equal(count(html), rows.length, 'every NBA player with stats');
    assert.ok(rows.length > 300 && rows.every(r => r.per));
    assert.ok(/\d+ GP · \d+ min\/g/.test(html), 'games played and minutes a game');
    if (app.state.fxTeam && app.fxOpponentFor(app.todayIso(), app.state.fxTeam)) assert.ok(html.includes('data-group="opp"'), "this week's opponent filter too");
    assert.ok(/<td class="sc" title="FG%: [\d.]+-[\d.]+ a game">\.\d{3}<\/td>/.test(html), 'percentages per game');
    // the top row is the best average game
    const best = rows.reduce((x, y) => (y.v > x.v ? y : x));
    assert.equal(ids(html)[0], best.raw.id);
    // search by name, any range
    const name = best.raw.name;
    ui.perfQ = name.split(' ').pop().toLowerCase();
    html = app.topPerformancesCard();
    assert.ok(ids(html).includes(best.raw.id) && ids(html).every(id => app.normName(app.nbaById.get(id).name).includes(app.normName(ui.perfQ))));
    ui.perfQ = '';
    // position
    ui.perfPos = 'C';
    html = app.topPerformancesCard();
    assert.ok(ids(html).length && ids(html).every(id => app.nbaById.get(id).pos.includes('C')), 'centers only');
    ui.perfPos = '';
    // NBA team
    ui.perfTeam = 'OKC';
    html = app.topPerformancesCard();
    assert.ok(ids(html).length && ids(html).every(id => app.nbaById.get(id).team === 'OKC'), 'one NBA team');
    ui.perfTeam = '';
    // the top 300 over a season
    assert.equal((app.topPerformancesCard().split('<tbody>')[1].match(/<\/tr>/g) || []).length, Math.min(300, rows.length), 'Per game: the top 300');
    // position and team are pill-style menus, then Rookies and Injured
    html = app.topPerformancesCard();
    assert.ok(/<select class="pill pill-menu" data-change="perf-pos"/.test(html) && /<select class="pill pill-menu" data-change="perf-team"/.test(html));
    assert.ok(html.indexOf('data-change="perf-team"') < html.indexOf('data-key="rookie"') && html.indexOf('data-key="rookie"') < html.indexOf('data-key="inj"'));
    ui.perfOnly.rookie = true;
    html = app.topPerformancesCard();
    assert.ok(ids(html).length && ids(html).every(id => !app.nbaById.get(id).exp), 'rookies only');
    ui.perfOnly.rookie = false; ui.perfOnly.inj = true;
    html = app.topPerformancesCard();
    assert.ok(ids(html).length && ids(html).every(id => app.nbaById.get(id).inj), 'injured only');
    ui.perfOnly.inj = false;
    // This season: every game so far, added up
    ui.perfRange = 'year';
    html = app.topPerformancesCard();
    const year = app.perfDays().year;
    assert.ok(year.length >= 5, 'the season so far');
    const tot = app.perfRows([...year]);
    assert.equal(count(html), tot.length);
    const top = tot.reduce((x, y) => (y.v > x.v ? y : x));
    assert.equal(ids(html)[0], top.raw.id, 'the most value over the season on top');
    assert.ok(new RegExp(`${top.g} G · `).test(html));
    // no live updates for averages
    ui.perfRange = 'avg';
    ui.tab = 'players';
    assert.equal(app.liveWanted(), false);
  } finally { ui.perfRange = null; ui.perfQ = ''; ui.perfPos = ''; ui.perfTeam = ''; Object.assign(ui.perfOnly, { rookie: false, inj: false }); ui.tab = 'standings'; }
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
    assert.ok(rowsOf(html).every(tr => tr.includes('badge bench') === (!!stOf(tr) && stOf(tr) !== 'ACTIVE' && stOf(tr) !== 'INJURED_RESERVE')), 'Bench badge on the rest of the rostered players');
    // IR: a red badge and always the fantasy team's name, even on your team or the opponent's
    const owners = new Map(Object.entries(L.rosters).flatMap(([tid, r]) => r.filter(x => x.nba).map(x => [x.nba, tid])));
    app.ui.perfRange = 'avg';
    const avg = rowsOf(app.topPerformancesCard()).filter(tr => stOf(tr) === 'INJURED_RESERVE');
    app.ui.perfRange = null;
    assert.ok(avg.length, 'IR players in Per game');
    for (const tr of avg) {
      const tid = owners.get(+tr.match(/data-nba="(\d+)"/)[1]);
      assert.ok(tr.includes('<span class="badge bad" title="On injured reserve">IR</span>'), 'red IR badge');
      assert.ok(tr.includes(`<span class="perf-owner">${app.esc(app.fxTeamName(tid))}</span>`), `${app.fxTeamName(tid)}'s IR player shows the team`);
    }
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
    // the next update: the scoreboard again, but no box score whose game's score hasn't moved (and was read under a minute ago)
    urls.length = 0;
    live.at = 0;
    await onDay(day, () => app.pollLive());
    assert.ok(urls.some(u => u.endsWith('/scoreboard')) && !urls.some(u => u.includes('/summary?')), urls.join('\n'));
    const g = app.espnGames(sb).find(x => x.state === 'in');
    assert.ok(!app.boxDue(g));
    assert.ok(app.boxDue({ ...g, hs: g.hs + 2 }), 'a basket: read it again');

    await onDay(day, () => {
      assert.equal(app.perfDays().today, day);
      const rows = app.perfRows([day]);
      assert.equal(rows.length, app.liveLines(day).size, "everyone who's played today");
      assert.equal(rows.find(r => r.raw.id === raw.id).tot.pts, line.pts);
      const html = app.topPerformancesCard();
      assert.ok(html.includes('class="on" data-action="perf-range" data-range="today"'), 'it opens on today once games have started');
      assert.ok(html.includes('lv-dot') && html.includes('Halftime') && html.includes('Q4 2:08') && html.includes('updated '), 'the clock of each game still on');
      // a live update keeps the rows in place; anything else sorts them again
      const order = h => [...h.matchAll(/data-action="player-detail" data-nba="(\d+)"/g)].map(m => m[1]);
      const before = order(html);
      const last = app.liveLines(day).get(+before[before.length - 1]);
      const was = { ...last };
      Object.assign(last, { pts: last.pts + 60, reb: last.reb + 20, ast: last.ast + 20 });
      try {
        live.hold = true;
        assert.deepEqual(order(app.topPerformancesCard()), before, 'held in place');
        live.hold = false;
        assert.equal(order(app.topPerformancesCard())[0], before[before.length - 1], 'sorted again');
      } finally { live.hold = false; Object.assign(last, was); }

      // the Dashboard's matchup: both lineups slot by slot, each starter's game and line, and the categories each
      // side leads, counted from the starters' lines
      const L = app.fxLeague();
      // the team whose matchup has the most starters in today's games
      const on = id => { const S = app.fxTeamSide(id); return S.lineup.filter(pid => { const p = S.players.find(x => x.id === pid); return p && app.liveLines(day).has(p.nbaId); }).length; };
      const both = id => on(id) + on(app.fxOpponentFor(day, id).id);
      const tid = L.teams.map(t => t.id).sort((a, b) => both(b) - both(a))[0];
      const wasTeam = app.state.fxTeam;
      app.state.fxTeam = tid;
      try {
        const side = app.fxTeamSide(tid), opp = app.fxTeamSide(app.fxOpponentFor(day, tid).id);
        const starters = S => S.lineup.map(id => S.players.find(p => p.id === id)).filter(Boolean);
        const total = (S, ds) => { const t = {}; for (const p of starters(S)) for (const d of ds) { const l = app.lineOn(p, d); if (l) app.addLine(t, l); } return t; };
        const scores = h => [...h.matchAll(/class="mu-score">([^<]*)</g)].map(m => m[1]);
        const halves = x => [String(x.me + x.ties / 2), String(x.opp + x.ties / 2)]; // a tie counts half to each
        let m = app.dashMatchupCard();
        assert.ok(m.includes('class="on" data-action="dash-range" data-range="today"') && m.includes('>Yesterday<') && m.includes('data-range="week"'), 'today, yesterday, the week; on today');
        // one day: only who plays that day, each side's starters then its bench (always), no slot column
        const playing = list => list.filter(p => app.playsOn(p, day));
        const benchOf = S => S.players.filter(p => !S.lineup.includes(p.id));
        // anyone Out, or who sat out a finished game, goes last
        const sits = p => !app.lineOn(p, day) && (p.status === 'Out' || app.gameFinal(p, day) || (app.liveGame(p, day) || {}).state === 'post');
        const count = (list, out) => playing(list).filter(p => sits(p) === out).length;
        // each side one column with no gaps: starters, then the bench (tagged), then Out / DNP; rows pair them up
        const col = S => [...playing(starters(S)).filter(p => !sits(p)), ...playing(benchOf(S)).filter(p => !sits(p)), ...playing(starters(S)).filter(sits), ...playing(benchOf(S)).filter(sits)];
        assert.equal((m.match(/class="mu-row day"/g) || []).length, Math.max(col(side).length, col(opp).length), 'as many rows as the longer side');
        const left = [...m.matchAll(/<div class="mu-row day"><div class="mu-p([^"]*)"[\s\S]*?data-nba="(\d+)"/g)].map(x => +x[2]);
        const group = id => { const p = col(side).find(x => x.nbaId === id); return (sits(p) ? 2 : 0) + (starters(side).includes(p) ? 0 : 1); };
        assert.deepEqual([...left].sort(), col(side).map(p => p.nbaId).sort(), 'my side: everyone who plays, no gaps');
        assert.deepEqual(left.map(group), left.map(group).sort(), 'starters, bench, then out');
        // within starters and within the bench: games on now first, then finished games, then those still to come
        const stageOf = id => { const p = col(side).find(x => x.nbaId === id), g = app.liveGame(p, day); return g && g.state === 'in' ? 0 : app.gameFinal(p, day) || (g && g.state === 'post') ? 1 : 2; };
        for (const grp of [0, 1]) { const st = left.filter(id => group(id) === grp).map(stageOf); assert.deepEqual(st, [...st].sort(), `group ${grp}: on now, finished, to come`); }
        assert.ok(left.some(id => stageOf(id) === 0), 'a game on now in this matchup');
        assert.equal((m.match(/badge bench">Bench</g) || []).length, playing(benchOf(side)).length + playing(benchOf(opp)).length, 'bench players tagged');
        const shown = [...m.matchAll(/data-action="player-detail" data-nba="(\d+)"/g)].map(x => +x[1]);
        assert.ok(shown.length && shown.every(id => app.playsOn(app.playerFromRaw(app.nbaById.get(id)), day)), 'nobody without a game');
        assert.ok(!m.includes('mu-slot') && !m.includes('dash-bench'), 'no slot column, no bench button');
        // beside each score: starter games this period played / on now / to come, and game minutes left
        const games = app.espnGames(sb);
        assert.equal(app.gameMinLeft(games.find(g => g.detail === 'Halftime')), 24);
        assert.equal(+app.gameMinLeft(games.find(g => g.detail === '2:08 - 4th')).toFixed(2), 2.13);
        assert.equal(app.gameMinLeft({ state: 'pre' }), 48);
        const pc = [...m.matchAll(/<b>(\d+)<\/b><span class="(?:pos-good)?">(\d+)<\/span><span class="muted">(\d+)<\/span>/g)].map(x => x.slice(1).map(Number));
        assert.equal(pc.length, 2, 'one for each side');
        const period = app.dashDays().all;
        const scheduled = S => starters(S).reduce((n, p) => n + period.filter(d => app.playsOn(p, d)).length, 0);
        pc.forEach(([played, now, left], i) => assert.ok(played + now + left <= scheduled([side, opp][i]) && now > 0 === pc[i][1] > 0));
        assert.ok(pc.some(x => x[1] > 0), 'someone is on now');
        const sc = app.weekScore(total(side, [day]), total(opp, [day]));
        const week = app.dashDays().week;
        assert.deepEqual([...week], ['2026-10-26', '2026-10-27', day]);
        const wk = app.weekScore(total(side, week), total(opp, week));
        assert.deepEqual(scores(m), halves(wk), 'the big numbers: the period so far');
        assert.ok(m.includes(`title="${app.fmtDay('2026-10-26')} – ${app.fmtDay('2026-11-01')}">This period<`), "the league's whole matchup period, from its schedule");
        assert.ok(!/tied/.test(m), 'ties only as halves');
        assert.equal((m.match(/class="mu-lead"/g) || []).length, sc.me + sc.opp, "each category led today is marked");
        const p = [...starters(side), ...starters(opp)].find(x => app.liveLines(day).has(x.nbaId));
        assert.ok(p, "someone in this matchup is playing today");
        const pl = app.liveLines(day).get(p.nbaId);
        assert.ok(m.includes(`<b>${pl.pts}</b> PTS`), "a starter's line");
        assert.ok(!/<b>0<\/b> |<b>0-0<\/b> /.test(m), "no bubble for a stat he didn't put up");
        assert.ok(m.includes('lv-dot'), 'a game still on shows its clock');
        // a live update flashes the bubbles that moved: green for a basket, red for a turnover or a missed free throw
        const pl2 = app.liveLines(day).get(p.nbaId), was2 = { ...pl2 };
        try {
          Object.assign(pl2, { pts: pl2.pts + 2, fgm: pl2.fgm + 1, fga: pl2.fga + 1, to: pl2.to + 1, fta: pl2.fta + 1 });
          live.hold = true;
          const f = app.dashMatchupCard();
          const chip = label => (f.match(new RegExp(`<span class="mu-chip([^"]*)"><b>[^<]*</b> ${label}<`)) || [])[1];
          assert.equal(chip('PTS'), ' flash-good', 'points up');
          assert.equal(chip('FG'), ' flash-good', 'a make');
          assert.equal(chip('TO'), ' flash-bad', 'a turnover');
          assert.equal(chip('FT'), ' flash-bad', 'a missed free throw');
          assert.ok(!chip('REB'), "rebounds didn't move: no flash");
          live.hold = false;
          assert.ok(!app.dashMatchupCard().includes('flash-'), 'only on a live update');
        } finally { live.hold = false; Object.assign(pl2, was2); }
        // Hide game scores: the clock and the opponent, no score
        const g0 = app.espnGames(sb).find(g => g.state === 'in');
        const scoreTxt = `${g0.away} ${g0.as} @ ${g0.home} ${g0.hs}`;
        assert.ok(m.includes(scoreTxt), 'scores by default');
        app.ui.hideScores = true;
        try {
          const hidden = app.dashMatchupCard();
          assert.ok(!hidden.includes(scoreTxt) && !/[A-Z]{3} \d+ @ [A-Z]{3} \d+/.test(hidden), 'no score anywhere');
          assert.ok(hidden.includes('lv-dot'), 'still the clock');
        } finally { app.ui.hideScores = false; }
        app.ui.dashRange = 'week';
        m = app.dashMatchupCard();
        assert.equal((m.match(/class="mu-row"/g) || []).length, app.state.slots.length, 'the period: one row per starting slot; the bench hidden');
        app.ui.dashBench = true;
        const bench = Math.max(side.players.length - side.lineup.filter(Boolean).length - side.il.length, opp.players.length - opp.lineup.filter(Boolean).length - opp.il.length);
        assert.ok((app.dashMatchupCard().match(/class="mu-row bench"/g) || []).length >= bench, 'the bench, on request');
        assert.deepEqual(scores(m), halves(wk), 'the period so far');
        assert.equal((m.match(/class="mu-lead"/g) || []).length, wk.me + wk.opp, "each category led this week is marked");
        assert.match(m, /\d G · \d left/);
      } finally { app.state.fxTeam = wasTeam; app.ui.dashBench = false; app.ui.dashRange = null; }
    });
    // last night's games picked: no more updates, on the Dashboard or in Performances (Players)
    app.ui.dashRange = 'day';
    app.scheduleLive();
    assert.equal(live.timer, null);
    app.ui.dashRange = null;
    app.ui.tab = 'players';
    app.ui.perfRange = 'day';
    app.scheduleLive();
    assert.equal(live.timer, null);
  } finally {
    app.ui.perfRange = null; app.ui.dashRange = null; app.ui.tab = 'standings';
    clearTimeout(live.timer);
    live.timer = null;
    live.lines.clear(); live.games = []; live.done.clear(); live.read.clear(); live.at = 0;
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

test('weekly recap: every final of a finished week, the standouts, and a message to share', async () => {
  const L = await app.useLeague(CATS9);
  const ui = app.get('ui');
  useTeam(L.teams[0].id);
  ui.tab = 'recap';
  try {
    app.viewRecap(); // starts loading the week's lineups and box scores
    await new Promise(r => setTimeout(r, 20));
    const html = app.viewRecap();
    assert.match(html, /Week 1 standouts/);
    const X = app.get('recaps').get(`${L.id}|1`);
    assert.equal(X.games.length, L.matchups['1'].length, 'every matchup');
    // the finals agree with Fantrax's standings (week 1 is the only finished week)
    for (const g of X.games) {
      const ra = L.standings.find(r => r.id === g.a);
      assert.equal(g.margin > 0 ? 'win' : 'tie', ra.w ? 'win' : ra.l ? 'loss' : 'tie', `${app.fxTeamName(g.a)} ${app.scoreLine(g.sc)} ${app.fxTeamName(g.b)}`);
    }
    assert.ok(X.games.every((g, i) => !i || g.margin <= X.games[i - 1].margin), 'biggest margin first');
    // the standouts are starters' numbers, valued as Performances values them
    assert.ok(X.mvp && X.mvp.v > 0 && X.game && X.game.line.gp1 === 1);
    assert.ok(X.game.v >= X.mvp.v / X.mvp.line.gp1, 'the best game beats the best week per game');
    // the brick did the least over the week, the dud had the worst single game
    assert.ok(X.brick && X.dud);
    assert.ok(X.brick.line.gp1 >= 2 && X.brick.v / X.brick.line.gp1 <= X.mvp.v / X.mvp.line.gp1 && X.dud.v <= X.game.v && X.dud.line.gp1 === 1);
    assert.ok(html.includes('Worst week') && html.includes('Worst game'));
    // Street clothes: games missed while starting, never more than his team played
    assert.ok(X.missed.every(x => x.games > 0 && x.games <= x.sched));
    if (X.missed.length) assert.ok(html.includes('Street clothes') && html.includes('while starting'));
    if (X.regret) assert.ok(X.regret.up > 0, 'a bench regret changes a result');
    assert.ok(X.allPlay.w + X.allPlay.l + X.allPlay.t === L.teams.length - 1);
    for (const label of ['Player of the week', 'Game of the week', 'Best week']) assert.ok(html.includes(label), label);
    assert.match(html, /would have beaten (every other team|\d+ of \d+ teams)/, 'Best week counts teams beaten, not categories');
    // the message: the standouts only (everyone has the results), each with its full line in the league's categories
    const text = app.recapText(L, X);
    assert.ok(text.startsWith(`🏀 ${L.name} · Week 1 standouts`));
    assert.ok(!X.games.some(g => text.includes(`${app.fxTeamName(g.a)} ${app.scoreLine(g.sc)} ${app.fxTeamName(g.b)}`)), 'no results');
    assert.ok(text.includes('🏆 Player of the week: ') && !/<[a-z]/.test(text), 'plain text, no markup');
    for (const c of app.scoreCats()) assert.ok(text.includes(` ${c.pct ? c.label.replace('%', '') : c.label}`), `${c.label} in the lines`);
    assert.ok(text.includes(`${X.game.line.fgm}-${X.game.line.fga} FG`), 'shooting as makes-attempts');
    assert.ok(!/Biggest win|Closest/.test(text + html), 'not the biggest win or the closest');
    assert.ok(!html.includes('inl-p'), 'names without photos, in line with the text');
    assert.ok(app.recapUrl(L, 1).endsWith(`?league=${L.id}&week=1#recap`), app.recapUrl(L, 1));
    // the Dashboard points to it for three days
    assert.equal(app.freshRecap().n, 1);
    assert.ok(app.buildAlerts().some(a => a.action === 'go-recap'));
  } finally { ui.tab = 'dashboard'; }
  // leagues that don't share past lineups say so
  await app.useLeague(ESPN);
  assert.match(app.viewRecap(), /No recaps for ESPN leagues/);
  assert.equal(app.freshRecap(), null);
  await app.useLeague(CATS9);
});

test('a shared recap link: connects the league, asks for the team, then shows the recap', async () => {
  const L = await app.useLeague(CATS9);
  const state = app.get('state'), ui = app.get('ui');
  const was = { ...state }, loc = { search: app.location.search, hash: app.location.hash };
  app.history = { replaceState() { app.location.search = ''; } };
  Object.assign(state, { fxTeam: null, fxLeagueId: null, leagueStates: {}, savedLeagues: [], leagueChosen: false, demo: false });
  app.location.search = `?league=${L.id}&week=1`;
  app.location.hash = '#recap';
  app.route(); // as the page does on load, before the link is read
  try {
    await app.openSharedLink();
    assert.equal(app.location.search, '', 'the link is tidied away');
    assert.equal(ui.recapWeek, 1);
    assert.equal(app.currentLeagueId(), L.id);
    assert.ok(app.needsLanding(), 'pick your team first');
    assert.match(app.viewLanding(), /week 1 recap a league mate shared/);
    app.actions['land-team']({ dataset: { id: L.teams[2].id } });
    assert.equal(state.fxTeam, L.teams[2].id);
    assert.equal(ui.tab, 'recap', 'then the recap');
    assert.equal(ui.afterPick, null);
  } finally {
    Object.assign(state, was);
    Object.assign(app.location, loc);
    ui.recapWeek = null; ui.tab = 'dashboard';
    const live = app.get('live'); clearTimeout(live.timer); live.timer = null;
    await app.useLeague(CATS9);
  }
});

test('seasons: an earlier season entered as a league goes under its league, never in the league list', async () => {
  const PAST = 'czqgnyozmf2tbr93'; // 2025-26 of CATS9
  const L = await app.useLeague(CATS9);
  const state = app.get('state'), ui = app.get('ui'), NBA = app.get('NBA');
  const was = JSON.parse(JSON.stringify(state)), site = NBA.siteLeague, tab = ui.tab;
  ui.tab = 'standings'; // no live box scores in the background
  NBA.siteLeague = null; // a visitor with nothing connected yet
  Object.assign(state, { fxTeam: null, fxLeagueId: null, leagueStates: {}, savedLeagues: [], pastSeasons: {}, leagueChosen: false, demo: false });
  try {
    // the past season first: kept, not opened as this season's league
    const wait = await app.connectLeague(PAST);
    assert.equal(wait.label, '2025-26');
    assert.equal(state.savedLeagues.length, 0);
    assert.equal(state.fxLeagueId, null);
    // then this season's league: the past season is under it
    await app.connectLeague(CATS9);
    app.actions['land-team']({ dataset: { id: L.teams[2].id } });
    assert.deepEqual([...state.savedLeagues.map(l => l.id)], [CATS9]);
    assert.deepEqual([...app.seasonsFor(app.fxLeague()).map(x => x.id)], [PAST]);
    // entered again with its league here: opens it
    assert.equal(await app.connectLeague(PAST), null);
    assert.equal(ui.season, PAST);
    ui.season = null;
    // one added as a league before all this moves under its league
    state.pastSeasons = {};
    state.savedLeagues.unshift({ id: PAST, name: L.name, hid: app.fxLeague().historyId, year: 2025 });
    assert.ok(app.foldPastSeasons());
    assert.deepEqual([...state.savedLeagues.map(l => l.id)], [CATS9]);
    assert.deepEqual([...app.seasonsFor(app.fxLeague()).map(x => x.id)], [PAST]);
  } finally {
    for (const k of Object.keys(state)) delete state[k];
    Object.assign(state, was);
    NBA.siteLeague = site;
    ui.season = null; ui.addingLeague = false; ui.tab = tab;
    await app.useLeague(CATS9);
  }
});

test('Matchups steps through every week of the league, a two-week matchup once', async () => {
  const L = await app.useLeague(CATS9);
  const ui = app.get('ui');
  const shifts = app.weekShifts();
  const periods = shifts.map(s => app.fxPeriodFor(app.weekStartAt(s)).n);
  assert.deepEqual([...periods], L.periods.map(p => p.n), 'each matchup week, in order, once');
  assert.ok(shifts.includes(0));
  // stepping past a two-week matchup takes one click
  const long = L.periods.find(p => (Date.parse(p.end) - Date.parse(p.start)) / 864e5 > 7);
  if (long) {
    const at = shifts[periods.indexOf(long.n)], tab = ui.tab;
    ui.weekShift = at;
    ui.tab = 'week'; // (no live box scores in the background)
    try {
      app.actions['week-shift']({ dataset: { step: '1' } });
      assert.equal(app.fxPeriodFor(app.weekStartAt(ui.weekShift)).n, long.n + 1);
    } finally { ui.weekShift = 0; ui.tab = tab; }
  }
});

// ----- Yahoo -----
function yahooSignedIn(tokens = { access: 'a', refresh: 'r', until: app.NOW + 36e5 }) {
  app.get('yahoo').proxy = 'https://yahoo.test';
  app.localStorage.setItem('courtside-yahoo', JSON.stringify(tokens));
}

test("Yahoo's JSON: numbered objects become lists, one-key arrays become objects", () => {
  const f = app.yflat;
  assert.deepEqual(JSON.parse(JSON.stringify(f({ 0: { team: 1 }, 1: { team: 2 }, count: 2 }))), [{ team: 1 }, { team: 2 }]);
  assert.deepEqual(JSON.parse(JSON.stringify(f([{ a: 1 }, [], { b: 2 }]))), { a: 1, b: 2 }, 'empty arrays among them are dropped');
  assert.deepEqual(JSON.parse(JSON.stringify(f([{ position: 'PG' }, { position: 'G' }]))), [{ position: 'PG' }, { position: 'G' }], 'a shared key stays a list');
  assert.deepEqual(JSON.parse(JSON.stringify(f({ week: '1', 0: { teams: [] } }))), { 0: { teams: [] }, week: '1' }, 'no count: an ordinary object');
});

test('Yahoo league IDs and addresses', () => {
  assert.equal(app.parseLeagueId('https://basketball.fantasysports.yahoo.com/nba/777'), 'nba.l.777');
  assert.equal(app.parseLeagueId('466.l.777'), '466.l.777');
  assert.equal(app.leagueSourceOf('nba.l.777'), 'yahoo');
  assert.equal(app.leagueSourceOf('794342666'), 'espn', 'ESPN still all digits');
  assert.equal(app.sourceName({ source: 'yahoo' }), 'Yahoo');
});

test('Yahoo: sign-in needed, an expired token renewed, the leagues on the account', async () => {
  app.get('yahoo').proxy = 'https://yahoo.test';
  app.localStorage.removeItem('courtside-yahoo');
  await assert.rejects(app.yahooGet('users;use_login=1/games;game_keys=nba/leagues'), /yahoo sign-in/);
  assert.match(app.leagueError(YAHOO, new Error('yahoo sign-in')).message, /Sign in with Yahoo/);
  yahooSignedIn({ access: 'old', refresh: 'r', until: app.NOW - 1 });
  const leagues = [...await app.yahooLeagues()];
  assert.equal(JSON.parse(app.localStorage.getItem('courtside-yahoo')).access, 'new', 'renewed before asking');
  assert.deepEqual(JSON.parse(JSON.stringify(leagues)), [{ key: '466.l.777', name: 'Test Hoops', teams: 4, season: 2026 }]);
  // back from Yahoo's sign-in: the tokens after #yahoo= are kept and the address tidied
  const loc = app.location;
  loc.hash = '#yahoo=' + encodeURIComponent(Buffer.from(JSON.stringify({ access: 'x', refresh: 'y', until: 1 })).toString('base64'));
  assert.equal(app.yahooFromAddress(), 'in');
  assert.equal(JSON.parse(app.localStorage.getItem('courtside-yahoo')).refresh, 'y');
  loc.hash = '#yahoo-error=access_denied';
  assert.match(app.yahooFromAddress(), /cancelled/);
  loc.hash = '';
  assert.equal(app.yahooFromAddress(), null);
  app.get('yahoo').proxy = '';
});

test('a Yahoo league becomes the same league as the others', async () => {
  yahooSignedIn();
  try {
    const L = await app.useLeague(YAHOO);
    assert.equal(L.source, 'yahoo');
    assert.equal(L.name, 'Test Hoops');
    assert.equal(L.year, 2026);
    assert.deepEqual([...L.cats], ['fgPct', 'ftPct', 'tpm', 'pts', 'reb', 'ast', 'stl', 'blk', 'to'], "the league's 9 categories; FGM/A only on display");
    assert.deepEqual([...L.teams.map(t => t.name)], ['Alpha Dogs', 'Beta Ballers', 'Gamma Rays', 'Delta Force']);
    assert.deepEqual(JSON.parse(JSON.stringify(L.periods.map(p => [p.n, p.start, p.end]))), [[1, '2026-10-20', '2026-10-25'], [2, '2026-10-26', '2026-11-01'], [3, '2026-11-02', '2026-11-08']]);
    assert.deepEqual(JSON.parse(JSON.stringify(L.matchups['2'])), [['466.l.777.t.1', '466.l.777.t.3'], ['466.l.777.t.2', '466.l.777.t.4']]);
    assert.equal(L.playoffPeriod, 3);
    assert.equal(app.leagueLineupMode(L), 'daily');
    assert.deepEqual(JSON.parse(JSON.stringify(app.slotsFromLeague(L))), { slots: ['PG', 'SF', 'FLX'], bench: 1, ir: 1 });
    // rosters: every player matched to NBA.com's (Yahoo's NY is NYK), in his lineup spot
    const alpha = L.rosters['466.l.777.t.1'];
    assert.equal(alpha.length, 5);
    assert.ok(alpha.every(x => x.nba), 'all matched');
    const byName = n => alpha.find(x => x.name === n);
    assert.equal(byName('OG Anunoby').nba, app.NBA.players.find(r => r.name === 'OG Anunoby').id);
    assert.deepEqual([byName('LaMelo Ball').st, byName('Bam Adebayo').slot, byName('Steven Adams').st, byName('Ace Bailey').st], ['ACTIVE', 'Util', 'RESERVE', 'INJURED_RESERVE']);
    assert.deepEqual(JSON.parse(JSON.stringify(L.standings.map(r => [r.name, r.w, r.l]))), [['Alpha Dogs', 3, 0], ['Beta Ballers', 2, 1], ['Gamma Rays', 1, 2], ['Delta Force', 0, 3]]);
    assert.equal(L.draft.picks.length, 12);
    assert.deepEqual([...L.draft.picks[0]].slice(0, 3), [1, 1, '466.l.777.t.1']);
    assert.ok(L.draft.picks.every(p => p[3]), 'every pick matched');
    // a team's side works like any league's: its starters in their slots
    app.state.fxTeam = '466.l.777.t.1';
    const side = app.fxTeamSide('466.l.777.t.1');
    assert.equal(side.lineup.filter(Boolean).length, 3);
    assert.equal(side.il.length, 1);
    assert.equal(app.fxOpponentFor('2026-10-26', '466.l.777.t.1').name, 'Gamma Rays');
    assert.ok(app.viewWeek().includes('Gamma Rays'), 'Matchups draws');
  } finally { app.get('yahoo').proxy = ''; app.state.fxTeam = null; await app.useLeague(CATS9); }
});

test('the newer awards add up: Steal and Bust are each pick against its rank, Fan Boy shares, close losses', async () => {
  await app.useLeague(CATS9);
  const P = await app.loadSeason('czqgnyozmf2tbr93');
  const G = await app.loadGameLog('2025-26');
  const ui = app.get('ui');
  ui.season = 'czqgnyozmf2tbr93';
  let aw, steals, fans, bench;
  try { app.withSeason(() => { aw = app.seasonAwards(); steals = app.draftSteals(); fans = app.startsByNbaTeam(P.league, G); bench = app.benchValue(P.league, G); }); } finally { ui.season = null; }
  const award = t => aw.find(a => a.title === t);
  const all = Object.values(steals).flat();
  const best = all.reduce((a, b) => (b.gain > a.gain ? b : a)), worst = all.reduce((a, b) => (b.gain < a.gain ? b : a));
  assert.equal(award('Steal of the Draft').list[0].T.steal.gain, best.gain);
  assert.equal(award('Bust of the Draft').list[0].T.bust.gain, worst.gain);
  assert.ok(all.every(p => p.gain === p.pick - p.rank));
  for (const F of Object.values(fans)) {
    assert.equal(app.sum(F.teams.map(x => x.n)), F.n, 'every start counted once');
    assert.ok(F.teams.every((x, i) => !i || x.n <= F.teams[i - 1].n), 'biggest share first');
  }
  assert.ok(Object.values(bench).flat().every(p => p.games > 0 && p.weeks > 0));
  const heart = award('Heartbreak Hotel').list[0].T;
  assert.ok(heart.heart.every(x => x.wb - x.wa > 0 && x.wb - x.wa <= 1), 'losses by one category');
  const week = award('Week of the Year').list[0].T.bestWeek;
  assert.ok(week.beat <= week.of && week.cats.length === app.scoreCats().length);
});

test("a week is over once its last game day's box scores are in, before Fantrax ends it Monday evening", async () => {
  await app.loadBoxes();
  const L = await app.useLeague(CATS9);
  const wk1 = L.periods[0]; // Oct 20-25, ends on Fantrax Monday Oct 26 at 6:59 PM
  assert.equal(await onDay('2026-10-25', () => app.periodOver(wk1)), false, 'Sunday: its last games still to come');
  assert.equal(await onDay('2026-10-26', () => app.periodOver(wk1)), true, "Monday noon: Sunday's games are in");
  assert.ok(await onDay('2026-10-26', () => app.finishedPeriods(L).some(p => p.n === 1)), 'its recap is ready');
  assert.equal(await onDay('2026-10-26', () => app.periodOver(L.periods[1])), false, 'week 2 just starting');
});

test("Dashboard: this week's waiver moves, from last week's rosters to this week's", async () => {
  const L = await app.useLeague(CATS9);
  const fid = id => app.NBA.players.find(r => r.id === id).fx.id;
  const withFx = app.NBA.players.filter(r => r.fx).slice(0, 4);
  const [a, b, c, d] = withFx.map(r => r.fx.id);
  const [t1, t2] = L.teams.map(t => t.id);
  const owner = entries => new Map(entries.map(([f, tid]) => [f, { tid, on: true }]));
  const weeks = [{ n: 1, owner: owner([[a, t1], [b, t1], [c, t2]]) }, { n: 2, owner: owner([[a, t1], [d, t1], [b, t2]]) }];
  const moves = app.periodMoves({ ...L, rosterPeriod: 2 }, weeks);
  const kinds = tid => JSON.parse(JSON.stringify((moves[tid] || []).map(m => [m.kind, m.nba]))).sort();
  assert.deepEqual(kinds(t1), [['add', withFx[3].id], ['away', withFx[1].id]].sort(), `${app.fxTeamName(t1)} added one and traded one away`);
  assert.deepEqual(kinds(t2), [['drop', withFx[2].id], ['trade', withFx[1].id]].sort(), `${app.fxTeamName(t2)} traded for one and dropped one`);
  assert.equal(moves[t2].find(m => m.kind === 'trade').from, t1);
  assert.equal(app.periodMoves({ ...L, rosterPeriod: 1 }, weeks), null, 'week 1 has no week before it');
  assert.ok(fid(withFx[0].id));
});

test('times follow the 24-hour setting', () => {
  const ui = app.get('ui'), was = ui.clock24;
  try {
    ui.clock24 = true;
    assert.match(app.fmtTime('2026-11-02T19:05:00'), /^19:05$/);
    assert.match(app.fmtTime('2026-11-02T09:05:00'), /^09:05$/);
    ui.clock24 = false;
    assert.match(app.fmtTime('2026-11-02T19:05:00'), /^7:05\s?p\.?m\.?$/i);
  } finally { ui.clock24 = was; }
});

// ----- Sleeper -----
const SLEEPER = '1369432599025442816'; // a public Sleeper league (tests/capture_sleeper_fixtures.py): 12 teams, points, Lock-In

test('Sleeper league IDs and addresses', () => {
  assert.equal(app.parseLeagueId(SLEEPER), SLEEPER);
  assert.equal(app.parseLeagueId(`https://sleeper.com/leagues/${SLEEPER}/matchup`), SLEEPER);
  assert.equal(app.parseLeagueId(`sleeper.app/leagues/${SLEEPER}`), SLEEPER);
  assert.equal(app.leagueSourceOf(SLEEPER), 'sleeper');
  assert.equal(app.leagueSourceOf('794342666'), 'espn', 'short all-digit IDs stay ESPN');
});

test('reads a Sleeper league into the same shape as the others', async () => {
  const L = await app.useLeague(SLEEPER);
  assert.equal(L.source, 'sleeper');
  assert.equal(app.sourceName(L), 'Sleeper');
  assert.equal(L.name, 'Smart League');
  assert.ok(app.isPoints() && L.oneGame && app.isOneGame());
  assert.deepEqual({ ...L.points }, { ast: 1, blk: 2, dd: 1, pts: 0.5, reb: 1, stl: 2, td: 2, to: -1, tpm: 0.5 });
  assert.deepEqual([...L.pointsOther], ['40+ point games', '50+ point games', 'flagrant fouls', 'technical fouls'], 'bonuses listed, not projected');
  assert.deepEqual(JSON.parse(JSON.stringify(app.slotsFromLeague(L))), { slots: ['PG', 'SG', 'G', 'SF', 'PF', 'F', 'C', 'FLX', 'FLX'], bench: 5, ir: 1 });
  assert.equal(L.teams.length, 12);
  const all = Object.values(L.rosters).flat();
  assert.equal(all.filter(x => x.st === 'ACTIVE').length, 12 * 9);
  assert.ok(all.filter(x => x.nba).length >= all.length - 3, 'rostered players matched by their Sleeper ids');
  assert.ok(all.every(x => x.name && !/^Player /.test(x.name)), 'everyone named');
  assert.equal(L.draft.picks.length, 168);
  assert.equal(L.draft.perRound, 12);
  assert.deepEqual([...L.draft.picks[0].slice(0, 3)], [1, 1, '7']);
  assert.equal(L.standings.length, 12);
  assert.ok(L.standings.every((s, i) => !i || s.w <= L.standings[i - 1].w), 'ranked by wins');
  assert.ok(app.hasLineupHistory(L), 'weekly lineups for awards and recaps');
  // weeks: Monday to Sunday from opening night, no All-Star exception; 3 playoff weeks for 6 teams from week 22
  const span = n => { const p = L.periods.find(x => x.n === n); return p && `${p.start}..${p.end}`; };
  assert.equal(span(1), '2026-10-20..2026-10-25');
  assert.equal(span(2), '2026-10-26..2026-11-01');
  assert.equal(span(18), '2027-02-15..2027-02-21');
  assert.equal(span(24), '2027-03-29..2027-04-04');
  assert.equal(L.periods.length, 24);
  assert.equal(L.playoffPeriod, 22);
  assert.deepEqual(Object.keys(L.matchups).map(Number), [1, 2, 3], 'the week before, this week and the next');
  assert.ok(app.fxOpponentFor('2026-10-26', L.teams[0].id), 'an opponent this week');

  // Sleeper's own positions: its lineups follow them (Luka is a PG there, a guard-forward on NBA.com)
  const saved = app.NBA.players.map(r => [r, r.fx, r.pos]);
  try {
    app.applyFantraxLeague(await app.getLeague(SLEEPER, true));
    const luka = app.NBA.players.find(r => r.name === 'Luka Dončić');
    assert.deepEqual([...luka.pos], ['PG']);
    assert.equal(luka.fx.id, luka.slp);
  } finally {
    for (const [r, fx, pos] of saved) { if (fx) r.fx = fx; else delete r.fx; r.pos = pos; }
    app.set('nbaCache', null);
  }
});

test('Sleeper counts one game a week for each starter', async () => {
  await app.loadBoxes();
  const L = await app.useLeague(SLEEPER);
  const luka = app.NBA.players.find(r => r.name === 'Luka Dončić');
  const p = app.playerFromRaw(luka);
  const week1 = app.matchDates('2026-10-20');
  const lines = week1.map(d => app.actualLine(p, d)).filter(Boolean);
  assert.equal(lines.length, 3);
  // Sleeper's 53 points for him in week 1 are his 52-point night (Oct 25), not his week
  L.slpWeek = { n: 1, pts: { [luka.slp]: 53 }, at: Date.now() };
  assert.equal(app.oneGameLine(p, lines).pts, 52);
  // with no points from Sleeper: his latest game, as Sleeper counts one that isn't locked in
  L.slpWeek = { n: 1, pts: {}, at: Date.now() };
  assert.equal(app.oneGameLine(p, lines).min, lines[2].min);
  assert.equal(app.oneGameLine(p, lines).bonus, 4, 'with its bonus points');
  // Sleeper's 0 for a player with games: he went into the lineup after them, so none counts
  L.slpWeek = { n: 1, pts: { [luka.slp]: 0 }, at: Date.now() };
  assert.equal(app.oneGameLine(p, lines), null);

  // a finished week projects to one game per starter, well under every game added up
  const A = app.fxTeamSide(L.teams[0].id);
  const one = app.projectSide(A.players, week1, null);
  L.oneGame = false;
  let every;
  try { every = app.projectSide(A.players, week1, null); } finally { L.oneGame = true; }
  assert.ok(one.games <= 9 && one.games > 0, `${one.games} starters' games count`);
  assert.ok(every.games > one.games);
  const fp = S => app.fpTotals(S).a;
  assert.ok(fp(one) < fp(every) * 0.6, `one game each: ${fp(one)} FP, every game: ${fp(every)}`);
});

test("Sleeper on the Dashboard: this period shows the game that counts", async () => {
  await app.loadBoxes();
  const L = await app.useLeague(SLEEPER);
  const tid = L.teams[0].id;
  useTeam(tid);
  const ui = app.get('ui'), was = ui.dashRange;
  L.slpWeek = { n: 1, pts: {}, at: Date.now() }; // fresh: nothing asks Sleeper again
  try {
    ui.dashRange = 'week';
    const m = await onDay('2026-10-25', () => app.dashMatchupCard());
    assert.ok(m.includes(app.fxTeamName(tid)));
    assert.ok(m.includes('this one counts'), 'a starter with more than one game shows which counts');
    assert.ok(!m.includes('Game minutes left'), 'no minutes-left chip: games beyond the first one may not count');
    const score = +[...m.matchAll(/class="mu-score">([^<]*)</g)][0][1];
    assert.ok(score > 0 && score < 500, `period score ${score}`);
  } finally { ui.dashRange = was; app.get('state').fxTeam = null; }
});

// The Sleeper league as the site has it once connected: its players matched by their Sleeper ids (raw.fx)
async function asSleeper(fn) {
  const saved = app.NBA.players.map(r => [r, r.fx, r.pos]);
  try {
    await app.useLeague(SLEEPER);
    app.applyFantraxLeague(await app.getLeague(SLEEPER, true));
    return await fn(app.fxLeague());
  } finally {
    for (const [r, fx, pos] of saved) { if (fx) r.fx = fx; else delete r.fx; r.pos = pos; }
    app.set('nbaCache', null);
  }
}

test("Sleeper's weekly lineups: each week's starters, and the one game of each that counted", () => asSleeper(async L => {
  await app.loadBoxes();
  const weeks = await app.fetchRosterWeeks(L);
  assert.deepEqual([...weeks.map(w => w.n)], [1, 2], 'every week started (the fixtures are in week 2)');
  const w1 = weeks[0];
  const byTeam = {};
  for (const [, o] of w1.owner) if (o.on) byTeam[o.tid] = (byTeam[o.tid] || 0) + 1;
  assert.ok(Object.values(byTeam).every(n => n <= 9) && Object.keys(byTeam).length === 12, 'up to 9 starters a team');
  assert.ok([...w1.owner.values()].every(o => o.pts != null), "everyone's points that week");
  // the pairings of every week come with its lineups (the league brings only this week's and its neighbors')
  const pairs = JSON.stringify(L.matchups[1]);
  delete L.matchups[1];
  await app.fetchRosterWeeks(L);
  assert.equal(JSON.stringify(L.matchups[1]), pairs);
  assert.ok(![...w1.owner.values()].some(o => o.tid === '#m'));
  const G = await app.loadGameLog('cur');
  const fidNba = app.currentFidNba();
  const L2 = { ...L, weeks: [w1], fidNba };
  // Luka's counted game in week 1: his 52-point night, not his first or every game
  const luka = app.NBA.players.find(r => r.name === 'Luka Dončić');
  const rows = (G.players.get(luka.id) || []).filter(r => app.periodDays(G, w1).has(r[0]));
  assert.equal(rows.length, 3);
  const c = app.countedRows(L2, G, w1, luka.slp, rows);
  assert.equal(c.length, 1);
  assert.equal(app.gameLine(G, c[0]).pts, 52);
  assert.equal(app.lineFp(app.gameLine(G, c[0])), 53, 'with its 40- and 50-point bonuses');
  assert.equal(app.countedRows({ ...L2, oneGame: false }, G, w1, luka.slp, rows).length, 3, 'other leagues count every game');
  // each team's week, one counted game per starter, comes to Sleeper's own score less the bonuses we don't count
  const tot = app.pastSeasonTotals(L2, G);
  const ms = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'fixtures/sleeper/league_1369432599025442816_matchups_1.json'), 'utf8'));
  for (const m of ms) {
    const T = tot[String(m.roster_id)];
    const fp = T ? app.lineFp(T.s) : 0;
    // within a technical foul or a stat correction (bonuses included: Luka's 52-point night is worth 53 there)
    assert.ok(Math.abs(fp - m.points) <= 3, `team ${m.roster_id}: ${fp} against Sleeper's ${m.points}`);
    assert.ok(!T || T.gp <= 9, 'one game a starter');
  }
}));

test('Sleeper recap and awards: one counted game per starter', () => asSleeper(async L => {
  const ui = app.get('ui');
  useTeam(L.teams[0].id);
  ui.tab = 'recap';
  try {
    app.viewRecap();
    await new Promise(r => setTimeout(r, 30));
    const html = app.viewRecap();
    assert.match(html, /Week 1 standouts/);
    const X = app.get('recaps').get(`${L.id}|1`);
    assert.equal(X.games.length, 6);
    assert.ok(X.mvp && X.mvp.line.gp1 === 1, 'Player of the week: his counted game');
    assert.equal(X.game, null, 'no separate Game of the week');
    assert.equal(X.brick, null, 'no Worst week: a week is one game');
    assert.ok(X.dud && X.dud.line.gp1 === 1);
    assert.ok(!html.includes('Game of the week') && html.includes('Player of the week'));
    assert.ok(X.missed.every(x => x.games === 1 && x.sched === 1), 'Street clothes: a start without any game');
    if (X.missed.length) assert.ok(html.includes('started without playing a game'));
  } finally { ui.tab = 'dashboard'; }
  // Awards so far run on the same weeks
  ui.tab = 'awards';
  try {
    app.viewAwardsSoFar();
    await new Promise(r => setTimeout(r, 30));
    const html = app.viewAwardsSoFar();
    assert.ok(!/No awards for Sleeper/.test(html), 'awards for Sleeper leagues');
    assert.match(html, /Best manager|Waiver Wire Wizard|Unc Status/);
    if (html.includes('Street Clothes')) assert.match(html, /empty start/);
  } finally { ui.tab = 'dashboard'; app.get('state').fxTeam = null; }
}));

test("the player card: how he came to his fantasy team", async () => {
  const L = await app.useLeague(CATS9);
  const [t1, t2] = L.teams.map(t => t.id);
  const pick = L.draft.picks.find(p => p[2] === t1 && p[3]);
  const keeper = (L.draft.keepers[t1] || [])[0];
  assert.ok(pick && keeper, 'a pick and a keeper to look at');
  const owner = entries => new Map(entries.map(([f, tid]) => [f, { tid, on: true }]));
  const weeks = [
    { n: 1, start: '2026-10-20T00:00:00', end: '2026-10-26T18:59:00', owner: owner([['pick', t1], ['keep', t1], ['traded', t2]]) },
    { n: 2, start: '2026-10-26T19:00:00', end: '2026-11-02T18:59:00', owner: owner([['pick', t1], ['keep', t1], ['traded', t1], ['added', t1]]) },
  ];
  const loads = app.get('rosterWeeksLoad'), was = loads[L.id];
  loads[L.id] = Object.assign(Promise.resolve(weeks), { done: weeks });
  try {
    const how = (nba, f) => app.cardHow(L, { id: nba }, t1, f);
    assert.equal(how(keeper, 'keep'), 'Keeper');
    assert.equal(how(pick[3], 'pick'), `Drafted · round ${pick[0]}, pick ${pick[1]}`);
    assert.equal(how(1, 'added'), 'Waiver add · week 2');
    assert.equal(how(2, 'traded'), `Traded from ${app.fxTeamName(t2)} · week 2`);
    assert.equal(how(3, 'new'), 'Waiver add · this week', 'not on the latest weekly rosters yet');
  } finally { if (was) loads[L.id] = was; else delete loads[L.id]; }
  // without weekly rosters (ESPN): the draft, else added after it
  const E = await app.useLeague(ESPN);
  const ep = E.draft.picks.find(p => p[3]);
  assert.equal(app.cardHow(E, { id: ep[3] }, ep[2], 'x'), `Drafted · round ${ep[0]}, pick ${ep[1]}`);
  assert.equal(app.cardHow(E, { id: ep[3] }, E.teams.find(t => t.id !== ep[2]).id, 'x'), 'Added after the draft');
});

test("a draft request that fails is tried again, and a draft that still won't come isn't kept as 'no draft'", async () => {
  const realFetch = app.fetch;
  let fails = 0;
  app.fetch = (url, init) => (String(url).includes('getDraftResults') && fails-- > 0
    ? Promise.resolve({ ok: false, status: 403, text: async () => '' }) : realFetch(url, init));
  try {
    fails = 1; // once: the second try brings it
    const once = await app.fetchFantraxLeague(POINTS);
    assert.ok(once.league.draft && once.league.draft.picks.length && !once.league.draftFailed);
    fails = 2; // twice: a failure, not a league without a draft
    forgetLeague(POINTS);
    const res = await app.getLeague(POINTS, true);
    assert.ok(res.league.draftFailed && !res.league.draft);
    assert.ok(!app.readLeagueCache()[POINTS], "not kept on the device, so it's asked for again");
    const was = app.NBA.league;
    app.NBA.league = res.league;
    try { assert.match(app.viewDraft(), /Couldn't load the draft[\s\S]*data-action="draft-retry"/); } finally { app.NBA.league = was; }
  } finally { app.fetch = realFetch; }
});
// drop a league from the device's league cache
function forgetLeague(id) { const all = app.readLeagueCache(); delete all[id]; app.localStorage.setItem(app.FX_CACHE_KEY, JSON.stringify(all)); }

test("this season's draft: graded by the season so far, unless the league started late or is over", async () => {
  await app.loadBoxes();
  await app.loadGameLog('cur');
  const F = await app.useLeague(CATS9);
  assert.equal(app.draftSeason(F, 'cur'), null, 'the league started on opening night and is on: its season so far is the NBA\'s');
  assert.equal(app.leagueSeason(await app.useLeague(SLEEPER)).to, '2027-04-04', "a Sleeper week ends with its Sunday's games");
  const E = await app.useLeague(ESPN); // starts in week 3, Nov 2
  const W = app.draftSeason(E, 'cur');
  assert.equal(W.win.from, '2026-11-02');
  assert.equal(W.stats.size, 0, 'none of the games so far (to Oct 26) were in its season');
  // once a league is over, the NBA games after its last week don't count
  const over = await onDay('2027-04-20', () => app.draftSeason(F, 'cur'));
  assert.ok(over && over.win.to === '2027-04-11', 'its last week ends Apr 11');
});

test("Fantrax's 'too many requests' in a normal answer waits as long as it says, then asks again", async () => {
  const realFetch = app.fetch;
  let limited = 1, calls = 0;
  const busy = JSON.stringify({ error: { onScreen: false, code: 'RATE_LIMITED', message: 'Too many requests - getDraftResults may be called at most once every 1 seconds per IP address.' } });
  app.fetch = (url, init) => {
    if (!String(url).includes('getDraftResults')) return realFetch(url, init);
    calls++;
    return limited-- > 0 ? Promise.resolve({ ok: true, status: 200, text: async () => busy }) : realFetch(url, init);
  };
  try {
    const t0 = Date.now();
    const { league } = await app.fetchFantraxLeague(POINTS);
    assert.ok(league.draft && league.draft.picks.length && !league.draftFailed, 'the draft, not "no draft"');
    assert.equal(calls, 2);
    assert.ok(Date.now() - t0 >= 1000, 'waited the second it asked for');
  } finally { app.fetch = realFetch; }
});

test('the waiver order: from ESPN and Sleeper, in the action items and a popup; Fantrax shares none', async () => {
  const E = await app.useLeague(ESPN);
  assert.deepEqual(E.waivers.map(w => w.rank), E.waivers.map((w, i) => i + 1), 'first claim first');
  assert.ok(E.waivers.every(w => w.left === null), 'no budget in this league');
  const S = await app.useLeague(SLEEPER);
  assert.equal(S.waivers.length, 12);
  assert.equal(S.waivers[0].rank, 1);
  const st = app.get('state'), was = st.fxTeam;
  try {
    useTeam(S.waivers[2].id);
    const item = app.buildAlerts().find(a => a.action === 'waiver-order');
    assert.ok(item && item.msg.includes('<b>#3</b> of 12'), item && item.msg);
    const pop = app.waiverPopup();
    assert.equal((pop.match(/<li/g) || []).length, 12);
    assert.ok(pop.includes('class="me"') && pop.includes(app.fxTeamName(S.waivers[2].id)));
    const ui = app.get('ui');
    ui.season = 'past';
    try { assert.ok(!app.buildAlerts().some(a => a.action === 'waiver-order'), 'not while a past season is on screen'); } finally { ui.season = null; }
    // Fantrax doesn't share it: no item
    const F = await app.useLeague(CATS9);
    assert.equal(F.waivers, undefined);
    useTeam(F.teams[0].id);
    assert.ok(!app.buildAlerts().some(a => a.action === 'waiver-order'));
  } finally { st.fxTeam = was; }
});

test('browsing without a league: just the Players tab, no league anywhere', async () => {
  await app.loadBoxes();
  const st = app.get('state'), ui = app.get('ui');
  const saved = app.NBA.players.map(r => [r, r.fx, r.pos]);
  const was = { browse: st.browse, fxTeam: st.fxTeam, demo: st.demo, leagueChosen: st.leagueChosen };
  await app.useLeague(CATS9); // the daily file's own league stays loaded underneath
  try {
    st.fxTeam = undefined; st.demo = false; st.leagueChosen = false; // as on a first visit
    assert.ok(app.needsLanding(), 'no team: the landing page');
    assert.match(app.viewLanding(), /data-action="land-browse"/);
    app.actions['land-browse']();
    assert.ok(st.browse && !app.needsLanding());
    assert.equal(app.fxLeague(), null, "the site's league isn't this visitor's");
    assert.deepEqual([...app.tabList().map(t => t[0])], ['players']);
    assert.ok(app.NBA.players.every(r => !r.fx), "nobody shows as free in someone else's league");
    const html = app.viewPlayers();
    assert.match(html, /No league connected[\s\S]*data-action="browse-exit"/);
    assert.ok(!html.includes('perf-owner') && !html.includes('badge good'), 'no fantasy teams or free-agent badges');
    assert.ok(/data-nba="\d+"/.test(html), 'players listed');
    assert.equal(app.scoreCats().length, 9, 'a standard 9-category league');
    // back out: the landing page again
    app.actions['browse-exit']();
    assert.ok(!st.browse && app.needsLanding());
  } finally {
    Object.assign(st, was);
    for (const [r, fx, pos] of saved) { if (fx) r.fx = fx; else delete r.fx; r.pos = pos; }
    app.set('nbaCache', null);
    ui.tab = 'standings'; // no live box scores in the background
    const live = app.get('live');
    clearTimeout(live.timer); live.timer = null;
  }
});

test('Send feedback: an email to feedback@leaguelayer.com with the league, page and version filled in', async () => {
  const L = await app.useLeague(CATS9);
  const href = app.feedbackHref();
  assert.ok(href.startsWith('mailto:feedback@leaguelayer.com?subject=League%20Layer%20feedback&body='));
  const body = decodeURIComponent(href.split('&body=')[1]);
  assert.ok(body.includes(`League: ${L.name} (Fantrax ${L.id})`) && body.includes('Page: ') && body.includes('Version: '), body);
  assert.ok(body.split('\n').length > 6, 'on separate lines');
  // the popup: Gmail in the browser (an email link alone does nothing without an email app), the email app, or copy
  const pop = app.feedbackPopup();
  assert.ok(pop.includes('https://mail.google.com/mail/?view=cm') && pop.includes('to=feedback%40leaguelayer.com'));
  assert.ok(pop.includes('href="mailto:feedback@leaguelayer.com') && pop.includes('data-action="feedback-copy"'));
  assert.ok(pop.includes(L.id), 'the details shown');
});
