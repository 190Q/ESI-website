/*
 * panel-views.js - panel view and switch tracking.
 *
 * The active panel is set in four different places: the sidebar nav click
 * handler, the switchToPanel helper, and two URL-restore paths for deep links
 * and cached logins. Rather than instrument each one, this watches the DOM for
 * whichever panel actually became active, so a future code path is covered
 * without another edit here.
 *
 * Reports through window.ESITrack:
 *   panel_view    every panel that becomes active
 *   panel_switch  only when it replaces a different panel
 */
(function () {
  'use strict';

  var PANEL_SELECTOR = '.panel';
  var PREPAINT_ID = 'esi-preload-css';
  var POLL_MS = 250;
  var MAX_POLLS = 20;
  var SETTLE_TIMEOUT_MS = 5000;

  var current = '';
  var observer = null;

  function track(kind, props) {
    try {
      if (!window.ESITrack) return;
      window.ESITrack.event(kind, props);
    } catch (e) { /* analytics must never break the page */ }
  }

  function panelName(el) {
    var id = (el && el.id) || '';
    return id.indexOf('panel-') === 0 ? id.slice('panel-'.length) : '';
  }

  function activePanelName() {
    var panels = document.querySelectorAll(PANEL_SELECTOR);
    for (var i = 0; i < panels.length; i++) {
      if (panels[i].classList && panels[i].classList.contains('active')) {
        var name = panelName(panels[i]);
        if (name) return name;
      }
    }
    return '';
  }

  function note() {
    var next = activePanelName();
    if (!next || next === current) return;
    var previous = current;
    current = next;
    if (previous) track('panel_switch', { from: previous, to: next });
    track('panel_view', { panel: next });
  }

  // React renders its own default panel first and the pre-paint stylesheet
  // overrides its display. app.js removes that stylesheet at the moment it has
  // set the real active classes, so waiting for it to disappear is what keeps
  // the default panel from being counted as a view the visitor never had.
  function settled() {
    return !document.getElementById(PREPAINT_ID);
  }

  function observe() {
    if (observer || typeof MutationObserver === 'undefined') return !!observer;
    var panels = document.querySelectorAll(PANEL_SELECTOR);
    if (!panels.length) return false;
    observer = new MutationObserver(note);
    for (var i = 0; i < panels.length; i++) {
      observer.observe(panels[i], { attributes: true, attributeFilter: ['class'] });
    }
    return true;
  }

  function start() {
    var polls = 0;
    var startedAt = Date.now();

    function attempt() {
      if (settled() || Date.now() - startedAt > SETTLE_TIMEOUT_MS) {
        if (observe()) {
          note();
          return;
        }
      }
      if (polls++ >= MAX_POLLS) return;
      window.setTimeout(attempt, POLL_MS);
    }

    attempt();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  window.ESIPanelViews = { refresh: note };
})();
