// League Layer: live box scores: today's games on the Dashboard's matchup and Performances, as they're played.
// The site loads js/*.js in order (see index.html); they share one scope, like one file.
'use strict';

/* ---------- Live box scores ---------- */
// There's no server: the browser asks ESPN itself. While the matchup or Performances shows today's games and is on screen, every
// 30 seconds while games are on (a minute with the browser's data saver on): the day's scoreboard (small), and the
// box score of each game in progress whose score has changed, or that hasn't been read for a minute (once more when
// it ends). Earlier days come from the saved box scores; days the daily data job hasn't saved yet (it runs at
// 4 a.m. ET) are asked for once.
const LIVE_EVERY = 30e3;
const LIVE_STALE = 60e3; // a game's box score is read again after this even if its score hasn't moved
const LIVE_IDLE = 30 * 60e3; // nothing on: look again in half an hour (or at the next tip-off)
const liveEvery = () => (navigator.connection && navigator.connection.saveData ? 60e3 : LIVE_EVERY);
// games: the scoreboard's; lines: date -> NBA id -> stat line; done: finished games (and days) already read;
// read: game id -> { sc: its score when its box score was read, at }; hold: a live update is drawing (rows keep their order)
const live = { day: null, games: [], lines: new Map(), done: new Set(), read: new Map(), floor: new Map(), at: 0, busy: false, error: '', timer: null, hold: false };
// (another sport: its games and lines, from nothing)
keep('sport', () => { clearTimeout(live.timer); Object.assign(live, { day: null, games: [], lines: new Map(), done: new Set(), read: new Map(), at: 0, tried: 0, error: '', fails: 0, timer: null }); });

// ESPN lists tip-offs in UTC; 5 hours back always lands on the US game date (as the daily data job does)
const usDay = t => new Date(t - 5 * 36e5).toISOString().slice(0, 10);

// ESPN's team as the data's: basketball by its id, the others by its code
const espnTri = t => (SPORT.espnTeams ? SPORT.espnTeams[t.abbreviation] || t.abbreviation : ESPN_TEAMS[t.id] || t.abbreviation);

function espnGames(sb) {
  return (sb.events || []).map(e => {
    const side = Object.fromEntries(e.competitions[0].competitors.map(t => [t.homeAway, t]));
    const tri = t => espnTri(t.team);
    const start = new Date(e.date);
    // hockey: ESPN's starting goalies, Expected and then Confirmed
    const goalie = t => { const g = (t.probables || []).find(x => x.name === 'probableStartingGoalie'); return g && g.athlete ? { a: g.athlete, sure: !!g.status && g.status.type === 'confirmed' } : null; };
    return { id: e.id, d: usDay(start), start, home: tri(side.home), away: tri(side.away), hs: +side.home.score || 0, as: +side.away.score || 0, state: e.status.type.state, detail: e.status.type.shortDetail, period: +e.status.period || 0, clock: +e.status.clock || 0,
      goalies: { [tri(side.home)]: goalie(side.home), [tri(side.away)]: goalie(side.away) } };
  });
}

// ESPN's players as NBA.com's: by ESPN id (the daily data file has them), else first initial, last name and team
let espnIndex = null;
keep('sport', () => { espnIndex = null; });
function espnPlayer(a, team, role = '') {
  if (!espnIndex || espnIndex.nba !== NBA) {
    espnIndex = { nba: NBA, ids: new Map(), names: new Map() };
    for (const r of NBA.players) {
      if (r.espn) espnIndex.ids.set(String(r.espn), r);
      const k = `${nameKey(r.name)}|${r.team}|${isHockey() ? hockeyRole(homePos(r)) : ''}`;
      espnIndex.names.set(k, espnIndex.names.has(k) ? null : r);
    }
  }
  return espnIndex.ids.get(String(a.id)) || espnIndex.names.get(`${nameKey(a.displayName)}|${team}|${role}`) || null;
}

const madeAtt = v => String(v || '0-0').split('-').map(x => +x || 0);
const clockMin = v => { const [m, s] = String(v || '0:00').split(':'); return (+m || 0) + (+s || 0) / 60; };

// ESPN's hockey box score: forwards and defensemen on one list of keys, goalies on another. It has no power-play
// points or decisions: those, and the wins, come with the next morning's box scores.
function espnHockeyLines(sm) {
  const out = new Map();
  for (const team of (sm.boxscore && sm.boxscore.players) || []) {
    const tri = espnTri(team.team);
    for (const st of team.statistics || []) {
      const i = Object.fromEntries((st.keys || []).map((k, n) => [k, n])), goalies = st.name === 'goalies';
      for (const a of st.athletes || []) {
        const v = a.stats || [];
        const num = k => (k in i ? +v[i[k]] || 0 : 0);
        const min = clockMin(v[i.timeOnIce]);
        const raw = !a.didNotPlay && min > 0 ? espnPlayer(a.athlete, tri, goalies ? 'G' : st.name === 'defenses' ? 'D' : 'F') : null;
        if (!raw) continue;
        const fow = num('faceoffsWon'), fol = num('faceoffsLost');
        out.set(raw.id, boxCounts(goalies ? { min, gt: min / 60, ga: num('goalsAgainst'), sa: num('shotsAgainst'), sv: num('saves'), gpim: num('penaltyMinutes') } : {
          min, g: num('goals'), a: num('assists'), pts: num('goals') + num('assists'), pm: num('plusMinus'), pim: num('penaltyMinutes'),
          sog: num('shotsTotal'), hit: num('hits'), blk: num('blockedShots'), fow, fol, fot: fow + fol,
        }));
      }
    }
  }
  return out;
}

// One ESPN box score as the lines the saved box scores give: NBA id -> stats (players who've been on the floor)
// (teamOf, when given, gets each player's team in that game)
function espnLines(sm, teamOf) {
  if (isHockey()) return espnHockeyLines(sm);
  const out = new Map();
  for (const team of (sm.boxscore && sm.boxscore.players) || []) {
    const tri = espnTri(team.team);
    const st = (team.statistics || [])[0];
    if (!st) continue;
    const i = Object.fromEntries(st.keys.map((k, n) => [k, n]));
    for (const a of st.athletes || []) {
      const v = a.stats || [];
      const num = k => (k in i ? +v[i[k]] || 0 : 0);
      const raw = !a.didNotPlay && v.length && num('minutes') > 0 ? espnPlayer(a.athlete, tri) : null;
      if (!raw) continue;
      if (teamOf) teamOf.set(raw.id, tri);
      const [fgm, fga] = madeAtt(v[i['fieldGoalsMade-fieldGoalsAttempted']]);
      const [tpm, tpa] = madeAtt(v[i['threePointFieldGoalsMade-threePointFieldGoalsAttempted']]);
      const [ftm, fta] = madeAtt(v[i['freeThrowsMade-freeThrowsAttempted']]);
      out.set(raw.id, boxCounts({
        min: num('minutes'), pts: num('points'), reb: num('rebounds'), ast: num('assists'), stl: num('steals'), blk: num('blocks'),
        tpm, to: num('turnovers'), fgm, fga, ftm, fta, oreb: num('offensiveRebounds'), dreb: num('defensiveRebounds'), tpa, pf: num('fouls'), pm: num('plusMinus'),
      }));
    }
  }
  return out;
}

// Who's on the floor in an ESPN basketball box score: its `active` flag, which marks exactly five a team while a game is on
// (checked on four live games against the substitutions in their play-by-play). After the buzzer it still marks the last
// five, so it's read only while a game is on (onFloor). A Set of NBA ids; none for hockey or football.
function espnFloor(sm) {
  const out = new Set();
  if (isHockey() || isFootball()) return out;
  for (const team of (sm.boxscore && sm.boxscore.players) || []) {
    const tri = espnTri(team.team), st = (team.statistics || [])[0];
    for (const a of (st && st.athletes) || []) {
      const raw = a.active && !a.didNotPlay ? espnPlayer(a.athlete, tri) : null;
      if (raw) out.add(raw.id);
    }
  }
  return out;
}
// A player on the floor right now (true), on the bench (false), or not known (null): his game isn't on, it's between
// periods (the five who ended one), or its box score hasn't been read yet. As fresh as the box score: a minute at most.
const betweenPeriods = g => !g.clock || /half|end of/i.test(g.detail || ''); // (the clock run out, or Halftime, End of 3rd)
function onFloor(p, d) {
  const g = liveGame(p, d);
  if (!g || g.state !== 'in' || betweenPeriods(g)) return null;
  const f = live.floor.get(g.id);
  return f && f.size ? f.has(p.nbaId != null ? p.nbaId : p.id) : null; // (a row's player, or the data's: raw.id)
}

// ESPN's lines: date -> NBA id -> line, for games the saved box scores don't have yet
const liveLines = d => live.lines.get(d) || new Map();
const savedFinal = g => !!(BOX && BOX.finals.has(`${g.d} ${g.home}`));
const espnDate = d => d.replace(/-/g, '');
// Plan Ahead on the week underway (any sport): its games as they're played, a game on now marked in its schedule bubble
const weekTabLive = () => ui.tab === 'week' && !ui.weekShift;
const liveTab = () => ui.tab === 'dashboard' || ui.tab === 'players' || weekTabLive();
// (Matchup and Players: the first update of a visit whatever's picked, as it also reads last night's games the saved box
// scores lack, which a page opening on a kept pick (core.js, picks), Yesterday or This season, would go without)
const liveWanted = () => !document.hidden && (weekTabLive() || (!live.tried && liveTab()) || (ui.tab === 'dashboard' ? ui.dashRange !== 'day' : ui.tab === 'players' && !['day', 'last', 'avg', 'proj'].includes(ui.perfRange) && !(ui.perfRange === 'year' && ui.perfPer)));

// each game on its own: one that fails is asked for again next time; only all of them failing counts as an error.
// With the live feed (feed: liveFeedGet's answer), a game's box score comes from it when it has one under LIVE_FEED_OLD
// old (a finished game's once it was read after the buzzer), no request; one it lacks, or has too old (few people
// watching: the Worker builds it rarely, a few box scores at a time), is asked of ESPN, if due (boxDue), as without it.
// A finished basketball game goes in with the saved box scores at once (addBoxGame), as the job's copy would, so Plan
// Ahead's schedule and projection and every other tab count it that night, not once the daily job has run (GitHub starts
// that job hours late: 14:54-18:12 UTC, Nov 11-16, 2026). Hockey's ESPN lines lack stats leagues count: those wait for the job.
async function readBoxes(games, feed, pooled = false) {
  let added = 0;
  const res = await Promise.allSettled(games.map(async g => {
    const fb = feed && feed.boxes && feed.boxes[g.id];
    const use = fb && feed.at - fb.at < LIVE_FEED_OLD && (g.state !== 'post' || fb.final);
    if (!use && feed && !boxDue(g)) return;
    const sm = use ? fb.box : await espnSite(`summary?event=${g.id}`, 3, pooled), teamOf = new Map(), lines = espnLines(sm, teamOf); // (pooled: finished days')
    live.floor.set(g.id, espnFloor(sm)); // (who's on the floor: the Matchup tab's)
    if (!live.lines.has(g.d)) live.lines.set(g.d, new Map());
    for (const [id, line] of lines) live.lines.get(g.d).set(id, line);
    live.read.set(g.id, { sc: liveScore(g), at: Date.now() });
    if (g.state !== 'post') return;
    live.done.add(g.id);
    if (BOX && !isHockey() && !isFootball() && lines.size && !savedFinal(g)) { addBoxGame(g, lines, teamOf); added++; }
  }));
  if (added) boxAdded();
  dropPlayedInjuries(); // someone listed questionable who's played tonight
  const failed = res.filter(r => r.status === 'rejected');
  if (failed.length && failed.length === res.length) throw failed[0].reason;
  return failed.length;
}

// ----- A week's last games, before the daily job saves them -----
// The Recap waits for a week's games to be in the saved box scores, which the daily job
// writes at 3-4 a.m. ET. So that it's there the night the week ends, ESPN's finished games of the latest week's days the
// saved ones lack are put in with them, as the job keeps ESPN copies until NBA.com's come. Basketball only (ESPN's
// hockey lines lack stats leagues count); once a minute at most, and only from the week's last game day on.
const boxFill = { at: 0, busy: false };
const FINALS = 'ESPN finals'; // (its misses, for feedWait)
function weekDaysToFill(L) {
  if (!L || !BOX || isFootball() || isHockey() || !hasWeekLineups(L)) return [];
  const today = todayIso();
  // the week not over yet whose last game day has come (on a Monday morning, the next one has started already)
  const days = (L.periods || []).filter(x => String(x.start).slice(0, 10) <= today && !periodOver(x))
    .map(x => matchDates(String(x.start).slice(0, 10))).find(ds => ds.length && ds[ds.length - 1] <= today) || [];
  return days.filter(d => [...teamDates].some(([t, ds]) => ds.has(d) && !BOX.finals.has(`${d} ${t}`)));
}
// One finished ESPN game into the saved box scores, as loadBoxes reads the job's
function addBoxGame(g, lines, teamOf) {
  const s = { home: g.home, away: g.away, hs: g.hs, as: g.as };
  BOX.finals.add(`${g.d} ${g.home}`).add(`${g.d} ${g.away}`);
  BOX.scores.set(`${g.d} ${g.home}`, s).set(`${g.d} ${g.away}`, s);
  for (const [id, st] of lines) {
    const team = teamOf.get(id);
    if (team !== g.home && team !== g.away) continue;
    const margin = team === g.home ? g.hs - g.as : g.as - g.hs;
    if (!BOX.byPlayer.has(id)) BOX.byPlayer.set(id, []);
    BOX.byPlayer.get(id).push([g.d, st, margin, team]);
    if (!BOX.day.has(id)) BOX.day.set(id, new Map());
    BOX.day.get(id).set(g.d, { ...st, margin });
  }
}
async function fillWeekFromEspn(L) {
  const days = weekDaysToFill(L);
  if (!days.length || boxFill.busy || Date.now() - boxFill.at < feedWait(FINALS, 60e3)) return 0;
  boxFill.busy = true;
  boxFill.at = Date.now();
  let added = 0;
  try {
    for (const d of days) {
      const games = espnGames(await espnSite(`scoreboard?dates=${espnDate(d)}`, 1, true)).filter(g => g.state === 'post' && !savedFinal(g));
      await Promise.all(games.map(async g => {
        const teamOf = new Map(), lines = espnLines(await espnSite(`summary?event=${g.id}`, 1, true), teamOf);
        if (!lines.size || savedFinal(g)) return;
        addBoxGame(g, lines, teamOf);
        added++;
      }));
    }
    noteLiveOk(FINALS);
  } catch (e) { feedFails[FINALS] = (feedFails[FINALS] || 0) + 1; /* ESPN didn't answer: the saved box scores will have them by morning */ } finally { boxFill.busy = false; }
  if (added) {
    boxAdded();
    if (ui.tab === 'recap' || ui.tab === 'dashboard' || ui.tab === 'week') render();
  }
  return added;
}
// ESPN's finals went in with the saved box scores: what was built on those alone is built again (Sleeper's points for the
// week too, which tell which game counted)
function boxAdded() {
  const L = fxLeague();
  changed('box'); // (every league's: the box scores are everyone's)
  if (L && L.source === 'sleeper') changed('league', L.id);
}

// ----- The injury report, through the day -----
// The morning's data has ESPN's injury report as it was then; the page reads the report again (ESPN's own feed, about 50 KB)
// when it's drawn or comes back on screen, at most every 15 minutes (no timer of its own), the same way the job does: Out (suspended too) or Day-To-Day, hockey's
// questionable and probable as DTD. A player the feed has but the page can't place keeps the morning's entry.
const INJ_EVERY = 15 * 60e3;
const injFeed = { at: 0, nba: null, busy: false };
function injuryFrom(i) {
  const s = String(i.status || '').trim(), l = s.toLowerCase();
  const status = isHockey() ? (['day-to-day', 'questionable', 'probable'].includes(l) ? 'DTD' : 'Out') : (['out', 'suspension', 'suspended'].includes(l) ? 'Out' : 'DTD');
  return { status, label: s || status, note: i.shortComment || '', date: String(i.date || '').slice(0, 10), back: String((i.details || {}).returnDate || '').slice(0, 10) };
}
// feed: ESPN's injuries answer -> how many players' entries changed
function applyInjuries(feed) {
  const found = new Map(), unplaced = new Set();
  for (const team of feed.injuries || []) for (const i of team.injuries || []) {
    const a = i.athlete || {};
    if (!a.displayName) continue;
    const id = (String(((a.links || [])[0] || {}).href || '').match(/\/id\/(\d+)/) || [])[1];
    const raw = espnPlayer({ id, displayName: a.displayName }, a.team ? espnTri(a.team) : '', isHockey() ? hockeyRole((a.position || {}).abbreviation) : '');
    if (raw) found.set(raw, injuryFrom(i)); else unplaced.add(nameKey(a.displayName));
  }
  if (found.size < 5) return 0; // (an answer that comes back nearly empty isn't believed over the morning's)
  let n = 0;
  for (const raw of NBA.players) {
    let inj = found.get(raw) || (raw.inj && unplaced.has(nameKey(raw.name)) ? raw.inj : null);
    if (inj && inj.date && playedSince(raw.id, inj.date)) inj = null; // listed for a game he's since played
    if (JSON.stringify(inj) !== JSON.stringify(raw.inj || null)) { raw.inj = inj; n++; }
  }
  if (n) syncLinked();
  return n;
}
async function refreshInjuries() {
  if (!NBA || isFootball() || injFeed.busy || document.hidden || (injFeed.nba === NBA && Date.now() - injFeed.at < INJ_EVERY)) return 0;
  Object.assign(injFeed, { busy: true, at: Date.now(), nba: NBA }); // (a miss waits its 15 minutes too)
  try {
    const feed = await espnSite('injuries', 1, true); // (pooled: the Worker keeps one copy for everyone 5 minutes)
    const n = applyInjuries(feed);
    if (n) render();
    return n;
  } catch (e) { return 0; /* the morning's report stays */ } finally { injFeed.busy = false; }
}

// ESPN's feed is unofficial: it can block the site or change shape, and a visitor only sees a note. Failing LIVE_FAILS
// updates in a row (blocked, or its answers no longer read) goes to the error log, once a visit, unless it's this
// visitor's own connection: offline, or this site doesn't answer either.
const LIVE_FAILS = 3;
const feedFails = {};
const noteLiveOk = (feed = 'ESPN live scores') => { feedFails[feed] = 0; };
// How long to wait before asking a feed again: its usual wait, doubled after each failure in a row (1, 2, 4, 8 times), and
// 5 minutes at most. A feed that's failing isn't asked every 30 seconds by every visitor: that's how a site gets blocked.
const FEED_MAX_WAIT = 5 * 60e3;
const feedWait = (feed, base) => Math.min(base * 2 ** Math.min(feedFails[feed] || 0, 4), Math.max(base, FEED_MAX_WAIT));

// ESPN's site feed (scoreboards, box scores, the injury report), asked of ESPN by each visitor's browser. Should ESPN stop
// answering the site (ESPN_SWITCH failures in a row while leaguelayer.com itself answers, so not the visitor's own
// connection), the same feed comes through League Layer's Worker instead (worker/yahoo.js, /espn/), which asks ESPN once
// for everyone and keeps the answer for seconds. The switch lasts ESPN_ROUTE_HOURS on this device, then direct is tried
// again; it's logged once, so the owner knows.
const ESPN_SITE = 'https://site.api.espn.com/apis/site/v2/sports/';
const ESPN_SWITCH = 2, ESPN_ROUTE_HOURS = 6, ESPN_ROUTE_KEY = 'league-layer-espn-route';
const espnRoute = { misses: 0 };
const espnViaWorker = () => { try { return +localStorage.getItem(ESPN_ROUTE_KEY) > Date.now(); } catch (e) { return false; } };
// pooled: a feed that's the same for everyone and changes slowly (the injury report, finished days), asked of the Worker
// first, so ESPN gets one request where it would get one from each visitor; ESPN directly if the Worker can't answer
async function espnSite(path, tries = 3, pooled = false) {
  const direct = SPORT.espn + path;
  const viaWorker = () => getJson(`${WORKER}/espn/${direct.slice(ESPN_SITE.length)}`, 'ESPN', undefined, tries);
  if (espnViaWorker()) return viaWorker();
  if (pooled) { try { return await viaWorker(); } catch (e) { /* ESPN directly, below */ } }
  try {
    const j = await getJson(direct, 'ESPN', undefined, tries);
    espnRoute.misses = 0;
    return j;
  } catch (e) {
    if (++espnRoute.misses < ESPN_SWITCH || navigator.onLine === false) throw e;
    const here = await fetch('index.html', { method: 'HEAD', cache: 'no-store' }).catch(() => null);
    if (!here || !here.ok) throw e; // the visitor's own connection
    let j;
    try { j = await viaWorker(); } catch (e2) { throw e; } // the Worker can't either: ESPN itself is down, say so as before
    try { localStorage.setItem(ESPN_ROUTE_KEY, String(Date.now() + ESPN_ROUTE_HOURS * 36e5)); } catch (x) { /* storage blocked: this visit only */ }
    espnRoute.misses = 0;
    reportError(`ESPN not answering the site directly (${e.message}): its feeds come through the Worker for ${ESPN_ROUTE_HOURS} hours`, 'js/live.js');
    return j;
  }
}
async function noteLiveFailure(msg, feed = 'ESPN live scores') {
  feedFails[feed] = (feedFails[feed] || 0) + 1;
  if (feedFails[feed] !== LIVE_FAILS || navigator.onLine === false) return;
  const here = await fetch('index.html', { method: 'HEAD', cache: 'no-store' }).catch(() => null);
  if (here && here.ok) reportError(`${feed} failing (${SPORT.name}): ${msg}`, 'js/live.js');
}

// ----- The live feed: League Layer's Worker reads ESPN once for everyone (worker/yahoo.js, /live/) -----
// Today's scoreboard and each game's box score, cut to what the page reads, in one small request (about 1 KB a game,
// where ESPN's box score is 400 KB): the page asks it first. If it can't be had (the Worker down, or not deployed with
// the route yet), ESPN directly, as before, for LIVE_FEED_OFF before the feed is tried again.
const LIVE_FEED_OFF = 10 * 60e3, LIVE_FEED_OLD = 45e3;
const liveFeed = { off: 0 };
async function liveFeedGet() {
  if (Date.now() < liveFeed.off) return null;
  try {
    const f = await getJson(`${WORKER}/live/${SPORT.espn.slice(ESPN_SITE.length).replace(/\/$/, '')}`, 'League Layer', undefined, 1);
    if (!f || !f.scoreboard || !f.boxes) throw new Error('not a live feed');
    return f;
  } catch (e) { liveFeed.off = Date.now() + LIVE_FEED_OFF; return null; }
}

// the wait between updates: 30 seconds (a minute with data saver on), longer while ESPN keeps failing
const liveDelay = () => feedWait('ESPN live scores', liveEvery());
async function pollLive() {
  clearTimeout(live.timer);
  live.timer = null;
  if (live.busy || !liveWanted()) return;
  live.busy = true;
  live.tried = Date.now();
  try {
    await loadBoxes().catch(() => null); // to know which finished games are saved already
    const feed = await liveFeedGet(), sb = feed ? feed.scoreboard : await espnSite('scoreboard');
    const today = todayIso(), was = live.games;
    live.games = espnGames(sb);
    live.day = (sb.day && sb.day.date) || (live.games[0] && live.games[0].d) || live.day;
    // ESPN's scoreboard stays on last night's games until late morning (still at 11 a.m. ET, Nov 17, 2026): today's, with
    // their tip-offs, from today's own scoreboard meanwhile. Through the Worker, which keeps a dated day 10 minutes, unless
    // a game of today is on or that close to starting (ESPN directly then, fresh)
    if (!live.games.some(g => g.d === today) && [...teamDates.values()].some(ds => ds.has(today))) {
      const near = was.some(g => g.d === today && (g.state !== 'pre' || g.start - Date.now() < 10 * 60e3));
      try { live.games.push(...espnGames(await espnSite(`scoreboard?dates=${espnDate(today)}`, 1, !near))); } catch (e) { /* the opponent alone, until the next update */ }
    }
    // (football: only the scoreboard. Its live points come from Sleeper, in the league's scoring: footballLines)
    if (isFootball()) {
      for (const g of live.games) if (g.state === 'post') live.done.add(g.id);
    } else await readBoxes(live.games.filter(g => g.state !== 'pre' && !live.done.has(g.id) && !savedFinal(g) && (feed || boxDue(g))), feed);
    // yesterday and earlier days of this week that the saved box scores don't have yet: once each (a miss is
    // tried next time)
    const days = new Set(isFootball() ? [] : [addDays(today, -1), ...matchDates(mondayOf(today)).filter(d => d < today)]);
    for (const d of [...days].filter(d => d !== live.day && !live.done.has(d))) {
      if (![...teamDates].some(([t, ds]) => ds.has(d) && !(BOX && BOX.finals.has(`${d} ${t}`)))) { live.done.add(d); continue; }
      try {
        const past = espnGames(await espnSite(`scoreboard?dates=${espnDate(d)}`, 1, true));
        if (!(await readBoxes(past.filter(g => g.state === 'post' && !live.done.has(g.id) && !savedFinal(g)), null, true))) live.done.add(d);
      } catch (e) { /* try again on the next update */ }
    }
    live.at = Date.now();
    live.error = '';
    noteLiveOk();
  } catch (e) {
    live.error = e.message || "couldn't reach ESPN";
    await noteLiveFailure(live.error);
  } finally {
    live.busy = false;
  }
  scheduleLive();
  if (liveTab()) { live.hold = true; try { render(); } finally { live.hold = false; } }
}

// A game's box score is worth asking for again: its score (or state) moved since the last read, or that's a minute old
const liveScore = g => `${g.as}-${g.hs} ${g.state}`;
function boxDue(g) {
  const r = live.read.get(g.id);
  return !r || r.sc !== liveScore(g) || Date.now() - r.at >= LIVE_STALE;
}

// The next update: in 30 seconds while a game is on (or due to start, or just finished), else at the next tip-off,
// at most half an hour away
function scheduleLive() {
  clearTimeout(live.timer);
  live.timer = null;
  if (!liveWanted()) return;
  const soon = live.games.filter(g => g.state === 'pre').map(g => g.start - Date.now());
  const on = live.error || live.games.some(g => g.state === 'in' || (g.state === 'post' && !live.done.has(g.id) && !savedFinal(g))) || soon.some(ms => ms <= 0);
  live.timer = setTimeout(pollLive, on ? liveDelay() : Math.max(Math.min(LIVE_IDLE, ...soon), liveEvery()));
}

// Showing today's games: update now if the last update is due, else carry on with the schedule
function startLive() {
  if (live.busy || !liveWanted()) return;
  // (from the last try, not the last success: a page drawn again while ESPN fails doesn't ask again at once)
  if (Date.now() - Math.max(live.at, live.tried || 0) >= liveDelay()) pollLive();
  else if (!live.timer) scheduleLive();
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearTimeout(live.timer); live.timer = null; } else { startLive(); refreshInjuries(); }
});

// minutes of a game still to be played: all of them before the start, less the game clock's progress (none left in overtime)
function gameMinLeft(g) {
  const { minutes: all, periods: n } = SPORT.game, one = all / n;
  return !g || g.state === 'pre' ? all : g.state === 'post' || g.period > n ? 0 : Math.max(0, all - (g.period - 1) * one - (one - g.clock / 60));
}
const liveGame = (p, d) => live.games.find(g => g.d === d && (g.home === p.team || g.away === p.team)) || null;
const liveOn = (p, d) => { const g = liveGame(p, d); return !!g && g.state === 'in'; };
// The dot of a player in a game on now: solid and pulsing while he's on the floor, light while he's on his team's bench
// and between periods (nobody's playing); just the game's when it isn't known (hockey, football, a box score not read
// yet). Every live dot by a player goes through here (his clock, This period's "on now"): a solid dot for everyone in a
// game read as "all on the floor"
function liveDot(p, d) {
  const g = liveGame(p, d);
  if (!g || g.state !== 'in') return '';
  const on = onFloor(p, d), out = on === false || betweenPeriods(g);
  const tip = on ? 'On the floor now' : out ? (on === false ? 'On the bench now' : 'Between periods') : '';
  return tip ? `<span class="lv-dot${out ? ' out' : ''}" title="${tip}" aria-label="${tip}"></span>` : '<span class="lv-dot" aria-hidden="true"></span>';
}
// a game's state for its row: the clock while it's on (after his dot, liveDot), Final once it's over
function liveStatus(p, d) {
  const g = liveGame(p, d);
  if (!g || g.state === 'pre') return '';
  if (g.state !== 'in') return 'Final';
  // ESPN's "4:12 - 3rd" as "Q3 4:12" (hockey: "P3 4:12", "2:00 - OT" as "OT 2:00"); "Halftime" as "Half" (the room it
  // saves, the owner's ask); End of 3rd and the like as they are
  const clock = String(g.detail || '').replace(/^([\d:.]+) - (?:(\d)(?:st|nd|rd|th)|(\d*OT))$/, (m, t, q, ot) => `${q ? `${SPORT.game.tag}${q}` : ot} ${t}`);
  const said = clock === 'Halftime' ? 'Half' : clock;
  return `${liveDot(p, d)}${esc(said)}`;
}
