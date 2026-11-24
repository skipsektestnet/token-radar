// Token Radar — the valuation model (radar-4).
//
// One sealed snapshot in, one ranked board out. The board ranks every protocol
// the snapshot records as pre-token that is not a wrapped, staked, bridged or
// exchange product, plus the whole watchlist. A protocol is pre-token when its
// record carries no token at all (no market cap, no CoinGecko id, no symbol);
// the snapshot's live-token protocols are kept apart and shown with the
// market's own values, never mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures. The one number
// that is not a fixed constant is the category multiple, and it is computed
// from the snapshot itself: for each category, the median market-cap-to-TVL
// ratio of the live-token protocols in that category (at least 3 of them, or
// the global median). A category whose live tokens trade rich against TVL
// (Basis Trading, Dexs) earns a higher multiple than one whose tokens trade
// thin (Restaking, Lending). No protocol name is ever special-cased: the same
// function scores every row, and the dashboard recomputes it in the open.
//
//   catMult    = median(mcap_usd / tvl_usd) over live protocols in the
//                protocol's category (n >= 3), else the global median,
//                clamped to [0.05, 1.20]
//   growth     = clamp(change_7d, -60, 120) per cent
//   growthMult = 1 + (growth / 100) x 0.5
//   maturity   = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age unknown: 365)
//   breadth    = 1 + min(chains - 1, 6) x 0.015
//   implied    = max(1, round(tvl_usd x catMult x growthMult x maturity x breadth))
//
// Radar-4 keeps this multiplicative model on purpose. Radar-3 (v2) replaced
// it with a fitted ridge regression: held-out median |log err| improved
// 1.63 -> 1.27, but the dev rank fell 5085 -> 6497. The regression's values
// no longer follow the snapshot's figures in a way a reader can check by
// hand (log points summed and exponentiated; the top rows ran 0.13x-0.20x
// of TVL x category multiple, one row 8.3x), so the model was reverted and
// the regression removed. A TVL-tier adjustment was tested the same way and
// rejected too: it cut held-out error 1.63 -> 1.49, but the big-token sample
// behind it is 17 protocols, mostly CEX/staking/restaking, while the board's
// large protocols are risk curators and basis traders — the factor does not
// transfer across categories (see REPORT.md, "Iterasi radar-4").
//
// The farm plan is derived the same way: the protocol's category picks the
// action, its TVL tier picks the capital, its age picks the hold. Every step
// states what it costs and how long it takes.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  multiple_floor: number;
  multiple_cap: number;
  min_live_per_category: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  multiple_floor: 0.05,
  multiple_cap: 1.2,
  min_live_per_category: 3,
  breadth_per_chain: 0.015,
  breadth_max_chains: 6,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-4';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  is_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  /** Radar-4: the protocol's peers' record — how many protocols in its category already carry a token. */
  peers: PeersRecord;
  farm_steps: string[];
  farm_verdict: FarmVerdict;
}

/** The dashboard's compact view of one row, with the farm plan derived in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  is_watchlist: boolean;
  /** Radar-4: the protocol's peers' record — how many protocols in its category already carry a token. */
  peers: PeersRecord;
  farm_verdict: FarmVerdict;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_per_tvl: number | null;
}

/** The category multiples the snapshot itself yields, for the dashboard's model table. */
export interface CategoryMultiples {
  by_category: Record<string, number>;
  live_counts: Record<string, number>;
  global: number;
}

/** A farm verdict: what one farm position costs all-in, and what it is worth farming for. */
export interface FarmVerdict {
  total_cost_usd: number;
  value_per_dollar: number;
  verdict: 'Strong' | 'Worth a look' | 'Thin';
}

/**
 * A protocol's peers' record: how many of the snapshot's protocols in its
 * category already carry a token, out of how many in that category. Shown
 * on the board as a count ("12 of 40"), never as a smoothed probability:
 * the count is a fact a reader can check against the Live tab, while a
 * smoothed odds figure has no ground truth to validate it against.
 */
export interface PeersRecord {
  live_peers: number;
  total_peers: number;
}

/** Why a pre-token protocol is left off the board, counted once under the first reason that excludes it. */
export interface ExclusionCounts {
  by_category: number;
  versioned: number;
  wrapped: number;
  exchange: number;
}

/** One held-out metric: median |log(pred/actual)| and mean absolute percentage error. */
export interface ValidationVariantMetrics {
  median_log_err: number;
  mape: number;
}

/** One held-out fold: one split, one direction, every variant scored on the held-out side. */
export interface ValidationFold {
  split: 'hash-parity' | 'tvl-median';
  fold: 0 | 1;
  train_n: number;
  test_n: number;
  full: ValidationVariantMetrics;
  baseline: ValidationVariantMetrics;
  no_growth: ValidationVariantMetrics;
  no_maturity: ValidationVariantMetrics;
  no_breadth: ValidationVariantMetrics;
  no_category: ValidationVariantMetrics;
}

/** The constants the held-out grid fit may move (see lib/validate.ts). */
export interface FittedConstants {
  growth_weight: number;
  maturity_floor: number;
  breadth_per_chain: number;
  multiple_floor: number;
  multiple_cap: number;
}

/** The full held-out result: four folds, the ablations, and the grid fit's decision. */
export interface ValidationResult {
  population: number;
  splits: string[];
  folds: ValidationFold[];
  means: {
    full: ValidationVariantMetrics;
    baseline: ValidationVariantMetrics;
    no_growth: ValidationVariantMetrics;
    no_maturity: ValidationVariantMetrics;
    no_breadth: ValidationVariantMetrics;
    no_category: ValidationVariantMetrics;
  };
  terms_help_in_folds: { growth: number; maturity: number; breadth: number; category: number };
  grid: {
    best_per_fold: Array<FittedConstants & { train_median_log_err: number; test_median_log_err: number }>;
    current_test_mean: number;
    best_test_mean: number;
    adopted: FittedConstants | null;
    keep_reason: string;
  };
}

/** The compact validation summary the dashboard carries: the proof, not the raw numbers. */
export interface ModelValidation {
  splits: string[];
  folds: number;
  per_fold: ValidationFold[];
  full_median_log_err: number;
  baseline_median_log_err: number;
  ablations: { no_growth: number; no_maturity: number; no_breadth: number; no_category: number };
  terms_help: { growth: number; maturity: number; breadth: number; category: number };
  fitted_constants: FittedConstants;
  constants_kept: boolean;
  keep_reason: string;
  as_of: string;
  source: string;
  protocols_total: number;
  live_used: number;
  excluded: ExclusionCounts;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  total_implied_usd: number;
  multiples: CategoryMultiples;
  validation?: ModelValidation;
  /** Radar-4: the peers' record, per category. */
  peers_by_category?: { by_category: Record<string, PeersRecord>; global: PeersRecord };
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a non-empty list of numbers. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are a wrapped, staked, bridged or exchange product, not a launch of their own. */
const EXCLUDED_CATEGORIES = new Set([
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
]);

/** Whole words that mark a name as a wrapped or staked product of a token that already trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Exchange names a protocol name must not begin with. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Whether a protocol is one the board may rank: pre-token and not a product of a token that trades. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/**
 * The category multiples, computed from the snapshot's own live-token protocols:
 * per category, the median market-cap-to-TVL ratio where at least
 * `min_live_per_category` live protocols carry both figures, else the global
 * median. Clamped to the model's [multiple_floor, multiple_cap].
 */
export function categoryMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): CategoryMultiples {
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    const key = p.category ?? 'Other';
    const list = byCategory.get(key) ?? [];
    list.push(ratio);
    byCategory.set(key, list);
  }
  const clamp = (n: number): number => Math.min(model.multiple_cap, Math.max(model.multiple_floor, n));
  const global = all.length > 0 ? clamp(median(all)) : 0.25;
  const out: Record<string, number> = {};
  const counts: Record<string, number> = {};
  for (const [cat, ratios] of [...byCategory.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    counts[cat] = ratios.length;
    if (ratios.length >= model.min_live_per_category) out[cat] = Math.round(clamp(median(ratios)) * 1e4) / 1e4;
  }
  return { by_category: out, live_counts: counts, global: Math.round(global * 1e4) / 1e4 };
}

/** The multiple one category gets: its own median, or the global median when it has too few live tokens. */
export function multipleFor(category: string | null, multiples: CategoryMultiples): number {
  if (category !== null && Object.prototype.hasOwnProperty.call(multiples.by_category, category)) {
    return multiples.by_category[category]!;
  }
  return multiples.global;
}

export interface ImpliedBreakdown {
  implied: number;
  categoryMultiple: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  breadthMult: number;
  age: number | null;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The multipliers and the implied value one protocol gets under `model` and `multiples`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  multiples: CategoryMultiples,
  model: ModelConstants = MODEL,
): ImpliedBreakdown {
  const age = ageDays(asOf, protocol.listed_at);
  const categoryMultiple = multipleFor(protocol.category, multiples);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const breadthMult = 1 + Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_chains) * model.breadth_per_chain;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * categoryMultiple * growthMult * maturityMult * breadthMult));
  return { implied, categoryMultiple, growthPct, growthMult, maturityMult, breadthMult, age };
}

/**
 * Each category's peers' record: how many of the snapshot's protocols in
 * that category already carry a token, out of how many are in it. Counts
 * only — no smoothing, no probability. The board shows the count, which a
 * reader can check against the Live tab; it does not enter the implied
 * value.
 */
export function peersRecord(snapshot: Snapshot): { by_category: Record<string, PeersRecord>; global: PeersRecord } {
  const counts = new Map<string, { live: number; total: number }>();
  let liveTotal = 0;
  for (const p of snapshot.protocols) {
    const key = p.category ?? 'Other';
    const c = counts.get(key) ?? { live: 0, total: 0 };
    c.total++;
    if (!isPreToken(p)) {
      c.live++;
      liveTotal++;
    }
    counts.set(key, c);
  }
  const byCategory: Record<string, PeersRecord> = {};
  for (const [cat, c] of [...counts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    byCategory[cat] = { live_peers: c.live, total_peers: c.total };
  }
  return { by_category: byCategory, global: { live_peers: liveTotal, total_peers: snapshot.protocols.length } };
}

/** The protocols the board ranks, strongest first, with ranks 1..n.
 * Every row is scored by the multiplicative model (TVL x category multiple
 * x growth x maturity x breadth) — the same arithmetic the dashboard
 * recomputes in the open, so a reader can check any row by hand. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const multiples = categoryMultiples(snapshot, model);
  const peers = peersRecord(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable pre-token protocol, below the floor or
  // left out of the watchlist — the radar exists to find these, not to stop at 40.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, multiples, model);
    const peer = peers.by_category[p.category ?? 'Other'] ?? peers.global;
    return { p, v, implied: v.implied, peer };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    is_watchlist: watchlist.has(s.p.slug),
    age_days: s.v.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: round4(s.v.categoryMultiple),
      growth_pct: s.v.growthPct,
      growth_multiplier: round4(s.v.growthMult),
      maturity_multiplier: round4(s.v.maturityMult),
      breadth_multiplier: round4(s.v.breadthMult),
      age_days: s.v.age,
    },
    peers: s.peer,
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
    farm_verdict: farmVerdict(s.p, s.v.age, s.implied),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
export function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
export function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('risk') || c.includes('curator') || c.includes('allocator'))
    return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares.`;
  if (c.includes('basis trading')) return `Deposit $${capital} of USDC as margin on ${name} and open one small delta-neutral basis position.`;
  if (c.includes('cedefi')) return `Deposit $${capital} of USDC into ${name}'s CeDeFi yield product on ${chain} and keep the position open.`;
  if (c.includes('collateral')) return `Supply $${capital} of collateral to ${name} on ${chain} and borrow a small amount against it.`;
  if (c.includes('cdp')) return `Lock $${capital} of collateral in ${name} on ${chain} and mint its stable asset against it.`;
  if (c.includes('payment')) return `Route $${capital} of payments through ${name} on ${chain} and keep the receipts.`;
  if (c === 'chain') return `Bridge $${capital} to ${chain} and use one core app on the chain through ${name}.`;
  if (c.includes('staking pool') || c.includes('staking') || c.includes('restak'))
    return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
  if (c.includes('governance')) return `Deposit $${capital} into ${name} on ${chain} and vote or lock in its governance.`;
  if (c.includes('stablecoin wrapper') || c.includes('stable'))
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('lend')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('yield')) return `Deposit $${capital} into ${name}'s main yield vault on ${chain} and keep the shares.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield-bearing asset on ${chain} and hold it.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 * It never promises a token: a protocol "records no token", and no step pays anyone to claim one.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page from its own site and claim only from the link it publishes; never pay anyone to claim, and never click a claim link from a message.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** A protocol's farm verdict: the all-in cost of one farm position, from the farm plan's own numbers. */
export function farmVerdict(p: SnapshotProtocol, age: number | null, implied: number): FarmVerdict {
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  // Setup gas follows step 2 of the farm plan ($8 where the capital is $150 or more, else $4),
  // weekly gas follows step 3 ($2 a week), and checking or claiming costs nothing (step 5).
  const totalCost = capital + (capital >= 150 ? 8 : 4) + 2 * Math.ceil(hold / 7);
  const ratio = implied / totalCost;
  const verdict: FarmVerdict['verdict'] =
    ratio >= 1_000_000 && implied >= 10_000_000 ? 'Strong' : ratio >= 100_000 ? 'Worth a look' : 'Thin';
  return { total_cost_usd: totalCost, value_per_dollar: Math.round(ratio), verdict };
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_per_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? Math.round((p.mcap_usd / p.tvl_usd) * 1e4) / 1e4 : null,
    }));
}

/** A board row's compact form for data.js, with the farm plan derived in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    is_watchlist: row.is_watchlist,
    peers: row.peers,
    farm_verdict: row.farm_verdict,
  };
}

/** How many pre-token protocols each exclusion reason keeps off the board, counted once under the first reason that excludes it. */
export function exclusionCounts(snapshot: Snapshot): ExclusionCounts {
  const counts: ExclusionCounts = { by_category: 0, versioned: 0, wrapped: 0, exchange: 0 };
  for (const p of snapshot.protocols) {
    if (!isPreToken(p) || isRankable(p)) continue;
    if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) counts.by_category++;
    else if (VERSIONED.test(p.name)) counts.versioned++;
    else if (WRAPPED_WORD.test(p.name)) counts.wrapped++;
    else if (EXCHANGE_PREFIX.test(p.name)) counts.exchange++;
  }
  return counts;
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
  validation?: ModelValidation,
  version: string = MODEL_VERSION,
): { board: BoardRow[]; radar: RadarData } {
  const peers = peersRecord(snapshot);
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const multiples = categoryMultiples(snapshot, model);
  const early = board.filter((r) => !r.is_watchlist).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: version,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    total_implied_usd: board.reduce((sum, r) => sum + r.implied_value_usd, 0),
    multiples,
    validation,
    peers_by_category: peers,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
