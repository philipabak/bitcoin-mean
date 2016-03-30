var http = require('http');


var host = 'localhost';
var port = 3000;


function run(opts) {
  return new Promise(function(resolve, reject) {

    var req = http.request({
      host: host,
      port: port,
      path: opts.path,
      method: opts.method,
      headers: opts.headers
    }, resolve);

    req.on('error', reject);

    if (opts.body)
      req.write(opts.body);

    req.end();

  });
}

exports.json = function(path, obj) {
  return exports.post(path, JSON.stringify(obj));
};

exports.post = function(path, data) {
  return run({
    path: path,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: data
  });
};



exports.get = function(path) {
  return run({ path: path });
};

// takes a response, reads the body
exports.slurp = function(res) {
  return new Promise(function(resolve, reject) {
    var body = '';
    res.on('data', function(chunk) {
      body += chunk;
    });
    res.on('end', function() {
      resolve(body);
    });
    res.on('error', reject);
  });
};