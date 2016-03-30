"use strict";
// 3rd party
var Router = require('koa-router');
var _ = require('lodash');
var bitcoinClient = require('../../../bitcoin_client');
// 1st party
var mw = require('../../middleware');
var db = require('../../../db');
var belt = require('../../../belt');
var pre = require('../../presenters');
var send = require('../../../send');

var router = new Router();

router.use(mw.ensureAdmin);

////////////////////////////////////////////////////////////

router.delete('/admin/banner-announcement', function*() {
  yield db.clearBannerAnnouncement();
  this.flash = {
    message: ['success', 'Announcement banner cleared (may take 30 seconds)']
  };
  this.redirect('/admin');
});

router.post('/admin/banner-announcement', function*() {
  this.validateBody('html').notEmpty();
  this.validateBody('type')
    .notEmpty()
    .isIn(['success', 'danger', 'warning', 'info']);

  yield db.insertBannerAnnouncement(this.vals.html, this.vals.type);
  this.flash = {
    message: ['success', 'Banner announcement updated (appear within 30 seconds)']
  };
  this.redirect('/admin');
});

////////////////////////////////////////////////////////////

router.get('/admin/users', function*() {
  var data = yield {
    users: db.getAllUserInfo(),                    // :: [User]
    usersCount1: db.countNewUsersSince('1 day'),   // :: Int
    usersCount30: db.countNewUsersSince('30 days') // :: Int
  };

  data.users = data.users.map(pre.presentUser);

  yield this.render('admin_list_users', {
    ctx: this,
    users: data.users,
    usersCount1: data.usersCount1,
    usersCount30: data.usersCount30
  });
});

////////////////////////////////////////////////////////////

router.get('/admin/deposits', function*() {
  var deposits = yield db.getAllDepositsInfo();

  yield this.render('admin_list_deposits', {
    ctx: this,
    deposits: deposits
  });

});

router.get('/admin/withdrawals', function*() {
  var withdrawals = yield db.getAllWithdrawalsInfo();

  yield this.render('admin_list_withdrawals', {
    ctx: this,
    withdrawals: withdrawals
  });

});



router.get('/admin/faucets', function*() {
  var stats = yield db.getFaucetStats();
  var faucets = yield db.getAllFaucetInfo();


  yield this.render('admin_list_faucets', {
    ctx: this,
    stats: stats,
    faucets: faucets
  });
});


router.get('/admin', function*() {
  var hotWallet, bitcoindError;
  try {
    // Confirmed + just unconfirmed change (txns to self)
    hotWallet = (yield bitcoinClient.getBalance())[0] * 1e8;
  } catch (ex) {
    bitcoindError = ex;
  }

  var results = yield [
    db.getUnsuccesfulTransactions(),
    db.findAdminUsers()
  ];
  var unsuccessful = results[0];
  var adminUsers = results[1].map(pre.presentUser);

  yield this.render('admin', {
    ctx: this,
    hotWallet: hotWallet,
    bitcoindError: bitcoindError,
    unsuccessfulTransactions: unsuccessful,
    adminUsers: adminUsers
  });
});

router.post('/admin/gen-top-up-address', function*() {
  var address = (yield bitcoinClient.getNewAddress())[0];

  this.flash = {
    message: ['success', 'Generated a top-up address: ' + address]
  };

  this.response.redirect('/admin');
});

router.post('/admin/process-withdrawal', function*() {
  this.validateBody('withdrawal-id').isUuid();

  // In the background, process withdrawl
  try {
    yield send.processWithdrawal(this.vals['withdrawal-id']);
  } catch (ex) {
    if (ex === 'FAILED') {
      this.flash = {
        message: ['warning', 'Got failed error when trying to process']
      };
      this.response.redirect('/admin');
      return;
    }

    console.error('Error with async withdrawal: ', this.vals['withdrawal-id'], ex);
    belt.logError(ex, this);
    throw ex;
  }

  this.flash = {
    message: ['success', 'Processed withdrawal']
  };

  this.response.redirect('/admin');
});


router.post('/admin/succeed-withdrawal', function*() {
  this.validateBody('withdrawal-id').isUuid();

  this.validateBody('txid').match(/[a-fA-F0-9]{64}/, 'Invalid txid');

  yield db.succeedWithdrawal(this.vals['withdrawal-id'], this.vals['txid']);

  this.flash = {
    message: ['success', 'Updated Withdrawal']
  };

  this.response.redirect('/withdrawals/' + this.vals['withdrawal-id']);
});

router.post('/admin/fail-withdrawal', function*() {
  this.validateBody('withdrawal-id').isUuid();

  yield db.failWithdrawal(this.vals['withdrawal-id']);

  this.flash = {
    message: ['success', 'Withdrawal marked as failed']
  };

  this.response.redirect('/admin');
});



////////////////////////////////////////////////////////////

module.exports = router;
