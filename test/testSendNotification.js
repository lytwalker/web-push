var assert     = require('assert');
var crypto     = require('crypto');
var https      = require('https');
var fs         = require('fs');
var webPush    = require('../index');
var ece        = require('http_ece');
var urlBase64  = require('urlsafe-base64');
var semver     = require('semver');
var portfinder = require('portfinder');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

suite('sendNotification', function() {
  test('is defined', function() {
    assert(webPush.sendNotification);
  });

  var closePromise;
  var serverPort;

  afterEach(function() {
    if (closePromise) {
      return closePromise;
    }
  });

  var userCurve = crypto.createECDH('prime256v1');

  var userPublicKey = userCurve.generateKeys();
  var userPrivateKey = userCurve.getPrivateKey();

  function startServer(message, TTL, statusCode, isGCM) {
    var pem = fs.readFileSync('test/cert.pem');

    var options = {
      key: pem,
      cert: pem,
    };

    var server = https.createServer(options, function(req, res) {
      var body = new Buffer(0);

      req.on('data', function(chunk) {
        body = Buffer.concat([ body, chunk ]);
      });

      req.on('end', function() {
        assert.equal(req.headers['content-length'], body.length, 'Content-Length header correct');
        if (typeof TTL !== 'undefined') {
          assert.equal(req.headers['ttl'], TTL, 'TTL header correct');
        }

        if (typeof message !== 'undefined') {
          assert(body.length > 0);
          assert.equal(req.headers['content-type'], 'application/octet-stream', 'Content-Type header correct');
          assert.equal(req.headers['encryption-key'].indexOf('keyid=p256dh;dh='), 0, 'Encryption-Key header correct');
          assert.equal(req.headers['encryption'].indexOf('keyid=p256dh;salt='), 0, 'Encryption header correct');
          assert.equal(req.headers['content-encoding'], 'aesgcm128', 'Content-Encoding header correct');

          var appServerPublicKey = urlBase64.decode(req.headers['encryption-key'].substring('keyid=p256dh;dh='.length));
          var salt = req.headers['encryption'].substring('keyid=p256dh;salt='.length);

          var sharedSecret = userCurve.computeSecret(appServerPublicKey);

          ece.saveKey('webpushKey', sharedSecret);

          var decrypted = ece.decrypt(body, {
            keyid: 'webpushKey',
            salt: salt,
            padSize: 1,
          });

          assert(decrypted.equals(new Buffer(message)), "Cipher text correctly decoded");
        }

        if (isGCM) {
          assert.equal(body.toString(), '{"registration_ids":["someSubscriptionID"]}');
          assert.equal(req.headers['authorization'], 'key=my_gcm_key', 'Authorization header correct');
          assert.equal(req.headers['content-type'], 'application/json', 'Content-Type header correct');
          assert.equal(req.headers['content-length'], 43, 'Content-Length header correct');
        }

        res.writeHead(statusCode ? statusCode : 201);

        res.end(statusCode !== 404 ? 'ok' : 'not found');

        server.close();
      });
    });

    portfinder.getPort(function(err, port) {
      if (err) {
        serverPort = 50005;
      } else {
        serverPort = port;
      }

      server.listen(serverPort);
    });

    closePromise = new Promise(function(resolve, reject) {
      server.on('close', resolve);
    });

    return new Promise(function(resolve, reject) {
      server.on('listening', resolve);
    });
  }

  test('send/receive string', function() {
    return startServer('hello', 0)
    .then(function() {
      return webPush.sendNotification('https://127.0.0.1:' + serverPort, 0, urlBase64.encode(userPublicKey), 'hello');
    })
    .then(function(body) {
      assert(true, 'sendNotification promise resolved');
      assert.equal(body, 'ok');
    }, function() {
      assert(false, 'sendNotification promise rejected');
    });
  });

  test('send/receive buffer', function() {
    return startServer('hello', 0)
    .then(function() {
      return webPush.sendNotification('https://127.0.0.1:' + serverPort, 0, urlBase64.encode(userPublicKey), new Buffer('hello'));
    })
    .then(function() {
      assert(true, 'sendNotification promise resolved');
    }, function() {
      assert(false, 'sendNotification promise rejected');
    });
  });

  test('send/receive unicode character', function() {
    return startServer('😁', 0)
    .then(function() {
      return webPush.sendNotification('https://127.0.0.1:' + serverPort, 0, urlBase64.encode(userPublicKey), '😁');
    })
    .then(function() {
      assert(true, 'sendNotification promise resolved');
    }, function() {
      assert(false, 'sendNotification promise rejected');
    });
  });

  // This test fails on Node.js v0.12.
  if (!semver.satisfies(process.version, '0.12')) {
    test('send/receive empty message', function() {
      return startServer('', 0)
      .then(function() {
        return webPush.sendNotification('https://127.0.0.1:' + serverPort, 0, urlBase64.encode(userPublicKey), '');
      })
      .then(function() {
        assert(true, 'sendNotification promise resolved');
      }, function(e) {
        assert(false, 'sendNotification promise rejected with ' + e);
      });
    });
  }

  test('send/receive without message', function() {
    return startServer()
    .then(function() {
      return webPush.sendNotification('https://127.0.0.1:' + serverPort);
    })
    .then(function() {
      assert(true, 'sendNotification promise resolved');
    }, function() {
      assert(false, 'sendNotification promise rejected');
    });
  });

  test('send/receive without message with TTL', function() {
    return startServer(undefined, 5)
    .then(function() {
      return webPush.sendNotification('https://127.0.0.1:' + serverPort, 5);
    })
    .then(function() {
      assert(true, 'sendNotification promise resolved');
    }, function() {
      assert(false, 'sendNotification promise rejected');
    });
  });

  test('send/receive string with TTL', function() {
    return startServer('hello', 5)
    .then(function() {
      return webPush.sendNotification('https://127.0.0.1:' + serverPort, 5, urlBase64.encode(userPublicKey), 'hello');
    })
    .then(function() {
      assert(true, 'sendNotification promise resolved');
    }, function() {
      assert(false, 'sendNotification promise rejected');
    });
  });

  test('promise rejected when it can\'t connect to the server', function() {
    return webPush.sendNotification('https://127.0.0.1:' + serverPort)
    .then(function() {
      assert(false, 'sendNotification promise resolved');
    }, function() {
      assert(true, 'sendNotification promise rejected');
    });
  });

  test('promise rejected when the response status code is unexpected', function() {
    return startServer(undefined, undefined, 404)
    .then(function() {
      return webPush.sendNotification('https://127.0.0.1:' + serverPort);
    })
    .then(function() {
      assert(false, 'sendNotification promise resolved');
    }, function(err) {
      assert(err, 'sendNotification promise rejected');
      assert(err instanceof webPush.WebPushError, 'err is a WebPushError');
      assert.equal(err.statusCode, 404);
      assert.equal(err.body, 'not found');
      assert(err.headers != null, 'response headers are defined');
    });
  });

  test('send/receive GCM', function() {
    var httpsrequest = https.request;
    https.request = function(options, listener) {
      options.hostname = '127.0.0.1';
      options.port = serverPort;
      options.path = '/';
      return httpsrequest.call(https, options, listener);
    }

    webPush.setGCMAPIKey('my_gcm_key');

    return startServer(undefined, undefined, 200, true)
    .then(function() {
      return webPush.sendNotification('https://android.googleapis.com/gcm/send/someSubscriptionID');
    })
    .then(function() {
      assert(true, 'sendNotification promise resolved');
    }, function() {
      assert(false, 'sendNotification promise rejected');
    });
  });

  test('promise rejected if push serivice is GCM and you want to send a payload', function() {
    webPush.setGCMAPIKey('my_gcm_key');

    return webPush.sendNotification('https://android.googleapis.com/gcm/send/someSubscriptionID', 5, urlBase64.encode(userPublicKey), 'hello')
    .then(function() {
      assert(false, 'sendNotification promise resolved');
    }, function(err) {
      assert(err, 'sendNotification promise rejected');
      assert(err instanceof webPush.WebPushError, 'err is a WebPushError');
    });
  });
});