require('co-mocha'); // monkey patching nonsense

var assert = require('chai').assert;
var request = require('./request');
var lib = require('./lib');


describe('Webserver)', function(){
  it('should be running', function*() {

    var res = yield request.get('/');
    assert.equal(res.statusCode, 200);

    var body = yield request.slurp(res);

    assert.include(body, 'MoneyPot'); // Not the most robust search!
  })
});


describe('API Server', function() {

  it('Should give us a game hash', function*() {

    var hash = yield lib.getHash();
    assert.typeOf(hash, 'string');


  });

  it('Should allow a custom bet', function*() {

    var hash = yield lib.getHash();
    var response = yield lib.customBet(hash, 1, 0, [
      { from: 0, to: Math.round(Math.pow(2,32) * 0.49), value: 2 }
    ]);

    assert.typeOf(response['next_hash'], 'string');


    var response = yield lib.customBet(response['next_hash'], 1, 0, [
      { from: 0, to: Math.round(Math.pow(2,32) * 0.49), value: 2 }
    ]);

    assert.typeOf(response['next_hash'], 'string');

  });



  it('Should allow a jackpot dice bet', function*() {



    var hash = yield lib.getHash();
    var response = yield lib.jackpotDiceBet(hash, 10000, 0, '<', 49);

    console.log('Jackpot dice result: ', response);


    assert.typeOf(response['next_hash'], 'string');


  });


	it('Should allow a simple dice bet', function*() {

		var hash = yield lib.getHash();
		var response = yield lib.simpleDiceBet(hash, 1, 0, '<', 49.5, 2);

		console.log('Low dice result: ', response);


		assert.typeOf(response['next_hash'], 'string');

    var response2 = yield lib.simpleDiceBet(response['next_hash'], 1, 0, '>', 50.5, 2);

    console.log('High dice result: ', response2);





  });


  it('Should give us a deposit address', function*() {

    var address = yield lib.getDepositAddress();
    assert.typeOf(address, 'string');

    console.log('got address: ', address);

  });

  it('Get a hashed token user', function*() {


    var user = yield lib.getHashedTokenUser();


    console.log('Got user: ', user);

    assert.typeOf(user.auth.user.uname, 'string');

  });

  it('Get an app by id', function*() {


    var app = yield lib.getAppInfo();
    assert.typeOf(app.name, 'string');

    console.log('Got app: ', app);

  });


	it('Confidential flow', function*() {
    var info = yield lib.createAccessToken();

    console.log('Created access token: ', info);

    var reInfo = yield lib.getAccessToken(info.token);


    console.log('Getting the same thing: ', reInfo);

    // Normalizing... for test
    reInfo['access_token'] = reInfo['token']; // TODO: remove...
    info['expires_at'] = new Date(info['expires_at']);
    reInfo['expires_at'] = new Date(reInfo['expires_at']);

    assert.deepEqual(info, reInfo);

  });

  it('Bad format should not give internal error', function*() {
    var info = yield lib.createInvalidJSON();

    console.log('Server responded with: ', info);

  });

  it('Can get a confidential token', function*() {

    var info = yield lib.getConfidentialToken();
    console.log('Confidential token: ', info);

  });

  it('Can get the bankroll', function*() {
    var info = yield lib.getBankroll();
    console.log('Bankroll info: ', info);

  });

  it('Can get token info', function*() {
    var info = yield lib.getTokenInfo();
    console.log('Bankroll info: ', info);
  });

  it('Can get an auth token', function*() {
    var auth = yield lib.getAuthInfo();
    console.log('auth info: ', auth);

  });

  it('Can get public user info', function*() {
    var user = yield lib.getPublicUserInfo();
    console.log('Public User info: ', user);
  });

  it('Can tip another user', function*() {
    var tip = yield lib.tipUser();
    console.log('Tip is: ', tip);
  }
  );

  it('Can do a zero bet', function*() {

    var hash = yield lib.getHash();
    var response = yield lib.simpleDiceBet(hash, 0, 0, '<', 49.5, 0);

    console.log('Simple dice result: ', response);


    assert.typeOf(response['next_hash'], 'string');

  });

  it('Plinko bets work ', function*() {

    var hash = yield lib.getHash();

    var luckyBitGreen = [22, 5, 3, 2, 1.4, 1.2, 1.1, 1.0, 0.4, 1,  1.1, 1.2, 1.4, 2, 3, 5, 22];

    var response = yield lib.plinkoBet(hash, 100, 0, luckyBitGreen);

    console.log('Got response: ', response);


  });


});