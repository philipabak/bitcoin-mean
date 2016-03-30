"use strict";
// 3rd party
var co = require('co');
var Router = require('koa-router');
var assert = require('better-assert');
var debug = require('debug')('app:routes:me:send');
var uuid = require('node-uuid');
// 1st party
var mw = require('../../middleware');
var db = require('../../../db');
var belt = require('../../../belt');
var presenters = require('../../presenters');
var send = require('../../../send');

// All POST send endpoints now always require body.password

////////////////////////////////////////////////////////////

var router = new Router();
router.use(mw.ensureCurrUser);

////////////////////////////////////////////////////////////

router.post('/me/send/to-user', mw.ensureMFAPasscode, mw.ensurePassword, function *() {
  debug('Send to MoneyPot user:', this.request.body);

  this.validateBody('amount').toFloat().gt(0); // maybe be bitcoins
  this.validateBody('units').isIn(['bitcoin', 'bits']);
  this.validateBody('to').trim().isLength(2, 15, 'Username must be between 2 and 15 characters');
  this.validateBody('memo').default('').trim().isLength(0, 255);

  var amount = this.vals.amount;
  if (this.request.body.units === 'bitcoin')
    amount *= 1e8;
  else // bits
    amount *= 100;

  amount = Math.round(amount);

  this.validateBody('amount').check(amount >= 10000, 'Must send at least 100 bits');

  // Check password

  var toUname = this.vals.to;
  var toUser = yield db.findUserByUname(toUname);
  this.check(toUser, 'Could not find user you are sending to');

  this.check(this.currUser.id !== toUser.id, 'You can not send money to yourself');

  try {
    yield db.transferToUser(this.currUser.id, toUser.id, amount, this.vals['memo']);
  } catch (ex) {
    this.validateBody('amount').check(ex !== 'NOT_ENOUGH_BALANCE', 'You do not have enough balance');
    throw ex;
  }

  this.flash = { message: ['success', 'Money sent successfully'] };
  this.response.redirect('/me/history');
});

////////////////////////////////////////////////////////////

router.post('/me/send/to-bitcoin-address', mw.ensureMFAPasscode, mw.ensurePassword, function *() {
  this.validateBody('amount').toFloat().gt(0); // This might be bitcoins
  this.validateBody('units').isIn(['bitcoin', 'bits']);
  this.validateBody('to').trim().isLength(26, 35, 'Address length is not valid');
  this.validateBody('memo').default('').trim().isLength(0, 255);
  this.validateBody('id').isUuid();


  var amount = this.vals.amount;
  if (this.request.body.units === 'bitcoin')
    amount *= 1e8;
  else // bits
    amount *= 100;

  amount = Math.round(amount);

  this.validateBody('amount').check(amount >= 10000, 'Must send at least 100 bits');

  var toAddr = this.vals.to;

  this.validateBody('to').checkPred(belt.isValidBitcoinAddress, 'Invalid bitcoin address');

  var fee = 100 * 100; // 100 bits
  var withdrawalId;

  try {
    withdrawalId = yield db.makeWithdrawal(this.vals['id'], this.currUser.id, amount, fee, toAddr, this.vals['memo']);
    assert(withdrawalId);
  } catch (ex) {
    this.validateBody('amount').check(ex !== 'NOT_ENOUGH_BALANCE', 'You do not have enough money to send this (plus the fees)');
    this.validateBody('amount').check(ex !== 'WITHDRAWAL_ID_USED', 'It looks like you already tried to submit this withdrawal');

    throw ex;
  }

  this.flash = {message: ['success', 'Withdrawal has been queued for sending']};
  this.response.redirect('/withdrawals/' + withdrawalId);


  // In the background, process withdrawl
  var ctx = this;
  co(function*() {
    yield send.processWithdrawal(withdrawalId);
    debug('Withdrawal processed');
  }).catch(function(ex) {
    console.error('Error with async withdrawal: ', withdrawalId, ex);
    belt.logError(ex, ctx);
  });

});

// - Form for sending bitcoin from current wallet
router.get('/me/send', function *() {
  yield this.render('show_send', {
    ctx: this,
    title: 'Send',
    withdrawalId: uuid.v4()
  });
});

//
// GET /me/send/to-user
// - Form for sending bitcoin to another MoneyPot user
//
router.get('/me/send/to-user', function *() {
  yield this.render('show_send_to_user', {
    ctx: this,
    title: 'Send'
  });
});

module.exports = router;
