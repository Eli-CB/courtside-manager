"""Save a real Fantrax hockey league as test fixtures, cut down and with its team names replaced:

    python scripts/update_nhl.py                                    # data/nhl, first
    python tests/capture_nhl_fixtures.py <league id>

Writes tests/fixtures/fantrax/hockeyfixture01/ (the league), tests/fixtures/fantrax/nhl/ (Fantrax's player list) and
tests/fixtures/nhl/ (the rostered players' data), as of the test clock's week: period 5 of the league the fixtures came from.
"""
import json
import os
import sys
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'scripts'))
from update_data import norm_name  # noqa: E402
from update_nhl import goalie_shares  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIX = os.path.join(ROOT, 'tests', 'fixtures')
OUT = os.path.join(FIX, 'fantrax', 'hockeyfixture01')
API = 'https://www.fantrax.com/fxea/general/'
PERIOD = 5  # the test clock (2026-10-26 20:00 ET) is in this week
LAST_DAY = '2026-10-26'


def get(path):
    return json.load(urllib.request.urlopen(urllib.request.Request(API + path, headers={'User-Agent': 'Mozilla/5.0'}), timeout=40))


def put(folder, name, data):
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, name), 'w', encoding='utf-8') as f:
        json.dump(data, f, separators=(',', ':'), ensure_ascii=False)


def main(lid):
    info = get(f'getLeagueInfo?leagueId={lid}')
    now = get(f'getTeamRosters?leagueId={lid}&period={PERIOD}')
    nxt = get(f'getTeamRosters?leagueId={lid}&period={PERIOD + 1}')
    opening = get(f'getTeamRosters?leagueId={lid}&period=1')
    standings = get(f'getStandings?leagueId={lid}')
    draft = get(f'getDraftResults?leagueId={lid}')
    ids = get('getPlayerIds?sport=NHL')
    adp = get('getAdp?sport=NHL')

    # team names only stand in for the real ones; ids stay so the files agree with each other
    teams = {tid: f'Team {chr(65 + i)}' for i, tid in enumerate(sorted(info['teamInfo']))}
    for tid, t in info['teamInfo'].items():
        t['name'] = teams[tid]
    for m in info['matchups']:
        for x in m['matchupList']:
            for side in ('away', 'home'):
                if x.get(side, {}).get('id'):  # a playoff round's teams aren't known yet
                    x[side].update(name=teams[x[side]['id']], shortName=teams[x[side]['id']])
    info['leagueName'] = 'Hockey Fixture League'
    for r in standings:
        r['teamName'] = teams[r['teamId']]
    for R in (now, nxt, opening):
        for tid, r in R['rosters'].items():
            r['teamName'] = teams[tid]

    keep = {it['id'] for R in (now, nxt, opening) for r in R['rosters'].values() for it in r['rosterItems']}
    keep |= {k for k in ids if 'Pettersson' in ids[k]['name'] and ids[k].get('team') == 'VAN'}
    # a few free agents, for the Players tab
    keep |= set([a['id'] for a in adp if a.get('id') in info['playerInfo'] and info['playerInfo'][a['id']].get('status') != 'T'][:25])
    info['playerInfo'] = {k: v for k, v in info['playerInfo'].items() if k in keep}
    put(OUT, 'getLeagueInfo.json', info)
    put(OUT, 'getTeamRosters.json', now)
    put(OUT, f'getTeamRosters-{PERIOD + 1}.json', nxt)
    put(OUT, 'getTeamRosters-1.json', opening)
    put(OUT, 'getStandings.json', standings)
    put(OUT, 'getDraftResults.json', draft)
    put(os.path.join(FIX, 'fantrax', 'nhl'), 'getPlayerIds.json', {k: {x: v[x] for x in ('name', 'team', 'position', 'fantraxId') if x in v} for k, v in ids.items() if k in keep})
    put(os.path.join(FIX, 'fantrax', 'nhl'), 'getAdp.json', [a for a in adp if a.get('id') in keep])

    with open(os.path.join(ROOT, 'data', 'nhl', 'players.json'), encoding='utf-8') as f:
        data = json.load(f)
    last = {norm_name(ids[k]['name'].split(', ')[0]) for k in keep if k in ids}
    data['players'] = [p for p in data['players'] if 'st' in p or any(norm_name(p['name']).endswith(x) for x in last)]  # every goalie: they share a team's starts
    who = {p['id'] for p in data['players']}
    for p in data['players']:
        p.pop('log', None)
    put(os.path.join(FIX, 'nhl'), 'players.json', data)
    with open(os.path.join(ROOT, 'data', 'nhl', 'boxscores.json'), encoding='utf-8') as f:
        box = json.load(f)
    box['who'] = {}
    box['games'] = {gid: {**g, 'rows': [r for r in g['rows'] if r[0] in who]} for gid, g in box['games'].items() if g['d'] <= LAST_DAY}
    put(os.path.join(FIX, 'nhl'), 'boxscores.json', box)
    # who starts in goal, as of the fixtures' day
    with open(os.path.join(ROOT, 'data', 'nhl', 'seasons', f"{data['prevSeason']}.json"), encoding='utf-8') as f:
        prev = json.load(f)['players']
    goalies = {}
    for p in data['players']:
        if 'st' in p:
            goalies.setdefault(p['team'], []).append(p['id'])
    with open(os.path.join(ROOT, 'data', 'nhl', 'boxscores.json'), encoding='utf-8') as f:
        full = {k: g for k, g in json.load(f)['games'].items() if g['d'] <= LAST_DAY}
    shares, last = goalie_shares(full, goalies, prev)
    for p in data['players']:
        if 'st' in p:
            p['st'] = shares[p['id']]
    for t in data['teams'].values():
        t.pop('lg', None)
    for team, x in last.items():
        data['teams'][team]['lg'] = x
    put(os.path.join(FIX, 'nhl'), 'players.json', data)
    print(len(info['playerInfo']), 'league players,', len(data['players']), 'NHL players,', len(box['games']), 'games')


if __name__ == '__main__':
    main(sys.argv[1])
