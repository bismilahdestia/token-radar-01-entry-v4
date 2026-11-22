// Farm-plan expansion for the dashboard. Pure functions, no DOM: the same
// template strings the program ships in data.js are expanded here with the
// row's own numbers, so the steps the page shows are byte-identical to the
// steps board.json carries for that protocol.
//
// Row layout (see lib/model.ts): [slug, name, catIdx, chainIdxs, tvl, g7,
// ageDays, oddsPermille, implied, ifLaunches, feesCents, hoursX10, planIds,
// feeACents, feeBCents, feeCCents]. Plans are sized at a $1,000 deposit
// ($600 first leg, $400 second leg) over 60 days, 8 weekly touches.
var Plans = (function () {
  function money(n) { return '$' + n.toFixed(2); }
  function expand(t, ctx) {
    return t
      .split('{name}').join(ctx.name)
      .split('{chain}').join(ctx.chain)
      .split('{depA}').join('$' + ctx.depA)
      .split('{depB}').join('$' + ctx.depB)
      .split('{feeA}').join(money(ctx.feeA))
      .split('{feeB}').join(money(ctx.feeB))
      .split('{feeC}').join(money(ctx.feeC))
      .split('{days}').join(String(ctx.days))
      .split('{weeks}').join(String(ctx.weeks));
  }
  function ctxFor(row, data) {
    return {
      name: row[1],
      chain: data.chains[row[3][0]] || 'Ethereum',
      depA: 600, depB: 400,
      feeA: row[13] / 100, feeB: row[14] / 100, feeC: row[15] / 100,
      days: 60, weeks: 8,
    };
  }
  // The four steps for one board row, expanded from data.templates.
  function stepsFor(row, data) {
    var ctx = ctxFor(row, data);
    return row[12].map(function (i) { return expand(data.templates[i], ctx); });
  }
  // One-line plan summary for the table: first step, cut short, + fees + horizon.
  function labelFor(row, data) {
    var first = expand(data.templates[row[12][0]], ctxFor(row, data)).split(' (')[0];
    return first.slice(0, 34).replace(/\s+$/, '') + ' · $' + (row[10] / 100).toFixed(2) + ' fees · 60 d';
  }
  return { expand: expand, stepsFor: stepsFor, labelFor: labelFor, ctxFor: ctxFor };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Plans;
