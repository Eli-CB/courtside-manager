"""The NHL data job's own logic, no network: python -m unittest discover -s tests -p "test_*.py" """
import datetime as dt
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

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
        self.assertEqual({k: stat(r, k) for k in ('min', 'g', 'a', 'pts', 'pm', 'pim', 'sog', 'hit', 'blk', 'ppg', 'ppa', 'shg', 'sha', 'gwg', 'fow', 'fol', 'fot')},
                         {'min': 20.0, 'g': 1, 'a': 2, 'pts': 3, 'pm': -1, 'pim': 2, 'sog': 4, 'hit': 3, 'blk': 1, 'ppg': 1, 'ppa': 1, 'shg': 0, 'sha': 1, 'gwg': 1, 'fow': 9, 'fol': 7, 'fot': 16})

    def test_trailing_zeros_are_trimmed_and_come_back(self):
        self.assertEqual(len(self.skater), 2 + N.LINE_KEYS.index('fot') + 1, 'no goalie columns on a skater')
        self.assertEqual(len(N.full(self.skater)), len(N.LINE_KEYS))
        self.assertEqual(stat(self.skater, 'sa'), 0)

    def test_goalie_line_and_who(self):
        self.assertEqual({k: stat(self.goalie, k) for k in ('min', 'gs', 'otl', 'ga', 'sv', 'sa', 'gt', 'ag')}, {'min': 65.0, 'gs': 1, 'otl': 1, 'ga': 3, 'sv': 27, 'sa': 30, 'gt': 1.083, 'ag': 1})
        self.assertEqual((stat(self.goalie, 'a'), stat(self.goalie, 'pts')), (0, 0), "a goalie's assist isn't a skater's")
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


def side(gid, team, skaters, goalie=True):
    """A team's rows of a game: skaters of 15 minutes, and its goalie (his hours played make him one)."""
    rows = [[gid * 100 + i + (50 if team == 'B' else 0), team, 15.0] for i in range(skaters)]
    if goalie:
        rows.append([gid * 100 + 99 + (50 if team == 'B' else 0), team, 60.0] + [0] * (N.LINE_KEYS.index('gt') - 1) + [1.0])
    return rows


def scheduled(gid, d):
    return {'id': gid, 'gameDate': d, 'gameState': 'OFF', 'homeTeam': {'abbrev': 'A', 'score': 3}, 'awayTeam': {'abbrev': 'B', 'score': 2}}


class Fetching(unittest.TestCase):
    """NHL.com's stats API sends 100 rows a request since Nov 17, 2026; the job cached those as whole days."""

    def test_a_report_comes_a_page_at_a_time_sorted(self):
        everyone = [{'gameId': 1 + i // 40, 'playerId': i} for i in range(250)]
        asked = []

        def api(url, params, timeout):
            asked.append(params)
            self.assertIn('playerId', params['sort'], 'pages need a sort, or they repeat rows and skip others')
            return {'data': everyone[params['start']:params['start'] + min(params['limit'], 100)], 'total': len(everyone)}
        with mock.patch.object(N, 'get_json', api):
            rows = N.report('skater/summary', '2026-11-17', '2026-11-19')
        self.assertEqual(rows, everyone)
        self.assertEqual([p['start'] for p in asked], [0, 100, 200])

    def test_pages_that_repeat_rows_fail_the_job(self):
        everyone = [{'gameId': 1, 'playerId': i} for i in range(150)]
        with mock.patch.object(N, 'get_json', lambda url, params, timeout: {'data': everyone[:100], 'total': 150}):
            with self.assertRaises(RuntimeError):
                N.report('skater/summary', '2026-11-17', '2026-11-19')

    def test_a_game_is_complete_with_both_teams_skaters_and_goalies(self):
        game = lambda rows: {'home': 'A', 'away': 'B', 'rows': rows}
        self.assertTrue(N.complete(game(side(1, 'A', 18) + side(1, 'B', 15))))
        self.assertFalse(N.complete(game(side(1, 'A', 18) + side(1, 'B', 14))), 'a team short of skaters')
        self.assertFalse(N.complete(game(side(1, 'A', 18) + side(1, 'B', 18, goalie=False))), 'no goalie')
        self.assertFalse(N.complete(game(side(1, 'A', 1) + side(1, 'B', 1))), "Nov 19, 2026's DAL @ VGK: two skaters and the goalies")

    def test_spans_keep_an_old_game_from_bringing_every_game_since(self):
        self.assertEqual(N.spans(['2026-10-20', '2026-11-17', '2026-11-18', '2026-11-19']), [['2026-10-20', '2026-10-20'], ['2026-11-17', '2026-11-19']])

    def test_an_incomplete_day_is_fetched_again(self):
        whole = lambda gid: side(gid, 'A', 18) + side(gid, 'B', 18)
        # cached: Nov 12 whole, Nov 17 cut short (as the 100-row answers left it); a run on Nov 25, past the three days
        cache = {'season': '2026-27', 'v': N.BOX_VERSION, 'keys': N.LINE_KEYS, 'who': {}, 'games': {
            '12': {'d': '2026-11-12', 'home': 'A', 'away': 'B', 'hs': 3, 'as': 2, 'last': 'REG', 'rows': whole(12)},
            '17': {'d': '2026-11-17', 'home': 'A', 'away': 'B', 'hs': 3, 'as': 2, 'last': 'REG', 'rows': side(17, 'A', 2) + side(17, 'B', 1)}}}
        asked = []

        def season_lines(start, end):
            asked.append((start, end))
            return {12: whole(12)[:5], 17: whole(17)}, {}
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, 'boxscores.json')
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(cache, f)
            with mock.patch.object(N, 'BOX_CACHE', path), mock.patch.object(N, 'DATA', tmp), mock.patch.object(N, 'season_lines', season_lines), \
                    mock.patch.object(N, 'log', lambda *a: None):
                out = N.box_scores('2026-27', [scheduled(12, '2026-11-12'), scheduled(17, '2026-11-17')], dt.date(2026, 11, 25))
            with open(path, encoding='utf-8') as f:
                saved = json.load(f)
        self.assertEqual(asked, [('2026-11-17', '2026-11-17')], 'only the short day, not the whole one before it')
        self.assertEqual(len(out['games']['17']['rows']), 38)
        self.assertTrue(N.complete(saved['games']['17']), 'saved whole')
        self.assertEqual(len(saved['games']['12']['rows']), 38, 'Nov 12 untouched')

    def test_a_whole_game_is_not_swapped_for_part_of_one(self):
        whole = side(17, 'A', 18) + side(17, 'B', 18)
        cache = {'season': '2026-27', 'v': N.BOX_VERSION, 'keys': N.LINE_KEYS, 'who': {}, 'games': {
            '17': {'d': '2026-11-17', 'home': 'A', 'away': 'B', 'hs': 3, 'as': 2, 'last': 'REG', 'rows': whole}}}
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, 'boxscores.json')
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(cache, f)
            with mock.patch.object(N, 'BOX_CACHE', path), mock.patch.object(N, 'DATA', tmp), \
                    mock.patch.object(N, 'season_lines', lambda s, e: ({17: whole[:4]}, {})), mock.patch.object(N, 'log', lambda *a: None):
                out = N.box_scores('2026-27', [scheduled(17, '2026-11-17')], dt.date(2026, 11, 18))  # in the three days: asked again
        self.assertEqual(len(out['games']['17']['rows']), 38)


class Goalies(unittest.TestCase):
    gs = N.LINE_KEYS.index('gs') + 2

    def game(self, d, *starters):
        return {'d': d, 'home': 'A', 'away': 'B', 'rows': [[pid, team, 60.0] + [0] * (self.gs - 3) + [1] for pid, team in starters]}

    def test_recent_starts_count_most_and_last_season_only_a_little(self):
        boxes = {str(i): self.game(f'2026-10-0{i}', (1 if i < 5 else 2, 'A')) for i in range(1, 10)}
        prev = {str(i): {'s': [50 if i == 1 else 10] + [0] * (N.STAT_KEYS.index('gs') - 1) + [1]} for i in (1, 2)}
        shares, last = N.goalie_shares(boxes, {'A': [1, 2]}, prev)
        self.assertGreater(shares[2], shares[1], 'his last five starts outweigh four before them and last season')
        self.assertEqual(round(shares[1] + shares[2], 2), 1)
        self.assertEqual(last['A'], [2, '2026-10-09'])

    def test_before_any_games_last_season_decides_and_a_goalie_new_to_the_league_gets_a_share(self):
        prev = {'1': {'s': [40] + [0] * (N.STAT_KEYS.index('gs') - 1) + [1]}}
        shares, last = N.goalie_shares({}, {'A': [1, 3]}, prev)
        self.assertEqual(shares, {1: 1.0, 3: 0.0})
        self.assertEqual(N.goalie_shares({}, {'A': [3, 4]}, {})[0], {3: 0.5, 4: 0.5})
        self.assertEqual(last, {})

    def test_a_goalie_who_left_counts_only_for_who_is_here(self):
        boxes = {'1': self.game('2026-10-01', (9, 'A')), '2': self.game('2026-10-02', (1, 'A'))}
        shares, _ = N.goalie_shares(boxes, {'A': [1, 2]}, {})
        self.assertNotIn(9, shares)
        self.assertGreater(shares[1], shares[2])


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
