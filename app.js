/* Local results dashboard for the PV forecasting thesis.
   Data: window.DASH, written by Elaborato/scripts/build_dashboard.py (data.js).
   Charts: Plotly (vendor/plotly.min.js, offline). */
'use strict';
(function () {
  const D = window.DASH;
  const view = document.getElementById('view');
  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

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
    view.append(emptyBox(!D ? 'Dati non trovati (data.js).' : 'Libreria grafici non trovata (vendor/plotly.min.js).',
      'Fai doppio clic su aggiorna_dashboard.bat in questa cartella, poi ricarica la pagina.'));
    return;
  }

  // ------------------------------------------------------------------ state & storage
  const store = {
    get(k, d) { try { const v = localStorage.getItem('fvdash.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('fvdash.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  const REG = D.regression, ABR = D.abruzzo, EXO = D.exogenous;
  const P_NOM = ABR.p_nom, P_MAX = EXO.p_max;
  const ABR_SEASONS = ABR.seasons, EXO_SEASONS = EXO.seasons;
  const abrPref = ABR.configs.find(c => c.preferred) || ABR.configs[0];
  const exoPref = EXO.configs.find(c => c.preferred) || EXO.configs[0];
  // Generation_data families: exogenous / endogenous, single seasons / joined years (1 + 2 -> 3)
  const EMPTY_FAM = { configs: [], seasons: [], lstmvis: [], pending: [] };
  const ENDO = D.endo_gd || EMPTY_FAM, EXOJ = D.exo_joined || EMPTY_FAM, ENDOJ = D.endo_joined || EMPTY_FAM;
  const GD = { exo: EXO, endo: ENDO, exoJ: EXOJ, endoJ: ENDOJ };
  const GD_PART = { exo: 'LSTM esogena', endo: 'LSTM endogena (GD)', exoJ: 'LSTM esogena · anni uniti', endoJ: 'LSTM endogena (GD) · anni uniti' };
  const GD_TAG = { exo: 'ESO', endo: 'END', exoJ: 'ESO anni', endoJ: 'END anni' };
  function gdFam(base, mode) { return mode === 'joined' ? base + 'J' : base; }
  // a season entry as seen with the chosen test samples (joined nets: whole year 3, or the same samples as the single-season nets)
  function gdView(s, samples) {
    if (!s) return null;
    if (s.m20 && (samples || S.gdSamples) === 'last20') return { metrics: s.m20, pers: s.p20, shift1: s.s20, n_test: s.n_last20 };
    return s;
  }
  function gdVal(F, c, m, season, ofPers, samples) {
    if (season !== 'mean') { const s = gdView(c.seasons[season], samples); return s ? exoSeasonVal(s, m, ofPers) : null; }
    return mean(F.seasons.map(s => gdView(c.seasons[s.key], samples)).filter(Boolean).map(s => exoSeasonVal(s, m, ofPers)));
  }
  function gdAll() {
    return ['exo', 'endo', 'exoJ', 'endoJ'].flatMap(fk => GD[fk].configs.map(cf => Object.assign({}, cf, { id: fk + ':' + cf.id, label: GD_TAG[fk] + ' ' + cf.id })));
  }
  // Generation_data test series are stored compactly (first sheet row + predictions): rebuild them on first use
  const GDP = D.gd_power || {};
  for (const F of [EXO, ENDO, EXOJ, ENDOJ]) for (const cf of F.configs) for (const [sheet, e] of Object.entries(cf.seasons)) {
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
  // Abruzzo: the classic persistence (value TL hours before) is used as a reference only up to this horizon
  const ABR_PERS_MAX_TL = 3;

  const DEFAULTS = {
    theme: 'auto',
    ovMetric: 'nmae_ref', ovBaseline: false,
    regRun: REG.used_run, regModel: 'single_neuron', regBins: 'bias',
    abrMetric: 'mae', abrSeason: 'mean', abrConfig: abrPref.id, abrDetSeason: 'Primavera2021',
    abrPers: true, abrYest: false, abrVis: ABR.lstmvis.length ? ABR.lstmvis.find(v => v.units === 36)?.config || ABR.lstmvis[0].config : null,
    exoMetric: 'mae', exoConfig: exoPref.id, exoSeason: 'Estate_3', exoAxis: 'samples', exoPers: true,
    exoVis: EXO.lstmvis.length ? exoPref.id : null,
    galPart: 'all', galGroup: 'all',
    expModel: ABR.configs.some(c => ABR_SEASONS.some(s => c.seasons[s.key].csv)) ? 'abr' : 'exo',
    gdMetric: 'mae', gdSamples: 'last20', gdAxis: 'samples', gdPers: true, gdCells: 64,
    cmpMode: 'sep', cmpMetric: 'mae', cmpCells: 64, cmpSeason: 'mean',
    expSeasonAbr: 'Primavera2021', expSeasonExo: 'Estate_3', expCfgsAbr: [abrPref.id], expCfgsExo: ['exo:' + exoPref.id],
    expSlotsAbr: {}, expSlotsExo: {}, expPers: true, expYest: false, expErr: true, expUnit: 'samples',
    archGroup: 'abr', arch_reg: 'mlp', arch_abr: abrPref.id, arch_exo: exoPref.id,
  };
  const S = Object.assign({}, DEFAULTS, store.get('state', {}));
  const urlTheme = new URLSearchParams(location.search).get('theme');   // ?theme=light|dark (e.g. for screenshots)
  if (['auto', 'light', 'dark'].includes(urlTheme)) S.theme = urlTheme;
  // drop saved values that no longer exist in the data
  if (!REG.runs.some(r => r.name === S.regRun)) S.regRun = DEFAULTS.regRun;
  if (!ABR.configs.some(c => c.id === S.abrConfig)) S.abrConfig = DEFAULTS.abrConfig;
  if (!ABR_SEASONS.some(s => s.key === S.abrDetSeason)) S.abrDetSeason = ABR_SEASONS[0].key;
  if (!EXO.configs.some(c => c.id === S.exoConfig)) S.exoConfig = DEFAULTS.exoConfig;
  if (!EXO_SEASONS.some(s => s.key === S.exoSeason)) S.exoSeason = EXO_SEASONS[0].key;
  if (!ABR.lstmvis.some(v => v.config === S.abrVis)) S.abrVis = DEFAULTS.abrVis;
  if (!EXO.lstmvis.some(v => v.config === S.exoVis)) S.exoVis = DEFAULTS.exoVis;
  if (!ABR_SEASONS.some(s => s.key === S.expSeasonAbr)) S.expSeasonAbr = DEFAULTS.expSeasonAbr;
  if (!EXO_SEASONS.some(s => s.key === S.expSeasonExo)) S.expSeasonExo = DEFAULTS.expSeasonExo;
  for (const k of ['expCfgsAbr', 'expCfgsExo']) if (!Array.isArray(S[k])) S[k] = DEFAULTS[k].slice();
  for (const k of ['expSlotsAbr', 'expSlotsExo']) if (!S[k] || typeof S[k] !== 'object' || Array.isArray(S[k])) S[k] = {};
  // explorer ids of Generation_data are now "<family>:<config>"
  S.expCfgsExo = S.expCfgsExo.map(id => String(id).includes(':') ? id : 'exo:' + id);
  if (Object.keys(S.expSlotsExo).some(k => !k.includes(':'))) S.expSlotsExo = {};
  function save() { store.set('state', S); }
  function set(k, v) { S[k] = v; save(); render(true); }

  // ------------------------------------------------------------------ theme & colours
  const themeBtn = document.getElementById('theme-btn');
  const darkMq = window.matchMedia('(prefers-color-scheme: dark)');
  function isDark() { return S.theme === 'dark' || (S.theme === 'auto' && darkMq.matches); }
  function applyTheme() {
    const r = document.documentElement;
    if (S.theme === 'auto') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', S.theme);
    themeBtn.textContent = 'Tema: ' + ({ auto: 'automatico', light: 'chiaro', dark: 'scuro' })[S.theme];
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
  function nf(d) { return NF[d] || (NF[d] = new Intl.NumberFormat('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d })); }
  function fmt(v, d = 2) { return v == null || !isFinite(v) ? '—' : nf(d).format(v); }
  function fmtS(v, d = 1) { return v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : '') + nf(d).format(v); }
  function signed(v, d = 1, suffix = ' %') {
    if (v == null || !isFinite(v)) return h('span', { class: 'muted' }, '—');
    return h('span', { class: v >= 0 ? 'pos' : 'neg' }, fmtS(v, d) + suffix);
  }
  function mean(a) { const v = a.filter(x => x != null && isFinite(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; }

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
  function tile(label, who, value, unit, facts) {
    return h('div', { class: 'tile' }, h('div', { class: 'label' }, label), who ? h('div', { class: 'who' }, who) : null,
      h('div', { class: 'value' }, value, unit ? h('small', null, unit) : null),
      facts && facts.length ? h('div', { class: 'facts' }, facts) : null);
  }
  function fact(label, value) { return h('span', null, label + ' ', h('b', null, value)); }
  function chartDiv(cls) { return h('div', { class: 'chart' + (cls ? ' ' + cls : '') }); }
  function sectionTitle(t) { return h('h2', { class: 'section-title' }, t); }
  function callout(text, info) { return h('div', { class: 'callout' + (info ? ' info' : '') }, h('span', { class: 'icon', 'aria-hidden': 'true' }, info ? 'i' : '!'), h('div', null, text)); }
  function tableToggle(label, tbl) { return h('details', { class: 'table-toggle' }, h('summary', null, label), tbl); }

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
      paper_bgcolor: c.surface, plot_bgcolor: c.surface, separators: ',.',
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

  // ------------------------------------------------------------------ data access: regression
  function regRun(name) { return REG.runs.find(r => r.name === name) || REG.runs[0]; }
  function usedRun() { return regRun(REG.used_run); }
  function bestReg(run) { return run.metrics.filter(m => m.id !== 'baseline').reduce((a, b) => (a && a.mae <= b.mae ? a : b), null); }

  // ------------------------------------------------------------------ data access: Abruzzo
  const ABR_METRICS = [
    { value: 'mae', label: 'MAE [kWh]', unit: 'kWh', d: 2, kind: 'seq' },
    { value: 'mape', label: 'MAPE diurno [%]', unit: '%', d: 1, kind: 'seq' },
    { value: 'nmae_nom', label: 'nMAE sulla potenza nominale [%]', unit: '%', d: 2, kind: 'seq' },
    { value: 'nmae_mean', label: "nMAE sull'energia media [%]", unit: '%', d: 1, kind: 'seq' },
    { value: 'skill_pers', label: 'Miglioramento vs persistenza (solo TL ≤ 3 h) [%]', unit: '%', d: 1, kind: 'div' },
    { value: 'skill_yest', label: 'Miglioramento vs stessa ora di ieri [%]', unit: '%', d: 1, kind: 'div' },
  ];
  function abrMae(s) { return s.csv ? s.csv.mae : s.file ? s.file.mae : null; }
  function abrMape(s) { return s.csv ? s.csv.mape_day : s.file ? s.file.mape_day : null; }
  function abrSeasonVal(s, m, tl) {
    if (m === 'mape') return abrMape(s);
    const mae = abrMae(s); if (mae == null) return null;
    switch (m) {
      case 'mae': return mae;
      case 'nmae_nom': return 100 * mae / P_NOM;
      case 'nmae_mean': return 100 * mae / s.base.mean_real;
      case 'skill_pers': return tl > ABR_PERS_MAX_TL ? null : 100 * (1 - mae / s.base.pers.mae);
      case 'skill_yest': return 100 * (1 - mae / s.base.yest.mae);
    }
    return null;
  }
  function abrBaseVal(s, which, m) {
    const b = s.base[which];
    switch (m) {
      case 'mae': return b.mae; case 'mape': return b.mape_day;
      case 'nmae_nom': return 100 * b.mae / P_NOM; case 'nmae_mean': return 100 * b.mae / s.base.mean_real;
    }
    return null;
  }
  function abrVal(c, m, season) {
    if (season !== 'mean') return abrSeasonVal(c.seasons[season], m, c.tl);
    const v = ABR_SEASONS.map(s => abrSeasonVal(c.seasons[s.key], m, c.tl));
    return v.some(x => x == null) ? null : mean(v);
  }
  function abrHasData(c) { return ABR_SEASONS.every(s => abrMae(c.seasons[s.key]) != null); }
  function abrHasCsv(c) { return ABR_SEASONS.some(s => c.seasons[s.key].csv); }
  function abrConfig(id) { return ABR.configs.find(c => c.id === id) || abrPref; }
  function abrMetricDef(v) { return ABR_METRICS.find(m => m.value === v) || ABR_METRICS[0]; }
  function seasonLabel(key) { return (ABR_SEASONS.find(s => s.key === key) || EXO_SEASONS.find(s => s.key === key) || { label: key }).label; }

  // ------------------------------------------------------------------ data access: exogenous
  const EXO_METRICS = [
    { value: 'mae', label: 'MAE [kW]', unit: 'kW', d: 2 },
    { value: 'mape', label: 'MAPE diurno [%]', unit: '%', d: 1 },
    { value: 'wmape', label: 'wMAPE diurno [%]', unit: '%', d: 1 },
    { value: 'nmae_mean', label: 'nMAE sulla potenza media [%]', unit: '%', d: 1 },
    { value: 'nmae_ref', label: 'nMAE sulla potenza massima [%]', unit: '%', d: 2 },
    { value: 'skill', label: 'Miglioramento vs persistenza [%]', unit: '%', d: 1 },
    { value: 'r2', label: 'R²', unit: '', d: 3 },
  ];
  function exoSeasonVal(s, m, ofPers) {
    const x = ofPers ? s.pers : s.metrics;
    switch (m) {
      case 'mae': return x.mae; case 'mape': return x.mape_day; case 'wmape': return x.wmape_day;
      case 'nmae_mean': return 100 * x.mae / x.mean_real; case 'nmae_ref': return 100 * x.mae / P_MAX;
      case 'skill': return ofPers ? null : 100 * (1 - s.metrics.mae / s.pers.mae);
      case 'r2': return x.r2;
    }
    return null;
  }
  function exoVal(c, m, season, ofPers) { return gdVal(EXO, c, m, season, ofPers); }
  function exoConfig(id) { return EXO.configs.find(c => c.id === id) || exoPref; }
  function exoMetricDef(v) { return EXO_METRICS.find(m => m.value === v) || EXO_METRICS[0]; }
  function exoDesc(c) { return `TH ${c.th} passi (${c.th * EXO.step_min} min) · TL ${c.tl} passi (${c.tl * EXO.step_min} min) · ${c.cells} celle`; }

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
    const a = vline(0, c.text2, 'k = 0: in fase', 'left'), b = vline(tl, c.text2, `k = TL = ${tl}: come la persistenza`, 'right');
    plot(div, [lineT(ks, m, 'MAE previsione vs misura spostata', c[ROLE.model],
      { mode: 'lines+markers', marker: { size: 8, color: c[ROLE.model], line: { color: c.surface, width: 2 } },
        hovertemplate: `k = %{x} ${stepLabel}<br><b>%{y:.2f} ${unitLabel}</b><extra></extra>` })],
    { showlegend: false, margin: { t: 30 },
      xaxis: { title: { text: `Spostamento k della misura [${stepLabel}]` }, dtick: tl > 12 ? 4 : 1 },
      yaxis: { title: { text: `MAE [${unitLabel}]` }, rangemode: 'tozero' },
      shapes: [a.shape, b.shape], annotations: [a.ann, b.ann] }, 'analisi_ritardo');
    return ks[best];
  }

  // ------------------------------------------------------------------ header & tabs
  const TABS = [
    { id: 'panoramica', label: 'Panoramica', render: viewOverview },
    { id: 'regressione', label: 'Regressione', render: viewRegression },
    { id: 'endogena', label: 'LSTM endogena (Abruzzo)', render: viewAbruzzo },
    { id: 'esogena', label: 'LSTM esogena', render: () => viewGD('exo') },
    { id: 'endogena-gd', label: 'LSTM endogena (Generation data)', render: () => viewGD('endo') },
    { id: 'confronto', label: 'Endogena vs esogena', render: viewCompare },
    { id: 'esplora', label: 'Esplora il test', render: viewExplorer },
    { id: 'architetture', label: 'Architetture', render: viewArchitectures },
    { id: 'grafici', label: 'Grafici originali', render: viewGallery },
    { id: 'note', label: 'Definizioni e note', render: viewNotes },
  ];
  const tabsEl = document.getElementById('tabs');
  for (const t of TABS) {
    tabsEl.append(h('button', { class: 'tab', role: 'tab', id: 'tab-' + t.id, type: 'button',
      onclick: () => { if (location.hash !== '#' + t.id) location.hash = t.id; else render(false); } }, t.label));
  }
  document.getElementById('build-info').textContent =
    `Dati generati il ${D.build.time}` + (D.build.commit ? ` · commit ${D.build.commit}` : '') + ' · tutti i numeri vengono dai file dei modelli';
  if (!D.public && D.build.material_uncommitted > 0) {
    const chip = document.getElementById('material-chip');
    chip.hidden = false;
    chip.textContent = `${D.build.material_uncommitted} file del materiale non ancora nel commit`;
  }
  function currentTab() { const id = location.hash.slice(1).split('?')[0]; return TABS.find(t => t.id === id) || TABS[0]; }
  // deep links, e.g. #architetture?parte=reg&rete=mlp
  function applyHashParams(tabId) {
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    if (tabId === 'architetture' && q.get('parte')) {
      S.archGroup = q.get('parte');
      if (q.get('rete')) S['arch_' + S.archGroup] = q.get('rete');
    }
  }
  function syncTopbar() { document.documentElement.style.setProperty('--topbar-h', document.querySelector('.topbar').offsetHeight + 'px'); }

  let lastTab = null;
  function render(keepScroll) {
    const t = currentTab();
    if (!keepScroll) applyHashParams(t.id);
    const y = keepScroll && lastTab === t.id ? window.scrollY : 0;
    for (const b of tabsEl.children) b.setAttribute('aria-selected', String(b.id === 'tab-' + t.id));
    purgeAll();
    view.textContent = '';
    syncTopbar();
    t.render();
    lastTab = t.id;
    window.scrollTo(0, y);
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

  // ================================================================== VIEW: overview
  function overviewRows() {
    const rows = [];
    const run = usedRun(), best = bestReg(run);
    for (const m of run.metrics) {
      rows.push({ part: 'Regressione', key: 'reg-' + m.id, name: m.label, task: 'Stima nello stesso istante', step: '—',
        th: '—', tl: '—', cells: m.id === 'mlp' ? '64-32-16' : m.id === 'single_neuron' ? '1 neurone' : '—',
        mae: m.mae, unit: 'kW', nmae_mean: m.nmae, nmae_ref: m.nmae_ref, skill: null, r2: m.r2,
        src: run.source, baseline: m.id === 'baseline', _hl: best && m.id === best.id });
    }
    for (const c of ABR.configs) {
      if (!abrHasData(c)) continue;
      const srcs = [...new Set(ABR_SEASONS.map(s => c.seasons[s.key].csv ? 'CSV ricalcolato' : 'Metrics.txt'))].join(' + ');
      rows.push({ part: 'LSTM endogena', key: 'abr-' + c.id, name: c.id, task: 'Previsione', step: '1 h',
        th: c.th + ' h', tl: c.tl + ' h', cells: c.cells, mae: abrVal(c, 'mae', 'mean'), unit: 'kWh',
        nmae_mean: abrVal(c, 'nmae_mean', 'mean'), nmae_ref: abrVal(c, 'nmae_nom', 'mean'),
        skill: abrVal(c, 'skill_yest', 'mean'), r2: null, src: srcs, _hl: c.preferred });
    }
    for (const fk of ['exo', 'endo', 'exoJ', 'endoJ']) for (const c of GD[fk].configs) {
      const F = GD[fk];
      rows.push({ part: GD_PART[fk], key: fk + '-' + c.id, name: c.id, task: 'Previsione', step: '5 min (stima)',
        th: `${c.th} passi (${c.th * EXO.step_min} min)`, tl: `${c.tl} passi (${c.tl * EXO.step_min} min)`, cells: c.cells,
        mae: gdVal(F, c, 'mae', 'mean'), unit: 'kW', nmae_mean: gdVal(F, c, 'nmae_mean', 'mean'), nmae_ref: gdVal(F, c, 'nmae_ref', 'mean'),
        skill: gdVal(F, c, 'skill', 'mean'), r2: gdVal(F, c, 'r2', 'mean'), src: F.joined ? 'CSV ricalcolato (ultimo 20 % anno 3)' : 'CSV ricalcolato', _hl: c.preferred });
    }
    return rows;
  }

  function viewOverview() {
    const c = C();
    const run = usedRun(), best = bestReg(run);
    view.append(h('div', { class: 'view-head' }, h('h2', null, 'Panoramica dei tre modelli'),
      h('p', null, 'Confronto tra le configurazioni migliori di ciascuna parte del lavoro. Le metriche delle LSTM sono medie sulle stagioni di test; per la regressione si usa il run indicato per la tesi.')));

    const abrAvail = abrHasData(abrPref);
    view.append(h('div', { class: 'grid three' },
      tile('Regressione', `${best.label} · ${run.name}`, fmt(best.mae, 2), 'kW MAE',
        [fact('R²', fmt(best.r2, 4)), fact('nMAE media', fmt(best.nmae, 2) + ' %'), fact('nMAE rif.', fmt(best.nmae_ref, 2) + ' %')]),
      tile('LSTM endogena (Abruzzo)', `${abrPref.id} · configurazione preferita`, abrAvail ? fmt(abrVal(abrPref, 'mae', 'mean'), 2) : '—', 'kWh MAE',
        abrAvail ? [fact('nMAE nominale', fmt(abrVal(abrPref, 'nmae_nom', 'mean'), 2) + ' %'),
          h('span', null, 'vs stessa ora di ieri ', signed(abrVal(abrPref, 'skill_yest', 'mean')))] : [h('span', null, 'metriche non disponibili')]),
      tile('LSTM esogena', `${exoPref.id} · configurazione preferita`, fmt(exoVal(exoPref, 'mae', 'mean'), 2), 'kW MAE',
        [fact('nMAE rif.', fmt(exoVal(exoPref, 'nmae_ref', 'mean'), 2) + ' %'), fact('R²', fmt(exoVal(exoPref, 'r2', 'mean'), 3)),
          h('span', null, 'vs persistenza ', signed(exoVal(exoPref, 'skill', 'mean')))]),
    ));

    const OV = [
      { value: 'nmae_ref', label: 'nMAE sulla potenza di riferimento [%]', d: 2, unit: '%' },
      { value: 'nmae_mean', label: 'nMAE sulla potenza media misurata [%]', d: 1, unit: '%' },
      { value: 'skill', label: 'Miglioramento vs riferimento ingenuo [%]', d: 1, unit: '%' },
      { value: 'mae', label: 'MAE assoluto [kW o kWh/h]', d: 2, unit: '' },
    ];
    const met = OV.find(o => o.value === S.ovMetric) || OV[0];
    view.append(sectionTitle('Confronto tra tutte le configurazioni'));
    view.append(filters(
      selectCtl('Metrica', OV, met.value, v => set('ovMetric', v)),
      checkCtl('Includi la baseline della regressione (media)', S.ovBaseline, v => set('ovBaseline', v)),
    ));
    let rows = overviewRows().filter(r => S.ovBaseline || !r.baseline).filter(r => r[met.value] != null);
    const order = ['Regressione', 'LSTM endogena', 'LSTM esogena', GD_PART.endo, GD_PART.exoJ, GD_PART.endoJ];
    rows.sort((a, b) => order.indexOf(a.part) - order.indexOf(b.part) || a[met.value] - b[met.value]);
    const labels = rows.map(r => `${r.part} · ${r.name}`);
    const div = chartDiv();
    div.style.height = Math.max(260, rows.length * 30 + 90) + 'px';
    const desc = met.value === 'skill'
      ? 'Riferimento: stessa ora del giorno prima per l\'Abruzzo, persistenza (ultimo valore noto, TL passi prima) per Generation data. La regressione non compare: stima la potenza nello stesso istante.'
      : met.value === 'mae' ? 'Attenzione: l\'Abruzzo è in kWh per ora (equivalenti a kW medi nell\'ora) su un impianto da 995,67 kWp; gli altri in kW su Generation_data. I valori assoluti non sono confrontabili tra le parti.'
      : met.value === 'nmae_ref' ? `Riferimento: 995,67 kWp per l'Abruzzo; per Generation_data la potenza nominale non è nota e si usa la potenza massima misurata (${fmt(P_MAX, 1)} kW).`
      : 'Errore medio diviso la potenza (o energia) media misurata nel test. Nell\'Abruzzo la media comprende le ore notturne a produzione nulla.';
    view.append(card('Errore delle configurazioni', desc, [div,
      h('p', { class: 'note' }, 'In blu le configurazioni preferite (e il modello di regressione con MAE più basso); in grigio le altre. Il valore è riportato in fondo a ogni barra.')]));
    const hl = rows.map(r => r._hl);
    const mk = (sel, color, name) => ({
      type: 'bar', orientation: 'h', name, y: labels.filter((_, i) => hl[i] === sel), x: rows.filter((_, i) => hl[i] === sel).map(r => r[met.value]),
      marker: { color }, width: 0.62, text: rows.filter((_, i) => hl[i] === sel).map(r => fmt(r[met.value], met.d) + (met.unit ? ' ' + met.unit : '')),
      textposition: 'outside', cliponaxis: false, textfont: { color: c.text2, size: 11 },
      hovertemplate: `%{y}<br><b>%{x:.${met.d}f}${met.unit ? ' ' + met.unit : ''}</b><extra></extra>`,
    });
    plot(div, [mk(true, c.s1, 'Configurazione preferita'), mk(false, c.neutral, 'Altre configurazioni')], {
      barmode: 'overlay', margin: { l: 10, r: 70, t: 36, b: 44 },
      yaxis: { categoryorder: 'array', categoryarray: labels, autorange: 'reversed', showline: false, gridcolor: 'rgba(0,0,0,0)', tickfont: { color: c.text2, size: 12 } },
      xaxis: { title: { text: met.label }, zeroline: met.value === 'skill', zerolinecolor: c.axis, rangemode: 'tozero' },
    }, 'confronto_configurazioni');

    view.append(card('Tabella di confronto', 'Tutte le configurazioni con metriche disponibili. Clicca sulle intestazioni per ordinare.',
      table([
        { key: 'part', label: 'Parte' }, { key: 'name', label: 'Configurazione' },
        { key: 'step', label: 'Passo' }, { key: 'th', label: 'Finestra (TH)' }, { key: 'tl', label: 'Orizzonte (TL)' },
        { key: 'cells', label: 'Celle / neuroni' },
        { key: 'mae', label: 'MAE', num: true, render: r => fmt(r.mae, 2) + ' ' + r.unit },
        { key: 'nmae_ref', label: 'nMAE rif. %', num: true, fmt: v => fmt(v, 2) },
        { key: 'nmae_mean', label: 'nMAE media %', num: true, fmt: v => fmt(v, 1) },
        { key: 'skill', label: 'vs riferimento', num: true, render: r => signed(r.skill), title: 'Abruzzo: stessa ora di ieri; Generation data: persistenza' },
        { key: 'r2', label: 'R²', num: true, fmt: v => fmt(v, 3) },
        { key: 'src', label: 'Fonte' },
      ], overviewRows())));

    // explanation of the normalised MAE
    const exA = abrAvail ? abrVal(abrPref, 'mae', 'mean') : null, exE = exoVal(exoPref, 'mae', 'mean');
    view.append(card('Che cos\'è il MAE normalizzato (nMAE)', null, h('div', { class: 'prose' },
      h('p', null, 'Il MAE dice di quanto sbaglia in media un modello, nell\'unità della grandezza prevista (kW o kWh). Dipende però dalla taglia dell\'impianto: 25 kW di errore su un impianto da 995,67 kWp non pesano come 25 kW su uno da 330 kW. Il MAE normalizzato divide l\'errore per una potenza di riferimento e lo esprime in percentuale, così modelli su impianti diversi diventano confrontabili.'),
      h('div', { class: 'formula' }, 'nMAE = MAE / P_rif × 100 %'),
      h('p', null, 'Il risultato cambia con il riferimento scelto, ed è una scelta da dichiarare nella tesi:'),
      h('ul', null,
        h('li', null, h('b', null, 'Potenza nominale (o di riferimento). '), `Per l'Abruzzo è 995,67 kWp. Per Generation_data la potenza nominale non è nota, quindi qui si usa la potenza massima misurata, ${fmt(P_MAX, 1)} kW. ` +
          (exA != null ? `Esempio: ${abrPref.id} ha MAE medio ${fmt(exA, 2)} kWh → ${fmt(100 * exA / P_NOM, 2)} % di 995,67 kWp; ${exoPref.id} ha MAE ${fmt(exE, 2)} kW → ${fmt(100 * exE / P_MAX, 2)} % di ${fmt(P_MAX, 1)} kW.` : '')),
        h('li', null, h('b', null, 'Potenza media misurata nel test. '), `È la definizione usata dal tuo script di regressione (colonna nMAE di metriche.txt: ${fmt(best.nmae, 2)} % per ${best.label}). Nell'Abruzzo la media include le ore notturne a produzione nulla, mentre Generation_data non contiene la notte: per questo le due normalizzazioni possono dare classifiche diverse tra le parti.`),
      ),
      h('p', null, 'Nota: un\'energia in kWh prodotta in un\'ora equivale alla potenza media in kW in quell\'ora, quindi gli errori orari dell\'Abruzzo si leggono anche come kW medi.'),
    )));
  }

  // ================================================================== VIEW: regression
  function viewRegression() {
    const c = C();
    const run = regRun(S.regRun);
    view.append(h('div', { class: 'view-head' }, h('h2', null, 'Parte 1 · Modello di regressione'),
      h('p', null, `Stima della potenza AC nello stesso istante a partire da ${REG.inputs.join(', ')} (foglio Dati_completi, ${fmt(REG.n, 0)} campioni). Divisione casuale 70/15/15; metriche sul test. Script: ${REG.script}.`)));
    const models = run.metrics.map(m => ({ value: m.id, label: m.label }));
    if (!run.metrics.some(m => m.id === S.regModel)) S.regModel = 'single_neuron';
    view.append(filters(
      selectCtl('Run', REG.runs.map(r => ({ value: r.name, label: r.name + (r.used ? ' (usato nella tesi)' : '') })), run.name, v => set('regRun', v)),
      selectCtl('Modello (grafico di dispersione)', models, S.regModel, v => set('regModel', v)),
      segCtl('Errore per fascia di potenza', [{ value: 'bias', label: 'Errore medio' }, { value: 'mae', label: 'MAE' }], S.regBins, v => set('regBins', v)),
    ));
    if (!run.used) view.append(callout('Stai guardando un run diverso da quello scelto per la tesi. I due run differiscono perché la divisione train/test è casuale e senza seed.'));
    view.append(h('div', { class: 'grid four' }, run.metrics.map(m => tile(m.label, null, fmt(m.mae, 3), 'kW MAE',
      [fact('RMSE', fmt(m.rmse, 3)), fact('R²', fmt(m.r2, 4)), fact('nMAE', fmt(m.nmae, 2) + ' %')]))));

    // scatter + error by power band
    const sc = run.scatter;
    const g = h('div', { class: 'grid two' }); view.append(sectionTitle('Previsione contro misura')); view.append(g);
    const d1 = chartDiv('square'), d2 = chartDiv('square');
    const mSel = run.metrics.find(m => m.id === S.regModel);
    g.append(card(`Dispersione · ${mSel.label}`, `Potenza prevista contro potenza misurata sui ${fmt(sc ? sc.measured.length : 0, 0)} campioni di test; la retta è la previsione perfetta.`, d1));
    g.append(card(S.regBins === 'bias' ? 'Errore medio per fascia di potenza misurata' : 'MAE per fascia di potenza misurata',
      S.regBins === 'bias' ? 'Valori positivi = sovrastima. Fasce di 25 kW; la baseline è esclusa.' : 'Errore assoluto medio in ogni fascia di 25 kW; la baseline è esclusa.', d2));
    if (!sc) { d1.replaceWith(emptyBox('Dati di dispersione non disponibili per questo run.')); d2.replaceWith(emptyBox('—')); }
    else {
      const meas = sc.measured, pr = sc.pred[S.regModel];
      const lo = Math.min(0, ...pr.filter(v => v != null)), hi = Math.max(...meas, ...pr.filter(v => v != null));
      plot(d1, [
        { type: 'scattergl', mode: 'markers', x: meas, y: pr, name: mSel.label,
          marker: { size: 4, color: c[REG_COLOR[S.regModel]], opacity: 0.28 },
          hovertemplate: 'Misurata %{x:.1f} kW<br><b>Prevista %{y:.1f} kW</b><extra></extra>' },
        lineT([lo, hi], [lo, hi], 'Previsione perfetta', c.muted, { line: { color: c.muted, width: 1 }, hoverinfo: 'skip' }),
      ], { showlegend: false, margin: { t: 16 }, xaxis: { title: { text: 'Potenza misurata [kW]' }, range: [lo, hi * 1.02] },
        yaxis: { title: { text: 'Potenza prevista [kW]' }, range: [lo, hi * 1.02] } }, 'regressione_dispersione');

      const edges = []; for (let e = 0; e <= 350; e += 25) edges.push(e);
      const centres = edges.slice(0, -1).map((e, i) => (e + edges[i + 1]) / 2);
      const traces = ['linear', 'single_neuron', 'mlp'].filter(id => sc.pred[id]).map(id => {
        const sums = centres.map(() => [0, 0]);
        const p = sc.pred[id];
        for (let i = 0; i < meas.length; i++) {
          const b = Math.min(centres.length - 1, Math.floor(meas[i] / 25)); if (b < 0 || p[i] == null) continue;
          const e = p[i] - meas[i]; sums[b][0] += S.regBins === 'bias' ? e : Math.abs(e); sums[b][1]++;
        }
        const label = run.metrics.find(m => m.id === id).label;
        return lineT(centres, sums.map(s => s[1] ? s[0] / s[1] : null), label, c[REG_COLOR[id]],
          { mode: 'lines+markers', marker: { size: 8, color: c[REG_COLOR[id]], line: { color: c.surface, width: 2 } },
            customdata: sums.map(s => s[1]), hovertemplate: `<b>%{y:.2f} kW</b> · ${label}<br>fascia %{x:.1f} kW (%{customdata} campioni)<extra></extra>` });
      });
      plot(d2, traces, { hovermode: 'x unified', xaxis: { title: { text: 'Potenza misurata (centro della fascia) [kW]' } },
        yaxis: { title: { text: S.regBins === 'bias' ? 'Errore medio (previsto − misurato) [kW]' : 'MAE [kW]' }, zeroline: true, zerolinecolor: c.axis } }, 'regressione_errore_fasce');
    }

    // error distribution
    if (sc) {
      const d3 = chartDiv('short');
      view.append(card('Distribuzione degli errori', 'Percentuale dei campioni di test per errore (previsto − misurato), in classi da 2 kW. La baseline è esclusa.', d3));
      const bins = []; for (let e = -80; e < 80; e += 2) bins.push(e + 1);
      const tr = ['linear', 'single_neuron', 'mlp'].filter(id => sc.pred[id]).map(id => {
        const cnt = bins.map(() => 0); const p = sc.pred[id];
        for (let i = 0; i < p.length; i++) { const e = p[i] - sc.measured[i]; const b = Math.floor((e + 80) / 2); if (b >= 0 && b < cnt.length) cnt[b]++; }
        const label = run.metrics.find(m => m.id === id).label;
        return lineT(bins, cnt.map(v => 100 * v / p.length), label, c[REG_COLOR[id]], { line: { color: c[REG_COLOR[id]], width: 2, shape: 'hvh' },
          hovertemplate: `<b>%{y:.2f} %</b> · ${label}<extra></extra>` });
      });
      plot(d3, tr, { hovermode: 'x unified', xaxis: { title: { text: 'Errore [kW]' } }, yaxis: { title: { text: 'Campioni [%]' }, rangemode: 'tozero' } }, 'regressione_distribuzione_errori');
    }

    // table over runs
    const rows = [];
    for (const r of REG.runs) for (const m of r.metrics) {
      const other = REG.runs.find(o => o.name !== r.name);
      const om = other ? other.metrics.find(x => x.id === m.id) : null;
      rows.push(Object.assign({}, m, { run: r.name + (r.used ? ' ★' : ''), dmae: om ? m.mae - om.mae : null, _hl: r.used }));
    }
    view.append(card('Metriche di tutti i run', 'Valori letti da Modelli/metriche.txt di ogni run (★ = run usato nella tesi). "Verifica" = MAE ricalcolato dai punti del grafico salvato: deve coincidere.',
      table([
        { key: 'run', label: 'Run' }, { key: 'label', label: 'Modello' },
        { key: 'rmse', label: 'RMSE [kW]', num: true, fmt: v => fmt(v, 3) }, { key: 'mae', label: 'MAE [kW]', num: true, fmt: v => fmt(v, 3) },
        { key: 'nmae', label: 'nMAE [%]', num: true, fmt: v => fmt(v, 3) }, { key: 'nmae_ref', label: 'nMAE rif. [%]', num: true, fmt: v => fmt(v, 3) },
        { key: 'r2', label: 'R²', num: true, fmt: v => fmt(v, 4) }, { key: 'bias', label: 'Errore medio [kW]', num: true, fmt: v => fmt(v, 3) },
        { key: 'check_mae', label: 'Verifica MAE', num: true, fmt: v => fmt(v, 3) },
        { key: 'dmae', label: 'Δ MAE vs altro run', num: true, fmt: v => fmtS(v, 3) },
      ], rows)));
    view.append(h('p', { class: 'note' }, `nMAE rif. = MAE / ${fmt(P_MAX, 1)} kW (potenza massima misurata in Generation_data). Fonti: ${REG.runs.map(r => r.source).join(' · ')}.`));
  }

  // ================================================================== VIEW: Abruzzo
  function viewAbruzzo() {
    const c = C();
    const met = abrMetricDef(S.abrMetric);
    view.append(h('div', { class: 'view-head' }, h('h2', null, 'Parte 2 · LSTM endogena (Monomega Abruzzo)'),
      h('p', null, 'Previsione dell\'energia oraria (WR1 + WR2) dell\'impianto da 995,67 kWp usando solo la sua storia. Un modello per stagione; test = ultimo 10 % di ogni stagione (circa 9 giorni).')));
    const anyCsv = ABR.configs.some(abrHasCsv);
    const noMetrics = ABR.configs.filter(c2 => !abrHasData(c2)).map(c2 => c2.id);
    if (!anyCsv) view.append(callout('Le previsioni dell\'Abruzzo non sono ancora salvate. Ho aggiunto l\'esportazione dei CSV agli script: rilanciali in MATLAB e poi fai doppio clic su aggiorna_dashboard.bat. Fino ad allora le metriche vengono da Metrics.txt e i grafici di dettaglio mostrano le immagini originali.'));
    if (noMetrics.length) view.append(callout(`Configurazioni senza metriche (solo grafici): ${noMetrics.join(', ')}.`, true));

    const seasonOpts = [{ value: 'mean', label: 'Media delle 4 stagioni' }].concat(ABR_SEASONS.map(s => ({ value: s.key, label: s.label })));
    view.append(filters(
      selectCtl('Metrica', ABR_METRICS, met.value, v => set('abrMetric', v)),
      selectCtl('Stagione', seasonOpts, S.abrSeason, v => set('abrSeason', v)),
    ));

    // heatmap TH x TL (128 cells)
    const THs = [24, 48, 72], TLs = [1, 12, 24];
    const z = THs.map(th => TLs.map(tl => { const cf = ABR.configs.find(x => x.th === th && x.tl === tl && x.cells === 128); return cf ? abrVal(cf, met.value, S.abrSeason) : null; }));
    const hm = chartDiv('short');
    const vals = z.flat().filter(v => v != null);
    const g1 = h('div', { class: 'grid two' });
    view.append(sectionTitle('Esplorazione di finestra (TH) e orizzonte (TL)'));
    view.append(g1);
    const hmRows = [];
    for (const th of THs) for (const tl of TLs) { const cf = ABR.configs.find(x => x.th === th && x.tl === tl && x.cells === 128); hmRows.push({ cfg: `TH${th}-TL${tl}`, v: cf ? abrVal(cf, met.value, S.abrSeason) : null }); }
    g1.append(card(`${met.label} · 128 celle`, `${S.abrSeason === 'mean' ? 'Media delle quattro stagioni' : seasonLabel(S.abrSeason)}. ` +
      (met.kind === 'div' ? 'Blu = la rete fa meglio del riferimento, rosso = peggio.' : 'Più scuro = errore più alto.') + ' n.d. = metrica non disponibile.',
    [hm, tableToggle('Mostra tabella', table([{ key: 'cfg', label: 'Configurazione' }, { key: 'v', label: met.label, num: true, fmt: v => fmt(v, met.d) }], hmRows))]));
    if (!vals.length) hm.replaceWith(emptyBox('Nessun valore disponibile.'));
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
    g1.append(card('La rete batte i riferimenti ingenui?', `Riduzione percentuale del MAE rispetto alla stessa ora del giorno prima (riferimento principale, per ogni TL) e alla persistenza (ultimo valore noto, TL ore prima), quest'ultima solo per TL ≤ ${ABR_PERS_MAX_TL} h: con orizzonti lunghi sposta i picchi di mezzogiorno nelle ore sbagliate (vedi Definizioni e note). Sopra zero = la rete è migliore.`, sk));
    const withData = ABR.configs.filter(x => S.abrSeason === 'mean' ? abrHasData(x) : abrMae(x.seasons[S.abrSeason]) != null);
    if (!withData.length) sk.replaceWith(emptyBox('Nessun dato.'));
    else {
      const xs = withData.map(x => x.id);
      plot(sk, [
        { type: 'bar', name: 'vs persistenza', x: xs, y: withData.map(x => abrVal(x, 'skill_pers', S.abrSeason)), marker: { color: c[ROLE.pers] },
          hovertemplate: '%{x}<br><b>%{y:+.1f} %</b> vs persistenza<extra></extra>' },
        { type: 'bar', name: 'vs stessa ora di ieri', x: xs, y: withData.map(x => abrVal(x, 'skill_yest', S.abrSeason)), marker: { color: c[ROLE.yest] },
          hovertemplate: '%{x}<br><b>%{y:+.1f} %</b> vs stessa ora di ieri<extra></extra>' },
      ], { barmode: 'group', yaxis: { title: { text: 'Riduzione del MAE [%]' }, zeroline: true, zerolinecolor: c.text2, zerolinewidth: 1 },
        xaxis: { tickangle: -30 } }, 'abruzzo_vs_riferimenti');
    }

    // cells & short horizons
    view.append(sectionTitle('Numero di celle e orizzonti brevi (TH = 72 h)'));
    const g2 = h('div', { class: 'grid two' }); view.append(g2);
    const cellSet = [12, 24, 36, 128].map(n => ABR.configs.find(x => x.th === 72 && x.tl === 1 && x.cells === n));
    const tlSet = [1, 2, 3].map(t => ABR.configs.find(x => x.th === 72 && x.tl === t && x.cells === 36));
    function seriesBySeason(div, cfgs, xs, xTitle, name) {
      const have = cfgs.filter(Boolean).filter(cf => ABR_SEASONS.some(s => abrSeasonVal(cf.seasons[s.key], met.value, cf.tl) != null));
      if (have.length < 2) { div.replaceWith(emptyBox('Dati non ancora disponibili per questo confronto.', 'Rilancia gli script corrispondenti in MATLAB e aggiorna la dashboard.')); return; }
      const tr = ABR_SEASONS.map((s, i) => lineT(xs, cfgs.map(cf => cf ? abrSeasonVal(cf.seasons[s.key], met.value, cf.tl) : null), s.label, c[['s1', 's2', 's3', 's4'][i]],
        { mode: 'lines+markers', marker: { size: 8, color: c[['s1', 's2', 's3', 's4'][i]], line: { color: c.surface, width: 2 } } }));
      tr.push(lineT(xs, cfgs.map(cf => cf ? abrVal(cf, met.value, 'mean') : null), 'Media', c.text1, { mode: 'lines+markers', line: { color: c.text1, width: 2.5 }, marker: { size: 9, color: c.text1, line: { color: c.surface, width: 2 } } }));
      plot(div, tr, { hovermode: 'x unified', xaxis: { title: { text: xTitle }, type: 'category' }, yaxis: { title: { text: met.label } } }, name);
    }
    const dc = chartDiv('short'), dt = chartDiv('short');
    g2.append(card('Effetto del numero di celle (TL = 1 h)', 'Stessa rete con 12, 24, 36 e 128 unità nascoste.', dc));
    g2.append(card('Orizzonti di 1, 2 e 3 ore (36 celle)', 'Quanto peggiora la previsione allontanando il bersaglio.', dt));
    seriesBySeason(dc, cellSet, ['12', '24', '36', '128'], 'Celle LSTM', 'abruzzo_celle');
    seriesBySeason(dt, tlSet, ['1 h', '2 h', '3 h'], 'Orizzonte TL', 'abruzzo_orizzonti_brevi');

    // detail
    view.append(sectionTitle('Dettaglio di una configurazione'));
    const cf = abrConfig(S.abrConfig);
    view.append(filters(
      selectCtl('Configurazione', ABR.configs.map(x => ({ value: x.id, label: x.id + (x.preferred ? ' · preferita' : '') + (abrHasCsv(x) ? '' : abrHasData(x) ? ' · solo metriche' : ' · solo grafici') })), cf.id, v => set('abrConfig', v)),
      selectCtl('Stagione', ABR_SEASONS.map(s => ({ value: s.key, label: s.label })), S.abrDetSeason, v => set('abrDetSeason', v)),
      checkCtl('Misura traslata di 1 h', S.abrPers, v => set('abrPers', v)),
      checkCtl('Stessa ora di ieri', S.abrYest, v => set('abrYest', v)),
    ));
    const s = cf.seasons[S.abrDetSeason];
    const mae = abrMae(s);
    view.append(h('div', { class: 'grid four' },
      tile('MAE della rete', `${cf.id} · ${seasonLabel(S.abrDetSeason)}`, fmt(mae, 2), 'kWh', [fact('MAPE diurno', fmt(abrMape(s), 1) + ' %'), fact('Fonte', s.csv ? 'CSV' : s.file ? 'Metrics.txt' : '—')]),
      cf.tl <= ABR_PERS_MAX_TL
        ? tile('Persistenza', `ultimo valore noto (${cf.tl} h prima)`, fmt(s.base.pers.mae, 2), 'kWh', [h('span', null, 'rete ', signed(abrSeasonVal(s, 'skill_pers', cf.tl)))])
        : tile('Persistenza', `non usata con TL = ${cf.tl} h`, '—', null, [h('span', null, 'riferimento: stessa ora di ieri')]),
      tile('Stessa ora di ieri', 'valore di 24 ore prima', fmt(s.base.yest.mae, 2), 'kWh', [h('span', null, 'rete ', signed(abrSeasonVal(s, 'skill_yest', cf.tl)))]),
      tile('Test', `${s.base.t_start.slice(0, 16)} → ${s.base.t_end.slice(0, 16)}`, fmt(s.base.n_test, 0), 'ore',
        [fact('Energia media', fmt(s.base.mean_real, 1) + ' kWh'), s.csv ? fact('R²', fmt(s.csv.r2, 3)) : null]),
    ));
    if (s.csv && s.file) view.append(h('p', { class: 'note' }, `Controllo di riproducibilità: MAE dal CSV ${fmt(s.csv.mae, 2)} kWh, in Metrics.txt ${fmt(s.file.mae, 2)} kWh.`));
    const ts = chartDiv('tall');
    view.append(card('Energia misurata e prevista nel test', 'Trascina sulla barra in basso per scegliere il periodo; passa il mouse per leggere tutti i valori di un\'ora.', ts,
      s.series ? explorerButton('abr', cf.id, S.abrDetSeason) : null));
    if (!s.series) {
      const repl = h('div', null, emptyBox('Previsioni non ancora salvate per questa configurazione e stagione.',
        cf.script ? `Rilancia ${cf.script} (cartella Monomega abruzzo) e poi aggiorna la dashboard.` : 'Script non trovato.'),
      s.png ? h('div', { class: 'thumb-inline' }, h('p', { class: 'note' }, 'Intanto, il grafico originale salvato da MATLAB:'), thumbBtn(s.png, `${cf.id} · ${seasonLabel(S.abrDetSeason)}`, s.png.src)) : null);
      ts.replaceWith(repl);
    } else {
      const sr = s.series;
      const tr = [lineT(sr.t, sr.real, 'Misurata', c[ROLE.measured], { hovertemplate: '<b>%{y:.1f} kWh</b> misurata<extra></extra>' }),
        lineT(sr.t, sr.pred, 'Prevista (LSTM)', c[ROLE.model], { hovertemplate: '<b>%{y:.1f} kWh</b> LSTM<extra></extra>' })];
      if (S.abrPers) tr.push(lineT(sr.t, sr.shift1, 'Misura traslata di 1 h', c[ROLE.pers], { line: { color: c[ROLE.pers], width: 1.5 }, hovertemplate: '<b>%{y:.1f} kWh</b> misura 1 h prima<extra></extra>' }));
      if (S.abrYest) tr.push(lineT(sr.t, sr.yest, 'Stessa ora di ieri', c[ROLE.yest], { line: { color: c[ROLE.yest], width: 1.5 }, hovertemplate: '<b>%{y:.1f} kWh</b> ieri<extra></extra>' }));
      plot(ts, tr, { hovermode: 'x unified', xaxis: { type: 'date', rangeslider: { visible: true, thickness: 0.08, bgcolor: c.surface2, bordercolor: c.axis }, tickformat: '%d/%m %H:%M' },
        yaxis: { title: { text: 'Energia [kWh]' }, rangemode: 'tozero' } }, `abruzzo_${cf.id}_${S.abrDetSeason}`);

      const g3 = h('div', { class: 'grid two' }); view.append(g3);
      const dh = chartDiv('short'), dl = chartDiv('short');
      g3.append(card('Errore per ora del giorno', 'MAE in ciascuna ora sui giorni di test.', dh));
      const bestK = { v: null };
      const lagCard = card('Analisi del ritardo', null, dl); g3.append(lagCard);
      const byHour = arrK => { const s2 = Array(24).fill(0), n = Array(24).fill(0); sr.hour.forEach((hh, i) => { if (arrK[i] != null && sr.real[i] != null) { s2[hh] += Math.abs(arrK[i] - sr.real[i]); n[hh]++; } }); return s2.map((v, i) => n[i] ? v / n[i] : null); };
      const hrs = [...Array(24).keys()];
      const htr = [lineT(hrs, byHour(sr.pred), 'LSTM', c[ROLE.model], { mode: 'lines+markers', marker: { size: 7, color: c[ROLE.model] } }),
        lineT(hrs, byHour(sr.yest), 'Stessa ora di ieri', c[ROLE.yest], { mode: 'lines+markers', marker: { size: 7, color: c[ROLE.yest] } })];
      if (cf.tl <= ABR_PERS_MAX_TL) htr.splice(1, 0, lineT(hrs, byHour(sr.pers), `Persistenza (${cf.tl} h prima)`, c[ROLE.pers], { mode: 'lines+markers', marker: { size: 7, color: c[ROLE.pers] } }));
      plot(dh, htr, { hovermode: 'x unified', xaxis: { title: { text: 'Ora del giorno' }, dtick: 2 }, yaxis: { title: { text: 'MAE [kWh]' }, rangemode: 'tozero' } }, 'abruzzo_errore_ora');
      bestK.v = lagChart(dl, sr.real, sr.pred, cf.tl, 'kWh', 'h');
      lagCard.querySelector('.card-head > div').append(h('p', { class: 'desc' },
        `MAE tra la previsione e la misura spostata di k ore. Se il minimo è a k = TL, la rete ripete l'ultimo valore noto. Qui il minimo è a k = ${bestK.v}.`));
    }

    // full table
    const rows = [];
    for (const x of ABR.configs) for (const ss of ABR_SEASONS) {
      const e = x.seasons[ss.key];
      rows.push({ cfg: x.id, season: ss.label, n: e.base.n_test, mae: abrMae(e), mape: abrMape(e), pers: x.tl <= ABR_PERS_MAX_TL ? e.base.pers.mae : null, yest: e.base.yest.mae,
        skp: abrSeasonVal(e, 'skill_pers', x.tl), sky: abrSeasonVal(e, 'skill_yest', x.tl), nnom: abrSeasonVal(e, 'nmae_nom', x.tl),
        src: e.csv ? 'CSV' : e.file ? 'Metrics.txt' : '—', d: e.csv && e.file ? e.csv.mae - e.file.mae : null, _hl: x.preferred });
    }
    view.append(sectionTitle('Tutte le configurazioni'));
    view.append(card('Tabella completa', `Persistenza e stessa ora di ieri sono calcolate dai dati misurati sugli stessi campioni di test; la persistenza è riportata solo per TL ≤ ${ABR_PERS_MAX_TL} h. "Δ" confronta il MAE ricalcolato dal CSV con Metrics.txt.`,
      table([
        { key: 'cfg', label: 'Configurazione' }, { key: 'season', label: 'Stagione' }, { key: 'n', label: 'Ore test', num: true },
        { key: 'mae', label: 'MAE [kWh]', num: true, fmt: v => fmt(v, 2) }, { key: 'mape', label: 'MAPE diurno [%]', num: true, fmt: v => fmt(v, 1) },
        { key: 'pers', label: 'MAE persistenza', num: true, fmt: v => fmt(v, 2) }, { key: 'yest', label: 'MAE ieri', num: true, fmt: v => fmt(v, 2) },
        { key: 'skp', label: 'vs persistenza', num: true, render: r => signed(r.skp) }, { key: 'sky', label: 'vs ieri', num: true, render: r => signed(r.sky) },
        { key: 'nnom', label: 'nMAE nom. [%]', num: true, fmt: v => fmt(v, 2) }, { key: 'src', label: 'Fonte' },
        { key: 'd', label: 'Δ CSV − Metrics', num: true, fmt: v => fmtS(v, 3) },
      ], rows, { scroll: true })));

    lstmvisSection(ABR.lstmvis, 'abrVis', 'Stati interni della rete (LSTMVis)', 'Stati nascosti esportati per l\'ultima stagione elaborata (Estate 2021), proiettati sulle prime due componenti principali e colorati con l\'etichetta usata in LSTMVis (decile dell\'energia reale; P_00% contiene le ore a produzione nulla).');
  }

  // ------------------------------------------------------------------ LSTMVis section (shared)
  function lstmvisSection(list, key, title, desc) {
    if (!list.length) return;
    const c = C();
    const v = list.find(x => x.config === S[key]) || list[0];
    view.append(sectionTitle(title));
    view.append(filters(selectCtl('Esportazione', list.map(x => ({ value: x.config, label: `${x.config} · ${x.season} · ${x.units} unità` })), v.config, val => set(key, val))));
    const g = h('div', { class: 'grid two' }); view.append(g);
    const d1 = chartDiv('square');
    g.append(card(`Componenti principali · ${v.config}`, desc, d1));
    const tr = [{ type: v.n > 1500 ? 'scattergl' : 'scatter', mode: 'markers', name: 'Stati', x: v.pc1, y: v.pc2,
      customdata: v.decile.map(d => `P_${String(d * 10).padStart(2, '0')}%`),
      marker: { size: v.n > 1500 ? 6 : 8, color: v.decile.map(d => d * 10), cmin: 0, cmax: 90, colorscale: toScale(c.ord),
        line: { color: c.surface, width: v.n > 1500 ? 0.5 : 1.5 },
        colorbar: { title: { text: 'Decile [%]', font: { color: c.text2, size: 11 } }, thickness: 10, outlinewidth: 0, tickvals: [0, 30, 60, 90], tickfont: { color: c.muted, size: 11 } } },
      hovertemplate: '%{customdata}<br>PC1 %{x:.2f} · PC2 %{y:.2f}<extra></extra>' }];
    plot(d1, tr, { showlegend: false, margin: { t: 16 }, xaxis: { title: { text: `PC1 (${fmt(v.evr[0], 1)} % della varianza)` }, zeroline: false },
      yaxis: { title: { text: `PC2 (${fmt(v.evr[1], 1)} % della varianza)` } } }, 'lstmvis_pca');
    const d2 = chartDiv('short');
    const right = h('div', null, d2,
      h('p', { class: 'note' }, `${fmt(v.n, 0)} campioni × ${v.units} unità · stati tra ${fmt(v.state_min, 3)} e ${fmt(v.state_max, 3)} (media ${fmt(v.state_mean, 3)}) · correlazione PC1–decile ${fmt(v.pc1_corr_decile, 2)} · file ${v.file}`),
      h('p', { class: 'section-title' }, 'Unità più correlate con il decile di energia'),
      table([{ key: 'unit', label: 'Unità (da 0)', num: true }, { key: 'corr', label: 'Correlazione', num: true, fmt: x => fmtS(x, 2) }], v.top_units, { sortKey: null }));
    g.append(card('Varianza spiegata', 'Quota di varianza degli stati spiegata dalle prime cinque componenti.', right));
    plot(d2, [{ type: 'bar', x: v.evr.map((_, i) => 'PC' + (i + 1)), y: v.evr, marker: { color: c.s1 }, width: 0.5,
      text: v.evr.map(x => fmt(x, 1) + ' %'), textposition: 'outside', cliponaxis: false, textfont: { color: c.text2 },
      hovertemplate: '%{x}<br><b>%{y:.1f} %</b><extra></extra>' }],
    { showlegend: false, margin: { t: 20 }, yaxis: { title: { text: 'Varianza spiegata [%]' }, rangemode: 'tozero' } }, 'lstmvis_varianza');
  }

  // ================================================================== Generation_data: shared pieces
  // TH x TL heatmap; valFn(th, tl) -> value or null
  function gridHeat(div, ths, tls, valFn, met, diverging, name) {
    const c = C();
    const z = ths.map(th => tls.map(tl => valFn(th, tl)));
    const vals = z.flat().filter(v => v != null && isFinite(v));
    if (!vals.length) { div.replaceWith(emptyBox('Nessun valore disponibile.')); return; }
    let zmin = Math.min(...vals), zmax = Math.max(...vals), stops = c.seq;
    if (diverging) { const a = Math.max(...vals.map(Math.abs)) || 1; zmin = -a; zmax = a; stops = c.div; }
    if (zmax === zmin) zmax = zmin + 1;
    const xl = tls.map(t => `TL ${t}`), yl = ths.map(t => `TH ${t}`);
    const ann = [];
    ths.forEach((th, i) => tls.forEach((tl, j) => {
      const v = z[i][j];
      const col = v == null ? c.muted : (lum(scaleColor(stops, (v - zmin) / (zmax - zmin))) > 0.35 ? '#0b0b0b' : '#ffffff');
      ann.push({ x: xl[j], y: yl[i], text: v == null ? '—' : (diverging && v > 0 ? '+' : '') + fmt(v, met.d) + (met.unit === '%' ? ' %' : ''), showarrow: false, font: { color: col, size: 12 } });
    }));
    plot(div, [{ type: 'heatmap', x: xl, y: yl, z, zmin, zmax, colorscale: toScale(stops), xgap: 3, ygap: 3, hoverongaps: false,
      colorbar: { thickness: 10, outlinewidth: 0, tickfont: { color: c.muted, size: 11 } },
      hovertemplate: `%{y} · %{x} passi<br><b>%{z:.${met.d}f} ${met.unit}</b><extra></extra>` }],
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
  function meanOn(keys, cf, m, ofPers, samples) { return cf ? mean(keys.map(k => exoSeasonVal(gdView(cf.seasons[k], samples), m, ofPers))) : null; }
  const LOWER_BETTER = { mae: true, mape: true, wmape: true, nmae_mean: true, nmae_ref: true, skill: false, r2: false };
  // positive = the exogenous network is better
  function advantage(m, endoV, exoV) { if (endoV == null || exoV == null) return null; return LOWER_BETTER[m] ? endoV - exoV : exoV - endoV; }

  // ================================================================== VIEW: Generation_data networks (exogenous / endogenous)
  function viewGD(base) {
    const c = C();
    const mode = S['gdMode_' + base] === 'joined' ? 'joined' : 'sep';
    const fk = gdFam(base, mode), F = GD[fk], joined = mode === 'joined', isEndo = base === 'endo';
    const met = exoMetricDef(S.gdMetric);
    const seasons = F.seasons;
    view.append(h('div', { class: 'view-head' }, h('h2', null, isEndo ? 'Parte 3b · LSTM endogena su Generation data' : 'Parte 3 · LSTM esogena'),
      h('p', null, 'Previsione della potenza AC di Generation_data ' +
        (isEndo ? 'usando solo la potenza passata (un canale), con le stesse impostazioni della rete esogena. ' : 'usando come serie temporali la potenza passata e le quattro variabili della regressione. ') +
        (joined ? 'Anni uniti: per ogni stagione la rete è addestrata sugli anni 1 e 2 e provata su tutto il foglio dell\'anno 3 (Primavera: solo anno 2, perché Primavera_1 non esiste). ' : 'Un modello per foglio (11 fogli); test = ultimo 20 % delle finestre di ogni foglio. ') +
        'Passo stimato 5 minuti; TH e TL sono in passi.')));
    const ctl = [segCtl('Addestramento', [{ value: 'sep', label: 'Stagioni separate' }, { value: 'joined', label: 'Anni uniti (1 + 2 → 3)' }], mode, v => set('gdMode_' + base, v)),
      selectCtl('Metrica', EXO_METRICS, met.value, v => set('gdMetric', v))];
    if (joined) ctl.push(segCtl('Campioni di test', [{ value: 'last20', label: 'Ultimo 20 % (come le reti per stagione)' }, { value: 'all', label: 'Tutto l\'anno 3' }], S.gdSamples, v => set('gdSamples', v)));
    view.append(filters(...ctl));
    if (F.pending && F.pending.length) view.append(callout(`Script senza risultati salvati (da lanciare o in esecuzione): ${F.pending.join(', ')}.`, true));
    if (!F.configs.length) { view.append(emptyBox('Nessun risultato ancora disponibile per queste reti.', 'Quando gli script avranno finito, aggiorna la dashboard.')); return; }

    // TH x TL map
    const cellsList = cellsOf(F);
    const cells = cellsList.includes(Number(S.gdCells)) ? Number(S.gdCells) : cellsList[0];
    const seasonOpts = [{ value: 'mean', label: `Media delle ${seasons.length} stagioni` }].concat(seasons.map(s => ({ value: s.key, label: s.label })));
    const sKey = seasons.some(s => s.key === S['gdMapSeason_' + fk]) ? S['gdMapSeason_' + fk] : 'mean';
    view.append(sectionTitle('Finestra (TH) e orizzonte (TL)'));
    view.append(filters(selectCtl('Celle', cellsList.map(n => ({ value: n, label: n + ' celle' })), cells, v => set('gdCells', Number(v))),
      selectCtl('Stagione', seasonOpts, sKey, v => set('gdMapSeason_' + fk, v))));
    const { ths, tls } = axesOf(cells, F);
    const g1 = h('div', { class: 'grid two' }); view.append(g1);
    const hm = chartDiv('short'), hp = chartDiv('short');
    g1.append(card(`${met.label} · ${cells} celle`, (sKey === 'mean' ? 'Media sulle stagioni. ' : seasonLabel(sKey) + '. ') + (met.value === 'skill' ? 'Blu = la rete batte la persistenza.' : 'Scala dei colori a destra.') + ' — = combinazione non provata.', hm));
    g1.append(card('Persistenza sugli stessi campioni', 'Riferimento ingenuo: la misura di TL passi prima, cioè l\'ultimo valore noto quando si fa la previsione.', hp));
    const v1 = (th, tl) => { const cf = gdCfg(F, th, tl, cells); return cf ? gdVal(F, cf, met.value, sKey) : null; };
    gridHeat(hm, ths, tls, v1, met, met.value === 'skill', `${fk}_mappa`);
    if (met.value === 'skill' || met.value === 'r2') hp.replaceWith(emptyBox('Per questa metrica la persistenza non ha un valore proprio: scegli un errore (MAE, MAPE, nMAE).'));
    else gridHeat(hp, ths, tls, (th, tl) => { const cf = gdCfg(F, th, tl, cells); return cf ? gdVal(F, cf, met.value, sKey, true) : null; }, met, false, `${fk}_mappa_persistenza`);

    const sum = F.configs.map(cf => ({ id: cf.id, desc: exoDesc(cf), lr: cf.lr, script: cf.script, n: Object.keys(cf.seasons).length,
      mae: gdVal(F, cf, 'mae', 'mean'), mape: gdVal(F, cf, 'mape', 'mean'), wmape: gdVal(F, cf, 'wmape', 'mean'), r2: gdVal(F, cf, 'r2', 'mean'),
      pers: gdVal(F, cf, 'mae', 'mean', true), skill: gdVal(F, cf, 'skill', 'mean'), _hl: cf.preferred }));
    view.append(card(`Media delle stagioni (${seasons.length})`, 'Media semplice delle metriche delle stagioni. Le metriche sono ricalcolate dai file Risultati_<stagione>.csv con le stesse formule degli script.',
      table([{ key: 'id', label: 'Configurazione' }, { key: 'desc', label: 'Parametri' }, { key: 'lr', label: 'Learning rate', num: true },
        { key: 'n', label: 'Stagioni', num: true },
        { key: 'mae', label: 'MAE [kW]', num: true, fmt: v => fmt(v, 2) }, { key: 'mape', label: 'MAPE diurno [%]', num: true, fmt: v => fmt(v, 1) },
        { key: 'wmape', label: 'wMAPE [%]', num: true, fmt: v => fmt(v, 1) }, { key: 'r2', label: 'R²', num: true, fmt: v => fmt(v, 3) },
        { key: 'pers', label: 'MAE persistenza', num: true, fmt: v => fmt(v, 2) }, { key: 'skill', label: 'vs persistenza', num: true, render: r => signed(r.skill) },
        { key: 'script', label: 'Script' }], sum, { sortKey: 'mae' })));

    // detail
    view.append(sectionTitle('Dettaglio di una configurazione'));
    const cfK = 'gdCfg_' + fk, ssK = 'gdSeason_' + fk;
    const cf = F.configs.find(x => x.id === S[cfK]) || F.configs.find(x => x.preferred) || F.configs[0];
    const avail = seasons.filter(s => cf.seasons[s.key]);
    const sk = avail.some(s => s.key === S[ssK]) ? S[ssK] : (avail.find(s => s.key === 'Estate_3') || avail[0]).key;
    view.append(filters(
      selectCtl('Configurazione', F.configs.map(x => ({ value: x.id, label: x.id + (x.preferred ? ' · preferita' : '') })), cf.id, v => set(cfK, v)),
      selectCtl('Stagione', avail.map(s => ({ value: s.key, label: s.label })), sk, v => set(ssK, v)),
      segCtl('Asse orizzontale', [{ value: 'samples', label: 'Riga del foglio' }, { value: 'hours', label: 'Ore (stima 5 min)' }], S.gdAxis, v => set('gdAxis', v)),
      checkCtl('Misura traslata di 1 passo', S.gdPers, v => set('gdPers', v)),
    ));
    const raw = cf.seasons[sk], s = gdView(raw), m = s.metrics;
    view.append(h('div', { class: 'grid four' },
      tile('MAE della rete', `${cf.id} · ${seasonLabel(sk)}`, fmt(m.mae, 2), 'kW', [fact('RMSE', fmt(m.rmse, 2)), fact('R²', fmt(m.r2, 3))]),
      tile('Persistenza', `ultimo valore noto (${cf.tl} passi prima)`, fmt(s.pers.mae, 2), 'kW', [h('span', null, 'rete ', signed(exoSeasonVal(s, 'skill')))]),
      tile('Errori percentuali', 'ore diurne (> 5 % del massimo)', fmt(m.mape_day, 1), '% MAPE', [fact('wMAPE', fmt(m.wmape_day, 1) + ' %')]),
      tile('Test', exoDesc(cf), fmt(s.n_test, 0), 'campioni', [fact('su', fmt(raw.n_series, 0) + ' righe'),
        joined ? fact('addestrata su', raw.train.join(' + ')) : fact('Potenza media', fmt(m.mean_real, 1) + ' kW')]),
    ));
    const sr = raw.series;
    const x = S.gdAxis === 'hours' ? sr.idx.map(i => (i - sr.idx[0]) * EXO.step_min / 60) : sr.idx;
    const xTitle = S.gdAxis === 'hours' ? 'Ore dall\'inizio del test (stima, notti escluse)' : 'Riga del foglio della stagione';
    const ts = chartDiv('tall');
    view.append(card('Potenza misurata e prevista nel test', 'Le notti non sono nei dati: un giorno segue subito il precedente. All\'apertura è mostrato l\'inizio del test; usa la barra in basso per spostarti.' +
      (joined ? ' La linea verticale segna l\'inizio dell\'ultimo 20 %, cioè il test delle reti per stagione.' : ''), ts, explorerButton('exo', fk + ':' + cf.id, sk)));
    const tr2 = [lineT(x, sr.real, 'Misurata', c[ROLE.measured], { hovertemplate: '<b>%{y:.1f} kW</b> misurata<extra></extra>' }),
      lineT(x, sr.pred, 'Prevista (LSTM)', c[ROLE.model], { hovertemplate: '<b>%{y:.1f} kW</b> LSTM<extra></extra>' })];
    if (S.gdPers) tr2.push(lineT(x, sr.shift1, 'Misura traslata di 1 passo (5 min)', c[ROLE.pers], { line: { color: c[ROLE.pers], width: 1.5 }, hovertemplate: '<b>%{y:.1f} kW</b> misura 1 passo prima<extra></extra>' }));
    const win = Math.min(x.length - 1, 288);
    const lay = { hovermode: 'x unified', xaxis: { title: { text: xTitle }, range: [x[0], x[win]], rangeslider: { visible: true, thickness: 0.08, bgcolor: c.surface2, bordercolor: c.axis } },
      yaxis: { title: { text: 'Potenza AC [kW]' }, rangemode: 'tozero' } };
    if (joined) {
      const xi = sr.idx.indexOf(raw.last20_first);
      if (xi >= 0) { const v = vline(x[xi], c.text2, 'inizio ultimo 20 %', 'right'); lay.shapes = [v.shape]; lay.annotations = [v.ann]; }
    }
    plot(ts, tr2, lay, `${fk}_${cf.id}_${sk}`);

    const g = h('div', { class: 'grid two' }); view.append(g);
    const dsc = chartDiv('square'), dl = chartDiv('square');
    g.append(card('Previsione contro misura', 'Ogni punto è un campione di test (tutto il test salvato nel CSV); la retta è la previsione perfetta.', dsc));
    const lagCard = card('Analisi del ritardo', null, dl); g.append(lagCard);
    const hi = Math.max(...sr.real, ...sr.pred);
    plot(dsc, [{ type: 'scattergl', mode: 'markers', x: sr.real, y: sr.pred, name: 'Campioni', marker: { size: 4, color: c[ROLE.model], opacity: 0.35 },
      hovertemplate: 'Misurata %{x:.1f} kW<br><b>Prevista %{y:.1f} kW</b><extra></extra>' },
    lineT([0, hi], [0, hi], 'Previsione perfetta', c.muted, { line: { color: c.muted, width: 1 }, hoverinfo: 'skip' })],
    { showlegend: false, margin: { t: 16 }, xaxis: { title: { text: 'Potenza misurata [kW]' }, range: [0, hi * 1.02] }, yaxis: { title: { text: 'Potenza prevista [kW]' }, range: [0, hi * 1.02] } }, `${fk}_dispersione`);
    const k = lagChart(dl, sr.real, sr.pred, cf.tl, 'kW', 'passi');
    lagCard.querySelector('.card-head > div').append(h('p', { class: 'desc' },
      `MAE tra la previsione e la misura spostata di k passi. Se il minimo è a k = TL, la rete ripete l'ultimo valore noto. Qui il minimo è a k = ${k}.`));

    const lagRows = [], rows = [];
    for (const x2 of F.configs) for (const ss of seasons) {
      const e0 = x2.seasons[ss.key]; if (!e0) continue;
      const e = gdView(e0);
      const { ks, m: mm } = lagCurve(e0.series.real, e0.series.pred, -6, x2.tl + 8);
      let b = 0; mm.forEach((v, i) => { if (v != null && (mm[b] == null || v < mm[b])) b = i; });
      lagRows.push({ cfg: x2.id, tl: x2.tl, season: ss.label, k: ks[b], m0: mm[ks.indexOf(0)], mk: mm[b], _hl: x2.preferred });
      rows.push({ cfg: x2.id, season: ss.label, n: e.n_test, mae: e.metrics.mae, rmse: e.metrics.rmse, r2: e.metrics.r2, mape: e.metrics.mape_day,
        wmape: e.metrics.wmape_day, pers: e.pers.mae, skill: exoSeasonVal(e, 'skill'), src: e0.metrics.source, _hl: x2.preferred });
    }
    view.append(card('Ritardo in tutte le stagioni', 'Per ogni configurazione e stagione: spostamento k con l\'errore minimo (su tutto il test salvato). k = 0 vuol dire previsione in fase; k = TL vuol dire che la rete si comporta come la persistenza.',
      tableToggle('Mostra tabella', table([{ key: 'cfg', label: 'Configurazione' }, { key: 'tl', label: 'TL [passi]', num: true }, { key: 'season', label: 'Stagione' },
        { key: 'k', label: 'k con MAE minimo', num: true }, { key: 'm0', label: 'MAE a k = 0 [kW]', num: true, fmt: v => fmt(v, 2) },
        { key: 'mk', label: 'MAE minimo [kW]', num: true, fmt: v => fmt(v, 2) }], lagRows, { scroll: true }))));
    view.append(sectionTitle('Tutte le configurazioni'));
    view.append(card('Tabella completa', joined ? (S.gdSamples === 'last20' ? 'Metriche sull\'ultimo 20 % dell\'anno 3 (stessi campioni delle reti per stagione).' : 'Metriche su tutto il foglio dell\'anno 3.') : null, table([
      { key: 'cfg', label: 'Configurazione' }, { key: 'season', label: 'Stagione' }, { key: 'n', label: 'Campioni test', num: true },
      { key: 'mae', label: 'MAE [kW]', num: true, fmt: v => fmt(v, 2) }, { key: 'rmse', label: 'RMSE [kW]', num: true, fmt: v => fmt(v, 2) },
      { key: 'r2', label: 'R²', num: true, fmt: v => fmt(v, 3) }, { key: 'mape', label: 'MAPE diurno [%]', num: true, fmt: v => fmt(v, 1) },
      { key: 'wmape', label: 'wMAPE [%]', num: true, fmt: v => fmt(v, 1) }, { key: 'pers', label: 'MAE persistenza', num: true, fmt: v => fmt(v, 2) },
      { key: 'skill', label: 'vs persistenza', num: true, render: r => signed(r.skill) }, { key: 'src', label: 'File' },
    ], rows, { scroll: true })));

    lstmvisSection(F.lstmvis, 'gdVis_' + fk, 'Stati interni della rete (LSTMVis)', 'Stati nascosti esportati per l\'ultima stagione elaborata (Estate_3), proiettati sulle prime due componenti principali e colorati con il decile della potenza reale.');
  }

  // ================================================================== VIEW: endogenous vs exogenous (Generation_data)
  function viewCompare() {
    const c = C();
    const mode = S.cmpMode === 'joined' ? 'joined' : 'sep', joined = mode === 'joined';
    const FN = GD[gdFam('endo', mode)], FX = GD[gdFam('exo', mode)];
    const met = exoMetricDef(S.cmpMetric);
    view.append(h('div', { class: 'view-head' }, h('h2', null, 'LSTM endogena contro LSTM esogena (Generation data)'),
      h('p', null, 'Stesse stagioni, stessi TH, TL e numero di celle: l\'unica differenza è l\'ingresso (solo la potenza passata, oppure potenza e variabili meteo). Le medie sono calcolate solo sulle stagioni che hanno entrambe le reti.')));
    const ctl = [segCtl('Addestramento', [{ value: 'sep', label: 'Stagioni separate' }, { value: 'joined', label: 'Anni uniti (1 + 2 → 3)' }], mode, v => set('cmpMode', v)),
      selectCtl('Metrica', EXO_METRICS, met.value, v => set('cmpMetric', v))];
    if (joined) ctl.push(segCtl('Campioni di test', [{ value: 'last20', label: 'Ultimo 20 %' }, { value: 'all', label: 'Tutto l\'anno 3' }], S.gdSamples, v => set('gdSamples', v)));
    const cellsList = cellsOf(FN, FX);
    if (!cellsList.length) { view.append(filters(...ctl)); view.append(emptyBox('Nessun risultato disponibile per questo confronto.')); return; }
    const cells = cellsList.includes(Number(S.cmpCells)) ? Number(S.cmpCells) : (cellsList.includes(64) ? 64 : cellsList[0]);
    const seasons = FN.seasons.length ? FN.seasons : FX.seasons;
    const sKey = seasons.some(s => s.key === S.cmpSeason) ? S.cmpSeason : 'mean';
    ctl.push(selectCtl('Celle', cellsList.map(n => ({ value: n, label: n + ' celle' })), cells, v => set('cmpCells', Number(v))),
      selectCtl('Stagione', [{ value: 'mean', label: 'Media sulle stagioni in comune' }].concat(seasons.map(s => ({ value: s.key, label: s.label }))), sKey, v => set('cmpSeason', v)));
    view.append(filters(...ctl));
    const lrN = [...new Set(FN.configs.filter(x => x.cells === cells).map(x => x.lr))], lrX = [...new Set(FX.configs.filter(x => x.cells === cells).map(x => x.lr))];
    if (lrN.join() !== lrX.join() && lrN.length && lrX.length) view.append(callout(`Attenzione: con ${cells} celle i learning rate non coincidono (endogena ${lrN.join(', ')}, esogena ${lrX.join(', ')}).`));

    const { ths, tls } = axesOf(cells, FN, FX);
    const pair = (th, tl) => [gdCfg(FN, th, tl, cells), gdCfg(FX, th, tl, cells)];
    const valOf = (F, cf, other) => {
      if (!cf) return null;
      if (sKey !== 'mean') return cf.seasons[sKey] ? exoSeasonVal(gdView(cf.seasons[sKey]), met.value) : null;
      return meanOn(commonKeys(F, cf, other), cf, met.value);
    };
    const g = h('div', { class: 'grid three' }); view.append(g);
    const dN = chartDiv('short'), dX = chartDiv('short'), dD = chartDiv('short');
    const diverg = met.value === 'skill';
    g.append(card(`Endogena · ${met.label}`, `${cells} celle. — = combinazione non provata.`, dN));
    g.append(card(`Esogena · ${met.label}`, `${cells} celle.`, dX));
    g.append(card('Vantaggio dell\'esogena', LOWER_BETTER[met.value] ? 'Endogena − esogena: positivo (blu) = l\'esogena sbaglia meno.' : 'Esogena − endogena: positivo (blu) = l\'esogena è migliore.', dD));
    gridHeat(dN, ths, tls, (th, tl) => { const [a, b] = pair(th, tl); return valOf(FN, a, b); }, met, diverg, 'confronto_endogena');
    gridHeat(dX, ths, tls, (th, tl) => { const [a, b] = pair(th, tl); return valOf(FX, b, a); }, met, diverg, 'confronto_esogena');
    gridHeat(dD, ths, tls, (th, tl) => { const [a, b] = pair(th, tl); return a && b ? advantage(met.value, valOf(FN, a, b), valOf(FX, b, a)) : null; }, met, true, 'confronto_differenza');

    // table of all matched configurations
    const rows = [];
    const keys = [...new Set(FN.configs.concat(FX.configs).map(x => `${x.th}|${x.tl}|${x.cells}`))];
    for (const kk of keys) {
      const [th, tl, ce] = kk.split('|').map(Number);
      const a = gdCfg(FN, th, tl, ce), b = gdCfg(FX, th, tl, ce);
      const ck = commonKeys(FN, a, b);
      const vn = a && b ? meanOn(ck, a, 'mae') : a ? gdVal(FN, a, 'mae', 'mean') : null;
      const vx = a && b ? meanOn(ck, b, 'mae') : b ? gdVal(FX, b, 'mae', 'mean') : null;
      rows.push({ cfg: `TH${th}-TL${tl}-${ce}`, th, tl, cells: ce, n: a && b ? ck.length : null, endo: vn, exo: vx, d: a && b ? vn - vx : null,
        pers: a && b ? meanOn(ck, a, 'mae', true) : null, skn: a && b ? meanOn(ck, a, 'skill') : null, skx: a && b ? meanOn(ck, b, 'skill') : null,
        lrn: a ? a.lr : null, lrx: b ? b.lr : null, note: !a ? 'solo esogena' : !b ? 'solo endogena' : '' });
    }
    view.append(card('Tutte le combinazioni', 'MAE medio sulle stagioni in comune; "Δ" = MAE endogena − MAE esogena (positivo = l\'esogena sbaglia meno).',
      table([{ key: 'cfg', label: 'Configurazione' }, { key: 'n', label: 'Stagioni in comune', num: true },
        { key: 'endo', label: 'MAE endogena [kW]', num: true, fmt: v => fmt(v, 2) }, { key: 'exo', label: 'MAE esogena [kW]', num: true, fmt: v => fmt(v, 2) },
        { key: 'd', label: 'Δ [kW]', num: true, render: r => signed(r.d, 2, ' kW') }, { key: 'pers', label: 'MAE persistenza', num: true, fmt: v => fmt(v, 2) },
        { key: 'skn', label: 'Endogena vs persistenza', num: true, render: r => signed(r.skn) }, { key: 'skx', label: 'Esogena vs persistenza', num: true, render: r => signed(r.skx) },
        { key: 'lrn', label: 'lr endo', num: true }, { key: 'lrx', label: 'lr eso', num: true }, { key: 'note', label: 'Nota' }], rows, { sortKey: 'cfg' })));

    // per-season bars for one matched configuration
    const matched = FN.configs.filter(a => gdCfg(FX, a.th, a.tl, a.cells));
    if (matched.length) {
      const pick = matched.find(x => x.id === S.cmpCfg) || matched[0];
      const b = gdCfg(FX, pick.th, pick.tl, pick.cells);
      const ck = commonKeys(FN, pick, b);
      view.append(sectionTitle('Stagione per stagione'));
      view.append(filters(selectCtl('Configurazione', matched.map(x => ({ value: x.id, label: x.id })), pick.id, v => set('cmpCfg', v))));
      const d = chartDiv('');
      view.append(card(`${met.label} · ${pick.id}`, 'Le due reti e la persistenza sugli stessi campioni di test.', d));
      const xs = ck.map(seasonLabel);
      const tr = [
        { type: 'bar', name: 'Endogena', x: xs, y: ck.map(k => exoSeasonVal(gdView(pick.seasons[k]), met.value)), marker: { color: c.s1 } },
        { type: 'bar', name: 'Esogena', x: xs, y: ck.map(k => exoSeasonVal(gdView(b.seasons[k]), met.value)), marker: { color: c.s2 } }];
      if (met.value !== 'skill') tr.push({ type: 'bar', name: `Persistenza (TL ${pick.tl})`, x: xs, y: ck.map(k => exoSeasonVal(gdView(pick.seasons[k]), met.value, true)), marker: { color: c.neutral } });
      tr.forEach(t => { t.hovertemplate = `${t.name}<br>%{x}: <b>%{y:.${met.d}f} ${met.unit}</b><extra></extra>`; });
      plot(d, tr, { barmode: 'group', yaxis: { title: { text: met.label }, zeroline: true, zerolinecolor: c.axis } }, 'confronto_per_stagione');
    }

    // joined years vs single seasons, on the same samples
    view.append(sectionTitle('Anni uniti contro stagioni separate (stessi campioni dell\'anno 3)'));
    view.append(h('p', { class: 'note' }, 'Per ogni foglio dell\'anno 3 si confrontano, sull\'ultimo 20 % delle finestre, la rete addestrata solo sul primo 80 % di quel foglio e la rete addestrata sugli anni 1 e 2 della stessa stagione. Stessi TH, TL e celle.'));
    const jr = [];
    for (const base of ['endo', 'exo']) {
      const FS = GD[base], FJ = GD[base + 'J'];
      for (const j of FJ.configs) {
        const sp = gdCfg(FS, j.th, j.tl, j.cells);
        for (const s of FJ.seasons) {
          const ej = j.seasons[s.key]; if (!ej) continue;
          const es = sp && sp.seasons[s.key];
          jr.push({ fam: base === 'endo' ? 'Endogena' : 'Esogena', cfg: j.id, season: s.label, n: ej.n_last20,
            sep: es ? es.metrics.mae : null, join: ej.m20.mae, d: es ? es.metrics.mae - ej.m20.mae : null, pers: ej.p20.mae,
            all: ej.metrics.mae, same: es ? es.n_test === ej.n_last20 : null });
        }
      }
    }
    if (!jr.length) view.append(emptyBox('Le reti con gli anni uniti non hanno ancora risultati salvati.'));
    else view.append(card('MAE sull\'ultimo 20 % dell\'anno 3', '"Δ" = MAE stagione separata − MAE anni uniti: positivo = gli anni uniti sbagliano meno. "Tutto l\'anno 3" = MAE della rete ad anni uniti su tutto il foglio.',
      table([{ key: 'fam', label: 'Rete' }, { key: 'cfg', label: 'Configurazione' }, { key: 'season', label: 'Foglio' }, { key: 'n', label: 'Campioni', num: true },
        { key: 'sep', label: 'MAE stagione separata', num: true, fmt: v => fmt(v, 2) }, { key: 'join', label: 'MAE anni uniti', num: true, fmt: v => fmt(v, 2) },
        { key: 'd', label: 'Δ [kW]', num: true, render: r => signed(r.d, 2, ' kW') }, { key: 'pers', label: 'MAE persistenza', num: true, fmt: v => fmt(v, 2) },
        { key: 'all', label: 'Anni uniti, tutto l\'anno 3', num: true, fmt: v => fmt(v, 2) },
        { key: 'same', label: 'Stessi campioni', render: r => r.same == null ? '—' : r.same ? 'sì' : 'no' }], jr, { scroll: true })));
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
    if (location.hash === '#esplora') render(false); else location.hash = 'esplora';
  }
  function explorerButton(model, cfgId, season) {
    return h('button', { type: 'button', class: 'ghost-btn', onclick: () => openInExplorer(model, cfgId, season) }, 'Apri nell\'esploratore');
  }

  function viewExplorer() {
    const c = C();
    const isAbr = S.expModel === 'abr';
    const cfgList = isAbr ? ABR.configs : gdAll();
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

    view.append(h('div', { class: 'view-head' }, h('h2', null, 'Esplora il test'),
      h('p', null, 'L\'intero periodo di test di una stagione, con le previsioni salvate nei CSV. Scegli fino a quattro configurazioni da sovrapporre, poi una finestra precisa con i campi "dal / al", i pulsanti rapidi o trascinando sulla barra in basso. La tabella sotto il grafico calcola gli errori solo sulla finestra visibile.')));

    // --- selection row
    const alertBox = h('span', { class: 'note', hidden: true }, 'Al massimo quattro configurazioni insieme: togline una prima di aggiungerne un\'altra.');
    const chips = h('div', { class: 'cfg-chips', role: 'group', 'aria-label': 'Configurazioni' });
    for (const cf of cfgList) {
      const ok = hasSeries(cf), on = sel.includes(cf.id);
      const sw = on ? h('span', { class: 'swatch', style: `background:${slotCols[S[slotKey][cf.id]]}` }) : null;
      chips.append(h('button', { type: 'button', class: 'chip-toggle', 'aria-pressed': String(on), disabled: !ok,
        title: ok ? (on ? 'Togli dal grafico' : 'Aggiungi al grafico') : 'Previsioni non salvate per questa stagione',
        onclick: () => {
          const arr = S[selKey];
          if (arr.includes(cf.id)) { arr.splice(arr.indexOf(cf.id), 1); delete S[slotKey][cf.id]; }
          else if (sel.length >= 4) { alertBox.hidden = false; return; }
          else arr.push(cf.id);
          save(); render(true);
        } }, sw, (cf.label || cf.id) + (cf.preferred ? ' ★' : '')));
    }
    view.append(filters(
      segCtl('Modello', [{ value: 'abr', label: 'LSTM endogena (Abruzzo)' }, { value: 'exo', label: 'Generation data (tutte le reti)' }], S.expModel, v => set('expModel', v)),
      selectCtl('Stagione', seasons.map(s => ({ value: s.key, label: s.label })), seasonKey, v => set(isAbr ? 'expSeasonAbr' : 'expSeasonExo', v)),
      checkCtl(isAbr ? 'Misura traslata di 1 h' : 'Misura traslata di 1 passo', S.expPers, v => set('expPers', v)),
      isAbr ? checkCtl('Stessa ora di ieri', S.expYest, v => set('expYest', v)) : null,
      checkCtl('Pannello dell\'errore', S.expErr, v => set('expErr', v)),
      !isAbr ? segCtl('Asse orizzontale', [{ value: 'samples', label: 'Riga del foglio' }, { value: 'minutes', label: 'Minuti (stima 5 min)' }], S.expUnit, v => set('expUnit', v)) : null,
      h('div', { class: 'ctl', style: 'flex-basis:100%' }, h('span', null, isAbr ? 'Configurazioni (★ = preferita; disattivate quelle senza previsioni salvate per questa stagione)'
        : 'Configurazioni (ESO = esogena, END = endogena; "anni" = addestrata sugli anni 1 + 2, esiste solo sui fogli dell\'anno 3; ★ = preferita)'), chips, alertBox),
    ));
    if (!sel.length) {
      view.append(emptyBox(isAbr && !ABR.configs.some(abrHasCsv)
        ? 'Le previsioni dell\'Abruzzo non sono ancora salvate: rilancia gli script in MATLAB e poi aggiorna la dashboard.'
        : 'Seleziona almeno una configurazione con previsioni salvate.'));
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
    const traces = [lineT(xOf(base), base.real, 'Misurata', c.text1, { line: { color: c.text1, width: 2 }, hovertemplate: `<b>%{y:.1f} ${unitY}</b> misurata<extra></extra>` })];
    const tls = [...new Set(cfgs.map(cf => cf.tl))];
    const tlsRef = isAbr ? tls.filter(t => t <= ABR_PERS_MAX_TL) : tls;     // persistence used as a reference in the table
    const nm = cf => cf.label || cf.id;
    if (S.expPers) traces.push(lineT(xOf(base), base.shift1, isAbr ? 'Misura traslata di 1 h' : 'Misura traslata di 1 passo (5 min)', c.neutral,
      { line: { color: c.neutral, width: 1.5 }, hovertemplate: `<b>%{y:.1f} ${unitY}</b> misura 1 passo prima<extra></extra>` }));
    if (isAbr && S.expYest) traces.push(lineT(xOf(base), base.yest, 'Stessa ora di ieri', c.muted,
      { line: { color: c.muted, width: 1.5, dash: 'dot' }, hovertemplate: '<b>%{y:.1f} kWh</b> ieri<extra></extra>' }));
    cfgs.forEach((cf, i) => traces.push(lineT(xOf(sers[i]), sers[i].pred, nm(cf), slotCols[S[slotKey][cf.id]],
      { hovertemplate: `<b>%{y:.1f} ${unitY}</b> ${nm(cf)}<extra></extra>` })));
    if (err) cfgs.forEach((cf, i) => traces.push(lineT(xOf(sers[i]),
      sers[i].pred.map((p, j) => p == null || sers[i].real[j] == null ? null : p - sers[i].real[j]),
      'Errore ' + nm(cf), slotCols[S[slotKey][cf.id]], { yaxis: 'y2', showlegend: false, line: { color: slotCols[S[slotKey][cf.id]], width: 1.5 },
        hovertemplate: `errore <b>%{y:+.1f} ${unitY}</b> ${nm(cf)}<extra></extra>` })));

    // --- default window
    const allX = xNum(base), xmin = allX[0], xmax = allX[allX.length - 1];
    const toAxis = v => isAbr ? strOf(v) : v;
    if (!expRange) expRange = isAbr ? [xmin, Math.min(xmax, xmin + 3 * 864e5)]
      : [xmin, Math.min(xmax, xmin + (S.expUnit === 'minutes' ? 288 * EXO.step_min : 288))];

    // --- window controls
    const step = isAbr ? 36e5 : S.expUnit === 'minutes' ? EXO.step_min : 1;
    const fromIn = h('input', { type: isAbr ? 'datetime-local' : 'number', step: isAbr ? 3600 : step, class: 'in', 'aria-label': 'Inizio della finestra' });
    const toIn = h('input', { type: isAbr ? 'datetime-local' : 'number', step: isAbr ? 3600 : step, class: 'in', 'aria-label': 'Fine della finestra' });
    const fmtIn = v => isAbr ? strOf(v).replace(' ', 'T') : String(Math.round(v));
    const parseIn = s => isAbr ? msOf(s) : Number(s);
    fromIn.min = toIn.min = fmtIn(xmin); fromIn.max = toIn.max = fmtIn(xmax);
    const quick = isAbr
      ? [['6 ore', 6 * 36e5], ['12 ore', 12 * 36e5], ['1 giorno', 864e5], ['3 giorni', 3 * 864e5], ['1 settimana', 7 * 864e5]]
      : (S.expUnit === 'minutes'
        ? [['1 ora', 60], ['3 ore', 180], ['12 ore (≈ 1 giorno di luce)', 720], ['3 giorni', 2160]]
        : [['1 ora (12)', 12], ['3 ore (36)', 36], ['≈ 1 giorno (144)', 144], ['3 giorni (432)', 432]]);
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
      h('label', { class: 'ctl' }, h('span', null, isAbr ? 'Dal' : 'Da'), fromIn),
      h('label', { class: 'ctl' }, h('span', null, isAbr ? 'Al' : 'A'), toIn),
      h('div', { class: 'ctl' }, h('span', null, ' '), h('button', { type: 'button', class: 'ghost-btn', onclick: () => applyRange(parseIn(fromIn.value), parseIn(toIn.value)) }, 'Applica')),
      h('div', { class: 'ctl' }, h('span', null, 'Durata della finestra (dall\'inizio attuale)'),
        h('div', { class: 'seg' }, quick.map(([l, d]) => h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => applyRange(expRange[0], expRange[0] + d) }, l)),
          h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => applyRange(xmin, xmax) }, 'Tutto il test'))),
      h('div', { class: 'ctl' }, h('span', null, 'Sposta la finestra'),
        h('div', { class: 'seg' },
          h('button', { type: 'button', onclick: () => { const w = expRange[1] - expRange[0]; applyRange(expRange[0] - w, expRange[0]); } }, '◀ indietro'),
          h('button', { type: 'button', onclick: () => { const w = expRange[1] - expRange[0]; applyRange(expRange[1], expRange[1] + w); } }, 'avanti ▶'))),
    );
    [fromIn, toIn].forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') applyRange(parseIn(fromIn.value), parseIn(toIn.value)); }));
    view.append(winRow);
    const csvBtn = h('button', { type: 'button', class: 'ghost-btn', onclick: () => downloadWindow() }, 'Scarica i dati della finestra (CSV)');
    view.append(card(`${isAbr ? 'Energia' : 'Potenza'} nel test · ${seasonLabel(seasonKey)}`,
      isAbr ? 'Ore reali dal file Excel. Doppio clic sul grafico per tornare all\'intero test.'
        : 'Le notti non sono nei dati: un giorno segue subito il precedente. I minuti sono una stima (passo di 5 minuti). Doppio clic per tornare all\'intero test.',
      chart, csvBtn));
    view.append(card('Errori nella finestra selezionata', 'Calcolati solo sui campioni visibili nel grafico; si aggiornano quando sposti o ingrandisci la finestra.', statsWrap));

    const yTitle = isAbr ? 'Energia [kWh]' : 'Potenza AC [kW]';
    const xTitle = isAbr ? '' : S.expUnit === 'minutes' ? 'Minuti dall\'inizio del test (stima)' : 'Riga del foglio della stagione';
    const layout = {
      hovermode: 'x unified', margin: { t: 36, b: 40 },
      xaxis: { type: isAbr ? 'date' : 'linear', range: [toAxis(expRange[0]), toAxis(expRange[1])], anchor: err ? 'y2' : 'y',
        title: { text: xTitle }, rangeslider: { visible: true, thickness: 0.06, bgcolor: c.surface2, bordercolor: c.axis } },
      yaxis: { title: { text: yTitle }, domain: err ? [0.31, 1] : [0, 1], rangemode: 'tozero' },
    };
    if (isAbr) layout.xaxis.tickformat = '%d/%m %H:%M';
    if (err) layout.yaxis2 = Object.assign(axis(c), { title: { text: 'Errore [' + unitY + ']', font: { color: c.text2, size: 12 }, standoff: 10 },
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
      tlsRef.forEach(tl => { const i = cfgs.findIndex(cf => cf.tl === tl); rows.push(Object.assign({ name: `Persistenza (ultimo valore noto, TL ${tl})`, col: c.neutral }, stats(xs[i], sers[i].real, sers[i].pers))); });
      rows.push(Object.assign({ name: isAbr ? 'Misura traslata di 1 h (solo riferimento visivo)' : 'Misura traslata di 1 passo (solo riferimento visivo)', col: c.neutral }, stats(xs[ei], base.real, base.shift1)));
      if (isAbr) rows.push(Object.assign({ name: 'Stessa ora di ieri', col: c.muted }, stats(xs[ei], base.real, base.yest)));
      const span = isAbr ? `${strOf(expRange[0])} → ${strOf(expRange[1])}`
        : `${fmt(expRange[0], 0)} → ${fmt(expRange[1], 0)} ${S.expUnit === 'minutes' ? 'min' : '(righe del foglio)'}`;
      statsWrap.textContent = '';
      statsWrap.append(h('p', { class: 'note', style: 'margin:0 0 8px' }, 'Finestra: ' + span),
        table([
          { key: 'name', label: 'Serie', render: r => h('span', null, h('span', { class: 'swatch', style: `background:${r.col}` }), r.name) },
          { key: 'n', label: 'Campioni', num: true },
          { key: 'mae', label: `MAE [${unitY}]`, num: true, fmt: v => fmt(v, 2) },
          { key: 'rmse', label: `RMSE [${unitY}]`, num: true, fmt: v => fmt(v, 2) },
          { key: 'bias', label: 'Errore medio', num: true, fmt: v => fmtS(v, 2) },
          { key: 'wmape', label: 'wMAPE [%]', num: true, fmt: v => fmt(v, 1), title: 'Somma degli errori assoluti / somma delle misure nella finestra' },
          { key: 'mean', label: `Misura media [${unitY}]`, num: true, fmt: v => fmt(v, 1) },
        ], rows));
    }
    function downloadWindow() {
      const head = [isAbr ? 'Timestamp' : (S.expUnit === 'minutes' ? 'Minuti' : 'RigaFoglio'), 'Misurata'];
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
      const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
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
  const ROLE_NAME = { input: 'Ingresso', lstm: 'LSTM', fc: 'Completamente connesso', bn: 'Normalizzazione batch', act: 'Attivazione', out: 'Uscita' };
  function roleColor(c, r) { return { input: c.neutral, lstm: c.s1, fc: c.s2, bn: c.s3, act: c.s4, out: c.text2 }[r] || c.neutral; }
  function plural(n, one, many) { return n === 1 ? one : many; }

  function archNets() {
    const nets = [];
    for (const a of REG.architectures || []) {
      nets.push({ group: 'reg', id: a.id, label: a.label, kind: 'ff', arch: a, inputs: REG.inputs, target: 'Potenza AC stimata [kW]',
        split: REG.split ? `${REG.split.train} / ${REG.split.val} / ${REG.split.test} % casuale (addestramento / validazione / test)` : '—',
        script: REG.script.split('/').pop(), seed: 'nessuno (divisione casuale diversa a ogni run)' });
    }
    for (const c2 of ABR.configs) if (c2.arch) nets.push({ group: 'abr', id: c2.id, label: c2.id + (c2.preferred ? ' (preferita)' : ''), kind: 'lstm', arch: c2.arch,
      inputs: c2.arch.inputs, th: c2.th, tl: c2.tl, unit: 'h', stepName: "un passo = un'ora", target: `Energia dell'ora t + ${c2.tl} [kWh]`,
      split: `${Math.round((c2.frac || 0.9) * 100)} / ${100 - Math.round((c2.frac || 0.9) * 100)} % cronologica (addestramento / test), un modello per stagione`,
      script: c2.script, seed: "rng('default') prima di ogni stagione" });
    for (const c2 of EXO.configs) if (c2.arch) nets.push({ group: 'exo', id: c2.id, label: c2.id + (c2.preferred ? ' (preferita)' : ''), kind: 'lstm', arch: c2.arch,
      inputs: c2.arch.inputs, th: c2.th, tl: c2.tl, unit: 'passi', stepName: 'un passo ≈ 5 minuti, stima', target: `Potenza AC al passo t + ${c2.tl} [kW]`,
      split: `${Math.round((c2.frac || 0.8) * 100)} / ${100 - Math.round((c2.frac || 0.8) * 100)} % cronologica (addestramento / test), un modello per stagione`,
      script: c2.script, seed: "rng('default') prima di ogni stagione" });
    for (const fk of ['endo', 'exoJ', 'endoJ']) for (const c2 of GD[fk].configs) if (c2.arch) nets.push({ group: fk, id: c2.id, label: c2.id, kind: 'lstm', arch: c2.arch,
      inputs: c2.arch.inputs, th: c2.th, tl: c2.tl, unit: 'passi', stepName: 'un passo ≈ 5 minuti, stima', target: `Potenza AC al passo t + ${c2.tl} [kW]`,
      split: GD[fk].joined ? 'addestramento sugli anni 1 + 2 della stagione, test su tutto il foglio dell\'anno 3 (normalizzazione sui soli dati di addestramento)'
        : `${Math.round((c2.frac || 0.8) * 100)} / ${100 - Math.round((c2.frac || 0.8) * 100)} % cronologica (addestramento / test), un modello per stagione`,
      script: c2.script, seed: "rng('default') prima di ogni stagione" });
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
      if (ly.type === 'featureInputLayer') { title = `Ingresso · ${ly.size} ${plural(ly.size, 'variabile', 'variabili')}`; detail = net.inputs.join(', '); }
      else if (ly.type === 'sequenceInputLayer') { title = `Ingresso · sequenza di ${net.th} ${net.unit} × ${ly.size} ${plural(ly.size, 'canale', 'canali')}`; detail = net.inputs.join(', '); }
      else if (ly.type === 'lstmLayer') { title = `LSTM · ${ly.size} unità nascoste`; detail = `${ly.output_mode === 'last' ? "restituisce solo lo stato dell'ultimo passo" : 'restituisce tutta la sequenza'} · ${fmt(ly.params, 0)} parametri (4 porte)`; }
      else if (ly.type === 'fullyConnectedLayer') { title = `Completamente connesso · ${ly.size} ${plural(ly.size, 'neurone', 'neuroni')}`; detail = `${ly.input} × ${ly.size} pesi + ${ly.size} bias = ${fmt(ly.params, 0)} parametri`; }
      else if (ly.type === 'batchNormalizationLayer') { title = 'Normalizzazione batch'; detail = `${ly.size} canali · ${fmt(ly.params, 0)} parametri (scala e scostamento)`; }
      else if (ly.type === 'reluLayer') { title = 'Attivazione ReLU'; detail = 'max(0, x) · nessun parametro'; }
      else if (ly.type === 'regressionLayer') { title = `Uscita · ${net.target}`; detail = 'durante l\'addestramento calcola la perdita MSE'; }
      else { title = ly.type; detail = ''; }
      items.push({ role, title, detail, small: role === 'bn' || role === 'act', out: ly.size, type: ly.type });
    });
    if (!L.some(ly => ly.type === 'regressionLayer')) {
      items.push({ role: 'out', title: `Uscita · ${net.target}`, detail: `durante l'addestramento minimizza la perdita ${(net.arch.loss || '').toUpperCase()}`, small: false, out: 1, type: 'out' });
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
        if (it.type === 'sequenceInputLayer') lab = `${net.th} passi × ${it.out}`;
        else if (it.type === 'lstmLayer') lab = `${it.out} valori (stato finale h)`;
        else if (it.out != null) lab = `${it.out} ${plural(it.out, 'valore', 'valori')}`;
        g.append(sv('text', { x: bx + bw / 2 + 12, y: y + gap / 2 + 4, fill: c.muted, 'font-size': 12, 'font-family': FONT }, lab));
        y += gap;
      }
    });
    const H = y + 10;
    return sv('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', style: `max-width:${W}px;display:block;margin:0 auto`, role: 'img',
      'aria-label': `Schema dei livelli di ${net.label}` }, defs, g);
  }

  // ---- neurons and connections (feed-forward nets)
  function neuronGraph(net) {
    const c = C();
    const fcs = net.arch.layers.filter(l => l.type === 'fullyConnectedLayer');
    const cols = [{ n: net.inputs.length, role: 'input', cap: ['Ingresso', `${net.inputs.length} variabili`] }];
    fcs.forEach((l, i) => {
      const idx = net.arch.layers.indexOf(l);
      const after = net.arch.layers.slice(idx + 1, net.arch.layers.indexOf(fcs[i + 1]) === -1 ? undefined : net.arch.layers.indexOf(fcs[i + 1])).map(x => x.type);
      const last = i === fcs.length - 1;
      const extras = [after.includes('batchNormalizationLayer') ? 'BN' : null, after.includes('reluLayer') ? 'ReLU' : null].filter(Boolean).join(' + ');
      cols.push({ n: l.size, role: last ? 'out' : 'fc', cap: last ? ['Uscita', `${l.size} ${plural(l.size, 'neurone', 'neuroni')}`] : [`Nascosto ${i + 1}`, `${l.size} neuroni${extras ? ' · ' + extras : ''}`] });
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
    lastCol.forEach(p => { if (p.k >= 0) g.append(sv('text', { x: p.x + 18, y: p.y + 4, fill: c.text2, 'font-size': 12, 'font-family': FONT }, 'P̂ [kW]')); });
    return sv('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', style: `max-width:${W}px;display:block;margin:0 auto`, role: 'img', 'aria-label': `Neuroni e collegamenti di ${net.label}` }, g);
  }

  // ---- LSTM unrolled in time
  function unrolledLSTM(net) {
    const c = C();
    const lstm = net.arch.layers.find(l => l.type === 'lstmLayer');
    const fc = net.arch.layers.find(l => l.type === 'fullyConnectedLayer');
    const C_in = net.arch.layers[0].size, N = lstm.size, TH = net.th, TL = net.tl, u = net.unit === 'h' ? ' h' : '';
    const lab = k => k === 0 ? 't' : `t − ${k}${u}`;
    const span = n => net.unit === 'h' ? `${n} h` : `${n} ${plural(n, 'passo', 'passi')}`;
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
      g.add(box(x, cellY, bw, 52, colL, 'LSTM', `${N} unità`));
      g.add(box(x, inY, bw, 46, colI, lab(s.k), C_in === 1 ? '1 valore' : `${C_in} valori`));
      g.add(arrow(x + bw / 2, inY - 2, x + bw / 2, cellY + 56));
      if (i < slots.length - 1) g.add(arrow(x + bw + 2, cellY + 26, cx[i + 1] - 4, cellY + 26, i === 0 ? 'stato h, c' : null, x + bw + (sw - bw) / 2, cellY - 6));
    });
    // same weights note
    g.append(sv('text', { x: x0, y: cellY - 34, fill: c.text2, 'font-size': 12, 'font-family': FONT }, 'La stessa cella (stessi pesi) viene applicata a ogni passo e aggiorna il suo stato.'));
    // window bracket
    const xl = cx[0], xr = cx[slots.length - 1] + bw;
    g.append(sv('path', { d: `M ${xl} ${inY + 62} v 8 H ${xr} v -8`, fill: 'none', stroke: c.text2, 'stroke-width': 1.2 }));
    g.append(sv('text', { x: xl, y: inY + 88, fill: c.text1, 'font-size': 12.5, 'font-weight': 600, 'font-family': FONT },
      `Finestra di ingresso TH = ${span(TH)}`));
    g.append(sv('text', { x: xl, y: inY + 106, fill: c.text2, 'font-size': 12, 'font-family': FONT },
      `A ogni passo: ${net.inputs.join(', ')}`));
    // last state -> FC -> output
    const lx = cx[slots.length - 1];
    const fx = lx + bw + 80, ox = fx + 200;
    g.add(arrow(lx + bw + 2, cellY + 26, fx - 4, cellY + 26, `h(t): ${N} valori`, (lx + bw + fx) / 2, cellY - 6));
    g.add(box(fx, cellY, 160, 52, colF, 'Completam. connesso', fc ? `${fc.size} neurone` : ''));
    g.add(arrow(fx + 162, cellY + 26, ox - 4, cellY + 26));
    g.add(box(ox, cellY - 6, 150, 64, colO, 'Previsione', TL ? `al tempo t + ${span(TL)}` : ''));
    // horizon note
    g.append(sv('text', { x: ox + 150, y: cellY + 84, 'text-anchor': 'end', fill: c.text2, 'font-size': 12, 'font-family': FONT },
      `Orizzonte TL = ${span(TL)} dopo l'ultimo dato`));
    return sv('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', style: `max-width:${W}px;display:block;margin:0 auto`, role: 'img', 'aria-label': `Funzionamento nel tempo di ${net.label}` }, defs, g);
  }

  function trainingRows(net) {
    const o = net.arch.opts || {};
    const rows = [
      ['Ottimizzatore', (o.solver || '—').replace(/^adam$/i, 'Adam')],
      ['Funzione di perdita', net.arch.loss === 'mae' ? 'MAE (errore assoluto medio)' : net.arch.loss === 'mse' ? 'MSE (errore quadratico medio, livello di regressione)' : '—'],
      ['Epoche (massimo)', o.MaxEpochs != null ? fmt(o.MaxEpochs, 0) : '—'],
      ['Mini-batch', o.MiniBatchSize != null ? fmt(o.MiniBatchSize, 0) : '—'],
      ['Learning rate iniziale', o.InitialLearnRate != null ? String(o.InitialLearnRate).replace('.', ',') : '—'],
      ['Riduzione del learning rate', o.LearnRateSchedule === 'piecewise' ? `× ${String(o.LearnRateDropFactor).replace('.', ',')} ogni ${o.LearnRateDropPeriod} epoche` : 'nessuna (costante)'],
      ['Soglia sul gradiente', o.GradientThreshold != null ? String(o.GradientThreshold) : 'nessuna'],
      ['Arresto anticipato', o.ValidationPatience != null ? `sì, dopo ${o.ValidationPatience} controlli senza miglioramento sulla validazione` : 'no (nessun insieme di validazione)'],
      ['Divisione dei dati', net.split],
      ['Normalizzazione', 'z-score con media e deviazione standard del solo addestramento'],
      ['Seme casuale', net.seed],
      ['Parametri addestrabili', fmt(net.arch.params, 0)],
      ['Script', net.script || '—'],
    ];
    return rows.map(([k, v]) => ({ k, v }));
  }

  function viewArchitectures() {
    const c = C();
    const nets = archNets();
    view.append(h('div', { class: 'view-head' }, h('h2', null, 'Architetture delle reti'),
      h('p', null, 'Per ogni rete: i livelli nell\'ordine in cui sono definiti nello script MATLAB, con dimensioni e parametri addestrabili, uno schema intuitivo del funzionamento e le impostazioni di addestramento. Tutto è letto direttamente dagli script.')));
    if (!nets.length) { view.append(emptyBox('Nessuna architettura trovata negli script.')); return; }
    const groups = [{ value: 'reg', label: 'Regressione' }, { value: 'abr', label: 'LSTM endogena (Abruzzo)' }, { value: 'exo', label: 'LSTM esogena' },
      { value: 'endo', label: 'LSTM endogena (GD)' }, { value: 'exoJ', label: 'Esogena · anni uniti' }, { value: 'endoJ', label: 'Endogena (GD) · anni uniti' }].filter(gp => nets.some(n => n.group === gp.value));
    if (!groups.some(gp => gp.value === S.archGroup)) S.archGroup = groups[0].value;
    const inGroup = nets.filter(n => n.group === S.archGroup);
    const key = 'arch_' + S.archGroup;
    if (!inGroup.some(n => n.id === S[key])) S[key] = (inGroup.find(n => /preferita/.test(n.label)) || inGroup.find(n => n.id === 'mlp') || inGroup[0]).id;
    const net = inGroup.find(n => n.id === S[key]);
    view.append(filters(
      segCtl('Parte', groups, S.archGroup, v => set('archGroup', v)),
      selectCtl('Rete', inGroup.map(n => ({ value: n.id, label: n.label })), net.id, v => set(key, v)),
    ));

    const legend = h('div', { class: 'cfg-chips', style: 'margin-top:10px' },
      ['input', 'lstm', 'fc', 'bn', 'act', 'out'].filter(r => r === 'out' || net.arch.layers.some(l => LAYER_ROLE[l.type] === r))
        .map(r => h('span', { class: 'chip soft' }, h('span', { class: 'swatch', style: `background:${roleColor(c, r)};height:10px;width:10px;border-radius:3px` }), ROLE_NAME[r])));
    const g = h('div', { class: 'grid two' });
    g.append(card(`Livelli · ${net.label}`, `${fmt(net.arch.params, 0)} parametri addestrabili in totale. Le frecce indicano quanti valori passano da un livello al successivo.`,
      [blockDiagram(net), legend]));
    g.append(card('Addestramento', null, table([{ key: 'k', label: 'Impostazione' }, { key: 'v', label: 'Valore' }], trainingRows(net))));
    view.append(g);
    if (net.kind === 'ff') {
      view.append(card('Neuroni e collegamenti', 'Ogni cerchio è un neurone, ogni linea un peso. Negli strati con molti neuroni ne sono disegnati solo alcuni (⋮). Lo strato di uscita restituisce la potenza stimata nello stesso istante dei dati in ingresso.', neuronGraph(net)));
      if (net.id === 'single_neuron') view.append(h('p', { class: 'note' }, 'Un solo neurone lineare calcola P̂ = w₁·MODULE_TEMP + w₂·Amb_Temp + w₃·WIND_Speed + w₄·IRR + b: la stessa forma della regressione lineare multipla, ma con i pesi trovati dall\'ottimizzatore Adam sui dati normalizzati.'));
    } else {
      view.append(card('Come usa il tempo', `La rete legge la finestra un passo alla volta (${net.stepName}). Dopo l'ultimo passo, lo stato finale della cella passa allo strato completamente connesso, che produce la previsione.`, unrolledLSTM(net)));
    }

    // comparison of all networks
    const rows = nets.map(n => ({ part: { reg: 'Regressione', abr: 'LSTM endogena (Abruzzo)', exo: 'LSTM esogena', endo: GD_PART.endo, exoJ: GD_PART.exoJ, endoJ: GD_PART.endoJ }[n.group], name: n.label,
      inp: n.kind === 'ff' ? `${n.inputs.length} variabili (stesso istante)` : `${n.th} ${n.unit} × ${n.arch.layers[0].size} ${plural(n.arch.layers[0].size, 'canale', 'canali')}`,
      struct: n.arch.layers.filter(l => ['lstmLayer', 'fullyConnectedLayer'].includes(l.type)).map(l => (l.type === 'lstmLayer' ? 'LSTM ' : 'FC ') + l.size).join(' → '),
      params: n.arch.params, loss: (n.arch.loss || '').toUpperCase(), _hl: n.id === net.id && n.group === net.group }));
    view.append(card('Tutte le reti a confronto', 'FC = strato completamente connesso. Clicca sulle intestazioni per ordinare.', table([
      { key: 'part', label: 'Parte' }, { key: 'name', label: 'Rete' }, { key: 'inp', label: 'Ingresso' }, { key: 'struct', label: 'Struttura' },
      { key: 'params', label: 'Parametri', num: true, fmt: v => fmt(v, 0) }, { key: 'loss', label: 'Perdita' }], rows)));
  }

  // ================================================================== VIEW: gallery
  function viewGallery() {
    view.append(h('div', { class: 'view-head' }, h('h2', null, 'Grafici originali'),
      h('p', null, 'Le immagini salvate dagli script MATLAB, così come sono (tema scuro, etichette in italiano). Clicca per aprirle ingrandite. Le prove scartate durante il lavoro non sono mostrate.')));
    const parts = [{ value: 'all', label: 'Tutte le parti' }, { value: 'regressione', label: 'Regressione' }, { value: 'abruzzo', label: 'LSTM endogena (Abruzzo)' }, { value: 'esogena', label: 'LSTM esogena' },
      { value: 'endogena_gd', label: 'LSTM endogena (Generation data)' }, { value: 'esogena_anni', label: 'Esogena · anni uniti' }, { value: 'endogena_anni', label: 'Endogena (GD) · anni uniti' }];
    const items = D.gallery.filter(g => S.galPart === 'all' || g.part === S.galPart);
    const groups = [...new Set(items.map(g => g.group))];
    if (S.galGroup !== 'all' && !groups.includes(S.galGroup)) S.galGroup = 'all';
    view.append(filters(
      selectCtl('Parte', parts, S.galPart, v => { S.galGroup = 'all'; set('galPart', v); }),
      selectCtl('Configurazione / run', [{ value: 'all', label: 'Tutte' }].concat(groups.map(g => ({ value: g, label: g }))), S.galGroup, v => set('galGroup', v)),
    ));
    const shown = items.filter(g => S.galGroup === 'all' || g.group === S.galGroup);
    view.append(h('p', { class: 'note' }, `${shown.length} immagini`));
    const grid = h('div', { class: 'gallery' });
    for (const g of shown) grid.append(thumbBtn(g, `${g.group} · ${g.label}`, g.src));
    view.append(grid);
  }

  // ================================================================== VIEW: notes
  function viewNotes() {
    const c = C();
    const sw = col => h('span', { class: 'swatch', style: `background:${col}` });
    view.append(h('div', { class: 'view-head' }, h('h2', null, 'Definizioni e note'), h('p', null, D.public ? 'Come sono calcolati i numeri della dashboard.' : 'Come sono calcolati i numeri della dashboard e come aggiornarla.')));
    if (!D.public) view.append(card('Come aggiornare', null, h('div', { class: 'prose' },
      h('p', null, 'Quando rilanci uno script o aggiungi risultati, fai doppio clic su ', h('code', null, 'aggiorna_dashboard.bat'), ' (in questa cartella) e ricarica la pagina. Lo script ', h('code', null, 'Elaborato/scripts/build_dashboard.py'), ' rilegge tutti i file dei modelli, ricalcola le metriche e riscrive ', h('code', null, 'data.js'), '. Non modifica nulla nelle cartelle dei modelli.'),
      h('p', null, 'Nuovi run della regressione (cartelle Risultati/Run_*) e nuove cartelle Grafici_TH*_TL* vengono trovati da soli. Per la regressione, i punti dei grafici vengono estratti dal file .fig con MATLAB la prima volta (circa 25 secondi per run).'))));
    view.append(card('Colori', null, h('div', { class: 'prose' }, h('ul', null,
      h('li', null, sw(c.s1), 'misura reale'), h('li', null, sw(c.s2), 'previsione del modello'),
      h('li', null, sw(c.s3), 'persistenza'), h('li', null, sw(c.s4), 'stessa ora del giorno prima'),
      h('li', null, 'Nei grafici che confrontano configurazioni o stagioni, i colori indicano la configurazione o la stagione: la legenda di ogni grafico lo dice.')))));
    view.append(card('Metriche', null, h('div', { class: 'prose' },
      h('dl', { class: 'defs' },
        h('dt', null, 'MAE'), h('dd', null, 'Errore assoluto medio: media di |previsto − misurato| su tutti i campioni di test (kW, o kWh per ora nell\'Abruzzo).'),
        h('dt', null, 'RMSE'), h('dd', null, 'Radice dell\'errore quadratico medio: pesa di più gli errori grandi.'),
        h('dt', null, 'R²'), h('dd', null, '1 − (somma degli errori al quadrato) / (somma degli scarti della misura dalla sua media). 1 = perfetto, 0 = come prevedere sempre la media.'),
        h('dt', null, 'nMAE'), h('dd', null, 'MAE diviso una potenza di riferimento, in %: la potenza nominale (995,67 kWp per l\'Abruzzo), la potenza massima misurata (Generation_data, nominale non nota) oppure la potenza media misurata nel test. Spiegazione completa nella Panoramica.'),
        h('dt', null, 'MAPE diurno'), h('dd', null, 'Errore percentuale medio solo sui campioni "diurni": misura > 10 kWh nell\'Abruzzo, > 5 % del massimo della stagione nell\'esogena (come negli script).'),
        h('dt', null, 'wMAPE diurno'), h('dd', null, 'Somma degli errori assoluti diviso somma delle misure, sugli stessi campioni diurni: meno sensibile ai valori piccoli.'),
        h('dt', null, 'Persistenza'), h('dd', null, 'Previsione ingenua "il valore resta quello dell\'ultimo istante noto": la misura di TL passi prima, cioè l\'ultimo dato disponibile quando la rete fa la previsione. Nell\'Abruzzo è usata solo per TL ≤ ' + ABR_PERS_MAX_TL + ' h (vedi sotto).'),
        h('dt', null, 'Stessa ora di ieri'), h('dd', null, 'Previsione ingenua con la misura di 24 ore prima (solo Abruzzo, dati orari). È il riferimento principale dell\'Abruzzo per ogni TL.'),
        h('dt', null, 'Misura traslata di 1 passo'), h('dd', null, 'La misura spostata in avanti di un passo (1 ora nell\'Abruzzo, 5 minuti su Generation data), disegnata nei grafici come riferimento visivo. Con TL > 1 non è una previsione realizzabile, perché quel valore non è ancora noto quando si fa la previsione: per questo non entra nelle tabelle di miglioramento.'),
        h('dt', null, 'Miglioramento'), h('dd', null, '1 − MAE rete / MAE riferimento, in %. Positivo = la rete è migliore.'),
        h('dt', null, 'Analisi del ritardo'), h('dd', null, 'MAE tra la previsione al tempo t e la misura al tempo t − k, per vari k. Il minimo a k = 0 indica una previsione in fase; il minimo a k = TL indica che la rete ripete l\'ultimo valore noto.'),
      ))));
    view.append(card('Quale riferimento ingenuo, e perché', null, h('div', { class: 'prose' },
      h('p', null, 'La persistenza classica (misura di TL passi prima) è un buon riferimento solo se TL è breve rispetto al ciclo giornaliero. Nell\'Abruzzo, con dati orari e TL = 12 h, la "previsione" per mezzogiorno è il valore di mezzanotte e quella per mezzanotte è il picco di mezzogiorno: i picchi finiscono di notte, l\'errore della persistenza diventa enorme e la rete sembra migliore di quanto sia.'),
      h('ul', null,
        h('li', null, h('b', null, 'Abruzzo. '), `Il riferimento principale, per tutti i TL, è la stessa ora del giorno prima (t − 24 h): rispetta il ciclo giornaliero ed è disponibile quando si fa la previsione (TL ≤ 24 h). Nei dati è già migliore della persistenza classica anche a TL = 1 h. La persistenza classica è riportata solo per TL ≤ ${ABR_PERS_MAX_TL} h.`),
        h('li', null, h('b', null, 'Generation data. '), 'TL arriva al massimo a 6 passi (circa 30 minuti) e i fogli contengono solo ore di luce, quindi il problema non si presenta: resta la persistenza classica. L\'unico effetto residuo è al passaggio da un giorno al successivo (la sera seguita dalla mattina dopo), dove per i primi TL campioni la persistenza usa il valore della sera prima.'),
        h('li', null, h('b', null, 'Nei grafici '), 'si può mostrare la misura traslata di 1 passo: aiuta a vedere se la previsione è in ritardo, ma non è un riferimento per le tabelle.'),
      ))));
    view.append(card('Dati e cautele', null, h('div', { class: 'prose' }, h('ul', null,
      h('li', null, 'Regressione: divisione train/test casuale senza seed, quindi ogni run dà numeri leggermente diversi. Il run usato nella tesi è ' + REG.used_run + '.'),
      h('li', null, 'Abruzzo: le metriche vengono dai CSV quando esistono, altrimenti da Metrics.txt (copia della console). I test durano circa 9 giorni per stagione. In Estate 2020 il test contiene un buco di circa 17 ore riempito per interpolazione lineare.'),
      h('li', null, 'Generation_data non ha data e ora: giorni e stagioni sono ricostruiti (foglio Riepilogo) e il passo di 5 minuti è una stima. Le notti non ci sono.'),
      h('li', null, 'Le medie "sulle stagioni" sono medie semplici delle metriche di ogni stagione.'),
    ))));
    view.append(card('Materiale non mostrato', null, h('div', { class: 'prose' },
      h('p', null, 'Le prove scartate durante il lavoro e le copie duplicate dei grafici non compaiono nella dashboard.'))));
    view.append(card('Fonti', null, h('div', { class: 'prose' }, h('ul', null,
      REG.runs.map(r => h('li', null, h('code', null, r.source), r.scatter_source ? [' · punti: ', h('code', null, r.scatter_source)] : null)),
      h('li', null, h('code', null, ABR.metrics_source), ' e ', h('code', null, 'Monomega abruzzo/Grafici_*/Risultati_*.csv')),
      h('li', null, h('code', null, 'Monomega abruzzo/Abruzzo_diviso_in_stagioni.xlsx'), ' (serie misurate, riferimenti ingenui)'),
      h('li', null, h('code', null, 'Generation data/LSTM_ESOGENA/Reti_stagioni_separate/Grafici_*/Risultati_*.csv'), ' e ', h('code', null, 'Generation data/LSTM_ENDOGENA/Reti_con_stagioni_separate/Grafici_*/Risultati_*.csv')),
      h('li', null, h('code', null, 'Generation data/LSTM_ESOGENA/Reti_stagioni_unite/Grafici_ANNI_*/Risultati_*.csv'), ' e ', h('code', null, 'Generation data/LSTM_ENDOGENA/Reti_con_stagioni_unite/Grafici_ANNI_*/Risultati_*.csv')),
      h('li', null, h('code', null, 'Generation data/Generation_data_stagioni_vento_corretto.xlsx'), ' (serie misurate, persistenza)'),
      h('li', null, 'File FV_*.hdf5 / FV_*.dict per gli stati LSTMVis.'),
    ))));
  }

  // ------------------------------------------------------------------ start
  applyTheme();
  render(false);
})();
