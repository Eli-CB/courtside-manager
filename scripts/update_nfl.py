"""Pull real NFL data into data/nfl/ for League Layer, as scripts/update_data.py does for the NBA.

Sources (all public, no API key):
  - Sleeper: every player (ids, positions, injuries) and each week's stats. Its stats use the same names as a Sleeper
    league's scoring settings, so stats × scoring gives each league's own points exactly (checked on a real league:
    1,187 player-weeks, none off by more than 0.01). Its weekly stats by position aren't a documented API.
    Its weekly projections (Rotowire's, as Sleeper shows them) name their stats the same way, so a projection × a league's
    scoring is that league's projected points. Checked on a real league's 80 team-weeks: 0.7 points off on average, and it
    picked the winner of 25 of 40 matchups. Also not a documented API; if it fails, the site goes by season averages.
  - ESPN: the schedule, scores and bye weeks

Writes data/nfl/players.json and data/nfl/boxscores.json, laid out like the NBA's files. A week runs Tuesday to Monday
night. Sleeper's stats are a player's week; a row of the box scores is one player in his team's game that week.

Run:  python scripts/update_nfl.py
"""
import datetime as dt
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from update_data import fetch_json, log, per_game, schedule  # noqa: E402

DATA = os.path.join(ROOT, 'data', 'nfl')
OUT = os.path.join(DATA, 'players.json')
BOX_CACHE = os.path.join(DATA, 'boxscores.json')
SLEEPER = 'https://api.sleeper.app/v1/'
SLEEPER_STATS = 'https://api.sleeper.com/stats/nfl/'
SLEEPER_PROJ = 'https://api.sleeper.com/projections/nfl/'
ESPN = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/'
ESPN_TEAMS = {'WSH': 'WAS'}  # ESPN's codes that aren't Sleeper's
HEADERS = {'User-Agent': 'Mozilla/5.0 (compatible; LeagueLayer data job)'}
POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']
WEEKS = 18
PROJ_WEEKS = 3  # this week and the next two: Sleeper moves on to a new week a day or so after the site does
BOX_VERSION = 2  # 2: only games a player was in, not ones he was merely listed active for
DEF_IDS = 900000  # a team defense's Sleeper id is its team code; the site's player ids are numbers
# Sleeper's stats that no league scores: ranks, percentages, longest plays, rates
NOT_SCORED = re.compile(r'^(pos_rank|rank_|pts_(std|half_ppr|ppr)$|gms_active$|gp$|gs$|.*_lng$|.*_pct$|.*_ypa$|.*_ypc$|.*_ypt$|.*_yar$|.*_rtg$|.*per_play|.*_air_yd$|'
                        r'opp_|down_|g2g_|rz_|tm_|.*_snp$|.*_rz_|.*_lng_)')
NOT_PROJECTED = re.compile(r'^(adp_|pos_adp_|cmp_pct$)')
INJURED_OUT = {'out', 'ir', 'pup', 'sus', 'na', 'dnr', 'cov'}


def get_json(url, tries=3, timeout=60):
    return fetch_json(url, tries, timeout, HEADERS)


def player_id(sid):
    """Sleeper's id as a number: a team defense's is its team code."""
    return int(sid) if str(sid).isdigit() else None


def espn_tri(t):
    return ESPN_TEAMS.get(t, t)


def def_ids(games):
    """A team defense's number, from its team code."""
    return {t: DEF_IDS + i for i, t in enumerate(sorted({g['home'] for g in games} | {g['away'] for g in games}))}


def week_of(games):
    """{week: [Tuesday, the Monday after]} from the games: a week is Tuesday to Monday around its games."""
    out = {}
    for g in games:
        d = dt.date.fromisoformat(g['date'])
        tue = d - dt.timedelta(days=(d.weekday() - 1) % 7)
        out.setdefault(g['week'], [tue.isoformat(), (tue + dt.timedelta(days=6)).isoformat()])
    return out


def us_day(iso):
    """ESPN lists kickoffs in UTC; 5 hours back lands on the US game date."""
    t = dt.datetime.strptime(iso[:16], '%Y-%m-%dT%H:%M') - dt.timedelta(hours=5)
    return t.date().isoformat()


def schedule_games():
    """Every regular-season game from ESPN, a week at a time."""
    games = []
    for w in range(1, WEEKS + 1):
        data = get_json(ESPN + f'scoreboard?seasontype=2&week={w}')
        for e in data.get('events', []):
            c = e['competitions'][0]
            side = {t['homeAway']: t for t in c['competitors']}
            games.append({'id': str(e['id']), 'date': us_day(e['date']), 'home': espn_tri(side['home']['team']['abbreviation']), 'away': espn_tri(side['away']['team']['abbreviation']),
                          'hs': int(side['home'].get('score') or 0), 'as': int(side['away'].get('score') or 0), 'week': w,
                          'final': e['status']['type'].get('state') == 'post'})
    return sorted(games, key=lambda g: (g['date'], g['id']))


def week_stats(season, week):
    """[{player_id, team, stats}] for players in a game that week. gp says he played: gms_active is on for anyone on an
    active roster, injured starters who sat included, and with it a game he missed would count in his averages."""
    q = '&'.join(f'position[]={p}' for p in POSITIONS)
    rows = get_json(SLEEPER_STATS + f'{season}/{week}?season_type=regular&{q}')
    return [r for r in rows if (r.get('stats') or {}).get('gp')]


def scored(stats):
    return {k: v for k, v in stats.items() if v and isinstance(v, (int, float)) and not NOT_SCORED.match(k)}


def projected(stats):
    """A projection's stats as leagues score them. Kicks differ from real stats: a projection has one 50+ range and only
    misses by distance, where leagues also score 50-59 yards and misses as a whole."""
    st = {k: round(v, 2) for k, v in stats.items() if v and isinstance(v, (int, float)) and not NOT_SCORED.match(k) and not NOT_PROJECTED.match(k)}
    if st.get('fgm_50p'):
        st.setdefault('fgm_50_59', st['fgm_50p'])
    if st.get('fga'):
        st.setdefault('fgmiss', round(st['fga'] - st.get('fgm', 0), 2))
    return {k: v for k, v in st.items() if v}


def projections(season, week, defs):
    """{projKeys, projWeeks, rows: {player id: {week: [stats in projKeys' order]}}}: this week's and the next ones'. Anyone
    without a game that week has no gp in the feed. Rows drop trailing zeros, the most common stats first."""
    q = '&'.join(f'position[]={p}' for p in POSITIONS)
    first = max(week, 1)
    weeks = [w for w in range(first, first + PROJ_WEEKS) if w <= WEEKS]
    by_week = {}
    for w in weeks:
        rows = get_json(SLEEPER_PROJ + f'{season}/{w}?season_type=regular&{q}')
        by_week[w] = {}
        for r in rows:
            pid = defs.get(r['player_id']) or player_id(r['player_id'])
            if pid and (r.get('stats') or {}).get('gp'):
                by_week[w][pid] = projected(r['stats'])
    seen = {}
    for lines in by_week.values():
        for st in lines.values():
            for k in st:
                seen[k] = seen.get(k, 0) + 1
    keys = sorted(seen, key=lambda k: (-seen[k], k))
    out = {}
    for w, lines in by_week.items():
        for pid, st in lines.items():
            row = [per_game(st.get(k, 0)) for k in keys]
            while row and row[-1] == 0:
                row.pop()
            out.setdefault(pid, {})[str(w)] = row
    return {'projKeys': keys, 'projWeeks': weeks, 'rows': out}


def box_scores(season, games):
    """Finished weeks' lines, cached in data/nfl/boxscores.json. The last two weeks are asked for again each run, for stat
    corrections. {espn game id: {d, w, home, away, hs, as, rows: [[player id, team, ...keys]]}}. keys only grow, the most
    common stats first when first seen, and rows drop trailing zeros; min stays 0 (the site's lines all have it)."""
    cache = {'season': season, 'v': BOX_VERSION, 'keys': ['min'], 'games': {}}
    if os.path.exists(BOX_CACHE):
        with open(BOX_CACHE, encoding='utf-8') as f:
            saved = json.load(f)
        if saved.get('season') == season and saved.get('v') == BOX_VERSION:
            cache = saved
    by_team = {(g['week'], t): g for g in games for t in (g['home'], g['away'])}
    defs = def_ids(games)
    have = {g['w'] for g in cache['games'].values()}
    finals = sorted({g['week'] for g in games if g['final']})
    for w in finals:
        if w in have and w < finals[-1] - 1:
            continue
        rows = week_stats(season, w)
        seen = {}
        for r in rows:
            for k in scored(r['stats']):
                seen[k] = seen.get(k, 0) + 1
        cache['keys'] += sorted((k for k in seen if k not in cache['keys']), key=lambda k: -seen[k])
        cache['games'] = {gid: g for gid, g in cache['games'].items() if g['w'] != w}
        for r in rows:
            sid, team = r['player_id'], espn_tri(r.get('team') or '')
            g, pid = by_team.get((w, team)), defs.get(sid) or player_id(sid)
            if not g or not pid:
                continue
            st = scored(r['stats'])
            row = [pid, team] + [st.get(k, 0) for k in cache['keys']]
            while row[-1] == 0 and len(row) > 2:
                row.pop()
            cache['games'].setdefault(g['id'], {'d': g['date'], 'w': w, 'home': g['home'], 'away': g['away'], 'rows': []})['rows'].append(row)
    for g in games:  # scores and dates as they stand
        if g['id'] in cache['games']:
            cache['games'][g['id']].update({'d': g['date'], 'hs': g['hs'], 'as': g['as']})
    with open(BOX_CACHE, 'w', encoding='utf-8') as f:
        json.dump(cache, f, separators=(',', ':'))
    return cache


def injury(p):
    raw = (p.get('injury_status') or '').strip()
    if not raw:
        return None
    note = ' '.join(x for x in (p.get('injury_body_part'), p.get('injury_notes')) if x)
    return {'status': 'Out' if raw.lower() in INJURED_OUT else 'DTD', 'label': raw, 'note': note, 'date': '', 'back': ''}


def main():
    state = get_json(SLEEPER + 'state/nfl')
    season = str(state.get('league_season') or state.get('season'))
    log(f'NFL season {season}, week {state.get("week")}')
    os.makedirs(DATA, exist_ok=True)
    today = dt.date.today()

    log('- Schedule (ESPN)...')
    games = schedule_games()
    week, teams, _ = schedule(today, games)
    for g in sorted(games, key=lambda x: x['date']):  # each team's opponents, in the order of its dates
        teams[g['home']].setdefault('opps', []).append(f"vs {g['away']}")
        teams[g['away']].setdefault('opps', []).append(f"@{g['home']}")
    codes = sorted(teams)
    log(f'  {len(games)} games, {len(codes)} teams')

    log('- Weekly stats (Sleeper)...')
    box = box_scores(season, games)
    keys = box['keys']
    lines = {}
    for g in box['games'].values():
        for r in g['rows']:
            lines.setdefault(r[0], []).append(r[2:] + [0] * (len(keys) - len(r) + 2))
    log(f'  {len(box["games"])} games, {len(keys)} stats')

    def_id = def_ids(games)
    log('- Projections (Sleeper)...')
    try:
        proj = projections(season, int(state.get('week') or 1), def_id)
        log(f'  weeks {proj["projWeeks"]}, {len(proj["rows"])} players, {len(proj["projKeys"])} stats')
    except Exception as e:  # the site falls back on season averages, and the run fails at the end so someone hears of it
        log(f'  failed: {e}')
        proj = {'projKeys': [], 'projWeeks': [], 'rows': {}, 'failed': str(e)}

    log('- Players (Sleeper)...')
    everyone = get_json(SLEEPER + 'players/nfl', timeout=120)
    players = []
    for sid, p in everyone.items():
        pos = p.get('position')
        if pos not in POSITIONS:
            continue
        pid = def_id.get(sid) if pos == 'DEF' else player_id(sid)
        if pid is None or not (pid in lines or (p.get('team') and p.get('active'))):
            continue
        # (a defense goes by its team: "Bengals")
        name = p.get('last_name') if pos == 'DEF' else p.get('full_name') or f"{p.get('first_name', '')} {p.get('last_name', '')}".strip()
        out = {'id': pid, 'name': name, 'team': p.get('team') or '', 'tid': 0, 'pos': [pos], 'slp': sid, 'jersey': str(p.get('number') or ''), 'exp': p.get('years_exp') or 0}
        fantasy = [x for x in (p.get('fantasy_positions') or []) if x in POSITIONS]
        if fantasy:
            out['slpPos'] = fantasy
        if p.get('birth_date'):
            out['born'] = p['birth_date']
        if p.get('espn_id'):
            out['espn'] = int(p['espn_id'])
        inj = injury(p)
        if inj:
            out['inj'] = inj
        if pid in lines:
            x = lines[pid]
            cur = [len(x)] + [per_game(sum(r[i] for r in x) / len(x)) for i in range(len(keys))]
            while cur[-1] == 0:
                cur.pop()
            out['cur'] = cur
        if pid in proj['rows']:
            out['proj'] = proj['rows'][pid]
        players.append(out)

    data = {
        'sport': 'nfl', 'updated': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
        'season': season, 'prevSeason': str(int(season) - 1), 'sources': ['Sleeper stats and projections', 'ESPN schedule'],
        'statKeys': ['gp'] + keys, 'projKeys': proj['projKeys'], 'projWeeks': proj['projWeeks'], 'logKeys': [], 'sdKeys': [],
        'week': week, 'weeks': {str(k): v for k, v in sorted(week_of(games).items())}, 'teams': teams, 'players': players, 'league': None,
    }
    tmp = OUT + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    os.replace(tmp, OUT)
    log(f'Wrote {OUT}: {len(players)} players, {os.path.getsize(OUT) // 1024} KB; box scores {os.path.getsize(BOX_CACHE) // 1024} KB')
    if proj.get('failed'):
        raise RuntimeError(f'written, but with no projections: {proj["failed"]}')


if __name__ == '__main__':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    try:
        main()
    except Exception as e:
        log(f'Update failed: {e}')
        sys.exit(1)
