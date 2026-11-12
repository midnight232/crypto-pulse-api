"""Shared Crypto Pulse Arena REST client + ed25519 signing (no framework deps)."""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any

import base58
from nacl.signing import SigningKey

DEFAULT_BASE = "https://cryptopulseapi.com"
COINGECKO = "https://api.coingecko.com/api/v3/simple/price?ids={ids}&vs_currencies=usd"
ASSET_IDS = {"BTC": "bitcoin", "ETH": "ethereum", "SOL": "solana", "SUI": "sui", "HYPE": "hyperliquid"}
ASSETS = ("BTC", "ETH", "SOL", "SUI", "HYPE")


def http_json(url: str, method: str = "GET", body: dict | None = None) -> tuple[int, Any]:
    data = None
    headers = {
        "Accept": "application/json",
        "User-Agent": "crypto-pulse-arena-template/0.6",
    }
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
    s = f"{float(n):.8f}".rstrip("0").rstrip(".")
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


def fetch_spots(assets: tuple[str, ...] | list[str] = ASSETS) -> dict[str, float]:
    ids = ",".join(ASSET_IDS[a] for a in assets)
    status, data = http_json(COINGECKO.format(ids=ids))
    if status != 200:
        raise SystemExit(f"CoinGecko failed ({status}): {data}")
    out: dict[str, float] = {}
    for asset in assets:
        cid = ASSET_IDS[asset]
        usd = data.get(cid, {}).get("usd")
        if not isinstance(usd, (int, float)) or usd <= 0:
            raise SystemExit(f"missing {asset} on CoinGecko")
        out[asset] = float(usd)
    return out


def get_base() -> str:
    return (os.environ.get("ARENA_BASE_URL") or DEFAULT_BASE).rstrip("/")


def get_bot_name() -> str:
    return (os.environ.get("ARENA_BOT_NAME") or "TemplateBot").strip()[:32]


def fetch_round(base: str | None = None) -> dict:
    base = base or get_base()
    status, body = http_json(f"{base}/v1/arena/round")
    if status != 200:
        raise SystemExit(f"round fetch failed: {status} {body}")
    return body


def fetch_rules(base: str | None = None) -> dict:
    base = base or get_base()
    status, body = http_json(f"{base}/v1/arena/rules")
    if status != 200:
        raise SystemExit(f"rules fetch failed: {status} {body}")
    return body


def fetch_leaderboard(base: str | None = None, weekly: bool = False) -> dict:
    base = base or get_base()
    path = "/v1/arena/leaderboard/weekly" if weekly else "/v1/arena/leaderboard"
    status, body = http_json(f"{base}{path}")
    if status != 200:
        raise SystemExit(f"leaderboard failed: {status} {body}")
    return body


def fetch_prize_wallet(base: str | None = None) -> dict:
    base = base or get_base()
    status, body = http_json(f"{base}/v1/arena/prize-wallet")
    if status != 200:
        raise SystemExit(f"prize-wallet failed: {status} {body}")
    return body


def build_signed_prediction(
    *,
    round_id: str,
    asset: str,
    price: float,
    sk: SigningKey,
    bot_name: str,
) -> dict:
    wallet = base58.b58encode(bytes(sk.verify_key)).decode("ascii")
    price_canonical = canonical_price(price)
    message = build_message(round_id, wallet, asset, price_canonical, bot_name)
    sig = sk.sign(message.encode("utf-8")).signature
    return {
        "roundId": round_id,
        "wallet": wallet,
        "asset": asset,
        "price": float(price_canonical),
        "botName": bot_name,
        "signature": base58.b58encode(sig).decode("ascii"),
        "_message": message,  # dry-run only; strip before POST
    }


def submit_prediction(body: dict, *, base: str | None = None, dry_run: bool = False) -> dict:
    base = base or get_base()
    payload = {k: v for k, v in body.items() if not k.startswith("_")}
    if dry_run:
        return {
            "dryRun": True,
            "message": body.get("_message"),
            "body": {**payload, "signature": payload["signature"][:12] + "…"},
        }
    code, resp = http_json(f"{base}/v1/arena/predict", method="POST", body=payload)
    return {"httpStatus": code, **(resp if isinstance(resp, dict) else {"raw": resp})}


def enter_naive(*, dry_run: bool = False, assets: tuple[str, ...] | None = None) -> dict:
    """Hold-last-price entry for this round's asset set. Replace prediction logic as needed."""
    base = get_base()
    bot_name = get_bot_name()
    round_json = fetch_round(base)
    if not round_json.get("acceptingEntries"):
        raise SystemExit(
            f"round {round_json.get('roundId')} not accepting entries "
            f"(status={round_json.get('status')})"
        )
    round_assets = tuple(a for a in (round_json.get("assets") or ASSETS) if a in ASSET_IDS)
    use_assets = assets or round_assets
    spots = fetch_spots(use_assets)
    sk = load_signing_key()
    wallet = base58.b58encode(bytes(sk.verify_key)).decode("ascii")
    results = []
    for asset in use_assets:
        signed = build_signed_prediction(
            round_id=round_json["roundId"],
            asset=asset,
            price=spots[asset],
            sk=sk,
            bot_name=bot_name,
        )
        results.append(submit_prediction(signed, base=base, dry_run=dry_run))
    return {
        "base": base,
        "roundId": round_json["roundId"],
        "wallet": wallet,
        "botName": bot_name,
        "spotsUsd": spots,
        "dryRun": dry_run,
        "results": results,
    }
