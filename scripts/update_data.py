"""Pull real NBA data into data/players.json for Courtside Manager.

Sources (all public, no API key):
  - Fantrax (when league.json names a league): your league's position
    eligibility, every team's roster and lineup, matchups, and who's available
  - NBA.com stats API: active players, per-game stats (this season, last season,
    last 10 games) and recent game logs
  - ESPN: league injury report
  - NBA.com CDN: full season schedule (games per fantasy week, next game)

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
    data = get_json('https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json', timeout=60)
    games = []
    for day in data['leagueSchedule']['gameDates']:
        for g in day['games']:
            if not str(g.get('gameId', '')).startswith('002'):  # regular season only
                continue
            d = (g.get('gameDateEst') or '')[:10]
            if not d:
                continue
            games.append({
                'date': d, 'week': g.get('weekNumber') or 0,
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
    return week, teams


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

    log('- Active players (NBA.com)...')
    index = result_rows(get_json('https://stats.nba.com/stats/playerindex', {
        'LeagueID': '00', 'Season': season, 'Historical': 0, 'Active': 1}))
    log(f'  {len(index)} players')

    def optional(label, fn, default):
        log(f'- {label}...')
        try:
            v = fn()
            log(f'  ok ({len(v) if hasattr(v, "__len__") else "done"})')
            return v
        except Exception as e:
            log(f'  skipped: {e}')
            return default

    cur = optional(f'{season} per-game stats', lambda: dash_stats(season), {})
    prev = optional(f'{prev_season} per-game stats', lambda: dash_stats(prev_season), {})
    l10 = optional('Last 10 games', lambda: dash_stats(season, last_n=10), {}) if cur else {}
    logs = optional(f'{season} game logs', lambda: game_logs(season, 'Regular Season', 'REG'), {})
    pre_logs = optional(f'{season} preseason game logs', lambda: game_logs(season, 'Pre Season', 'PRE'), {})
    prev_logs = optional(f'{prev_season} game logs (for variability)', lambda: game_logs(prev_season, 'Regular Season', 'REG'), {})
    inj = optional('Injury report (ESPN)', injuries, {})
    week, teams = optional('Schedule (NBA.com)', lambda: schedule(today), (None, {}))
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
        team = r['TEAM_ABBREVIATION'] or ''
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
        if pid in cur: p['cur'] = cur[pid]
        if pid in prev: p['prev'] = prev[pid]
        if pid in l10: p['l10'] = l10[pid]
        game_log = logs.get(pid) or pre_logs.get(pid)
        if game_log: p['log'] = game_log[:5]
        sd = stat_sds(logs.get(pid, []) + prev_logs.get(pid, []))
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
        'sources': ['NBA.com stats', 'ESPN injury report', 'NBA.com schedule'],
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
