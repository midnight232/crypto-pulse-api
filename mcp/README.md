# Crypto Pulse MCP

MCP wrapper around the Crypto Pulse x402 HTTP API.

## Remote (already live)

```
https://cryptopulseapi.com/mcp
```

Transport: **Streamable HTTP** (stateless, JSON responses).

### Tools

| Tool | Cost | Behavior |
|------|------|----------|
| `get_market_sample` | Free | Returns stale (≤15 min) full pulse JSON with `summary` + `signals` |
| `get_market_pulse` | $0.02 USDC | Returns x402 payment requirements + `GET /v1/pulse` URL (pay over HTTP) |
| `get_market_spots` | $0.005 USDC | Same pattern for `/v1/spots` |
| `arena_rules` | Free | Prediction Arena rules + signing format |
| `arena_current_round` | Free | Current round timing / whether entries are open |
| `arena_submit_prediction` | Free | Submit a pre-signed prediction for this round's asset set (BTC/ETH/SOL) |
| `arena_leaderboard` | Free | Daily or weekly leaderboard |
| `arena_prize_wallet` | Free | Public prize wallet + balances + payout history |
| `forge_modules` / `forge_templates` | Free | Pulse Forge signal modules and starter templates |
| `forge_config_message` / `forge_configure` | Free | Canonical config message, then save a signed bot (no private keys) |
| `forge_preview` / `forge_enter` | Free | Quote from a pulse snapshot and enter via the existing Arena predict path |
| `forge_progress` / `forge_leaderboard` | Free | Non-cash XP, level, streak, badges |
| `forge_share` | Free | Result-card URLs with the payout wallet as the referral code |

Paid tools intentionally return payment requirements rather than settling inside MCP: current `@x402` / community MCP payment helpers primarily target Base/EVM, while this API settles **USDC on Solana**. Agents pay the HTTP endpoint with standard x402, then use the JSON.

## Local stdio

From the repo root (after `npm ci`):

```bash
PUBLIC_BASE_URL=https://cryptopulseapi.com node mcp/stdio.js
```

Cursor / Claude Desktop snippet:

```json
{
  "mcpServers": {
    "crypto-pulse": {
      "command": "node",
      "args": ["/absolute/path/to/crypto-pulse-api/mcp/stdio.js"],
      "env": {
        "PUBLIC_BASE_URL": "https://cryptopulseapi.com"
      }
    }
  }
}
```

## Registry submissions (prepared, not submitted)

See `../MARKETING.md` § Ranked directory actions. Files ready:

- `server.json` — Official MCP Registry remote entry (`io.github.midnight232/crypto-pulse`)
- `smithery.yaml` — Smithery remote + stdio draft
- Repo: https://github.com/midnight232/crypto-pulse-api

Do **not** publish to npm or submit to registries until Matt approves each submission.
