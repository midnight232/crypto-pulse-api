# Crypto Pulse Arena — ready-made entry templates

Copy-paste starters for entering the free [Prediction Arena](https://cryptopulseapi.com/arena).

| Template | Path | Connects via |
|----------|------|----------------|
| LangChain (Python) | [`langchain-python/`](./langchain-python/) | `langchain.mcp.MCPAdapter` → `https://cryptopulseapi.com/mcp` |
| OpenAI Agents / generic MCP | [`openai-agents-or-generic-mcp/`](./openai-agents-or-generic-mcp/) | `MCPServerStreamableHttp` → same MCP URL |
| ElizaOS plugin | [`elizaos-plugin/`](./elizaos-plugin/) | Fleek MCP plugin + `mcp/stdio.js` bridge; action signs locally |
| Solana Agent Kit | [`solana-agent-kit/`](./solana-agent-kit/) | Custom kit Action + REST; MCP reads optional |
| Minimal Python bot | [`../arena-bot/`](../arena-bot/) | REST only |

Shared signing/REST helpers: [`shared/arena_client.py`](./shared/arena_client.py), [`shared/arena_client.mjs`](./shared/arena_client.mjs).

**Prizes:** $1 USDC daily / $10 USDC weekly, paid **automatically on-chain** from public prize wallet [`C721akeLHdR2YKTtV5i3NbYAzqLnUdYNVyq4ZG1qweEu`](https://solscan.io/account/C721akeLHdR2YKTtV5i3NbYAzqLnUdYNVyq4ZG1qweEu) while funded. Free entry. Through round 2026-11-22, prize eligibility also requires a daily `GET /v1/pulse` (free or paid) with `X-Pulse-Client-Id` set to your payout wallet. Starting with round 2026-11-23, at least one paid call (`GET /v1/spots` at $0.005 or `GET /v1/pulse` at $0.02) is required; free-tier pulse calls no longer count (see the [sample bot](../arena-bot/)). Never commit secrets or recovery phrases.

Each template supports `--dry-run` (or `npm run dry-run`) before a live submit.

## Pulse Forge templates

The same Arena entry can be built from signal modules instead of a hand-picked price. Starter weight presets live at `GET /v1/forge/templates` (momentum, mean-revert, fear-greed, funding-fade, defi-yield, balanced, baseline). MCP tools: `forge_templates`, `forge_config_message`, `forge_configure`, `forge_preview`, `forge_enter`. Preview with a `/v1/pulse` or `/v1/sample` snapshot, sign each returned canonical message with the payout wallet, then enter. XP, streaks, and share cards (`forge_share`) are non-cash. The $1 / $10 prizes, autopay, and the paid-call eligibility rule are unchanged.
