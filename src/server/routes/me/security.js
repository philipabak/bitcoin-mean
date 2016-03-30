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

router.get('/me/security', function *() {
  // - If user has 2fa enabled then this.currUser.mfa_key will
  //   be available in teh view
  // - Else, a `potentialSecret` object will be available in the view
  //   with a `key` prop (base32 key) and a `qrSvg` prop which is a <svg>
  //   element that can be inserted directly into the html.
  var potentialSecret;
  if (! this.currUser.mfa_key) {
    potentialSecret = {};
    if (this.flash.key) {
      potentialSecret.key = this.flash.key;
    } else {
      potentialSecret.key = belt.generateMfaKey();
    }
    potentialSecret.qrSvg = belt.generateMfaQr(
      this.currUser.uname, potentialSecret.key
    );
  }

  var results = yield [
    db.findActiveSessions(this.currUser.id),
    db.findRecentSessions(this.currUser.id)
  ];
  var activeSessions = results[0];
  var recentSessions = results[1];
  yield this.render('profile_security', {
    ctx: this,
    potentialSecret: potentialSecret,
    activeSessions: activeSessions.map(presenters.presentSession),
    recentSessions: recentSessions.map(presenters.presentSession),
    currSessionId: this.cookies.get('sessionId'),
    currIpAddr: this.request.ip,
    title: 'Security'
  });
});

////////////////////////////////////////////////////////////

module.exports = router;
