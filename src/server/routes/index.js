"use strict";
// Node
var util = require('util');
var crypto = require('crypto');
// 3rd party
var assert = require('better-assert');
var AsciiTable = require('ascii-table');
var router = require('koa-router')();
var debug = require('debug')('app:routes:index');
var _ = require('lodash');
var fs = require('co-fs');
var marked = require('marked');
var bouncer = require('koa-bouncer');
// 1st party
var belt = require('../../belt');
var config = require('config');
var db = require('../../db');
var emailer = require('../emailer');
var middleware = require('../middleware');
var pre = require('../presenters');
var cache = require('../cache')();

// API docs

router.get('/api-docs', function*() {
	yield this.render('api-docs');
});

// 301 redirect the legacy api-docs url
router.get('/api-docs.html', function*() {
  this.status = 301;
  this.redirect('/api-docs');
});

////////////////////////////////////////////////////////////

router.get('/forgot', function*() {
	yield this.render('forgot', {
		ctx: this
	});
});

router.post('/forgot', middleware.ensureRecaptcha, function*() {
	// Validate
	this.validateBody('email').isEmail('Invalid email format');

	// Always send the same message on success and failure.
	var successMessage = 'If you have an account with this email, a recovery email will have been sent';

	// Check if it belongs to a user
	var user = yield db.findUserByEmail(this.request.body.email);
	debug('Found user for forgot: ', user);

	if (!user) {
		this.flash = { message: ['success', successMessage]};
		this.response.redirect('/');
		return;
	}

	// Don't send another email until previous reset token has expired
	if (yield db.findLatestActiveResetToken(user.id)) {
    debug('Found an existing reset token');
		this.flash = { message: ['success', successMessage] };
		this.response.redirect('/');
		return;
	}

	var resetToken = yield db.createResetToken(user.id);
  debug('Created reset token ' + resetToken.id + ' sending email');

  // Send email in background
	emailer.sendResetTokenEmail(user.uname, user.email, resetToken.id);

	this.flash = { message: ['success', successMessage] };
	this.response.redirect('/');
});



router.get('/reset-password', function*() {
	var resetToken = this.request.query.token;

	yield this.render('reset_password', {
		ctx: this,
		resetToken: resetToken
	});
});

router.post('/reset-password', function*() {
	this.validateBody('token').isUuid('Reset token is missing or malformed');
	this.validateBody('password2').notEmpty('Password confirmation required');
	this.validateBody('password1').eq(this.vals['password2']);

  var userId;
  try {
    // Check reset token
    userId = yield db.resetUserPasswordByToken(this.vals['token'], this.vals['password1']);
  } catch (ex) {
    if (ex === 'INVALID_RESET_TOKEN')
      this.check(false, 'Reset token is not valid, expired or already used');
    throw ex;
  }

	yield completeLogin(this, userId, false, 'Your password has been reset');
});

var faqCache;  // Holds html of rendered faq.md markdown
router.get('/faq', function*() {
  if (!faqCache) {
    faqCache = marked(yield fs.readFile('./views/faq.md', 'utf8'));
  }

  yield this.render('faq', {
    ctx: this,
    html: faqCache
  });
});

router.get('/provably-fair', function*() {
	yield this.render('provably_fair', {
		ctx: this
	});
});


function sha1(str) {
  var sum = crypto.createHash('sha1');
  sum.update(str);
  return sum.digest('hex');
}

function base64(str) {
  return (new Buffer(str)).toString('base64')
}

////////////////////////////////////////////////////////////
// Articles

router.get('/bitcoin-gambling', function*() {
  yield this.render('articles/bitcoin_gambling', {
    ctx: this,
    title: 'Bitcoin Gambling'
  });
});

router.get('/online-gambling-meets-bitcoin', function*() {
  yield this.render('articles/online_gambling_meets_bitcoin', {
    ctx: this,
    title: 'Online Gambling Meets Bitcoin'
  });
});

////////////////////////////////////////////////////////////


// Show bet public page
router.get('/bets/:id', function*() {
  this.validateParam('id').toInt();

  var bet = yield db.getPublicBetInfo(this.vals.id);

  // Ensure exists
  this.assert(bet, 404);

  bet = pre.presentBet(bet);

  yield this.render('show_public_bet', {
    ctx: this,
    bet: bet,
    title: 'Bet ' + bet.id
  });
});

router.get('/api/usernames/:prefix', function *() {
  this.validateParam('prefix').match(/^[a-z0-9_]{1,32}$/i, 'Invalid uname');

  var prefix = this.vals['prefix'];
  var unames = yield db.getUsernamesByPrefix(prefix);
  this.body = JSON.stringify(unames);
});

router.get('/', function*() {
  // If users navigate to api.moneypot.com in their browser,
  // let them know they probably meant www.moneypot.com
  if (this.request.headers['host'] === 'api.moneypot.com') {
    this.type = 'text/html';
    this.body = 'This is the API end point. Did you mean to go to <a href="https://www.moneypot.com">www.moneypot.com</a>?';
    return;
  }

  var results = yield {
    bankroll: db.getBankroll(),
    betsCount: db.getBetsCount()
  };

  results.bankroll.investorProfit = results.bankroll.balance - results.bankroll.invested;

  yield this.render('homepage', {
    ctx: this,
    bankroll: results.bankroll,
    betsCount: results.betsCount
  });
});

// Keep in sync with /register?app_id=Int
//
// Optional query param:
// - app_id: Int - If this is set, then display onboarding
//   info for this app to the user so they aren't just looking
//   at a blank form with no context.
router.get('/login', function*() {

  var app;
  if (this.query.app_id) {
    this.validateQuery('app_id')
      .toInt();
    app = yield db.findAppById(this.vals.app_id);

    // Ensure app was found
    this.assert(app, 404);
  }

  // If user is already logged in, redirect them back to /oauth/authorize
  if (this.currUser) {
    var url = app ? util.format('/oauth/authorize?app_id=%s', app.id) : '/me/account';
    this.redirect(url);
    return;
  }

  yield this.render('login', {
    ctx: this,
    app: app, // App | undefined
    hideLoginButtons: !!this.vals.app_id,
    title: 'Login'
  });
});

//


//
// POST /login
// - uname
// - password
// - passcode (Optional, the mfa passcode for this user)
// - remember-me (Optional, defaults to no)
//
router.post('/login', middleware.ensureRecaptcha, function*() {
  this.validateBody('uname').notEmpty('Username required');
  this.validateBody('password').notEmpty('Password required');
  this.validateBody('remember-me').toBoolean();

  var uname = this.vals['uname'];
  var password = this.vals['password'];
  var rememberMe = this.vals['remember-me'];

  // Check if user with this uname exists
  var user = yield db.findUserByUname(uname);
  if (!user) {
    this.flash = { message: ['danger', 'No such username'] };
    return this.response.redirect('/login');
  }
  debug('User with uname ', user.uname, ' found: ', user);


	var isCorrectPassword = yield belt.checkPassword(password, user.digest);
	debug('User\'s provided password matches the bcrypt digest: ', isCorrectPassword);


	// We want to record the fact they tried.
  var loginAttempt = yield db.createLoginAttempt({
    user_id:    user.id,
    user_agent: this.request.headers['user-agent'],
    ip_address: this.request.ip,
    is_success: isCorrectPassword
  });

  // If user is locked, tell them to contact customer support and then bail
  if (user.locked_at) {
    this.body = 'Account has been locked. Please contact customer support';
    return;
  }

  // Check if provided password matches digest
  if (!isCorrectPassword) {
    // User provided invalid uname/password combo, so log the failed attempt
    debug('Incorrect password attempt for : ', uname);
    this.flash = { message: ['danger', 'Invalid password'] };  // TODO: send the username to the form
    return this.response.redirect('/login');
  }


	if (user.mfa_key) {
		return yield this.render('login_mfa', {
			ctx: this,
			loginAttemptId: loginAttempt.id,
			rememberMe: rememberMe
		});
	}

	// User successfully authenticated (including MFA if they had it enabled)

	yield completeLogin(this, user.id, rememberMe, 'Logged in successfully');
});


router.post('/login_mfa', function*() {
	this.validateBody('login_attempt_id').isUuid('No valid login attempt id was found');
	this.validateBody('passcode').notEmpty('You must enter an MFA passcode');
	this.validateBody('remember-me').toBoolean();

	var user = yield db.findUserFromLoginAttemptId(this.vals['login_attempt_id']);

	console.log('User: ', user)

	if (!user) {
		this.validateBody('login_attempt_id').check(false, 'Invalid login attempt id');
		return;
	}

	if (user.locked_at) {
		this.body = 'Account has been locked. Please contact customer support';
		return;
	}

	if (!user['mfa_key']) {
		this.flash = { message: ['warning', 'MFA has been disabled for this account, pleas relogin'] };
		this.response.redirect('/login');
		return;
	}


	var expectedPasscode = belt.generateMfaPasscode(user.mfa_key);
	if (this.vals['passcode'] !== expectedPasscode) {
		// Passcode was wrong

		// Log the MFA failure
		yield db.createMfaAttempt({
			login_attempt_id: this.vals['login_attempt_id'],
			is_success: false
		});

		// If they have had 5 MFA failures in 30 seconds, lock user
		if (yield db.shouldLockUser(user.id)) {
			yield db.lockUser(user.id);
			this.body = 'Account locked due to too many failed multi-factor login attempts.';
			return;
		} else {
			// Else, redirect back to login MFA-step so they can try again
			return yield this.render('login_mfa', {
				ctx: this,
				alert: ['danger', 'That is not the passcode we expected. Try again.'],
				loginAttemptId: this.vals['login_attempt_id'],
				rememberMe: this.vals['remember_me']
			});
		}
	}

	// Passcode was correct. Now ensure it hasn't yet been used.
	try {
		yield db.insertMFAPasscode(user.id, this.vals['passcode']);

		// And log the MFA success
		yield db.createMfaAttempt({
			login_attempt_id: this.vals['login_attempt_id'],
			is_success: true
		});

	} catch (ex) {
		if (ex === 'PASSCODE_ALREADY_USED') {

			// Log the MFA failure
			yield db.createMfaAttempt({
				login_attempt_id: this.vals['login_attempt_id'],
				is_success: false
			});

			return yield this.render('login_mfa', {
				ctx: this,
				alert: ['danger', 'That is not the passcode we expected. Try again.'],
				loginAttemptId: this.vals['login_attempt_id'],
				rememberMe: this.vals['remember_me']
			});
		}
		throw ex;
	}

	yield completeLogin(this, user.id, this.vals['remember_me'], 'Login successful');

});





function* completeLogin(ctx, userId, rememberMe, msg) {
	// Create a session
	var session = yield db.createSession({
		user_id: userId,
		ip_address: ctx.request.ip,
		interval: (rememberMe ? '365 days' : '2 weeks')
	});
	debug('Session created: ', session);

	ctx.cookies.set('sessionId', session.id, {
		// Cookie will be a session cookie if remember-me is false
		expires: rememberMe ? belt.futureDate({ days: 365 }) : undefined,
		secure: false, //  See https://github.com/pillarjs/cookies/issues/51
		secureProxy: config.get('ENV') === 'production',  // TODO: This is a hack the relies on impl details.
		httpOnly: true
	});

	ctx.flash = { message: ['success', msg] };

	// Extract value from cookie
	var redirectToUrl = belt.getRedirectToPath(ctx);

	// Sync this with POST /users (registration)
	if (redirectToUrl) {
		// Clear the cookie
		belt.clearRedirectToPath(ctx);
	} else {
		redirectToUrl = '/me/account';
	}

	ctx.response.redirect(redirectToUrl);
}


// Keep in sync with /login?app_id=Int
router.get('/register', function*() {

  var app;
  if (this.query.app_id) {
    this.validateQuery('app_id')
      .toInt();
    app = yield db.findAppById(this.vals.app_id);

    // Ensure app was found
    this.assert(app, 404);
  }


  // If user is already logged in, redirect them back to /oauth/authorize
  if (this.currUser) {
    var url = app ?  util.format('/oauth/authorize?app_id=%s', app.id) : '/me/account';
    this.redirect(url);
    return;
  }

  if (app) {
    belt.setRedirectToPath(this, util.format('/oauth/authorize?app_id=%s', app.id));
  }

  yield this.render('register', {
    ctx: this,
    app: app, // App | undefined
    recaptchaSitekey: config.get('RECAPTCHA_SITEKEY'),
    hideLoginButtons: !!this.vals.app_id,
    title: 'Register'
  });
});

// Show user public profile
//
// - slug is lowercased uname
//   - if different, then 301 to canonical slug
router.get('/users/:slug', function*() {
  this.validateParam('slug');

  var user = yield db.findUserByUname(this.vals.slug);

  // Ensure user exists
  this.assert(user, 404);


  // Ensure canonical
  if (this.vals.slug !== user.uname.toLowerCase()) {
    this.status = 301;
    this.redirect('/users/' + user.uname.toLowerCase());
    return;
  }

  var publicStats = yield db.getUserPublicStats(user.id);

  for (var stat of publicStats) {
    stat.app = pre.presentApp(stat.app);
  }

  var privateStats = this.currUser && this.currUser.role === 'admin' ? yield db.getUserPrivateHistory(user.id) : null;

  yield this.render('show_public_user', {
    ctx: this,
    user: user,
    title: user.uname + '\'s Profile',
    public_stats: publicStats,
    private_stats: privateStats
  });
});

//
// POST /users (Create new user)
// - uname
// - password1
// - password2
// - email (Optional)
// - g-recaptcha-response
//
// If redirectTo cookie is set, redirect user there after
// registration and clear the cookie.
router.post('/users', middleware.ensureRecaptcha, function*() {
  this.validateBody('password2')
    .notEmpty('Password confirmation is required');
  this.validateBody('password1')
    .notEmpty('Password required')
    .isLength(6, 50, 'Password must be 6-50 characters')
    .eq(this.vals.password2, 'Password must match confirmation');

  if (this.request.body.email)
    this.validateBody('email')
      .isEmail('Invalid email format');

  this.validateBody('uname')
    .notEmpty('Username is required')
    .trim()
    .match(/^[a-z0-9_]+$/i, 'Username contains invalid characters')
    .notMatch(/[_]{2,}/i, 'Username contains consecutive underscores')
    .notMatch(/^[_]|[_]$/i, 'Username starts or ends with underscores')
    .isLength(2, 15, 'Username must be 2-15 characters long')
    .checkNot(yield db.findUserByUname(this.vals.uname), 'Username is taken');


  // User params validated, so create a user and log them in
  var user = yield db.createUser({
    uname: this.vals.uname,
    email: this.vals.email,
    password: this.vals.password1,
    ip_address: this.request.ip
  });

	assert(user);

	yield completeLogin(this, user.id, false, 'Registration a success');
});

router.get('/support', function*() {
  yield this.render('support', {
    ctx: this
  });
});

router.post('/support', middleware.ensureRecaptcha, function*() {
  this.validateBody('email').isEmail();
  this.validateBody('message')
    .trim()
    .notEmpty('Message required')
    .isLength(1, 3000, 'Message length must be 1 - 3,000 chars');

  var ip_address = this.request.ip;

  yield emailer.sendSupportEmail(this.currUser, this.vals['email'], this.vals['message'], ip_address);


  this.flash = { message: ['success', 'Thanks for getting in touch! We will get back to you as soon as possible'] };
  this.response.redirect('/support');

});

router.get('/proof-of-liabilities.txt', function*() {

  var table = new AsciiTable();

  table.setHeading('User Hash', 'Balance (bits)', 'Invested (bits)', 'In apps (bits)');
  table.setAlignRight(1);
  table.setAlignRight(2);
  table.setAlignRight(3);

  var liabilities = yield db.getProofOfLiabilities();

  var sum = 0;
  liabilities.forEach(function(liabilty) {
    table.addRow(liabilty.hash,
         belt.formatSatoshis(liabilty.balance, 2),
         belt.formatSatoshis(liabilty.invested, 2),
         belt.formatSatoshis(liabilty.in_apps, 2)
    );
    sum += liabilty.balance + liabilty.invested + liabilty.in_apps;
  });

  table.setTitle('Proof of ' + belt.formatSatoshis(sum) + ' bits of liabilities');


  this.response.body = table.toString();
});

router.get('/proof-of-assets.txt', function*() {
  var table = new AsciiTable();

  table.setHeading('Address', 'Balance (bits)', 'Signed "This is an address controlled by moneypot.com for the purpose of cold storage"');
  table.setAlignRight(1);
  table.setAlignRight(2);
  table.setAlignRight(3);


  table.addRow('1NinE5MNy64iUE6zBdJ2fJ2tfQrRs2ERpm',
    belt.formatSatoshis(500e8),
     'IFY2P2qtt9M7wj96/i57cOX2V4Vsel2qEfg2gchEQCNTOdhfHIp1uaBcpZv0MRZxZAZ0W24Ubz6/YyC3RJgefaU='
  );


  table.setTitle('Proof of ' + belt.formatSatoshis(500e8) + ' bits of assets');

  console.log(table.toString());

  this.response.body = table.toString();
});


////////////////////////////////////////////////////////////

// Redirect legacy /me/investment to /investment
router.get('/me/investment', function*() {
  this.status = 301;
  this.redirect('/investment');
});

router.get('/investment', function*() {
  var thunks = {};

  // Always get the bankroll for guests/users
  thunks.bankroll = db.getBankroll;

  // But only get stake and lockout if user is logged in
  if (this.currUser) {
    thunks.stake = db.getUsersBankrollStake(this.currUser.id);
    thunks.lockout = db.getActiveLockoutForUserId(this.currUser.id);
  }

  var results = yield thunks;

  yield this.render('profile_investment', {
    ctx: this,
    bankroll: results.bankroll,
    stake: results.stake,
    lockout: results.lockout
  });
});


{

  // These routes are for apps to provide a Deposit/Withdraw popup box

  // In event of koa-bouncer validation error, just render the message in
  // the popup
  let handleValidationError = function* (next) {
    try {
      yield next;
    } catch(ex) {
      if (ex instanceof bouncer.ValidationError) {
        this.body = ex.message;
        return;
      }
      throw ex;
    }
  };

  router.get('/dialog/deposit', handleValidationError, function*() {

    // Manually ensure a user is logged in
    if (!this.currUser) {
      this.body = 'You must be logged in to Moneypot to deposit into this app.';
      return;
    }

    this.validateQuery('app_id')
      .notEmpty('app_id is required')
      .toInt('Invalid app_id');

    var app = yield db.findAppById(this.vals.app_id);

    // Ensure app exists
    if (!app) {
      this.body = 'No app exists with the given ID.';
      return;
    }

    // Ensure user has an auth for this app.
    const auth = yield db.findAuthForUserIdAndAppId(
      this.currUser.id, this.vals.app_id
    );

    if (!auth) {
      this.body = 'You must add this app before you can deposit into it.';
      return;
    }

    // TODO: Auto-enable auth for user or give them an enable button
    // Ensure auth is enabled.
    if (!auth.enabled) {
      this.body = 'You must enable this app before you can deposit into it.';
      return;
    }

    // Get a deposit address for this user
    const address = yield db.getAuthDepositAddress(auth.id, this.currUser.id);

    yield this.render('dialog_deposit', {
      ctx: this,
      address: address,
      app: app,
      auth: auth,
      didBalanceUpdate: this.flash.message && this.flash.message[0] === 'success'
    });
  });

  router.get('/dialog/withdraw', handleValidationError, function*() {

    // Manually ensure a user is logged in
    if (!this.currUser) {
      this.body = 'You must be logged in to Moneypot to withdraw from this app.';
      return;
    }

    this.validateQuery('app_id')
      .notEmpty('app_id is required')
      .toInt('Invalid app_id');

    var app = yield db.findAppById(this.vals.app_id);

    // Ensure app exists
    if (!app) {
      this.body = 'No app exists with the given ID.';
      return;
    }

    // Ensure user has an auth for this app.
    const auth = yield db.findAuthForUserIdAndAppId(
      this.currUser.id, this.vals.app_id
    );

    if (!auth) {
      this.body = 'You must add this app before you can withdraw from it.';
      return;
    }

    // TODO: Auto-enable auth for user or give them an enable button
    // Ensure auth is enabled.
    if (!auth.enabled) {
      this.body = 'You must enable this app before you can withdraw from it.';
      return;
    }

    yield this.render('dialog_withdraw', {
      ctx: this,
      app: app,
      auth: auth,
      didBalanceUpdate: this.flash.message && this.flash.message[0] === 'success'
    });
  });
}

router.get('/full-stats.json', function*() {
  var t = yield [
    db.getBankroll(),
    db.getPublicAppsStats()
  ];

  this.body = {
    bankroll: t[0].balance,
    apps: t[1]
  }

});

router.get('/withdrawals/:id', function*() {
  this.validateParam('id').isUuid('Invalid withdrawal id');

  var withdrawal = yield db.getWithdrawal(this.vals['id']);
  this.assert(withdrawal, 404);

  yield this.render('show_public_withdrawal', {
    ctx: this,
    withdrawal: withdrawal
  });

});

module.exports = router;
