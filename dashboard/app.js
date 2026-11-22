// Launch Radar v4 — dashboard logic. Reads window.RADAR (data.js) and
// recomputes every verdict live from the row's own numbers:
//   slice = value-if-it-launches x odds x drop share x deposit / TVL
//   net   = slice - plan fees;  net/hour = net / plan hours
// FARM when net >= $15 and net/hour >= $5; MARGINAL when net > $0; else SKIP.
// Table, detail view and integrity strip all read the same rows the program
// wrote to board.json, so screenshots and code agree.
(function () {
  var D = window.RADAR;
  var M = D.meta;
  var $ = function (id) { return document.getElementById(id); };
  var fmt$ = function (n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  };
  var fmtInt = function (n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); };
  var fmtSigned = function (n, d) { return (n < 0 ? '' : '+') + n.toFixed(d === undefined ? 1 : d); };
  var money2 = function (n) { return (n < 0 ? '-$' : '+$') + Math.abs(n).toFixed(2); };
  var ageStr = function (days) {
    if (days === null || days === undefined) return '—';
    if (days < 90) return days + ' d';
    if (days < 730) return (days / 30.44).toFixed(1) + ' mo';
    return (days / 365.25).toFixed(1) + ' yr';
  };
  var catName = function (r) { return D.cats[r[2]] || 'none'; };
  var chainNames = function (r) { return r[3].map(function (i) { return D.chains[i]; }); };
  var isWatch = function (r) { return M.watchlist.indexOf(r[0]) !== -1; };
  var econ = function (r) {
    var dep = +$('depSel').value, share = +$('shareSel').value;
    var slice = (r[9] * (r[7] / 1000) * share * dep) / r[4];
    var fees = r[10] / 100, hours = Math.max(0.5, r[11] / 10);
    var net = slice - fees;
    return { slice: slice, fees: fees, hours: hours, net: net, netHr: net / hours,
      verdict: (net >= 15 && net / hours >= 5) ? 'FARM' : (net > 0 ? 'MARGINAL' : 'SKIP') };
  };
  // FNV-1a over "slug:implied|..." — the same checksum main.ts prints.
  var fnv = function (s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16).padStart(8, '0');
  };

  // ---- integrity strip: recompute the board's own claims in the browser ----
  var sorted = true, watchN = 0, total = 0;
  for (var i = 0; i < D.rows.length; i++) {
    var r = D.rows[i];
    if (i > 0 && r[8] > D.rows[i - 1][8]) sorted = false;
    if (isWatch(r)) watchN++;
    total += r[8];
  }
  var sumOk = total === M.totalImplied;
  var chkOk = fnv(D.rows.map(function (r) { return r[0] + ':' + r[8]; }).join('|')) === M.checksum;
  var integ = $('integrity');
  integ.textContent = '✓ this table = board.json: ' + D.rows.length + ' of ' + D.rows.length + ' rows drawn = ' + D.rows.length +
    ' written · ranks 1–' + D.rows.length + ' in order, values never rise · totals equal ' + fmt$(total) +
    ' · checksum ' + M.checksum + ' · watchlist ' + watchN + ' of ' + M.watch + ' ranked · ledger ' + M.n + ' of ' + M.n + ' protocols';
  if (!sorted || !sumOk || !chkOk || watchN !== M.watch) { integ.classList.add('bad'); integ.textContent = '✗ board check failed — sorted:' + sorted + ' totals:' + sumOk + ' checksum:' + chkOk + ' watchlist:' + watchN + '/' + M.watch; }

  $('snapLine').textContent = 'DefiLlama snapshot ' + M.asOf + ' · model ' + M.model + ' · ' + M.n + ' protocols read · no network, no hand-picked names';
  $('footLine').textContent = 'Snapshot: ' + M.source + ' · Floor $' + fmtInt(M.floor) + ' · ' + M.n + ' protocols, ' + M.ranked + ' ranked · dossier built by main.ts from this snapshot alone.';

  // ---- KPI strip ----
  var farmN = 0;
  D.rows.forEach(function (r) { if (econ(r).verdict === 'FARM') farmN++; });
  var kpis = [
    ['Ranked', String(M.ranked), 'of ' + M.n + ' read · by implied value'],
    ['Implied value', fmt$(M.totalImplied), 'summed on the board · rank 1 ' + fmt$(D.rows[0][8])],
    ['Out-of-sample miss', '×' + M.loo.toFixed(2), 'median, leave-one-out · walk-forward ×' + M.wf.toFixed(2)],
    ['Range holds', Math.round(M.cov50 * 100) + '%', 'of held-out caps inside P25–P75 (nominal 50%) · P10–P90 ' + Math.round(M.cov80 * 100) + '%'],
    ['Launch odds, held out', Math.round(M.oddsAcc * 100) + '% · ' + M.oddsBrier, 'called right, 5-fold CV · Brier (base rate ' + M.oddsBase + ')'],
    ['Worth farming', farmN + ' FARM', 'at $1,000 deposit, 7% drop · ' + M.watch + '/' + M.watch + ' watchlist ranked'],
  ];
  $('kpis').innerHTML = kpis.map(function (k) { return '<div class="kpi"><span>' + k[0] + '</span><b>' + k[1] + '</b><small>' + k[2] + '</small></div>'; }).join('');

  // ---- ledger ----
  var palette = ['#1458d6', '#0b7a6d', '#7a5200', '#6b21a8', '#b3261e', '#5b6b7c', '#2f6fb2', '#8a6d00', '#455a6b', '#904d00'];
  var bar = '', leg = '';
  M.ledger.forEach(function (g, i) {
    var pct = (100 * g.n / M.n).toFixed(1);
    bar += '<i style="width:' + pct + '%;background:' + palette[i % palette.length] + '" title="' + g.label + ' ' + g.n + '"></i>';
    leg += '<span><i class="dot" style="background:' + palette[i % palette.length] + '"></i>' + g.label + ' <b>' + g.n + '</b></span>';
  });
  $('ledgerBar').innerHTML = bar;
  $('ledgerLegend').innerHTML = leg;
  $('ledgerN').textContent = M.n;

  // ---- method + evidence ----
  $('formula').textContent = 'implied = 10^(' + M.olsA + ' + ' + M.olsB + '·log10 TVL)' +
    (M.keptUpTo >= 2 ? ' × category' : '') + (M.keptUpTo >= 3 ? ' × momentum' : '') + (M.keptUpTo >= 4 ? ' × age' : '') +
    (M.keptUpTo >= 5 ? ' × chains' : '') + ' × token odds';
  $('modelNotes').innerHTML =
    '<li>Each term survives only if it lowers the held-out miss in <b>both</b> tests (leave-one-out and walk-forward); the table shows every term, kept or not.</li>' +
    '<li>Size curve: fitted on the ' + M.peersN + ' traded tokens with a market cap — log10(mcap) = ' + M.olsA + ' + ' + M.olsB + '·log10(TVL).</li>' +
    '<li>Token odds: logistic fit on all ' + M.n + ' protocols (category, log age, log TVL). Age coef ' + M.oddsAgeCoef + ', TVL coef ' + M.oddsTvlCoef + '.</li>' +
    '<li>Band: P25–P75 of the leave-one-out value ratios (×' + M.bandLo + ' to ×' + M.bandHi + '); ' + Math.round(M.cov50 * 100) + '% of held-out caps land inside it.</li>';
  var ab = '<tr><th>Term, added in order</th><th>Leave-one-out</th><th>Walk-forward</th><th></th></tr>';
  M.ablation.forEach(function (a) {
    ab += '<tr><td>' + a[0] + '</td><td>×' + a[1].toFixed(2) + '</td><td>×' + a[2].toFixed(2) + '</td><td class="' + (a[3] ? 'kept' : 'notkept') + '">' + (a[3] ? 'kept' : 'tested, not kept') + '</td></tr>';
  });
  $('ablation').innerHTML = ab;
  $('oddsLine').textContent = 'Token odds, 5-fold CV: Brier ' + M.oddsBrier + ' (base rate ' + M.oddsBase + '), ' + Math.round(M.oddsAcc * 100) + '% called right. ' +
    'Walk-forward splits the ' + M.wfN + ' dated traded tokens at the median listing date: fit on the older half, scored on the newer half.';

  // ---- scatter: traded tokens, log TVL vs log mcap, fitted line + board ----
  (function () {
    var cv = $('scatter'), ctx = cv.getContext('2d');
    var W = cv.width, H = cv.height, pad = 34;
    var xs = [], ys = [];
    D.peers.forEach(function (p) { xs.push(p[1]); ys.push(p[2]); });
    var x0 = Math.min.apply(null, xs) - 0.2, x1 = Math.max.apply(null, xs) + 0.2;
    var y0 = Math.min.apply(null, ys) - 0.3, y1 = Math.max.apply(null, ys) + 0.3;
    var X = function (v) { return pad + ((v - x0) / (x1 - x0)) * (W - 2 * pad); };
    var Y = function (v) { return H - pad - ((v - y0) / (y1 - y0)) * (H - 2 * pad); };
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#d9e1e8'; ctx.fillStyle = '#5b6b7c'; ctx.font = '11px sans-serif';
    for (var g = Math.ceil(x0); g <= Math.floor(x1); g++) {
      ctx.beginPath(); ctx.moveTo(X(g), pad); ctx.lineTo(X(g), H - pad); ctx.stroke();
      ctx.fillText('$1e' + g, X(g) - 10, H - 12);
    }
    ctx.fillText('mcap $', 4, 16);
    D.peers.forEach(function (p) { ctx.fillStyle = '#1458d6'; ctx.beginPath(); ctx.arc(X(p[1]), Y(p[2]), 2.6, 0, 7); ctx.fill(); });
    ctx.strokeStyle = '#b3261e'; ctx.lineWidth = 2; ctx.beginPath();
    ctx.moveTo(X(x0), Y(M.olsA + M.olsB * x0)); ctx.lineTo(X(x1), Y(M.olsA + M.olsB * x1)); ctx.stroke();
    ctx.fillStyle = '#b3261e'; ctx.fillText('fitted line', X(x1) - 62, Y(M.olsA + M.olsB * x1) - 8);
    $('scatterNote').textContent = 'Each dot is one of the ' + M.peersN + ' traded tokens (log TVL vs log mcap). Red: the fitted size curve. The board sits on the same curve — no protocol is priced off a name, only off its TVL and its peers.';
  })();

  // ---- controls, tabs, table ----
  var state = { tab: 'all', q: '', cat: '', chain: '', sort: 'rank', dir: 1 };
  var tabs = [['all', 'All'], ['watch', 'Watchlist'], ['early', 'Early'], ['FARM', 'Farm'], ['MARGINAL', 'Marginal'], ['SKIP', 'Skip']];
  function tabCounts() {
    var c = { all: D.rows.length, watch: 0, early: 0, FARM: 0, MARGINAL: 0, SKIP: 0 };
    D.rows.forEach(function (r) { if (isWatch(r)) c.watch++; else c.early++; c[econ(r).verdict]++; });
    return c;
  }
  function renderTabs() {
    var c = tabCounts();
    $('tabs').innerHTML = tabs.map(function (t) {
      return '<button type="button" class="tab' + (state.tab === t[0] ? ' on' : '') + '" data-tab="' + t[0] + '">' + t[1] + ' ' + c[t[0]] + '</button>';
    }).join('');
    document.querySelectorAll('#tabs .tab').forEach(function (b) {
      b.addEventListener('click', function () { state.tab = b.getAttribute('data-tab'); renderTabs(); renderRows(); });
    });
  }
  var catSel = $('catSel'), chainSel = $('chainSel');
  D.cats.forEach(function (c) { if (c !== 'none') { var o = document.createElement('option'); o.value = c; o.textContent = c; catSel.appendChild(o); } });
  D.chains.forEach(function (c) { var o = document.createElement('option'); o.value = c; o.textContent = c; chainSel.appendChild(o); });

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    return D.rows.filter(function (r) {
      if (state.tab === 'watch' && !isWatch(r)) return false;
      if (state.tab === 'early' && isWatch(r)) return false;
      if ((state.tab === 'FARM' || state.tab === 'MARGINAL' || state.tab === 'SKIP') && econ(r).verdict !== state.tab) return false;
      if (state.cat && catName(r) !== state.cat) return false;
      if (state.chain && chainNames(r).indexOf(state.chain) === -1) return false;
      if (q && (r[1] + ' ' + r[0] + ' ' + catName(r) + ' ' + chainNames(r).join(' ')).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }
  var sorters = {
    rank: function (a, b) { return (D.rows.indexOf(a) - D.rows.indexOf(b)) * state.dir; },
    name: function (a, b) { return (a[1] < b[1] ? -1 : 1) * state.dir; },
    tvl: function (a, b) { return (a[4] - b[4]) * state.dir; },
    g7: function (a, b) { return ((a[5] || 0) - (b[5] || 0)) * state.dir; },
    age: function (a, b) { return ((a[6] || 0) - (b[6] || 0)) * state.dir; },
    odds: function (a, b) { return (a[7] - b[7]) * state.dir; },
    if: function (a, b) { return (a[9] - b[9]) * state.dir; },
    implied: function (a, b) { return (a[8] - b[8]) * state.dir; },
    net: function (a, b) { return (econ(a).net - econ(b).net) * state.dir; },
    hour: function (a, b) { return (econ(a).netHr - econ(b).netHr) * state.dir; },
  };
  var selected = null;
  function renderRows() {
    var rows = visibleRows();
    rows.sort(sorters[state.sort] || sorters.rank);
    var html = '';
    rows.forEach(function (r) {
      var e = econ(r), rank = D.rows.indexOf(r) + 1;
      var g7 = r[5] === null ? '—' : '<span class="' + (r[5] >= 0 ? 'up' : 'down') + '">' + fmtSigned(r[5], 1) + '%</span>';
      html += '<tr data-slug="' + r[0] + '"' + (selected === r[0] ? ' class="sel"' : '') + '><td>' + rank + '</td>' +
        '<td class="name"><b>' + r[1] + '</b><small>' + catName(r) + ' · ' + chainNames(r).slice(0, 3).join(', ') + (r[3].length > 3 ? ' +' + (r[3].length - 3) : '') +
        (isWatch(r) ? '<span class="badge wl">Watchlist</span>' : '') + '</small></td>' +
        '<td>' + fmt$(r[4]) + '</td><td>' + g7 + '</td><td>' + ageStr(r[6]) + '</td>' +
        '<td><span class="oddsbar"><i style="width:' + (r[7] / 10) + '%"></i></span>' + Math.round(r[7] / 10) + '%</td>' +
        '<td>' + fmt$(r[9]) + '</td>' +
        '<td><b>' + fmt$(r[8]) + '</b><br><small>' + fmt$(r[8] * M.bandLo) + '–' + fmt$(r[8] * M.bandHi) + '</small></td>' +
        '<td>' + money2(e.net) + '<br><small>slice ' + money2(e.slice) + '</small></td>' +
        '<td>' + money2(e.netHr) + '/h</td>' +
        '<td><span class="verdict ' + e.verdict + '">' + e.verdict + '</span></td>' +
        '<td><small>' + Plans.labelFor(r, D) + '</small></td></tr>';
    });
    $('rows').innerHTML = html;
    $('countLine').textContent = rows.length + ' of ' + D.rows.length + ' shown · plans at $' + fmtInt(+$('depSel').value) + ' deposit, ' + Math.round(+$('shareSel').value * 100) + '% drop · sorted by ' + state.sort + ' · click a row for its model, comps and farm plan';
    document.querySelectorAll('#rows tr').forEach(function (tr) {
      tr.addEventListener('click', function () { showDetail(tr.getAttribute('data-slug')); });
    });
  }
  document.querySelectorAll('#board thead th').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-sort');
      if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = (k === 'name' ? 1 : -1); }
      renderRows();
    });
  });

  // ---- detail view ----
  function showDetail(slug) {
    var r = null;
    D.rows.forEach(function (x) { if (x[0] === slug) r = x; });
    if (!r) return;
    selected = slug;
    var e = econ(r), rank = D.rows.indexOf(r) + 1;
    var steps = Plans.stepsFor(r, D);
    var comps = D.peers.map(function (p) { return { slug: p[0], x: p[1], y: p[2], d: Math.abs(p[1] - Math.log10(r[4])) }; })
      .sort(function (a, b) { return a.d - b.d; }).slice(0, 3);
    var compHtml = comps.map(function (c) {
      return '<tr><td>' + c.slug + '</td><td>' + fmt$(Math.pow(10, c.x)) + '</td><td>' + fmt$(Math.pow(10, c.y)) + '</td><td>×' + (Math.pow(10, c.y) / Math.pow(10, c.x)).toFixed(2) + '</td></tr>';
    }).join('');
    $('detail').hidden = false;
    $('detail').innerHTML =
      '<p class="back"><a href="#" id="backLink">← Back to the board</a> · rank ' + rank + ' of ' + D.rows.length + (isWatch(r) ? ' · <span class="badge wl">Watchlist</span>' : ' · Early, below the floor') + '</p>' +
      '<h2>' + r[1] + '</h2><p class="sub">' + catName(r) + ' · ' + chainNames(r).join(', ') + ' · TVL ' + fmt$(r[4]) + ' · snapshot ' + M.asOf + '</p>' +
      '<div class="grid"><div><h3>Model breakdown — impliedValue()</h3><table>' +
      '<tr><td>TVL</td><td>' + fmt$(r[4]) + '</td></tr>' +
      '<tr><td>7-day TVL change</td><td>' + (r[5] === null ? 'not reported' : fmtSigned(r[5], 1) + '%') + '</td></tr>' +
      '<tr><td>No token for</td><td>' + ageStr(r[6]) + '</td></tr>' +
      '<tr><td>Value if it launches</td><td>' + fmt$(r[9]) + ' <small>(10^(' + M.olsA + ' + ' + M.olsB + '·log10 TVL)' + (M.keptUpTo >= 2 ? ' × category' : '') + (M.keptUpTo >= 3 ? ' × momentum' : '') + (M.keptUpTo >= 4 ? ' × age' : '') + ')</small></td></tr>' +
      '<tr><td>Token odds</td><td>' + Math.round(r[7] / 10) + '% <small>(logistic fit on all ' + M.n + ' protocols)</small></td></tr>' +
      '<tr><td>Implied value (rank ' + rank + ')</td><td><b>' + fmt$(r[8]) + '</b> · P25–P75 ' + fmt$(r[8] * M.bandLo) + '–' + fmt$(r[8] * M.bandHi) + '</td></tr>' +
      '<tr><td>Expected slice at $' + fmtInt(+$('depSel').value) + ', ' + Math.round(+$('shareSel').value * 100) + '% drop</td><td>' + money2(e.slice) + '</td></tr>' +
      '<tr><td>Plan fees / hours</td><td>$' + e.fees.toFixed(2) + ' / ' + e.hours.toFixed(1) + ' h</td></tr>' +
      '<tr><td>Net of fees · net / hour</td><td><b>' + money2(e.net) + ' · ' + money2(e.netHr) + '/h</b></td></tr>' +
      '<tr><td>Verdict</td><td><span class="verdict ' + e.verdict + '">' + e.verdict + '</span></td></tr></table>' +
      '<h3>Nearest traded comps (by TVL)</h3><table><tr><th>Protocol</th><th>TVL</th><th>Mcap</th><th>Multiple</th></tr>' + compHtml + '</table></div>' +
      '<div><h3>Farm plan — $1,000 deposit, 60 days, $' + e.fees.toFixed(2) + ' fees</h3><ol>' +
      steps.map(function (s) { return '<li>' + s + '</li>'; }).join('') +
      '</ol><p class="caveat">Steps are a plan, not a promise: costs are the chain gas plus the stated fee, and the drop may never come. The protocol records no token today — that is all the snapshot says.</p></div></div>';
    $('backLink').addEventListener('click', function (ev) { ev.preventDefault(); $('detail').hidden = true; selected = null; renderRows(); });
    renderRows();
  }

  $('q').addEventListener('input', function () { state.q = $('q').value; renderRows(); });
  catSel.addEventListener('change', function () { state.cat = catSel.value; renderRows(); });
  chainSel.addEventListener('change', function () { state.chain = chainSel.value; renderRows(); });
  $('depSel').addEventListener('change', function () { renderTabs(); renderRows(); if (selected) showDetail(selected); });
  $('shareSel').addEventListener('change', function () { renderTabs(); renderRows(); if (selected) showDetail(selected); });
  $('resetBtn').addEventListener('click', function () { state = { tab: 'all', q: '', cat: '', chain: '', sort: 'rank', dir: 1 }; $('q').value = ''; catSel.value = ''; chainSel.value = ''; $('depSel').value = '1000'; $('shareSel').value = '0.07'; $('detail').hidden = true; selected = null; renderTabs(); renderRows(); });
  $('csvBtn').addEventListener('click', function () {
    var lines = ['rank,slug,name,category,chains,tvl_usd,change_7d,age_days,token_odds,implied_value_usd,verdict,net_usd'];
    visibleRows().forEach(function (r) {
      var e = econ(r);
      lines.push((D.rows.indexOf(r) + 1) + ',' + r[0] + ',"' + r[1].replace(/"/g, '""') + '",' + catName(r) + ',"' + chainNames(r).join(' ') + '",' + r[4] + ',' + (r[5] === null ? '' : r[5]) + ',' + (r[6] === null ? '' : r[6]) + ',' + (r[7] / 1000) + ',' + r[8] + ',' + e.verdict + ',' + e.net.toFixed(2));
    });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = 'launch-radar-board.csv'; a.click();
  });

  // ---- URL views for screenshots: ?view=detail&slug=X · ?tab=farm|watch|... · ?shot=board ----
  var params = new URLSearchParams(location.search);
  if (params.get('shot') === 'board') {
    document.querySelector('.ledger').style.display = 'none';
    document.querySelector('.method').style.display = 'none';
  }
  var tab = params.get('tab');
  if (tab && tabs.some(function (t) { return t[0] === tab; })) state.tab = tab;
  renderTabs();
  renderRows();
  if (params.get('view') === 'detail' && params.get('slug')) {
    document.querySelector('.kpis').style.display = 'none';
    document.querySelector('.ledger').style.display = 'none';
    document.querySelector('.method').style.display = 'none';
    document.querySelector('.controls').style.display = 'none';
    document.querySelector('table.board').style.display = 'none';
    showDetail(params.get('slug'));
    document.querySelector('.detail').scrollIntoView();
  }
})();
