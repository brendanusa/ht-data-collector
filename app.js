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

const gameData = {};

axios.get('https://www.basketball-reference.com/boxscores/pbp/201804070CHI.html')
  .then(res => {
    let $ = cheerio.load(res.data);
    // console.log($('#pbp tbody').find('td').first())
    let cells = $('#pbp tbody').find('td');
    console.log(cells.length);
    var halfData = {
      road: {
        twosMade: 0,
        twosAtt: 0,
        threesMade: 0,
        threesAtt: 0,
        ftMade: 0,
        ftAtt: 0,
        oReb: 0,
        dReb: 0,
        ast: 0,
        tov: 0
      },
      home: {
        twosMade: 0,
        twosAtt: 0,
        threesMade: 0,
        threesAtt: 0,
        ftMade: 0,
        ftAtt: 0,
        oReb: 0,
        dReb: 0,
        ast: 0,
        tov: 0
      }
    }
    let eventTeam = '';
    let j;
    for (let i = 0; i < cells.length; i++) {
      // console.log('length', cells[i].children)
      // console.log(cells[i].children[0].data);
      j = 0;
      while (j < cells[i].children.length) {
        console.log('i', i, 'j', j)
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
            halfData[eventTeam].twosMade++;
            halfData[eventTeam].twosAtt++;
            if (value.indexOf('assist by') !== -1) {
              halfData[eventTeam].ast++;
            }
          }
          else if (value.indexOf('misses 2-pt shot') !== -1) {
            halfData[eventTeam].twosAtt++;
          }
          else if (value.indexOf('makes 3-pt shot') !== -1) {
            halfData[eventTeam].threesMade++;
            halfData[eventTeam].threesAtt++;
            if (value.indexOf('assist by') !== -1) {
              halfData[eventTeam].ast++;
            }
          }
          else if (value.indexOf('misses 3-pt shot') !== -1) {
            halfData[eventTeam].threesAtt++;
          }
          else if (value.indexOf('Defensive rebound') !== -1) {
            halfData[eventTeam].dReb++;
          }
          else if (value.indexOf('Offensive rebound') !== -1) {
            halfData[eventTeam].oReb++;
          }
          if (value.indexOf('makes free throw') !== -1) {
            halfData[eventTeam].ftMade++;
            halfData[eventTeam].ftAtt++;
          }
          if (value.indexOf('misses free throw') !== -1) {
            halfData[eventTeam].ftAtt++;
          }
          if (value.indexOf('Turnover') !== -1) {
            halfData[eventTeam].tov++;
          }
          // record first half data at start of 2nd half
          else if (value === 'Start of 3rd quarter') {
            gameData.firstHalf = Object.create(halfData);
          }
        }
        j++;
      }
    }
    gameData.secondHalf = halfData;
    console.log(gameData);

  })

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// app.use('/', indexRouter);
// app.use('/users', usersRouter);

module.exports = app;
