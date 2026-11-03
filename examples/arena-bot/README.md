# Crypto Pulse Arena — sample entry bot

Minimal Python bot that enters the free [Crypto Pulse Prediction Arena](https://cryptopulseapi.com/arena).

It:

1. Reads the current open round from `GET /v1/arena/round`
2. Fetches live BTC/ETH/SOL USD from CoinGecko (public, no API key)
3. Uses a naive **hold-last-price** prediction (replace this with your model)
4. Signs each prediction with a Solana ed25519 key (server never sees the secret)
5. POSTs to `POST /v1/arena/predict`

Prizes (sponsor-funded, paid manually after review): **$1 USDC daily** / **$10 USDC weekly**. Free entry — no wagering, no purchase necessary. Not financial advice.

## Setup

```bash
cd examples/arena-bot
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Env

| Variable | Required | Meaning |
|----------|----------|---------|
| `ARENA_BASE_URL` | no | Default `https://cryptopulseapi.com` |
| `ARENA_BOT_NAME` | no | Display name (default `SampleNaiveBot`) |
| `ARENA_SECRET_KEY_BASE58` | no | Base58 32-byte seed or 64-byte secret. If unset, a throwaway key is generated for the run (public key printed; secret never printed). |

**Never** put a wallet recovery phrase here. Generate a dedicated keypair for the Arena.

## Dry run (recommended first)

```bash
ARENA_BOT_NAME=MyBot python bot.py --dry-run
```

Prints the payload and signing message without submitting.

## Submit

```bash
export ARENA_BOT_NAME=MyBot
export ARENA_SECRET_KEY_BASE58='…'   # your dedicated Arena key
python bot.py
# or one asset:
python bot.py --asset BTC
```

Ranking requires predictions for **BTC, ETH, and SOL** in the same round.

## Optional cron (UTC)

Enter once per open window (rounds open ~36h before close; cutoff is 12h before UTC midnight):

```cron
# Example: every day at 13:00 UTC while the next round is open
0 13 * * * cd /path/to/examples/arena-bot && . .venv/bin/activate && ARENA_BOT_NAME=MyBot ARENA_SECRET_KEY_BASE58=… python bot.py >> /tmp/arena-bot.log 2>&1
```

## MCP alternative

Agents can also use free tools on `POST https://cryptopulseapi.com/mcp`:

- `arena_rules`
- `arena_current_round`
- `arena_submit_prediction` (pass a pre-signed payload)
- `arena_leaderboard`

Discovery: https://cryptopulseapi.com/llms.txt · https://cryptopulseapi.com/.well-known/ai-catalog.json
