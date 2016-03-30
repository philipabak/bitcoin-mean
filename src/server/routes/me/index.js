"use strict";
// Node
var nodeUrl = require('url');
// 3rd party
var assert = require('better-assert');
var Router = require('koa-router');
var _ = require('lodash');
var debug = require('debug')('app:routes');
var bouncer = require('koa-bouncer');
// 1st party
var mw = require('../../middleware');
var db = require('../../../db');
var belt = require('../../../belt');
var pre = require('../../presenters');


var router = new Router();

router.use(mw.ensureCurrUser);


////////////////////////////////////////////////////////////

router.get('/me', function *() {
  this.response.redirect('/me/account');
});

////////////////////////////////////////////////////////////

router.get('/me/history', function*() {
  this.redirect('/me/history/all');
});

////////////////////////////////////////////////////////////

router.get('/me/history/:what', function*() {
  // Validate :what param
  try {
    this.validateParam('what')
      .isIn(['all', 'deposits', 'send_tips', 'receive_tips', 'withdrawals', 'sends', 'receives', 'bets', 'faucets', 'investments'], 'Invalid history type');
  } catch(ex) {
    if (ex instanceof bouncer.ValidationError) {
      this.redirect('/me/history/all');
      this.flash = { message: ['danger', ex.message] };
      return;
    }
    throw ex;
  }

  var historyItems = yield db.getUserHistory(this.params.what, this.currUser.id);

  yield this.render('history_layout', {
    ctx: this,
    title: 'My History',
    history: historyItems
  });
});

////////////////////////////////////////////////////////////

router.get('/me/account', function *() {
  var tmp = [
    yield db.getBankroll(),
    yield db.getUsersBankrollStake(this.currUser.id)
  ];
  var bankroll = tmp[0];
  var stake = tmp[1];

  yield this.render('show_account', {
    ctx: this,
    title: 'Account',
    stakeAmount: bankroll.balance * stake
  });
});

//
// GET /me/wallets/:walletId/receive
// - Form for displaying/generating an address for current wallet
//
router.get('/me/receive', function *() {
  var walletAddrs = yield db.getUserAddresses(this.currUser.id);
  yield this.render('show_receive', {
    ctx: this,
    addresses: walletAddrs.map(pre.presentAddress),
    title: 'Receive'
  });
});

////////////////////////////////////////////////////////////

router.delete('/me/mfa', function *() {
  // TODO: Authz

  // Short-circuit if user doesn't have MFA enabled
  if (! this.currUser.mfa_key) {
    this.flash = {
      message: ['danger', 'You do not have 2FA enabled, so there is nothing to disable']
    };
    return this.response.redirect('/me/security');
  }

  // Ensure passcodes match
  var expectedPasscode = belt.generateMfaPasscode(this.currUser.mfa_key);
  if (this.request.body.passcode !== expectedPasscode) {
    this.flash = {
      message: ['danger', 'That is not the passcode we expected. Try again.']
    };
    return this.response.redirect('/me/security');
  }

  // Passcodes match, so delete this user's mfa_key
  yield db.deleteMfaKey(this.currUser.id);
  this.flash = {
    message: ['success', 'Two factor authentication successfully disabled']
  };
  this.response.redirect('/me/security');
});

////////////////////////////////////////////////////////////

router.post('/me/mfa', function *() {
  this.validateBody('secret-key')
    .notEmpty('Secret key is required');

  var expectedPasscode = belt.generateMfaPasscode(this.vals['secret-key']);

  this.validateBody('passcode')
    .notEmpty('Passcode is required')
    .eq(expectedPasscode,
        'The passcode you entered was not the one we expected. Try again.');

  if (this.errors) {
    this.flash = {
      message: ['danger', belt.extractErrors(this.errors)[0]],
      key: this.vals['secret-key']
    };
    this.response.redirect('/me/security');
    return;
  }

  // Validation successful
  // TODO: Authz

  // Passcodes match, so save their base32 key into db
  yield db.createMfaKey(this.currUser.id, this.vals['secret-key']);
  this.flash = {
    message: ['success', 'Two factor authentication was successfully enabled']
  };
  this.response.redirect('/me/security');
});

////////////////////////////////////////////////////////////

// POST /me/sessions/:sessionId/logout
// - Logs out a specific session
// - Use POST /me/logout for logging out currUser's curr session
// - Used on the /security panel to revoke other sessions
//
router.post('/me/sessions/:sessionId/logout', function *() {
  var sessionId = this.params.sessionId;
  this.assert(belt.isValidUuid(sessionId), 404);
  yield db.logoutSession(this.currUser.id, sessionId);
  this.flash = { message: ['success', 'Successfully terminated the session'] };
  return this.response.redirect('/me/security#active-sessions');
});

////////////////////////////////////////////////////////////

// Logs out currUser's curr session.
// Use POST /me/sessions/:sessionId/logout for logging out arbitrary session
// Used for the logout button
//
// Body params:
// - redirect_to: Optional, if given, then redirect there after logout
router.post('/me/logout', function *() {
  this.validateBody('redirect_to')
    .default('/')
    .tap(function(path) { return nodeUrl.parse(path).path; });

  yield db.logoutSession(this.currUser.id, this.cookies.get('sessionId'));
  belt.clearRedirectToPath(this);
  this.flash = { message: ['success', 'Session terminated'] };
  this.redirect(this.vals.redirect_to);
});

////////////////////////////////////////////////////////////

router.post('/me/invest', function*() {
  this.validateBody('amount')
    .toFloat()
    .gte(0.01, 'Amount must be at least 0.01 bits');

  var satoshis = Math.round(this.vals.amount * 100);

  try {
    yield db.invest(this.currUser.id, satoshis);
  } catch (ex) {
    if (ex === 'NOT_ENOUGH_BALANCE') {
      this.flash = {
        message: ['warning', "Don't have that much to invest (yet!)"]
      };
      this.response.redirect('/investment');
      return;
    }

    throw ex;
  }


  this.flash = { message: ['success', 'Investment a success!'] };
  this.response.redirect('/investment');
  return;
});

////////////////////////////////////////////////////////////

router.post('/me/divest', function*() {

  this.validateBody('amount').isIn(['partial', 'full']);

  // Ensure user is not locked out
  var lockout = yield db.getActiveLockoutForUserId(this.currUser.id);

  if (lockout) {
    this.flash = {
      message: ['danger', 'You cannot divest until your divestment lockout expires']
    };
    this.redirect('/investment');
    return;
  }

  ////////////////////////////////////////////////////////////

  var divest;

  if (this.vals['amount'] === 'partial') {
    this.validateBody('bits').toFloat().gt(0);
    var satoshis = Math.round(this.vals['bits'] * 100);
    divest = db.divest(this.currUser.id, satoshis);
  } else {
    divest = db.divestAll(this.currUser.id);
  }

  try {
    yield divest;
  } catch (ex) {
    if (ex.message == 'NOT_ENOUGH_BALANCE') throw ex;

    this.flash = {
      message: ['warning', "Don't have enough to divest"]
    };
    this.response.redirect('/investment');
    return;
  }

  this.flash = {
    message: ['success', 'Divested like a pro!']
  };
  this.response.redirect('/investment');
});

////////////////////////////////////////////////////////////
// Divestment lockouts
////////////////////////////////////////////////////////////

// Body:
// - days: Int, 1-60
// - password: String
router.post('/me/divestment-lockouts', mw.ensurePassword, function*() {

  // Validation

  this.validateBody('days')
    .notEmpty('Must provide a duration')
    .toInt('Invalid duration')
    .gte(1, 'Duration must be 1-30 days')
    .lte(60, 'Duration must be 1-30 days');

  // Attempt insertion

  let lockout;
  try {
    lockout = yield db.insertDivestmentLockout(this.currUser.id, this.vals.days);
  } catch(err) {
    if (err instanceof Error) {
      throw err;
    } else {
      this.flash = { message: ['danger', 'You are already locked out.'] };
    }
  }

  if (lockout) {
    this.flash = { message: ['success', 'You are now locked out.'] };
  }
  this.redirect('/investment');
});

////////////////////////////////////////////////////////////


module.exports = router;
