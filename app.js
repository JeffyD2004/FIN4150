// app.js — reads data/*.csv, runs capstruct.js and fills in the page.
(function () {
  'use strict';
  const C = window.CapStruct;
  const r = C.roundHalfUp;
  const $ = id => document.getElementById(id);

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

  // ---------- CDSS: the two cards for the slider's amount ----------
  function stakeText(s) {
    if (s.status === 'must-sell') {
      return '<span class="warn-inline">Management would have to sell: the buyback is larger than all outside shares.</span>';
    }
    if (s.status === 'all-outside-gone') {
      return '100.00% <span class="small">(no outside shareholders would be left)</span>';
    }
    return pct(s.value);
  }

  function methodCard(title, subtitle, x, m, waccLabel, isBest) {
    const line = (k, v) => `<div class="line"><span>${k}</span><span>${v}</span></div>`;
    return `
      <h4>${title}</h4>
      <p class="small">${subtitle}</p>
      <div class="price${isBest ? ' best-price' : ''}">${cents(m.price)}<span class="small">share price${isBest ? ' · highest' : ''}</span></div>
      ${line('Shares repurchased', shares(m.repurchased))}
      ${line('Shares remaining', shares(m.remaining))}
      ${line('EPS', cents(m.eps))}
      ${line('Dividends per share', cents(m.dps))}
      ${line('TIE', mult(x.tie))}
      ${line(waccLabel, pct(m.wacc))}
      ${line("Management's share", stakeText(m.mgmtStake))}`;
  }

  // ---------- CDSS: full schedule tables ----------
  function cdssTable(rows, method, bestDebt, selectedDebt) {
    const isCase = method === 'caseMethod';
    const head = ['Debt', 'r<sub>d</sub>', 'r<sub>s</sub>', 'Shares repurchased', 'Shares remaining',
                  'EPS (= DPS)', 'TIE', 'Share price', isCase ? 'WACC (book)' : 'WACC (market)'];
    const labels = ['Debt', 'r_d', 'r_s', 'Shares repurchased', 'Shares remaining',
                    'EPS (= DPS)', 'TIE', 'Share price', isCase ? 'WACC (book)' : 'WACC (market)'];
    const body = rows.map(x => {
      const m = x[method];
      const cells = [dollars(x.debt), pct(x.rd), pct(x.rs), shares(m.repurchased), shares(m.remaining),
                     cents(m.eps), mult(x.tie), cents(m.price), pct(m.wacc)];
      const cls = [x.debt === bestDebt ? 'best' : '', x.debt === selectedDebt ? 'selected' : ''].join(' ').trim();
      return `<tr${cls ? ` class="${cls}"` : ''}>${
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

      // ----- Firm U and Firm L, with the Firm L debt slider -----
      $('firms-note').textContent =
        `Both firms have ${dollars(ex.total_assets)} of assets and a ${pct(T)} tax rate. In the case, Firm L has ${dollars(ex.firm_l_debt)} of debt at ${pct(ex.interest_rate)}. ROE uses book equity (assets − debt). Firm U has no interest, so its TIE is n/a.`;
      $('firm-l-rate-note').textContent =
        `The interest rate is held at ${pct(ex.interest_rate)} at every amount, so the slider shows what debt alone does to Firm L's return and risk, not how lenders would respond to more borrowing.`;
      const u = C.exampleFirm(sc, ex.total_assets, 0, ex.interest_rate, T);
      $('firm-u').innerHTML = firmTable('Firm U (no debt)', u);

      const firmSlider = $('firm-l-debt');
      firmSlider.min = 0;
      firmSlider.max = ex.slider_max;
      firmSlider.step = ex.slider_step;
      firmSlider.value = ex.firm_l_debt;
      function renderFirmL() {
        const d = Number(firmSlider.value);
        $('firm-l-debt-out').textContent = dollars(d) + (d === ex.firm_l_debt ? ' (case)' : '');
        const l = C.exampleFirm(sc, ex.total_assets, d, ex.interest_rate, T);
        $('firm-l').innerHTML = firmTable(`Firm L (${dollars(d)} debt)`, l);
      }
      firmSlider.addEventListener('input', renderFirmL);
      $('btn-case').addEventListener('click', () => { firmSlider.value = ex.firm_l_debt; renderFirmL(); });
      renderFirmL();

      // ----- CDSS -----
      const a = C.cdssAnalysis(sched, cdss, T);
      $('p0').textContent = cents(cdss.share_price);
      $('cdss-note').textContent =
        `EBIT = ${dollars(cdss.sales)} × (1 − ${pct(cdss.variable_cost_rate)}) − ${dollars(cdss.fixed_costs)} = ${dollars(a.ebit)}, the same at every amount of debt. ` +
        `${group(cdss.shares_outstanding, 0)} shares before the buyback, ${dollars(cdss.total_assets)} of book assets, ${pct(T)} tax. Management owns ${pct(cdss.management_share)} and doesn't sell. All earnings are paid out, so dividends per share = EPS and g = 0.`;
      if (!a.zeroDebtCheck.ok) {
        const z = $('zero-check');
        z.hidden = false;
        z.textContent = `Check failed: with no debt, EPS / r_s gives ${a.zeroDebtCheck.price == null ? 'no price (no $0 row)' : cents(a.zeroDebtCheck.price)}, but today's price in cdss.csv is ${cents(a.zeroDebtCheck.expected)}. The schedule and CDSS's data don't fit together.`;
      }

      // The slider moves over the schedule's rows, so it stops only at the banker's amounts.
      const cdssSlider = $('cdss-debt');
      cdssSlider.max = a.rows.length - 1;
      cdssSlider.value = 0;
      $('cdss-ticks').innerHTML = a.rows.map(x => `<span>${x.debt >= 1e6 ? '$' + group(x.debt / 1e6, 0) + 'M' : x.debt === 0 ? '$0' : '$' + group(x.debt / 1000, 0) + 'k'}</span>`).join('');

      function renderCdss() {
        const x = a.rows[Number(cdssSlider.value)];
        $('cdss-debt-out').textContent = dollars(x.debt);
        $('card-case').innerHTML = methodCard(
          `Case method: buy back at ${cents(cdss.share_price)}`, 'Questions d(3)–d(4)',
          x, x.caseMethod, 'WACC (book weights)', x.debt === a.best.casePrice);
        $('card-new').innerHTML = methodCard(
          'New-price method', 'Buy back at the price after the announcement',
          x, x.newPrice, 'WACC (market weights)', x.debt === a.best.newPrice);
        $('case-table').innerHTML = cdssTable(a.rows, 'caseMethod', a.best.casePrice, x.debt);
        $('new-table').innerHTML = cdssTable(a.rows, 'newPrice', a.best.newPrice, x.debt);
      }
      function goTo(target, what) {
        cdssSlider.value = a.rows.findIndex(x => x.debt === target.debt);
        const note = $('button-note');
        note.hidden = target.agree;
        if (!target.agree) {
          note.textContent = `${what}: the case method picks ${dollars(target.caseDebt)} and the new-price method picks ${dollars(target.newDebt)}. The slider shows the case method's amount.`;
        }
        renderCdss();
      }
      cdssSlider.addEventListener('input', () => { $('button-note').hidden = true; renderCdss(); });
      $('btn-best-price').addEventListener('click', () => goTo(C.buttonTarget(a.best.casePrice, a.best.newPrice), 'Highest share price'));
      $('btn-best-eps').addEventListener('click', () => goTo(C.buttonTarget(a.best.caseEps, a.best.newEps), 'Highest EPS'));
      renderCdss();
      $('best').innerHTML = bestSummary(a.best);
    } catch (err) {
      const e = $('load-error');
      e.hidden = false;
      e.textContent = err.message + '. Open the app from a web server (GitHub Pages, or `python3 -m http.server`), not by double-clicking index.html.';
    }
  }

  main();

  // Progressive web app: the service worker lets the app install and work offline.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service worker not registered:', err));
    });
  }
})();
