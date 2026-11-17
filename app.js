/* Local results dashboard for the PV forecasting thesis.
   Data: window.DASH, written by Elaborato/scripts/build_dashboard.py (data.js).
   Charts: Plotly (vendor/plotly.min.js, offline). */
'use strict';
(function () {
  const D = window.DASH;
  const view = document.getElementById('view');
  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

  // ------------------------------------------------------------------ language of the interface
  // The language is fixed when the page loads (address ?lang=en|it, else the last choice, else English): the switch
  // reloads the page. Italian is the language of the source; LX('testo') and LXt`testo ${x}` return the English text
  // from i18n_en.js when the page is in English, and the Italian text itself when a translation is missing.
  const LANG = (() => {
    try {
      const u = new URLSearchParams(location.search).get('lang');
      if (u === 'en' || u === 'it') return u;
      const saved = JSON.parse(localStorage.getItem('fvdash.state') || '{}');
      return saved.lang === 'it' ? 'it' : 'en';
    } catch (e) { return 'en'; }
  })();
  const I18N = window.I18N_EN || { s: {}, t: {} };
  // spaces at the two ends of a text are kept as they are (many texts are joined to others)
  function LX(s) {
    if (LANG !== 'en' || typeof s !== 'string') return s;
    const core = s.trim(), v = I18N.s[core];
    return v == null ? s : s.replace(core, () => v);
  }
  function LXt(strings, ...vals) {
    const a = strings.slice(), last = a.length - 1;
    const lead = a[0].match(/^\s*/)[0]; a[0] = a[0].slice(lead.length);
    const trail = a[last].match(/\s*$/)[0]; a[last] = a[last].slice(0, a[last].length - trail.length);
    const tpl = LANG === 'en' ? I18N.t[a.join('\u0001')] : null;
    if (tpl == null) { let o = strings[0]; for (let i = 0; i < vals.length; i++) o += vals[i] + strings[i + 1]; return o; }
    return lead + tpl.replace(/\{(\d+)\}/g, (m, i) => vals[+i]) + trail;
  }
  // labels that come from the data file (model names, season names)
  if (LANG === 'en' && window.DASH) {
    const DD = window.DASH, seasonEN = l => String(l).replace(/Autunno|Inverno|Primavera|Estate/g, w => ({ Autunno: 'Autumn', Inverno: 'Winter', Primavera: 'Spring', Estate: 'Summer' })[w]);
    for (const r of (DD.regression || {}).runs || []) for (const m of r.metrics || []) m.label = LX(m.label);
    for (const a of (DD.regression || {}).architectures || []) if (a.label) a.label = LX(a.label);
    for (const fam of [DD.abruzzo, DD.exogenous, DD.endo_gd, DD.exo_joined, DD.endo_joined]) for (const s of (fam || {}).seasons || []) if (s.label) s.label = seasonEN(s.label);
    for (const e of DD.lstmvis || []) if (e.season_label) e.season_label = seasonEN(e.season_label);
  }

  // ------------------------------------------------------------------ DOM helpers
  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k === 'html') e.innerHTML = v;            // static strings written in this file only
        else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      e.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return e;
  }
  function emptyBox(...lines) { return h('div', { class: 'empty' }, lines.map(l => h('div', null, l))); }

  if (!D || typeof Plotly === 'undefined') {
    view.append(emptyBox(!D ? LX('Dati non trovati (data.js).') : LX('Libreria grafici non trovata (vendor/plotly.min.js).'),
      'Fai doppio clic su aggiorna_dashboard.bat in questa cartella, poi ricarica la pagina.'));
    return;
  }

  // ------------------------------------------------------------------ state & storage
  const store = {
    get(k, d) { try { const v = localStorage.getItem('fvdash.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('fvdash.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  const REG = D.regression, ABR = D.abruzzo, EXO = D.exogenous;
  const P_NOM = ABR.p_nom, P_MAX = EXO.p_max, P_NOM_GD = EXO.p_nom;
  // season facts (days, rows, mean power) used by the day-weighted means and by the normalised MAE
  const GD_SHEET = Object.fromEntries(EXO.seasons.map(s => [s.key, s]));
  const ABR_SINFO = Object.fromEntries(ABR.seasons.map(s => [s.key, s]));
  for (const c of ABR.configs) for (const [k, e] of Object.entries(c.seasons)) e._key = k;
  const ABR_SEASONS = ABR.seasons, EXO_SEASONS = EXO.seasons;
  const abrPref = ABR.configs.find(c => c.preferred) || ABR.configs[0];
  const exoPref = EXO.configs.find(c => c.preferred) || EXO.configs[0];
  // Generation_data families: exogenous / endogenous, single seasons / joined years (1 + 2 -> 3)
  const EMPTY_FAM = { configs: [], seasons: [], pending: [] };
  const ENDO = D.endo_gd || EMPTY_FAM, EXOJ = D.exo_joined || EMPTY_FAM, ENDOJ = D.endo_joined || EMPTY_FAM;
  const GD = { exo: EXO, endo: ENDO, exoJ: EXOJ, endoJ: ENDOJ };
  const GD_TAG = { exo: 'ESO', endo: 'END', exoJ: LX('ESO anni'), endoJ: LX('END anni'),
    exoS: LX('ESO stato agg.'), endoS: LX('END stato agg.'), exoJS: LX('ESO anni stato agg.'), endoJS: LX('END anni stato agg.') };
  function gdFam(base, mode) { return mode === 'joined' ? base + 'J' : base; }
  // a season entry as seen with the chosen test samples (joined nets: whole year 3, or the same samples as the single-season nets)
  function gdView(s, samples) {
    if (!s) return null;
    if (s.m20 && (samples || S.gdSamples) === 'last20') return { metrics: s.m20, pers: s.p20, shift1: s.s20, n_test: s.n_last20, _sheet: s._sheet };
    return s;
  }
  // value over several sheets: mean weighted by the days of each season; the nMAE is the weighted MAE divided by the
  // mean power of all those sheets together (e.g. the whole year 3, or the whole dataset)
  function gdAgg(keys, entryOf, m, ofPers) {
    const items = keys.map(k => ({ k, s: entryOf(k) })).filter(o => o.s);
    if (!items.length) return null;
    const w = o => (GD_SHEET[o.k] || {}).days;
    if (m === 'nmae') {
      const mae = wmean(items.map(o => [exoSeasonVal(o.s, 'mae', ofPers), w(o)]));
      const p = pooledMean(items.map(o => GD_SHEET[o.k]), 'p_mean', 'n');
      return mae == null || !p ? null : 100 * mae / p;
    }
    return wmean(items.map(o => [exoSeasonVal(o.s, m, ofPers), w(o)]));
  }
  function gdVal(F, c, m, season, ofPers, samples) {
    if (season !== 'mean') { const s = gdView(c.seasons[season], samples); return s ? exoSeasonVal(s, m, ofPers) : null; }
    return gdAgg(F.seasons.map(s => s.key), k => gdView(c.seasons[k], samples), m, ofPers);
  }
  function gdAll() {
    return ['exo', 'endo', 'exoJ', 'endoJ'].flatMap(fk => GD[fk].configs.map(cf => Object.assign({}, cf, { id: fk + ':' + cf.id, label: GD_TAG[fk] + ' ' + cf.id })));
  }
  // Generation_data test series are stored compactly (first sheet row + predictions): rebuild them on first use
  const GDP = D.gd_power || {};
  function lazySeries(F) {
    for (const cf of F.configs) for (const [sheet, e] of Object.entries(cf.seasons)) {
      e._sheet = e.sheet || sheet;
      const c0 = e.series;
      if (!c0 || !('i0' in c0)) continue;
      let cache = null;
      Object.defineProperty(e, 'series', { configurable: true, enumerable: true, get() {
        if (!cache) {
          const p = GDP[e.sheet || sheet], n = c0.pred.length, tl = cf.tl;
          const idx = new Array(n), real = new Array(n), pers = new Array(n), shift1 = new Array(n);
          for (let j = 0; j < n; j++) { const i = c0.i0 + j; idx[j] = i; real[j] = p[i - 1]; pers[j] = p[i - 1 - tl]; shift1[j] = p[i - 2]; }
          cache = { idx, real, pred: c0.pred, pers, shift1 };
        }
        return cache;
      } });
    }
  }
  for (const F of [EXO, ENDO, EXOJ, ENDOJ]) lazySeries(F);

  // Networks with the LSTM state carried on in the test ("_stato_aggiornato" scripts, TL = 1 step).
  // D.stato[family].nets[i].methods['1'|'2'].seasons[key]: errors of the new forecast (m), of the original network (o)
  // and of the persistence (p) on the same rows, error per epoch (ep, best epoch) and the forecast series.
  // Hidden for now (user request, 2026-11-13: methods 1 and 2 to be reviewed before showing them again).
  // true = the "Stato aggiornato" pages and the M1/M2 explorer groups come back; the data are still in data.js.
  const SHOW_STATO = false;
  const ST = SHOW_STATO ? (D.stato || {}) : {};
  function stFam(fk) { return ST[fk] || { nets: [], scripts: [] }; }
  // for the explorer: one pseudo-configuration per network and method, with the same series as the original ones
  const ST_GD = {};
  for (const fk of ['exo', 'endo', 'exoJ', 'endoJ']) {
    const configs = [];
    for (const n of stFam(fk).nets) for (const k of Object.keys(n.methods).sort()) {
      const seasons = {};
      for (const [key, e] of Object.entries(n.methods[k].seasons)) seasons[key] = { sheet: e.sheet || key, series: e.series };
      configs.push({ id: `${n.id} · M${k}`, th: n.th, tl: n.tl, cells: n.cells, preferred: false, seasons });
    }
    ST_GD[fk + 'S'] = { configs };
    lazySeries(ST_GD[fk + 'S']);
  }
  const ST_ABR = [];
  for (const n of stFam('abr').nets) for (const k of Object.keys(n.methods).sort()) {
    const orig = ABR.configs.find(x => x.id === n.id), seasons = {};
    for (const [key, e] of Object.entries(n.methods[k].seasons)) {
      const o = orig && orig.seasons[key] && orig.seasons[key].series;
      if (o && o.real.length === e.series.pred.length) seasons[key] = { series: Object.assign({}, o, { pred: e.series.pred }) };
    }
    ST_ABR.push({ id: `${n.id} · M${k}`, label: LXt`${n.id} · stato agg. M${k}`, th: n.th, tl: n.tl, cells: n.cells, preferred: false, seasons });
  }
  // Abruzzo: the classic persistence (value TL hours before) is used as a reference only up to this horizon
  const ABR_PERS_MAX_TL = 3;

  const DEFAULTS = {
    theme: 'auto', lang: 'en',
    stReg: 'linear', stAbrSeason: 'Primavera2021', stGdType: 'exo', stGdTl: 1, stGdSeason: 'Estate_3', stCurve: '', stCurveSeason: '',
    ovMetric: 'nmae_prod', ovBaseline: false,
    regRun: REG.used_run, regModel: 'single_neuron', regBins: 'bias',
    abrMetric: 'mae', abrSeason: 'mean', abrConfig: abrPref.id, abrDetSeason: 'Primavera2021',
    abrPers: true, abrYest: false,
    exoMetric: 'mae', exoConfig: exoPref.id, exoSeason: 'Estate_3', exoAxis: 'samples', exoPers: true,
    expModel: ABR.configs.some(c => ABR_SEASONS.some(s => c.seasons[s.key].csv)) ? 'abr' : 'exo',
    gdMetric: 'mae', gdSamples: 'last20', gdAxis: 'samples', gdPers: true, gdCells: 64,
    stBase: 'exo', stMode: 'sep', stMetric_gd: 'mae', stMetric_abr: 'mae', stMb: false,
    cmpMode: 'sep', cmpMetric: 'mae', cmpCells: 64, cmpSeason: 'mean',
    expSeasonAbr: 'Primavera2021', expSeasonExo: 'Estate_3', expCfgsAbr: [abrPref.id], expCfgsExo: ['exo:' + exoPref.id],
    expSlotsAbr: {}, expSlotsExo: {}, expPers: true, expYest: false, expErr: true, expUnit: 'samples',
    archGroup: 'abr', arch_reg: 'mlp', arch_abr: abrPref.id, arch_exo: exoPref.id,
  };
  const S = Object.assign({}, DEFAULTS, store.get('state', {}));
  const urlTheme = new URLSearchParams(location.search).get('theme');   // ?theme=light|dark (e.g. for screenshots)
  if (['auto', 'light', 'dark'].includes(urlTheme)) S.theme = urlTheme;
  S.lang = LANG;
  // drop saved values that no longer exist in the data
  if (!ABR.configs.some(c => c.id === S.abrConfig)) S.abrConfig = DEFAULTS.abrConfig;
  if (!ABR_SEASONS.some(s => s.key === S.abrDetSeason)) S.abrDetSeason = ABR_SEASONS[0].key;
  if (!EXO.configs.some(c => c.id === S.exoConfig)) S.exoConfig = DEFAULTS.exoConfig;
  if (!EXO_SEASONS.some(s => s.key === S.exoSeason)) S.exoSeason = EXO_SEASONS[0].key;
  if (!ABR_SEASONS.some(s => s.key === S.expSeasonAbr)) S.expSeasonAbr = DEFAULTS.expSeasonAbr;
  if (!EXO_SEASONS.some(s => s.key === S.expSeasonExo)) S.expSeasonExo = DEFAULTS.expSeasonExo;
  for (const k of ['expCfgsAbr', 'expCfgsExo']) if (!Array.isArray(S[k])) S[k] = DEFAULTS[k].slice();
  for (const k of ['expSlotsAbr', 'expSlotsExo']) if (!S[k] || typeof S[k] !== 'object' || Array.isArray(S[k])) S[k] = {};
  // explorer ids of Generation_data are now "<family>:<config>"
  S.expCfgsExo = S.expCfgsExo.map(id => String(id).includes(':') ? id : 'exo:' + id);
  if (Object.keys(S.expSlotsExo).some(k => !k.includes(':'))) S.expSlotsExo = {};
  function save() { store.set('state', S); }
  function set(k, v) { S[k] = v; save(); render(true); }

  // ------------------------------------------------------------------ language (Overview texts: overview_texts.js)
  const OVT = window.OV_TEXTS || { en: {}, it: {} };
  let FACTS = {};
  function tx(key, vars) {
    let t = (OVT[LANG] || {})[key];
    if (t == null) t = (OVT.en || {})[key];
    if (t == null) return key;
    return t.replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars ? vars[k] : (k in FACTS ? FACTS[k] : m)));
  }
  // paragraphs of a text (blank line = new paragraph, **word** = bold)
  function prose(key, vars) {
    return tx(key, vars).split(/\n\s*\n/).map(par => {
      const p = h('p', null);
      par.split(/(\*\*[^*]+\*\*)/).forEach(seg => p.append(/^\*\*.*\*\*$/.test(seg) ? h('b', null, seg.slice(2, -2)) : seg));
      return p;
    });
  }
  function seasonL(key) { return seasonLabel(key); }

  // ------------------------------------------------------------------ theme & colours
  const themeBtn = document.getElementById('theme-btn');
  const darkMq = window.matchMedia('(prefers-color-scheme: dark)');
  function isDark() { return S.theme === 'dark' || (S.theme === 'auto' && darkMq.matches); }
  function applyTheme() {
    const r = document.documentElement;
    if (S.theme === 'auto') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', S.theme);
    themeBtn.textContent = tx('theme_' + S.theme);
  }
  themeBtn.addEventListener('click', () => {
    S.theme = ({ auto: 'light', light: 'dark', dark: 'auto' })[S.theme]; save(); applyTheme(); render(true);
  });
  darkMq.addEventListener('change', () => { if (S.theme === 'auto') render(true); });

  function cssv(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function C() {
    const dark = isDark();
    return {
      dark, surface: cssv('--surface-1'), surface2: cssv('--surface-2'), text1: cssv('--text-primary'),
      text2: cssv('--text-secondary'), muted: cssv('--text-muted'), grid: cssv('--grid'), axis: cssv('--axis'),
      s1: cssv('--series-1'), s2: cssv('--series-2'), s3: cssv('--series-3'), s4: cssv('--series-4'),
      neutral: cssv('--neutral'), good: cssv('--good'), bad: cssv('--bad'),
      seq: dark ? ['#0d366b', '#104281', '#184f95', '#256abf', '#2a78d6', '#3987e5', '#6da7ec', '#9ec5f4']
                : ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'],
      div: dark ? ['#e66767', '#8f4644', '#383835', '#1c5cab', '#3987e5']
                : ['#d03b3b', '#ef9b98', '#f0efec', '#86b6ef', '#2a78d6'],
      ord: dark ? ['#184f95', '#1c5cab', '#256abf', '#2a78d6', '#3987e5', '#5598e7', '#86b6ef', '#b7d3f6']
                : ['#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#104281'],
    };
  }
  const ROLE = { measured: 's1', model: 's2', pers: 's3', yest: 's4' };
  const REG_COLOR = { baseline: 'neutral', linear: 's1', single_neuron: 's2', mlp: 's3' };
  function exoColor(c, id) { const i = EXO.configs.findIndex(x => x.id === id); return c[['s1', 's2', 's3'][i]] || c.neutral; }

  // ------------------------------------------------------------------ number formatting
  const NF = {};
  function nf(d) { const k = LANG + d; return NF[k] || (NF[k] = new Intl.NumberFormat(LANG === 'en' ? 'en-US' : 'it-IT', { minimumFractionDigits: d, maximumFractionDigits: d })); }
  function fmt(v, d = 2) { return v == null || !isFinite(v) ? '—' : nf(d).format(Math.abs(v) < 0.5 * Math.pow(10, -d) ? 0 : v); }
  function fmtS(v, d = 1) { return v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : '') + nf(d).format(v); }
  function signed(v, d = 1, suffix = ' %') {
    if (v == null || !isFinite(v)) return h('span', { class: 'muted' }, '—');
    return h('span', { class: v >= 0 ? 'pos' : 'neg' }, fmtS(v, d) + suffix);
  }
  function mean(a) { const v = a.filter(x => x != null && isFinite(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; }
  // weighted mean of [value, weight] pairs (weights = days of each season); pairs without a value are skipped
  function wmean(pairs) {
    let s = 0, w = 0;
    for (const [v, k] of pairs) { if (v == null || !isFinite(v) || !(k > 0)) continue; s += v * k; w += k; }
    return w ? s / w : null;
  }
  // mean power of several sheets taken together (each sheet's mean weighted by its number of samples)
  function pooledMean(infos, key, nKey) {
    let s = 0, n = 0;
    for (const x of infos) { if (!x || x[key] == null || !x[nKey]) continue; s += x[key] * x[nKey]; n += x[nKey]; }
    return n ? s / n : null;
  }

  // ------------------------------------------------------------------ controls & layout pieces
  function selectCtl(label, options, value, onchange) {
    const sel = h('select', { onchange: e => onchange(e.target.value) });
    for (const o of options) {
      const opt = h('option', { value: o.value }, o.label);
      if (String(o.value) === String(value)) opt.selected = true;
      sel.append(opt);
    }
    return h('label', { class: 'ctl' }, h('span', null, label), sel);
  }
  function checkCtl(label, checked, onchange) {
    const i = h('input', { type: 'checkbox' }); i.checked = !!checked;
    i.addEventListener('change', e => onchange(e.target.checked));
    return h('label', { class: 'check' }, i, label);
  }
  function segCtl(label, options, value, onchange) {
    const g = h('div', { class: 'seg', role: 'group', 'aria-label': label });
    for (const o of options) g.append(h('button', { type: 'button', 'aria-pressed': String(o.value === value), onclick: () => onchange(o.value) }, o.label));
    return h('div', { class: 'ctl' }, h('span', null, label), g);
  }
  function filters(...kids) { return h('div', { class: 'filters sticky' }, kids); }
  function card(title, desc, body, tools) {
    return h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', null, h('h3', null, title), desc ? h('p', { class: 'desc' }, desc) : null),
        tools ? h('div', { class: 'card-tools' }, tools) : null),
      body);
  }
  function tile(label, who, value, unit, facts, hl) {
    return h('div', { class: 'tile' + (hl ? ' hl' : '') }, h('div', { class: 'label' }, label), who ? h('div', { class: 'who' }, who) : null,
      h('div', { class: 'value' }, value, unit ? h('small', null, unit) : null),
      facts && facts.length ? h('div', { class: 'facts' }, facts) : null);
  }
  function fact(label, value) { return h('span', null, label + ' ', h('b', null, value)); }
  function chartDiv(cls) { return h('div', { class: 'chart' + (cls ? ' ' + cls : '') }); }
  // section heading; `lead` is one short sentence saying what the section answers
  function sectionTitle(t, id, lead) {
    const e = h('div', { class: 'section', id: id || null }, h('h2', { class: 'section-title' }, t), lead ? h('p', { class: 'section-lead' }, lead) : null);
    return e;
  }
  function viewHead(kicker, title, ...paras) {
    return h('div', { class: 'view-head' }, kicker ? h('p', { class: 'kicker' }, kicker) : null, h('h2', null, title), paras.filter(Boolean).map(p => h('p', null, p)));
  }
  function callout(text, info) { return h('div', { class: 'callout' + (info ? ' info' : '') }, h('span', { class: 'icon', 'aria-hidden': 'true' }, info ? 'i' : '!'), h('div', null, text)); }
  function tableToggle(label, tbl) { return h('details', { class: 'table-toggle' }, h('summary', null, label), tbl); }
  // a card whose body opens on demand (long tables)
  // `body` can be a function: it is then built the first time the card is opened
  function foldCard(title, desc, body) {
    const inner = h('div', { class: 'fold-body' }, typeof body === 'function' ? null : body);
    const d = h('details', { class: 'card fold' }, h('summary', null, h('span', { class: 'fold-title' }, title), desc ? h('span', { class: 'desc' }, desc) : null), inner);
    if (typeof body === 'function') d.addEventListener('toggle', () => { if (d.open && !inner.childNodes.length) inner.append(body()); });
    return d;
  }
  // button that looks like a link (used inside tables to open a configuration)
  function linkBtn(text, onclick, title) { return h('button', { type: 'button', class: 'link-btn', title: title || null, onclick }, text); }
  // element of `list` with the lowest (or highest) value of fn; ignores missing values
  function bestOf(list, fn, higher) {
    let best = null, bv = null;
    for (const x of list) { const v = fn(x); if (v == null || !isFinite(v)) continue; if (best == null || (higher ? v > bv : v < bv)) { best = x; bv = v; } }
    return best;
  }
  function bullets(items) { return h('ul', { class: 'bullets' }, items.filter(Boolean).map(t => h('li', null, t))); }

  function table(cols, rows, opts = {}) {
    let sortKey = opts.sortKey || null, dir = opts.dir || 1;
    const wrap = h('div', { class: 'table-wrap' + (opts.scroll ? ' scroll' : '') });
    function build() {
      wrap.textContent = '';
      const tr = h('tr');
      for (const c of cols) {
        const th = h('th', { class: (c.num ? 'num ' : '') + 'sortable', scope: 'col', title: c.title || null }, c.label);
        if (sortKey === c.key) th.append(h('span', { class: 'arrow' }, dir > 0 ? '▲' : '▼'));
        th.addEventListener('click', () => { if (sortKey === c.key) dir = -dir; else { sortKey = c.key; dir = 1; } build(); });
        tr.append(th);
      }
      let rs = rows.slice();
      if (sortKey) {
        const c = cols.find(x => x.key === sortKey);
        const get = c.sort || (r => r[sortKey]);
        rs.sort((a, b) => {
          const x = get(a), y = get(b);
          if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
          return (x < y ? -1 : x > y ? 1 : 0) * dir;
        });
      }
      const tb = h('tbody');
      for (const r of rs) {
        const row = h('tr', { class: r._hl ? 'hl' : null });
        for (const c of cols) {
          const v = c.render ? c.render(r) : c.fmt ? c.fmt(r[c.key]) : r[c.key];
          row.append(h('td', { class: c.num ? 'num' : null }, v == null ? '—' : v));
        }
        tb.append(row);
      }
      wrap.append(h('table', null, h('thead', null, tr), tb));
    }
    build();
    return wrap;
  }

  // ------------------------------------------------------------------ Plotly helpers
  const plotted = [];
  function merge(a, b) {
    for (const k of Object.keys(b || {})) {
      const v = b[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])) a[k] = merge(Object.assign({}, a[k]), v);
      else a[k] = v;
    }
    return a;
  }
  function axis(c) {
    return { gridcolor: c.grid, linecolor: c.axis, showline: true, zeroline: false, ticks: '', automargin: true,
      tickfont: { color: c.muted, size: 11 }, title: { font: { color: c.text2, size: 12 }, standoff: 10 } };
  }
  function L(over) {
    const c = C();
    return merge({
      paper_bgcolor: c.surface, plot_bgcolor: c.surface, separators: LANG === 'en' ? '.,' : ',.',
      font: { family: FONT, size: 12, color: c.text2 },
      margin: { l: 60, r: 16, t: 36, b: 48 }, xaxis: axis(c), yaxis: axis(c),
      legend: { orientation: 'h', x: 0, xanchor: 'left', y: 1.01, yanchor: 'bottom', font: { color: c.text2, size: 12 }, bgcolor: 'rgba(0,0,0,0)' },
      hoverlabel: { bgcolor: c.surface, bordercolor: c.axis, font: { color: c.text1, family: FONT, size: 12 } },
      hovermode: 'closest', barcornerradius: 4, bargap: 0.35, bargroupgap: 0.12,
    }, over || {});
  }
  function plot(div, traces, layout, name) {
    Plotly.newPlot(div, traces, L(layout), {
      displaylogo: false, responsive: true, displayModeBar: 'hover',
      // fully local: no "share to cloud" button and no upload destination
      plotlyServerURL: '', showSendToCloud: false, showEditInChartStudio: false,
      modeBarButtonsToRemove: ['sendChartToCloud', 'sendDataToCloud', 'lasso2d', 'select2d', 'autoScale2d', 'toggleSpikelines',
        'hoverClosestCartesian', 'hoverCompareCartesian'],
      toImageButtonOptions: { format: 'png', scale: 2, filename: name || 'grafico' },
    });
    plotted.push(div);
  }
  function purgeAll() { while (plotted.length) { const d = plotted.pop(); try { Plotly.purge(d); } catch (e) { /* ignore */ } } }
  function lineT(x, y, name, color, extra) {
    return Object.assign({ type: 'scatter', mode: 'lines', x, y, name, line: { color, width: 2 } }, extra || {});
  }
  function vline(x, color, text, side) {
    return { shape: { type: 'line', x0: x, x1: x, yref: 'paper', y0: 0, y1: 1, line: { color, width: 1 } },
      ann: { x, yref: 'paper', y: 1, yanchor: 'bottom', xanchor: side === 'left' ? 'right' : 'left', xshift: side === 'left' ? -4 : 4,
        text, showarrow: false, font: { size: 11, color } } };
  }
  function hexToRgb(hx) { const n = parseInt(hx.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function lum(hx) {
    const [r, g, b] = hexToRgb(hx).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function scaleColor(stops, t) {
    t = Math.max(0, Math.min(1, t));
    const p = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(p)), f = p - i;
    const a = hexToRgb(stops[i]), b = hexToRgb(stops[i + 1]);
    return '#' + a.map((v, k) => Math.round(v + (b[k] - v) * f).toString(16).padStart(2, '0')).join('');
  }
  function toScale(stops) { return stops.map((s, i) => [i / (stops.length - 1), s]); }


  // skill score [%] = 1 - sum (y - yhat)^2 / sum (y - y_ref)^2. Model and reference are on the same test samples,
  // so the ratio of the sums equals (RMSE model / RMSE reference)^2.
  function skillScore(rmse, rmseRef) { return rmse == null || !rmseRef ? null : 100 * (1 - (rmse / rmseRef) * (rmse / rmseRef)); }

  // ------------------------------------------------------------------ data access: Abruzzo
  const ABR_METRICS = [
    { value: 'mae', label: 'MAE [kWh]', unit: 'kWh', d: 2, kind: 'seq' },
    { value: 'mape', label: LX('MAPE diurno [%]'), unit: '%', d: 1, kind: 'seq' },
    { value: 'nmae', label: LX('nMAE sulla potenza media, tutte le ore [%]'), unit: '%', d: 1, kind: 'seq' },
    { value: 'nmae_prod', label: LX('nMAE sulla potenza media, ore di produzione [%]'), unit: '%', d: 1, kind: 'seq' },
    { value: 'skill_pers', label: LX('Miglioramento vs persistenza (solo TL ≤ 3 h) [%]'), unit: '%', d: 1, kind: 'div' },
    { value: 'skill_yest', label: LX('Miglioramento vs stessa ora di ieri [%]'), unit: '%', d: 1, kind: 'div' },
    { value: 'ss_yest', label: LX('Skill score vs stessa ora di ieri [%]'), unit: '%', d: 1, kind: 'div' },
  ];
  function abrMae(s) { return s.csv ? s.csv.mae : s.file ? s.file.mae : null; }
  function abrRmse(s) { return s.csv ? s.csv.rmse : s.file && s.file.rmse != null ? s.file.rmse : null; }
  function abrMape(s) { return s.csv ? s.csv.mape_day : s.file ? s.file.mape_day : null; }
  function abrSeasonVal(s, m, tl) {
    if (m === 'mape') return abrMape(s);
    if (m === 'ss_yest') return skillScore(abrRmse(s), s.base.yest.rmse);
    const mae = abrMae(s); if (mae == null) return null;
    const si = ABR_SINFO[s._key] || {};
    switch (m) {
      case 'mae': return mae;
      case 'nmae': return 100 * mae / si.p_mean;
      case 'nmae_prod': return 100 * mae / si.p_mean_prod;
      case 'skill_pers': return tl > ABR_PERS_MAX_TL ? null : 100 * (1 - mae / s.base.pers.mae);
      case 'skill_yest': return 100 * (1 - mae / s.base.yest.mae);
    }
    return null;
  }
  function abrBaseVal(s, which, m) {
    const b = s.base[which];
    switch (m) {
      case 'mae': return b.mae; case 'mape': return b.mape_day;
      case 'nmae': return 100 * b.mae / (ABR_SINFO[s._key] || {}).p_mean;
      case 'nmae_prod': return 100 * b.mae / (ABR_SINFO[s._key] || {}).p_mean_prod;
    }
    return null;
  }
  // mean of the 4 seasons, weighted by their days; the nMAE is the weighted MAE divided by the mean power of the
  // 4 season sheets together (all hours, or production hours only)
  function abrVal(c, m, season) {
    if (season !== 'mean') return abrSeasonVal(c.seasons[season], m, c.tl);
    const days = s => (ABR_SINFO[s.key] || {}).days;
    if (m === 'nmae' || m === 'nmae_prod') {
      const v = ABR_SEASONS.map(s => abrMae(c.seasons[s.key]));
      if (v.some(x => x == null)) return null;
      const p = m === 'nmae' ? pooledMean(ABR.seasons, 'p_mean', 'n_valid') : pooledMean(ABR.seasons, 'p_mean_prod', 'n_prod');
      return 100 * wmean(ABR_SEASONS.map((s, i) => [v[i], days(s)])) / p;
    }
    const v = ABR_SEASONS.map(s => abrSeasonVal(c.seasons[s.key], m, c.tl));
    return v.some(x => x == null) ? null : wmean(ABR_SEASONS.map((s, i) => [v[i], days(s)]));
  }
  function abrHasData(c) { return ABR_SEASONS.every(s => abrMae(c.seasons[s.key]) != null); }
  function abrHasCsv(c) { return ABR_SEASONS.some(s => c.seasons[s.key].csv); }
  function abrConfig(id) { return ABR.configs.find(c => c.id === id) || abrPref; }
  function abrMetricDef(v) { return ABR_METRICS.find(m => m.value === v) || ABR_METRICS[0]; }
  function seasonLabel(key) {
    const l = (ABR_SEASONS.find(s => s.key === key) || EXO_SEASONS.find(s => s.key === key) || { label: String(key).replace(/_/g, ' ') }).label;
    return LANG === 'en' ? l.replace(/Autunno|Inverno|Primavera|Estate/g, w => ({ Autunno: 'Autumn', Inverno: 'Winter', Primavera: 'Spring', Estate: 'Summer' })[w]) : l;
  }

  // ------------------------------------------------------------------ data access: exogenous
  const EXO_METRICS = [
    { value: 'mae', label: 'MAE [kW]', unit: 'kW', d: 2 },
    { value: 'mape', label: LX('MAPE diurno [%]'), unit: '%', d: 1 },
    { value: 'wmape', label: LX('wMAPE diurno [%]'), unit: '%', d: 1 },
    { value: 'nmae', label: LX('nMAE sulla potenza media [%]'), unit: '%', d: 1 },
    { value: 'ss', label: LX('Skill score vs persistenza [%]'), unit: '%', d: 1 },
    { value: 'skill', label: LX('Miglioramento del MAE vs persistenza [%]'), unit: '%', d: 1 },
    { value: 'r2', label: 'R²', unit: '', d: 3 },
  ];
  function exoSeasonVal(s, m, ofPers) {
    const x = ofPers ? s.pers : s.metrics;
    switch (m) {
      case 'mae': return x.mae; case 'mape': return x.mape_day; case 'wmape': return x.wmape_day;
      case 'nmae': { const p = (GD_SHEET[s._sheet] || {}).p_mean; return p ? 100 * x.mae / p : null; }
      case 'skill': return ofPers ? null : 100 * (1 - s.metrics.mae / s.pers.mae);
      case 'ss': return ofPers ? null : skillScore(s.metrics.rmse, s.pers.rmse);
      case 'r2': return x.r2;
    }
    return null;
  }
  // metrics measured against persistence (higher = better, no persistence value of their own)
  function isSk(m) { return m === 'skill' || m === 'ss'; }
  function exoVal(c, m, season, ofPers) { return gdVal(EXO, c, m, season, ofPers); }
  function exoConfig(id) { return EXO.configs.find(c => c.id === id) || exoPref; }
  function exoMetricDef(v) { return EXO_METRICS.find(m => m.value === v) || EXO_METRICS[0]; }
  function exoDesc(c) { return LXt`TH ${c.th} passi (${c.th * EXO.step_min} min) · TL ${c.tl} ${c.tl === 1 ? LX('passo') : LX('passi')} (${c.tl * EXO.step_min} min) · ${c.cells} celle`; }

  // ------------------------------------------------------------------ shared analyses
  function lagCurve(real, pred, kmin, kmax) {
    const ks = [], m = [];
    for (let k = kmin; k <= kmax; k++) {
      let s = 0, n = 0;
      for (let i = 0; i < pred.length; i++) {
        const j = i - k;
        if (j < 0 || j >= real.length || pred[i] == null || real[j] == null) continue;
        s += Math.abs(pred[i] - real[j]); n++;
      }
      ks.push(k); m.push(n ? s / n : null);
    }
    return { ks, m };
  }
  function lagChart(div, real, pred, tl, unitLabel, stepLabel) {
    const c = C();
    const kmin = -6, kmax = tl + 8;
    const { ks, m } = lagCurve(real, pred, kmin, kmax);
    let best = 0; m.forEach((v, i) => { if (v != null && (m[best] == null || v < m[best])) best = i; });
    const a = vline(0, c.text2, LX('k = 0: in fase'), 'left'), b = vline(tl, c.text2, LXt`k = TL = ${tl}: come la persistenza`, 'right');
    plot(div, [lineT(ks, m, LX('MAE previsione vs misura spostata'), c[ROLE.model],
      { mode: 'lines+markers', marker: { size: 8, color: c[ROLE.model], line: { color: c.surface, width: 2 } },
        hovertemplate: `k = %{x} ${stepLabel}<br><b>%{y:.2f} ${unitLabel}</b><extra></extra>` })],
    { showlegend: false, margin: { t: 30 },
      xaxis: { title: { text: LXt`Spostamento k della misura [${stepLabel}]` }, dtick: tl > 12 ? 4 : 1 },
      yaxis: { title: { text: `MAE [${unitLabel}]` }, rangemode: 'tozero' },
      shapes: [a.shape, b.shape], annotations: [a.ann, b.ann] }, 'analisi_ritardo');
    return ks[best];
  }

  // ================================================================== VIEW: hidden states, LSTMVis style
  // The scripts export, for the last season they process, the LSTM output h (one vector per test sample, at the last step
  // of the window) to FV_<season>.hdf5. build_dashboard.py turns each export into states/<key>.js (int8 = 127·h),
  // loaded here only when the network is opened. As in LSTMVis: select an interval, the units that stay above a threshold
  // during it are highlighted, and the rest of the test is searched for the moments when the same units are on together.
  const VIS = D.lstmvis || [];
  const VIS_FAM = { abr: LX('LSTM endogena'), exo: LX('LSTM esogena'), endo: LX('LSTM endogena') };
  const visCache = {};
  function loadStates(e) {
    if (visCache[e.key]) return visCache[e.key];
    return (visCache[e.key] = new Promise((resolve, reject) => {
      const done = () => {
        const r = window.LSTMVIS_STATES && window.LSTMVIS_STATES[e.key];
        if (!r) { delete visCache[e.key]; reject(new Error(LX('dati non trovati in ') + e.file)); return; }
        if (!r.H) {
          const bin = atob(r.h), H = new Int8Array(bin.length);
          for (let i = 0; i < bin.length; i++) H[i] = bin.charCodeAt(i);      // bytes > 127 wrap to negative values
          r.H = H; r.h = null;
          const mr = mean(r.real), U = r.u, N = r.n;                            // correlation of each unit with the measured power
          let vr = 0; for (let t = 0; t < N; t++) vr += (r.real[t] - mr) ** 2;
          r.corr = [];
          for (let u = 0; u < U; u++) {
            let m = 0; for (let t = 0; t < N; t++) m += H[t * U + u]; m /= N;
            let cov = 0, vu = 0;
            for (let t = 0; t < N; t++) { const d = H[t * U + u] - m; cov += d * (r.real[t] - mr); vu += d * d; }
            r.corr.push(vu && vr ? cov / Math.sqrt(vu * vr) : null);
          }
        }
        resolve(r);
      };
      if (window.LSTMVIS_STATES && window.LSTMVIS_STATES[e.key]) { done(); return; }
      const s = document.createElement('script');
      s.src = e.file + '?v=' + encodeURIComponent(D.build.time);
      s.onload = done;
      s.onerror = () => { delete visCache[e.key]; reject(new Error(LX('impossibile caricare ') + e.file)); };
      document.head.append(s);
    }));
  }
  function visLabel(e) { return LXt`${VIS_FAM[e.fam]} · ${e.config} · ${e.season_label} · ${e.units} unità`; }

  function viewLstmvis(ds) {
    const c = C();
    const list = VIS.filter(e => ds === 'abr' ? e.fam === 'abr' : e.fam !== 'abr');
    const isAbr = ds === 'abr';
    view.append(viewHead(isAbr ? DS_ABR : DS_GD, LX('Stati interni (LSTMVis)'),
      LX('Che cosa "vedono" le unità nascoste della rete durante il test, con il metodo di LSTMVis: scegli un intervallo in cui succede qualcosa (per esempio la salita del mattino), la pagina evidenzia le unità che restano accese per tutto l\'intervallo e cerca nel resto del test i momenti in cui le stesse unità si accendono insieme.')));
    if (!list.length) { view.append(emptyBox(LX('Nessuno stato interno esportato per questo dataset.'))); return; }
    const kK = 'visKey_' + ds;
    const pref = isAbr ? list.find(e => e.config === abrPref.id) : list.find(e => e.fam === 'exo' && e.config === exoPref.id);
    const e = list.find(x => x.key === S[kK]) || pref || list[0];
    const thr = Number(S.visThr) || 0.3, sign = S.visSign === 'neg' ? -1 : 1, frac = Number(S.visMatch) || 1;
    const thrIn = h('input', { type: 'range', min: '0.05', max: '0.8', step: '0.05', value: String(thr), 'aria-label': LX('Soglia di attivazione') });
    const thrOut = h('b', null, fmt(thr, 2));
    thrIn.addEventListener('input', () => { thrOut.textContent = fmt(Number(thrIn.value), 2); });
    thrIn.addEventListener('change', () => set('visThr', Number(thrIn.value)));
    view.append(filters(
      selectCtl(LX('Rete'), list.map(x => ({ value: x.key, label: visLabel(x) })), e.key, v => set(kK, v)),
      h('label', { class: 'ctl' }, h('span', null, LX('Soglia di attivazione '), thrOut), thrIn),
      segCtl(LX('Unità accese quando'), [{ value: 'pos', label: LX('h ≥ soglia') }, { value: 'neg', label: LX('h ≤ −soglia') }], sign > 0 ? 'pos' : 'neg', v => set('visSign', v)),
      selectCtl(LX('Corrispondenza'), [{ value: 1, label: LX('tutte le unità selezionate accese') }, { value: 0.8, label: LX('almeno l\'80 %') }, { value: 0.6, label: LX('almeno il 60 %') }], frac, v => set('visMatch', Number(v))),
      segCtl(LX('Stati'), [{ value: 'lines', label: LX('Linee') }, { value: 'heat', label: LX('Mappa di calore') }], S.visView === 'heat' ? 'heat' : 'lines', v => set('visView', v)),
      checkCtl(LX('Spente subito prima e dopo'), S.visPad, v => set('visPad', v)),
    ));
    const host = h('div', null, emptyBox(LX('Caricamento degli stati…')));
    view.append(host);
    loadStates(e).then(r => { if (document.body.contains(host)) drawLstmvis(host, e, r, { thr, sign, frac }); })
      .catch(err => { host.textContent = ''; host.append(emptyBox(LX('Non è stato possibile caricare gli stati di questa rete.'), err.message)); });
  }

  function drawLstmvis(host, e, r, o) {
    const c = C(), N = r.n, U = r.u, H = r.H, isAbr = e.fam === 'abr';
    const lim = Math.round(o.thr * 127);
    const on = (t, u) => o.sign * H[t * U + u] >= lim;
    const selK = 'visSel_' + e.key;
    let sel = Array.isArray(S[selK]) ? S[selK].map(Number) : null;
    if (!sel || !(sel[0] >= 0 && sel[1] < N && sel[0] <= sel[1])) {
      // default: the interval (3 h in the Abruzzo, 1 h on Generation data) with the most units on all the time
      const w = isAbr ? 3 : 12;
      let best = -1, k0 = 0;
      for (let t = 0; t + w <= N; t++) {
        let n = 0;
        for (let u = 0; u < U; u++) { let ok = true; for (let j = t; j < t + w && ok; j++) ok = on(j, u); if (ok) n++; }
        if (n > best) { best = n; k0 = t; }
      }
      sel = [k0, Math.min(N - 1, k0 + w - 1)];
    }
    const [a, b] = sel;
    const units = [];
    for (let u = 0; u < U; u++) {
      let ok = true;
      for (let t = a; t <= b && ok; t++) ok = on(t, u);
      if (ok && S.visPad) ok = (a === 0 || !on(a - 1, u)) && (b === N - 1 || !on(b + 1, u));
      if (ok) units.push(u);
    }
    const need = Math.max(1, Math.ceil(o.frac * units.length - 1e-9));
    const cnt = new Array(N).fill(0);
    if (units.length) for (let t = 0; t < N; t++) { let k = 0; for (const u of units) if (on(t, u)) k++; cnt[t] = k; }
    const runs = [];
    if (units.length) for (let t = 0; t < N;) {
      if (cnt[t] < need) { t++; continue; }
      let s = t; while (t < N && cnt[t] >= need) t++;
      const pr = r.real.slice(s, t);
      runs.push({ s, e: t - 1, len: t - s, p: mean(pr), self: s <= b && t - 1 >= a });
    }
    const step = isAbr ? 60 : EXO.step_min;                                    // minutes per test sample
    const xl = i => isAbr ? r.x[i] : LXt`riga ${r.x[i]}`;
    const durTxt = n => { const m = n * step; return m >= 60 ? `${fmt(m / 60, m % 60 ? 1 : 0)} h` : `${m} min`; };
    host.textContent = '';

    // --- in short
    const others = runs.filter(x => !x.self);
    host.append(h('div', { class: 'grid three' },
      tile(LX('Rete'), `${VIS_FAM[e.fam]} · ${e.season_label}`, e.config, null, [fact(LX('unità nascoste'), fmt(U, 0)), fact(LX('campioni di test'), fmt(N, 0))]),
      tile(LX('Intervallo selezionato'), `${xl(a)} → ${xl(b)}`, fmt(b - a + 1, 0), LX('campioni'), [fact('durata', durTxt(b - a + 1)), fact(LX('potenza media misurata'), fmt(mean(r.real.slice(a, b + 1)), 1) + (isAbr ? ' kWh' : ' kW'))]),
      tile(LX('Unità selezionate'), LXt`accese (${o.sign > 0 ? 'h ≥ ' : 'h ≤ −'}${fmt(o.thr, 2)}) per tutto l'intervallo`, fmt(units.length, 0), `su ${U}`,
        [fact(LX('altre corrispondenze'), fmt(others.length, 0)), fact(LX('tempo in corrispondenza'), fmt(100 * cnt.filter(k => units.length && k >= need).length / N, 1) + ' %')], units.length > 0),
    ));
    if (!units.length) host.append(callout(LX('Nessuna unità resta accesa per tutto l\'intervallo: abbassa la soglia, accorcia l\'intervallo o cambia il segno.'), true));

    // --- selection by numbers (also for touch screens)
    const inA = h('input', { type: 'number', min: '1', max: String(N), value: String(a + 1) }), inB = h('input', { type: 'number', min: '1', max: String(N), value: String(b + 1) });
    const apply = () => { const p = Math.max(1, Math.min(N, Number(inA.value) || 1)) - 1, q = Math.max(1, Math.min(N, Number(inB.value) || 1)) - 1; set(selK, [Math.min(p, q), Math.max(p, q)]); };
    inA.addEventListener('change', apply); inB.addEventListener('change', apply);
    const fig = chartDiv(''); fig.style.height = (window.innerWidth < 700 ? 620 : 700) + 'px';
    host.append(card(LX('Potenza, stati nascosti e corrispondenze'),
      LX('Trascina orizzontalmente su uno dei tre grafici per scegliere un intervallo (fascia scura). Le fasce chiare nel grafico in alto sono le corrispondenze: i momenti in cui le unità selezionate sono accese insieme. Al centro gli stati: in grigio tutte le unità, in verde quelle selezionate; in basso la quota di unità selezionate accese in ogni campione.'),
      fig, h('div', { class: 'inline-ctl', style: 'gap:12px;align-items:flex-end;flex-wrap:wrap' },
        h('label', { class: 'ctl' }, h('span', null, LX('Da campione')), inA), h('label', { class: 'ctl' }, h('span', null, LX('a campione')), inB),
        h('button', { type: 'button', class: 'link-btn', onclick: () => { delete S[selK]; save(); render(true); } }, LX('Torna all\'esempio')))));

    const X = r.x;
    // half a sample on each side, so that a band of one sample is visible (dates: ± 30 minutes)
    const p2 = n => String(n).padStart(2, '0');
    const dshift = (sx, m) => { const d = new Date(new Date(sx.replace(' ', 'T')).getTime() + m * 60e3); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`; };
    const x0 = s => isAbr ? dshift(X[s], -30) : X[s] - 0.5, x1 = t => isAbr ? dshift(X[t], 30) : X[t] + 0.5;
    const band = (s, t, col, op) => ({ type: 'rect', xref: 'x', yref: 'paper', y0: 0.66, y1: 1, layer: 'below', line: { width: 0 }, fillcolor: col, opacity: op, x0: x0(s), x1: x1(t) });
    const shapes = runs.filter(x => !x.self).slice(0, 400).map(x => band(x.s, x.e, c.s4, 0.22));
    shapes.push(band(a, b, c.text1, 0.28));
    shapes.push({ type: 'rect', xref: 'x', yref: 'paper', y0: 0, y1: 0.62, layer: 'below', line: { width: 0 }, fillcolor: c.text1, opacity: 0.1,
      x0: x0(a), x1: x1(b) });
    const unit = isAbr ? 'kWh' : 'kW';
    const tr = [
      lineT(X, r.real, LX('Misurata'), c[ROLE.measured], { xaxis: 'x', yaxis: 'y', hovertemplate: LXt`<b>%{y:.1f} ${unit}</b> misurata<extra></extra>` }),
      lineT(X, r.pred, LX('Prevista'), c[ROLE.model], { xaxis: 'x', yaxis: 'y', line: { color: c[ROLE.model], width: 1.5 }, hovertemplate: LXt`<b>%{y:.1f} ${unit}</b> prevista<extra></extra>` }),
    ];
    const inSel = new Set(units);
    const order = [...Array(U).keys()].sort((p, q) => (r.corr[q] ?? -2) - (r.corr[p] ?? -2));
    if (S.visView === 'heat') {
      const z = order.map(u => { const row = new Array(N); for (let t = 0; t < N; t++) row[t] = H[t * U + u] / 127; return row; });
      tr.push({ type: 'heatmap', x: X, y: order.map(u => (inSel.has(u) ? '● ' : '') + 'u' + u), z, xaxis: 'x', yaxis: 'y2', zmin: -1, zmax: 1,
        colorscale: toScale(c.div), showscale: false, hovertemplate: '%{y}<br>h = %{z:.2f}<extra></extra>' });
    } else {
      const gx = [], gy = [];
      for (let u = 0; u < U; u++) { if (inSel.has(u)) continue; for (let t = 0; t < N; t++) { gx.push(X[t]); gy.push(H[t * U + u] / 127); } gx.push(null); gy.push(null); }
      tr.push({ type: 'scattergl', mode: 'lines', x: gx, y: gy, xaxis: 'x', yaxis: 'y2', name: LX('Altre unità'), line: { color: c.neutral, width: 1 }, opacity: 0.35, hoverinfo: 'skip' });
      const shown = units.slice(0, 40);
      for (const u of shown) {
        const y = new Array(N); for (let t = 0; t < N; t++) y[t] = H[t * U + u] / 127;
        tr.push({ type: 'scattergl', mode: 'lines', x: X, y, xaxis: 'x', yaxis: 'y2', name: 'u' + u, showlegend: false, line: { color: c.s3, width: 1.4 },
          hovertemplate: LXt`unità ${u}: <b>%{y:.2f}</b><extra></extra>` });
      }
      tr.push(lineT([X[0], X[N - 1]], [o.sign * o.thr, o.sign * o.thr], LX('Soglia'), c.text2, { xaxis: 'x', yaxis: 'y2', line: { color: c.text2, width: 1, dash: 'dot' }, hoverinfo: 'skip', showlegend: false }));
    }
    tr.push({ type: 'bar', x: X, y: cnt.map(k => units.length ? 100 * k / units.length : 0), xaxis: 'x', yaxis: 'y3', name: LX('Unità selezionate accese'),
      marker: { color: cnt.map(k => units.length && k >= need ? c.s4 : c.neutral) }, showlegend: false, hovertemplate: LX('<b>%{y:.0f} %</b> delle unità selezionate accese<extra></extra>') });
    const ax = extra => Object.assign(axis(c), extra);
    plot(fig, tr, {
      dragmode: 'select', selectdirection: 'h', hovermode: 'x', bargap: 0, margin: { l: 64, r: 16, t: 36, b: 48 }, shapes,
      xaxis: ax({ anchor: 'y3', type: isAbr ? 'date' : 'linear', title: { text: isAbr ? LX('Data e ora') : LX('Riga del foglio (passo di circa 5 minuti)') } }),
      yaxis: ax({ domain: [0.68, 1], title: { text: LXt`Potenza [${unit}]` }, rangemode: 'tozero' }),
      yaxis2: ax({ domain: [0.2, 0.64], title: { text: S.visView === 'heat' ? LX('Unità (per correlazione)') : LX('Stato h') }, range: S.visView === 'heat' ? undefined : [-1, 1],
        showticklabels: S.visView !== 'heat' || U <= 40, tickfont: { size: 9 } }),
      yaxis3: ax({ domain: [0, 0.15], title: { text: LX('% accese') }, range: [0, 100], tickvals: [0, 50, 100] }),
    }, 'lstmvis_' + e.key);
    fig.on('plotly_selected', ev => {
      const rg = ev && ev.range && (ev.range.x || Object.values(ev.range)[0]);
      if (!rg) return;
      let lo = rg[0], hi = rg[1];
      if (isAbr) { lo = String(lo).slice(0, 16); hi = String(hi).slice(0, 16); }
      let p = -1, q = -1;
      for (let t = 0; t < N; t++) { if (X[t] >= lo && X[t] <= hi) { if (p < 0) p = t; q = t; } }
      if (p < 0) return;
      set(selK, [p, q]);
    });

    // --- tables
    const urows = units.map(u => {
      let s = 0; for (let t = a; t <= b; t++) s += H[t * U + u]; let k = 0; for (let t = 0; t < N; t++) if (on(t, u)) k++;
      return { u, m: s / (b - a + 1) / 127, corr: r.corr[u], onp: 100 * k / N };
    });
    const g = h('div', { class: 'grid two' }); host.append(g);
    g.append(card(LXt`Unità selezionate (${units.length})`, LX('Media di h nell\'intervallo, quota del test in cui l\'unità è accesa e correlazione con la potenza misurata su tutto il test.'),
      units.length ? table([{ key: 'u', label: LX('Unità (da 0)'), num: true }, { key: 'm', label: LX('h medio nell\'intervallo'), num: true, fmt: v => fmtS(v, 2) },
        { key: 'onp', label: LX('Accesa nel test [%]'), num: true, fmt: v => fmt(v, 1) }, { key: 'corr', label: LX('Correlazione con la potenza'), num: true, fmt: v => fmtS(v, 2) }], urows, { sortKey: 'onp' })
        : emptyBox(LX('Nessuna unità selezionata.'))));
    const mrows = runs.map(x => ({ s: xl(x.s), e2: xl(x.e), len: x.len, dur: durTxt(x.len), p: x.p, self: x.self ? LX('sì') : '', _hl: x.self }))
      .sort((p, q) => q.len - p.len).slice(0, 60);
    g.append(card(LXt`Corrispondenze (${runs.length})`, LX('Tratti di test in cui le unità selezionate sono accese insieme; le più lunghe in alto. Se cadono tutte su momenti simili (per esempio ogni salita del mattino), quelle unità probabilmente rappresentano quel comportamento.'),
      runs.length ? table([{ key: 's', label: LX('Inizio') }, { key: 'e2', label: LX('Fine') }, { key: 'len', label: LX('Campioni'), num: true }, { key: 'dur', label: LX('Durata') },
        { key: 'p', label: LXt`Potenza media [${unit}]`, num: true, fmt: v => fmt(v, 1) }, { key: 'self', label: LX('Selezione') }], mrows, { sortKey: null, scroll: true })
        : emptyBox(LX('Nessuna corrispondenza.'))));
    host.append(h('p', { class: 'note' }, LXt`Stato h = uscita dello strato LSTM all'ultimo passo della finestra di ogni campione di test (${e.season_label}, ultima stagione elaborata dallo script: le altre stagioni non sono state esportate). Valori salvati con una precisione di 1/127. File: ${e.source}; serie: ${e.csv}.`));
  }

  // ------------------------------------------------------------------ header & tabs
  // One tab per dataset; each dataset has its own pages (sub-tabs). Address: #<tab>/<page>?<parameters>
  const TABS = [
    { id: 'panoramica', label: LX('Panoramica'), tk: 'nav_overview', render: viewStory },
    { id: 'gd', label: 'Generation data', tk: 'nav_gd', subs: [
      { id: 'confronto', label: LX('Confronto tra i modelli'), render: viewGDCompare },
      { id: 'esogena', label: LX('LSTM esogena'), render: () => viewGD('exo') },
      { id: 'endogena', label: LX('LSTM endogena'), render: () => viewGD('endo') },
      { id: 'stato', label: LX('Stato aggiornato'), render: () => viewStato('gd') },
      { id: 'esplora', label: LX('Esplora il test'), render: () => viewExplorer('exo') },
      { id: 'lstmvis', label: LX('Stati interni (LSTMVis)'), render: () => viewLstmvis('gd') },
      { id: 'architetture', label: LX('Architetture'), render: () => viewArchitectures('gd') },
      { id: 'grafici', label: LX('Grafici originali'), render: () => viewGallery('gd') },
    ] },
    { id: 'abruzzo', label: LX('Monomega Abruzzo'), tk: 'nav_abr', subs: [
      { id: 'confronto', label: LX('Confronto tra le configurazioni'), render: viewAbruzzo },
      { id: 'dettaglio', label: LX('Dettaglio di una configurazione'), render: viewAbruzzoDetail },
      { id: 'stato', label: LX('Stato aggiornato'), render: () => viewStato('abr') },
      { id: 'esplora', label: LX('Esplora il test'), render: () => viewExplorer('abr') },
      { id: 'lstmvis', label: LX('Stati interni (LSTMVis)'), render: () => viewLstmvis('abr') },
      { id: 'architetture', label: LX('Architetture'), render: () => viewArchitectures('abr') },
      { id: 'grafici', label: LX('Grafici originali'), render: () => viewGallery('abr') },
    ] },
    { id: 'risultati', label: LX('Tutti i risultati'), tk: 'nav_all', render: viewOverview },
    { id: 'note', label: LX('Definizioni e note'), tk: 'nav_notes', render: viewNotes },
    { id: 'tesi', label: LX('Tesi'), tk: 'nav_thesis', render: viewThesis },
  ];
  // English names of the detail pages (their content is still in Italian)
  const SUB_EN = { 'gd/confronto': 'Model comparison', 'abruzzo/confronto': 'Configuration comparison', regressione: 'Regression',
    esogena: 'Exogenous LSTM', endogena: 'Endogenous LSTM', esplora: 'Test explorer', lstmvis: 'Internal states (LSTMVis)',
    architetture: 'Architecture', grafici: 'Original plots', dettaglio: 'One configuration in detail', stato: 'State carried on' };
  function tabLabel(t) { return tx(t.tk); }
  function subLabel(t, s) { return LANG === 'en' ? (SUB_EN[t.id + '/' + s.id] || SUB_EN[s.id] || s.label) : s.label; }
  if (!SHOW_STATO) for (const t of TABS) if (t.subs) t.subs = t.subs.filter(s => s.id !== 'stato');
  // addresses used before the dashboard was organised by dataset
  const OLD_HASH = { regressione: 'gd/confronto', esogena: 'gd/esogena', 'endogena-gd': 'gd/endogena', confronto: 'gd/confronto',
    endogena: 'abruzzo/confronto', grafici: 'gd/grafici' };
  function route() {
    const parts = location.hash.slice(1).split('?');
    let path = parts[0];
    const q = new URLSearchParams(parts[1] || '');
    if (OLD_HASH[path]) path = OLD_HASH[path];
    else if (path === 'esplora') path = S.expModel === 'abr' ? 'abruzzo/esplora' : 'gd/esplora';
    else if (path === 'architetture') path = (q.get('parte') === 'abr' ? 'abruzzo' : 'gd') + '/architetture';
    const [tid, sid] = path.split('/');
    const tab = TABS.find(t => t.id === tid) || TABS[0];
    const sub = tab.subs ? (tab.subs.find(s => s.id === sid) || tab.subs.find(s => s.id === S['sub_' + tab.id]) || tab.subs[0]) : null;
    return { tab, sub, q, path: tab.id + (sub ? '/' + sub.id : '') };
  }
  function tabPath(t) { return t.subs ? t.id + '/' + ((t.subs.find(s => s.id === S['sub_' + t.id]) || t.subs[0]).id) : t.id; }
  function go(path) { if (location.hash === '#' + path) render(false); else location.hash = path; }
  const tabsEl = document.getElementById('tabs'), subEl = document.getElementById('subtabs'), subBar = document.getElementById('subbar');
  for (const t of TABS) tabsEl.append(h('button', { class: 'tab', type: 'button', 'data-id': t.id, onclick: () => go(tabPath(t)) }, tabLabel(t)));
  // header texts, language switch and optional LinkedIn link
  const langBtn = document.getElementById('lang-btn'), liLink = document.getElementById('li-link');
  function applyLang() {
    document.documentElement.lang = S.lang;
    document.title = tx('site_title');
    document.getElementById('site-title').textContent = tx('brand_name');
    document.getElementById('build-info').textContent = tx('brand_sub');
    for (const b of tabsEl.children) b.textContent = tabLabel(TABS.find(t => t.id === b.dataset.id));
    if (langBtn) { langBtn.textContent = S.lang === 'en' ? 'Italiano' : 'English'; langBtn.setAttribute('aria-label', S.lang === 'en' ? 'Passa all’italiano' : 'Switch to English'); }
    if (liLink) { liLink.hidden = !OVT.linkedin; if (OVT.linkedin) liLink.href = OVT.linkedin; }
    themeBtn.textContent = tx('theme_' + S.theme);
  }
  if (langBtn) langBtn.addEventListener('click', () => {
    S.lang = S.lang === 'en' ? 'it' : 'en'; save();
    const u = new URL(location.href); u.searchParams.delete('lang');      // the saved choice decides after the reload
    location.replace(u.toString()); if (u.toString() === location.href) location.reload();
  });
  applyLang();
  if (!D.public && D.build.material_uncommitted > 0) {
    const chip = document.getElementById('material-chip');
    chip.hidden = false;
    chip.textContent = `${D.build.material_uncommitted} file del materiale non ancora nel commit`;
  }
  // deep links, e.g. #gd/architetture?parte=reg&rete=mlp
  function applyHashParams(r) {
    if (r.sub && r.sub.id === 'architetture' && r.q.get('parte')) {
      const part = r.q.get('parte');
      if (part !== 'abr') S.archGroup = part;
      if (r.q.get(LX('rete'))) S['arch_' + part] = r.q.get(LX('rete'));
    }
  }
  function syncTopbar() { document.documentElement.style.setProperty('--topbar-h', document.querySelector('.topbar').offsetHeight + 'px'); }
  function revealActive(bar, el) {     // keep the selected tab visible when the bar scrolls sideways (phones)
    if (!el) return;
    if (bar.scrollWidth > bar.clientWidth) bar.scrollLeft = el.offsetLeft - (bar.clientWidth - el.offsetWidth) / 2;
  }

  let lastTab = null;
  function render(keepScroll) {
    const r = route();
    if (!keepScroll) {
      applyHashParams(r);
      const want = '#' + r.path + (r.q.toString() ? '?' + r.q.toString() : '');
      if (location.hash !== want && history.replaceState) history.replaceState(null, '', want);
    }
    if (r.sub && S['sub_' + r.tab.id] !== r.sub.id) { S['sub_' + r.tab.id] = r.sub.id; save(); }
    const y = keepScroll && lastTab === r.path ? window.scrollY : 0;
    for (const b of tabsEl.children) b.setAttribute('aria-current', b.dataset.id === r.tab.id ? 'page' : 'false');
    subEl.textContent = '';
    subBar.hidden = !r.tab.subs;
    if (r.tab.subs) for (const s of r.tab.subs) subEl.append(h('button', { class: 'subtab', type: 'button',
      'aria-current': s === r.sub ? 'page' : 'false', onclick: () => go(r.tab.id + '/' + s.id) }, subLabel(r.tab, s)));
    purgeAll();
    view.textContent = '';
    syncTopbar();
    (r.sub || r.tab).render();
    applyTexts(view);   // the key is the text shown, so the English and the Italian page each have their own edits
    // side-by-side cards share one height, and some descriptions are added after their chart is drawn:
    // fit those charts to their final box once the page is complete
    setTimeout(() => { for (const d of view.querySelectorAll('.grid > .card > .chart.js-plotly-plot')) { try { Plotly.Plots.resize(d); } catch (e) { /* ignore */ } } }, 0);
    lastTab = r.path;
    window.scrollTo(0, y);
    if (!keepScroll) { revealActive(tabsEl, tabsEl.querySelector('[aria-current="page"]')); revealActive(subEl, subEl.querySelector('[aria-current="page"]')); }
  }
  window.addEventListener('hashchange', () => render(false));
  window.addEventListener('resize', syncTopbar);

  // ------------------------------------------------------------------ lightbox
  const lb = document.getElementById('lightbox');
  function openImage(item) {
    document.getElementById('lb-title').textContent = item.title;
    document.getElementById('lb-path').textContent = item.src;
    const img = document.getElementById('lb-img'); img.src = item.path; img.alt = item.title;
    document.getElementById('lb-open').href = item.path;
    lb.hidden = false; document.getElementById('lb-close').focus();
  }
  function closeImage() { lb.hidden = true; document.getElementById('lb-img').removeAttribute('src'); }
  document.getElementById('lb-close').addEventListener('click', closeImage);
  lb.addEventListener('click', e => { if (e.target === lb) closeImage(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !lb.hidden) closeImage(); });
  function thumbBtn(png, title, sub) {
    return h('button', { type: 'button', class: 'thumb', onclick: () => openImage({ path: png.path, src: png.src, title }) },
      h('img', { src: png.thumb, alt: title, loading: 'lazy' }), h('span', { class: 't1' }, title), sub ? h('span', { class: 't2' }, sub) : null);
  }

  // ------------------------------------------------------------------ texts edited on the page ("Modifica i testi")
  // Every text of the page can be replaced from testi.js: window.TESTI = { "original text": "new text" }.
  // The original text is the key, so a sentence that contains a computed number stops being replaced when the
  // number changes: the page never shows an edited text with an old number.
  // testi.js lives in the public GitHub repository: the page saves it there with the owner's GitHub token
  // (kept only in the browser of the owner's devices). The local build copies it back into Elaborato/dashboard.
  const GH = { owner: 'marcodezan', repo: 'Tesi-triennale', path: 'testi.js', branch: 'main',
    author: { name: 'Marco De Zan', email: '119526606+marcodezan@users.noreply.github.com' } };
  const EDIT_SEL = ['.view-head h2', '.view-head p', '.section-title', '.section-lead', '.card-head h3', '.card-head .desc',
    '.fold-title', 'details.fold > summary .desc', '.callout > div', 'p.note', '.prose p', '.prose li', '.prose dt', '.prose dd',
    '.tile .label', '.tile .who', 'ul.bullets li', '.chip-group-label', '.empty > div',
    // Overview and Thesis pages
    '.hero .kicker', '.hero-title', '.hero-lead p', '.hero-status .chip', '.stat-l', '.glossary h3', '.gloss dt', '.gloss dd',
    '.story-head .kicker', '.story-head h2', '.story-prose p', 'table.tried th', 'table.tried td', '.story-foot'].join(', ');
  const FILE_TX = (window.TESTI && typeof window.TESTI === 'object') ? window.TESTI : {};
  const draft = store.get('testi_bozza', null);
  // just after a save the site can still serve the previous testi.js for a few minutes: keep showing what was saved
  const recent = draft && draft.pub && Date.now() - draft.pub < 15 * 60e3;
  let BASE = Object.assign({}, recent ? draft.base : FILE_TX);
  let TX = Object.assign({}, draft && draft.tx ? draft.tx : BASE);
  let editing = false;
  function ghToken() { return store.get('gh_token', null); }
  function applyTexts(root) {
    for (const el of root.querySelectorAll(EDIT_SEL)) {
      if (el.closest('.js-plotly-plot') || (el.closest('.table-wrap') && !el.closest('table.tried'))) continue;
      for (const n of [...el.childNodes]) {
        if (n.nodeType !== 3 || n.nodeValue.trim().length < 2) continue;
        const sp = document.createElement('span');
        sp.className = 'edt'; sp.dataset.k = n.nodeValue;
        sp.textContent = TX[n.nodeValue] != null ? TX[n.nodeValue] : n.nodeValue;
        if (TX[n.nodeValue] != null) sp.classList.add('changed');
        n.replaceWith(sp);
      }
    }
    if (editing) setEditable(root, true);
  }
  function setEditable(root, on) {
    for (const sp of root.querySelectorAll('.edt')) {
      if (!on) { sp.removeAttribute('contenteditable'); continue; }
      sp.setAttribute('contenteditable', 'plaintext-only');
      if (sp.contentEditable !== 'plaintext-only') sp.setAttribute('contenteditable', 'true');
      sp.spellcheck = true;
    }
  }
  function changedKeys() { return [...new Set(Object.keys(TX).concat(Object.keys(BASE)))].filter(k => TX[k] !== BASE[k]); }
  function keepDraft(pub) { store.set('testi_bozza', changedKeys().length || pub ? { tx: TX, base: BASE, pub: pub || (draft && recent ? draft.pub : 0) } : null); }
  function commitText(sp) {
    const k = sp.dataset.k, lead = k.match(/^\s*/)[0], trail = k.match(/\s*$/)[0];
    const v = sp.textContent.replace(/\s+/g, ' ').trim();
    if (!v || lead + v + trail === k) { delete TX[k]; sp.textContent = k; sp.classList.remove('changed'); }
    else { TX[k] = lead + v + trail; if (sp.textContent !== TX[k]) sp.textContent = TX[k]; sp.classList.add('changed'); }
    keepDraft(); updateEditBar();
  }
  view.addEventListener('focusout', e => { if (editing && e.target.classList && e.target.classList.contains('edt')) commitText(e.target); });
  view.addEventListener('keydown', e => {
    if (!editing || !e.target.classList || !e.target.classList.contains('edt')) return;
    if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
    if (e.key === 'Escape') { e.target.textContent = TX[e.target.dataset.k] != null ? TX[e.target.dataset.k] : e.target.dataset.k; e.target.blur(); }
  });
  // a text inside the title of a folded card: clicking it edits it instead of opening the card
  view.addEventListener('click', e => { if (editing && e.target.closest && e.target.closest('summary .edt')) e.preventDefault(); });

  // --- controls: topbar button (devices with a token), footer link, edit bar, token dialog
  // On the public site visitors see no way in: the footer link appears only on a device that already has the token,
  // or when the address contains ?modifica (the owner opens .../Tesi-triennale/?modifica to log in on a new device).
  const EDIT_URL = new URLSearchParams(location.search).has('modifica');
  const editBar = h('div', { class: 'editbar', hidden: true, role: 'region', 'aria-label': 'Modifica dei testi' });
  const editBtn = h('button', { type: 'button', class: 'ghost-btn', onclick: () => toggleEditing() }, 'Modifica testi');
  const footLink = h('button', { type: 'button', class: 'link-btn foot-link', onclick: () => toggleEditing() }, LANG === 'en' ? 'Edit texts' : 'Modifica i testi');
  document.body.append(h('footer', { class: 'site-foot' }, h('span', null, LANG === 'en' ? 'Marco De Zan · BSc thesis project' : 'Marco De Zan · progetto di tesi triennale'), footLink), editBar);
  document.querySelector('.topbar-actions').prepend(editBtn);
  function editMsg(text, bad) { const m = editBar.querySelector('.eb-msg'); if (m) { m.textContent = text; m.classList.toggle('bad', !!bad); } }
  function updateEditBar() {
    const n = changedKeys().length;
    editBtn.hidden = !ghToken() && !editing;
    footLink.hidden = D.public && !ghToken() && !editing && !EDIT_URL;
    editBtn.textContent = LANG === 'en' ? (editing ? 'Stop editing' : 'Edit texts' + (n ? ' •' : '')) : (editing ? 'Fine modifica' : 'Modifica testi' + (n ? ' •' : ''));
    editBtn.setAttribute('aria-pressed', String(editing));
    editBar.hidden = !editing;
    if (!editing) return;
    editBar.textContent = '';
    editBar.append(
      h('div', { class: 'eb-text' }, h('b', null, 'Modifica dei testi. '), 'Tocca un titolo o una frase e scrivi; Invio conferma, Esc annulla. Lascia vuoto per tornare al testo originale. I numeri dei grafici e delle tabelle non si modificano.'),
      h('div', { class: 'eb-actions' },
        h('span', { class: 'eb-count' }, n ? `${n} ${n === 1 ? 'modifica da salvare' : 'modifiche da salvare'}` : 'Nessuna modifica da salvare'),
        h('button', { type: 'button', class: 'primary-btn no-arrow', disabled: !n, onclick: e => saveTexts(e.currentTarget) }, 'Salva sul sito'),
        h('button', { type: 'button', class: 'ghost-btn', disabled: !n, onclick: () => discardTexts() }, 'Annulla le modifiche'),
        h('button', { type: 'button', class: 'ghost-btn', onclick: () => toggleEditing() }, LX('Fine')),
        h('button', { type: 'button', class: 'link-btn eb-logout', onclick: () => forgetToken() }, 'Esci da questo dispositivo')),
      h('div', { class: 'eb-msg note', 'aria-live': 'polite' }));
  }
  function toggleEditing() {
    if (!editing && !ghToken()) { openTokenDialog(); return; }
    if (editing && document.activeElement && document.activeElement.classList.contains('edt')) document.activeElement.blur();
    editing = !editing;
    document.body.classList.toggle('editing', editing);
    setEditable(view, editing);
    updateEditBar();
  }
  function forgetToken() {
    store.set('gh_token', null);
    if (editing) toggleEditing(); else updateEditBar();
  }
  function ghHeaders(token) { return { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }; }
  const fileUrl = () => `https://api.github.com/repos/${GH.owner}/${GH.repo}/contents/${GH.path}`;
  // the repository is public, so any valid GitHub token can read it: editing needs a token whose user can write to it
  async function checkWrite(token) {
    const r = await fetch(`https://api.github.com/repos/${GH.owner}/${GH.repo}?t=${Date.now()}`, { headers: ghHeaders(token), cache: 'no-store' });
    if (!r.ok) throw new Error(r.status === 401 ? 'token non valido o scaduto' : 'GitHub ha risposto ' + r.status);
    const j = await r.json();
    if (!(j.permissions && j.permissions.push === true)) throw new Error('questo token non ha il permesso di modificare il sito');
  }
  async function readRemote(token) {
    const r = await fetch(fileUrl() + '?ref=' + GH.branch + '&t=' + Date.now(), { headers: ghHeaders(token), cache: 'no-store' });
    if (r.status === 404) return { sha: null, tx: {} };
    if (!r.ok) throw new Error(r.status === 401 ? 'token non valido o scaduto' : r.status === 403 ? 'il token non ha accesso a questo repository' : 'GitHub ha risposto ' + r.status);
    const j = await r.json();
    const text = new TextDecoder().decode(Uint8Array.from(atob(j.content.replace(/\s/g, '')), ch => ch.charCodeAt(0)));
    let tx = {};
    const i = text.indexOf('window.TESTI');
    if (i >= 0) { const body = text.slice(text.indexOf('=', i) + 1).trim().replace(/;\s*$/, ''); try { tx = JSON.parse(body); } catch (e) { throw new Error('il file testi.js su GitHub non è leggibile'); } }
    return { sha: j.sha, tx };
  }
  function openTokenDialog() {
    const input = h('input', { type: 'password', class: 'in token-in', autocomplete: 'off', spellcheck: 'false', placeholder: 'github_pat_…', 'aria-label': 'Token di GitHub' });
    const msg = h('p', { class: 'note', 'aria-live': 'polite' });
    const close = () => dlg.remove();
    const go = async () => {
      const t = input.value.trim();
      if (!t) { msg.textContent = 'Incolla il token.'; return; }
      msg.textContent = 'Controllo il token…';
      try {
        await checkWrite(t);
        await readRemote(t);
        store.set('gh_token', t); close();
        toggleEditing();
      } catch (e) { msg.textContent = 'Non funziona: ' + e.message + '.'; }
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); if (e.key === 'Escape') close(); });
    const dlg = h('div', { class: 'lightbox', onclick: e => { if (e.target === dlg) close(); } },
      h('div', { class: 'lightbox-inner token-box', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Accesso per modificare i testi' },
        h('p', { class: 'lightbox-title' }, 'Modifica i testi'),
        h('p', { class: 'note', style: 'margin:0' }, `Incolla il token di GitHub creato per il repository ${GH.owner}/${GH.repo}. Resta solo in questo browser: la prossima volta non servirà reinserirlo.`),
        input, msg,
        h('div', { class: 'lightbox-actions' }, h('button', { type: 'button', class: 'primary-btn no-arrow', onclick: go }, 'Entra'),
          h('button', { type: 'button', class: 'ghost-btn', onclick: close }, 'Annulla'))));
    document.body.append(dlg); input.focus();
  }
  function textsFile(obj) {
    const out = {}; for (const k of Object.keys(obj).sort((a, b) => a.localeCompare(b, 'it'))) out[k] = obj[k];
    return '// Testi della dashboard cambiati con "Modifica i testi" (sul sito o nella copia locale).\n' +
      '// Ogni voce: "testo originale": "testo nuovo". Se il testo originale cambia (per esempio perché cambia un numero\n' +
      '// calcolato), la voce smette di applicarsi e la pagina mostra di nuovo il testo originale.\n' +
      'window.TESTI = ' + JSON.stringify(out, null, 2) + ';\n';
  }
  async function saveTexts(btn) {
    const token = ghToken(); if (!token) { openTokenDialog(); return; }
    if (btn) btn.disabled = true;
    editMsg('Salvataggio su GitHub…');
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        // start from the file on GitHub (it may have been changed from another device) and apply only my changes
        const remote = await readRemote(token);
        const merged = Object.assign({}, remote.tx);
        for (const k of changedKeys()) { if (TX[k] == null) delete merged[k]; else merged[k] = TX[k]; }
        const n = changedKeys().length;
        const bytes = new TextEncoder().encode(textsFile(merged));
        let bin = ''; bytes.forEach(b => { bin += String.fromCharCode(b); });
        const body = { message: `Testi della dashboard: ${n} ${n === 1 ? 'modifica' : 'modifiche'} dal sito`, content: btoa(bin), branch: GH.branch,
          author: GH.author, committer: GH.author };
        if (remote.sha) body.sha = remote.sha;
        const r = await fetch(fileUrl(), { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, ghHeaders(token)), body: JSON.stringify(body) });
        if (r.status === 409 || r.status === 422) continue;            // changed meanwhile: read it again and retry once
        if (!r.ok) throw new Error(r.status === 401 ? 'token non valido o scaduto' : r.status === 403 ? 'il token non può scrivere in questo repository (serve "Contents: Read and write")' : 'GitHub ha risposto ' + r.status);
        BASE = Object.assign({}, merged); TX = Object.assign({}, merged); window.TESTI = merged;
        keepDraft(Date.now()); updateEditBar();
        editMsg('Salvato su GitHub. Il sito pubblico si aggiorna in circa un minuto; su questo dispositivo le modifiche si vedono già.');
        return;
      }
      throw new Error('il file è stato cambiato nello stesso momento da un altro dispositivo; riprova');
    } catch (e) {
      editMsg('Non salvato: ' + e.message + '. Le modifiche restano su questo dispositivo finché non le salvi o le annulli.', true);
      if (btn) btn.disabled = false;
    }
  }
  function discardTexts() {
    TX = Object.assign({}, BASE); keepDraft();
    render(true); editMsg('Modifiche annullate: la pagina mostra di nuovo i testi salvati.');
  }

  // ================================================================== VIEW: overview
  const DS_GD = 'Generation data', DS_ABR = LX('Monomega Abruzzo');
  const FAM_NAME = { exo: LX('LSTM esogena'), endo: LX('LSTM endogena'), exoJ: LX('LSTM esogena · anni uniti'), endoJ: LX('LSTM endogena · anni uniti'), abr: LX('LSTM endogena') };
  function overviewRows() {
    const rows = [];
    for (const fk of ['exo', 'endo', 'exoJ', 'endoJ']) for (const c of GD[fk].configs) {
      const F = GD[fk];
      rows.push({ ds: DS_GD, fam: fk, part: FAM_NAME[fk], key: fk + '-' + c.id, name: c.id, step: LX('5 min (stima)'),
        th: LXt`${c.th} passi (${c.th * EXO.step_min} min)`, tl: `${c.tl} ${c.tl === 1 ? LX('passo') : LX('passi')} (${c.tl * EXO.step_min} min)`, cells: c.cells,
        mae: gdVal(F, c, 'mae', 'mean'), unit: 'kW', nmae: gdVal(F, c, 'nmae', 'mean'), nmae_prod: gdVal(F, c, 'nmae', 'mean'),
        skill: gdVal(F, c, 'skill', 'mean'), ss: gdVal(F, c, 'ss', 'mean'), r2: gdVal(F, c, 'r2', 'mean'), src: F.joined ? LX('CSV ricalcolato (anno 3)') : LX('CSV ricalcolato'), _hl: c.preferred });
    }
    for (const c of ABR.configs) {
      if (!abrHasData(c)) continue;
      const srcs = [...new Set(ABR_SEASONS.map(s => c.seasons[s.key].csv ? LX('CSV ricalcolato') : 'Metrics.txt'))].join(' + ');
      rows.push({ ds: DS_ABR, fam: 'abr', part: FAM_NAME.abr, key: 'abr-' + c.id, name: c.id, step: '1 h', tlh: c.tl,
        th: c.th + ' h', tl: c.tl + ' h', cells: c.cells, mae: abrVal(c, 'mae', 'mean'), unit: 'kWh',
        nmae: abrVal(c, 'nmae', 'mean'), nmae_prod: abrVal(c, 'nmae_prod', 'mean'),
        skill: abrVal(c, 'skill_yest', 'mean'), ss: abrVal(c, 'ss_yest', 'mean'), r2: null, src: srcs, _hl: c.preferred });
    }
    return rows;
  }
  // best configuration of a Generation_data family (mean over its seasons)
  function gdBest(F, m = 'mae', cfgs) { return bestOf(cfgs || F.configs, cf => gdVal(F, cf, m, 'mean'), isSk(m) || m === 'r2'); }

  function datasetCard(title, intro, facts, body, path, btnLabel) {
    return h('section', { class: 'card dataset-card' },
      h('div', { class: 'card-head' }, h('div', null, h('h3', null, title), h('p', { class: 'desc' }, intro))),
      bullets(facts), body,
      h('div', { class: 'card-foot' }, h('button', { type: 'button', class: 'primary-btn', onclick: () => go(path) }, btnLabel)));
  }

  function viewOverview() {
    const c = C();
    view.append(viewHead(null, LX('Panoramica'),
      LX('Reti LSTM per prevedere la potenza di impianti fotovoltaici, provate su due dataset. Ogni dataset ha la sua scheda in alto: dentro trovi una pagina di confronto tra i modelli, una pagina per ogni modello, l\'esploratore del periodo di test, le architetture e i grafici originali.')));

    // --- one card per dataset, with the headline results
    const bx = gdBest(EXO), bn = gdBest(ENDO);
    const gdRows = [
      bx ? { m: LX('LSTM esogena'), cfg: bx.id, mae: gdVal(EXO, bx, 'mae', 'mean'), ref: h('span', null, LX('vs persistenza '), signed(gdVal(EXO, bx, 'skill', 'mean'))) } : null,
      bn ? { m: LX('LSTM endogena'), cfg: bn.id, mae: gdVal(ENDO, bn, 'mae', 'mean'), ref: h('span', null, LX('vs persistenza '), signed(gdVal(ENDO, bn, 'skill', 'mean'))) } : null,
    ].filter(Boolean);
    const miniCols = unit => [{ key: 'm', label: LX('Modello') }, { key: 'cfg', label: LX('Migliore') },
      { key: 'mae', label: `MAE [${unit}]`, num: true, fmt: v => fmt(v, 2) }, { key: 'ref', label: LX('Rispetto al riferimento'), render: r => r.ref }];
    const abrTls = [...new Set(ABR.configs.filter(abrHasData).map(x => x.tl))].sort((a, b) => a - b).filter(t => [1, 12, 24].includes(t));
    const abrRows = abrTls.map(tl => {
      const b = bestOf(ABR.configs.filter(x => x.tl === tl && abrHasData(x)), x => abrVal(x, 'mae', 'mean'));
      return { m: LXt`Orizzonte ${tl} h`, cfg: b.id, mae: abrVal(b, 'mae', 'mean'), ref: h('span', null, LX('vs ieri '), signed(abrVal(b, 'skill_yest', 'mean'))) };
    });
    view.append(h('div', { class: 'grid two' },
      datasetCard(DS_GD, LX('Un impianto, reti LSTM esogene ed endogene sugli stessi dati.'), [
        LXt`Potenza AC con passo stimato di 5 minuti, solo ore di luce (${fmt(REG.n, 0)} campioni).`,
        LXt`${EXO_SEASONS.length} fogli stagionali su tre anni; impianto da ${fmt(P_NOM_GD, 0)} kWp, potenza massima misurata ${fmt(P_MAX, 1)} kW.`,
        LX('La LSTM esogena prevede la potenza dei passi successivi dalla potenza passata e dal meteo misurato, la LSTM endogena dalla sola potenza passata.'),
      ], [table(miniCols('kW'), gdRows), h('p', { class: 'note' }, LX('LSTM: reti addestrate stagione per stagione, media sulle stagioni pesata con i giorni di ciascuna. Persistenza = ultimo valore noto.'))],
      'gd/confronto', LX('Apri Generation data')),
      datasetCard(DS_ABR, LX('Un impianto, reti LSTM endogene con finestre e orizzonti diversi.'), [
        LXt`Energia oraria (inverter WR1 + WR2) di un impianto da ${fmt(P_NOM, 2)} kWp.`,
        LXt`${ABR_SEASONS.length} stagioni (primavera ed estate 2020 e 2021), un modello per stagione; test = ultimo 10 % di ogni stagione (circa 9 giorni).`,
        LX('Le reti vedono solo la produzione passata e prevedono l\'energia da 1 a 24 ore dopo.'),
      ], [table(miniCols('kWh'), abrRows), h('p', { class: 'note' }, LX('Migliore configurazione per ciascun orizzonte, media sulle 4 stagioni pesata con i giorni. Riferimento = stessa ora del giorno prima.'))],
      'abruzzo/confronto', LX('Apri Monomega Abruzzo')),
    ));

    // --- normalised error across datasets
    const OV = [
      { value: 'nmae_prod', label: LX('nMAE sulla potenza media, Abruzzo sulle ore di produzione [%]'), d: 1, unit: '%' },
      { value: 'nmae', label: LX('nMAE sulla potenza media, Abruzzo su tutte le ore [%]'), d: 1, unit: '%' },
    ];
    const met = OV.find(o => o.value === S.ovMetric) || OV[0];
    view.append(sectionTitle(LX('I due dataset a confronto'), null,
      LX('Gli errori in kW e in kWh non si possono confrontare tra impianti di taglia diversa: qui sono divisi per la potenza media misurata (nMAE). Per ogni modello è mostrata la configurazione migliore.')));
    view.append(filters(selectCtl(LX('Metrica'), OV, met.value, v => set('ovMetric', v))));
    const all = overviewRows().filter(r => !r.baseline && r[met.value] != null);
    const groups = [
      ...['exo', 'endo', 'exoJ', 'endoJ'].map(f => ({ ds: DS_GD, name: FAM_NAME[f], rows: all.filter(r => r.fam === f) })),
      ...abrTls.map(tl => ({ ds: DS_ABR, name: LXt`LSTM endogena · orizzonte ${tl} h`, rows: all.filter(r => r.fam === 'abr' && r.tlh === tl) })),
    ].filter(g => g.rows.length).map(g => Object.assign(g, { best: bestOf(g.rows, r => r[met.value]) }));
    const labels = groups.map(g => `${g.name} · ${g.best.name}`);
    const div = chartDiv();
    div.style.height = Math.max(260, groups.length * 40 + 90) + 'px';
    const refTxt = met.value === 'nmae_prod'
      ? LX('Riferimento: potenza media misurata del periodo di test (media pesata delle stagioni divisa per la potenza media di tutte le stagioni insieme). Per l\'Abruzzo la media è calcolata sulle sole ore con produzione: Generation data non ha le notti, quindi così i due dataset sono confrontati alla pari.')
      : LX('Riferimento: potenza media misurata del periodo di test. Per l\'Abruzzo la media comprende anche le ore notturne a produzione nulla, che Generation data non ha: l\'nMAE dell\'Abruzzo risulta più alto.');
    view.append(card(met.label, refTxt, div));
    const mk = ds => {
      const gs = groups.filter(g => g.ds === ds);
      return { type: 'bar', orientation: 'h', name: ds, y: gs.map(g => labels[groups.indexOf(g)]), x: gs.map(g => g.best[met.value]),
        marker: { color: ds === DS_GD ? c.s1 : c.s2 }, width: 0.6, text: gs.map(g => fmt(g.best[met.value], met.d) + ' %'),
        textposition: 'outside', cliponaxis: false, textfont: { color: c.text2, size: 11 },
        hovertemplate: `%{y}<br><b>%{x:.${met.d}f} %</b><extra>${ds}</extra>` };
    };
    plot(div, [mk(DS_GD), mk(DS_ABR)], {
      barmode: 'overlay', margin: { l: 10, r: 60, t: 36, b: 44 },
      yaxis: { categoryorder: 'array', categoryarray: labels, autorange: 'reversed', showline: false, gridcolor: 'rgba(0,0,0,0)', tickfont: { color: c.text2, size: 12 } },
      xaxis: { title: { text: met.label }, rangemode: 'tozero' },
    }, 'confronto_dataset');

    const rows = overviewRows();
    view.append(foldCard(LXt`Tutte le configurazioni (${rows.length})`, LX('Tabella completa di entrambi i dataset. Clicca sulle intestazioni per ordinare; la barra blu a sinistra segna le configurazioni preferite.'),
      table([
        { key: 'ds', label: 'Dataset' }, { key: 'part', label: LX('Modello') }, { key: 'name', label: LX('Configurazione') },
        { key: 'th', label: LX('Finestra (TH)') }, { key: 'tl', label: LX('Orizzonte (TL)') }, { key: 'cells', label: LX('Celle / neuroni') },
        { key: 'mae', label: 'MAE', num: true, render: r => fmt(r.mae, 2) + ' ' + r.unit },
        { key: 'nmae', label: LX('nMAE tutte le ore [%]'), num: true, fmt: v => fmt(v, 1), title: LX('MAE / potenza media misurata; per Generation data le due colonne coincidono (non ci sono notti)') },
        { key: 'nmae_prod', label: LX('nMAE ore di produzione [%]'), num: true, fmt: v => fmt(v, 1), title: LX('MAE / potenza media sulle ore con produzione (Abruzzo); per Generation data coincide con la colonna precedente') },
        { key: 'skill', label: LX('vs riferimento (MAE)'), num: true, render: r => signed(r.skill), title: LX('Abruzzo: stessa ora di ieri; Generation data: persistenza') },
        { key: 'ss', label: 'Skill score', num: true, render: r => signed(r.ss), title: LX('Abruzzo: rispetto alla stessa ora di ieri; Generation data: rispetto alla persistenza') },
        { key: 'r2', label: 'R²', num: true, fmt: v => fmt(v, 3) },
        { key: 'src', label: LX('Fonte') },
      ], rows, { scroll: true })));
  }

  // ================================================================== VIEW: overview (the story of the work)
  // Texts: overview_texts.js (English and Italian). Numbers: computed here from the data and put into the texts
  // through the {tokens}. Every chart of this page uses the same data as the detail pages.
  const RAW = {};
  function storyFacts() {
    const gain = (m, p) => (m == null || !p ? null : 100 * (1 - m / p));
    const days = s => (ABR_SINFO[s.key] || {}).days;
    const a = abrPref;
    const abrBase = w => wmean(ABR_SEASONS.map(s => [(a.seasons[s.key].base[w] || {}).mae, days(s)]));
    const aMae = abrVal(a, 'mae', 'mean');
    // Generation data: day-weighted MAE of a network and of persistence over its own seasons
    const gdPair = (F, cf, samples) => {
      if (!cf) return [null, null];
      const it = Object.entries(cf.seasons).map(([k, e]) => ({ s: gdView(e, samples), w: (GD_SHEET[e._sheet || k] || {}).days })).filter(o => o.s);
      return [wmean(it.map(o => [o.s.metrics.mae, o.w])), wmean(it.map(o => [o.s.pers.mae, o.w]))];
    };
    const gdGain = (F, cf, samples) => gain(...gdPair(F, cf, samples));
    const [gMae, gPers] = gdPair(EXO, exoPref);
    let nNets = ABR.configs.filter(abrHasData).length * ABR_SEASONS.length;
    for (const F of [EXO, ENDO, EXOJ, ENDOJ]) for (const cf of F.configs) nNets += Object.keys(cf.seasons).length;
    // joined years against separate seasons on the same samples (last 20 % of each year-3 sheet)
    const cJ = gdCfg(EXOJ, 6, 1, 64);
    let gJ = null, gS = null;
    if (cJ) {
      const it = Object.entries(cJ.seasons).map(([k, e]) => ({ j: gdView(e, 'last20'), s: exoPref.seasons[e._sheet || k], w: (GD_SHEET[e._sheet || k] || {}).days })).filter(o => o.j && o.s);
      gJ = gain(wmean(it.map(o => [o.j.metrics.mae, o.w])), wmean(it.map(o => [o.j.pers.mae, o.w])));
      gS = gain(wmean(it.map(o => [o.s.metrics.mae, o.w])), wmean(it.map(o => [o.s.pers.mae, o.w])));
    }
    // state carried on during the test (method 2), same rows as the original network
    let gSt = null, gSo = null;
    const stNet = ((D.stato || {}).exo || { nets: [] }).nets.find(n => n.th === 6 && n.tl === 1 && n.cells === 64);
    if (stNet && stNet.methods['2']) {
      const it = Object.entries(stNet.methods['2'].seasons).map(([k, e]) => ({ e, w: (GD_SHEET[e.sheet || k] || {}).days })).filter(o => o.e.m && o.e.p && o.e.o);
      gSt = gain(wmean(it.map(o => [o.e.m.mae, o.w])), wmean(it.map(o => [o.e.p.mae, o.w])));
      gSo = gain(wmean(it.map(o => [o.e.o.mae, o.w])), wmean(it.map(o => [o.e.p.mae, o.w])));
    }
    // no window across the night: new network and original one on the same samples
    const nn = (D.no_night || []).find(n => n.th === 6) || null;
    Object.assign(RAW, { aMae, aPers: abrBase('pers'), aYest: abrBase('yest'), aStat: abrBase('stat'), gMae, gPers });
    const p1 = v => fmt(v, 1), p0 = v => fmt(v, 0);
    FACTS = {
      n_networks: p0(Math.round(nNets / 10) * 10), gd_pnom: p0(P_NOM_GD), abr_pnom: fmt(P_NOM, 2), abr_pnom0: p0(P_NOM),
      gd_n: p0(REG.n), gd_blocks: String(EXO_SEASONS.length),
      abr_mae: p1(aMae), abr_pers: p1(RAW.aPers), abr_yest: p1(RAW.aYest), abr_stat: p1(RAW.aStat),
      abr_skill_pers: p0(gain(aMae, RAW.aPers)), abr_skill_stat: p0(gain(aMae, RAW.aStat)),
      gd_mae: p1(gMae), gd_pers: p1(gPers), gd_skill: p0(gain(gMae, gPers)), gd_skill30: p0(gdGain(EXO, gdCfg(EXO, 12, 6, 64))),
      t_th6: p0(gdGain(ENDO, gdCfg(ENDO, 6, 1, 64))), t_th36: p0(gdGain(ENDO, gdCfg(ENDO, 36, 1, 64))),
      t_c64: p1(gdGain(ENDO, gdCfg(ENDO, 6, 1, 64))), t_c128: p1(gdGain(ENDO, gdCfg(ENDO, 6, 1, 128))),
      t_exo6: p1(gdGain(EXO, gdCfg(EXO, 6, 1, 64))), t_endo6: p1(gdGain(ENDO, gdCfg(ENDO, 6, 1, 64))),
      t_exo24: p1(gdGain(EXO, gdCfg(EXO, 24, 1, 64))), t_endo24: p1(gdGain(ENDO, gdCfg(ENDO, 24, 1, 64))),
      t_joined: p1(gJ), t_sep: p1(gS), t_state: p1(gSt), t_state_orig: p1(gSo),
      t_nn: nn ? p1(nn.gain) : '—', t_nn_orig: nn ? p1(nn.gain_orig) : '—', t_nn_share: nn ? p1(nn.share_removed) : '—',
    };
    return { hasState: gSt != null, hasNoNight: !!nn };
  }
  function storyHead(kKey, titleKey) { return h('div', { class: 'story-head' }, kKey ? h('p', { class: 'kicker' }, tx(kKey)) : null, h('h2', null, tx(titleKey))); }
  // a section of the Overview: text (title, paragraphs, buttons) in the left column, charts and tables in the right one
  function storySec(id, head, textKey, media, actions) {
    const m = [].concat(media || []).filter(Boolean);
    const text = h('div', { class: 'story-text' }, head, textKey ? h('div', { class: 'story-prose' }, prose(textKey)) : null, actions || null);
    return h('section', { class: 'story-sec' + (m.length ? ' split' : ''), id }, text, m.length ? h('div', { class: 'story-media' }, m) : null);
  }
  function barsH(div, labels, values, colors, unit, d, axisTitle, name) {
    const c = C();
    div.style.height = Math.max(190, labels.length * 46 + 80) + 'px';
    plot(div, [{ type: 'bar', orientation: 'h', y: labels, x: values, marker: { color: colors }, width: 0.62,
      text: values.map(v => fmt(v, d) + ' ' + unit), textposition: 'outside', cliponaxis: false, textfont: { color: c.text2, size: 12 },
      hovertemplate: '%{y}<br><b>%{x:.' + d + 'f} ' + unit + '</b><extra></extra>' }],
    { showlegend: false, margin: { l: 10, r: 70, t: 10, b: 44 },
      yaxis: { autorange: 'reversed', showline: false, gridcolor: 'rgba(0,0,0,0)', tickfont: { color: c.text2, size: 12.5 } },
      xaxis: { title: { text: axisTitle }, rangemode: 'tozero' } }, name);
  }
  function storyLag(div, real, pred, tl, unit, xTitle, name) {
    const c = C();
    const { ks, m } = lagCurve(real, pred, -3, tl + 5);
    const a = vline(0, c.text2, tx('lag_zero'), 'left'), b = vline(tl, c.text2, tx('lag_tl'), 'right');
    plot(div, [lineT(ks, m, '', c[ROLE.model], { mode: 'lines+markers', marker: { size: 8, color: c[ROLE.model], line: { color: c.surface, width: 2 } },
      hovertemplate: 'k = %{x}<br><b>%{y:.2f} ' + unit + '</b><extra></extra>' })],
    { showlegend: false, margin: { t: 30 }, xaxis: { title: { text: xTitle }, dtick: 1 },
      yaxis: { title: { text: tx(unit === 'kW' ? 'axis_mae_kw' : 'axis_mae_kwh') }, rangemode: 'tozero' },
      shapes: [a.shape, b.shape], annotations: [a.ann, b.ann] }, name);
  }
  // networks whose training curves are available: the main ones (D.curves), the ones without windows across the night
  // and the ones with the state carried on (method 2: validation data instead of test data)
  function curveNets() {
    const out = [];
    const famOrd = { abr: 0, exo: 1, endo: 2 };
    for (const n of [...(D.curves || [])].sort((p, q) => famOrd[p.fam] - famOrd[q.fam] || p.th - q.th)) out.push({ key: n.fam + ':' + n.id, unit: n.unit, seasons: n.seasons,
      label: tx(n.fam === 'abr' ? 'c_abr' : n.fam === 'exo' ? 'c_exo' : 'c_endo', { th: n.th, min: n.th * 5 }) });
    for (const n of [...(D.no_night || [])].sort((p, q) => p.th - q.th)) if (n.curves) out.push({ key: 'nn:' + n.id, unit: 'kW', seasons: n.curves,
      label: tx('c_nonight', { min: n.th * 5 }) });
    for (const fk of ['exo', 'endo', 'abr']) for (const n of (((D.stato || {})[fk]) || { nets: [] }).nets) {
      const m2 = n.methods['2']; if (!m2) continue;
      const seasons = {};
      for (const [k, e] of Object.entries(m2.seasons)) if (e.ep && e.ep.tr) seasons[k] = { ep: e.ep.tr.map((_, i) => i + 1), tr: e.ep.tr, va: e.ep.va, pers_te: e.p ? e.p.mae : null, best: e.ep.best };
      if (Object.keys(seasons).length) out.push({ key: 'st:' + fk + ':' + n.id, unit: fk === 'abr' ? 'kWh' : 'kW', seasons, state: true,
        label: tx(fk === 'abr' ? 'c_st_abr' : fk === 'exo' ? 'c_st_exo' : 'c_st_endo', { th: n.th, min: n.th * 5 }) + (fk === 'abr' ? ' · ' + n.cells + ' ' + LX('celle') : '') });
    }
    return out;
  }

  function viewStory() {
    const have = storyFacts();
    const c = C();
    const root = h('div', { class: 'story' });
    view.append(root);

    // ---- opening
    root.append(h('header', { class: 'hero' },
      h('div', { class: 'hero-main' },
        h('p', { class: 'kicker' }, tx('hero_kicker')),
        h('h2', { class: 'hero-title' }, tx('hero_title')),
        h('div', { class: 'hero-lead' }, prose('hero_lead')),
        h('p', { class: 'hero-status' }, h('span', { class: 'chip accent' }, tx('hero_status')))),
      h('div', { class: 'stat-row' }, [1, 2, 3, 4].map(i => h('div', { class: 'stat' },
        h('div', { class: 'stat-v' }, tx('stat' + i + '_v')), h('div', { class: 'stat-l' }, tx('stat' + i + '_l')))))));

    // ---- glossary
    root.append(h('section', { class: 'story-sec glossary' }, h('h3', null, tx('glossary_title')),
      h('dl', { class: 'gloss' }, [1, 2, 3, 4, 5, 6].map(i => h('div', null, h('dt', null, tx('g' + i + '_t')), h('dd', null, tx('g' + i + '_d')))))));

    // ---- the data
    const dGd = chartDiv('small'), dAb0 = chartDiv('small');
    const dataCard = (k, div) => h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('div', null, h('h3', null, tx('data_' + k + '_t')))),
      h('div', { class: 'story-prose in-card' }, prose('data_' + k + '_p')), div, h('p', { class: 'note' }, tx('data_' + k + '_c')));
    root.append(h('section', { class: 'story-sec', id: 'data' }, storyHead(null, 'data_title'), h('div', { class: 'grid two' }, dataCard('gd', dGd), dataCard('abr', dAb0))));
    {
      const e = exoPref.seasons.Estate_3 || Object.values(exoPref.seasons)[0];
      const n = Math.min(560, e.series.real.length);
      plot(dGd, [lineT(Array.from({ length: n }, (_, i) => i), e.series.real.slice(0, n), tx('measured'), c[ROLE.measured], { hovertemplate: '<b>%{y:.1f} kW</b><extra></extra>' })],
        { showlegend: false, margin: { t: 10 }, xaxis: { title: { text: tx('axis_samples') } }, yaxis: { title: { text: tx('axis_power') }, rangemode: 'tozero' } }, 'generation_data');
      const sa = (abrPref.seasons.Primavera2021 || Object.values(abrPref.seasons)[0]).series;
      if (sa) plot(dAb0, [lineT(sa.t, sa.real, tx('measured'), c[ROLE.measured], { hovertemplate: '%{x}<br><b>%{y:.1f} kWh</b><extra></extra>' })],
        { showlegend: false, margin: { t: 10 }, xaxis: { title: { text: tx('axis_time') } }, yaxis: { title: { text: tx('axis_energy') }, rangemode: 'tozero' } }, 'abruzzo');
    }

    // ---- step 2: hourly forecasts (Abruzzo)
    const a = abrPref;
    const aKey = ABR_SEASONS.some(s => s.key === S.stAbrSeason && a.seasons[s.key].series) ? S.stAbrSeason : (ABR_SEASONS.find(s => a.seasons[s.key].series) || ABR_SEASONS[0]).key;
    const dA = chartDiv('tall'), dAb = chartDiv();
    root.append(storySec('step2', storyHead('s2_k', 's2_title'), 's2_p', [
      card(tx('s2_chart_t'), tx('s2_chart_d'), dA, selectCtl(tx('season'), ABR_SEASONS.map(s => ({ value: s.key, label: seasonL(s.key) })), aKey, v => set('stAbrSeason', v))),
      card(tx('s2_bar_t'), tx('s2_bar_d'), dAb)],
      h('div', { class: 'story-actions' },
        h('button', { type: 'button', class: 'primary-btn', onclick: () => go('abruzzo/confronto') }, tx('btn_abr')),
        h('button', { type: 'button', class: 'ghost-btn', onclick: () => go('abruzzo/esplora') }, tx('btn_explorer')))));
    const sa = a.seasons[aKey].series;
    if (sa) {
      const tr = [lineT(sa.t, sa.real, tx('measured'), c[ROLE.measured], { line: { color: c[ROLE.measured], width: 2.6 } }),
        lineT(sa.t, sa.pred, tx('network'), c[ROLE.model])];
      if (sa.stat) tr.push(lineT(sa.t, sa.stat, tx('stat_ref'), c.neutral, { line: { color: c.neutral, width: 1.6, dash: 'dot' } }));
      tr.push(lineT(sa.t, sa.pers, tx('persistence'), c[ROLE.pers], { visible: 'legendonly' }), lineT(sa.t, sa.yest, tx('yesterday'), c[ROLE.yest], { visible: 'legendonly' }));
      plot(dA, tr, { hovermode: 'x unified', xaxis: { title: { text: tx('axis_time') } }, yaxis: { title: { text: tx('axis_energy') }, rangemode: 'tozero' } }, 'abruzzo_test');
    }
    {
      const rows = [[tx('network'), RAW.aMae, c[ROLE.model]], [tx('stat_ref'), RAW.aStat, c.neutral], [tx('yesterday'), RAW.aYest, c[ROLE.yest]], [tx('persistence'), RAW.aPers, c[ROLE.pers]]].filter(r => r[1] != null);
      barsH(dAb, rows.map(r => r[0]), rows.map(r => r[1]), rows.map(r => r[2]), 'kWh', 1, tx('axis_mae_kwh'), 'abruzzo_references');
    }

    // ---- step 3: five-minute forecasts (Generation data)
    const fk = S.stGdType === 'endo' ? 'endo' : 'exo', F = GD[fk];
    const tlsOf = Fm => [...new Set(Fm.configs.filter(x => x.th === 12 && x.cells === 64).map(x => x.tl))].sort((p, q) => p - q);
    const tls = tlsOf(F);
    const tl = tls.includes(+S.stGdTl) ? +S.stGdTl : tls[0];
    const cf = gdCfg(F, 12, tl, 64);
    const gKey = cf && cf.seasons[S.stGdSeason] ? S.stGdSeason : Object.keys(cf.seasons)[0];
    const dG = chartDiv('tall'), dGb = chartDiv();
    root.append(storySec('step3', storyHead('s3_k', 's3_title'), 's3_p', [
      card(tx('s3_chart_t'), tx('s3_chart_d'), dG, [
        segCtl(tx('net_type'), [{ value: 'exo', label: tx('exo') }, { value: 'endo', label: tx('endo') }], fk, v => set('stGdType', v)),
        segCtl(tx('horizon'), tls.map(t => ({ value: t, label: t * 5 + ' ' + tx('minutes') })), tl, v => set('stGdTl', v)),
        selectCtl(tx('block'), Object.keys(cf.seasons).map(k => ({ value: k, label: seasonL(k) })), gKey, v => set('stGdSeason', v))]),
      card(tx('s3_bar_t'), tx('s3_bar_d'), dGb)],
      h('div', { class: 'story-actions' },
        h('button', { type: 'button', class: 'primary-btn', onclick: () => go('gd/confronto') }, tx('btn_gd')),
        h('button', { type: 'button', class: 'ghost-btn', onclick: () => go('gd/esplora') }, tx('btn_explorer')))));
    const sg = cf.seasons[gKey].series;
    plot(dG, [lineT(sg.idx, sg.real, tx('measured'), c[ROLE.measured], { line: { color: c[ROLE.measured], width: 2.6 } }),
      lineT(sg.idx, sg.pred, tx('network'), c[ROLE.model]),
      lineT(sg.idx, sg.pers, tx('persistence'), c[ROLE.pers], { line: { color: c[ROLE.pers], width: 1.6, dash: 'dot' } })],
    { hovermode: 'x unified', xaxis: { title: { text: tx('axis_samples') }, range: [sg.idx[0], sg.idx[0] + Math.min(300, sg.idx.length - 1)] },
      yaxis: { title: { text: tx('axis_power') }, rangemode: 'tozero' } }, 'generation_data_test');
    {
      const g = (m, p) => (m == null || !p ? null : 100 * (1 - m / p));
      const pair = cfx => { const it = Object.entries(cfx.seasons).map(([k, e]) => ({ s: e, w: (GD_SHEET[e._sheet || k] || {}).days }));
        return g(wmean(it.map(o => [o.s.metrics.mae, o.w])), wmean(it.map(o => [o.s.pers.mae, o.w]))); };
      const trace = (Fm, name, col) => { const t = tlsOf(Fm); return { type: 'bar', name, x: t.map(v => String(v * 5)), y: t.map(v => pair(gdCfg(Fm, 12, v, 64))), marker: { color: col },
        text: t.map(v => fmt(pair(gdCfg(Fm, 12, v, 64)), 1) + ' %'), textposition: 'outside', cliponaxis: false, textfont: { color: c.text2, size: 11 },
        hovertemplate: '%{x} ' + tx('minutes') + '<br><b>%{y:.1f} %</b><extra>' + name + '</extra>' }; };
      plot(dGb, [trace(EXO, tx('exo'), c.s2), trace(ENDO, tx('endo'), c.s4)],
        { barmode: 'group', xaxis: { title: { text: tx('axis_horizon') }, type: 'category' }, yaxis: { title: { text: tx('axis_gain') }, rangemode: 'tozero' } }, 'gain_by_horizon');
    }

    // ---- the link with persistence
    const dL1 = chartDiv(), dL2 = chartDiv();
    root.append(storySec('persistence', storyHead(null, 'p_title'), 'p_p',
      [card(tx('p_gd_t'), tx('p_chart_d'), dL1), card(tx('p_abr_t'), tx('p_chart_d'), dL2)]));
    {
      const e = exoPref.seasons[gKey] || Object.values(exoPref.seasons)[0];
      storyLag(dL1, e.series.real, e.series.pred, exoPref.tl, 'kW', tx('axis_delay_gd'), 'delay_generation_data');
      if (sa) storyLag(dL2, sa.real, sa.pred, a.tl, 'kWh', tx('axis_delay_abr'), 'delay_abruzzo');
    }

    // ---- what I tried
    const tried = [1, 2, 3, 4].concat(have.hasState ? [5] : [], have.hasNoNight ? [6] : []);
    root.append(storySec('tried', storyHead(null, 't_title'), 't_p',
      h('div', { class: 'table-wrap' }, h('table', { class: 'tried' },
        h('thead', null, h('tr', null, h('th', null, tx('t_h1')), h('th', null, tx('t_h2')))),
        h('tbody', null, tried.map(i => h('tr', null, h('td', null, tx('t' + i + '_a')), h('td', null, tx('t' + i + '_b')))))))));

    // ---- how the networks learn
    const nets = curveNets();
    if (nets.length) {
      const net = nets.find(n => n.key === S.stCurve) || nets.find(n => n.key.startsWith('exo:')) || nets[0];
      const sKeys = Object.keys(net.seasons);
      const sKey = sKeys.includes(S.stCurveSeason) ? S.stCurveSeason : (sKeys.includes('Estate_3') ? 'Estate_3' : sKeys[sKeys.length - 1]);
      const e = net.seasons[sKey];
      const dC = chartDiv('tall');
      root.append(storySec('learning', storyHead(null, 'c_title'), 'c_p',
        card(tx('c_chart_t'), tx(net.state ? 'c_chart_d_state' : e.itc ? 'c_chart_d_it' : 'c_chart_d'), dC, [
          selectCtl(tx('c_net'), nets.map(n => ({ value: n.key, label: n.label })), net.key, v => set('stCurve', v)),
          selectCtl(tx('season'), sKeys.map(k => ({ value: k, label: seasonL(k) })), sKey, v => set('stCurveSeason', v))])));
      const hl = (y, name, col) => lineT([e.ep[0], e.ep[e.ep.length - 1]], [y, y], name, col, { line: { color: col, width: 1.6, dash: 'dash' }, hovertemplate: '<b>%{y:.2f} ' + net.unit + '</b><extra>' + name + '</extra>' });
      const ht = name => '%{x}<br><b>%{y:.2f} ' + net.unit + '</b><extra>' + name + '</extra>';
      const tr = [];
      // cost computed by Adam on every mini-batch (one point per weight update), or its mean per epoch when the
      // per-iteration file is not there; below the other curves
      if (e.itc && e.ipe) tr.push(lineT(e.itc.map((_, i) => (i + 1) / e.ipe), e.itc, tx('c_cost'), c.s3,
        { line: { color: c.s3, width: 0.8 }, opacity: 0.35, customdata: e.itc.map((_, i) => i + 1),
          hovertemplate: tx('c_iter') + ' %{customdata}<br><b>%{y:.2f} ' + net.unit + '</b><extra>' + tx('c_cost') + '</extra>' }));
      else if (e.mb) tr.push(lineT(e.ep, e.mb, tx('c_cost_ep'), c.s3, { line: { color: c.s3, width: 1.6, dash: 'dashdot' }, hovertemplate: ht(tx('c_cost_ep')) }));
      tr.push(lineT(e.ep, e.tr, tx('c_train'), c.s1, { hovertemplate: ht(tx('c_train')) }));
      let lrPrev = e.lr0;
      const lrMarks = (e.lr_steps || []).map(([x, v]) => { const m = vline(x, c.text2, tx('c_lr', { a: lrPrev, b: v }), 'right'); lrPrev = v; return m; });
      if (e.te) tr.push(lineT(e.ep, e.te, tx('c_test'), c.s2, { hovertemplate: ht(tx('c_test')) }));
      if (e.va) tr.push(lineT(e.ep, e.va, tx('c_val'), c.s2, { hovertemplate: ht(tx('c_val')) }));
      if (e.pers_tr != null) tr.push(hl(e.pers_tr, tx('c_ptrain'), c.s1));
      if (e.pers_te != null) tr.push(hl(e.pers_te, tx('c_ptest'), c.s2));
      if (e.dist) tr.push(lineT(e.ep, e.dist, tx('c_dist'), c.neutral, { line: { color: c.neutral, width: 1.8, dash: 'dot' }, hovertemplate: ht(tx('c_dist')) }));
      const top = 1.9 * Math.max(e.pers_tr || 0, e.pers_te || 0, Math.min(...e.tr.filter(v => v != null)));
      plot(dC, tr, { hovermode: 'x unified', xaxis: { title: { text: tx('axis_epoch') }, dtick: 5, hoverformat: '.2f' },
        yaxis: { title: { text: tx(net.unit === 'kW' ? 'axis_mae_kw' : 'axis_mae_kwh') }, range: [0, top] },
        shapes: lrMarks.map(m => Object.assign(m.shape, { line: Object.assign(m.shape.line, { dash: 'dot' }) })), annotations: lrMarks.map(m => Object.assign(m.ann, { y: 0.02, yanchor: 'bottom' })) }, 'training_curves');
    }

    // ---- inside the network, status
    root.append(storySec('inside', storyHead(null, 'i_title'), 'i_p', null, h('div', { class: 'story-actions' },
      h('button', { type: 'button', class: 'primary-btn', onclick: () => go('abruzzo/architetture') }, tx('btn_arch')),
      h('button', { type: 'button', class: 'ghost-btn', onclick: () => go('abruzzo/lstmvis') }, tx('btn_states')))));
    root.append(storySec('conclusions', storyHead(null, 'concl_title'), 'concl_p'));
    root.append(storySec('status', storyHead(null, 'st_title'), 'st_p'));
    root.append(h('p', { class: 'note story-foot' }, tx('foot')));
  }

  function viewThesis() {
    view.append(h('div', { class: 'story' }, h('header', { class: 'hero' }, h('h2', { class: 'hero-title' }, tx('thesis_title')),
      h('div', { class: 'hero-lead' }, prose('thesis_p')))));
  }

  // ================================================================== VIEW: Abruzzo · comparison of the configurations
  function abrNotices() {
    const anyCsv = ABR.configs.some(abrHasCsv);
    const noMetrics = ABR.configs.filter(c2 => !abrHasData(c2)).map(c2 => c2.id);
    if (!anyCsv) view.append(callout('Le previsioni dell\'Abruzzo non sono ancora salvate. Ho aggiunto l\'esportazione dei CSV agli script: rilanciali in MATLAB e poi fai doppio clic su aggiorna_dashboard.bat. Fino ad allora le metriche vengono da Metrics.txt e i grafici di dettaglio mostrano le immagini originali.'));
    if (noMetrics.length) view.append(callout(LXt`Configurazioni senza metriche (solo grafici): ${noMetrics.join(', ')}.`, true));
  }
  function openAbrDetail(id) { S.abrConfig = id; save(); go('abruzzo/dettaglio'); }

  function viewAbruzzo() {
    const c = C();
    const met = abrMetricDef(S.abrMetric);
    view.append(viewHead(DS_ABR, LX('Confronto tra le configurazioni'),
      LXt`Reti LSTM endogene che prevedono l'energia oraria (WR1 + WR2) dell'impianto da ${fmt(P_NOM, 2)} kWp usando solo la sua produzione passata. Ogni configurazione cambia la finestra di ingresso (TH), l'orizzonte di previsione (TL) o il numero di celle; un modello per stagione, test sull'ultimo 10 % di ogni stagione.`));
    abrNotices();

    // --- in short: best configuration for each horizon
    const ok = ABR.configs.filter(abrHasData);
    const tls = [...new Set(ok.map(x => x.tl))].sort((a, b) => a - b);
    const tileTls = tls.filter(t => [1, 12, 24].includes(t));
    const tl1 = ok.filter(x => x.tl === 1).map(x => abrVal(x, 'mae', 'mean'));
    view.append(sectionTitle(LX('In sintesi'), null, LX('La configurazione con il MAE medio più basso per ciascun orizzonte di previsione (media delle 4 stagioni).') +
      (tl1.length > 1 ? LXt` A 1 ora tutte le ${tl1.length} configurazioni stanno tra ${fmt(Math.min(...tl1), 2)} e ${fmt(Math.max(...tl1), 2)} kWh.` : '')));
    view.append(h('div', { class: 'grid three' }, tileTls.map(tl => {
      const b = bestOf(ok.filter(x => x.tl === tl), x => abrVal(x, 'mae', 'mean'));
      const pf = ok.find(x => x.tl === tl && x.preferred && x !== b);
      return tile(LXt`Previsione a ${tl} ${tl === 1 ? LX('ora') : LX('ore')}`, `${b.id}${b.preferred ? LX(' · preferita') : LX(' · MAE più basso')}`, fmt(abrVal(b, 'mae', 'mean'), 2), 'kWh MAE',
        [h('span', null, LX('vs stessa ora di ieri '), signed(abrVal(b, 'skill_yest', 'mean'))), h('span', null, 'skill score ', signed(abrVal(b, 'ss_yest', 'mean'))), fact('nMAE', fmt(abrVal(b, 'nmae', 'mean'), 1) + LX(' % (tutte le ore)')), fact('nMAE', fmt(abrVal(b, 'nmae_prod', 'mean'), 1) + LX(' % (ore di produzione)')),
          pf ? fact('preferita', `${pf.id} (${fmt(abrVal(pf, 'mae', 'mean'), 2)} kWh)`) : null], b.preferred);
    })));

    const seasonOpts = [{ value: 'mean', label: LX('Media delle 4 stagioni') }].concat(ABR_SEASONS.map(s => ({ value: s.key, label: s.label })));
    view.append(sectionTitle(LX('Finestra (TH) e orizzonte (TL)'), null, LX('Come cambia l\'errore allungando la finestra di ingresso o l\'orizzonte, e se la rete batte i riferimenti ingenui.')));
    view.append(filters(
      selectCtl(LX('Metrica'), ABR_METRICS, met.value, v => set('abrMetric', v)),
      selectCtl(LX('Stagione'), seasonOpts, S.abrSeason, v => set('abrSeason', v)),
    ));

    // heatmap TH x TL (128 cells)
    const THs = [24, 48, 72], TLs = [1, 12, 24];
    const z = THs.map(th => TLs.map(tl => { const cf = ABR.configs.find(x => x.th === th && x.tl === tl && x.cells === 128); return cf ? abrVal(cf, met.value, S.abrSeason) : null; }));
    const hm = chartDiv('short');
    const vals = z.flat().filter(v => v != null);
    const g1 = h('div', { class: 'grid two' });
    view.append(g1);
    const hmRows = [];
    for (const th of THs) for (const tl of TLs) { const cf = ABR.configs.find(x => x.th === th && x.tl === tl && x.cells === 128); hmRows.push({ cfg: `TH${th}-TL${tl}`, v: cf ? abrVal(cf, met.value, S.abrSeason) : null }); }
    g1.append(card(LXt`${met.label} · 128 celle`, `${S.abrSeason === 'mean' ? LX('Media delle quattro stagioni') : seasonLabel(S.abrSeason)}. ` +
      (met.kind === 'div' ? LX('Blu = la rete fa meglio del riferimento, rosso = peggio.') : LX('Più scuro = errore più alto.')) + LX(' n.d. = metrica non disponibile.'),
    [hm, tableToggle(LX('Mostra i valori in tabella'), table([{ key: 'cfg', label: LX('Configurazione') }, { key: 'v', label: met.label, num: true, fmt: v => fmt(v, met.d) }], hmRows))]));
    if (!vals.length) hm.replaceWith(emptyBox(LX('Nessun valore disponibile.')));
    else {
      let zmin = Math.min(...vals), zmax = Math.max(...vals), stops = c.seq;
      if (met.kind === 'div') { const a = Math.max(...vals.map(Math.abs)); zmin = -a; zmax = a; stops = c.div; }
      if (zmax === zmin) zmax = zmin + 1;
      const ann = [];
      THs.forEach((th, i) => TLs.forEach((tl, j) => {
        const v = z[i][j];
        const col = v == null ? c.muted : (lum(scaleColor(stops, (v - zmin) / (zmax - zmin))) > 0.35 ? '#0b0b0b' : '#ffffff');
        ann.push({ x: `TL ${tl} h`, y: `TH ${th} h`, text: v == null ? 'n.d.' : fmt(v, met.d) + (met.unit === '%' ? ' %' : ''), showarrow: false, font: { color: col, size: 13 } });
      }));
      plot(hm, [{ type: 'heatmap', x: TLs.map(t => `TL ${t} h`), y: THs.map(t => `TH ${t} h`), z, zmin, zmax, colorscale: toScale(stops), xgap: 3, ygap: 3,
        hoverongaps: false, colorbar: { thickness: 10, outlinewidth: 0, tickfont: { color: c.muted, size: 11 } },
        hovertemplate: `%{y} · %{x}<br><b>%{z:.${met.d}f} ${met.unit}</b><extra></extra>` }],
      { margin: { l: 70, r: 10, t: 10, b: 40 }, annotations: ann, xaxis: { showline: false, gridcolor: 'rgba(0,0,0,0)', side: 'bottom' },
        yaxis: { showline: false, gridcolor: 'rgba(0,0,0,0)', autorange: 'reversed' } }, 'abruzzo_heatmap');
    }

    // skill vs naive baselines
    const sk = chartDiv('short');
    g1.append(card(LX('La rete batte i riferimenti ingenui?'), LXt`Riduzione del MAE rispetto alla stessa ora del giorno prima (riferimento principale, per ogni TL) e alla persistenza (ultimo valore noto), quest'ultima solo per TL ≤ ${ABR_PERS_MAX_TL} h. Sopra zero = la rete è migliore.`, sk));
    const withData = ABR.configs.filter(x => S.abrSeason === 'mean' ? abrHasData(x) : abrMae(x.seasons[S.abrSeason]) != null);
    if (!withData.length) sk.replaceWith(emptyBox(LX('Nessun dato.')));
    else {
      const xs = withData.map(x => x.id);
      plot(sk, [
        { type: 'bar', name: LX('vs persistenza'), x: xs, y: withData.map(x => abrVal(x, 'skill_pers', S.abrSeason)), marker: { color: c[ROLE.pers] },
          hovertemplate: LX('%{x}<br><b>%{y:+.1f} %</b> vs persistenza<extra></extra>') },
        { type: 'bar', name: LX('vs stessa ora di ieri'), x: xs, y: withData.map(x => abrVal(x, 'skill_yest', S.abrSeason)), marker: { color: c[ROLE.yest] },
          hovertemplate: LX('%{x}<br><b>%{y:+.1f} %</b> vs stessa ora di ieri<extra></extra>') },
      ], { barmode: 'group', yaxis: { title: { text: LX('Riduzione del MAE [%]') }, zeroline: true, zerolinecolor: c.text2, zerolinewidth: 1 },
        xaxis: { tickangle: -40, tickfont: { size: window.innerWidth < 700 ? 9 : 11 } } }, 'abruzzo_vs_riferimenti');
    }

    // cells & short horizons
    view.append(sectionTitle(LX('Numero di celle e orizzonti brevi'), null, LX('Quanto conta la dimensione della rete (con finestra di 24, 48 o 72 ore), e quanto peggiora la previsione da 1 a 3 ore (TH = 72 h).')));
    const g2 = h('div', { class: 'grid two' }); view.append(g2);
    // windows that have the 12/24/36/128-cell family at TL = 1 h
    const cellThs = [24, 48, 72].filter(th => [12, 24, 36].some(n => ABR.configs.some(x => x.th === th && x.tl === 1 && x.cells === n && abrHasData(x))));
    const cellTh = cellThs.includes(Number(S.abrCellsTh)) ? Number(S.abrCellsTh) : (cellThs.includes(72) ? 72 : cellThs[0] || 72);
    const cellSet = [12, 24, 36, 128].map(n => ABR.configs.find(x => x.th === cellTh && x.tl === 1 && x.cells === n));
    const tlSet = [1, 2, 3].map(t => ABR.configs.find(x => x.th === 72 && x.tl === t && x.cells === 36));
    function seriesBySeason(div, cfgs, xs, xTitle, name) {
      const have = cfgs.filter(Boolean).filter(cf => ABR_SEASONS.some(s => abrSeasonVal(cf.seasons[s.key], met.value, cf.tl) != null));
      if (have.length < 2) { div.replaceWith(emptyBox(LX('Dati non ancora disponibili per questo confronto.'), 'Rilancia gli script corrispondenti in MATLAB e aggiorna la dashboard.')); return; }
      const tr = ABR_SEASONS.map((s, i) => lineT(xs, cfgs.map(cf => cf ? abrSeasonVal(cf.seasons[s.key], met.value, cf.tl) : null), s.label, c[['s1', 's2', 's3', 's4'][i]],
        { mode: 'lines+markers', marker: { size: 8, color: c[['s1', 's2', 's3', 's4'][i]], line: { color: c.surface, width: 2 } } }));
      tr.push(lineT(xs, cfgs.map(cf => cf ? abrVal(cf, met.value, 'mean') : null), LX('Media'), c.text1, { mode: 'lines+markers', line: { color: c.text1, width: 2.5 }, marker: { size: 9, color: c.text1, line: { color: c.surface, width: 2 } } }));
      // legend under the chart: with five entries it takes two rows and would sit under the toolbar at the top
      plot(div, tr, { hovermode: 'x unified', legend: { y: -0.22, yanchor: 'top' }, margin: { t: 16 },
        xaxis: { title: { text: xTitle }, type: 'category' }, yaxis: { title: { text: met.label } } }, name);
    }
    const dc = chartDiv('short'), dt = chartDiv('short');
    g2.append(card(LXt`Effetto del numero di celle (TH = ${cellTh} h, TL = 1 h)`, LXt`Stessa rete con 12, 24, 36 e 128 unità nascoste · ${met.label}.`,
      [cellThs.length > 1 ? h('div', { class: 'inline-ctl' }, segCtl(LX('Finestra TH'), cellThs.map(t => ({ value: t, label: t + ' h' })), cellTh, v => set('abrCellsTh', v))) : null, dc]));
    g2.append(card(LX('Orizzonti di 1, 2 e 3 ore (36 celle)'), LXt`Quanto peggiora la previsione allontanando il bersaglio · ${met.label}.`, dt));
    seriesBySeason(dc, cellSet, ['12', '24', '36', '128'], LX('Celle LSTM'), `abruzzo_celle_TH${cellTh}`);
    seriesBySeason(dt, tlSet, ['1 h', '2 h', '3 h'], LX('Orizzonte TL'), 'abruzzo_orizzonti_brevi');

    // input window TH: the chosen metric for TH = 24, 48, 72 h, at equal cells and horizon
    const THS = [24, 48, 72];
    const thMode = S.abrThMode === 'tl' ? 'tl' : 'cells';
    view.append(sectionTitle(LX('Finestra di ingresso (TH)'), null, LX('Come cambia la metrica scelta in alto allungando la finestra da 24 a 72 ore, a parità di celle e di orizzonte.')));
    const thGroups = thMode === 'cells'
      ? [128, 36, 24, 12].map((n, i) => ({ name: LXt`${n} celle`, col: ['s1', 's2', 's3', 's4'][i], cfgs: THS.map(th => ABR.configs.find(x => x.th === th && x.tl === 1 && x.cells === n)) }))
      : [1, 12, 24].map((tl, i) => ({ name: `TL = ${tl} h`, col: ['s1', 's2', 's3'][i], cfgs: THS.map(th => ABR.configs.find(x => x.th === th && x.tl === tl && x.cells === 128)) }));
    const thVal = cf => cf ? abrVal(cf, met.value, S.abrSeason) : null;
    const dth = chartDiv('');
    const thRows = THS.map((th, j) => Object.assign({ th: th + ' h' }, Object.fromEntries(thGroups.map((g, i) => ['g' + i, thVal(g.cfgs[j])]))));
    view.append(card(LXt`${met.label} al variare di TH`,
      (thMode === 'cells' ? LX('Orizzonte TL = 1 h, una linea per numero di celle.') : LX('128 celle, una linea per orizzonte di previsione.')) + ' ' +
      (S.abrSeason === 'mean' ? LX('Media delle quattro stagioni pesata con i giorni.') : seasonLabel(S.abrSeason) + '.') + (met.kind === 'div' ? LX(' Sopra zero = la rete fa meglio del riferimento.') : LX(' L\'asse verticale non parte da zero: guarda i valori, non solo la pendenza.')),
      [h('div', { class: 'inline-ctl' }, segCtl(LX('Linee'), [{ value: 'cells', label: LX('Celle (TL = 1 h)') }, { value: 'tl', label: LX('Orizzonte (128 celle)') }], thMode, v => set('abrThMode', v))),
        dth, tableToggle(LX('Mostra i valori in tabella'), table([{ key: 'th', label: LX('Finestra TH') }].concat(thGroups.map((g, i) => ({ key: 'g' + i, label: g.name, num: true, fmt: v => fmt(v, met.d) }))), thRows))]));
    if (!thGroups.some(g => g.cfgs.filter(cf => thVal(cf) != null).length >= 2)) dth.replaceWith(emptyBox(LX('Metrica non disponibile per questo confronto.'), met.value === 'skill_pers' ? LXt`La persistenza è usata solo per TL ≤ ${ABR_PERS_MAX_TL} h.` : ''));
    else plot(dth, thGroups.map(g => lineT(THS.map(t => t + ' h'), g.cfgs.map(thVal), g.name, c[g.col], {
      mode: 'lines+markers', line: { color: c[g.col], width: 2.5 }, marker: { size: 9, color: c[g.col], line: { color: c.surface, width: 2 } },
      customdata: g.cfgs.map(cf => cf ? cf.id : '—'), hovertemplate: `${g.name} · %{customdata}<br><b>%{y:.${met.d}f} ${met.unit}</b><extra></extra>` })),
    { hovermode: 'x unified', xaxis: { title: { text: LX('Finestra di ingresso TH') }, type: 'category' },
      yaxis: { title: { text: met.label }, zeroline: met.kind === 'div', zerolinecolor: c.text2 } }, `abruzzo_finestra_TH_${thMode}`);

    // ranking (mean over the seasons)
    view.append(sectionTitle(LX('Classifica delle configurazioni'), null, LX('Media delle 4 stagioni, ordinata per MAE. Clicca su una configurazione per aprirne il dettaglio.')));
    const rank = ABR.configs.map(x => ({ id: x.id, th: x.th, tl: x.tl, cells: x.cells, mae: abrHasData(x) ? abrVal(x, 'mae', 'mean') : null,
      mape: abrVal(x, 'mape', 'mean'), nall: abrVal(x, 'nmae', 'mean'), nprod: abrVal(x, 'nmae_prod', 'mean'), sky: abrVal(x, 'skill_yest', 'mean'), ssy: abrVal(x, 'ss_yest', 'mean'), skp: abrVal(x, 'skill_pers', 'mean'), _hl: x.preferred }));
    view.append(card(LX('Media delle stagioni'), LX('Medie pesate con i giorni di ogni stagione. La barra blu segna la configurazione preferita. Persistenza solo per TL ≤ ') + ABR_PERS_MAX_TL + ' h.', table([
      { key: 'id', label: LX('Configurazione'), render: r => linkBtn(r.id, () => openAbrDetail(r.id), LX('Apri il dettaglio')) },
      { key: 'th', label: 'TH [h]', num: true }, { key: 'tl', label: 'TL [h]', num: true }, { key: 'cells', label: LX('Celle'), num: true },
      { key: 'mae', label: 'MAE [kWh]', num: true, fmt: v => fmt(v, 2) },
      { key: 'nall', label: LX('nMAE tutte le ore [%]'), num: true, fmt: v => fmt(v, 1) }, { key: 'nprod', label: LX('nMAE ore di produzione [%]'), num: true, fmt: v => fmt(v, 1) },
      { key: 'mape', label: LX('MAPE diurno [%]'), num: true, fmt: v => fmt(v, 1) },
      { key: 'sky', label: LX('vs ieri (MAE)'), num: true, render: r => signed(r.sky) },
      { key: 'ssy', label: LX('Skill score vs ieri'), num: true, render: r => signed(r.ssy), title: LX('1 − Σ(misura − rete)² / Σ(misura − stessa ora di ieri)²') },
      { key: 'skp', label: LX('vs persistenza'), num: true, render: r => signed(r.skp) },
    ], rank, { sortKey: 'mae' })));

    // full table
    const rows = [];
    for (const x of ABR.configs) for (const ss of ABR_SEASONS) {
      const e = x.seasons[ss.key];
      rows.push({ cfg: x.id, season: ss.label, n: e.base.n_test, mae: abrMae(e), mape: abrMape(e), pers: x.tl <= ABR_PERS_MAX_TL ? e.base.pers.mae : null, yest: e.base.yest.mae,
        skp: abrSeasonVal(e, 'skill_pers', x.tl), sky: abrSeasonVal(e, 'skill_yest', x.tl), ssy: abrSeasonVal(e, 'ss_yest', x.tl), nall: abrSeasonVal(e, 'nmae', x.tl), nprod: abrSeasonVal(e, 'nmae_prod', x.tl),
        _hl: x.preferred });
    }
    view.append(foldCard(LXt`Tutte le stagioni di tutte le configurazioni (${rows.length} righe)`, LXt`Metriche ricalcolate dai file Risultati_<stagione>.csv; persistenza e stessa ora di ieri sono calcolate dai dati misurati sugli stessi campioni di test.`,
      table([
        { key: 'cfg', label: LX('Configurazione') }, { key: 'season', label: LX('Stagione') }, { key: 'n', label: LX('Ore test'), num: true },
        { key: 'mae', label: 'MAE [kWh]', num: true, fmt: v => fmt(v, 2) }, { key: 'mape', label: LX('MAPE diurno [%]'), num: true, fmt: v => fmt(v, 1) },
        { key: 'pers', label: LX('MAE persistenza'), num: true, fmt: v => fmt(v, 2) }, { key: 'yest', label: LX('MAE ieri'), num: true, fmt: v => fmt(v, 2) },
        { key: 'skp', label: LX('vs persistenza'), num: true, render: r => signed(r.skp) }, { key: 'sky', label: LX('vs ieri (MAE)'), num: true, render: r => signed(r.sky) },
        { key: 'ssy', label: LX('Skill score vs ieri'), num: true, render: r => signed(r.ssy) },
        { key: 'nall', label: LX('nMAE tutte le ore [%]'), num: true, fmt: v => fmt(v, 1) }, { key: 'nprod', label: LX('nMAE ore di produzione [%]'), num: true, fmt: v => fmt(v, 1) },
      ], rows, { scroll: true })));
  }

  // ================================================================== VIEW: Abruzzo · one configuration
  function viewAbruzzoDetail() {
    const c = C();
    const cf = abrConfig(S.abrConfig);
    view.append(viewHead(DS_ABR, LX('Dettaglio di una configurazione'),
      LX('Una configurazione e una stagione alla volta: errori, confronto con i riferimenti ingenui e andamento nel periodo di test.')));
    abrNotices();
    view.append(filters(
      selectCtl(LX('Configurazione'), ABR.configs.map(x => ({ value: x.id, label: x.id + (x.preferred ? LX(' · preferita') : '') + (abrHasCsv(x) ? '' : abrHasData(x) ? LX(' · solo metriche') : LX(' · solo grafici')) })), cf.id, v => set('abrConfig', v)),
      selectCtl(LX('Stagione'), ABR_SEASONS.map(s => ({ value: s.key, label: s.label })), S.abrDetSeason, v => set('abrDetSeason', v)),
      checkCtl(LX('Misura traslata di 1 h'), S.abrPers, v => set('abrPers', v)),
      checkCtl(LX('Stessa ora di ieri'), S.abrYest, v => set('abrYest', v)),
    ));
    view.append(h('p', { class: 'note', style: 'margin:-6px 0 14px' }, LXt`TH ${cf.th} h di ingresso · previsione a ${cf.tl} h · ${cf.cells} celle LSTM · script ${cf.script || '—'}`));

    // every season of this configuration
    if (abrHasData(cf)) {
      const ds = chartDiv('short');
      view.append(card(LXt`MAE stagione per stagione · ${cf.id}`, LX('La rete e i riferimenti ingenui sugli stessi giorni di test. Clicca su una stagione per vederne il dettaglio qui sotto.'), ds));
      const xs = ABR_SEASONS.map(s => s.label);
      const tr = [{ type: 'bar', name: 'LSTM', x: xs, y: ABR_SEASONS.map(s => abrMae(cf.seasons[s.key])), marker: { color: c[ROLE.model] } }];
      if (cf.tl <= ABR_PERS_MAX_TL) tr.push({ type: 'bar', name: LXt`Persistenza (${cf.tl} h prima)`, x: xs, y: ABR_SEASONS.map(s => cf.seasons[s.key].base.pers.mae), marker: { color: c[ROLE.pers] } });
      tr.push({ type: 'bar', name: LX('Stessa ora di ieri'), x: xs, y: ABR_SEASONS.map(s => cf.seasons[s.key].base.yest.mae), marker: { color: c[ROLE.yest] } });
      tr.forEach(t => { t.hovertemplate = `${t.name}<br>%{x}: <b>%{y:.2f} kWh</b><extra></extra>`; });
      plot(ds, tr, { barmode: 'group', yaxis: { title: { text: 'MAE [kWh]' }, rangemode: 'tozero' } }, `abruzzo_${cf.id}_stagioni`);
      ds.on('plotly_click', ev => { const p = ev.points && ev.points[0]; const s = p && ABR_SEASONS.find(x => x.label === p.x); if (s) set('abrDetSeason', s.key); });
    }

    const s = cf.seasons[S.abrDetSeason];
    const mae = abrMae(s);
    view.append(sectionTitle(`${seasonLabel(S.abrDetSeason)} · ${cf.id}`, null, LXt`Test dal ${s.base.t_start.slice(0, 16)} al ${s.base.t_end.slice(0, 16)}.`));
    view.append(h('div', { class: 'grid four' },
      tile(LX('MAE della rete'), `${cf.id} · ${seasonLabel(S.abrDetSeason)}`, fmt(mae, 2), 'kWh', [fact('nMAE', fmt(abrSeasonVal(s, 'nmae', cf.tl), 1) + LX(' % (tutte le ore)')),
        fact('nMAE', fmt(abrSeasonVal(s, 'nmae_prod', cf.tl), 1) + LX(' % (ore di produzione)')), fact(LX('MAPE diurno'), fmt(abrMape(s), 1) + ' %')]),
      tile(LX('Stessa ora di ieri'), LX('valore di 24 ore prima (riferimento principale)'), fmt(s.base.yest.mae, 2), 'kWh', [h('span', null, LX('rete '), signed(abrSeasonVal(s, 'skill_yest', cf.tl))), h('span', null, 'skill score ', signed(abrSeasonVal(s, 'ss_yest', cf.tl)))]),
      cf.tl <= ABR_PERS_MAX_TL
        ? tile(LX('Persistenza'), LXt`ultimo valore noto (${cf.tl} h prima)`, fmt(s.base.pers.mae, 2), 'kWh', [h('span', null, LX('rete '), signed(abrSeasonVal(s, 'skill_pers', cf.tl)))])
        : tile(LX('Persistenza'), LXt`non usata con TL = ${cf.tl} h`, '—', null, [h('span', null, LX('vedi Definizioni e note'))]),
      tile('Test', LX('ore di test'), fmt(s.base.n_test, 0), LX('ore'),
        [fact(LX('Potenza media della stagione'), LXt`${fmt((ABR_SINFO[S.abrDetSeason] || {}).p_mean, 1)} kW (tutte le ore), ${fmt((ABR_SINFO[S.abrDetSeason] || {}).p_mean_prod, 1)} kW (ore di produzione)`), s.csv ? fact('R²', fmt(s.csv.r2, 3)) : null]),
    ));
    const ts = chartDiv('tall');
    view.append(card(LX('Energia misurata e prevista nel test'), LX('Trascina sulla barra in basso per scegliere il periodo; passa il mouse (o tocca) per leggere tutti i valori di un\'ora.'), ts,
      s.series ? explorerButton('abr', cf.id, S.abrDetSeason) : null));
    if (!s.series) {
      const repl = h('div', null, emptyBox(LX('Previsioni non ancora salvate per questa configurazione e stagione.'),
        cf.script ? `Rilancia ${cf.script} (cartella Monomega abruzzo) e poi aggiorna la dashboard.` : LX('Script non trovato.')),
      s.png ? h('div', { class: 'thumb-inline' }, h('p', { class: 'note' }, LX('Intanto, il grafico originale salvato da MATLAB:')), thumbBtn(s.png, `${cf.id} · ${seasonLabel(S.abrDetSeason)}`, s.png.src)) : null);
      ts.replaceWith(repl);
    } else {
      const sr = s.series;
      const tr = [lineT(sr.t, sr.real, LX('Misurata'), c[ROLE.measured], { hovertemplate: LX('<b>%{y:.1f} kWh</b> misurata<extra></extra>') }),
        lineT(sr.t, sr.pred, LX('Prevista (LSTM)'), c[ROLE.model], { hovertemplate: '<b>%{y:.1f} kWh</b> LSTM<extra></extra>' })];
      if (S.abrPers) tr.push(lineT(sr.t, sr.shift1, LX('Misura traslata di 1 h'), c[ROLE.pers], { line: { color: c[ROLE.pers], width: 1.5 }, hovertemplate: LX('<b>%{y:.1f} kWh</b> misura 1 h prima<extra></extra>') }));
      if (S.abrYest) tr.push(lineT(sr.t, sr.yest, LX('Stessa ora di ieri'), c[ROLE.yest], { line: { color: c[ROLE.yest], width: 1.5 }, hovertemplate: LX('<b>%{y:.1f} kWh</b> ieri<extra></extra>') }));
      plot(ts, tr, { hovermode: 'x unified', xaxis: { type: 'date', rangeslider: { visible: true, thickness: 0.08, bgcolor: c.surface2, bordercolor: c.axis }, tickformat: '%d/%m %H:%M' },
        yaxis: { title: { text: LX('Energia [kWh]') }, rangemode: 'tozero' } }, `abruzzo_${cf.id}_${S.abrDetSeason}`);

      const g3 = h('div', { class: 'grid two' }); view.append(g3);
      const dh = chartDiv('short'), dl = chartDiv('short');
      g3.append(card(LX('Errore per ora del giorno'), LX('MAE in ciascuna ora sui giorni di test.'), dh));
      const lagCard = card(LX('Analisi del ritardo'), null, dl); g3.append(lagCard);
      const byHour = arrK => { const s2 = Array(24).fill(0), n = Array(24).fill(0); sr.hour.forEach((hh, i) => { if (arrK[i] != null && sr.real[i] != null) { s2[hh] += Math.abs(arrK[i] - sr.real[i]); n[hh]++; } }); return s2.map((v, i) => n[i] ? v / n[i] : null); };
      const hrs = [...Array(24).keys()];
      const htr = [lineT(hrs, byHour(sr.pred), 'LSTM', c[ROLE.model], { mode: 'lines+markers', marker: { size: 7, color: c[ROLE.model] } }),
        lineT(hrs, byHour(sr.yest), LX('Stessa ora di ieri'), c[ROLE.yest], { mode: 'lines+markers', marker: { size: 7, color: c[ROLE.yest] } })];
      if (cf.tl <= ABR_PERS_MAX_TL) htr.splice(1, 0, lineT(hrs, byHour(sr.pers), LXt`Persistenza (${cf.tl} h prima)`, c[ROLE.pers], { mode: 'lines+markers', marker: { size: 7, color: c[ROLE.pers] } }));
      plot(dh, htr, { hovermode: 'x unified', xaxis: { title: { text: LX('Ora del giorno') }, dtick: 2 }, yaxis: { title: { text: 'MAE [kWh]' }, rangemode: 'tozero' } }, 'abruzzo_errore_ora');
      const k = lagChart(dl, sr.real, sr.pred, cf.tl, 'kWh', 'h');
      lagCard.querySelector('.card-head > div').append(h('p', { class: 'desc' },
        LXt`MAE tra la previsione e la misura spostata di k ore. Se il minimo è a k = TL, la rete ripete l'ultimo valore noto. Qui il minimo è a k = ${k}.`));
    }
  }

  // ================================================================== Generation_data: shared pieces
  // TH x TL heatmap; valFn(th, tl) -> value or null
  function gridHeat(div, ths, tls, valFn, met, diverging, name) {
    const c = C();
    const z = ths.map(th => tls.map(tl => valFn(th, tl)));
    const vals = z.flat().filter(v => v != null && isFinite(v));
    if (!vals.length) { div.replaceWith(emptyBox(LX('Nessun valore disponibile.'))); return; }
    let zmin = Math.min(...vals), zmax = Math.max(...vals), stops = c.seq;
    if (diverging) { const a = Math.max(...vals.map(Math.abs)) || 1; zmin = -a; zmax = a; stops = c.div; }
    if (zmax === zmin) zmax = zmin + 1;
    const xl = tls.map(t => `TL ${t}`), yl = ths.map(t => `TH ${t}`);
    const ann = [];
    ths.forEach((th, i) => tls.forEach((tl, j) => {
      const v = z[i][j];
      const col = v == null ? c.muted : (lum(scaleColor(stops, (v - zmin) / (zmax - zmin))) > 0.35 ? '#0b0b0b' : '#ffffff');
      ann.push({ x: xl[j], y: yl[i], text: v == null ? '—' : (diverging && v > 0 ? '+' : '') + fmt(v, met.d) + (met.unit === '%' ? ' %' : ''), showarrow: false, font: { color: col, size: window.innerWidth < 700 ? 10 : 12 } });
    }));
    plot(div, [{ type: 'heatmap', x: xl, y: yl, z, zmin, zmax, colorscale: toScale(stops), xgap: 3, ygap: 3, hoverongaps: false,
      colorbar: { thickness: 10, outlinewidth: 0, tickfont: { color: c.muted, size: 11 } },
      hovertemplate: LXt`%{y} · %{x} passi<br><b>%{z:.${met.d}f} ${met.unit}</b><extra></extra>` }],
    { margin: { l: 64, r: 10, t: 10, b: 36 }, annotations: ann,
      xaxis: { type: 'category', showline: false, gridcolor: 'rgba(0,0,0,0)' },
      yaxis: { type: 'category', showline: false, gridcolor: 'rgba(0,0,0,0)', autorange: 'reversed' } }, name);
  }
  function gdCfg(F, th, tl, cells) { return F.configs.find(x => x.th === th && x.tl === tl && x.cells === cells) || null; }
  function cellsOf(...fams) { return [...new Set(fams.flatMap(F => F.configs.map(x => x.cells)))].sort((a, b) => a - b); }
  function axesOf(cells, ...fams) {
    const cf = fams.flatMap(F => F.configs.filter(x => x.cells === cells));
    return { ths: [...new Set(cf.map(x => x.th))].sort((a, b) => a - b), tls: [...new Set(cf.map(x => x.tl))].sort((a, b) => a - b) };
  }
  // mean over the seasons that both configurations have (or over one configuration's seasons)
  function commonKeys(F, a, b) { return F.seasons.map(s => s.key).filter(k => (!a || a.seasons[k]) && (!b || b.seasons[k])); }
  function meanOn(keys, cf, m, ofPers, samples) { return cf ? gdAgg(keys, k => gdView(cf.seasons[k], samples), m, ofPers) : null; }
  const LOWER_BETTER = { mae: true, mape: true, wmape: true, nmae: true, skill: false, ss: false, r2: false };
  // positive = the exogenous network is better
  function advantage(m, endoV, exoV) { if (endoV == null || exoV == null) return null; return LOWER_BETTER[m] ? endoV - exoV : exoV - endoV; }

  // ================================================================== VIEW: Generation_data networks (exogenous / endogenous)
  const TRAIN_SEG = [{ value: 'sep', label: LX('Stagioni separate') }, { value: 'joined', label: LX('Anni uniti (1 + 2 → 3)') }];
  const SAMPLES_SEG = [{ value: 'last20', label: LX('Ultimo 20 % (come le reti per stagione)') }, { value: 'all', label: LX('Tutto l\'anno 3') }];
  function trainNote(joined) {
    return joined
      ? LX('Anni uniti: per ogni stagione la rete è addestrata sugli anni 1 e 2 e provata sul foglio dell\'anno 3 (per la Primavera solo sull\'anno 2, perché Primavera_1 non esiste). Con "Ultimo 20 %" il test usa gli stessi campioni delle reti per stagione.')
      : LX('Stagioni separate: un modello per ciascuno degli 11 fogli; test = ultimo 20 % delle finestre di ogni foglio. Le medie sulle stagioni sono pesate con i giorni di ogni stagione.');
  }
  function scrollToId(id) { const e = document.getElementById(id); if (e) e.scrollIntoView({ behavior: 'smooth', block: 'start' }); }

  function viewGD(base) {
    const c = C();
    const mode = S['gdMode_' + base] === 'joined' ? 'joined' : 'sep';
    const fk = gdFam(base, mode), F = GD[fk], joined = mode === 'joined', isEndo = base === 'endo';
    const met = exoMetricDef(S.gdMetric);
    const seasons = F.seasons;
    view.append(viewHead(DS_GD, isEndo ? LX('LSTM endogena') : LX('LSTM esogena'),
      LX('Previsione della potenza AC ') + (isEndo ? LX('usando solo la potenza passata (un canale), con le stesse impostazioni della rete esogena. ') : LX('usando come serie temporali la potenza passata e le quattro variabili meteo misurate (irraggiamento, temperatura dei moduli, temperatura ambiente, velocità del vento). ')) +
      LX('TH = lunghezza della finestra di ingresso, TL = di quanti passi avanti si prevede; un passo vale circa 5 minuti.')));
    const ctl = [segCtl(LX('Addestramento'), TRAIN_SEG, mode, v => set('gdMode_' + base, v)),
      selectCtl(LX('Metrica dei grafici'), EXO_METRICS, met.value, v => set('gdMetric', v))];
    if (joined) ctl.push(segCtl(LX('Campioni di test'), SAMPLES_SEG, S.gdSamples, v => set('gdSamples', v)));
    view.append(filters(...ctl));
    view.append(h('p', { class: 'note', style: 'margin:-6px 0 14px' }, trainNote(joined)));
    if (F.pending && F.pending.length) view.append(callout(LXt`Script senza risultati salvati (da lanciare o in esecuzione): ${F.pending.join(', ')}.`, true));
    if (!F.configs.length) { view.append(emptyBox(LX('Nessun risultato ancora disponibile per queste reti.'), 'Quando gli script avranno finito, aggiorna la dashboard.')); return; }

    // --- in short
    const best = gdBest(F);
    const skills = F.configs.map(cf => gdVal(F, cf, 'skill', 'mean')).filter(v => v != null);
    const beat = skills.filter(v => v > 0).length;
    const perSeason = seasons.filter(s => best.seasons[s.key]).map(s => ({ s, v: exoSeasonVal(gdView(best.seasons[s.key]), 'mae') }));
    const easy = bestOf(perSeason, x => x.v), hard = bestOf(perSeason, x => x.v, true);
    view.append(sectionTitle(LX('In sintesi'), null, LXt`${F.configs.length} configurazioni provate su ${seasons.length} ${seasons.length === 1 ? LX('stagione') : LX('stagioni')}.`));
    view.append(h('div', { class: 'grid three' },
      tile(LX('Configurazione migliore'), `${best.id} · ${exoDesc(best)}`, fmt(gdVal(F, best, 'mae', 'mean'), 2), 'kW MAE',
        [h('span', null, LX('vs persistenza '), signed(gdVal(F, best, 'skill', 'mean'))), h('span', null, 'skill score ', signed(gdVal(F, best, 'ss', 'mean'))), fact('R²', fmt(gdVal(F, best, 'r2', 'mean'), 3)),
          F.configs.some(x => x.preferred && x !== best) ? fact('preferita', F.configs.filter(x => x.preferred).map(x => `${x.id} (${fmt(gdVal(F, x, 'mae', 'mean'), 2)} kW)`).join(', ')) : null], true),
      tile(LX('Battono la persistenza'), LX('in media sulle stagioni'), LXt`${beat} su ${skills.length}`, 'configurazioni',
        [fact(LX('miglioramento massimo'), fmtS(Math.max(...skills), 1) + ' %'), fact('minimo', fmtS(Math.min(...skills), 1) + ' %'),
          fact(LX('con skill score positivo'), LXt`${F.configs.filter(cf => gdVal(F, cf, 'ss', 'mean') > 0).length} su ${skills.length}`)]),
      easy && hard ? tile(LX('Differenze tra stagioni'), LXt`${best.id}: MAE nella stagione più facile e più difficile`, `${fmt(easy.v, 1)} – ${fmt(hard.v, 1)}`, 'kW',
        [fact(LX('più facile'), easy.s.label), fact(LX('più difficile'), hard.s.label)]) : null,
    ));

    // --- configurations compared
    const cellsList = cellsOf(F);
    const cells = cellsList.includes(Number(S.gdCells)) ? Number(S.gdCells) : cellsList[0];
    const seasonOpts = [{ value: 'mean', label: LXt`Media delle ${seasons.length} stagioni` }].concat(seasons.map(s => ({ value: s.key, label: s.label })));
    const sKey = seasons.some(s => s.key === S['gdMapSeason_' + fk]) ? S['gdMapSeason_' + fk] : 'mean';
    view.append(sectionTitle(LX('Confronto tra le configurazioni'), null, LX('Ogni casella è una combinazione di finestra (TH) e orizzonte (TL): a sinistra l\'errore della rete, a destra quanto migliora rispetto alla persistenza.')));
    view.append(filters(selectCtl(LX('Celle'), cellsList.map(n => ({ value: n, label: n + LX(' celle') })), cells, v => set('gdCells', Number(v))),
      selectCtl(LX('Stagione'), seasonOpts, sKey, v => set('gdMapSeason_' + fk, v))));
    const { ths, tls } = axesOf(cells, F);
    const g1 = h('div', { class: 'grid two' }); view.append(g1);
    const hm = chartDiv('short'), hp = chartDiv('short');
    const where = sKey === 'mean' ? LX('Media sulle stagioni, pesata con i giorni.') : seasonLabel(sKey) + '.';
    g1.append(card(LXt`${met.label} · ${cells} celle`, LXt`${where} TL e TH in passi da 5 minuti; — = combinazione non provata.`, hm));
    const rightIsPers = isSk(met.value);
    g1.append(card(rightIsPers ? LX('MAE della persistenza [kW]') : LX('Miglioramento rispetto alla persistenza [%]'),
      rightIsPers ? LX('Riferimento ingenuo: l\'ultimo valore noto (la misura di TL passi prima), sugli stessi campioni.') : LX('Riduzione del MAE rispetto all\'ultimo valore noto. Blu = la rete è migliore, rosso = peggiore.'), hp));
    gridHeat(hm, ths, tls, (th, tl) => { const cf = gdCfg(F, th, tl, cells); return cf ? gdVal(F, cf, met.value, sKey) : null; }, met, isSk(met.value), `${fk}_mappa`);
    if (rightIsPers) gridHeat(hp, ths, tls, (th, tl) => { const cf = gdCfg(F, th, tl, cells); return cf ? gdVal(F, cf, 'mae', sKey, true) : null; }, exoMetricDef('mae'), false, `${fk}_mappa_persistenza`);
    else gridHeat(hp, ths, tls, (th, tl) => { const cf = gdCfg(F, th, tl, cells); return cf ? gdVal(F, cf, 'skill', sKey) : null; }, exoMetricDef('skill'), true, `${fk}_mappa_miglioramento`);

    const cfK = 'gdCfg_' + fk, ssK = 'gdSeason_' + fk;
    const sum = F.configs.map(cf => ({ id: cf.id, th: cf.th, tl: cf.tl, cells: cf.cells, lr: cf.lr,
      mae: gdVal(F, cf, 'mae', 'mean'), mape: gdVal(F, cf, 'mape', 'mean'), wmape: gdVal(F, cf, 'wmape', 'mean'), r2: gdVal(F, cf, 'r2', 'mean'),
      pers: gdVal(F, cf, 'mae', 'mean', true), skill: gdVal(F, cf, 'skill', 'mean'), ss: gdVal(F, cf, 'ss', 'mean'), _hl: cf === best }));
    view.append(card(LX('Classifica (media delle stagioni)'), LX('Ordinata per MAE; la barra blu segna la migliore. Clicca su una configurazione per vederne il dettaglio qui sotto.'),
      table([{ key: 'id', label: LX('Configurazione'), render: r => linkBtn(r.id, () => { S[cfK] = r.id; save(); render(true); scrollToId('dettaglio'); }, LX('Mostra il dettaglio')) },
        { key: 'th', label: 'TH', num: true }, { key: 'tl', label: 'TL', num: true }, { key: 'cells', label: LX('Celle'), num: true },
        { key: 'mae', label: 'MAE [kW]', num: true, fmt: v => fmt(v, 2) }, { key: 'pers', label: LX('MAE persistenza'), num: true, fmt: v => fmt(v, 2) },
        { key: 'skill', label: LX('vs persistenza (MAE)'), num: true, render: r => signed(r.skill) },
        { key: 'ss', label: 'Skill score', num: true, render: r => signed(r.ss), title: LX('1 − Σ(misura − rete)² / Σ(misura − persistenza)²') }, { key: 'r2', label: 'R²', num: true, fmt: v => fmt(v, 3) },
        { key: 'mape', label: LX('MAPE diurno [%]'), num: true, fmt: v => fmt(v, 1) }, { key: 'wmape', label: 'wMAPE [%]', num: true, fmt: v => fmt(v, 1) },
        { key: 'lr', label: 'Learning rate', num: true }], sum, { sortKey: 'mae' })));

    // --- one configuration
    const pref = F.configs.find(x => x.preferred);
    const cf = F.configs.find(x => x.id === S[cfK]) || pref || best;
    const avail = seasons.filter(s => cf.seasons[s.key]);
    const sk = avail.some(s => s.key === S[ssK]) ? S[ssK] : (avail.find(s => s.key === 'Estate_3') || avail[0]).key;
    view.append(sectionTitle(LX('Dettaglio di una configurazione'), 'dettaglio', LX('Come si comporta una configurazione stagione per stagione, e nel tempo dentro il test.')));
    view.append(filters(
      selectCtl(LX('Configurazione'), F.configs.map(x => ({ value: x.id, label: x.id + (x === best ? LX(' · migliore') : '') + (x.preferred ? LX(' · preferita') : '') })), cf.id, v => set(cfK, v)),
      selectCtl(LX('Stagione'), avail.map(s => ({ value: s.key, label: s.label })), sk, v => set(ssK, v)),
      segCtl(LX('Asse orizzontale'), [{ value: 'samples', label: LX('Riga del foglio') }, { value: 'hours', label: LX('Ore (stima 5 min)') }], S.gdAxis, v => set('gdAxis', v)),
      checkCtl(LX('Misura traslata di 1 passo'), S.gdPers, v => set('gdPers', v)),
    ));
    const dsz = chartDiv('short');
    view.append(card(LXt`${met.label} stagione per stagione · ${cf.id}`, LXt`${exoDesc(cf)}. Clicca su una stagione per vederne il dettaglio qui sotto.`, dsz));
    const xs = avail.map(s => s.label);
    const sTr = [{ type: 'bar', name: 'LSTM', x: xs, y: avail.map(s => exoSeasonVal(gdView(cf.seasons[s.key]), met.value)), marker: { color: c[ROLE.model], opacity: avail.map(s => s.key === sk ? 1 : 0.45) } }];
    if (!isSk(met.value)) sTr.push({ type: 'bar', name: LXt`Persistenza (TL ${cf.tl})`, x: xs, y: avail.map(s => exoSeasonVal(gdView(cf.seasons[s.key]), met.value, true)), marker: { color: c.neutral } });
    sTr.forEach(t => { t.hovertemplate = `${t.name}<br>%{x}: <b>%{y:.${met.d}f} ${met.unit}</b><extra></extra>`; });
    plot(dsz, sTr, { barmode: 'group', showlegend: true, yaxis: { title: { text: met.label }, zeroline: true, zerolinecolor: c.axis } }, `${fk}_${cf.id}_stagioni`);
    dsz.on('plotly_click', ev => { const p = ev.points && ev.points[0]; const s = p && avail.find(x => x.label === p.x); if (s) set(ssK, s.key); });

    const raw = cf.seasons[sk], s = gdView(raw), m = s.metrics;
    view.append(h('div', { class: 'grid four' },
      tile(LX('MAE della rete'), `${cf.id} · ${seasonLabel(sk)}`, fmt(m.mae, 2), 'kW', [fact('RMSE', fmt(m.rmse, 2)), fact('R²', fmt(m.r2, 3)), fact('nMAE', fmt(exoSeasonVal(s, 'nmae'), 1) + ' %')]),
      tile(LX('Persistenza'), LXt`ultimo valore noto (${cf.tl} ${cf.tl === 1 ? LX('passo') : LX('passi')} prima)`, fmt(s.pers.mae, 2), 'kW', [h('span', null, LX('rete '), signed(exoSeasonVal(s, 'skill'))), fact('RMSE', fmt(s.pers.rmse, 2)), h('span', null, 'skill score ', signed(exoSeasonVal(s, 'ss')))]),
      tile(LX('Errori percentuali'), LX('ore diurne (> 5 % del massimo)'), fmt(m.mape_day, 1), '% MAPE', [fact('wMAPE', fmt(m.wmape_day, 1) + ' %')]),
      tile('Test', joined ? LXt`addestrata su ${raw.train.join(' + ')}` : LX('ultimo 20 % del foglio'), fmt(s.n_test, 0), LX('campioni'), [fact('su', fmt(raw.n_series, 0) + ' righe'),
        fact(LX('Potenza media della stagione'), fmt((GD_SHEET[sk] || {}).p_mean, 1) + ' kW')]),
    ));
    const sr = raw.series;
    const x = S.gdAxis === 'hours' ? sr.idx.map(i => (i - sr.idx[0]) * EXO.step_min / 60) : sr.idx;
    const xTitle = S.gdAxis === 'hours' ? LX('Ore dall\'inizio del test (stima, notti escluse)') : LX('Riga del foglio della stagione');
    const ts = chartDiv('tall');
    view.append(card(LX('Potenza misurata e prevista nel test'), LX('Le notti non sono nei dati: un giorno segue subito il precedente. All\'apertura è mostrato l\'inizio del test; usa la barra in basso per spostarti.') +
      (joined ? LX(' La linea verticale segna l\'inizio dell\'ultimo 20 %, cioè il test delle reti per stagione.') : ''), ts, explorerButton('exo', fk + ':' + cf.id, sk)));
    const tr2 = [lineT(x, sr.real, LX('Misurata'), c[ROLE.measured], { hovertemplate: LX('<b>%{y:.1f} kW</b> misurata<extra></extra>') }),
      lineT(x, sr.pred, LX('Prevista (LSTM)'), c[ROLE.model], { hovertemplate: '<b>%{y:.1f} kW</b> LSTM<extra></extra>' })];
    if (S.gdPers) tr2.push(lineT(x, sr.shift1, LX('Misura traslata di 1 passo (5 min)'), c[ROLE.pers], { line: { color: c[ROLE.pers], width: 1.5 }, hovertemplate: LX('<b>%{y:.1f} kW</b> misura 1 passo prima<extra></extra>') }));
    const win = Math.min(x.length - 1, 288);
    const lay = { hovermode: 'x unified', xaxis: { title: { text: xTitle }, range: [x[0], x[win]], rangeslider: { visible: true, thickness: 0.08, bgcolor: c.surface2, bordercolor: c.axis } },
      yaxis: { title: { text: LX('Potenza AC [kW]') }, rangemode: 'tozero' } };
    if (joined) {
      const xi = sr.idx.indexOf(raw.last20_first);
      if (xi >= 0) { const v = vline(x[xi], c.text2, LX('inizio ultimo 20 %'), 'right'); lay.shapes = [v.shape]; lay.annotations = [v.ann]; }
    }
    plot(ts, tr2, lay, `${fk}_${cf.id}_${sk}`);

    const g = h('div', { class: 'grid two' }); view.append(g);
    const dsc = chartDiv('square'), dl = chartDiv('square');
    g.append(card(LX('Previsione contro misura'), LX('Ogni punto è un campione di test (tutto il test salvato nel CSV); la retta è la previsione perfetta.'), dsc));
    const lagCard = card(LX('Analisi del ritardo'), null, dl); g.append(lagCard);
    const hi = Math.max(...sr.real, ...sr.pred);
    plot(dsc, [{ type: 'scattergl', mode: 'markers', x: sr.real, y: sr.pred, name: LX('Campioni'), marker: { size: 4, color: c[ROLE.model], opacity: 0.35 },
      hovertemplate: LX('Misurata %{x:.1f} kW<br><b>Prevista %{y:.1f} kW</b><extra></extra>') },
    lineT([0, hi], [0, hi], LX('Previsione perfetta'), c.muted, { line: { color: c.muted, width: 1 }, hoverinfo: 'skip' })],
    { showlegend: false, margin: { t: 16 }, xaxis: { title: { text: LX('Potenza misurata [kW]') }, range: [0, hi * 1.02] }, yaxis: { title: { text: LX('Potenza prevista [kW]') }, range: [0, hi * 1.02] } }, `${fk}_dispersione`);
    const k = lagChart(dl, sr.real, sr.pred, cf.tl, 'kW', LX('passi'));
    lagCard.querySelector('.card-head > div').append(h('p', { class: 'desc' },
      LXt`MAE tra la previsione e la misura spostata di k passi. Se il minimo è a k = TL, la rete ripete l'ultimo valore noto. Qui il minimo è a k = ${k}.`));

    // --- complete tables (built only when opened)
    view.append(sectionTitle(LX('Tabelle complete'), null, joined ? (S.gdSamples === 'last20' ? LX('Metriche sull\'ultimo 20 % dell\'anno 3 (stessi campioni delle reti per stagione).') : LX('Metriche su tutto il foglio dell\'anno 3.')) : LX('Tutte le configurazioni in tutte le stagioni.')));
    view.append(foldCard(LX('Metriche per configurazione e stagione'), LX('Ricalcolate dai file Risultati_<stagione>.csv con le stesse formule degli script.'), () => {
      const rows = [];
      for (const x2 of F.configs) for (const ss of seasons) {
        const e0 = x2.seasons[ss.key]; if (!e0) continue;
        const e = gdView(e0);
        rows.push({ cfg: x2.id, season: ss.label, n: e.n_test, mae: e.metrics.mae, rmse: e.metrics.rmse, r2: e.metrics.r2, mape: e.metrics.mape_day,
          wmape: e.metrics.wmape_day, pers: e.pers.mae, prmse: e.pers.rmse, skill: exoSeasonVal(e, 'skill'), ss: exoSeasonVal(e, 'ss'), src: e0.metrics.source, _hl: x2 === best });
      }
      return table([
        { key: 'cfg', label: LX('Configurazione') }, { key: 'season', label: LX('Stagione') }, { key: 'n', label: LX('Campioni test'), num: true },
        { key: 'mae', label: 'MAE [kW]', num: true, fmt: v => fmt(v, 2) }, { key: 'rmse', label: 'RMSE [kW]', num: true, fmt: v => fmt(v, 2) },
        { key: 'r2', label: 'R²', num: true, fmt: v => fmt(v, 3) }, { key: 'mape', label: LX('MAPE diurno [%]'), num: true, fmt: v => fmt(v, 1) },
        { key: 'wmape', label: 'wMAPE [%]', num: true, fmt: v => fmt(v, 1) }, { key: 'pers', label: LX('MAE persistenza'), num: true, fmt: v => fmt(v, 2) },
        { key: 'prmse', label: LX('RMSE persistenza'), num: true, fmt: v => fmt(v, 2) },
        { key: 'skill', label: LX('vs persistenza (MAE)'), num: true, render: r => signed(r.skill) },
        { key: 'ss', label: 'Skill score', num: true, render: r => signed(r.ss) }, { key: 'src', label: 'File' },
      ], rows, { scroll: true });
    }));
    view.append(foldCard(LX('Ritardo in tutte le stagioni'), LX('Per ogni configurazione e stagione, lo spostamento k con l\'errore minimo (su tutto il test salvato): k = 0 vuol dire previsione in fase, k = TL che la rete si comporta come la persistenza.'), () => {
      const lagRows = [];
      for (const x2 of F.configs) for (const ss of seasons) {
        const e0 = x2.seasons[ss.key]; if (!e0) continue;
        const { ks, m: mm } = lagCurve(e0.series.real, e0.series.pred, -6, x2.tl + 8);
        let b = 0; mm.forEach((v, i) => { if (v != null && (mm[b] == null || v < mm[b])) b = i; });
        lagRows.push({ cfg: x2.id, tl: x2.tl, season: ss.label, k: ks[b], m0: mm[ks.indexOf(0)], mk: mm[b], _hl: x2 === best });
      }
      return table([{ key: 'cfg', label: LX('Configurazione') }, { key: 'tl', label: LX('TL [passi]'), num: true }, { key: 'season', label: LX('Stagione') },
        { key: 'k', label: LX('k con MAE minimo'), num: true }, { key: 'm0', label: LX('MAE a k = 0 [kW]'), num: true, fmt: v => fmt(v, 2) },
        { key: 'mk', label: LX('MAE minimo [kW]'), num: true, fmt: v => fmt(v, 2) }], lagRows, { scroll: true });
    }));
  }

  // ================================================================== VIEW: Generation_data, all models compared
  function viewGDCompare() {
    const c = C();
    const mode = S.cmpMode === 'joined' ? 'joined' : 'sep', joined = mode === 'joined';
    const FN = GD[gdFam('endo', mode)], FX = GD[gdFam('exo', mode)];
    const met = exoMetricDef(S.cmpMetric);
    const higher = isSk(met.value) || met.value === 'r2';
    view.append(viewHead(DS_GD, LX('Confronto tra i modelli'),
      LX('LSTM esogena e LSTM endogena sullo stesso impianto. Le due reti prevedono la potenza da 1 a 6 passi avanti (da 5 a 30 minuti), con la potenza passata e il meteo misurato (esogena) o con la sola potenza passata (endogena).')));
    const ctl = [segCtl(LX('Addestramento delle LSTM'), TRAIN_SEG, mode, v => set('cmpMode', v)),
      selectCtl(LX('Metrica dei grafici'), EXO_METRICS, met.value, v => set('cmpMetric', v))];
    if (joined) ctl.push(segCtl(LX('Campioni di test'), SAMPLES_SEG, S.gdSamples, v => set('gdSamples', v)));
    view.append(filters(...ctl));
    view.append(h('p', { class: 'note', style: 'margin:-6px 0 14px' }, trainNote(joined)));
    if (!FN.configs.length || !FX.configs.length) { view.append(emptyBox(LX('Mancano i risultati di una delle due reti per questo confronto.'))); return; }

    // --- in short (MAE)
    const bx = gdBest(FX), bn = gdBest(FN);
    const pairs = FN.configs.map(a => [a, gdCfg(FX, a.th, a.tl, a.cells)]).filter(p => p[1]);
    const diffs = pairs.map(([a, b]) => { const ck = commonKeys(FN, a, b); return meanOn(ck, a, 'mae') - meanOn(ck, b, 'mae'); }).filter(v => v != null && isFinite(v));
    const exoWins = diffs.filter(d => d > 0).length;
    view.append(sectionTitle(LX('In sintesi'), null, LX('Errore assoluto medio (MAE) della configurazione migliore di ogni modello.')));
    view.append(h('div', { class: 'grid three' },
      tile(LX('LSTM esogena'), LXt`${bx.id} · previsione a ${bx.tl * EXO.step_min} min`, fmt(gdVal(FX, bx, 'mae', 'mean'), 2), 'kW MAE',
        [h('span', null, LX('vs persistenza '), signed(gdVal(FX, bx, 'skill', 'mean'))), h('span', null, 'skill score ', signed(gdVal(FX, bx, 'ss', 'mean'))), fact('R²', fmt(gdVal(FX, bx, 'r2', 'mean'), 3))]),
      tile(LX('LSTM endogena'), LXt`${bn.id} · previsione a ${bn.tl * EXO.step_min} min`, fmt(gdVal(FN, bn, 'mae', 'mean'), 2), 'kW MAE',
        [h('span', null, LX('vs persistenza '), signed(gdVal(FN, bn, 'skill', 'mean'))), h('span', null, 'skill score ', signed(gdVal(FN, bn, 'ss', 'mean'))), fact('R²', fmt(gdVal(FN, bn, 'r2', 'mean'), 3))]),
      diffs.length ? tile(LX('Esogena contro endogena'), LX('MAE endogena − esogena, a parità di TH, TL e celle'), fmtS(mean(diffs), 2), LX('kW in media'),
        [fact(LX('l\'esogena è migliore in'), LXt`${exoWins} su ${diffs.length}`)]) : null,
    ));
    // --- error vs horizon
    view.append(sectionTitle(LX('Errore al crescere dell\'orizzonte'), null, LX('Per ogni orizzonte TL, la configurazione migliore di ciascuna rete (TH e celle con il valore migliore) e la persistenza sugli stessi campioni dell\'esogena.')));
    const tlsAll = [...new Set(FN.configs.concat(FX.configs).map(x => x.tl))].sort((a, b) => a - b);
    const xl = tlsAll.map(t => `${t} ${t === 1 ? LX('passo') : LX('passi')} (${t * EXO.step_min} min)`);
    const atTl = (F, tl) => bestOf(F.configs.filter(x => x.tl === tl), cf => gdVal(F, cf, met.value, 'mean'), higher);
    const bxs = tlsAll.map(t => atTl(FX, t)), bns = tlsAll.map(t => atTl(FN, t));
    const hz = chartDiv('');
    const hzRows = tlsAll.map((t, i) => ({ tl: xl[i], exo: bxs[i] ? gdVal(FX, bxs[i], met.value, 'mean') : null, exoId: bxs[i] ? bxs[i].id : '—',
      endo: bns[i] ? gdVal(FN, bns[i], met.value, 'mean') : null, endoId: bns[i] ? bns[i].id : '—',
      pers: isSk(met.value) ? null : (bxs[i] || bns[i]) ? gdVal(bxs[i] ? FX : FN, bxs[i] || bns[i], met.value, 'mean', true) : null }));
    view.append(card(LXt`${met.label} per orizzonte`, LX('Passa il mouse (o tocca un punto) per leggere la configurazione usata.'),
      [hz, tableToggle(LX('Mostra i valori in tabella'), table([{ key: 'tl', label: LX('Orizzonte') },
        { key: 'exoId', label: LX('Esogena') }, { key: 'exo', label: met.label, num: true, fmt: v => fmt(v, met.d) },
        { key: 'endoId', label: LX('Endogena') }, { key: 'endo', label: met.label, num: true, fmt: v => fmt(v, met.d) },
        { key: 'pers', label: LX('Persistenza'), num: true, fmt: v => fmt(v, met.d) }], hzRows))]));
    const mkLine = (key, idKey, name, color, dash) => lineT(xl, hzRows.map(r => r[key]), name, color, { mode: 'lines+markers', line: { color, width: 2.5, dash },
      marker: { size: 9, color, line: { color: c.surface, width: 2 } }, customdata: hzRows.map(r => idKey ? r[idKey] : ''),
      hovertemplate: `${name}${idKey ? ' · %{customdata}' : ''}<br><b>%{y:.${met.d}f} ${met.unit}</b><extra></extra>` });
    const hzTr = [mkLine('exo', 'exoId', LX('LSTM esogena'), c.s1), mkLine('endo', 'endoId', LX('LSTM endogena'), c.s2)];
    if (!isSk(met.value)) hzTr.push(mkLine('pers', null, LX('Persistenza'), c.neutral, 'dot'));
    plot(hz, hzTr, { hovermode: 'closest', xaxis: { type: 'category', title: { text: LX('Orizzonte di previsione TL') } },
      yaxis: { title: { text: met.label }, rangemode: isSk(met.value) ? 'normal' : 'tozero', zeroline: isSk(met.value), zerolinecolor: c.axis } }, 'confronto_orizzonte');

    // --- skill score against persistence, by horizon
    view.append(sectionTitle(LX('Skill score rispetto alla persistenza'), 'skill', LX('Skill score = 1 − Σ(misura − rete)² / Σ(misura − persistenza)², sugli stessi campioni di test: 0 = come la persistenza, valori positivi = meglio, 100 % = previsione perfetta. Toglie l\'effetto della difficoltà della stagione e dell\'orizzonte, quindi permette di confrontare l\'esogena e l\'endogena in modo più corretto del solo errore in kW.')));
    const ssAt = (F, tl) => bestOf(F.configs.filter(x => x.tl === tl), cf => gdVal(F, cf, 'ss', 'mean'), true);
    const ssRows = tlsAll.map((t, i) => {
      const a = ssAt(FX, t), b = ssAt(FN, t);
      return { tl: xl[i], exoId: a ? a.id : '—', exo: a ? gdVal(FX, a, 'ss', 'mean') : null, exoMae: a ? gdVal(FX, a, 'skill', 'mean') : null,
        endoId: b ? b.id : '—', endo: b ? gdVal(FN, b, 'ss', 'mean') : null, endoMae: b ? gdVal(FN, b, 'skill', 'mean') : null };
    });
    const ssd = chartDiv('short');
    view.append(card(LX('Skill score per orizzonte'), LX('Per ogni orizzonte, la configurazione di ciascuna rete con lo skill score medio più alto (media sulle stagioni). Passa il mouse su una barra per leggere la configurazione.'),
      [ssd, tableToggle(LX('Mostra i valori in tabella'), table([{ key: 'tl', label: LX('Orizzonte') },
        { key: 'exoId', label: LX('Esogena') }, { key: 'exo', label: 'Skill score', num: true, render: r => signed(r.exo) }, { key: 'exoMae', label: LX('vs persistenza (MAE)'), num: true, render: r => signed(r.exoMae) },
        { key: 'endoId', label: LX('Endogena') }, { key: 'endo', label: 'Skill score', num: true, render: r => signed(r.endo) }, { key: 'endoMae', label: LX('vs persistenza (MAE)'), num: true, render: r => signed(r.endoMae) }], ssRows))]));
    plot(ssd, [['exo', 'exoId', LX('LSTM esogena'), c.s1], ['endo', 'endoId', LX('LSTM endogena'), c.s2]].map(([k, idk, name, col]) => ({ type: 'bar', name, x: xl,
      y: ssRows.map(r => r[k]), customdata: ssRows.map(r => r[idk]), marker: { color: col },
      hovertemplate: `${name} · %{customdata}<br><b>%{y:+.1f} %</b><extra></extra>` })),
    { barmode: 'group', xaxis: { type: 'category', title: { text: LX('Orizzonte di previsione TL') } },
      yaxis: { title: { text: LX('Skill score vs persistenza [%]') }, zeroline: true, zerolinecolor: c.text2, zerolinewidth: 1 } }, 'confronto_skill_score');

    // --- exogenous vs endogenous, same configuration
    view.append(sectionTitle(LX('Esogena contro endogena a parità di configurazione'), 'pari', LX('Stesse stagioni, stessi TH, TL e celle: cambia solo l\'ingresso. Le medie usano solo le stagioni che hanno entrambe le reti.')));
    const cellsList = cellsOf(FN, FX);
    const cells = cellsList.includes(Number(S.cmpCells)) ? Number(S.cmpCells) : (cellsList.includes(64) ? 64 : cellsList[0]);
    const seasons = FN.seasons.length ? FN.seasons : FX.seasons;
    const sKey = seasons.some(s => s.key === S.cmpSeason) ? S.cmpSeason : 'mean';
    view.append(filters(selectCtl(LX('Celle'), cellsList.map(n => ({ value: n, label: n + LX(' celle') })), cells, v => set('cmpCells', Number(v))),
      selectCtl(LX('Stagione'), [{ value: 'mean', label: LX('Media sulle stagioni in comune') }].concat(seasons.map(s => ({ value: s.key, label: s.label }))), sKey, v => set('cmpSeason', v))));
    const lrN = [...new Set(FN.configs.filter(x => x.cells === cells).map(x => x.lr))], lrX = [...new Set(FX.configs.filter(x => x.cells === cells).map(x => x.lr))];
    if (lrN.join() !== lrX.join() && lrN.length && lrX.length) view.append(callout(LXt`Attenzione: con ${cells} celle i learning rate non coincidono (endogena ${lrN.join(', ')}, esogena ${lrX.join(', ')}).`));
    const { ths, tls } = axesOf(cells, FN, FX);
    const pair = (th, tl) => [gdCfg(FN, th, tl, cells), gdCfg(FX, th, tl, cells)];
    const valOf = (F, cf, other) => {
      if (!cf) return null;
      if (sKey !== 'mean') return cf.seasons[sKey] ? exoSeasonVal(gdView(cf.seasons[sKey]), met.value) : null;
      return meanOn(commonKeys(F, cf, other), cf, met.value);
    };
    const g = h('div', { class: 'grid three' }); view.append(g);
    const dN = chartDiv('short'), dX = chartDiv('short'), dD = chartDiv('short');
    const diverg = isSk(met.value);
    g.append(card(LXt`Endogena · ${met.label}`, LXt`${cells} celle. — = combinazione non provata.`, dN));
    g.append(card(LXt`Esogena · ${met.label}`, LXt`${cells} celle.`, dX));
    g.append(card(LX('Vantaggio dell\'esogena'), LOWER_BETTER[met.value] ? LX('Endogena − esogena: positivo (blu) = l\'esogena sbaglia meno.') : LX('Esogena − endogena: positivo (blu) = l\'esogena è migliore.'), dD));
    gridHeat(dN, ths, tls, (th, tl) => { const [a, b] = pair(th, tl); return valOf(FN, a, b); }, met, diverg, 'confronto_endogena');
    gridHeat(dX, ths, tls, (th, tl) => { const [a, b] = pair(th, tl); return valOf(FX, b, a); }, met, diverg, 'confronto_esogena');
    gridHeat(dD, ths, tls, (th, tl) => { const [a, b] = pair(th, tl); return a && b ? advantage(met.value, valOf(FN, a, b), valOf(FX, b, a)) : null; }, met, true, 'confronto_differenza');

    const matched = pairs.map(p => p[0]);
    if (matched.length) {
      const pick = matched.find(x => x.id === S.cmpCfg) || matched[0];
      const b = gdCfg(FX, pick.th, pick.tl, pick.cells);
      const ck = commonKeys(FN, pick, b);
      const d = chartDiv('');
      view.append(card(LXt`Stagione per stagione · ${met.label}`, LX('Le due reti e la persistenza sugli stessi campioni di test.'), [
        h('div', { class: 'inline-ctl' }, selectCtl(LX('Configurazione'), matched.map(x => ({ value: x.id, label: x.id })), pick.id, v => set('cmpCfg', v))), d]));
      const xs = ck.map(seasonLabel);
      const tr = [
        { type: 'bar', name: LX('Endogena'), x: xs, y: ck.map(k => exoSeasonVal(gdView(pick.seasons[k]), met.value)), marker: { color: c.s2 } },
        { type: 'bar', name: LX('Esogena'), x: xs, y: ck.map(k => exoSeasonVal(gdView(b.seasons[k]), met.value)), marker: { color: c.s1 } }];
      if (!isSk(met.value)) tr.push({ type: 'bar', name: LXt`Persistenza (TL ${pick.tl})`, x: xs, y: ck.map(k => exoSeasonVal(gdView(pick.seasons[k]), met.value, true)), marker: { color: c.neutral } });
      tr.forEach(t => { t.hovertemplate = `${t.name}<br>%{x}: <b>%{y:.${met.d}f} ${met.unit}</b><extra></extra>`; });
      plot(d, tr, { barmode: 'group', yaxis: { title: { text: met.label }, zeroline: true, zerolinecolor: c.axis } }, 'confronto_per_stagione');
    }
    view.append(foldCard(LX('Tutte le combinazioni'), LX('MAE medio sulle stagioni in comune; "Δ" = MAE endogena − MAE esogena (positivo = l\'esogena sbaglia meno).'), () => {
      const rows = [];
      const keys = [...new Set(FN.configs.concat(FX.configs).map(x => `${x.th}|${x.tl}|${x.cells}`))];
      for (const kk of keys) {
        const [th, tl, ce] = kk.split('|').map(Number);
        const a = gdCfg(FN, th, tl, ce), b = gdCfg(FX, th, tl, ce);
        const ck = commonKeys(FN, a, b);
        const vn = a && b ? meanOn(ck, a, 'mae') : a ? gdVal(FN, a, 'mae', 'mean') : null;
        const vx = a && b ? meanOn(ck, b, 'mae') : b ? gdVal(FX, b, 'mae', 'mean') : null;
        rows.push({ cfg: `TH${th}-TL${tl}-${ce}`, n: a && b ? ck.length : null, endo: vn, exo: vx, d: a && b ? vn - vx : null,
          pers: a && b ? meanOn(ck, a, 'mae', true) : null, skn: a && b ? meanOn(ck, a, 'skill') : null, skx: a && b ? meanOn(ck, b, 'skill') : null,
          ssn: a && b ? meanOn(ck, a, 'ss') : null, ssx: a && b ? meanOn(ck, b, 'ss') : null,
          lrn: a ? a.lr : null, lrx: b ? b.lr : null, note: !a ? LX('solo esogena') : !b ? LX('solo endogena') : '' });
      }
      return table([{ key: 'cfg', label: LX('Configurazione') }, { key: 'n', label: LX('Stagioni in comune'), num: true },
        { key: 'endo', label: LX('MAE endogena [kW]'), num: true, fmt: v => fmt(v, 2) }, { key: 'exo', label: LX('MAE esogena [kW]'), num: true, fmt: v => fmt(v, 2) },
        { key: 'd', label: 'Δ [kW]', num: true, render: r => signed(r.d, 2, ' kW') }, { key: 'pers', label: LX('MAE persistenza'), num: true, fmt: v => fmt(v, 2) },
        { key: 'skn', label: LX('Endogena vs persistenza'), num: true, render: r => signed(r.skn) }, { key: 'skx', label: LX('Esogena vs persistenza'), num: true, render: r => signed(r.skx) },
        { key: 'ssn', label: LX('Skill score endogena'), num: true, render: r => signed(r.ssn) }, { key: 'ssx', label: LX('Skill score esogena'), num: true, render: r => signed(r.ssx) },
        { key: 'lrn', label: LX('lr endo'), num: true }, { key: 'lrx', label: LX('lr eso'), num: true }, { key: 'note', label: LX('Nota') }], rows, { sortKey: 'cfg' });
    }));

    // --- joined years vs single seasons, on the same samples
    view.append(sectionTitle(LX('Anni uniti contro stagioni separate'), 'anni', LX('Sull\'ultimo 20 % di ogni foglio dell\'anno 3: la rete addestrata solo sul primo 80 % di quel foglio contro la rete addestrata sugli anni 1 e 2 della stessa stagione. Stessi TH, TL e celle. Non dipende dai filtri in alto.')));
    const jr = [], agg = {};
    for (const b2 of ['endo', 'exo']) {
      const FS = GD[b2], FJ = GD[b2 + 'J'];
      for (const j of FJ.configs) {
        const sp = gdCfg(FS, j.th, j.tl, j.cells);
        for (const s of FJ.seasons) {
          const ej = j.seasons[s.key]; if (!ej) continue;
          const es = sp && sp.seasons[s.key];
          const row = { fam: b2 === 'endo' ? LX('Endogena') : LX('Esogena'), cfg: j.id, season: s.label, n: ej.n_last20, w: (GD_SHEET[s.key] || {}).days,
            sep: es ? es.metrics.mae : null, join: ej.m20.mae, d: es ? es.metrics.mae - ej.m20.mae : null, pers: ej.p20.mae,
            all: ej.metrics.mae, same: es ? es.n_test === ej.n_last20 : null };
          jr.push(row);
          if (row.d != null) { const kk = row.fam + '|' + j.id; (agg[kk] = agg[kk] || { fam: row.fam, cfg: j.id, tl: j.tl, th: j.th, list: [] }).list.push(row); }
        }
      }
    }
    if (!jr.length) { view.append(emptyBox(LX('Le reti con gli anni uniti non hanno ancora risultati salvati.'))); }
    else {
      const wm = (list, k) => wmean(list.map(r => [r[k], r.w]));
      const ag = Object.values(agg).map(a => ({ fam: a.fam, cfg: a.cfg, th: a.th, tl: a.tl, n: a.list.length, sep: wm(a.list, 'sep'), join: wm(a.list, 'join'),
        d: wm(a.list, 'd'), pers: wm(a.list, 'pers'), better: a.list.filter(r => r.d > 0).length }));
      const ids = [...new Set(ag.map(a => a.cfg))].sort((p, q) => { const A = ag.find(a => a.cfg === p), B = ag.find(a => a.cfg === q); return A.tl - B.tl || A.th - B.th; });
      const dj = chartDiv('short');
      view.append(card(LX('Guadagno degli anni uniti [kW]'), LX('MAE stagione separata − MAE anni uniti, in media sui fogli dell\'anno 3 (pesata con i giorni): positivo = addestrare su due anni riduce l\'errore.'), dj));
      const tj = [LX('Esogena'), LX('Endogena')].map((fam, i) => ({ type: 'bar', name: fam, x: ids, y: ids.map(id => { const a = ag.find(r => r.fam === fam && r.cfg === id); return a ? a.d : null; }),
        marker: { color: i ? c.s2 : c.s1 }, customdata: ids.map(id => { const a = ag.find(r => r.fam === fam && r.cfg === id); return a ? `${fmt(a.sep, 2)} → ${fmt(a.join, 2)} kW` : ''; }),
        hovertemplate: `${fam} · %{x}<br><b>%{y:+.2f} kW</b> (%{customdata})<extra></extra>` }));
      plot(dj, tj, { barmode: 'group', xaxis: { type: 'category', tickangle: -30 }, yaxis: { title: { text: LX('Riduzione del MAE [kW]') }, zeroline: true, zerolinecolor: c.text2 } }, 'anni_uniti_guadagno');
      view.append(foldCard(LX('Valori medi per configurazione'), LX('Medie sui fogli dell\'anno 3 che hanno entrambe le reti, pesate con i giorni di ogni foglio.'), table([
        { key: 'fam', label: LX('Rete') }, { key: 'cfg', label: LX('Configurazione') }, { key: 'n', label: LX('Fogli'), num: true },
        { key: 'sep', label: LX('MAE stagione separata'), num: true, fmt: v => fmt(v, 2) }, { key: 'join', label: LX('MAE anni uniti'), num: true, fmt: v => fmt(v, 2) },
        { key: 'd', label: 'Δ [kW]', num: true, render: r => signed(r.d, 2, ' kW') }, { key: 'better', label: LX('Fogli migliorati'), num: true, render: r => LXt`${r.better} su ${r.n}` },
        { key: 'pers', label: LX('MAE persistenza'), num: true, fmt: v => fmt(v, 2) }], ag, { sortKey: 'cfg' })));
      view.append(foldCard(LX('Foglio per foglio'), LX('"Tutto l\'anno 3" = MAE della rete ad anni uniti su tutto il foglio, non solo sull\'ultimo 20 %.'),
        table([{ key: 'fam', label: LX('Rete') }, { key: 'cfg', label: LX('Configurazione') }, { key: 'season', label: LX('Foglio') }, { key: 'n', label: LX('Campioni'), num: true },
          { key: 'sep', label: LX('MAE stagione separata'), num: true, fmt: v => fmt(v, 2) }, { key: 'join', label: LX('MAE anni uniti'), num: true, fmt: v => fmt(v, 2) },
          { key: 'd', label: 'Δ [kW]', num: true, render: r => signed(r.d, 2, ' kW') }, { key: 'pers', label: LX('MAE persistenza'), num: true, fmt: v => fmt(v, 2) },
          { key: 'all', label: LX('Anni uniti, tutto l\'anno 3'), num: true, fmt: v => fmt(v, 2) },
          { key: 'same', label: LX('Stessi campioni'), render: r => r.same == null ? '—' : r.same ? LX('sì') : 'no' }], jr, { scroll: true })));
    }

    // --- every model of the dataset
    view.append(sectionTitle(LX('Tutti i modelli di Generation data')));
    const all = overviewRows().filter(r => r.ds === DS_GD);
    view.append(foldCard(LXt`Tabella completa (${all.length} righe)`, LX('Tutte le configurazioni LSTM, con le stagioni separate e con gli anni uniti (queste ultime sull\'anno 3).'), table([
      { key: 'part', label: LX('Modello') }, { key: 'name', label: LX('Configurazione') }, { key: 'th', label: LX('Finestra (TH)') }, { key: 'tl', label: LX('Orizzonte (TL)') },
      { key: 'cells', label: LX('Celle / neuroni') }, { key: 'mae', label: 'MAE [kW]', num: true, fmt: v => fmt(v, 2) },
      { key: 'nmae', label: 'nMAE [%]', num: true, fmt: v => fmt(v, 1) },
      { key: 'skill', label: LX('vs persistenza (MAE)'), num: true, render: r => signed(r.skill) },
      { key: 'ss', label: 'Skill score', num: true, render: r => signed(r.ss) }, { key: 'r2', label: 'R²', num: true, fmt: v => fmt(v, 3) },
    ], all, { scroll: true })));
  }

  // ================================================================== VIEW: LSTM state carried on in the test ("stato aggiornato")
  const ST_METRICS = {
    gd: [{ value: 'mae', label: 'MAE [kW]', unit: 'kW', d: 2 }, { value: 'nmae', label: LX('nMAE sulla potenza media [%]'), unit: '%', d: 1 },
      { value: 'rmse', label: 'RMSE [kW]', unit: 'kW', d: 2 }],
    abr: [{ value: 'mae', label: 'MAE [kWh]', unit: 'kWh', d: 2 }, { value: 'nmae', label: LX('nMAE sulla potenza media, tutte le ore [%]'), unit: '%', d: 1 },
      { value: 'nmae_prod', label: LX('nMAE sulla potenza media, ore di produzione [%]'), unit: '%', d: 1 }, { value: 'rmse', label: 'RMSE [kWh]', unit: 'kWh', d: 2 }],
  };
  const ST_WHO = { o: LX('Rete originale'), 1: LX('Metodo 1'), 2: LX('Metodo 2'), p: LX('Persistenza') };
  function stCol(c, w) { return { o: c.s1, 1: c.s2, 2: c.s3, p: c.neutral }[w]; }
  // errors of one season; w = 'o' (original network), 'p' (persistence) or a method (1, 2). The original and the
  // persistence are measured on the rows of the new forecast, which are the same for both methods.
  function stBlock(n, w, key, samples) {
    const k = (w === 1 || w === 2) ? String(w) : (n.methods['1'] && n.methods['1'].seasons[key] ? '1' : '2');
    const e = n.methods[k] && n.methods[k].seasons[key];
    if (!e) return null;
    const f = (w === 'o' || w === 'p') ? w : 'm';
    if (samples === 'last20' && e.m20) return { m: e.m20, o: e.o20, p: e.p20 }[f];
    return e[f];
  }
  function stInfo(isAbr, key) { return (isAbr ? ABR_SINFO[key] : GD_SHEET[key]) || {}; }
  function stSeasonVal(isAbr, n, w, m, key, samples) {
    const b = stBlock(n, w, key, samples); if (!b) return null;
    const i = stInfo(isAbr, key);
    switch (m) {
      case 'mae': return b.mae; case 'rmse': return b.rmse;
      case 'nmae': return i.p_mean ? 100 * b.mae / i.p_mean : null;
      case 'nmae_prod': return i.p_mean_prod ? 100 * b.mae / i.p_mean_prod : null;
    }
    return null;
  }
  // mean over the seasons weighted by their days; nMAE = weighted MAE / mean power of those sheets together
  function stMean(isAbr, n, w, m, keys, samples) {
    const v = keys.map(k => stSeasonVal(isAbr, n, w, m === 'rmse' ? 'rmse' : 'mae', k, samples));
    if (v.some(x => x == null)) return null;
    const mae = wmean(keys.map((k, i) => [v[i], stInfo(isAbr, k).days]));
    if (m === 'mae' || m === 'rmse') return mae;
    const p = isAbr ? (m === 'nmae' ? pooledMean(ABR.seasons, 'p_mean', 'n_valid') : pooledMean(ABR.seasons, 'p_mean_prod', 'n_prod'))
      : pooledMean(keys.map(k => GD_SHEET[k]), 'p_mean', 'n');
    return mae == null || !p ? null : 100 * mae / p;
  }
  function stComplete(n, keys) { return ['1', '2'].every(k => n.methods[k] && keys.every(key => n.methods[k].seasons[key])); }
  function improve(v, ref) { return v == null || !ref ? null : 100 * (1 - v / ref); }

  function viewStato(ds) {
    const c = C();
    const isAbr = ds === 'abr';
    const base = S.stBase === 'endo' ? 'endo' : 'exo', mode = S.stMode === 'joined' ? 'joined' : 'sep';
    const fk = isAbr ? 'abr' : gdFam(base, mode), joined = !isAbr && mode === 'joined';
    const seasons = isAbr ? ABR_SEASONS : GD[fk].seasons;
    const keys = seasons.map(s => s.key);
    const samples = joined ? S.gdSamples : null;
    const fam = stFam(fk), nets = fam.nets;
    const mets = ST_METRICS[isAbr ? 'abr' : 'gd'];
    const met = mets.find(m => m.value === S['stMetric_' + ds]) || mets[0];
    const U = isAbr ? 'kWh' : 'kW';
    view.append(viewHead(isAbr ? DS_ABR : DS_GD, LX('Stato aggiornato nel test'),
      `Versioni delle reti con TL = ${isAbr ? LX('1 ora') : '1 passo (circa 5 minuti)'} in cui, nel test, la rete riceve un dato misurato alla volta e il suo stato interno prosegue da una previsione all'altra, invece di ripartire da zero a ogni finestra` +
      (isAbr ? LX(': lo stato scorre su tutta la stagione, notti comprese.') : LX(': lo stato scorre per tutta la giornata e riparte all\'inizio del giorno dopo, perché le notti non sono nei dati.')),
      'Metodo 1: addestramento come la rete originale, su finestre di TH passi sovrapposte che partono dallo stato zero. Metodo 2: addestramento su tratti consecutivi di TH passi, con lo stato che passa da un tratto al successivo e una previsione a ogni passo. Per entrambi si usa la rete dell\'epoca con l\'errore di validazione più basso (validazione = ultimo 10 % del periodo di training, non usato per addestrare); il periodo di test è quello della rete originale.'));
    const ctl = [];
    if (!isAbr) ctl.push(segCtl(LX('Rete'), [{ value: 'exo', label: LX('LSTM esogena') }, { value: 'endo', label: LX('LSTM endogena') }], base, v => set('stBase', v)),
      segCtl(LX('Addestramento'), TRAIN_SEG, mode, v => set('stMode', v)));
    if (joined) ctl.push(segCtl(LX('Campioni di test'), SAMPLES_SEG, S.gdSamples, v => set('gdSamples', v)));
    ctl.push(selectCtl(LX('Metrica'), mets, met.value, v => set('stMetric_' + ds, v)));
    view.append(filters(...ctl));
    view.append(h('p', { class: 'note', style: 'margin:-6px 0 14px' }, isAbr
      ? 'Rete originale, metodi 1 e 2 e persistenza sono confrontati sulle stesse ore di test. Le medie sulle stagioni sono pesate con i giorni di ogni stagione.'
      : trainNote(joined) + ' Rete originale, metodi 1 e 2 e persistenza sono confrontati sulle stesse righe: senza la prima riga di ogni giorno, che le nuove reti non possono prevedere perché a inizio giornata non hanno ancora nessun dato di quel giorno.'));
    const ready = nets.filter(n => stComplete(n, keys));
    const pending = fam.scripts.filter(id => !ready.some(n => n.id === id));
    if (pending.length) view.append(callout(`Script _stato_aggiornato senza risultati completi (non lanciati o ancora in esecuzione): ${pending.join(', ')}.`, true));
    if (!nets.length) { view.append(emptyBox(LX('Nessun risultato ancora disponibile per queste reti.'), 'Quando gli script _stato_aggiornato avranno finito, aggiorna la dashboard.')); return; }

    // --- in short
    const val = (n, w) => stMean(isAbr, n, w, met.value, keys, samples);
    const rows = nets.map(n => {
      const o = val(n, 'o'), m1 = val(n, 1), m2 = val(n, 2), p = val(n, 'p');
      return { n, id: n.id, th: n.th, cells: n.cells, o, m1, m2, p, d1: improve(m1, o), d2: improve(m2, o), _hl: n.preferred };
    });
    const full = rows.filter(r => r.o != null && r.m1 != null && r.m2 != null);
    view.append(sectionTitle(LX('In sintesi'), null, `${ready.length} ${ready.length === 1 ? LX('rete') : LX('reti')} su ${fam.scripts.length} con entrambi i metodi completi. Valori medi sulle stagioni, pesati con i giorni.`));
    const tileFor = k => {
      const d = full.map(r => (k === 1 ? r.d1 : r.d2));
      const better = d.filter(x => x > 0).length;
      const top = bestOf(full, r => (k === 1 ? r.d1 : r.d2), true);
      return tile(LXt`Metodo ${k} rispetto alla rete originale`, k === 1 ? 'finestre sovrapposte, stato che prosegue nel test' : LX('finestre consecutive, stato che passa avanti anche nel training'),
        full.length ? LXt`${better} su ${full.length}` : '—', LX('reti con errore più basso'),
        full.length ? [h('span', null, LX('riduzione media dell\'errore '), signed(mean(d))),
          top ? h('span', null, LXt`caso migliore ${top.id} `, signed(k === 1 ? top.d1 : top.d2)) : null] : [], better > 0);
    };
    const cands = rows.flatMap(r => [['o', r.o], [1, r.m1], [2, r.m2]].filter(x => x[1] != null).map(([w, v]) => ({ r, w, v })));
    const top = bestOf(cands, x => x.v);
    view.append(h('div', { class: 'grid three' }, tileFor(1), tileFor(2),
      tile(LX('Errore più basso'), top ? `${top.r.id} · ${ST_WHO[top.w]}` : '', top ? fmt(top.v, met.d) : '—', met.unit,
        top ? [fact('persistenza', fmt(top.r.p, met.d) + ' ' + met.unit), fact('metrica', met.label)] : [])));

    // --- networks compared
    const nK = 'stNet_' + fk, sK = 'stSeason_' + fk;
    view.append(card(LXt`Confronto per rete · ${met.label}`, 'Media delle stagioni pesata con i giorni; tutte le reti hanno TL = 1. "vs originale" = riduzione dell\'errore rispetto alla rete originale (positivo = la nuova versione sbaglia meno). Clicca su una rete per vederne il dettaglio qui sotto.',
      table([
        { key: 'id', label: LX('Rete'), render: r => linkBtn(r.id + (r.n.preferred ? ' ★' : ''), () => { S[nK] = r.id; save(); render(true); scrollToId('st-dettaglio'); }, LX('Mostra il dettaglio')) },
        { key: 'th', label: 'TH', num: true }, { key: 'cells', label: LX('Celle'), num: true },
        { key: 'o', label: LX('Rete originale'), num: true, fmt: v => fmt(v, met.d) },
        { key: 'm1', label: LX('Metodo 1'), num: true, fmt: v => fmt(v, met.d) },
        { key: 'm2', label: LX('Metodo 2'), num: true, fmt: v => fmt(v, met.d) },
        { key: 'p', label: LX('Persistenza'), num: true, fmt: v => fmt(v, met.d) },
        { key: 'd1', label: LX('M1 vs originale'), num: true, render: r => signed(r.d1), title: LX('Riduzione dell\'errore rispetto alla rete originale') },
        { key: 'd2', label: LX('M2 vs originale'), num: true, render: r => signed(r.d2), title: LX('Riduzione dell\'errore rispetto alla rete originale') },
      ], rows, { sortKey: 'th' })));

    // --- one network
    const n = nets.find(x => x.id === S[nK]) || ready.find(x => x.preferred) || ready[0] || nets[0];
    const has = (k, key) => !!(n.methods[k] && n.methods[k].seasons[key]);
    const avail = seasons.filter(s => has('1', s.key) || has('2', s.key));
    if (!avail.length) return;
    const sk = avail.some(s => s.key === S[sK]) ? S[sK] : (avail.find(s => s.key === (isAbr ? 'Estate2021' : 'Estate_3')) || avail[0]).key;
    view.append(sectionTitle(LX('Dettaglio di una rete'), 'st-dettaglio', LX('Errore stagione per stagione, andamento dell\'errore durante l\'addestramento e previsioni nel test.')));
    view.append(filters(
      selectCtl(LX('Rete'), nets.map(x => ({ value: x.id, label: x.id + (x.preferred ? LX(' · preferita') : '') + (stComplete(x, keys) ? '' : LX(' · incompleta')) })), n.id, v => set(nK, v)),
      selectCtl(LX('Stagione'), avail.map(s => ({ value: s.key, label: s.label })), sk, v => set(sK, v)),
      checkCtl(LX('Mostra l\'errore medio dei mini-batch'), S.stMb, v => set('stMb', v))));
    const bars = chartDiv('short');
    view.append(card(LXt`${met.label} stagione per stagione · ${n.id}`, `Script ${n.script || '—'} (rete di partenza ${n.original || '—'}). Clicca su una stagione per vederne il dettaglio qui sotto.`, bars));
    const xs = avail.map(s => s.label);
    const bt = ['o', 1, 2, 'p'].map(w => {
      const name = w === 'p' ? LXt`Persistenza (TL ${n.tl})` : ST_WHO[w];
      return { type: 'bar', name, x: xs, y: avail.map(s => stSeasonVal(isAbr, n, w, met.value, s.key, samples)),
        marker: { color: stCol(c, w), opacity: avail.map(s => (s.key === sk ? 1 : 0.5)) },
        hovertemplate: `${name}<br>%{x}: <b>%{y:.${met.d}f} ${met.unit}</b><extra></extra>` };
    });
    plot(bars, bt, { barmode: 'group', showlegend: true, yaxis: { title: { text: met.label } } }, `stato_${fk}_${n.id}_stagioni`);
    bars.on('plotly_click', ev => { const p = ev.points && ev.points[0]; const s = p && avail.find(x => x.label === p.x); if (s) set(sK, s.key); });

    const e1 = has('1', sk) ? n.methods['1'].seasons[sk] : null, e2 = has('2', sk) ? n.methods['2'].seasons[sk] : null;
    const any = e1 || e2;
    const v = w => stSeasonVal(isAbr, n, w, 'mae', sk, samples);
    const vO = v('o'), vP = v('p');
    const mTile = (k, e) => {
      const vk = v(k);
      return tile(LXt`Metodo ${k}`, e ? LXt`epoca usata ${e.best} di ${e.ep ? e.ep.tr.length : '—'}` : LX('non ancora disponibile'), fmt(vk, 2), U + ' MAE',
        e ? [h('span', null, LX('vs originale '), signed(improve(vk, vO))), h('span', null, LX('vs persistenza '), signed(improve(vk, vP)))] : [], vk != null && vO != null && vk < vO);
    };
    const nUsed = joined && samples === 'last20' && any.n20 != null ? any.n20 : any.n;
    view.append(h('div', { class: 'grid four' },
      tile(LX('Rete originale'), `${n.id} · ${seasonLabel(sk)}`, fmt(vO, 2), U + ' MAE', [h('span', null, LX('vs persistenza '), signed(improve(vO, vP)))]),
      mTile(1, e1), mTile(2, e2),
      tile(LX('Campioni confrontati'), joined && samples === 'last20' ? LX('ultimo 20 % dell\'anno 3') : (isAbr ? LX('ore di test') : LX('righe di test con previsione')), fmt(nUsed, 0), '',
        [fact(LX('righe del test'), fmt(any.n_tot, 0)), fact('persistenza', fmt(vP, 2) + ' ' + U)])));

    // error per epoch
    const ec = chartDiv();
    view.append(card(LXt`Errore durante l'addestramento · ${seasonLabel(sk)}`,
      `MAE in ${U} alla fine di ogni epoca, calcolato con lo stato che prosegue come nel test. Linea continua = training, tratteggiata = validazione; la stella segna l'epoca usata. Se la validazione risale mentre il training continua a scendere, la rete sta andando in overfitting; se restano alte entrambe, in underfitting.`, ec));
    const et = [];
    let nEp = 0;
    for (const [k, e] of [[1, e1], [2, e2]]) {
      if (!e || !e.ep) continue;
      const x = e.ep.tr.map((_, i) => i + 1), col = stCol(c, k);
      nEp = Math.max(nEp, x.length);
      et.push(lineT(x, e.ep.tr, LXt`Metodo ${k} · training`, col, { hovertemplate: `Metodo ${k} · training · epoca %{x}: <b>%{y:.2f} ${U}</b><extra></extra>` }));
      et.push(lineT(x, e.ep.va, LXt`Metodo ${k} · validazione`, col, { line: { color: col, width: 2, dash: 'dash' }, hovertemplate: `Metodo ${k} · validazione · epoca %{x}: <b>%{y:.2f} ${U}</b><extra></extra>` }));
      if (S.stMb) et.push(lineT(x, e.ep.mb, LXt`Metodo ${k} · media dei mini-batch`, col, { line: { color: col, width: 1, dash: 'dot' }, hovertemplate: `Metodo ${k} · mini-batch · epoca %{x}: <b>%{y:.2f} ${U}</b><extra></extra>` }));
      if (e.best) et.push({ type: 'scatter', mode: 'markers', x: [e.best], y: [e.ep.va[e.best - 1]], showlegend: false,
        marker: { symbol: 'star', size: 14, color: col, line: { color: c.surface, width: 1 } }, hovertemplate: `Metodo ${k}: epoca usata %{x}<br>validazione <b>%{y:.2f} ${U}</b><extra></extra>` });
    }
    if (!et.length) ec.replaceWith(emptyBox(LX('Errore per epoca non disponibile per questa stagione.')));
    else {
      const lay = { hovermode: 'closest', xaxis: { title: { text: LX('Epoca') }, dtick: 5 }, yaxis: { title: { text: `MAE [${U}]` } } };
      if (nEp > 20) { const vl = vline(20.5, c.muted, LX('learning rate × 0,2'), 'right'); lay.shapes = [vl.shape]; lay.annotations = [vl.ann]; }
      plot(ec, et, lay, `stato_${fk}_${n.id}_${sk}_epoche`);
    }

    // forecasts in the test
    let xT = null, real = null, orig = null;
    const preds = {};
    if (isAbr) {
      const oc = ABR.configs.find(x => x.id === n.id), os = oc && oc.seasons[sk] && oc.seasons[sk].series;
      if (os) { xT = os.t; real = os.real; orig = os.pred; }
      for (const k of ['1', '2']) { const cf = ST_ABR.find(x => x.id === `${n.id} · M${k}`); const s = cf && cf.seasons[sk] && cf.seasons[sk].series; if (s) preds[k] = s.pred; }
    } else {
      for (const k of ['1', '2']) {
        const cf = ST_GD[fk + 'S'].configs.find(x => x.id === `${n.id} · M${k}`), s = cf && cf.seasons[sk] && cf.seasons[sk].series;
        if (s) { preds[k] = s.pred; if (!xT) { xT = s.idx; real = s.real; } }
      }
      const oc = GD[fk].configs.find(x => x.id === n.id), os = oc && oc.seasons[sk] && oc.seasons[sk].series;
      if (os && xT) { const at = new Map(os.idx.map((i, j) => [i, os.pred[j]])); orig = xT.map(i => (at.has(i) ? at.get(i) : null)); }
    }
    if (xT) {
      const tsd = chartDiv('tall');
      view.append(card(LXt`${isAbr ? LX('Energia') : LX('Potenza')} misurata e prevista nel test · ${seasonLabel(sk)}`,
        (isAbr ? LX('Ore reali dal file Excel.') : LX('Le notti non sono nei dati: un giorno segue subito il precedente; la prima riga di ogni giorno non ha previsione nelle nuove reti.')) + LX(' Usa la barra in basso per spostarti; nell\'esploratore puoi scegliere la finestra e leggere gli errori sui soli campioni visibili.'),
        tsd, h('button', { type: 'button', class: 'ghost-btn', onclick: () => openStatoInExplorer(isAbr, fk, n, sk) }, LX('Apri nell\'esploratore'))));
      const tr = [lineT(xT, real, LX('Misurata'), c.text1, { hovertemplate: LXt`<b>%{y:.1f} ${U}</b> misurata<extra></extra>` })];
      if (orig) tr.push(lineT(xT, orig, LX('Rete originale'), stCol(c, 'o'), { line: { color: stCol(c, 'o'), width: 1.5 }, hovertemplate: LXt`<b>%{y:.1f} ${U}</b> rete originale<extra></extra>` }));
      for (const k of ['1', '2']) if (preds[k]) tr.push(lineT(xT, preds[k], LXt`Metodo ${k}`, stCol(c, Number(k)), { line: { color: stCol(c, Number(k)), width: 1.5 }, hovertemplate: LXt`<b>%{y:.1f} ${U}</b> metodo ${k}<extra></extra>` }));
      const win = Math.min(xT.length - 1, isAbr ? 72 : 288);
      const lay = { hovermode: 'x unified', xaxis: { range: [xT[0], xT[win]], rangeslider: { visible: true, thickness: 0.08, bgcolor: c.surface2, bordercolor: c.axis },
        title: { text: isAbr ? '' : LX('Riga del foglio della stagione') } }, yaxis: { title: { text: isAbr ? LX('Energia [kWh]') : LX('Potenza AC [kW]') }, rangemode: 'tozero' } };
      if (isAbr) { lay.xaxis.type = 'date'; lay.xaxis.tickformat = '%d/%m %H:%M'; }
      plot(tsd, tr, lay, `stato_${fk}_${n.id}_${sk}_test`);
    }

    // --- complete table
    view.append(sectionTitle(LX('Tabella completa'), null, LX('Tutte le reti in tutte le stagioni, con l\'epoca usata da ogni metodo.')));
    view.append(foldCard(LX('Errori per rete e stagione'), `MAE in ${U}, per ogni riga sulle stesse ore o righe del test. Fonti: Risultati_<stagione>.csv ed Errore_per_epoca_<stagione>.csv nelle cartelle …_stato_aggiornato_metodo1 e …_metodo2.`, () => {
      const rs = [];
      for (const x of nets) for (const s of seasons) {
        const a = x.methods['1'] && x.methods['1'].seasons[s.key], b = x.methods['2'] && x.methods['2'].seasons[s.key];
        if (!a && !b) continue;
        const g = w => stSeasonVal(isAbr, x, w, 'mae', s.key, samples), e = a || b;
        rs.push({ net: x.id, season: s.label, o: g('o'), m1: g(1), m2: g(2), p: g('p'), b1: a ? a.best : null, b2: b ? b.best : null,
          n: joined && samples === 'last20' && e.n20 != null ? e.n20 : e.n, nt: e.n_tot, _hl: x === n });
      }
      return table([{ key: 'net', label: LX('Rete') }, { key: 'season', label: LX('Stagione') },
        { key: 'o', label: LX('Rete originale'), num: true, fmt: v2 => fmt(v2, 2) }, { key: 'm1', label: LX('Metodo 1'), num: true, fmt: v2 => fmt(v2, 2) },
        { key: 'm2', label: LX('Metodo 2'), num: true, fmt: v2 => fmt(v2, 2) }, { key: 'p', label: LX('Persistenza'), num: true, fmt: v2 => fmt(v2, 2) },
        { key: 'b1', label: LX('Epoca M1'), num: true }, { key: 'b2', label: LX('Epoca M2'), num: true },
        { key: 'n', label: LX('Campioni confrontati'), num: true }, { key: 'nt', label: LX('Righe del test'), num: true }], rs, { scroll: true });
    }));
  }

  // ================================================================== VIEW: explorer (whole test sets)
  let expRange = null;            // current x window [a, b] (not saved between sessions)
  let expKey = null;              // model|season|unit the window belongs to
  function pad2(n) { return String(n).padStart(2, '0'); }
  function msOf(s) { return new Date(String(s).replace(' ', 'T')).getTime(); }   // naive local time, as Plotly
  function strOf(ms) { const d = new Date(ms); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
  function openInExplorer(model, cfgId, season) {
    S.expModel = model;
    const selKey = model === 'abr' ? 'expCfgsAbr' : 'expCfgsExo', slotKey = model === 'abr' ? 'expSlotsAbr' : 'expSlotsExo';
    if (model === 'abr') S.expSeasonAbr = season; else S.expSeasonExo = season;
    if (!S[selKey].includes(cfgId)) {
      if (S[selKey].length >= 4) { const old = S[selKey].shift(); delete S[slotKey][old]; }
      S[selKey].push(cfgId);
    }
    expRange = null; expKey = null; save();
    go(model === 'abr' ? 'abruzzo/esplora' : 'gd/esplora');
  }
  function explorerButton(model, cfgId, season) {
    return h('button', { type: 'button', class: 'ghost-btn', onclick: () => openInExplorer(model, cfgId, season) }, LX('Apri nell\'esploratore'));
  }

  const GD_GROUP = { exo: LX('Esogena · stagioni separate'), endo: LX('Endogena · stagioni separate'), exoJ: LX('Esogena · anni uniti (solo fogli dell\'anno 3)'), endoJ: LX('Endogena · anni uniti (solo fogli dell\'anno 3)'),
    exoS: 'Esogena · stagioni separate · stato aggiornato (M1, M2)', endoS: 'Endogena · stagioni separate · stato aggiornato (M1, M2)',
    exoJS: 'Esogena · anni uniti · stato aggiornato (M1, M2)', endoJS: 'Endogena · anni uniti · stato aggiornato (M1, M2)' };
  const EXP_GD_FAMS = ['exo', 'endo', 'exoJ', 'endoJ', 'exoS', 'endoS', 'exoJS', 'endoJS'];
  function stGdAll() {
    return ['exoS', 'endoS', 'exoJS', 'endoJS'].flatMap(fk => ST_GD[fk].configs.map(cf => Object.assign({}, cf, { id: fk + ':' + cf.id, label: GD_TAG[fk] + ' ' + cf.id })));
  }
  // explorer with the original network and its two "stato aggiornato" versions of one season
  function openStatoInExplorer(isAbr, fk, n, season) {
    const ids = isAbr ? [n.id, `${n.id} · M1`, `${n.id} · M2`] : [`${fk}:${n.id}`, `${fk}S:${n.id} · M1`, `${fk}S:${n.id} · M2`];
    S.expModel = isAbr ? 'abr' : 'exo';
    if (isAbr) { S.expSeasonAbr = season; S.expCfgsAbr = ids; S.expSlotsAbr = {}; } else { S.expSeasonExo = season; S.expCfgsExo = ids; S.expSlotsExo = {}; }
    expRange = null; expKey = null; save();
    go(isAbr ? 'abruzzo/esplora' : 'gd/esplora');
  }
  function viewExplorer(model) {
    const c = C();
    S.expModel = model;
    const isAbr = model === 'abr';
    const cfgList = isAbr ? ABR.configs.concat(ST_ABR) : gdAll().concat(stGdAll());
    const seasons = isAbr ? ABR_SEASONS : EXO_SEASONS;
    const seasonKey = isAbr ? S.expSeasonAbr : S.expSeasonExo;
    const selKey = isAbr ? 'expCfgsAbr' : 'expCfgsExo', slotKey = isAbr ? 'expSlotsAbr' : 'expSlotsExo';
    const hasSeries = cf => !!(cf && cf.seasons[seasonKey] && cf.seasons[seasonKey].series);
    const slotCols = [c.s1, c.s2, c.s3, c.s4];
    const sel = S[selKey].filter(id => hasSeries(cfgList.find(x => x.id === id)));
    for (const id of Object.keys(S[slotKey])) if (!sel.includes(id)) delete S[slotKey][id];
    for (const id of sel) if (S[slotKey][id] == null) { const used = Object.values(S[slotKey]); S[slotKey][id] = [0, 1, 2, 3].find(k => !used.includes(k)); }
    const key = S.expModel + '|' + seasonKey + '|' + S.expUnit;
    if (key !== expKey) { expRange = null; expKey = key; }

    view.append(viewHead(isAbr ? DS_ABR : DS_GD, LX('Esplora il test'),
      LX('L\'intero periodo di test di una stagione, con le previsioni salvate nei CSV. 1) Scegli la stagione e fino a quattro configurazioni da sovrapporre. 2) Scegli la finestra con i campi "dal / al", i pulsanti rapidi o trascinando sulla barra sotto il grafico. 3) Leggi gli errori calcolati solo sulla finestra visibile.')));

    // --- selection row
    const alertBox = h('span', { class: 'note', hidden: true }, LX('Al massimo quattro configurazioni insieme: togline una prima di aggiungerne un\'altra.'));
    const chipBox = h('div', { class: 'chip-groups' });
    const groupsOf = isAbr
      ? [{ key: 'abr', label: ST_ABR.length ? LX('Reti originali') : null, list: ABR.configs },
        { key: 'abrS', label: 'Stato aggiornato nel test (M1 = metodo 1, M2 = metodo 2)', list: ST_ABR }].filter(gp => gp.list.length)
      : EXP_GD_FAMS.map(fk => ({ key: fk, label: GD_GROUP[fk], list: cfgList.filter(cf => cf.id.startsWith(fk + ':')) })).filter(gp => gp.list.length);
    for (const gp of groupsOf) {
    const chips = h('div', { class: 'cfg-chips', role: 'group', 'aria-label': gp.label || LX('Configurazioni') });
    chipBox.append(h('div', { class: 'chip-group' }, gp.label ? h('span', { class: 'chip-group-label' }, gp.label) : null, chips));
    for (const cf of gp.list) {
      const ok = hasSeries(cf), on = sel.includes(cf.id);
      const sw = on ? h('span', { class: 'swatch', style: `background:${slotCols[S[slotKey][cf.id]]}` }) : null;
      chips.append(h('button', { type: 'button', class: 'chip-toggle', 'aria-pressed': String(on), disabled: !ok,
        title: ok ? (on ? LX('Togli dal grafico') : LX('Aggiungi al grafico')) : LX('Previsioni non salvate per questa stagione'),
        onclick: () => {
          const arr = S[selKey];
          if (arr.includes(cf.id)) { arr.splice(arr.indexOf(cf.id), 1); delete S[slotKey][cf.id]; }
          else if (sel.length >= 4) { alertBox.hidden = false; return; }
          else arr.push(cf.id);
          save(); render(true);
        } }, sw, (isAbr ? cf.id : cf.id.split(':')[1]) + (cf.preferred ? ' ★' : '')));
    }
    }
    view.append(filters(
      selectCtl(LX('Stagione'), seasons.map(s => ({ value: s.key, label: s.label })), seasonKey, v => set(isAbr ? 'expSeasonAbr' : 'expSeasonExo', v)),
      checkCtl(isAbr ? LX('Misura traslata di 1 h') : LX('Misura traslata di 1 passo'), S.expPers, v => set('expPers', v)),
      isAbr ? checkCtl(LX('Stessa ora di ieri'), S.expYest, v => set('expYest', v)) : null,
      checkCtl(LX('Pannello dell\'errore'), S.expErr, v => set('expErr', v)),
      !isAbr ? segCtl(LX('Asse orizzontale'), [{ value: 'samples', label: LX('Riga del foglio') }, { value: 'minutes', label: LX('Minuti (stima 5 min)') }], S.expUnit, v => set('expUnit', v)) : null,
    ));
    view.append(card(LX('Configurazioni da sovrapporre'), LX('Fino a quattro insieme. ★ = configurazione preferita; sono disattivate quelle senza previsioni salvate per la stagione scelta') + (isAbr ? '.' : LX(' (le reti ad anni uniti esistono solo sui fogli dell\'anno 3).')), [chipBox, alertBox]));
    if (!sel.length) {
      view.append(emptyBox(isAbr && !ABR.configs.some(abrHasCsv)
        ? 'Le previsioni dell\'Abruzzo non sono ancora salvate: rilancia gli script in MATLAB e poi aggiorna la dashboard.'
        : LX('Seleziona almeno una configurazione con previsioni salvate.')));
      return;
    }

    // --- series
    const cfgs = sel.map(id => cfgList.find(x => x.id === id));
    const sers = cfgs.map(cf => cf.seasons[seasonKey].series);
    const firstX = s => isAbr ? msOf(s.t[0]) : s.idx[0];
    let ei = 0;
    sers.forEach((s, i) => { if (firstX(s) < firstX(sers[ei])) ei = i; });
    const base = sers[ei];
    const idx0 = isAbr ? null : base.idx[0];
    const xOf = s => isAbr ? s.t : S.expUnit === 'minutes' ? s.idx.map(i => (i - idx0) * EXO.step_min) : s.idx;
    const xNum = s => isAbr ? s.t.map(msOf) : xOf(s);
    const unitY = isAbr ? 'kWh' : 'kW';
    const err = S.expErr;
    const traces = [lineT(xOf(base), base.real, LX('Misurata'), c.text1, { line: { color: c.text1, width: 2 }, hovertemplate: LXt`<b>%{y:.1f} ${unitY}</b> misurata<extra></extra>` })];
    const tls = [...new Set(cfgs.map(cf => cf.tl))];
    const tlsRef = isAbr ? tls.filter(t => t <= ABR_PERS_MAX_TL) : tls;     // persistence used as a reference in the table
    const nm = cf => cf.label || cf.id;
    if (S.expPers) traces.push(lineT(xOf(base), base.shift1, isAbr ? LX('Misura traslata di 1 h') : LX('Misura traslata di 1 passo (5 min)'), c.neutral,
      { line: { color: c.neutral, width: 1.5 }, hovertemplate: LXt`<b>%{y:.1f} ${unitY}</b> misura 1 passo prima<extra></extra>` }));
    if (isAbr && S.expYest) traces.push(lineT(xOf(base), base.yest, LX('Stessa ora di ieri'), c.muted,
      { line: { color: c.muted, width: 1.5, dash: 'dot' }, hovertemplate: LX('<b>%{y:.1f} kWh</b> ieri<extra></extra>') }));
    cfgs.forEach((cf, i) => traces.push(lineT(xOf(sers[i]), sers[i].pred, nm(cf), slotCols[S[slotKey][cf.id]],
      { hovertemplate: `<b>%{y:.1f} ${unitY}</b> ${nm(cf)}<extra></extra>` })));
    if (err) cfgs.forEach((cf, i) => traces.push(lineT(xOf(sers[i]),
      sers[i].pred.map((p, j) => p == null || sers[i].real[j] == null ? null : p - sers[i].real[j]),
      LX('Errore ') + nm(cf), slotCols[S[slotKey][cf.id]], { yaxis: 'y2', showlegend: false, line: { color: slotCols[S[slotKey][cf.id]], width: 1.5 },
        hovertemplate: LXt`errore <b>%{y:+.1f} ${unitY}</b> ${nm(cf)}<extra></extra>` })));

    // --- default window
    const allX = xNum(base), xmin = allX[0], xmax = allX[allX.length - 1];
    const toAxis = v => isAbr ? strOf(v) : v;
    if (!expRange) expRange = isAbr ? [xmin, Math.min(xmax, xmin + 3 * 864e5)]
      : [xmin, Math.min(xmax, xmin + (S.expUnit === 'minutes' ? 288 * EXO.step_min : 288))];

    // --- window controls
    const step = isAbr ? 36e5 : S.expUnit === 'minutes' ? EXO.step_min : 1;
    const fromIn = h('input', { type: isAbr ? 'datetime-local' : 'number', step: isAbr ? 3600 : step, class: 'in', 'aria-label': LX('Inizio della finestra') });
    const toIn = h('input', { type: isAbr ? 'datetime-local' : 'number', step: isAbr ? 3600 : step, class: 'in', 'aria-label': LX('Fine della finestra') });
    const fmtIn = v => isAbr ? strOf(v).replace(' ', 'T') : String(Math.round(v));
    const parseIn = s => isAbr ? msOf(s) : Number(s);
    fromIn.min = toIn.min = fmtIn(xmin); fromIn.max = toIn.max = fmtIn(xmax);
    const quick = isAbr
      ? [[LX('6 ore'), 6 * 36e5], [LX('12 ore'), 12 * 36e5], [LX('1 giorno'), 864e5], [LX('3 giorni'), 3 * 864e5], [LX('1 settimana'), 7 * 864e5]]
      : (S.expUnit === 'minutes'
        ? [[LX('1 ora'), 60], [LX('3 ore'), 180], [LX('12 ore (≈ 1 giorno di luce)'), 720], [LX('3 giorni'), 2160]]
        : [[LX('1 ora (12)'), 12], [LX('3 ore (36)'), 36], [LX('≈ 1 giorno (144)'), 144], [LX('3 giorni (432)'), 432]]);
    const chart = chartDiv('xl');
    const statsWrap = h('div');
    function applyRange(a, b, fromPlot) {
      if (!isFinite(a) || !isFinite(b)) return;
      a = Math.max(xmin, Math.min(a, xmax)); b = Math.max(xmin, Math.min(b, xmax));
      if (b <= a) b = Math.min(xmax, a + step);
      expRange = [a, b];
      fromIn.value = fmtIn(a); toIn.value = fmtIn(b);
      if (!fromPlot) Plotly.relayout(chart, { 'xaxis.range': [toAxis(a), toAxis(b)] });
      renderStats();
    }
    const winRow = h('div', { class: 'filters' },
      h('label', { class: 'ctl' }, h('span', null, isAbr ? LX('Dal') : 'Da'), fromIn),
      h('label', { class: 'ctl' }, h('span', null, isAbr ? 'Al' : 'A'), toIn),
      h('div', { class: 'ctl' }, h('span', { class: 'ctl-spacer', 'aria-hidden': 'true' }), h('button', { type: 'button', class: 'ghost-btn', onclick: () => applyRange(parseIn(fromIn.value), parseIn(toIn.value)) }, LX('Applica'))),
      h('div', { class: 'ctl' }, h('span', null, LX('Durata della finestra (dall\'inizio attuale)')),
        h('div', { class: 'seg' }, quick.map(([l, d]) => h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => applyRange(expRange[0], expRange[0] + d) }, l)),
          h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => applyRange(xmin, xmax) }, LX('Tutto il test')))),
      h('div', { class: 'ctl' }, h('span', null, LX('Sposta la finestra')),
        h('div', { class: 'seg' },
          h('button', { type: 'button', onclick: () => { const w = expRange[1] - expRange[0]; applyRange(expRange[0] - w, expRange[0]); } }, LX('◀ indietro')),
          h('button', { type: 'button', onclick: () => { const w = expRange[1] - expRange[0]; applyRange(expRange[1], expRange[1] + w); } }, LX('avanti ▶')))),
    );
    [fromIn, toIn].forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') applyRange(parseIn(fromIn.value), parseIn(toIn.value)); }));
    view.append(winRow);
    const csvBtn = h('button', { type: 'button', class: 'ghost-btn', onclick: () => downloadWindow() }, LX('Scarica i dati della finestra (CSV)'));
    view.append(card(LXt`${isAbr ? LX('Energia') : LX('Potenza')} nel test · ${seasonLabel(seasonKey)}`,
      isAbr ? LX('Ore reali dal file Excel. Doppio clic sul grafico per tornare all\'intero test.')
        : LX('Le notti non sono nei dati: un giorno segue subito il precedente. I minuti sono una stima (passo di 5 minuti). Doppio clic per tornare all\'intero test.'),
      chart, csvBtn));
    view.append(card(LX('Errori nella finestra selezionata'), LX('Calcolati solo sui campioni visibili nel grafico; si aggiornano quando sposti o ingrandisci la finestra.'), statsWrap));

    const yTitle = isAbr ? LX('Energia [kWh]') : LX('Potenza AC [kW]');
    const xTitle = isAbr ? '' : S.expUnit === 'minutes' ? LX('Minuti dall\'inizio del test (stima)') : LX('Riga del foglio della stagione');
    const layout = {
      hovermode: 'x unified', margin: { t: 36, b: 40 },
      xaxis: { type: isAbr ? 'date' : 'linear', range: [toAxis(expRange[0]), toAxis(expRange[1])], anchor: err ? 'y2' : 'y',
        title: { text: xTitle }, rangeslider: { visible: true, thickness: 0.06, bgcolor: c.surface2, bordercolor: c.axis } },
      yaxis: { title: { text: yTitle }, domain: err ? [0.31, 1] : [0, 1], rangemode: 'tozero' },
    };
    if (isAbr) layout.xaxis.tickformat = '%d/%m %H:%M';
    if (err) layout.yaxis2 = Object.assign(axis(c), { title: { text: LX('Errore [') + unitY + ']', font: { color: c.text2, size: 12 }, standoff: 10 },
      domain: [0, 0.24], zeroline: true, zerolinecolor: c.text2 });
    plot(chart, traces, layout, `esplora_${S.expModel}_${seasonKey}`);
    chart.on('plotly_relayout', ev => {
      let a = ev['xaxis.range[0]'], b = ev['xaxis.range[1]'];
      if (Array.isArray(ev['xaxis.range'])) [a, b] = ev['xaxis.range'];
      if (ev['xaxis.autorange']) { a = toAxis(xmin); b = toAxis(xmax); }
      if (a == null || b == null) return;
      applyRange(isAbr ? msOf(a) : Number(a), isAbr ? msOf(b) : Number(b), true);
    });

    // --- window statistics and CSV
    const xs = sers.map(xNum);
    function inWin(x) { return x >= expRange[0] && x <= expRange[1]; }
    function stats(xArr, real, pred) {
      let n = 0, sa = 0, s2 = 0, sb = 0, sr = 0;
      for (let i = 0; i < xArr.length; i++) {
        if (!inWin(xArr[i]) || pred[i] == null || real[i] == null) continue;
        const e = pred[i] - real[i]; n++; sa += Math.abs(e); s2 += e * e; sb += e; sr += real[i];
      }
      return n ? { n, mae: sa / n, rmse: Math.sqrt(s2 / n), bias: sb / n, mean: sr / n, wmape: sr ? 100 * sa / sr : null } : { n: 0 };
    }
    function renderStats() {
      const rows = [];
      cfgs.forEach((cf, i) => rows.push(Object.assign({ name: nm(cf), col: slotCols[S[slotKey][cf.id]], _hl: cf.preferred }, stats(xs[i], sers[i].real, sers[i].pred))));
      tlsRef.forEach(tl => { const i = cfgs.findIndex(cf => cf.tl === tl); rows.push(Object.assign({ name: LXt`Persistenza (ultimo valore noto, TL ${tl})`, col: c.neutral }, stats(xs[i], sers[i].real, sers[i].pers))); });
      rows.push(Object.assign({ name: isAbr ? LX('Misura traslata di 1 h (solo riferimento visivo)') : LX('Misura traslata di 1 passo (solo riferimento visivo)'), col: c.neutral }, stats(xs[ei], base.real, base.shift1)));
      if (isAbr) rows.push(Object.assign({ name: LX('Stessa ora di ieri'), col: c.muted }, stats(xs[ei], base.real, base.yest)));
      const span = isAbr ? `${strOf(expRange[0])} → ${strOf(expRange[1])}`
        : `${fmt(expRange[0], 0)} → ${fmt(expRange[1], 0)} ${S.expUnit === 'minutes' ? 'min' : LX('(righe del foglio)')}`;
      statsWrap.textContent = '';
      statsWrap.append(h('p', { class: 'note', style: 'margin:0 0 8px' }, LX('Finestra: ') + span),
        table([
          { key: 'name', label: LX('Serie'), render: r => h('span', null, h('span', { class: 'swatch', style: `background:${r.col}` }), r.name) },
          { key: 'n', label: LX('Campioni'), num: true },
          { key: 'mae', label: `MAE [${unitY}]`, num: true, fmt: v => fmt(v, 2) },
          { key: 'rmse', label: `RMSE [${unitY}]`, num: true, fmt: v => fmt(v, 2) },
          { key: 'bias', label: LX('Errore medio'), num: true, fmt: v => fmtS(v, 2) },
          { key: 'wmape', label: 'wMAPE [%]', num: true, fmt: v => fmt(v, 1), title: LX('Somma degli errori assoluti / somma delle misure nella finestra') },
          { key: 'mean', label: LXt`Misura media [${unitY}]`, num: true, fmt: v => fmt(v, 1) },
        ], rows));
    }
    function downloadWindow() {
      const head = [isAbr ? 'Timestamp' : (S.expUnit === 'minutes' ? LX('Minuti') : 'RigaFoglio'), LX('Misurata')];
      const toMap = (xArr, vals) => { const m = new Map(); xArr.forEach((x, j) => m.set(x, vals[j])); return m; };
      const maps = cfgs.map((cf, i) => { head.push(nm(cf)); return toMap(xs[i], sers[i].pred); });
      const pmaps = tlsRef.map(tl => { head.push(`Persistenza_TL${tl}`); const i = cfgs.findIndex(cf => cf.tl === tl); return toMap(xs[i], sers[i].pers); });
      if (isAbr) head.push('StessaOraIeri');
      const lines = [head.join(';')];
      const bx = xs[ei], bxLabel = xOf(base);
      for (let j = 0; j < bx.length; j++) {
        if (!inWin(bx[j])) continue;
        const row = [bxLabel[j], base.real[j]].concat(maps.map(m => m.get(bx[j])), pmaps.map(m => m.get(bx[j])));
        if (isAbr) row.push(base.yest[j]);
        lines.push(row.map(v => v == null ? '' : String(v).replace('.', ',')).join(';'));
      }
      const blob = new Blob([String.fromCharCode(0xFEFF) + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const a = h('a', { href: URL.createObjectURL(blob), download: `finestra_${S.expModel}_${seasonKey}.csv` });
      document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    }
    fromIn.value = fmtIn(expRange[0]); toIn.value = fmtIn(expRange[1]);
    renderStats();
  }

  // ================================================================== VIEW: architectures
  const SVGNS = 'http://www.w3.org/2000/svg';
  function sv(tag, attrs, ...kids) {
    const e = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v != null) e.setAttribute(k, v);
    for (const kid of kids.flat(Infinity)) { if (kid == null || kid === false) continue; e.append(kid instanceof Node ? kid : document.createTextNode(String(kid))); }
    return e;
  }
  const LAYER_ROLE = { featureInputLayer: 'input', sequenceInputLayer: 'input', lstmLayer: 'lstm', fullyConnectedLayer: 'fc',
    batchNormalizationLayer: 'bn', reluLayer: 'act', dropoutLayer: 'act', regressionLayer: 'out' };
  const ROLE_NAME = { input: LX('Ingresso'), lstm: 'LSTM', fc: LX('Completamente connesso'), bn: LX('Normalizzazione batch'), act: LX('Attivazione'), out: LX('Uscita') };
  function roleColor(c, r) { return { input: c.neutral, lstm: c.s1, fc: c.s2, bn: c.s3, act: c.s4, out: c.text2 }[r] || c.neutral; }
  function plural(n, one, many) { return n === 1 ? one : many; }

  function archNets() {
    const nets = [];
    for (const c2 of ABR.configs) if (c2.arch) nets.push({ group: 'abr', id: c2.id, label: c2.id + (c2.preferred ? ' (preferita)' : ''), kind: 'lstm', arch: c2.arch,
      inputs: c2.arch.inputs, th: c2.th, tl: c2.tl, unit: 'h', stepName: LX("un passo = un'ora"), target: LXt`Energia dell'ora t + ${c2.tl} [kWh]`,
      split: LXt`${Math.round((c2.frac || 0.9) * 100)} / ${100 - Math.round((c2.frac || 0.9) * 100)} % cronologica (addestramento / test), un modello per stagione`,
      script: c2.script, seed: LX("rng('default') prima di ogni stagione") });
    for (const c2 of EXO.configs) if (c2.arch) nets.push({ group: 'exo', id: c2.id, label: c2.id + (c2.preferred ? ' (preferita)' : ''), kind: 'lstm', arch: c2.arch,
      inputs: c2.arch.inputs, th: c2.th, tl: c2.tl, unit: LX('passi'), stepName: LX('un passo ≈ 5 minuti, stima'), target: LXt`Potenza AC al passo t + ${c2.tl} [kW]`,
      split: LXt`${Math.round((c2.frac || 0.8) * 100)} / ${100 - Math.round((c2.frac || 0.8) * 100)} % cronologica (addestramento / test), un modello per stagione`,
      script: c2.script, seed: LX("rng('default') prima di ogni stagione") });
    for (const fk of ['endo', 'exoJ', 'endoJ']) for (const c2 of GD[fk].configs) if (c2.arch) nets.push({ group: fk, id: c2.id, label: c2.id, kind: 'lstm', arch: c2.arch,
      inputs: c2.arch.inputs, th: c2.th, tl: c2.tl, unit: LX('passi'), stepName: LX('un passo ≈ 5 minuti, stima'), target: LXt`Potenza AC al passo t + ${c2.tl} [kW]`,
      split: GD[fk].joined ? LX('addestramento sugli anni 1 + 2 della stagione, test su tutto il foglio dell\'anno 3 (normalizzazione sui soli dati di addestramento)')
        : LXt`${Math.round((c2.frac || 0.8) * 100)} / ${100 - Math.round((c2.frac || 0.8) * 100)} % cronologica (addestramento / test), un modello per stagione`,
      script: c2.script, seed: LX("rng('default') prima di ogni stagione") });
    return nets;
  }

  // ---- block diagram (one row per layer, top to bottom)
  function blockDiagram(net) {
    const c = C();
    const items = [];
    const L = net.arch.layers;
    L.forEach((ly, i) => {
      const role = LAYER_ROLE[ly.type] || 'act';
      let title = '', detail = '';
      if (ly.type === 'featureInputLayer') { title = LXt`Ingresso · ${ly.size} ${plural(ly.size, LX('variabile'), LX('variabili'))}`; detail = net.inputs.join(', '); }
      else if (ly.type === 'sequenceInputLayer') { title = LXt`Ingresso · sequenza di ${net.th} ${net.unit} × ${ly.size} ${plural(ly.size, LX('canale'), LX('canali'))}`; detail = net.inputs.join(', '); }
      else if (ly.type === 'lstmLayer') { title = LXt`LSTM · ${ly.size} unità nascoste`; detail = LXt`${ly.output_mode === 'last' ? LX("restituisce solo lo stato dell'ultimo passo") : LX('restituisce tutta la sequenza')} · ${fmt(ly.params, 0)} parametri (4 porte)`; }
      else if (ly.type === 'fullyConnectedLayer') { title = LXt`Completamente connesso · ${ly.size} ${plural(ly.size, LX('neurone'), LX('neuroni'))}`; detail = LXt`${ly.input} × ${ly.size} pesi + ${ly.size} bias = ${fmt(ly.params, 0)} parametri`; }
      else if (ly.type === 'batchNormalizationLayer') { title = LX('Normalizzazione batch'); detail = LXt`${ly.size} canali · ${fmt(ly.params, 0)} parametri (scala e scostamento)`; }
      else if (ly.type === 'reluLayer') { title = LX('Attivazione ReLU'); detail = LX('max(0, x) · nessun parametro'); }
      else if (ly.type === 'regressionLayer') { title = LXt`Uscita · ${net.target}`; detail = LX('durante l\'addestramento calcola la perdita MSE'); }
      else { title = ly.type; detail = ''; }
      items.push({ role, title, detail, small: role === 'bn' || role === 'act', out: ly.size, type: ly.type });
    });
    if (!L.some(ly => ly.type === 'regressionLayer')) {
      items.push({ role: 'out', title: LXt`Uscita · ${net.target}`, detail: LXt`durante l'addestramento minimizza la perdita ${(net.arch.loss || '').toUpperCase()}`, small: false, out: 1, type: 'out' });
    }
    const W = 600, bx = 70, bw = 460, gap = 36;
    let y = 10;
    const g = sv('g');
    const defs = sv('defs', null, sv('marker', { id: 'arr', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' },
      sv('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: c.muted })));
    items.forEach((it, i) => {
      const hgt = it.small ? 44 : 62;
      const col = roleColor(c, it.role);
      g.append(sv('rect', { x: bx, y, width: bw, height: hgt, rx: 10, fill: col, 'fill-opacity': c.dark ? 0.22 : 0.12, stroke: col, 'stroke-width': 1.5 }));
      g.append(sv('rect', { x: bx, y, width: 6, height: hgt, rx: 3, fill: col }));
      g.append(sv('text', { x: bx + 20, y: y + (it.small ? 19 : 25), fill: c.text1, 'font-size': it.small ? 13 : 14.5, 'font-weight': 650, 'font-family': FONT }, it.title));
      g.append(sv('text', { x: bx + 20, y: y + (it.small ? 35 : 46), fill: c.text2, 'font-size': 12, 'font-family': FONT }, it.detail.length > 74 ? it.detail.slice(0, 72) + '…' : it.detail,
        it.detail.length > 74 ? sv('title', null, it.detail) : null));
      y += hgt;
      if (i < items.length - 1) {
        g.append(sv('line', { x1: bx + bw / 2, y1: y + 2, x2: bx + bw / 2, y2: y + gap - 4, stroke: c.muted, 'stroke-width': 1.5, 'marker-end': 'url(#arr)' }));
        let lab = '';
        if (it.type === 'sequenceInputLayer') lab = LXt`${net.th} passi × ${it.out}`;
        else if (it.type === 'lstmLayer') lab = LXt`${it.out} valori (stato finale h)`;
        else if (it.out != null) lab = `${it.out} ${plural(it.out, LX('valore'), LX('valori'))}`;
        g.append(sv('text', { x: bx + bw / 2 + 12, y: y + gap / 2 + 4, fill: c.muted, 'font-size': 12, 'font-family': FONT }, lab));
        y += gap;
      }
    });
    const H = y + 10;
    return sv('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', style: `max-width:${W}px;display:block;margin:0 auto`, role: 'img',
      'aria-label': LXt`Schema dei livelli di ${net.label}` }, defs, g);
  }

  // ---- neurons and connections (feed-forward nets)
  function neuronGraph(net) {
    const c = C();
    const fcs = net.arch.layers.filter(l => l.type === 'fullyConnectedLayer');
    const cols = [{ n: net.inputs.length, role: 'input', cap: [LX('Ingresso'), LXt`${net.inputs.length} variabili`] }];
    fcs.forEach((l, i) => {
      const idx = net.arch.layers.indexOf(l);
      const after = net.arch.layers.slice(idx + 1, net.arch.layers.indexOf(fcs[i + 1]) === -1 ? undefined : net.arch.layers.indexOf(fcs[i + 1])).map(x => x.type);
      const last = i === fcs.length - 1;
      const extras = [after.includes('batchNormalizationLayer') ? 'BN' : null, after.includes('reluLayer') ? 'ReLU' : null].filter(Boolean).join(' + ');
      cols.push({ n: l.size, role: last ? 'out' : 'fc', cap: last ? [LX('Uscita'), `${l.size} ${plural(l.size, LX('neurone'), LX('neuroni'))}`] : [LXt`Nascosto ${i + 1}`, LXt`${l.size} neuroni${extras ? ' · ' + extras : ''}`] });
    });
    const W = 860, H = 400, top = 30, bottom = 300, MAXN = 9;
    const xs = cols.map((_, i) => 150 + i * ((W - 300) / Math.max(1, cols.length - 1)));
    const pos = cols.map((col, i) => {
      const shown = col.n <= MAXN ? [...Array(col.n).keys()] : [0, 1, 2, 3, -1, col.n - 3, col.n - 2, col.n - 1];
      const step = (bottom - top) / Math.max(1, shown.length - 1 || 1);
      return shown.map((k, j) => ({ k, x: xs[i], y: shown.length === 1 ? (top + bottom) / 2 : top + j * step }));
    });
    const g = sv('g');
    for (let i = 0; i < pos.length - 1; i++) for (const a of pos[i]) for (const b of pos[i + 1]) {
      if (a.k < 0 || b.k < 0) continue;
      g.append(sv('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: c.dark ? c.muted : c.axis, 'stroke-width': 0.7, 'stroke-opacity': c.dark ? 0.45 : 0.8 }));
    }
    pos.forEach((col, i) => {
      const color = roleColor(c, cols[i].role);
      for (const p of col) {
        if (p.k < 0) { g.append(sv('text', { x: p.x, y: p.y + 5, 'text-anchor': 'middle', fill: c.muted, 'font-size': 18, 'font-family': FONT }, '⋮')); continue; }
        g.append(sv('circle', { cx: p.x, cy: p.y, r: 10, fill: color, stroke: c.surface, 'stroke-width': 2 }));
      }
      g.append(sv('text', { x: xs[i], y: bottom + 38, 'text-anchor': 'middle', fill: c.text1, 'font-size': 12.5, 'font-weight': 650, 'font-family': FONT }, cols[i].cap[0]));
      g.append(sv('text', { x: xs[i], y: bottom + 56, 'text-anchor': 'middle', fill: c.text2, 'font-size': 11.5, 'font-family': FONT }, cols[i].cap[1]));
    });
    pos[0].forEach((p, j) => { if (p.k >= 0) g.append(sv('text', { x: p.x - 18, y: p.y + 4, 'text-anchor': 'end', fill: c.text2, 'font-size': 12, 'font-family': FONT }, net.inputs[p.k] || '')); });
    const lastCol = pos[pos.length - 1];
    lastCol.forEach(p => { if (p.k >= 0) g.append(sv('text', { x: p.x + 18, y: p.y + 4, fill: c.text2, 'font-size': 12, 'font-family': FONT }, 'P' + String.fromCharCode(0x302) + ' [kW]')); });
    return sv('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', style: `max-width:${W}px;display:block;margin:0 auto`, role: 'img', 'aria-label': LXt`Neuroni e collegamenti di ${net.label}` }, g);
  }

  // ---- LSTM unrolled in time
  function unrolledLSTM(net) {
    const c = C();
    const lstm = net.arch.layers.find(l => l.type === 'lstmLayer');
    const fc = net.arch.layers.find(l => l.type === 'fullyConnectedLayer');
    const C_in = net.arch.layers[0].size, N = lstm.size, TH = net.th, TL = net.tl, u = net.unit === 'h' ? ' h' : '';
    const lab = k => k === 0 ? 't' : `t − ${k}${u}`;
    const span = n => net.unit === 'h' ? `${n} h` : `${n} ${plural(n, LX('passo'), LX('passi'))}`;
    const slots = TH <= 4 ? [...Array(TH).keys()].reverse().map(k => ({ k })) : [{ k: TH - 1 }, { k: TH - 2 }, { gap: true }, { k: 1 }, { k: 0 }];
    const W = 1060, x0 = 20, sw = 126, cellY = 64, inY = 176, bw = 88, H = inY + 118;
    const g = sv('g');
    g.add = (...parts) => g.append(...parts.flat(Infinity).filter(Boolean));
    const defs = sv('defs', null, sv('marker', { id: 'arr2', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' },
      sv('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: c.muted })));
    const colL = roleColor(c, 'lstm'), colI = roleColor(c, 'input'), colF = roleColor(c, 'fc'), colO = roleColor(c, 'out');
    const box = (x, y, w, h, col, t1, t2) => [
      sv('rect', { x, y, width: w, height: h, rx: 9, fill: col, 'fill-opacity': c.dark ? 0.22 : 0.12, stroke: col, 'stroke-width': 1.5 }),
      sv('text', { x: x + w / 2, y: y + (t2 ? h / 2 - 3 : h / 2 + 5), 'text-anchor': 'middle', fill: c.text1, 'font-size': 13.5, 'font-weight': 650, 'font-family': FONT }, t1),
      t2 ? sv('text', { x: x + w / 2, y: y + h / 2 + 14, 'text-anchor': 'middle', fill: c.text2, 'font-size': 11.5, 'font-family': FONT }, t2) : null];
    const arrow = (x1, y1, x2, y2, label, lx, ly) => [
      sv('line', { x1, y1, x2, y2, stroke: c.muted, 'stroke-width': 1.5, 'marker-end': 'url(#arr2)' }),
      label ? sv('text', { x: lx, y: ly, 'text-anchor': 'middle', fill: c.muted, 'font-size': 11, 'font-family': FONT }, label) : null];
    const cx = slots.map((_, i) => x0 + i * sw);
    slots.forEach((s, i) => {
      const x = cx[i];
      if (s.gap) {
        g.append(sv('text', { x: x + bw / 2, y: cellY + 34, 'text-anchor': 'middle', fill: c.muted, 'font-size': 22, 'font-family': FONT }, '…'));
        g.append(sv('text', { x: x + bw / 2, y: inY + 30, 'text-anchor': 'middle', fill: c.muted, 'font-size': 22, 'font-family': FONT }, '…'));
        if (i < slots.length - 1) g.add(arrow(x + bw * 0.75, cellY + 26, cx[i + 1] - 4, cellY + 26));
        return;
      }
      g.add(box(x, cellY, bw, 52, colL, 'LSTM', LXt`${N} unità`));
      g.add(box(x, inY, bw, 46, colI, lab(s.k), C_in === 1 ? LX('1 valore') : LXt`${C_in} valori`));
      g.add(arrow(x + bw / 2, inY - 2, x + bw / 2, cellY + 56));
      if (i < slots.length - 1) g.add(arrow(x + bw + 2, cellY + 26, cx[i + 1] - 4, cellY + 26, i === 0 ? LX('stato h, c') : null, x + bw + (sw - bw) / 2, cellY - 6));
    });
    // same weights note
    g.append(sv('text', { x: x0, y: cellY - 34, fill: c.text2, 'font-size': 12, 'font-family': FONT }, LX('La stessa cella (stessi pesi) viene applicata a ogni passo e aggiorna il suo stato.')));
    // window bracket
    const xl = cx[0], xr = cx[slots.length - 1] + bw;
    g.append(sv('path', { d: `M ${xl} ${inY + 62} v 8 H ${xr} v -8`, fill: 'none', stroke: c.text2, 'stroke-width': 1.2 }));
    g.append(sv('text', { x: xl, y: inY + 88, fill: c.text1, 'font-size': 12.5, 'font-weight': 600, 'font-family': FONT },
      LXt`Finestra di ingresso TH = ${span(TH)}`));
    g.append(sv('text', { x: xl, y: inY + 106, fill: c.text2, 'font-size': 12, 'font-family': FONT },
      LXt`A ogni passo: ${net.inputs.join(', ')}`));
    // last state -> FC -> output
    const lx = cx[slots.length - 1];
    const fx = lx + bw + 80, ox = fx + 200;
    g.add(arrow(lx + bw + 2, cellY + 26, fx - 4, cellY + 26, LXt`h(t): ${N} valori`, (lx + bw + fx) / 2, cellY - 6));
    g.add(box(fx, cellY, 160, 52, colF, LX('Completam. connesso'), fc ? LXt`${fc.size} neurone` : ''));
    g.add(arrow(fx + 162, cellY + 26, ox - 4, cellY + 26));
    g.add(box(ox, cellY - 6, 150, 64, colO, LX('Previsione'), TL ? LXt`al tempo t + ${span(TL)}` : ''));
    // horizon note
    g.append(sv('text', { x: ox + 150, y: cellY + 84, 'text-anchor': 'end', fill: c.text2, 'font-size': 12, 'font-family': FONT },
      LXt`Orizzonte TL = ${span(TL)} dopo l'ultimo dato`));
    return sv('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', style: `max-width:${W}px;display:block;margin:0 auto`, role: 'img', 'aria-label': LXt`Funzionamento nel tempo di ${net.label}` }, defs, g);
  }

  function trainingRows(net) {
    const o = net.arch.opts || {};
    const rows = [
      [LX('Ottimizzatore'), (o.solver || '—').replace(/^adam$/i, 'Adam')],
      [LX('Funzione di perdita'), net.arch.loss === 'mae' ? LX('MAE (errore assoluto medio)') : net.arch.loss === 'mse' ? LX('MSE (errore quadratico medio, livello di regressione)') : '—'],
      [LX('Epoche (massimo)'), o.MaxEpochs != null ? fmt(o.MaxEpochs, 0) : '—'],
      ['Mini-batch', o.MiniBatchSize != null ? fmt(o.MiniBatchSize, 0) : '—'],
      [LX('Learning rate iniziale'), o.InitialLearnRate != null ? String(o.InitialLearnRate).replace('.', ',') : '—'],
      [LX('Riduzione del learning rate'), o.LearnRateSchedule === 'piecewise' ? LXt`× ${String(o.LearnRateDropFactor).replace('.', ',')} ogni ${o.LearnRateDropPeriod} epoche` : LX('nessuna (costante)')],
      [LX('Soglia sul gradiente'), o.GradientThreshold != null ? String(o.GradientThreshold) : 'nessuna'],
      [LX('Arresto anticipato'), o.ValidationPatience != null ? LXt`sì, dopo ${o.ValidationPatience} controlli senza miglioramento sulla validazione` : LX('no (nessun insieme di validazione)')],
      [LX('Divisione dei dati'), net.split],
      [LX('Normalizzazione'), LX('z-score con media e deviazione standard del solo addestramento')],
      [LX('Seme casuale'), net.seed],
      [LX('Parametri addestrabili'), fmt(net.arch.params, 0)],
      ['Script', net.script || '—'],
    ];
    return rows.map(([k, v]) => ({ k, v }));
  }

  function viewArchitectures(ds) {
    const c = C();
    const isAbr = ds === 'abr';
    const nets = archNets().filter(n => isAbr ? n.group === 'abr' : n.group !== 'abr');
    view.append(viewHead(isAbr ? DS_ABR : DS_GD, LX('Architetture delle reti'),
      LX('Per ogni rete: i livelli nell\'ordine in cui sono definiti nello script MATLAB, con dimensioni e parametri addestrabili, uno schema del funzionamento e le impostazioni di addestramento. Tutto è letto direttamente dagli script.')));
    if (!nets.length) { view.append(emptyBox(LX('Nessuna architettura trovata negli script.'))); return; }
    const groups = [{ value: 'abr', label: LX('LSTM endogena') }, { value: 'exo', label: LX('LSTM esogena') },
      { value: 'endo', label: LX('LSTM endogena') }, { value: 'exoJ', label: LX('Esogena · anni uniti') }, { value: 'endoJ', label: LX('Endogena · anni uniti') }].filter(gp => nets.some(n => n.group === gp.value));
    const gKey = isAbr ? 'archGroupAbr' : 'archGroup';
    if (!groups.some(gp => gp.value === S[gKey])) S[gKey] = groups[0].value;
    const inGroup = nets.filter(n => n.group === S[gKey]);
    const key = 'arch_' + S[gKey];
    if (!inGroup.some(n => n.id === S[key])) S[key] = (inGroup.find(n => /preferita/.test(n.label)) || inGroup.find(n => n.id === 'mlp') || inGroup[0]).id;
    const net = inGroup.find(n => n.id === S[key]);
    view.append(filters(
      groups.length > 1 ? segCtl(LX('Modello'), groups, S[gKey], v => set(gKey, v)) : null,
      selectCtl(LX('Rete'), inGroup.map(n => ({ value: n.id, label: n.label })), net.id, v => set(key, v)),
    ));

    const legend = h('div', { class: 'cfg-chips', style: 'margin-top:10px' },
      ['input', 'lstm', 'fc', 'bn', 'act', 'out'].filter(r => r === 'out' || net.arch.layers.some(l => LAYER_ROLE[l.type] === r))
        .map(r => h('span', { class: 'chip soft' }, h('span', { class: 'swatch', style: `background:${roleColor(c, r)};height:10px;width:10px;border-radius:3px` }), ROLE_NAME[r])));
    const g = h('div', { class: 'grid two' });
    g.append(card(LXt`Livelli · ${net.label}`, LXt`${fmt(net.arch.params, 0)} parametri addestrabili in totale. Le frecce indicano quanti valori passano da un livello al successivo.`,
      [blockDiagram(net), legend]));
    g.append(card(LX('Addestramento'), null, table([{ key: 'k', label: LX('Impostazione') }, { key: 'v', label: LX('Valore') }], trainingRows(net))));
    view.append(g);
    if (net.kind === 'ff') {
      view.append(card(LX('Neuroni e collegamenti'), LX('Ogni cerchio è un neurone, ogni linea un peso. Negli strati con molti neuroni ne sono disegnati solo alcuni (⋮). Lo strato di uscita restituisce la potenza stimata nello stesso istante dei dati in ingresso.'), neuronGraph(net)));
      if (net.id === 'single_neuron') view.append(h('p', { class: 'note' }, LX('Un solo neurone lineare calcola P') + String.fromCharCode(0x302) + LX(' = w₁·MODULE_TEMP + w₂·Amb_Temp + w₃·WIND_Speed + w₄·IRR + b: la stessa forma della regressione lineare multipla, ma con i pesi trovati dall\'ottimizzatore Adam sui dati normalizzati.')));
    } else {
      view.append(card(LX('Come usa il tempo'), LXt`La rete legge la finestra un passo alla volta (${net.stepName}). Dopo l'ultimo passo, lo stato finale della cella passa allo strato completamente connesso, che produce la previsione.`, unrolledLSTM(net)));
    }

    // comparison of all networks
    const rows = nets.map(n => ({ part: FAM_NAME[n.group], name: n.label,
      inp: n.kind === 'ff' ? LXt`${n.inputs.length} variabili (stesso istante)` : `${n.th} ${n.unit} × ${n.arch.layers[0].size} ${plural(n.arch.layers[0].size, LX('canale'), LX('canali'))}`,
      struct: n.arch.layers.filter(l => ['lstmLayer', 'fullyConnectedLayer'].includes(l.type)).map(l => (l.type === 'lstmLayer' ? 'LSTM ' : 'FC ') + l.size).join(' → '),
      params: n.arch.params, loss: (n.arch.loss || '').toUpperCase(), _hl: n.id === net.id && n.group === net.group }));
    view.append(foldCard(LXt`Tutte le reti di ${isAbr ? DS_ABR : DS_GD} (${rows.length})`, LX('Ingresso, struttura e numero di parametri. FC = strato completamente connesso. Clicca sulle intestazioni per ordinare.'), table([
      { key: 'part', label: LX('Parte') }, { key: 'name', label: LX('Rete') }, { key: 'inp', label: LX('Ingresso') }, { key: 'struct', label: LX('Struttura') },
      { key: 'params', label: LX('Parametri'), num: true, fmt: v => fmt(v, 0) }, { key: 'loss', label: LX('Perdita') }], rows, { scroll: true })));
  }

  // ================================================================== VIEW: gallery
  function viewGallery(ds) {
    const isAbr = ds === 'abr';
    view.append(viewHead(isAbr ? DS_ABR : DS_GD, LX('Grafici originali'),
      LX('Le immagini salvate dagli script MATLAB, così come sono (tema scuro, etichette in italiano). Clicca per aprirle ingrandite. Le prove scartate durante il lavoro non sono mostrate.')));
    const parts = isAbr ? [{ value: 'abruzzo', label: LX('LSTM endogena') }]
      : [{ value: 'all', label: LX('Tutti i modelli') }, { value: 'esogena', label: LX('LSTM esogena') },
        { value: 'endogena_gd', label: LX('LSTM endogena') }, { value: 'esogena_anni', label: LX('Esogena · anni uniti') }, { value: 'endogena_anni', label: LX('Endogena · anni uniti') }];
    const pKey = 'galPart_' + ds, grKey = 'galGroup_' + ds;
    if (!parts.some(p => p.value === S[pKey])) S[pKey] = parts[0].value;
    const inDs = D.gallery.filter(g => parts.some(p => p.value === g.part));
    const items = inDs.filter(g => S[pKey] === 'all' || g.part === S[pKey]);
    const groups = [...new Set(items.map(g => g.group))];
    if (S[grKey] !== 'all' && !groups.includes(S[grKey])) S[grKey] = 'all';
    view.append(filters(
      parts.length > 1 ? selectCtl(LX('Modello'), parts, S[pKey], v => { S[grKey] = 'all'; set(pKey, v); }) : null,
      selectCtl(LX('Configurazione / run'), [{ value: 'all', label: LX('Tutte') }].concat(groups.map(g => ({ value: g, label: g }))), S[grKey], v => set(grKey, v)),
    ));
    const shown = items.filter(g => S[grKey] === 'all' || g.group === S[grKey]);
    view.append(h('p', { class: 'note' }, LXt`${shown.length} immagini`));
    const grid = h('div', { class: 'gallery' });
    for (const g of shown) grid.append(thumbBtn(g, `${g.group} · ${g.label}`, g.src));
    view.append(grid);
  }

  // ================================================================== VIEW: notes
  function viewNotes() {
    const c = C();
    const sw = col => h('span', { class: 'swatch', style: `background:${col}` });
    view.append(viewHead(null, LX('Definizioni e note'), D.public ? LX('Come è organizzata la dashboard e come sono calcolati i numeri.') : LX('Come è organizzata la dashboard, come sono calcolati i numeri e come aggiornarla.')));
    view.append(card(LX('Come è organizzata'), null, h('div', { class: 'prose' },
      h('p', null, LX('Le schede in alto sono i due dataset. Dentro ciascuno, la riga di pulsanti sotto le schede porta alle pagine del dataset:')),
      h('ul', null,
        h('li', null, h('b', null, 'Generation data. '), LX('Confronto tra i modelli (LSTM esogena e LSTM endogena insieme), una pagina per ciascun modello, Esplora il test, Architetture, Grafici originali.')),
        h('li', null, h('b', null, LX('Monomega Abruzzo. ')), LX('Confronto tra le configurazioni LSTM endogene (finestra, orizzonte, celle), Dettaglio di una configurazione, Esplora il test, Architetture, Grafici originali.'))),
      h('p', null, LX('Ogni pagina comincia con un riquadro "In sintesi" con i risultati principali; seguono i grafici e, in fondo, le tabelle complete, che si aprono con un clic. Le scelte fatte nei filtri vengono ricordate dal browser.')))));
    if (!D.public) view.append(card(LX('Come aggiornare'), null, h('div', { class: 'prose' },
      h('p', null, 'Quando rilanci uno script o aggiungi risultati, fai doppio clic su ', h('code', null, 'aggiorna_dashboard.bat'), ' (in questa cartella) e ricarica la pagina. Lo script ', h('code', null, 'Elaborato/scripts/build_dashboard.py'), ' rilegge tutti i file dei modelli, ricalcola le metriche e riscrive ', h('code', null, 'data.js'), '. Non modifica nulla nelle cartelle dei modelli.'),
      h('p', null, 'Nuove cartelle Grafici_TH*_TL* vengono trovate da sole.'),
      h('p', null, 'I testi della pagina si cambiano con "Modifica i testi" (in fondo alla pagina, qui o sul sito): serve il token di GitHub del repository pubblico. Il salvataggio scrive ', h('code', null, 'testi.js'), ' direttamente su GitHub; prima di ricostruire il sito da qui, esegui git pull in Elaborato/dashboard_public: lo script di pubblicazione riporta testi.js in questa cartella. I numeri restano calcolati dai file dei modelli: se una frase modificata contiene un numero che poi cambia, torna al testo originale.'))));
    view.append(card(LX('Colori'), null, h('div', { class: 'prose' }, h('ul', null,
      h('li', null, sw(c.s1), LX('misura reale')), h('li', null, sw(c.s2), LX('previsione del modello')),
      h('li', null, sw(c.s3), 'persistenza'), h('li', null, sw(c.s4), LX('stessa ora del giorno prima')),
      h('li', null, LX('Nei grafici che confrontano configurazioni o stagioni, i colori indicano la configurazione o la stagione: la legenda di ogni grafico lo dice.'))))));
    // formulas in MathML: drawn by the browser like LaTeX, no external library (works offline)
    const SUM_I = '<munderover><mo>∑</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mi>N</mi></munderover>';
    const SUM_S = '<munder><mo>∑</mo><mi>s</mi></munder>';
    const Yi = '<msub><mi>y</mi><mi>i</mi></msub>', YHi = '<msub><mover accent="true"><mi>y</mi><mo>^</mo></mover><mi>i</mi></msub>';
    const YBAR = '<mi>ȳ</mi>', YREF = '<msubsup><mi>y</mi><mi>i</mi><mtext>rif</mtext></msubsup>';
    const sq = x => `<msup><mrow><mo>(</mo>${x}<mo>)</mo></mrow><mn>2</mn></msup>`;
    const PCT = '<mo>×</mo><mn>100</mn><mo>%</mo>';
    const PBAR = sub => `<msub><mi>P̄</mi>${sub}</msub>`;
    const DS = x => `${SUM_S}<msub><mi>d</mi><mi>s</mi></msub>${x}`;
    const FM = {
      mae: `<mi>MAE</mi><mo>=</mo><mfrac><mn>1</mn><mi>N</mi></mfrac>${SUM_I}<mo>|</mo>${Yi}<mo>−</mo>${YHi}<mo>|</mo>`,
      rmse: `<mi>RMSE</mi><mo>=</mo><msqrt><mfrac><mn>1</mn><mi>N</mi></mfrac>${SUM_I}${sq(Yi + '<mo>−</mo>' + YHi)}</msqrt>`,
      r2: `<msup><mi>R</mi><mn>2</mn></msup><mo>=</mo><mn>1</mn><mo>−</mo><mfrac><mrow>${SUM_I}${sq(Yi + '<mo>−</mo>' + YHi)}</mrow><mrow>${SUM_I}${sq(Yi + '<mo>−</mo>' + YBAR)}</mrow></mfrac>`,
      ss: `<mi>SS</mi><mo>=</mo><mrow><mo>(</mo><mn>1</mn><mo>−</mo><mfrac><mrow>${SUM_I}${sq(Yi + '<mo>−</mo>' + YHi)}</mrow><mrow>${SUM_I}${sq(Yi + '<mo>−</mo>' + YREF)}</mrow></mfrac><mo>)</mo></mrow>${PCT}`,
      imp: `<mtext>Miglioramento</mtext><mo>=</mo><mrow><mo>(</mo><mn>1</mn><mo>−</mo><mfrac><msub><mi>MAE</mi><mtext>rete</mtext></msub><msub><mi>MAE</mi><mtext>rif</mtext></msub></mfrac><mo>)</mo></mrow>${PCT}`,
      pers: `<msubsup><mover accent="true"><mi>y</mi><mo>^</mo></mover><mi>t</mi><mtext>pers</mtext></msubsup><mo>=</mo><msub><mi>y</mi><mrow><mi>t</mi><mo>−</mo><mi>TL</mi></mrow></msub>`,
      yest: `<msubsup><mover accent="true"><mi>y</mi><mo>^</mo></mover><mi>t</mi><mtext>ieri</mtext></msubsup><mo>=</mo><msub><mi>y</mi><mrow><mi>t</mi><mo>−</mo><mn>24</mn><mtext> h</mtext></mrow></msub>`,
      nmaeS: `<msub><mi>nMAE</mi><mi>s</mi></msub><mo>=</mo><mfrac><msub><mi>MAE</mi><mi>s</mi></msub>${PBAR('<mi>s</mi>')}</mfrac>${PCT}`,
      wmean: `<mi>x̄</mi><mo>=</mo><mfrac><mrow>${DS('<msub><mi>x</mi><mi>s</mi></msub>')}</mrow><mrow>${DS('')}</mrow></mfrac>`,
      nmaeT: `<mi>nMAE</mi><mo>=</mo><mfrac><mrow><mfrac><mrow>${DS('<msub><mi>MAE</mi><mi>s</mi></msub>')}</mrow><mrow>${DS('')}</mrow></mfrac></mrow>${PBAR('<mtext>tot</mtext>')}</mfrac>${PCT}`,
    };
    const math = ml => { const d = document.createElement('div'); d.className = 'formula-math'; d.innerHTML = `<math xmlns="http://www.w3.org/1998/Math/MathML" display="block">${ml}</math>`; return d; };
    const legend = LX('yᵢ = misura, ŷᵢ = previsione, N = numero di campioni di test.');
    view.append(card(LX('Metriche'), LX('Formule usate per tutte le tabelle e i grafici; ogni metrica è calcolata prima stagione per stagione, sugli stessi campioni di test per la rete e per i riferimenti.'), h('div', { class: 'prose' },
      h('dl', { class: 'defs' },
        h('dt', null, 'MAE'), h('dd', null, math(FM.mae),
          h('div', null, LX('Errore assoluto medio, in kW (kWh per ora nell\'Abruzzo). ') + legend)),
        h('dt', null, 'RMSE'), h('dd', null, math(FM.rmse),
          h('div', null, LX('Radice dell\'errore quadratico medio, in kW (kWh per ora nell\'Abruzzo).'))),
        h('dt', null, 'R²'), h('dd', null, math(FM.r2),
          h('div', null, LX('ȳ = media della misura nei campioni di test. R² = 1: previsione perfetta; R² = 0: errore quadratico uguale a quello che si ha prevedendo sempre ȳ.'))),
        h('dt', null, 'Skill score'), h('dd', null, math(FM.ss),
          h('div', null, LX('yᵢʳⁱᶠ = previsione del riferimento ingenuo sugli stessi campioni: la persistenza (ultimo valore noto) per Generation data, la stessa ora del giorno prima per l\'Abruzzo. SS = 0: errore quadratico della rete uguale a quello del riferimento; SS > 0: minore; SS < 0: maggiore; SS = 100 %: previsione perfetta. Calcolato stagione per stagione; la colonna "media" è la media pesata con i giorni di ogni stagione (formula più sotto).'))),
        h('dt', null, LX('Miglioramento')), h('dd', null, math(FM.imp),
          h('div', null, LX('Variazione relativa del MAE della rete rispetto al MAE del riferimento ingenuo, sugli stessi campioni. Positivo = MAE della rete minore di quello del riferimento.'))),
        h('dt', null, 'nMAE'), h('dd', null, LX('MAE diviso la potenza media misurata del periodo a cui si riferisce l\'errore, in %. Formule e valori nel riquadro più sotto.')),
        h('dt', null, LX('MAPE diurno')), h('dd', null, LX('Errore percentuale medio solo sui campioni "diurni": misura > 10 kWh nell\'Abruzzo, > 5 % del massimo della stagione nell\'esogena (come negli script).')),
        h('dt', null, LX('wMAPE diurno')), h('dd', null, LX('Somma degli errori assoluti diviso somma delle misure, sugli stessi campioni diurni.')),
        h('dt', null, LX('Persistenza')), h('dd', null, math(FM.pers),
          h('div', null, LX('Previsione ingenua "il valore resta quello dell\'ultimo istante noto": la misura di TL passi prima, cioè l\'ultimo dato disponibile quando la rete fa la previsione. Nell\'Abruzzo è usata solo per TL ≤ ') + ABR_PERS_MAX_TL + LX(' h (vedi sotto).'))),
        h('dt', null, LX('Stessa ora di ieri')), h('dd', null, math(FM.yest),
          h('div', null, LX('Previsione ingenua con la misura di 24 ore prima (solo Abruzzo, dati orari). Nelle tabelle dell\'Abruzzo è il riferimento per ogni TL.'))),
        h('dt', null, LX('Misura traslata di 1 passo')), h('dd', null, LX('La misura spostata in avanti di un passo (1 ora nell\'Abruzzo, 5 minuti su Generation data). Compare solo nei grafici, non nelle tabelle.')),
        h('dt', null, LX('Analisi del ritardo')), h('dd', null, LX('MAE tra la previsione al tempo t e la misura al tempo t − k, per vari k. Il minimo a k = 0 indica una previsione in fase; il minimo a k = TL indica che la rete ripete l\'ultimo valore noto.')),
      ))));
    const pGD = pooledMean(EXO.seasons, 'p_mean', 'n'), pGD3 = pooledMean(EXOJ.seasons, 'p_mean', 'n');
    const pAbr = pooledMean(ABR.seasons, 'p_mean', 'n_valid'), pAbrP = pooledMean(ABR.seasons, 'p_mean_prod', 'n_prod');
    const dayRows = ABR.seasons.map(s => ({ ds: DS_ABR, s: s.label, d: s.days, p: s.p_mean, pp: s.p_mean_prod }))
      .concat(EXO.seasons.map(s => ({ ds: DS_GD, s: s.label, d: s.days, p: s.p_mean, pp: null })));
    view.append(card(LX('MAE normalizzato (nMAE) e medie sulle stagioni'), null, h('div', { class: 'prose' },
      h('p', null, LX('Il MAE normalizzato (nMAE) è il MAE diviso la potenza media misurata nel periodo a cui l\'errore si riferisce, espresso in percentuale.')),
      h('p', null, h('b', null, LX('Una stagione. ')), LX('Il test è una sola stagione: si usa la potenza media di quella stagione, calcolata su tutto il suo foglio (non solo sui giorni di test).')),
      math(FM.nmaeS),
      h('p', null, h('b', null, LX('Più stagioni insieme (colonne "media"). ')), LX('Il MAE medio pesato con i giorni viene diviso per la potenza media di tutti i fogli insieme, cioè dell\'intero periodo di test:')),
      math(FM.nmaeT),
      h('ul', null,
        h('li', null, LXt`Reti di Generation data a stagioni separate: 11 fogli, cioè tutto il dataset, P̄ = ${fmt(pGD, 2)} kW.`),
        h('li', null, LXt`Reti di Generation data ad anni uniti: i fogli dell'anno 3, cioè un anno intero, P̄ = ${fmt(pGD3, 2)} kW.`),
        h('li', null, LXt`Abruzzo, 4 stagioni: P̄ = ${fmt(pAbr, 1)} kW su tutte le ore, ${fmt(pAbrP, 1)} kW sulle ore con produzione.`)),
      h('p', null, h('b', null, LX('Abruzzo: due varianti. ')), LX('I dati orari comprendono la notte. "Tutte le ore" usa la potenza media calcolata su tutte le ore, notti comprese; "ore di produzione" usa la media delle sole ore con energia > 0. Il MAE è calcolato su tutte le ore del test. Generation data non contiene la notte, quindi ha una sola variante.')),
      h('p', null, h('b', null, LX('Media pesata. ')), LX('Tutte le colonne "media" (MAE, RMSE, R², skill score, miglioramento, MAPE) sono medie delle stagioni pesate con il numero di giorni di ciascuna:')),
      math(FM.wmean),
      h('p', null, LX('dₛ = giorni della stagione s: per Generation data la colonna "Giorni (circa)" del foglio Riepilogo, per l\'Abruzzo le ore del foglio divise per 24.')),
      tableToggle(LX('Mostra giorni e potenza media di ogni stagione'), table([
        { key: 'ds', label: 'Dataset' }, { key: 's', label: LX('Stagione') }, { key: 'd', label: LX('Giorni'), num: true, fmt: v => fmt(v, 1) },
        { key: 'p', label: LX('Potenza media, tutte le ore [kW]'), num: true, fmt: v => fmt(v, 2) },
        { key: 'pp', label: LX('Potenza media, ore di produzione [kW]'), num: true, fmt: v => v == null ? '—' : fmt(v, 2) }], dayRows)),
      h('p', null, LX('Nota: un\'energia in kWh prodotta in un\'ora equivale alla potenza media in kW in quell\'ora, quindi gli errori orari dell\'Abruzzo si leggono anche come kW medi.')))));
    view.append(card(LX('Quale riferimento ingenuo, e perché'), null, h('div', { class: 'prose' },
      h('p', null, LX('La persistenza classica (misura di TL passi prima) è un buon riferimento solo se TL è breve rispetto al ciclo giornaliero. Nell\'Abruzzo, con dati orari e TL = 12 h, la "previsione" per mezzogiorno è il valore di mezzanotte e quella per mezzanotte è il picco di mezzogiorno: i picchi finiscono di notte, l\'errore della persistenza diventa enorme e la rete sembra migliore di quanto sia.')),
      h('ul', null,
        h('li', null, h('b', null, 'Abruzzo. '), LXt`Il riferimento principale, per tutti i TL, è la stessa ora del giorno prima (t − 24 h): rispetta il ciclo giornaliero ed è disponibile quando si fa la previsione (TL ≤ 24 h). Nei dati è già migliore della persistenza classica anche a TL = 1 h. La persistenza classica è riportata solo per TL ≤ ${ABR_PERS_MAX_TL} h.`),
        h('li', null, h('b', null, 'Generation data. '), LX('TL arriva al massimo a 6 passi (circa 30 minuti) e i fogli contengono solo ore di luce, quindi il problema non si presenta: resta la persistenza classica. L\'unico effetto residuo è al passaggio da un giorno al successivo (la sera seguita dalla mattina dopo), dove per i primi TL campioni la persistenza usa il valore della sera prima.')),
        h('li', null, h('b', null, LX('Nei grafici ')), LX('si può mostrare la misura traslata di 1 passo: aiuta a vedere se la previsione è in ritardo, ma non è un riferimento per le tabelle.')),
      ))));
    view.append(card(LX('Dati e cautele'), null, h('div', { class: 'prose' }, h('ul', null,
      h('li', null, LX('Abruzzo: le metriche sono ricalcolate dai file Risultati_<stagione>.csv della riesecuzione di tutte le configurazioni (26/10/2026). I test durano circa 9 giorni per stagione. Dati mancanti nei fogli: 12 ore in Primavera 2020, 22 in Estate 2020, 6 in Primavera 2021, 3 in Estate 2021, sempre a blocchi di ore consecutive. Solo un blocco cade in un periodo di test: in Estate 2020 mancano le 14 ore dal 21/09/2020 alle 21:00 al 22/09/2020 alle 10:00 (la notte e la mattina). Gli script le riempiono per interpolazione lineare, quindi lì la "misura" è una rampa da 0 kWh (ore 20) a 138 kWh (ore 11), anche durante la notte.')),
      h('li', null, LX('Generation_data non ha data e ora: giorni e stagioni sono ricostruiti (foglio Riepilogo) e il passo di 5 minuti è una stima. Le notti non ci sono.')),
      h('li', null, LX('Le medie "sulle stagioni" sono medie delle metriche di ogni stagione pesate con i giorni (vedi il riquadro sul MAE normalizzato).')),
    ))));
    view.append(card(LX('Materiale non mostrato'), null, h('div', { class: 'prose' },
      h('p', null, LX('Le prove scartate durante il lavoro e le copie duplicate dei grafici non compaiono nella dashboard.')))));
    view.append(card(LX('Fonti'), null, h('div', { class: 'prose' }, h('ul', null,
      h('li', null, h('code', null, 'Monomega abruzzo/Grafici_*/Risultati_*.csv')),
      h('li', null, h('code', null, 'Monomega abruzzo/Abruzzo_diviso_in_stagioni.xlsx'), LX(' (serie misurate, riferimenti ingenui)')),
      h('li', null, h('code', null, 'Generation_data/LSTM_ESOGENA/Reti_stagioni_separate/Grafici_*/Risultati_*.csv'), ' e ', h('code', null, 'Generation_data/LSTM_ENDOGENA/Reti_con_stagioni_separate/Grafici_*/Risultati_*.csv')),
      h('li', null, h('code', null, 'Generation_data/LSTM_ESOGENA/Reti_stagioni_unite/Grafici_ANNI_*/Risultati_*.csv'), ' e ', h('code', null, 'Generation_data/LSTM_ENDOGENA/Reti_con_stagioni_unite/Grafici_ANNI_*/Risultati_*.csv')),
      h('li', null, h('code', null, 'Generation_data/Generation_data_stagioni_vento_corretto.xlsx'), LX(' (serie misurate, persistenza)')),
      h('li', null, h('code', null, 'Grafici_*/FV_<stagione>.hdf5'), ' e ', h('code', null, '.dict'), LX(' (stati interni esportati dagli script, pagina "Stati interni")')),
    ))));
  }

  // ------------------------------------------------------------------ start
  applyTheme();
  render(false);
  updateEditBar();
  // a token saved on this device that is no longer valid, or cannot write to the site, is forgotten
  if (ghToken()) checkWrite(ghToken()).catch(e => { if (/non valido|permesso/.test(e.message)) forgetToken(); });
  if (EDIT_URL && !ghToken()) openTokenDialog();
})();
