# Token Launch Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/sukamtiindrawati-dot/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/sukamtiindrawati-dot/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Launch Radar ranks 178 pre-token protocols by what their launch would be worth, from a sealed DefiLlama snapshot (2026-11-14). Implied value = TVL × category median mcap/TVL multiple × growth × age — derived from the snapshot's figures alone, never a hardcoded name list. All 40 watchlist protocols are covered, plus 138 pre-token protocols below the $50M floor. Every row carries a concrete farm plan with costs and times.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

`main.ts` (Node 22, standard library only) writes `board.json`, the dashboard, and `dossier.json` to the output directory. It runs twice with byte-identical output. Open `out/dashboard/index.html` to explore the board, or look at the screenshots in `screenshots/`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=0tdg42rq&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)</sub>
