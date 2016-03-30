"use strict";
var co = require('co');
var config = require('config');
var db = require('./db');
var fs = require('co-fs');
var path = require('path');


if (config.get('ENV') !== 'development') {
  throw new Error('Refusing to continue on non-dev environment');
}


function *slurpSql(filePath) {
    var relativePath = '../sql/' + filePath;
    var fullPath = path.join(__dirname, relativePath);
    return yield fs.readFile(fullPath, 'utf8');
}


co(function*() {
    console.log('Resetting the db, this can take a while (it generates a lot of dummy data)');

    var sql;
    
    sql = yield slurpSql('schema.sql');
    console.log('Executing schema.sql...');
    yield db.query(sql);

    sql = yield slurpSql('dev_seeds.sql');
    console.log('Executing dev_seeds.sql...');
    yield db.query(sql);

}).then(function() {
    console.log('Finished resetting db');
    process.exit(0);
}, function(err){
    console.error('Caught error: ', err, err.stack);
    process.exit(1);
});
