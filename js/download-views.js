(function () {
  'use strict';

  function _safeStringify(obj) {
    try {
      return JSON.stringify(obj, null, 2);
    } catch (e) {
      return JSON.stringify({ error: 'Could not serialize data' });
    }
  }

  function _triggerDownload(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    requestAnimationFrame(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  function _buildZip(files) {
    if (typeof JSZip === 'undefined') {
      throw new Error('JSZip is not loaded');
    }
    var zip = new JSZip();
    files.forEach(function (file) {
      zip.file(file.name, file.content);
    });
    return zip.generateAsync({ type: 'blob' });
  }

  function downloadFilesAsZip(filename, files) {
    _buildZip(files).then(function (blob) {
      _triggerDownload(blob, filename);
    }).catch(function (err) {
      if (typeof window.showToast === 'function') {
        window.showToast('\u26a0 Download failed: ' + (err && err.message ? err.message : 'unknown error'), 'error');
      }
    });
  }

  window.DownloadViews = {
    stringify: _safeStringify,
    downloadZip: downloadFilesAsZip,
  };
})();
