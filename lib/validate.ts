// Token Radar — held-out validation of the radar-3 valuation model (spec §D1, v2).
//
// The model's claim is that a live token's market cap is predictable from a
// ridge regression on log TVL, 7-day growth, log age and chain count, plus a
// shrunk per-category residual effect. This script tests that claim on the
// snapshot's own live-token protocols, which the board never ranks: two
// deterministic splits (slug-hash parity; above/below the median TVL), two
// folds each, so every live protocol is held out exactly twice. Every fit
// is done on the training side only, so the test side is genuinely unseen.
//
// Variants per fold: the full model, a baseline (TVL x the training side's
// global median, nothing else), and four ablations that each drop one term.
// A term earns its keep only if dropping it raises the held-out error in a
// majority of folds. A small grid over the ridge penalty lambda is selected
// on each fold's training side and scored on its test side; lambda moves
// only if one value wins in at least 3 of 4 folds and cuts the mean test
// error by at least 5% — otherwise the current lambda stands, and the fit
// is reported as the evidence for keeping it.
//
// Run standalone: `node lib/validate.ts --input <snapshot.json> [--out validation.json]`
// main.ts imports validateModel and embeds the summary in RadarData.validation.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  REGRESSION_LAMBDA,
  REGRESSION_SHRINK_K,
  categoryMultiples,
  fitRidgeRegression,
  isPreToken,
  median,
  parseSnapshot,
  predictRegressionValue,
} from './model.ts';
import type {
  ExclusionCounts,
  FittedConstants,
  ModelValidation,
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

/** The live-token protocols the regression is fitted on: a market cap and a TVL, both positive. */
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

/** Every variant's predictions for one side, fitted on the training side only. */
function predictAll(
  side: SnapshotProtocol[],
  asOf: string,
  train: SnapshotProtocol[],
  snapshot: Snapshot,
  lambda: number,
): Record<'full' | 'baseline' | 'no_growth' | 'no_maturity' | 'no_breadth' | 'no_category', number[]> {
  const trainSnap: Snapshot = { as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd, protocols: train, watchlist: [] };
  const multiples = categoryMultiples(trainSnap);
  const full = fitRidgeRegression(train, asOf, lambda, REGRESSION_SHRINK_K);
  const noGrowth = fitRidgeRegression(train, asOf, lambda, REGRESSION_SHRINK_K, [true, false, true, true]);
  const noAge = fitRidgeRegression(train, asOf, lambda, REGRESSION_SHRINK_K, [true, true, false, true]);
  const noChains = fitRidgeRegression(train, asOf, lambda, REGRESSION_SHRINK_K, [true, true, true, false]);
  const noCategory = fitRidgeRegression(train, asOf, lambda, REGRESSION_SHRINK_K, [true, true, true, true], false);
  const out: Record<string, number[]> = { full: [], baseline: [], no_growth: [], no_maturity: [], no_breadth: [], no_category: [] };
  for (const p of side) {
    out.full!.push(predictRegressionValue(full, p, asOf));
    out.baseline!.push(Math.max(1, Math.round(p.tvl_usd * multiples.global)));
    out.no_growth!.push(predictRegressionValue(noGrowth, p, asOf));
    out.no_maturity!.push(predictRegressionValue(noAge, p, asOf));
    out.no_breadth!.push(predictRegressionValue(noChains, p, asOf));
    out.no_category!.push(predictRegressionValue(noCategory, p, asOf));
  }
  return out as Record<'full' | 'baseline' | 'no_growth' | 'no_maturity' | 'no_breadth' | 'no_category', number[]>;
}

/** One fold scored under one lambda: every variant against the held-out side's real market caps. */
function evaluateFold(fold: FoldData, snapshot: Snapshot, lambda: number): ValidationFold {
  const preds = predictAll(fold.test, snapshot.as_of, fold.train, snapshot, lambda);
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

/** The median |log err| of one lambda on one side, fitted on that fold's training side. */
function lambdaMedianLogErr(lambda: number, fold: FoldData, snapshot: Snapshot, side: 'train' | 'test'): number {
  const fit = fitRidgeRegression(fold.train, snapshot.as_of, lambda, REGRESSION_SHRINK_K);
  const rows = side === 'train' ? fold.train : fold.test;
  const preds = rows.map((p) => predictRegressionValue(fit, p, snapshot.as_of));
  const actuals = rows.map((p) => p.mcap_usd!);
  return scoreVariant(preds, actuals).median_log_err;
}

const LAMBDAS = [1, 3, 10, 30];
const lambdaKey = (t: FittedConstants): string => `${t.lambda}/${t.shrink_k}`;

/** The full held-out result: four folds, ablations, and the lambda grid's keep-or-adopt decision. */
export function validateModel(snapshot: Snapshot, lambda: number = REGRESSION_LAMBDA): ValidationResult {
  const live = livePopulation(snapshot);
  const folds = makeFolds(live);
  const scored = folds.map((f) => evaluateFold(f, snapshot, lambda));
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

  // Grid fit: each fold's training-best lambda, then the modal lambda scored on every fold's test side.
  const bestPerFold = folds.map((fold) => {
    let best: FittedConstants | null = null;
    let bestTrain = Infinity;
    for (const l of LAMBDAS) {
      const err = lambdaMedianLogErr(l, fold, snapshot, 'train');
      if (err < bestTrain - 1e-12) {
        bestTrain = err;
        best = { lambda: l, shrink_k: REGRESSION_SHRINK_K };
      }
    }
    return { ...best!, train_median_log_err: r4(bestTrain), test_median_log_err: r4(lambdaMedianLogErr(best!.lambda, fold, snapshot, 'test')) };
  });
  const counts = new Map<string, { tuple: FittedConstants; n: number }>();
  for (const b of bestPerFold) {
    const k = lambdaKey(b);
    const entry = counts.get(k) ?? { tuple: b, n: 0 };
    entry.n++;
    counts.set(k, entry);
  }
  const modal = [...counts.values()].sort((a, b) => b.n - a.n || 0)[0]!;
  const bestTestMean = r4(mean(folds.map((f) => lambdaMedianLogErr(modal.tuple.lambda, f, snapshot, 'test'))));
  const currentTestMean = r4(mean(scored.map((s) => s.full.median_log_err)));
  const adopted =
    modal.n >= 3 && bestTestMean < 0.95 * currentTestMean ? modal.tuple : null;
  const keepReason =
    adopted !== null
      ? `adopted: lambda ${modal.tuple.lambda} won in ${modal.n} of 4 folds and cut mean test median |log err| from ${currentTestMean} to ${bestTestMean}`
      : modal.n < 3
        ? `kept: no lambda won in 3 of 4 folds (best won in ${modal.n}); lambda ${lambda} stands`
        : bestTestMean < currentTestMean
          ? `kept: lambda ${modal.tuple.lambda} won in ${modal.n} of 4 folds but cut mean test median |log err| only from ${currentTestMean} to ${bestTestMean} (under the 5% bar)`
          : `kept: lambda ${modal.tuple.lambda} won in ${modal.n} of 4 folds on training error but its mean test median |log err| was ${bestTestMean}, worse than lambda ${lambda}'s ${currentTestMean}`;
  return {
    population: live.length,
    splits: ['hash-parity', 'tvl-median'],
    folds: scored,
    means,
    terms_help_in_folds,
    grid: { best_per_fold: bestPerFold, current_test_mean: currentTestMean, best_test_mean: bestTestMean, adopted, keep_reason: keepReason },
  };
}

/** The compact summary the dashboard carries, under the lambda it actually runs. */
export function summarizeValidation(
  result: ValidationResult,
  lambdaUsed: number,
  snapshot: Snapshot,
  excluded: ExclusionCounts,
): ModelValidation {
  const kept = lambdaUsed === REGRESSION_LAMBDA;
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
      lambda: lambdaUsed,
      shrink_k: REGRESSION_SHRINK_K,
    },
    constants_kept: kept,
    keep_reason: kept
      ? result.grid.keep_reason
      : 'adopted from the held-out lambda grid: the fitted lambda won in at least 3 of 4 folds and cut mean test error by at least 5%',
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
  const result = validateModel(snapshot, REGRESSION_LAMBDA);
  writeFileSync(arg('out', 'validation.json'), `${JSON.stringify(result, null, 2)}\n`);
  const m = result.means;
  process.stdout.write(
    `held-out validation (radar-3): ${result.population} live-token protocols, 2 splits x 2 folds\n` +
      `  full model      median |log err| ${m.full.median_log_err}  MAPE ${m.full.mape}\n` +
      `  baseline        median |log err| ${m.baseline.median_log_err}  MAPE ${m.baseline.mape}\n` +
      `  no growth       median |log err| ${m.no_growth.median_log_err}  (term helps in ${result.terms_help_in_folds.growth}/4 folds)\n` +
      `  no age          median |log err| ${m.no_maturity.median_log_err}  (term helps in ${result.terms_help_in_folds.maturity}/4 folds)\n` +
      `  no chains       median |log err| ${m.no_breadth.median_log_err}  (term helps in ${result.terms_help_in_folds.breadth}/4 folds)\n` +
      `  no category     median |log err| ${m.no_category.median_log_err}  (term helps in ${result.terms_help_in_folds.category}/4 folds)\n` +
      `  grid fit: ${result.grid.keep_reason}\n`,
  );
}
