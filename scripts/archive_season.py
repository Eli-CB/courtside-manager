"""Save a finished NBA season's player stats to data/seasons/<season>.json, once.

Past seasons never change, so each is fetched a single time from stats.nba.com (which blocks
GitHub's servers, so run this on your own computer) and committed. The site loads a season's
file when you open that past season, to grade its draft and awards; the daily data job reads
last season's file for projections.

    python scripts/archive_season.py 2025-26          # one season
    python scripts/archive_season.py 2016-17 2025-26  # every season in a range

Each player: "n" name, "s" per-game stats in STAT_KEYS order (as in data/players.json), and
"g" game-to-game totals over games of 10+ minutes: [games, sum of each SD_KEYS stat..., sum of
squares...], so the daily job can combine them with this season's games for spreads.

Alongside it, data/seasons/<season>-games.json holds every regular-season game line (day number
from "start", then GAME_KEYS), which the site loads for Awards: what each pickup did in the weeks
he was in a lineup.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from update_data import SD_KEYS, STAT_KEYS, dash_stats, game_logs, get_json, result_rows, season_str  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'seasons')


def names(season):
    params = {'LeagueID': '00', 'Season': season, 'Historical': 1, 'Active': 0}
    rows = result_rows(get_json('https://stats.nba.com/stats/playerindex', params))
    return {r['PERSON_ID']: f"{r['PLAYER_FIRST_NAME']} {r['PLAYER_LAST_NAME']}".strip() for r in rows}


def moments(rows):
    """[games, sums..., sums of squares...] of each SD_KEYS stat over games of 10+ minutes."""
    games = [g for g in rows if (g[3] or 0) >= 10]
    cols = range(4, 4 + len(SD_KEYS))  # pts .. fta in game-log order
    return [len(games)] + [round(sum(g[i] for g in games), 1) for i in cols] + [round(sum(g[i] ** 2 for g in games), 1) for i in cols]


def archive(season):
    path = os.path.join(OUT, f'{season}.json')
    if os.path.exists(path):
        print(f'{season}: already saved')
        return
    stats = dash_stats(season)
    logs = game_logs(season, 'Regular Season', 'REG')
    who = names(season)
    players = {}
    for pid, s in stats.items():
        p = {'n': who.get(pid, ''), 's': s}
        if pid in logs:
            p['g'] = moments(logs[pid])
        players[str(pid)] = p
    os.makedirs(OUT, exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump({'season': season, 'statKeys': STAT_KEYS, 'sdKeys': SD_KEYS, 'players': players}, f, separators=(',', ':'), ensure_ascii=False)
    print(f'{season}: {len(players)} players, {os.path.getsize(path) // 1024} KB')


GAME_KEYS = ['min', 'pts', 'reb', 'ast', 'stl', 'blk', 'tpm', 'to', 'fgm', 'fga', 'ftm', 'fta', 'oreb', 'dreb', 'tpa', 'pf', 'pm']
GAME_COLS = ['MIN', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'FG3M', 'TOV', 'FGM', 'FGA', 'FTM', 'FTA', 'OREB', 'DREB', 'FG3A', 'PF', 'PLUS_MINUS']


def archive_games(season):
    from datetime import date
    path = os.path.join(OUT, f'{season}-games.json')
    if os.path.exists(path):
        print(f'{season} games: already saved')
        return
    params = {'LeagueID': '00', 'Season': season, 'SeasonType': 'Regular Season', 'PlayerOrTeam': 'P',
              'Counter': 0, 'Sorter': 'DATE', 'Direction': 'ASC'}
    rows = result_rows(get_json('https://stats.nba.com/stats/leaguegamelog', params, timeout=90))
    start = min(r['GAME_DATE'] for r in rows)
    d0 = date.fromisoformat(start)
    players = {}
    for r in rows:
        day = (date.fromisoformat(r['GAME_DATE']) - d0).days
        line = [round(r[c] or 0, 1) if c == 'MIN' else int(r[c] or 0) for c in GAME_COLS]
        players.setdefault(str(r['PLAYER_ID']), []).append([day] + line)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump({'season': season, 'start': start, 'keys': GAME_KEYS, 'players': players}, f, separators=(',', ':'))
    print(f'{season} games: {len(rows)} lines, {os.path.getsize(path) // 1024} KB')


def write_index():
    seasons = sorted(f[:-5] for f in os.listdir(OUT) if f.endswith('.json') and f != 'index.json' and not f.endswith('-games.json'))
    with open(os.path.join(OUT, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump(seasons, f)
    print('index:', ', '.join(seasons))


def main():
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    first, last = int(args[0][:4]), int(args[-1][:4])
    for y in range(first, last + 1):
        archive(season_str(y))
        archive_games(season_str(y))
    write_index()


if __name__ == '__main__':
    main()
