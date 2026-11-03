# Solana Agent Kit + Crypto Pulse Arena

Adds an **`ENTER_CRYPTO_PULSE_ARENA`** [Action](https://github.com/sendaifun/solana-agent-kit) (`solana-agent-kit` ^2.0.10) that signs Arena predictions locally and submits over REST.

For MCP **reads**, point your agent/client at `https://cryptopulseapi.com/mcp` (or `node mcp/stdio.js`). The kit’s `@solana-agent-kit/adapter-mcp` package is for exposing *kit* actions as an MCP **server**, which is optional here.

Automatic on-chain prizes from `C721akeLHdR2YKTtV5i3NbYAzqLnUdYNVyq4ZG1qweEu` while funded.

## Setup

```bash
cd examples/templates/solana-agent-kit
npm install
npm run typecheck
```

## Dry run

```bash
npm run dry-run
```

## Env

| Variable | Required | Meaning |
|----------|----------|---------|
| `ARENA_SECRET_KEY_BASE58` | for live Arena submit | Dedicated Arena key |
| `ARENA_BOT_NAME` | no | Display name |
| `SOLANA_PRIVATE_KEY` | only for other kit actions | Separate from Arena key |

## Wire into a kit agent

See `enterArenaAction.ts` and `register.mjs`. Call `enterCryptoPulseArenaAction.handler(agent, { dryRun: true })` from your agent loop or register it alongside plugin actions.
