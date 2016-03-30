var bitcoin = require('bitcoin');
var config = require('config');
var thunkify = require('thunkify');

var client = new bitcoin.Client({
    host: config.get('BITCOIND_HOST'),
    port: config.get('BITCOIND_PORT'),
    user: config.get('BITCOIND_USER'),
    pass: config.get('BITCOIND_PASS'),
    timeout: 60000
});

exports.sendMany = thunkify(client.sendMany.bind(client));

exports.sendToAddress = thunkify(client.sendToAddress.bind(client));

exports.getBalance = thunkify(client.getBalance.bind(client));

exports.getNewAddress = thunkify(client.getNewAddress.bind(client));