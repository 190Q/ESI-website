(function () {
  'use strict';

  // shared caches
  window.playtimeCache = {};
  window.guildStatsCache = {};

  // resolves once bulk playtime data is loaded
  var _resolve;
  window.playtimePrefetchReady = new Promise(function (resolve) { _resolve = resolve; });

  function applyBulkData(data) {
    window.playtimeCache = data.members;
    window.guildStatsCache = data.guild || {};
    // stash it so it has something to show if the server goes down later
    DataCache.writeCache('/api/guild/activity', data);
  }

  function fetchBulkPlaytime() {
    return fetch('/api/guild/activity')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        // server says it's still computing, try again
        if (!data || data.ready === false) {
          return false;
        }
        applyBulkData(data);
        return true;
      })
      .catch(function () {
        // server's down, try sessionStorage
        var cached = DataCache.readCache('/api/guild/activity');
        if (cached && cached.members && Object.keys(cached.members).length) {
          applyBulkData(cached);
          if (typeof window.showToast === 'function') {
            window.showToast('\u26a0 Could not refresh data \u2014 showing cached version.', 'warn');
          }
          return true;
        }
        return false;
      });
  }

  var _prefetchRetries = 0;
  var _PREFETCH_MAX_RETRIES = 40; // 40 * 3s = 2 minutes
  var _prefetchToast = null;

  function tryLoad() {
    fetchBulkPlaytime().then(function (loaded) {
      if (loaded) {
        // resolve the promise
        if (_prefetchToast) {
          _prefetchToast.updateItem('data', 'success');
          _prefetchToast.finish({ success: '\u2713 Activity data ready' });
          _prefetchToast = null;
        }
        _resolve();
      } else if (_prefetchRetries < _PREFETCH_MAX_RETRIES) {
        _prefetchRetries++;
        // show a toast after the first retry
        if (_prefetchRetries === 1 && typeof window.showProgressToast === 'function') {
          _prefetchToast = window.showProgressToast('Loading activity data\u2026');
          _prefetchToast.addItem('data', 'Activity data');
        }
        setTimeout(tryLoad, 3000);
      } else {
        // if timeout, let everything continue anyway
        if (_prefetchToast) {
          _prefetchToast.updateItem('data', 'error');
          _prefetchToast.finish({
            fail:    '\u2715 Activity data unavailable',
            partial: '\u26a0 Activity data unavailable',
          });
          _prefetchToast = null;
        } else if (typeof window.showToast === 'function') {
          window.showToast('\u26a0 Activity data unavailable \u2014 graphs may be empty.', 'warn');
        }
        _resolve();
      }
    });
  }

  tryLoad();

})();
