'use strict';

var merge = require('merge');
var leveldown = require('leveldown');
var inherits = require('util').inherits;
var events = require('events');
var constants = require('./constants');
var utils = require('./utils');
var WritableFileStream = require('./write-stream');
var ReadableFileStream = require('./read-stream');

/**
 * Capped LevelDB database within a {@link Btable}
 * @constructor
 * @param {String} dbPath - The path to database on disk
 * @param {Object} [options] - Options to pass through to leveldown#open
 * @param {Number} [options.maxOpenFiles=1000]
 * @param {Boolean} [options.compression=true]
 * @param {Number} [options.cacheSize=8388608]
 * @param {Boolean} [options.createIfMissing=true]
 * @param {Boolean} [options.errorIfExists=false]
 * @param {Number} [options.writeBufferSize=4194304]
 * @param {Number} [options.blockSize=4096]
 * @param {Number} [options.blockRestartInterval=16]
 */
function Sbucket(dbPath, options) {
  if (!(this instanceof Sbucket)) {
    return new Sbucket(dbPath, options);
  }

  events.EventEmitter.call(this);

  this._options = merge(Object.create(Sbucket.DEFAULTS), options);
  this._db = leveldown(dbPath);
  this._pendingOperations = 0;
  this.readyState = Sbucket.CLOSED;
}

inherits(Sbucket, events.EventEmitter);

/**
 * Triggered when the underlying database opens
 * @event Sbucket#open
 */

/**
 * Triggered when the underlying database closes
 * @event Sbucket#close
 */

/**
 * Triggered when there are no more pending operations
 * @event Sbucket#idle
 */

Sbucket.CLOSED = 4;
Sbucket.CLOSING = 3;
Sbucket.OPENED = 2;
Sbucket.OPENING = 1;
Sbucket.SIZE_START_KEY = '0';
Sbucket.SIZE_END_KEY = 'z';
Sbucket.DEFAULTS = {
  maxOpenFiles: 1000,
  compression: true,
  cacheSize: 8 * (1024 * 1024),
  createIfMissing: true,
  errorIfExists: false,
  writeBufferSize: 4 * (1024 * 1024),
  blockSize: 4096,
  blockRestartInterval: 16
};

/**
 * Opens the underlying database
 * @fires Sbucket#open
 * @param {Sbucket~openCallback}
 */
Sbucket.prototype.open = function(callback) {
  var self = this;
  callback = callback || utils.noop;

  function _open() {
    self.readyState = Sbucket.OPENING;
    self._db.open(self._options, function(err) {
      if (err) {
        return self.emit('error', err);
      }

      self.readyState = Sbucket.OPENED;
      self.emit('open');
    });
  }

  this.once('open', callback);
  this.once('error', function(err) {
    this.removeListener('open', callback);
    callback(err);
  });

  if (this.readyState === Sbucket.OPENED) {
    return self.emit('open');
  }

  if (this.readyState === Sbucket.OPENING) {
    return;
  }

  if (this.readyState === Sbucket.CLOSING) {
    return self.once('close', _open);
  }

  _open();
};
/**
 * @callback Sbucket~openCallback
 * @param {Error} [error]
 */

/**
 * Closes the underlying database
 * @fires Sbucket#close
 * @param {Sbucket~closeCallback}
 */
Sbucket.prototype.close = function(callback) {
  var self = this;
  callback = callback || utils.noop;

  function _close() {
    self.readyState = Sbucket.CLOSING;
    self._db.close(function(err) {
      if (err) {
        return self.emit('error', err);
      }

      self.readyState = Sbucket.CLOSED;
      self.emit('close');
    });
  }

  this.once('close', callback);
  this.once('error', function(err) {
    this.removeListener('close', callback);
    callback(err);
  });

  if (this.readyState === Sbucket.CLOSED) {
    return self.emit('close');
  }

  if (this.readyState === Sbucket.CLOSING) {
    return;
  }

  if (this.readyState === Sbucket.OPENING) {
    return this.once('open', _close);
  }

  _close();
};
/**
 * @callback Sbucket~closeCallback
 * @param {Error} [error]
 */

/**
 * Determines if the file is already stored in the db
 * @param {String} key - The key for the file stored
 * @param {Sbucket~existsCallback}
 */
Sbucket.prototype.exists = function(key, callback) {
  var self = this;

  this._incPendingOps();
  this._db.get(utils.createItemKeyFromIndex(key, 0), function(err) {
    self._decPendingOps();
    callback(!err);
  });
};
/**
 * @callback Sbucket~existsCallback
 * @param {Boolean} fileDoesExist
 */

/**
 * Deletes the file chunks from the database
 * @param {String} key - The key for the file stored
 * @param {Sbucket~unlinkCallback}
 */
Sbucket.prototype.unlink = function(key, callback) {
  var self = this;
  var index = 0;

  function _del(index, callback) {
    var itemKey = utils.createItemKeyFromIndex(key, index);

    self._db.get(itemKey, function(err) {
      index++;

      if (!err) {
        self._db.del(itemKey, function() {
          _del(index, callback);
        });
      } else if (err.type === 'NotFoundError') {
        self._decPendingOps();
        callback(null);
      } else {
        self._decPendingOps();
        callback(err);
      }
    });
  }

  this._incPendingOps();
  _del(index, callback);
};
/**
 * @callback Sbucket~unlinkCallback
 * @param {Error} [error]
 */

/**
 * Reads the file at the given key into a buffer
 * @param {String} key - The key for the file to read
 * @param {Sbucket~readFileCallback}
 */
Sbucket.prototype.readFile = function(key, callback) {
  var self = this;
  var fileBuffer = new Buffer([], 'binary');
  var readStream = this.createReadStream(key);

  readStream.on('data', function(data) {
    fileBuffer = Buffer.concat([fileBuffer, data]);
  });

  readStream.on('end', function() {
    self._decPendingOps();
    callback(null, fileBuffer);
  });

  readStream.on('error', function(err) {
    self._decPendingOps();
    readStream.removeAllListeners();
    callback(err);
  });

  this._incPendingOps();
};
/**
 * @callback Sbucket~readFileCallback
 * @param {Error} [error]
 * @param {Buffer} fileBuffer
 */

/**
 * Writes the buffer to the given key
 * @param {String} key - The key for the file to write
 * @param {Buffer} buffer - The data to write to the given key
 * @param {Sbucket~writeFileCallback}
 */
Sbucket.prototype.writeFile = function(key, buffer, callback) {
  var self = this;
  var writeStream = this.createWriteStream(key);
  var whichSlice = 0;

  function _writeFileSlice() {
    var startIndex = whichSlice * constants.C;
    var endIndex = startIndex + constants.C;
    var bufferSlice = buffer.slice(startIndex, endIndex);

    if (bufferSlice.length === 0) {
      return writeStream.end();
    }

    writeStream.write(bufferSlice);
    _writeFileSlice();
  }

  writeStream.on('finish', function() {
    self._decPendingOps();
    callback(null);
  });

  writeStream.on('error', function(err) {
    self._decPendingOps();
    writeStream.removeAllListeners();
    callback(err);
  });

  this._incPendingOps();
  this.unlink(key, function(err) {
    if (err) {
      return callback(err);
    }

    _writeFileSlice();
  });
};
/**
 * @callback Sbucket~writeFileCallback
 * @param {Error} [error]
 */

/**
 * Returns a readable stream of the file at the given key
 * @param {String} key - The key for the file to read
 * @returns {ReadableFileStream}
 */
Sbucket.prototype.createReadStream = function(key) {
  var rs = new ReadableFileStream({
    sBucket: this,
    fileKey: key
  });

  this._incPendingOps();
  rs.on('end', this._decPendingOps.bind(this));
};

/**
 * Returns a writable stream for a file at the given key
 * @param {String} key - The key for the file to read
 * @returns {WritableFileStream}
 */
Sbucket.prototype.createWriteStream = function(key) {
  var ws = new WritableFileStream({
    sBucket: this,
    fileKey: key
  });

  this._incPendingOps();
  ws.on('finish', this._decPendingOps.bind(this));

  return ws;
};

/**
 * Get stats for this bucket
 * @param {Sbucket~statCallback}
 */
Sbucket.prototype.stat = function(callback) {
  var self = this;

  this._incPendingOps();
  this._db.approximateSize(
    Sbucket.SIZE_START_KEY,
    Sbucket.SIZE_END_KEY,
    function(err, size) {
      self._decPendingOps();

      if (err) {
        return callback(err);
      }

      callback(null, {
        size: size,
        free: constants.S - size
      });
    }
  );
};
/**
 * @callback Sbucket~statCallback
 * @param {Error} [error]
 * @param {Object} bucketStats
 * @param {Number} bucketStats.size - The used space in bytes
 * @param {Number} bucketStats.free - The free space left in bytes
 */

/**
 * Increments the pending operations counter
 * @private
 */
Sbucket.prototype._incPendingOps = function() {
  this._pendingOperations++;
};

/**
 * Decrements the pending operations counter
 * @private
 * @fires Sbucket#idle
 */
Sbucket.prototype._decPendingOps = function() {
  var self = this;

  function _checkIdleState() {
    if (self._pendingOperations === 0) {
      self.emit('idle');
    }
  }

  this._pendingOperations--;

  setImmediate(_checkIdleState);
};

module.exports = Sbucket;