"use strict";
//// Presenters
//// - Presenters are functions that transform/enhance canonical db data,
////   preparing them for the view layer.

// 1st party
var assert = require('better-assert');
// 3rd party
var belt = require('../belt');

// Ex: formatDate(d) -> '8 Dec 2014 16:24'
exports.formatDate = formatDate;
function formatDate(d) {
  var months = ["Jan", "Feb", "Mar", "Apr",
                "May", "Jun", "Jul", "Aug",
                "Sep", "Oct", "Nov", "Dec"];
  var mins = d.getMinutes();
  // Pad mins to format "XX". e.g. 8 -> "08", 10 -> "10"
  var paddedMins = mins < 10 ? '0' + mins : mins;
  return [
    d.getDate(),
    months[d.getMonth()],
    d.getFullYear(),
    d.getHours() + ':' + paddedMins
  ].join(' ');
}



////////////////////////////////////////////////////////////

exports.presentUser = function(user) {
  user.url = '/users/' + user.uname.toLowerCase();

  // Fix embedded json representation
  if (typeof user.created_at === 'string')
    user.created_at = new Date(user.created_at);

  return user;
};

exports.presentAttempt = function(attempt) {
  return attempt;
};

exports.presentAddress = function(addr) {
  addr.url = '/me/addresses/' + addr.address;
  return addr;
};

exports.presentApp = function(app) {
  if (!app) return app;

  if (typeof app.created_at === 'string')
    app.created_at = new Date(app.created_at);

  app.slug = belt.slugify(app.id, app.name);
  app.url = '/apps/' + app.slug;

  // If app has an embedded user, present it as well
  if (app.user) app.user = exports.presentUser(app.user);
  return app;
};

exports.presentSession = function(session) {
  session.url = '/me/sessions/' + session.id;
  session.isExpired = session.expired_at < new Date();
  return session;
};

exports.presentBet = function(bet) {
  bet.raw_outcome = (bet.secret + bet.client_seed) % Math.pow(2,32);
  bet.salt = bet.salt.toString('hex');
  if (bet.user)
    bet.user = exports.presentUser(bet.user);
  if (bet.app)
    bet.app = exports.presentApp(bet.app);


  if (bet.kind === 'simple_dice') {
    assert(bet.payouts.length === 1);
    var payout = bet.payouts[0];
    var chance = (payout.to - payout.from) / Math.pow(2,32);

    var increments = Math.pow(2,32)/10000;
    bet.outcome = Math.floor(bet.raw_outcome / increments) / 100;

    if (payout.from === 0) {
      bet.cond = '<';
      bet.target = belt.round10(chance*100, -2);
    } else {
      assert(payout.to === Math.pow(2,32));
      bet.cond = '>';
      bet.target = belt.round10(99.99 - chance*100, -2);
    }
  } else if (bet.kind === '101_dice') {
    assert(bet.payouts.length === 1);
    var payout = bet.payouts[0];
    var chance = (payout.to - payout.from) / Math.pow(2,32);

    var increments = Math.pow(2,32)/101;
    bet.outcome = Math.floor(bet.raw_outcome / increments);

    if (payout.from === 0) {
      bet.cond = '<';
      bet.target = Math.round(chance*101);
    } else {
      assert(payout.to === Math.pow(2,32));
      bet.cond = '>';
      bet.target = Math.round(100 - chance*101);
    }

  }

  return bet;
};

exports.presentAccessToken = function(a) {
  // Fix embedded json representation
  if (typeof a.expired_at === 'string')
    a.expired_at = new Date(a.expired_at);
  if (typeof a.created_at === 'string')
    a.created_at = new Date(a.created_at);

  return a;
};

exports.presentAuth = function(auth) {
  if (!auth) return auth;

  if (auth.access_token)
    auth.access_token = exports.presentAccessToken(auth.access_token);
  if (auth.app)
    auth.app = exports.presentApp(auth.app);

  return auth;
};

exports.presentAppBets = function(bets) {
  bets.forEach(function(bet) {
    if (bet.user)
      bet.user = exports.presentUser(bet.user);
  });

  return bets;
};
