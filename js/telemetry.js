/*
 * telemetry.js - the client half of the analytics beacon.
 *
 * Queues a small, fixed vocabulary of events and posts them to /api/track in
 * batches. Nothing here is trusted: the server re-derives the timestamp, page,
 * panel, user and IP hash, drops any kind or property outside its allow-list,
 * and rate limits per session. This file only has to be cheap, quiet, and
 * incapable of breaking the page.
 *
 * Exposes window.ESITrack:
 *   ESITrack.event(kind, props)   queue one event
 *   ESITrack.error(kind, detail)  queue one client error
 *   ESITrack.flush()              send now (used on page hide)
 */
(function () {
  "use strict";

  var TOKEN_URL = "/api/track/token";
  var TRACK_URL = "/api/track";
  var MAX_EVENTS = 20;
  var MAX_ERRORS = 10;
  var MAX_BYTES = 4096;
  var MAX_QUEUE = 200;
  var FLUSH_DELAY = 1500;
  var RETRY_DELAY = 10000;
  var DEPTH_TICK = 15000;
  var IDLE_AFTER = 60000;
  var MAX_TICK = 5 * 60 * 1000;

  function noop() {}

  if (window.ESITrack) {
    return;
  }
  if (navigator.doNotTrack === "1" || window.doNotTrack === "1" ||
      navigator.msDoNotTrack === "1") {
    window.ESITrack = { event: noop, error: noop, flush: noop };
    return;
  }

  var token = null;
  var tokenExpiresAt = 0;
  var events = [];
  var errors = [];
  var timer = null;
  var inFlight = false;
  var environment = null;
  var depth = { scroll: 0, activeMs: 0, idleMs: 0, hiddenMs: 0, lastTick: Date.now(),
                lastActivity: Date.now(), hiddenSince: null };

  function safe(fn, fallback) {
    try {
      return fn();
    } catch (e) {
      return fallback;
    }
  }

  function clip(value, max) {
    return String(value == null ? "" : value).slice(0, max);
  }

  function detectBrowser() {
    var data = navigator.userAgentData;
    if (data && data.brands) {
      var known = {
        "Google Chrome": "chrome",
        "Chromium": "chromium",
        "Microsoft Edge": "edge",
        "Opera": "opera",
        "Brave": "brave",
        "Firefox": "firefox",
        "Safari": "safari"
      };
      for (var i = 0; i < data.brands.length; i++) {
        var match = known[data.brands[i].brand];
        if (match) {
          return match;
        }
      }
    }
    var ua = navigator.userAgent || "";
    if (/Edg\//.test(ua)) return "edge";
    if (/OPR\//.test(ua)) return "opera";
    if (/Firefox\//.test(ua)) return "firefox";
    if (/Chrome\//.test(ua)) return "chrome";
    if (/Safari\//.test(ua)) return "safari";
    return "other";
  }

  function detectOs() {
    var data = navigator.userAgentData;
    if (data && data.platform) {
      var platform = String(data.platform).toLowerCase();
      if (platform.indexOf("windows") === 0) return "windows";
      if (platform.indexOf("chrome os") === 0) return "chromeos";
      if (platform.indexOf("mac") === 0) return "macos";
      if (platform.indexOf("android") === 0) return "android";
      if (platform.indexOf("ios") === 0) return "ios";
      if (platform.indexOf("linux") === 0) return "linux";
    }
    var ua = navigator.userAgent || "";
    if (/Windows/.test(ua)) return "windows";
    if (/Android/.test(ua)) return "android";
    if (/iPhone|iPad|iPod/.test(ua)) return "ios";
    if (/CrOS/.test(ua)) return "chromeos";
    if (/Mac OS X/.test(ua)) return "macos";
    if (/Linux/.test(ua)) return "linux";
    return "other";
  }

  function detectDevice() {
    var ua = navigator.userAgent || "";
    if (/iPad|Tablet|PlayBook|Silk/i.test(ua)) return "tablet";
    if (/Android/i.test(ua) && !/Mobile/i.test(ua)) return "tablet";
    if (/Mobi|Android|iPhone|iPod/i.test(ua)) return "mobile";
    return "desktop";
  }

  function detectConnection() {
    var conn = navigator.connection || navigator.mozConnection ||
               navigator.webkitConnection;
    if (!conn) {
      return "unknown";
    }
    var effective = String(conn.effectiveType || "");
    if (["slow-2g", "2g", "3g", "4g", "5g"].indexOf(effective) !== -1) {
      return effective;
    }
    if (conn.type === "wifi") return "wifi";
    if (conn.type === "ethernet") return "ethernet";
    return "unknown";
  }

  function buildEnvironment() {
    var data = navigator.userAgentData;
    return {
      device: detectDevice(),
      os: detectOs(),
      browser: detectBrowser(),
      platform: data && data.platform ? clip(data.platform, 24) : "",
      locale: clip(navigator.language || "", 24),
      timezone: safe(function () {
        return clip(Intl.DateTimeFormat().resolvedOptions().timeZone || "", 48);
      }, "")
    };
  }

  function buildId() {
    var scripts = document.getElementsByTagName("script");
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].src || "";
      var match = src.match(/\/assets\/[^/]*?([0-9A-Za-z_-]{8})\.js/);
      if (match) return match[1];
    }
    return "";
  }

  function bannerEnabled() {
    var raw = safe(function () { return localStorage.getItem("esi_settings"); }, null);
    if (!raw) return true;
    var parsed = safe(function () { return JSON.parse(raw); }, null);
    if (!parsed || typeof parsed !== "object") return true;
    return parsed.showPinnedBanner !== false;
  }

  function utmProps() {
    var out = {};
    var search = safe(function () { return String(window.location.search || ""); }, "");
    if (!search) return out;
    var params = {};
    search.replace(/^\?/, "").split("&").forEach(function (pair) {
      var split = pair.indexOf("=");
      if (split < 1) return;
      params[safe(function () {
        return decodeURIComponent(pair.slice(0, split));
      }, "")] = safe(function () {
        return decodeURIComponent(pair.slice(split + 1));
      }, "");
    });
    if (params.utm_campaign) out.utm_campaign = clip(params.utm_campaign, 40);
    if (params.utm_source) out.utm_source = clip(params.utm_source, 24);
    if (params.utm_medium) out.utm_medium = clip(params.utm_medium, 24);
    return out;
  }

  function pageViewProps() {
    var props = {
      banner_enabled: bannerEnabled(),
      build: buildId(),
      viewport: clip(window.innerWidth + "x" + window.innerHeight, 16),
      screen: clip(
        (window.screen ? window.screen.width + "x" + window.screen.height : ""),
        16
      ),
      connection: detectConnection()
    };
    if (typeof navigator.deviceMemory === "number") {
      props.memory = Math.round(navigator.deviceMemory);
    }
    if (typeof navigator.hardwareConcurrency === "number") {
      props.cores = Math.round(navigator.hardwareConcurrency);
    }
    var reduced = safe(function () {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }, null);
    if (typeof reduced === "boolean") {
      props.reduced_motion = reduced;
    }
    var utm = utmProps();
    Object.keys(utm).forEach(function (key) { props[key] = utm[key]; });
    return props;
  }

  function noteActivity() {
    depth.lastActivity = Date.now();
  }

  function tickDepth() {
    var now = Date.now();
    var elapsed = now - depth.lastTick;
    depth.lastTick = now;
    if (elapsed <= 0 || elapsed > MAX_TICK) return;
    if (now - depth.lastActivity <= IDLE_AFTER) depth.activeMs += elapsed;
    else depth.idleMs += elapsed;
  }

  function noteScroll(target) {
    var doc = document.documentElement;
    var body = document.body;
    var scroller = (target && target.scrollHeight) ? target : null;
    var height = Math.max(
      scroller ? scroller.scrollHeight || 0 : 0,
      doc ? doc.scrollHeight || 0 : 0,
      body ? body.scrollHeight || 0 : 0
    );
    if (height <= 0) return;
    var top = Math.max(
      scroller ? scroller.scrollTop || 0 : 0,
      window.pageYOffset || 0,
      doc ? doc.scrollTop || 0 : 0,
      body ? body.scrollTop || 0 : 0
    );
    var viewport = window.innerHeight || (doc ? doc.clientHeight : 0) || 0;
    var pct = Math.max(0, Math.min(100, Math.round((top + viewport) / height * 100)));
    if (pct > depth.scroll) depth.scroll = pct;
  }

  function emitDepth() {
    if (depth.hiddenSince !== null) {
      depth.hiddenMs += Date.now() - depth.hiddenSince;
      depth.hiddenSince = null;
    }
    tickDepth();
    noteScroll();
    if (!depth.activeMs && !depth.idleMs && !depth.hiddenMs && !depth.scroll) return;
    queue("depth", {
      scroll: depth.scroll,
      active_ms: Math.round(depth.activeMs),
      idle_ms: Math.round(depth.idleMs),
      hidden_ms: Math.round(depth.hiddenMs)
    });
    depth.activeMs = 0;
    depth.idleMs = 0;
    depth.hiddenMs = 0;
  }

  function schedule(delay) {
    if (timer) {
      return;
    }
    timer = window.setTimeout(function () {
      timer = null;
      flush(false);
    }, delay == null ? FLUSH_DELAY : delay);
  }

  function queue(kind, props) {
    if (!kind || events.length >= MAX_QUEUE) {
      return;
    }
    events.push({ kind: clip(kind, 40), props: props || {} });
    schedule();
  }

  function queueError(kind, detail) {
    if (!kind || errors.length >= MAX_QUEUE) {
      return;
    }
    detail = detail || {};
    errors.push({
      kind: clip(kind, 24),
      message: clip(detail.message, 300),
      source: clip(detail.source, 200),
      line: typeof detail.line === "number" ? detail.line : null,
      build: clip(detail.build, 40)
    });
    schedule();
  }

  function withToken(callback) {
    var now = Date.now();
    if (token && now < tokenExpiresAt) {
      callback(true);
      return;
    }
    if (!window.fetch) {
      callback(false);
      return;
    }
    window.fetch(TOKEN_URL, {
      credentials: "same-origin",
      headers: { "Accept": "application/json" }
    }).then(function (response) {
      return response.ok ? response.json() : null;
    }).then(function (data) {
      if (!data || !data.token) {
        callback(false);
        return;
      }
      token = data.token;
      tokenExpiresAt = Date.now() +
        Math.max(60, (data.expires_in || 1800) - 300) * 1000;
      callback(true);
    })["catch"](function () {
      callback(false);
    });
  }

  function buildBody(batchEvents, batchErrors) {
    return JSON.stringify({
      token: token,
      client: environment || (environment = buildEnvironment()),
      events: batchEvents,
      errors: batchErrors
    });
  }

  function takeBatch() {
    var batchEvents = events.slice(0, MAX_EVENTS);
    var batchErrors = errors.slice(0, MAX_ERRORS);
    var body = buildBody(batchEvents, batchErrors);
    while (body.length > MAX_BYTES && batchEvents.length + batchErrors.length > 1) {
      if (batchErrors.length) {
        batchErrors.pop();
      } else {
        batchEvents.pop();
      }
      body = buildBody(batchEvents, batchErrors);
    }
    if (body.length > MAX_BYTES) {
      // A single item that cannot fit is dropped rather than retried forever.
      if (batchErrors.length) {
        errors.shift();
      } else if (batchEvents.length) {
        events.shift();
      }
      return null;
    }
    return { body: body, events: batchEvents.length, errors: batchErrors.length };
  }

  function post(body, useBeacon) {
    try {
      if (useBeacon && navigator.sendBeacon) {
        var blob = new Blob([body], { type: "application/json" });
        return navigator.sendBeacon(TRACK_URL, blob);
      }
      if (window.fetch) {
        window.fetch(TRACK_URL, {
          method: "POST",
          credentials: "same-origin",
          keepalive: true,
          headers: { "Content-Type": "application/json" },
          body: body
        })["catch"](function () {});
        return true;
      }
    } catch (e) {
      // Under-reporting beats breaking the page.
    }
    return false;
  }

  function flush(useBeacon) {
    if (inFlight || (!events.length && !errors.length)) {
      return;
    }
    inFlight = true;
    withToken(function (ok) {
      inFlight = false;
      if (!ok) {
        schedule(RETRY_DELAY);
        return;
      }
      var batch = takeBatch();
      if (!batch) {
        return;
      }
      if (!post(batch.body, useBeacon)) {
        schedule(RETRY_DELAY);
        return;
      }
      events.splice(0, batch.events);
      errors.splice(0, batch.errors);
      if (events.length || errors.length) {
        schedule();
      }
    });
  }

  // global error capture

  window.addEventListener("error", function (event) {
    if (event && event.target && event.target !== window && event.target.tagName) {
      queueError("broken_asset", {
        message: clip(event.target.tagName.toLowerCase(), 60),
        source: clip(event.target.src || event.target.href || "", 200),
        build: buildId()
      });
      return;
    }
    queueError("error", {
      message: event && event.message,
      source: event && event.filename,
      line: event && event.lineno,
      build: buildId()
    });
  }, true);

  window.addEventListener("unhandledrejection", function (event) {
    var reason = event && event.reason;
    queueError("rejection", {
      message: reason && reason.message ? reason.message : reason
    });
  });

  document.addEventListener("securitypolicyviolation", function (event) {
    if (!event) {
      return;
    }
    var detail = event.violatedDirective || event.effectiveDirective || "unknown";
    if (event.blockedURI) {
      detail += " " + event.blockedURI;
    }
    if (event.sample) {
      detail += " :: " + event.sample;
    }
    queueError("csp", {
      message: detail,
      source: event.sourceFile || event.documentURI || "",
      line: event.lineNumber,
      build: buildId()
    });
  });

  ["mousemove", "keydown", "click", "touchstart"].forEach(function (name) {
    window.addEventListener(name, function () {
      safe(noteActivity, null);
    }, { passive: true });
  });

  window.addEventListener("scroll", function (event) {
    safe(function () { noteScroll(event.target); }, null);
    safe(noteActivity, null);
  }, { passive: true, capture: true });
  window.setInterval(function () { safe(tickDepth, null); }, DEPTH_TICK);

  window.addEventListener("pagehide", function () {
    safe(emitDepth, null);
    flush(true);
  });

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") {
      safe(emitDepth, null);
      depth.hiddenSince = Date.now();
      flush(true);
    } else {
      depth.lastTick = Date.now();
      depth.lastActivity = Date.now();
    }
  });

  function onRouteChange() {
    flush(false);
    queue("page_view", pageViewProps());
  }

  ["pushState", "replaceState"].forEach(function (name) {
    var original = history[name];
    if (typeof original !== "function") {
      return;
    }
    history[name] = function () {
      var result = original.apply(this, arguments);
      safe(onRouteChange, null);
      return result;
    };
  });

  window.addEventListener("popstate", function () {
    safe(onRouteChange, null);
  });

  var _netFailures = {};
  var GIVE_UP_AFTER = 3;

  function noteNetwork(url, ok, status, ms) {
    var key = clip(url, 120);
    if (!key || key.indexOf("/api/track") !== -1) return;
    if (ok) {
      delete _netFailures[key];
      return;
    }
    var attempts = (_netFailures[key] || 0) + 1;
    _netFailures[key] = attempts;
    var props = { url: key, status: status || 0, ms: Math.round(ms), build: buildId() };
    queue("net", Object.assign({ action: "failed" }, props));
    if (attempts > 1) {
      queue("net", Object.assign({ action: "retry" }, props));
    }
    if (attempts >= GIVE_UP_AFTER) {
      queue("net", Object.assign({ action: "gave_up" }, props));
      delete _netFailures[key];
    }
  }

  function instrumentNetwork() {
    if (!window.fetch || window.fetch.__esiInstrumented) return;
    var original = window.fetch;
    var wrapped = function () {
      var args = arguments;
      var target = typeof args[0] === "string" ? args[0] : (args[0] && args[0].url) || "";
      var started = Date.now();
      return original.apply(this, args).then(function (response) {
        safe(function () { noteNetwork(target, response.ok, response.status, Date.now() - started); }, null);
        return response;
      }, function (error) {
        safe(function () { noteNetwork(target, false, 0, Date.now() - started); }, null);
        throw error;
      });
    };
    wrapped.__esiInstrumented = true;
    window.fetch = wrapped;
  }

  instrumentNetwork();

  window.ESITrack = {
    event: function (kind, props) {
      safe(function () {
        queue(kind, props);
      }, null);
    },
    error: function (kind, detail) {
      safe(function () {
        queueError(kind, detail);
      }, null);
    },
    flush: function () {
      safe(function () {
        flush(true);
      }, null);
    }
  };

  safe(function () {
    withToken(function () {});
    queue("page_view", pageViewProps());
  }, null);
})();
