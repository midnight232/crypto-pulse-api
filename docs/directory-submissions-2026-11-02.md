# Directory submissions — prepared 2026-11-02 (America/Chicago)

**Status: DRAFT ONLY. Do not submit until Matt says yes to each one.**

Already live / ours:
- Official MCP Registry: `io.github.midnight232/crypto-pulse` (will publish **0.5.0** as our own listing update)
- Glama: previously submitted / synced to cryptopulseapi.com (confirm listing after registry bump)
- CDP + PayAI Bazaars: indexed via x402 settles (no new submit)

Not listed yet (checked 2026-11-02):
- punkpeye/awesome-mcp-servers — no hit for midnight232 / crypto-pulse-api / cryptopulseapi
- PulseMCP — submissions currently **paused**; ingest path is Official MCP Registry
- mcp.so — confirm manually after Matt picks free issue vs paid form

---

## 1. PulseMCP — https://www.pulsemcp.com/servers

| Field | Value |
|-------|--------|
| Method | **No form right now.** Submit page says new listings/changes are paused while they rework ingestion. |
| What to do | Keep Official MCP Registry entry current (`mcp-publisher publish` for 0.5.0). PulseMCP says it will pick up registry entries when it reopens. |
| Recheck | https://www.pulsemcp.com/submit and search `https://www.pulsemcp.com/servers?q=crypto-pulse` |
| Draft copy (if form reopens) | Name: Crypto Pulse · Remote: `https://cryptopulseapi.com/mcp` · Repo: `https://github.com/midnight232/crypto-pulse-api` · Description: One call replaces four crypto data fetches for AI agents (spots, Fear & Greed, Hyperliquid funding, DefiLlama) + summary; free sample; free BTC/ETH/SOL Prediction Arena; x402 USDC on Solana. |

**Action for Matt:** none until PulseMCP reopens (registry publish already covers their stated path).

---

## 2. mcp.so — https://mcp.so/submit

| Field | Value |
|-------|--------|
| Paid form | Remote Server tab · confirm live price (historically ~$39 one-time) before paying |
| Free path | Comment on https://github.com/chatmcp/mcpso/issues/1 **or** open issue titled `Submit Remote MCP Server` |

**Paid form fields (draft):**
- Name: Crypto Pulse
- Remote endpoint: `https://cryptopulseapi.com/mcp`
- Repository: `https://github.com/midnight232/crypto-pulse-api`

**Free issue body (draft):**
```
Name: Crypto Pulse
Remote MCP: https://cryptopulseapi.com/mcp
GitHub: https://github.com/midnight232/crypto-pulse-api
Homepage: https://cryptopulseapi.com/
Official registry: io.github.midnight232/crypto-pulse
Description: One call replaces four crypto data sources (spots, Fear & Greed, Hyperliquid funding, DefiLlama) with a plain-English summary. Free sample + Streamable HTTP MCP. Free Crypto Pulse Prediction Arena (BTC/ETH/SOL daily closes; $1 USDC daily / $10 weekly prizes paid manually by the sponsor). Paid pulse/spots via x402 USDC on Solana.
Tools: get_market_sample (free), get_market_pulse ($0.02 via x402 HTTP), get_market_spots ($0.005 via x402 HTTP), arena_rules, arena_current_round, arena_submit_prediction, arena_leaderboard (all free)
llms.txt: https://cryptopulseapi.com/llms.txt
Sample bot: https://github.com/midnight232/crypto-pulse-api/tree/master/examples/arena-bot
```

**Action for Matt:** pick free issue vs paid form; if paid, approve the exact dollar amount first.

---

## 3. punkpeye/awesome-mcp-servers — free PR

| Field | Value |
|-------|--------|
| Target | https://github.com/punkpeye/awesome-mcp-servers |
| Section | Finance & Fintech (`### 💰 Finance & Fintech`) — alphabetical near other `m*` repos |
| Cost | Free PR |
| Already listed? | No (search 2026-11-02) |

**PR title:** `Add midnight232/crypto-pulse-api (Solana x402 market pulse + free prediction arena)`

**Bullet to insert (Node remote = 📇 ☁️):**
```
- [midnight232/crypto-pulse-api](https://github.com/midnight232/crypto-pulse-api) 📇 ☁️ - Crypto market pulse for agents via x402 USDC on Solana (spots + Fear & Greed + Hyperliquid funding + DefiLlama + summary). Free sample + free BTC/ETH/SOL Prediction Arena. Remote MCP at https://cryptopulseapi.com/mcp
```

**Action for Matt:** approve opening the PR as midnight232.

---

## 4. Other well-fitting directories (optional)

### Smithery — https://smithery.ai/
- Method: GitHub login as midnight232 → add remote Streamable HTTP `https://cryptopulseapi.com/mcp` (draft config in `mcp/smithery.yaml`)
- Cost: free listing
- Needs Matt's yes + Smithery account

### Official MCP Registry (ours — version bump only)
```bash
cd /workspace/crypto-pulse-api/mcp
mcp-publisher publish   # publishes server.json 0.5.0
curl -sS "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.midnight232/crypto-pulse"
```

### Glama
- Already submitted earlier; after 0.5.0 registry publish, confirm listing still shows cryptopulseapi.com
