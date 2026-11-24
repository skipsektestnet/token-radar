// Token Radar — experiment: category-specific growth weights (radar-6 candidate).
//
// The growth term is currently one global weight: growthMult = 1 + w * g with
// w = 0.5 for every category, g = clamp(change_7d, -60, 120) / 100. D1 noted
// that deleting growth entirely (w = 0) slightly improves every fold on the
// 4-fold set, and on the radar-5 6-fold set no_growth (1.5359) is a hair better
// than full (1.538) — but far under the 5% adoption bar. The question here is
// whether growth helps in some categories and hurts in others, so a
// per-category weight could beat both the global 0.5 and the global 0.
//
// Candidates (all fitted on the TRAIN side of each fold only, never the test
// side; category multiples and the size curve are likewise train-side only):
//   gw0        — global w = 0 (the D1 candidate, re-tested on the 6-fold set)
//   grid5      — per-category w from a grid search on train median |log err|,
//                categories with >= 5 live train protocols, else global 0.5
//   grid5-k5   — grid5 shrunk toward 0.5 with prior weight k = 5
//   grid8-k5   — grid search, min 8 live, shrunk k = 5
//   ols5-k5    — per-category w from an OLS slope of the log residual on g
//                (with intercept), min 5 live, shrunk k = 5, clipped [-1, 2]
//   ols8-k10   — OLS slope, min 8 live, shrunk k = 10, clipped [-1, 2]
//
// Adoption rule (same as §D, on the 6-fold set): a candidate is adopted only
// if it wins in >= 4 of 6 folds vs the full radar-5 model AND cuts the mean
// test median |log err| by >= 5%. Otherwise the model stays radar-5 and this
// file is only the evidence for keeping it.
//
// The per-protocol prediction replicates lib/model.ts impliedValue exactly
// (same helpers, same constants) except for the growth weight override; a
// self-check asserts the w = 0.5 replication equals impliedValue bit for bit
// on every test protocol, so a divergence cannot silently flatter a variant.
//
// Run: `node lib/experiment-growth.ts --input <snapshot.json>
//        [--out experiment-growth-cat.json]`
// (Node 22 type stripping; run from the entry directory.)

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  MODEL,
  ageDays,
  categoryMultiples,
  fitSizeCurve,
  impliedValue,
  median,
  multipleFor,
  parseSnapshot,
  sizeMultiplier,
} from './model.ts';
import type {
  ModelConstants,
  SizeCurve,
  Snapshot,
  SnapshotProtocol,
} from './model.ts';
import { livePopulation } from './validate.ts';

const r4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const mean = (vs: number[]): number => vs.reduce((a, b) => a + b, 0) / vs.length;

function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

interface FoldData {
  split: 'hash-parity' | 'tvl-median' | 'time';
  fold: 0 | 1;
  train: SnapshotProtocol[];
  test: SnapshotProtocol[];
  curve: SizeCurve;
}

function makeFolds(live: SnapshotProtocol[]): FoldData[] {
  const medianTvl = median(live.map((p) => p.tvl_usd));
  const dated = live.filter((p) => p.listed_at !== null);
  const medianListed = median(dated.map((p) => Date.parse(`${p.listed_at}T00:00:00Z`)));
  const sides = {
    'hash-parity': (p: SnapshotProtocol): number => djb2(p.slug) % 2,
    'tvl-median': (p: SnapshotProtocol): number => (p.tvl_usd > medianTvl ? 0 : 1),
    time: (p: SnapshotProtocol): number => (Date.parse(`${p.listed_at}T00:00:00Z`) <= medianListed ? 0 : 1),
  } as const;
  const folds: FoldData[] = [];
  for (const split of ['hash-parity', 'tvl-median', 'time'] as const) {
    const pool = split === 'time' ? dated : live;
    for (const fold of [0, 1] as const) {
      const train = pool.filter((p) => sides[split](p) === fold);
      const test = pool.filter((p) => sides[split](p) === 1 - fold);
      folds.push({ split, fold, train, test, curve: fitSizeCurve(train) });
    }
  }
  return folds;
}

const finite = (n: number | null, fallback: number): number =>
  n !== null && Number.isFinite(n) ? n : fallback;

/** implied value with an explicit growth weight (replicates impliedValue). */
function predictWithGrowth(
  p: SnapshotProtocol,
  asOf: string,
  multiples: ReturnType<typeof categoryMultiples>,
  model: ModelConstants,
  curve: SizeCurve | undefined,
  w: number,
): number {
  const age = ageDays(asOf, p.listed_at);
  const catMult = multipleFor(p.category, multiples);
  const sizeMult = curve ? sizeMultiplier(p.tvl_usd, curve) : 1;
  const rawGrowth = finite(p.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * w;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const breadthMult =
    1 + Math.min(Math.max(p.chains.length - 1, 0), model.breadth_max_chains) * model.breadth_per_chain;
  return Math.max(1, Math.round(p.tvl_usd * catMult * sizeMult * growthMult * maturityMult * breadthMult));
}

/** The growth-free base: everything except the growth multiplier. */
function baseWithoutGrowth(
  p: SnapshotProtocol,
  asOf: string,
  multiples: ReturnType<typeof categoryMultiples>,
  model: ModelConstants,
  curve: SizeCurve | undefined,
): number {
  return predictWithGrowth(p, asOf, multiples, model, curve, 0) / 1; // w=0 => growthMult 1
}

function medianLogErr(preds: number[], actuals: number[]): number {
  const errs = preds.map((pr, i) => Math.abs(Math.log(Math.max(pr, 1) / actuals[i]!)));
  return r4(median(errs));
}

const GRID_W = [-1, -0.5, 0, 0.25, 0.5, 0.75, 1, 1.5, 2];
const GLOBAL_W = MODEL.growth_weight; // 0.5

interface CatWeights {
  weights: Record<string, number>;
  fitted: Record<string, { n: number; w_fit: number; w_used: number }>;
}

function groupByCategory(ps: SnapshotProtocol[]): Map<string, SnapshotProtocol[]> {
  const m = new Map<string, SnapshotProtocol[]>();
  for (const p of ps) {
    const k = p.category ?? 'Other';
    m.set(k, [...(m.get(k) ?? []), p]);
  }
  return m;
}

/** Grid-search fit of one category's weight on its train protocols. */
function fitGrid(
  train: SnapshotProtocol[],
  asOf: string,
  multiples: ReturnType<typeof categoryMultiples>,
  curve: SizeCurve,
  minN: number,
  shrinkK: number,
): CatWeights {
  const weights: Record<string, number> = {};
  const fitted: CatWeights['fitted'] = {};
  for (const [cat, ps] of groupByCategory(train)) {
    if (ps.length < minN) continue;
    const actuals = ps.map((p) => p.mcap_usd!);
    let bestW = GLOBAL_W;
    let bestErr = Infinity;
    for (const w of GRID_W) {
      const err = medianLogErr(ps.map((p) => predictWithGrowth(p, asOf, multiples, MODEL, curve, w)), actuals);
      if (err < bestErr - 1e-12) {
        bestErr = err;
        bestW = w;
      }
    }
    const wUsed = (ps.length * bestW + shrinkK * GLOBAL_W) / (ps.length + shrinkK);
    weights[cat] = r4(wUsed);
    fitted[cat] = { n: ps.length, w_fit: bestW, w_used: r4(wUsed) };
  }
  return { weights, fitted };
}

/** OLS-slope fit of one category's weight: regress the log residual (vs the
 *  growth-free base) on g = growthPct/100 with an intercept; slope ~= w. */
function fitOls(
  train: SnapshotProtocol[],
  asOf: string,
  multiples: ReturnType<typeof categoryMultiples>,
  curve: SizeCurve,
  minN: number,
  shrinkK: number,
): CatWeights {
  const weights: Record<string, number> = {};
  const fitted: CatWeights['fitted'] = {};
  for (const [cat, ps] of groupByCategory(train)) {
    if (ps.length < minN) continue;
    const xs: number[] = [];
    const ys: number[] = [];
    for (const p of ps) {
      const base = baseWithoutGrowth(p, asOf, multiples, MODEL, curve);
      const g = Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, finite(p.change_7d, 0))) / 100;
      xs.push(g);
      ys.push(Math.log(p.mcap_usd! / base));
    }
    const mx = mean(xs);
    const my = mean(ys);
    let sxx = 0;
    let sxy = 0;
    for (let i = 0; i < xs.length; i++) {
      sxx += (xs[i]! - mx) ** 2;
      sxy += (xs[i]! - mx) * (ys[i]! - my);
    }
    if (sxx <= 0) continue;
    const slope = Math.min(2, Math.max(-1, sxy / sxx));
    const wUsed = (ps.length * slope + shrinkK * GLOBAL_W) / (ps.length + shrinkK);
    weights[cat] = r4(wUsed);
    fitted[cat] = { n: ps.length, w_fit: r4(slope), w_used: r4(wUsed) };
  }
  return { weights, fitted };
}

type Candidate = 'gw0' | 'grid5' | 'grid5-k5' | 'grid8-k5' | 'ols5-k5' | 'ols8-k10';

function fitCandidate(
  name: Candidate,
  train: SnapshotProtocol[],
  asOf: string,
  multiples: ReturnType<typeof categoryMultiples>,
  curve: SizeCurve,
): CatWeights | null {
  switch (name) {
    case 'grid5':
      return fitGrid(train, asOf, multiples, curve, 5, 0);
    case 'grid5-k5':
      return fitGrid(train, asOf, multiples, curve, 5, 5);
    case 'grid8-k5':
      return fitGrid(train, asOf, multiples, curve, 8, 5);
    case 'ols5-k5':
      return fitOls(train, asOf, multiples, curve, 5, 5);
    case 'ols8-k10':
      return fitOls(train, asOf, multiples, curve, 8, 10);
    default:
      return null;
  }
}

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const CANDIDATES: Candidate[] = ['gw0', 'grid5', 'grid5-k5', 'grid8-k5', 'ols5-k5', 'ols8-k10'];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const inputArg = arg('input', '/input');
  const inputFile = inputArg.endsWith('.json') ? inputArg : `${inputArg.replace(/\/$/, '')}/snapshot.json`;
  const snapshot: Snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
  const live = livePopulation(snapshot);
  const folds = makeFolds(live);

  // Self-check: w = 0.5 replication must equal impliedValue on every protocol.
  let checked = 0;
  for (const f of folds) {
    const trainSnap: Snapshot = { as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd, protocols: f.train, watchlist: [] };
    const multiples = categoryMultiples(trainSnap, MODEL);
    for (const p of f.test) {
      const a = predictWithGrowth(p, snapshot.as_of, multiples, MODEL, f.curve, 0.5);
      const b = impliedValue(p, snapshot.as_of, multiples, MODEL, f.curve).implied;
      if (a !== b) throw new Error(`replication diverged for ${p.slug}: ${a} vs ${b}`);
      checked++;
    }
  }

  const perFold: Array<Record<string, number> & { split: string; fold: number; train_n: number; test_n: number }> = [];
  const fittedPerFold: Record<string, Array<{ split: string; fold: number; fitted: CatWeights['fitted'] }>> = {};
  for (const f of folds) {
    const trainSnap: Snapshot = { as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd, protocols: f.train, watchlist: [] };
    const multiples = categoryMultiples(trainSnap, MODEL);
    const actuals = f.test.map((p) => p.mcap_usd!);
    const row: Record<string, number> & { split: string; fold: number; train_n: number; test_n: number } = {
      split: f.split,
      fold: f.fold,
      train_n: f.train.length,
      test_n: f.test.length,
      full: medianLogErr(f.test.map((p) => impliedValue(p, snapshot.as_of, multiples, MODEL, f.curve).implied), actuals),
    };
    for (const name of CANDIDATES) {
      if (name === 'gw0') {
        row[name] = medianLogErr(
          f.test.map((p) => predictWithGrowth(p, snapshot.as_of, multiples, MODEL, f.curve, 0)),
          actuals,
        );
        continue;
      }
      const cw = fitCandidate(name, f.train, snapshot.as_of, multiples, f.curve)!;
      (fittedPerFold[name] ??= []).push({ split: f.split, fold: f.fold, fitted: cw.fitted });
      row[name] = medianLogErr(
        f.test.map((p) => predictWithGrowth(p, snapshot.as_of, multiples, MODEL, f.curve, cw.weights[p.category ?? 'Other'] ?? GLOBAL_W)),
        actuals,
      );
    }
    perFold.push(row);
  }

  const summary: Record<string, { mean: number; wins_vs_full: string; mean_cut_pct: number; adopted: boolean }> = {};
  for (const name of ['full', ...CANDIDATES]) {
    const vals = perFold.map((r) => r[name]!);
    const fullVals = perFold.map((r) => r.full);
    const wins = perFold.filter((r) => r[name]! < r.full).length;
    const cut = r4(mean(perFold.map((r) => ((r.full - r[name]!) / r.full) * 100)));
    summary[name] = {
      mean: r4(mean(vals)),
      wins_vs_full: name === 'full' ? '-' : `${wins}/6`,
      mean_cut_pct: name === 'full' ? 0 : cut,
      adopted: name !== 'full' && wins >= 4 && cut >= 5,
    };
    void fullVals;
  }

  // Full-sample diagnostic: what weights would the whole live population fit?
  const fullSnap = snapshot;
  const fullMultiples = categoryMultiples(fullSnap, MODEL);
  const fullCurve = fitSizeCurve(snapshot.protocols);
  const fullSampleWeights = {
    grid5: fitGrid(live, snapshot.as_of, fullMultiples, fullCurve, 5, 0).fitted,
    grid5_k5: fitGrid(live, snapshot.as_of, fullMultiples, fullCurve, 5, 5).fitted,
    ols5_k5: fitOls(live, snapshot.as_of, fullMultiples, fullCurve, 5, 5).fitted,
  };

  const out = {
    model: 'radar-5',
    population: live.length,
    folds: 6,
    self_check_protocols: checked,
    per_fold: perFold,
    summary,
    fitted_per_fold: fittedPerFold,
    full_sample_weights: fullSampleWeights,
    adoption_rule: 'adopt only if wins >= 4/6 folds vs full AND mean test median |log err| cut >= 5%',
  };
  writeFileSync(arg('out', 'experiment-growth-cat.json'), `${JSON.stringify(out, null, 2)}\n`);
  process.stdout.write(`category-specific growth weights: ${live.length} live protocols, 6 folds, replication self-check ${checked}/${checked} exact\n`);
  for (const r of perFold) {
    process.stdout.write(
      `  ${r.split} fold ${r.fold} (train ${r.train_n}/test ${r.test_n}): full ${r.full} | gw0 ${r.gw0} | grid5 ${r['grid5']} | grid5-k5 ${r['grid5-k5']} | grid8-k5 ${r['grid8-k5']} | ols5-k5 ${r['ols5-k5']} | ols8-k10 ${r['ols8-k10']}\n`,
    );
  }
  for (const name of ['full', ...CANDIDATES]) {
    const s = summary[name]!;
    process.stdout.write(`  ${name}: mean ${s.mean}, wins ${s.wins_vs_full}, mean cut ${s.mean_cut_pct}%${s.adopted ? ' — ADOPTED' : ''}\n`);
  }
}
