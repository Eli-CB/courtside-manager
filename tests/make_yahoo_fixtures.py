"""Write tests/fixtures/yahoo/*.json: a small made-up Yahoo NBA league, laid out the way Yahoo's fantasy API lays out its
JSON (lists as objects keyed "0", "1"... with a count; things as arrays of one-key objects). Run it again after changing it:
  python tests/make_yahoo_fixtures.py
Refresh it from a real league once a Yahoo login is set up (the helper's /yahoo/api/<path> answers the same)."""
import json
import os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'yahoo')
GAME, LEAGUE = '466', '777'
LK = f'{GAME}.l.{LEAGUE}'


def ylist(items, key):
    return {**{str(i): {key: it} for i, it in enumerate(items)}, 'count': len(items)}


def team_meta(n, name):
    return [{'team_key': f'{LK}.t.{n}'}, {'team_id': str(n)}, {'name': name}, [], {'url': f'https://basketball.fantasysports.yahoo.com/nba/{LEAGUE}/{n}'}]


def write(path, body):
    name = path.replace(';', '_').replace('=', '_').replace(',', '_').replace('/', '_')
    with open(os.path.join(OUT, name + '.json'), 'w', encoding='utf-8') as f:
        json.dump({'fantasy_content': body}, f, indent=1)


TEAMS = ['Alpha Dogs', 'Beta Ballers', 'Gamma Rays', 'Delta Force']
# (player id, name, Yahoo team abbreviation, eligible positions, slot) per team: PG, SF, Util, BN, IL
ROSTERS = [
    [(1, 'LaMelo Ball', 'MIN', ['PG', 'G'], 'PG'), (2, 'OG Anunoby', 'NY', ['SF', 'PF', 'F'], 'SF'), (3, 'Bam Adebayo', 'MIA', ['PF', 'C', 'F'], 'Util'), (4, 'Steven Adams', 'HOU', ['C'], 'BN'), (5, 'Ace Bailey', 'UTA', ['SG', 'SF'], 'IL')],
    [(6, 'Jose Alvarado', 'NY', ['PG', 'G'], 'PG'), (7, 'Kyle Anderson', 'TOR', ['SF', 'PF'], 'SF'), (8, 'Giannis Antetokounmpo', 'MIA', ['PF', 'C'], 'Util'), (9, 'Jarrett Allen', 'CLE', ['C'], 'BN')],
    [(10, 'Nickeil Alexander-Walker', 'ATL', ['PG', 'SG', 'SF'], 'PG'), (11, 'Deni Avdija', 'POR', ['SG', 'SF', 'PF'], 'SF'), (12, 'Deandre Ayton', 'WAS', ['C'], 'Util'), (13, 'Precious Achiuwa', 'SAC', ['PF', 'C'], 'BN')],
    [(14, 'Grayson Allen', 'CHO', ['PG', 'SG', 'SF'], 'PG'), (15, 'Nate Ament', 'MIL', ['SF'], 'SF'), (16, 'Marvin Bagley III', 'DEN', ['PF', 'C'], 'Util'), (17, 'Tobe Awaka', 'CHI', ['PF'], 'BN')],
]
WEEKS = [(1, '2026-10-20', '2026-10-25'), (2, '2026-10-26', '2026-11-01'), (3, '2026-11-02', '2026-11-08')]
PAIRS = [[(1, 2), (3, 4)], [(1, 3), (2, 4)], [(1, 4), (2, 3)]]
CATS = [(9004003, 'FGM/A', '1'), (5, 'FG%', '0'), (9007006, 'FTM/A', '1'), (8, 'FT%', '0'), (10, '3PTM', '0'), (12, 'PTS', '0'),
        (15, 'REB', '0'), (16, 'AST', '0'), (17, 'ST', '0'), (18, 'BLK', '0'), (19, 'TO', '0')]

league_meta = {'league_key': LK, 'league_id': LEAGUE, 'name': 'Test Hoops', 'url': f'https://basketball.fantasysports.yahoo.com/nba/{LEAGUE}',
               'draft_status': 'postdraft', 'num_teams': 4, 'scoring_type': 'head', 'league_type': 'private', 'current_week': 2,
               'start_week': '1', 'start_date': '2026-10-20', 'end_week': '3', 'end_date': '2026-11-08', 'game_code': 'nba', 'season': '2026'}


def player(pid, name, abbr, elig, slot):
    return [[{'player_key': f'{GAME}.p.{pid}'}, {'player_id': str(pid)}, {'name': {'full': name, 'first': name.split()[0], 'last': name.split()[-1]}},
             {'editorial_team_abbr': abbr}, {'display_position': ','.join(p for p in elig if len(p) <= 2)}, {'eligible_positions': [{'position': p} for p in elig + ['Util']]}],
            {'selected_position': [{'coverage_type': 'date', 'date': '2026-10-26'}, {'position': slot}]}]


def main():
    os.makedirs(OUT, exist_ok=True)
    settings = {
        'draft_type': 'live', 'scoring_type': 'head', 'uses_playoff': '1', 'playoff_start_week': '3', 'num_playoff_teams': '2',
        'roster_positions': [{'roster_position': {'position': p, 'position_type': t, 'count': c}} for p, t, c in
                             [('PG', 'P', 1), ('SF', 'P', 1), ('Util', 'P', 1), ('BN', '', 1), ('IL', '', 1)]],
        'stat_categories': {'stats': [{'stat': {'stat_id': i, 'enabled': '1', 'name': d, 'display_name': d, 'sort_order': '1', 'position_type': 'P',
                                                **({'is_only_display_stat': '1'} if o == '1' else {})}} for i, d, o in CATS]},
    }
    standings = [{'teams': ylist([[team_meta(n, name), {'team_standings': {'rank': str(n), 'outcome_totals': {'wins': str(4 - n), 'losses': str(n - 1), 'ties': 0, 'percentage': ''}, 'games_back': '-' if n == 1 else str(n - 1)}}]
                                  for n, name in enumerate(TEAMS, 1)], 'team')}]
    picks = [{'pick': k + 1, 'round': k // 4 + 1, 'team_key': f'{LK}.t.{k % 4 + 1}', 'player_key': f'{GAME}.p.{ROSTERS[k % 4][k // 4][0]}'} for k in range(12)]
    write(f'league/nba.l.{LEAGUE};out=settings,standings,draftresults',
          {'league': [league_meta, {'settings': [settings]}, {'standings': standings}, {'draft_results': ylist(picks, 'draft_result')}]})
    write(f'league/nba.l.{LEAGUE}/teams/roster', {'league': [league_meta, {'teams': ylist([
        [team_meta(n, name), {'roster': {'coverage_type': 'date', 'date': '2026-10-26', 'is_editable': 0, '0': {'players': ylist([player(*p) for p in ROSTERS[n - 1]], 'player')}}}]
        for n, name in enumerate(TEAMS, 1)], 'team')}]})
    for (w, start, end), pairs in zip(WEEKS, PAIRS):
        matchups = [{'week': str(w), 'week_start': start, 'week_end': end, 'status': 'postevent' if w == 1 else 'midevent' if w == 2 else 'preevent',
                     '0': {'teams': ylist([[team_meta(t, TEAMS[t - 1]), {'team_stats': {'coverage_type': 'week', 'week': str(w)}}] for t in pair], 'team')}} for pair in pairs]
        write(f'league/nba.l.{LEAGUE}/scoreboard;week={w}', {'league': [league_meta, {'scoreboard': {'0': {'matchups': ylist(matchups, 'matchup')}, 'week': str(w)}}]})
    write('users;use_login=1/games;game_keys=nba/leagues', {'users': ylist([[{'guid': 'TESTGUID'}, {'games': ylist([[
        {'game_key': GAME, 'game_id': GAME, 'name': 'Basketball', 'code': 'nba', 'type': 'full', 'season': '2026'},
        {'leagues': ylist([[league_meta]], 'league')}]], 'game')}]], 'user')})
    print('wrote', len(os.listdir(OUT)), 'files to', OUT)


if __name__ == '__main__':
    main()
