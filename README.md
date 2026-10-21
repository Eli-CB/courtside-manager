# Courtside Manager

A weekly matchup optimizer for 9-category head-to-head fantasy basketball. It pulls your Fantrax league, real NBA stats, injuries and the schedule, then shows:

- **This week:** both lineups side by side, projected category totals, win chances, and which starters to use
- **Dashboard:** category strengths ranked against every team in the league
- **Roster, Players, Watchlist:** stats for every active NBA player, with your league's position eligibility and availability

It's a plain static site (`index.html`, `styles.css`, `app.js`) reading data files in `data/`.

## Data

`scripts/update_data.py` builds `data/players.json` from:

- NBA.com data server (cdn.nba.com): schedule, active players, and every finished game's box score, which this season's stats and game logs are built from (cached in `data/boxscores.json`)
- NBA.com stats (stats.nba.com): last season's stats and game-to-game spreads. It blocks most cloud servers, so the GitHub workflow keeps the saved copy; refresh it from your PC now and then with `python scripts/update_data.py` and push.
- ESPN: injury report
- Fantrax: positions, rosters, lineups, matchups and availability for the league in `league.json`

`scripts/build_images.py` builds the headshot sprite and team logos (`data/headshots.webp`, `data/images.json`). It needs Pillow.

A GitHub Actions workflow (`.github/workflows/site.yml`) refreshes the data every morning, rebuilds images on Mondays, and publishes the site to GitHub Pages. Run it by hand from the Actions tab at any time.

## Running locally

```
python serve.py
```

Then open http://localhost:5173. The local server refreshes data when it's more than 6 hours old, and lets you switch leagues from Settings.

## Changing leagues

Put your Fantrax league ID (from your league's URL, `fantrax.com/fantasy/league/<id>/…`) in `league.json`, then run the workflow or `python scripts/update_data.py`.
