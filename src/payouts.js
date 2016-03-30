"use strict";
var assert = require('better-assert');
var ValidationError = require('koa-bouncer').ValidationError;


function error(str) {
  return new ValidationError('payouts', str);
}


// inclusive, exclusive

// This is from the players perspective
function Payouts(wager, payouts) {
  this.wager = wager;

  this.modifiers = [
    {index: 0, val: -wager}, // players loses wager
    {index: Math.pow(2, 32), val: wager} // player no longer loses wager (And importantly forces everything to process)
  ];

  if (!Array.isArray(payouts)) {
    throw error('Payouts is not an array');
  }
  if (payouts.length === 0) {
    throw error('Payouts needs at least one payout');
  }

  for (var i = 0; i < payouts.length; ++i) {

    var payout = payouts[i];
    if (typeof payout !== 'object')
      throw error('All payouts must be an object { from: ... , to: ... , value: ... }');


    if (!Number.isInteger(payout.from) || payout.from < 0)
      throw error('Invalid or missing `from` field in a payout object');

    if (!Number.isInteger(payout.to) || payout.to > Math.pow(2, 32) || payout.to < payout.from)
      throw error('Payout `to` is not valid');

    if (typeof payout.value !== 'number')
      throw error('Payout value is invalid');

    if (Object.keys(payout).length !== 3)
      throw error('Unreckognized field in payout (should only have from, to and value)');

    var diff = payout.to - payout.from;
    assert(diff >= 0);

    if (diff === 0)
      continue;

    this.modifiers.push({index: payout.from, val: payout.value}); // Players win this!
    this.modifiers.push({index: payout.to, val: -payout.value}); //Players no longer win it
  }

  this.modifiers.sort(function (a, b) {
    return a.index - b.index;
  });

}

// From players perspective
Payouts.prototype.getPayout = function (at) {
  var cum = 0;

  for (var i = 0; i < this.modifiers.length; ++i) {
    var modifier = this.modifiers[i];
    if (modifier.index <= at)
      cum += modifier.val;
    else
      break;
  }

  return cum;
};

// This returns from the **CASINOS PERSPECTIVE**
Payouts.prototype.getInfo = function () {
  var cum = 0;
  var ev = 0;

  var minProfit = 0; // The most we could lose
  var maxProfit = 0; // The most we can win

  var profitPossibilities = [];

  var at = 0;

  for (var i = 0; i < this.modifiers.length; ++i) {
    var modifier = this.modifiers[i];

    if (modifier.index !== at) {
      var probability = (modifier.index - at) / Math.pow(2, 32);
      var profit = -cum;
      profitPossibilities.push({profit: profit, probability: probability});
      ev += profit * probability;

      minProfit = Math.min(minProfit, profit);
      maxProfit = Math.max(maxProfit, profit);

      at = modifier.index;
    }

    cum += modifier.val;
  }

  assert(maxProfit <= this.wager);

  return {
    ev: ev,
    maxLoss: Math.abs(minProfit),
    maxWin: maxProfit,
    profitPossibilities: profitPossibilities
  };
};


module.exports = Payouts;
