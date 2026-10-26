# Courtside Manager

A weekly matchup optimizer for 9-category head-to-head fantasy basketball. It pulls your Fantrax league, real NBA stats, injuries and the schedule, then shows:

- **Dashboard:** record, strengths and weaknesses at a glance, injuries and action items
- **Matchups:** both lineups side by side, projected category totals, win chances, and which starters to use
- **Roster:** what your team is good and bad at: each category ranked against every team in the league, and every player's stats shaded by how much they help or hurt
- **Players:** stats for every active NBA player, with your league's position eligibility and availability
- **Trades:** what a deal with another team in your league does to your per-game production

It's a plain static site (`index.html`, `styles.css`, `app.js`) reading data files in `data/`.

## Data

`scripts/update_data.py` builds `data/players.json` from:

- NBA.com data server (cdn.nba.com): schedule, active players, and every finished game's box score, which this season's stats and game logs are built from (cached in `data/boxscores.json`)
- NBA.com stats (stats.nba.com): last season's stats and game-to-game spreads. It blocks most cloud servers, so the GitHub workflow keeps the saved copy; refresh it from your PC now and then with `python scripts/update_data.py` and push.
- ESPN: injury report, and the schedule and box scores when NBA.com is blocked (GitHub's servers can't reach NBA.com, so the daily cloud refresh uses ESPN for game stats)
- Fantrax: positions, rosters, lineups, matchups and availability for the league in `league.json`

`scripts/build_images.py` builds the headshot sprite and team logos (`data/headshots.webp`, `data/images.json`). It needs Pillow.

A GitHub Actions workflow (`.github/workflows/site.yml`) refreshes the data every morning, rebuilds images on Mondays, and publishes the site to GitHub Pages. Run it by hand from the Actions tab at any time.

## Running locally

```
python serve.py
```

Then open http://localhost:5173. The local server refreshes data when it's more than 6 hours old. Switch or add leagues from the league menu at the top.

## Leagues

First-time visitors land on a page that asks for their Fantrax league ID (from the league's address, `fantrax.com/fantasy/league/<id>/…`), then which team is theirs. They can add more leagues and switch between them from the league menu in the top bar. The browser loads that league's rosters, lineups, matchups, positions and draft straight from Fantrax, which allows requests from any site, and remembers it on that device. NBA stats, the schedule and injuries come from the shared daily data.

`league.json` sets the league included in the daily data, which doubles as the demo league on the landing page.
