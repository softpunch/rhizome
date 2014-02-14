var _ = require('underscore')
  , fs = require('fs')
  , async = require('async')
  , assert = require('assert')
  , wsServer = require('../../lib/server/websockets')
  , oscServer = require('../../lib/server/osc')
  , client = require('../../lib/web-client/client')
  , shared = require('../../lib/shared')
  , utils = require('../../lib/server/utils')
  , helpers = require('../helpers')
  , WebSocket = require('ws')

var config = {
  server: {
    ip: '127.0.0.1',
    webPort: 8000,
    oscPort: 9000,
    rootUrl: '/',
    usersLimit: 40,
    blobsDirName: '/tmp'
  },
  clients: []
}

var oscClient = new utils.OSCClient(config.server.ip, config.server.oscPort)


describe('web client', function() {

  before(function(done) { oscServer.start(config, done) })
  beforeEach(function(done) {
    //client.debug = console.log
    done()
  })
  afterEach(function(done) {
    client.debug = function() {}
    helpers.afterEach(done)
  })

  describe('start', function() {
    
    beforeEach(function(done) {
      config.server.usersLimit = 1
      client.config.reconnect = 0
      wsServer.start(config, done)
    })
    afterEach(function() { config.server.usersLimit = 10 })

    it('should open a socket connection to the server', function(done) {
      assert.equal(client.status(), 'stopped')
      assert.equal(client.userId, null)
      assert.equal(wsServer.sockets().length, 0)
      client.start(function(err) {
        if (err) throw err
        assert.equal(client.status(), 'started')
        assert.equal(wsServer.sockets().length, 1)
        assert.equal(client.userId, 0)
        done()
      })
    })

    it('should reject connection if server is full', function(done) {
      assert.equal(client.status(), 'stopped')
      assert.equal(wsServer.sockets().length, 0)
      assert.equal(client.userId, null)
      async.series([
        function(next) { helpers.dummyConnections(config, 1, next) },
        function(next) { client.start(next) }
      ], function(err) {
        assert.ok(err)
        assert.equal(client.status(), 'stopped')
        assert.equal(_.last(wsServer.sockets()).readyState, WebSocket.CLOSING)
        assert.equal(client.userId, null)
        done()
      })
    })

    it('should return an error if the server is not responding', function(done) {
      assert.equal(client.status(), 'stopped')
      assert.equal(wsServer.sockets().length, 0)
      assert.equal(client.userId, null)
      async.series([
        function(next) { wsServer.stop(next) },
        function(next) { setTimeout(next, 50) },
        function(next) { client.start(next) }
      ], function(err) {
        assert.ok(err)
        assert.equal(client.status(), 'stopped')
        assert.equal(client.userId, null)
        done()
      })
    })

  })

  describe('listen', function() {
    
    beforeEach(function(done) {
      client.config.reconnect = 0
      async.series([
        function(next) { wsServer.start(config, next) },
        function(next) { client.start(done) }
      ])
    })

    it('should receive messages from the specified address', function(done) {
      assert.equal(wsServer.nsTree.has('/place1'), false)
      
      var listend = function(err) {
        if (err) throw err
        assert.equal(wsServer.nsTree.has('/place1'), true)
        assert.equal(wsServer.nsTree.get('/place1').data.sockets.length, 1)
        oscClient.send('/place2', [44])
        oscClient.send('/place1', [1, 2, 3])
      }

      var handler = function(address, args) {
        assert.equal(address, '/place1')
        assert.deepEqual(args, [1, 2, 3])
        done()
      }

      client.listen('/place1', handler, listend)
    })

    it('shouldn\'t cause problem if listening twice same place', function(done) {
      var answered = 0

      var handler = function() {}          

      var listend = function(err) {
        if (err) throw err
        answered++
        assert.equal(wsServer.nsTree.get('/place1').data.sockets.length, 1)
        if (answered === 2) done()
      }

      client.listen('/place1', handler, listend)
      client.listen('/place1', handler, listend)
    })

    it('should receive all messages from subspaces', function(done) {
      var received = []

      var listend = function(err) {
        if (err) throw err
        oscClient.send('/a', [44])
        oscClient.send('/a/b', [55])
        oscClient.send('/', [66])
        oscClient.send('/c', [77])
        oscClient.send('/a/d', [88])
        oscClient.send('/a/', [99])
      }

      var handler = function(address, args) {
        received.push([args[0], address])
        assert.equal(args.length, 1)
        if (received.length === 4) {
          helpers.assertSameElements(
            received, 
            [[44, '/a'], [55, '/a/b'], [88, '/a/d'], [99, '/a']]
          )
          done()
        }
      }

      client.listen('/a', handler, listend)
    })

    it('should throw an error if the address is not valid', function(done) {
      handler = function() {}
      client.start(function(err) {
        if (err) throw err
        assert.throws(function() { client.listen('bla', handler) })
        assert.throws(function() { client.listen('/sys', handler) })
        assert.throws(function() { client.listen('/sys/takeIt/', handler) })
        done()
      })
    })

    it('should throw an error if the client isn\'t started', function(done) {
      handler = function() {}
      client.stop(function(err) {
        if (err) throw err
        assert.throws(function() { client.listen('/bla', handler) })
        done()
      })
    })

  })

  describe('message', function() {
    
    beforeEach(function(done) {
      config.clients = [
        { ip: '127.0.0.1', port: 9005, desktopClientPort: 44444 },
        { ip: '127.0.0.1', port: 9010, desktopClientPort: 44445 }
      ]
      client.config.reconnect = 0
      async.series([
        function(next) { wsServer.start(config, next) },
        function(next) { client.start(done) }
      ], done)
    })

    it('should receive messages from the specified address', function(done) {
      var oscTrace1 = new utils.OSCServer(9005)
        , oscTrace2 = new utils.OSCServer(9010)
        , received = []

      var assertions = function() {
        helpers.assertSameElements(received, [
          ['/bla', [1, 2, 3], 1],
          ['/blo', ['oui', 'non'], 1],
          ['/bla', [1, 2, 3], 2],
          ['/blo', ['oui', 'non'], 2]
        ])
        done()
      }

      oscTrace1.on('message', function (address, args, rinfo) {
        received.push([address, args, 1])
        if (received.length === 4) assertions()
      })

      oscTrace2.on('message', function (address, args, rinfo) {
        received.push([address, args, 2])
        if (received.length === 4) assertions()
      })

      client.message('/bla', [1, 2, 3])
      client.message('/blo', ['oui', 'non'])
    })

    it('should handle things correctly when sending blobs', function(done) {
      var blob1 = new Buffer('blobba')
        , blob2 = new Buffer('blobbo')
        , blob3 = new Buffer('blobbu')
        , blob4 = new Buffer('blobbi')

      var oscTrace1 = new utils.OSCServer(44444)
          oscTrace2 = new utils.OSCServer(44445)
        , received = []

      var assertions = function() {
        helpers.assertSameElements(received, [
          [44444, shared.fromWebBlobAddress, ['/bla/blob', 'blobba', client.userId]],
          [44444, shared.fromWebBlobAddress, ['/bli/blob/', 'blobbi', client.userId]],
          [44444, shared.fromWebBlobAddress, ['/blo/blob', 'blobbo', client.userId]],
          [44444, shared.fromWebBlobAddress, ['/blu/blob/', 'blobbu', client.userId]],

          [44445, shared.fromWebBlobAddress, ['/bla/blob', 'blobba', client.userId]],
          [44445, shared.fromWebBlobAddress, ['/bli/blob/', 'blobbi', client.userId]],
          [44445, shared.fromWebBlobAddress, ['/blo/blob', 'blobbo', client.userId]],
          [44445, shared.fromWebBlobAddress, ['/blu/blob/', 'blobbu', client.userId]]
        ])
        done()
      }

      oscTrace1.on('message', function (address, args, rinfo) {
        args[1] = args[1].toString()
        received.push([44444, address, args])
        if (received.length >= 8) assertions()
      })

      oscTrace2.on('message', function (address, args, rinfo) {
        args[1] = args[1].toString()
        received.push([44445, address, args])
        if (received.length >= 8) assertions()
      })
  
      client.message('/bla/blob', blob1)
      client.message('/blo/blob', blob2)
      client.message('/blu/blob/', blob3)
      client.message('/bli/blob/', blob4)
    })

    it('should throw an error if the address is blob address but the argument is not a blob', function() {
      assert.throws(function() { client.message('/blob', [12, 23]) })
    })

    it('should throw an error if the address is not valid', function() {
      assert.throws(function() { client.message('bla', [12]) })
      assert.throws(function() { client.message('/sys/', ['mna']) })
    })

  })

  describe('auto-reconnect', function() {

    beforeEach(function(done) {
      client.config.reconnect = 1 // Just so that reconnect is not null and therefore it is handled
      async.series([
        function(next) { wsServer.start(config, next) },
        function(next) { client.start(next) },
        function(next) { client.listen('/someAddr', function() {}, next) }
      ], done)
    })

    var assertConnected = function() {
      assert.equal(wsServer.nsTree.get('/someAddr').data.sockets.length, 1)
      assert.ok(_.isNumber(client.userId))
      assert.equal(client.status(), 'started')
    }

    var assertDisconnected = function() {
      assert.equal(client.status(), 'stopped')
    }

    it('should reconnect', function(done) {
      client.config.reconnect = 50
      assertConnected()
      async.series([
        function(next) {
          wsServer.forget(wsServer.sockets()[0])
          setTimeout(next, 20)
        },
        function(next) {
          assertDisconnected()
          setTimeout(next, 100)
        },
        function(next) {
          assertConnected()
          next()
        }
      ], done)
    })

    it('should work as well when retrying several times', function(done) {
      client.config.reconnect = 50
      assertConnected()
      async.series([
        function(next) {
          wsServer.forget(wsServer.sockets()[0])
          wsServer.stop()
          setTimeout(next, 250) // wait for a few retries
        },
        function(next) {
          assertDisconnected()
          wsServer.start(config, next)
        },
        function(next) { setTimeout(next, 150) }, // wait for reconnection to happen
        function(next) {
          assertConnected()
          wsServer.stop() // do it again
          setTimeout(next, 250)
        },

        function(next) {
          assertDisconnected()
          wsServer.start(config, next)
        },
        function(next) { setTimeout(next, 75) }, // wait for reconnection to happen
        function(next) {
          assertConnected()
          next()
        }
      ], done)
    })

  })

})