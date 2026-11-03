#!/usr/bin/env python3
"""
LangChain + Crypto Pulse Arena template.

1) Connects to https://cryptopulseapi.com/mcp via langchain.mcp.MCPAdapter
2) Lists Arena tools (arena_rules, arena_current_round, …)
3) Signs a naive prediction locally (server never sees the secret)
4) Submits via REST (or you can call arena_submit_prediction with the signed body)

Usage:
  python enter_arena.py --dry-run
  ARENA_SECRET_KEY_BASE58=… python enter_arena.py

Optional: set OPENAI_API_KEY to also build a LangChain agent that can *read*
Arena MCP tools (submit still uses local signing — never put keys in the model).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import warnings
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared"))

from arena_client import (  # noqa: E402
    enter_naive,
    fetch_prize_wallet,
    fetch_rules,
    get_base,
)

MCP_URL = os.environ.get("CRYPTO_PULSE_MCP_URL", "https://cryptopulseapi.com/mcp")


async def list_mcp_tools() -> list[str]:
    # langchain.mcp is the built-in adapter (langchain>=1.4). Suppress beta warning in demos.
    warnings.filterwarnings("ignore", category=UserWarning, module="langchain")
    from langchain.mcp import MCPAdapter  # type: ignore

    async with MCPAdapter(MCP_URL) as adapter:
        tools = await adapter.list_tools()
    return [getattr(t, "name", str(t)) for t in tools]


async def optional_agent_probe(tool_names: list[str]) -> str | None:
    """If OPENAI_API_KEY is set, create a read-only agent and ask for rules summary."""
    if not (os.environ.get("OPENAI_API_KEY") or "").strip():
        return None
    warnings.filterwarnings("ignore", category=UserWarning, module="langchain")
    from langchain.agents import create_agent  # type: ignore
    from langchain.mcp import MCPAdapter  # type: ignore

    async with MCPAdapter(MCP_URL) as adapter:
        tools = await adapter.list_tools()
        # Prefer read tools only for the demo agent.
        read = [
            t
            for t in tools
            if getattr(t, "name", "")
            in {
                "arena_rules",
                "arena_current_round",
                "arena_leaderboard",
                "arena_prize_wallet",
                "get_market_sample",
            }
        ]
        agent = create_agent(
            os.environ.get("LANGCHAIN_MODEL", "openai:gpt-4.1-mini"),
            tools=read or tools,
        )
        result = await agent.ainvoke(
            {
                "messages": [
                    {
                        "role": "user",
                        "content": (
                            "Call arena_rules and arena_prize_wallet. "
                            "Summarize prizes and whether autopay is on. Be brief."
                        ),
                    }
                ]
            }
        )
    # Result shape varies; stringify last message content when present.
    msgs = result.get("messages") if isinstance(result, dict) else None
    if msgs:
        last = msgs[-1]
        content = getattr(last, "content", None) or (last.get("content") if isinstance(last, dict) else None)
        return str(content)[:800]
    return str(result)[:800]


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--skip-mcp", action="store_true", help="Skip MCP tool listing")
    args = parser.parse_args()
    if str(os.environ.get("ARENA_DRY_RUN", "")).lower() in ("1", "true", "yes"):
        args.dry_run = True

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

    out["rulesSnippet"] = {
        k: fetch_rules().get(k)
        for k in ("name", "freeEntry", "prizes")
    }
    out["prizeWallet"] = fetch_prize_wallet()
    out["entry"] = enter_naive(dry_run=args.dry_run)

    agent_summary = await optional_agent_probe(out.get("mcpTools") or [])
    if agent_summary:
        out["agentSummary"] = agent_summary

    print(json.dumps(out, indent=2, default=str))
    if args.dry_run:
        return 0
    results = out["entry"]["results"]
    return 0 if all(r.get("httpStatus") in (200, 201) for r in results) else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
