"""Save a Sleeper league the tests run against, and give the fixture players their Sleeper ids (as the daily job does).

Run from the repo root when you want fresh Sleeper fixtures:
    python tests/capture_sleeper_fixtures.py
Managers' names and avatars are replaced (Club 1, Club 2...) and chat fields dropped: the tests don't need them.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import update_data  # noqa: E402  (sleeper_ids, sleeper_id: the daily job's matching)

OUT = os.path.join(ROOT, 'tests', 'fixtures', 'sleeper')
API = 'https://api.sleeper.app/v1/'
LEAGUE = '1369432599025442816'  # a public 12-team points league, Lock-In mode, 2026-27
WEEKS = [1, 2, 3]  # the fixtures' clock is in week 2: the week before, this week and the next


def get(path):
    return update_data.get_json(API + path)


def save(path, data):
    with open(os.path.join(OUT, path.replace('/', '_') + '.json'), 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))


def main():
    os.makedirs(OUT, exist_ok=True)
    lg = get(f'league/{LEAGUE}')
    save(f'league/{LEAGUE}', {k: v for k, v in lg.items() if not k.startswith('last_') and k not in ('avatar', 'group_id', 'company_id')})
    users = get(f'league/{LEAGUE}/users')
    save(f'league/{LEAGUE}/users', [{'user_id': u['user_id'], 'display_name': f'Manager {i + 1}', 'metadata': {'team_name': f'Club {i + 1}'}}
                                    for i, u in enumerate(users)])
    rosters = get(f'league/{LEAGUE}/rosters')
    save(f'league/{LEAGUE}/rosters', [{k: r[k] for k in ('roster_id', 'owner_id', 'players', 'starters', 'reserve', 'taxi', 'settings')} for r in rosters])
    for n in WEEKS:
        save(f'league/{LEAGUE}/matchups/{n}', get(f'league/{LEAGUE}/matchups/{n}'))
    draft = get(f"draft/{lg['draft_id']}")
    save(f"draft/{lg['draft_id']}", {k: draft[k] for k in ('draft_id', 'type', 'status', 'start_time', 'season', 'settings', 'slot_to_roster_id')})
    picks = get(f"draft/{lg['draft_id']}/picks")
    save(f"draft/{lg['draft_id']}/picks", [{k: p[k] for k in ('round', 'pick_no', 'roster_id', 'player_id', 'is_keeper', 'draft_slot')}
                                           | {'metadata': {k: p['metadata'].get(k) for k in ('first_name', 'last_name', 'team')}} for p in picks])
    # the fixture players' Sleeper ids
    path = os.path.join(ROOT, 'tests', 'fixtures', 'players.json')
    with open(path, encoding='utf-8') as f:
        data = json.load(f)
    slp = update_data.sleeper_ids()
    n = 0
    for p in data['players']:
        s = update_data.sleeper_id(slp, p['name'], p['team'])
        if s:
            p['slp'] = s[0]
            if s[3]:
                p['slpPos'] = s[3]
            n += 1
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    print(f'Saved league {LEAGUE}; {n}/{len(data["players"])} fixture players have Sleeper ids')


if __name__ == '__main__':
    main()
