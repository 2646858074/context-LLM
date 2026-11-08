/*!
 * app.js — UI wiring for the Context-LLM benchmark viewer.
 * Reads local files with the File API only; nothing leaves the browser.
 */
(function () {
  'use strict';

  var R = window.CLReport;
  var C = window.CLCharts;
  var I = window.CLI18n;
  var esc = C.esc;

  var STORAGE_DATA = 'cl-viewer-data-v1';
  var STORAGE_LIMIT = 3.5 * 1024 * 1024;
  var MODE_ORDER = ['needle', 'multi_hop', 'conflict', 'adversarial', 'abstention'];

  var state = {
    model: null,
    raw: { checkpoint: null, config: null, fileName: '', configFileName: '' },
    expanded: Object.create(null),
    rawTab: 'checkpoint',
    restored: false,
    cacheable: true
  };

  /* ------------------------------------------------------------------ *
   * DOM helpers
   * ------------------------------------------------------------------ */

  function $(selector, scope) {
    return (scope || document).querySelector(selector);
  }

  function $$(selector, scope) {
    return Array.prototype.slice.call((scope || document).querySelectorAll(selector));
  }

  function t(key, params) {
    return I.t(key, params);
  }

  function setHtml(node, html) {
    if (node) node.innerHTML = html;
  }

  var ICONS = {
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7"/></svg>',
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 8v5m0 3.5v.5"/><circle cx="12" cy="12" r="9"/></svg>',
  };

  /* ------------------------------------------------------------------ *
   * Formatting
   * ------------------------------------------------------------------ */

  function k(value) {
    return value === null || value === undefined ? R.DASH : R.format.K(value);
  }

  function kAverage(value) {
    return value === null || value === undefined ? R.DASH : R.format.KAverage(value);
  }

  function tierLabel(tier) {
    return C.abbreviated(tier || 0);
  }

  function pct(value) {
    return I.decimal(value, 1) + '%';
  }

  function seconds(value) {
    return I.decimal(value, 2) + 's';
  }

  function fixed(value, digits) {
    return value === null || value === undefined ? R.DASH : Number(value).toFixed(digits);
  }

  function dateText(isoString) {
    try {
      var date = isoString ? new Date(isoString) : new Date();
      return new Intl.DateTimeFormat(I.getLang() === 'zh-CN' ? 'zh-CN' : 'en-US', {
        dateStyle: 'medium',
        timeStyle: 'short'
      }).format(date);
    } catch (error) {
      return '';
    }
  }

  function modeName(mode) {
    var key = 'mode.name.' + mode;
    var translated = t(key);
    return translated === key ? mode : translated;
  }

  function statusText(status) {
    var key = 'status.' + status;
    var translated = t(key);
    return translated === key ? status : translated;
  }

  function scoreText(scoreState) {
    var key = 'score.' + scoreState;
    var translated = t(key);
    return translated === key ? scoreState : translated;
  }

  function statusClass(status) {
    if (status === 'passed') return 'pill--pass';
    if (status === 'partial') return 'pill--partial';
    if (status === 'context_limit') return 'pill--ctx';
    if (status === 'failed') return 'pill--fail';
    return 'pill--neutral';
  }

  function scorePillClass(trial) {
    if (trial.contextTooLarge) return 'pill--ctx';
    if (trial.scoreState === 'passed') return 'pill--pass';
    if (trial.scoreState === 'scored_failure') return 'pill--partial';
    return 'pill--fail';
  }

  function meterTone(rate) {
    if (rate >= 99.5) return 'is-ok';
    if (rate >= 60) return 'is-warn';
    return 'is-bad';
  }

  function meter(rate, tone) {
    var width = Math.max(0, Math.min(100, rate || 0));
    return '<div class="meter" aria-hidden="true"><div class="meter-fill ' + (tone || meterTone(width)) +
      '" style="width:' + width.toFixed(1) + '%"></div></div>';
  }

  function pill(text, cls, plain) {
    return '<span class="pill ' + cls + (plain ? ' pill--plain' : '') + '">' + esc(text) + '</span>';
  }

  function truncateText(text, max) {
    var value = String(text || '');
    return value.length > max ? value.slice(0, max - 1) + '…' : value;
  }

  /* ------------------------------------------------------------------ *
   * Toast
   * ------------------------------------------------------------------ */

  var toastTimer = null;

  function toast(message, isError) {
    var stack = $('#toastStack');
    if (!stack) return;
    var node = document.createElement('div');
    node.className = 'toast' + (isError ? ' is-error' : '');
    node.setAttribute('role', isError ? 'alert' : 'status');
    node.innerHTML = (isError ? ICONS.alert : ICONS.check) + '<span>' + esc(message) + '</span>';
    stack.appendChild(node);
    window.setTimeout(function () {
      node.style.transition = 'opacity .2s ease';
      node.style.opacity = '0';
      window.setTimeout(function () { node.remove(); }, 220);
    }, 2600);
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      while (stack.firstChild) stack.removeChild(stack.firstChild);
    }, 3200);
  }

  /* ------------------------------------------------------------------ *
   * Static text, theme, language
   * ------------------------------------------------------------------ */

  function applyStaticText() {
    document.title = t('app.title');
    var description = $('meta[name="description"]');
    if (description) description.setAttribute('content', t('app.tagline'));

    $$('[data-i18n]').forEach(function (node) {
      node.textContent = t(node.getAttribute('data-i18n'));
    });
    $$('[data-i18n-title]').forEach(function (node) {
      node.setAttribute('title', t(node.getAttribute('data-i18n-title')));
    });
    $$('[data-i18n-aria]').forEach(function (node) {
      node.setAttribute('aria-label', t(node.getAttribute('data-i18n-aria')));
    });

    var github = $('.header-actions .icon-btn:last-child');
    if (github) github.setAttribute('aria-label', t('action.github'));

    var langSwitch = $('#langSwitch');
    if (langSwitch) {
      langSwitch.setAttribute('aria-label', t('action.language'));
      $$('button', langSwitch).forEach(function (button) {
        button.setAttribute('aria-pressed', String(button.getAttribute('data-lang') === I.getLang()));
      });
    }

    var overlayText = $('#dropOverlayText');
    if (overlayText) overlayText.textContent = t('empty.releaseToLoad');
  }

  /* ------------------------------------------------------------------ *
   * Report header
   * ------------------------------------------------------------------ */

  function renderHeader(model) {
    var meta = model.meta;

    setHtml($('#reportTitle'), esc(meta.runFolder || model.source.fileName || 'checkpoint.json'));

    var badges = [];
    if (model.checkpoint) {
      badges.push(pill(model.checkpoint.complete ? t('meta.complete') : t('meta.incomplete'),
        model.checkpoint.complete ? 'pill--pass' : 'pill--partial'));
      if (model.checkpoint.version !== null) {
        badges.push(pill('checkpoint v' + model.checkpoint.version, 'pill--neutral', true));
      }
    }
    badges.push(pill(meta.enhanced ? t('badge.enhancedOn') : t('badge.enhancedOff'), 'pill--accent', true));
    badges.push(pill(model.source.hasConfig ? t('badge.config') : t('badge.noConfig'), 'pill--neutral', true));
    setHtml($('#reportBadges'), badges.join(''));

    var spec = [];
    spec.push(specItem(t('meta.provider'), meta.provider, true));
    spec.push(specItem(t('meta.model'), meta.model, true));
    spec.push(specItem(t('meta.apiMode'), meta.apiMode, true));
    spec.push(specItem(t('meta.testModes'), meta.testModes.join(' · '), false));
    spec.push(specItem(t('meta.evidenceTolerance'),
      meta.evidenceTolerance === null ? null : String(meta.evidenceTolerance), false));
    spec.push(specItem(t('meta.anchorCount'),
      meta.anchorCount === null ? null : String(meta.anchorCount), false));
    setHtml($('#reportSpec'), spec.join(''));

    var source = ['<span>' + esc(t('meta.sourceLabel')) + '</span>',
      '<code>' + esc(model.source.fileName || 'checkpoint.json') + '</code>'];
    if (model.source.configFileName) {
      source.push('<span>·</span><code>' + esc(model.source.configFileName) + '</code>');
    }
    source.push('<span>·</span><span>' + esc(t('footer.generated')) + ' ' + esc(dateText(model.loadedAt)) + '</span>');
    setHtml($('#sourceLine'), source.join(''));
  }

  function specItem(label, value, mono) {
    var hasValue = value !== null && value !== undefined && value !== '';
    var html = hasValue ? esc(String(value)) : esc(R.DASH);
    return '<div' + (hasValue ? '' : ' class="is-empty"') + '>' +
      '<dt>' + esc(label) + '</dt>' +
      '<dd' + (mono && hasValue ? ' class="is-mono"' : '') + '>' + html + '</dd>' +
      '</div>';
  }

  /* ------------------------------------------------------------------ *
   * Readout band
   * ------------------------------------------------------------------ */

  function readoutItem(label, value, unit, note, extra) {
    return '<div class="readout-item">' +
      '<div class="k">' + esc(label) + '</div>' +
      '<div class="v">' + esc(value) + (unit ? '<span class="u">' + esc(unit) + '</span>' : '') + '</div>' +
      (note ? '<div class="n">' + esc(note) + '</div>' : '') +
      (extra || '') +
      '</div>';
  }

  function renderReadout(model) {
    var totals = model.totals;
    var items = [];

    items.push(readoutItem(t('kpi.passRate'), I.decimal(totals.passRatePercent, 1), '%',
      I.integer(totals.passed) + ' / ' + I.integer(totals.trials),
      meter(totals.passRatePercent, totals.passRatePercent >= 100 ? 'is-ok' : (totals.passRatePercent >= 50 ? 'is-warn' : 'is-bad'))));

    items.push(readoutItem(t('kpi.trials'), I.integer(totals.trials), '',
      t('kpi.trialsNote', { passed: totals.passed, failed: totals.failed })));

    items.push(readoutItem(t('kpi.evidence'), I.decimal(totals.evidenceRatePercent, 1), '%',
      I.integer(totals.evidenceHits) + ' / ' + I.integer(totals.questions),
      meter(totals.evidenceRatePercent)));

    items.push(readoutItem(t('kpi.totalTokens'), I.integer(totals.totalTokens), '',
      t('kpi.totalTokensNote', {
        input: R.format.K(totals.promptTotal),
        output: R.format.K(totals.completionTotal)
      })));

    items.push(readoutItem(t('kpi.latency'), I.decimal(totals.elapsedAverage, 2), 's', t('kpi.latencyNote')));

    items.push(readoutItem(t('kpi.tiers'), I.integer(totals.tiers), '',
      t('kpi.tiersNote', { n: model.meta.configuredTiers.length })));

    setHtml($('#readout'), items.join(''));
  }

  function renderRecommend(model) {
    var node = $('#recommendLine');
    if (!node) return;
    var rec = model.recommendation;
    if (!rec) {
      node.hidden = true;
      node.innerHTML = '';
      return;
    }
    node.hidden = false;
    node.innerHTML = '<span>' + esc(t('meta.recommendation')) + '</span>' +
      '<b>chars_per_token ' + esc(rec.charsPerToken.toFixed(4)) + '</b>' +
      '<span class="note">' + esc(t('meta.recommendationNote', { n: rec.samples })) + '</span>';
  }

  /* ------------------------------------------------------------------ *
   * Run state
   * ------------------------------------------------------------------ */

  function stateItem(label, valueHtml) {
    return '<div><dt>' + esc(label) + '</dt><dd>' + valueHtml + '</dd></div>';
  }

  function yesNo(value) {
    if (value === null || value === undefined) return esc(R.DASH);
    return esc(value ? t('meta.yes') : t('meta.no'));
  }

  function renderStatus(model) {
    var items = [];
    var checkpoint = model.checkpoint;
    var meta = model.meta;

    if (checkpoint) {
      if (checkpoint.version !== null) items.push(stateItem(t('status.version'), esc('v' + checkpoint.version)));
      items.push(stateItem(t('section.status'), checkpoint.complete
        ? pill(t('meta.complete'), 'pill--pass')
        : pill(t('meta.incomplete'), 'pill--partial')));
      if (checkpoint.phase) items.push(stateItem(t('status.phase'), esc(checkpoint.phase)));
      if (checkpoint.tierIndex !== null) items.push(stateItem(t('status.tierIndex'), esc(String(checkpoint.tierIndex))));
      items.push(stateItem(t('status.binary'), esc((checkpoint.binaryLow || checkpoint.binaryHigh)
        ? checkpoint.binaryLow + ' – ' + checkpoint.binaryHigh
        : t('status.none'))));
      if (checkpoint.probeHigh) {
        items.push(stateItem(t('status.probe'), esc(String(checkpoint.probeHigh))));
      }
      if (checkpoint.configSignature) {
        items.push(stateItem(t('status.signature'),
          '<span title="' + esc(checkpoint.configSignature) + '">' + esc(checkpoint.configSignature.slice(0, 12)) + '…</span>'));
      }
    }

    if (meta.enhanced || model.source.hasConfig) {
      items.push(stateItem(t('meta.enhanced'), yesNo(meta.enhanced)));
    }
    if (model.source.hasConfig) {
      items.push(stateItem(t('meta.parallel'), yesNo(meta.parallelTests)));
      items.push(stateItem(t('meta.structured'), yesNo(meta.structuredOutput)));
      items.push(stateItem(t('meta.autocalibrate'), yesNo(meta.autoCalibrate)));
      if (meta.timeoutSeconds !== null) {
        items.push(stateItem(t('meta.timeout'), esc(String(meta.timeoutSeconds))));
      }
    }

    setHtml($('#stateList'), items.join(''));
    var note = $('#noConfigNote');
    if (note) {
      note.hidden = model.source.hasConfig;
      if (!model.source.hasConfig) note.textContent = t('meta.noConfig');
    }
  }

  /* ------------------------------------------------------------------ *
   * Charts
   * ------------------------------------------------------------------ */

  function chartPanel(title, svg, legend) {
    return '<div class="panel chart">' +
      '<div class="chart-title">' + esc(title) + '</div>' +
      svg +
      (legend || '') +
      '</div>';
  }

  function renderCharts(model) {
    var host = $('#chartGrid');
    if (!host) return;
    var blocks = [];

    var passItems = model.tiers.map(function (stat) {
      return {
        label: tierLabel(stat.tier),
        percent: stat.passRatePercent,
        status: stat.status,
        caption: I.integer(stat.passed) + '/' + I.integer(stat.trials),
        title: stat.tier + ' · ' + stat.passed + '/' + stat.trials + ' · ' + pct(stat.passRatePercent)
      };
    });
    blocks.push(chartPanel(t('chart.passRate'),
      C.passRateChart(passItems, { label: t('chart.passRate'), labelWidth: 62 })));

    if (model.trials.length) {
      var tokenItems = model.trials.map(function (trial) {
        return {
          label: trial.label,
          input: trial.promptTokens || 0,
          output: trial.completionTokens || 0,
          total: trial.totalTokens || 0,
          totalLabel: trial.totalTokens !== null ? R.format.K(trial.totalTokens) : R.DASH,
          title: trial.label + ' · ' + t('chart.input') + ' ' + k(trial.promptTokens) +
            ' · ' + t('chart.output') + ' ' + k(trial.completionTokens)
        };
      });
      var legend = '<div class="chart-legend">' +
        '<span class="legend-item"><span class="legend-swatch" style="background:var(--accent)"></span>' + esc(t('chart.input')) + '</span>' +
        '<span class="legend-item"><span class="legend-swatch" style="background:var(--accent-2)"></span>' + esc(t('chart.output')) + '</span>' +
        '</div>';
      blocks.push(chartPanel(t('chart.tokens'), C.tokensChart(tokenItems), legend));

      var latencyItems = model.trials.map(function (trial) {
        return {
          label: trial.label,
          value: trial.elapsedSeconds,
          title: trial.label + ' · ' + seconds(trial.elapsedSeconds)
        };
      });
      blocks.push(chartPanel(t('chart.latency'), C.latencyChart(latencyItems)));
    }

    setHtml(host, blocks.join(''));
  }

  /* ------------------------------------------------------------------ *
   * Tier table
   * ------------------------------------------------------------------ */

  var TIER_COLUMNS = [
    { key: 'tier', label: 'tier.tier', align: 'left', width: '76px' },
    { key: 'status', label: 'tier.status', align: 'left', width: '124px' },
    { key: 'trials', label: 'tier.trials', align: 'num', width: '56px' },
    { key: 'passed', label: 'tier.passed', align: 'num', width: '58px' },
    { key: 'passRate', label: 'tier.passRate', align: 'num', width: '76px' },
    { key: 'contextLimits', label: 'tier.contextLimits', align: 'num', width: '56px', optional: true },
    { key: 'failed', label: 'tier.failed', align: 'num', width: '56px' },
    { key: 'inputAvg', label: 'tier.inputAvg', align: 'num', width: '72px' },
    { key: 'inputMedian', label: 'tier.inputMedian', align: 'num', width: '88px', optional: true },
    { key: 'inputRange', label: 'tier.inputRange', align: 'num', width: '142px' },
    { key: 'inputTotal', label: 'tier.inputTotal', align: 'num', width: '80px' },
    { key: 'outputAvg', label: 'tier.outputAvg', align: 'num', width: '72px' },
    { key: 'outputTotal', label: 'tier.outputTotal', align: 'num', width: '78px', optional: true },
    { key: 'totalAvg', label: 'tier.totalAvg', align: 'num', width: '72px' },
    { key: 'latencyAvg', label: 'tier.latencyAvg', align: 'num', width: '80px' }
  ];

  function tierCell(stat, column) {
    var cls = 'dt-cell' + (column.align === 'num' ? ' is-num' : '') +
      (column.key === 'tier' ? ' is-strong is-mono' : '') +
      (column.optional ? ' is-optional' : '');
    var label = esc(t(column.label));
    var open = '<span data-label="' + label + '" class="' + cls + '">';

    switch (column.key) {
      case 'tier':
        return open + esc(I.integer(stat.tier)) + '</span>';
      case 'status':
        return open + pill(statusText(stat.status), statusClass(stat.status)) + '</span>';
      case 'trials':
        return open + esc(I.integer(stat.trials)) + '</span>';
      case 'passed':
        return open + esc(I.integer(stat.passed)) + '</span>';
      case 'passRate':
        return open + esc(pct(stat.passRatePercent)) + '</span>';
      case 'contextLimits':
        return open + esc(I.integer(stat.contextLimits)) + '</span>';
      case 'failed':
        return open + esc(I.integer(stat.failed)) + '</span>';
      case 'inputAvg':
        return open + esc(stat.promptSamples ? kAverage(stat.promptAverage) : R.DASH) + '</span>';
      case 'inputMedian':
        return open + esc(stat.promptSamples ? k(stat.promptMedian) : R.DASH) + '</span>';
      case 'inputRange':
        return open + (stat.promptSamples
          ? esc(k(stat.promptMin)) + '<span class="is-muted"> – </span>' + esc(k(stat.promptMax))
          : esc(R.DASH)) + '</span>';
      case 'inputTotal':
        return open + esc(stat.promptTotal > 0 ? k(stat.promptTotal) : R.DASH) + '</span>';
      case 'outputAvg':
        return open + esc(stat.completionSamples ? kAverage(stat.completionAverage) : R.DASH) + '</span>';
      case 'outputTotal':
        return open + esc(stat.completionTotal > 0 ? k(stat.completionTotal) : R.DASH) + '</span>';
      case 'totalAvg':
        return open + esc(stat.totalSamples ? kAverage(stat.totalAverage) : R.DASH) + '</span>';
      case 'latencyAvg':
        return open + esc(seconds(stat.elapsedAverage)) + '</span>';
      default:
        return open + esc(R.DASH) + '</span>';
    }
  }

  function renderTierTable(model) {
    var host = $('#tierTable');
    if (!host) return;
    var cols = TIER_COLUMNS.map(function (column) { return column.width; }).join(' ');
    var head = TIER_COLUMNS.map(function (column) {
      return '<span role="columnheader" class="' + (column.align === 'num' ? 'is-num' : '') + '">' +
        esc(t(column.label)) + '</span>';
    }).join('');

    var rows = model.tiers.map(function (stat) {
      var cells = TIER_COLUMNS.map(function (column) { return tierCell(stat, column); }).join('');
      return '<div class="dt-row" role="row">' + cells + '</div>';
    }).join('');

    host.innerHTML = '<div class="dt-inner is-wide" role="table" aria-label="' + esc(t('section.tiers')) +
      '" style="--cols:' + cols + '">' +
      '<div class="dt-head" role="row">' + head + '</div>' +
      rows +
      '</div>';
  }

  /* ------------------------------------------------------------------ *
   * Trials table
   * ------------------------------------------------------------------ */

  function modeMiniTable(trial) {
    if (!trial.modes.length) {
      return '<div class="empty-score">' + esc(t('trial.none')) + '</div>';
    }
    var head = '<tr><th>' + esc(t('mode.mode')) + '</th><th>' + esc(t('mode.answers')) + '</th><th>' +
      esc(t('mode.evidence')) + '</th><th>' + esc(t('mode.missed')) + '</th></tr>';
    var rows = trial.modes.map(function (mode) {
      return '<tr>' +
        '<td class="mode-name">' + esc(modeName(mode.mode)) + '</td>' +
        '<td>' + esc(mode.answerHits + '/' + mode.questionCount) + '</td>' +
        '<td>' + esc(mode.evidenceHits + '/' + mode.questionCount) + '</td>' +
        '<td class="missed">' + esc(mode.missed.length ? mode.missed.join(', ') : '') + '</td>' +
        '</tr>';
    }).join('');
    return '<table class="mode-mini"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table>';
  }

  function usageOfTrial(trial) {
    var usage = trial.metadata && trial.metadata.usage;
    if (!usage || typeof usage !== 'object') return null;
    var input = usage.input_tokens !== undefined ? usage.input_tokens : usage.prompt_tokens;
    var output = usage.output_tokens !== undefined ? usage.output_tokens : usage.completion_tokens;
    var reasoning = null;
    var cached = null;
    if (usage.output_tokens_details && usage.output_tokens_details.reasoning_tokens !== undefined) {
      reasoning = usage.output_tokens_details.reasoning_tokens;
    } else if (usage.completion_tokens_details && usage.completion_tokens_details.reasoning_tokens !== undefined) {
      reasoning = usage.completion_tokens_details.reasoning_tokens;
    }
    if (usage.input_tokens_details && usage.input_tokens_details.cached_tokens !== undefined) {
      cached = usage.input_tokens_details.cached_tokens;
    } else if (usage.prompt_tokens_details && usage.prompt_tokens_details.cached_tokens !== undefined) {
      cached = usage.prompt_tokens_details.cached_tokens;
    }
    return { input: input, output: output, total: usage.total_tokens, reasoning: reasoning, cached: cached };
  }

  function detailRows(items) {
    var rows = items.filter(Boolean).map(function (item) {
      return '<dt>' + esc(item[0]) + '</dt><dd>' + item[1] + '</dd>';
    }).join('');
    return '<dl class="detail-list">' + rows + '</dl>';
  }

  function trialDetail(trial) {
    var usage = usageOfTrial(trial);
    var calibration = trial.recommendedCalibration || {};
    var rows = [];

    rows.push([t('trial.httpStatus'), esc(trial.httpStatus === null ? R.DASH : String(trial.httpStatus))]);
    rows.push([t('trial.attempts'), esc(String(trial.attempts || 1))]);
    if (trial.outputRetries) rows.push([t('trial.outputRetries'), esc(String(trial.outputRetries))]);
    rows.push([t('trial.cptUsed'), esc(fixed(trial.charsPerTokenUsed, 4))]);
    rows.push([t('trial.recommendedCpt'),
      esc(trial.recommendedCharsPerToken === null ? R.DASH : trial.recommendedCharsPerToken.toFixed(4))]);
    if (calibration.targetPromptTokens !== undefined && calibration.targetPromptTokens !== null) {
      rows.push([t('trial.calibrationTarget'), esc(I.integer(calibration.targetPromptTokens))]);
      rows.push([t('trial.calibrationActual'), esc(I.integer(calibration.actualPromptTokens))]);
    }
    rows.push([t('trial.outputLimit'), esc(trial.maxOutputTokensUsed ? I.integer(trial.maxOutputTokensUsed) : R.DASH)]);
    if (usage) {
      if (usage.reasoning !== null && usage.reasoning !== undefined) {
        rows.push([t('trial.reasoning'), esc(I.integer(usage.reasoning))]);
      }
      if (usage.cached !== null && usage.cached !== undefined) {
        rows.push([t('trial.cached'), esc(I.integer(usage.cached))]);
      }
    }
    if (trial.repaired) rows.push([t('trial.repaired'), esc(t('meta.yes'))]);
    if (trial.transportError) rows.push([t('trial.transportError'), esc(trial.transportError)]);
    rows.push([t('trial.seed'), esc(String(trial.seed === null ? R.DASH : trial.seed))]);
    if (trial.corpus) rows.push([t('trial.corpus'), esc(trial.corpus)]);
    if (trial.responseFile) rows.push([t('trial.responseFile'), esc(trial.responseFile)]);

    return '<div class="dt-detail" id="trial-detail-' + trial.index + '" data-detail="' + trial.index + '" hidden>' +
      '<div role="cell" aria-colspan="10" style="display:contents">' +
      '<div class="detail-block">' +
      '<div class="detail-title">' + esc(t('trial.modeBreakdown')) + '</div>' +
      modeMiniTable(trial) +
      '</div>' +
      '<div class="detail-block">' +
      '<div class="detail-title">' + esc(t('trial.detail')) + '</div>' +
      detailRows(rows) +
      '</div>' +
      '</div>' +
      '</div>';
  }

  function trialRow(trial) {
    var isOpen = !!state.expanded[trial.index];
    var resultLabel = trial.contextTooLarge ? statusText('context_limit') : scoreText(trial.scoreState);
    var cpt = trial.recommendedCharsPerToken === null ? R.DASH : trial.recommendedCharsPerToken.toFixed(4);

    return '<div class="dt-row' + (isOpen ? ' is-open' : '') + '" role="row" data-index="' + trial.index + '">' +
      '<span class="dt-cell is-mono is-optional" data-label="' + esc(t('tier.tier')) + '">' + esc(tierLabel(trial.tier)) + '</span>' +
      '<span class="dt-cell" data-label="' + esc(t('trial.label')) + '">' +
      '<button type="button" class="row-label" aria-expanded="' + (isOpen ? 'true' : 'false') +
      '" aria-controls="trial-detail-' + trial.index + '">' + esc(trial.label) + '</button></span>' +
      '<span class="dt-cell" data-label="' + esc(t('trial.result')) + '">' +
      pill(resultLabel, scorePillClass(trial)) + '</span>' +
      '<span class="dt-cell is-num" data-label="' + esc(t('trial.actualInput')) + '">' + esc(k(trial.promptTokens)) + '</span>' +
      '<span class="dt-cell is-num" data-label="' + esc(t('trial.actualOutput')) + '">' + esc(k(trial.completionTokens)) + '</span>' +
      '<span class="dt-cell is-num" data-label="' + esc(t('trial.actualTotal')) + '">' + esc(k(trial.totalTokens)) + '</span>' +
      '<span class="dt-cell is-num" data-label="' + esc(t('trial.answers')) + '">' +
      esc(trial.answerHits + '/' + trial.questionCount) + '</span>' +
      '<span class="dt-cell is-num" data-label="' + esc(t('trial.evidence')) + '">' +
      esc(trial.evidenceHits + '/' + trial.questionCount) + '</span>' +
      '<span class="dt-cell is-num" data-label="' + esc(t('trial.elapsed')) + '">' + esc(seconds(trial.elapsedSeconds)) + '</span>' +
      '<span class="dt-cell is-toggle" data-label="' + esc(t('trial.detail')) + '" title="' + esc(t('trial.recommendedCpt') + ' ' + cpt) + '">' +
      '<span class="row-chevron" aria-hidden="true">' + ICONS.chevron + '</span></span>' +
      '</div>' +
      trialDetail(trial);
  }

  function renderTrials(model) {
    var host = $('#trialTable');
    if (!host) return;

    var cols = '0.62fr 1.25fr 1.3fr 0.72fr 0.72fr 0.78fr 0.68fr 0.72fr 0.74fr 34px';
    var head = ['tier.tier', 'trial.label', 'trial.result', 'trial.actualInput', 'trial.actualOutput',
      'trial.actualTotal', 'trial.answers', 'trial.evidence', 'trial.elapsed']
      .map(function (key, index) {
        return '<span role="columnheader" class="' + (index >= 3 ? 'is-num' : '') + '">' + esc(t(key)) + '</span>';
      }).join('') + '<span role="columnheader"></span>';

    host.innerHTML = '<div class="dt-inner" role="table" aria-label="' + esc(t('section.trials')) +
      '" style="--cols:' + cols + '">' +
      '<div class="dt-head" role="row">' + head + '</div>' +
      model.trials.map(trialRow).join('') +
      '</div>';
  }

  function setTrialOpen(index, open) {
    var row = $('.dt-row[data-index="' + index + '"]');
    var detail = $('#trial-detail-' + index);
    if (!row) return;
    row.classList.toggle('is-open', open);
    if (detail) detail.hidden = !open;
    var button = $('.row-label', row);
    if (button) button.setAttribute('aria-expanded', String(open));
    if (open) state.expanded[index] = true;
    else delete state.expanded[index];
  }

  function toggleTrial(index) {
    setTrialOpen(index, !state.expanded[index]);
  }

  /* ------------------------------------------------------------------ *
   * Heatmap
   * ------------------------------------------------------------------ */

  function heatTone(rate) {
    if (rate >= 99.5) {
      return 'background:color-mix(in srgb, var(--ok) 15%, var(--surface-3));border-color:color-mix(in srgb, var(--ok) 26%, transparent)';
    }
    if (rate >= 80) return 'background:color-mix(in srgb, var(--ok) 7%, var(--surface-3))';
    if (rate >= 50) {
      return 'background:color-mix(in srgb, var(--warn) 13%, var(--surface-3));border-color:color-mix(in srgb, var(--warn) 24%, transparent)';
    }
    return 'background:color-mix(in srgb, var(--bad) 12%, var(--surface-3));border-color:color-mix(in srgb, var(--bad) 26%, transparent)';
  }

  function renderHeatmap(model) {
    var host = $('#heatmap');
    if (!host) return;

    var modeSet = Object.create(null);
    model.trials.forEach(function (trial) {
      trial.modes.forEach(function (mode) { modeSet[mode.mode] = true; });
    });
    var modes = Object.keys(modeSet).sort(function (a, b) {
      var ia = MODE_ORDER.indexOf(a);
      var ib = MODE_ORDER.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });

    if (!modes.length) {
      host.innerHTML = '<div class="empty-score">' + esc(t('trial.none')) + '</div>';
      setHtml($('#heatLegend'), '');
      return;
    }

    host.style.setProperty('--heat-cols', String(modes.length));

    var head = '<div class="heat-row">' +
      '<div class="heat-label"></div>' +
      modes.map(function (mode) { return '<div class="heat-head">' + esc(modeName(mode)) + '</div>'; }).join('') +
      '</div>';

    var rows = model.trials.map(function (trial) {
      var cells = modes.map(function (mode) {
        var entry = null;
        for (var i = 0; i < trial.modes.length; i++) {
          if (trial.modes[i].mode === mode) { entry = trial.modes[i]; break; }
        }
        if (!entry) {
          return '<div class="heat-cell" style="opacity:.4"><div class="pct">' + esc(R.DASH) +
            '</div><div class="frac">' + esc(R.DASH) + '</div></div>';
        }
        var title = modeName(mode) + ' · ' + t('mode.answers') + ' ' + entry.answerHits + '/' + entry.questionCount +
          ' · ' + t('mode.evidence') + ' ' + entry.evidenceHits + '/' + entry.questionCount +
          (entry.missed.length ? ' · ' + t('mode.missed') + ': ' + entry.missed.join(', ') : '');
        return '<div class="heat-cell" style="' + heatTone(entry.evidenceRate) + '" title="' + esc(title) + '">' +
          '<div class="pct">' + esc(I.decimal(entry.evidenceRate, 0)) + '%</div>' +
          '<div class="frac">' + esc(entry.evidenceHits + '/' + entry.questionCount) + '</div>' +
          '</div>';
      }).join('');
      return '<div class="heat-row">' +
        '<div class="heat-label" title="' + esc(trial.label) + '">' +
        esc(truncateText(trial.label, 13)) + '</div>' +
        cells +
        '</div>';
    }).join('');

    var meanCells = modes.map(function (mode) {
      var hits = 0;
      var total = 0;
      model.trials.forEach(function (trial) {
        trial.modes.forEach(function (entry) {
          if (entry.mode !== mode) return;
          hits += entry.evidenceHits;
          total += entry.questionCount;
        });
      });
      var rate = total ? (hits / total) * 100 : 0;
      return '<div class="heat-cell" style="' + heatTone(rate) + '">' +
        '<div class="pct">' + esc(I.decimal(rate, 0)) + '%</div>' +
        '<div class="frac">' + esc(hits + '/' + total) + '</div>' +
        '</div>';
    }).join('');

    var meanRow = '<div class="heat-row" style="margin-top:3px">' +
      '<div class="heat-label" style="color:var(--ink-2);font-weight:600">' + esc(t('mode.mean')) + '</div>' +
      meanCells +
      '</div>';

    host.innerHTML = head + rows + meanRow;

    setHtml($('#heatLegend'),
      '<span class="legend-item"><span class="legend-swatch" style="background:var(--ok)"></span>100%</span>' +
      '<span class="legend-item"><span class="legend-swatch" style="background:var(--warn)"></span>' +
      esc(t('legend.partial')) + '</span>' +
      '<span class="legend-item"><span class="legend-swatch" style="background:var(--bad)"></span>' +
      esc(t('legend.low')) + '</span>');
  }

  /* ------------------------------------------------------------------ *
   * Raw JSON
   * ------------------------------------------------------------------ */

  function activeRawTab() {
    if (state.rawTab === 'config' && state.raw.config) return 'config';
    return 'checkpoint';
  }

  function currentRawValue() {
    return activeRawTab() === 'config' ? state.raw.config : state.raw.checkpoint;
  }

  function renderRaw() {
    var tabsHost = $('#rawTabs');
    var pre = $('#rawPre');
    if (!tabsHost || !pre) return;

    var tabs = [
      { id: 'checkpoint', label: t('raw.checkpoint'), available: !!state.raw.checkpoint },
      { id: 'config', label: t('raw.config'), available: !!state.raw.config }
    ];

    tabsHost.innerHTML = tabs.map(function (tab) {
      var active = activeRawTab() === tab.id;
      return '<button type="button" class="raw-tab" role="tab" data-tab="' + tab.id + '" aria-selected="' + active + '"' +
        (tab.available ? '' : ' disabled style="opacity:.5;cursor:not-allowed"') + '>' +
        esc(tab.label) +
        '<span class="count">' + (tab.available ? '' : esc(t('raw.notLoaded'))) + '</span>' +
        '</button>';
    }).join('');

    var value = currentRawValue();
    if (!value) {
      pre.textContent = t('raw.notLoaded');
      return;
    }
    var text = JSON.stringify(value, null, 2);
    if (text.length > 400000) {
      text = text.slice(0, 400000) + '\n… (' + I.integer(text.length - 400000) + ' more characters)';
    }
    pre.textContent = text;
  }

  /* ------------------------------------------------------------------ *
   * Render orchestration
   * ------------------------------------------------------------------ */

  function renderAll() {
    applyStaticText();
    var model = state.model;
    var empty = $('#emptyState');
    var report = $('#report');

    if (!model) {
      if (empty) empty.hidden = false;
      if (report) report.hidden = true;
      return;
    }

    if (empty) empty.hidden = true;
    if (report) report.hidden = false;

    renderHeader(model);
    renderReadout(model);
    renderRecommend(model);
    renderCharts(model);
    renderStatus(model);
    renderTierTable(model);
    renderTrials(model);
    renderHeatmap(model);
    renderRaw();

    var banner = $('#restoreBanner');
    if (banner) {
      banner.hidden = !state.restored;
      if (state.restored) {
        setHtml($('#restoreText'), esc(t('banner.restored', {
          name: model.source.fileName || 'checkpoint.json'
        })));
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * Loading data
   * ------------------------------------------------------------------ */

  function analyzeSelection(selection) {
    return R.analyze({
      checkpoint: selection.checkpoint || null,
      config: selection.config || null,
      fileName: selection.fileName || '',
      configFileName: selection.configFileName || '',
      sourceLabel: selection.sourceLabel || ''
    });
  }

  function commit(selection) {
    var model = analyzeSelection(selection);
    if (!model.trials.length) throw new Error(t('error.emptyTrials'));

    state.model = model;
    state.raw = {
      checkpoint: selection.checkpoint || null,
      config: selection.config || null,
      fileName: selection.fileName || '',
      configFileName: selection.configFileName || ''
    };
    state.rawTab = 'checkpoint';
    state.restored = false;
    state.expanded = Object.create(null);
    saveCache();
    renderAll();
    if (window.__CL_EXPAND_ALL__) {
      model.trials.forEach(function (trial) { setTrialOpen(trial.index, true); });
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function selectionFromEntries(entries) {
    var selection = { checkpoint: null, config: null, fileName: '', configFileName: '' };
    var trialArrays = [];

    entries.forEach(function (entry) {
      if (!entry || !entry.json) return;
      if (entry.kind === 'checkpoint' && !selection.checkpoint) {
        selection.checkpoint = entry.json;
        selection.fileName = entry.name;
      } else if (entry.kind === 'trials') {
        trialArrays.push(entry);
      } else if (entry.kind === 'config' && !selection.config) {
        selection.config = entry.json;
        selection.configFileName = entry.name;
      }
    });

    if (!selection.checkpoint && trialArrays.length) {
      selection.checkpoint = { version: null, complete: null, trials: trialArrays[0].json };
      selection.fileName = trialArrays[0].name;
    }

    if (!selection.checkpoint) {
      var configOnly = entries.filter(function (entry) { return entry && entry.kind === 'config'; })[0];
      if (configOnly) throw new Error(t('error.configOnly', { name: configOnly.name }));
      throw new Error(t('error.noTrials'));
    }

    return selection;
  }

  function readEntries(files) {
    var list = Array.prototype.slice.call(files || []);
    return Promise.all(list.map(function (file) {
      return file.text().then(function (text) {
        try {
          var parsed = R.parseText(text, file.name);
          return { name: file.name, path: file.webkitRelativePath || '', kind: parsed.kind, json: parsed.data };
        } catch (error) {
          return { name: file.name, path: file.webkitRelativePath || '', kind: 'invalid', error: error };
        }
      }).catch(function (error) {
        return { name: file.name, path: file.webkitRelativePath || '', kind: 'unreadable', error: error };
      });
    }));
  }

  function handleFiles(files) {
    if (!files || !files.length) return;
    readEntries(files).then(function (entries) {
      var usable = entries.filter(function (entry) {
        return entry.kind === 'checkpoint' || entry.kind === 'trials' || entry.kind === 'config';
      });

      if (!usable.length) {
        var invalid = entries.filter(function (entry) { return entry.kind === 'invalid'; })[0];
        toast(invalid ? t('error.json', { message: invalid.error.message }) : t('error.noTrials'), true);
        return;
      }

      var selection;
      try {
        selection = selectionFromEntries(usable);
      } catch (error) {
        toast(error.message, true);
        return;
      }

      try {
        commit(selection);
        toast(t('toast.loaded', { name: selection.fileName || 'checkpoint.json' }));
      } catch (error) {
        toast(error.message, true);
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * Drag & drop (walks folders)
   * ------------------------------------------------------------------ */

  var dragDepth = 0;

  function isFileDrag(event) {
    var types = event.dataTransfer && event.dataTransfer.types;
    if (!types) return false;
    return Array.prototype.indexOf.call(types, 'Files') !== -1;
  }

  function collectEntryFiles(entry, out, depth) {
    if (!entry || depth > 3) return Promise.resolve();
    if (entry.isFile) {
      return new Promise(function (resolve) {
        entry.file(function (file) { out.push(file); resolve(); }, function () { resolve(); });
      });
    }
    if (entry.isDirectory) {
      var reader = entry.createReader();
      return new Promise(function (resolve) {
        function readBatch() {
          reader.readEntries(function (batch) {
            if (!batch.length) { resolve(); return; }
            Promise.all(batch.map(function (child) {
              return collectEntryFiles(child, out, depth + 1);
            })).then(readBatch, resolve);
          }, function () { resolve(); });
        }
        readBatch();
      });
    }
    return Promise.resolve();
  }

  function filesFromDataTransfer(dataTransfer) {
    if (!dataTransfer) return Promise.resolve([]);
    var items = dataTransfer.items ? Array.prototype.slice.call(dataTransfer.items) : [];
    var entries = items.map(function (item) {
      return typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
    }).filter(Boolean);

    if (!entries.length) {
      return Promise.resolve(Array.prototype.slice.call(dataTransfer.files || []));
    }

    var out = [];
    return Promise.all(entries.map(function (entry) {
      return collectEntryFiles(entry, out, 0);
    })).then(function () {
      if (!out.length) return Array.prototype.slice.call(dataTransfer.files || []);
      return out.filter(function (file) {
        return /\.json$/i.test(file.name);
      }).slice(0, 200);
    });
  }

  function bindDrop() {
    var overlay = $('#dropOverlay');

    window.addEventListener('dragenter', function (event) {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      dragDepth++;
      if (state.model && overlay) overlay.hidden = false;
    });

    window.addEventListener('dragleave', function (event) {
      if (!isFileDrag(event)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth && overlay) overlay.hidden = true;
    });

    window.addEventListener('dragover', function (event) {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      var zone = $('#dropzone');
      if (zone) zone.classList.add('is-dragging');
    });

    window.addEventListener('drop', function (event) {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      dragDepth = 0;
      if (overlay) overlay.hidden = true;
      var zone = $('#dropzone');
      if (zone) zone.classList.remove('is-dragging');
      filesFromDataTransfer(event.dataTransfer).then(handleFiles);
    });
  }

  /* ------------------------------------------------------------------ *
   * Cache
   * ------------------------------------------------------------------ */

  function saveCache() {
    if (!state.cacheable) return;
    try {
      var payload = JSON.stringify({
        fileName: state.raw.fileName,
        configFileName: state.raw.configFileName,
        checkpoint: state.raw.checkpoint,
        config: state.raw.config,
        savedAt: new Date().toISOString()
      });
      if (payload.length > STORAGE_LIMIT) return;
      window.localStorage.setItem(STORAGE_DATA, payload);
    } catch (error) { /* quota or private mode */ }
  }

  function loadCache() {
    try {
      var raw = window.localStorage.getItem(STORAGE_DATA);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && parsed.checkpoint ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  function clearCache() {
    try { window.localStorage.removeItem(STORAGE_DATA); } catch (error) { /* ignore */ }
    state.model = null;
    state.raw = { checkpoint: null, config: null, fileName: '', configFileName: '' };
    state.restored = false;
    state.expanded = Object.create(null);
    renderAll();
    toast(t('toast.cleared'));
  }

  /* ------------------------------------------------------------------ *
   * Export & clipboard
   * ------------------------------------------------------------------ */

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function copyText(text) {
    function fallback() {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', 'readonly');
      area.style.position = 'fixed';
      area.style.top = '-1000px';
      document.body.appendChild(area);
      area.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (error) { ok = false; }
      document.body.removeChild(area);
      return ok;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast(t('action.copied'));
      }).catch(function () {
        toast(fallback() ? t('action.copied') : t('toast.copyFailed'), !fallback());
      });
      return;
    }
    toast(fallback() ? t('action.copied') : t('toast.copyFailed'), !fallback());
  }

  /* ------------------------------------------------------------------ *
   * Events
   * ------------------------------------------------------------------ */

  function bindEvents() {
    var fileInput = $('#fileInput');
    var folderInput = $('#folderInput');

    function openPicker(folder) {
      var input = folder ? folderInput : fileInput;
      if (!input) return;
      input.value = '';
      input.click();
    }

    $('#pickFile').addEventListener('click', function () { openPicker(false); });
    $('#pickFolder').addEventListener('click', function () { openPicker(true); });
    $('#replaceFile').addEventListener('click', function () { openPicker(false); });
    $('#loadSample').addEventListener('click', loadSample);

    fileInput.addEventListener('change', function () {
      handleFiles(fileInput.files);
      fileInput.value = '';
    });
    folderInput.addEventListener('change', function () {
      handleFiles(folderInput.files);
      folderInput.value = '';
    });

    $('#printBtn').addEventListener('click', function () { window.print(); });

    $('#langSwitch').addEventListener('click', function (event) {
      var button = event.target.closest('button[data-lang]');
      if (!button) return;
      I.setLang(button.getAttribute('data-lang'));
      renderAll();
    });

    $('#exportMd').addEventListener('click', function () {
      if (!state.model) return;
      download('RESULTS.md', R.toMarkdown(state.model), 'text/markdown;charset=utf-8');
      toast(t('toast.exportedMd'));
    });

    $('#exportCsv').addEventListener('click', function () {
      if (!state.model) return;
      download('trials.csv', R.toCSV(state.model), 'text/csv;charset=utf-8');
      toast(t('toast.exportedCsv'));
    });

    $('#expandAll').addEventListener('click', function () {
      if (!state.model) return;
      state.model.trials.forEach(function (trial) { setTrialOpen(trial.index, true); });
    });

    $('#collapseAll').addEventListener('click', function () {
      if (!state.model) return;
      state.model.trials.forEach(function (trial) { setTrialOpen(trial.index, false); });
    });

    $('#trialTable').addEventListener('click', function (event) {
      var button = event.target.closest('.row-label');
      var row = event.target.closest('.dt-row');
      if (!row) return;
      if (button) event.stopPropagation();
      toggleTrial(Number(row.getAttribute('data-index')));
    });

    $('#rawTabs').addEventListener('click', function (event) {
      var tab = event.target.closest('.raw-tab');
      if (!tab || tab.disabled) return;
      state.rawTab = tab.getAttribute('data-tab');
      renderRaw();
    });

    $('#copyRaw').addEventListener('click', function () {
      var value = currentRawValue();
      if (value) copyText(JSON.stringify(value, null, 2));
    });

    $('#downloadRaw').addEventListener('click', function () {
      var value = currentRawValue();
      if (!value) return;
      var name = activeRawTab() === 'config' ? 'run_config.public.json' : 'checkpoint.json';
      download(name, JSON.stringify(value, null, 2), 'application/json');
    });

    $('#clearCache').addEventListener('click', clearCache);

    window.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        var overlay = $('#dropOverlay');
        if (overlay) overlay.hidden = true;
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * Sample & boot
   * ------------------------------------------------------------------ */

  function loadSample() {
    var sample = window.CL_SAMPLE;
    if (!sample || !sample.checkpoint) {
      toast(t('error.noTrials'), true);
      return;
    }
    try {
      commit({
        checkpoint: sample.checkpoint,
        config: sample.config || null,
        fileName: 'checkpoint.json',
        configFileName: sample.config ? 'run_config.public.json' : ''
      });
      toast(t('toast.sample'));
    } catch (error) {
      toast(error.message, true);
    }
  }

  function wantsSample() {
    var hash = String(window.location.hash || '').toLowerCase();
    var search = String(window.location.search || '').toLowerCase();
    return hash === '#demo' || hash === '#sample' || search.indexOf('demo=1') !== -1;
  }

  function boot() {
    var forcedLang = null;
    try {
      forcedLang = new URLSearchParams(window.location.search).get('lang');
    } catch (error) {
      forcedLang = null;
    }
    if (forcedLang === 'zh' || forcedLang === 'zh-CN' || forcedLang === 'cn') I.setLang('zh-CN');
    else if (forcedLang === 'en' || forcedLang === 'en-US') I.setLang('en');

    I.setLang(I.getLang());
    applyStaticText();

    try {
      window.__CL_EXPAND_ALL__ = new URLSearchParams(window.location.search).get('expand') === '1' ||
        String(window.location.hash || '').toLowerCase() === '#expand';
    } catch (error) {
      window.__CL_EXPAND_ALL__ = false;
    }

    bindEvents();
    bindDrop();

    if (wantsSample()) {
      state.cacheable = false;
      loadSample();
      return;
    }

    var cached = loadCache();
    if (cached) {
      try {
        var model = analyzeSelection({
          checkpoint: cached.checkpoint,
          config: cached.config,
          fileName: cached.fileName,
          configFileName: cached.configFileName
        });
        if (model.trials.length) {
          state.model = model;
          state.raw = {
            checkpoint: cached.checkpoint,
            config: cached.config || null,
            fileName: cached.fileName || '',
            configFileName: cached.configFileName || ''
          };
          state.restored = true;
          renderAll();
          return;
        }
      } catch (error) { /* fall through to the empty state */ }
    }

    renderAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
