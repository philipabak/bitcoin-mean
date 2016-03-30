"use strict";

var config = require('config');
var server = require('../src/server/index');

console.log('Starting server');
server.listen(config.get('PORT'), function() {
  console.log('Listening on port: ', config.get('PORT'));
});
