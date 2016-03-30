"use strict";
// 3rd party
var Router = require('koa-router');
var _ = require('lodash');
var debug = require('debug')('app:routes:auths');
// 1st party
var db = require('../../../db');
var belt = require('../../../belt');
var pre = require('../../presenters');


var mw = require('../../middleware');

var router = new Router({
  prefix: '/me/auths'
});
router.use(mw.ensureCurrUser);

router.param('auth', function*(id, next) {
  // Ensure id parses into integer
  id = belt.parseU53(id);
  this.assert(id, 404);

  var auth = yield db.getAuthById(id);
  this.assert(auth, 404);
  this.assert(auth['user_id'] === this.currUser.id, 403);

  this['currAuth'] = auth;

  yield next;
});

// Create an auth between user and app
//
// Required body params:
// - app_id: Int
router.post('/', function*() {
  this.validateBody('app_id').toInt();

  // Load app
  var app = yield db.findAppById(this.vals.app_id);
  this.assert(app, 404);

  // Create auth
  var auth;
  try {
    auth = yield db.createAuth(this.currUser.id, this.vals.app_id, 0, true);
  } catch (ex) {
    if (ex === 'AUTH_ALREADY_EXISTS')
      this.validateBody('app_id').check(false, 'App already authorized');

    throw ex;
  }

  this.flash = { message: ['success', 'App authorized'] };
  this.redirect('/apps/' + auth.app_id);
});

////////////////////////////////////////////////////////////
// Enable/Disable auth

router.post('/:auth/enable', function*() {
  var enabled = yield db.enableAuth(this.currAuth.id);
  this.check(enabled, 'Unable to enable the app. Please contact the app owner.');

  this.flash = { message: ['success', 'Authorization enabled'] };
  this.redirect('/apps/' + this.currAuth.app_id);
});

router.post('/:auth/disable', function*() {
  yield db.disableAuth(this.currAuth.id);

  this.flash = { message: ['success', 'Authorization disabled'] };
  this.redirect('/apps/' + this.currAuth.app_id);
});

// - `amount` is bits (positive Int)
// - `direction` is 'deposit' | 'withdraw'
// - Optional `redirectTo` is String
router.post('/:auth/fund', function*() {
  this.validateBody('direction').isIn(['deposit', 'withdraw']);
  this.validateBody('amount').toFloat().gt(0);
  this.validateBody('redirectTo').default('/apps/' + this.currAuth.app_id);

  // Adjust bit amount by direction and convert to satoshis
  var amount = Math.round(this.vals['amount'] * 100) * (this.vals['direction'] === 'withdraw' ? -1 : 1);

  try {
    yield db.fundAuth(this.currUser.id, this.currAuth.id, amount);
  } catch (ex) {
    if (ex === 'NOT_ENOUGH_BALANCE') {
      this.validateBody('amount').check(false, 'Do not have enough money');
    }

    throw ex;
  }

  this.flash = { message: ['success', 'Funds moved!'] };

  this.redirect(this.vals.redirectTo);
});

////////////////////////////////////////////////////////////

module.exports = router;
