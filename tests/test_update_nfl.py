"""The NFL data job's own logic, no network: python -m unittest discover -s tests -p "test_*.py" """
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'scripts'))
import update_nfl as N  # noqa: E402


class Weeks(unittest.TestCase):
    def game(self, d, w):
        return {'date': d, 'week': w}

    def test_a_week_runs_tuesday_to_monday_around_its_games(self):
        # Thursday, Sunday and Monday night of one week
        for d in ('2026-11-05', '2026-11-08', '2026-11-09'):
            self.assertEqual(N.week_of([self.game(d, 9)]), {9: ['2026-11-03', '2026-11-09']})

    def test_a_kickoff_after_midnight_utc_is_the_night_it_is_played(self):
        self.assertEqual(N.us_day('2026-11-10T01:15Z'), '2026-11-09')


class Stats(unittest.TestCase):
    def test_keeps_what_leagues_score_and_drops_the_rest(self):
        s = N.scored({'pass_yd': 250, 'pass_td': 2, 'bonus_pass_yd_300': 0, 'rec_0_4': 1, 'pts_allow_7_13': 1, 'fgm_30_39': 2, 'bonus_rec_te': 3,
                      'pos_rank_ppr': 12, 'pts_half_ppr': 19.5, 'pass_lng': 49, 'cmp_pct': 63.6, 'rec_ypr': 11, 'gms_active': 1, 'tm_off_snp': 60, 'pass_rtg': 96})
        self.assertEqual(set(s) - {'rec_ypr'}, {'pass_yd', 'pass_td', 'rec_0_4', 'pts_allow_7_13', 'fgm_30_39', 'bonus_rec_te'})

    def test_every_team_defense_gets_its_own_number(self):
        ids = N.def_ids([{'home': 'LAR', 'away': 'SEA'}, {'home': 'BUF', 'away': 'LAR'}])
        self.assertEqual(ids, {'BUF': N.DEF_IDS, 'LAR': N.DEF_IDS + 1, 'SEA': N.DEF_IDS + 2})
        self.assertIsNone(N.player_id('LAR'))
        self.assertEqual(N.player_id('4034'), 4034)

    def test_espn_codes_become_sleepers(self):
        self.assertEqual(N.espn_tri('WSH'), 'WAS')
        self.assertEqual(N.espn_tri('KC'), 'KC')


class Injuries(unittest.TestCase):
    def test_who_is_out_and_who_might_play(self):
        self.assertEqual(N.injury({'injury_status': 'IR', 'injury_body_part': 'Knee'})['status'], 'Out')
        self.assertEqual(N.injury({'injury_status': 'Questionable'})['status'], 'DTD')
        self.assertEqual(N.injury({'injury_status': 'Questionable', 'injury_body_part': 'Ankle', 'injury_notes': 'limited'})['note'], 'Ankle limited')
        self.assertIsNone(N.injury({}))


if __name__ == '__main__':
    unittest.main()
