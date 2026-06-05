(function () {
  'use strict';

  var _ROOT = document.documentElement;
  var _lastSignature = '';
  var _applyQueued = false;
  var _raf = window.requestAnimationFrame || function (cb) { return setTimeout(cb, 16); };

  var _PATTERN_TYPES = [
    'dots-grid',
    'dots-random',
    'cross-grid',
    'cross-random',
    'diagonal-lines',
    'checkerboard',
    'hexagonal-tiling',
    'graph-paper',
    'noise-grain',
    'topographic-contours',
    'watercolor-blobs',
    'paper-texture',
    'voronoi-diagram',
    'truchet-tiles',
    'wave-interference',
    'penrose-tiling',
  ];

  function _readVar(style, name, fallbackValue) {
    var value = String(style.getPropertyValue(name) || '').trim();
    if (!value && fallbackValue !== undefined) return String(fallbackValue);
    return value;
  }

  function _toNumber(raw, fallbackValue) {
    var value = parseFloat(String(raw || '').trim());
    if (!isFinite(value)) return fallbackValue;
    return value;
  }

  function _toPx(raw, fallbackPx) {
    var value = String(raw || '').trim();
    if (!value) return fallbackPx;
    if (/^-?\d+(?:\.\d+)?px$/i.test(value)) return parseFloat(value);
    var numeric = parseFloat(value);
    if (isFinite(numeric)) return numeric;
    return fallbackPx;
  }

  function _clamp(value, min, max) {
    if (value < min) return min;
    if (value > max) return max;
    return value;
  }

  function _toBool(raw, fallbackValue) {
    var value = String(raw || '').trim().toLowerCase();
    if (!value) return !!fallbackValue;
    if (/^(1|true|yes|on)$/i.test(value)) return true;
    if (/^(0|false|no|off)$/i.test(value)) return false;
    return !!fallbackValue;
  }

  function _fmt(value) {
    var rounded = Math.round(Number(value) * 1000) / 1000;
    var asText = String(rounded);
    if (asText.indexOf('.') === -1) return asText;
    return asText.replace(/0+$/, '').replace(/\.$/, '');
  }

  function _seededRng(seed) {
    var state = seed % 2147483647;
    if (state <= 0) state += 2147483646;
    return function () {
      state = state * 16807 % 2147483647;
      return (state - 1) / 2147483646;
    };
  }

  function _normalizeType(rawType) {
    var value = String(rawType || '').trim().toLowerCase();
    if (!value) return 'none';
    value = value
      .replace(/_/g, '-')
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');

    var aliases = {
      'none': 'none',
      'dots': 'dots-grid',
      'dot-grid': 'dots-grid',
      'dots-grid': 'dots-grid',
      'dots-drig': 'dots-grid',
      'dots-organized': 'dots-grid',
      'dots-random': 'dots-random',
      'dot-random': 'dots-random',
      'plus-grid': 'cross-grid',
      'cross': 'cross-grid',
      'cross-grid': 'cross-grid',
      'cross-plus-grid': 'cross-grid',
      'cross-organized': 'cross-grid',
      'plus-random': 'cross-random',
      'cross-random': 'cross-random',
      'diagonal-lines': 'diagonal-lines',
      'diagonal-stripes': 'diagonal-lines',
      'checkerboard': 'checkerboard',
      'hexagonal-tiling': 'hexagonal-tiling',
      'hexagon-grid': 'hexagonal-tiling',
      'hexagons': 'hexagonal-tiling',
      'graph-paper': 'graph-paper',
      'noise': 'noise-grain',
      'grain': 'noise-grain',
      'noise-grain': 'noise-grain',
      'topographic-contours': 'topographic-contours',
      'topographic-contour-lines': 'topographic-contours',
      'contour-lines': 'topographic-contours',
      'watercolor-blobs': 'watercolor-blobs',
      'watercolour-blobs': 'watercolor-blobs',
      'watercolor-clobs': 'watercolor-blobs',
      'watercolour-clobs': 'watercolor-blobs',
      'paper-texture': 'paper-texture',
      'voronoi': 'voronoi-diagram',
      'voronoi-diagram': 'voronoi-diagram',
      'truchet': 'truchet-tiles',
      'truchet-tiles': 'truchet-tiles',
      'turchet-tiles': 'truchet-tiles',
      'wave-interference': 'wave-interference',
      'moire': 'wave-interference',
      'wave-moire': 'wave-interference',
      'penrose': 'penrose-tiling',
      'penrose-tiling': 'penrose-tiling',
    };
    return aliases[value] || 'none';
  }

  function _normalizeRepeat(raw) {
    var value = String(raw || '').trim().toLowerCase();
    var allowed = {
      'repeat': true,
      'no-repeat': true,
      'repeat-x': true,
      'repeat-y': true,
      'space': true,
      'round': true,
    };
    if (!allowed[value]) return 'repeat';
    return value;
  }

  function _normalizeBlendMode(raw) {
    var value = String(raw || '').trim().toLowerCase();
    if (!value) return 'normal';
    if (!/^[a-z-]+$/.test(value)) return 'normal';
    return value;
  }

  function _svgOpen(width, height) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + _fmt(width) + ' ' + _fmt(height) + '" width="' + _fmt(width) + '" height="' + _fmt(height) + '">';
  }

  function _svgClose() {
    return '</svg>';
  }

  function _svgToCssUrl(svgText) {
    var encoded = encodeURIComponent(svgText).replace(/%0A/g, '').replace(/%20/g, ' ');
    return 'url("data:image/svg+xml,' + encoded + '")';
  }

  function _svgInner(svgText) {
    var open = String(svgText || '').indexOf('>');
    var close = String(svgText || '').lastIndexOf('</svg>');
    if (open < 0 || close < 0 || close <= open) return '';
    return String(svgText).slice(open + 1, close);
  }

  function _hasFixedPatternTargets() {
    if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return false;
    var selector = '.theme-pattern-surface, .theme-pattern-surface-soft, .sidebar, .content-area, .site-footer, .shop-modal, .owed-aspects-popup, .modal';
    var nodes = [];
    if (document.body) nodes.push(document.body);
    try {
      var matched = document.querySelectorAll(selector);
      for (var i = 0; i < matched.length; i++) nodes.push(matched[i]);
    } catch (_err) {}
    for (var j = 0; j < nodes.length; j++) {
      var node = nodes[j];
      if (!node || node.nodeType !== 1 || typeof node.getBoundingClientRect !== 'function') continue;
      var rect = node.getBoundingClientRect();
      if (!rect || rect.width < 1 || rect.height < 1) continue;
      var attachment = String(getComputedStyle(node).backgroundAttachment || '').toLowerCase();
      if (attachment.indexOf('fixed') !== -1) return true;
    }
    return false;
  }

  function _isStochasticPatternType(type) {
    return type === 'dots-random'
      || type === 'cross-random'
      || type === 'noise-grain'
      || type === 'topographic-contours'
      || type === 'watercolor-blobs'
      || type === 'paper-texture'
      || type === 'voronoi-diagram'
      || type === 'truchet-tiles'
      || type === 'wave-interference'
      || type === 'penrose-tiling';
  }
  function _isDotsPatternType(type) {
    return type === 'dots-grid' || type === 'dots-random';
  }

  function _withSeed(cfg, seed) {
    return {
      theme: cfg.theme,
      type: cfg.type,
      enabled: cfg.enabled,
      size: cfg.size,
      density: cfg.density,
      opacity: cfg.opacity,
      lineWidth: cfg.lineWidth,
      angle: cfg.angle,
      seed: seed,
      roughness: cfg.roughness,
      color: cfg.color,
      color2: cfg.color2,
      repeat: cfg.repeat,
      blendMode: cfg.blendMode,
      applyBody: cfg.applyBody,
      noRepeatScale: cfg.noRepeatScale,
    };
  }

  function _buildExpandedNoRepeatSvg(cfg, tileSvg, tileWidth, tileHeight, areaScaleX, areaScaleY) {
    var scaleX = Math.max(1, Math.round(areaScaleX || 1));
    var scaleY = Math.max(1, Math.round(areaScaleY || 1));
    var shouldReseedExpanded = _isStochasticPatternType(cfg.type) && cfg.type !== 'dots-random';
    if (shouldReseedExpanded) {
      var isDualAxisExpansion = scaleX > 1 && scaleY > 1;
      var maxStochasticScale = isDualAxisExpansion ? 8 : 24;
      scaleX = Math.min(scaleX, maxStochasticScale);
      scaleY = Math.min(scaleY, maxStochasticScale);
    }
    if (scaleX <= 1 && scaleY <= 1) return null;
    var width = Math.max(1, tileWidth * scaleX);
    var height = Math.max(1, tileHeight * scaleY);
    var svg = _svgOpen(width, height);

    if (cfg.type === 'watercolor-blobs') {
      var expandedCfg = _withSeed(cfg, cfg.seed);
      expandedCfg.sizeX = width;
      expandedCfg.sizeY = height;
      expandedCfg.motifBaseSize = Math.max(1, Math.min(tileWidth, tileHeight));
      var watercolorBuilt = _buildWatercolorBlobs(expandedCfg);
      if (!watercolorBuilt || !watercolorBuilt.svg) return null;
      return {
        svg: watercolorBuilt.svg,
        width: watercolorBuilt.width || width,
        height: watercolorBuilt.height || height,
      };
    }
    if (cfg.type === 'dots-grid') {
      var expandedGridCfg = _withSeed(cfg, cfg.seed);
      expandedGridCfg.sizeX = width;
      expandedGridCfg.sizeY = height;
      expandedGridCfg.motifBaseSize = Math.max(1, Math.min(tileWidth, tileHeight));
      var gridBuilt = _buildDotsGrid(expandedGridCfg);
      if (!gridBuilt || !gridBuilt.svg) return null;
      return {
        svg: gridBuilt.svg,
        width: gridBuilt.width || width,
        height: gridBuilt.height || height,
      };
    }
    if (cfg.type === 'dots-random') {
      var expandedDotsCfg = _withSeed(cfg, cfg.seed);
      expandedDotsCfg.sizeX = width;
      expandedDotsCfg.sizeY = height;
      expandedDotsCfg.motifBaseSize = Math.max(1, Math.min(tileWidth, tileHeight));
      var dotsBuilt = _buildDotsRandom(expandedDotsCfg);
      if (!dotsBuilt || !dotsBuilt.svg) return null;
      return {
        svg: dotsBuilt.svg,
        width: dotsBuilt.width || width,
        height: dotsBuilt.height || height,
      };
    }

    if (shouldReseedExpanded) {
      for (var row = 0; row < scaleY; row++) {
        for (var col = 0; col < scaleX; col++) {
          var idx = row * scaleX + col + 1;
          var seed = cfg.seed + (idx * 7919);
          var cellBuilt = _buildPattern(_withSeed(cfg, seed));
          if (!cellBuilt || !cellBuilt.svg) return null;
          var cellWidth = cellBuilt.width || tileWidth;
          var cellHeight = cellBuilt.height || tileHeight;
          if (Math.abs(cellWidth - tileWidth) > 0.01 || Math.abs(cellHeight - tileHeight) > 0.01) return null;
          var cellInner = _svgInner(cellBuilt.svg);
          if (!cellInner) continue;
          svg += '<g transform="translate(' + _fmt(col * tileWidth) + ' ' + _fmt(row * tileHeight) + ')">' + cellInner + '</g>';
        }
      }
      svg += _svgClose();
      return { svg: svg, width: width, height: height };
    }

    var inner = _svgInner(tileSvg);
    if (!inner) return null;
    var patternId = 'tp-nr-' + String(Math.abs((cfg.seed || 0) % 1000000));
    svg += '<defs><pattern id="' + patternId + '" patternUnits="userSpaceOnUse" width="' + _fmt(tileWidth) + '" height="' + _fmt(tileHeight) + '">' + inner + '</pattern></defs>'
      + '<rect x="0" y="0" width="' + _fmt(width) + '" height="' + _fmt(height) + '" fill="url(#' + patternId + ')"/>'
      + _svgClose();
    return { svg: svg, width: width, height: height };
  }

  function _hexPath(cx, cy, radius) {
    var points = [];
    for (var i = 0; i < 6; i++) {
      var angle = (Math.PI / 180) * (60 * i - 30);
      var x = cx + Math.cos(angle) * radius;
      var y = cy + Math.sin(angle) * radius;
      points.push(_fmt(x) + ' ' + _fmt(y));
    }
    return 'M ' + points.join(' L ') + ' Z';
  }

  function _blobPath(cx, cy, radius, pointCount, rng, roughness) {
    var points = [];
    for (var i = 0; i < pointCount; i++) {
      var angle = Math.PI * 2 * (i / pointCount);
      var jitter = 1 - (roughness * 0.35) + rng() * (roughness * 0.7);
      var r = radius * _clamp(jitter, 0.45, 1.65);
      points.push({
        x: cx + Math.cos(angle) * r,
        y: cy + Math.sin(angle) * r,
      });
    }
    var d = '';
    for (var p = 0; p < points.length; p++) {
      var point = points[p];
      if (p === 0) d += 'M ' + _fmt(point.x) + ' ' + _fmt(point.y);
      else d += ' L ' + _fmt(point.x) + ' ' + _fmt(point.y);
    }
    d += ' Z';
    return d;
  }

  function _periodicSinePath(width, baseY, amplitude, phase, cycles, samples, bleed) {
    var sampleCount = Math.max(16, Math.round(samples || 48));
    var edgeBleed = Math.max(0, bleed || 0);
    var startX = -edgeBleed;
    var endX = width + edgeBleed;
    var span = endX - startX;
    var d = '';
    for (var i = 0; i <= sampleCount; i++) {
      var t = i / sampleCount;
      var x = startX + span * t;
      var theta = ((x / width) * Math.PI * 2 * cycles) + phase;
      var y = baseY + Math.sin(theta) * amplitude;
      if (i === 0) d = 'M ' + _fmt(x) + ' ' + _fmt(y);
      else d += ' L ' + _fmt(x) + ' ' + _fmt(y);
    }
    return d;
  }

  function _periodicSinePathVertical(height, baseX, amplitude, phase, cycles, samples, bleed) {
    var sampleCount = Math.max(16, Math.round(samples || 48));
    var edgeBleed = Math.max(0, bleed || 0);
    var startY = -edgeBleed;
    var endY = height + edgeBleed;
    var span = endY - startY;
    var d = '';
    for (var i = 0; i <= sampleCount; i++) {
      var t = i / sampleCount;
      var y = startY + span * t;
      var theta = ((y / height) * Math.PI * 2 * cycles) + phase;
      var x = baseX + Math.sin(theta) * amplitude;
      if (i === 0) d = 'M ' + _fmt(x) + ' ' + _fmt(y);
      else d += ' L ' + _fmt(x) + ' ' + _fmt(y);
    }
    return d;
  }

  function _buildDotsGrid(cfg) {
    var w = cfg.sizeX || cfg.size;
    var h = cfg.sizeY || cfg.size;
    var motifBase = Math.max(1, cfg.motifBaseSize || cfg.size);
    var cells = 2 + Math.round(cfg.density * 4);
    var baseStep = motifBase / cells;
    var cols = Math.max(1, Math.round(w / baseStep));
    var rows = Math.max(1, Math.round(h / baseStep));
    var stepX = w / cols;
    var stepY = h / rows;
    var radius = Math.max(0.45, Math.min(stepX, stepY) * (0.18 + cfg.density * 0.12));
    var svg = _svgOpen(w, h);
    for (var row = 0; row < rows; row++) {
      var y = (row + 0.5) * stepY;
      for (var col = 0; col < cols; col++) {
        var x = (col + 0.5) * stepX;
        var usePrimary = ((row + col) % 2) === 0;
        var color = usePrimary ? cfg.color : cfg.color2;
        var alpha = _clamp(cfg.opacity * (usePrimary ? 1 : 0.78), 0.02, 1);
        svg += '<circle cx="' + _fmt(x) + '" cy="' + _fmt(y) + '" r="' + _fmt(radius) + '" fill="' + color + '" fill-opacity="' + _fmt(alpha) + '"/>';
      }
    }
    svg += _svgClose();
    return { svg: svg, width: w, height: h };
  }

  function _buildDotsRandom(cfg) {
    var rng = _seededRng(cfg.seed + 101);
    var w = cfg.sizeX || cfg.size;
    var h = cfg.sizeY || cfg.size;
    var motifBase = Math.max(1, cfg.motifBaseSize || cfg.size);
    var areaFactor = Math.max(1, (w * h) / (motifBase * motifBase));
    var count = Math.round((8 + cfg.density * 28) * areaFactor);
    var useFullWrap = areaFactor <= 1.2;
    var svg = _svgOpen(w, h);
    for (var i = 0; i < count; i++) {
      var x = rng() * w;
      var y = rng() * h;
      var radius = motifBase * (0.012 + rng() * (0.03 + cfg.density * 0.08));
      var color = i % 3 === 0 ? cfg.color2 : cfg.color;
      var alpha = _clamp(cfg.opacity * (0.4 + rng() * 0.8), 0.03, 1);
      if (useFullWrap) {
        for (var ox = -1; ox <= 1; ox++) {
          for (var oy = -1; oy <= 1; oy++) {
            svg += '<circle cx="' + _fmt(x + (ox * w)) + '" cy="' + _fmt(y + (oy * h)) + '" r="' + _fmt(radius) + '" fill="' + color + '" fill-opacity="' + _fmt(alpha) + '"/>';
          }
        }
      } else {
        var reach = radius + 1.5;
        var xOffsets = [0];
        var yOffsets = [0];
        if (x - reach < 0) xOffsets.push(w);
        if (x + reach > w) xOffsets.push(-w);
        if (y - reach < 0) yOffsets.push(h);
        if (y + reach > h) yOffsets.push(-h);
        for (var xi = 0; xi < xOffsets.length; xi++) {
          for (var yi = 0; yi < yOffsets.length; yi++) {
            svg += '<circle cx="' + _fmt(x + xOffsets[xi]) + '" cy="' + _fmt(y + yOffsets[yi]) + '" r="' + _fmt(radius) + '" fill="' + color + '" fill-opacity="' + _fmt(alpha) + '"/>';
          }
        }
      }
    }
    svg += _svgClose();
    return { svg: svg, width: w, height: h };
  }

  function _buildCrossGrid(cfg) {
    var w = cfg.size;
    var h = cfg.size;
    var centerX = w / 2;
    var centerY = h / 2;
    var arm = w * (0.15 + cfg.density * 0.22);
    var stroke = Math.max(0.4, cfg.lineWidth);
    var svg = _svgOpen(w, h)
      + '<path d="M ' + _fmt(centerX - arm) + ' ' + _fmt(centerY) + ' L ' + _fmt(centerX + arm) + ' ' + _fmt(centerY)
      + ' M ' + _fmt(centerX) + ' ' + _fmt(centerY - arm) + ' L ' + _fmt(centerX) + ' ' + _fmt(centerY + arm)
      + '" stroke="' + cfg.color + '" stroke-opacity="' + _fmt(cfg.opacity) + '" stroke-width="' + _fmt(stroke) + '" stroke-linecap="round"/>'
      + '<circle cx="' + _fmt(centerX) + '" cy="' + _fmt(centerY) + '" r="' + _fmt(Math.max(0.8, stroke * 0.75)) + '" fill="' + cfg.color2 + '" fill-opacity="' + _fmt(cfg.opacity * 0.8) + '"/>'
      + _svgClose();
    return { svg: svg, width: w, height: h };
  }

  function _buildCrossRandom(cfg) {
    var rng = _seededRng(cfg.seed + 203);
    var w = cfg.size;
    var h = cfg.size;
    var count = Math.round(5 + cfg.density * 22);
    var stroke = Math.max(0.35, cfg.lineWidth);
    var svg = _svgOpen(w, h);
    for (var i = 0; i < count; i++) {
      var x = rng() * w;
      var y = rng() * h;
      var len = w * (0.05 + rng() * (0.06 + cfg.density * 0.14));
      var angle = Math.round(rng() * 180);
      var color = i % 2 ? cfg.color : cfg.color2;
      var alpha = _clamp(cfg.opacity * (0.35 + rng() * 0.8), 0.03, 1);
      svg += '<g transform="translate(' + _fmt(x) + ' ' + _fmt(y) + ') rotate(' + angle + ')">'
        + '<path d="M ' + _fmt(-len) + ' 0 L ' + _fmt(len) + ' 0 M 0 ' + _fmt(-len) + ' L 0 ' + _fmt(len) + '"'
        + ' stroke="' + color + '" stroke-opacity="' + _fmt(alpha) + '" stroke-width="' + _fmt(stroke) + '" stroke-linecap="round"/></g>';
    }
    svg += _svgClose();
    return { svg: svg, width: w, height: h };
  }

  function _buildDiagonalLines(cfg) {
    var spacing = Math.max(4, cfg.size * (0.1 + (1 - cfg.density) * 0.26));
    var stroke = Math.max(0.35, cfg.lineWidth);
    var solidStart = Math.max(0, spacing - stroke);
    var opacityPct = _clamp(cfg.opacity * 100, 0, 100);
    var lineColor = 'color-mix(in srgb, ' + cfg.color + ' ' + _fmt(opacityPct) + '%, transparent)';
    var image = 'repeating-linear-gradient(' + _fmt(cfg.angle) + 'deg,'
      + ' transparent 0px,'
      + ' transparent ' + _fmt(solidStart) + 'px,'
      + ' ' + lineColor + ' ' + _fmt(solidStart) + 'px,'
      + ' ' + lineColor + ' ' + _fmt(spacing) + 'px'
      + ')';
    return { image: image, sizeX: 'auto', sizeY: 'auto' };
  }

  function _buildCheckerboard(cfg) {
    var w = cfg.size;
    var h = cfg.size;
    var cellW = w / 2;
    var cellH = h / 2;
    var alphaA = _clamp(cfg.opacity * 0.95, 0.03, 1);
    var alphaB = _clamp(cfg.opacity * 0.5, 0.02, 1);
    var svg = _svgOpen(w, h)
      + '<rect x="0" y="0" width="' + _fmt(cellW) + '" height="' + _fmt(cellH) + '" fill="' + cfg.color + '" fill-opacity="' + _fmt(alphaA) + '"/>'
      + '<rect x="' + _fmt(cellW) + '" y="' + _fmt(cellH) + '" width="' + _fmt(cellW) + '" height="' + _fmt(cellH) + '" fill="' + cfg.color + '" fill-opacity="' + _fmt(alphaA) + '"/>'
      + '<rect x="' + _fmt(cellW) + '" y="0" width="' + _fmt(cellW) + '" height="' + _fmt(cellH) + '" fill="' + cfg.color2 + '" fill-opacity="' + _fmt(alphaB) + '"/>'
      + '<rect x="0" y="' + _fmt(cellH) + '" width="' + _fmt(cellW) + '" height="' + _fmt(cellH) + '" fill="' + cfg.color2 + '" fill-opacity="' + _fmt(alphaB) + '"/>'
      + _svgClose();
    return { svg: svg, width: w, height: h };
  }

  function _buildHexagonalTiling(cfg) {
    var side = cfg.size / 2;
    var w = side * 4;
    var h = side * 1.7320508075688772;
    var radius = side * 0.48;
    var stroke = Math.max(0.35, cfg.lineWidth);
    var alpha = _clamp(cfg.opacity * 0.95, 0.03, 1);
    var centers = [
      { x: side, y: h * 0.5 },
      { x: side * 3, y: h * 0.5 },
      { x: side * 2, y: 0 },
      { x: side * 2, y: h },
    ];
    var svg = _svgOpen(w, h);
    for (var i = 0; i < centers.length; i++) {
      var c = centers[i];
      var path = _hexPath(c.x, c.y, radius);
      svg += '<path d="' + path + '" fill="none" stroke="' + cfg.color + '" stroke-opacity="' + _fmt(alpha) + '" stroke-width="' + _fmt(stroke) + '"/>';
    }
    svg += _svgClose();
    return { svg: svg, width: w, height: h };
  }

  function _buildGraphPaper(cfg) {
    var w = cfg.size;
    var h = cfg.size;
    var stroke = Math.max(0.25, cfg.lineWidth);
    var divisions = 3 + Math.round(cfg.density * 5);
    var step = w / divisions;
    var svg = _svgOpen(w, h);
    for (var i = 0; i <= divisions; i++) {
      var p = i * step;
      var major = (i === 0 || i === divisions || i === Math.round(divisions / 2));
      var color = major ? cfg.color : cfg.color2;
      var alpha = major ? cfg.opacity : cfg.opacity * 0.45;
      var width = major ? stroke * 1.4 : stroke * 0.75;
      svg += '<line x1="' + _fmt(p) + '" y1="0" x2="' + _fmt(p) + '" y2="' + _fmt(h) + '"'
        + ' stroke="' + color + '" stroke-opacity="' + _fmt(alpha) + '" stroke-width="' + _fmt(width) + '"/>';
      svg += '<line x1="0" y1="' + _fmt(p) + '" x2="' + _fmt(w) + '" y2="' + _fmt(p) + '"'
        + ' stroke="' + color + '" stroke-opacity="' + _fmt(alpha) + '" stroke-width="' + _fmt(width) + '"/>';
    }
    svg += _svgClose();
    return { svg: svg, width: w, height: h };
  }

  function _buildNoiseGrain(cfg) {
    var rng = _seededRng(cfg.seed + 307);
    var w = cfg.size;
    var h = cfg.size;
    var count = Math.round(90 + cfg.density * 260);
    var svg = _svgOpen(w, h);
    for (var i = 0; i < count; i++) {
      var x = rng() * w;
      var y = rng() * h;
      var grain = 0.45 + rng() * 1.8;
      var color = i % 2 ? cfg.color : cfg.color2;
      var alpha = _clamp(cfg.opacity * (0.12 + rng() * 0.42), 0.01, 0.7);
      svg += '<rect x="' + _fmt(x) + '" y="' + _fmt(y) + '" width="' + _fmt(grain) + '" height="' + _fmt(grain) + '"'
        + ' fill="' + color + '" fill-opacity="' + _fmt(alpha) + '"/>';
    }
    svg += _svgClose();
    return { svg: svg, width: w, height: h };
  }

  function _buildTopographic(cfg) {
    var rng = _seededRng(cfg.seed + 401);
    var w = cfg.size;
    var h = cfg.size;
    var lineCount = 4 + Math.round(cfg.density * 8);
    var stroke = Math.max(0.25, cfg.lineWidth);
    var ampBase = Math.max(3, h * (0.028 + cfg.density * 0.09));
    var safeMargin = Math.max(stroke * 2, ampBase * 1.15);
    var usableHeight = Math.max(1, h - (safeMargin * 2));
    var samples = 40 + Math.round(cfg.density * 24);
    var edgeBleed = Math.max(1.25, stroke * 1.8);
    var svg = _svgOpen(w, h);
    for (var i = 0; i < lineCount; i++) {
      var y = safeMargin + (((i + 0.5) / lineCount) * usableHeight);
      var amp = ampBase * (0.65 + rng() * 0.55);
      var phase = rng() * Math.PI * 2;
      var cycles = 1 + Math.floor(rng() * 3);
      var path = _periodicSinePath(w, y, amp, phase, cycles, samples, edgeBleed);
      var color = i % 2 ? cfg.color : cfg.color2;
      var alpha = _clamp(cfg.opacity * (0.62 + rng() * 0.45), 0.05, 1);
      var width = stroke * (0.9 + rng() * 0.8);
      svg += '<path d="' + path + '" fill="none" stroke="' + color + '" stroke-opacity="' + _fmt(alpha) + '" stroke-width="' + _fmt(width) + '" stroke-linecap="round" stroke-linejoin="round"/>';
    }
    svg += _svgClose();
    return { svg: svg, width: w, height: h };
  }

  function _buildWatercolorBlobs(cfg) {
    var rng = _seededRng(cfg.seed + 509);
    var w = cfg.sizeX || cfg.size;
    var h = cfg.sizeY || cfg.size;
    var motifBase = Math.max(1, cfg.motifBaseSize || cfg.size);
    var areaFactor = Math.max(1, (w * h) / (motifBase * motifBase));
    var blur = Math.max(1.2, motifBase * (0.022 + cfg.density * 0.02));
    var blobCount = Math.max(3, Math.round((3 + Math.round(cfg.density * 4)) * areaFactor));
    var filterId = 'wc-blur-' + String(Math.abs(cfg.seed % 1000000));
    var svg = _svgOpen(w, h)
      + '<defs><filter id="' + filterId + '" x="' + _fmt(-w) + '" y="' + _fmt(-h) + '" width="' + _fmt(w * 3) + '" height="' + _fmt(h * 3) + '" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="' + _fmt(blur) + '"/></filter></defs>';
    for (var i = 0; i < blobCount; i++) {
      var cx = rng() * w;
      var cy = rng() * h;
      var radius = motifBase * (0.16 + rng() * 0.22);
      var points = 7 + Math.floor(rng() * 4);
      var path = _blobPath(cx, cy, radius, points, rng, cfg.roughness);
      var color = i % 2 ? cfg.color : cfg.color2;
      var alpha = _clamp(cfg.opacity * (0.22 + rng() * 0.5), 0.04, 0.75);
      var reach = (radius * (1.1 + cfg.roughness * 0.85)) + blur * 3;
      var xWrap = [0];
      var yWrap = [0];
      if (cx - reach < 0) xWrap.push(w);
      if (cx + reach > w) xWrap.push(-w);
      if (cy - reach < 0) yWrap.push(h);
      if (cy + reach > h) yWrap.push(-h);
      for (var xIdx = 0; xIdx < xWrap.length; xIdx++) {
        for (var yIdx = 0; yIdx < yWrap.length; yIdx++) {
          var tx = xWrap[xIdx];
          var ty = yWrap[yIdx];
          var transform = '';
          if (tx || ty) transform = ' transform="translate(' + _fmt(tx) + ' ' + _fmt(ty) + ')"';
          svg += '<path d="' + path + '"' + transform + ' fill="' + color + '" fill-opacity="' + _fmt(alpha) + '" filter="url(#' + filterId + ')"/>';
        }
      }
    }
    svg += _svgClose();
    return { svg: svg, width: w, height: h };
  }

  function _buildPaperTexture(cfg) {
    var rng = _seededRng(cfg.seed + 601);
    var w = cfg.size;
    var h = cfg.size;
    var fibers = 80 + Math.round(cfg.density * 220);
    var flecks = 26 + Math.round(cfg.density * 76);
    var speckles = 220 + Math.round(cfg.density * 520);
    var stroke = Math.max(0.24, cfg.lineWidth * 0.85);
    var rough = _clamp(cfg.roughness * 0.7 + 0.2, 0.18, 1);
    var baseAlphaA = _clamp(cfg.opacity * (0.55 + cfg.density * 0.2), 0.08, 1);
    var baseAlphaB = _clamp(cfg.opacity * (0.34 + cfg.density * 0.18), 0.05, 0.95);
    var svg = _svgOpen(w, h)
      + '<rect x="0" y="0" width="' + _fmt(w) + '" height="' + _fmt(h) + '" fill="' + cfg.color2 + '" fill-opacity="' + _fmt(baseAlphaA) + '"/>'
      + '<rect x="0" y="0" width="' + _fmt(w) + '" height="' + _fmt(h) + '" fill="' + cfg.color + '" fill-opacity="' + _fmt(baseAlphaB) + '"/>';
    for (var i = 0; i < fibers; i++) {
      var x1 = rng() * w;
      var y1 = rng() * h;
      var len = w * (0.06 + rng() * (0.1 + cfg.density * 0.08));
      var angle = rng() * Math.PI * 2;
      var x2 = x1 + Math.cos(angle) * len;
      var y2 = y1 + Math.sin(angle) * len;
      var alpha = _clamp(cfg.opacity * (0.22 + rng() * 0.72), 0.04, 1);
      var color = (i % 3) ? cfg.color2 : cfg.color;
      var width = stroke * (0.55 + rng() * 1.25);
      svg += '<line x1="' + _fmt(x1) + '" y1="' + _fmt(y1) + '" x2="' + _fmt(x2) + '" y2="' + _fmt(y2) + '"'
        + ' stroke="' + color + '" stroke-opacity="' + _fmt(alpha) + '" stroke-width="' + _fmt(width) + '" stroke-linecap="round"/>';
    }
    for (var f = 0; f < flecks; f++) {
      var cx = rng() * w;
      var cy = rng() * h;
      var radius = w * (0.008 + rng() * 0.03);
      var points = 5 + Math.floor(rng() * 5);
      var blobPath = _blobPath(cx, cy, radius, points, rng, rough);
      var fleckColor = (f % 2) ? cfg.color : cfg.color2;
      var fleckAlpha = _clamp(cfg.opacity * (0.16 + rng() * 0.42), 0.03, 0.85);
      svg += '<path d="' + blobPath + '" fill="' + fleckColor + '" fill-opacity="' + _fmt(fleckAlpha) + '"/>';
    }
    for (var j = 0; j < speckles; j++) {
      var x = rng() * w;
      var y = rng() * h;
      var r = 0.35 + rng() * 1.35;
      var dotColor = (j % 4 === 0) ? cfg.color : cfg.color2;
      var alphaDot = _clamp(cfg.opacity * (0.14 + rng() * 0.5), 0.03, 0.9);
      svg += '<circle cx="' + _fmt(x) + '" cy="' + _fmt(y) + '" r="' + _fmt(r) + '" fill="' + dotColor + '" fill-opacity="' + _fmt(alphaDot) + '"/>';
    }
    svg += _svgClose();
    return { svg: svg, width: w, height: h };
  }

  function _buildVoronoi(cfg) {
    var rng = _seededRng(cfg.seed + 701);
    var w = cfg.size;
    var h = cfg.size;
    var pointCount = 9 + Math.round(cfg.density * 18);
    var points = [];
    var minDist = w * 0.07;
    var maxDist = w * 0.58;
    var stroke = Math.max(0.2, cfg.lineWidth * 0.9);
    for (var i = 0; i < pointCount; i++) {
      points.push({ x: rng() * w, y: rng() * h });
    }

    var svg = _svgOpen(w, h);
    for (var a = 0; a < points.length; a++) {
      for (var b = a + 1; b < points.length; b++) {
        var p1 = points[a];
        var p2 = points[b];
        var dx = p2.x - p1.x;
        var dy = p2.y - p1.y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < minDist || dist > maxDist) continue;
        var mx = (p1.x + p2.x) / 2;
        var my = (p1.y + p2.y) / 2;
        var ux = -dy / dist;
        var uy = dx / dist;
        var seg = Math.min(w * 0.24, dist * 0.42);
        var x1 = mx - ux * seg;
        var y1 = my - uy * seg;
        var x2 = mx + ux * seg;
        var y2 = my + uy * seg;
        var color = (a + b) % 2 ? cfg.color : cfg.color2;
        var alpha = _clamp(cfg.opacity * (0.25 + (1 - (dist / maxDist)) * 0.8), 0.03, 0.9);
        svg += '<line x1="' + _fmt(x1) + '" y1="' + _fmt(y1) + '" x2="' + _fmt(x2) + '" y2="' + _fmt(y2) + '"'
          + ' stroke="' + color + '" stroke-opacity="' + _fmt(alpha) + '" stroke-width="' + _fmt(stroke) + '"/>';
      }
    }
    for (var p = 0; p < points.length; p++) {
      svg += '<circle cx="' + _fmt(points[p].x) + '" cy="' + _fmt(points[p].y) + '" r="' + _fmt(Math.max(0.45, stroke * 0.6)) + '"'
        + ' fill="' + cfg.color + '" fill-opacity="' + _fmt(cfg.opacity * 0.7) + '"/>';
    }
    svg += _svgClose();
    return { svg: svg, width: w, height: h };
  }

  function _buildTruchet(cfg) {
    var rng = _seededRng(cfg.seed + 809);
    var w = cfg.size;
    var h = cfg.size;
    var cells = 2 + Math.round(cfg.density * 2);
    var cell = w / cells;
    var stroke = Math.max(0.35, cfg.lineWidth);
    var svg = _svgOpen(w, h);
    for (var row = 0; row < cells; row++) {
      for (var col = 0; col < cells; col++) {
        var x = col * cell;
        var y = row * cell;
        var color = (row + col) % 2 ? cfg.color : cfg.color2;
        var alpha = _clamp(cfg.opacity * 0.95, 0.03, 1);
        var orient = rng() > 0.5;
        var d1;
        var d2;
        if (orient) {
          d1 = 'M ' + _fmt(x) + ' ' + _fmt(y + cell) + ' A ' + _fmt(cell) + ' ' + _fmt(cell) + ' 0 0 1 ' + _fmt(x + cell) + ' ' + _fmt(y);
          d2 = 'M ' + _fmt(x) + ' ' + _fmt(y) + ' A ' + _fmt(cell) + ' ' + _fmt(cell) + ' 0 0 0 ' + _fmt(x + cell) + ' ' + _fmt(y + cell);
        } else {
          d1 = 'M ' + _fmt(x) + ' ' + _fmt(y) + ' A ' + _fmt(cell) + ' ' + _fmt(cell) + ' 0 0 1 ' + _fmt(x + cell) + ' ' + _fmt(y + cell);
          d2 = 'M ' + _fmt(x) + ' ' + _fmt(y + cell) + ' A ' + _fmt(cell) + ' ' + _fmt(cell) + ' 0 0 0 ' + _fmt(x + cell) + ' ' + _fmt(y);
        }
        svg += '<path d="' + d1 + '" fill="none" stroke="' + color + '" stroke-opacity="' + _fmt(alpha) + '" stroke-width="' + _fmt(stroke) + '" stroke-linecap="round"/>';
        svg += '<path d="' + d2 + '" fill="none" stroke="' + color + '" stroke-opacity="' + _fmt(alpha * 0.82) + '" stroke-width="' + _fmt(stroke) + '" stroke-linecap="round"/>';
      }
    }
    svg += _svgClose();
    return { svg: svg, width: w, height: h };
  }

  function _buildWaveInterference(cfg) {
    var w = cfg.size;
    var h = cfg.size;
    var stroke = Math.max(0.2, cfg.lineWidth * 0.68);
    var phaseBase = ((cfg.angle % 360) * Math.PI) / 180;
    var sampleCount = 54 + Math.round(cfg.density * 24);
    var edgeBleed = Math.max(1.2, stroke * 2.4);

    var rowCount = 4 + Math.round(cfg.density * 7);
    var colCount = 4 + Math.round(cfg.density * 7);
    var spacingY = h / rowCount;
    var spacingX = w / colCount;

    var ampY = Math.max(1.35, spacingY * (0.2 + cfg.density * 0.24));
    var ampX = Math.max(1.35, spacingX * (0.2 + cfg.density * 0.24));
    var cyclesA = 1 + Math.round(cfg.density * 2);
    var cyclesB = cyclesA + 1;

    var alphaA = _clamp((cfg.opacity * 1.45) + 0.14, 0.2, 0.68);
    var alphaB = _clamp((cfg.opacity * 0.7) + 0.05, 0.08, 0.3);

    var svg = _svgOpen(w, h);

    for (var i = -1; i <= rowCount; i++) {
      var row = ((i % rowCount) + rowCount) % rowCount;
      var baseY = (i / rowCount) * h;
      var ampRow = ampY * (1 + Math.sin((row + 1) * 1.7 + phaseBase * 0.5) * 0.18);
      var phaseRow = phaseBase + (row * ((Math.PI * 2) / rowCount)) * 0.9;
      var cyclesRow = cyclesA + (row % 2);
      var widthRow = stroke * (0.95 + (row % 3) * 0.15);
      var alphaRow = _clamp(alphaA * (0.9 + (row % 4) * 0.08), 0.11, 1);
      var rowPath = _periodicSinePath(w, baseY, ampRow, phaseRow, cyclesRow, sampleCount, edgeBleed);
      svg += '<path d="' + rowPath + '" fill="none" stroke="' + cfg.color + '" stroke-opacity="' + _fmt(alphaRow) + '" stroke-width="' + _fmt(widthRow) + '" stroke-linecap="round" stroke-linejoin="round"/>';
    }

    for (var j = -1; j <= colCount; j++) {
      var col = ((j % colCount) + colCount) % colCount;
      var baseX = (j / colCount) * w;
      var ampCol = ampX * (1 + Math.cos((col + 1) * 1.5 + phaseBase * 0.35) * 0.18);
      var phaseCol = (phaseBase * 0.7) + (col * ((Math.PI * 2) / colCount)) * 1.05;
      var cyclesCol = cyclesB + ((col + 1) % 2);
      var widthCol = stroke * (0.66 + (col % 3) * 0.1);
      var alphaCol = _clamp(alphaB * (0.84 + (col % 4) * 0.08), 0.06, 1);
      var colPath = _periodicSinePathVertical(h, baseX, ampCol, phaseCol, cyclesCol, sampleCount, edgeBleed);
      svg += '<path d="' + colPath + '" fill="none" stroke="' + cfg.color2 + '" stroke-opacity="' + _fmt(alphaCol) + '" stroke-width="' + _fmt(widthCol) + '" stroke-linecap="round" stroke-linejoin="round"/>';
    }

    svg += _svgClose();
    return { svg: svg, width: w, height: h };
  }

  function _penroseRosette(cx, cy, radius, cfg, seedShift, opts) {
    var options = opts || {};
    var detail = options.detail === undefined ? 1 : _clamp(options.detail, 0, 1);
    var fillScale = options.fillScale === undefined ? 1 : Math.max(0, options.fillScale);
    var strokeScale = options.strokeScale === undefined ? 1 : Math.max(0, options.strokeScale);
    var polyFillScale = options.polyFillScale === undefined ? 1 : Math.max(0, options.polyFillScale);
    var polyStrokeScale = options.polyStrokeScale === undefined ? 1 : Math.max(0, options.polyStrokeScale);
    var phi = (1 + Math.sqrt(5)) / 2;
    var innerRadius = radius / phi;
    var outer = [];
    var inner = [];
    var start = -Math.PI / 2 + seedShift;
    for (var i = 0; i < 5; i++) {
      var angleOuter = start + (Math.PI * 2 * i / 5);
      var angleInner = angleOuter + Math.PI / 5;
      outer.push({
        x: cx + Math.cos(angleOuter) * radius,
        y: cy + Math.sin(angleOuter) * radius,
      });
      inner.push({
        x: cx + Math.cos(angleInner) * innerRadius,
        y: cy + Math.sin(angleInner) * innerRadius,
      });
    }

    var out = '';
    var starPath = 'M ' + _fmt(outer[0].x) + ' ' + _fmt(outer[0].y);
    for (var p = 0; p < 5; p++) {
      var innerPt = inner[p];
      var nextOuter = outer[(p + 1) % 5];
      starPath += ' L ' + _fmt(innerPt.x) + ' ' + _fmt(innerPt.y)
        + ' L ' + _fmt(nextOuter.x) + ' ' + _fmt(nextOuter.y);
    }
    starPath += ' Z';
    out += '<path d="' + starPath + '" fill="' + cfg.color2 + '" fill-opacity="' + _fmt(cfg.opacity * 0.25 * fillScale) + '"'
      + ' stroke="' + cfg.color + '" stroke-opacity="' + _fmt(cfg.opacity * strokeScale) + '" stroke-width="' + _fmt(Math.max(0.16, cfg.lineWidth * 0.85 * strokeScale)) + '" stroke-linejoin="round"/>';

    if (detail <= 0) return out;

    var polygonCount = detail >= 1 ? 5 : Math.max(2, Math.round(5 * detail));
    for (var r = 0; r < polygonCount; r++) {
      var a = outer[r];
      var b = outer[(r + 1) % 5];
      var c = inner[r];
      var d = inner[(r + 4) % 5];
      var poly = _fmt(a.x) + ',' + _fmt(a.y) + ' ' + _fmt(c.x) + ',' + _fmt(c.y) + ' '
        + _fmt(b.x) + ',' + _fmt(b.y) + ' ' + _fmt(d.x) + ',' + _fmt(d.y);
      out += '<polygon points="' + poly + '" fill="' + cfg.color2 + '" fill-opacity="' + _fmt(cfg.opacity * 0.16 * polyFillScale) + '"'
        + ' stroke="' + cfg.color + '" stroke-opacity="' + _fmt(cfg.opacity * 0.85 * polyStrokeScale) + '" stroke-width="' + _fmt(Math.max(0.14, cfg.lineWidth * 0.7 * polyStrokeScale)) + '" stroke-linejoin="round"/>';
    }
    return out;
  }

  function _buildPenrose(cfg) {
    var w = cfg.size;
    var h = cfg.size;
    var shift = (cfg.seed % 360) * (Math.PI / 180) * 0.2;
    var cornerStyle = {
      detail: 0,
      fillScale: 0.24,
      strokeScale: 0.52,
      polyFillScale: 0.28,
      polyStrokeScale: 0.44,
    };
    var svg = _svgOpen(w, h);
    svg += _penroseRosette(w * 0.5, h * 0.5, w * 0.39, cfg, shift, { detail: 1, fillScale: 1.05, strokeScale: 1, polyFillScale: 1, polyStrokeScale: 1 });
    svg += _penroseRosette(0, 0, w * 0.22, cfg, shift + 0.4, cornerStyle);
    svg += _penroseRosette(w, 0, w * 0.22, cfg, shift + 0.8, cornerStyle);
    svg += _penroseRosette(0, h, w * 0.22, cfg, shift + 1.2, cornerStyle);
    svg += _penroseRosette(w, h, w * 0.22, cfg, shift + 1.6, cornerStyle);
    svg += _svgClose();
    return { svg: svg, width: w, height: h };
  }

  function _buildPattern(cfg) {
    switch (cfg.type) {
      case 'dots-grid': return _buildDotsGrid(cfg);
      case 'dots-random': return _buildDotsRandom(cfg);
      case 'cross-grid': return _buildCrossGrid(cfg);
      case 'cross-random': return _buildCrossRandom(cfg);
      case 'diagonal-lines': return _buildDiagonalLines(cfg);
      case 'checkerboard': return _buildCheckerboard(cfg);
      case 'hexagonal-tiling': return _buildHexagonalTiling(cfg);
      case 'graph-paper': return _buildGraphPaper(cfg);
      case 'noise-grain': return _buildNoiseGrain(cfg);
      case 'topographic-contours': return _buildTopographic(cfg);
      case 'watercolor-blobs': return _buildWatercolorBlobs(cfg);
      case 'paper-texture': return _buildPaperTexture(cfg);
      case 'voronoi-diagram': return _buildVoronoi(cfg);
      case 'truchet-tiles': return _buildTruchet(cfg);
      case 'wave-interference': return _buildWaveInterference(cfg);
      case 'penrose-tiling': return _buildPenrose(cfg);
      default: return null;
    }
  }

  function _readConfig() {
    var style = getComputedStyle(_ROOT);
    var type = _normalizeType(_readVar(style, '--theme-pattern-type', _readVar(style, '--theme-pattern', 'none')));
    var enabled = _toBool(_readVar(style, '--theme-pattern-enabled', ''), type !== 'none');
    var size = _clamp(_toPx(_readVar(style, '--theme-pattern-size', '120'), 120), 20, 520);
    var density = _clamp(_toNumber(_readVar(style, '--theme-pattern-density', '0.5'), 0.5), 0.05, 1);
    var opacity = _clamp(_toNumber(_readVar(style, '--theme-pattern-opacity', '0.35'), 0.35), 0.02, 1);
    var lineWidth = _clamp(_toNumber(_readVar(style, '--theme-pattern-line-width', '1.2'), 1.2), 0.2, 12);
    var angle = _toNumber(_readVar(style, '--theme-pattern-angle', '45'), 45);
    var seed = Math.floor(_toNumber(_readVar(style, '--theme-pattern-seed', '7'), 7));
    var roughness = _clamp(_toNumber(_readVar(style, '--theme-pattern-roughness', '0.6'), 0.6), 0, 1);
    var color = _readVar(style, '--theme-pattern-color', 'rgba(255, 255, 255, 0.3)');
    var color2 = _readVar(style, '--theme-pattern-color-2', 'rgba(255, 255, 255, 0.12)');
    var repeat = _normalizeRepeat(_readVar(style, '--theme-pattern-repeat', 'repeat'));
    var blendMode = _normalizeBlendMode(_readVar(style, '--theme-pattern-blend-mode', 'normal'));
    var applyBody = _toBool(_readVar(style, '--theme-pattern-apply-body', '1'), true);
    var noRepeatScale = _clamp(_toNumber(_readVar(style, '--theme-pattern-no-repeat-scale', '6'), 6), 1, 24);
    var theme = String(_ROOT.getAttribute('data-theme') || '').trim();
    return {
      theme: theme,
      type: type,
      enabled: enabled,
      size: size,
      density: density,
      opacity: opacity,
      lineWidth: lineWidth,
      angle: angle,
      seed: seed,
      roughness: roughness,
      color: color,
      color2: color2,
      repeat: repeat,
      blendMode: blendMode,
      applyBody: applyBody,
      noRepeatScale: noRepeatScale,
    };
  }

  function _clearPatternOutput() {
    _ROOT.style.setProperty('--theme-pattern-image', 'none');
    _ROOT.style.setProperty('--theme-pattern-body-image', 'none');
    _ROOT.style.setProperty('--theme-pattern-size-x', 'auto');
    _ROOT.style.setProperty('--theme-pattern-size-y', 'auto');
    _ROOT.style.setProperty('--theme-pattern-repeat-resolved', 'repeat');
    _ROOT.style.setProperty('--theme-pattern-position-resolved', 'top left');
    _ROOT.style.setProperty('--theme-pattern-blend-mode-resolved', 'normal');
    _ROOT.style.setProperty('--theme-pattern-active', '0');
    _ROOT.removeAttribute('data-theme-pattern');
    _ROOT.removeAttribute('data-theme-pattern-active');
  }

  function apply() {
    var cfg = _readConfig();
    var viewportWidth = Math.max(window.innerWidth || 0, _ROOT.clientWidth || 0, 1);
    var viewportHeight = Math.max(window.innerHeight || 0, _ROOT.clientHeight || 0, 1);
    var hasFixedTargets = _hasFixedPatternTargets();
    var signature = [
      cfg.theme,
      cfg.type,
      cfg.enabled ? '1' : '0',
      _fmt(cfg.size),
      _fmt(cfg.density),
      _fmt(cfg.opacity),
      _fmt(cfg.lineWidth),
      _fmt(cfg.angle),
      String(cfg.seed),
      _fmt(cfg.roughness),
      cfg.color,
      cfg.color2,
      cfg.repeat,
      cfg.blendMode,
      cfg.applyBody ? '1' : '0',
      _fmt(cfg.noRepeatScale),
      String(viewportWidth),
      String(viewportHeight),
      hasFixedTargets ? '1' : '0',
    ].join('|');

    if (signature === _lastSignature) return;
    _lastSignature = signature;

    if (!cfg.enabled || cfg.type === 'none') {
      _clearPatternOutput();
      return;
    }

    var built = _buildPattern(cfg);
    if (!built || (!built.svg && !built.image)) {
      _clearPatternOutput();
      return;
    }

    var image = built.image || _svgToCssUrl(built.svg);
    var width = built.width || cfg.size;
    var height = built.height || cfg.size;
    var sizeX = built.sizeX || (_fmt(width) + 'px');
    var sizeY = built.sizeY || (_fmt(height) + 'px');
    var resolvedSizeX = sizeX;
    var resolvedSizeY = sizeY;
    var position = 'top left';
    var resolvedRepeat = cfg.repeat;
    var preserveRepeatModes = _isDotsPatternType(cfg.type);

    if (cfg.repeat === 'space') {
      if (preserveRepeatModes) {
        if (built.svg && width > 0 && height > 0) {
          var dotsSpaceScale = Math.max(2, Math.min(cfg.noRepeatScale, 3));
          var expandedSpace = _buildExpandedNoRepeatSvg(cfg, built.svg, width, height, dotsSpaceScale, dotsSpaceScale);
          if (expandedSpace && expandedSpace.svg) {
            image = _svgToCssUrl(expandedSpace.svg);
            resolvedSizeX = _fmt(expandedSpace.width) + 'px';
            resolvedSizeY = _fmt(expandedSpace.height) + 'px';
            position = 'top left';
            resolvedRepeat = 'repeat';
          } else {
            resolvedRepeat = 'space';
          }
        } else {
          resolvedRepeat = 'space';
        }
      } else {
        if (hasFixedTargets) {
          resolvedRepeat = 'repeat';
        } else {
          var spaceTileCountX = width > 0 ? Math.floor(viewportWidth / width) : 0;
          var spaceTileCountY = height > 0 ? Math.floor(viewportHeight / height) : 0;
          var repeatX = spaceTileCountX >= 3 ? 'space' : 'repeat';
          var repeatY = spaceTileCountY >= 3 ? 'space' : 'repeat';
          resolvedRepeat = repeatX === repeatY ? repeatX : (repeatX + ' ' + repeatY);
        }
      }
    } else if (cfg.repeat === 'no-repeat') {
      if (built.svg && width > 0 && height > 0) {
        var expanded = _buildExpandedNoRepeatSvg(cfg, built.svg, width, height, cfg.noRepeatScale, cfg.noRepeatScale);
        if (expanded && expanded.svg) {
          image = _svgToCssUrl(expanded.svg);
          resolvedSizeX = _fmt(expanded.width) + 'px';
          resolvedSizeY = _fmt(expanded.height) + 'px';
          position = 'top left';
          resolvedRepeat = 'repeat';
        } else {
          resolvedRepeat = 'repeat';
        }
      } else {
        resolvedRepeat = 'repeat';
      }
    } else if (cfg.repeat === 'repeat-x' || cfg.repeat === 'repeat-y') {
      if (built.svg && width > 0 && height > 0) {
        var minSpanScaleX = cfg.repeat === 'repeat-y' ? Math.ceil(viewportWidth / width) : 1;
        var minSpanScaleY = cfg.repeat === 'repeat-x' ? Math.ceil(viewportHeight / height) : 1;
        var axisScaleX = cfg.repeat === 'repeat-y' ? Math.max(cfg.noRepeatScale, minSpanScaleX) : 1;
        var axisScaleY = cfg.repeat === 'repeat-x' ? Math.max(cfg.noRepeatScale, minSpanScaleY) : 1;
        var expandedAxis = _buildExpandedNoRepeatSvg(cfg, built.svg, width, height, axisScaleX, axisScaleY);
        if (expandedAxis && expandedAxis.svg) {
          image = _svgToCssUrl(expandedAxis.svg);
          resolvedSizeX = _fmt(expandedAxis.width) + 'px';
          resolvedSizeY = _fmt(expandedAxis.height) + 'px';
          position = 'top left';
        }
      }
      resolvedRepeat = cfg.repeat;
    } else if (cfg.repeat === 'round') {
      if (preserveRepeatModes && built.svg && width > 0 && height > 0) {
        var roundCfg = _withSeed(cfg, cfg.seed);
        roundCfg.sizeX = viewportWidth;
        roundCfg.sizeY = viewportHeight;
        roundCfg.motifBaseSize = Math.max(1, Math.min(width, height));
        var roundBuilt = cfg.type === 'dots-grid'
          ? _buildDotsGrid(roundCfg)
          : _buildDotsRandom(roundCfg);
        if (roundBuilt && roundBuilt.svg) {
          image = _svgToCssUrl(roundBuilt.svg);
          resolvedSizeX = _fmt(roundBuilt.width || viewportWidth) + 'px';
          resolvedSizeY = _fmt(roundBuilt.height || viewportHeight) + 'px';
          position = 'top left';
          resolvedRepeat = 'repeat';
        } else {
          resolvedRepeat = 'round';
        }
      } else {
        resolvedRepeat = 'round';
      }
    }
    _ROOT.style.setProperty('--theme-pattern-image', image);
    _ROOT.style.setProperty('--theme-pattern-body-image', cfg.applyBody ? image : 'none');
    _ROOT.style.setProperty('--theme-pattern-size-x', resolvedSizeX);
    _ROOT.style.setProperty('--theme-pattern-size-y', resolvedSizeY);
    _ROOT.style.setProperty('--theme-pattern-repeat-resolved', resolvedRepeat);
    _ROOT.style.setProperty('--theme-pattern-position-resolved', position);
    _ROOT.style.setProperty('--theme-pattern-blend-mode-resolved', cfg.blendMode);
    _ROOT.style.setProperty('--theme-pattern-active', '1');
    _ROOT.setAttribute('data-theme-pattern', cfg.type);
    _ROOT.setAttribute('data-theme-pattern-active', '1');
  }

  function _queueApply() {
    if (_applyQueued) return;
    _applyQueued = true;
    _raf(function () {
      _applyQueued = false;
      apply();
    });
  }

  function _nodeAffectsTheme(node) {
    if (!node || node.nodeType !== 1) return false;
    var tag = String(node.tagName || '').toUpperCase();
    if (tag === 'STYLE') return true;
    if (tag === 'LINK') {
      var rel = String(node.getAttribute('rel') || '').toLowerCase();
      if (rel === 'stylesheet') return true;
    }
    return false;
  }

  function _watchThemeSources() {
    if (typeof MutationObserver !== 'function') return;
    var head = document.head || document.documentElement;
    if (!head) return;
    var headObserver = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var mutation = mutations[i];
        if (mutation.type === 'attributes') {
          if (_nodeAffectsTheme(mutation.target)) {
            _queueApply();
            return;
          }
          continue;
        }
        var added = mutation.addedNodes || [];
        for (var a = 0; a < added.length; a++) {
          if (_nodeAffectsTheme(added[a])) {
            _queueApply();
            return;
          }
        }
        var removed = mutation.removedNodes || [];
        for (var r = 0; r < removed.length; r++) {
          if (_nodeAffectsTheme(removed[r])) {
            _queueApply();
            return;
          }
        }
      }
    });
    headObserver.observe(head, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href', 'media', 'disabled'],
    });

    var rootObserver = new MutationObserver(function () { _queueApply(); });
    rootObserver.observe(_ROOT, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
  }

  window.addEventListener('themechange', _queueApply);
  window.addEventListener('load', _queueApply);
  window.addEventListener('resize', _queueApply);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _queueApply);
  } else {
    _queueApply();
  }

  _watchThemeSources();

  window.ThemePatterns = Object.freeze({
    PATTERN_TYPES: _PATTERN_TYPES.slice(),
    normalizeType: _normalizeType,
    apply: apply,
    queueApply: _queueApply,
  });
})();
