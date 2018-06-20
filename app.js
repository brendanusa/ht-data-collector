var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
const cheerio = require('cheerio');
const axios = require('axios');

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

populateGameData = (gameUrl) => {

  const gameData = {};
  const roadTeam = {};
  const homeTeam = {};

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
      // console.log('125', gameData)
      // db.query('INSERT INTO test (${this:name}) VALUES (${this:csv}) RETURNING id', gameData);
    })
    .then(() => {
      console.log('130', roadTeam.name, homeTeam.name)
      queryString = `INSERT into teams (name) values ('${roadTeam.name}'), ('${homeTeam.name}') on conflict (name) do nothing;`;
      db.query(queryString)
    })
    .then(() => {
      queryString = `SELECT id from teams where name = '${roadTeam.name}';` 
      return db.query(queryString)
    })
    .then((result) => {
      roadTeam.id = result;
      queryString = `SELECT id from teams where name = '${homeTeam.name}';` 
      return db.query(queryString)
    })
    .then((result) => {
      homeTeam.id = result;
      console.log('145', roadTeam.id, homeTeam.id)
      axios.get('https://www.basketball-reference.com/boxscores/' + gameUrl)
        .then(res => {
          $ = cheerio.load(res.data);
          let teamAbbrvContainer = $('#all_line_score').children('.placeholder')[0].next.next.data;
          roadTeam.abbrv = teamAbbrvContainer.split('.html">')[1].slice(0, 3).toLowerCase();
          homeTeam.abbrv = teamAbbrvContainer.split('.html">')[2].slice(0, 3).toLowerCase();
          let roadminutes = populatePlayerMinutes($(`#box_${roadTeam.abbrv}_basic tbody`).children('tr'));
          // const queryString = `INSERT INTO test (rminutes) values (${roadminutes});`;
          // console.log('133', queryString)
          // db.query(queryString);
        })
        // .then(() => {
        //   return db.query('select rminutes from test where id = 16;');
        // })
    })
}

populatePlayerMinutes = (teamTable) => {
  teamMinutes = '[';
  for (i = 0; i < teamTable.length; i++) {
    // console.log('167', teamTable[i].children[0].attribs)
    if (teamTable[i].children[0].attribs) {
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
      teamMinutes += '\''
      teamMinutes += name
      teamMinutes += '\','
      teamMinutes += minutes
      teamMinutes += ','
      // teamMinutes.push(name)
      // teamMinutes.push(minutes);
    }
  }
  teamMinutes = teamMinutes.slice(0, -1);
  teamMinutes += ']'
  return teamMinutes;
}

let gameUrls = '';

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
  setTimeout(populateGameUrls, 10000)
}

// populateGameUrls();

populateGameData('201804070CHI.html');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// app.use('/', indexRouter);
// app.use('/users', usersRouter);

module.exports = app;
