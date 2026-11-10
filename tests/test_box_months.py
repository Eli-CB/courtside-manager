"""The site's box scores by month (box_months in scripts/update_data.py). Run: python -m unittest discover -s tests -p "test_*.py"."""
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'scripts'))
from update_data import box_months  # noqa: E402


def game(d, home='AAA', away='BBB'):
    return {'d': d, 'home': home, 'away': away, 'hs': 100, 'as': 90, 'rows': [[1, home, 30, 20]]}


class BoxMonths(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.dir.name, 'boxscores.json')

    def tearDown(self):
        self.dir.cleanup()

    def save(self, games, **more):
        with open(self.path, 'w', encoding='utf-8') as f:
            json.dump({'season': '2026-27', 'v': 2, **more, 'games': games}, f)

    def month(self, name):
        with open(os.path.join(self.dir.name, 'box', name + '.json'), encoding='utf-8') as f:
            return json.load(f)

    def test_no_file_yet(self):
        self.assertEqual(box_months(self.path), {})

    def test_one_file_a_month_with_every_game_once(self):
        self.save({'3': game('2026-11-01'), '1': game('2026-10-20'), '2': game('2026-10-31')}, keys=['min', 'pts'], who={'9': ['A', 'C']})
        index = box_months(self.path)
        self.assertEqual(sorted(index), ['2026-10', '2026-11'])
        october = self.month('2026-10')
        self.assertEqual(list(october['games']), ['1', '2'])
        self.assertEqual(list(self.month('2026-11')['games']), ['3'])
        self.assertEqual((october['season'], october['v'], october['keys']), ('2026-27', 2, ['min', 'pts']))
        self.assertNotIn('who', october)  # the job's own notes stay in its working copy

    def test_a_version_changes_only_with_its_month(self):
        games = {'1': game('2026-10-20'), '2': game('2026-11-01')}
        self.save(games)
        first = box_months(self.path)
        # the same games saved in another order: the same files
        self.save(dict(reversed(list(games.items()))))
        self.assertEqual(box_months(self.path), first)
        # a new game in November, and a stat correction there: October keeps its version (and its place in a visitor's cache)
        games['3'] = game('2026-11-02')
        games['2']['rows'][0][3] = 22
        self.save(games)
        second = box_months(self.path)
        self.assertEqual(second['2026-10'], first['2026-10'])
        self.assertNotEqual(second['2026-11'], first['2026-11'])

    def test_another_seasons_months_go(self):
        self.save({'1': game('2026-04-10')})
        box_months(self.path)
        self.save({'2': game('2026-10-20')})
        self.assertEqual(sorted(box_months(self.path)), ['2026-10'])
        self.assertEqual(os.listdir(os.path.join(self.dir.name, 'box')), ['2026-10.json'])


if __name__ == '__main__':
    unittest.main()
