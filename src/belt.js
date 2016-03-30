"use strict";
// Node
var nodeUrl = require('url');
var querystring = require('querystring');
var util = require('util');
// 3rd party
var _ = require('lodash');
var config = require('config');
var debug = require('debug')('app:belt');
var assert = require('better-assert');
var bcrypt = require('bcryptjs');
var bitcoinjs = require('bitcoinjs-lib');
var slug = require('slug');
var validator = require('validator');

// MFA
var speakeasy = require('speakeasy');
var qr = require('qr-image');



// Ex: slugify(42, 'HeLLo WORLD', '&')  //=> '42-hello-world-and'
exports.slugify = function() {
  var args = Array.prototype.slice.call(arguments);
  return slug(args.join(' ').toLowerCase());
};

// Ex: futureDate(new Date(), { years: 1 })
// Ex: futureDate(new Date(), { minutes: 15 })
//
// Returns a new Date set in the future
// nowDate is optional, defaults to new Date()
exports.futureDate = function(nowDate, opts) {
  assert(nowDate); // There will always be at least one argument
  if (!opts) {
    opts = nowDate;
    nowDate = new Date();
  }

  return new Date(nowDate.getTime() +
                  (opts.years   || 0) * 1000 * 60 * 60 * 24 * 365 +
                  (opts.weeks   || 0) * 1000 * 60 * 60 * 24 * 7 +
                  (opts.days    || 0) * 1000 * 60 * 60 * 24 +
                  (opts.minutes || 0) * 1000 * 60 +
                  (opts.seconds || 0) * 1000 +
                  (opts.milliseconds || 0));
};

// co-bcrypt
var Bcrypt = {
  hash: function(password, salt) {
    return function(done) {
      bcrypt.hash(password, salt, done);
    };
  },
  compare: function(secret, digest) {
    return function(done) {
      bcrypt.compare(secret, digest, done);
    };
  }
};

// Returns hashed password value to be used in `users.digest` column
// String -> String
exports.hashPassword = hashPassword;
function *hashPassword(password) {
  return yield Bcrypt.hash(password, 4);
}

// Compares password plaintext against bcrypted digest
// String -> String -> Bool
exports.checkPassword = checkPassword;
function *checkPassword(password, digest) {
  return yield Bcrypt.compare(password, digest);
}

// String -> Bool
exports.isValidBitcoinAddress = function (addr) {
  if (typeof addr !== 'string') return false;
  try {
    var version = bitcoinjs.Address.fromBase58Check(addr).version;
    return version === bitcoinjs.networks.bitcoin.pubKeyHash ||
        version === bitcoinjs.networks.bitcoin.scriptHash;
  } catch(ex) {
    return false;
  }
  return true;
};

exports.isValidUuid = function(uuid) {
  var regexp = /^[a-f0-9]{8}\-[a-f0-9]{4}\-[a-f0-9]{4}\-[a-f0-9]{4}\-[a-f0-9]{12}$/;
  return regexp.test(uuid);
};

var walletHDNode = bitcoinjs.HDNode.fromBase58(config.get('BIP32_WALLET_PUB_KEY'));
var coldHDNode = bitcoinjs.HDNode.fromBase58(config.get('BIP32_COLD_PUB_KEY'));

exports.deriveAddress = function(index, cold) {
  assert(Number.isInteger(index));
  assert(!cold); // not supported right now..
  var node = cold ? coldHDNode : walletHDNode;
  return node.derive(index).pubKey.getAddress().toString();
};

// MFA /////////////////////////////////////////////////////

// String -- Base32 MFA key
exports.generateMfaKey = function() {
  return speakeasy.generate_key({ length: 32 }).base32;
};

// Returns String -- the actual <svg> element to be inserted directly into html
//   to show the qr code.
exports.generateMfaQr = function(uname, key) {
  var qrUri = 'otpauth://totp/MoneyPot:' + uname + '?secret=' + key + '&issuer=MoneyPot';
  return qr.imageSync(qrUri, {type: 'svg'});
};

exports.generateMfaPasscode = function(base32Key) {
  return speakeasy.totp({
    key: base32Key,
    encoding: 'base32'
  });
};

////////////////////////////////////////////////////////////

// removes internal nulls. If str null or undefined, returns it
exports.stripString = function(str) {
  if (str === null || str === undefined) return str;
  assert(typeof str === 'string');
  return str.replace(/\0/g, '').trim();
};

// makeHashFragment({ foo: 42, bar: 'hello' })
// -> #foo=42&bar=hello
exports.makeHashFragment = function(props) {
  debug('[makeHashFragment] props:', props);

  return '#' + _.chain(props).pairs().map(function(pair) {
    var k = pair[0], v = pair[1];

    // Ignore pairs with empty or undefined value
    if (v == '') {
      debug('Ignoring key %s since it has value %j', k, v);
      return;
    }

    return [encodeURIComponent(k), encodeURIComponent(v)].join('=');
  }).compact().join('&');
};


// Adds a fragment fragment to given `url`, either in the search params or hash
exports.mergeFragment = function(fragmentType, url, props) {
	assert(fragmentType === 'hash' || fragmentType === 'search');

	var full = nodeUrl.parse(url);

	var prefix = fragmentType ==='hash' ? '#' : '?';

	var fragment = full[fragmentType];
	var qsObj = fragment ? querystring.parse(fragment.substring(1)) : {};
	_.merge(qsObj, props);

	full[fragmentType] = prefix + querystring.encode(qsObj);

	return nodeUrl.format(full);
};


exports.formatSatoshis = function (n,decimals) {
  var sat = Math.floor(n);

  if (typeof decimals !== 'number')
    decimals = sat % 100 === 0 ? 0 : 2;

  return (sat/100).toFixed(decimals).toString().replace(/(\d)(?=(\d{3})+(?!\d))/g, "$1,");
};

exports.formatNumber = function(n, decimals) {
  if (typeof decimals !== 'number')
    decimals = n % 1 === 0 ? 0 : 2;

  return (n).toFixed(decimals).toString().replace(/(\d)(?=(\d{3})+(?!\d))/g, "$1,");
};

/**
 * Decimal adjustment of a number.
 *
 * @param {String}  type  The type of adjustment.
 * @param {Number}  value The number.
 * @param {Integer} exp   The exponent (the 10 logarithm of the adjustment base).
 * @returns {Number} The adjusted value.
 */
function decimalAdjust(type, value, exp) {
  // If the exp is undefined or zero...
  if (typeof exp === 'undefined' || +exp === 0) {
    return Math[type](value);
  }
  value = +value;
  exp = +exp;
  // If the value is not a number or the exp is not an integer...
  if (isNaN(value) || !(typeof exp === 'number' && exp % 1 === 0)) {
    return NaN;
  }
  // Shift
  value = value.toString().split('e');
  value = Math[type](+(value[0] + 'e' + (value[1] ? (+value[1] - exp) : -exp)));
  // Shift back
  value = value.toString().split('e');
  return +(value[0] + 'e' + (value[1] ? (+value[1] + exp) : exp));
}

exports.round10 = function(value, exp) {
    return decimalAdjust('round', value, exp);
};

exports.floor10 = function(value, exp) {
    return decimalAdjust('floor', value, exp);
};

exports.ceil10 = function(value, exp) {
    return decimalAdjust('ceil', value, exp);
};

// Returns distance in seconds from now to `date`.
// - Positive int: future, negative int: past
//
// Date -> Int
exports.dateToSecondsFromNow = function(date) {
  assert(date instanceof Date);
  var n = Math.floor((date.getTime() - Date.now()) / 1000);
  debug('[dateToSecondsFromNow] n:', n);
  return n;
};

///////////////////////////////////////////////////////////
// Managing the redirectToPath cookie has been factored out into this belt
// function so that we don't need to remember to parse the path out of whatever
// URL this cookie stores in the event that someone finds a way to set this
// cookie for users.

// if no url provided, uses ctx.url

// Note: this.url returns path + queryString
// - Ex: this.url => /example?foo=42
//
// `ctx` is Koa context
exports.setRedirectToPath = function(ctx, url) {
  assert(ctx);

  ctx.cookies.set('redirectToPath', url || ctx.url, {
    secure: false,
    secureProxy: config.get('ENV') === 'production',  // TODO: This is a hack the relies on impl details..
    httpOnly: true
  });
};

// `ctx` is Koa context
exports.getRedirectToPath = function(ctx) {
  assert(ctx);
  if (!ctx.cookies.get('redirectToPath')) return;
  return nodeUrl.parse(ctx.cookies.get('redirectToPath')).path;
};

// `ctx` is Koa context
exports.clearRedirectToPath = function(ctx) {
  assert(ctx);
  ctx.cookies.set('redirectToPath', null, { expires: 0 });
};

exports.sha256HashRegex = /^[\da-f]{64}$/;


// ex is optional
// 2nd argument is optional KoaContext
exports.logError = function(msg, ctx) {

  if (ctx) {
    console.error(util.format('[INTERNAL_ERROR, requestId: %s] %s %s', ctx.state.requestId, msg, msg.stack));
  } else {
    console.error('[INTERNAL_ERROR]', msg, msg.stack);
  }
};


exports.defaultRedirectUri = config.get('HOST') + 'oauth/debug';

// parse unsigned 53 bit number
exports.parseU53 = function(str) {
  var t = Number.parseInt(str, 10);
  if (t === NaN || t < 0 || t > Number.MAX_SAFE_INTEGER)
    return NaN;
  return t;
};