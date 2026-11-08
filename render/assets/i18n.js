/*!
 * i18n.js — bilingual dictionary + formatters.
 * Two locales only: zh-CN and en. No network, no build step.
 */
(function (global) {
  'use strict';

  var DICT = {
    'zh-CN': {
      'app.title': 'Context-LLM · 基准测试查看器',
      'app.brand': 'Context-LLM',
      'app.subtitle': '基准测试查看器',
      'app.tagline': '在浏览器里打开 checkpoint.json，把长上下文基准测试结果读成一份可视化报告。',

      'nav.overview': '概览',
      'nav.tiers': '档位',
      'nav.trials': '试次',
      'nav.modes': '题型',
      'nav.raw': '原始数据',

      'action.pick': '打开 checkpoint.json',
      'action.replace': '更换文件',
      'action.sample': '载入示例数据',
      'action.exportMd': '导出 Markdown',
      'action.exportCsv': '导出 CSV',
      'action.print': '打印 / 存为 PDF',
      'action.copy': '复制',
      'action.copied': '已复制',
      'action.download': '下载',
      'action.expandAll': '全部展开',
      'action.collapseAll': '全部收起',
      'action.clearSaved': '清除本地缓存',
      'action.theme': '切换主题',
      'theme.auto': '跟随系统',
      'theme.light': '浅色',
      'theme.dark': '深色',
      'action.language': '切换语言',
      'action.github': '在 GitHub 上查看项目',
      'action.removeFile': '移除',

      'empty.title': '打开一份 checkpoint.json',
      'empty.desc': '文件只在你自己的浏览器里解析，不会上传到任何服务器。',
      'empty.drop': '把文件拖到这里',
      'empty.or': '或',
      'empty.pickOne': '选择文件',
      'empty.pickFolder': '选择运行目录',
      'empty.sample': '没有文件？看示例',
      'empty.formatsLabel': '支持的文件',
      'empty.formatsValue': 'checkpoint.json（推荐）、summary.json、run_config.public.json',
      'empty.multiTitle': '可以一起拖入',
      'empty.multiValue': '同时拖入 run_config.public.json 或整个 run_* 目录，服务商、题型、证据容差会自动补全。',
      'empty.localTitle': '完全离线',
      'empty.localValue': '不需要联网，不发起任何请求，适合在离线机器上查看测试结果。',
      'empty.privacyTitle': '不含密钥',
      'empty.privacyValue': 'checkpoint 与公开配置都不保存 API 密钥，可以放心分享。',
      'empty.eyebrow': '纯静态 · 本地解析 · 中英文',
      'empty.releaseToLoad': '松开即可载入',

      'meta.runFolder': '运行目录',
      'meta.provider': '服务商',
      'meta.model': '模型',
      'meta.apiMode': '接口模式',
      'meta.testModes': '题型',
      'meta.evidenceTolerance': '证据容差',
      'meta.anchorCount': '题目数',
      'meta.charsPerToken': '字符 / token',
      'meta.outputLimit': '最小输出预算',
      'meta.enhanced': '增强自动测试',
      'meta.parallel': '并行测试',
      'meta.structured': '结构化输出',
      'meta.autocalibrate': '自动校准',
      'meta.timeout': '请求超时（秒）',
      'meta.complete': '已完成',
      'meta.incomplete': '未完成',
      'meta.yes': '是',
      'meta.no': '否',
      'meta.unknown': '未知',
      'meta.noConfig': '只读取了 checkpoint，部分配置项取自其中的元数据。同时载入 run_config.public.json 可以补全。',
      'meta.recommendation': '下一次运行建议使用',
      'meta.recommendationNote': '由 {n} 次试次的中位数校准得出',
      'meta.sourceLabel': '数据来源',

      'kpi.trials': '试次',
      'kpi.trialsNote': '{passed} 通过 · {failed} 未通过',
      'kpi.passRate': '通过率',
      'kpi.tiers': '档位',
      'kpi.tiersNote': '共 {n} 个配置档位',
      'kpi.totalTokens': '总 token',
      'kpi.totalTokensNote': '输入 {input} · 输出 {output}',
      'kpi.latency': '平均耗时',
      'kpi.latencyNote': '单次请求平均',
      'kpi.evidence': '证据命中率',
      'kpi.evidenceNote': '答案 {answers} / {questions}',
      'kpi.contextLimits': '超限次数',
      'kpi.contextLimitsNote': '因上下文过长失败',

      'section.overview': '概览',
      'section.overviewDesc': '这次运行的关键指标，以及 checkpoint 记录的运行状态。',
      'section.status': '运行状态',
      'section.statusDesc': '来自 checkpoint.json 的断点续跑信息。',
      'status.version': '版本',
      'status.phase': '阶段',
      'status.tierIndex': '档位索引',
      'status.binary': '二分区间',
      'status.probe': '上限探测',
      'status.signature': '配置指纹',
      'status.none': '无',

      'section.tiers': '档位总览',
      'section.tiersDesc': '按测试档位汇总次数、通过率与 token 用量，等价于 RESULTS.md 的 Tier summary。',

      'tier.tier': '档位',
      'tier.status': '状态',
      'tier.trials': '次数',
      'tier.passed': '通过',
      'tier.passRate': '通过率',
      'tier.contextLimits': '超限',
      'tier.failed': '失败',
      'tier.inputAvg': '输入均值',
      'tier.inputMedian': '输入中位数',
      'tier.inputRange': '输入范围',
      'tier.inputTotal': '输入合计',
      'tier.outputAvg': '输出均值',
      'tier.outputTotal': '输出合计',
      'tier.totalAvg': '总量均值',
      'tier.latencyAvg': '平均耗时',

      'section.trials': '试次明细',
      'section.trialsDesc': '每一次请求的实际用量与评分；点开任意一行查看分题型成绩和响应元数据。',
      'trial.label': '试次',
      'trial.tier': '档位',
      'trial.cptUsed': '本次 CPT',
      'trial.actualInput': '实际输入',
      'trial.actualOutput': '实际输出',
      'trial.actualTotal': '实际总计',
      'trial.recommendedCpt': '建议 CPT',
      'trial.outputLimit': '输出上限',
      'trial.result': '结果',
      'trial.score': '得分',
      'trial.answers': '答案',
      'trial.evidence': '证据',
      'trial.elapsed': '耗时',
      'trial.detail': '详情',
      'trial.hideDetail': '收起',
      'trial.missed': '未命中',
      'trial.none': '无',
      'trial.httpStatus': 'HTTP 状态',
      'trial.attempts': '请求次数',
      'trial.outputRetries': '输出扩容次数',
      'trial.seed': '随机种子',
      'trial.corpus': '材料目录',
      'trial.responseFile': '响应文件',
      'trial.calibration': 'Token 校准',
      'trial.calibrationTarget': '目标输入',
      'trial.calibrationActual': '实际输入',
      'trial.repaired': '已修复 JSON',
      'trial.request': '请求参数',
      'trial.usage': '用量明细',
      'trial.reasoning': '推理 token',
      'trial.cached': '缓存命中 token',
      'trial.transportError': '传输错误',
      'trial.filesCleaned': '材料已清理',
      'trial.modeBreakdown': '分题型成绩',

      'section.modes': '题型分析',
      'section.modesDesc': '按题型拆分的答案与证据命中情况；颜色越深表示证据命中率越低。',
      'mode.mode': '题型',
      'mode.answers': '答案',
      'mode.evidence': '证据',
      'mode.missed': '未命中',
      'mode.name.needle': '精确检索',
      'mode.name.multi_hop': '多跳推理',
      'mode.name.conflict': '规则冲突',
      'mode.name.adversarial': '对抗干扰',
      'mode.name.abstention': '拒答',
      'mode.name.unknown': '未知题型',
      'mode.breakdownTitle': '题型明细',
      'legend.partial': '80–99%',
      'legend.low': '低于 50%',
      'mode.mean': '各试次平均',

      'chart.passRate': '各档位通过率',
      'chart.tokens': '每次试次的 token 用量',
      'chart.latency': '每次试次的耗时',
      'chart.input': '输入',
      'chart.output': '输出',
      'chart.total': '总计',
      'chart.passRateCaption': '柱长表示通过率，标注为通过次数 / 总次数。',
      'chart.tokensCaption': '下段为输入 token，上段为输出 token。',
      'chart.latencyCaption': '单位：秒。',

      'section.raw': '原始数据',
      'section.rawDesc': '当前载入的 JSON，可用于核对或排查。',
      'raw.checkpoint': 'checkpoint.json',
      'raw.config': 'run_config.public.json',
      'raw.notLoaded': '未载入',

      'status.passed': '通过',
      'status.partial': '部分通过',
      'status.context_limit': '超出上下文',
      'status.failed': '失败',
      'score.passed': '通过',
      'score.scored_failure': '评分未通过',
      'score.request_failed': '请求失败',
      'score.invalid_answer_json': '答案 JSON 无效',
      'score.context_too_large': '上下文过长',
      'score.unknown': '未知',

      'footer.builtFor': '用于可视化',
      'footer.project': '项目主页',
      'footer.offline': '纯静态页面 · 所有解析都在本地完成',
      'footer.license': 'The Unlicense',
      'footer.generated': '报告生成于',

      'toast.loaded': '已载入 {name}',
      'toast.sample': '已载入示例数据',
      'toast.restored': '已恢复上次载入的数据',
      'toast.cleared': '已清除本地缓存',
      'toast.exportedMd': '已导出 RESULTS.md',
      'toast.exportedCsv': '已导出 trials.csv',
      'toast.copyFailed': '复制失败，请手动选择文本',

      'error.title': '无法读取这个文件',
      'error.json': '不是合法的 JSON：{message}',
      'error.noTrials': '文件里没有找到 trials 数组，可能不是 checkpoint.json 或 summary.json。',
      'error.emptyTrials': 'checkpoint 里的 trials 还是空的，这次运行还没有产生任何结果。',
      'error.configOnly': '{name} 是一份运行配置，里面没有测试结果。请再打开 checkpoint.json。',
      'error.read': '读取文件失败：{message}',

      'banner.restored': '正在显示上次载入的数据（{name}）。',
      'badge.config': '已合并运行配置',
      'badge.noConfig': '仅 checkpoint',
      'badge.enhancedOn': '增强模式',
      'badge.enhancedOff': '普通模式'
    },

    'en': {
      'app.title': 'Context-LLM · Benchmark Viewer',
      'app.brand': 'Context-LLM',
      'app.subtitle': 'Benchmark Viewer',
      'app.tagline': 'Open a local checkpoint.json and read a long-context benchmark run as a visual report.',

      'nav.overview': 'Overview',
      'nav.tiers': 'Tiers',
      'nav.trials': 'Trials',
      'nav.modes': 'Modes',
      'nav.raw': 'Raw data',

      'action.pick': 'Open checkpoint.json',
      'action.replace': 'Load another file',
      'action.sample': 'Load sample run',
      'action.exportMd': 'Export Markdown',
      'action.exportCsv': 'Export CSV',
      'action.print': 'Print / Save as PDF',
      'action.copy': 'Copy',
      'action.copied': 'Copied',
      'action.download': 'Download',
      'action.expandAll': 'Expand all',
      'action.collapseAll': 'Collapse all',
      'action.clearSaved': 'Clear local cache',
      'action.theme': 'Toggle theme',
      'theme.auto': 'System',
      'theme.light': 'Light',
      'theme.dark': 'Dark',
      'action.language': 'Switch language',
      'action.github': 'View the project on GitHub',
      'action.removeFile': 'Remove',

      'empty.title': 'Open a checkpoint.json',
      'empty.desc': 'The file is parsed in your browser only — nothing is uploaded anywhere.',
      'empty.drop': 'Drop the file here',
      'empty.or': 'or',
      'empty.pickOne': 'Choose a file',
      'empty.pickFolder': 'Choose a run folder',
      'empty.sample': 'No file handy? Try the sample',
      'empty.formatsLabel': 'Accepted files',
      'empty.formatsValue': 'checkpoint.json (recommended), summary.json, run_config.public.json',
      'empty.multiTitle': 'Drop them together',
      'empty.multiValue': 'Add run_config.public.json or the whole run_* folder to fill in provider, test modes and evidence tolerance.',
      'empty.localTitle': 'Fully offline',
      'empty.localValue': 'No network access and no requests — handy for reviewing runs on an offline machine.',
      'empty.privacyTitle': 'No secrets',
      'empty.privacyValue': 'Neither the checkpoint nor the public config stores the API key, so both are safe to share.',
      'empty.eyebrow': 'Static · local parsing · bilingual',
      'empty.releaseToLoad': 'Release to load',

      'meta.runFolder': 'Run folder',
      'meta.provider': 'Provider',
      'meta.model': 'Model',
      'meta.apiMode': 'API mode',
      'meta.testModes': 'Test modes',
      'meta.evidenceTolerance': 'Evidence tolerance',
      'meta.anchorCount': 'Questions',
      'meta.charsPerToken': 'Chars per token',
      'meta.outputLimit': 'Min output budget',
      'meta.enhanced': 'Enhanced auto test',
      'meta.parallel': 'Parallel tests',
      'meta.structured': 'Structured output',
      'meta.autocalibrate': 'Auto calibrate',
      'meta.timeout': 'Request timeout (s)',
      'meta.complete': 'Complete',
      'meta.incomplete': 'Incomplete',
      'meta.yes': 'Yes',
      'meta.no': 'No',
      'meta.unknown': 'Unknown',
      'meta.noConfig': 'Only the checkpoint was read; a few settings come from its metadata. Load run_config.public.json alongside it to fill in the rest.',
      'meta.recommendation': 'For the next run, use',
      'meta.recommendationNote': 'median calibration over {n} trial(s)',
      'meta.sourceLabel': 'Source',

      'kpi.trials': 'Trials',
      'kpi.trialsNote': '{passed} passed · {failed} failed',
      'kpi.passRate': 'Pass rate',
      'kpi.tiers': 'Tiers',
      'kpi.tiersNote': '{n} configured tiers',
      'kpi.totalTokens': 'Total tokens',
      'kpi.totalTokensNote': '{input} in · {output} out',
      'kpi.latency': 'Avg latency',
      'kpi.latencyNote': 'per request',
      'kpi.evidence': 'Evidence accuracy',
      'kpi.evidenceNote': 'answers {answers} / {questions}',
      'kpi.contextLimits': 'Context limits',
      'kpi.contextLimitsNote': 'failed as context too large',

      'section.overview': 'Overview',
      'section.overviewDesc': 'Headline numbers from this run plus the resume state recorded in the checkpoint.',
      'section.status': 'Run state',
      'section.statusDesc': 'Resume bookkeeping stored in checkpoint.json.',
      'status.version': 'Version',
      'status.phase': 'Phase',
      'status.tierIndex': 'Tier index',
      'status.binary': 'Binary search range',
      'status.probe': 'Ceiling probe',
      'status.signature': 'Config signature',
      'status.none': 'none',

      'section.tiers': 'Tier summary',
      'section.tiersDesc': 'Trials, pass rate and token usage per configured tier — the Tier summary table of RESULTS.md.',

      'tier.tier': 'Tier',
      'tier.status': 'Status',
      'tier.trials': 'Trials',
      'tier.passed': 'Passed',
      'tier.passRate': 'Pass rate',
      'tier.contextLimits': 'Ctx limits',
      'tier.failed': 'Failed',
      'tier.inputAvg': 'Input avg',
      'tier.inputMedian': 'Input median',
      'tier.inputRange': 'Input range',
      'tier.inputTotal': 'Input total',
      'tier.outputAvg': 'Output avg',
      'tier.outputTotal': 'Output total',
      'tier.totalAvg': 'Total avg',
      'tier.latencyAvg': 'Latency avg',

      'section.trials': 'Trial detail',
      'section.trialsDesc': 'Actual usage and scoring for every request. Open a row for per-mode results and response metadata.',
      'trial.label': 'Trial',
      'trial.tier': 'Tier',
      'trial.cptUsed': 'CPT used',
      'trial.actualInput': 'Actual input',
      'trial.actualOutput': 'Actual output',
      'trial.actualTotal': 'Actual total',
      'trial.recommendedCpt': 'Recommended CPT',
      'trial.outputLimit': 'Output limit',
      'trial.result': 'Result',
      'trial.score': 'Score',
      'trial.answers': 'Answers',
      'trial.evidence': 'Evidence',
      'trial.elapsed': 'Latency',
      'trial.detail': 'Details',
      'trial.hideDetail': 'Hide',
      'trial.missed': 'Missed',
      'trial.none': 'none',
      'trial.httpStatus': 'HTTP status',
      'trial.attempts': 'Attempts',
      'trial.outputRetries': 'Output expansions',
      'trial.seed': 'Seed',
      'trial.corpus': 'Corpus folder',
      'trial.responseFile': 'Response file',
      'trial.calibration': 'Token calibration',
      'trial.calibrationTarget': 'Target input',
      'trial.calibrationActual': 'Actual input',
      'trial.repaired': 'Repaired JSON',
      'trial.request': 'Request',
      'trial.usage': 'Usage',
      'trial.reasoning': 'Reasoning tokens',
      'trial.cached': 'Cached tokens',
      'trial.transportError': 'Transport error',
      'trial.filesCleaned': 'Test files cleaned',
      'trial.modeBreakdown': 'Per-mode score',

      'section.modes': 'Mode analysis',
      'section.modesDesc': 'Answer and evidence hits split by question mode. Darker cells mean fewer evidence hits.',
      'mode.mode': 'Mode',
      'mode.answers': 'Answers',
      'mode.evidence': 'Evidence',
      'mode.missed': 'Missed',
      'mode.name.needle': 'Needle',
      'mode.name.multi_hop': 'Multi-hop',
      'mode.name.conflict': 'Conflict',
      'mode.name.adversarial': 'Adversarial',
      'mode.name.abstention': 'Abstention',
      'mode.name.unknown': 'Unknown mode',
      'mode.breakdownTitle': 'Mode breakdown',
      'legend.partial': '80–99%',
      'legend.low': 'under 50%',
      'mode.mean': 'Mean across trials',

      'chart.passRate': 'Pass rate by tier',
      'chart.tokens': 'Tokens per trial',
      'chart.latency': 'Latency per trial',
      'chart.input': 'Input',
      'chart.output': 'Output',
      'chart.total': 'Total',
      'chart.passRateCaption': 'Bar length is the pass rate; labels show passed / total.',
      'chart.tokensCaption': 'Lower segment is input tokens, upper segment is output tokens.',
      'chart.latencyCaption': 'Seconds per request.',

      'section.raw': 'Raw data',
      'section.rawDesc': 'The JSON currently loaded, for checking or debugging.',
      'raw.checkpoint': 'checkpoint.json',
      'raw.config': 'run_config.public.json',
      'raw.notLoaded': 'not loaded',

      'status.passed': 'passed',
      'status.partial': 'partial',
      'status.context_limit': 'context limit',
      'status.failed': 'failed',
      'score.passed': 'passed',
      'score.scored_failure': 'scored failure',
      'score.request_failed': 'request failed',
      'score.invalid_answer_json': 'invalid answer JSON',
      'score.context_too_large': 'context too large',
      'score.unknown': 'unknown',

      'footer.builtFor': 'Visualizer for',
      'footer.project': 'Project',
      'footer.offline': 'Static page · everything is parsed locally',
      'footer.license': 'The Unlicense',
      'footer.generated': 'Report generated',

      'toast.loaded': 'Loaded {name}',
      'toast.sample': 'Sample run loaded',
      'toast.restored': 'Restored the last loaded run',
      'toast.cleared': 'Local cache cleared',
      'toast.exportedMd': 'RESULTS.md downloaded',
      'toast.exportedCsv': 'trials.csv downloaded',
      'toast.copyFailed': 'Copy failed — select the text manually',

      'error.title': 'Could not read this file',
      'error.json': 'Not valid JSON: {message}',
      'error.noTrials': 'No trials array found — this does not look like a checkpoint.json or summary.json.',
      'error.emptyTrials': 'The checkpoint has no trials yet; this run has not produced any results.',
      'error.configOnly': '{name} is a run configuration and holds no results. Open checkpoint.json as well.',
      'error.read': 'Could not read the file: {message}',

      'banner.restored': 'Showing the last loaded run ({name}).',
      'badge.config': 'run config merged',
      'badge.noConfig': 'checkpoint only',
      'badge.enhancedOn': 'enhanced mode',
      'badge.enhancedOff': 'normal mode'
    }
  };

  var ALIASES = {
    'zh': 'zh-CN', 'zh-cn': 'zh-CN', 'zh-hans': 'zh-CN', 'zh-sg': 'zh-CN',
    'en': 'en', 'en-us': 'en', 'en-gb': 'en'
  };

  function detect(defaultLang) {
    try {
      var stored = global.localStorage && global.localStorage.getItem('cl-viewer-lang');
      if (stored && DICT[stored]) return stored;
    } catch (error) { /* private mode */ }
    var nav = (global.navigator && (global.navigator.language || global.navigator.userLanguage)) || '';
    var key = String(nav).toLowerCase();
    if (ALIASES[key]) return ALIASES[key];
    var base = key.split('-')[0];
    if (ALIASES[base]) return ALIASES[base];
    return defaultLang || 'en';
  }

  var current = detect('en');

  function t(key, params) {
    var table = DICT[current] || DICT.en;
    var text = table[key];
    if (text === undefined) text = DICT.en[key];
    if (text === undefined) return key;
    if (params) {
      text = text.replace(/\{(\w+)\}/g, function (match, name) {
        return params[name] !== undefined && params[name] !== null ? String(params[name]) : match;
      });
    }
    return text;
  }

  function setLang(lang) {
    if (!DICT[lang]) lang = 'en';
    current = lang;
    try {
      global.localStorage && global.localStorage.setItem('cl-viewer-lang', lang);
      if (global.document) global.document.documentElement.setAttribute('lang', lang);
    } catch (error) { /* ignore */ }
    return current;
  }

  function number(value, options) {
    try {
      return new Intl.NumberFormat(current === 'zh-CN' ? 'zh-CN' : 'en-US', options || {}).format(value);
    } catch (error) {
      return String(value);
    }
  }

  function integer(value) {
    return number(Math.trunc(value), { maximumFractionDigits: 0 });
  }

  function decimal(value, digits) {
    return number(value, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  var API = {
    DICT: DICT,
    t: t,
    setLang: setLang,
    getLang: function () { return current; },
    detect: detect,
    number: number,
    integer: integer,
    decimal: decimal,
    locales: ['zh-CN', 'en']
  };

  global.CLI18n = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
