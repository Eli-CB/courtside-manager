"""Save the Fantrax and NBA data the tests run against, so they don't depend on the network.

Run from the repo root when you want fresh fixtures (the tests' expected values may need updating):
    python tests/capture_fixtures.py
"""
import json
import os
import shutil
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'tests', 'fixtures')
FX = 'https://www.fantrax.com/fxea/general/'
HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'}

# one league per format we support
LEAGUES = {
    'my19c8mwmoipvhon': '9-cat H2H, most categories, weekly lineups',
    'la2a76bkmt6aqekb': 'H2H points, weekly lineups',
    'frapfs43mutrff0g': 'H2H points with double/triple-doubles, daily lineups',
    'czqgnyozmf2tbr93': 'last season of the 9-cat league (graded from its archive)',
}
PAST_PERIODS = {'my19c8mwmoipvhon': [1], 'czqgnyozmf2tbr93': list(range(1, 22))}  # finished lineup periods: season totals; every week of last season (trades vs pickups)


def get(path):
    req = urllib.request.Request(FX + path, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode('utf-8'))


def save(name, data):
    path = os.path.join(OUT, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, separators=(',', ':'))
    print(f'{name}: {os.path.getsize(path) // 1024} KB')


def main():
    save('fantrax/getPlayerIds.json', get('getPlayerIds?sport=NBA'))
    save('fantrax/getAdp.json', get('getAdp?sport=NBA'))
    for lid in LEAGUES:
        for ep in ('getLeagueInfo', 'getTeamRosters', 'getStandings', 'getDraftResults'):
            save(f'fantrax/{lid}/{ep}.json', get(f'{ep}?leagueId={lid}'))
        for n in PAST_PERIODS.get(lid, []):
            save(f'fantrax/{lid}/getTeamRosters-{n}.json', get(f'getTeamRosters?leagueId={lid}&period={n}'))
    for name in ('players.json', 'boxscores.json', 'seasons/2025-26.json'):
        os.makedirs(os.path.dirname(os.path.join(OUT, name)), exist_ok=True)
        shutil.copy(os.path.join(ROOT, 'data', name), os.path.join(OUT, name))
        print(f'{name}: copied from data/')


if __name__ == '__main__':
    main()
