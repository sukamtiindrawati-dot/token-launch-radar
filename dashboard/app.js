// Token Radar dashboard, model radar-2. Reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, filters, a per-protocol detail view with the model's
// own inputs and the protocol's farm plan. No network: every byte it shows is in data.js.
// Rows arrive compact: [rank, slug, name, catIdx, chainIdxs, tvl, chg7d, ageDays, implied].
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var M = DATA.model;
  var state = { q: '', category: 'all', chain: 'all', tvlMin: 0, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  function decode(r) {
    return { rank: r[0], slug: r[1], name: r[2], category: DATA.categories[r[3]] || 'Other', chains: (r[4] || []).map(function (i) { return DATA.chains[i]; }), tvl: r[5], chg: r[6], age: r[7] < 0 ? null : r[7], implied: r[8], mult: DATA.multiples[r[3]] || 0 };
  }
  var ROWS = DATA.rows.map(decode);
  var LIVE = (DATA.live || []).map(function (r) {
    return { name: r[0], category: DATA.categories[r[1]] || 'Other', chains: (r[2] || []).map(function (i) { return DATA.chains[i]; }), tvl: r[3], mcap: r[4], chg: r[5] };
  });

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) { if (n === null || n === undefined || !isFinite(n)) return 'n/a'; return (n > 0 ? '+' : '') + n.toFixed(2) + '%'; }
  function fmtAge(d) { if (d === null || d === undefined) return 'unknown'; if (d >= 365) return (d / 365).toFixed(1) + 'y'; return Math.max(0, Math.round(d)) + 'd'; }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function growthMult(row) { return 1 + clamp(row.chg === null ? 0 : row.chg, M.growth_floor, M.growth_cap) / M.growth_divisor; }
  function ageMult(row) { return 1 + Math.min(row.age === null ? 0 : row.age / 365, M.age_years_cap) * M.age_per_year; }
  // The model in one function: recompute a row from the snapshot figures and check the number
  // board.json carries, so the page's code and the board's data are visibly the same arithmetic.
  function impliedOf(row) { return Math.max(1, Math.round(row.tvl * row.mult * growthMult(row) * ageMult(row))); }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
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

  // Farm plan: the same derivation main.ts writes to board.json — category, chains, TVL and age
  // decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) { if (p.tvl >= 5e9) return 250; if (p.tvl >= 1e9) return 150; if (p.tvl >= 1e8) return 100; return 50; }
  function holdDaysFor(age) { if (age === null || age === undefined) return 30; if (age < 180) return 60; if (age < 365) return 45; return 30; }
  function gasFor(chain) { return ['Solana', 'Base', 'Arbitrum', 'Optimism', 'Polygon', 'BSC', 'BNB Chain', 'Avalanche', 'Sui', 'Aptos'].indexOf(chain) >= 0 ? 'under $1 of gas' : 'about $3-8 of gas'; }
  function stepText(s) { var t = s.text + ' Cost: ' + s.cost + '. Time: ' + s.time + '.'; if (t.length > 600) t = t.slice(0, 596) + '...'; if (t.length < 20) t += ' Hold the position and check the protocol\'s own page.'; return t; }
  function farmSteps(p) {
    var chain = chainOf(p), capital = capitalFor(p), hold = holdDaysFor(p.age), gas = gasFor(chain), name = p.name, c = (p.category || '').toLowerCase();
    var setup = { text: 'Open a fresh wallet, fund it with $' + (capital + 20) + ' of USDC on ' + chain + ', and keep its seed phrase offline.', cost: gas + ' to fund it', time: '10 minutes' };
    var weekly = function (a) { return { text: 'Once a week, ' + a + ' on ' + name + ' so the wallet stays active in more than one snapshot.', cost: 'about $2 of gas a week', time: '10 minutes a week' }; };
    var holdStep = { text: 'Hold the position for at least ' + hold + ' days, and do not withdraw and re-enter to chase a snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' };
    var claim = { text: 'Before you withdraw, open ' + name + '\'s own points or rewards page and claim only from the link it publishes.', cost: 'no fee to check, and never pay to claim', time: '10 minutes' };
    var log = { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' };
    var steps;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) steps = [setup,
      { text: 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the supply position open.', cost: '$' + capital + ' of capital and ' + gas, time: '15 minutes to set up' },
      { text: 'Borrow 30% of the supplied value in the protocol\'s stable asset and hold it in the same wallet.', cost: 'about $2 of gas', time: '10 minutes' },
      weekly('adjust the supply or the borrow by $10-20'), holdStep, claim, log];
    else if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0 || c.indexOf('liquidity') >= 0) steps = [setup,
      { text: 'Provide $' + capital + ' of liquidity to ' + name + '\'s main pool on ' + chain + ' in equal parts of its two assets.', cost: '$' + capital + ' of capital and ' + gas, time: '20 minutes to set up' },
      { text: 'Stake the LP receipt in ' + name + '\'s farm on ' + chain + ' if it offers one, and note the reward rate.', cost: 'about $2 of gas', time: '10 minutes' },
      weekly('swap $10-20 through the pool or add a little liquidity'), holdStep, claim, log];
    else if (c.indexOf('rwa') >= 0) steps = [setup,
      { text: 'Mint $' + capital + ' of the yield-bearing asset on ' + chain + ' through ' + name + ' and hold it in the wallet.', cost: '$' + capital + ' of capital and ' + gas, time: '15 minutes to set up' },
      { text: 'Check the asset\'s yield and redemption terms on ' + name + '\'s own page, and note the lock or notice period.', cost: 'no fee to check', time: '10 minutes' },
      weekly('top up by $10-20 or re-mint after a redemption window opens'), holdStep, claim, log];
    else if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('vault') >= 0) steps = [setup,
      { text: 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the vault shares in the wallet.', cost: '$' + capital + ' of capital and ' + gas, time: '15 minutes to set up' },
      { text: 'Read which strategy the vault allocates to on ' + name + '\'s own page, and note its fee and curator.', cost: 'no fee to check', time: '10 minutes' },
      weekly('add $10-20 to the vault or move between its vaults'), holdStep, claim, log];
    else if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('basis') >= 0) steps = [setup,
      { text: 'Deposit $' + capital + ' of USDC as margin on ' + name + ' on ' + chain + ' and keep it as collateral.', cost: '$' + capital + ' of capital and ' + gas, time: '15 minutes to set up' },
      { text: 'Open one small hedge on ' + name + ' worth about $' + Math.round(capital / 5) + ' and close it within the week.', cost: 'about $2 of gas plus the trade fee', time: '15 minutes' },
      weekly('open and close one small position so the account shows real use'), holdStep, claim, log];
    else if (c.indexOf('stable') >= 0) steps = [setup,
      { text: 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.', cost: '$' + capital + ' of capital and ' + gas, time: '15 minutes to set up' },
      { text: 'Hold the stable asset in ' + name + '\'s savings or staking module on ' + chain + ' if it has one.', cost: 'about $2 of gas', time: '10 minutes' },
      weekly('top up by $10-20 or move the balance between its modules'), holdStep, claim, log];
    else if (c.indexOf('insurance') >= 0 || c.indexOf('prediction') >= 0 || c.indexOf('governance') >= 0) steps = [setup,
      { text: 'Use $' + capital + ' to buy cover, place a market position or vote through ' + name + ' on ' + chain + '.', cost: '$' + capital + ' of capital and ' + gas, time: '15 minutes to set up' },
      { text: 'Keep the position or vote receipt in the wallet, and note its expiry or the vote\'s close.', cost: 'no fee to check', time: '5 minutes' },
      weekly('place one more position or vote in a new market'), holdStep, claim, log];
    else steps = [setup,
      { text: 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.', cost: '$' + capital + ' of capital and ' + gas, time: '15 minutes to set up' },
      weekly('make one qualifying action, such as a deposit, a swap or a vote'), holdStep, claim, log];
    return steps.map(stepText);
  }

  function readView() {
    var q = new URLSearchParams(window.location.search);
    var view = q.get('view') || '';
    var hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (hash.get('q')) state.q = hash.get('q');
    if (hash.get('p')) state.selected = hash.get('p');
    if (hash.get('category')) state.category = hash.get('category');
    if (view === 'detail' && ROWS[0]) state.selected = ROWS[0].slug;
    if (view === 'filtered') {
      var counts = {};
      ROWS.forEach(function (r) { counts[r.category] = (counts[r.category] || 0) + 1; });
      var top = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })[0];
      if (top) state.category = top;
    }
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.category !== 'all') p.set('category', state.category);
    if (state.selected) p.set('p', state.selected);
    var next = p.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return ROWS.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (r.tvl < state.tvlMin) return false;
      if (!q) return true;
      return [r.name, r.slug, r.category, r.chains.join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl; bv = b.tvl; }
      else if (key === 'growth') { av = a.chg === null ? -Infinity : a.chg; bv = b.chg === null ? -Infinity : b.chg; }
      else if (key === 'age') { av = a.age === null ? Infinity : a.age; bv = b.age === null ? Infinity : b.age; }
      else { av = a.implied; bv = b.implied; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Launch Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      ));
  }
  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: 'Token Launch Radar' }),
        el('p', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value. The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor. A protocol records no token, never that it has none. Implied value is this entry\'s own claim, from the snapshot\'s figures alone.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      ));
  }
  function top5() {
    return el('section', { class: 'top5' }, ROWS.slice(0, 5).map(function (r) {
      return el('button', { type: 'button', class: 'pick', onclick: function () { openDetail(r.slug); } },
        el('span', { class: 'rank', text: '#' + r.rank }),
        el('b', { text: r.name }),
        el('span', { text: fmtUsd(r.implied) + ' implied' }));
    }));
  }
  function controls() {
    var categories = Array.from(new Set(ROWS.map(function (r) { return r.category; }))).sort();
    var chains = Array.from(new Set(ROWS.reduce(function (a, r) { return a.concat(r.chains); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var cat = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c + ' (' + ROWS.filter(function (r) { return r.category === c; }).length + ')', selected: c === state.category ? 'selected' : null }); }));
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); render(); });
    var chain = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); }));
    chain.addEventListener('change', function () { state.chain = chain.value; render(); });
    var tvl = el('select', { id: 'tvl', 'aria-label': 'Filter by TVL' },
      [['0', 'Any TVL'], ['100000000', 'TVL $100M+'], ['500000000', 'TVL $500M+'], ['1000000000', 'TVL $1B+']].map(function (o) { return el('option', { value: o[0], text: o[1], selected: String(state.tvlMin) === o[0] ? 'selected' : null }); }));
    tvl.addEventListener('change', function () { state.tvlMin = Number(tvl.value); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), cat),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chain),
      el('div', { class: 'field' }, el('label', { for: 'tvl', text: 'TVL' }), tvl),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : LIVE.length + ' live-token protocols' }));
  }
  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } }, label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null));
  }
  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.tvlMin = 0; writeHash(); render(); } })));
    }
    var max = list[0].implied || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.chg === null ? 'n/a' : fmtPct(r.chg);
      var growthClass = r.chg === null ? '' : r.chg >= 0 ? 'pos' : 'neg';
      tbody.appendChild(el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false', tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: r.category + ' on ' + (r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age) }),
        el('td', null, el('div', { class: 'implied' }, el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied / max) * 100)) + '%' })), el('span', { class: 'num', text: fmtUsd(r.implied) }))),
        el('td', null, el('span', { class: 'status', text: 'no token' }))));
    });
    return el('div', { class: 'panel' }, el('div', { class: 'table-wrap' }, el('table', null,
      el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
      el('thead', null, el('tr', null, sortHeader('implied', 'Rank'), sortHeader('name', 'Protocol'), sortHeader('tvl', 'TVL'), sortHeader('growth', '7d'), sortHeader('age', 'Age'), sortHeader('implied', 'Implied value'), el('th', { scope: 'col', text: 'Token' }))),
      tbody)));
  }
  function liveTable() {
    var tbody = el('tbody');
    LIVE.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: r.category + ' on ' + (r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl) }),
        el('td', { class: 'num ' + (r.chg !== null && r.chg >= 0 ? 'pos' : 'neg'), text: fmtPct(r.chg) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))));
    });
    return el('div', { class: 'panel' }, el('div', { class: 'table-wrap' }, el('table', null,
      el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
      el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
      tbody)));
  }
  function modelPanel() {
    var chips = DATA.categories.map(function (c, i) { return { c: c, m: DATA.multiples[i] }; })
      .sort(function (a, b) { return b.m - a.m; }).slice(0, 6)
      .map(function (x) { return el('span', { class: 'multi' }, x.c + ' ', el('b', { text: x.m.toFixed(2) + 'x' })); });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. The category multiple is the median market-cap-to-TVL ratio of the token-bearing protocols in that category, shrunk toward the overall median when the category has few of them. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' }, 'implied = round( tvl_usd x category multiple x (1 + clamp(change_7d, ' + M.growth_floor + ', ' + M.growth_cap + ') / ' + M.growth_divisor + ') x (1 + min(age in years, ' + M.age_years_cap + ') x ' + M.age_per_year + ') )'),
      el('div', { class: 'multis' }, chips),
      el('p', { class: 'sub', text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age scores as new. The early radar is every rankable pre-token protocol below the watchlist floor, and the live-token protocols are set aside with their market caps shown.' }));
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });
  function openDetail(slug) {
    var row = ROWS.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = impliedOf(row);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: row.category + ' on ' + (row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl) })),
        el('div', null, el('span', { text: 'Category multiple' }), el('b', { class: 'num', text: row.mult.toFixed(3) + 'x' })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.chg) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: growthMult(row).toFixed(4) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age) })),
        el('div', null, el('span', { text: 'Age multiplier' }), el('b', { class: 'num', text: ageMult(row).toFixed(4) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied) }))),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))));
    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); }
    else dialog.setAttribute('open', '');
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(top5());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
    if (!window.__shotReady) {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { window.__shotReady = true; });
      });
    }
  }

  readView();
  render();
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && dialog.open) dialog.close(); });
})();
