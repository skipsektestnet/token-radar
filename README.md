# Token Radar — Build the best token launch radar

[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/competitions/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/skipsektestnet/token-radar/rank.svg)](https://make.fun/competitions/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/skipsektestnet/token-radar/reward.svg)](https://make.fun/competitions/token-radar-01)

A web dashboard that ranks pre-token DeFi protocols by implied value — what a
token would be worth if the protocol's record stayed as it is — and shows how
to farm each one. Built for the [token-radar-01 bounty](https://make.fun/competitions/token-radar-01)
on make.fun.

## What it does

- Reads the sealed DefiLlama snapshot (`/input/snapshot.json`, as of
  2026-11-14, 758 protocols) and scores **every rankable pre-token protocol**:
  all 40 watchlist protocols plus every other pre-token protocol that is not
  a wrapped, staked, bridged or exchange product — **197 rows**.
- Ranks them by an **implied value** computed only from the snapshot's own
  figures. The category multiple is the snapshot's own live-token evidence:
  the median market-cap-to-TVL ratio of the live-token protocols in each
  category (global median where a category has too few live tokens), clamped
  to [0.05, 1.20]. Then growth (7-day TVL change, clamped), maturity (age
  since first listed) and chain breadth adjust it. No protocol name is ever
  special-cased.
- Gives every protocol a **6-step farm plan** derived from its category
  (the action), its TVL tier (the capital, $50–$250) and its age (the hold,
  30–60 days), each step with its cost and time. It never promises a token
  and never asks anyone to pay to claim one.
- Shows the **live-token set apart** (top 24 by market cap) with their real
  market caps and mcap/TVL ratios — the same ratios that price the board.

## The dashboard

`dashboard/` is a static page with no network and no framework: a sortable,
filterable board (search, category, chain, watchlist-only), a detail view for
every protocol (value breakdown, live comparables in its category, farm
plan), the live-token table, and the model itself in the open — including the
category-multiples table computed from the snapshot.

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
- `lib/model.ts` — the valuation model, the farm plans, the board builder.
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
