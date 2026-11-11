// League Layer: what differs between the sports. A league's sport decides which data set loads (js/nba.js: useSport)
// and which of these tables the rest of the site reads. "NBA", nbaId and the like mean "the sport's data" (as "fx"
// names mean "the league's site"): names kept from when the site was basketball only.
// The site loads js/*.js in order (see index.html); they share one scope, like one file.
'use strict';

const SPORTS = {
  nba: {
    key: 'nba', name: 'NBA', emoji: '🏀', data: 'data/', fantrax: 'NBA',
    positions: ['PG', 'SG', 'SF', 'PF', 'C'],
    slotTypes: ['PG', 'SG', 'G', 'SF', 'PF', 'F', 'C', 'FLX'],
    elig: { PG: ['PG'], SG: ['SG'], SF: ['SF'], PF: ['PF'], C: ['C'], G: ['PG', 'SG'], F: ['SF', 'PF'], FLX: ['PG', 'SG', 'SF', 'PF', 'C'] },
    defaultSlots: ['PG', 'SG', 'G', 'SF', 'PF', 'F', 'C', 'FLX'],
    // each lineup spot's color, as Fantrax shows them (its own shades: pc-* in styles.css; Res is its plain blue)
    slotColors: { PG: 'orange-2', SG: 'rose-2', G: 'orange-1', SF: 'blue-2', PF: 'purple-2', F: 'purple-1', C: 'emerald-1', FLX: 'teal-2', BN: 'blue' },
    broadPos: { G: ['PG', 'SG'], F: ['SF', 'PF'] }, // leagues with broad positions list G / F instead of PG,SG / SF,PF
    // The standard 9 categories, in the order most leagues display them (used when a league's own list is unknown).
    // Percentage categories name the makes and attempts they're built from.
    cats: [
      { key: 'fgPct', label: 'FG%', pct: true, made: 'fgm', att: 'fga' },
      { key: 'ftPct', label: 'FT%', pct: true, made: 'ftm', att: 'fta' },
      { key: 'tpm', label: '3PM' },
      { key: 'pts', label: 'PTS' },
      { key: 'reb', label: 'REB' },
      { key: 'ast', label: 'AST' },
      { key: 'stl', label: 'STL' },
      { key: 'blk', label: 'BLK' },
      { key: 'to', label: 'TO', neg: true },
    ],
    // Mean / spread of each stat for an average rostered player, for turning stats into "value" (a z-score sum).
    // BASE comes from the data (baseNow: the league's rostered-player pool, that season's stats); these rough
    // numbers for a standard 12-team league stand in until the NBA data has loaded.
    baseDefault: {
      pts: [15, 6], reb: [6, 3], ast: [3.8, 2.3], stl: [1.0, 0.4], blk: [0.6, 0.5],
      tpm: [1.7, 1.0], to: [1.9, 0.9],
      fgPct: [0.47, 0.9], // impact = (FG% - mean) * FGA
      ftPct: [0.78, 0.7], // impact = (FT% - mean) * FTA
    },
    // what's copied onto a player: per-game stats, plus fgPct and ftPct worked out from makes and attempts
    playerKeys: ['min', 'pts', 'reb', 'ast', 'stl', 'blk', 'tpm', 'to', 'fga', 'fta', 'fgPct', 'ftPct', 'oreb', 'dreb', 'tpa', 'pf', 'pm', 'dd', 'td'],
    fields: ['min', 'pts', 'reb', 'ast', 'stl', 'blk', 'tpm', 'to', 'fgPct', 'fga', 'ftPct', 'fta', 'games'],
    statLabel: { pts: 'PTS', reb: 'REB', oreb: 'OREB', dreb: 'DREB', ast: 'AST', stl: 'STL', blk: 'BLK', tpm: '3PM', tpa: '3PA', tpmi: '3P miss',
      fg2m: '2PM', fg2a: '2PA', to: 'TO', fgm: 'FGM', fga: 'FGA', fgmi: 'FG miss', ftm: 'FTM', fta: 'FTA', ftmi: 'FT miss', dd: 'DD', td: 'TD',
      pf: 'PF', pm: '+/−', min: 'MIN', gp1: 'GP' },
    // stats a league can score that are combinations of ones we project
    derived: { fgmi: { fga: 1, fgm: -1 }, ftmi: { fta: 1, ftm: -1 }, tpmi: { tpa: 1, tpm: -1 }, fg2m: { fgm: 1, tpm: -1 }, fg2a: { fga: 1, tpa: -1 } },
    pctCats: { fgPct: ['FG%', 'fgm', 'fga'], ftPct: ['FT%', 'ftm', 'fta'], tpPct: ['3P%', 'tpm', 'tpa'] },
    negCats: ['to', 'pf', 'fgmi', 'ftmi', 'tpmi'], // fewer is better
    catOrder: ['fgPct', 'ftPct', 'tpPct', 'tpm', 'tpa', 'pts', 'reb', 'oreb', 'dreb', 'ast', 'stl', 'blk', 'to', 'dd', 'td'],
    // Per-game stats we project. The first 11 have spreads from game logs (raw.sd, same order); the rest are
    // for points leagues that score them (dd/td are per-game rates; gp1 is one per game played).
    countKeys: ['pts', 'reb', 'ast', 'stl', 'blk', 'tpm', 'to', 'fgm', 'fga', 'ftm', 'fta', 'oreb', 'dreb', 'tpa', 'pf', 'pm', 'dd', 'td', 'min', 'gp1'],
    boxCols: ['min', 'pts', 'reb', 'ast', 'stl', 'blk', 'tpm', 'to', 'fgm', 'fga', 'ftm', 'fta', 'oreb', 'dreb', 'tpa', 'pf', 'pm'],
    espn: 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/',
    game: { minutes: 48, periods: 4, tag: 'Q' }, // a game's length and what its periods are called on a live clock
    // the stat columns of a table of per-game or season stats (past rosters), then its percentages: [key, label, makes, attempts]
    soonTabs: [], // tabs this sport doesn't have yet
    tableStats: [['min', 'MIN'], ['pts', 'PTS'], ['reb', 'REB'], ['ast', 'AST'], ['stl', 'STL'], ['blk', 'BLK'], ['tpm', '3PM'], ['to', 'TO']],
    tablePct: [['fgPct', 'FG%', 'fgm', 'fga'], ['ftPct', 'FT%', 'ftm', 'fta']],
    // each team's full name, for its card (a team's code anywhere opens it)
    teamNames: {ATL: 'Atlanta Hawks', BKN: 'Brooklyn Nets', BOS: 'Boston Celtics', CHA: 'Charlotte Hornets', CHI: 'Chicago Bulls',
      CLE: 'Cleveland Cavaliers', DAL: 'Dallas Mavericks', DEN: 'Denver Nuggets', DET: 'Detroit Pistons', GSW: 'Golden State Warriors',
      HOU: 'Houston Rockets', IND: 'Indiana Pacers', LAC: 'LA Clippers', LAL: 'Los Angeles Lakers', MEM: 'Memphis Grizzlies', MIA: 'Miami Heat',
      MIL: 'Milwaukee Bucks', MIN: 'Minnesota Timberwolves', NOP: 'New Orleans Pelicans', NYK: 'New York Knicks', OKC: 'Oklahoma City Thunder',
      ORL: 'Orlando Magic', PHI: 'Philadelphia 76ers', PHX: 'Phoenix Suns', POR: 'Portland Trail Blazers', SAC: 'Sacramento Kings',
      SAS: 'San Antonio Spurs', TOR: 'Toronto Raptors', UTA: 'Utah Jazz', WAS: 'Washington Wizards' },
    teamColors: {
      ATL: ['#E03A3E', '#C1D32F'], BOS: ['#007A33', '#BA9653'], BKN: ['#000000', '#FFFFFF'], CHA: ['#1D1160', '#00788C'],
      CHI: ['#CE1141', '#000000'], CLE: ['#860038', '#FDBB30'], DAL: ['#00538C', '#B8C4CA'], DEN: ['#0E2240', '#FEC524'],
      DET: ['#C8102E', '#1D42BA'], GSW: ['#1D428A', '#FFC72C'], HOU: ['#CE1141', '#000000'], IND: ['#002D62', '#FDBB30'],
      LAC: ['#12173F', '#C8102E'], LAL: ['#552583', '#FDB927'], MEM: ['#5D76A9', '#12173F'], MIA: ['#98002E', '#F9A01B'],
      MIL: ['#00471B', '#EEE1C6'], MIN: ['#0C2340', '#78BE20'], NOP: ['#0C2340', '#B4975A'], NYK: ['#006BB6', '#F58426'],
      OKC: ['#007AC1', '#EF3B24'], ORL: ['#0077C0', '#C4CED4'], PHI: ['#006BB6', '#ED174C'], PHX: ['#1D1160', '#E56020'],
      POR: ['#E03A3E', '#000000'], SAC: ['#5A2D81', '#63727A'], SAS: ['#000000', '#C4CED4'], TOR: ['#CE1141', '#000000'],
      UTA: ['#4E008E', '#000000'], WAS: ['#002B5C', '#E31837'],
    },
  },

  // A game's stats, data/nhl (scripts/update_nhl.py): a goalie's own goals, assists and penalty minutes have their own
  // keys (gg, ag, gpim), so a league can score them apart from a skater's and no total mixes them; gt is his hours played.
  nhl: {
    key: 'nhl', name: 'NHL', emoji: '🏒', data: 'data/nhl/', fantrax: 'NHL',
    steadyMinutes: true, // ice time doesn't swing with blowouts and fouls: no "short minutes" notes
    positions: ['C', 'LW', 'RW', 'D', 'G'],
    slotTypes: ['C', 'LW', 'RW', 'W', 'F', 'D', 'G', 'FLX'],
    // each lineup spot's color, as Fantrax shows hockey's (F green, D purple, G brown; Res its plain blue); C, LW, RW and W stay plain until seen
    slotColors: { F: 'emerald-1', D: 'purple-2', G: 'amber-2', BN: 'blue' },
    elig: { C: ['C'], LW: ['LW'], RW: ['RW'], W: ['LW', 'RW'], F: ['C', 'LW', 'RW'], D: ['D'], G: ['G'], FLX: ['C', 'LW', 'RW', 'D'] },
    defaultSlots: ['C', 'C', 'W', 'W', 'W', 'W', 'D', 'D', 'D', 'D', 'G', 'G'],
    broadPos: { W: ['LW', 'RW'], F: ['C', 'LW', 'RW'] },
    cats: [
      { key: 'g', label: 'G' }, { key: 'a', label: 'A' }, { key: 'pm', label: '+/−' }, { key: 'sog', label: 'SOG' },
      { key: 'hit', label: 'HIT' }, { key: 'blk', label: 'BLK' }, { key: 'w', label: 'W' },
      { key: 'svPct', label: 'SV%', pct: true, made: 'sv', att: 'sa' },
    ],
    baseDefault: {},
    playerKeys: ['min', 'g', 'a', 'pts', 'pm', 'pim', 'sog', 'hit', 'blk', 'ppg', 'ppa', 'shg', 'sha', 'gwg', 'fow', 'fol', 'fot',
      'gs', 'w', 'l', 'otl', 'sol', 'so', 'ga', 'sv', 'sa', 'gt', 'gg', 'ag', 'gpim'],
    fields: ['min', 'g', 'a', 'pts', 'pm', 'sog', 'hit', 'blk', 'w', 'sv', 'sa', 'games'],
    // in the order tables show them; a goalie's own goals and assists count but aren't given a column
    statLabel: { g: 'G', a: 'A', pts: 'PTS', pm: '+/−', pim: 'PIM', sog: 'SOG', hit: 'HIT', blk: 'BLK', ppg: 'PPG', ppa: 'PPA', ppp: 'PPP',
      shg: 'SHG', sha: 'SHA', shp: 'SHP', gwg: 'GWG', fow: 'FOW', fol: 'FOL', gs: 'GS', w: 'W', l: 'L', otl: 'OTL', sol: 'SOL', so: 'SO',
      ga: 'GA', sv: 'SV', sa: 'SA', min: 'MIN', gp1: 'GP' },
    derived: { ppp: { ppg: 1, ppa: 1 }, shp: { shg: 1, sha: 1 } },
    // rate: a rate per hour, not a share of attempts (goals against average); neg: lower is better
    pctCats: { foPct: ['FO%', 'fow', 'fot'], svPct: ['SV%', 'sv', 'sa'], gaa: ['GAA', 'ga', 'gt', { neg: true, rate: true }] },
    negCats: ['l', 'otl', 'sol', 'ga'],
    catOrder: ['g', 'a', 'pts', 'pm', 'pim', 'sog', 'hit', 'blk', 'ppg', 'ppa', 'ppp', 'shg', 'sha', 'shp', 'gwg', 'fow', 'fol', 'foPct',
      'gs', 'w', 'l', 'otl', 'sol', 'so', 'ga', 'gaa', 'sv', 'sa', 'svPct'],
    // SD_KEYS of scripts/update_nhl.py (raw.sd, same order), then the rest
    countKeys: ['g', 'a', 'pts', 'pm', 'pim', 'sog', 'hit', 'blk', 'ppg', 'ppa', 'shg', 'sha', 'gwg', 'fow', 'fol', 'fot',
      'w', 'l', 'otl', 'sol', 'so', 'ga', 'sv', 'sa', 'gt', 'gg', 'ag', 'gpim', 'min', 'gs', 'gp1'],
    boxCols: null, // the box score file names its own
    espn: 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/',
    espnTeams: { LA: 'LAK', NJ: 'NJD', SJ: 'SJS', TB: 'TBL' }, // ESPN's codes that aren't the NHL's
    game: { minutes: 60, periods: 3, tag: 'P' },
    soonTabs: [],
    tableStats: [['min', 'MIN'], ['g', 'G'], ['a', 'A'], ['sog', 'SOG'], ['hit', 'HIT'], ['blk', 'BLK'], ['w', 'W'], ['so', 'SO']],
    tablePct: [['svPct', 'SV%', 'sv', 'sa']],
    goalieCats: ['gs', 'w', 'l', 'otl', 'sol', 'so', 'ga', 'gaa', 'sv', 'sa', 'svPct'],
    // added to an (i) popup
    infoMore: {
      win: `<p><b>Goalies.</b> A goalie counts by his chance of starting each game: his share of his team's recent starts, much lower the night after he plays (a team's goalie started both games of a back-to-back 7% of the time in 2025-26), lower after any start. Once ESPN names the starter, that's who counts. This week's starts usually come within about one of the guess.</p>`,
      dots: `<p>A goalie's games show his team's schedule: hover a game for his chance of starting it. The number on the right is the starts he's expected to play.</p>`,
      recap: `<p>Street clothes counts skaters: a healthy backup goalie sits most games, so goalies aren't in it.</p>`,
      awStreet: `<p>Goalies aren't counted: a healthy backup sits most games.</p>`,
      pastRoster: `<p>Missed counts skaters: a healthy backup goalie sits most games.</p>`,
    },
    // Fantrax's stats by scoring group (goals and assists are in both): short names first, then its category codes
    fxStats: {
      HOCKEY_SKATING: {
        short: { G: 'g', A: 'a', PTS: 'pts', '+/-': 'pm', PIM: 'pim', SOG: 'sog', SH: 'sog', HIT: 'hit', HITS: 'hit', BLK: 'blk', BS: 'blk', PPG: 'ppg', PPA: 'ppa',
          PPP: 'ppp', SHG: 'shg', SHA: 'sha', SHP: 'shp', GWG: 'gwg', FOW: 'fow', FOL: 'fol', GP: 'gp1' },
        codes: [[/PERCENT|PCT/, null], [/POWER_PLAY_GOAL/, 'ppg'], [/POWER_PLAY_ASSIST/, 'ppa'], [/POWER_PLAY_POINT/, 'ppp'], [/SHORT.*GOAL/, 'shg'], [/SHORT.*ASSIST/, 'sha'],
          [/SHORT.*POINT/, 'shp'], [/GAME_WINNING/, 'gwg'], [/FACEOFF.*(WIN|WON)/, 'fow'], [/FACEOFF.*LOS/, 'fol'], [/SHOTS_ON_GOAL/, 'sog'], [/PLUS_MINUS/, 'pm'],
          [/PENALTY_MIN/, 'pim'], [/HIT/, 'hit'], [/BLOCK/, 'blk'], [/ASSIST/, 'a'], [/GOALS?$/, 'g'], [/POINTS$/, 'pts'], [/GAMES?_PLAYED/, 'gp1']],
      },
      HOCKEY_GOALIE: {
        short: { W: 'w', L: 'l', OL: 'otl', OTL: 'otl', SHL: 'sol', SOL: 'sol', SHO: 'so', SO: 'so', GA: 'ga', SV: 'sv', SVS: 'sv', SA: 'sa', GS: 'gs', G: 'gg', A: 'ag', PIM: 'gpim', GP: 'gp1' },
        codes: [[/PERCENT|PCT|AVERAGE/, null], [/SHOOTOUT_LOSS/, 'sol'], [/OVERTIME_LOSS/, 'otl'], [/SHUTOUT/, 'so'], [/WINS/, 'w'], [/LOSS/, 'l'], [/GOALS_AGAINST/, 'ga'],
          [/SAVES/, 'sv'], [/SHOTS_AGAINST/, 'sa'], [/GAMES?_STARTED/, 'gs'], [/ASSIST/, 'ag'], [/PENALTY_MIN/, 'gpim'], [/GOALS?$/, 'gg'], [/GAMES?_PLAYED/, 'gp1']],
      },
    },
    // each team's full name, for its card (a team's code anywhere opens it)
    teamNames: {ANA: 'Anaheim Ducks', BOS: 'Boston Bruins', BUF: 'Buffalo Sabres', CAR: 'Carolina Hurricanes', CBJ: 'Columbus Blue Jackets',
      CGY: 'Calgary Flames', CHI: 'Chicago Blackhawks', COL: 'Colorado Avalanche', DAL: 'Dallas Stars', DET: 'Detroit Red Wings',
      EDM: 'Edmonton Oilers', FLA: 'Florida Panthers', LAK: 'Los Angeles Kings', MIN: 'Minnesota Wild', MTL: 'Montreal Canadiens',
      NJD: 'New Jersey Devils', NSH: 'Nashville Predators', NYI: 'New York Islanders', NYR: 'New York Rangers', OTT: 'Ottawa Senators',
      PHI: 'Philadelphia Flyers', PIT: 'Pittsburgh Penguins', SEA: 'Seattle Kraken', SJS: 'San Jose Sharks', STL: 'St. Louis Blues',
      TBL: 'Tampa Bay Lightning', TOR: 'Toronto Maple Leafs', UTA: 'Utah Mammoth', VAN: 'Vancouver Canucks', VGK: 'Vegas Golden Knights',
      WPG: 'Winnipeg Jets', WSH: 'Washington Capitals' },
    teamColors: {
      ANA: ['#F47A38', '#B9975B'], BOS: ['#FFB81C', '#000000'], BUF: ['#003087', '#FFB81C'], CAR: ['#CC0000', '#000000'],
      CBJ: ['#002654', '#CE1126'], CGY: ['#C8102E', '#F1BE48'], CHI: ['#CF0A2C', '#000000'], COL: ['#6F263D', '#236192'],
      DAL: ['#006847', '#8F8F8C'], DET: ['#CE1126', '#FFFFFF'], EDM: ['#041E42', '#FF4C00'], FLA: ['#041E42', '#C8102E'],
      LAK: ['#111111', '#A2AAAD'], MIN: ['#154734', '#A6192E'], MTL: ['#AF1E2D', '#192168'], NJD: ['#CE1126', '#000000'],
      NSH: ['#FFB81C', '#041E42'], NYI: ['#00539B', '#F47D30'], NYR: ['#0038A8', '#CE1126'], OTT: ['#C52032', '#000000'],
      PHI: ['#F74902', '#000000'], PIT: ['#000000', '#FCB514'], SEA: ['#001628', '#99D9D9'], SJS: ['#006D75', '#000000'],
      STL: ['#002F87', '#FCB514'], TBL: ['#002868', '#FFFFFF'], TOR: ['#00205B', '#FFFFFF'], UTA: ['#71AFE5', '#090909'],
      VAN: ['#00205B', '#00843D'], VGK: ['#B4975A', '#333F42'], WPG: ['#041E42', '#7B303E'], WSH: ['#041E42', '#C8102E'],
    },
  },

  // Football: Sleeper leagues. A week is Tuesday to Monday night (weekShift), one game a player. A line's stats are named as
  // in a league's Sleeper scoring settings, so stats × scoring gives its points exactly, its bonuses and a defense's
  // brackets (points allowed) included; the stats are the daily job's (data/nfl), filled in here when it loads (fetchSport).
  // A week's projection is Sleeper's, in the same names (the daily file's proj: nba.js, footballProj), so it scores exactly as
  // the league does. No past seasons or Fantrax yet; a team defense is a player, with a number made from its team code.
  nfl: {
    key: 'nfl', name: 'NFL', emoji: '🏈', data: 'data/nfl/', fantrax: 'NFL',
    // What a football week is like, for the pages that aren't football's own (football.js does the football):
    weekLineup: true,   // one lineup for the week, whatever the league's site calls it
    gameLocks: true,    // a lineup spot locks when its player's game starts (spotLocked), not all at once
    oneNumber: true,    // a player's week is one projected number: no games count, schedule dots, per-game tables, categories or minutes
    samePosDrops: true, // an add takes the place of the weakest at its position
    positions: ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'],
    slotTypes: ['QB', 'RB', 'WR', 'TE', 'WRRB', 'WRTE', 'FLX', 'SFLX', 'K', 'DEF'],
    elig: { QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'], K: ['K'], DEF: ['DEF'], WRRB: ['WR', 'RB'], WRTE: ['WR', 'TE'], FLX: ['RB', 'WR', 'TE'], SFLX: ['QB', 'RB', 'WR', 'TE'] },
    defaultSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLX', 'K', 'DEF'],
    slpSlots: { FLEX: 'Flx', WRRB_FLEX: 'WRRB', REC_FLEX: 'WRTE', SUPER_FLEX: 'SFLX' }, // Sleeper's slot names
    broadPos: {},
    cats: [],
    baseDefault: {},
    playerKeys: [], countKeys: ['gp1'], // the daily file's stats
    fields: ['games'],
    statLabel: {}, // a league's points are the one column: dozens of stats score
    derived: {},
    pctCats: {},
    negCats: [],
    catOrder: [],
    boxCols: null,
    tableStats: [],
    tablePct: [],
    espn: 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/',
    espnTeams: { WSH: 'WAS' },
    game: { minutes: 60, periods: 4, tag: 'Q' },
    weekShift: 1,
    soonTabs: ['draft', 'trade'],
    // How far a starter's week lands from his projection. A real league's 80 team-weeks missed by 7.8 (QB), 7.6 (RB), 7.8 (WR),
    // 6 (TE), 5.2 (K) and 6 (DEF); those are × 0.8 here, or a team's week would swing more than it did: matchup margins
    // missed by 24 points, where nine players moving independently make 30.
    projSd: { QB: 6.2, RB: 6.1, WR: 6.2, TE: 4.8, K: 4.2, DEF: 4.8 },
    // (i) texts that replace basketball's
    infoOver: {
      win: ['Win chances', `
        <p><b>Projected score.</b> Each starter counts his projection for the week, Sleeper's own, in your league's scoring. They're updated every morning. A finished game counts its real points, and a game in progress its points so far plus the projection for the time left. Anyone on a bye or listed Out counts zero.</p>
        <p><b>Beyond the next few weeks</b> there are no projections yet, so a player's season average stands in.</p>
        <p><b>Win chance.</b> The chance of outscoring them on a bell curve. The spread comes from how far projections missed a real league's starters over its first 8 weeks: about 8 points for a quarterback, running back or receiver, 5 to 6 for a tight end, kicker or defense. On those weeks the team projected ahead won 25 of 40 matchups, so even a big favorite can lose.</p>
        <p><b>Lineups.</b> Both teams' starters as set on Sleeper.</p>`],
      suggest: ['How lineup suggestions work', `
        <p><b>The lineup.</b> Your highest-projected players who fit your slots. Anyone on a bye or listed Out doesn't count.</p>
        <p><b>Locked players.</b> Once a player's game starts he's locked: a starter stays where he is, and a bench player can't come in.</p>
        <p><b>Questionable players</b> keep their projection, so check the news before kickoff.</p>`],
      dots: ['Lineups', `
        <p>Each player's game and his number for the week: his <b>projection</b> before kickoff, his <b>points so far</b> once it starts, and his <b>final points</b> after.</p>
        <p>Bye means no game this week.</p>`],
    },
    // how a line reads: [stat, word], and which a position's card shows: [label, stat]
    words: [['pass_yd', 'pass yd'], ['pass_td', 'pass TD'], ['pass_int', 'INT'], ['rush_yd', 'rush yd'], ['rush_td', 'rush TD'], ['rec', 'rec'], ['rec_yd', 'rec yd'], ['rec_td', 'rec TD'],
      ['fgm', 'FG'], ['xpm', 'XP'], ['sack', 'sacks'], ['int', 'INT'], ['def_td', 'def TD'], ['pts_allow', 'pts allowed']],
    card: {
      QB: [['Pass yd', 'pass_yd'], ['Pass TD', 'pass_td'], ['INT', 'pass_int'], ['Rush yd', 'rush_yd'], ['Rush TD', 'rush_td']],
      K: [['FG', 'fgm'], ['XP', 'xpm']],
      DEF: [['Sacks', 'sack'], ['INT', 'int'], ['Pts allowed', 'pts_allow']],
      other: [['Rush yd', 'rush_yd'], ['Rush TD', 'rush_td'], ['Rec', 'rec'], ['Rec yd', 'rec_yd'], ['Rec TD', 'rec_td']],
    },
    // each team's full name, for its card (a team's code anywhere opens it)
    teamNames: {ARI: 'Arizona Cardinals', ATL: 'Atlanta Falcons', BAL: 'Baltimore Ravens', BUF: 'Buffalo Bills', CAR: 'Carolina Panthers',
      CHI: 'Chicago Bears', CIN: 'Cincinnati Bengals', CLE: 'Cleveland Browns', DAL: 'Dallas Cowboys', DEN: 'Denver Broncos', DET: 'Detroit Lions',
      GB: 'Green Bay Packers', HOU: 'Houston Texans', IND: 'Indianapolis Colts', JAX: 'Jacksonville Jaguars', KC: 'Kansas City Chiefs',
      LAC: 'Los Angeles Chargers', LAR: 'Los Angeles Rams', LV: 'Las Vegas Raiders', MIA: 'Miami Dolphins', MIN: 'Minnesota Vikings',
      NE: 'New England Patriots', NO: 'New Orleans Saints', NYG: 'New York Giants', NYJ: 'New York Jets', PHI: 'Philadelphia Eagles',
      PIT: 'Pittsburgh Steelers', SEA: 'Seattle Seahawks', SF: 'San Francisco 49ers', TB: 'Tampa Bay Buccaneers', TEN: 'Tennessee Titans',
      WAS: 'Washington Commanders' },
    teamColors: {
      ARI: ['#97233F', '#000000'], ATL: ['#A71930', '#000000'], BAL: ['#241773', '#9E7C0C'], BUF: ['#00338D', '#C60C30'], CAR: ['#0085CA', '#101820'], CHI: ['#0B162A', '#C83803'],
      CIN: ['#FB4F14', '#000000'], CLE: ['#311D00', '#FF3C00'], DAL: ['#003594', '#869397'], DEN: ['#FB4F14', '#002244'], DET: ['#0076B6', '#B0B7BC'], GB: ['#203731', '#FFB612'],
      HOU: ['#03202F', '#A71930'], IND: ['#002C5F', '#A2AAAD'], JAX: ['#006778', '#D7A22A'], KC: ['#E31837', '#FFB81C'], LAC: ['#0080C6', '#FFC20E'], LAR: ['#003594', '#FFA300'],
      LV: ['#000000', '#A5ACAF'], MIA: ['#008E97', '#FC4C02'], MIN: ['#4F2683', '#FFC62F'], NE: ['#002244', '#C60C30'], NO: ['#D3BC8D', '#101820'], NYG: ['#0B2265', '#A71930'],
      NYJ: ['#125740', '#000000'], PHI: ['#004C54', '#A5ACAF'], PIT: ['#000000', '#FFB612'], SEA: ['#002244', '#69BE28'], SF: ['#AA0000', '#B3995D'], TB: ['#D50A0A', '#34302B'],
      TEN: ['#0C2340', '#4B92DB'], WAS: ['#5A1414', '#FFB612'],
    },
  },
};

// The sport on screen, and its tables as the plain names the rest of the site reads
let SPORT, POSITIONS, SLOT_TYPES, ELIG, DEFAULT_SLOTS, CATS, BASE_DEFAULT, STAT_FIELDS, STAT_LABEL, DERIVED, PCT_CATS, NEG_CATS, CAT_ORDER, COUNT_KEYS, TEAM_COLORS;
function setSport(key) {
  SPORT = SPORTS[key] || SPORTS.nba;
  ({ positions: POSITIONS, slotTypes: SLOT_TYPES, elig: ELIG, defaultSlots: DEFAULT_SLOTS, cats: CATS, baseDefault: BASE_DEFAULT, fields: STAT_FIELDS,
    statLabel: STAT_LABEL, derived: DERIVED, pctCats: PCT_CATS, catOrder: CAT_ORDER, countKeys: COUNT_KEYS, teamColors: TEAM_COLORS } = SPORT);
  NEG_CATS = new Set(SPORT.negCats);
}
setSport('nba');
const isHockey = () => SPORT.key === 'nhl';
const isFootball = () => SPORT.key === 'nfl';
// a hockey player who plays goal
const isGoalie = p => isHockey() && !!p && (p.pos || []).includes('G');
