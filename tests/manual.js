var assert = require('chai').assert;
var co = require('co');
var lib = require('./lib');


co(function*() {
  var hash = yield lib.getHash();


  for (var i = 1; true; ++i) {
    console.time('Jackpot Bet');
    var response = yield lib.jackpotDiceBet(hash, 10000, 0, '<', 49);
    console.log(response.outcome);
    hash = response.hash;
    console.timeEnd('Jackpot Bet');

  }

}).then(console.log, console.error);


