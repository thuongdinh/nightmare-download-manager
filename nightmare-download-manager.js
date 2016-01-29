var Nightmare = require('nightmare'),
  sliced = require('sliced'),
  debug = require('debug')('nightmare:download-manager');

Nightmare.action('downloadManager',
  function(ns, options, parent, win, renderer, done) {
    var fs = require('fs'),
      join = require('path')
      .join,
      sliced = require('sliced');

    win.webContents.session.on('will-download',
      function(event, downloadItem, webContents) {
        parent.emit('log', 'will-download');
        if (options.ignoreDownloads) {
          downloadItem.cancel();
          return;
        }
        downloadItem.pause();

        var downloadInfo = {
          filename: downloadItem.getFilename(),
          mimetype: downloadItem.getMimeType(),
          receivedBytes: 0,
          totalBytes: downloadItem.getTotalBytes(),
          url: downloadItem.getURL(),
          path: join('./', downloadItem.getFilename())
        };

        downloadItem.on('done', function(e, state) {
          if (state == 'completed') {
            fs.renameSync(join('./', downloadItem.getFilename()), downloadInfo.path);
          }
          parent.emit('download', state, downloadInfo);
        });

        downloadItem.on('updated', function(event) {
          downloadInfo.receivedBytes = event.sender.getReceivedBytes();
          parent.emit('download', 'updated', downloadInfo);
        });

        downloadItem.setSavePath(downloadInfo.path);

        var handler = function() {
          var arguments = sliced(arguments)
            .filter(function(arg) {
              return !!arg;
            });
          var item, path;
          if (arguments.length == 1 && arguments[0] === Object(arguments[0])) {
            item = arguments[0];
          } else if (arguments.length == 2) {
            path = arguments[0];
            item = arguments[1];
          }

          parent.removeListener('download', handler);
          if (item.filename == downloadItem.getFilename()) {
            if (path == 'cancel') {
              downloadItem.cancel();
            } else {
              if (path && path !== 'continue') {
                //.setSavePath() does not overwrite the first .setSavePath() call
                //use `fs.rename` when download is completed
                downloadInfo.path = path;
              }
              downloadItem.resume();
            }
          }
        };

        parent.on('download', handler);
        parent.emit('log', 'will-download about bubble to parent');
        parent.emit('download', 'started', downloadInfo);
      });
    done();
  },
  function(done) {
    debug('downloadManager', 'setting up downloads hash');
    var self = this;
    self._downloads = self._downloads || {};
    self.child.on('download', function(state, downloadInfo) {
      debug('download', downloadInfo.filename + ' is ' + state + ': ' + ((downloadInfo.receivedBytes / downloadInfo.totalBytes) * 100)
        .toFixed(2) + '%');
      self._downloads[downloadInfo.filename] = downloadInfo;
      self._downloads[downloadInfo.filename].state = state;
      if (self.child.listeners('download')
        .length == 1 && state == 'started') {
        if (self.options.ignoreDownloads) {
          self.child.emit('download', 'cancel', downloadInfo);
        } else {
          self.child.emit('download', 'continue', downloadInfo);
        }
      }
    });
    done();
    return this;
  });

Nightmare.action('waitDownloadsComplete', function(done) {
  debug('waitDownloadsComplete', 'waiting for downloads to finish');

  var self = this;
  var dldone = function() {
    return Object.keys(self._downloads)
      .map(key => self._downloads[key])
      .filter(function(item) {
        return item.state != 'completed' && item.state != 'interrupted' && item.state != 'cancelled';
      }) == 0;
  };

  var _waitMsPassed = 0,
    _timeoutMs = 250,
    _elapsed = 0;


  var waitDownloads = function waitDownloads(self, done) {
    if (dldone()) {
      return done();
      _waitMsPassed = 0;
    } else if (self.options.downloadTimeout && _waitMsPassed > self.options.downloadTimeout) {
      _waitMsPassed = 0;
      return done(new Error('.wait() for download timed out after ' + self.options.downloadTimeout + 'msec'));
    } else {
      _waitMsPassed += _timeoutMs;
      setTimeout(function() {
        waitDownloads(self, done);
      }, _timeoutMs);
    }
  };

  var waitResponse = function() {
    setTimeout(function() {
      if (Object.keys(self._downloads || {})
        .length > 0) {
        waitDownloads(self, done);
      } else if (_elapsed < self.options.downloadResponseWait || 3000) {
        _elapsed += 100;
        waitResponse();
      } else if (_elapsed >= self.options.downloadResponseWait || 3000) {
        return done(new Error('.wait() for download never received a download after ' + (self.options.downloadResponseWait || 3000)));
      }
    }, 100);
  };

  if (!self.options.ignoreDownloads) {
    waitResponse();
  }else{
    done();
  }
});

Nightmare.prototype.emit = function() {
  this.child.emit.apply(this, sliced(arguments));
  return this;
};
