"use strict";
// Node
var util = require('util');
// 3rd party
var _ = require('lodash');
var co = require('co');
var debug = require('debug')('app:cache');
var assert = require('better-assert');
// 1st party
var db = require('../db');
var pre = require('./presenters');

// TODO: Handle failure
function Cache() {
  this.store = {};
  this.intervals = [];
  this.name = Math.random().toString();
  var self = this;

  this.get = function(key) {
    debug('getting name:', self.name, key);
    var val = self.store[key];
    //assert(val);
    return val;
  };

  this.set = function(key, val) {
    self.store[key] = val;
    debug('setting cache key: %s', key);
    return val;
  };

  // genFn failed
  function errBack(err) {
    console.error('Error', err, err.stack);
  }

  this.once = function(genFn) {
    co(genFn.bind(self)).then(_.noop, errBack);
  };

  this.every = function(ms, genFn) {
    // Run the genFn on initial load, and then run it at an interval

    // Initial run successful, so create an interval
    function succBack() {
      var interval = setInterval(function() {
        co(genFn.bind(self)).then(_.noop, errBack);
      }, ms);
      self.intervals.push(interval);
    }

    co(genFn.bind(self)).then(succBack, errBack);
  };
}

var cache;
module.exports = function() {
  // There can only be one cache instance
  if (cache) return cache;

  cache = new Cache();

  // Demo:
  //
  // cache.once(function*() {
  //   this.set('big-thing-that-runs-on-boot', yield db.bigThing());
  // });
  //
  //
  // Every 60 seconds
  // cache.every(1000 * 60, function*() {
  //   this.set('stats', yield db.getStats());
  // });

  // Every 30 seconds
  cache.every(1000 * 30, function*() {
    var row = yield db.getLatestActiveBannerAnnouncement();
    debug('found: %j', row);
    this.set('banner-announcement', row);
  });

  return cache;
};
