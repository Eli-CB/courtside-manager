# Trends: js/trends.js

Part of the repo's notes: CLAUDE.md says which file covers what and how to keep them current. Read this before changing js/trends.js.

- Trends, a tab of its own after Players (`#trends`, `viewTrends`/`trendsCard`, trends.js; under the Recap until Nov 2026, the owner's ask; not football: in its `soonTabs`): Heating up / Cooling off (`ui.trendDir`), each player's last 5 games
  through the latest day of saved box scores against his median game before them (5+ earlier games; a regular: 15+ minutes, hockey 10), one top-5 list per
  counting category (points leagues: fantasy points), shooting % with volume, Minutes and Shot attempts, ranked by the change per game; first by Value
  (`lineValue` now and its change): Rostered and Waivers (unowned). Notes from the box scores only (`teammateOut`: a 24+ minute teammate missing most of those games;
  minutes moved 4+). Owners are today's rosters. Info text `trends`. A list's name (every category, Rostered, Waivers) opens its card (the owner's ask, Nov 2026: `trend-cat`,
  `trendCardHtml`/`showTrendCard`, in the player card's dialog; `trendKit` is what the tab and the card share): everyone the list takes, 25 at a time, each one's last 5 games
  one by one (green above his usual, red below), Avg / Usual / Season / MIN / Change, sortable (`ui.trendSort`), direction and whose (All / Rostered / Waivers; the
  sandbox's My team / Everyone else) picked in it (`ui.trendCard`). The full-draw test never reaches it (the fixtures' season is too young for a trend): its own test checks names
