"""The NHL data job's own logic, no network: python -m unittest discover -s tests -p "test_*.py" """
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'scripts'))
import update_nhl as N  # noqa: E402

SKATER = {'gameId': 1, 'playerId': 10, 'teamAbbrev': 'VAN', 'gameDate': '2026-11-02', 'skaterFullName': 'Elias Pettersson', 'positionCode': 'C',
          'timeOnIcePerGame': 1200, 'goals': 1, 'assists': 2, 'plusMinus': -1, 'penaltyMinutes': 2, 'shots': 4, 'ppGoals': 1, 'ppPoints': 2,
          'shGoals': 0, 'shPoints': 1, 'gameWinningGoals': 1}
GOALIE = {'gameId': 1, 'playerId': 20, 'teamAbbrev': 'VAN', 'gameDate': '2026-11-02', 'goalieFullName': 'Thatcher Demko', 'timeOnIce': 3900,
          'goals': 0, 'assists': 1, 'penaltyMinutes': 0, 'gamesStarted': 1, 'wins': 0, 'losses': 0, 'otLosses': 1, 'shutouts': 0,
          'goalsAgainst': 3, 'saves': 27, 'shotsAgainst': 30}


def stat(row, key):
    return N.full(row)[N.LINE_KEYS.index(key)]


class Lines(unittest.TestCase):
    def setUp(self):
        games, self.who = N.merge_lines([SKATER], [{'gameId': 1, 'playerId': 10, 'hits': 3, 'blockedShots': 1}],
                                        [{'gameId': 1, 'playerId': 10, 'totalFaceoffWins': 9, 'totalFaceoffLosses': 7}], [GOALIE])
        self.skater, self.goalie = games[1]

    def test_skater_line_takes_all_four_reports(self):
        r = self.skater
        self.assertEqual([r[0], r[1]], [10, 'VAN'])
        self.assertEqual({k: stat(r, k) for k in ('min', 'g', 'a', 'pts', 'pm', 'pim', 'sog', 'hit', 'blk', 'ppg', 'ppa', 'shg', 'sha', 'gwg', 'fow', 'fol')},
                         {'min': 20.0, 'g': 1, 'a': 2, 'pts': 3, 'pm': -1, 'pim': 2, 'sog': 4, 'hit': 3, 'blk': 1, 'ppg': 1, 'ppa': 1, 'shg': 0, 'sha': 1, 'gwg': 1, 'fow': 9, 'fol': 7})

    def test_trailing_zeros_are_trimmed_and_come_back(self):
        self.assertEqual(len(self.skater), 2 + N.LINE_KEYS.index('fol') + 1, 'no goalie columns on a skater')
        self.assertEqual(len(N.full(self.skater)), len(N.LINE_KEYS))
        self.assertEqual(stat(self.skater, 'sa'), 0)

    def test_goalie_line_and_who(self):
        self.assertEqual({k: stat(self.goalie, k) for k in ('min', 'a', 'gs', 'otl', 'ga', 'sv', 'sa')}, {'min': 65.0, 'a': 1, 'gs': 1, 'otl': 1, 'ga': 3, 'sv': 27, 'sa': 30})
        self.assertEqual((self.who[20]['name'], self.who[20]['pos'], self.who[10]['pos']), ('Thatcher Demko', 'G', 'C'))

    def test_a_shootout_loss_is_kept_apart_from_an_overtime_loss(self):
        ot = N.shootout_losses([list(self.goalie)], 'OT')[0]
        self.assertEqual((stat(ot, 'otl'), stat(ot, 'sol')), (1, 0))
        so = N.shootout_losses([list(self.goalie), list(self.skater)], 'SO')
        self.assertEqual((stat(so[0], 'otl'), stat(so[0], 'sol')), (0, 1))
        self.assertEqual(so[1], self.skater, 'a skater untouched')


class Season(unittest.TestCase):
    def test_averages_logs_and_spreads(self):
        line = lambda g: [0, 'x'][:0] + [20.0, g] + [0] * (len(N.LINE_KEYS) - 2)
        cur = N.average([line(1), line(0), line(0)])
        self.assertEqual(cur[:3], [3, 20.0, 0.33])
        self.assertIsNone(N.spreads([line(1)] * 7), 'needs eight games')
        sd = N.spreads([line(1), line(0)] * 4)
        self.assertEqual(sd[N.SD_KEYS.index('g')], 0.53)
        self.assertIsNotNone(N.spreads([line(1)] * 2, N.moments([line(0)] * 6)), 'last season counts')

    def test_mop_up_relief_stays_out_of_the_spreads(self):
        self.assertEqual(N.moments([[5.0] + [1] * (len(N.LINE_KEYS) - 1)])[0], 0)

    def test_box_scores_become_logs_newest_first(self):
        games = {'1': {'d': '2026-11-01', 'home': 'VAN', 'away': 'EDM', 'hs': 2, 'as': 3, 'rows': [[10, 'VAN', 20.0, 1]]},
                 '2': {'d': '2026-11-03', 'home': 'CGY', 'away': 'VAN', 'hs': 1, 'as': 4, 'rows': [[10, 'VAN', 21.0, 2]]}}
        cur, _, logs, _ = N.season_from_boxes(games)
        self.assertEqual(cur[10][:3], [2, 20.5, 1.5])
        self.assertEqual([x[:3] for x in logs[10]], [['2026-11-03', 'VAN @ CGY', 'W'], ['2026-11-01', 'VAN vs. EDM', 'L']])
        self.assertEqual(len(logs[10][0]), len(N.LOG_KEYS))

    def test_weeks_run_monday_to_sunday_from_opening_night(self):
        def game(d):
            return {'id': d, 'gameDate': d, 'homeTeam': {'abbrev': 'A'}, 'awayTeam': {'abbrev': 'B'}, 'gameState': 'FUT'}
        weeks = [g['week'] for g in N.week_games([game('2026-09-29'), game('2026-10-04'), game('2026-10-05')])]
        self.assertEqual(weeks, [1, 1, 2])


class Names(unittest.TestCase):
    table = N.by_name([('Sebastian Aho', 'CAR', 'C', 'car'), ('Sebastian Aho', 'PIT', 'D', 'pit'), ('Elias Pettersson', 'VAN', 'C', 'f'),
                       ('Elias N. Pettersson', 'VAN', 'D', 'd'), ('Joe Veleno', 'NYR', 'C', 'veleno'), ('Connor McDavid', 'EDM', 'C', 'mcdavid')])

    def test_same_name_goes_by_team_and_role(self):
        self.assertEqual(N.find(self.table, 'Sebastian Aho', 'PIT', 'D'), 'pit')
        self.assertEqual(N.find(self.table, 'Elias Pettersson', 'VAN', 'C'), 'f')
        self.assertEqual(N.find(self.table, 'Elias Pettersson', 'VAN', 'D'), 'd', "ESPN's middle initial")

    def test_a_shared_name_is_never_guessed(self):
        self.assertIsNone(N.find(self.table, 'Sebastian Aho', 'BOS', 'C'))

    def test_a_short_first_name_needs_the_team(self):
        self.assertEqual(N.find(self.table, 'Joseph Veleno', 'NYR', 'C'), 'veleno')
        self.assertIsNone(N.find(self.table, 'Joseph Veleno', 'BOS', 'C'))

    def test_a_player_who_moved_is_found_by_name_alone(self):
        self.assertEqual(N.find(self.table, 'Connor McDavid', 'TOR', 'C'), 'mcdavid')


if __name__ == '__main__':
    unittest.main()
