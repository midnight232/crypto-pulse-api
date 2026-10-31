# crypto-pulse-api (Solana x402)

Pay-per-request **crypto market pulse** for AI agents. **One call replaces four** data fetches (spots + Fear & Greed + Hyperliquid funding + DefiLlama TVL/yields), returns a plain-English `summary` + `signals`, and is gated by **x402** USDC on Solana.

> Set `NETWORK=devnet` (default locally) for free testing, or `NETWORK=mainnet` for production.
>
> Live: https://137-184-201-7.sslip.io — source: https://github.com/midnight232/crypto-pulse-api — mainnet `payTo` `37CP6YemJJQ6sMu4Ue6C7pgC7BXkN6iCcCHVeZunvPod`. Facilitator: **Coinbase CDP** (PayAI listing retained). See **DEPLOY.md**.

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
- `POST /mcp` — Streamable HTTP MCP (`get_market_sample` free; paid tools return x402 payment requirements + HTTP URLs)

Free discovery: `GET /`, `GET /health`, `GET /llms.txt`, `GET /.well-known/x402`, `GET /openapi.json`.

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
npm run buy                # full paid flow (needs buyer DEVNET USDC)
```

Never commit `.devnet-keys/`, `.mainnet-keys/`, `.cdp-keys/`, `.do-token`, or `.deploy-ssh/`. Never print secret keys.

## MCP

Remote (live): `https://137-184-201-7.sslip.io/mcp`

Local stdio:

```bash
PUBLIC_BASE_URL=https://137-184-201-7.sslip.io npm run mcp:stdio
```

Registry drafts (not published): `mcp/server.json`, `mcp/smithery.yaml`. See [MARKETING.md](./MARKETING.md).

## Project layout

```
src/server.js          Express + x402 + sample + MCP mount
src/pulse.js           Public data aggregation + caches
src/summary.js         Plain-English summary + signals
src/discovery.js       llms.txt / well-known / OpenAPI
src/mcp-server.js      Streamable HTTP MCP tools
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
