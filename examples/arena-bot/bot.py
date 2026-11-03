#!/usr/bin/env python3
"""
Crypto Pulse Prediction Arena — sample entry bot.

Fetches current BTC/ETH/SOL USD from CoinGecko (public, no key), applies a
naive "hold last price" prediction, signs with a Solana ed25519 key, and
POSTs to the free Arena API.

Env:
  ARENA_BASE_URL          default https://cryptopulseapi.com
  ARENA_BOT_NAME          display name (default SampleNaiveBot)
  ARENA_SECRET_KEY_BASE58 32-byte seed or 64-byte secret key (base58).
                          If unset, a throwaway keypair is generated for this run
                          (printed public key only — secret is not printed).

Flags:
  --dry-run   fetch + sign + print payload; do NOT POST
  --asset X   only submit one asset (BTC|ETH|SOL); default all three

Never pass a wallet recovery phrase. Never commit secret keys.
This is a demo / scaffold, not financial advice.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request

import base58
from nacl.signing import SigningKey

DEFAULT_BASE = "https://cryptopulseapi.com"
COINGECKO = (
    "https://api.coingecko.com/api/v3/simple/price"
    "?ids=bitcoin,ethereum,solana&vs_currencies=usd"
)
ASSET_IDS = {"BTC": "bitcoin", "ETH": "ethereum", "SOL": "solana"}
ASSETS = ("BTC", "ETH", "SOL")


def http_json(url: str, method: str = "GET", body: dict | None = None) -> tuple[int, dict]:
    data = None
    headers = {"Accept": "application/json", "User-Agent": "crypto-pulse-arena-sample-bot/0.5"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            raw = res.read().decode("utf-8")
            return res.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            parsed = {"error": "http_error", "message": raw[:400]}
        return e.code, parsed


def canonical_price(n: float) -> str:
    s = f"{n:.8f}".rstrip("0").rstrip(".")
    return s or "0"


def build_message(round_id: str, wallet: str, asset: str, price_canonical: str, bot_name: str) -> str:
    return (
        f"crypto-pulse-arena:v1|round={round_id}|wallet={wallet}"
        f"|asset={asset}|price={price_canonical}|name={bot_name or ''}"
    )


def load_signing_key() -> SigningKey:
    raw = (os.environ.get("ARENA_SECRET_KEY_BASE58") or "").strip()
    if not raw:
        return SigningKey.generate()
    secret = base58.b58decode(raw)
    if len(secret) == 32:
        return SigningKey(secret)
    if len(secret) == 64:
        return SigningKey(secret[:32])
    raise SystemExit("ARENA_SECRET_KEY_BASE58 must decode to 32 or 64 bytes")


def fetch_spots() -> dict[str, float]:
    status, data = http_json(COINGECKO)
    if status != 200:
        raise SystemExit(f"CoinGecko failed ({status}): {data}")
    out = {}
    for asset, cid in ASSET_IDS.items():
        usd = data.get(cid, {}).get("usd")
        if not isinstance(usd, (int, float)) or usd <= 0:
            raise SystemExit(f"missing {asset} usd on CoinGecko: {data}")
        out[asset] = float(usd)
    return out


def naive_predict(spots: dict[str, float]) -> dict[str, float]:
    """Hold last price — simplest baseline. Builders should replace this."""
    return dict(spots)


def main() -> int:
    parser = argparse.ArgumentParser(description="Crypto Pulse Arena sample bot")
    parser.add_argument("--dry-run", action="store_true", help="Do not POST; print payload only")
    parser.add_argument("--asset", choices=ASSETS, help="Submit only one asset (default: all)")
    args = parser.parse_args()

    base = (os.environ.get("ARENA_BASE_URL") or DEFAULT_BASE).rstrip("/")
    bot_name = (os.environ.get("ARENA_BOT_NAME") or "SampleNaiveBot").strip()[:32]

    status, round_json = http_json(f"{base}/v1/arena/round")
    if status != 200:
        print(json.dumps({"error": "round_fetch_failed", "status": status, "body": round_json}, indent=2))
        return 1
    if not round_json.get("acceptingEntries"):
        print(
            json.dumps(
                {
                    "error": "round_not_accepting",
                    "roundId": round_json.get("roundId"),
                    "status": round_json.get("status"),
                },
                indent=2,
            )
        )
        return 1

    round_id = round_json["roundId"]
    spots = fetch_spots()
    preds = naive_predict(spots)
    sk = load_signing_key()
    wallet = base58.b58encode(bytes(sk.verify_key)).decode("ascii")

    assets = [args.asset] if args.asset else list(ASSETS)
    results = []
    for asset in assets:
        price = preds[asset]
        price_canonical = canonical_price(price)
        message = build_message(round_id, wallet, asset, price_canonical, bot_name)
        sig = sk.sign(message.encode("utf-8")).signature
        signature = base58.b58encode(sig).decode("ascii")
        body = {
            "roundId": round_id,
            "wallet": wallet,
            "asset": asset,
            "price": float(price_canonical),
            "botName": bot_name,
            "signature": signature,
        }
        if args.dry_run:
            results.append({"dryRun": True, "message": message, "body": {**body, "signature": signature[:12] + "…"}})
            continue
        code, resp = http_json(f"{base}/v1/arena/predict", method="POST", body=body)
        results.append(
            {
                "httpStatus": code,
                "asset": asset,
                "price": float(price_canonical),
                "ok": resp.get("ok"),
                "created": resp.get("created"),
                "error": resp.get("error"),
                "message": resp.get("message"),
            }
        )

    print(
        json.dumps(
            {
                "base": base,
                "roundId": round_id,
                "wallet": wallet,
                "botName": bot_name,
                "spotsUsd": spots,
                "dryRun": bool(args.dry_run),
                "results": results,
            },
            indent=2,
        )
    )
    if args.dry_run:
        return 0
    return 0 if all(r.get("httpStatus") in (200, 201) for r in results) else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
