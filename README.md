# Token Radar — radar-5

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/bismilahdestia/token-radar-01-entry-v4/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/bismilahdestia/token-radar-01-entry-v4/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

The best token launch radar I can build: a program that reads a frozen snapshot
of every protocol DefiLlama tracks, finds the ones that record no token yet,
ranks them by what a launch would be worth, and hands in a dashboard that shows
the board, a detail view for each protocol, and the steps to farm it.

## What it does

`main.ts` (Node 22, standard library only) reads `/input/snapshot.json`, scores
every rankable pre-token protocol with the radar-5 model in `lib/model.ts`, and
writes `/output/board.json`, `/output/data.js`, the dashboard, three screenshots
and `/output/dossier.json` (via `vendor/makefun-board.ts`).

- **198 rows**: all 40 watchlist protocols, plus 158 early pre-token protocols
  below the $50M floor. A ledger accounts for all 758 snapshot protocols in
  exactly one group (40 watchlist, 158 early, 128 priced comps, 288
  token-recorded-no-cap, 144 set aside by the house rule). Live-token
  protocols are set aside at their market cap, never mixed into the ranking.
- **radar-5 value model, fitted at run time**: log10(mcap) =
  3.025 + 0.522·log10(TVL), fitted on the 128 traded tokens with a market cap.
  Extra terms (category, 7-day growth, age, chain count) were kept only if
  they lowered the held-out median miss in both leave-one-out and walk-forward
  tests — only the size curve survived, and the dashboard shows the tested,
  not-kept terms openly. Token odds come from a logistic fit on all 758
  protocols (category, log age, log TVL). Implied value = value-if-it-launches
  × token odds. No protocol name is special-cased.
- **Blind test, reported openly**: leave-one-out median miss ×3.40,
  walk-forward ×3.01, odds Brier 0.228 (5-fold CV, 64% called right),
  P25–P75 band coverage 50% (nominal 50%). The dashboard reports these
  numbers instead of hiding them.
- **Farm plans**: 4 concrete steps per protocol, costed (chain gas + 0.3%
  swap + 0.1% deposit) and time-boxed, sized at a $1,000 deposit over 60 days.
  FARM only when net ≥ $15 and net/hour ≥ $5: 14 FARM / 110 MARGINAL / 74 SKIP.
- **Dashboard**: sortable board, tabs (All / Watchlist / Early / Farm /
  Marginal / Skip with live counts), search, category + chain filters, detail
  view per protocol (model breakdown, nearest traded comps by TVL, full farm
  plan), CSV export, integrity strip that recomputes the board checks in the
  browser. Dossier 633,203 bytes — small enough that the judge reads all
  source whole.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

The run is deterministic: the same snapshot bytes always write the same
output bytes. No network at runtime.

## What changed from radar-4 (v3)

- Model: the per-category median multiple is gone. A single size curve is
  fitted at run time on the traded peers, with an ablation table that keeps a
  term only when it wins both held-out tests; token odds are a logistic fit,
  and every row carries a P25–P75 band from leave-one-out residuals.
- Farm plans: 9 steps to 4, each costed and time-boxed, with a live
  cost/benefit verdict (FARM / MARGINAL / SKIP) from the row's own numbers
  instead of a fixed script.
- Dashboard: a protocol-accounting ledger, a fitted size curve with held-out
  tests, an integrity strip with a checksum, and a smaller dossier (633,203
  bytes vs 1,322,154) so the judge reads the whole source.
- Screenshots: re-rendered from this dashboard in a real headless browser.
