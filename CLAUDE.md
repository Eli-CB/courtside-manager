# League Layer: notes for working on this repo

Fantasy basketball (Fantrax, public ESPN leagues, Sleeper), hockey (Fantrax) and football (Sleeper, part of the site so far) weekly matchup site. Static GitHub Pages site, no build step, no backend.
Live: https://leaguelayer.com (domain on Cloudflare, DNS only, set in the repo's Pages settings; the old
eli-cb.github.io/courtside-manager/ link redirects there) (repo Eli-CB/league-layer, renamed from courtside-manager Nov 16, 2026:
GitHub redirects the old name as long as no new repo takes it. The site was Courtside Manager until Oct 2026; its storage keys were
`courtside-*` until Nov 16, 2026 and are `league-layer-*` now, renamed with nothing carried over, as the owner was the only visitor: with
real visitors, a renamed key needs its old copy moved first, or their saved leagues are gone). Owner's league:
"Keepers and Creepers" `my19c8mwmoipvhon` (9-cat H2H, most categories wins the week, weekly lineups,
8 starters + 5 bench + 1 IR, 2 keepers). Last season: `czqgnyozmf2tbr93` (2025-26; Fantrax's public API can't list a league's past seasons, so their IDs come from the owner). The owner's Sleeper league (Nov 18, 2026), free to
test with: "The IPA" `1336466264633135104` (16-team dynasty, points, Lock-In, 2 IR + 2 taxi spots, a 3-round rookie draft, picks traded through 2028).
The owner's ESPN test leagues (Nov 19, 2026; public, the owner's team in both is "Eli's Excellent Team"; 10 teams, 8 cats without TO, daily lineups, 10 starters + 3 bench + 1 IR):
"Utah Pro H2H Categories League" `1715452380` (starts Nov 23 as Matchup 6: a late league keeps ESPN's week numbers, as ESPN's own schedule page shows) and
"Sacramento Beginner Roto League" `1299985004` (roto, a 68-game limit a lineup spot; the tests' fixture, team names made up; roto is in docs/espn.md).
The real leagues hockey and football were built on: "Bar Down Fantasy Hockey 2" `bbuqfr8gmuanycdo` (Fantrax, 12 teams, H2H points, weekly) and
"RidgeFootball" `1388378031520772096` (Sleeper, 10 teams, half PPR, keepers).

## These notes (the owner's standing rule, Nov 2026)
This file holds only what every session needs, whatever it touches. Each area's detail is in its `docs/` file (the map below):
read it before changing that area, and each one a change spans. Whenever you learn something that any Claude starting on this
site for the first time would need, write it down in the same piece of work, without being asked: a decision the owner made and
why, a rule for how something must behave, a gotcha that cost time (an API's quirk, a limit, something that fails silently), where
a new feature lives and which functions own it, a check done against real data, a step that is the owner's alone. It goes in its
area's file, under that file's own headings (a new area: a new file and a row in the map); here only what every session needs.
Fix or remove a line your change made wrong rather than adding a second one, and keep it short and specific. Not for the notes:
what only matters to the task at hand, or what the code already says plainly. Most changes add nothing: a one-off tweak to how
something looks (a bigger player card, a moved button, a new size or spacing) isn't site knowledge unless the owner states it as
a rule to keep. When unsure, leave it out; an addition is a line or two, not a paragraph. This file stays under 20,000 characters,
the owner's ask (Nov 19, 2026, when it had reached 69,000 and every session read all of it): a test fails past that, so move
detail out to `docs/` rather than squeezing words. Never in Claude's own memory folder: it belongs to one PC and one folder path
(renaming the folder, Nov 19, 2026, left it behind). A long how-to goes in the README beside its code (worker/README.md), with a
line in the notes pointing to it. `docs/` isn't published: the deploy copies only what the page reads.

## Where the notes are
| Working on | Read |
|---|---|
| `sports.js`, `core.js`, `info.js`, `render.js`, `actions.js`, styles.css (the look, positions, picks that hold) | docs/core.md |
| the player card, a sport team's or a fantasy team's card | docs/cards.md |
| `nba.js`: data load, projections, value, the category model, Stats used | docs/model.md |
| `fantrax.js`, anything that asks Fantrax | docs/fantrax.md |
| `espn.js`, `roto.js`: ESPN basketball, football and roto | docs/espn.md |
| `sleeper.js`: one game a week, taxi, rookie drafts, real results | docs/sleeper.md |
| `yahoo.js` (blocked on Yahoo's approval) | docs/yahoo.md, worker/README.md |
| `football.js`, scripts/update_nfl.py | docs/football.md |
| hockey: goalies, scripts/update_nhl.py | docs/hockey.md |
| `dashboard.js`: the Matchup tab, live dots, full screen | docs/matchup.md |
| `players.js`: the Players tab | docs/players.md |
| `matchups.js`: Plan Ahead, next week's lineups, finished weeks | docs/plan-ahead.md |
| `views.js`: Standings, Categories won, Season totals | docs/standings.md |
| `views.js`: Trades, draft picks in a deal | docs/trades.md |
| `recap.js`, `share.js`: the Recap, every share picture | docs/recap.md |
| `trends.js` | docs/trends.md |
| `draft.js`: the board, Draft Retrospective, keepers | docs/draft.md |
| `history.js`: weekly rosters, awards, when a week is over | docs/history.md |
| `leagues.js`: saved leagues, seasons, the demo, the landing page | docs/leagues.md |
| `sandbox.js` | docs/sandbox.md |
| `live.js`, the Worker's /live and /espn/, injuries | docs/live.md |
| scripts/update_data.py, data/, how box scores load | docs/data.md |
| the logo, 404, home-screen install, error log, analytics, restoring Pages | docs/hosting.md |

## Layout
- `index.html`, `styles.css`, `js/*.js`. The js files are ONE script split by area and share one global
  scope; they must load in the order index.html lists: sports, core, nba, info, fantrax, espn, sleeper, football, yahoo, render, history, views,
  dashboard, players, matchups, roto, recap, trends, share, live, draft, leagues, sandbox, actions. Shared builders (Nov 18, 2026): every row of on/off buttons is `segBtns` (core.js), every sortable table's order `sortRows` (views.js: empty cells last), whose a player is `rosterOwners`/`ownerTag`/`faBadge` (players.js, the sandbox's My team included). Top-level code may only use things defined in earlier files (no hoisting across files), and no two files may declare the same function: a later file's silently replaces the earlier one everywhere (history.js's `periodDays` once broke every week's dates; a test checks).
- Names: "NBA", `nbaId`, `nbaPlayers` and the like mean "the sport's data"; "fx" names (`fxLeague`, `raw.fx`, `fxTeamSide`) mean "the league's
  site", any site. Use the shared pieces, never your own: caches sign up with `keep(from, reset)` beside their declaration and hear
  `changed('sport' | 'box' | 'league' | 'players', leagueId)` (never clear another file's cache by hand); `withState(over, fn)` is the one
  place the page's state is swapped; every localStorage read and write goes through `store`, every time of day through `fmtTime`; highest
  first is `sortDesc(list, fn)`; a player's name is `playerBtn`, a team's code `teamBtn`/`linkTeams`, a fantasy team's name `teamLink`;
  positions only through `posTags` (colors only from `slotColor`). Details: docs/core.md.
- What a football week is like is said once, in its sport table (sports.js: `weekLineup`, `gameLocks` + `spotLocked`, `oneNumber`,
  `samePosDrops`; hockey's `steadyMinutes`): other pages read those traits, and branch on `isFootball()` only to call football's own functions.
- Other folders: `scripts/` the daily data jobs (docs/data.md), `worker/` the Cloudflare Worker at api.leaguelayer.com (worker/README.md),
  `data/` what the jobs write, `icons/`, `fonts/`.
- `tests/`: `node --test tests/app.test.js` (Node built-ins only). `harness.js` loads the js files in a vm
  in page order with fake fetch (fixtures) and a fixed clock (2026-10-26 20:00 ET). Fixtures in
  `tests/fixtures` (refresh: `python tests/capture_fixtures.py`). Every run of the site workflow, data runs too, tests
  what's on main in its `test` job, and publishes exactly that commit only if they pass (`site.yml`; `tests.yml` covers pull requests).

## Rules settled with the owner (keep them)
- How the owner works (Nov 17, 2026): several sessions at once, and the owner doesn't read code. No pull requests: a session lands
  its own work on main once it's tested and checked, without asking (only force pushes, rewriting history or deleting things need a yes), rebasing onto origin/main and fixing any conflict itself, keeping both sides' changes (Deploy, under Gotchas).
- Where the site is going (Oct 31, 2026): grow it, not keep it a personal tool. Its niche: head-to-head category leagues (Fantrax, weekly lineups), matchup odds,
  league-wide fun (recaps, awards, past seasons), free with no account. Favor what a whole league shares and what spreads through league chats (share links and
  pictures that open with no setup); not what needs staff or a backend (articles, expert rankings, a draft extension, push notifications).
- Every session that changes files works in a worktree of its own (the owner's rule, Nov 18, 2026): the app starts sessions in the main folder, so before
  its first edit a session there calls EnterWorktree (named for the task; it branches from origin/main) and keeps every edit, test, preview and commit,
  this request's and later ones', in it. Only reading and answering stay in the main folder. Sessions sharing the main folder tested each other's
  half-done code and couldn't commit apart in a file both had changed (core.js and actions.js take most changes).
- Everything follows each league's own settings on Fantrax or ESPN (category list or point values, slots, daily
  vs weekly lineups, playoffs). Never hard-code the owner's league.
- Weekly lineups lock when the week starts, so the lineup people are setting is next week's: Plan Ahead shows next week's rosters;
  every other tab and the saved lineup stay on this week's (docs/plan-ahead.md).
- Fantrax: minimize requests (league data cached on the device, a manual ↻ Reload, one automatic reload around a period's start spread
  over minutes, weekly rosters once per finished period: docs/fantrax.md). Fantrax and Sleeper are asked straight from each browser on
  purpose: their limits are per IP, and a proxy would pool everyone's.
- A matchup's span is a "period" in labels (This / Last / Next period), not a week.
- Makes and attempts are always written with a slash, "10/19 FG", never a dash (the owner's ask, Nov 2026; a dash is for records and scores). How pairs are drawn and sorted: docs/core.md.
- Static explanations go in (i) popups; on-screen text stays short and specific.
- Mobile matters: check phone width (375px); no page-level sideways scroll. Popups keep their scrolling (`overscroll-behavior: contain` on `.modal`/`.modal-body`, not on tables inside them) and the page behind is frozen while one is open (`html:has(dialog[open])`, with its scrollbar's gutter kept).
- The look (Nov 2026, chosen from a mock): shadcn/ui-style, in styles.css alone: zinc neutrals, Inter served from `fonts/`. Orange
  (`--accent`) is only for your own team and team things; player names stay black. A player's positions always take Fantrax's
  colors, everywhere, share pictures too: `posTags` (a test fails otherwise). Details: docs/core.md.
- The Worker (`worker/`) is the owner's to deploy: never run `npx wrangler deploy` or `wrangler secret put` yourself.

## Gotchas
- Escaping: a shared link opens any league on leaguelayer.com, so text a league's members type (its name, team names) goes through `esc()`
  wherever it's drawn. A `data-tip` is HTML put in the page again as HTML (`showTip`), so text inside one is escaped twice: `esc()` in the tip, `esc()` on the attribute. Inside a popup `showTip` moves the box into the open dialog: a modal is drawn above any z-index, so tips in cards never showed until Nov 2026.
  The full-draw test in app.test.js draws every tab and popup of nine leagues with names made to break out of HTML (audited Nov 17, 2026: none did); it also checks every position is in its color.
- `python serve.py [port]` (preview config "site", port 5173) refreshes `data/` locally: never commit
  `data/players.json` / `data/boxscores.json` from a local run (`git checkout -- data/players.json data/boxscores.json`).
  `.claude/` is git-ignored, so a worktree has no `launch.json` (and the preview tool reads the main folder's, which a worktree session may not edit: its "site" serves the main folder's code; if so, run the worktree's `python serve.py 5176` in the background and open its URL): write one there whose port no other session uses (5174, 5175...: `runtimeArgs` `["serve.py", "5174"]`;
  serve.py refuses a port in use, as Windows would otherwise let two servers share one; keep to 5174-5179). Another port is another origin, with its own empty storage: open it as
  `http://localhost:<port>/?league=my19c8mwmoipvhon#dashboard` (`openSharedLink` connects the league; pick "Eli's SGAteam" if it asks), not by typing the ID in the form. The Worker
  answers localhost:5173-5179 (`SITE_ORIGINS`, worker/wrangler.toml; 5174-5179 added Nov 18, 2026, live once the owner deploys the Worker: until then those ports fall back to ESPN directly).
- Deploy: push to main triggers the site workflow (deploy only); `gh workflow run site.yml` refreshes data. It publishes only what the page reads
  (`index.html`, `404.html`, `styles.css`, `manifest.webmanifest`, `js/`, `data/`, `fonts/`, `icons/`: the deploy job's "Gather" step): a new top-level file or folder the page needs must be added there. Each sport's refresh
  runs apart; one that fails (or NFL projections failing) fails the run at the end, so GitHub says so, and the rest still publishes.
  Commit flow used: `git pull --rebase -q origin main && git push -q origin main`, then `gh run watch`. In a worktree (its own branch) the push is
  `git push -q origin HEAD:main` (plain `main` there is the stale local branch, not the work), and the tests run again after the rebase, before it.
  Then bring the main folder up to it (`git -C <main folder> merge --ff-only -q origin/main`, which never overwrites uncommitted edits): new sessions read this file from there. A worktree session can't run git in the main folder (the app refuses `git -C`): leave the worktree first (ExitWorktree, keep), then merge there.
  A session that edited in the main folder anyway may find other sessions' unfinished edits beside its own: commit only your own files (`git commit <files>`), and never `git stash`
  theirs (or `--autostash`): every session shares one stash list, and another's pop or drop took a stashed Trends edit (Nov 18, 2026; got back from
  `git fsck --unreachable`). There: `git fetch`; origin/main already in HEAD (`git merge-base --is-ancestor origin/main HEAD`): push; else rebase in a temporary worktree.
  Commit messages end with the Co-Authored-By line.
- The repo must stay public on GitHub's free plan: making it private deletes the Pages site at once, and making it public again
  doesn't bring it back (restoring it: docs/hosting.md).
- The preview browser sometimes loses localStorage on restart (back to the landing page): reconnect the
  league by ID in the form, then pick "Eli's SGAteam".
