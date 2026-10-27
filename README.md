# Courtside Manager

A weekly matchup optimizer for 9-category head-to-head fantasy basketball. It pulls your Fantrax league, real NBA stats, injuries and the schedule, then shows:

- **Dashboard:** the day's essentials: action items, injury news for your players, and the latest game day's best single games across the NBA (free agents included) and worst games by rostered players, with who has each player
- **Matchups:** both lineups side by side, projected category totals, win chances, and which starters to use
- **Roster:** what your team is good and bad at: each category ranked against every team in the league, and every player's stats shaded by how much they help or hurt
- **Free Agents:** recommended adds for your team (plus an injured player to stash when you have an open IR spot), then every free agent and waiver player, or every NBA player, with your league's position eligibility
- **Standings:** the Fantrax standings, plus every team's season totals in each category from the players it actually started each week
- **Awards:** this season's awards so far (and each past season's): best draft, best manager (actual wins vs an all-play record), Waiver Wire Wizard, Street Clothes, biggest punt, Even Steven and Unc Status, all from each week's starting lineups
- **Trades:** what a deal with another team in your league does to your per-game production

It's a plain static site (`index.html`, `styles.css`, `app.js`) reading data files in `data/`.

## Data

`scripts/update_data.py` builds `data/players.json` from:

- NBA.com data server (cdn.nba.com): schedule, active players, and every finished game's box score, which this season's stats and game logs are built from (cached in `data/boxscores.json`)
- Past seasons (`data/seasons/<season>.json`, 2016-17 on): each finished season's per-game stats and every game line (`<season>-games.json`, for what pickups did in the weeks they started), saved once with `python scripts/archive_season.py <season>` and never changed. stats.nba.com blocks GitHub's servers, so run it on your own computer: once a year, when a season ends. The daily job reads last season's file for projections (combining its game-to-game totals with this season's games), and the site loads a season's file when you open it, to grade its draft, awards and rosters.
- ESPN: injury report, and the schedule and box scores when NBA.com is blocked (GitHub's servers can't reach NBA.com, so the daily cloud refresh uses ESPN for game stats)
- Fantrax: positions, rosters, lineups, matchups and availability for the league in `league.json`

`scripts/build_images.py` builds the headshot sprite and team logos (`data/headshots.webp`, `data/images.json`). It needs Pillow.

A GitHub Actions workflow (`.github/workflows/site.yml`) refreshes the data every morning, rebuilds images on the 1st of each month (or sooner when more than 5 active players have no headshot), and publishes the site to GitHub Pages. Run it by hand from the Actions tab at any time.

## Running locally

```
python serve.py
```

Then open http://localhost:5173. The local server refreshes data when it's more than 6 hours old. Switch or add leagues from the league menu at the top.

## Leagues

First-time visitors land on a page that asks for their Fantrax league ID (from the league's address, `fantrax.com/fantasy/league/<id>/…`), then which team is theirs. They can add more leagues and switch between them from the league menu in the top bar. The browser loads that league's rosters, lineups, matchups, positions and draft straight from Fantrax, which allows requests from any site, and remembers it on that device. NBA stats, the schedule and injuries come from the shared daily data.

`league.json` sets the league included in the daily data, which doubles as the demo league on the landing page.

Scoring comes from each league's Fantrax settings: its own categories for category leagues (any counting stat, FG%, FT% and 3P%), or its point values for points leagues. Anything the site can't project, like an A/TO ratio category or technical fouls, is listed in the top bar. Head-to-head leagues are supported; rotisserie and season-total points leagues aren't yet.

## Tests

```
node --test tests/app.test.js
```

The tests load `app.js` in Node against saved Fantrax and NBA responses in `tests/fixtures` (a 9-cat league, a weekly points league and a daily points league), with the date fixed at Oct 26, 2026. They cover reading league settings, category and points scoring, projections, season totals (which must reproduce the real week-1 results), short names, draft grading and recommended adds. They run on every push. `python tests/capture_fixtures.py` saves fresh fixtures, which may mean updating expected values.
