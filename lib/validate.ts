// Token Radar — held-out validation of the valuation model (spec §D1).
//
// The model's claim is that a live token's market cap is predictable from
// TVL x category multiple x growth x maturity x breadth. This script tests
// that claim on the snapshot's own live-token protocols, which the board
// never ranks: two deterministic splits (slug-hash parity; above/below the
// median TVL), two folds each, so every live protocol is held out exactly
// twice. The category multiple is always fitted on the training side only,
// so the test side is genuinely unseen.
//
// Variants per fold: the full model, a baseline (TVL x the training side's
// global median, nothing else), and four ablations that each drop one term.
// A term earns its keep only if dropping it raises the held-out error in a
// majority of folds. A small grid over the four fittable constants is
// selected on each fold's training side and scored on its test side; the
// constants move only if one tuple wins in at least 3 of 4 folds and cuts
// the mean test error by at least 5% — otherwise the current constants
// stand, and the fit is reported as the evidence for keeping them.
//
// Run standalone: `node lib/validate.ts --input <snapshot.json> [--out validation.json]`
// main.ts imports validateModel and embeds the summary in RadarData.validation.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  MODEL,
  categoryMultiples,
  impliedValue,
  isPreToken,
  median,
  parseSnapshot,
} from './model.ts';
import type {
  FittedConstants,
  ModelConstants,
  ModelValidation,
  ExclusionCounts,
  Snapshot,
  SnapshotProtocol,
  ValidationFold,
  ValidationResult,
  ValidationVariantMetrics,
} from './model.ts';

const r4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;

/** djb2, the deterministic hash behind the hash-parity split. */
function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

/** The live-token protocols the category multiples are fitted on: a market cap and a TVL, both positive. */
export function livePopulation(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter(
    (p) =>
      !isPreToken(p) &&
      p.mcap_usd !== null &&
      p.tvl_usd > 0 &&
      Number.isFinite(p.mcap_usd / p.tvl_usd) &&
      p.mcap_usd / p.tvl_usd > 0,
  );
}

interface FoldData {
  split: 'hash-parity' | 'tvl-median';
  fold: 0 | 1;
  train: SnapshotProtocol[];
  test: SnapshotProtocol[];
}

/** The two deterministic splits, each in both directions: four folds in all. */
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

/** The median |log(pred/actual)| and the mean absolute percentage error of one variant on the test side. */
function scoreVariant(preds: number[], actuals: number[]): ValidationVariantMetrics {
  const logErrs = preds.map((p, i) => Math.abs(Math.log(Math.max(p, 1) / actuals[i]!)));
  const pctErrs = preds.map((p, i) => Math.abs(p - actuals[i]!) / actuals[i]!);
  return { median_log_err: r4(median(logErrs)), mape: r4(mean(pctErrs)) };
}

/** Every variant's predictions for one side, under one model and one training-side multiple set. */
function predictAll(
  side: SnapshotProtocol[],
  asOf: string,
  train: SnapshotProtocol[],
  snapshot: Snapshot,
  model: ModelConstants,
): Record<'full' | 'baseline' | 'no_growth' | 'no_maturity' | 'no_breadth' | 'no_category', number[]> {
  const trainSnap: Snapshot = { as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd, protocols: train, watchlist: [] };
  const multiples = categoryMultiples(trainSnap, model);
  const noCategory = { by_category: {} as Record<string, number>, live_counts: multiples.live_counts, global: multiples.global };
  const out: Record<string, number[]> = { full: [], baseline: [], no_growth: [], no_maturity: [], no_breadth: [], no_category: [] };
  for (const p of side) {
    out.full!.push(impliedValue(p, asOf, multiples, model).implied);
    out.baseline!.push(Math.max(1, Math.round(p.tvl_usd * multiples.global)));
    out.no_growth!.push(impliedValue(p, asOf, multiples, { ...model, growth_weight: 0 }).implied);
    out.no_maturity!.push(impliedValue(p, asOf, multiples, { ...model, maturity_floor: 1, maturity_range: 0 }).implied);
    out.no_breadth!.push(impliedValue(p, asOf, multiples, { ...model, breadth_per_chain: 0 }).implied);
    out.no_category!.push(impliedValue(p, asOf, noCategory, model).implied);
  }
  return out as Record<'full' | 'baseline' | 'no_growth' | 'no_maturity' | 'no_breadth' | 'no_category', number[]>;
}

/** One fold scored under one model: every variant against the held-out side's real market caps. */
function evaluateFold(fold: FoldData, snapshot: Snapshot, model: ModelConstants): ValidationFold {
  const preds = predictAll(fold.test, snapshot.as_of, fold.train, snapshot, model);
  const actuals = fold.test.map((p) => p.mcap_usd!);
  return {
    split: fold.split,
    fold: fold.fold,
    train_n: fold.train.length,
    test_n: fold.test.length,
    full: scoreVariant(preds.full, actuals),
    baseline: scoreVariant(preds.baseline, actuals),
    no_growth: scoreVariant(preds.no_growth, actuals),
    no_maturity: scoreVariant(preds.no_maturity, actuals),
    no_breadth: scoreVariant(preds.no_breadth, actuals),
    no_category: scoreVariant(preds.no_category, actuals),
  };
}

/** The median |log err| of one fitted tuple on one side, fitted on that fold's training side. */
function tupleMedianLogErr(tuple: FittedConstants, fold: FoldData, snapshot: Snapshot, side: 'train' | 'test'): number {
  const model: ModelConstants = { ...MODEL, ...tuple };
  const preds = predictAll(side === 'train' ? fold.train : fold.test, snapshot.as_of, fold.train, snapshot, model);
  const actuals = (side === 'train' ? fold.train : fold.test).map((p) => p.mcap_usd!);
  return scoreVariant(preds.full, actuals).median_log_err;
}

// The grid, current constants first so an exact tie keeps them.
const GRID = {
  growth_weight: [0.5, 0.25, 0.75, 0, 1.0],
  maturity_floor: [0.6, 0.5, 0.7],
  breadth_per_chain: [0.015, 0, 0.03],
  clamp: [
    [0.05, 1.2],
    [0.1, 1.0],
  ] as Array<[number, number]>,
};

function* gridTuples(): Generator<FittedConstants> {
  for (const growth_weight of GRID.growth_weight)
    for (const maturity_floor of GRID.maturity_floor)
      for (const breadth_per_chain of GRID.breadth_per_chain)
        for (const [multiple_floor, multiple_cap] of GRID.clamp)
          yield { growth_weight, maturity_floor, breadth_per_chain, multiple_floor, multiple_cap };
}

const tupleKey = (t: FittedConstants): string =>
  [t.growth_weight, t.maturity_floor, t.breadth_per_chain, t.multiple_floor, t.multiple_cap].join('/');

/** The full held-out result: four folds, ablations, and the grid fit's keep-or-adopt decision. */
export function validateModel(snapshot: Snapshot, model: ModelConstants = MODEL): ValidationResult {
  const live = livePopulation(snapshot);
  const folds = makeFolds(live);
  const scored = folds.map((f) => evaluateFold(f, snapshot, model));
  const variantKeys = ['full', 'baseline', 'no_growth', 'no_maturity', 'no_breadth', 'no_category'] as const;
  const means = Object.fromEntries(
    variantKeys.map((k) => [
      k,
      { median_log_err: r4(mean(scored.map((s) => s[k].median_log_err))), mape: r4(mean(scored.map((s) => s[k].mape))) },
    ]),
  ) as ValidationResult['means'];
  const terms_help_in_folds = {
    growth: scored.filter((s) => s.full.median_log_err < s.no_growth.median_log_err).length,
    maturity: scored.filter((s) => s.full.median_log_err < s.no_maturity.median_log_err).length,
    breadth: scored.filter((s) => s.full.median_log_err < s.no_breadth.median_log_err).length,
    category: scored.filter((s) => s.full.median_log_err < s.no_category.median_log_err).length,
  };

  // Grid fit: each fold's training-best tuple, then the modal tuple scored on every fold's test side.
  const bestPerFold = folds.map((fold) => {
    let best: FittedConstants | null = null;
    let bestTrain = Infinity;
    for (const tuple of gridTuples()) {
      const err = tupleMedianLogErr(tuple, fold, snapshot, 'train');
      if (err < bestTrain - 1e-12) {
        bestTrain = err;
        best = tuple;
      }
    }
    return { ...best!, train_median_log_err: r4(bestTrain), test_median_log_err: r4(tupleMedianLogErr(best!, fold, snapshot, 'test')) };
  });
  const counts = new Map<string, { tuple: FittedConstants; n: number }>();
  for (const b of bestPerFold) {
    const k = tupleKey(b);
    const entry = counts.get(k) ?? { tuple: b, n: 0 };
    entry.n++;
    counts.set(k, entry);
  }
  const modal = [...counts.values()].sort((a, b) => b.n - a.n || 0)[0]!;
  const bestTestMean = r4(mean(folds.map((f) => tupleMedianLogErr(modal.tuple, f, snapshot, 'test'))));
  const currentTestMean = r4(mean(scored.map((s) => s.full.median_log_err)));
  const adopted =
    modal.n >= 3 && bestTestMean < 0.95 * currentTestMean ? modal.tuple : null;
  const keepReason =
    adopted !== null
      ? `adopted: fitted tuple ${tupleKey(modal.tuple)} won in ${modal.n} of 4 folds and cut mean test median |log err| from ${currentTestMean} to ${bestTestMean}`
      : modal.n < 3
        ? `kept: no fitted tuple won in 3 of 4 folds (best won in ${modal.n}); the current constants stand`
        : `kept: the fitted tuple won in ${modal.n} of 4 folds but cut mean test median |log err| only from ${currentTestMean} to ${bestTestMean} (under the 5% bar)`;
  return {
    population: live.length,
    splits: ['hash-parity', 'tvl-median'],
    folds: scored,
    means,
    terms_help_in_folds,
    grid: { best_per_fold: bestPerFold, current_test_mean: currentTestMean, best_test_mean: bestTestMean, adopted, keep_reason: keepReason },
  };
}

/** The compact summary the dashboard carries, under the model it actually runs. */
export function summarizeValidation(
  result: ValidationResult,
  modelUsed: ModelConstants,
  snapshot: Snapshot,
  excluded: ExclusionCounts,
): ModelValidation {
  const kept =
    modelUsed.growth_weight === MODEL.growth_weight &&
    modelUsed.maturity_floor === MODEL.maturity_floor &&
    modelUsed.breadth_per_chain === MODEL.breadth_per_chain &&
    modelUsed.multiple_floor === MODEL.multiple_floor &&
    modelUsed.multiple_cap === MODEL.multiple_cap;
  return {
    splits: result.splits,
    folds: result.folds.length,
    per_fold: result.folds,
    full_median_log_err: result.means.full.median_log_err,
    baseline_median_log_err: result.means.baseline.median_log_err,
    ablations: {
      no_growth: result.means.no_growth.median_log_err,
      no_maturity: result.means.no_maturity.median_log_err,
      no_breadth: result.means.no_breadth.median_log_err,
      no_category: result.means.no_category.median_log_err,
    },
    terms_help: result.terms_help_in_folds,
    fitted_constants: {
      growth_weight: modelUsed.growth_weight,
      maturity_floor: modelUsed.maturity_floor,
      breadth_per_chain: modelUsed.breadth_per_chain,
      multiple_floor: modelUsed.multiple_floor,
      multiple_cap: modelUsed.multiple_cap,
    },
    constants_kept: kept,
    keep_reason: kept
      ? result.grid.keep_reason
      : 'adopted from the held-out grid fit: the fitted constants won in at least 3 of 4 folds and cut mean test error by at least 5%',
    as_of: snapshot.as_of,
    source: snapshot.source,
    protocols_total: snapshot.protocols.length,
    live_used: result.population,
    excluded,
  };
}

/** --name <value> out of the arguments, or the fallback. */
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
  const result = validateModel(snapshot, MODEL);
  writeFileSync(arg('out', 'validation.json'), `${JSON.stringify(result, null, 2)}\n`);
  const m = result.means;
  process.stdout.write(
    `held-out validation: ${result.population} live-token protocols, 2 splits x 2 folds\n` +
      `  full model      median |log err| ${m.full.median_log_err}  MAPE ${m.full.mape}\n` +
      `  baseline        median |log err| ${m.baseline.median_log_err}  MAPE ${m.baseline.mape}\n` +
      `  no growth       median |log err| ${m.no_growth.median_log_err}  (term helps in ${result.terms_help_in_folds.growth}/4 folds)\n` +
      `  no maturity     median |log err| ${m.no_maturity.median_log_err}  (term helps in ${result.terms_help_in_folds.maturity}/4 folds)\n` +
      `  no breadth      median |log err| ${m.no_breadth.median_log_err}  (term helps in ${result.terms_help_in_folds.breadth}/4 folds)\n` +
      `  no category     median |log err| ${m.no_category.median_log_err}  (term helps in ${result.terms_help_in_folds.category}/4 folds)\n` +
      `  grid fit: ${result.grid.keep_reason}\n`,
  );
}
