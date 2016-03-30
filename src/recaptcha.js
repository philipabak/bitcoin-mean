var assert = require('better-assert');
var debug = require('debug')('app:recaptcha');
var https = require('https');
var querystring = require('querystring');


var options = {
  hostname: 'www.google.com',
  port: 443,
  path: '/recaptcha/api/siteverify',
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded'
  }
};


exports.ensure = function(secret, response, remoteIp) {
  assert(secret);
  assert(response);
  assert(remoteIp);

  return new Promise(function(resolve, reject) {

    var req = https.request(options, function(res) {
      res.setEncoding('utf8');
      var body = '';
      res.on('data', function (chunk) {
        body += chunk;
      });
      res.on('error', function(e) {
        debug('Caught recaptcha error: ', e);
        reject(e);
      });
      res.on('end', function() {
        debug('Raw Response: ', body);

        var json = JSON.parse(body);

        if (json.success)
          return resolve();

        var err = 'Unspecified error';

        if (Array.isArray(json['error-codes']))
            err = json['error-codes'][0] || err;

        if (typeof err === 'string')
          err = err.toUpperCase().replace(/\-/g, '_');

        reject(err);
      });
    });

	  req.on('error', function(err) {
		  debug('Recaptcha request error: ', err);
		  reject(err);
	  });

    var postData = querystring.stringify({
      secret: secret,
      response: response,
      remoteip: remoteIp
    });

    debug('Recaptcha POSTing: ', postData);

    req.write(postData);
    req.end();
  });


};