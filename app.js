var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
const cheerio = require('cheerio');
const axios = require('axios');
const gameUrls = require('./gameUrls.js');

// var indexRouter = require('./routes/index');
// var usersRouter = require('./routes/users');

var pgp = require('pg-promise')(/*options*/);
var db = pgp('postgres://bbansavage:pass@localhost:5432/ht_data_collector');

var app = express();

let gameData = {};
let queryString = '';

const teamHalfData = {
  twosmade: 0,
  twosatt: 0,
  threesmade: 0,
  threesatt: 0,
  ftmade: 0,
  ftatt: 0,
  oreb: 0,
  dreb: 0,
  ast: 0,
  tov: 0
}

const currentGameUrls = gameUrls['oct-nov'];
let gameIndex = -1;

populateGameData = () => {

  gameIndex++;

  if (gameIndex === currentGameUrls.length) {
    return console.log('DONE!')
  }

  const gameUrl = currentGameUrls[gameIndex];
  console.log('index', gameIndex, 'game', gameUrl)
  const gameData = { date: gameUrl.slice(0, 9) };
  const roadTeam = {};
  const homeTeam = {};
  let gameId;

  axios.get('https://www.basketball-reference.com/boxscores/pbp/' + gameUrl)
    .then(res => {
      let $ = cheerio.load(res.data);
      roadTeam.name = $('#pbp .thead').children('th')[2].children[0].data;
      homeTeam.name = $('#pbp .thead').children('th')[6].children[0].data;
      let cells = $('#pbp tbody').find('td');
      let eventTeam = '';
      let halfData = {
        road: Object.assign({}, teamHalfData),
        home: Object.assign({}, teamHalfData)
      }
      // console.log('43', halfData);
      let j;
      for (let i = 0; i < cells.length; i++) {
        j = 0;
        while (j < cells[i].children.length) {
          let value = cells[i].children[j].data;
          // check that cell is not undefined before proceeding
          if (value) {
            // location of cell relative to clock/score indicates road or home event
            if (value[value.length - 1] === '0' && value[value.length - 2] === '.') {
              eventTeam = 'road';
            }
            else if (value.indexOf('-') !== -1 && value[value.indexOf('-') + 1] !== 'p') {
              eventTeam = 'home';
            }
            // identify and log events
            else if (value.indexOf('makes 2-pt shot') !== -1) {
              halfData[eventTeam].twosmade++;
              halfData[eventTeam].twosatt++;
              if (value.indexOf('assist by') !== -1) {
                halfData[eventTeam].ast++;
              }
            }
            else if (value.indexOf('misses 2-pt shot') !== -1) {
              halfData[eventTeam].twosatt++;
            }
            else if (value.indexOf('makes 3-pt shot') !== -1) {
              halfData[eventTeam].threesmade++;
              halfData[eventTeam].threesatt++;
              if (value.indexOf('assist by') !== -1) {
                halfData[eventTeam].ast++;
              }
            }
            else if (value.indexOf('misses 3-pt shot') !== -1) {
              halfData[eventTeam].threesatt++;
            }
            else if (value.indexOf('Defensive rebound') !== -1) {
              halfData[eventTeam].dreb++;
            }
            else if (value.indexOf('Offensive rebound') !== -1) {
              halfData[eventTeam].oreb++;
            }
            if (value.indexOf('makes free throw') !== -1) {
              halfData[eventTeam].ftmade++;
              halfData[eventTeam].ftatt++;
            }
            if (value.indexOf('misses free throw') !== -1) {
              halfData[eventTeam].ftatt++;
            }
            if (value.indexOf('Turnover') !== -1) {
              halfData[eventTeam].tov++;
            }
            // record first half data at start of 2nd half
            else if (value === 'Start of 3rd quarter') {
              for (var key in halfData.road) {
                gameData['hfh' + key] = halfData.road[key];
              }
              for (var key in halfData.home) {
                gameData['rfh' + key] = halfData.home[key];
              }
              halfData = {
                road: Object.assign({}, teamHalfData),
                home: Object.assign({}, teamHalfData)
              }
            }
          }
          j++;
        }
      }
      for (var key in halfData.road) {
        gameData['hsh' + key] = halfData.road[key];
      }
      for (var key in halfData.home) {
        gameData['rsh' + key] = halfData.home[key];
      }
      queryString = `INSERT into teams (name) values ('${roadTeam.name}'), ('${homeTeam.name}') on conflict (name) do nothing;`;
      return db.query(queryString)
    })
    .then(() => {
      queryString = `SELECT id from teams where name = '${roadTeam.name}';` 
      return db.query(queryString)
    })
    .then((res) => {
      roadTeam.id = res[0].id;
      queryString = `SELECT id from teams where name = '${homeTeam.name}';` 
      return db.query(queryString)
    })
    .then((res) => {
      homeTeam.id = res[0].id;
      gameData.hteam_id = homeTeam.id;
      gameData.rteam_id = roadTeam.id;
      return db.query('INSERT INTO games (${this:name}) VALUES (${this:csv}) RETURNING id', gameData);
    })
    .then((res) => {
      gameId = res[0].id;
      axios.get('https://www.basketball-reference.com/boxscores/' + gameUrl)
        .then(res => {
          $ = cheerio.load(res.data);
          let teamAbbrvContainer = $('#all_line_score').children('.placeholder')[0].next.next.data;
          roadTeam.abbrv = teamAbbrvContainer.split('.html">')[1].slice(0, 3).toLowerCase();
          homeTeam.abbrv = teamAbbrvContainer.split('.html">')[2].slice(0, 3).toLowerCase();
          recordAllPlayerAppearances($(`#box_${roadTeam.abbrv}_basic tbody`).children('tr'), roadTeam.id, $(`#box_${homeTeam.abbrv}_basic tbody`).children('tr'), homeTeam.id, gameId);
          console.log('game data recorded!')
          delayedPopulateGameData();
        })
    })
}

recordAllPlayerAppearances = (roadTeamTable, roadTeamId, homeTeamTable, homeTeamId, gameId) => {

  let currentTeam = 'road';

  recordOnePlayerAppearance = (i, teamTable, teamId) => {
    if (i === teamTable.length) {
      if (currentTeam === 'road') {
        currentTeam = 'home'
        return recordOnePlayerAppearance(0, homeTeamTable, homeTeamId);
      } else {
        return 'done!';
      }
    } else if (teamTable[i] && teamTable[i].children[0].attribs) {
      let minutes = 0;
      if (teamTable[i].children[1].children[0].data !== 'Did Not Play') {
        minutes = teamTable[i].children[1].children[0].data;
        let seconds = parseInt(minutes.split(':')[1]) * 1.667;
        seconds = seconds.toFixed();
        minutes = parseFloat(minutes.split(':')[0] + '.' + seconds);
      }
      // remove escaped apostrophes
      let name = teamTable[i].children[0].attribs.csk.replace('\'', '');
      name = name.replace(',', '-')
      db.query(`INSERT into players (name) values ('${name}') on conflict (name) do nothing;`)
        .then(() => {
          return db.query(`SELECT id from players where name = '${name}';`)
        })
        .then((res) => {
          return db.query(`INSERT into appearances (player_id, team_id, game_id, minutes) VALUES ('${res[0].id}', '${teamId}', '${gameId}', '${minutes}') RETURNING id;`)
        })
        .then((id) => {
          return recordOnePlayerAppearance(i + 1, teamTable, teamId);
        })
    } else {
      return recordOnePlayerAppearance(i + 1, teamTable, teamId);
    }
  }
  return recordOnePlayerAppearance(0, roadTeamTable, roadTeamId);
}

const date = {month: '3', day: '1', year: '2018'}

populateGameUrls = () => {

  console.log('newdate', date)

  axios.get(`https://www.basketball-reference.com/boxscores/?month=${date.month}&day=${date.day}&year=${date.year}`)
    .then(res => {
      $ = cheerio.load(res.data);
      let links = $('.game_summaries .links a');
      if (links.length > 0) {
        i = 0;
        while (i < links.length) {
          gameUrls += links[i].attribs.href.slice(-17);
          gameUrls += ',';
          i += 3;
        }
      }
    })
    .then(() => {
      if (date.day === '31') {
        if (date.month === '12') {
          date.year = '2018';
          date.month = '1';
        } else {
          date.month = (parseInt(date.month) + 1).toString();
        }
        date.day = '1';
      } else {
        date.day = (parseInt(date.day) + 1).toString();
      }
      if (date.month === '4' && date.day === '12') {
        console.log('ALL DONE!', gameUrls.slice(0, -1))
      } else {
        delayedPopulateGameUrls();
      }
    })

}

delayedPopulateGameUrls = () => {
  setTimeout(populateGameUrls, 12000)
}

delayedPopulateGameData = () => {
  setTimeout(populateGameData, 12000)
}

// populateGameUrls();

// populateGameData('201804070CHI.html');

populateGameData()

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// app.use('/', indexRouter);
// app.use('/users', usersRouter);

module.exports = app;
