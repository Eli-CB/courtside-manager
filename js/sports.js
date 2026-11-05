// League Layer: what differs between the sports. A league's sport decides which data set loads (js/nba.js: useSport)
// and which of these tables the rest of the site reads. "NBA", nbaId and the like mean "the sport's data" (as "fx"
// names mean "the league's site"): names kept from when the site was basketball only.
// The site loads js/*.js in order (see index.html); they share one scope, like one file.
'use strict';

const SPORTS = {
  nba: {
    key: 'nba', name: 'NBA', data: 'data/', fantrax: 'NBA',
    positions: ['PG', 'SG', 'SF', 'PF', 'C'],
    slotTypes: ['PG', 'SG', 'G', 'SF', 'PF', 'F', 'C', 'FLX'],
    elig: { PG: ['PG'], SG: ['SG'], SF: ['SF'], PF: ['PF'], C: ['C'], G: ['PG', 'SG'], F: ['SF', 'PF'], FLX: ['PG', 'SG', 'SF', 'PF', 'C'] },
    defaultSlots: ['PG', 'SG', 'G', 'SF', 'PF', 'F', 'C', 'FLX'],
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
    soonTabs: [], // tabs this sport doesn't have yet
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
    key: 'nhl', name: 'NHL', data: 'data/nhl/', fantrax: 'NHL',
    positions: ['C', 'LW', 'RW', 'D', 'G'],
    slotTypes: ['C', 'LW', 'RW', 'W', 'F', 'D', 'G', 'FLX'],
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
    soonTabs: ['recap', 'draft', 'awards', 'trade'],
    // added to an (i) popup
    infoMore: {
      win: `<p><b>Goalies.</b> A goalie counts by his chance of starting each game: his share of his team's recent starts, much lower the night after he plays (a team's goalie started both games of a back-to-back 7% of the time in 2025-26), lower after any start. Once ESPN names the starter, that's who counts. This week's starts usually come within about one of the guess.</p>`,
      dots: `<p>A goalie's games show his team's schedule: hover a game for his chance of starting it. The number on the right is the starts he's expected to play.</p>`,
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
// a hockey player who plays goal
const isGoalie = p => isHockey() && !!p && (p.pos || []).includes('G');
