// League Layer: Football: a player's week from Sleeper's projections and the live game.
// The site loads js/*.js in order (see index.html); they share one scope, like one file.
'use strict';

// Weeks are one game each, so everything here is about a player's week, not his games: footballProj what he's projected
// (stats, in Sleeper's names, with their spread), footballNow where his game stands, footballEntry the two together, as
// oneGameSide adds them up. Other files ask for these where football differs (isFootball()).

const footballWeek = d => +(Object.entries(NBA.weeks || {}).find(([, w]) => w[0] <= d && d <= w[1]) || [0])[0];

const projMemo = new Map();

// { m: his projected stats, sd: { fpsd: how far his week lands from them, in points } }. A week the daily file has no
// projections for: his season average. A week it has them, but none for him: nothing (he isn't expected to play).
function footballProj(p, dates) {
  const w = footballWeek(dates[0]), key = `${p.nbaId}|${w}`;
  if (projMemo.has(key)) return projMemo.get(key);
  const raw = nbaById.get(p.nbaId), row = raw && raw.proj && raw.proj[w], m = { gp1: 1 };
  if (row) NBA.projKeys.forEach((k, i) => { if (row[i]) m[k] = row[i]; });
  else if (raw && !(NBA.projWeeks || []).includes(w)) { const s = statObj(raw.cur) || {}; for (const k of SPORT.playerKeys) if (s[k]) m[k] = s[k]; }
  const out = { m, sd: { fpsd: SPORT.projSd[(raw ? raw.pos : p.pos || [])[0]] || 6 } };
  projMemo.set(key, out);
  return out;
}

// His projected points for a week (nothing on a bye or listed Out), in the league's own scoring
const footballPts = (p, dates) => (gamesIn(p, dates) && p.status !== 'Out' ? lineFp(footballProj(p, dates).m) : 0);

// His game in those days now. state: bye, pre (not started), in, post. line: his points so far. left: the share of it left.
function footballNow(p, dates) {
  const d = dates.find(x => playsOn(p, x));
  if (!d) return { state: 'bye' };
  const g = liveGame(p, d), line = actualLine(p, d) || liveLines(d).get(p.nbaId) || null;
  if (gameFinal(p, d) || d < todayIso() || (g && g.state === 'post')) return { d, state: 'post', line };
  return g && g.state === 'in' ? { d, state: 'in', line, left: gameMinLeft(g) / SPORT.game.minutes } : { d, state: 'pre', line: null };
}

// One side's entry for the week: what he's scored, and what share of his projection is still to come
function footballEntry(p, dates) {
  const g = footballProj(p, dates), now = footballNow(p, dates), line = now.line || {};
  const share = now.state === 'pre' ? 1 : now.state === 'in' ? now.left : 0;
  return { p, line, g, share, fp: lineFp(line) + share * lineFp(g.m) };
}

// The best lineup: the most projected points. A player is locked once his game starts: a starter stays, a bench player can't come in.
function bestFootballIds(players, dates) {
  const on = new Set([...state.lineup, ...(state.opp.starters || [])]), stateOf = p => footballNow(p, dates).state;
  const locked = players.filter(p => on.has(p.id) && (stateOf(p) === 'in' || stateOf(p) === 'post'));
  const open = players.filter(p => stateOf(p) === 'pre' && p.status !== 'Out').sort((a, b) => footballPts(b, dates) - footballPts(a, dates));
  return new Set(fillSlots([...locked, ...open], state.slots).filter(Boolean));
}

// Football: this week's points before the morning's box scores have them, as lines on the day each player's game is. Only the
// points: Sleeper keeps them current, in the league's own scoring. A game not started has none yet.
// The week's points as the league's site has them (Sleeper's or ESPN's), asked for again every 30 s
function leagueWeekFresh(L) {
  if (!L) return;
  if (L.source === 'espn') espnWeekFresh(L); else sleeperWeekFresh(L);
}

// A player's ID on the league's site (the league's player list has it; Sleeper's is also in the daily file)
const leagueFid = (L, raw) => (raw.fx && raw.fx.id != null ? String(raw.fx.id) : raw.slp);

function footballLines(L) {
  if (!isFootball() || !L.slpWeek) return;
  const p = L.periods.find(x => x.n === L.slpWeek.n), today = todayIso();
  if (!p) return;
  const days = [];
  for (let d = p.start; d <= p.end; d = addDays(d, 1)) days.push(d);
  for (const raw of NBA.players) {
    const fid = leagueFid(L, raw), pts = fid != null ? L.slpWeek.pts[fid] : null, d = days.find(x => playsOn(raw, x));
    if (pts == null || !d || (BOX && (BOX.day.get(raw.id) || new Map()).has(d))) continue;
    const g = live.games.find(x => x.d === d && (x.home === raw.team || x.away === raw.team));
    if (!(d < today || (g && g.state !== 'pre') || +pts)) continue;
    if (!live.lines.has(d)) live.lines.set(d, new Map());
    live.lines.get(d).set(raw.id, { gp1: 1, min: 0, bonus: +pts });
  }
}

// Football's game in a few words: "@KC Sun", or Bye
function footballGame(p, dates, html) {
  const d = dates.find(x => playsOn(p, x)), T = teamInfo(p.team);
  if (!d) return 'Bye';
  const vs = T && T.opps ? T.opps[T.dates.indexOf(d)] : '';
  return `${vs ? `${vs} ` : ''}${html ? '<span class="fb-day">' : ''}${fmtDay(d).split(',')[0]}${html ? '</span>' : ''}`;
}

// Football's line under a player: his game, and his number for the week: projected, so far, or final
function footballMeta(p, ctx) {
  const now = footballNow(p, ctx.dates), line = now.line || {};
  const on = now.state === 'in' ? `<span class="lv-dot" aria-hidden="true"></span>` : '';
  const [num, tip] = now.state === 'bye' ? ['—', 'No game this week']
    : now.state === 'pre' ? [p.status === 'Out' ? '0' : fmt(footballPts(p, ctx.dates), 1), p.status === 'Out' ? "Listed Out, so he's not projected" : 'Projected points']
    : now.state === 'in' ? [fmtFp(lineFp(line)), `So far, with ${fmt(now.left * lineFp(footballProj(p, ctx.dates).m), 1)} projected in the time left`]
    : [fmtFp(lineFp(line)), now.line ? 'Final points' : "His team played, but he didn't score"];
  return `<div class="bmeta fb"><span class="fb-game">${posTags(p.pos)} ${footballGame(p, ctx.dates, true)}</span><b class="bmeta-g" data-tip="${esc(tip)}">${on}${num}</b></div>`;
}

// Football's Projected: this week's projection of everyone who has one, in the same rows
function projRows() {
  const dates = matchDates(weekStartAt(0));
  return nbaPlayers().map(p => ({ p, v: footballPts(p, dates) })).filter(x => x.v > 0 && footballNow(x.p, dates).state === 'pre')
    .map(({ p, v }) => ({ raw: nbaById.get(p.nbaId), g: 1, tot: {}, z: {}, v, per: true, game: footballGame(p, dates) }));
}

// Football's line in words: what the player did, the rest left out
const footballWords = (s, per = 1) => SPORT.words.filter(([k]) => s[k]).map(([k, w]) => `${fmt(s[k] / per, per > 1 ? 1 : 0)} ${w}`);

// The Dashboard's matchup or Performances (Players) is on screen and shows games from today (Today, This week, or
// not picked yet: each opens on Today once games have started)
// (and football's Matchups this week: its projections follow the games)
const footballWeekTab = () => ui.tab === 'week' && isFootball() && !ui.weekShift;
