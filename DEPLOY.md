# Deploy crypto-pulse-api (DigitalOcean)

This service is **mainnet-ready** when `NETWORK=mainnet`. It does **not** hold private keys — payments settle to Matt’s public Solana address via an x402 facilitator.

## Defaults (mainnet)

| Setting | Value |
|---------|--------|
| `NETWORK` | `mainnet` |
| `payTo` | `37CP6YemJJQ6sMu4Ue6C7pgC7BXkN6iCcCHVeZunvPod` |
| Network CAIP-2 | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` |
| USDC mint | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| Price | `$0.02` |
| Facilitator | Coinbase CDP `https://api.cdp.coinbase.com/platform/v2/x402` (Solana mainnet exact; CDP API keys via `/etc/crypto-pulse.env`) |
| Fallback / prior | PayAI `https://facilitator.payai.network` (listing retained from earlier settles) |

Optional override: Coinbase CDP facilitator needs API keys (`CDP_API_KEY_ID` / `CDP_API_KEY_SECRET`) — not required for PayAI.

## Still needed before real traffic

1. **DigitalOcean account** + a Droplet or App Platform app (this box is not a public host).
2. **Domain** + DNS A/AAAA to the host.
3. **HTTPS** (Caddy reverse proxy recommended).
4. First paid call through PayAI so Bazaar discovery can index (PayAI supports the `bazaar` extension).
5. Optional: dedicated Solana RPC URL (`SOLANA_RPC_URL`) if public RPC rate-limits.

## Option A — Droplet + Docker + Caddy

```bash
# On a Ubuntu 24.04 droplet
sudo apt update && sudo apt install -y docker.io docker-compose-v2 caddy
sudo usermod -aG docker $USER   # re-login after

# App directory
sudo mkdir -p /opt/crypto-pulse-api && sudo chown $USER:$USER /opt/crypto-pulse-api
cd /opt/crypto-pulse-api
# copy repo files (git clone or scp), then:
docker build -t crypto-pulse-api .
docker run -d --name crypto-pulse --restart unless-stopped \
  -p 127.0.0.1:4021:4021 \
  -e NETWORK=mainnet \
  -e HOST=0.0.0.0 \
  -e PORT=4021 \
  -e FACILITATOR_URL=https://facilitator.payai.network \
  -e MAINNET_PAY_TO=37CP6YemJJQ6sMu4Ue6C7pgC7BXkN6iCcCHVeZunvPod \
  crypto-pulse-api
```

Caddyfile (`/etc/caddy/Caddyfile`):

```
pulse.example.com {
  reverse_proxy 127.0.0.1:4021
}
```

```bash
sudo systemctl reload caddy
curl -sS https://pulse.example.com/health
# Unpaid probe (expect 402 — do not settle unless intentional):
curl -sS -D- https://pulse.example.com/v1/pulse -o /dev/null | head
```

## Option B — Droplet + systemd (no Docker)

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo useradd -r -m -d /opt/crypto-pulse-api pulse || true
# place app under /opt/crypto-pulse-api, npm ci --omit=dev
```

`/etc/systemd/system/crypto-pulse.service`:

```
[Unit]
Description=crypto-pulse-api
After=network.target

[Service]
Type=simple
User=pulse
WorkingDirectory=/opt/crypto-pulse-api
Environment=NODE_ENV=production
Environment=NETWORK=mainnet
Environment=HOST=127.0.0.1
Environment=PORT=4021
Environment=FACILITATOR_URL=https://facilitator.payai.network
Environment=MAINNET_PAY_TO=37CP6YemJJQ6sMu4Ue6C7pgC7BXkN6iCcCHVeZunvPod
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now crypto-pulse
```

Put Caddy in front as in Option A.

## Option C — PM2

```bash
npm ci --omit=dev
NETWORK=mainnet HOST=127.0.0.1 PORT=4021 \
FACILITATOR_URL=https://facilitator.payai.network \
pm2 start src/server.js --name crypto-pulse
pm2 save && pm2 startup
```

## Option D — DigitalOcean App Platform

1. Create App from GitHub/repo or Dockerfile.
2. HTTP port `4021`.
3. Env: `NETWORK=mainnet`, `HOST=0.0.0.0`, `PORT=4021`, `FACILITATOR_URL=https://facilitator.payai.network`, `MAINNET_PAY_TO=37CP6YemJJQ6sMu4Ue6C7pgC7BXkN6iCcCHVeZunvPod`.
4. Attach a custom domain (DO manages TLS).

## Smoke after deploy

```bash
curl -sS https://YOUR_DOMAIN/health
curl -sS -o /dev/null -w "%{http_code}\n" https://YOUR_DOMAIN/v1/pulse   # expect 402
```

Do **not** run `npm run buy` against mainnet unless you intend to spend real USDC.


## Live Droplet (Oct 30, 2026)

| Field | Value |
|-------|--------|
| Public base URL | `https://137-184-201-7.sslip.io` |
| Paid endpoint | `https://137-184-201-7.sslip.io/v1/pulse` |
| Droplet name | `crypto-pulse-api` |
| Region | `nyc1` |
| Size | `s-1vcpu-512mb-10gb` ($4/mo) |
| Image | Ubuntu 24.04 x64 |
| App path on server | `/opt/crypto-pulse-api` |
| Process | systemd unit `crypto-pulse` (user `pulse`) |
| TLS / proxy | Caddy → `127.0.0.1:4021` |
| Firewall | ufw allow 22, 80, 443 only |

### SSH from this box

```bash
ssh -i /workspace/crypto-pulse-api/.deploy-ssh/id_ed25519 root@137.184.201.7
```

(The private key lives at `.deploy-ssh/id_ed25519`, gitignored. Do not copy `.do-token` or `.devnet-keys` to the server.)

### Redeploy app code

```bash
IP=137.184.201.7
KEY=/workspace/crypto-pulse-api/.deploy-ssh/id_ed25519
scp -i "$KEY" package.json package-lock.json README.md MARKETING.md DEPLOY.md root@$IP:/opt/crypto-pulse-api/
scp -i "$KEY" -r src mcp root@$IP:/opt/crypto-pulse-api/
ssh -i "$KEY" root@$IP 'chown -R pulse:pulse /opt/crypto-pulse-api && cd /opt/crypto-pulse-api && sudo -u pulse npm ci --omit=dev && systemctl restart crypto-pulse'
```

### Smoke (no paid settle)

```bash
curl -sS https://137-184-201-7.sslip.io/health
curl -sS -o /dev/null -w "%{http_code}\n" https://137-184-201-7.sslip.io/v1/pulse   # expect 402
curl -sS https://137-184-201-7.sslip.io/v1/sample | head -c 200   # free sample + summary
PUBLIC_BASE_URL=https://137-184-201-7.sslip.io npm run test:mcp   # MCP initialize/list/sample
```

### Agent discovery (free)

After the Oct 30 marketing pass:

- `GET /llms.txt`
- `GET /.well-known/x402`
- `GET /openapi.json`
- Free sample: `GET /v1/sample` (≤15 min old)
- MCP: `POST /mcp` (Streamable HTTP)
- Paid: `GET /v1/pulse` ($0.02), `GET /v1/pulse/:asset` ($0.02), `GET /v1/spots` ($0.005)

Bazaar catalog metadata refreshes only after the next extension-carrying verify/settle through PayAI. Do not settle without Matt approving the exact USDC spend.


### CDP facilitator (Coinbase Bazaar)

As of Oct 30, 2026 the live droplet settles through **Coinbase CDP** so resources appear in CDP Bazaar discovery. PayAI listing remains from earlier settles (`listed:true`).

- systemd `EnvironmentFile=/etc/crypto-pulse.env` (mode `600`, owner `root:root`) holds `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` plus `FACILITATOR=cdp`. Never commit these keys; `.cdp-keys/` is gitignored.
- Redeploy code as above, then `systemctl restart crypto-pulse`.
- First CDP settle indexes the resource in `GET https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?query=...` (auth optional for some list endpoints; search works with CDP JWT).
