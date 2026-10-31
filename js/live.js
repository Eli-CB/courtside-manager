// League Layer: live box scores: today's games on Performances, as they're played.
// The site loads js/*.js in order (see index.html); they share one scope, like one file.
'use strict';

/* ---------- Live box scores ---------- */
// There's no server: the browser asks ESPN itself. While Performances shows today's games and is on screen, about
// once a minute while games are on: the day's scoreboard, and the box score of each game in progress (once more
// when it ends). Earlier days come from the saved box scores; days the daily data job hasn't saved yet (it runs at
// 4 a.m. ET) are asked for once.
const ESPN_SITE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/';
const LIVE_EVERY = 60e3;
const LIVE_IDLE = 30 * 60e3; // nothing on: look again in half an hour (or at the next tip-off)
// games: the scoreboard's; lines: date -> NBA id -> stat line; done: finished games (and days) already read
const live = { day: null, games: [], lines: new Map(), done: new Set(), at: 0, busy: false, error: '', timer: null };

// ESPN lists tip-offs in UTC; 5 hours back always lands on the US game date (as the daily data job does)
const usDay = t => new Date(t - 5 * 36e5).toISOString().slice(0, 10);

function espnGames(sb) {
  return (sb.events || []).map(e => {
    const side = Object.fromEntries(e.competitions[0].competitors.map(t => [t.homeAway, t]));
    const tri = t => ESPN_TEAMS[t.team.id] || t.team.abbreviation;
    const start = new Date(e.date);
    return { id: e.id, d: usDay(start), start, home: tri(side.home), away: tri(side.away), hs: +side.home.score || 0, as: +side.away.score || 0, state: e.status.type.state, detail: e.status.type.shortDetail };
  });
}

// ESPN's players as NBA.com's: by ESPN id (the daily data file has them), else first initial, last name and team
let espnIndex = null;
function espnPlayer(a, team) {
  if (!espnIndex || espnIndex.nba !== NBA) {
    espnIndex = { nba: NBA, ids: new Map(), names: new Map() };
    for (const r of NBA.players) {
      if (r.espn) espnIndex.ids.set(String(r.espn), r);
      const k = `${nameKey(r.name)}|${r.team}`;
      espnIndex.names.set(k, espnIndex.names.has(k) ? null : r);
    }
  }
  return espnIndex.ids.get(String(a.id)) || espnIndex.names.get(`${nameKey(a.displayName)}|${team}`) || null;
}

const madeAtt = v => String(v || '0-0').split('-').map(x => +x || 0);
// One ESPN box score as the lines the saved box scores give: NBA id -> stats (players who've been on the floor)
function espnLines(sm) {
  const out = new Map();
  for (const team of (sm.boxscore && sm.boxscore.players) || []) {
    const tri = ESPN_TEAMS[team.team.id] || team.team.abbreviation;
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
// Performances is on screen and shows games from today (Today, This week, or not picked yet: it opens on Today
// once games have started)
const liveWanted = () => ui.tab === 'dashboard' && !document.hidden && ui.perfRange !== 'day';

async function readBoxes(games) {
  await Promise.all(games.map(async g => {
    const lines = espnLines(await getJson(`${ESPN_SITE}summary?event=${g.id}`, 'ESPN'));
    if (!live.lines.has(g.d)) live.lines.set(g.d, new Map());
    for (const [id, line] of lines) live.lines.get(g.d).set(id, line);
    if (g.state === 'post') live.done.add(g.id);
  }));
}

async function pollLive() {
  clearTimeout(live.timer);
  live.timer = null;
  if (live.busy || !liveWanted()) return;
  live.busy = true;
  try {
    await loadBoxes().catch(() => null); // to know which finished games are saved already
    const sb = await getJson(ESPN_SITE + 'scoreboard', 'ESPN');
    live.games = espnGames(sb);
    live.day = (sb.day && sb.day.date) || (live.games[0] && live.games[0].d) || live.day;
    await readBoxes(live.games.filter(g => g.state !== 'pre' && !live.done.has(g.id) && !savedFinal(g)));
    // yesterday and earlier days of this week that the saved box scores don't have yet: once each (a miss is
    // tried next time)
    const today = todayIso();
    const days = new Set([addDays(today, -1), ...matchDates(mondayOf(today)).filter(d => d < today)]);
    for (const d of [...days].filter(d => d !== live.day && !live.done.has(d))) {
      if (![...teamDates].some(([t, ds]) => ds.has(d) && !(BOX && BOX.finals.has(`${d} ${t}`)))) { live.done.add(d); continue; }
      try {
        const past = espnGames(await getJson(`${ESPN_SITE}scoreboard?dates=${espnDate(d)}`, 'ESPN', undefined, 1));
        await readBoxes(past.filter(g => g.state === 'post' && !live.done.has(g.id) && !savedFinal(g)));
        live.done.add(d);
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
  if (ui.tab === 'dashboard') render();
}

// The next update: in a minute while a game is on (or due to start, or just finished), else at the next tip-off,
// at most half an hour away
function scheduleLive() {
  clearTimeout(live.timer);
  live.timer = null;
  if (!liveWanted()) return;
  const soon = live.games.filter(g => g.state === 'pre').map(g => g.start - Date.now());
  const on = live.error || live.games.some(g => g.state === 'in' || (g.state === 'post' && !live.done.has(g.id) && !savedFinal(g))) || soon.some(ms => ms <= 0);
  live.timer = setTimeout(pollLive, on ? LIVE_EVERY : Math.max(Math.min(LIVE_IDLE, ...soon), LIVE_EVERY));
}

// Showing today's games: update now if the last update is a minute old, else carry on with the schedule
function startLive() {
  if (live.busy || !liveWanted()) return;
  if (Date.now() - live.at >= LIVE_EVERY) pollLive();
  else if (!live.timer) scheduleLive();
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearTimeout(live.timer); live.timer = null; } else startLive();
});

const liveGame = (p, d) => live.games.find(g => g.d === d && (g.home === p.team || g.away === p.team)) || null;
const liveOn = (p, d) => { const g = liveGame(p, d); return !!g && g.state === 'in'; };
// a game's state for its row: the clock while it's on, Final once it's over
function liveStatus(p, d) {
  const g = liveGame(p, d);
  if (!g || g.state === 'pre') return '';
  // ESPN's "4:12 - 3rd" as "Q3 4:12" ("2:00 - OT" as "OT 2:00"); Halftime, End of 3rd and the like as they are
  const clock = String(g.detail || '').replace(/^([\d:.]+) - (?:(\d)(?:st|nd|rd|th)|(\d*OT))$/, (m, t, q, ot) => `${q ? `Q${q}` : ot} ${t}`);
  return g.state === 'in' ? `<span class="lv-dot" aria-hidden="true"></span>${esc(clock)}` : 'Final';
}

// A game still on is measured against an average game's share for the minutes he's played (his minutes over an
// average rostered player's), so a good start reads as good; a finished game against a whole one
function liveZ(line, on) {
  const z = lineZ(line);
  const f = on && BASE.min ? Math.min(line.min / BASE.min[0], 1) : 1;
  if (f < 1) for (const c of scoreCats()) if (!c.pct && !c.fp && BASE[c.key]) z[c.key] += (c.neg ? -1 : 1) * BASE[c.key][0] * (1 - f) / BASE[c.key][1];
  return z;
}
