"use strict";
var bouncer = require('koa-bouncer');
var cors = require('koa-cors')({
  // Seconds to cache preflight
  maxAge: 24 * 60 * 60  // 24 hours
});
var debug = require('debug')('app:middleware');
var assert = require('better-assert');
var _ = require('lodash');
var recaptcha = require('../recaptcha');


var belt = require('../belt');
var config = require('config');
var db = require('../db');
var presenters = require('./presenters');



// Assoc ctx.currUser if the sessionId cookie (UUIDv4 String)
// is an active session.
exports.wrapCurrUser = function() {
  return function *(next) {
    var sessionId = this.cookies.get('sessionId');
    debug('[wrapCurrUser] sessionId: ' + sessionId);
    if (! sessionId) return yield next;
    var user = yield db.findUserBySessionId(sessionId);
    if (user)
      this.currUser = presenters.presentUser(user);
    if (user) {
      debug('[wrapCurrUser] User found');
    } else {
      debug('[wrapCurrUser] No user found');
    }
    yield* next;
  };
};

// Expose req.flash (getter) and res.flash = _ (setter)
// Flash data persists in user's sessions until the next ~successful response
exports.wrapFlash = function(cookieName) {
  return function *(next) {
    var data, tmp;
    if (this.cookies.get(cookieName)) {
      tmp = decodeURIComponent(this.cookies.get(cookieName));
      // Handle bad JSON in the cookie, possibly set by fuzzers
      try {
        data = JSON.parse(tmp);
      } catch(e) {
        this.cookies.set(cookieName, null);
        data = {};
      }
    } else {
      data = {};
    }

    Object.defineProperty(this, 'flash', {
      enumerable: true,
      get: function() {
        return data;
      },
      set: function(val) {
        this.cookies.set(cookieName, encodeURIComponent(JSON.stringify(val)));
      }
    });

    yield* next;

    debug('status: ' + this.response.status);
    if (this.response.status < 300) {
      this.cookies.set(cookieName, null);
    }
  };
};

// This middleware ensures that this.request.body.passcode is valid.
// If invalid, then it just redirects back to the referring page with a flash
// error.
// Inject it after ensureCurrUser middleware since it depends on currUser.
exports.ensureMFAPasscode = function*(next) {
  debug('Ensuring MFA Passcode');
  assert(this.currUser, 'this.currUser must be loaded before this middleware');

  // User has MFA enabled
  if (this.currUser.mfa_key) {
    var passcode = this.request.body.passcode;
    // Ensure user has supplied a passcode
    if (! passcode) {
      this.flash = { message: ['danger', 'That is not the 2FA passcode we expected. Try again.'] };
      return this.response.redirect('back');
    }
    var expectedPasscode = belt.generateMfaPasscode(this.currUser.mfa_key);
    // Ensure user has supplied expected passcode
    if (passcode !== expectedPasscode) {
      this.flash = { message: ['danger', 'That is not the 2FA passcode we expected. Try again.'] };
      return this.response.redirect('back');
    }
    // Ensure user hasn't recently used this passcode
    try {
      yield db.insertMFAPasscode(this.currUser.id, passcode);
      return yield next;
    } catch(ex) {
      if (ex === 'PASSCODE_ALREADY_USED') {
        this.flash = {
          message: ['danger', 'You have already used this passcode recently. Wait until it refreshes (Every 30 seconds) and try again.']
        };
        return this.response.redirect('back');
      }
      throw ex;
    }
  }

  // User doesn't have MFA enabled
  yield* next;
};

exports.ensureRecaptcha = function*(next) {
	if (config.get('ENV') === 'development' && !this.request.body['g-recaptcha-response']) {
		console.log('Skipping recaptcha check, for dev');
		yield* next;
		return;
	}

	this.validateBody('g-recaptcha-response').notEmpty('You must attempt the human test');

	try {
		yield recaptcha.ensure(config.get('RECAPTCHA_SITESECRET'), this.vals['g-recaptcha-response'], this.request.ip);
	} catch (ex) {
		console.warn('Got invalid captcha: ', this.vals['g-recaptcha-response'], ex);
		this.validateBody('g-recaptcha-response').check(false, 'Could not verify recaptcha was correct');
		return;
	}

	yield* next;
};



exports.ensureCurrUser = function*(next) {
  debug('Ensuring currUser, next is: ', next);

  if (! this.currUser) {
    console.warn('User unauthorized, redirecting to /login');

    // Set redirectToPath cookie so that user will be redirected to their
    // attempted destination after logging in
    belt.setRedirectToPath(this);

    this.flash = { message: ['danger', 'You must login to do that'] };
    return this.response.redirect('/login');
  }

  // Exposed so that routes/views know when they're on a protected path.
  // For example, the logout mechanism, when user is logging out, does not
  // want to redirect the user back to a route that requires user to be logged in
  this.state.isEnsureCurrUser = true;

  yield* next;
};

exports.ensureAdmin = function*(next) {

  if (!this.currUser || this.currUser.role !== 'admin') {
    console.warn('Admin unauthorized, redirecting to /');
    this.flash = {
      message: ['danger', 'Unauthorized']
    };
    return this.response.redirect('/');
  }

  yield* next;
};

exports.methodOverride = function() {
  return function*(next) {
    if (_.isUndefined(this.request.body))
      throw new Error('methodOverride middleware must be applied after the body is parsed and this.request.body is populated');

    if (this.request.body && this.request.body._method) {
      this.method = this.request.body._method.toUpperCase();
      delete this.request.body._method;
    }

    yield* next;
  };
};



exports.v1Middleware = function*(next) {
  try {
    // Apply CORS to downstream middleware
    yield* cors.call(this, next);
  } catch (ex) {
    debug('/v1/ caught: ', ex);

    if (ex instanceof bouncer.ValidationError) {
      debug('Validation error: ', ex);
      this.status = 400;
      this.body = { error: ex.message, field: ex.name };
    } else if (typeof ex === 'string') {
      this.status = 403;
      this.body = { error: ex };
    } else
      throw ex;
  }


};

exports.deprecate = function*(next) {
  console.warn('Route is deprecated: ', this.path);
  yield* next;
};

// Adds .state.auth to a request, throwing if it doesn't have an auth
//   auth contains 'type' of either 'token' or 'confidential'
exports.ensureAuth = function*(next) {
  var auth;

  if (this.request.query['access_token']) {
    this.validateQuery('access_token').checkPred(belt.isValidUuid);

    auth = yield db.getAuthByAccessToken(this.vals['access_token']);
    if (!auth)
      throw 'INVALID_ACCESS_TOKEN';
    auth.type = 'token';

  } else {
    this.validateQuery('app_secret').checkPred(belt.isValidUuid);
    this.validateQuery('auth_id').toInt().gt(0);

    auth = yield db.findAuthByIdAndAppSecret(this.vals['auth_id'], this.vals['app_secret']);
    if (!auth)
      throw 'INVALID_AUTH_ID_OR_SECRET';
    auth.type = 'confidential';
  }

  if (!auth.enabled)
    throw 'AUTH_NOT_ENABLED';

  this.state.auth = auth;
  yield* next;
};

////////////////////////////////////////////////////////////

// Checks to see if this.request.body.password hashes
// to this.currUser.digest
exports.ensurePassword = function*(next) {
  this.validate(this.currUser, 'You must be logged in');

  this.validateBody('password')
    .notEmpty('Your password is required')
    .isString()
    .check(yield belt.checkPassword(this.vals.password, this.currUser.digest));

  yield next;
};
