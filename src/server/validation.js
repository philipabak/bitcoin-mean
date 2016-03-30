"use strict";
// 3rd party
var _ = require('lodash');
var assert = require('better-assert');
// 1st party
var db = require('./../db');

// Util ////////////////////////////////////////////////////

// Collapses 2+ spaces into 1
// Ex: 'a   b   c' -> 'a b c'
function collapseSpaces(str) {
  return str.replace(/\s{2,}/g, ' ');
}

// Removes any whitespace in the string
function removeWhitespace(str) {
  return str.replace(/\s/g, '');
}

////////////////////////////////////////////////////////////

exports.fixWallet = function(attrs) {
  // Trim and collapse consecutive whitespace
  attrs.name = attrs.name && collapseSpaces(attrs.name.trim());
  return attrs;
};

exports.validateWallet = function *(attrs) {
  assert(_.isNumber(attrs.userId));
  attrs = exports.fixWallet(attrs);
  if (! (attrs.name && attrs.name.length >= 1))
    throw 'Name is required';
  // Ensure user doesn't already have a wallet with this name
  if (yield db.findWalletForUserIdAndName(attrs.userId, attrs.name)) {
    throw 'You already have a wallet with that name';
  }
  return attrs;
};

////////////////////////////////////////////////////////////

exports.fixNewUser = function(attrs) {
  // Prefix/suffix whitespace in usernames are accidental,
  // but inner whitespace probably isn't, so leave inner whitespace
  // intact so user can see that spaces aren't allowed
  attrs.uname = attrs.uname && attrs.uname.trim();
  // Whitespace in emails are accidental
  attrs.email = attrs.email && removeWhitespace(attrs.email);
  return attrs;
};

exports.validateNewUser = function*(attrs) {
  attrs = exports.fixNewUser(attrs);
  if (! attrs.uname)
    throw 'Username is required';
  if (! /^[a-z0-9_]+$/i.test(attrs.uname))
    throw 'Username contains invalid characters';
  // Ensure underscores are only used as separators, not anything fancier.
  if (/[_]{2,}/i.test(attrs.uname))
    throw 'Username contains consecutive underscores';
  if (/^[_]|[_]$/i.test(attrs.uname))
    throw 'Username starts or ends with underscores';
  if (attrs.uname.length < 2 || attrs.uname.length > 15)
    throw 'Username must be 2-15 characters';
  if (! attrs.password1)
    throw 'Password is required';
  if (attrs.password1.length < 6)
    throw 'Password must be 6 or more characters';
  if (attrs.password1 !== attrs.password2)
    throw 'Password confirmation does not match';

  // Case-insensitive comparison. If 'ace' exists, we don't allow 'Ace'
  if (yield db.findUserByUname(attrs.uname)) {
    throw 'Username is taken';
  }

  // Validation checks out, so return the fixed attrs
  return attrs;
};
