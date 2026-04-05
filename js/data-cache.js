(function () {
  'use strict';

  var PREFIX = 'esi_dc_';
  var _lastToastTime = 0;
  var TOAST_COOLDOWN = 5000; // one stale-data toast per 5s max

  function _storageKey(url) {
    return PREFIX + url.replace(/[^a-zA-Z0-9_/?.=-]/g, '_');
  }

  function _readStorage(url) {
    try {
      var raw = sessionStorage.getItem(_storageKey(url));
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function _writeStorage(url, data) {
    try {
      sessionStorage.setItem(_storageKey(url), JSON.stringify(data));
    } catch (e) {
      // if the storage full, ignore silently
    }
  }

  function _showStaleToast() {
    var now = Date.now();
    if (now - _lastToastTime < TOAST_COOLDOWN) return;
    _lastToastTime = now;
    if (typeof window.showToast === 'function') {
      window.showToast('\u26a0 Could not refresh data \u2014 showing cached version.', 'warn');
    }
  }

  // fetch with sessionStorage fallback, and on failure try to serve stale data
  function cachedFetch(url, fetchOpts) {
    var opts = Object.assign({}, fetchOpts || {});
    return fetch(url, opts)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        _writeStorage(url, data);
        return { data: data, fromCache: false };
      })
      .catch(function (err) {
        var cached = _readStorage(url);
        if (cached !== null) {
          _showStaleToast();
          return { data: cached, fromCache: true };
        }
        throw err;
      });
  }

  // read from cache
  function readCache(url) {
    return _readStorage(url);
  }

  // manually shove data into the cache
  function writeCache(url, data) {
    _writeStorage(url, data);
  }

  window.DataCache = {
    cachedFetch: cachedFetch,
    readCache: readCache,
    writeCache: writeCache,
  };
})();
