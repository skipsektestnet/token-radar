// Token Radar's plain dashboard. It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, filters, a per-protocol detail view with the model's own inputs,
// the live-token set and the model itself. No network: every byte it shows is in data.js.
//
// The page recomputes each row from the fitted regression's breakdown (impliedOf) and the farm
// plan from the protocol's category, chains, TVL and age (farmSteps), the same derivation
// main.ts writes to board.json — so the page's code and the board's data are visibly the
// same arithmetic.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', watchlistOnly: false, tab: 'board', sort: 'implied', dir: -1, selected: null };

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return 'x' + n.toFixed(2); }
  function fmtRatio(n) { return n.toLocaleString('en-US') + 'x'; }
  function verdictClass(v) { return v === 'Strong' ? 'strong' : v === 'Worth a look' ? 'worth' : 'thin'; }

  // The model in one function: the radar-3 fitted log-linear model. The
  // row carries its own breakdown in log points (intercept plus one part
  // per term); the implied value is exp of their sum. Mirrors
  // lib/model.ts predictRegressionValue, which sums the same rounded parts.
  function impliedOf(row) {
    var b = row.regression || { intercept: 0, log_tvl: 0, growth: 0, log_age: 0, chains: 0, category_effect: 0 };
    var logValue = b.intercept + b.log_tvl + b.growth + b.log_age + b.chains + b.category_effect;
    return Math.max(1, Math.round(Math.exp(logValue)));
  }
  function fmtLog(n) { return (n >= 0 ? '+' : '') + n.toFixed(2); }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan, derived exactly as lib/model.ts farmSteps does: category picks the action,
  // TVL picks the capital, age picks the hold. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('risk') >= 0 || c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the vault shares.';
    if (c.indexOf('basis trading') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small delta-neutral basis position.';
    if (c.indexOf('cedefi') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + "'s CeDeFi yield product on " + chain + ' and keep the position open.';
    if (c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of collateral to ' + name + ' on ' + chain + ' and borrow a small amount against it.';
    if (c.indexOf('cdp') >= 0) return 'Lock $' + capital + ' of collateral in ' + name + ' on ' + chain + ' and mint its stable asset against it.';
    if (c.indexOf('payment') >= 0) return 'Route $' + capital + ' of payments through ' + name + ' on ' + chain + ' and keep the receipts.';
    if (c === 'chain') return 'Bridge $' + capital + ' to ' + chain + ' and use one core app on the chain through ' + name + '.';
    if (c.indexOf('staking pool') >= 0 || c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake $' + capital + " of the chain's staking asset through " + name + ' and keep the receipt token.';
    if (c.indexOf('governance') >= 0) return 'Deposit $' + capital + ' into ' + name + ' on ' + chain + ' and vote or lock in its governance.';
    if (c.indexOf('stablecoin wrapper') >= 0 || c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.';
    if (c.indexOf('lend') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('yield') >= 0) return 'Deposit $' + capital + ' into ' + name + "'s main yield vault on " + chain + ' and keep the shares.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + " of the protocol's yield-bearing asset on " + chain + ' and hold it.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page from its own site and claim only from the link it publishes; never pay anyone to claim, and never click a claim link from a message.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('wl')) state.watchlistOnly = params.get('wl') === '1';
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watchlistOnly) params.set('wl', '1');
    if (state.tab !== 'board') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchlistOnly && !r.is_watchlist) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'odds') { av = a.launch_odds ? a.launch_odds.odds : 0; bv = b.launch_odds ? b.launch_odds.odds : 0; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  // The integrity strip: what the snapshot is, who was left out and why, and how the model
  // held up out of sample. Every number comes from DATA.validation, computed by lib/validate.ts.
  function integrityStrip() {
    var v = DATA.validation;
    if (!v) return null;
    var ex = v.excluded;
    var exTotal = ex.by_category + ex.versioned + ex.wrapped + ex.exchange;
    var terms = 'dropping a term raises the held-out error in ' + v.terms_help.category + '/4 folds (category), ' +
      v.terms_help.maturity + '/4 (age), ' + v.terms_help.breadth + '/4 (chains), ' + v.terms_help.growth + '/4 (growth)';
    return el('section', { class: 'strip', 'aria-label': 'How this board was checked' },
      el('div', null, el('b', { text: 'Snapshot ' + v.as_of + ' · DefiLlama protocol index · ' + v.protocols_total + ' protocols' })),
      el('div', null, el('span', { text: v.live_used + ' live-token protocols priced the board; ' + exTotal + ' pre-token protocols excluded (' + ex.by_category + ' by category, ' + ex.versioned + ' versioned, ' + ex.wrapped + ' wrapped/staked, ' + ex.exchange + ' exchange)' })),
      el('div', null, el('span', { text: 'Held-out, 2 splits x 2 folds: full model median |log err| ' + v.full_median_log_err.toFixed(2) + ' vs baseline ' + v.baseline_median_log_err.toFixed(2) + ' — ' + terms + '.' }))
    );
  }

  function lede() {
    var h1 = el('h1');
    h1.appendChild(document.createTextNode(DATA.watchlist_size + ' watchlist protocols, ranked by '));
    h1.appendChild(el('em', { text: 'implied value' }));
    return el('section', { class: 'lede' },
      el('div', null, h1,
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' more pre-token protocols below that floor — every rankable one in the snapshot. Implied value is this entry\u2019s model, not a promise and not a prediction that a token will launch.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), el('small', { text: 'every one, ranked' })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) }), el('small', { text: DATA.early_size + ' early rows below the floor' })),
        el('div', { class: 'fact' }, el('span', { text: 'Total implied value' }), el('b', { text: fmtUsd(DATA.total_implied_usd) }), el('small', { text: 'sum of the whole board' })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }), el('small', { text: 'their market caps are facts, not models' }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSelect = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSelect.addEventListener('change', function () { state.category = catSelect.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var wl = el('input', { type: 'checkbox', id: 'wl', checked: state.watchlistOnly ? 'checked' : null, 'aria-label': 'Watchlist only' });
    wl.addEventListener('change', function () { state.watchlistOnly = wl.checked; writeHash(); render(); });
    var sortSelect = el('select', { id: 'sort', 'aria-label': 'Sort the board' },
      [['implied', 'Implied value'], ['tvl', 'TVL'], ['growth', '7-day growth'], ['age', 'Age'], ['odds', 'Launch odds'], ['name', 'Name']].map(function (o) {
        return el('option', { value: o[0], text: o[1], selected: state.sort === o[0] ? 'selected' : null });
      })
    );
    sortSelect.addEventListener('change', function () { state.sort = sortSelect.value; state.dir = state.sort === 'name' || state.sort === 'age' ? 1 : -1; writeHash(); render(); });
    function tabBtn(tab, label) {
      return el('button', { type: 'button', 'aria-pressed': state.tab === tab ? 'true' : 'false', text: label, onclick: function () { state.tab = tab; writeHash(); render(); } });
    }
    var shown = state.tab === 'board' ? filteredRows().length + ' rows shown' : state.tab === 'live' ? DATA.live.length + ' live-token protocols' : 'the model, in the open';
    return el('div', { class: 'controls' },
      el('div', { class: 'field grow' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSelect),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('label', { for: 'sort', text: 'Sort by' }), sortSelect),
      el('label', { class: 'field check', for: 'wl' }, wl, el('span', { text: 'Watchlist only' })),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'View' }), el('div', { class: 'tabs' }, tabBtn('board', 'Board'), tabBtn('live', 'Live token'), tabBtn('model', 'Model'))),
      el('span', { class: 'count', text: shown })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(filteredRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchlistOnly = false; writeHash(); render(); } })
      ));
    }
    var max = 1;
    list.forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var nameCell = el('div', { class: 'name' }, el('b', { text: r.name }));
      if (r.is_watchlist) nameCell.appendChild(el('span', { class: 'badge', text: 'WATCHLIST' }));
      nameCell.appendChild(el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') : 'an unnamed chain') }));
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, nameCell),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'verdict v-' + verdictClass(r.farm_verdict.verdict), text: r.farm_verdict.verdict }), el('div', { class: 'sub', text: fmtUsd(r.farm_verdict.total_cost_usd) + ' to farm' })),
        el('td', { class: 'num', text: fmtMult(r.category_multiple) }),
        el('td', null, el('span', { class: 'num', text: r.launch_odds ? Math.round(r.launch_odds.odds * 100) + '%' : 'n/a' }), el('div', { class: 'sub', text: r.launch_odds ? r.launch_odds.live_peers + ' of ' + r.launch_odds.total_peers + ' peers launched' : '' })),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model breakdown and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Farm verdict' }),
            el('th', { scope: 'col', text: 'Cat. x' }),
            sortHeader('odds', 'Launch odds'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r, i) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: String(i + 1) }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.mcap_per_tvl === null ? 'n/a' : fmtMult(r.mcap_per_tvl) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking — and their market-cap-to-TVL ratios are what price the board.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: '#' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Mcap / TVL' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  // The held-out validation table: one row per fold, median |log(pred/actual)| for the full
  // model, the TVL-only baseline and each ablation. Lower is better; 0 is exact.
  function validationSection() {
    var v = DATA.validation;
    if (!v) return null;
    var vtbody = el('tbody');
    v.per_fold.forEach(function (f) {
      vtbody.appendChild(el('tr', null,
        el('td', { text: f.split === 'hash-parity' ? 'Slug-hash parity' : 'TVL median' }),
        el('td', { class: 'num', text: String(f.fold + 1) }),
        el('td', { class: 'num', text: String(f.train_n) + ' / ' + String(f.test_n) }),
        el('td', { class: 'num', text: f.full.median_log_err.toFixed(2) }),
        el('td', { class: 'num', text: f.baseline.median_log_err.toFixed(2) }),
        el('td', { class: 'num', text: f.no_growth.median_log_err.toFixed(2) }),
        el('td', { class: 'num', text: f.no_maturity.median_log_err.toFixed(2) }),
        el('td', { class: 'num', text: f.no_breadth.median_log_err.toFixed(2) }),
        el('td', { class: 'num', text: f.no_category.median_log_err.toFixed(2) })
      ));
    });
    return [
      el('h3', { text: 'Held-out validation — does the model predict anything?' }),
      el('p', { class: 'sub', text: 'Tested on the snapshot\u2019s ' + v.live_used + ' live-token protocols, which the board never ranks. Each split fits the ridge regression on one half and scores the other, then swaps, so every live protocol is held out twice. On average the full model scores ' + v.full_median_log_err.toFixed(2) + ' against the TVL-only baseline\u2019s ' + v.baseline_median_log_err.toFixed(2) + '. The ridge penalty was ' + (v.constants_kept ? 'kept' : 'changed') + ': ' + v.keep_reason + '.' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Split' }), el('th', { scope: 'col', text: 'Fold' }), el('th', { scope: 'col', text: 'Train / test' }), el('th', { scope: 'col', text: 'Full' }), el('th', { scope: 'col', text: 'Baseline' }), el('th', { scope: 'col', text: 'No growth' }), el('th', { scope: 'col', text: 'No age' }), el('th', { scope: 'col', text: 'No chains' }), el('th', { scope: 'col', text: 'No category' }))),
          vtbody
        )
      ),
      el('p', { class: 'note', html: '<b>Farm verdicts.</b> Total cost = capital ($50–$250 by TVL tier) + setup gas ($4, or $8 where the capital is $150 or more) + $2 per week of hold; checking or claiming costs nothing. Value per dollar = implied value / total cost. <b>Strong</b>: at least 1,000,000x and implied value of $10M or more. <b>Worth a look</b>: at least 100,000x. Otherwise <b>Thin</b>. A verdict is the model\u2019s own claim, not a promise that a token will launch.' })
    ];
  }

  function modelPanel() {
    var m = DATA.model;
    var mults = DATA.multiples;
    var fit = DATA.regression_fit;
    var cats = Object.keys(mults.by_category).sort();
    var tbody = el('tbody');
    cats.forEach(function (c) {
      tbody.appendChild(el('tr', null,
        el('td', { text: c }),
        el('td', { class: 'num', text: fmtMult(mults.by_category[c]) }),
        el('td', { class: 'num', text: String(mults.live_counts[c] || 0) })
      ));
    });
    tbody.appendChild(el('tr', null,
      el('td', { text: 'All other categories (global median)' }),
      el('td', { class: 'num', text: fmtMult(mults.global) }),
      el('td', { class: 'num', text: '—' })
    ));
    var children = [
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'One fitted model scores every row, from the snapshot\u2019s own figures. No protocol name is special-cased and no row is hand-picked. The model is a ridge regression of log market cap on log TVL, seven-day growth, log age and chain count, plus a per-category effect — fitted on the snapshot\u2019s live-token protocols, the same 128 the validation scores. It replaces the earlier TVL-times-multiple formula because it predicts held-out market caps better (median |log err| 1.27 against 1.63 before, same four folds).' }),
      el('div', { class: 'formula' },
        'log(implied) = ' + (fit ? fit.intercept.toFixed(2) : '—') + ' + ' + (fit ? (fit.beta[0] / fit.stds[0]).toFixed(2) : '—') + ' x log(tvl_usd) + ' + (fit ? (fit.beta[1] / fit.stds[1]).toFixed(2) : '—') + ' x growth + ' + (fit ? (fit.beta[2] / fit.stds[2]).toFixed(2) : '—') + ' x log(age_days + 1) + ' + (fit ? (fit.beta[3] / fit.stds[3]).toFixed(2) : '—') + ' x chains + category effect'
      ),
      el('p', { class: 'sub', text: 'Ridge penalty \u03bb = ' + (fit ? fit.lambda : '—') + ', category shrinkage weight = ' + (fit ? fit.shrink_k : '—') + '. The penalty was chosen on the held-out grid (see validation below); the plain least-squares fit was rejected because its coefficients swing wildly across folds (growth ran from -10.8 to +1.2), while the ridge fit keeps the TVL elasticity inside 0.46–0.75 on every fold.' })
    ];
    if (fit) {
      var coefBody = el('tbody');
      var names = ['log TVL (elasticity)', '7-day growth (per +100 pts)', 'log age (per log point)', 'Chain count (per chain)'];
      for (var i = 0; i < 4; i++) {
        coefBody.appendChild(el('tr', null,
          el('td', { text: names[i] }),
          el('td', { class: 'num', text: (fit.beta[i] / fit.stds[i]).toFixed(3) }),
          el('td', { class: 'num', text: fit.beta[i].toFixed(3) })
        ));
      }
      children.push(
        el('h3', { text: 'Fitted coefficients' }),
        el('div', { class: 'table-wrap' },
          el('table', null,
            el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Term' }), el('th', { scope: 'col', text: 'Raw effect' }), el('th', { scope: 'col', text: 'Standardized \u03b2' }))),
            coefBody
          )
        )
      );
      var effCats = Object.keys(fit.cat_effects).sort(function (a, b) { return fit.cat_effects[b] - fit.cat_effects[a]; });
      var effBody = el('tbody');
      effCats.forEach(function (c) {
        effBody.appendChild(el('tr', null,
          el('td', { text: c }),
          el('td', { class: 'num', text: fmtLog(fit.cat_effects[c]) })
        ));
      });
      children.push(
        el('h3', { text: 'Category effects (log points, shrunk toward zero)' }),
        el('p', { class: 'sub', text: 'A category whose live tokens trade rich against the regression\u2019s prediction earns a positive effect; one that trades thin earns a negative one. Effects are shrunk by live count, so a category with few live tokens cannot shout.' }),
        el('div', { class: 'table-wrap' },
          el('table', null,
            el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Effect' }))),
            effBody
          )
        )
      );
    }
    children.push(
      el('h3', { text: 'Category multiples, from the snapshot\u2019s live tokens (audit trail)' }),
      el('p', { class: 'sub', text: 'The earlier radar-2 multiple is kept as an audit trail: the median market-cap-to-TVL ratio of the live-token protocols in each category. It no longer sets the implied value, but it is still shown on every row.' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Multiple' }), el('th', { scope: 'col', text: 'Live tokens counted' }))),
          tbody
        )
      )
    );
    if (DATA.launch_odds) {
      var oddsBody = el('tbody');
      var oddsCats = Object.keys(DATA.launch_odds.by_category).sort(function (a, b) { return DATA.launch_odds.by_category[b].odds - DATA.launch_odds.by_category[a].odds; });
      oddsCats.forEach(function (c) {
        var o = DATA.launch_odds.by_category[c];
        oddsBody.appendChild(el('tr', null,
          el('td', { text: c }),
          el('td', { class: 'num', text: Math.round(o.odds * 100) + '%' }),
          el('td', { class: 'num', text: o.live_peers + ' of ' + o.total_peers })
        ));
      });
      children.push(
        el('h3', { text: 'Launch odds from the peers\u2019 record' }),
        el('p', { class: 'sub', text: 'For each category, the share of the snapshot\u2019s protocols that already carry a token — smoothed toward the global share (' + Math.round(DATA.launch_odds.global.odds * 100) + '% of ' + DATA.launch_odds.global.total_peers + ' protocols) with a prior weight of 5, so a category with one or two peers does not read 0% or 100%. The odds are displayed on the board; they do not enter the implied value, which stays the fitted value of a launch at peer multiples.' }),
        el('div', { class: 'table-wrap' },
          el('table', null,
            el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Odds' }), el('th', { scope: 'col', text: 'Peers launched' }))),
            oddsBody
          )
        )
      );
    }
    var val = validationSection();
    if (val) val.forEach(function (node) { children.push(node); });
    children.push(
      el('p', { class: 'note', html: '<b>What the numbers mean.</b> TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed — the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. The TVL elasticity is below one (about 0.48): market cap grows with TVL, but less than proportionally, which is what the live tokens show. The category effect is the part the four features cannot explain; the launch odds are the peers\u2019 record, not a fitted prediction.' }),
      el('p', { class: 'note', html: '<b>What this board does not claim.</b> A protocol on it “records no token” in DefiLlama\u2019s record — that is not proof it has none. Implied value is what a token would be worth if the protocol\u2019s record stayed as it is; it does not predict whether or when a token is issued. Wrapped, staked, bridged and exchange products are excluded, because they are not launches of their own.' }),
      el('p', { class: 'note', html: '<b>How to use it.</b> Open a row for its breakdown and farm plan. The plan\u2019s action follows the protocol\u2019s category, its capital follows its TVL tier ($50–$250), its hold follows its age (30–60 days). Never pay anyone to claim an airdrop.' })
    );
    return el('section', { class: 'panel model' }, children);
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = impliedOf(row);
    var b = row.regression || { intercept: 0, log_tvl: 0, growth: 0, log_age: 0, chains: 0, category_effect: 0 };
    var parts = [['Intercept', b.intercept], ['Log TVL', b.log_tvl], ['Growth', b.growth], ['Log age', b.log_age], ['Chains', b.chains], ['Category effect', b.category_effect]];
    var maxAbs = 1;
    parts.forEach(function (p) { if (Math.abs(p[1]) > maxAbs) maxAbs = Math.abs(p[1]); });
    function bRow(label, value, frac) {
      return el('div', { class: 'row' },
        el('span', { text: label }),
        el('div', { class: 'track', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(2, Math.round(frac * 100)) + '%' })),
        el('span', { text: value })
      );
    }
    var comps = DATA.live.filter(function (r) { return r.category === row.category; }).slice(0, 3);
    var compText = comps.length > 0
      ? 'Live tokens in ' + (row.category || 'this category') + ' trade at ' + comps.map(function (r) { return r.name + ' ' + fmtMult(r.mcap_per_tvl); }).join(', ') + ' of TVL — the median of all of them is the ' + fmtMult(row.category_multiple) + ' the audit trail carries.'
      : 'No live-token protocol in ' + (row.category || 'this category') + ' sits in the snapshot\u2019s top live set, so the audit trail uses the global median multiple of ' + fmtMult(DATA.multiples.global) + '.';
    var oddsText = row.launch_odds
      ? ' In this category ' + row.launch_odds.live_peers + ' of ' + row.launch_odds.total_peers + ' protocols already carry a token, so the launch odds read ' + Math.round(row.launch_odds.odds * 100) + '% (smoothed toward the global rate).'
      : '';
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'rank', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.is_watchlist ? '  ·  Watchlist' : '  ·  Early radar') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value — the breakdown' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Category effect' }), el('b', { class: 'num', text: fmtLog(b.category_effect) + ' log pts' })),
        el('div', null, el('span', { text: 'Launch odds (peers)' }), el('b', { class: 'num', text: row.launch_odds ? Math.round(row.launch_odds.odds * 100) + '% — ' + row.launch_odds.live_peers + ' of ' + row.launch_odds.total_peers : 'n/a' })),
        el('div', { class: 'wide' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('div', { class: 'breakdown' },
        bRow('Intercept', fmtLog(b.intercept) + ' log pts', Math.abs(b.intercept) / maxAbs),
        bRow('Log TVL', fmtLog(b.log_tvl) + ' log pts', Math.abs(b.log_tvl) / maxAbs),
        bRow('Growth', fmtLog(b.growth) + ' log pts', Math.abs(b.growth) / maxAbs),
        bRow('Log age', fmtLog(b.log_age) + ' log pts', Math.abs(b.log_age) / maxAbs),
        bRow('Chains', fmtLog(b.chains) + ' log pts', Math.abs(b.chains) / maxAbs),
        bRow('Category effect', fmtLog(b.category_effect) + ' log pts', Math.abs(b.category_effect) / maxAbs),
        bRow('Implied value (exp of the sum)', fmtUsd(row.implied_value_usd), 1)
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board — the data would be stale.') + ' ' + compText + oddsText + ' This is an estimate, not a price, and not a prediction that a token will launch.' })
    ));
    var fv = row.farm_verdict;
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('p', { class: 'sub', text: 'Farm verdict: ' + fv.verdict + ' — ' + fmtUsd(fv.total_cost_usd) + ' all-in for one position, or ' + fmtRatio(fv.value_per_dollar) + ' of implied value per dollar spent.' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    var strip = integrityStrip();
    if (strip) shell.appendChild(strip);
    shell.appendChild(lede());
    shell.appendChild(controls());
    if (state.tab === 'board') shell.appendChild(boardTable());
    else if (state.tab === 'live') shell.appendChild(liveTable());
    else shell.appendChild(modelPanel());
    shell.appendChild(el('p', { class: 'foot', html: '<b>Token Radar</b> · Snapshot ' + DATA.as_of + ' · DefiLlama protocol index · ' + DATA.model_version + ' model · Implied values are this entry\u2019s own claim, never a price. A protocol “records no token” when DefiLlama\u2019s record carries none.' }));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
