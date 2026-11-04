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
const live = { day: null, games: [], lines: new Map(), done: new Set(), read: new Map(), at: 0, busy: false, error: '', timer: null, hold: false };

// ESPN lists tip-offs in UTC; 5 hours back always lands on the US game date (as the daily data job does)
const usDay = t => new Date(t - 5 * 36e5).toISOString().slice(0, 10);

// ESPN's team as the data's: basketball by its id, hockey by its code
const espnTri = t => (isHockey() ? SPORT.espnTeams[t.abbreviation] || t.abbreviation : ESPN_TEAMS[t.id] || t.abbreviation);

function espnGames(sb) {
  return (sb.events || []).map(e => {
    const side = Object.fromEntries(e.competitions[0].competitors.map(t => [t.homeAway, t]));
    const tri = t => espnTri(t.team);
    const start = new Date(e.date);
    return { id: e.id, d: usDay(start), start, home: tri(side.home), away: tri(side.away), hs: +side.home.score || 0, as: +side.away.score || 0, state: e.status.type.state, detail: e.status.type.shortDetail, period: +e.status.period || 0, clock: +e.status.clock || 0 };
  });
}

// ESPN's players as NBA.com's: by ESPN id (the daily data file has them), else first initial, last name and team
let espnIndex = null;
function espnPlayer(a, team, role = '') {
  if (!espnIndex || espnIndex.nba !== NBA) {
    espnIndex = { nba: NBA, ids: new Map(), names: new Map() };
    for (const r of NBA.players) {
      if (r.espn) espnIndex.ids.set(String(r.espn), r);
      const k = `${nameKey(r.name)}|${r.team}|${isHockey() ? hockeyRole(r.pos[0]) : ''}`;
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
function espnLines(sm) {
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

// ESPN's lines: date -> NBA id -> line, for games the saved box scores don't have yet
const liveLines = d => live.lines.get(d) || new Map();
const savedFinal = g => !!(BOX && BOX.finals.has(`${g.d} ${g.home}`));
const espnDate = d => d.replace(/-/g, '');
// The Dashboard's matchup or Performances (Players) is on screen and shows games from today (Today, This week, or
// not picked yet: each opens on Today once games have started)
const liveTab = () => ui.tab === 'dashboard' || ui.tab === 'players';
const liveWanted = () => !document.hidden && (ui.tab === 'dashboard' ? ui.dashRange !== 'day' : ui.tab === 'players' && ui.perfRange !== 'day' && ui.perfRange !== 'avg');

// each game on its own: one that fails is asked for again next time; only all of them failing counts as an error
async function readBoxes(games) {
  const res = await Promise.allSettled(games.map(async g => {
    const lines = espnLines(await getJson(`${SPORT.espn}summary?event=${g.id}`, 'ESPN'));
    if (!live.lines.has(g.d)) live.lines.set(g.d, new Map());
    for (const [id, line] of lines) live.lines.get(g.d).set(id, line);
    live.read.set(g.id, { sc: liveScore(g), at: Date.now() });
    if (g.state === 'post') live.done.add(g.id);
  }));
  const failed = res.filter(r => r.status === 'rejected');
  if (failed.length && failed.length === res.length) throw failed[0].reason;
  return failed.length;
}

async function pollLive() {
  clearTimeout(live.timer);
  live.timer = null;
  if (live.busy || !liveWanted()) return;
  live.busy = true;
  try {
    await loadBoxes().catch(() => null); // to know which finished games are saved already
    const sb = await getJson(SPORT.espn + 'scoreboard', 'ESPN');
    live.games = espnGames(sb);
    live.day = (sb.day && sb.day.date) || (live.games[0] && live.games[0].d) || live.day;
    await readBoxes(live.games.filter(g => g.state !== 'pre' && !live.done.has(g.id) && !savedFinal(g) && boxDue(g)));
    // yesterday and earlier days of this week that the saved box scores don't have yet: once each (a miss is
    // tried next time)
    const today = todayIso();
    const days = new Set([addDays(today, -1), ...matchDates(mondayOf(today)).filter(d => d < today)]);
    for (const d of [...days].filter(d => d !== live.day && !live.done.has(d))) {
      if (![...teamDates].some(([t, ds]) => ds.has(d) && !(BOX && BOX.finals.has(`${d} ${t}`)))) { live.done.add(d); continue; }
      try {
        const past = espnGames(await getJson(`${SPORT.espn}scoreboard?dates=${espnDate(d)}`, 'ESPN', undefined, 1));
        if (!(await readBoxes(past.filter(g => g.state === 'post' && !live.done.has(g.id) && !savedFinal(g))))) live.done.add(d);
      } catch (e) { /* try again on the next update */ }
    }
    live.at = Date.now();
    live.error = '';
  } catch (e) {
    live.error = e.message || "couldn't reach ESPN";
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
  live.timer = setTimeout(pollLive, on ? liveEvery() : Math.max(Math.min(LIVE_IDLE, ...soon), liveEvery()));
}

// Showing today's games: update now if the last update is due, else carry on with the schedule
function startLive() {
  if (live.busy || !liveWanted()) return;
  if (Date.now() - live.at >= liveEvery()) pollLive();
  else if (!live.timer) scheduleLive();
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearTimeout(live.timer); live.timer = null; } else startLive();
});

// minutes of a game still to be played: all of them before the start, less the game clock's progress (none left in overtime)
function gameMinLeft(g) {
  const { minutes: all, periods: n } = SPORT.game, one = all / n;
  return !g || g.state === 'pre' ? all : g.state === 'post' || g.period > n ? 0 : Math.max(0, all - (g.period - 1) * one - (one - g.clock / 60));
}
const liveGame = (p, d) => live.games.find(g => g.d === d && (g.home === p.team || g.away === p.team)) || null;
const liveOn = (p, d) => { const g = liveGame(p, d); return !!g && g.state === 'in'; };
// a game's state for its row: the clock while it's on, Final once it's over
function liveStatus(p, d) {
  const g = liveGame(p, d);
  if (!g || g.state === 'pre') return '';
  // ESPN's "4:12 - 3rd" as "Q3 4:12" (hockey: "P3 4:12", "2:00 - OT" as "OT 2:00"); Halftime, End of 3rd and the like as they are
  const clock = String(g.detail || '').replace(/^([\d:.]+) - (?:(\d)(?:st|nd|rd|th)|(\d*OT))$/, (m, t, q, ot) => `${q ? `${SPORT.game.tag}${q}` : ot} ${t}`);
  return g.state === 'in' ? `<span class="lv-dot" aria-hidden="true"></span>${esc(clock)}` : 'Final';
}
