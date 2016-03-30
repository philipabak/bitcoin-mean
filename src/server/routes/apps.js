"use strict";
var assert = require('better-assert');
var belt = require('../../belt');
var busboy = require('co-busboy');
var db = require('../../db');
var debug = require('debug')('app:routes:apps');
var fs = require('fs');
var gm = require('gm');
var path = require('path');
var pre = require('../presenters');
var Router = require('koa-router');
var _ = require('lodash');
var mw = require('../middleware');

var router = new Router();

router.param('slug', function*(slug, next) {
  // Ensure slug parses into integer
  // e.g. '33-my-app' -> 33
  var id = belt.parseU53(slug);
  this.assert(id, 404);

  var app = yield db.findAppById(id);
  this.assert(app, 404);

  this.currApp = pre.presentApp(app);


  this.currAuth = this.currUser ? pre.presentAuth(
       yield db.findAuthForUserIdAndAppId(this.currUser.id, this.currApp.id)
  ) : null;


  // If currUser is an active staffmember of currApp,
  // then this will be set to the relevant record in the app_staff table.
  if (this.currUser) {
    this.currUserStaffRecord = _.find(this.currApp.app_staff, {
      user_id: this.currUser.id
    });
  }

  yield next;
});

// Ensure that currUser has privs to manage app
// They must be an owner
var ensureAppOwnership = function*(next) {
  this.assert(this.currUser, 403);
  if (this.currUser.role !== 'admin')
    this.assert(this.currUserStaffRecord && this.currUserStaffRecord.role === 'OWNER', 403);

  // We don't want logout button to redirect back to protected routes
  this.state.isEnsureCurrUser = true;

  yield* next;
};


router.get('/apps/thumbnails/:hash', function*() {
  this.validateParam('hash').match(belt.sha256HashRegex, 'You did not provide a valid hash');
  var thumb = yield db.getAppThumbnailByHash(this.vals['hash']);
  if (!thumb) {
    this.status = 404;
    this.body = 'Not found';
    return;
  }
  // filename is a hash, we can cache forever!
  this.set('Cache-Control', 'max-age=31536000');
  this.type = 'image/png';
  this.body = thumb;
});


//
// Render new-app form
//
router.get('/apps/new', function*() {
  this.assert(this.currUser, 403);

  yield this.render('app_new', {
    ctx: this,
    title: 'New App'
  });
});

//
// Create app for this user
//
router.post('/apps', function*() {
  this.assert(this.currUser, 403);

  // Validate params
  this.validateBody('name')
    .notEmpty('Name is required')
    .trim()
    .isLength(1, 50, 'Name must be no more than 50 characters');

  var redirectUris;
  if (this.request.body['redirect-uris'])
    redirectUris = this.request.body['redirect-uris'].split('\n').map(function(str) {
      return str.trim();
    });

  this.validateBody('recaptcha-secret').trim().isLength(0,200);
  var recaptchaSecret = this.vals['recaptcha-secret'].length === 0 ? null : this.vals['recaptcha-secret'];

  this.validateBody('description').default('').isLength(0, 140);

  // Validation succeeded, create app
  var app;

  try {
    app = yield db.createApp({
      user_id: this.currUser.id,
      name: this.vals.name,
      redirect_uris: redirectUris,
      recaptca_secret: recaptchaSecret,
      description: this.vals['description']
    });
  } catch (ex) {
    this.validateBody('name').check(ex.code !== '23505', 'Must have a unique name for your account');
    throw ex;
  }
  app = pre.presentApp(app);

  this.flash = { message: ['success', 'App created'] };
  this.response.redirect('/apps/' + app.id);
});

//
// List apps
//
// Show list of apps
router.get('/apps', function*() {
  // TODO: Paginations and filters

  // Array of apps that currUser is staff of (mod or owner)
  var staffedApps = [];
  if (this.currUser) {
    staffedApps = yield db.findStaffedAppsWithAuthForUserId(this.currUser.id);
    staffedApps = staffedApps.map(record => {
      pre.presentApp(record.app);
      pre.presentAuth(record.auth);
      return record;
    });
  }

  var auths = [];
  if (this.currUser) {
    auths = yield db.findAuthsAndAppsByUserId(this.currUser.id);
    auths = auths.map(pre.presentAuth);
  }

  // Counts (sloppy)
  var enabledAppsCount = 0;
  var disabledAppsCount = 0;
  auths.forEach(function(auth) {
    if (auth.enabled) {
      ++enabledAppsCount;
    } else {
      ++disabledAppsCount;
    }
  });
  // Consider ownedApps with null auth as "disabled"
  staffedApps.forEach(function(app) {
    if (!app.auth) {
      ++disabledAppsCount;
    }
  });



  // TODO: This view/route is kinda nasty since we have a list of auths and a list
  // of owned apps, so everything is special cased between them
  yield this.render('app_list', {
    ctx: this,
    staffedApps: staffedApps,
    disabledAppsCount: disabledAppsCount,
    enabledAppsCount: enabledAppsCount,
    auths: auths,
    title: 'Apps'
  });
});

// Show app profile
// - `slug` is `{{id}}-{{appSlug}}`
router.get('/apps/:slug', function*() {
  var self = this;
  var tasks = {
    history: db.appHistory(this.currApp.id),
    stats: db.appStats(this.currApp.id),
    activeStaff: db.getActiveStaffForAppId(this.currApp.id),
    auth: this.currAuth
  };

  var results = yield tasks;
  var bets = pre.presentAppBets(results.history);
  var stats = results.stats;
  var auth = results.auth;

  // Handle canonical redirect
  if (this.params.slug !== this.currApp.slug) {
    this.status = 301;
    this.redirect(this.currApp.url);
    return;
  }

  // If user is not logged in and clicks "login"/"register" from here,
  // they'll return to this app when they complete the form.
  belt.setRedirectToPath(this);

  // yield this.render('show_app', {
  yield this.render('app_show', {
    ctx: this,
    app: this.currApp,
    auth: auth,
    stats: stats,
    activeStaff: results.activeStaff,
    title: this.currApp.name,
    bets: bets
  });
});

router.get('/apps/:slug/owner', ensureAppOwnership, function*() {
  this.currApp.secret = yield db.getAppSecretById(this.currApp.id);

  yield this.render('app_owner', {
    ctx: this,
    app: this.currApp,
    auth: this.currAuth,
    title: 'Admin ' + this.currApp.name
  });
});

var currUserCanDemoteStaffUser = function(app_staff, currUserId, otherStaffUserId) {
  assert(_.isArray(app_staff));
  assert(Number.isInteger(currUserId));
  assert(Number.isInteger(otherStaffUserId));

  var currStaffUser = _.find(app_staff, { user_id: currUserId });

  // Only owners can manage staff
  if (currStaffUser.role !== 'OWNER') {
    return false;
  }

  // owners can always demote themselves
  // TODO: allow mods to self-demote
  if (currUserId === otherStaffUserId) {
    return true;
  }

  var otherStaffUser = _.find(app_staff, { user_id: otherStaffUserId });

  // Any owners can demote any mods
  if (otherStaffUser.role === 'MOD') {
    return true;
  }

  // currUser and otherUser are both owners.
  // Owner can only demote another owner if other owner was created after them
  return currStaffUser.created_at < otherStaffUser.created_at;
};

// body: user_id: Int
router.del('/apps/:slug/staff', ensureAppOwnership, function*() {
  this.validateBody('user_id')
    .notEmpty('user_id required')
    .toInt('Invalid user_id');

  // TODO: Test this
  if (!currUserCanDemoteStaffUser(this.currApp.app_staff, this.currUser.id, this.vals.user_id)) {
    this.status = 403;
    this.body = 'You do not have permission to demote that user';
    return;
  }

  yield db.demoteAppStaff({
    app_id: this.currApp.id,
    user_id: this.vals.user_id,
    demoted_by_user_id: this.currUser.id
  });

  this.flash = { message: ['success', 'Successfully demoted user'] };

  // if user self-demoted, don't redirect back to staff page since it'll 404
  if (this.currUser.id === this.vals.user_id) {
    this.redirect('/apps/' + this.currApp.id);
  } else {
    this.redirect('/apps/' + this.currApp.id + '/staff');
  }
});

// uname: String
// role: 'MOD' | 'OWNER'
router.post('/apps/:slug/staff', ensureAppOwnership, function*() {

  this.validateBody('uname')
    .notEmpty('Must provide a username')
    .toLowerCase();

  this.validateBody('role')
    .notEmpty('Must specify a role')
    .isIn(['OWNER', 'MOD'], 'Invalid role');

  var user = yield db.findUserByUname(this.vals.uname);

  // Ensure user is found
  this.validateBody('uname').check(user, 'User not found with that username');

  // Ensure user isn't already a staff member
  var staff = yield db.getActiveStaffForAppId(this.currApp.id);
  var isStaffMember = _.find(staff, function(staff_user) {
    return staff_user.uname.toLowerCase() === this.vals.uname;
  }, this);

  this.validateBody('uname').checkNot(isStaffMember, 'User already a staff member');

  // Validation success, so create staff member

  yield db.insertAppStaff({
    app_id: this.currApp.id,
    role: this.vals.role,
    appointed_by_user_id: this.currUser.id,
    user_id: user.id
  });

  this.flash = { message: ['success', 'Successfully appointed user'] };
  this.redirect('/apps/' + this.currApp.id + '/staff');
});


router.get('/apps/:slug/staff', ensureAppOwnership, function*() {
  this.currApp.secret = yield db.getAppSecretById(this.currApp.id);

  var activeStaff = yield db.getActiveStaffForAppId(this.currApp.id);
  activeStaff = activeStaff.map(pre.presentUser);

  var demotedStaff = yield db.getDemotedStaffForAppId(this.currApp.id);
  demotedStaff = demotedStaff.map(pre.presentUser);


  yield this.render('app_staff', {
    ctx: this,
    app: this.currApp,
    auth: this.currAuth,
    activeStaff: activeStaff,
    demotedStaff: demotedStaff,
    currUserCanDemoteStaffUser: currUserCanDemoteStaffUser,
    title: 'Admin ' + this.currApp.name
  });
});

router.get('/apps/:slug/edit', ensureAppOwnership, function*() {
  yield this.render('app_edit', {
    ctx: this,
    app: this.currApp,
    auth: this.currAuth,
    title: 'Edit ' + this.currApp.name
  });
});

router.get('/apps/:slug/history', ensureAppOwnership, function*() {
  var bets = yield db.appHistory(this.currApp.id);
  bets = pre.presentAppBets(bets);

  yield this.render('app_history', {
    ctx: this,
    app: this.currApp,
    auth: this.currAuth,
    bets: bets,
    title: 'History for ' + this.currApp.name
  });
});

router.get('/apps/:slug/fundings', ensureAppOwnership, function*() {
  var fundings = yield db.findFundingsForAppId(this.currApp.id);

  yield this.render('app_fundings', {
    ctx: this,
    app: this.currApp,
    fundings: fundings,
    auth: this.currAuth,
    title: 'Fundings for ' + this.currApp.name
  });
});

//
// Update app
//
router.put('/apps/:slug', ensureAppOwnership, function*() {
  this.validateBody('name').isLength(1, 200);

  var redirectUris = [];
  if (this.request.body['redirect-uris'])
    redirectUris = this.request.body['redirect-uris'].split('\n').map(function(str) {
      return str.trim();
    });

  this.validateBody('recaptcha-secret').trim().isLength(0,200);
  var recaptchaSecret = this.vals['recaptcha-secret'].length === 0 ? null : this.vals['recaptcha-secret'];

	this.validateBody('oauth-response-type').isIn(['token', 'confidential']);

  this.validateBody('description').default('').isLength(0, 140);

  yield db.updateApp(this.currApp.id, {
    name: this.vals['name'],
    redirect_uris: redirectUris,
    recaptcha_secret: recaptchaSecret,
	  oauth_response_type: this.vals['oauth-response-type'],
    description: this.vals['description']
  });

  this.flash = { message: ['success', 'App updated'] };
  this.response.redirect(this.currApp.url + '/edit');
});


function streamToImageBuffer(stream, maxFileSize, requiredWidth, requiredHeight) {
  return new Promise(function(resolve, reject) {
    var used = 0;

    stream.on('data', function(chunk) {
      used += chunk.length;
      if (used > maxFileSize) {
        debug('Sending filesize was too big');
        return reject('Filesize was too large');
      }

    });

    stream.on('error', function(e) {
      console.error('Got stream error: ', e, ' rejecting');
      reject(e);
    });

    var img = gm(stream)
      .size({ bufferStream: true }, function(err, size) {
        if (err) {
          console.error('Could not get image size', err);
          return reject('Unrecognized image');
        }

        if (size.width !== requiredWidth || size.height !== requiredHeight)
          return reject('Invalid image size');

        img.strip().toBuffer('png', function(err, buffer) {
          if (err) return reject(err);

          resolve(buffer);
        })
      });
  });
}

router.post('/apps/:slug/thumbnail', ensureAppOwnership, function*(next) {
  if (!this.request.is('multipart/*')) return yield next;

  var parts = busboy(this);

  var part;
  var buffer;

  while (part = yield parts) {
    try {
      buffer = yield streamToImageBuffer(part, 102400, 200, 108);
    } catch (ex) {
      if (typeof ex === 'string')
        return this.check(false, ex);

      console.error('[INTERNAL_ERROR] with image: ', ex);
      this.check(false, 'Was unable to process image');
    }
  }

  assert(buffer);
  yield db.updateAppThumbnail(this.currApp.id, buffer);

  this.flash = { message: ['success', 'Successfully updated thumbnail'] };
  this.redirect(this.currApp.url);
});


router.post('/apps/:slug/disable', ensureAppOwnership, function*() {

  yield db.disableApp(this.currApp.id);
  this.response.redirect(this.currApp.url + '/owner');
});

//
// - Move funds from current user into app's balance (Deposit)
//   or from app->wallet (Withdraw)
// - Logs these actions in the app_fundings table
//
// Body params:
// - bits: String (that is a float)

// Reminder: Keep in sync with /fundings/withdraw
router.post('/apps/:slug/fundings/withdraw', ensureAppOwnership, function*() {
  // Validate params

  this.validateBody('bits').toFloat().gt(0);

  // Update database
  // Note: DB expects negative amount for withdraw

  var negSatoshis = 0 - Math.round(this.vals.bits * 100);

  // this.validateBody('bits').check(this.currApp.id !== 14, 'App contains overdue loan, please contact support');

  try {
    yield db.fundApp(this.currUser.id, this.currApp.id, negSatoshis);
  } catch (ex) {
    this.validateBody('bits').check(ex !== 'NOT_ENOUGH_BALANCE', 'Do not have enough balance');
    throw ex;
  }

  // Redirect to app fundings page
  this.flash = { message: ['success', 'Successfully withdrew from app funds'] };
  this.redirect(this.currApp.url + '/fundings');
});

// Reminder: Keep in sync with /fundings/deposit
router.post('/apps/:slug/fundings/deposit', ensureAppOwnership, function*() {
  // Validate params

  this.validateBody('bits').toFloat().gt(0);

  // Update database

  var satoshis = Math.round(this.vals.bits * 100);

  try {
    yield db.fundApp(this.currUser.id, this.currApp.id, satoshis);
  } catch (ex) {
    this.validateBody('bits').check(ex !== 'NOT_ENOUGH_BALANCE', 'Do not have enough balance');
    throw ex;
  }

  // Redirect to app fundings page
  this.flash = { message: ['success', 'Successfully deposited into app funds'] };
  this.redirect(this.currApp.url + '/fundings');
});

////////////////////////////////////////////////////////////

router.post('/apps/:slug/secret', ensureAppOwnership, function*() {
  yield db.invalidateAppSecret(this.currApp.id);

  this.flash = { message: ['success', 'New secret generated'] };
  this.redirect('/apps/' + this.currApp.id);
});

////////////////////////////////////////////////////////////

// Only admins can access this
//
// Body:
// - domain: Required String. May be blank.
router.post('/apps/:slug/verified-domain', mw.ensureAdmin, function*() {
  this.validateBody('domain')
    .isString()
    .tap(x => x.trim())
    .tap(x => x.length === 0 ? null : x);

  yield db.updateAppVerifiedDomain(this.currApp.id, this.vals.domain);

  this.flash = { message: ['success', 'App updated'] };
  this.redirect(this.currApp.url);
});

////////////////////////////////////////////////////////////

module.exports = router;
