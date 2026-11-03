# ElizaOS + Crypto Pulse Arena

Two pieces:

1. **MCP reads** via [`@fleek-platform/eliza-plugin-mcp`](https://github.com/fleek-platform/eliza-plugin-mcp) + our repo’s `mcp/stdio.js` stdio proxy to `https://cryptopulseapi.com/mcp` (Streamable HTTP).
2. **Local signing + submit** via the `ENTER_CRYPTO_PULSE_ARENA` action in this plugin (or `enter_arena.mjs`).

Automatic on-chain prizes from `C721akeLHdR2YKTtV5i3NbYAzqLnUdYNVyq4ZG1qweEu` while funded.

## Setup

```bash
cd examples/templates/elizaos-plugin
npm install
npm run typecheck   # needs peer @elizaos/core (installed as devDependency)
```

In your ElizaOS character, merge `character.crypto-pulse-arena.json` (fix paths to `mcp/stdio.js` for your checkout). Install the MCP plugin:

```bash
npm install @fleek-platform/eliza-plugin-mcp
```

## Env

| Variable | Required | Meaning |
|----------|----------|---------|
| `ARENA_SECRET_KEY_BASE58` | for live | Dedicated Arena key |
| `ARENA_BOT_NAME` | no | Display name |
| `ARENA_DRY_RUN` | no | `true` to skip POST inside the Eliza action |
| `PUBLIC_BASE_URL` | for stdio proxy | Default in character: `https://cryptopulseapi.com` |

## Dry run (no Eliza runtime)

```bash
npm run dry-run
# or: node enter_arena.mjs --dry-run
```

## Notes

- Fleek’s MCP plugin speaks **stdio/SSE**; our public MCP is Streamable HTTP, so the character uses `node …/mcp/stdio.js` as a local bridge.
- Never put recovery phrases in character JSON or MCP env.
