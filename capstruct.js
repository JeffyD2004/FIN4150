// capstruct.js — the finance math for the AGE capital structure app.
// Plain functions only: nothing here touches the page, so every number can be
// checked with Node, e.g.  node -e "const c=require('./capstruct.js'); ..."

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CapStruct = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- CSV parsing ----------

  // Parses a simple CSV (no quoted commas) into an array of row objects.
  function parseCSV(text) {
    const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim() !== '');
    const headers = lines[0].split(',').map(h => h.trim());
    return lines.slice(1).map(line => {
      const cells = line.split(',');
      const row = {};
      headers.forEach((h, i) => { row[h] = (cells[i] ?? '').trim(); });
      return row;
    });
  }

  // Turns blank cells into null and everything else into a number.
  function num(s) {
    return s === '' || s == null ? null : Number(s);
  }

  // Item/value files (assumptions, example_firms, cdss) -> { item: number }.
  function toLookup(rows, keyField) {
    const out = {};
    rows.forEach(r => { out[r[keyField]] = num(r.value); });
    return out;
  }

  // ---------- Rounding and statistics ----------

  // Round half up on the decimal value. toFixed rounds the binary value and
  // shows 14.025% as 14.02% and $3.495 as $3.49; this shows 14.03% and $3.50.
  function roundHalfUp(x, d) {
    const f = 10 ** d;
    return Math.round(Number((x * f).toPrecision(12))) / f;
  }

  function expected(probs, values) {
    return probs.reduce((s, p, i) => s + p * values[i], 0);
  }

  function stdDev(probs, values) {
    const m = expected(probs, values);
    return Math.sqrt(probs.reduce((s, p, i) => s + p * (values[i] - m) ** 2, 0));
  }

  // ---------- Firm U and Firm L (question c) ----------

  // One firm's income statements and ratios across the EBIT scenarios.
  function exampleFirm(scenarios, totalAssets, debt, rate, taxRate) {
    const equity = totalAssets - debt;
    const probs = scenarios.map(s => s.probability);
    const states = scenarios.map(s => {
      const ebit = s.sales - s.operating_costs;
      const interest = rate * debt;
      const ebt = ebit - interest;
      const taxes = taxRate * ebt;
      const netIncome = ebt - taxes;
      return {
        probability: s.probability,
        sales: s.sales,
        operatingCosts: s.operating_costs,
        ebit, interest, ebt, taxes, netIncome,
        roe: netIncome / equity,
        tie: interest > 0 ? ebit / interest : null,   // null = "n/a" (no interest)
      };
    });
    const roes = states.map(s => s.roe);
    const eRoe = expected(probs, roes);
    const sdRoe = stdDev(probs, roes);
    const hasDebt = debt > 0;
    const ties = states.map(s => s.tie);
    const eTie = hasDebt ? expected(probs, ties) : null;
    const sdTie = hasDebt ? stdDev(probs, ties) : null;
    return {
      assets: totalAssets, equity, debt, states,
      eRoe, sdRoe, cvRoe: sdRoe / eRoe,
      eTie, sdTie, cvTie: hasDebt ? sdTie / eTie : null,
    };
  }

  // ---------- CDSS ----------

  function cdssEbit(cdss) {
    return cdss.sales * (1 - cdss.variable_cost_rate) - cdss.fixed_costs;
  }

  // One row of the banker's schedule, both buyback methods.
  //   T = tax rate, D = debt, n = shares before buyback, P0 = today's price, A = book assets
  function cdssRow(row, cdss, taxRate) {
    const T = taxRate;
    const D = row.debt;
    const rd = row.cost_of_debt;            // null at $0
    const rs = row.cost_of_equity;
    const n = cdss.shares_outstanding;
    const P0 = cdss.share_price;
    const A = cdss.total_assets;
    const mgmt = cdss.management_share;

    const ebit = cdssEbit(cdss);
    const interest = D > 0 ? rd * D : 0;
    const netIncome = (ebit - interest) * (1 - T);
    const tie = interest > 0 ? ebit / interest : null;
    const afterTaxRd = D > 0 ? rd * (1 - T) : 0;

    // Case method (d(3), d(4)): buy back at today's $20.
    const caseRepurchased = D / P0;
    const caseRemaining = n - caseRepurchased;
    const caseEps = netIncome / caseRemaining;
    const casePrice = caseEps / rs;
    const bookWacc = (D / A) * afterTaxRd + ((A - D) / A) * rs;

    // New-price method: buy back at the price after the announcement.
    const S = netIncome / rs;
    const V = S + D;
    const P = V / n;
    const newRepurchased = D / P;
    const newRemaining = n - newRepurchased;
    const newEps = netIncome / newRemaining;
    const marketWacc = (D / V) * afterTaxRd + (S / V) * rs;

    return {
      debt: D, rd, rs, ebit, interest, netIncome, tie,
      caseMethod: {
        repurchased: caseRepurchased,
        remaining: caseRemaining,
        eps: caseEps,
        dps: caseEps,
        price: casePrice,
        wacc: bookWacc,
        mgmtStake: managementStake(mgmt, n, caseRemaining, caseRepurchased),
      },
      newPrice: {
        equityValue: S,
        firmValue: V,
        repurchased: newRepurchased,
        remaining: newRemaining,
        eps: newEps,
        dps: newEps,
        price: P,
        wacc: marketWacc,
        mgmtStake: managementStake(mgmt, n, newRemaining, newRepurchased),
        // Checks from CLAUDE.md: EPS = r_s × P and WACC = EBIT(1 − T) / V
        checkEps: Math.abs(newEps - rs * P) < 1e-9,
        checkWacc: Math.abs(marketWacc - ebit * (1 - T) / V) < 1e-12,
      },
    };
  }

  // Management doesn't sell, so its stake grows as outside shares are bought back.
  function managementStake(mgmtShare, n, remaining, repurchased) {
    const outside = (1 - mgmtShare) * n;
    const eps = 1e-9;
    if (repurchased > outside + eps) return { status: 'must-sell', value: null };
    if (Math.abs(repurchased - outside) <= eps) return { status: 'all-outside-gone', value: 1 };
    return { status: 'ok', value: (mgmtShare * n) / remaining };
  }

  // Every row of the schedule, plus which debt is best by each measure.
  function cdssAnalysis(schedule, cdss, taxRate) {
    const rows = schedule.map(r => cdssRow(r, cdss, taxRate));
    const pick = (getter, better) => {
      // On an exact tie, keep the smaller amount of debt (rows are in debt order).
      let best = rows[0];
      rows.forEach(r => { if (better(getter(r), getter(best))) best = r; });
      return best.debt;
    };
    const higher = (a, b) => a > b;
    const lower = (a, b) => a < b;
    const zero = rows.find(r => r.debt === 0);
    return {
      ebit: cdssEbit(cdss),
      rows,
      best: {
        casePrice: pick(r => r.caseMethod.price, higher),
        newPrice: pick(r => r.newPrice.price, higher),
        caseEps: pick(r => r.caseMethod.eps, higher),
        newEps: pick(r => r.newPrice.eps, higher),
        bookWacc: pick(r => r.caseMethod.wacc, lower),
        marketWacc: pick(r => r.newPrice.wacc, lower),
      },
      // EPS / r_s at $0 debt should equal today's price in cdss.csv.
      zeroDebtCheck: zero
        ? { price: zero.caseMethod.price, expected: cdss.share_price,
            ok: Math.abs(zero.caseMethod.price - cdss.share_price) < 0.005 }
        : { price: null, expected: cdss.share_price, ok: false },
    };
  }

  // Where the Best price / Highest EPS buttons send the CDSS slider.
  // Same amount under both methods: go there. Different: go to the case
  // method's amount and say so. (Each pick already takes the smaller debt on a tie.)
  function buttonTarget(caseDebt, newDebt) {
    return { debt: caseDebt, agree: caseDebt === newDebt, caseDebt, newDebt };
  }

  // The amounts the Firm L slider stops at: 0, step, 2·step, ... up to max.
  function sliderStops(max, step) {
    const stops = [];
    for (let d = 0; d <= max + 1e-9; d += step) stops.push(d);
    return stops;
  }

  return {
    parseCSV, num, toLookup, roundHalfUp, expected, stdDev,
    exampleFirm, cdssEbit, cdssRow, cdssAnalysis, managementStake,
    buttonTarget, sliderStops,
  };
});
