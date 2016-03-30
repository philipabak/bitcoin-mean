"use strict";
var assert = require('better-assert');
var belt = require('./belt');
var bitcoinClient = require('./bitcoin_client');
var config = require('config');
var db = require('./db');
var debug = require('debug')('app:send');

exports.processWithdrawal = function*(withdrawalId) {
  assert(withdrawalId);


  var withdrawal = yield db.dequeueWithdrawal(withdrawalId);
  if (!withdrawal)
    throw new Error('Could not find withdrawal to process: ' + withdrawalId);

  var outputs = {};  // values in bitcoins, as we're sending it to bitcoin-rpc
  outputs[withdrawal.to_address] = withdrawal.amount/1e8;

  //if (withdrawal.amount > 0.01e8) {
  if (false) {
    var balance = (yield bitcoinClient.getBalance())[0] * 1e8;
    assert(typeof balance == 'number');

    if (balance - 2*withdrawal.amount > config.get('HOTWALLET_OVERFLOW')) {
      var index =   yield db.getNextHotWalletSpillSequence();
      var address = belt.deriveAddress(index, true);

      debug('Got cold address: ', address, ' from index: ', index);

      assert(!outputs[address]); // Let's not overwrite...

      outputs[address] = withdrawal.amount / 1e8; // spill exactly the same amount to cold..
    }
  }

  debug('Sending to: ' + JSON.stringify(outputs));

  var txid;
  try {
    txid = (yield bitcoinClient.sendMany("", outputs, 0))[0];
  } catch (ex) {
    if (/Insufficient funds/.test(ex.message) ||
      /This transaction requires a transaction fee of at least/.test(ex.message) ||
      ex.code === 'ECONNREFUSED'
    ) {
      debug('Queuing withdrawal: ', withdrawalId, ' as we got error: ', ex);
      yield db.failWithdrawal(withdrawalId); // it's safe to resend

      belt.logError('We had to fail withdrawal ' + withdrawalId + ' as we got error: ' + ex);

      throw 'FAILED';
    }

    belt.logError('[INTERNAL_ERROR] Could not send: '+ satoshis/1e8 + ' bitcoins to ' + toAddr,
      ' for withdrawal ' + withdrawalId + ' got error: ' + ex);

    throw ex;
  }

  assert(typeof txid === 'string');
  debug('Sent ' + withdrawal.amount/1e8 + ' btc to ' + JSON.stringify(outputs) + ' for ' + withdrawalId + ' with tx: ' + txid);

  yield db.succeedWithdrawal(withdrawalId, txid);

  return txid;
};
