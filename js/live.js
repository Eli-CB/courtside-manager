// Courtside Manager: Live: this week's matchup as the games are played.
// The site loads js/*.js in order (see index.html); they share one scope, like one file.
'use strict';

/* ---------- Live ---------- */
// There's no server: the browser asks ESPN itself. While the Live tab is open and on screen and one of your or your
// opponent's players has a game on, about once a minute: the day's scoreboard, and the box score of each of those
// games in progress (once more when it ends). Earlier days come from the saved box scores; days of this week the
// daily data job hasn't saved yet (it runs at 4 a.m. ET) are asked for once.
const ESPN_SITE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/';
const LIVE_EVERY = 60e3;
const LIVE_IDLE = 30 * 60e3; // nothing on: look again in half an hour (or at the next tip-off)
// games: the scoreboard's; lines: "date|NBA id" -> stat line; done: finished games (and days) already read
const live = { day: null, games: [], lines: new Map(), done: new Set(), at: 0, busy: false, error: '', timer: null };

// ESPN lists tip-offs in UTC; 5 hours back always lands on the US game date (as the daily data job does)
const usDay = t => new Date(t - 5 * 36e5).toISOString().slice(0, 10);
const liveDay = () => live.day || todayIso();

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

// a player's line for a day: the saved box score, else ESPN's
const lineOn = (nbaId, d) => (BOX && BOX.day.has(nbaId) && BOX.day.get(nbaId).get(d)) || live.lines.get(`${d}|${nbaId}`) || null;
const savedFinal = g => !!(BOX && BOX.finals.has(`${g.d} ${g.home}`));
// the NBA teams of everyone on your roster and your opponent's
const liveTeams = () => new Set([...state.players, ...state.opp.players].map(p => p.team).filter(Boolean));
const liveWanted = (g, teams) => teams.has(g.home) || teams.has(g.away);
const espnDate = d => d.replace(/-/g, '');

async function readBoxes(games) {
  await Promise.all(games.map(async g => {
    for (const [id, line] of espnLines(await getJson(`${ESPN_SITE}summary?event=${g.id}`, 'ESPN'))) live.lines.set(`${g.d}|${id}`, line);
    if (g.state === 'post') live.done.add(g.id);
  }));
}

async function pollLive() {
  clearTimeout(live.timer);
  live.timer = null;
  if (live.busy || ui.tab !== 'live' || document.hidden) return;
  live.busy = true;
  try {
    await loadBoxes().catch(() => null); // to know which finished games are saved already
    const sb = await getJson(ESPN_SITE + 'scoreboard', 'ESPN');
    live.games = espnGames(sb);
    live.day = (sb.day && sb.day.date) || (live.games[0] && live.games[0].d) || live.day;
    const teams = liveTeams();
    await readBoxes(live.games.filter(g => g.state !== 'pre' && liveWanted(g, teams) && !live.done.has(g.id) && !savedFinal(g)));
    // earlier days of this week that the saved box scores don't have yet: once each (a miss is tried next time)
    const day = liveDay();
    for (const d of matchDates(mondayOf(day)).filter(d => d < day && !live.done.has(d))) {
      if (![...teams].some(t => playsOn({ team: t }, d) && !(BOX && BOX.finals.has(`${d} ${t}`)))) { live.done.add(d); continue; }
      try {
        const past = espnGames(await getJson(`${ESPN_SITE}scoreboard?dates=${espnDate(d)}`, 'ESPN', undefined, 1));
        await readBoxes(past.filter(g => g.state === 'post' && liveWanted(g, teams) && !live.done.has(g.id) && !savedFinal(g)));
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
  if (ui.tab === 'live') render();
}

// The next update: in a minute while one of the players' games is on (or due to start), else at the next of
// their tip-offs, at most half an hour away
function scheduleLive() {
  clearTimeout(live.timer);
  live.timer = null;
  if (ui.tab !== 'live' || document.hidden) return;
  const teams = liveTeams();
  const theirs = live.games.filter(g => liveWanted(g, teams));
  const soon = theirs.filter(g => g.state === 'pre').map(g => g.start - Date.now());
  const on = live.error || theirs.some(g => g.state === 'in' || (g.state === 'post' && !live.done.has(g.id) && !savedFinal(g))) || soon.some(ms => ms <= 0);
  live.timer = setTimeout(pollLive, on ? LIVE_EVERY : Math.max(Math.min(LIVE_IDLE, ...soon), LIVE_EVERY));
}

// Opening the tab: update now if the last update is a minute old, else carry on with the schedule
function startLive() {
  if (live.busy) return;
  if (Date.now() - live.at >= LIVE_EVERY) pollLive();
  else if (!live.timer) scheduleLive();
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearTimeout(live.timer); live.timer = null; } else if (ui.tab === 'live') startLive();
});

// One side this week: its starters' games so far added up, and the part played today
function liveSide(players, ids, dates, day) {
  const tot = {}, today = {};
  let games = 0, on = 0, left = 0;
  for (const p of players) {
    if (!ids.has(p.id)) continue;
    const g = liveGame(p, day);
    for (const d of dates) {
      const line = p.nbaId ? lineOn(p.nbaId, d) : null;
      if (line) {
        games++;
        for (const k of COUNT_KEYS) {
          tot[k] = (tot[k] || 0) + (line[k] || 0);
          if (d === day) today[k] = (today[k] || 0) + (line[k] || 0);
        }
      }
      if (p.status === 'Out' || !playsOn(p, d)) continue;
      if (d > day || (d === day && g && g.state === 'pre')) left++;
    }
    if (g && g.state === 'in' && dates.includes(day)) on++;
  }
  return { tot, today, games, on, left };
}

function liveCat(tot, c) {
  if (c.fp) return lineFp(tot);
  if (c.pct) return tot[c.att] ? tot[c.made] / tot[c.att] : null;
  return lineStat(tot, c.key);
}
// who's ahead in a category: 1 you, -1 them, 0 even
function liveLead(a, b, c) {
  if (a == null && b == null) return 0;
  if (a == null || b == null) return a == null ? -1 : 1;
  const d = c.pct ? Math.round((a - b) * 1e4) : Math.round((a - b) * 100);
  return Math.sign(c.neg ? -d : d);
}

const liveGame = (p, day) => live.games.find(g => g.d === day && (g.home === p.team || g.away === p.team)) || null;
function liveGameText(p, g) {
  const home = g.home === p.team;
  const vs = `${home ? 'vs' : '@'} ${home ? g.away : g.home}`;
  if (g.state === 'pre') return `${vs} · ${g.start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  const score = `${home ? g.hs : g.as}–${home ? g.as : g.hs}`;
  return `${g.state === 'in' ? '<span class="lv-dot" aria-hidden="true"></span>' : ''}${vs} · ${score} · ${g.state === 'post' ? 'Final' : esc(g.detail)}`;
}

// A game still on is measured against an average game's share for the minutes he's played (his minutes over an
// average rostered player's), so a good start reads as good; a finished game against a whole one, as on Performances
function liveZ(line, on) {
  const z = lineZ(line);
  const f = on && BASE.min ? Math.min(line.min / BASE.min[0], 1) : 1;
  if (f < 1) for (const c of scoreCats()) if (!c.pct && !c.fp && BASE[c.key]) z[c.key] += (c.neg ? -1 : 1) * BASE[c.key][0] * (1 - f) / BASE[c.key][1];
  return z;
}

// A side's players with a game today: starters first (their stats count), then the bench
function liveTable(side, day, tint) {
  const pts = leaguePoints();
  const cats = scoreCats().filter(c => !c.fp);
  const playing = side.players.filter(p => liveGame(p, day) || playsOn(p, day));
  const off = side.players.filter(p => !playing.includes(p) && side.ids.has(p.id));
  const order = { in: 0, post: 1, pre: 2 };
  const rows = playing.map(p => {
    const g = liveGame(p, day), line = p.nbaId ? lineOn(p.nbaId, day) : null;
    const z = line && !pts ? liveZ(line, g && g.state === 'in') : {};
    return { p, g, line, z, on: side.ids.has(p.id), v: line ? (pts ? lineFp(line) : sum(Object.values(z))) : null };
  }).sort((a, b) => (b.on - a.on) || ((a.g ? order[a.g.state] : 3) - (b.g ? order[b.g.state] : 3)) || ((b.v ?? -99) - (a.v ?? -99)));
  const cell = (r, c) => {
    if (!r.line) return '<td class="sc muted">–</td>';
    const z = r.z;
    if (c.pct) {
      const [m, a] = [r.line[c.made] || 0, r.line[c.att] || 0];
      return `<td class="sc" style="${shade(z[c.key])}" title="${c.label}: ${a ? `${fmt(m / a * 100, 1)}%` : 'no attempts'}">${m}-${a}</td>`;
    }
    return `<td class="sc" style="${pts ? '' : shade(z[c.key])}">${fmt(lineStat(r.line, c.key), 0)}</td>`;
  };
  const table = rows.length ? `<div class="perf-wrap"><table class="perf-table lv-table">
      <thead><tr><th class="pf-name">Player</th><th class="sc">MIN</th>${cats.map(c => `<th class="sc">${c.label}</th>`).join('')}<th class="num pf-v">${pts ? 'FP' : 'Value'}</th></tr></thead>
      <tbody>${rows.map(r => `<tr class="${r.on ? tint : 'lv-bench'}">
        <td class="pf-name"><div class="bplayer">${headshot(r.p, 28)}<div class="bmain">
          <div class="bname"><button class="link-btn pname" data-action="player-detail" data-nba="${r.p.nbaId}">${esc(r.p.name)}</button></div>
          <div class="pmeta">${r.on ? '' : '<span class="badge bench">Bench</span> '}${r.p.status === 'Out' ? '<span class="badge bad">Out</span> ' : ''}${r.g ? liveGameText(r.p, r.g) : 'Plays today'}</div></div></div></td>
        <td class="sc">${r.line ? Math.round(r.line.min) : '–'}</td>${cats.map(c => cell(r, c)).join('')}
        <td class="num pf-v">${r.v == null ? '–' : pts ? fmt(r.v, 1) : signed(r.v, 1)}</td>
      </tr>`).join('')}</tbody>
    </table></div>` : '<p class="muted small" style="margin:0 0 8px">No games today.</p>';
  return `${table}${off.length ? `<p class="muted small" style="margin:0">No game today: ${off.map(p => esc(p.name)).join(', ')}</p>` : ''}`;
}

function viewLive() {
  if (!NBA) return '<div class="card"><div class="empty"><strong>Loading schedule and stats…</strong></div></div>';
  if (!BOX) loadBoxes().then(() => { if (ui.tab === 'live') render(); }).catch(() => {});
  startLive();
  const day = liveDay();
  const start = mondayOf(day);
  const dates = matchDates(start);
  const pts = leaguePoints();
  const cats = scoreCats();
  const me = { name: state.teamName, players: state.players.filter(p => !state.il.includes(p.id)), ids: new Set(state.lineup.filter(Boolean)) };
  const real = fxOpponentFor(start);
  const oppReady = state.opp.players.length > 0 && state.opp.week === start;
  const them = oppReady ? { name: state.opp.name || 'Opponent', players: state.opp.players, ids: oppStarterIds(dates) } : null;
  const A = liveSide(me.players, me.ids, dates, day);
  const B = them ? liveSide(them.players, them.ids, dates, day) : null;

  const updated = live.at ? `updated ${new Date(live.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : live.busy ? 'loading…' : '';
  const head = `<div class="page-head">
      <div><h1>Live ${infoBtn('live')}</h1><p>${fmtDay(dates[0])} – ${fmtDay(dates[dates.length - 1])}${updated ? ` · ${updated}` : ''}${live.error ? ` · <span class="pos-bad">${esc(live.error)}</span>` : ''}</p></div>
      <button type="button" class="btn sm" data-action="live-refresh"${live.busy ? ' disabled' : ''}>↻ Refresh</button>
    </div>`;
  const gamesTxt = S => `<span class="muted">Starter games</span><br>${S.games} played${S.on ? ` · <b>${S.on} on now</b>` : ''} · ${S.left} left`;

  let score;
  if (B) {
    const leads = cats.filter(c => !c.fp).map(c => liveLead(liveCat(A.tot, c), liveCat(B.tot, c), c));
    const [sa, sb] = pts ? [lineFp(A.tot), lineFp(B.tot)] : [leads.filter(x => x > 0).length, leads.filter(x => x < 0).length];
    const ties = leads.filter(x => x === 0).length;
    score = `<div class="card scoreboard">
      <div class="sb-main">
        <div class="sb-side"><div class="sb-label">${esc(me.name)}</div><div class="sb-score">${pts ? fmt(sa, 0) : sa}</div></div>
        <div class="sb-vs">${pts ? 'points' : 'cats ahead'}<br>so far${!pts && ties ? `<br>${ties} even` : ''}</div>
        <div class="sb-side right"><div class="sb-label">${esc(them.name)}</div><div class="sb-score">${pts ? fmt(sb, 0) : sb}</div></div>
      </div>
      <div class="sb-foot lv-foot"><div class="small">${gamesTxt(A)}</div><div class="small lv-right">${gamesTxt(B)}</div></div>
    </div>`;
  } else {
    score = `<div class="card"><div class="empty"><strong>Load your opponent to follow the matchup</strong>${real ? `This week you play <b>${esc(real.name)}</b>.<br><br><button class="btn primary" data-action="live-load-opp">Load ${esc(real.name)} from ${sourceName()}</button>` : 'There is no matchup for you this week.'}</div></div>`;
  }

  // the categories, each with what today added
  const catVal = (S, c) => { const v = liveCat(S.tot, c); return v == null ? '–' : c.pct ? fmtPct(v) : fmt(v, c.fp ? 1 : 0); };
  const todayTxt = (S, c) => {
    if (c.pct) return S.today[c.att] ? `${S.today[c.made] || 0}-${S.today[c.att]}` : '';
    const v = liveCat(S.today, c);
    return v ? `+${fmt(v, c.fp ? 1 : 0)}` : '';
  };
  const catRow = c => {
    const lead = B ? liveLead(liveCat(A.tot, c), liveCat(B.tot, c), c) : 0;
    const td = (S, on, cls) => `<td${lead === on ? ` class="${cls}"` : ''}>${catVal(S, c)}<span class="lv-today">${todayTxt(S, c)}</span></td>`;
    return `<tr><th scope="row">${c.label}</th>${td(A, 1, 'lead-me')}${B ? td(B, -1, 'lead-opp') : ''}</tr>`;
  };
  const catCard = `<div class="card">
      <div class="card-head"><h2>${pts ? 'Stats' : 'Categories'} so far</h2><span class="muted small">starters' games this week · small numbers: today</span></div>
      <div class="table-wrap"><table class="lv-cats">
        <thead><tr><th></th><th>${esc(me.name)}</th>${B ? `<th>${esc(them.name)}</th>` : ''}</tr></thead>
        <tbody>${cats.map(catRow).join('')}</tbody>
      </table></div>
    </div>`;

  const dayTxt = day === todayIso() ? 'today' : fmtDay(day);
  const tonight = (side, tint, label) => `<div class="card">
      <div class="card-head"><h2>${label}</h2><span class="muted small">${dayTxt} · bench stats don't count</span></div>
      ${liveTable(side, day, tint)}
    </div>`;
  return `${head}<div class="week-stack">
    ${score}
    ${catCard}
    ${tonight(me, 'pf-me', 'Your players')}
    ${them ? tonight(them, 'pf-opp', esc(them.name)) : ''}
  </div>`;
}
