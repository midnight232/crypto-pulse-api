#!/usr/bin/env python3
"""
OpenAI Agents SDK (or generic MCP) + Crypto Pulse Arena.

Connects with agents.mcp.MCPServerStreamableHttp to
https://cryptopulseapi.com/mcp, lists tools, then signs + submits via REST.

Dry-run needs no OpenAI key. Optional agent path uses OPENAI_API_KEY.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared"))

from arena_client import enter_naive, fetch_prize_wallet, fetch_rules, get_base  # noqa: E402

MCP_URL = os.environ.get("CRYPTO_PULSE_MCP_URL", "https://cryptopulseapi.com/mcp")


async def list_mcp_tools() -> list[str]:
    from agents.mcp import MCPServerStreamableHttp

    async with MCPServerStreamableHttp(
        name="Crypto Pulse",
        params={"url": MCP_URL, "timeout": 30},
        client_session_timeout_seconds=30,
    ) as server:
        tools = await server.list_tools()
    # SDK returns Tool objects or dict-like; normalize names.
    names = []
    for t in tools:
        names.append(getattr(t, "name", None) or (t.get("name") if isinstance(t, dict) else str(t)))
    return names


async def optional_agent_probe() -> str | None:
    if not (os.environ.get("OPENAI_API_KEY") or "").strip():
        return None
    from agents import Agent, Runner
    from agents.mcp import MCPServerStreamableHttp

    async with MCPServerStreamableHttp(
        name="Crypto Pulse",
        params={"url": MCP_URL, "timeout": 30},
        client_session_timeout_seconds=30,
    ) as server:
        agent = Agent(
            name="Arena Reader",
            instructions=(
                "Use arena_rules and arena_prize_wallet. "
                "Summarize prizes and autopay status briefly. Do not invent numbers."
            ),
            mcp_servers=[server],
        )
        result = await Runner.run(
            agent,
            "What are the Arena prizes and is the prize wallet funded?",
        )
    return str(result.final_output)[:800]


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--skip-mcp", action="store_true")
    args = parser.parse_args()

    out: dict = {"base": get_base(), "mcpUrl": MCP_URL}
    if not args.skip_mcp:
        names = await list_mcp_tools()
        out["mcpTools"] = names
        needed = {
            "arena_rules",
            "arena_current_round",
            "arena_submit_prediction",
            "arena_leaderboard",
            "arena_prize_wallet",
        }
        missing = sorted(needed - set(names))
        if missing:
            out["mcpMissing"] = missing
            print(json.dumps(out, indent=2))
            return 1

    out["rulesSnippet"] = {k: fetch_rules().get(k) for k in ("name", "freeEntry", "prizes")}
    out["prizeWallet"] = fetch_prize_wallet()
    out["entry"] = enter_naive(dry_run=args.dry_run)

    summary = await optional_agent_probe()
    if summary:
        out["agentSummary"] = summary

    print(json.dumps(out, indent=2, default=str))
    if args.dry_run:
        return 0
    results = out["entry"]["results"]
    return 0 if all(r.get("httpStatus") in (200, 201) for r in results) else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
