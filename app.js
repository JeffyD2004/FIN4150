// app.js — reads data/*.csv, runs capstruct.js and fills in the page.
(function () {
  'use strict';
  const C = window.CapStruct;
  const r = C.roundHalfUp;

  // ---------- formatting (round half up on the decimal value) ----------
  const group = (x, d) => r(x, d).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const dollars = x => (x < 0 ? '−$' : '$') + group(Math.abs(x), 0);
  const paren = x => '(' + group(Math.abs(x), 0) + ')';
  const cents = x => '$' + group(x, 2);
  const pct = x => (x == null ? '—' : group(x * 100, 2) + '%');
  const mult = x => (x == null ? 'n/a' : group(x, 2) + '×');
  const shares = x => group(x, 2);

  async function loadCSV(path) {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) throw new Error('Could not load ' + path + ' (' + res.status + ')');
    return C.parseCSV(await res.text());
  }

  function el(tag, attrs, html) {
    const e = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => e.setAttribute(k, v));
    if (html != null) e.innerHTML = html;
    return e;
  }

  // ---------- Firm U and Firm L ----------
  function firmTable(name, f) {
    const st = f.states;
    const cols = st.length;
    const row = (label, fn, cls) =>
      `<tr${cls ? ` class="${cls}"` : ''}><td>${label}</td>${st.map(s => `<td>${fn(s)}</td>`).join('')}</tr>`;
    const stat = (label, value) =>
      `<tr class="stat"><td>${label}</td><td colspan="${cols}">${value}</td></tr>`;
    return `
      <table>
        <caption>${name}</caption>
        <thead><tr><th></th>${st.map(s => `<th>p = ${group(s.probability, 2)}</th>`).join('')}</tr></thead>
        <tbody>
          ${row('Assets', () => dollars(f.assets))}
          ${row('Equity', () => dollars(f.equity))}
          ${row('Probability', s => group(s.probability, 2))}
          ${row('Sales', s => dollars(s.sales))}
          ${row('Oper. costs', s => paren(s.operatingCosts))}
          ${row('EBIT', s => dollars(s.ebit), 'subtotal')}
          ${row('Interest', s => paren(s.interest))}
          ${row('EBT', s => dollars(s.ebt), 'subtotal')}
          ${row('Taxes', s => paren(s.taxes))}
          ${row('Net income', s => dollars(s.netIncome), 'subtotal')}
          ${row('ROE', s => pct(s.roe))}
          ${row('TIE', s => mult(s.tie))}
          ${stat('E(ROE)', pct(f.eRoe))}
          ${stat('σ(ROE)', pct(f.sdRoe))}
          ${stat('CV(ROE)', group(f.cvRoe, 2))}
          ${stat('E(TIE)', mult(f.eTie))}
          ${stat('σ(TIE)', mult(f.sdTie))}
        </tbody>
      </table>`;
  }

  // ---------- CDSS ----------
  function cdssTable(rows, method, bestDebt) {
    const isCase = method === 'caseMethod';
    const head = ['Debt', 'r<sub>d</sub>', 'r<sub>s</sub>', 'Shares repurchased', 'Shares remaining',
                  'EPS (= DPS)', 'TIE', 'Share price', isCase ? 'WACC (book)' : 'WACC (market)'];
    const labels = ['Debt', 'r_d', 'r_s', 'Shares repurchased', 'Shares remaining',
                    'EPS (= DPS)', 'TIE', 'Share price', isCase ? 'WACC (book)' : 'WACC (market)'];
    const body = rows.map(x => {
      const m = x[method];
      const cells = [dollars(x.debt), pct(x.rd), pct(x.rs), shares(m.repurchased), shares(m.remaining),
                     cents(m.eps), mult(x.tie), cents(m.price), pct(m.wacc)];
      return `<tr${x.debt === bestDebt ? ' class="best"' : ''}>${
        cells.map((c, i) => `<td data-label="${labels[i]}">${c}</td>`).join('')}</tr>`;
    }).join('');
    return `<table class="cards"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
  }

  function bestSummary(b) {
    const items = [
      ['Highest share price, case method ($20 buyback)', b.casePrice],
      ['Highest share price, new-price method', b.newPrice],
      ['Lowest WACC, book weights', b.bookWacc],
      ['Lowest WACC, market weights', b.marketWacc],
      ['Highest EPS, case method', b.caseEps],
      ['Highest EPS, new-price method', b.newEps],
    ];
    const priceWacc = [b.casePrice, b.newPrice, b.bookWacc, b.marketWacc];
    const agree = priceWacc.every(d => d === priceWacc[0]);
    return `<strong>${agree
      ? `Price and WACC agree: ${dollars(priceWacc[0])} of debt gives the highest price under both methods and the lowest WACC under both sets of weights.`
      : 'Price and WACC do not all point to the same amount of debt:'}</strong>
      <ul>${items.map(([k, v]) => `<li>${k}: ${dollars(v)}</li>`).join('')}</ul>`;
  }

  async function main() {
    try {
      const [assumptions, firms, scenarios, cdssRows, schedule] = await Promise.all([
        loadCSV('data/assumptions.csv'), loadCSV('data/example_firms.csv'),
        loadCSV('data/ebit_scenarios.csv'), loadCSV('data/cdss.csv'), loadCSV('data/banker_schedule.csv'),
      ]);
      const T = C.toLookup(assumptions, 'assumption').tax_rate;
      const ex = C.toLookup(firms, 'item');
      const sc = scenarios.map(s => ({ probability: C.num(s.probability), sales: C.num(s.sales), operating_costs: C.num(s.operating_costs) }));
      const cdss = C.toLookup(cdssRows, 'item');
      const sched = schedule.map(s => ({ debt: C.num(s.debt), cost_of_debt: C.num(s.cost_of_debt), cost_of_equity: C.num(s.cost_of_equity) }));

      // Firm U and Firm L
      const u = C.exampleFirm(sc, ex.total_assets, 0, ex.interest_rate, T);
      const l = C.exampleFirm(sc, ex.total_assets, ex.firm_l_debt, ex.interest_rate, T);
      document.getElementById('firms-note').textContent =
        `Both firms have ${dollars(ex.total_assets)} of assets and a ${pct(T)} tax rate. Firm L has ${dollars(ex.firm_l_debt)} of debt at ${pct(ex.interest_rate)}. ROE uses book equity (assets − debt). Firm U has no interest, so its TIE is n/a.`;
      document.getElementById('firm-u').innerHTML = firmTable('Firm U (no debt)', u);
      document.getElementById('firm-l').innerHTML = firmTable(`Firm L (${dollars(ex.firm_l_debt)} debt)`, l);

      // CDSS
      const a = C.cdssAnalysis(sched, cdss, T);
      document.getElementById('p0').textContent = cents(cdss.share_price);
      document.getElementById('cdss-note').textContent =
        `EBIT = ${dollars(cdss.sales)} × (1 − ${pct(cdss.variable_cost_rate)}) − ${dollars(cdss.fixed_costs)} = ${dollars(a.ebit)}, the same at every amount of debt. ` +
        `${group(cdss.shares_outstanding, 0)} shares before the buyback, ${dollars(cdss.total_assets)} of book assets, ${pct(T)} tax. All earnings are paid out, so dividends per share = EPS and g = 0. Highlighted rows have the highest share price.`;
      if (!a.zeroDebtCheck.ok) {
        const z = document.getElementById('zero-check');
        z.hidden = false;
        z.textContent = `Check failed: with no debt, EPS / r_s gives ${a.zeroDebtCheck.price == null ? 'no price (no $0 row)' : cents(a.zeroDebtCheck.price)}, but today's price in cdss.csv is ${cents(a.zeroDebtCheck.expected)}. The schedule and CDSS's data don't fit together.`;
      }
      document.getElementById('case-table').innerHTML = cdssTable(a.rows, 'caseMethod', a.best.casePrice);
      document.getElementById('new-table').innerHTML = cdssTable(a.rows, 'newPrice', a.best.newPrice);
      document.getElementById('best').innerHTML = bestSummary(a.best);
    } catch (err) {
      const e = document.getElementById('load-error');
      e.hidden = false;
      e.textContent = err.message + '. Open the app from a web server (GitHub Pages, or `python3 -m http.server`), not by double-clicking index.html.';
    }
  }

  main();
})();
