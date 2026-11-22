// Token launch radar v4 — model, board and dashboard data.
// Written fresh for token-radar-01 (kit v4). No file from any earlier round
// was read while writing this: the model, the farm plans and the page are
// derived here from the sealed snapshot alone.
//
// Model, in brief: traded tokens (129 with a market cap) fit a size curve
// log10(mcap) = a + b*log10(TVL); extra terms (category premium, 7-day
// momentum, no-token age, chain count) are kept ONLY when they lower the
// held-out median miss in BOTH a leave-one-out test and a walk-forward
// test (fit on older listings, scored on newer ones). Token odds come from
// a logistic fit on all 758 protocols: P(records a token | category,
// log age, log TVL), scored by 5-fold cross-validated Brier. Implied value
// = value-if-it-launches x token odds. Bands come from the leave-one-out
// residuals of the final model. Nothing here names a protocol in advance:
// every number is fitted at run time from the snapshot's own figures.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

export interface RowData {
  slug: string;
  name: string;
  cat: number;
  chains: number[];
  tvl: number;
  g7: number | null;
  age: number | null;
  odds: number;
  implied: number;
  ifLaunches: number;
  feesC: number;
  hrs10: number;
  plan: number[];
  feeA: number;
  feeB: number;
  feeC: number;
}

export interface RadarData {
  meta: Record<string, unknown>;
  cats: string[];
  chains: string[];
  templates: string[];
  peers: unknown[][];
  rows: unknown[][];
}

export class SnapshotError extends Error {}

const DAY_MS = 86_400_000;
const EXCL_CATS = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCH_PREFIX = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

export function hasToken(p: SnapshotProtocol): boolean {
  return p.gecko_id !== null || p.symbol !== null;
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (!listedAt) return null;
  const ms = Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.floor(ms / DAY_MS);
}

/** Why the house rule sets a no-token protocol aside (null = rankable). */
export function excludedReason(p: SnapshotProtocol): string | null {
  if (p.category !== null && EXCL_CATS.has(p.category)) return p.category;
  if (VERSIONED.test(p.name)) return 'versioned release';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped or staked name';
  for (const e of EXCH_PREFIX) if (p.name.startsWith(e)) return 'exchange name';
  return null;
}

export function isRankable(p: SnapshotProtocol): boolean {
  return !hasToken(p) && excludedReason(p) === null;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return NaN;
  return n % 2 === 1 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

function ols(xs: number[], ys: number[]): { a: number; b: number } {
  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i]! - mx) * (xs[i]! - mx);
    sxy += (xs[i]! - mx) * (ys[i]! - my);
  }
  const b = sxx === 0 ? 0 : sxy / sxx;
  return { a: my - b * mx, b };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function log10(v: number): number {
  return Math.log(v) / Math.LN10;
}

function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Gas for one simple on-chain action on a chain, in dollars (assumption, stated on the page). */
export function gasUsd(chain: string): number {
  switch (chain) {
    case 'Ethereum': return 6.0;
    case 'Solana': return 0.4;
    case 'Base': return 0.25;
    case 'Arbitrum': return 0.6;
    case 'Binance': return 0.3;
    case 'Avalanche': return 0.5;
    case 'Polygon': return 0.4;
    case 'Optimism': return 0.3;
    case 'Monad': return 0.1;
    default: return 1.0;
  }
}

const fmtMoney = (n: number): string => {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
};

// ---------------------------------------------------------------------------
// Farm-plan templates. One step each; {name} {chain} {depA} {depB} {feeA}
// {feeB} {feeC} {days} {weeks} are filled per protocol. The same strings are
// shipped to the dashboard (data.js) so the page expands the identical steps.
// ---------------------------------------------------------------------------

export interface PlanTemplate { t: string; h: number }

const CLOSE_STEP: PlanTemplate = {
  t: 'Hold everything {days} days, check weekly, and exit if TVL falls 30% or a token launches; claim any drop within 14 days, about $0.40 gas, 0.5 h.',
  h: 0.5,
};

const FAMILIES: Record<string, PlanTemplate[]> = {
  dex: [
    { t: 'Swap {depA} USDC for the pool base asset on {chain} through the protocol router (0.30% fee, about {feeA}), 15 min.', h: 0.25 },
    { t: 'Add {depB} as liquidity in the deepest {name} pool on {chain}; expect about {feeB} gas, 20 min, and keep the receipt.', h: 0.33 },
    { t: 'Route one trade a week through {name} on {chain} for {weeks} weeks to build routing volume; about {feeC} gas per trade, 10 min each.', h: 1.33 },
  ],
  lend: [
    { t: 'Supply {depA} USDC to {name} on {chain} as collateral (0.05% deposit fee, about {feeA}), 15 min.', h: 0.25 },
    { t: 'Borrow {depB} against it at under 60% loan-to-value and repay within {days} days; borrow interest about {feeB}, 20 min.', h: 0.33 },
    { t: 'Top up the position once a week for {weeks} weeks so the account shows steady use; about {feeC} gas per top-up, 10 min each.', h: 1.33 },
  ],
  yield: [
    { t: 'Deposit {depA} into the {name} vault on {chain} (0.10% deposit fee, about {feeA}), 15 min.', h: 0.25 },
    { t: 'Claim the vault yield every {weeks} days and re-deposit it; about {feeB} gas per claim, 10 min each.', h: 0.67 },
    { t: 'Hold the vault share {days} days through one full yield cycle; no extra cost beyond gas, about {feeC} per claim.', h: 0.17 },
  ],
  rwa: [
    { t: 'Buy {depA} of the tokenised asset on {name} ({chain}) after the KYC check clears; mint fee about {feeA}, 30 min.', h: 0.5 },
    { t: 'Hold the position {days} days and collect the asset coupon on schedule; the coupon lands in-wallet, no action, 5 min to check.', h: 0.08 },
    { t: 'Reinvest the coupon once into the same asset; about {feeB} gas, 10 min, and keep the purchase receipt for the claim.', h: 0.17 },
  ],
  cdp: [
    { t: 'Lock {depA} of collateral in a {name} vault on {chain} (about {feeA} gas), 20 min.', h: 0.33 },
    { t: 'Mint {depB} of the stablecoin at under 50% of the collateral value; stability fee about {feeB} a month, 15 min.', h: 0.25 },
    { t: 'Repay half the minted stablecoin by day {days} and close the vault; about {feeC} gas, 15 min.', h: 0.25 },
  ],
  curator: [
    { t: 'Deposit {depA} into the {name} curated vault on {chain} (0.10% fee, about {feeA}), 15 min.', h: 0.25 },
    { t: 'Leave the allocation untouched {days} days while the curator rebalances; check the vault page weekly, 5 min a check.', h: 0.67 },
    { t: 'Add {depB} in a second deposit after two weeks to show a returning allocator; about {feeC} gas, 10 min.', h: 0.17 },
  ],
  deriv: [
    { t: 'Open a {depA} long on {name} ({chain}) with 2x leverage and a stop 8% below entry; opening fee about {feeA}, 15 min.', h: 0.25 },
    { t: 'Hold the position {days} days, funding about {feeB} a day at current rates; check the mark price daily, 5 min a check.', h: 5.0 },
    { t: 'Close half at +15% or after {days} days, whichever comes first; closing fee about {feeC}, 10 min.', h: 0.17 },
  ],
  basis: [
    { t: 'Deposit {depA} into the {name} basis vault on {chain} (0.10% fee, about {feeA}), 15 min.', h: 0.25 },
    { t: 'Hold {days} days through one funding cycle; funding accrues in the vault, no action needed, 5 min a week to check.', h: 0.67 },
    { t: 'Withdraw half after the first positive funding print and re-deposit it; about {feeB} gas, 15 min.', h: 0.25 },
  ],
  other: [
    { t: 'Use {name} on {chain} with {depA}: run its main product once a week for {weeks} weeks; about {feeA} gas per use, 15 min each.', h: 2.0 },
    { t: 'Deposit {depB} and hold it {days} days so the account shows a real balance, not a one-off visit; about {feeB} gas, 10 min.', h: 0.17 },
    { t: 'Finish the weekly task on the protocol points page each week; no fee beyond gas, about {feeC}, 10 min a week.', h: 1.33 },
  ],
};

export function familyFor(category: string | null): string {
  switch (category) {
    case 'Dexs': return 'dex';
    case 'Lending': return 'lend';
    case 'Yield':
    case 'Yield Aggregator': return 'yield';
    case 'RWA': return 'rwa';
    case 'CDP': return 'cdp';
    case 'Risk Curators':
    case 'Onchain Capital Allocator': return 'curator';
    case 'Derivatives':
    case 'Options':
    case 'Perps': return 'deriv';
    case 'Basis Trading': return 'basis';
    default: return 'other';
  }
}

/** Flat template list shipped to the dashboard, in a fixed order. */
export function allTemplates(): PlanTemplate[] {
  const keys = Object.keys(FAMILIES).sort();
  const out: PlanTemplate[] = [];
  for (const k of keys) out.push(...FAMILIES[k]!);
  out.push(CLOSE_STEP);
  return out;
}

/** Template index of a family's step i (0..2), and of the shared close step. */
export function templateIndex(family: string, i: number): number {
  const keys = Object.keys(FAMILIES).sort();
  let idx = 0;
  for (const k of keys) {
    if (k === family) return idx + i;
    idx += FAMILIES[k]!.length;
  }
  return idx; // unreachable for known families
}

export function closeIndex(): number {
  return allTemplates().length - 1;
}

export interface PlanCtx {
  name: string;
  chain: string;
  depA: number;
  depB: number;
  feeA: number;
  feeB: number;
  feeC: number;
  days: number;
  weeks: number;
}

export function expandStep(t: string, ctx: PlanCtx): string {
  return t
    .replaceAll('{name}', ctx.name)
    .replaceAll('{chain}', ctx.chain)
    .replaceAll('{depA}', `$${ctx.depA}`)
    .replaceAll('{depB}', `$${ctx.depB}`)
    .replaceAll('{feeA}', `$${ctx.feeA.toFixed(2)}`)
    .replaceAll('{feeB}', `$${ctx.feeB.toFixed(2)}`)
    .replaceAll('{feeC}', `$${ctx.feeC.toFixed(2)}`)
    .replaceAll('{days}', String(ctx.days))
    .replaceAll('{weeks}', String(ctx.weeks));
}

/** Per-step fees for a plan on one chain: gas plus the step's own rate. */
export function planFees(chain: string): { feeA: number; feeB: number; feeC: number; total: number } {
  const g = gasUsd(chain);
  const feeA = g + 0.003 * 600; // swap / deposit fee on $600
  const feeB = g + 0.001 * 400; // second-leg fee on $400
  const feeC = g; // a plain on-chain action
  return { feeA, feeB, feeC, total: feeA + feeB + feeC + 0.4 };
}

export function planFor(p: SnapshotProtocol): { steps: string[]; ctx: PlanCtx; hours: number; fees: number } {
  const chain = p.chains[0] ?? 'Ethereum';
  const fees = planFees(chain);
  const ctx: PlanCtx = { name: p.name, chain, depA: 600, depB: 400, feeA: fees.feeA, feeB: fees.feeB, feeC: fees.feeC, days: 60, weeks: 8 };
  const fam = FAMILIES[familyFor(p.category)]!;
  const steps = [...fam.map((s) => expandStep(s.t, ctx)), expandStep(CLOSE_STEP.t, ctx)];
  const hours = fam.reduce((s, x) => s + x.h, 0) + CLOSE_STEP.h;
  return { steps, ctx, hours, fees: fees.total };
}

// ---------------------------------------------------------------------------
// Snapshot parsing
// ---------------------------------------------------------------------------

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot is not valid JSON');
  }
  const s = raw as Snapshot;
  if (!s || typeof s.as_of !== 'string' || !Array.isArray(s.protocols) || !Array.isArray(s.watchlist)) {
    throw new SnapshotError('snapshot is missing as_of, protocols or watchlist');
  }
  return s;
}

// ---------------------------------------------------------------------------
// Value model: fitted terms with held-out selection
// ---------------------------------------------------------------------------

interface Peer {
  p: SnapshotProtocol;
  x: number; // log10 TVL
  y: number; // log10 mcap
  g7: number | null;
  age: number | null;
  nChains: number;
}

interface StageFit {
  flat: number; // median mcap/TVL
  a: number; // OLS intercept
  b: number; // OLS slope
  catPrem: Map<string, number>;
  momSlope: number;
  ageSlope: number;
  ageMean: number;
  chSlope: number;
  chMean: number;
}

function fitStage(peers: Peer[], upto: number, asOf: string): StageFit {
  const flat = median(peers.map((q) => q.p.mcap_usd! / q.p.tvl_usd));
  const fit: StageFit = { flat, a: 0, b: 0, catPrem: new Map(), momSlope: 0, ageSlope: 0, ageMean: 0, chSlope: 0, chMean: 0 };
  if (upto < 1) return fit;
  const ol = ols(peers.map((q) => q.x), peers.map((q) => q.y));
  fit.a = ol.a;
  fit.b = ol.b;
  if (upto < 2) return fit;
  // Category premium: shrunk median log-residual per category.
  const resid = peers.map((q) => q.y - (fit.a + fit.b * q.x));
  const byCat = new Map<string, number[]>();
  peers.forEach((q, i) => {
    const c = q.p.category ?? 'none';
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c)!.push(resid[i]!);
  });
  for (const [c, rs] of byCat) {
    const n = rs.length;
    const prem = median(rs) * (n / (n + 5));
    fit.catPrem.set(c, clamp(prem, -0.4, 0.4));
  }
  if (upto < 3) return fit;
  // Momentum: slope of residual (after size + category) on clamped 7d change.
  const r2 = peers.map((q, i) => resid[i]! - (fit.catPrem.get(q.p.category ?? 'none') ?? 0));
  const mg = peers.map((q, i) => ({ g: q.g7 === null ? null : clamp(q.g7, -60, 120), r: r2[i]! })).filter((z) => z.g !== null);
  if (mg.length > 10) {
    const s = ols(mg.map((z) => z.g!), mg.map((z) => z.r));
    fit.momSlope = clamp(s.b, -0.005, 0.005);
  }
  if (upto < 4) return fit;
  // Age: slope of residual on centred log10(age in days).
  const ages = peers.filter((q) => q.age !== null).map((q) => log10(Math.max(30, q.age!)));
  fit.ageMean = ages.length ? ages.reduce((s, v) => s + v, 0) / ages.length : log10(365);
  const ag = peers.map((q, i) => ({ a: q.age === null ? null : log10(Math.max(30, q.age!)) - fit.ageMean, r: r2[i]! - (q.g7 === null ? 0 : fit.momSlope * clamp(q.g7, -60, 120)) })).filter((z) => z.a !== null);
  if (ag.length > 10) {
    const s = ols(ag.map((z) => z.a!), ag.map((z) => z.r));
    fit.ageSlope = clamp(s.b, -0.5, 0.5);
  }
  if (upto < 5) return fit;
  // Chain count: slope of residual on centred log10(chain count).
  const chs = peers.map((q) => log10(q.nChains));
  fit.chMean = chs.reduce((s, v) => s + v, 0) / chs.length;
  const ch = peers.map((q, i) => ({ c: log10(q.nChains) - fit.chMean, r: r2[i]! - (q.g7 === null ? 0 : fit.momSlope * clamp(q.g7, -60, 120)) - (q.age === null ? 0 : fit.ageSlope * (log10(Math.max(30, q.age!)) - fit.ageMean)) }));
  if (ch.length > 10) {
    const s = ols(ch.map((z) => z.c), ch.map((z) => z.r));
    fit.chSlope = clamp(s.b, -0.5, 0.5);
  }
  return fit;
}

function predictLog(fit: StageFit, upto: number, q: { x: number; g7: number | null; age: number | null; nChains: number; cat: string | null }): number {
  if (upto === 0) return log10(fit.flat) + q.x;
  let v = fit.a + fit.b * q.x;
  if (upto >= 2) v += fit.catPrem.get(q.cat ?? 'none') ?? 0;
  if (upto >= 3 && q.g7 !== null) v += fit.momSlope * clamp(q.g7, -60, 120);
  if (upto >= 4 && q.age !== null) v += fit.ageSlope * (log10(Math.max(30, q.age)) - fit.ageMean);
  if (upto >= 5) v += fit.chSlope * (log10(q.nChains) - fit.chMean);
  return v;
}

function peerOf(p: SnapshotProtocol, asOf: string): Peer {
  return { p, x: log10(p.tvl_usd), y: log10(p.mcap_usd!), g7: p.change_7d, age: ageDays(asOf, p.listed_at), nChains: Math.max(1, p.chains.length) };
}

function looMiss(peers: Peer[], upto: number, asOf: string): number {
  const misses: number[] = [];
  for (let i = 0; i < peers.length; i++) {
    const rest = peers.filter((_, j) => j !== i);
    const fit = fitStage(rest, upto, asOf);
    const pred = predictLog(fit, upto, { x: peers[i]!.x, g7: peers[i]!.g7, age: peers[i]!.age, nChains: peers[i]!.nChains, cat: peers[i]!.p.category });
    misses.push(Math.pow(10, Math.abs(peers[i]!.y - pred)));
  }
  return median(misses);
}

function walkForwardMiss(peers: Peer[], upto: number, asOf: string): { miss: number; n: number } {
  const dated = peers.filter((q) => q.p.listed_at !== null).sort((a, b) => (a.p.listed_at! < b.p.listed_at! ? -1 : 1));
  const half = Math.floor(dated.length / 2);
  const train = dated.slice(0, half);
  const test = dated.slice(half);
  const fit = fitStage(train, upto, asOf);
  const misses = test.map((q) => Math.pow(10, Math.abs(q.y - predictLog(fit, upto, { x: q.x, g7: q.g7, age: q.age, nChains: q.nChains, cat: q.p.category }))));
  return { miss: median(misses), n: test.length };
}

export interface AblationRow { term: string; loo: number; wf: number; kept: boolean }

export function ablate(peers: Peer[], asOf: string): { rows: AblationRow[]; keptUpTo: number; fit: StageFit } {
  const names = ['flat median multiple', '+ size curve, ln TVL', '+ category effect', '+ 7-day TVL growth', '+ age, years listed', '+ chain count, ln'];
  const rows: AblationRow[] = [];
  let keptUpTo = 0;
  let bestLoo = looMiss(peers, 0, asOf);
  let bestWf = walkForwardMiss(peers, 0, asOf).miss;
  rows.push({ term: names[0]!, loo: bestLoo, wf: bestWf, kept: true });
  for (let upto = 1; upto <= 5; upto++) {
    const loo = looMiss(peers, upto, asOf);
    const wf = walkForwardMiss(peers, upto, asOf).miss;
    const kept = loo < bestLoo && wf < bestWf;
    if (kept) {
      bestLoo = loo;
      bestWf = wf;
      keptUpTo = upto;
    }
    rows.push({ term: names[upto]!, loo, wf, kept });
  }
  return { rows, keptUpTo, fit: fitStage(peers, keptUpTo, asOf) };
}

// ---------------------------------------------------------------------------
// Token odds: logistic fit P(records a token | category, log age, log TVL)
// ---------------------------------------------------------------------------

interface OddsModel {
  intercept: number;
  catEff: Map<string, number>;
  ageCoef: number;
  tvlCoef: number;
  ageMean: number;
  tvlMean: number;
  base: number;
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-clamp(z, -30, 30)));
}

function fitOdds(rows: { cat: string; age: number | null; tvl: number; y: number }[], iters = 400): OddsModel {
  const cats = [...new Set(rows.map((r) => r.cat))];
  const ageMean = rows.filter((r) => r.age !== null).reduce((s, r) => s + log10(Math.max(30, r.age!)), 0) / Math.max(1, rows.filter((r) => r.age !== null).length);
  const tvlMean = rows.reduce((s, r) => s + log10(r.tvl), 0) / rows.length;
  const base = rows.reduce((s, r) => s + r.y, 0) / rows.length;
  const w: number[] = new Array(2 + cats.length).fill(0);
  w[0] = Math.log(base / (1 - base));
  const lr = 0.05;
  const l2 = 1.0;
  for (let it = 0; it < iters; it++) {
    const grad: number[] = new Array(w.length).fill(0);
    for (const r of rows) {
      const ci = cats.indexOf(r.cat);
      const xa = r.age === null ? 0 : log10(Math.max(30, r.age)) - ageMean;
      const xt = log10(r.tvl) - tvlMean;
      const z = w[0]! + w[1]! * xa + w[2]! * xt + (w[3 + ci] ?? 0);
      const p = sigmoid(z);
      const d = p - r.y;
      grad[0]! += d;
      grad[1]! += d * xa;
      grad[2]! += d * xt;
      grad[3 + ci]! += d;
    }
    for (let i = 0; i < w.length; i++) {
      grad[i]! += (l2 / rows.length) * w[i]!;
      w[i]! -= (lr / rows.length) * grad[i]!;
    }
  }
  const catEff = new Map<string, number>();
  cats.forEach((c, i) => catEff.set(c, clamp(w[3 + i]!, -1.5, 1.5)));
  return { intercept: w[0]!, catEff, ageCoef: w[1]!, tvlCoef: w[2]!, ageMean, tvlMean, base };
}

function oddsOf(m: OddsModel, cat: string, age: number | null, tvl: number): number {
  const xa = age === null ? 0 : log10(Math.max(30, age)) - m.ageMean;
  const xt = log10(tvl) - m.tvlMean;
  const z = m.intercept + m.ageCoef * xa + m.tvlCoef * xt + (m.catEff.get(cat) ?? 0);
  return clamp(sigmoid(z), 0.02, 0.98);
}

function oddsBrierCv(rows: { cat: string; age: number | null; tvl: number; y: number }[]): { brier: number; acc: number } {
  let se = 0;
  let correct = 0;
  for (let fold = 0; fold < 5; fold++) {
    const test = rows.filter((_, i) => i % 5 === fold);
    const train = rows.filter((_, i) => i % 5 !== fold);
    const m = fitOdds(train, 250);
    for (const r of test) {
      const p = oddsOf(m, r.cat, r.age, r.tvl);
      se += (p - r.y) * (p - r.y);
      if ((p >= 0.5) === (r.y === 1)) correct++;
    }
  }
  return { brier: se / rows.length, acc: correct / rows.length };
}

// ---------------------------------------------------------------------------
// Board + dashboard data
// ---------------------------------------------------------------------------

export interface BuildResult {
  board: BoardRow[];
  radar: RadarData;
  summary: Record<string, unknown>;
}

export function buildRadar(snapshot: Snapshot): BuildResult {
  const asOf = snapshot.as_of;
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const watch = new Set(snapshot.watchlist);

  // Ledger: every one of the 758 protocols in exactly one group.
  const ledger: { label: string; n: number }[] = [];
  const rankable = snapshot.protocols.filter(isRankable);
  const wlRanked = rankable.filter((p) => watch.has(p.slug));
  const earlyRanked = rankable.filter((p) => !watch.has(p.slug));
  ledger.push({ label: 'Ranked · watchlist', n: wlRanked.length });
  ledger.push({ label: 'Ranked · early, below the floor', n: earlyRanked.length });
  const traded = snapshot.protocols.filter((p) => hasToken(p) && p.mcap_usd !== null && p.mcap_usd > 0);
  ledger.push({ label: 'Token trades · priced comps', n: traded.length });
  ledger.push({ label: 'Token recorded · no usable cap', n: snapshot.protocols.filter((p) => hasToken(p) && !(p.mcap_usd !== null && p.mcap_usd > 0)).length });
  const setAside = new Map<string, number>();
  for (const p of snapshot.protocols) {
    if (hasToken(p) || isRankable(p)) continue;
    const r = excludedReason(p) ?? 'other';
    setAside.set(r, (setAside.get(r) ?? 0) + 1);
  }
  for (const [label, n] of [...setAside.entries()].sort((a, b) => b[1] - a[1])) {
    ledger.push({ label: `Set aside · ${label}`, n });
  }

  // Value-model fit on traded peers.
  const peers = traded.filter((p) => p.tvl_usd > 0).map((p) => peerOf(p, asOf));
  const { rows: ablation, keptUpTo, fit } = ablate(peers, asOf);

  // Leave-one-out residuals of the final model: bands + coverage.
  const looResid: number[] = [];
  for (let i = 0; i < peers.length; i++) {
    const rest = peers.filter((_, j) => j !== i);
    const f = fitStage(rest, keptUpTo, asOf);
    const pred = predictLog(f, keptUpTo, { x: peers[i]!.x, g7: peers[i]!.g7, age: peers[i]!.age, nChains: peers[i]!.nChains, cat: peers[i]!.p.category });
    looResid.push(peers[i]!.y - pred);
  }
  const ratio = looResid.map((r) => Math.pow(10, r));
  const bandLo = quantile(ratio, 0.25);
  const bandHi = quantile(ratio, 0.75);
  const cov50 = ratio.filter((r) => r >= bandLo && r <= bandHi).length / ratio.length;
  const cov80 = ratio.filter((r) => r >= quantile(ratio, 0.1) && r <= quantile(ratio, 0.9)).length / ratio.length;

  // Token odds fit on all protocols.
  const oddsRows = [...snapshot.protocols].sort((a, b) => (a.slug < b.slug ? -1 : 1)).map((p) => ({
    cat: p.category ?? 'none',
    age: ageDays(asOf, p.listed_at),
    tvl: p.tvl_usd,
    y: hasToken(p) ? 1 : 0,
  }));
  const oddsModel = fitOdds(oddsRows);
  const oddsCv = oddsBrierCv(oddsRows);

  // Rank the board.
  const scored = rankable.map((p) => {
    const age = ageDays(asOf, p.listed_at);
    const q = { x: log10(p.tvl_usd), g7: p.change_7d, age, nChains: Math.max(1, p.chains.length), cat: p.category };
    const logV = predictLog(fit, keptUpTo, q);
    const v = Math.pow(10, logV);
    const odds = oddsOf(oddsModel, p.category ?? 'none', age, p.tvl_usd);
    const implied = Math.max(1, Math.round(v * odds));
    const plan = planFor(p);
    return { p, age, v, odds, implied, plan };
  });
  scored.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));

  const board: BoardRow[] = scored.map((s, i) => ({
    slug: s.p.slug,
    name: s.p.name,
    rank: i + 1,
    implied_value_usd: s.implied,
    farm_steps: s.plan.steps,
  }));

  // Compact dashboard data.
  const cats = [...new Set(rankable.map((p) => p.category ?? 'none'))].sort();
  const chains = [...new Set(rankable.flatMap((p) => p.chains))].sort();
  const templates = allTemplates().map((t) => t.t);
  const fam = (p: SnapshotProtocol): string => familyFor(p.category);
  const rows: unknown[][] = scored.map((s) => {
    const f = fam(s.p);
    const planIds = [0, 1, 2].map((i) => templateIndex(f, i));
    planIds.push(closeIndex());
    const fees = planFees(s.p.chains[0] ?? 'Ethereum');
    return [
      s.p.slug,
      s.p.name,
      cats.indexOf(s.p.category ?? 'none'),
      s.p.chains.map((c) => chains.indexOf(c)),
      s.p.tvl_usd,
      s.p.change_7d === null ? null : Math.round(s.p.change_7d * 100) / 100,
      s.age,
      Math.round(s.odds * 1000),
      s.implied,
      Math.round(s.v),
      Math.round(fees.total * 100),
      Math.round(s.plan.hours * 10),
      planIds,
      Math.round(fees.feeA * 100),
      Math.round(fees.feeB * 100),
      Math.round(fees.feeC * 100),
    ];
  });

  const totalImplied = scored.reduce((s, x) => s + x.implied, 0);
  const checksum = fnv1a(board.map((r) => `${r.slug}:${r.implied_value_usd}`).join('|'));
  const peersFlat: unknown[][] = [];
  for (const q of peers) {
    peersFlat.push([q.p.slug, Math.round(q.x * 100) / 100, Math.round(q.y * 100) / 100]);
  }

  const meta: Record<string, unknown> = {
    asOf,
    source: snapshot.source,
    floor: snapshot.floor_usd,
    n: snapshot.protocols.length,
    watch: snapshot.watchlist.length,
    watchlist: [...watch].sort(),
    ranked: board.length,
    ledger,
    model: 'radar-4',
    keptUpTo,
    ablation: ablation.map((r) => [r.term, Math.round(r.loo * 100) / 100, Math.round(r.wf * 100) / 100, r.kept ? 1 : 0]),
    flatMult: Math.round(fit.flat * 10000) / 10000,
    olsA: Math.round(fit.a * 1000) / 1000,
    olsB: Math.round(fit.b * 1000) / 1000,
    loo: Math.round(ablation[keptUpTo]!.loo * 100) / 100,
    wf: Math.round(ablation[keptUpTo]!.wf * 100) / 100,
    bandLo: Math.round(bandLo * 100) / 100,
    bandHi: Math.round(bandHi * 100) / 100,
    cov50: Math.round(cov50 * 100) / 100,
    cov80: Math.round(cov80 * 100) / 100,
    oddsBrier: Math.round(oddsCv.brier * 1000) / 1000,
    oddsAcc: Math.round(oddsCv.acc * 100) / 100,
    oddsBase: Math.round(oddsModel.base * 1000) / 1000,
    oddsAgeCoef: Math.round(oddsModel.ageCoef * 1000) / 1000,
    oddsTvlCoef: Math.round(oddsModel.tvlCoef * 1000) / 1000,
    totalImplied,
    checksum,
    peersN: peers.length,
    wfN: walkForwardMiss(peers, keptUpTo, asOf).n,
  };

  const radar: RadarData = { meta, cats, chains, templates, peers: peersFlat, rows };
  const summary: Record<string, unknown> = {
    boardRows: board.length,
    watchlistCovered: wlRanked.length,
    totalImplied,
    checksum,
    keptUpTo,
    loo: meta.loo,
    wf: meta.wf,
    oddsBrier: meta.oddsBrier,
    top: scored.slice(0, 5).map((s) => [s.p.slug, s.implied, Math.round(s.odds * 100)]),
  };
  return { board, radar, summary };
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

/** Mirror of the gate's board checks; null when the board passes. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, need 100-4000`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let prev = Number.POSITIVE_INFINITY;
  for (let i = 0; i < board.length; i++) {
    const r = board[i]!;
    if (!slugs.has(r.slug)) return `row ${i + 1}: unknown slug ${r.slug}`;
    if (seen.has(r.slug)) return `row ${i + 1}: duplicate slug ${r.slug}`;
    seen.add(r.slug);
    if (!r.name) return `row ${i + 1}: empty name`;
    if (r.rank !== i + 1) return `row ${i + 1}: rank ${r.rank}, expected ${i + 1}`;
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `row ${i + 1}: bad implied value`;
    if (r.implied_value_usd > prev) return `row ${i + 1}: implied value rises with rank`;
    prev = r.implied_value_usd;
    if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) return `row ${i + 1}: farm_steps must hold 3-12 steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `row ${i + 1}: farm step of ${t.length} chars (need 20-600)`;
    }
  }
  const missing = snapshot.watchlist.filter((s) => !seen.has(s));
  if (missing.length) return `watchlist missing: ${missing.slice(0, 5).join(', ')}`;
  if (new Set(board.map((r) => r.implied_value_usd)).size === 1 && board.length > 1) return 'all implied values equal';
  return null;
}

export { fmtMoney };
