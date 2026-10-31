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
