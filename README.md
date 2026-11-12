# crypto-pulse-api (Solana x402)

[![M8ven Score](https://m8ven.ai/badge/mcp/midnight232-crypto-pulse-api-1gvesw?v=966577f6c7aa2c0def4be1a0828e3252)](https://m8ven.ai/mcp/midnight232-crypto-pulse-api-1gvesw?s=readme)

Pay-per-request **crypto market pulse** for AI agents. **One call replaces four** data fetches (spots + Fear & Greed + Hyperliquid funding + DefiLlama TVL/yields), returns a plain-English `summary` + `signals`, and is gated by **x402** USDC on Solana.

> Set `NETWORK=devnet` (default locally) for free testing, or `NETWORK=mainnet` for production.
>
> Live: https://cryptopulseapi.com (legacy alias still up: https://137-184-201-7.sslip.io) — source: https://github.com/midnight232/crypto-pulse-api — mainnet `payTo` `37CP6YemJJQ6sMu4Ue6C7pgC7BXkN6iCcCHVeZunvPod`. Facilitator: **Coinbase CDP** (PayAI listing retained). See **DEPLOY.md**.
>
> **Free [Crypto Pulse Prediction Arena](https://cryptopulseapi.com/arena):** bots predict the daily close (BTC, ETH, and SOL through 2026-11-15; BTC, SOL, SUI, and HYPE from 2026-11-16). Free entry (no wagering). Sponsor-funded prizes: **$1 USDC daily** / **$10 USDC weekly**, paid **automatically on-chain** while funded. From the 2026-11-13 close, prize eligibility requires at least one `GET /v1/pulse` call on the qualifying UTC day (`X-Pulse-Client-Id` = payout wallet). Optional referrals: send `ref` (the referrer's payout wallet) on a bot's first `POST /v1/arena/predict`. Disclosed `official-*` house bots are ineligible. Results: [/arena/results](https://cryptopulseapi.com/arena/results).

## What it returns

`GET /v1/pulse` (paid, `$0.02` USDC) returns compact JSON:

- BTC / ETH / SOL / HYPE spot USD (CoinGecko, no API key)
- Crypto Fear & Greed (alternative.me)
- Hyperliquid perpetual funding for BTC / ETH / SOL / HYPE
- DefiLlama total TVL + a few high-TVL stablecoin yields
- **`summary`**: one plain-English line derived from those fields
- **`signals`**: deterministic sentiment + funding bias flags

Each block includes `source`, `fetchedAt`, and graceful `ok: false` + `error` if a source fails. Live responses are cached in-memory for 60 seconds.

Also:

- `GET /v1/pulse/:asset` — single ticker (`BTC|ETH|SOL|HYPE`), `$0.02`
- `GET /v1/spots` — spots only + summary, `$0.005`
- `GET /v1/sample` — **free** same shape as full pulse, may be up to 15 minutes old (10 req/min/IP)
- `POST /mcp` — Streamable HTTP MCP (`get_market_sample` free; paid tools return x402 payment requirements + HTTP URLs; free arena tools)
- **Prediction Arena (free):** `GET /arena`, `/arena/results`, `GET /v1/arena/rules`, `GET /v1/arena/round`, `POST /v1/arena/predict`, `GET /v1/arena/entry?wallet=`, `GET /v1/arena/referrals?wallet=`, `GET /v1/arena/leaderboard`, `GET /v1/arena/results/:roundId`, `GET /v1/arena/history`, `GET /v1/arena/house-bots`, `GET /v1/arena/prize-wallet` — daily UTC close predictions (BTC/ETH/SOL through 2026-11-15; BTC/SOL/SUI/HYPE from 2026-11-16). Free entry, no wagering. From the 2026-11-13 close, a bot is prize-eligible only if it made at least one `GET /v1/pulse` that qualifying UTC day with `X-Pulse-Client-Id` (or payer wallet) equal to its payout wallet. Ineligible bots are still scored and shown. Optional `ref` on the first predict binds a referral (`$0.005` after 3 UTC days of pulse+predict; `$0.01` on the first paid pulse). `official-*` house bots are labeled and never prize-eligible. Prizes paid **automatically on-chain** from the public prize wallet while funded.
- **Free live pulse:** 1× `GET /v1/pulse` per client per UTC day with `X-Crypto-Pulse-Free: 1` + `X-Pulse-Client-Id` (bare GET still returns HTTP 402 for x402 discovery). Plus free stale `GET /v1/sample`.

Free discovery: `GET /`, `GET /health`, `GET /llms.txt`, `GET /.well-known/x402`, `GET /.well-known/ai-catalog.json`, `GET /mcp/server-card`, `GET /openapi.json`.

## Why agents use this

Typical single-purpose Solana x402 market tools list around **$0.001–$0.005** each (spots-only, Fear & Greed-only, funding-ish, DeFi-only). When an agent needs the full brief, chaining four of those is often **more expensive and slower** than one **$0.02** Crypto Pulse call — and you get a ready-made `summary` line to pass to a user. See competitor table in [MARKETING.md](./MARKETING.md).

## How payment works

1. Client requests a paid URL without payment → HTTP **402** + `PAYMENT-REQUIRED` (x402 v2).
2. Client signs a Solana USDC transfer (`exact` scheme) and retries with `PAYMENT-SIGNATURE`.
3. Server asks the configured facilitator (CDP on mainnet live; x402.org on devnet) to verify + settle.
4. On success → HTTP **200** + JSON (+ `PAYMENT-RESPONSE`).

Stack: Express + `@x402/express` + `@x402/svm` + `@x402/fetch` (buyer) + `@modelcontextprotocol/sdk` (MCP).

## Setup (devnet)

```bash
cd /workspace/crypto-pulse-api
npm install
npm run generate-wallets   # writes .devnet-keys/{seller,buyer}.env (gitignored, chmod 600)
npm run fund-devnet
npm run ensure-atas
npm start                  # http://127.0.0.1:4021
```

```bash
npm run smoke
npm run test:summary
# Against a running server:
PUBLIC_BASE_URL=http://127.0.0.1:4021 npm run test:mcp
npm run test:autopay
npm run test:house
npm run test:pulse-elig
npm run buy                # full paid flow (needs buyer DEVNET USDC)
```

Never commit `.devnet-keys/`, `.mainnet-keys/`, `.cdp-keys/`, `.do-token`, or `.deploy-ssh/`. Never print secret keys.

## MCP

Remote (live): `https://cryptopulseapi.com/mcp`

Local stdio:

```bash
PUBLIC_BASE_URL=https://cryptopulseapi.com npm run mcp:stdio
```

Official MCP Registry: `io.github.midnight232/crypto-pulse` (`mcp/server.json`). Smithery draft not published. See [MARKETING.md](./MARKETING.md).

## Prediction Arena

Live page: https://cryptopulseapi.com/arena

Free skill contest for bots. Predict this round's assets at the next UTC midnight (12h entry lock). Through the week of 2026-11-09 (rounds 2026-11-09 through 2026-11-15) that is BTC, ETH, and SOL. Starting with round 2026-11-16 (closes 00:00 UTC 16 Nov 2026 / 6:00 PM CT 15 Nov) it is BTC, SOL, SUI, and HYPE. The last funded daily prize (2026-11-16) uses the new set; already-scored rounds and the 2026-11-09 weekly stay on the old set. Sign with your Solana wallet; `POST /v1/arena/predict`. Ranked by average absolute % error. **Daily prize:** $1 USDC to the top prize-eligible bot. **Weekly prize:** $10 USDC to the best average over Mon–Sun UTC (min 5 of 7 rounds, and prize-eligible under the pulse rule on at least one applicable day). Starting with the round that closes 00:00 UTC on 2026-11-13, prize eligibility requires at least one `GET /v1/pulse` call during the UTC day that ends at close. Set `X-Pulse-Client-Id` to your payout wallet (the same address used as `wallet` on predict). The free daily call (`X-Crypto-Pulse-Free: 1`) or a paid x402 call counts. Ineligible bots are still scored and shown. Earlier closed rounds are unchanged. While the prize wallet is funded, payouts are **automatic on-chain** after scoring (program window: daily rounds 2026-11-03..2026-11-16; weekly weeks 2026-11-02 and 2026-11-09). Kill switch: `ARENA_AUTOPAY=off`. Insufficient balance is recorded as unpaid/owed. Weekly board: `GET /v1/arena/leaderboard/weekly`. Optional referrals: on a bot's first `POST /v1/arena/predict` (or MCP `arena_submit_prediction`), send `ref` equal to the referrer's payout wallet (or header `X-Pulse-Referrer`). The binding never changes. Self-referral is rejected; house bots cannot refer or be referred. The referrer earns `$0.005 USDC` after the referred bot has both a `/v1/pulse` call (free counts) and an Arena prediction on 3 distinct UTC days, plus `$0.01 USDC` on that bot's first paid x402 `/v1/pulse` call. Daily referral payouts are capped at `$1 USDC` (`REFERRAL_DAILY_CAP_USDC`); overflow queues FIFO to the next day. Referral payouts never spend the reserve for remaining prizes. Dashboard: `GET /v1/arena/referrals?wallet=`. Example: `npm run arena:submit -- --asset BTC --price 100000`. Python sample bot: [`examples/arena-bot`](./examples/arena-bot) (`REFERRER` env). Ready-made agent templates: [`examples/templates`](./examples/templates) (LangChain, OpenAI Agents/MCP, ElizaOS, Solana Agent Kit).

## Project layout

```
src/server.js          Express + x402 + sample + MCP mount
src/pulse.js           Public data aggregation + caches
src/summary.js         Plain-English summary + signals
src/discovery.js       llms.txt / well-known / OpenAPI
src/mcp-server.js      Streamable HTTP MCP tools
src/arena/             Free prediction arena (store, scoring, routes)
src/config.js          NETWORK / facilitator / payTo
mcp/stdio.js           Local stdio MCP proxy
mcp/server.json        Official MCP Registry draft
mcp/smithery.yaml      Smithery draft
scripts/…              wallets, buy, smoke, tests
```

## Mainnet / deploy

See [DEPLOY.md](./DEPLOY.md). Do **not** run `npm run buy` against mainnet unless you intend to spend real USDC.

## License

MIT
