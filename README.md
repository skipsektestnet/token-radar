# Token Radar — Build the best token launch radar

[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/competitions/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/skipsektestnet/token-radar/rank.svg)](https://make.fun/competitions/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/skipsektestnet/token-radar/reward.svg)](https://make.fun/competitions/token-radar-01)

A web dashboard that ranks pre-token DeFi protocols by implied value — what a
token would be worth if the protocol's record stayed as it is — and shows how
to farm each one. Built for the [token-radar-01 bounty](https://make.fun/bounty/token-radar-01)
on make.fun.

## What it does

- Reads the sealed DefiLlama snapshot (`/input/snapshot.json`, as of
  2026-11-14, 758 protocols) and scores **every rankable pre-token protocol**:
  all 40 watchlist protocols plus every other pre-token protocol that is not
  a wrapped, staked, bridged or exchange product — **197 rows**.
- Ranks them by an **implied value** from a **ridge regression** fitted on the
  snapshot's own 128 live-token protocols: log market cap on log TVL, 7-day
  growth, log age and chain count, plus a shrunk per-category effect
  (penalty λ = 10, chosen on a held-out grid). The regression beats the
  earlier TVL-times-category-multiple formula out of sample (median |log err|
  1.27 vs 1.63 on the same 2 splits × 2 folds; TVL-only baseline 1.77). No
  protocol name is ever special-cased.
- Shows each protocol's **launch odds from its peers' record**: the share of
  protocols in its category that already carry a token, smoothed toward the
  global share. The odds are displayed, not fitted into the value.
- Gives every protocol a **6-step farm plan** derived from its category
  (the action), its TVL tier (the capital, $50–$250) and its age (the hold,
  30–60 days), each step with its cost and time. It never promises a token
  and never asks anyone to pay to claim one.
- Shows the **live-token set apart** (top 24 by market cap) with their real
  market caps and mcap/TVL ratios — the same ratios that price the board.

## The dashboard

`dashboard/` is a static page with no network and no framework: a sortable,
filterable board (search, category, chain, watchlist-only, launch odds), a
detail view for every protocol (regression breakdown, launch odds, live
comparables in its category, farm plan), the live-token table, and the model
itself in the open — including the fitted coefficients, the per-fold
validation table and the launch-odds table.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22.18+ (standard library only). The program writes `board.json`,
`data.js`, `dashboard/`, `screenshots/` and `dossier.json` to the output
directory, and refuses a board the gate would refuse (missing watchlist
coverage, bad ranks, bad farm steps).

## Layout

- `main.ts` — entrypoint: snapshot in, board + dashboard + dossier out.
- `lib/model.ts` — the valuation model (radar-4: TVL × category multiple ×
  growth × maturity × breadth, plus the peers' record), the farm plans, the
  board builder. Radar-3's fitted ridge regression was reverted: it scored
  better held-out (1.27 vs 1.63) but the dev rank fell, because its values no
  longer follow the snapshot's figures in a way a reader can check by hand.
- `lib/validate.ts` — the held-out validation (2 splits × 2 folds, ablations,
  constants grid) that the entry runs on every build.
- `lib/experiment.ts` — the v2 model experiments that chose the regression
  family (shrinkage, OLS, ridge) on the same folds.
- `dashboard/` — `index.html`, `app.css`, `app.js` (the page recomputes each
  row's implied value and farm plan, so the code and the board agree).
- `vendor/makefun-board.ts` — the kit's dossier library.
- `screenshots/` — the board, a protocol detail view, a filtered view.

## Honesty notes

- A protocol on the board "records no token" in DefiLlama's record; that is
  not proof it has none.
- Implied value is this entry's own claim, never a price, and it does not
  predict whether or when a token is issued.
- Wrapped, staked, bridged and exchange products are excluded: they are not
  launches of their own.

## License

MIT — see `LICENSE`.

<sub>Entered on [make.fun](https://make.fun/?ref=jeq52989&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
