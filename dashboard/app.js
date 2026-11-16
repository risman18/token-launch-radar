// Launch Radar dashboard. Renders window.RADAR (written beside dashboard/ by
// main.ts) as a sortable, filterable board with a per-protocol detail view and
// the comparables set kept apart. No network: every byte shown is in data.js.
// The valuation printed here is the model's own arithmetic from lib/model.ts,
// restated so a reader can check any row against the snapshot's figures.
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', tier: 'all', watchOnly: false, sort: 'rank', dir: 1, selected: null };

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined) return 'n/a';
    return (n > 0 ? '+' : '') + Number(n).toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.round(days) + 'd';
  }
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  var categories = [];
  var chains = [];
  DATA.rows.forEach(function (r) {
    if (r.category && categories.indexOf(r.category) < 0) categories.push(r.category);
    r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  categories.sort();
  chains.sort();

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) {
      if (state.watchOnly && !r.on_watchlist) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (state.tier !== 'all' && r.tier !== state.tier) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = state.sort;
    rows.sort(function (a, b) {
      var av = a[key], bv = b[key];
      if (av === null || av === undefined) av = -Infinity;
      if (bv === null || bv === undefined) bv = -Infinity;
      if (typeof av === 'string') return state.dir * av.localeCompare(bv);
      return state.dir * (av - bv);
    });
    return rows;
  }

  function detailView(row) {
    var m = row.model;
    var box = el('section', { class: 'detail', id: 'detail' });
    box.appendChild(el('button', { class: 'close', text: 'Close', onclick: function () { state.selected = null; render(); } }));
    box.appendChild(el('h2', { text: row.name + ' — detail' }));
    box.appendChild(el('p', { class: 'meta', text: (row.category || 'Uncategorized') + ' · ' + row.chains.join(', ') + ' · listed ' + (row.listed_at || 'unknown') + ' · token status: records no token' + (row.on_watchlist ? ' · on the snapshot watchlist' : ' · early radar (below the $50M watchlist floor)') }));
    var f = el('div', { class: 'factors' });
    function factor(label, value) { return el('div', { class: 'factor' }, el('span', { text: label }), el('b', { text: value })); }
    f.appendChild(factor('Implied value', fmtUsd(row.implied_value_usd)));
    f.appendChild(factor('Plausible range', fmtUsd(row.implied_low_usd) + ' – ' + fmtUsd(row.implied_high_usd)));
    f.appendChild(factor('TVL', fmtUsd(row.tvl_usd)));
    f.appendChild(factor('Category multiple', m.category_multiple.toFixed(2) + 'x (' + m.comparables + ' traded comparables)'));
    f.appendChild(factor('Growth 7d', fmtPct(row.change_7d) + ' → x' + m.growth_multiplier.toFixed(2)));
    f.appendChild(factor('Maturity', 'age ' + fmtAge(row.age_days) + ' → x' + m.maturity_multiplier.toFixed(2)));
    f.appendChild(factor('Breadth', row.chains.length + ' chain(s) → x' + m.breadth_multiplier.toFixed(2)));
    f.appendChild(factor('Readiness', row.readiness + '/100 · tier ' + row.tier + ' · ' + row.confidence + ' confidence'));
    box.appendChild(f);
    box.appendChild(el('h3', { text: 'How to farm it' }));
    var list = el('ol', { class: 'steps' });
    row.farm_steps.forEach(function (s) { list.appendChild(el('li', { text: s })); });
    box.appendChild(list);
    return box;
  }

  function boardTable(rows) {
    var table = el('table');
    var head = el('tr');
    var cols = [
      ['rank', '#', 'num'], ['name', 'Protocol', ''], ['category', 'Category', 'hideS'],
      ['tvl_usd', 'TVL', 'num'], ['change_7d', '7d', 'num hideS'], ['implied_value_usd', 'Implied value', 'num'],
      ['readiness', 'Ready', 'num'], ['tier', 'Tier', '']
    ];
    cols.forEach(function (c) {
      head.appendChild(el('th', { class: c[2], text: c[1] + (state.sort === c[0] ? (state.dir === 1 ? ' ↑' : ' ↓') : ''), onclick: function () {
        if (state.sort === c[0]) state.dir = -state.dir; else { state.sort = c[0]; state.dir = c[0] === 'name' || c[0] === 'category' ? 1 : -1; if (c[0] === 'rank') state.dir = 1; }
        render();
      } }));
    });
    table.appendChild(el('thead', null, head));
    var body = el('tbody');
    rows.forEach(function (r) {
      var tr = el('tr', { class: state.selected === r.slug ? 'sel' : '', onclick: function () { state.selected = state.selected === r.slug ? null : r.slug; render(); } });
      tr.appendChild(el('td', { class: 'num', text: String(r.rank) }));
      var nameCell = el('td', null, el('span', { class: 'name', text: r.name }), ' ', r.on_watchlist ? el('span', { class: 'watch', text: '★ watchlist' }) : null, el('div', { class: 'slug', text: r.slug + ' · ' + r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') }));
      tr.appendChild(nameCell);
      tr.appendChild(el('td', { class: 'hideS', text: r.category || '—' }));
      tr.appendChild(el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }));
      var ch = el('td', { class: 'num hideS' + (r.change_7d === null ? '' : r.change_7d >= 0 ? ' up' : ' down'), text: fmtPct(r.change_7d) });
      tr.appendChild(ch);
      tr.appendChild(el('td', { class: 'num', text: fmtUsd(r.implied_value_usd) }));
      var rd = el('td', { class: 'num' }, el('div', { class: 'bar' }, el('i', { style: 'width:' + r.readiness + '%' })), String(r.readiness));
      tr.appendChild(rd);
      tr.appendChild(el('td', null, el('span', { class: 'chip tier' + r.tier, text: r.tier })));
      body.appendChild(tr);
    });
    table.appendChild(body);
    return table;
  }

  function render() {
    app.setAttribute('aria-busy', 'false');
    app.textContent = '';
    var wrap = el('div', { class: 'wrap' });
    var hero = el('header', { class: 'hero' });
    hero.appendChild(el('div', { class: 'kicker', text: 'Token Launch Radar · ' + DATA.model_version }));
    hero.appendChild(el('h1', { text: 'Pre-token protocols, ranked by what a launch would be worth' }));
    hero.appendChild(el('p', { class: 'sub', text: 'Every protocol in the sealed DefiLlama snapshot (' + DATA.as_of + ') that records no token and is not a wrapped, staked, bridged or exchange product, valued from the snapshot\'s own traded comparables and ranked. Click any row for its valuation breakdown and farm plan.' }));
    wrap.appendChild(hero);

    var stats = el('div', { class: 'stats' });
    [['Board rows', DATA.board_size], ['Watchlist covered', DATA.watchlist_size + ' / ' + DATA.watchlist_size], ['Early (below floor)', DATA.early_size], ['Global median multiple', DATA.global_median_multiple.toFixed(2) + 'x'], ['Snapshot date', DATA.as_of]].forEach(function (s) {
      stats.appendChild(el('div', { class: 'stat' }, el('b', { text: String(s[1]) }), el('span', { text: s[0] })));
    });
    wrap.appendChild(stats);

    var method = el('section', { class: 'method' });
    method.appendChild(el('h2', { text: 'How a value is made (no names are special-cased)' }));
    method.appendChild(el('p', null, 'Implied value = category multiple × TVL', el('code', { text: '^0.88' }), ' (anchored at $100M) × growth factor × maturity factor × breadth factor. The category multiple is the median market-cap/TVL of that category\'s traded protocols in this same snapshot, shrunk toward the global median; growth clamps the 7-day TVL change to −50%…+100%, weighted 0.30 on the way up and 0.50 on the way down, because shrinking TVL is stronger evidence than one hot week; maturity rises with log-age up to 5 years; breadth adds 3% per extra chain, capped at 5. The range beside each value is 0.45×–2.2× the point estimate.'));
    var cats = el('div', { class: 'cats' });
    DATA.categories.forEach(function (c) { cats.appendChild(el('span', { text: c.category + ': ' + c.used_multiple.toFixed(2) + 'x (n=' + c.comparables + ')' })); });
    method.appendChild(cats);
    wrap.appendChild(method);

    var controls = el('div', { class: 'controls' });
    var search = el('input', { type: 'search', placeholder: 'Search name, slug, category…', value: state.q });
    search.addEventListener('input', function () { state.q = search.value; renderTableOnly(); });
    controls.appendChild(search);
    function select(options, value, onchange) {
      var s = el('select');
      options.forEach(function (o) { var opt = el('option', { value: o[0], text: o[1] }); if (o[0] === value) opt.setAttribute('selected', 'selected'); s.appendChild(opt); });
      s.addEventListener('change', function () { onchange(s.value); render(); });
      return s;
    }
    controls.appendChild(select([['all', 'All categories']].concat(categories.map(function (c) { return [c, c]; })), state.category, function (v) { state.category = v; }));
    controls.appendChild(select([['all', 'All chains']].concat(chains.map(function (c) { return [c, c]; })), state.chain, function (v) { state.chain = v; }));
    controls.appendChild(select([['all', 'All tiers'], ['A', 'Tier A'], ['B', 'Tier B'], ['C', 'Tier C']], state.tier, function (v) { state.tier = v; }));
    var watchLabel = el('label', { class: 'check' });
    var watchBox = el('input', { type: 'checkbox' });
    if (state.watchOnly) watchBox.setAttribute('checked', 'checked');
    watchBox.addEventListener('change', function () { state.watchOnly = watchBox.checked; render(); });
    watchLabel.appendChild(watchBox);
    watchLabel.appendChild(document.createTextNode('Watchlist only'));
    controls.appendChild(watchLabel);
    controls.appendChild(el('span', { class: 'count', id: 'rowcount' }));
    wrap.appendChild(controls);

    // The detail view sits directly under the controls, above the board: with
    // a 198-row table, a panel below the table would never be seen.
    var detailHolder = el('div', { id: 'detailholder' });
    wrap.appendChild(detailHolder);
    var holder = el('div', { id: 'tableholder' });
    wrap.appendChild(holder);

    var liveHead = el('h2', { class: 'section', text: 'Already trading — comparables only, never ranked' });
    wrap.appendChild(liveHead);
    wrap.appendChild(el('p', { class: 'note', text: 'These protocols already have a token; the board never ranks them. They are shown because their market-cap/TVL multiples are the evidence the pre-token values above are built from.' }));
    var lt = el('table');
    var lh = el('tr', null, el('th', { text: 'Protocol' }), el('th', { class: 'hideS', text: 'Category' }), el('th', { class: 'num', text: 'TVL' }), el('th', { class: 'num', text: 'Market cap' }), el('th', { class: 'num', text: 'Multiple' }));
    lt.appendChild(el('thead', null, lh));
    var lb = el('tbody');
    DATA.live.forEach(function (r) {
      lb.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'name', text: r.name }), el('div', { class: 'slug', text: r.slug })),
        el('td', { class: 'hideS', text: r.category || '—' }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.multiple === null ? 'n/a' : r.multiple.toFixed(2) + 'x' })));
    });
    lt.appendChild(lb);
    wrap.appendChild(lt);

    wrap.appendChild(el('footer', { text: 'Source: ' + DATA.source + ' · Floor: ' + fmtUsd(DATA.floor_usd) + ' · Implied values are this entry\'s own model claims, not predictions that a token will launch. Farm plans are checklists, not financial advice.' }));
    app.appendChild(wrap);
    renderTableOnly();
  }

  function renderTableOnly() {
    var holder = document.getElementById('tableholder');
    if (!holder) return;
    var rows = visibleRows();
    holder.textContent = '';
    holder.appendChild(boardTable(rows));
    var count = document.getElementById('rowcount');
    if (count) count.textContent = rows.length + ' of ' + DATA.board_size + ' protocols shown';
    var detailHolder = document.getElementById('detailholder');
    if (detailHolder && state.selected) {
      var row = DATA.rows.filter(function (r) { return r.slug === state.selected; })[0];
      detailHolder.textContent = '';
      if (row) detailHolder.appendChild(detailView(row));
    }
  }

  // Deep links: #<slug> opens that protocol's detail view, and ?category=,
  // ?chain=, ?tier=, ?q= or ?watch=1 opens the board already filtered, so a
  // reader (or a screenshot) can land on exactly one view of the radar.
  try {
    var params = new URLSearchParams(location.search);
    if (params.get('category') && categories.indexOf(params.get('category')) >= 0) state.category = params.get('category');
    if (params.get('chain') && chains.indexOf(params.get('chain')) >= 0) state.chain = params.get('chain');
    if (['A', 'B', 'C'].indexOf(params.get('tier')) >= 0) state.tier = params.get('tier');
    if (params.get('q')) state.q = params.get('q');
    if (params.get('watch') === '1') state.watchOnly = true;
  } catch (e) { /* a malformed query string just leaves the default view */ }
  if (location.hash && location.hash.length > 1) {
    var slug = decodeURIComponent(location.hash.slice(1));
    if (DATA.rows.some(function (r) { return r.slug === slug; })) state.selected = slug;
  }
  render();
})();
