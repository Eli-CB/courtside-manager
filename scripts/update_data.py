"""Pull real NBA data into data/players.json for Courtside Manager.

Sources (all public, no API key):
  - NBA.com data server (cdn.nba.com): schedule, every finished game's box score
    (this season's stats, last 10 games, game logs) and the active player list
  - NBA.com stats API (stats.nba.com): last season's stats and game-to-game
    spreads. It blocks most cloud servers, so when it doesn't answer the last
    saved copy is kept (those numbers don't change during the season).
  - Fantrax (when league.json names a league): your league's position
    eligibility, every team's roster and lineup, matchups, and who's available
  - ESPN: league injury report

Run:  python scripts/update_data.py
"""
import datetime as dt
import json
import os
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'players.json')
BOX_CACHE = os.path.join(ROOT, 'data', 'boxscores.json')
CDN = 'https://cdn.nba.com/static/json/'
LEAGUE_CFG = os.path.join(ROOT, 'league.json')
FX = 'https://www.fantrax.com/fxea/general/'
BASE_POS = ['PG', 'SG', 'SF', 'PF', 'C']

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
    'Referer': 'https://www.nba.com/',
    'Origin': 'https://www.nba.com',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
}

STAT_KEYS = ['gp', 'min', 'pts', 'reb', 'ast', 'stl', 'blk', 'tpm', 'to', 'fgm', 'fga', 'ftm', 'fta']
# per-game standard deviations, used for weekly win odds
SD_KEYS = ['pts', 'reb', 'ast', 'stl', 'blk', 'tpm', 'to', 'fgm', 'fga', 'ftm', 'fta']
LOG_KEYS = ['date', 'matchup', 'wl', 'min', 'pts', 'reb', 'ast', 'stl', 'blk', 'tpm', 'to', 'fgm', 'fga', 'ftm', 'fta', 'type']

# NBA.com lists broad positions; map them to fantasy eligibility
POS_MAP = {
    'G': ['PG', 'SG'], 'F': ['SF', 'PF'], 'C': ['C'],
    'G-F': ['SG', 'SF'], 'F-G': ['SG', 'SF'], 'F-C': ['PF', 'C'], 'C-F': ['PF', 'C'],
}


def log(msg):
    print(msg, flush=True)


def get_json(url, params=None, tries=3, timeout=40):
    if params:
        url += '?' + urllib.parse.urlencode(params)
    if os.environ.get('SKIP_NBA_CDN') and 'cdn.nba.com' in url:  # simulate a server the NBA data server blocks
        raise RuntimeError('skipped by SKIP_NBA_CDN')
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read())
        except Exception as e:  # network hiccups and stats.nba.com throttling
            last = e
            time.sleep(2 + i * 3)
    raise RuntimeError(f'{url[:90]}... failed: {last!r}')


def result_rows(data, idx=0):
    rs = data['resultSets'][idx]
    h = rs['headers']
    return [dict(zip(h, row)) for row in rs['rowSet']]


def season_str(start_year):
    return f'{start_year}-{str(start_year + 1)[-2:]}'


def norm_name(name):
    s = unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode().lower()
    s = re.sub(r'[^a-z ]', '', s.replace('-', ' '))
    s = re.sub(r'\b(jr|sr|ii|iii|iv|v)\b', '', s)
    return ' '.join(s.split())


def dash_stats(season, season_type='Regular Season', last_n=0):
    params = {
        'LeagueID': '00', 'Season': season, 'SeasonType': season_type, 'PerMode': 'PerGame',
        'MeasureType': 'Base', 'LastNGames': last_n, 'Month': 0, 'OpponentTeamID': 0, 'PaceAdjust': 'N',
        'Period': 0, 'PlusMinus': 'N', 'Rank': 'N', 'TeamID': 0, 'TwoWay': 0,
    }
    rows = result_rows(get_json('https://stats.nba.com/stats/leaguedashplayerstats', params))
    out = {}
    for r in rows:
        out[r['PLAYER_ID']] = [
            r['GP'], r['MIN'], r['PTS'], r['REB'], r['AST'], r['STL'], r['BLK'], r['FG3M'], r['TOV'],
            r['FGM'], r['FGA'], r['FTM'], r['FTA'],
        ]
    return out


def game_logs(season, season_type, label):
    """Every game a player appeared in, newest first."""
    params = {
        'LeagueID': '00', 'Season': season, 'SeasonType': season_type, 'PlayerOrTeam': 'P',
        'Counter': 0, 'Sorter': 'DATE', 'Direction': 'DESC',
    }
    rows = result_rows(get_json('https://stats.nba.com/stats/leaguegamelog', params))
    out = {}
    for r in rows:
        out.setdefault(r['PLAYER_ID'], []).append([
            r['GAME_DATE'], r['MATCHUP'], r['WL'] or '', r['MIN'] or 0, r['PTS'] or 0, r['REB'] or 0, r['AST'] or 0,
            r['STL'] or 0, r['BLK'] or 0, r['FG3M'] or 0, r['TOV'] or 0, r['FGM'] or 0, r['FGA'] or 0,
            r['FTM'] or 0, r['FTA'] or 0, label,
        ])
    return out


def stat_sds(rows):
    """Per-game SD of each SD_KEYS stat over games of 10+ minutes (needs 8+ games)."""
    games = [g for g in rows if (g[3] or 0) >= 10]
    if len(games) < 8:
        return None
    out = []
    for idx in range(4, 15):  # pts .. fta columns in LOG_KEYS order
        vals = [g[idx] for g in games]
        mean = sum(vals) / len(vals)
        out.append(round((sum((v - mean) ** 2 for v in vals) / (len(vals) - 1)) ** 0.5, 2))
    return out


def injuries():
    data = get_json('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries')
    out = {}
    for team in data.get('injuries', []):
        for i in team.get('injuries', []):
            name = i.get('athlete', {}).get('displayName')
            if not name:
                continue
            raw = (i.get('status') or '').strip()
            status = 'Out' if raw.lower() in ('out', 'suspension', 'suspended') else 'DTD'
            out[norm_name(name)] = {
                'status': status,
                'label': raw or status,
                'note': i.get('shortComment') or '',
                'date': (i.get('date') or '')[:10],
            }
    return out


def schedule(today):
    data = get_json(CDN + 'staticData/scheduleLeagueV2.json', timeout=60)
    games = []
    for day in data['leagueSchedule']['gameDates']:
        for g in day['games']:
            if not str(g.get('gameId', '')).startswith('002'):  # regular season only
                continue
            d = (g.get('gameDateEst') or '')[:10]
            if not d:
                continue
            games.append({
                'id': str(g['gameId']), 'date': d, 'week': g.get('weekNumber') or 0, 'final': g.get('gameStatus') == 3,
                'home': g['homeTeam']['teamTricode'], 'away': g['awayTeam']['teamTricode'],
            })
    games.sort(key=lambda g: g['date'])
    weeks = {}
    for g in games:
        if g['week']:
            w = weeks.setdefault(g['week'], [g['date'], g['date']])
            w[0], w[1] = min(w[0], g['date']), max(w[1], g['date'])
    today_s = today.isoformat()
    cur = next((n for n in sorted(weeks) if weeks[n][1] >= today_s), None)
    week = None
    teams = {}
    if cur is not None:
        week = {'num': cur, 'start': weeks[cur][0], 'end': weeks[cur][1]}
    for g in games:
        for side, opp, home in ((g['home'], g['away'], True), (g['away'], g['home'], False)):
            t = teams.setdefault(side, {'week': 0, 'left': 0, 'next': None, 'dates': []})
            t['dates'].append(g['date'])
            if cur is not None and g['week'] == cur:
                t['week'] += 1
                if g['date'] >= today_s:
                    t['left'] += 1
            if g['date'] >= today_s and t['next'] is None:
                t['next'] = {'date': g['date'], 'opp': opp, 'home': home}
    return week, teams, [g for g in games if g['final']]


def minutes(iso):
    """'PT33M15.00S' -> 33.25"""
    m = re.match(r'PT(?:(\d+)M)?(?:([\d.]+)S)?', iso or '')
    return (int(m.group(1) or 0) + float(m.group(2) or 0) / 60) if m else 0.0


def box_score(game):
    """One finished game from the NBA data server: a stat row per player who played."""
    g = get_json(CDN + f"liveData/boxscore/boxscore_{game['id']}.json", timeout=30)['game']
    rows = []
    for side in ('homeTeam', 'awayTeam'):
        t = g[side]
        for p in t.get('players', []):
            st = p.get('statistics') or {}
            mins = minutes(st.get('minutes'))
            if str(p.get('played')) != '1' or mins <= 0:
                continue
            rows.append([p['personId'], t['teamTricode'], round(mins, 1), st.get('points', 0), st.get('reboundsTotal', 0),
                         st.get('assists', 0), st.get('steals', 0), st.get('blocks', 0), st.get('threePointersMade', 0),
                         st.get('turnovers', 0), st.get('fieldGoalsMade', 0), st.get('fieldGoalsAttempted', 0),
                         st.get('freeThrowsMade', 0), st.get('freeThrowsAttempted', 0)])
    return {'d': game['date'], 'home': g['homeTeam']['teamTricode'], 'away': g['awayTeam']['teamTricode'],
            'hs': g['homeTeam'].get('score', 0), 'as': g['awayTeam'].get('score', 0), 'rows': rows}


def _try(fn, *a):
    try:
        return fn(*a)
    except Exception:
        return None


def box_scores(season, finals):
    """All finished games this season, cached in data/boxscores.json so each game downloads once."""
    import concurrent.futures
    cache = {'season': season, 'games': {}}
    if os.path.exists(BOX_CACHE):
        with open(BOX_CACHE, encoding='utf-8') as f:
            saved = json.load(f)
        if saved.get('season') == season:
            cache = saved
    todo = [g for g in finals if g['id'] not in cache['games']]
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        for game, res in zip(todo, pool.map(lambda g: _try(box_score, g), todo)):
            if res:
                cache['games'][game['id']] = res
    with open(BOX_CACHE, 'w', encoding='utf-8') as f:
        json.dump(cache, f, separators=(',', ':'))
    log(f'  {len(todo)} new game(s) downloaded')
    return cache['games']


def season_from_boxes(games):
    """Per-game averages (season and last 10) and newest-first game logs from box scores."""
    per = {}
    for g in sorted(games.values(), key=lambda g: g['d'], reverse=True):
        for r in g['rows']:
            pid, team = r[0], r[1]
            home = team == g['home']
            opp = g['away'] if home else g['home']
            mine, theirs = (g['hs'], g['as']) if home else (g['as'], g['hs'])
            wl = 'W' if mine > theirs else 'L' if mine < theirs else ''
            per.setdefault(pid, []).append([g['d'], f"{team} {'vs.' if home else '@'} {opp}", wl, *r[2:], 'REG'])

    def avg(rows):
        n = len(rows)
        cols = [round(sum(x[i] for x in rows) / n, 1) for i in range(3, 15)]  # min .. fta in LOG_KEYS order
        return [n] + cols

    cur = {pid: avg(rows) for pid, rows in per.items()}
    l10 = {pid: avg(rows[:10]) for pid, rows in per.items()}
    return cur, l10, per


def load_previous():
    """Last saved players.json, for anything we can't refresh this run."""
    if not os.path.exists(OUT):
        return {}
    try:
        with open(OUT, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}


def index_from_saved(saved, start_year):
    """Rebuild player-index rows from the saved file when NBA.com won't give us its list."""
    rows = []
    for p in saved.get('players', []):
        first, _, last = p['name'].partition(' ')
        rows.append({
            'PERSON_ID': p['id'], 'PLAYER_FIRST_NAME': first, 'PLAYER_LAST_NAME': last,
            'TEAM_ABBREVIATION': p.get('team', ''), 'TEAM_ID': p.get('tid', 0), 'POSITION': p.get('nbaPos', ''),
            'JERSEY_NUMBER': p.get('jersey', ''), 'FROM_YEAR': str(start_year - (p.get('exp') or 0)), 'TO_YEAR': str(start_year),
        })
    return rows


def fantrax_name(name):
    """Fantrax lists players as "Last, First"."""
    last, _, first = name.partition(', ')
    return f'{first} {last}'.strip() if first else name


def fantrax(league_id, index):
    """League positions, rosters and matchups from Fantrax's public league API."""
    ids = get_json(FX + 'getPlayerIds', {'sport': 'NBA'})
    info = get_json(FX + 'getLeagueInfo', {'leagueId': league_id})
    if info.get('error') or not info.get('teamInfo'):
        msg = (info.get('error') or {}).get('message') or 'no teams returned'
        raise RuntimeError(f'Fantrax league {league_id}: {msg}')
    rosters = get_json(FX + 'getTeamRosters', {'leagueId': league_id})

    # match Fantrax players to NBA.com ids by name (team breaks ties)
    by_name = {}
    for r in index:
        n = norm_name(f"{r['PLAYER_FIRST_NAME']} {r['PLAYER_LAST_NAME']}")
        by_name.setdefault(n, []).append(r)
    fx_to_nba, fx_names = {}, {}
    for fid, v in ids.items():
        fx_names[fid] = fantrax_name(v.get('name', ''))
        hits = by_name.get(norm_name(fx_names[fid]), [])
        if len(hits) > 1:
            hits = [h for h in hits if h['TEAM_ABBREVIATION'] == v.get('team')] or hits[:1]
        if hits:
            fx_to_nba[fid] = hits[0]['PERSON_ID']

    players = {}
    for fid, pi in info.get('playerInfo', {}).items():
        nba = fx_to_nba.get(fid)
        if not nba:
            continue
        elig = set((pi.get('eligiblePos') or '').split(','))
        players[nba] = {'id': fid, 'st': pi.get('status') or '', 'pos': [x for x in BASE_POS if x in elig]}

    league = {
        'id': league_id,
        'name': info.get('leagueName', ''),
        'scoring': (info.get('scoringSystem') or {}).get('type', ''),
        'teams': [{'id': k, 'name': v.get('name', '')} for k, v in info.get('teamInfo', {}).items()],
        'periods': [{'n': p['number'], 'start': p['startDate'][:10], 'end': p['endDate'][:10]} for p in info.get('scoringPeriods', [])],
        # playoff rounds list TBD pairings until they're set
        'matchups': {str(m['period']): [[x['away']['id'], x['home']['id']] for x in m.get('matchupList', [])
                                        if x.get('away', {}).get('id') and x.get('home', {}).get('id')] for m in info.get('matchups', [])},
        'rosterPeriod': rosters.get('period'),
        'rosters': {
            tid: [{'nba': fx_to_nba.get(it['id']), 'name': fx_names.get(it['id'], ''), 'slot': it.get('position', ''), 'st': it.get('status', '')}
                  for it in r.get('rosterItems', [])]
            for tid, r in rosters.get('rosters', {}).items()
        },
    }
    return players, league


def main():
    today = dt.date.today()
    start_year = today.year if today.month >= 9 else today.year - 1
    season, prev_season = season_str(start_year), season_str(start_year - 1)
    log(f'Season {season} (previous {prev_season})')

    saved = load_previous()
    old = {p['id']: p for p in saved.get('players', [])}

    def optional(label, fn, default):
        log(f'- {label}...')
        try:
            v = fn()
            log(f'  ok ({len(v) if hasattr(v, "__len__") else "done"})')
            return v
        except Exception as e:
            log(f'  skipped: {e}')
            return default

    log('- Active players (NBA.com)...')
    stats_ok = True
    try:
        if os.environ.get('SKIP_NBA_STATS'):  # simulate a cloud server that stats.nba.com blocks
            raise RuntimeError('skipped by SKIP_NBA_STATS')
        index = result_rows(get_json('https://stats.nba.com/stats/playerindex', {
            'LeagueID': '00', 'Season': season, 'Historical': 0, 'Active': 1}, tries=1, timeout=25))
    except Exception as e:
        stats_ok = False
        log(f'  stats.nba.com unavailable ({str(e)[:60]}...)')
        try:
            index = [r for r in result_rows(get_json(CDN + 'staticData/playerIndex.json', tries=2, timeout=30))
                     if r.get('ROSTER_STATUS') and r.get('TEAM_ID')]
            log('  using the NBA.com data server player list')
        except Exception as e2:
            if not saved.get('players'):
                raise
            log(f'  data server list unavailable too ({str(e2)[:50]}...); keeping the saved player list')
            index = index_from_saved(saved, start_year)
    log(f'  {len(index)} players')

    sched = optional('Schedule (NBA.com)', lambda: schedule(today), None)
    if sched:
        week, teams, finals = sched
    else:
        log('  keeping the saved schedule')
        week, teams, finals = saved.get('week'), saved.get('teams') or {}, []
    games = optional(f'{season} box scores (NBA.com)', lambda: box_scores(season, finals), {})
    if not finals and os.path.exists(BOX_CACHE):  # no schedule: still use the games we already have
        with open(BOX_CACHE, encoding='utf-8') as f:
            cached = json.load(f)
        if cached.get('season') == season:
            games = cached.get('games', {})
    cur, l10, logs = season_from_boxes(games) if games else ({}, {}, {})
    latest_team = {pid: rows[0][1].split(' ')[0] for pid, rows in logs.items()}
    if stats_ok:
        prev = optional(f'{prev_season} per-game stats', lambda: dash_stats(prev_season), {})
        pre_logs = optional(f'{season} preseason game logs', lambda: game_logs(season, 'Pre Season', 'PRE'), {})
        prev_logs = optional(f'{prev_season} game logs (for variability)', lambda: game_logs(prev_season, 'Regular Season', 'REG'), {})
    else:
        log(f'- {prev_season} stats, preseason logs and spreads: keeping the saved copy')
        prev, pre_logs, prev_logs = {}, {}, {}
    inj = optional('Injury report (ESPN)', injuries, {})
    fx_players, league = {}, None
    league_id = ''
    if os.path.exists(LEAGUE_CFG):
        with open(LEAGUE_CFG, encoding='utf-8') as f:
            league_id = (json.load(f).get('fantraxLeagueId') or '').strip()
    if league_id:
        fx_players, league = optional('Fantrax league', lambda: fantrax(league_id, index), ({}, None))

    players = []
    matched_inj = 0
    for r in index:
        pid = r['PERSON_ID']
        name = f"{r['PLAYER_FIRST_NAME']} {r['PLAYER_LAST_NAME']}".strip()
        team = (latest_team.get(pid) if not stats_ok else None) or r['TEAM_ABBREVIATION'] or ''
        p = {
            'id': pid, 'name': name, 'team': team, 'tid': r['TEAM_ID'] or 0,
            'pos': POS_MAP.get(r['POSITION'] or '', ['SF']), 'nbaPos': r['POSITION'] or '',
            'jersey': r['JERSEY_NUMBER'] or '', 'exp': (int(r['TO_YEAR']) - int(r['FROM_YEAR'])) if r['FROM_YEAR'] and r['TO_YEAR'] else 0,
        }
        fx = fx_players.get(pid)
        if fx:
            if fx['pos']:
                p['pos'] = fx['pos']  # your league's eligibility beats NBA.com's broad G/F/C
            p['fx'] = {'id': fx['id'], 'st': fx['st']}
        was = old.get(pid, {})
        if games:
            if pid in cur: p['cur'] = cur[pid]
            if pid in l10: p['l10'] = l10[pid]
        else:  # box scores unavailable this run: keep what we had
            for k in ('cur', 'l10'):
                if k in was: p[k] = was[k]
        if pid in prev: p['prev'] = prev[pid]
        elif 'prev' in was: p['prev'] = was['prev']
        game_log = logs.get(pid) or pre_logs.get(pid)
        if game_log: p['log'] = game_log[:5]
        elif 'log' in was: p['log'] = was['log']
        if prev_logs:
            sd = stat_sds(logs.get(pid, []) + prev_logs.get(pid, []))
        else:
            sd = was.get('sd') or stat_sds(logs.get(pid, []))
        if sd: p['sd'] = sd
        i = inj.get(norm_name(name))
        if i:
            p['inj'] = i
            matched_inj += 1
        players.append(p)
    log(f'  matched {matched_inj}/{len(inj)} injury entries to players')

    out = {
        'updated': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
        'season': season, 'prevSeason': prev_season,
        'sources': ['NBA.com box scores & schedule', 'NBA.com stats' if stats_ok else 'NBA.com stats (saved copy)', 'ESPN injury report'],
        'statKeys': STAT_KEYS, 'logKeys': LOG_KEYS, 'sdKeys': SD_KEYS,
        'week': week, 'teams': teams, 'players': players, 'league': league,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    tmp = OUT + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    os.replace(tmp, OUT)
    log(f'Wrote {OUT} ({os.path.getsize(OUT) // 1024} KB)')


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
