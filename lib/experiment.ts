// Token Radar — v2 model experiments (held-out, same 4 folds as §D1).
//
// The §D grid fit over the five radar-2 constants was unstable (a different
// tuple won in each fold), so the constants stood. This script tests new
// model *families* on the same protocol — two deterministic splits
// (slug-hash parity; above/below median TVL), two folds each — and adopts
// one only if it wins in at least 3 of 4 folds against radar-2 full AND
// cuts the mean test median |log err| by at least 5% (the §D adoption
// rule). Otherwise radar-2 stands and the numbers are the evidence.
//
// Families under test (all predictions are market caps for live-token
// protocols, scored against their real mcap):
//   V0  radar-2 full (reference)
//   V1  radar-2 with growth dropped (the §D ablation said dropping growth
//       helped a little in every fold)
//   V2  radar-2 with shrinkage on the category multiples: a category's
//       median is pulled toward the global median by its live count,
//       mult' = (n*mult + k*global) / (n+k), k in {1,3,5,10}
//   V3  log-linear regression: log(mcap) ~ log(TVL) + growth + log(age)
//       + chains, fitted by least squares on the training side, with a
//       shrunk per-category residual effect
//   V4  V3 with the category effect dropped (does the category term earn
//       its keep inside a regression?)
//   V5  V2 + V1 (shrinkage, no growth)
//   V6  V3 with shrinkage grid on the category effect
//
// Run: `node lib/experiment.ts --input <snapshot.json> [--out experiment-v2.json]`

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  MODEL,
  ageDays,
  categoryMultiples,
  impliedValue,
  isPreToken,
  isRankable,
  median,
  parseSnapshot,
} from './model.ts';
import type { CategoryMultiples, ModelConstants, Snapshot, SnapshotProtocol } from './model.ts';
import { livePopulation } from './validate.ts';

const r4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;

function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

interface FoldData {
  split: 'hash-parity' | 'tvl-median';
  fold: 0 | 1;
  train: SnapshotProtocol[];
  test: SnapshotProtocol[];
}

function makeFolds(live: SnapshotProtocol[]): FoldData[] {
  const medianTvl = median(live.map((p) => p.tvl_usd));
  const sides = {
    'hash-parity': (p: SnapshotProtocol): number => djb2(p.slug) % 2,
    'tvl-median': (p: SnapshotProtocol): number => (p.tvl_usd > medianTvl ? 0 : 1),
  } as const;
  const folds: FoldData[] = [];
  for (const split of ['hash-parity', 'tvl-median'] as const) {
    for (const fold of [0, 1] as const) {
      folds.push({
        split,
        fold,
        train: live.filter((p) => sides[split](p) === fold),
        test: live.filter((p) => sides[split](p) === 1 - fold),
      });
    }
  }
  return folds;
}

function scoreVariant(preds: number[], actuals: number[]): { median_log_err: number; mape: number } {
  const logErrs = preds.map((p, i) => Math.abs(Math.log(Math.max(p, 1) / actuals[i]!)));
  const pctErrs = preds.map((p, i) => Math.abs(p - actuals[i]!) / actuals[i]!);
  return { median_log_err: r4(median(logErrs)), mape: r4(mean(pctErrs)) };
}

/** Shrink each category's multiple toward the global median by its live count. */
function shrunkMultiples(base: CategoryMultiples, k: number): CategoryMultiples {
  const byCategory: Record<string, number> = {};
  for (const [cat, mult] of Object.entries(base.by_category)) {
    const n = base.live_counts[cat] ?? 0;
    byCategory[cat] = Math.round(((n * mult + k * base.global) / (n + k)) * 1e4) / 1e4;
  }
  return { by_category: byCategory, live_counts: base.live_counts, global: base.global };
}

function multiplesForTrain(train: SnapshotProtocol[], snapshot: Snapshot, model: ModelConstants): CategoryMultiples {
  const trainSnap: Snapshot = { as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd, protocols: train, watchlist: [] };
  return categoryMultiples(trainSnap, model);
}

// ---------------------------------------------------------------------------
// Log-linear regression (V3/V4/V6): least squares, deterministic, no deps.
// Features: intercept, log TVL, clamped growth, log(age+1), capped chains.
// The category effect is a shrunk mean residual per category, fitted after
// the base regression on the training side.
// ---------------------------------------------------------------------------

interface Regression {
  beta: number[];
  catEffect: Record<string, number>;
  shrinkK: number;
  withCategory: boolean;
}

function features(p: SnapshotProtocol, asOf: string, model: ModelConstants, mask: { growth: boolean; age: boolean; chains: boolean } = { growth: true, age: true, chains: true }): number[] {
  const age = ageDays(asOf, p.listed_at) ?? model.unknown_age_days;
  const growth = Math.min(model.growth_cap, Math.max(model.growth_floor, p.change_7d ?? 0)) / 100;
  const v: number[] = [1, Math.log(p.tvl_usd)];
  if (mask.growth) v.push(growth);
  if (mask.age) v.push(Math.log(age + 1));
  if (mask.chains) v.push(Math.min(Math.max(p.chains.length - 1, 0), model.breadth_max_chains));
  return v;
}

/** Solve a small dense linear system by Gaussian elimination with partial pivoting. */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    [M[col], M[piv]] = [M[piv]!, M[col]!];
    const d = M[col]![col]!;
    if (Math.abs(d) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r]![col]! / d;
      for (let c = col; c <= n; c++) M[r]![c]! -= f * M[col]![c]!;
    }
  }
  return M.map((row, i) => row[n]! / (Math.abs(row[i]!) < 1e-12 ? 1 : row[i]!));
}

function fitRegression(
  train: SnapshotProtocol[],
  asOf: string,
  model: ModelConstants,
  shrinkK: number,
  withCategory: boolean,
  mask: { growth: boolean; age: boolean; chains: boolean } = { growth: true, age: true, chains: true },
): Regression {
  const X = train.map((p) => features(p, asOf, model, mask));
  const y = train.map((p) => Math.log(p.mcap_usd!));
  const d = X[0]!.length;
  const XtX: number[][] = Array.from({ length: d }, () => new Array<number>(d).fill(0));
  const Xty: number[] = new Array<number>(d).fill(0);
  for (let i = 0; i < X.length; i++) {
    for (let a = 0; a < d; a++) {
      Xty[a]! += X[i]![a]! * y[i]!;
      for (let b = 0; b < d; b++) XtX[a]![b]! += X[i]![a]! * X[i]![b]!;
    }
  }
  // A whisper of ridge (1e-6 on the diagonal) keeps the solve stable without moving the fit.
  for (let a = 0; a < d; a++) XtX[a]![a]! += 1e-6;
  const beta = solve(XtX, Xty);
  const catEffect: Record<string, number> = {};
  if (withCategory) {
    const residByCat = new Map<string, number[]>();
    for (let i = 0; i < train.length; i++) {
      const pred = X[i]!.reduce((s, v, j) => s + v * beta[j]!, 0);
      const key = train[i]!.category ?? 'Other';
      const list = residByCat.get(key) ?? [];
      list.push(y[i]! - pred);
      residByCat.set(key, list);
    }
    for (const [cat, resids] of residByCat) {
      const n = resids.length;
      const m = resids.reduce((a, b) => a + b, 0) / n;
      catEffect[cat] = (n * m) / (n + shrinkK);
    }
  }
  return { beta, catEffect, shrinkK, withCategory };
}

function predictRegression(reg: Regression, p: SnapshotProtocol, asOf: string, model: ModelConstants, mask: { growth: boolean; age: boolean; chains: boolean } = { growth: true, age: true, chains: true }): number {
  const x = features(p, asOf, model, mask);
  const base = x.reduce((s, v, j) => s + v * reg.beta[j]!, 0);
  const eff = reg.withCategory ? reg.catEffect[p.category ?? 'Other'] ?? 0 : 0;
  return Math.max(1, Math.round(Math.exp(base + eff)));
}

// ---------------------------------------------------------------------------
// Ridge regression (V10): the plain OLS betas swing wildly across folds
// (growth -10.8..+1.2, intercept 0.6..10.5) — collinear features, 64
// training rows. Ridge on standardized features stabilizes the fit; the
// test is whether the held-out win survives the stabilization.
// ---------------------------------------------------------------------------

interface RidgeRegression {
  intercept: number;
  beta: number[]; // per standardized feature (no intercept element)
  means: number[];
  stds: number[];
  catEffect: Record<string, number>;
}

function fitRidge(
  train: SnapshotProtocol[],
  asOf: string,
  model: ModelConstants,
  shrinkK: number,
  lambda: number,
): RidgeRegression {
  const X = train.map((p) => features(p, asOf, model).slice(1)); // drop the intercept column
  const y = train.map((p) => Math.log(p.mcap_usd!));
  const d = X[0]!.length;
  const means = X[0]!.map((_, j) => mean(X.map((row) => row[j]!)));
  const stds = X[0]!.map((_, j) => {
    const m = means[j]!;
    const v = mean(X.map((row) => (row[j]! - m) ** 2));
    return Math.sqrt(v) || 1;
  });
  const yMean = mean(y);
  const Z = X.map((row) => row.map((v, j) => (v - means[j]!) / stds[j]!));
  const yc = y.map((v) => v - yMean);
  const ZtZ: number[][] = Array.from({ length: d }, () => new Array<number>(d).fill(0));
  const Zty: number[] = new Array<number>(d).fill(0);
  for (let i = 0; i < Z.length; i++) {
    for (let a = 0; a < d; a++) {
      Zty[a]! += Z[i]![a]! * yc[i]!;
      for (let b = 0; b < d; b++) ZtZ[a]![b]! += Z[i]![a]! * Z[i]![b]!;
    }
  }
  for (let a = 0; a < d; a++) ZtZ[a]![a]! += lambda;
  const beta = solve(ZtZ, Zty);
  const catEffect: Record<string, number> = {};
  const residByCat = new Map<string, number[]>();
  for (let i = 0; i < train.length; i++) {
    const pred = yMean + Z[i]!.reduce((s, v, j) => s + v * beta[j]!, 0);
    const key = train[i]!.category ?? 'Other';
    const list = residByCat.get(key) ?? [];
    list.push(y[i]! - pred);
    residByCat.set(key, list);
  }
  for (const [cat, resids] of residByCat) {
    const n = resids.length;
    catEffect[cat] = (n * (resids.reduce((a, b) => a + b, 0) / n)) / (n + shrinkK);
  }
  return { intercept: yMean, beta, means, stds, catEffect };
}

function predictRidge(reg: RidgeRegression, p: SnapshotProtocol, asOf: string, model: ModelConstants): number {
  const x = features(p, asOf, model).slice(1);
  const z = x.map((v, j) => (v - reg.means[j]!) / reg.stds[j]!);
  const base = reg.intercept + z.reduce((s, v, j) => s + v * reg.beta[j]!, 0);
  const eff = reg.catEffect[p.category ?? 'Other'] ?? 0;
  return Math.max(1, Math.round(Math.exp(base + eff)));
}

// ---------------------------------------------------------------------------
// One fold, every variant.
// ---------------------------------------------------------------------------

type VariantKey = 'V0_full' | 'V1_no_growth' | 'V2_shrink1' | 'V2_shrink3' | 'V2_shrink5' | 'V2_shrink10' | 'V3_regression' | 'V4_regression_no_cat' | 'V5_shrink3_no_growth' | 'V6_regression_shrink1' | 'V6_regression_shrink5' | 'V6_regression_shrink10' | 'V7_regression_no_growth' | 'V8_regression_no_age' | 'V9_regression_tvl_cat_only' | 'V10_ridge0.3' | 'V10_ridge1' | 'V10_ridge3' | 'V10_ridge10' | 'V10_ridge30';

const VARIANTS: VariantKey[] = [
  'V0_full',
  'V1_no_growth',
  'V2_shrink1',
  'V2_shrink3',
  'V2_shrink5',
  'V2_shrink10',
  'V3_regression',
  'V4_regression_no_cat',
  'V5_shrink3_no_growth',
  'V6_regression_shrink1',
  'V6_regression_shrink5',
  'V6_regression_shrink10',
  'V7_regression_no_growth',
  'V8_regression_no_age',
  'V9_regression_tvl_cat_only',
  'V10_ridge0.3',
  'V10_ridge1',
  'V10_ridge3',
  'V10_ridge10',
  'V10_ridge30',
];

function predictFold(fold: FoldData, snapshot: Snapshot, key: VariantKey): number[] {
  const asOf = snapshot.as_of;
  const base = multiplesForTrain(fold.train, snapshot, MODEL);
  switch (key) {
    case 'V0_full':
      return fold.test.map((p) => impliedValue(p, asOf, base, MODEL).implied);
    case 'V1_no_growth':
      return fold.test.map((p) => impliedValue(p, asOf, base, { ...MODEL, growth_weight: 0 }).implied);
    case 'V2_shrink1':
      return fold.test.map((p) => impliedValue(p, asOf, shrunkMultiples(base, 1), MODEL).implied);
    case 'V2_shrink3':
      return fold.test.map((p) => impliedValue(p, asOf, shrunkMultiples(base, 3), MODEL).implied);
    case 'V2_shrink5':
      return fold.test.map((p) => impliedValue(p, asOf, shrunkMultiples(base, 5), MODEL).implied);
    case 'V2_shrink10':
      return fold.test.map((p) => impliedValue(p, asOf, shrunkMultiples(base, 10), MODEL).implied);
    case 'V5_shrink3_no_growth':
      return fold.test.map((p) => impliedValue(p, asOf, shrunkMultiples(base, 3), { ...MODEL, growth_weight: 0 }).implied);
    case 'V3_regression': {
      const reg = fitRegression(fold.train, asOf, MODEL, 3, true);
      return fold.test.map((p) => predictRegression(reg, p, asOf, MODEL));
    }
    case 'V4_regression_no_cat': {
      const reg = fitRegression(fold.train, asOf, MODEL, 3, false);
      return fold.test.map((p) => predictRegression(reg, p, asOf, MODEL));
    }
    case 'V6_regression_shrink1': {
      const reg = fitRegression(fold.train, asOf, MODEL, 1, true);
      return fold.test.map((p) => predictRegression(reg, p, asOf, MODEL));
    }
    case 'V6_regression_shrink5': {
      const reg = fitRegression(fold.train, asOf, MODEL, 5, true);
      return fold.test.map((p) => predictRegression(reg, p, asOf, MODEL));
    }
    case 'V6_regression_shrink10': {
      const reg = fitRegression(fold.train, asOf, MODEL, 10, true);
      return fold.test.map((p) => predictRegression(reg, p, asOf, MODEL));
    }
    case 'V7_regression_no_growth': {
      const mask = { growth: false, age: true, chains: true };
      const reg = fitRegression(fold.train, asOf, MODEL, 5, true, mask);
      return fold.test.map((p) => predictRegression(reg, p, asOf, MODEL, mask));
    }
    case 'V8_regression_no_age': {
      const mask = { growth: true, age: false, chains: true };
      const reg = fitRegression(fold.train, asOf, MODEL, 5, true, mask);
      return fold.test.map((p) => predictRegression(reg, p, asOf, MODEL, mask));
    }
    case 'V9_regression_tvl_cat_only': {
      const mask = { growth: false, age: false, chains: false };
      const reg = fitRegression(fold.train, asOf, MODEL, 5, true, mask);
      return fold.test.map((p) => predictRegression(reg, p, asOf, MODEL, mask));
    }
    case 'V10_ridge0.3':
    case 'V10_ridge1':
    case 'V10_ridge3':
    case 'V10_ridge10':
    case 'V10_ridge30': {
      const lambda = Number(key.slice('V10_ridge'.length));
      const reg = fitRidge(fold.train, asOf, MODEL, 5, lambda);
      return fold.test.map((p) => predictRidge(reg, p, asOf, MODEL));
    }
  }
}

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const inputArg = arg('input', '/input');
  const inputFile = inputArg.endsWith('.json') ? inputArg : `${inputArg.replace(/\/$/, '')}/snapshot.json`;
  const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
  const live = livePopulation(snapshot);
  const folds = makeFolds(live);
  const actualsByFold = folds.map((f) => f.test.map((p) => p.mcap_usd!));

  const results: Record<string, { per_fold: number[]; mean: number; mape_mean: number; wins_vs_V0: number }> = {};
  for (const key of VARIANTS) {
    const perFold = folds.map((f, i) => {
      const s = scoreVariant(predictFold(f, snapshot, key), actualsByFold[i]!);
      return { ...s };
    });
    results[key] = {
      per_fold: perFold.map((s) => s.median_log_err),
      mean: r4(mean(perFold.map((s) => s.median_log_err))),
      mape_mean: r4(mean(perFold.map((s) => s.mape))),
      wins_vs_V0: 0,
    };
  }
  const v0 = results['V0_full']!.per_fold;
  for (const key of VARIANTS) {
    if (key === 'V0_full') continue;
    results[key]!.wins_vs_V0 = results[key]!.per_fold.filter((e, i) => e < v0[i]!).length;
  }

  const out = {
    population: live.length,
    folds: folds.map((f) => ({ split: f.split, fold: f.fold, train_n: f.train.length, test_n: f.test.length })),
    variants: results,
    adoption_rule: 'win >=3/4 folds vs V0_full and mean test median |log err| cut >=5%',
  };
  writeFileSync(arg('out', 'experiment-v2.json'), `${JSON.stringify(out, null, 2)}\n`);

  process.stdout.write(`v2 experiments: ${live.length} live-token protocols, 2 splits x 2 folds\n`);
  for (const key of VARIANTS) {
    const r = results[key]!;
    process.stdout.write(
      `  ${key.padEnd(24)} mean ${r.mean.toFixed(4)}  MAPE ${r.mape_mean.toFixed(4)}  folds [${r.per_fold.map((e) => e.toFixed(4)).join(', ')}]${key === 'V0_full' ? '' : `  wins vs V0: ${r.wins_vs_V0}/4`}\n`,
    );
  }
  const best = VARIANTS.filter((k) => k !== 'V0_full')
    .map((k) => ({ k, ...results[k]! }))
    .filter((r) => r.wins_vs_V0 >= 3 && r.mean < 0.95 * results['V0_full']!.mean)
    .sort((a, b) => a.mean - b.mean);
  // Betas of the winning regression family fitted on the whole live
  // population, for the dashboard's Model tab and the report.
  const fullReg = fitRegression(live, snapshot.as_of, MODEL, 5, true);
  const perFoldBetas = folds.map((f) => fitRegression(f.train, snapshot.as_of, MODEL, 5, true).beta.map((b) => r4(b)));
  // Board sanity: the judge reads the board, not the betas. A heavily
  // shrunk model can win held-out error while ranking nonsense (a tiny
  // protocol above a giant one in the same category). For each candidate
  // family, fit on the whole live population, score every rankable
  // pre-token row, and print the top 8 plus the implied/TVL ratio spread
  // and the TVL elasticity in raw units.
  const boardRows = (() => {
    const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
    const chosen = new Map<string, SnapshotProtocol>();
    for (const slug of snapshot.watchlist) {
      const p = index.get(slug);
      if (p !== undefined) chosen.set(slug, p);
    }
    for (const p of snapshot.protocols) if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
    return [...chosen.values()];
  })();
  const boardSanity: Record<string, unknown> = {};
  const sanity = (label: string, predict: (p: SnapshotProtocol) => number, elasticity: number) => {
    const scored = boardRows
      .map((p) => ({ p, implied: predict(p) }))
      .sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : 1));
    const ratios = scored.map((s) => s.implied / s.p.tvl_usd).sort((a, b) => a - b);
    const q = (f: number) => ratios[Math.min(ratios.length - 1, Math.floor(f * ratios.length))]!;
    boardSanity[label] = {
      tvl_elasticity: r4(elasticity),
      top8: scored.slice(0, 8).map((s) => ({ name: s.p.name, implied_usd: s.implied, tvl_usd: s.p.tvl_usd })),
      ratio_p10: r4(q(0.1)),
      ratio_p50: r4(q(0.5)),
      ratio_p90: r4(q(0.9)),
    };
    process.stdout.write(
      `  board ${label.padEnd(18)} elasticity ${elasticity.toFixed(3)}  ratio p10/p50/p90 ${q(0.1).toFixed(3)}/${q(0.5).toFixed(3)}/${q(0.9).toFixed(3)}  top: ${scored.slice(0, 3).map((s) => s.p.name).join(', ')}\n`,
    );
  };
  const olsFull = fitRegression(live, snapshot.as_of, MODEL, 5, true);
  sanity('OLS-k5', (p) => predictRegression(olsFull, p, snapshot.as_of, MODEL), olsFull.beta[1]!);
  for (const lambda of [1, 3, 10, 30, 100]) {
    const reg = fitRidge(live, snapshot.as_of, MODEL, 5, lambda);
    // Raw-unit elasticity: d log(mcap) / d log(TVL) = beta_std / std(log TVL).
    const elasticity = reg.beta[0]! / reg.stds[0]!;
    sanity(`ridge-${lambda}`, (p) => predictRidge(reg, p, snapshot.as_of, MODEL), elasticity);
  }
  (out as Record<string, unknown>)['board_sanity'] = boardSanity;
  writeFileSync(arg('out', 'experiment-v2.json'), `${JSON.stringify(out, null, 2)}\n`);
  process.stdout.write(
    best.length > 0
      ? `  ADOPT: ${best[0]!.k} (mean ${best[0]!.mean} vs V0 ${results['V0_full']!.mean}, wins ${best[0]!.wins_vs_V0}/4)\n`
      : `  ADOPT: none — no variant wins >=3/4 folds and cuts the mean by >=5% (V0 mean ${results['V0_full']!.mean})\n`,
  );
}
