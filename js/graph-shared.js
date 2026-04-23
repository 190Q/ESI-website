(function () {
  'use strict';

  function ensureTooltip(canvas) {
    const wrap = canvas && canvas.parentElement;
    if (!wrap) return null;
    let tooltip = wrap.querySelector('.graph-hover-tooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.className = 'graph-hover-tooltip';
      wrap.appendChild(tooltip);
    }
    return tooltip;
  }

  function ensureHoverGuides(canvas, styleOptions) {
    const wrap = canvas && canvas.parentElement;
    if (!wrap) return null;
    const styles = styleOptions || {};
    const hoverLineColor = styles.hoverLineColor || 'rgba(212,160,23,0.25)';
    const selectedLineColor = styles.selectedLineColor || 'rgba(212,160,23,0.6)';
    const hoverBadgeColor = styles.hoverBadgeColor || '#4A5A3A';
    const selectedBadgeColor = styles.selectedBadgeColor || 'rgba(212,160,23,0.95)';

    let line = wrap.querySelector('.graph-hover-vline');
    if (!line) {
      line = document.createElement('div');
      line.className = 'graph-hover-vline';
      wrap.appendChild(line);
    }
    line.style.cssText = 'position:absolute;width:2px;background:' + hoverLineColor + ';pointer-events:none;display:none;z-index:3;';

    let xBadge = wrap.querySelector('.graph-hover-xbadge');
    if (!xBadge) {
      xBadge = document.createElement('div');
      xBadge.className = 'graph-hover-xbadge';
      wrap.appendChild(xBadge);
    }
    xBadge.style.cssText = 'position:absolute;transform:translateX(-50%);color:' + hoverBadgeColor + ';font-size:9px;font-family:sans-serif;line-height:1;white-space:nowrap;pointer-events:none;display:none;z-index:4;';

    let pinLine = wrap.querySelector('.graph-selected-vline');
    if (!pinLine) {
      pinLine = document.createElement('div');
      pinLine.className = 'graph-selected-vline';
      wrap.appendChild(pinLine);
    }
    pinLine.style.cssText = 'position:absolute;width:2px;background:' + selectedLineColor + ';pointer-events:none;display:none;z-index:2;';

    let pinBadge = wrap.querySelector('.graph-selected-xbadge');
    if (!pinBadge) {
      pinBadge = document.createElement('div');
      pinBadge.className = 'graph-selected-xbadge';
      wrap.appendChild(pinBadge);
    }
    pinBadge.style.cssText = 'position:absolute;transform:translateX(-50%);color:' + selectedBadgeColor + ';font-size:9px;font-family:sans-serif;line-height:1;white-space:nowrap;pointer-events:none;display:none;z-index:4;';

    return { wrap: wrap, line: line, xBadge: xBadge, pinLine: pinLine, pinBadge: pinBadge };
  }

  function hideHoverGuides(guides) {
    if (!guides) return;
    if (guides.line) guides.line.style.display = 'none';
    if (guides.xBadge) guides.xBadge.style.display = 'none';
  }

  function updateHoverGuides(guides, model, hoverPoint) {
    if (!guides || !model || !hoverPoint) { hideHoverGuides(guides); return; }
    const maxLen = Math.max(1, model.maxLen || 1);
    const dayIndex = Math.max(0, Math.min(maxLen - 1, hoverPoint.index || 0));
    const x = Number.isFinite(hoverPoint.x)
      ? hoverPoint.x
      : model.pad.left + (maxLen === 1 ? model.plotW / 2 : (dayIndex / (maxLen - 1)) * model.plotW);
    const canvasOffsetX = Number.isFinite(model.canvasOffsetX) ? model.canvasOffsetX : 0;
    const canvasOffsetY = Number.isFinite(model.canvasOffsetY) ? model.canvasOffsetY : 0;
    const xInWrap = canvasOffsetX + x;
    const dayOffset = Math.max(0, (maxLen - 1) - dayIndex);
    const dayText = dayOffset === 0 ? 'now' : '-' + dayOffset + 'd';

    var lineH = (Number.isFinite(model.pad.top) ? model.pad.top : 0) + (Number.isFinite(model.plotH) ? model.plotH : 0) + 4;
    guides.line.style.display = 'block';
    guides.line.style.left = xInWrap + 'px';
    guides.line.style.top = '0';
    guides.line.style.height = lineH + 'px';

    const xLabelY = Number.isFinite(model.xLabelY) ? model.xLabelY : (model.pad.top + model.plotH + 16);
    const duplicateAxisLabel = !!(model.axisDayTexts && model.axisDayTexts.has(dayText));
    const nearbyAxisLabel = Array.isArray(model.axisDayXs) && model.axisDayXs.some(function (axisX) {
      return Number.isFinite(axisX) && Math.abs(axisX - x) <= 16;
    });
    const overlapsAxisLabel = Array.isArray(model.axisLabelBoxes) && model.axisLabelBoxes.some(function (box) {
      return box && Number.isFinite(box.left) && Number.isFinite(box.right) && x >= (box.left - 1) && x <= (box.right + 1);
    });
    if (duplicateAxisLabel || nearbyAxisLabel || overlapsAxisLabel) {
      guides.xBadge.style.display = 'none';
    } else {
      guides.xBadge.style.display = 'block';
      guides.xBadge.textContent = dayText;
      guides.xBadge.style.top = (canvasOffsetY + xLabelY - 8) + 'px';
      guides.xBadge.style.left = xInWrap + 'px';
    }
  }

  function resolveSelectedIndex(dayOffset, maxLen) {
    if (!Number.isFinite(dayOffset) || dayOffset < 0 || !Number.isFinite(maxLen) || maxLen <= 0) return null;
    const offset = Math.round(dayOffset);
    if (offset > maxLen - 1) return null;
    return (maxLen - 1) - offset;
  }

  function updatePinnedGuide(guides, model, selectedDayOffset) {
    if (!guides || !model) return null;
    const maxLen = Math.max(1, model.maxLen || 1);
    const selectedIndex = resolveSelectedIndex(selectedDayOffset, maxLen);
    if (selectedIndex == null) {
      guides.pinLine.style.display = 'none';
      guides.pinBadge.style.display = 'none';
      return null;
    }
    const x = model.pad.left + (maxLen === 1 ? model.plotW / 2 : (selectedIndex / (maxLen - 1)) * model.plotW);
    const canvasOffsetX = Number.isFinite(model.canvasOffsetX) ? model.canvasOffsetX : 0;
    const canvasOffsetY = Number.isFinite(model.canvasOffsetY) ? model.canvasOffsetY : 0;
    var lineH = (Number.isFinite(model.pad.top) ? model.pad.top : 0) + (Number.isFinite(model.plotH) ? model.plotH : 0) + 4;
    guides.pinLine.style.display = 'block';
    guides.pinLine.style.left = (canvasOffsetX + x) + 'px';
    guides.pinLine.style.top = '0';
    guides.pinLine.style.height = lineH + 'px';

    const dayOffset = Math.max(0, (maxLen - 1) - selectedIndex);
    const dayText = dayOffset === 0 ? 'now' : '-' + dayOffset + 'd';
    const xLabelY = Number.isFinite(model.xLabelY) ? model.xLabelY : (model.pad.top + model.plotH + 16);
    const duplicateAxisLabel = !!(model.axisDayTexts && model.axisDayTexts.has(dayText));
    const nearbyAxisLabel = Array.isArray(model.axisDayXs) && model.axisDayXs.some(function (axisX) {
      return Number.isFinite(axisX) && Math.abs(axisX - x) <= 16;
    });
    const overlapsAxisLabel = Array.isArray(model.axisLabelBoxes) && model.axisLabelBoxes.some(function (box) {
      return box && Number.isFinite(box.left) && Number.isFinite(box.right) && x >= (box.left - 1) && x <= (box.right + 1);
    });
    if (duplicateAxisLabel || nearbyAxisLabel || overlapsAxisLabel) {
      guides.pinBadge.style.display = 'none';
    } else {
      guides.pinBadge.style.display = 'block';
      guides.pinBadge.textContent = dayText;
      guides.pinBadge.style.left = (canvasOffsetX + x) + 'px';
      guides.pinBadge.style.top = (canvasOffsetY + xLabelY - 8) + 'px';
    }
    return selectedIndex;
  }

  function positionTooltip(tooltip, wrap, x, y) {
    if (!tooltip || !wrap) return;
    const margin = 8;
    const offset = 14;
    let left = x + offset;
    let top = y + offset;
    const maxLeft = wrap.clientWidth - tooltip.offsetWidth - margin;
    const maxTop = wrap.clientHeight - tooltip.offsetHeight - margin;
    if (left > maxLeft) left = x - tooltip.offsetWidth - offset;
    if (top > maxTop) top = y - tooltip.offsetHeight - offset;
    if (left < margin) left = margin;
    if (top < margin) top = margin;
    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
  }

  function defaultFormatYAxisLabel(value) {
    return String(Math.round(value * 10) / 10).replace('.', ',');
  }

  function drawGraphCanvas(canvas, seriesList, options) {
    const opts = options || {};
    if (!canvas) return null;
    const wrap = canvas.parentElement;
    if (!wrap) return null;

    ['.graph-hover-tooltip', '.graph-hover-vline', '.graph-hover-xbadge', '.graph-selected-vline', '.graph-selected-xbadge'].forEach(function (selector) {
      const node = wrap.querySelector(selector);
      if (node) node.style.display = 'none';
    });

    const dpr = window.devicePixelRatio || 1;
    /* Reset canvas so the flex container can shrink to its natural width */
    canvas.style.width = '0';
    const W = wrap.clientWidth;
    const H = Number.isFinite(opts.height) ? opts.height : 220;
    if (W === 0) return null;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = opts.backgroundColor || '#111e11';
    ctx.fillRect(0, 0, W, H);
    if (!Array.isArray(seriesList) || !seriesList.length) return null;

    const pad = Object.assign({ top: 18, right: 14, bottom: 28, left: 44 }, opts.pad || {});
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top - pad.bottom;
    const maxLen = Math.max.apply(null, seriesList.map(function (series) {
      return (series && Array.isArray(series.data) ? series.data.length : 0);
    }));
    if (!Number.isFinite(maxLen) || maxLen <= 0) return null;

    function xPos(i) {
      return pad.left + (maxLen === 1 ? plotW / 2 : (i / (maxLen - 1)) * plotW);
    }

    let globalMax = 0;
    let globalMin = 0;
    seriesList.forEach(function (series) {
      if (!series || !Array.isArray(series.data) || !series.data.length) return;
      const finiteValues = series.data.filter(function (v) { return Number.isFinite(v); });
      if (!finiteValues.length) return;
      globalMax = Math.max(globalMax, Math.max.apply(null, finiteValues));
      globalMin = Math.min(globalMin, Math.min.apply(null, finiteValues));
    });
    globalMax = globalMax * 1.1 || 1;
    const globalRange = (globalMax - globalMin) || 1;

    function yPos(v) {
      return pad.top + plotH - ((v - globalMin) / globalRange) * plotH;
    }

    const formatYAxisLabel = typeof opts.formatYAxisLabel === 'function' ? opts.formatYAxisLabel : defaultFormatYAxisLabel;
    ctx.strokeStyle = 'rgba(212,160,23,0.1)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (plotH / 4) * i;
      const val = globalMax - (globalRange / 4) * i;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + plotW, y);
      ctx.stroke();
      ctx.fillStyle = '#4A5A3A';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(formatYAxisLabel(val), pad.left - 6, y + 3);
    }

    const multi = seriesList.length > 1;
    const singlePointSpread = Number.isFinite(opts.singlePointSpread) ? opts.singlePointSpread : 24;
    const hoverSeries = [];
    seriesList.forEach(function (series, seriesIndex) {
      const data = series && Array.isArray(series.data) ? series.data : [];
      if (!data.length) return;
      const color = series.color || {};
      const lineColor = color.line || '#D4A017';
      const fillColor = color.fill || 'rgba(212,160,23,0.08)';
      const pointColor = color.point || lineColor;
      const isDashed = !!series.dashed;

      function xPosSeries(i) {
        if (maxLen === 1 && multi) {
          return xPos(i) - ((seriesList.length - 1) * singlePointSpread) / 2 + seriesIndex * singlePointSpread;
        }
        return xPos(i);
      }

      const points = data.map(function (v, i) {
        if (!Number.isFinite(v)) return null;
        return { index: i, x: xPosSeries(i), y: yPos(v), value: v };
      });

      if (series.fillBetweenBase && Array.isArray(series.baseData)) {
        const base = series.baseData;
        let idx = 0;
        while (idx < data.length) {
          while (idx < data.length && !Number.isFinite(data[idx])) idx++;
          if (idx >= data.length) break;

          const segStart = idx;
          while (idx + 1 < data.length && Number.isFinite(data[idx + 1])) idx++;
          const segEnd = idx;

          const startBridge = !!(
            series.drawTransitionToBase &&
            segStart > 0 &&
            !Number.isFinite(data[segStart - 1]) &&
            Number.isFinite(base[segStart - 1])
          );
          const endBridge = !!(
            series.drawTransitionToBase &&
            segEnd < data.length - 1 &&
            !Number.isFinite(data[segEnd + 1]) &&
            Number.isFinite(base[segEnd + 1])
          );

          const baseStartIdx = startBridge ? (segStart - 1) : segStart;
          const baseEndIdx = endBridge ? (segEnd + 1) : segEnd;
          if (!Number.isFinite(base[baseStartIdx]) || !Number.isFinite(base[baseEndIdx])) {
            idx++;
            continue;
          }

          ctx.beginPath();

          // Top edge (queue line + optional start/end bridge)
          if (startBridge) {
            ctx.moveTo(xPosSeries(segStart - 1), yPos(base[segStart - 1]));
            ctx.lineTo(xPosSeries(segStart), yPos(data[segStart]));
          } else {
            ctx.moveTo(xPosSeries(segStart), yPos(data[segStart]));
          }
          for (let k = segStart + 1; k <= segEnd; k++) {
            if (!Number.isFinite(data[k])) continue;
            ctx.lineTo(xPosSeries(k), yPos(data[k]));
          }
          if (endBridge) {
            ctx.lineTo(xPosSeries(segEnd + 1), yPos(base[segEnd + 1]));
          }

          // Bottom edge (baseline back to start)
          for (let k = baseEndIdx; k >= baseStartIdx; k--) {
            if (!Number.isFinite(base[k])) continue;
            ctx.lineTo(xPosSeries(k), yPos(base[k]));
          }

          ctx.closePath();
          ctx.fillStyle = isDashed ? fillColor.replace(/[\d.]+\)$/, '0.03)') : fillColor;
          ctx.fill();

          idx++;
        }
      }
      const canFill = !series.disableFill && data.every(function (v) { return Number.isFinite(v); });
      if (canFill) {
        ctx.beginPath();
        data.forEach(function (v, i) {
          if (i === 0) ctx.moveTo(xPosSeries(i), yPos(v));
          else ctx.lineTo(xPosSeries(i), yPos(v));
        });
        ctx.lineTo(xPosSeries(data.length - 1), pad.top + plotH);
        ctx.lineTo(xPosSeries(0), pad.top + plotH);
        ctx.closePath();
        ctx.fillStyle = isDashed ? fillColor.replace(/[\d.]+\)$/, '0.03)') : fillColor;
        ctx.fill();
      }

      ctx.beginPath();
      let hasLine = false;
      let segmentOpen = false;
      data.forEach(function (v, i) {
        if (!Number.isFinite(v)) {
          segmentOpen = false;
          return;
        }
        if (!segmentOpen) {
          ctx.moveTo(xPosSeries(i), yPos(v));
          segmentOpen = true;
          hasLine = true;
          return;
        }
        ctx.lineTo(xPosSeries(i), yPos(v));
      });
      if (hasLine) {
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = isDashed ? 1.5 : 2;
        ctx.setLineDash(isDashed ? [6, 4] : []);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (series.drawTransitionToBase && Array.isArray(series.baseData)) {
        ctx.beginPath();
        let hasTransitions = false;
        data.forEach(function (v, i) {
          if (!Number.isFinite(v)) return;
          const prevFinite = i > 0 && Number.isFinite(data[i - 1]);
          const nextFinite = i < data.length - 1 && Number.isFinite(data[i + 1]);

          // Queue starts here (previous day had no queue): connect prev baseline -> current queue
          if (!prevFinite && i > 0) {
            const fromIdx = i - 1;
            const baseStart = series.baseData[fromIdx];
            if (Number.isFinite(baseStart)) {
              const xFrom = xPosSeries(fromIdx);
              const yFrom = yPos(baseStart);
              const xTo = xPosSeries(i);
              const yTo = yPos(v);
              if (Math.abs(yTo - yFrom) >= 0.5 || Math.abs(xTo - xFrom) >= 0.5) {
                ctx.moveTo(xFrom, yFrom);
                ctx.lineTo(xTo, yTo);
                hasTransitions = true;
              }
            }
          }

          // Queue ends here (next day has no queue): connect current queue -> next baseline
          if (!nextFinite && i < data.length - 1) {
            const toIdx = i + 1;
            const baseEnd = series.baseData[toIdx];
            if (Number.isFinite(baseEnd)) {
              const xFrom = xPosSeries(i);
              const yFrom = yPos(v);
              const xTo = xPosSeries(toIdx);
              const yTo = yPos(baseEnd);
              if (Math.abs(yTo - yFrom) >= 0.5 || Math.abs(xTo - xFrom) >= 0.5) {
                ctx.moveTo(xFrom, yFrom);
                ctx.lineTo(xTo, yTo);
                hasTransitions = true;
              }
            }
          }
        });
        if (hasTransitions) {
          ctx.strokeStyle = lineColor;
          ctx.lineWidth = isDashed ? 1.25 : 1.5;
          ctx.setLineDash([]);
          ctx.stroke();
        }
      }

      if (data.length <= 60) {
        const r = maxLen === 1 ? 4.5 : (data.length > 30 ? 1.5 : 2.5);
        const pointR = isDashed ? r * 0.7 : r;
        data.forEach(function (v, i) {
          if (!Number.isFinite(v)) return;
          ctx.beginPath();
          ctx.arc(xPosSeries(i), yPos(v), pointR, 0, Math.PI * 2);
          ctx.fillStyle = isDashed ? lineColor : pointColor;
          ctx.fill();
        });
      }

      hoverSeries.push({
        key: series.key,
        player: series.player,
        dashed: isDashed,
        color: lineColor,
        points: points,
      });
    });

    ctx.fillStyle = '#4A5A3A';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    const xLabelY = pad.top + plotH + 16;
    const axisDayTexts = new Set();
    const axisDayXs = [];
    const axisLabelBoxes = [];
    const selectedIndex = resolveSelectedIndex(opts.selectedDayOffset, maxLen);
    const selectedDayOffset = selectedIndex == null ? null : Math.max(0, (maxLen - 1) - selectedIndex);
    const selectedDayText = selectedDayOffset == null ? null : (selectedDayOffset === 0 ? 'now' : '-' + selectedDayOffset + 'd');
    const selectedX = selectedIndex == null ? null : xPos(selectedIndex);
    const axisLabelColor = opts.axisLabelColor || '#4A5A3A';
    const selectedAxisLabelColor = opts.selectedAxisLabelColor || ((opts.guideStyles && opts.guideStyles.selectedBadgeColor) || 'rgba(212,160,23,0.95)');
    function fillAxisLabel(text, x, align) {
      if (align) ctx.textAlign = align;
      const isSelectedLabel = !!(selectedDayText && text === selectedDayText && (selectedX == null || Math.abs(selectedX - x) <= 16));
      ctx.fillStyle = isSelectedLabel ? selectedAxisLabelColor : axisLabelColor;
      ctx.fillText(text, x, xLabelY);
    }
    if (maxLen === 1) {
      const nowX = xPos(0);
      const nowText = 'now';
      fillAxisLabel(nowText, nowX, 'right');
      axisDayTexts.add(nowText);
      axisDayXs.push(nowX);
      const nowWidth = ctx.measureText(nowText).width;
      axisLabelBoxes.push({ left: nowX - nowWidth - 4, right: nowX + 2 });
      ctx.textAlign = 'center';
    } else {
      const safeSpanDays = Math.max(1, maxLen - 1);
      const dayStep = Math.max(1, Math.ceil(safeSpanDays / 6));
      const minGap = Number.isFinite(opts.xLabelMinGap) ? opts.xLabelMinGap : 0;
      const nowX = pad.left + plotW;
      const nowText = 'now';
      fillAxisLabel(nowText, nowX, 'right');
      axisDayTexts.add(nowText);
      axisDayXs.push(nowX);
      const nowWidth = ctx.measureText(nowText).width;
      axisLabelBoxes.push({ left: nowX - nowWidth - 4, right: nowX + 2 });
      ctx.textAlign = 'center';
      for (let d = dayStep; d <= safeSpanDays; d += dayStep) {
        const x = pad.left + (1 - d / safeSpanDays) * plotW;
        if (x - pad.left < minGap) continue;
        const text = '-' + d + 'd';
        fillAxisLabel(text, x, 'center');
        axisDayTexts.add(text);
        axisDayXs.push(x);
        const textWidth = ctx.measureText(text).width;
        axisLabelBoxes.push({ left: x - textWidth / 2 - 4, right: x + textWidth / 2 + 4 });
      }
      const leftText = '-' + safeSpanDays + 'd';
      if (!axisDayTexts.has(leftText)) {
        fillAxisLabel(leftText, pad.left, 'center');
        axisDayTexts.add(leftText);
        axisDayXs.push(pad.left);
        const leftTextWidth = ctx.measureText(leftText).width;
        axisLabelBoxes.push({ left: pad.left - leftTextWidth / 2 - 4, right: pad.left + leftTextWidth / 2 + 4 });
      }
    }

    const model = {
      pad: pad,
      plotW: plotW,
      plotH: plotH,
      maxLen: maxLen,
      xLabelY: xLabelY,
      axisDayTexts: axisDayTexts,
      axisDayXs: axisDayXs,
      axisLabelBoxes: axisLabelBoxes,
      canvasOffsetX: canvas.offsetLeft,
      canvasOffsetY: canvas.offsetTop,
      canvasH: H,
      wrapHeight: wrap.clientHeight,
      hasCompare: seriesList.some(function (series) { return !!(series && series.dashed); }),
      series: hoverSeries,
    };

    const guides = ensureHoverGuides(canvas, opts.guideStyles);
    updatePinnedGuide(guides, model, opts.selectedDayOffset);

    // If this panel has a persistent share-ready shadow clone, keep it in sync with the freshly-drawn canvas
    var panel = canvas.closest ? canvas.closest('.graph-panel') : null;
    if (panel && panel._shareClone) {
      syncSharePanel(panel);
    }

    return model;
  }

  function computeSummaryStats(data, selectedEndIndex, options) {
    if (!Array.isArray(data) || !data.length) return null;
    const opts = options || {};
    const endIndex = Number.isInteger(selectedEndIndex)
      ? Math.max(0, Math.min(data.length - 1, selectedEndIndex))
      : (data.length - 1);
    let values = data.slice(0, endIndex + 1);
    if (!values.length) return null;

    if (opts.stripLeadingZeroes) {
      const firstNonZero = values.findIndex(function (v) { return v !== 0; });
      if (firstNonZero !== -1) values = values.slice(firstNonZero);
    }
    if (!values.length) return null;

    const latest = values[values.length - 1];
    const sum = values.reduce(function (acc, n) { return acc + n; }, 0);
    const avg = sum / values.length;
    const sorted = values.slice().sort(function (a, b) { return a - b; });
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    return {
      latest: latest,
      sum: sum,
      avg: avg,
      median: median,
      latestLabel: Number.isInteger(selectedEndIndex) ? 'Selected' : 'Today',
      values: values,
    };
  }

  // Elements removed from the share clone because they are interactive
  var SHARE_STRIP_SELECTORS = [
    '.graph-controls',
    '.graph-legend',
    '.btn-add-metric',
    '.graph-share-zone',
    '.graph-share-btn',
    '.compare-area',
    '.graph-loader',
    '.graph-hover-vline',
    '.graph-hover-xbadge',
    '.graph-hover-tooltip',
  ].join(', ');

  // Overlays that live inside .graph-canvas-wrap
  var SHARE_GUIDE_SELECTORS = [
    '.graph-selected-vline',
    '.graph-selected-xbadge',
  ];

  // Build the header text for the share clone
  function buildShareHeaderText(panel) {
    var isGuild = !!panel.querySelector('#guildGraphCanvas');

    var mainName = '';
    var compareName = '';
    if (isGuild) {
      var guildNameEl = document.getElementById('guildCardName');
      mainName = guildNameEl ? (guildNameEl.textContent || '').trim() : '';
      if (!mainName) mainName = 'Guild';
      var guildPill = document.getElementById('guildComparePill');
      var guildPillName = document.getElementById('guildComparePillName');
      if (guildPill && guildPill.style.display !== 'none' && guildPillName) {
        compareName = (guildPillName.textContent || '').trim();
      }
    } else {
      var playerNameEl = document.getElementById('playerName');
      mainName = playerNameEl ? (playerNameEl.textContent || '').trim() : '';
      var pill = document.getElementById('comparePill');
      var pillName = document.getElementById('comparePillName');
      if (pill && pill.style.display !== 'none' && pillName) {
        compareName = (pillName.textContent || '').trim();
      }
    }

    // Collect currently-selected metric label(s) from the live controls
    var metrics = [];
    panel.querySelectorAll('.graph-metric-row').forEach(function (row) {
      var sel = row.querySelector('.graph-select');
      if (sel && sel.options && sel.selectedIndex >= 0) {
        var opt = sel.options[sel.selectedIndex];
        if (opt && opt.textContent) { metrics.push(opt.textContent.trim()); return; }
      }
      var lbl = row.querySelector('.graph-metric-label');
      if (lbl && lbl.textContent) metrics.push(lbl.textContent.trim());
    });
    // Player-side rows are removed from the DOM when locked to a single metric
    if (!metrics.length && !isGuild) metrics.push('Playtime');

    var nameStr = compareName ? (mainName + ' vs ' + compareName) : mainName;
    var metricStr = metrics.join(', ');
    var parts = [];
    if (nameStr) parts.push(nameStr);
    if (metricStr) parts.push(metricStr);
    return parts.join(' \u00b7 ');
  }

  /**
   * Build (or return) a persistent offscreen clone of the given graph panel.
   * The clone mirrors the live panel's canvas pixels + summaries block so that
   * a share click can hand it straight to html2canvas without any per-click
   * cloning or stripping work.
   */
  function ensureSharePanel(panel) {
    if (!panel) return null;
    if (panel._shareClone) return panel._shareClone;

    var clone = panel.cloneNode(true);
    clone.style.cssText =
      'position:fixed;left:-9999px;top:0;width:' + panel.offsetWidth + 'px;' +
      'z-index:-1;overflow:hidden;pointer-events:none;';

    clone.querySelectorAll(SHARE_STRIP_SELECTORS).forEach(function (el) { el.remove(); });

    // Cache references to the dynamic bits BEFORE we strip IDs
    var cloneCanvas = clone.querySelector('canvas');
    var cloneSummaries = clone.querySelector('#graphSummaries, #guildGraphSummaries');

    // Remove IDs so the document never has duplicates
    clone.querySelectorAll('[id]').forEach(function (el) { el.removeAttribute('id'); });

    document.body.appendChild(clone);

    panel._shareClone = clone;
    panel._shareCloneCanvas = cloneCanvas;
    panel._shareCloneSummaries = cloneSummaries;
    panel._shareLastSummariesHTML = null;

    // MutationObserver picks up summaries (and any other DOM) changes
    if (!panel._shareObserver && typeof MutationObserver !== 'undefined') {
      var observer = new MutationObserver(function () {
        if (panel._shareSyncScheduled) return;
        panel._shareSyncScheduled = true;
        var run = function () {
          panel._shareSyncScheduled = false;
          syncSharePanel(panel);
        };
        if (typeof window.requestAnimationFrame === 'function') {
          window.requestAnimationFrame(run);
        } else {
          setTimeout(run, 16);
        }
      });
      observer.observe(panel, { childList: true, subtree: true, characterData: true });
      panel._shareObserver = observer;
    }

    syncSharePanel(panel);
    return clone;
  }

  /**
   * Mirror dynamic content from the live graph panel onto its shadow clone
   */
  function syncSharePanel(panel) {
    if (!panel || !panel._shareClone) return;
    var clone = panel._shareClone;

    // Keep the clone the same width as the live panel
    var panelWidth = panel.offsetWidth;
    if (panelWidth > 0) {
      var widthPx = panelWidth + 'px';
      if (clone.style.width !== widthPx) clone.style.width = widthPx;
    }

    // Sync summaries innerHTML (the only non-canvas dynamic block kept in the clone)
    var srcSummaries = panel.querySelector('#graphSummaries, #guildGraphSummaries');
    var cloneSummaries = panel._shareCloneSummaries;
    if (srcSummaries && cloneSummaries) {
      var html = srcSummaries.innerHTML;
      if (html !== panel._shareLastSummariesHTML) {
        cloneSummaries.innerHTML = html;
        panel._shareLastSummariesHTML = html;
      }
    }

    // Sync canvas pixels
    var srcCanvas = panel.querySelector('canvas');
    var cloneCanvas = panel._shareCloneCanvas;
    if (srcCanvas && cloneCanvas && srcCanvas.width > 0 && srcCanvas.height > 0) {
      if (cloneCanvas.width !== srcCanvas.width) cloneCanvas.width = srcCanvas.width;
      if (cloneCanvas.height !== srcCanvas.height) cloneCanvas.height = srcCanvas.height;
      if (cloneCanvas.style.width !== srcCanvas.style.width) cloneCanvas.style.width = srcCanvas.style.width;
      if (cloneCanvas.style.height !== srcCanvas.style.height) cloneCanvas.style.height = srcCanvas.style.height;
      var ctx = cloneCanvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, cloneCanvas.width, cloneCanvas.height);
        try { ctx.drawImage(srcCanvas, 0, 0); } catch (e) { /* ignore */ }
      }
    }

    // Sync pinned-selection guide overlays (selected vline + day badge)
    var srcWrap = srcCanvas && srcCanvas.parentElement;
    var cloneWrap = cloneCanvas && cloneCanvas.parentElement;
    if (srcWrap && cloneWrap) {
      SHARE_GUIDE_SELECTORS.forEach(function (sel) {
        var srcEl = srcWrap.querySelector(sel);
        if (!srcEl) return;
        var dstEl = cloneWrap.querySelector(sel);
        if (!dstEl) {
          dstEl = srcEl.cloneNode(false);
          cloneWrap.appendChild(dstEl);
        }
        if (dstEl.style.cssText !== srcEl.style.cssText) dstEl.style.cssText = srcEl.style.cssText;
        if (dstEl.innerHTML !== srcEl.innerHTML) dstEl.innerHTML = srcEl.innerHTML;
      });
    }

    // Rewrite the panel header
    var headerSpan = clone.querySelector('.graph-panel-header > span:first-child');
    if (headerSpan) {
      var title = buildShareHeaderText(panel);
      if (title && headerSpan.textContent !== title) headerSpan.textContent = title;
    }
  }

  /**
   * Attach a share button to every .graph-panel that contains a .graph-share-btn
   * The panel's shadow clone is built up-front and kept in sync live, so the
   * click handler only has to hand it to html2canvas and push the result to the
   * clipboard.
   */
  function initShareButtons() {
    var btns = document.querySelectorAll('.graph-share-btn');
    btns.forEach(function (btn) {
      if (btn._shareInitialized) return;
      btn._shareInitialized = true;

      var panel = btn.closest('.graph-panel');
      if (!panel) return;

      // Pre-build the offscreen clone so the click path never pays for a clone/strip
      ensureSharePanel(panel);

      var _busy = false;
      btn.addEventListener('click', function () {
        if (_busy) return;
        _busy = true;
        setTimeout(function () { _busy = false; }, 3000);

        // Idempotent: ensures the clone exists even if something reset it
        ensureSharePanel(panel);
        // Belt-and-suspenders final sync; cheap when nothing changed
        syncSharePanel(panel);

        var clone = panel._shareClone;
        var srcCanvas = panel.querySelector('canvas');

        if (clone && typeof html2canvas !== 'undefined') {
          html2canvas(clone, { backgroundColor: '#0D1A0D', scale: 2, useCORS: true, allowTaint: true })
            .then(function (c) { _copyOrDownload(c); })
            .catch(function () { _copyOrDownload(srcCanvas); });
        } else {
          _copyOrDownload(srcCanvas);
        }

        function _copyOrDownload(c) {
          if (!c) return;
          c.toBlob(function (blob) {
            if (!blob) return;
            if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
              navigator.clipboard.write([
                new ClipboardItem({ 'image/png': blob })
              ]).then(function () {
                if (window.showToast) window.showToast('\u2713 Graph copied to clipboard', 'success');
              }).catch(function () {
                _downloadBlob(blob);
              });
            } else {
              _downloadBlob(blob);
            }
          }, 'image/png');
        }

        function _downloadBlob(blob) {
          try {
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = 'graph-' + Date.now() + '.png';
            a.rel = 'noopener';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
            if (window.showToast) window.showToast('\u2713 Graph downloaded', 'success');
          } catch (e) {
            if (window.showToast) window.showToast('\u26a0 Failed to share graph', 'warn');
          }
        }
      });
    });
  }

  window.GraphShared = Object.freeze({
    ensureTooltip: ensureTooltip,
    ensureHoverGuides: ensureHoverGuides,
    hideHoverGuides: hideHoverGuides,
    updateHoverGuides: updateHoverGuides,
    resolveSelectedIndex: resolveSelectedIndex,
    updatePinnedGuide: updatePinnedGuide,
    positionTooltip: positionTooltip,
    drawGraphCanvas: drawGraphCanvas,
    computeSummaryStats: computeSummaryStats,
    initShareButtons: initShareButtons,
    ensureSharePanel: ensureSharePanel,
    syncSharePanel: syncSharePanel,
  });
})();
