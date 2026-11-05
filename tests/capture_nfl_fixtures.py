"""Save a real Sleeper football league as test fixtures, cut down and with its team and manager names replaced:

    python scripts/update_nfl.py                                    # data/nfl, first
    python tests/capture_nfl_fixtures.py <league id>

Writes tests/fixtures/sleeper/ (the league, as league 999000000000000001) and tests/fixtures/nfl/ (the rostered players' data).
"""
import gzip
import json
import os
import re
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIX = os.path.join(ROOT, 'tests', 'fixtures')
API = 'https://api.sleeper.app/v1/'
FAKE = '999000000000000001'
LAST_DAY = '2026-10-26'  # the test clock's day: the fixtures stop there
WEEKS = range(1, 9)


def get(path):
    r = urllib.request.urlopen(urllib.request.Request(API + path, headers={'User-Agent': 'Mozilla/5.0', 'Accept-Encoding': 'gzip'}), timeout=40)
    b = r.read()
    return json.loads(gzip.decompress(b) if r.headers.get('content-encoding') == 'gzip' else b)


def put(folder, name, data):
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, name), 'w', encoding='utf-8') as f:
        json.dump(data, f, separators=(',', ':'), ensure_ascii=False)


def main(lid):
    sl = os.path.join(FIX, 'sleeper')
    lg = get(f'league/{lid}')
    did = lg.get('draft_id')
    lg.update(league_id=FAKE, name='Football Fixture League', previous_league_id=None, avatar=None)
    put(sl, f'league_{FAKE}.json', lg)
    rosters = get(f'league/{lid}/rosters')
    users = get(f'league/{lid}/users')
    ids = {u['user_id']: f'{i + 1}' for i, u in enumerate(users)}
    put(sl, f'league_{FAKE}_users.json', [{'user_id': ids[u['user_id']], 'display_name': f'Manager {ids[u["user_id"]]}', 'metadata': {'team_name': f'Team {chr(64 + int(ids[u["user_id"]]))}'}} for u in users])
    for r in rosters:
        r['owner_id'] = ids.get(r.get('owner_id'))
        r['co_owners'] = None
        r['league_id'] = FAKE
    put(sl, f'league_{FAKE}_rosters.json', rosters)
    keep = {p for r in rosters for p in r.get('players') or []}
    for w in WEEKS:
        ms = get(f'league/{lid}/matchups/{w}')
        put(sl, f'league_{FAKE}_matchups_{w}.json', ms)
        keep |= {p for m in ms for p in m.get('players') or []}
    if did:
        put(sl, f'draft_{did}.json', {k: v for k, v in get(f'draft/{did}').items() if k in ('type', 'status', 'start_time', 'settings')})
        put(sl, f'draft_{did}_picks.json', [{k: p.get(k) for k in ('player_id', 'round', 'pick_no', 'roster_id', 'is_keeper', 'metadata')} for p in get(f'draft/{did}/picks')])
    with open(os.path.join(ROOT, 'data', 'nfl', 'players.json'), encoding='utf-8') as f:
        data = json.load(f)
    data['players'] = [p for p in data['players'] if p['slp'] in keep]
    who = {p['id'] for p in data['players']}
    put(os.path.join(FIX, 'nfl'), 'players.json', data)
    with open(os.path.join(ROOT, 'data', 'nfl', 'boxscores.json'), encoding='utf-8') as f:
        box = json.load(f)
    box['games'] = {k: {**g, 'rows': [r for r in g['rows'] if r[0] in who]} for k, g in box['games'].items() if g['d'] <= LAST_DAY}
    put(os.path.join(FIX, 'nfl'), 'boxscores.json', box)
    print(len(data['players']), 'players,', len(box['games']), 'games, draft', did)


if __name__ == '__main__':
    main(sys.argv[1])
