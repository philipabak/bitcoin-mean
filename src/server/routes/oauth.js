"use strict";
var util = require('util');
// 3rd party
var Router = require('koa-router');
var debug = require('debug')('app:oauth.js');
var _ = require('lodash');
var bouncer = require('koa-bouncer');
var assert = require('better-assert');
// 1st party
var belt = require('../../belt');
var config = require('../../db');
var db = require('../../db');
var pre = require('../../server/presenters');

var router = new Router();


// This function extends an app's redirect_uri with the parameters it needs
// to receive from the user being redirected, namely the access token.
// It has slightly different logic depending on the response_type.
var extendRedirectUri = function*(redirect_uri, state, response_type, auth_id) {
  assert(_.isString(redirect_uri));
  assert(_.isString(response_type));
  assert(_.isNumber(auth_id));
  // `state` is string or undefined

  var uri;

  switch(response_type) {
  case 'token':
    // Create a fresh, active access_token every time a user hits this route
    var accessToken = yield db.createToken(auth_id, 'access_token');
    uri = belt.mergeFragment('hash', redirect_uri, {
      access_token: accessToken.token,
      expires_in: belt.dateToSecondsFromNow(accessToken.expired_at),
      state: state
    });
    break;
  case 'confidential':
    var confidentialToken = yield db.createToken(auth_id, 'confidential_token');

    uri = belt.mergeFragment('search', redirect_uri, {
      confidential_token: confidentialToken.token,
      expires_in: belt.dateToSecondsFromNow(confidentialToken.expired_at),
      auth_id: auth_id, // TODO: deprecate
      state: state
    });
    break;
  default:
    throw Error('Unsupported response_type: ' + response_type);
  }

  return uri;

};

//
// App redirects user here to begin flow
//
// Must not redirect user if app gave us invalid params.
//
// Possible scenarios:
// - User is not logged in on vault
// - User is logged in on vault but has no granted authz for app
// - User is logged in on vault but already has granted authz for app
//
// Params:
// - response_type: code | token (Required)
//   Only support token (implicit flow
// - redirect_uri: (Optional) - If not given, defaults to app's first redirect_uri
//   Must match one of app.redirect_uris
// - app_id: (Required)
// - state: (Optional)
//
// Example:
//   http://localhost:3000/oauth/authorize?app_id=1&state=abc&redirect_uri=http://localhost:3001&response_type=token
router.get('/oauth/authorize', function*() {
  debug('query: ', this.request.query);

  var app;
  try {

    // Ensure app gave us app_id

    this.validateQuery('app_id')
      .notEmpty('Missing app_id')
      .toInt('Invalid app_id');

    // Ensure given app_id is linked to an app in the database

    app = yield db.findAppById(this.request.query.app_id);
    this.check(app, 'Invalid app_id');
    app = pre.presentApp(app);

    // Now check remaining params

    this.validateQuery('state');

    // If redirect_uri is given, ensure it is one of the apps.
    // Else, default to its first redirect_uri


    this.validateQuery('redirect_uri')
      .default(app.redirect_uris[0])
      .isIn(app.redirect_uris,
            'redirect_uri does not match any of the URIs configured by the app operator');

    this.validateQuery('response_type')
      .default(app.oauth_response_type)
      .eq(app.oauth_response_type, 'Unsupported response_type');

  } catch(ex) {
    if (ex instanceof bouncer.ValidationError) {
      yield this.render('oauth/authorize', {
        ctx: this,
        title: 'Authorize App',
        errorMessage: '<p>The app that directed you here did not supply a valid request.</p> <ul><li>Reason: ' + ex.message + '</li></ul> <p>Until the operator of the app complies with the MoneyPot API, you cannot authorize this app.</p>'
      });
      return;
    }
    throw ex;
  }

  // Now that we know the uri is at least valid. If user is not logged in
  // save the uri in redirectTo cookie (session cookie that will expire soon),
  // redirect them to login form.
  // They'll be redirected back here once they finish, and that
  // cookie should then be cleared.

  if (!this.currUser) {
    // Set redirectTo session cookie to save our progress
    belt.setRedirectToPath(this);

    // Adding ?app_id=x will trigger the onboarding info
    // so that user doesn't just land on some blank login
    // form where it's unclear just what they're logging into.
    this.redirect(util.format('/login?app_id=%s', app.id));
    return;
  }

  ////////////////////////////////////////////////////////////
  // Past this point, this.currUser is guaranteed to be logged in
  ////////////////////////////////////////////////////////////

  var auth = yield db.findAuthForUserIdAndAppId(this.currUser.id, app.id);

  // If currUser has no auth for this app, then create one.

  // TODO: this operation can fail, if the auth was created in between
  // TODO:  we should do a proper loop in the db function
  if (!auth)
    auth = yield db.createAuth(this.currUser.id, app.id, 0);

  if (auth.enabled) {
    // User already has enabled auth for this endpoint, so just redirect
    // them to the app so there's less friction.

    var uri = yield extendRedirectUri(
      this.vals.redirect_uri,
      this.vals.state,
      this.vals.response_type,
      auth.id
    );

    this.redirect(uri);
  } else {
    // Present user with authorization form/splash if auth is disabled which also
    // includes the case where it never existed until they arrived here

    yield this.render('oauth/authorize', {
      ctx: this,
      app: app,
      auth: auth,
      title: 'Authorize App',
      oauth: {
        state:        this.vals.state,
        redirect_uri: this.vals.redirect_uri,
	      response_type: this.vals.response_type
      }
    });
  }
});

////////////////////////////////////////////////////////////

//
// When a user submits the authorize-app form, the form
// is submitted to this route.
//
// Required Params
// - app_id
// - state
// - redirect_uri


router.post('/oauth/authorize', function*() {
  // Ensure user logged in
  this.assert(this.currUser, 403);

  this.validateBody('app_id')
    .notEmpty('App ID is required')
    .toInt('Invalid App ID').gt(0);
  this.validateBody('state');

  // Check app id
  var app = yield db.findAppById(this.vals.app_id);
  this.check(app, 'App does not exist');

  if (app.redirect_uris.length > 0)
    this.validateBody('redirect_uri')
      .default(app.redirect_uris[0])
      .isIn(app.redirect_uris,
          'redirect_uri does not match any of the URIs configured by the app operator');
  else
    this.validateBody('redirect_uri')
       .default(belt.defaultRedirectUri)
       .eq(belt.defaultRedirectUri);

	this.validateBody('response_type')
		.default(app.oauth_response_type)
		.eq(app.oauth_response_type, 'response_type does not match what the app supports');

  ////////////////////////////////////////////////////////////
  // Validation success. Creds are valid.
  ////////////////////////////////////////////////////////////

  var auth = yield db.findAuthForUserIdAndAppId(this.currUser.id, app.id);
  auth = pre.presentAuth(auth);

  // Ensure auth is found. This should only fail if a fuzzer posts directly.
  this.validateBody('app_id').check(auth, 'Auth required between you and this app');

	// If auth is disabled, then enable it
	if (!auth.enabled) {
    var enabled = yield db.enableAuth(auth.id);
    this.check(enabled, 'Unable to enable the app. Please contact the app owner.');
	}

  var uri = yield extendRedirectUri(
    this.vals.redirect_uri,
    this.vals.state,
    this.vals.response_type,
    auth.id
  );

	this.redirect(uri);

});


router.get('/oauth/debug', function*() {
  if (this.request.query['confidential_token'])
    this.validateQuery('confidential_token').isUuid();

  return yield this.render('oauth/debug', {
    ctx: this,
    confidential_token: this.vals['confidential_token']
  });
});



////////////////////////////////////////////////////////////

module.exports = router;
