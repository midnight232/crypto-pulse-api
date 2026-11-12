# Crypto Pulse — marketing & directory submissions

**Do not submit these yet** without Matt’s go-ahead (except PayAI/CDP which already index via settlement). Drafts only for registries that need accounts.

Live base URL: `https://cryptopulseapi.com` (legacy: `https://137-184-201-7.sslip.io` still served)  
PayTo (Phantom): `37CP6YemJJQ6sMu4Ue6C7pgC7BXkN6iCcCHVeZunvPod`  
Network: `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` (Solana mainnet)  
Facilitator (live): Coinbase CDP `https://api.cdp.coinbase.com/platform/v2/x402`  
PayAI listing retained from earlier settles: `https://facilitator.payai.network`  
Full pulse: `GET /v1/pulse` — **$0.02** USDC  
Spots only: `GET /v1/spots` — **$0.005** USDC  
Asset slice: `GET /v1/pulse/:asset` — **$0.02** USDC  
Free sample: `GET /v1/sample` (≤15 min old, 10/min/IP)  
MCP: `POST /mcp` (Streamable HTTP)

---

## Shared copy (reuse everywhere)

**Name:** Crypto Pulse

**One-liner (short):**
One call replaces four: spots + Fear & Greed + Hyperliquid funding + DefiLlama TVL/yields, with a ready-made summary. x402 USDC on Solana. Free sample + MCP.

**Long description:**
One call replaces four crypto data fetches for AI agents: (1) BTC/ETH/SOL/SUI/HYPE/ZEC spot USD + 24h change (CoinGecko), (2) Crypto Fear & Greed (alternative.me), (3) Hyperliquid perp funding + mark + open interest, (4) DefiLlama total TVL + top stable yields — plus a plain-English summary line and deterministic signals. Keyless upstreams, 60s live cache, pay-per-request USDC on Solana via x402. Typical single-purpose x402 market tools on Solana list around $0.001–$0.005 each; this $0.02 bundle is usually cheaper than paying four of them when you need the full brief. Free stale sample at GET /v1/sample; MCP tools at POST /mcp.

**Tags / categories:**
`crypto`, `market-data`, `solana`, `agents`, `x402`, `fear-greed`, `funding`, `defi`, `hyperliquid`, `coingecko`, `defillama`, `btc`, `eth`, `sol`, `mcp`, `summary`

**URLs to include:**
- Home / agent summary: `https://cryptopulseapi.com/`
- Free sample: `https://cryptopulseapi.com/v1/sample`
- MCP: `https://cryptopulseapi.com/mcp`
- Paid full pulse: `https://cryptopulseapi.com/v1/pulse`
- Paid spots: `https://cryptopulseapi.com/v1/spots`
- llms.txt: `https://cryptopulseapi.com/llms.txt`
- OpenAPI: `https://cryptopulseapi.com/openapi.json`
- Well-known: `https://cryptopulseapi.com/.well-known/x402`
- Health: `https://cryptopulseapi.com/health`

**Pricing line:** $0.02 USDC / full pulse · $0.005 USDC / spots-only · free sample (stale) · Solana mainnet · exact scheme · CDP facilitator (PayAI listing retained)

---

## Competitor snapshot (PayAI search `crypto market` on Solana, 2026-10-30)

| Price | Service | URL | Notes |
|------:|---------|-----|-------|
| $0.001 | Crypto price (agent402) | https://agent402.tools/api/crypto-price | Spots only |
| $0.002 | 47620 price | https://47620.xyz/x/crypto/price/BTCUSDT | Single pair |
| $0.003 | Fear & Greed clones | payai.agentstools.dev / others | Sentiment only |
| $0.004 | Crypto market pulse (agent402) | https://agent402.tools/api/crypto-market-pulse | Perp breadth; closest peer |
| $0.005 | Global DeFi (agent402) | https://agent402.tools/api/global-defi | DeFi only |
| **$0.02** | **Crypto Pulse (us)** | **https://cryptopulseapi.com/v1/pulse** | Spots+F&G+funding+DeFi+summary |
| $0.01 | CoinMarketCap x402 | https://pro-api.coinmarketcap.com (Base) | Quotes; Base not Solana |
| $0.02 | Kronos liquidations | kronossignals.com | Niche liq map |

**Honest math:** four typical singles at $0.001+$0.003+$0.004+$0.005 = **$0.013** minimum in that snapshot, often higher depending on which endpoints an agent actually needs; our **$0.02** bundle adds a summary line and one round-trip. Claim only “usually cheaper than chaining four single-purpose APIs when you need the full brief” — not “always cheapest” or fake usage stats.

Sources: PayAI discovery search; https://x402.new/services?category=market-data ; https://coinmarketcap.com/api/documentation/ai-agent-hub/x402

---

## Ranked directory actions

**Status 2026-10-31 (America/Chicago):** Public GitHub repo exists at https://github.com/midnight232/crypto-pulse-api. **Do not submit** any of the items below until Matt explicitly approves each one. Drafts only.

### 1. PayAI Bazaar — FREE, already listed

| Field | Value |
|-------|--------|
| Status | **Listed** (indexes via settlement) |
| Needs from Matt | Nothing required. Optional ~$0.02 settle refreshes listing metadata. |

### 2. Coinbase CDP Bazaar — FREE, already listed

| Field | Value |
|-------|--------|
| Status | Live facilitator is CDP; resources indexed after CDP settles |
| Needs from Matt | Nothing for listing. Optional paid settle to refresh metadata. |

### 3. Official MCP Registry — prepared, NOT submitted

| Field | Value |
|-------|--------|
| Cost | **Free** |
| Docs | https://modelcontextprotocol.io/registry/authentication · https://modelcontextprotocol.io/registry/remote-servers |
| File | `mcp/server.json` |
| Namespace | `io.github.midnight232/crypto-pulse` (GitHub auth for user **midnight232**) |
| Needs from Matt | Approve publish. Authorize `mcp-publisher login github` (device code on phone). |

**Exact steps (after Matt's yes):**

```bash
# Install publisher (once)
curl -L "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').tar.gz" \
  | tar xz mcp-publisher && sudo mv mcp-publisher /usr/local/bin/

cd /workspace/crypto-pulse-api/mcp
mcp-publisher login github   # open https://github.com/login/device , enter code
mcp-publisher publish        # publishes mcp/server.json
# Verify:
curl -sS "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.midnight232/crypto-pulse"
```

`server.json` already names `io.github.midnight232/crypto-pulse`, version `0.3.3`, remote `https://cryptopulseapi.com/mcp`, repo `https://github.com/midnight232/crypto-pulse-api`.

### 4. Smithery — prepared, NOT submitted

| Field | Value |
|-------|--------|
| Cost | **Free** for listing |
| File | `mcp/smithery.yaml` |
| Site | https://smithery.ai/ |
| Needs from Matt | Smithery account (GitHub login as midnight232). Approve connect of this repo **or** paste remote URL. |

**Exact steps (after Matt's yes):**

1. Sign in at https://smithery.ai/ with GitHub **midnight232**.
2. Add a remote server: Streamable HTTP URL `https://cryptopulseapi.com/mcp`.
3. Or connect the GitHub repo `midnight232/crypto-pulse-api` and use `mcp/smithery.yaml`.
4. Optional CLI path: `npx -y @smithery/cli@latest auth login` then publish under Matt's namespace (confirm current CLI flags on Smithery docs before running).

### 5. Glama — prepared, NOT submitted

| Field | Value |
|-------|--------|
| Cost | **Free** (confirm on submit page) |
| Site | https://glama.ai/mcp |
| Needs from Matt | Glama account; approve listing this public repo and/or remote MCP URL |

**Draft listing copy:**

- Name: Crypto Pulse
- Repository: https://github.com/midnight232/crypto-pulse-api
- Remote MCP: https://cryptopulseapi.com/mcp
- Homepage: https://cryptopulseapi.com/
- Description: One call replaces four crypto data fetches for AI agents (spots, Fear & Greed, Hyperliquid funding, DefiLlama TVL/yields) with a plain-English summary. Free sample tool; paid pulse/spots via x402 USDC on Solana.

### 6. mcp.so — prepared, NOT submitted

| Field | Value |
|-------|--------|
| Cost | Form path historically **~$39 one-time** for immediate publish (confirm live price on https://mcp.so/submit before paying). Alternate: community GitHub issue on https://github.com/chatmcp/mcpso/issues/1 appears **free** but slow/uncertain. |
| Needs from Matt | Explicit yes on which path; if paid form, approve the exact dollar amount before checkout. Sign-in on mcp.so. |

**Paid form draft (Remote Server tab):**

- Name: Crypto Pulse
- Remote endpoint: `https://cryptopulseapi.com/mcp`
- Repository: `https://github.com/midnight232/crypto-pulse-api`

**Free issue draft (comment on chatmcp/mcpso#1 or new “Submit Remote MCP Server” issue):**

```
Name: Crypto Pulse
Remote MCP: https://cryptopulseapi.com/mcp
GitHub: https://github.com/midnight232/crypto-pulse-api
Homepage: https://cryptopulseapi.com/
Description: One call replaces four crypto data sources (spots, Fear & Greed, funding, DeFi) with summary; free sample + Streamable HTTP MCP; x402 USDC on Solana.
Tools: get_market_sample (free), get_market_pulse ($0.02 via x402 HTTP), get_market_spots ($0.005 via x402 HTTP)
```

### 7. x402 Discovery Index — prepared, NOT submitted

| Field | Value |
|-------|--------|
| Repo | https://github.com/x402-index/x402-discovery-index |
| Cost | README mentions a **one-time listing fee** — **confirm amount in the issue thread before paying**. Do not pay without Matt's exact-amount yes. |
| Needs from Matt | Approve opening the issue; approve any fee after the maintainers quote it. |

**Issue title:** `List: Crypto Pulse — Solana x402 crypto market pulse ($0.02)`

**Issue body:**

```
Endpoint: https://cryptopulseapi.com/v1/pulse
Also: https://cryptopulseapi.com/v1/spots ($0.005 spots-only)
Free sample: https://cryptopulseapi.com/v1/sample
MCP: https://cryptopulseapi.com/mcp
GitHub: https://github.com/midnight232/crypto-pulse-api
Payment address (payTo): 37CP6YemJJQ6sMu4Ue6C7pgC7BXkN6iCcCHVeZunvPod
Network: solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp
Asset: USDC EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
Price: $0.02 full pulse / $0.005 spots
Facilitator: https://api.cdp.coinbase.com/platform/v2/x402 (PayAI listing also present)
Description: One call replaces four crypto data fetches for AI agents: spots, Fear & Greed, Hyperliquid funding, DefiLlama TVL/yields, plus a plain-English summary. Free sample + MCP. Keyless upstreams, x402 USDC on Solana.
llms.txt: https://cryptopulseapi.com/llms.txt
OpenAPI: https://cryptopulseapi.com/openapi.json
```

### 8. awesome-x402 curated lists — prepared PRs, NOT submitted

| List | Cost | Needs from Matt |
|------|------|-----------------|
| https://github.com/xpaysh/awesome-x402 | Free PR | Approve PR text + open PR as midnight232 |
| https://github.com/Rug-Munch-Media-LLC/awesome-x402 | Free PR | Same |

**Suggested bullet (xpaysh / similar):**

```
- [Crypto Pulse](https://cryptopulseapi.com/) — One call replaces four crypto data fetches for AI agents (spots, Fear & Greed, Hyperliquid funding, DefiLlama TVL/yields) + summary. Free sample + MCP. x402 USDC on Solana ($0.02 pulse / $0.005 spots). [GitHub](https://github.com/midnight232/crypto-pulse-api)
```

---

## Recommended next moves (priority)

1. Keep `/v1/pulse` at **$0.02** with “one call replaces four” + summary positioning.
2. Point agents at **free `/v1/sample`** and **`POST /mcp`** in every listing.
3. After Matt's yes: Official MCP Registry (`io.github.midnight232/crypto-pulse`) + Smithery + Glama (all free).
4. Confirm mcp.so fee before paying; prefer free issue path if Matt does not want the ~$39 fee.
5. Open x402 Discovery Index issue only after confirming any listing fee.
6. Optional awesome-x402 PRs for human discoverability.
7. Custom domain (optional) for branding.

---

## What was shipped 2026-10-30 (America/Chicago) — agent marketing pass

- `summary` + `signals` on pulse / spots / sample
- `GET /v1/sample` free (15 min TTL, 10/min/IP)
- `POST /mcp` Streamable HTTP MCP + `mcp/` stdio + `server.json` + `smithery.yaml`
- Discovery docs rewritten around one call replaces four
- **No paid settle** in this pass — Bazaar metadata refresh waits for next real payment Matt approves

## What was shipped 2026-10-31 (America/Chicago) — public GitHub

- Public repo https://github.com/midnight232/crypto-pulse-api (MIT, secrets gitignored + scanned)
- MCP registry namespace set to `io.github.midnight232/crypto-pulse`
- Submission drafts updated below; **nothing submitted to directories yet**


---

## Arena discoverability pass — 2026-11-02 (America/Chicago)

Shipped in v0.5.0:
- Richer Arena section in `/llms.txt`
- `GET /.well-known/ai-catalog.json` + `GET /mcp/server-card` (SEP-2127 style)
- Sample bot at `examples/arena-bot/`
- OpenAPI paths for Arena + discovery
- MCP Registry version bump to 0.5.0 (our listing)

Directory drafts (not submitted): see [docs/directory-submissions-2026-11-02.md](./docs/directory-submissions-2026-11-02.md) for PulseMCP (paused → registry), mcp.so, and punkpeye/awesome-mcp-servers.
