"""The NFL data job's own logic, no network: python -m unittest discover -s tests -p "test_*.py" """
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'scripts'))
import update_nfl as N  # noqa: E402


class EspnIds(unittest.TestCase):
    def test_sleepers_id_stays_and_the_rest_match_by_name_and_team(self):
        real = N.fetch_json
        N.fetch_json = lambda *a, **kw: [{'id': 1, 'fullName': 'Jaxon Smith-Njigba', 'proTeamId': 26}, {'id': 2, 'fullName': 'Josh Allen', 'proTeamId': 2},
                                         {'id': 3, 'fullName': 'Josh Allen', 'proTeamId': 30}, {'id': 4, 'fullName': 'Mike Williams', 'proTeamId': 1},
                                         {'id': 5, 'fullName': 'Mike Williams', 'proTeamId': 2}, {'id': -16026, 'fullName': 'Seahawks D/ST', 'proTeamId': 26}]
        self.addCleanup(setattr, N, 'fetch_json', real)
        players = [{'name': 'Jaxon Smith-Njigba', 'team': 'SEA', 'pos': ['WR']}, {'name': 'Josh Allen', 'team': 'BUF', 'pos': ['QB'], 'espn': 99},
                   {'name': 'Josh Allen', 'team': 'JAX', 'pos': ['LB']}, {'name': 'Mike Williams', 'team': 'NYJ', 'pos': ['WR']},
                   {'name': 'Seahawks', 'team': 'SEA', 'pos': ['DEF']}]
        self.assertEqual(N.espn_ids('2026', players), 2)
        self.assertEqual([p.get('espn') for p in players], [1, 99, 3, None, None])


class EspnDefense(unittest.TestCase):
    def test_a_game_lands_in_one_of_espns_brackets(self):
        st = N.espn_defense({'pts_allow': 17, 'fum_rec': 1, 'def_st_fum_rec': 1, 'pts_allow_14_20': 1}, True)
        self.assertEqual(st['pts_allow_14_17'], 1)
        self.assertNotIn('pts_allow_18_21', st)
        self.assertEqual(st['def_fum_rec'], 2)
        self.assertEqual(st['pts_allow_14_20'], 1, "Sleeper's stay")
        self.assertEqual(N.espn_defense({'pts_allow': 46}, True)['pts_allow_46p'], 1)
        self.assertEqual(N.espn_defense({'pts_allow_0': 1}, True).get('pts_allow_14_17'), None)

    def test_only_a_defense(self):
        self.assertEqual(N.espn_defense({'rec': 5, 'fum_rec': 1}, False), {'rec': 5, 'fum_rec': 1})

    def test_a_projection_spreads_its_brackets(self):
        st = N.espn_defense_odds({'pts_allow': 20})
        odds = [st[k] for k, _, _ in N.ESPN_BRACKETS]
        self.assertGreater(st['pts_allow_18_21'], st['pts_allow_35_45'])
        self.assertLess(sum(odds), 1)
        self.assertGreater(sum(odds), 0.4)


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


class WeekStats(unittest.TestCase):
    def test_a_game_counts_only_if_he_played(self):
        real = N.get_json
        N.get_json = lambda url, **kw: [{'player_id': '1', 'stats': {'gp': 1, 'gms_active': 1, 'off_snp': 34}},
                                        {'player_id': '2', 'stats': {'gms_active': 1}},  # on the active roster, never played
                                        {'player_id': 'KC', 'stats': {'gp': 1, 'sack': 3}}]  # defenses have no gms_active
        self.addCleanup(setattr, N, 'get_json', real)
        self.assertEqual([r['player_id'] for r in N.week_stats('2026', 8)], ['1', 'KC'])


class Projections(unittest.TestCase):
    def test_a_projection_keeps_what_leagues_score(self):
        s = N.projected({'adp_dd_ppr': 3, 'pos_adp_dd_ppr': 1, 'gp': 1, 'pts_half_ppr': 20.2, 'rec': 5.3, 'rush_yd': 89.094, 'bonus_rec_rb': 5.3, 'cmp_pct': 66, 'pts_allow_14_20': 1})
        self.assertEqual(s, {'rec': 5.3, 'rush_yd': 89.09, 'bonus_rec_rb': 5.3, 'pts_allow_14_20': 1})

    def test_kicks_are_named_as_leagues_score_them(self):
        s = N.projected({'fga': 2.72, 'fgm': 2.36, 'fgm_50p': 0.46, 'fgmiss_50p': 0.13})
        self.assertEqual(s['fgm_50_59'], 0.46)
        self.assertEqual(s['fgmiss'], 0.36)

    def feed(self, weeks):
        real = N.get_json
        N.get_json = lambda url, **kw: weeks.get(int(url.split('?')[0].rsplit('/', 1)[1]), [])
        self.addCleanup(setattr, N, 'get_json', real)

    def test_players_without_a_game_are_left_out_and_rows_lose_trailing_zeros(self):
        self.feed({9: [{'player_id': '4034', 'stats': {'gp': 1, 'rec': 6, 'rec_yd': 70}}, {'player_id': 'KC', 'stats': {'gp': 1, 'sack': 3}}, {'player_id': '99', 'stats': {'adp_dd_ppr': 999}}],
                   10: [{'player_id': '4034', 'stats': {'gp': 1, 'rec': 5}}]})
        p = N.projections('2026', 9, {'KC': N.DEF_IDS})
        self.assertEqual(p['projWeeks'], [9, 10, 11])
        self.assertEqual(p['projKeys'], ['rec', 'rec_yd', 'sack'])
        self.assertEqual(p['rows'], {4034: {'9': [6, 70], '10': [5]}, N.DEF_IDS: {'9': [0, 0, 3]}})

    def test_the_season_ends_the_weeks_asked_for(self):
        self.feed({})
        self.assertEqual(N.projections('2026', 18, {})['projWeeks'], [18])


class Injuries(unittest.TestCase):
    def test_who_is_out_and_who_might_play(self):
        self.assertEqual(N.injury({'injury_status': 'IR', 'injury_body_part': 'Knee'})['status'], 'Out')
        self.assertEqual(N.injury({'injury_status': 'Questionable'})['status'], 'DTD')
        self.assertEqual(N.injury({'injury_status': 'Questionable', 'injury_body_part': 'Ankle', 'injury_notes': 'limited'})['note'], 'Ankle limited')
        self.assertIsNone(N.injury({}))


if __name__ == '__main__':
    unittest.main()
