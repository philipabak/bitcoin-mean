"use strict";
// 3rd party
var Router = require('koa-router');
// 1st party
var mw = require('../../middleware');
var db = require('../../../db');
var belt = require('../../../belt');
var presenters = require('../../presenters');

var router = new Router();
router.use(mw.ensureCurrUser);

////////////////////////////////////////////////////////////

router.get('/me/settings', function *() {
  var proofOfLiability = yield db.getUsersProofOfLiability(this.currUser.id);

  yield this.render('profile_settings', {
    ctx: this,
    title: 'Settings',
    proofOfLiability: proofOfLiability
  });
});

// Params: email
router.put('/me/settings/email', mw.ensurePassword, mw.ensureMFAPasscode, function *() {
  this.validateBody('email')
    .notEmpty('Email required')
    .isEmail('Invalid email format');

  // Validation success

  yield db.updateUserEmail(this.currUser.id, this.vals.email);
  this.flash = { message: ['success', 'Email updated'] };
  this.response.redirect('/me/settings');
});

// Body:
// - password  Required
// - new_password1 Required
// - new_password2 Required
router.put('/me/settings/password', mw.ensurePassword, function*() {
  this.validateBody('new_password2');
  this.validateBody('new_password1')
    .notEmpty('New password required')
    .isLength(6, 50, 'New password must be 6-50 characters')
    .eq(this.vals.new_password2, 'New password must match confirmation');

  yield db.updateUserPassword(this.currUser.id, this.vals.new_password1, this.cookies.get('sessionId'));

  this.flash = { message: ['success', 'Password updated'] };
  this.redirect('/me/settings');
});

////////////////////////////////////////////////////////////

module.exports = router;
