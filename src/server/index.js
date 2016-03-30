"use strict";
var _ = require('lodash');
var assert = require('better-assert');
var belt = require('../belt');
var bodyParser = require('koa-bodyparser');
var bouncer = require('koa-bouncer');
var cache = require('./cache')();
var config = require('config');
var db = require('../db');
var debug = require('debug')('app:index');
var mw = require('./middleware');
var swig = require('swig');
var util = require('util');
var pre = require('./presenters');
var views = require('koa-views');


var app = require('koa')();

app.poweredBy = false;
app.proxy = true;
app.use(require('koa-static')('public'));

var requestCounter = 0;
app.use(function*(next) {
  let requestId = ++requestCounter;
  let ip = this.request.ip;
  let method = this.method;
  let path = this.path;
  let start = Date.now();

  // Add requestId to koa context
  this.state.requestId = requestId;

  // Log request
  console.log(util.format('id=%s <--Request ip=%s method=%s path=%s', requestId, ip, method, path));

  yield next;

  // Log response
  let status = this.status;
  let responseTime = Date.now() - start;
  console.log(util.format('id=%s Response--> status=%s ip=%s method=%s path=%s - time=%sms', requestId, status, ip, method, path, responseTime));
});

app.use(function*(next) {
  try {
    yield* next;
  } catch(err) {
    if (err && err.status) {
      this.response.status = err.status;
      var body = err.body || err.message || 'Unspecified error';
      this.body = { error: body };
      return;
    }
    belt.logError(err, this);

    this.response.status = 500;
    this.body = { error: 'INTERNAL_ERROR' };
    return;
  }
});


app.use(bodyParser({
  // Treat 'Content-Type: text/plain' body as JSON
  extendTypes: { json: ['text/plain'] }
}));

app.use(mw.methodOverride()); // Ensure this comes after body parser
app.use(mw.wrapCurrUser());

app.use(bouncer.middleware());


//  csfr

if (config.get('ENV') === 'production') {
  app.use(function*(next) {
    if (this.method === 'GET')
      return yield* next;

    if (!this.headers['referer'] || !this.headers['referer'].startsWith(config.get('HOST'))) {
      this.response.status = 403;
      this.response.body = 'Triggered csrf protection';
      return;
    }

    yield* next;
  });
}

app.use(function*(next) {
  this.set("Content-Security-Policy", "frame-ancestors 'none'");
  yield* next;
});

app.use(mw.wrapFlash('flash'));

////////////////////////////////////////////////////////////
// Validation middleware ///////////////////////////////////
////////////////////////////////////////////////////////////


app.use(function*(next) {
  try {
    yield next;
  } catch(ex) {
    if (ex instanceof bouncer.ValidationError) {
      console.warn(util.format('[requestId: %s] Caught validation error: %s'), this.state.requestId, ex);
      this.flash = {
        message: ['danger', ex.message || 'Validation error'],
        params: this.request.body
      };
      this.response.redirect('back');
      return;
    }

    throw ex;
  }
});

////////////////////////////////////////////////////////////
// Configure Swig templating ///////////////////////////////
////////////////////////////////////////////////////////////

swig.setDefaults({
  locals: {
    // Let views access the belt
    belt: belt,
    prod: config.get('ENV') === 'production',
    recaptchaSitekey: config.get('RECAPTCHA_SITEKEY'),
    getBannerAnnouncement: function() {
      return cache.get('banner-announcement');
    }
  }
});

app.use(views('../../views', {
  default: 'html',  // Default extension is .html
  cache: (process.env.NODE_ENV === 'production' ? 'memory' : undefined), // consolidate bug hack
  map: { html: 'swig' }
}));

// Expose custom helpers to Swig templates /////////////////

swig.setFilter('nbspPad', function(str, n) {
  var d = n - str.length;
  str = _.escape(str); // just to be safe
  for (var i = 0; i < d; ++i) {
    str = '&nbsp;' + str;
  }
  return str;
});

swig.setFilter('formatSatoshis', belt.formatSatoshis);

swig.setFilter('formatNumber', belt.formatNumber);



// {{ new Date()|formatDate }}  //=> 20 Jan 2015 14:13
swig.setFilter('formatDate', pre.formatDate);

// Returns the last segment of a path
//
// Ex:
//
//    '/'        -> ''
//    '/foo'     -> 'foo'
//    '/foo/bar' -> 'bar'
swig.setFilter('pathTail', function(path) {
  return _.last(path.split('/'));
});

// {{ 'hello'|endsWith('llo') }} -> true
swig.setFilter('endsWith', function(fullString, subString) {
  return (fullString || '').endsWith(subString);
});

// {{ thing|isIn(['a', 'b', 'c']) }} -> Bool
swig.setFilter('isIn', function(item, collection) {
  return _.contains(collection || [], item);
});

// {{ thing|isNotIn(['a', 'b', 'c']) }} -> Bool
swig.setFilter('isNotIn', function(item, collection) {
  return !_.contains(collection || [], item);
});

swig.setFilter('add', function(n1, n2) { return n1 + n2; });


////////////////////////////////////////////////////////////
// Routes
////////////////////////////////////////////////////////////

app.use(require('./routes').routes());
app.use(require('./routes/apps').routes());
app.use(require('./routes/oauth').routes());
app.use(require('./routes/me').routes());
app.use(require('./routes/me/send').routes());
app.use(require('./routes/me/addresses').routes());
app.use(require('./routes/me/security').routes());
app.use(require('./routes/me/settings').routes());
app.use(require('./routes/me/auths').routes());
app.use(require('./routes/admin').routes());



app.on('error', belt.logError);

////////////////////////////////////////////////////////////

module.exports = app;
