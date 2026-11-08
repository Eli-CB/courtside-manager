"""Save a real public ESPN football league as a test fixture, its team and manager names replaced:

    python scripts/update_nfl.py                                           # data/nfl, first
    python tests/capture_espn_football_fixtures.py <league id>

Writes tests/fixtures/espn-ffl/999000001/league.json, and adds the league's rostered players missing from
tests/fixtures/nfl/players.json there (their stats in that file's order; no projections, which are for its weeks).
"""
import json
import os
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIX = os.path.join(ROOT, 'tests', 'fixtures')
FAKE = '999000001'
VIEWS = ['mSettings', 'mTeam', 'mRoster', 'mMatchupScore', 'mDraftDetail', 'mStatus']


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=40) as r:
        return json.loads(r.read())


def put(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, separators=(',', ':'), ensure_ascii=False)


def main(lid):
    with open(os.path.join(ROOT, 'data', 'nfl', 'players.json'), encoding='utf-8') as f:
        data = json.load(f)
    season = data['season']
    j = get(f'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{season}/segments/0/leagues/{lid}?' + '&'.join('view=' + v for v in VIEWS))
    # names out: teams become Team A, B...; managers go
    j['id'] = int(FAKE)
    j['members'] = []
    j['settings']['name'] = 'ESPN Football Fixture League'
    for i, t in enumerate(j['teams']):
        letter = chr(65 + i)
        t.update(name=f'Team {letter}', abbrev=f'T{letter}', owners=[], primaryOwner=None, logo='')
        t.pop('location', None)
        t.pop('nickname', None)
        for e in (t.get('roster') or {}).get('entries', []):
            pl = e['playerPoolEntry']['player']
            # each player's real weekly points only: the rest is large and unused
            pl['stats'] = [s for s in pl.get('stats', []) if s.get('statSplitTypeId') == 1 and s.get('statSourceId') == 0]
            for k in [k for k in pl if k not in ('id', 'fullName', 'firstName', 'lastName', 'proTeamId', 'defaultPositionId', 'eligibleSlots', 'injuryStatus', 'injured', 'stats')]:
                pl.pop(k, None)  # (ESPN's outlooks and the like: words that aren't ours to keep)
            e['playerPoolEntry'].pop('ratings', None)
            e.pop('pendingTransactionIds', None)
    put(os.path.join(FIX, 'espn-ffl', FAKE, 'league.json'), j)

    # the league's players into the football fixture's data
    path = os.path.join(FIX, 'nfl', 'players.json')
    with open(path, encoding='utf-8') as f:
        fix = json.load(f)
    have = {p['id'] for p in fix['players']}
    espn = {p['id']: p['espn'] for p in data['players'] if p.get('espn')}
    for p in fix['players']:  # ESPN ids the fixture's players got since it was made
        if p['id'] in espn:
            p['espn'] = espn[p['id']]
    teams = {1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN', 8: 'DET', 9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR',
             15: 'MIA', 16: 'MIN', 17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI', 23: 'PIT', 24: 'LAC', 25: 'SF', 26: 'SEA', 27: 'TB',
             28: 'WAS', 29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU'}
    by_espn = {p.get('espn'): p for p in data['players'] if p.get('espn')}
    defs = {p['team']: p for p in data['players'] if p['pos'] == ['DEF']}
    added = 0
    for t in j['teams']:
        for e in (t.get('roster') or {}).get('entries', []):
            pid = e['playerId']
            p = defs.get(teams.get(-pid - 16000)) if pid < 0 else by_espn.get(pid)
            if not p or p['id'] in have:
                continue
            p = {k: v for k, v in p.items() if k != 'proj'}
            if 'cur' in p:  # in the fixture's stat order
                stats = dict(zip(data['statKeys'], p['cur']))
                cur = [stats.get(k, 0) for k in fix['statKeys']]
                while cur and cur[-1] == 0:
                    cur.pop()
                p['cur'] = cur
            fix['players'].append(p)
            have.add(p['id'])
            added += 1
    put(path, fix)
    print(len(j['teams']), 'teams;', added, 'players added to the football fixture')


if __name__ == '__main__':
    main(sys.argv[1])
