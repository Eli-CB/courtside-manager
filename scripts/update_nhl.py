"""Pull real NHL data into data/nhl/ for League Layer, as scripts/update_data.py does for the NBA.

Sources (all public, no API key):
  - NHL.com (api-web.nhle.com): each club's roster and schedule
  - NHL.com stats (api.nhle.com/stats/rest): every player's line of every regular-season game, asked for by date
    range, so a day of new games takes four requests rather than one or two per game. Box scores don't carry
    faceoff wins, power-play assists or game-winning goals, which fantasy hockey counts.
  - ESPN: injury report, birth dates and ESPN's player ids (the site matches ESPN's live box scores by them)

Writes data/nhl/players.json and data/nhl/boxscores.json, laid out like the NBA's files, and data/nhl/seasons/<season>.json,
once, for last season. One stat row fits both kinds of player: a skater's goalie columns are 0 (and goalies score and
assist too). Regular season only: fantasy hockey seasons end before the NHL's playoffs.

Run:  python scripts/update_nhl.py
"""
import datetime as dt
import json
import os
import sys
import time
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from update_data import log, name_key, norm_name, schedule, season_str  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data', 'nhl')
OUT = os.path.join(DATA, 'players.json')
BOX_CACHE = os.path.join(DATA, 'boxscores.json')
SEASONS = os.path.join(DATA, 'seasons')
WEB = 'https://api-web.nhle.com/v1/'
REST = 'https://api.nhle.com/stats/rest/en/'
ESPN = 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/'
ESPN_TEAMS = {'LA': 'LAK', 'NJ': 'NJD', 'SJ': 'SJS', 'TB': 'TBL'}  # ESPN's codes that aren't the NHL's
HEADERS = {'User-Agent': 'Mozilla/5.0 (compatible; LeagueLayer data job)'}
# NHL.com's birth countries to the flag codes the player card uses
COUNTRY_ISO = {
    'AUS': 'AU', 'AUT': 'AT', 'BLR': 'BY', 'BEL': 'BE', 'BGR': 'BG', 'CAN': 'CA', 'CHE': 'CH', 'CHN': 'CN', 'CZE': 'CZ', 'DEU': 'DE',
    'DNK': 'DK', 'ESP': 'ES', 'EST': 'EE', 'FIN': 'FI', 'FRA': 'FR', 'GBR': 'GB', 'HRV': 'HR', 'HUN': 'HU', 'IRL': 'IE', 'ITA': 'IT',
    'JPN': 'JP', 'KAZ': 'KZ', 'KOR': 'KR', 'LTU': 'LT', 'LVA': 'LV', 'NLD': 'NL', 'NOR': 'NO', 'POL': 'PL', 'ROU': 'RO', 'RUS': 'RU',
    'SRB': 'RS', 'SVK': 'SK', 'SVN': 'SI', 'SWE': 'SE', 'UKR': 'UA', 'USA': 'US',
}
POS = {'C': ['C'], 'L': ['LW'], 'R': ['RW'], 'D': ['D'], 'G': ['G']}

# a game's line: min, then what skaters do, then what goalies do: his own goals, assists and penalty minutes have their
# own columns (leagues score them apart from a skater's), and gt is his hours played, for goals against average
LINE_KEYS = ['min', 'g', 'a', 'pts', 'pm', 'pim', 'sog', 'hit', 'blk', 'ppg', 'ppa', 'shg', 'sha', 'gwg', 'fow', 'fol', 'fot',
             'gs', 'w', 'l', 'otl', 'sol', 'so', 'ga', 'sv', 'sa', 'gt', 'gg', 'ag', 'gpim']
STAT_KEYS = ['gp'] + LINE_KEYS
LOG_KEYS = ['date', 'matchup', 'wl'] + LINE_KEYS + ['type']
# per-game standard deviations, for weekly win odds
SD_KEYS = [k for k in LINE_KEYS if k not in ('min', 'gs')]
SD_MIN = 10  # a game counts for the spreads from this many minutes (a goalie's mop-up relief can stay out)
BOX_VERSION = 2  # goalies' own columns


def get_json(url, params=None, tries=3, timeout=40):
    if params:
        url += '?' + urllib.parse.urlencode(params)
    last = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=timeout) as r:
                return json.loads(r.read())
        except Exception as e:
            last = e
            time.sleep(2 + i * 3)
    raise RuntimeError(f'{url[:90]}... failed: {last!r}')


def report(name, start, end):
    """One stats report's rows, a row per player per game. The API stops at 10,000 rows however many are asked for."""
    exp = f'gameDate>="{start}" and gameDate<="{end}" and gameTypeId=2'
    return get_json(REST + name, {'isGame': 'true', 'start': 0, 'limit': -1, 'cayenneExp': exp}, timeout=60)['data']


def merge_lines(summary, realtime, faceoffs, goalies):
    """Four stats reports to {gameId: [[playerId, team, *LINE_KEYS]]} (rows trimmed of trailing zeros) + who's who."""
    hits = {(r['gameId'], r['playerId']): r for r in realtime}
    draws = {(r['gameId'], r['playerId']): r for r in faceoffs}
    games, who = {}, {}
    for r in summary:
        key = (r['gameId'], r['playerId'])
        x, f = hits.get(key, {}), draws.get(key, {})
        goals, assists = r.get('goals') or 0, r.get('assists') or 0
        line = [round((r.get('timeOnIcePerGame') or 0) / 60, 1), goals, assists, goals + assists, r.get('plusMinus') or 0, r.get('penaltyMinutes') or 0,
                r.get('shots') or 0, x.get('hits') or 0, x.get('blockedShots') or 0, r.get('ppGoals') or 0, (r.get('ppPoints') or 0) - (r.get('ppGoals') or 0),
                r.get('shGoals') or 0, (r.get('shPoints') or 0) - (r.get('shGoals') or 0), r.get('gameWinningGoals') or 0,
                f.get('totalFaceoffWins') or 0, f.get('totalFaceoffLosses') or 0, (f.get('totalFaceoffWins') or 0) + (f.get('totalFaceoffLosses') or 0)]
        games.setdefault(r['gameId'], []).append([r['playerId'], r['teamAbbrev'], *line])
        who[r['playerId']] = {'name': r.get('skaterFullName') or '', 'pos': r.get('positionCode') or '', 'team': r['teamAbbrev'], 'd': r['gameDate']}
    for r in goalies:
        line = [round((r.get('timeOnIce') or 0) / 60, 1)] + [0] * 16 + [
            r.get('gamesStarted') or 0, r.get('wins') or 0, r.get('losses') or 0, r.get('otLosses') or 0, 0, r.get('shutouts') or 0,
            r.get('goalsAgainst') or 0, r.get('saves') or 0, r.get('shotsAgainst') or 0, round((r.get('timeOnIce') or 0) / 3600, 3),
            r.get('goals') or 0, r.get('assists') or 0, r.get('penaltyMinutes') or 0]
        games.setdefault(r['gameId'], []).append([r['playerId'], r['teamAbbrev'], *line])
        who[r['playerId']] = {'name': r.get('goalieFullName') or '', 'pos': 'G', 'team': r['teamAbbrev'], 'd': r['gameDate']}
    for rows in games.values():
        for r in rows:
            while r[-1] == 0:
                r.pop()
    return games, who


def game_lines(start, end):
    return merge_lines(*(report(n, start, end) for n in ('skater/summary', 'skater/realtime', 'skater/faceoffwins', 'goalie/summary')))


def season_lines(start, end):
    """game_lines for a stretch too long for one request: a week at a time."""
    games, who = {}, {}
    d = dt.date.fromisoformat(start)
    last = dt.date.fromisoformat(end)
    while d <= last:
        stop = min(d + dt.timedelta(days=6), last)
        g, w = game_lines(d.isoformat(), stop.isoformat())
        games.update(g)
        who.update(w)
        d = stop + dt.timedelta(days=1)
    return games, who


def teams_list():
    return sorted(t['teamAbbrev']['default'] for t in get_json(WEB + 'standings/now')['standings'])


def club_schedules(season_id, teams):
    """Every regular-season game once, from the 32 clubs' schedules."""
    games = {}
    tids = {}
    for tri in teams:
        for g in get_json(WEB + f'club-schedule-season/{tri}/{season_id}')['games']:
            for side in ('homeTeam', 'awayTeam'):
                tids[g[side]['abbrev']] = g[side]['id']
            if g.get('gameType') == 2:
                games[g['id']] = g
    return sorted(games.values(), key=lambda g: (g['gameDate'], g['id'])), tids


def week_games(games):
    """The shape update_data.schedule() reads. The NHL has no weeks of its own: Monday-Sunday from opening night."""
    if not games:
        return []
    first = dt.date.fromisoformat(games[0]['gameDate'])
    monday = first - dt.timedelta(days=first.weekday())
    return [{'id': g['id'], 'date': g['gameDate'], 'home': g['homeTeam']['abbrev'], 'away': g['awayTeam']['abbrev'],
             'week': (dt.date.fromisoformat(g['gameDate']) - monday).days // 7 + 1, 'final': g.get('gameState') in ('OFF', 'FINAL')} for g in games]


def box_scores(season, games):
    """All finished games, cached in data/nhl/boxscores.json. The last three days are asked for again each run, for
    stat corrections. {gameId: {d, home, away, hs, as, last (REG, OT or SO), rows}}, and who: {id: [name, position]} for
    players who've left the rosters."""
    cache = {'season': season, 'v': BOX_VERSION, 'keys': LINE_KEYS, 'who': {}, 'games': {}}
    if os.path.exists(BOX_CACHE):
        with open(BOX_CACHE, encoding='utf-8') as f:
            saved = json.load(f)
        if saved.get('season') == season and saved.get('v') == BOX_VERSION:
            cache = saved
    finals = [g for g in games if g.get('gameState') in ('OFF', 'FINAL')]
    recent = (dt.date.today() - dt.timedelta(days=3)).isoformat()
    todo = [g for g in finals if str(g['id']) not in cache['games'] or g['gameDate'] >= recent]
    if todo:
        lines, who = season_lines(todo[0]['gameDate'], todo[-1]['gameDate'])
        cache['who'].update({str(pid): [w['name'], w['pos']] for pid, w in who.items()})
        for g in todo:
            rows = lines.get(g['id'])
            if not rows:  # the stats aren't up yet: next run
                continue
            last = (g.get('gameOutcome') or {}).get('lastPeriodType') or 'REG'
            cache['games'][str(g['id'])] = {'d': g['gameDate'], 'home': g['homeTeam']['abbrev'], 'away': g['awayTeam']['abbrev'],
                                            'hs': g['homeTeam'].get('score', 0), 'as': g['awayTeam'].get('score', 0), 'last': last,
                                            'rows': shootout_losses(rows, last)}
    os.makedirs(DATA, exist_ok=True)
    with open(BOX_CACHE, 'w', encoding='utf-8') as f:
        json.dump(cache, f, separators=(',', ':'))
    log(f'  {len(todo)} game(s) asked for (new, or from the last three days)')
    return cache


def shootout_losses(rows, last):
    """The NHL counts a shootout loss as an overtime loss; fantasy leagues can score them apart."""
    if last == 'SO':
        otl, sol = LINE_KEYS.index('otl') + 2, LINE_KEYS.index('sol') + 2
        for r in rows:
            if len(r) > otl and r[otl]:
                r[otl], r[sol] = 0, r[otl]
    return rows


def full(r):
    """A row's line with its trimmed zeros back."""
    return r[2:] + [0] * (len(LINE_KEYS) - len(r) + 2)


def per_game(v):
    v = round(v, 2)
    return int(v) if v == int(v) else v


def average(lines):
    n = len(lines)
    return [n] + [round(sum(x[0] for x in lines) / n, 1)] + [per_game(sum(x[i] for x in lines) / n) for i in range(1, len(LINE_KEYS))]


def season_from_boxes(games):
    """Per-game averages (season and last 10), newest-first game logs and each player's lines from box scores."""
    lines, logs = {}, {}
    for g in sorted(games.values(), key=lambda g: g['d'], reverse=True):
        for r in g['rows']:
            pid, team = r[0], r[1]
            home = team == g['home']
            opp = g['away'] if home else g['home']
            mine, theirs = (g['hs'], g['as']) if home else (g['as'], g['hs'])
            line = full(r)
            lines.setdefault(pid, []).append(line)
            logs.setdefault(pid, []).append([g['d'], f"{team} {'vs.' if home else '@'} {opp}", 'W' if mine > theirs else 'L', *line, 'REG'])
    cur = {pid: average(x) for pid, x in lines.items()}
    l10 = {pid: average(x[:10]) for pid, x in lines.items()}
    return cur, l10, logs, lines


def moments(lines):
    """[games, sum of each SD_KEYS stat..., sum of squares...] over games of SD_MIN+ minutes."""
    use = [x for x in lines if x[0] >= SD_MIN]
    cols = [LINE_KEYS.index(k) for k in SD_KEYS]
    return [len(use)] + [round(sum(x[i] for x in use), 1) for i in cols] + [round(sum(x[i] ** 2 for x in use), 1) for i in cols]


def spreads(lines, mom=None):
    """Per-game SD of each SD_KEYS stat over these lines plus last season's moments (needs 8+ games)."""
    now = moments(lines)
    k = len(SD_KEYS)
    mom = mom or [0] * (1 + 2 * k)
    n = now[0] + mom[0]
    if n < 8:
        return None
    out = []
    for j in range(k):
        total, squares = now[1 + j] + mom[1 + j], now[1 + k + j] + mom[1 + k + j]
        out.append(round((max(squares - n * (total / n) ** 2, 0) / (n - 1)) ** 0.5, 2))
    return out


def archive(season, season_id):
    """Last season's per-game stats and spreads, saved once: past seasons don't change."""
    path = os.path.join(SEASONS, f'{season}.json')
    if os.path.exists(path):
        with open(path, encoding='utf-8') as f:
            saved = json.load(f)
        if saved.get('statKeys') == STAT_KEYS:
            return saved['players']
    log(f'- {season}: saving the season')
    games, _ = club_schedules(season_id, teams_list())
    rows, who = season_lines(games[0]['gameDate'], games[-1]['gameDate'])
    by_game = {g['id']: g for g in games}
    lines = {}
    for gid, rs in rows.items():
        g = by_game.get(gid)
        last = ((g or {}).get('gameOutcome') or {}).get('lastPeriodType') or 'REG'
        for r in shootout_losses(rs, last):
            lines.setdefault(r[0], []).append(full(r))
    players = {str(pid): {'n': who[pid]['name'], 't': who[pid]['team'], 'p': who[pid]['pos'], 's': average(x), 'g': moments(x)} for pid, x in lines.items()}
    os.makedirs(SEASONS, exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump({'season': season, 'statKeys': STAT_KEYS, 'sdKeys': SD_KEYS, 'players': players}, f, separators=(',', ':'), ensure_ascii=False)
    log(f'  {len(players)} players, {os.path.getsize(path) // 1024} KB')
    return players


def role(pos):
    return pos if pos in ('G', 'D') else 'F'


def full_name(name):
    """The name without a middle initial (ESPN's Elias N. Pettersson)."""
    w = norm_name(name).split(' ')
    return ' '.join(x for i, x in enumerate(w) if i == 0 or len(x) > 1)


def find(table, name, team, pos):
    """A player by name, team and role; else initial + last name, team and role (Joe and Joseph); else by name alone
    (he may have moved) when that name is one person. Names aren't enough: two Sebastian Ahos play in the NHL, and two
    Elias Petterssons, both for Vancouver."""
    return table.get((full_name(name), team, role(pos))) or table.get((name_key(full_name(name)), team, role(pos))) or table.get((full_name(name), None, None))


def by_name(rows):
    """[(name, team, position, value)] to the table find() reads."""
    out, seen = {}, {}
    for name, team, pos, v in rows:
        out[(full_name(name), team, role(pos))] = out[(name_key(full_name(name)), team, role(pos))] = v
        seen.setdefault(full_name(name), []).append(v)
    for name, vs in seen.items():
        if len(vs) == 1:
            out[(name, None, None)] = vs[0]
    return out


def injuries():
    rows = []
    for team in get_json(ESPN + 'injuries').get('injuries', []):
        for i in team.get('injuries', []):
            a = i.get('athlete') or {}
            if not a.get('displayName'):
                continue
            raw = (i.get('status') or '').strip()
            tri = (a.get('team') or {}).get('abbreviation') or ''
            team = ESPN_TEAMS.get(tri, tri)
            rows.append((a['displayName'], team, (a.get('position') or {}).get('abbreviation') or '', {
                'team': team, 'status': 'DTD' if raw.lower() in ('day-to-day', 'questionable', 'probable') else 'Out',
                'label': raw or 'Out', 'note': i.get('shortComment') or '', 'date': (i.get('date') or '')[:10],
                'back': ((i.get('details') or {}).get('returnDate') or '')[:10]}))
    return by_name(rows)


def espn_rosters():
    rows = []
    for t in get_json(ESPN + 'teams')['sports'][0]['leagues'][0]['teams']:
        tri = t['team'].get('abbreviation') or ''
        roster = get_json(ESPN + f"teams/{t['team']['id']}/roster")
        groups = roster.get('athletes', [])
        for a in (x for g in groups for x in (g.get('items') or [g])):
            if a.get('displayName'):
                team = ESPN_TEAMS.get(tri, tri)
                rows.append((a['displayName'], team, (a.get('position') or {}).get('abbreviation') or '',
                             {'born': (a.get('dateOfBirth') or '')[:10], 'espn': int(a.get('id') or 0), 'team': team}))
    return by_name(rows)


def bios(season_id):
    """Player id -> first NHL season's start year, flag and birth date, for everyone who's played this season."""
    out = {}
    for kind in ('skater', 'goalie'):
        exp = f'seasonId={season_id} and gameTypeId=2'
        for r in get_json(REST + f'{kind}/bios', {'start': 0, 'limit': -1, 'cayenneExp': exp}, timeout=60)['data']:
            out[r['playerId']] = {'first': (r.get('firstSeasonForGameType') or 0) // 10000, 'nat': COUNTRY_ISO.get(r.get('birthCountryCode') or ''), 'born': r.get('birthDate') or ''}
    return out


def rosters(teams):
    """Everyone on an NHL roster: {id: {...}}"""
    out = {}
    for tri in teams:
        data = get_json(WEB + f'roster/{tri}/current')
        for group in ('forwards', 'defensemen', 'goalies'):
            for r in data.get(group, []):
                out[r['id']] = {'name': f"{r['firstName']['default']} {r['lastName']['default']}".strip(), 'team': tri, 'pos': r.get('positionCode') or '',
                                'jersey': str(r.get('sweaterNumber') or ''), 'born': r.get('birthDate') or '', 'nat': COUNTRY_ISO.get(r.get('birthCountry') or '')}
    return out


def main():
    today = dt.date.today()
    start_year = today.year if today.month >= 9 else today.year - 1
    season, prev_season = season_str(start_year), season_str(start_year - 1)
    season_id = f'{start_year}{start_year + 1}'
    log(f'NHL season {season} (previous {prev_season})')

    saved = {}
    if os.path.exists(OUT):
        with open(OUT, encoding='utf-8') as f:
            saved = json.load(f)
    old = {p['id']: p for p in saved.get('players', [])}

    def optional(label, fn, default):
        log(f'- {label}...')
        try:
            v = fn()
            log(f'  ok ({len(v)})')
            return v
        except Exception as e:
            log(f'  skipped: {e}')
            return default

    log('- Rosters and schedules (NHL.com)...')
    teams = teams_list()
    index = rosters(teams)
    games, tids = club_schedules(season_id, teams)
    week, team_sched, _ = schedule(today, week_games(games))
    log(f'  {len(index)} players, {len(games)} games')
    log('- Box scores...')
    cache = box_scores(season, games)
    boxes = cache['games']
    cur, l10, logs, lines = season_from_boxes(boxes)
    prev = archive(prev_season, f'{start_year - 1}{start_year}')
    bio = optional('Player bios (NHL.com)', lambda: bios(season_id), {})
    inj = optional('Injury report (ESPN)', injuries, None)
    espn = optional('Birth dates and ESPN ids (ESPN rosters)', espn_rosters, {})

    # off the rosters now but still in fantasy: the sent-down and waived (their last team) and the long-term injured
    # (ESPN has them on theirs, on its rosters or injury report). Last season's players with neither have left the league.
    latest = {}
    for g in sorted(boxes.values(), key=lambda g: g['d']):
        for r in g['rows']:
            latest[r[0]] = r[1]

    def off_roster(pid, name, pos, last_team=''):
        if pid not in index:
            team = latest.get(pid) or (find(espn, name, last_team, pos) or find(inj or {}, name, last_team, pos) or {}).get('team')
            if team:
                index[pid] = {'name': name, 'team': team, 'pos': pos, 'jersey': '', 'born': '', 'nat': None}
    for pid, w in cache['who'].items():
        off_roster(int(pid), w[0], w[1])
    for pid, p in prev.items():
        off_roster(int(pid), p['n'], p['p'], p['t'])

    players, matched = [], 0
    for pid, r in sorted(index.items()):
        name, was, b = r['name'], old.get(pid, {}), bio.get(pid, {})
        p = {'id': pid, 'name': name, 'team': r['team'], 'tid': tids.get(r['team'], 0), 'pos': POS.get(r['pos'], ['C']), 'jersey': r['jersey'],
             'exp': start_year - b['first'] if b.get('first') else 1 if str(pid) in prev else 0}
        nat = r['nat'] or b.get('nat') or was.get('nat')
        if nat: p['nat'] = nat
        if pid in cur:
            p['cur'], p['l10'] = cur[pid], l10[pid]
            p['log'] = logs[pid][:5]
        pv = prev.get(str(pid))
        if pv: p['prev'] = pv['s']
        sd = spreads(lines.get(pid, []), pv and pv.get('g'))
        if sd: p['sd'] = sd
        e = find(espn, name, r['team'], r['pos']) or {}
        born = r['born'] or b.get('born') or e.get('born') or was.get('born')
        if born: p['born'] = born
        eid = e.get('espn') or was.get('espn')
        if eid: p['espn'] = eid
        i = find(inj, name, r['team'], r['pos']) if inj is not None else was.get('inj')
        if i:
            p['inj'] = {k: v for k, v in i.items() if k != 'team'}
            matched += 1
        players.append(p)
    log(f'  {matched} players on the injury report')

    out = {
        'sport': 'nhl', 'updated': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
        'season': season, 'prevSeason': prev_season, 'sources': ['NHL.com stats & schedule', 'ESPN injury report'],
        'statKeys': STAT_KEYS, 'logKeys': LOG_KEYS, 'sdKeys': SD_KEYS,
        'week': week, 'teams': team_sched, 'players': players, 'league': None,
    }
    tmp = OUT + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    os.replace(tmp, OUT)
    log(f'Wrote {OUT}: {len(players)} players, {os.path.getsize(OUT) // 1024} KB')


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
