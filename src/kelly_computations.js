"use strict";
var assert = require('better-assert');


// This is all from the investors perspective
//    maxshift -- The most the app was willing to shift the payouts
//                  see computeKelly to see what shift is
//    bankroll -- how much money the investors have
//    maxLoss -- the biggest possible loss the investor can hit (from profitProbabilities)
//    maxWin  -- the biggest possible win the investor can hit (from profitProbabilities)
//    profitProbabilitites -- an array of [{ profit, probability}]
module.exports = function (maxShift, bankroll, maxLoss, maxWin, profitProbabilities) {

  assert(bankroll >= maxLoss);
  assert(maxLoss >= 0);
  assert(Number.isFinite(maxWin));
  assert(Array.isArray(profitProbabilities));

  // s is how much to shift the payouts
  //   a negative amount would mean that investors are paying to accept the bet
  //   a positive amount would be investors are being paid to accept the bet
  function computeKelly(s) {
    assert(s <= maxShift);
    assert(s >= -maxWin);

    // Calls f, with (probability, adjusted_profit)
    function forEachOutcome(f) {
      for (var i = 0; i < profitProbabilities.length; ++i) {
        var t = profitProbabilities[i];
        var profit = (t.profit + s) / (maxLoss - s);
        var probability = t.probability;

        f(probability, profit);
      }
    }

    // When risking x of the bankroll
    function bankrollGrowth(x) {
      var result = 0;
      forEachOutcome(function (probability, profit) {
        var r = probability * Math.log(1 + profit * x);
        result += r;
      });
      return result;
    }

    function bankrollGrowthDerivative(x) {
      var result = 0;
      forEachOutcome(function (probability, profit) {
        var r = probability * profit / (1 + profit * x);
        result += r;
      });
      return result;
    }

    //function sq(x) { return x*x; }
    //
    //function bankrollGrowthSecondDerivative(x) {
    //    var result = 0;
    //    forEachOutcome(function(probability, profit) {
    //        result -= probability * sq(profit) / sq(1 + profit*x);
    //    });
    //    return result;
    //}


    var r = bisectHigh(function (x) {
      return bankrollGrowthDerivative(x) < 0;
    }, 0, 1);

    return r;
  }

  function canAcceptBet(x) {
    return computeKelly(x) > (maxLoss / bankroll);
  }

  if (!canAcceptBet(maxShift))
    throw 'BANKROLL_TOO_SMALL';

  return bisectLow(canAcceptBet, -maxWin, maxShift);
};


// Bisect a range, and underguesses
function bisectLow(pred, low, high) {
  while (high - low > 1e-8) {
    var m = (high + low) / 2;

    if (pred(m)) {
      high = m;
    } else {
      low = m;
    }
  }
  return low;
}

// Bisects a range, and overguesses
function bisectHigh(pred, low, high) {
  while (high - low > 1e-8) {
    var m = (high + low) / 2;

    if (pred(m)) {
      high = m;
    } else {
      low = m;
    }
  }
  return low;
}
