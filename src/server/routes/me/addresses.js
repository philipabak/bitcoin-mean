"use strict";
// 3rd party
var Router = require('koa-router');
var debug = require('debug')('app:routes:me:addresses');
// 1st party
var mw = require('../../middleware');
var db = require('../../../db');
var belt = require('../../../belt');
var presenters = require('../../presenters');

var router = new Router();
router.use(mw.ensureCurrUser);

////////////////////////////////////////////////////////////

//
// PUT /me/wallets/:waleltId/addresses/:address (Update address)
// Params:
// - memo: String
//
router.put('/me/addresses/:address', function *() {
  // Ensure currUser can edit this address
  var addressString = this.params.address;
  this.assert(addressString, 400, 'Need to send an address');
  addressString = belt.stripString(addressString);

  // TODO: Validate memo
  var memo = this.request.body.memo;
  if (memo) memo = belt.stripString(memo);

  // Update address
  var updated = yield db.updateAddressMemo(this.currUser.id, addressString, memo);
  if (updated)
    this.flash = { message: ['success', 'Memo updated'] };
  else
    this.flash = { message: ['warning', 'Could not update memo'] };
  this.response.redirect('/me/receive');
});

// - Generates a new wallet address (if permitted for this wallet)
// - Params
//   - memo (Optional)
//
router.post('/me/addresses', function *() {

  var cold = (this.request.body.cold === 'on');
  this.check(!cold, 'Cold addresses not supported at the moment');

  var memo = this.request.body.memo;
  if (memo) {
    memo = belt.stripString(memo);
    this.check(memo.length < 2000, 'Memo length must be less than 2000');
  }

  var address = yield db.generateAddress(this.currUser.id, cold, memo);
  debug(address);
  this.flash = { message: ['success', 'New address generated: ' + address.address]};
  this.response.redirect('/me/receive');
});

////////////////////////////////////////////////////////////

module.exports = router;
