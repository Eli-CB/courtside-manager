"""The NBA data job's own logic, no network: python -m unittest discover -s tests -p "test_*.py" """
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'scripts'))
import update_data as D  # noqa: E402


def row(pid, team, mins=30, pts=20, reb=5, ast=5, stl=1, blk=1):
    """A box score row: id, team, min, pts, reb, ast, stl, blk, 3pm, to, fgm, fga, ftm, fta, then oreb, dreb, 3pa, pf, +/-."""
    return [pid, team, mins, pts, reb, ast, stl, blk, 2, 2, 8, 16, 2, 2, 1, 4, 5, 2, 3]


def fake_get_json(test, answer):
    real = D.get_json
    D.get_json = lambda *a, **kw: answer
    test.addCleanup(setattr, D, 'get_json', real)


class Names(unittest.TestCase):
    def test_accents_suffixes_and_hyphens_go(self):
        self.assertEqual(D.norm_name('Luka Dončić'), 'luka doncic')
        self.assertEqual(D.norm_name('Jaren Jackson Jr.'), 'jaren jackson')
        self.assertEqual(D.norm_name('Shai Gilgeous-Alexander'), 'shai gilgeous alexander')
        self.assertEqual(D.norm_name('Robert Williams III'), 'robert williams')

    def test_a_key_is_initial_and_last_name(self):
        self.assertEqual(D.name_key('Nicolas Claxton'), 'n claxton')
        self.assertEqual(D.name_key('Nic Claxton'), D.name_key('Nicolas Claxton'))
        self.assertEqual(D.name_key('Nene'), 'nene')


class Small(unittest.TestCase):
    def test_season_names(self):
        self.assertEqual(D.season_str(2026), '2026-27')
        self.assertEqual(D.season_str(1999), '1999-00')

    def test_minutes_from_the_clock_format(self):
        self.assertEqual(D.minutes('PT33M15.00S'), 33.25)
        self.assertEqual(D.minutes('PT45S'), 0.75)
        self.assertEqual(D.minutes(''), 0)
        self.assertEqual(D.minutes(None), 0)

    def test_makes_and_attempts(self):
        self.assertEqual(D.split_made('8-18'), (8, 18))
        self.assertEqual(D.split_made(None), (0, 0))

    def test_per_game_drops_needless_decimals(self):
        self.assertEqual(D.per_game(3.0), 3)
        self.assertIsInstance(D.per_game(3.0), int)
        self.assertEqual(D.per_game(3.456), 3.46)

    def test_the_season_index_lists_seasons_only(self):
        with tempfile.TemporaryDirectory() as folder:
            for f in ('2024-25.json', '2024-25-games.json', '2025-26.json', 'index.json'):
                open(os.path.join(folder, f), 'w').close()
            self.assertEqual(D.write_season_index(folder), ['2024-25', '2025-26'])


class Spreads(unittest.TestCase):
    def games(self, n, pts=lambda i: 10 + i):
        # [date, matchup, wl, min, pts .. fta]
        return [['d', 'x', 'W', 30, pts(i)] + [5] * 10 for i in range(n)]

    def test_eight_games_are_needed_and_short_nights_dont_count(self):
        self.assertIsNone(D.stat_sds(self.games(7)))
        self.assertIsNone(D.stat_sds(self.games(7) + [['d', 'x', 'W', 9, 50] + [5] * 10]))
        sds = D.stat_sds(self.games(8))
        self.assertEqual(len(sds), 11)
        self.assertEqual(sds[1], 0, 'a stat that never moves')
        self.assertAlmostEqual(sds[0], 2.45, places=2)

    def test_last_seasons_totals_add_up_like_the_games_themselves(self):
        old, new = self.games(6), self.games(6, lambda i: 16 + i)
        k = len(D.SD_KEYS)
        cols = range(4, 4 + k)
        mom = [len(old)] + [sum(g[i] for g in old) for i in cols] + [sum(g[i] ** 2 for g in old) for i in cols]
        self.assertEqual(D.sds_with(new, mom), D.stat_sds(old + new))


class BoxScores(unittest.TestCase):
    def team(self, tri, score, players):
        return {'teamTricode': tri, 'score': score, 'players': players}

    def player(self, pid, played='1', minutes='PT30M00.00S', **st):
        return {'personId': pid, 'played': played, 'statistics': {'minutes': minutes, **st}}

    def test_only_players_who_played_get_a_row(self):
        fake_get_json(self, {'game': {
            'homeTeam': self.team('BOS', 110, [self.player(1, points=20, reboundsTotal=7), self.player(2, played='0'), self.player(3, minutes='PT00M00.00S')]),
            'awayTeam': self.team('NYK', 100, [self.player(4, points=31)]),
        }})
        g = D.box_score({'id': '1', 'date': '2026-11-01'})
        self.assertEqual([r[0] for r in g['rows']], [1, 4])
        self.assertEqual(g['rows'][0][:5], [1, 'BOS', 30.0, 20, 7])
        self.assertEqual((g['d'], g['home'], g['away'], g['hs'], g['as']), ('2026-11-01', 'BOS', 'NYK', 110, 100))

    def test_espn_gives_the_same_rows(self):
        keys = ['minutes', 'fieldGoalsMade-fieldGoalsAttempted', 'threePointFieldGoalsMade-threePointFieldGoalsAttempted', 'freeThrowsMade-freeThrowsAttempted',
                'offensiveRebounds', 'defensiveRebounds', 'rebounds', 'assists', 'steals', 'blocks', 'turnovers', 'fouls', 'plusMinus', 'points']
        line = ['30', '8-16', '2-5', '2-2', '1', '4', '5', '5', '1', '1', '2', '2', '+3', '20']
        fake_get_json(self, {
            'header': {'competitions': [{'competitors': [{'team': {'abbreviation': 'BOS'}, 'score': '110'}, {'team': {'abbreviation': 'NY'}, 'score': '100'}]}]},
            'boxscore': {'players': [{'team': {'abbreviation': 'BOS'}, 'statistics': [{'keys': keys, 'athletes': [
                {'athlete': {'displayName': 'Jayson Tatum'}, 'stats': line},
                {'athlete': {'displayName': 'Sat Out'}, 'didNotPlay': True, 'stats': []},
                {'athlete': {'displayName': 'Unknown Player'}, 'stats': line},
            ]}]}]},
        })
        g = D.espn_box({'id': 'espn:9', 'date': '2026-11-01', 'home': 'BOS', 'away': 'NYK'}, {'jayson tatum': 7})
        self.assertEqual(g['rows'], [[7, 'BOS', 30.0, 20, 5, 5, 1, 1, 2, 2, 8, 16, 2, 2, 1, 4, 5, 2, 3]])
        self.assertEqual((g['hs'], g['as']), (110, 100), "ESPN's NY is the NBA's NYK")


class Season(unittest.TestCase):
    def game(self, d, rows, hs=110, away_score=100):
        return {'d': d, 'home': 'BOS', 'away': 'NYK', 'hs': hs, 'as': away_score, 'rows': rows}

    def test_the_nba_copy_of_a_game_wins_over_espns(self):
        cur, _, _ = D.season_from_boxes({'espn:1': self.game('2026-11-01', [row(7, 'BOS', pts=99)]), '001': self.game('2026-11-01', [row(7, 'BOS', pts=20)])})
        self.assertEqual(cur[7][0], 1, 'one game')
        self.assertEqual(cur[7][2], 20, 'points')

    def test_averages_game_logs_and_the_last_ten(self):
        games = {str(i): self.game(f'2026-11-{i + 1:02}', [row(7, 'BOS', pts=10 + i)]) for i in range(12)}
        cur, l10, per = D.season_from_boxes(games)
        self.assertEqual(cur[7][0], 12)
        self.assertEqual(cur[7][2], 15.5)
        self.assertEqual(l10[7][0], 10)
        self.assertEqual(l10[7][2], 16.5, 'the newest ten')
        self.assertEqual(per[7][0][0], '2026-11-12', 'newest first')

    def test_a_game_log_says_who_and_how_it_went(self):
        _, _, per = D.season_from_boxes({'1': self.game('2026-11-01', [row(7, 'BOS'), row(8, 'NYK')])})
        self.assertEqual(per[7][0][1:3], ['BOS vs. NYK', 'W'])
        self.assertEqual(per[8][0][1:3], ['NYK @ BOS', 'L'])

    def test_double_and_triple_doubles(self):
        cur, _, _ = D.season_from_boxes({'1': self.game('2026-11-01', [row(1, 'BOS', pts=20, reb=10), row(2, 'BOS', pts=20, reb=10, ast=10), row(3, 'BOS')])})
        self.assertEqual(cur[1][-2:], [1.0, 0.0])
        self.assertEqual(cur[2][-2:], [1.0, 1.0])
        self.assertEqual(cur[3][-2:], [0.0, 0.0])


if __name__ == '__main__':
    unittest.main()
