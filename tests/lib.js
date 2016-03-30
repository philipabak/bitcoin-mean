var assert = require('chai').assert;
var request = require('./request');

var access_token = 'access_token=82c5bbe7-d9fd-4f5d-a06c-e34e588db2fd';
var app_secret = '409982aa-746f-4ca7-b010-cf43387039b0';

exports.getHash = function*() {
  var res = yield request.json('/v1/hashes?' + access_token, {});

	var body = JSON.parse(yield request.slurp(res));

	assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');

  assert.match(body.hash, /^[\da-f]{64}$/);
  return body.hash;
};


exports.customBet = function*(hash, wager, clientSeed, payouts) {

  var obj = {
    hash: hash,
    wager: wager,
    client_seed: clientSeed,
    payouts: payouts
  };

  var res = yield request.json('/v1/bets/custom?' + access_token, obj);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');

  return JSON.parse(yield request.slurp(res));
};

exports.jackpotDiceBet = function*(hash, wager, clientSeed, cond, number) {

  var obj = {
    jackpot: 1e4,
    hash: hash,
    wager: wager,
    client_seed: clientSeed,
    cond: cond,
    number: number
  };

  var res = yield request.json('/v1/bets/jackpot-dice?' + access_token, obj);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');

  return JSON.parse(yield request.slurp(res));
};

exports.jackpotDiceBet = function*(hash, wager, clientSeed, cond, number) {

	var obj = {
		jackpot: 1e4,
		hash: hash,
		wager: wager,
		client_seed: clientSeed,
		cond: cond,
		number: number
	};

	var res = yield request.json('/v1/bets/jackpot-dice?' + access_token, obj);

	assert.equal(res.statusCode, 200);
	assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');

	return JSON.parse(yield request.slurp(res));
};

exports.simpleDiceBet = function*(hash, wager, clientSeed, cond, number, payout) {

	var obj = {
		hash: hash,
		wager: wager,
		client_seed: clientSeed,
		cond: cond,
		target: number,
		payout: payout
	};

	var res = yield request.json('/v1/bets/simple-dice?' + access_token, obj);

	var body = yield request.slurp(res);

	console.log('simple dice body: ', body);

	assert.equal(res.statusCode, 200);
	assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');

	return JSON.parse(body);
};


exports.plinkoBet = function*(hash, wager, clientSeed, payTable) {

  var obj = {
    hash: hash,
    wager: wager,
    client_seed: clientSeed,
    pay_table: payTable
  };

  var res = yield request.json('/v1/bets/plinko?' + access_token, obj);

  var body = yield request.slurp(res);

  console.log('Plinko result: ', body);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');

  return JSON.parse(body);
};


exports.getDepositAddress = function*() {
  var res = yield request.get('/v1/deposit-address?' + access_token);
  assert.equal(res.statusCode, 200);
  return yield request.slurp(res);
};

exports.getHashedTokenUser = function*() {
  var hashedToken = 'b0b2ee44b5b589f9738b5f0981c0fa0e4498819a05aebbcf41804070fb94aa4c';
  var res = yield request.get(
    '/v1/token?hashed_token=' + hashedToken + '&app_secret=' + app_secret);

  var text = yield request.slurp(res);

  console.log('text: ', text)

  assert.equal(res.statusCode, 200);
  return JSON.parse(text);

};

exports.getTokenInfo = function*() {
  var res = yield request.get('/v1/token?' + access_token);

  assert.equal(res.statusCode, 200);
  return JSON.parse(yield request.slurp(res));
};

exports.getAppInfo = function*() {
  var res = yield request.get('/v1/app?app_id=4&app_secret=' + app_secret);

  assert.equal(res.statusCode, 200);
  return JSON.parse(yield request.slurp(res));

};

exports.getAuthInfo = function*() {
  var res = yield request.get('/v1/auth?auth_id=1&app_secret=' + app_secret);

  var text = yield request.slurp(res);

  console.log('text is: ', text);

  return JSON.parse(text);
};

exports.getPublicUserInfo = function*() {
  var res = yield request.get('/v1/user-stats?uname=foo&' + access_token);

  var text = yield request.slurp(res);

  var res2 = yield request.get('/v1/user-stats?uname=foo&app_secret=' + app_secret);
  var text2 = yield request.slurp(res2);

  assert.equal(text, text2);

  return JSON.parse(text);
};

exports.createAccessToken = function*() {
	var res = yield request.json('/v1/tokens?app_secret=' + app_secret,  { auth_id: 1 });

	assert.equal(res.statusCode, 200);
	return JSON.parse(yield request.slurp(res));

};

exports.getAccessToken = function*(token) {
  var res = yield request.get('/v1/tokens/' + token + '?' + access_token);
  assert.equal(res.statusCode, 200);

  return JSON.parse(yield request.slurp(res));

};

exports.createInvalidJSON = function*() {
  var res = yield request.post('/v1/bet-hashes?' + access_token, "{foo: ");

  var text = yield request.slurp(res);

  console.log('text is: ', text);

  return JSON.parse(text);
};

exports.getConfidentialToken = function*() {
  var confidentialToken = '82c5bbe7-d9fd-4f5d-a06c-e34e588db2fe';

  var res = yield request.get('/v1/token?confidential_token=' + confidentialToken + '&app_secret=' + app_secret);
  var text = yield request.slurp(res);

  console.log('text is: ', text);

  return JSON.parse(text);

};

exports.getBankroll = function*() {
  var res = yield request.get('/v1/bankroll?' + access_token);
  assert.equal(res.statusCode, 200);

  return JSON.parse(yield request.slurp(res));
};

exports.tipUser = function*() {
  var res = yield request.json('/v1/tip?' + access_token, {
    amount: 2000,
    uname: 'foo_foo'
  });

  var text = yield request.slurp(res);

  return JSON.parse(text);
};