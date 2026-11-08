/*!
 * charts.js — dependency-free SVG charts.
 * Every chart is theme-aware via CSS custom properties and renders as
 * a single responsive <svg viewBox> string with <title> tooltips.
 */
(function (global) {
  'use strict';

  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function abbreviated(value) {
    if (value >= 1000000) return (value / 1000000).toFixed(value >= 10000000 ? 0 : 1) + 'M';
    if (value >= 1000) return (value / 1000).toFixed(value >= 100000 ? 0 : 1) + 'K';
    return String(Math.round(value));
  }

  /** Rounds an axis maximum up to a friendly 1/2/2.5/5 × 10^n value. */
  function niceMax(value) {
    if (!value || value <= 0) return 1;
    var exponent = Math.floor(Math.log(value) / Math.LN10);
    var base = Math.pow(10, exponent);
    var fraction = value / base;
    var steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
    for (var i = 0; i < steps.length; i++) {
      if (fraction <= steps[i]) return steps[i] * base;
    }
    return 10 * base;
  }

  function truncate(text, max) {
    var value = String(text || '');
    if (value.length <= max) return value;
    return value.slice(0, Math.max(1, max - 1)) + '…';
  }

  var TONES = {
    passed: 'var(--ok)',
    partial: 'var(--warn)',
    context_limit: 'var(--ctx)',
    failed: 'var(--bad)',
    accent: 'var(--accent)'
  };

  function toneFor(status) {
    return TONES[status] || TONES.accent;
  }

  /* ------------------------------------------------------------------ *
   * Horizontal pass-rate bars
   * items: [{label, percent, status, caption, title}]
   * ------------------------------------------------------------------ */

  function passRateChart(items, options) {
    options = options || {};
    var width = 480;
    var rowH = 34;
    var labelW = Math.min(84, Math.max(52, options.labelWidth || 64));
    var valueW = 52;
    var height = Math.max(rowH, items.length * rowH) + 4;
    var trackW = width - labelW - valueW - 10;
    var parts = [];

    parts.push('<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="' +
      esc(options.label || 'pass rate') + '">');

    items.forEach(function (item, index) {
      var y = index * rowH + 2;
      var percent = Math.max(0, Math.min(100, item.percent || 0));
      var barW = Math.max(2, (trackW * percent) / 100);
      var color = toneFor(item.status);
      var gradientId = 'pr-grad-' + index + '-' + Math.round(percent * 10);

      parts.push('<defs><linearGradient id="' + gradientId + '" x1="0" x2="1">' +
        '<stop offset="0%" stop-color="' + color + '" stop-opacity="0.55"/>' +
        '<stop offset="100%" stop-color="' + color + '"/></linearGradient></defs>');

      parts.push('<text x="0" y="' + (y + rowH / 2 + 1) + '" dominant-baseline="middle" style="font-family:var(--font-mono)">' +
        esc(truncate(item.label, 9)) + '</text>');

      parts.push('<rect x="' + labelW + '" y="' + (y + 8) + '" width="' + trackW + '" height="13" rx="6.5" ' +
        'fill="var(--surface-3)" stroke="var(--line)"/>');

      parts.push('<rect x="' + labelW + '" y="' + (y + 8) + '" width="' + barW.toFixed(2) + '" height="13" rx="6.5" ' +
        'fill="url(#' + gradientId + ')">' +
        (item.title ? '<title>' + esc(item.title) + '</title>' : '') +
        '</rect>');

      parts.push('<text x="' + (width - 2) + '" y="' + (y + rowH / 2 + 1) + '" text-anchor="end" ' +
        'dominant-baseline="middle" class="value-label">' + esc(item.caption || percent.toFixed(1) + '%') + '</text>');
    });

    parts.push('</svg>');
    return parts.join('');
  }

  /* ------------------------------------------------------------------ *
   * Vertical stacked token bars
   * items: [{label, parts: [{value, tone, name}], total, title}]
   * ------------------------------------------------------------------ */

  function stackedBars(items, options) {
    options = options || {};
    var width = 480;
    var height = options.height || 208;
    var padLeft = options.padLeft === undefined ? 44 : options.padLeft;
    var padRight = 8;
    var padTop = 22;
    var padBottom = 26;
    var plotW = width - padLeft - padRight;
    var plotH = height - padTop - padBottom;

    var max = 0;
    items.forEach(function (item) {
      item.parts.forEach(function (part) {
        if (part.value > max) max = part.value;
      });
    });
    var top = niceMax(max || 1);
    var parts = [];

    parts.push('<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="' +
      esc(options.label || 'chart') + '">');

    // grid + y labels
    for (var step = 0; step <= 2; step++) {
      var y = padTop + (plotH * step) / 2;
      var value = top - (top * step) / 2;
      parts.push('<line class="' + (step === 2 ? 'axis-line' : 'grid-line') + '" x1="' + padLeft + '" x2="' +
        (width - padRight) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '"/>');
      parts.push('<text x="' + (padLeft - 8) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end">' +
        esc(options.yFormat ? options.yFormat(value) : abbreviated(value)) + '</text>');
    }

    var count = Math.max(1, items.length);
    var slot = plotW / count;
    var barW = Math.min(46, slot * 0.56);
    var gap = 2;

    items.forEach(function (item, index) {
      var centerX = padLeft + slot * index + slot / 2;
      var x = centerX - barW / 2;
      var accumulated = 0;
      var innerParts = [];

      item.parts.forEach(function (part) {
        if (!part.value) return;
        var h = (part.value / top) * plotH;
        var y = padTop + plotH - accumulated - h;
        innerParts.push('<rect x="' + x.toFixed(2) + '" y="' + y.toFixed(2) + '" width="' + barW.toFixed(2) +
          '" height="' + Math.max(1, h - gap).toFixed(2) + '" rx="3" fill="' + part.tone + '"' +
          (part.opacity ? ' fill-opacity="' + part.opacity + '"' : '') + '/>');
        accumulated += h;
      });

      var group = '<g>' + (item.title ? '<title>' + esc(item.title) + '</title>' : '') + innerParts.join('') + '</g>';
      parts.push(group);

      var topY = padTop + plotH - accumulated;
      if (item.total !== undefined && item.total !== null) {
        parts.push('<text class="value-label" x="' + centerX.toFixed(1) + '" y="' + (topY - 7).toFixed(1) +
          '" text-anchor="middle">' + esc(item.totalLabel || abbreviated(item.total)) + '</text>');
      }

      parts.push('<text x="' + centerX.toFixed(1) + '" y="' + (height - 8) + '" text-anchor="middle">' +
        esc(truncate(item.label, Math.max(4, Math.floor(slot / 6.2)))) + '</text>');
    });

    parts.push('</svg>');
    return parts.join('');
  }

  /* ------------------------------------------------------------------ *
   * Public helpers
   * ------------------------------------------------------------------ */

  function tokensChart(items, options) {
    return stackedBars(items.map(function (item) {
      return {
        label: item.label,
        total: item.total,
        totalLabel: item.totalLabel,
        title: item.title,
        parts: [
          { value: item.input || 0, tone: 'var(--accent)', opacity: 0.9 },
          { value: item.output || 0, tone: 'var(--accent-2)', opacity: 0.95 }
        ]
      };
    }), Object.assign({ label: 'tokens' }, options || {}));
  }

  function latencyChart(items, options) {
    return stackedBars(items.map(function (item) {
      return {
        label: item.label,
        total: item.value,
        totalLabel: item.valueLabel || (item.value.toFixed(2) + 's'),
        title: item.title,
        parts: [{ value: item.value, tone: 'var(--accent)', opacity: 0.75 }]
      };
    }), Object.assign({
      label: 'latency',
      yFormat: function (value) { return value.toFixed(1) + 's'; }
    }, options || {}));
  }

  var API = {
    passRateChart: passRateChart,
    tokensChart: tokensChart,
    latencyChart: latencyChart,
    abbreviated: abbreviated,
    niceMax: niceMax,
    esc: esc
  };

  global.CLCharts = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
