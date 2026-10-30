// Courtside Manager: The (i) explanations.
// The site loads js/*.js in order (see index.html); they share one scope, like one file.
'use strict';

// ----- ⓘ explanations of how things are calculated -----
const INFO = {
  win: ['Win chances', `
    <p><b>Projected totals.</b> For each category we add up every starter's per-game average × the games they play on your matchup days (from the NBA schedule). Players who are Out count zero. Bench games never count while lineups are locked for the week.</p>
    <p><b>Uncertainty.</b> Each player's game-to-game spread (standard deviation) comes from his NBA game logs: last season plus this season, games of 10+ minutes, at least 8 games. Spreads add up across every starter game, so a team's weekly total has a known range.</p>
    <p><b>Category win chance.</b> For counting stats: the chance your total beats theirs, using a bell curve with the gap divided by the combined spread. Turnovers are reversed (fewer wins). FG% and FT% use team makes ÷ attempts, with shot-making luck (binomial, widened 30%) as the spread.</p>
    <p><b>Lineups.</b> Both teams' starters as set on your league's site. Projections use the stats chosen in the league menu (smart blend by default).</p>
    <p><b>Points leagues.</b> Each side's projected fantasy points come from those totals × your league's points per stat. The spread combines every stat's spread, assuming stats in a game move together somewhat (correlation 0.35), and the win chance is the chance of outscoring them on that bell curve. The suggested lineup maximizes that chance, then projected points. We project points, rebounds (offensive and defensive too), assists, steals, blocks, turnovers, threes made and attempted, field goals and free throws made, attempted and missed, two-pointers, double-doubles and triple-doubles (as how often a player gets one), fouls, plus/minus, minutes and games played. Anything else your league scores, like technicals, percentages or position-specific points, is left out and listed in the top bar.</p>
    <p><b>Winning the week.</b> Categories are treated as independent, and we add up the chances of every way to take more than half of them. The projected category score is the sum of the category win chances.</p>`],
  suggest: ['How lineup suggestions work', `
    <p><b>Starting point.</b> Starters are ranked by games this week × (player value + 4), then fitted into your slots (PG, SG, G, SF, PF, F, C, Flx) so every slot gets an eligible player.</p>
    <p><b>Search.</b> We try every single swap of a starter for a bench player that still fits the slots and keep the one that improves the goal most, repeating up to 6 times until nothing helps.</p>
    <p><b>The goal.</b> Your league gives one win to whoever takes more categories, so the goal is your chance of winning the week. Total categories won only breaks ties.</p>
    <p><b>Punting.</b> A category's win chance follows a bell curve, so adding stats to one you're far behind in (or far ahead in) barely moves it. Those categories effectively get ignored, and players are used where the matchup is close.</p>
    <p><b>Explaining it.</b> The suggested lineup is broken into one-for-one swaps, best first. Each swap's numbers assume the swaps above it are already made.</p>`],
  shading: ['Stat shading', () => `
    <p><b>Per game.</b> Each stat is compared with an average rostered player in your league: the ${BASE.pool || 'about 156'} players with the most minutes (its teams × roster spots), by ${seasonCtx && seasonCtx.label ? `${esc(seasonCtx.label)} per-game stats` : "this season's stats (smart blend: 10 games of last season mixed in, so it's steady early on)"}. Average ± spread:</p>
    <ul><li>${scoreCats().filter(c => !c.fp && !c.pct && BASE[c.key]).map(c => `${c.label} ${fmt(BASE[c.key][0], BASE[c.key][0] < 3 ? 2 : 1)} ± ${fmt(BASE[c.key][1], 2)}${c.neg ? ' (fewer is better)' : ''}`).join(', ')}</li>
    ${scoreCats().filter(c => c.pct && BASE[c.key]).map(c => `<li>${c.label}: (${c.label} − ${fmt(BASE[c.key][0] * 100, 1)}%) × attempts ÷ ${fmt(BASE[c.key][1], 2)}, so shot volume counts</li>`).join('')}</ul>
    <p><b>Week total.</b> The player's weekly number is compared with an average starter's week of about 3.5 games: (weekly total − average × 3.5) ÷ (spread × 3.5). The same weekly total always gets the same shade.</p>
    <p><b>Colors.</b> Green helps the category, red hurts it, getting stronger up to ±2.5 spreads. The Projected week row is shaded by your chance to win each category instead. Hover any number for the exact value.</p>`],
  dots: ['Schedule dots', `
    <p>One dot per matchup day, from the NBA schedule. <b>Filled</b> dots are games already played; <b>rings</b> are games still to come.</p>
    <ul><li><b>Green:</b> a game that counts (a starter).</li><li><b>Grey:</b> a game on the bench, which doesn't count.</li>
    <li><b>Yellow:</b> a regular (20+ minutes a game) played well under his usual minutes: under 70% of his average and at least 8 fewer. Hover it for his minutes and the likely reason: an <b>injury</b> (he's been on the ESPN injury report since that game), a <b>blowout</b> (decided by 20 or more), <b>foul trouble</b> (5 or more fouls), or none of those, which usually means the coach's call.</li>
    <li><b>Light green ring:</b> an upcoming back-to-back night (the team also plays the day before or after). Players sometimes rest one of those nights.</li>
    <li><b>Red:</b> filled, his team played but he didn't; a ring, he's listed Out.</li></ul>
    <p>Hover any played game for his minutes and stat line. The number on the right is games this week; hover it for played and left. Projections use the real box score for games already played and project only the rest.</p>`],
  benchswaps: ['How the week ended', `
    <p><b>The final score</b> counts every game each team's starters played that week, from the weekly lineups on Fantrax and the NBA box scores (like Season totals). The tables show each team's lineup that week: starters' games (what counted), the week total (green where that team won the category, red where it lost), and the bench's games, which didn't count.</p>
    <p><b>Bench swaps.</b> Each bench player is tried in place of each starter: his games that week count instead of the starter's, against the other team's real total. A swap only counts if the lineup could still be filled from the two players' positions (as they're listed now). In daily-lineup leagues the swap covers every day the starter started and the bench player sat.</p>
    <p>The best swaps are listed for both teams, one per bench player, with the categories that change hands: <b>+</b> now won, <b>=</b> now tied, <b>−</b> now lost. Green rows would have changed the result.</p>`],
  perf: ['Performances', `
    <p><b>Value.</b> A single game counts like player value: every one of your league's categories against an average rostered player's game. In points leagues it's fantasy points, red when below a typical rostered player's game.</p>
    <p><b>Today.</b> ESPN's box scores, which your browser asks for about once a minute while games are on and this shows today's games (ESPN runs a minute or so behind the broadcast). A game still on is measured against an average game's share for the minutes played, so a good start reads as good. Finished days come from the saved box scores, which the site's data job adds overnight.</p>
    <p><b>This week.</b> Adds up each player's games on this matchup's days that have been played, and compares what they added to each category with an average starter's output over the same days (3.5 games a week), like the Matchups week totals. Every game counts, so a player with more games ranks higher. It appears once the week has more than one day of games.</p>
    <p><b>Columns.</b> Everyone who played is ranked by value (the number by each name). Click a column to sort; the top 50 by that column show, so sort Value the other way for the worst. Categories sort by how much they helped, so the fewest turnovers and the most valuable shooting come first. Shading is per game, as on the Matchups tables. Shooting shows makes-attempts; hover for the percentage.</p>
    <p><b>Filters.</b> By team: yours, this matchup's opponent and the other teams. By where players are: Active (in their team's starting lineup now), Bench (IR included) and Waivers (not on a roster in your league; they have no team, so the team filters don't hide them). Ranks stay out of everyone who played.</p>`],
  value: ['Player value', `
    <p>Value is the sum of a player's contributions per game in each of your league's categories, each measured against an average rostered player in your league (see Stat shading for the averages, which come from this season's stats and your league's size). +5 is an elite all-around player; 0 is an average rostered player.</p>
    <p>FG% and FT% count shot volume, and turnovers count against.</p>
    <p><b>Points leagues:</b> value is fantasy points per game (FP/G), using your league's points for each stat.</p>`],
  projection: ['Which stats are used', `
    <p><b>Smart blend (default):</b> this season's averages with 10 games of last season mixed in: (this season × games played + last season × 10) ÷ (games played + 10). Early on it leans on last season; after a month or two it's mostly this season.</p>
    <p>Switch to this season only, last season only, or the last 10 games from the league menu at the top.</p>`],
  strengths: ['Category strengths', `
    <p><b>You.</b> Your players' real per-game numbers: the average per player for counting stats (starters, or your whole active roster), and team FG% and FT% as total makes ÷ total attempts.</p>
    <p><b>League avg.</b> The same number averaged across every team in your league, using each team's current roster and lineup.</p>
    <p><b>Bar.</b> How far you are from that league average, measured in the typical gap between teams (one standard deviation across the league). The bar reaches the edge at two gaps above or below. Fewer turnovers counts as above average.</p>
    <p><b>Rank and dots.</b> Your place among the teams in that category, and every team on the same scale, with you in orange.</p>
    <p><b>Who helped and hurt.</b> Click a category's row to show the players who helped most (green) and hurt most (red). Each player's own per-game number in that category, compared with the league average in the same row. For FG% and FT% it's their percentage and attempts a game ("<b>.700</b> on 6.2 FTA"), ranked by makes above or below what the league average would give at that volume, so a poor shooter who takes a lot of shots hurts more than one who rarely shoots. Hover a name for the detail.</p>
    <p><b>Strengths and weaknesses.</b> Your top-three and bottom-three categories by league rank.</p>`],
  totals: ['Season totals', `
    <p><b>Who counts.</b> Fantrax keeps every team's lineup for each lineup period (a week, or a day in daily leagues). A player's games count for the team that had him <b>starting</b> in that period. Bench and IR games don't count, and a player who changed teams counts for whoever was starting him at the time.</p>
    <p><b>Player games.</b> Every starter's games added up, so it depends on how many starters your league has and how often their NBA teams played. A team with more player games has had more chances to pile up counting stats.</p>
    <p><b>Totals.</b> Counting stats are added up from this season's box scores (a past season uses its saved NBA game logs, back to 2016-17). FG% and FT% are total makes ÷ total attempts.</p>
    <p><b>Colors.</b> Each column is shaded from best in the league (green) to worst (red); fewer turnovers counts as better. Hover a number for its rank. <b>Avg rank</b> is a team's average rank across the categories.</p>
    <p><b>Sorting.</b> Click a column to sort it best first, and again to flip it. Until then, teams follow the standings.</p>`],
  pastRoster: ['Past rosters', `
    <p>Everyone the team had in its <b>starting lineup</b> for at least one week, from Fantrax's weekly rosters. Players who only sat on the bench or IR aren't listed.</p>
    <ul><li><b>How:</b> kept, drafted, picked up or traded for, by how he joined the team the first time he started for it. Keepers are players on the team's opening-week roster that it didn't draft.</li>
    <li><b>Wks:</b> weeks in the starting lineup.</li>
    <li><b>GP:</b> games played in those weeks; every stat comes from just these games.</li>
    <li><b>Missed:</b> games his NBA team played in those weeks without him (injury, rest or a coach's decision).</li>
    <li><b>Value:</b> each game valued against an average rostered player's game (fantasy points in points leagues), added up for Totals or averaged for Per game.</li></ul>`],
  storage: ['Saved on this device', `
    <p>To keep requests to Fantrax and ESPN low, the site saves what it fetches in this browser: each league you open (the five most recent, reused for 6 hours or until ↻ Reload), each site's player list (and Fantrax's ADP, refreshed daily), and finished weeks' lineups (the 8 most recently used leagues and seasons; a finished week never changes).</p>
    <p>Your leagues, team picks and settings are saved too. Browsers allow about 5 MB per site. <b>Clear saved league data</b> removes only what came from Fantrax and ESPN; it's fetched again the next time it's needed.</p>`],
  awDraft: ['Best draft', `
    <p>Everything a team's draft picks produced over the season: every game each pick played from the draft until he was first <b>dropped</b> to free agency, whether he was starting or on the bench. A pick who's <b>traded</b> keeps counting for the team that drafted him; one who's dropped stops counting (if someone picks him up later, that's their Waiver Wire Wizard).</p>
    <p>In category leagues each game is valued against a <b>replacement-level starter</b> (the per-game value of the last player who'd start in your league), so every game by a player worth starting adds to the total and staying healthy pays. Points leagues add up fantasy points.</p>
    <p>Totals don't adjust for draft slot, so a great first-round pick usually out-produces a late-round steal. The Draft tab grades each pick against its slot (+/−).</p>`],
  awManager: ['Best manager', `
    <p>Who won more than their team's play deserved: <b>actual wins</b> (from Fantrax's standings, ties counting half) minus <b>expected wins</b> from an <b>all-play record</b>.</p>
    <p><b>All-play.</b> Each finished regular-season week, a team's real totals (every game its starters played that week, from Fantrax's weekly lineups and the NBA box scores) are matched against <b>every</b> other team's, not just that week's opponent. A team that would have beaten 8 of 9 teams gets 0.89 of a win for the week; one that would have beaten 2 of 9 gets 0.22. Ties count half.</p>
    <p><b>Expected wins</b> are those weekly shares added up. Winning more than that means drawing weak opponents in good weeks and avoiding strong ones in bad weeks, mostly schedule luck. In leagues where every category counts, it's the same with categories: the share of categories won against every team.</p>
    <p>The week still underway doesn't count, and neither do playoff weeks. The totals come from box scores, which can differ slightly from Fantrax's (stat corrections, the odd game counted in a different week), so expect small gaps.</p>`],
  awWaiver: ['Waiver Wire Wizard', `
    <p>What free-agent and waiver pickups did for the team that picked them up: every game a pickup played in a week he was in that team's <b>starting lineup</b>, each valued like a single game on the Dashboard (fantasy points in points leagues), added up.</p>
    <p>A pickup who started one week counts for that week only, and he counts even if he was dropped later. A pickup who played below an average rostered player lowers the total.</p>
    <p>Fantrax has no public transaction log, so this follows each player through every week's rosters: on his team from week 1 means drafted or kept; on another team's roster the week before he arrived means a <b>trade</b>, which doesn't count; on nobody's roster means a <b>pickup</b>. A player dropped and claimed by another team in the same week looks like a trade.</p>`],
  awStreet: ['Street Clothes', `
    <p>Games a team lost to players sitting while they were in its <b>starting lineup</b>. For each week, Fantrax's rosters say who started; for each starter, every game his NBA team played that week without him counts one.</p>
    <p>Bench and IR players don't count, and neither do games before a player joined the team or after he left it, so a player traded or dropped mid-season counts only for the weeks a team started him. Injuries, rest and coach's decisions all count the same: the game logs can't tell them apart.</p>
    <p>A team's schedule comes from that season's NBA game logs (every day any of its players played). A player who didn't play at all that season is placed on his current team.</p>`],
  awPunt: ['Biggest punt', `
    <p>Each team's season totals (every game its starters played, week by week, the same numbers as the Standings tab's Season totals), compared with the league's other teams category by category, in team-to-team spreads. The award goes to the single category furthest below the league average.</p>`],
  awSteven: ['Even Steven', `
    <p>Each team's season totals (every game its starters played, week by week, the same numbers as the Standings tab's Season totals), compared with the league's other teams category by category, in team-to-team spreads. The most balanced team has the smallest spread between its best and worst categories.</p>`],
  awUnc: ['Unc Status', `
    <p>The oldest <b>starting lineups</b>. Every week, Fantrax's rosters say who each team started; each starter's age that week is averaged over all of the team's starter-weeks, so a player who started 20 weeks counts 20 times as much as one who started once. Bench and IR players don't count.</p>
    <p>Ages come from ESPN birth dates. Players without one on record (mostly those no longer in the NBA) are left out.</p>`],
  draft: ['How draft picks are graded', `
    <p><b>Now.</b> Every drafted player is ranked using only this season's stats (see Player value). Players who haven't played yet rank below everyone who has.</p>
    <p><b>Per game or season totals.</b> The toggle at the top re-ranks the whole tab. <b>Per game</b> ranks by value per game, so a player who's missed time isn't held against his pick. <b>Season totals</b> also counts games played: in points leagues it's total fantasy points; in category leagues it's value above a replacement-level starter (the last player who'd start in your league) times games played, so playing more only helps players worth starting.</p>
    <p><b>+/−.</b> Draft slot minus current rank. A #40 pick who's playing like the #5 player is +35; a #3 pick playing like #50 is −47.</p>
    <p><b>Past seasons.</b> A past draft is graded the same way, but on that season's full per-game stats, so the rank is where each player finished.</p>
    <p><b>Team drafts.</b> The average +/− across all of a team's picks. Total value adds up the per-game value of every pick who has played.</p>
    <p><b>Colors.</b> Each pick and keeper is shaded green (outplaying his slot) to red (underplaying it). Early in the season, a single game can move these a lot.</p>
    <p><b>Keepers</b> fill the top two rows. This season, the one with the better Fantrax ADP is graded as if he were the #5 pick, the other as the #15 pick, against where he ranks among this year's picks. A past season's keepers are shown but not graded.</p>
    <p><b>Board.</b> One row per round, one column per draft slot. Traded picks stay in their original slot, marked with the team that made the pick. "No pick" means the slot went unused.</p>`],
  board: ['Reading the draft board', `
    <p><b>Each cell</b> is one pick: the pick number, the player, and his <b>+/−</b>.</p>
    <p><b>How a pick is ranked.</b> Every drafted player is ranked against the others using this season's stats so far, or that season's full stats for a past draft. #1 is the best player of the whole draft class. Players who haven't played rank below everyone who has.</p>
    <p><b>Per game or season totals</b> (the toggle at the top of the tab). Per game ranks by value per game (fantasy points per game in points leagues). Season totals also counts games played, so missed games pull a player down: total fantasy points in points leagues, or value above a replacement-level starter times games in category leagues.</p>
    <p><b>+/−</b> is the pick number minus that rank. A #40 pick playing like the #5 player is <b>+35</b>; a #3 pick playing like #50 is <b>−47</b>. "DNP" means he hasn't played.</p>
    <p><b>Colors.</b> Green is outplaying the slot, red is underplaying it, getting stronger the bigger the gap. Hover a cell for the player's rank.</p>
    <p><b>Layout.</b> One row per round, one column per draft slot. A traded pick stays in its original slot, marked "by" the team that made it. "No pick" means the slot went unused.</p>
    <p><b>Keepers</b> fill the K rows at the top. This season, the one with the better Fantrax ADP is graded as if he were the #5 pick, the other as the #15 pick. A past season's keepers (players on a team's opening-week roster it didn't draft) are shown but not graded, and don't count toward any grade or award.</p>`],
  data: ['Where the data comes from', `
    <ul><li><b>NBA.com:</b> active players, last season's stats and game-to-game spreads, and (when reachable) the schedule and box scores.</li>
    <li><b>ESPN:</b> the injury report, plus the schedule and box scores on the website's daily refresh, since NBA.com blocks the cloud servers that run it. Both give identical numbers.</li>
    <li><b>Fantrax or ESPN</b> (wherever your league is): your league's position eligibility, every team's roster and lineup, matchups, and who's available.</li></ul>
    <p>NBA stats, box scores and injuries refresh every night at about 4 a.m. Eastern, after the last games finish. The site's own league gets its Fantrax data (rosters, lineups, matchups, draft) in that same refresh; other leagues are saved on this device for up to 6 hours. For the latest from your league's site any time, use ↻ Reload in the ⚙ menu.</p>`],
};

const infoBtn = key => `<button type="button" class="info-btn" data-action="info" data-key="${key}" aria-label="How this is calculated" title="How this is calculated">i</button>`;
