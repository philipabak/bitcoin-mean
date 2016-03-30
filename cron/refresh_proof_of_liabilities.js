// 3rd party
var co = require('co');
// 1st party
var db = require('../src/db');

var run = function*() {
  console.log('Refreshing proof_of_liabilities...');
  yield db.refreshProofOfLiabilities();
};

co(run).then(
  function() {
    console.log('OK'); 
    process.exit();
  },
  function(ex) {
    console.log('Error', ex, ex.stack);
    process.exit(1);
  }
);
