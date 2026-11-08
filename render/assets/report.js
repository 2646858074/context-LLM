/*!
 * report.js — Context-LLM checkpoint/summary data layer.
 *
 * Pure functions only (no DOM): parses a checkpoint.json / summary.json /
 * run_config.public.json, normalizes trials and reproduces the statistics
 * that internal/report/report.go writes into RESULTS.md.
 *
 * Works as a browser global (window.CLReport) and as a CommonJS module.
 */
(function (global) {
  'use strict';

  var HEADROOM_TOKENS = 12000; // internal/config.HeadroomTokens
  var CHECKPOINT_VERSION = 1;
  var DASH = '\u2014';

  /* ------------------------------------------------------------------ *
   * Small helpers
   * ------------------------------------------------------------------ */

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function num(value) {
    if (typeof value === 'number' && isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
      var parsed = Number(value);
      if (isFinite(parsed)) return parsed;
    }
    return null;
  }

  function intOrNull(value) {
    var parsed = num(value);
    return parsed === null ? null : Math.trunc(parsed);
  }

  function round4(value) {
    // math.Round in Go rounds half away from zero; all inputs here are > 0.
    return Math.round(value * 10000) / 10000;
  }

  function trunc(value) {
    return Math.trunc(value);
  }

  function sum(values) {
    var total = 0;
    for (var i = 0; i < values.length; i++) total += values[i];
    return total;
  }

  function average(values) {
    return values.length ? sum(values) / values.length : 0;
  }

  /** Upper median, matching Go: sorted[len/2]. */
  function median(values) {
    if (!values.length) return 0;
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    return sorted[Math.floor(sorted.length / 2)];
  }

  /** Same rendering as report.formatK: one decimal, always "K". */
  function formatK(value) {
    return (value / 1000).toFixed(1) + 'K';
  }

  /** Go's int() cast before formatK truncates toward zero. */
  function formatKAverage(value) {
    return formatK(trunc(value));
  }

  function formatSeconds(value) {
    return value.toFixed(2) + 's';
  }

  function formatPercent(value) {
    return value.toFixed(1) + '%';
  }

  function commaInt(value) {
    return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function basename(path, fallback) {
    if (typeof path !== 'string' || !path) return fallback || '';
    var parts = path.split(/[\\/]+/).filter(function (part) { return part !== ''; });
    return parts.length ? parts[parts.length - 1] : (fallback || '');
  }

  function parentName(path) {
    if (typeof path !== 'string' || !path) return '';
    var parts = path.split(/[\\/]+/).filter(function (part) { return part !== ''; });
    return parts.length > 1 ? parts[parts.length - 2] : '';
  }

  /* ------------------------------------------------------------------ *
   * Input detection
   * ------------------------------------------------------------------ */

  /**
   * Classifies parsed JSON without trusting the file name too much.
   * @returns {{kind:string, data:any, hints:string[]}}
   */
  function classify(parsed, fileName) {
    var hints = [];
    var name = String(fileName || '').toLowerCase();

    if (Array.isArray(parsed)) {
      if (parsed.length && isObject(parsed[0]) && ('tier' in parsed[0] || 'label' in parsed[0])) {
        hints.push('trials-array');
        return { kind: 'trials', data: parsed, hints: hints };
      }
      if (!parsed.length) return { kind: 'trials', data: [], hints: ['empty-array'] };
    }

    if (isObject(parsed)) {
      if (Array.isArray(parsed.trials)) {
        hints.push('checkpoint');
        return { kind: 'checkpoint', data: parsed, hints: hints };
      }
      if ('base_url' in parsed || 'model' in parsed || 'enhanced_auto_test' in parsed || 'test_modes' in parsed) {
        hints.push('config');
        return { kind: 'config', data: parsed, hints: hints };
      }
      if (Array.isArray(parsed.items) && parsed.items.length && isObject(parsed.items[0]) && 'tier' in parsed.items[0]) {
        hints.push('trials-array');
        return { kind: 'trials', data: parsed.items, hints: hints };
      }
    }

    if (name.indexOf('config') !== -1) {
      return { kind: 'config', data: isObject(parsed) ? parsed : null, hints: ['name-hint'] };
    }

    return { kind: 'unknown', data: parsed, hints: hints };
  }

  /** Parses raw text and returns {kind, data, hints}. Throws on invalid JSON. */
  function parseText(text, fileName) {
    var parsed = JSON.parse(text);
    return classify(parsed, fileName);
  }

  /* ------------------------------------------------------------------ *
   * Normalization
   * ------------------------------------------------------------------ */

  function normalizeMode(entry) {
    entry = isObject(entry) ? entry : {};
    var total = intOrNull(entry.question_count) || 0;
    var answers = intOrNull(entry.answer_hits) || 0;
    var evidence = intOrNull(entry.evidence_hits) || 0;
    return {
      answerHits: answers,
      evidenceHits: evidence,
      questionCount: total,
      missed: Array.isArray(entry.missed) ? entry.missed.map(String) : [],
      answerRate: total ? (answers / total) * 100 : 0,
      evidenceRate: total ? (evidence / total) * 100 : 0
    };
  }

  function normalizeTrial(raw, index) {
    raw = isObject(raw) ? raw : {};
    var score = isObject(raw.score) ? raw.score : {};
    var questionCount = intOrNull(score.question_count) || 0;
    var answerHits = intOrNull(score.answer_hits) || 0;
    var evidenceHits = intOrNull(score.evidence_hits) || 0;
    var promptTokens = intOrNull(raw.prompt_tokens);
    var completionTokens = intOrNull(raw.completion_tokens);

    var modes = [];
    if (isObject(score.by_mode)) {
      Object.keys(score.by_mode).sort().forEach(function (key) {
        var entry = normalizeMode(score.by_mode[key]);
        entry.mode = key;
        modes.push(entry);
      });
    }

    var metadata = isObject(raw.response_metadata) ? raw.response_metadata : null;
    var attemptMetadata = Array.isArray(raw.response_attempt_metadata) ? raw.response_attempt_metadata : null;
    var benchmark = isObject(metadata && metadata._benchmark)
      ? metadata._benchmark
      : (attemptMetadata && isObject(attemptMetadata[0] && attemptMetadata[0]._benchmark) ? attemptMetadata[0]._benchmark : null);
    var request = isObject(metadata && metadata._request) ? metadata._request : null;

    var contextTooLarge = raw.context_too_large === true;
    var state = typeof score.state === 'string' && score.state ? score.state : (contextTooLarge ? 'context_too_large' : 'unknown');

    return {
      index: index,
      tier: intOrNull(raw.tier) || 0,
      label: typeof raw.label === 'string' && raw.label ? raw.label : 'trial_' + (index + 1),
      seed: raw.seed === undefined ? null : raw.seed,
      corpus: typeof raw.corpus === 'string' ? raw.corpus : '',
      responseFile: typeof raw.response_file === 'string' ? raw.response_file : '',
      attempts: intOrNull(raw.attempts) || 0,
      maxOutputTokensUsed: intOrNull(raw.max_output_tokens_used) || 0,
      outputRetries: intOrNull(raw.output_retries) || 0,
      charsPerTokenUsed: num(raw.chars_per_token_used),
      promptTokens: promptTokens,
      completionTokens: completionTokens,
      totalTokens: promptTokens !== null && completionTokens !== null ? promptTokens + completionTokens : null,
      elapsedSeconds: num(raw.elapsed_seconds) || 0,
      httpStatus: intOrNull(raw.http_status),
      transportError: typeof raw.transport_error === 'string' && raw.transport_error ? raw.transport_error : '',
      contextTooLarge: contextTooLarge,
      scoreState: state,
      answerHits: answerHits,
      evidenceHits: evidenceHits,
      questionCount: questionCount,
      missed: Array.isArray(score.missed) ? score.missed.map(String) : [],
      repaired: score.repaired === true,
      detail: typeof score.detail === 'string' ? score.detail : '',
      modes: modes,
      answerRate: questionCount ? (answerHits / questionCount) * 100 : 0,
      evidenceRate: questionCount ? (evidenceHits / questionCount) * 100 : 0,
      calibration: isObject(raw.calibration) ? raw.calibration : null,
      metadata: metadata,
      attemptMetadata: attemptMetadata,
      benchmark: benchmark,
      request: request,
      testFilesCleaned: raw.test_files_cleaned === true,
      raw: raw
    };
  }

  /* ------------------------------------------------------------------ *
   * Aggregation — mirrors report.Aggregate / report.tierStatus
   * ------------------------------------------------------------------ */

  function tierStatus(stat) {
    if (stat.passed === stat.trials) return 'passed';
    if (stat.contextLimits > 0 && stat.passed === 0) return 'context_limit';
    return 'partial';
  }

  function aggregate(trials) {
    var order = [];
    var grouped = {};
    trials.forEach(function (trial) {
      if (!grouped[trial.tier]) {
        grouped[trial.tier] = [];
        order.push(trial.tier);
      }
      grouped[trial.tier].push(trial);
    });

    return order.map(function (tier) {
      var group = grouped[tier];
      var stat = {
        tier: tier,
        trials: group.length,
        passed: 0,
        failed: 0,
        contextLimits: 0,
        promptSamples: 0,
        promptAverage: 0,
        promptMedian: 0,
        promptMin: 0,
        promptMax: 0,
        promptTotal: 0,
        completionSamples: 0,
        completionAverage: 0,
        completionTotal: 0,
        totalSamples: 0,
        totalTotal: 0,
        totalAverage: 0,
        elapsedAverage: 0
      };

      var promptValues = [];
      var completionValues = [];
      var totalValues = [];
      var elapsedValues = [];

      group.forEach(function (trial) {
        if (!trial.contextTooLarge && trial.scoreState === 'passed') stat.passed++;
        else if (trial.contextTooLarge) stat.contextLimits++;
        else stat.failed++;

        if (trial.promptTokens !== null && trial.promptTokens > 0) promptValues.push(trial.promptTokens);
        if (trial.completionTokens !== null && trial.completionTokens > 0) completionValues.push(trial.completionTokens);
        if (trial.promptTokens !== null && trial.completionTokens !== null && trial.promptTokens > 0 && trial.completionTokens > 0) {
          totalValues.push(trial.promptTokens + trial.completionTokens);
        }
        elapsedValues.push(trial.elapsedSeconds);
      });

      stat.passRatePercent = (stat.passed / stat.trials) * 100;
      stat.status = tierStatus(stat);

      stat.promptSamples = promptValues.length;
      if (promptValues.length) {
        stat.promptAverage = average(promptValues);
        stat.promptMedian = median(promptValues);
        stat.promptMin = Math.min.apply(null, promptValues);
        stat.promptMax = Math.max.apply(null, promptValues);
        stat.promptTotal = sum(promptValues);
      }

      stat.completionSamples = completionValues.length;
      if (completionValues.length) {
        stat.completionAverage = average(completionValues);
        stat.completionTotal = sum(completionValues);
      }

      stat.totalSamples = totalValues.length;
      if (totalValues.length) {
        stat.totalTotal = sum(totalValues);
        stat.totalAverage = average(totalValues);
      }

      stat.elapsedAverage = average(elapsedValues);
      stat.trialsList = group;
      return stat;
    });
  }

  /* ------------------------------------------------------------------ *
   * Calibration — mirrors report.calibrationForTrial / runner.CalibrateFromTrials
   * ------------------------------------------------------------------ */

  function trialsForTier(trials, tier) {
    return trials.filter(function (trial) {
      return trial.tier === tier && trial.promptTokens !== null;
    });
  }

  function calibrateFromTrials(tier, charsPerToken, group) {
    var values = group
      .map(function (trial) { return trial.promptTokens; })
      .filter(function (value) { return value !== null && value > 0; });
    if (!values.length) return null;
    var target = tier - HEADROOM_TOKENS;
    var med = median(values);
    if (!med) return null;
    return {
      targetPromptTokens: target,
      actualPromptTokens: med,
      charsPerTokenUsed: charsPerToken,
      recommendedCharsPerToken: round4((charsPerToken * target) / med),
      samples: values.length
    };
  }

  function calibrationForTrial(trials, trial, enhanced) {
    if (!enhanced) {
      if (!trial.calibration) return null;
      var recommended = num(trial.calibration.recommended_chars_per_token);
      if (recommended === null) return null;
      return {
        targetPromptTokens: intOrNull(trial.calibration.target_prompt_tokens),
        actualPromptTokens: intOrNull(trial.calibration.actual_prompt_tokens),
        charsPerTokenUsed: num(trial.calibration.chars_per_token_used),
        recommendedCharsPerToken: recommended,
        differencePercent: num(trial.calibration.difference_percent),
        samples: 1
      };
    }
    var group = trialsForTier(trials, trial.tier);
    if (!group.length) return null;
    var chars = trial.charsPerTokenUsed === null ? 0 : trial.charsPerTokenUsed;
    return calibrateFromTrials(trial.tier, chars, group);
  }

  /* ------------------------------------------------------------------ *
   * Top-level analysis
   * ------------------------------------------------------------------ */

  var SCORE_STATES = [
    'passed',
    'scored_failure',
    'request_failed',
    'invalid_answer_json',
    'context_too_large',
    'unknown'
  ];

  /**
   * @param {{checkpoint?:any, config?:any, fileName?:string, configFileName?:string,
   *          runFolder?:string, sourceLabel?:string}} input
   */
  function analyze(input) {
    input = input || {};
    var checkpoint = isObject(input.checkpoint) ? input.checkpoint : null;
    var config = isObject(input.config) ? input.config : null;
    var warnings = [];

    var rawTrials = [];
    if (checkpoint && Array.isArray(checkpoint.trials)) rawTrials = checkpoint.trials;
    else if (Array.isArray(input.trials)) rawTrials = input.trials;

    var trials = rawTrials.map(normalizeTrial);

    if (checkpoint && checkpoint.version !== undefined && checkpoint.version !== CHECKPOINT_VERSION) {
      warnings.push({ key: 'unsupportedVersion', params: { version: String(checkpoint.version), expected: String(CHECKPOINT_VERSION) } });
    }
    trials.forEach(function (trial) {
      if (trial.scoreState && SCORE_STATES.indexOf(trial.scoreState) === -1) {
        warnings.push({ key: 'unknownScoreState', params: { state: trial.scoreState } });
      }
    });

    var firstTrial = trials[0] || null;
    var benchmark = (firstTrial && firstTrial.benchmark) || null;
    var request = (firstTrial && firstTrial.request) || null;

    // Provider / model: config wins, else the first trial that recorded a request.
    var provider = (config && config.base_url) || (request && request.base_url) || '';
    var model = (config && config.model) || (request && request.model) || '';
    if (!config) {
      for (var i = 0; i < trials.length; i++) {
        if (trials[i].request) {
          if (!provider && trials[i].request.base_url) provider = trials[i].request.base_url;
          if (!model && trials[i].request.model) model = trials[i].request.model;
        }
        if (provider && model) break;
      }
    }

    var testModes = (config && Array.isArray(config.test_modes) && config.test_modes.length)
      ? config.test_modes.slice()
      : (benchmark && Array.isArray(benchmark.test_modes) ? benchmark.test_modes.slice() : []);

    var enhanced = config && config.enhanced_auto_test !== undefined
      ? config.enhanced_auto_test === true
      : null;

    if (enhanced === null) {
      // Infer: enhanced mode runs several trials per tier.
      var counts = {};
      trials.forEach(function (trial) { counts[trial.tier] = (counts[trial.tier] || 0) + 1; });
      var maxCount = 0;
      Object.keys(counts).forEach(function (key) { maxCount = Math.max(maxCount, counts[key]); });
      enhanced = maxCount > 1;
      if (trials.length) warnings.push({ key: 'configMissing', params: {} });
    }

    // Attach per-trial calibration results in place (report column "Recommended CPT").
    trials.forEach(function (trial) {
      var calibration = calibrationForTrial(trials, trial, enhanced);
      trial.recommendedCalibration = calibration;
      trial.recommendedCharsPerToken = calibration ? calibration.recommendedCharsPerToken : null;
    });

    var tiers = aggregate(trials);

    // Headline recommendation: last trial (scanning backwards) with a calibration.
    var recommendation = null;
    for (var index = trials.length - 1; index >= 0; index--) {
      var trialCalibration = trials[index].recommendedCalibration;
      if (trialCalibration) {
        recommendation = {
          charsPerToken: trialCalibration.recommendedCharsPerToken,
          samples: trialsForTier(trials, trials[index].tier).length,
          tier: trials[index].tier,
          sampleCount: trialCalibration.samples
        };
        break;
      }
    }

    var configuredTiers = (config && Array.isArray(config.tiers) && config.tiers.length)
      ? config.tiers.map(function (value) { return intOrNull(value) || 0; })
      : tiers.map(function (stat) { return stat.tier; });

    var totals = {
      trials: trials.length,
      tiers: tiers.length,
      passed: tiers.reduce(function (acc, stat) { return acc + stat.passed; }, 0),
      failed: tiers.reduce(function (acc, stat) { return acc + stat.failed; }, 0),
      contextLimits: tiers.reduce(function (acc, stat) { return acc + stat.contextLimits; }, 0),
      promptTotal: sum(tiers.map(function (stat) { return stat.promptTotal; })),
      completionTotal: sum(tiers.map(function (stat) { return stat.completionTotal; })),
      answerHits: trials.reduce(function (acc, trial) { return acc + trial.answerHits; }, 0),
      evidenceHits: trials.reduce(function (acc, trial) { return acc + trial.evidenceHits; }, 0),
      questions: trials.reduce(function (acc, trial) { return acc + trial.questionCount; }, 0),
      elapsedAverage: trials.length ? average(trials.map(function (trial) { return trial.elapsedSeconds; })) : 0
    };
    totals.totalTokens = totals.promptTotal + totals.completionTotal;
    totals.passRatePercent = totals.trials ? (totals.passed / totals.trials) * 100 : 0;
    totals.answerRatePercent = totals.questions ? (totals.answerHits / totals.questions) * 100 : 0;
    totals.evidenceRatePercent = totals.questions ? (totals.evidenceHits / totals.questions) * 100 : 0;

    var runFolder = input.runFolder
      || (firstTrial && parentName(firstTrial.corpus))
      || '';

    return {
      loadedAt: new Date().toISOString(),
      source: {
        fileName: input.fileName || '',
        configFileName: input.configFileName || '',
        label: input.sourceLabel || '',
        hasConfig: !!config,
        hasCheckpoint: !!checkpoint
      },
      checkpoint: checkpoint ? {
        version: intOrNull(checkpoint.version),
        complete: checkpoint.complete === true,
        configSignature: typeof checkpoint.config_signature === 'string' ? checkpoint.config_signature : '',
        phase: typeof checkpoint.phase === 'string' ? checkpoint.phase : '',
        tierIndex: intOrNull(checkpoint.tier_index),
        lastPassed: intOrNull(checkpoint.last_passed),
        binaryLow: intOrNull(checkpoint.binary_low),
        binaryHigh: intOrNull(checkpoint.binary_high),
        probeHigh: intOrNull(checkpoint.probe_high),
        probeCount: intOrNull(checkpoint.probe_count)
      } : null,
      config: config,
      meta: {
        runFolder: runFolder,
        provider: provider,
        model: model,
        apiMode: (config && config.api_mode) || (request && request.api_mode) || '',
        testModes: testModes,
        evidenceTolerance: config && config.evidence_tolerance !== undefined ? intOrNull(config.evidence_tolerance) : null,
        anchorCount: (config && intOrNull(config.anchor_count)) || (benchmark && intOrNull(benchmark.anchor_count)) || null,
        charsPerToken: (config && num(config.chars_per_token)) || (benchmark && num(benchmark.chars_per_token_estimate)) || null,
        outputLimit: (config && intOrNull(config.max_output_tokens)) || null,
        transportedRetries: config && intOrNull(config.transport_retries),
        timeoutSeconds: config && intOrNull(config.timeout_seconds),
        parallelTests: config ? config.parallel_tests === true : null,
        structuredOutput: config ? config.structured_output === true : null,
        autoCalibrate: config ? config.auto_calibrate === true : null,
        enhanced: enhanced === true,
        enhancedInferred: !config && trials.length > 0,
        configuredTiers: configuredTiers
      },
      trials: trials,
      tiers: tiers,
      totals: totals,
      recommendation: recommendation,
      warnings: warnings
    };
  }

  /* ------------------------------------------------------------------ *
   * Exports
   * ------------------------------------------------------------------ */

  /** Rebuilds RESULTS.md with the (corrected) column order. */
  function toMarkdown(model) {
    var lines = [];
    var meta = model.meta;

    lines.push('# Long-context benchmark result');
    lines.push('');
    if (meta.provider) lines.push('- Provider: `' + meta.provider + '`');
    if (meta.model) lines.push('- Model: `' + meta.model + '`');
    if (meta.runFolder) lines.push('- Run folder: `' + meta.runFolder + '`');
    if (meta.testModes.length) lines.push('- Test modes: `' + meta.testModes.join(',') + '`');
    if (meta.evidenceTolerance !== null) {
      lines.push('- Evidence tolerance: `' + meta.evidenceTolerance + '` (all answers must still be correct).');
    }
    lines.push('- Response metadata: preserved in `summary.json` and the checkpoint; message content is excluded.');
    lines.push('- API key is intentionally excluded from all saved files.');
    if (model.recommendation) {
      lines.push('- Recommended `chars_per_token` for the next run: `' + model.recommendation.charsPerToken.toFixed(4) +
        '` (median of ' + model.recommendation.samples + ' trial(s)).');
    }

    lines.push('');
    lines.push('## Tier summary');
    lines.push('');
    lines.push('| Tier | Status | Trials | Passed | Pass rate | Context limits | Failed | Input avg | Input median | Input range | Input total | Output avg | Output total | Total avg | Latency avg |');
    lines.push('|---:|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|');
    model.tiers.forEach(function (stat) {
      var inputAverage = DASH, inputMedian = DASH, inputRange = DASH;
      if (stat.promptSamples > 0) {
        inputAverage = formatKAverage(stat.promptAverage);
        inputMedian = formatK(stat.promptMedian);
        inputRange = formatK(stat.promptMin) + '\u2013' + formatK(stat.promptMax);
      }
      var inputTotal = stat.promptTotal > 0 ? formatK(stat.promptTotal) : DASH;
      var outputAverage = stat.completionSamples > 0 ? formatKAverage(stat.completionAverage) : DASH;
      var outputTotal = stat.completionTotal > 0 ? formatK(stat.completionTotal) : DASH;
      var totalAverage = stat.totalSamples > 0 ? formatKAverage(stat.totalAverage) : DASH;
      lines.push('| ' + stat.tier + ' | ' + stat.status + ' | ' + stat.trials + ' | ' + stat.passed + ' | ' +
        formatPercent(stat.passRatePercent) + ' | ' + stat.contextLimits + ' | ' + stat.failed + ' | ' +
        inputAverage + ' | ' + inputMedian + ' | ' + inputRange + ' | ' + inputTotal + ' | ' + outputAverage + ' | ' +
        outputTotal + ' | ' + totalAverage + ' | ' + formatSeconds(stat.elapsedAverage) + ' |');
    });

    lines.push('');
    lines.push('| Configured tier | Trial | CPT used | Actual input | Actual output | Actual total | Recommended CPT | Output limit | Result | Score |');
    lines.push('|---:|---|---:|---:|---:|---:|---:|---:|---|---|');
    model.trials.forEach(function (trial) {
      var actualInput = trial.promptTokens !== null ? formatK(trial.promptTokens) : DASH;
      var actualOutput = trial.completionTokens !== null ? formatK(trial.completionTokens) : DASH;
      var actualTotal = trial.totalTokens !== null ? formatK(trial.totalTokens) : DASH;
      var recommended = trial.recommendedCharsPerToken !== null ? trial.recommendedCharsPerToken.toFixed(4) : DASH;
      var outputLimit = trial.maxOutputTokensUsed > 0 ? String(trial.maxOutputTokensUsed) : DASH;
      var result = trial.contextTooLarge ? 'context limit' : trial.scoreState;
      var score = trial.answerHits + '/' + trial.questionCount + ' answers; ' +
        trial.evidenceHits + '/' + trial.questionCount + ' evidence';
      if (trial.repaired) score += '; repaired JSON';
      var cptUsed = trial.charsPerTokenUsed === null ? DASH : trial.charsPerTokenUsed.toFixed(4);
      lines.push('| ' + trial.tier + ' | ' + trial.label + ' | ' + cptUsed + ' | ' + actualInput + ' | ' +
        actualOutput + ' | ' + actualTotal + ' | ' + recommended + ' | ' + outputLimit + ' | ' + result + ' | ' + score + ' |');
    });

    lines.push('');
    lines.push('## Mode breakdown');
    lines.push('');
    lines.push('| Tier | Trial | Mode | Answers | Evidence | Missed |');
    lines.push('|---:|---|---|---:|---:|---|');
    model.trials.forEach(function (trial) {
      trial.modes.forEach(function (mode) {
        lines.push('| ' + trial.tier + ' | ' + trial.label + ' | ' + mode.mode + ' | ' +
          mode.answerHits + '/' + mode.questionCount + ' | ' + mode.evidenceHits + '/' + mode.questionCount + ' | ' +
          mode.missed.join(', ') + ' |');
      });
    });

    return lines.join('\n') + '\n';
  }

  function csvCell(value) {
    var text = value === null || value === undefined ? '' : String(value);
    if (/[",\n\r]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  function toCSV(model) {
    var header = ['tier', 'label', 'score_state', 'context_too_large', 'answer_hits', 'evidence_hits',
      'question_count', 'missed', 'prompt_tokens', 'completion_tokens', 'total_tokens',
      'chars_per_token_used', 'recommended_chars_per_token', 'max_output_tokens_used',
      'elapsed_seconds', 'http_status', 'attempts', 'output_retries', 'repaired_json'];
    var rows = [header.join(',')];
    model.trials.forEach(function (trial) {
      rows.push([
        trial.tier, trial.label, trial.scoreState, trial.contextTooLarge, trial.answerHits,
        trial.evidenceHits, trial.questionCount, trial.missed.join(' '), trial.promptTokens,
        trial.completionTokens, trial.totalTokens, trial.charsPerTokenUsed,
        trial.recommendedCharsPerToken, trial.maxOutputTokensUsed, trial.elapsedSeconds,
        trial.httpStatus, trial.attempts, trial.outputRetries, trial.repaired
      ].map(csvCell).join(','));
    });
    return rows.join('\n') + '\n';
  }

  var API = {
    HEADROOM_TOKENS: HEADROOM_TOKENS,
    DASH: DASH,
    parseText: parseText,
    classify: classify,
    analyze: analyze,
    aggregate: aggregate,
    normalizeTrial: normalizeTrial,
    calibrationForTrial: calibrationForTrial,
    calibrateFromTrials: calibrateFromTrials,
    tierStatus: tierStatus,
    toMarkdown: toMarkdown,
    toCSV: toCSV,
    format: {
      K: formatK,
      KAverage: formatKAverage,
      seconds: formatSeconds,
      percent: formatPercent,
      comma: commaInt,
      basename: basename,
      parentName: parentName,
      round4: round4,
      median: median
    }
  };

  global.CLReport = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
