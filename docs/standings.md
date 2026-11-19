# Standings: js/views.js

Part of the repo's notes: CLAUDE.md says which file covers what and how to keep them current. Read this before changing Standings or Season totals in js/views.js (box score loading: docs/data.md).

- views: Standings (+ Categories won, category leagues: each team's categories W-L-T against its real opponent over the finished regular-season weeks, and per category, by the Recap's `weekScore`, `catsWonRecords`/`catsWonCard`; + Season totals; both from one load, `seasonLineups`; the Roster tab is gone, `#roster` and `#lineup` land here), Trades, shared table helpers, box score loading.
