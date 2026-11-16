# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/risman18/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/risman18/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Launch Radar: a token launch radar over the sealed DefiLlama snapshot in
make.fun's token-radar-01 kit. The program (`main.ts`, Node 22, standard
library only) reads `/input/snapshot.json`, keeps every protocol that records
no token and is not a wrapped, staked, bridged or exchange product, and ranks
198 of them by implied value. The value model is comparables-based: each
category's traded protocols in the same snapshot imply a median
market-cap/TVL multiple (shrunk toward the global median), applied to a
sublinear TVL curve and adjusted for 7-day growth (asymmetric: downside
weighs more), log-age maturity and chain breadth. Every row carries a
plausible range, a readiness score and a six-step farm plan with costs and
times. The static dashboard in `dashboard/` renders the board with search,
category/chain/tier filters and sorting, a detail view per protocol showing
each valuation factor, and the traded comparables listed separately — all
offline, from the `data.js` the program writes. Three screenshots under
`screenshots/` show the board, Gauntlet's detail view and the Lending filter.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
