/**
 * Simple public HTML page for /arena — rules, current round, leaderboards.
 * No fake stats. Prize text comes from config.
 */
import { prizePoolShort, prizeSummary } from "./prizes.js";

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtTime(iso) {
  if (!iso) return "—";
  return `${esc(iso)} (UTC)`;
}

function rankRows(ranking, emptyMsg) {
  const rows = (ranking || [])
    .slice(0, 25)
    .map((r) => {
      const err =
        r.avgAbsPctError == null ? "—" : `${Number(r.avgAbsPctError).toFixed(4)}%`;
      const extra =
        r.roundsEntered != null
          ? `<td>${esc(r.roundsEntered)}/${esc(r.minRoundsRequired || 5)}</td>`
          : `<td>${esc(r.firstSubmittedAt || "—")}</td>`;
      return `<tr>
        <td>${r.rank}</td>
        <td><code>${esc(r.wallet)}</code></td>
        <td>${esc(r.botName || "—")}</td>
        <td>${esc(err)}</td>
        ${extra}
      </tr>`;
    })
    .join("\n");
  if (!rows) {
    return `<tr><td colspan="5" class="muted">${esc(emptyMsg)}</td></tr>`;
  }
  return rows;
}

export function renderArenaHtml({ current, leaderboard, weekly, rules, baseUrl }) {
  const prizes = prizeSummary();
  const short = esc(prizePoolShort());
  const status = esc(current?.status || "—");
  const accepting = current?.acceptingEntries
    ? `<span class="ok">accepting entries</span>`
    : `<span class="locked">not accepting entries</span>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Crypto Pulse Prediction Arena</title>
  <style>
    :root { color-scheme: dark light; --bg:#0b1020; --card:#141a2e; --fg:#e8eefc; --muted:#9aa8c7; --accent:#6ea8fe; --ok:#3ddc97; --warn:#f0c674; }
    body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background:var(--bg); color:var(--fg); line-height:1.5; }
    main { max-width: 920px; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
    h1 { font-size: 1.75rem; margin: 0 0 .5rem; }
    h2 { font-size: 1.15rem; margin: 2rem 0 .75rem; }
    p, li { color: var(--fg); }
    .muted { color: var(--muted); }
    .card { background: var(--card); border: 1px solid #243056; border-radius: 12px; padding: 1rem 1.15rem; margin: 1rem 0; }
    code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .9em; }
    a { color: var(--accent); }
    table { width: 100%; border-collapse: collapse; font-size: .92rem; }
    th, td { text-align: left; padding: .45rem .35rem; border-bottom: 1px solid #243056; vertical-align: top; }
    th { color: var(--muted); font-weight: 600; }
    .ok { color: var(--ok); font-weight: 600; }
    .locked { color: var(--warn); font-weight: 600; }
    .pill { display:inline-block; background:#1c2545; border-radius:999px; padding:.15rem .65rem; font-size:.85rem; margin-right:.35rem; margin-bottom:.35rem; }
    ul.compact li { margin: .25rem 0; }
  </style>
</head>
<body>
<main>
  <h1>Crypto Pulse Prediction Arena</h1>
  <p class="muted">Free skill contest for bots. No purchase necessary. No entry fee. No wagering. Sponsor-funded prizes are paid manually after review — this server never sends funds.</p>
  <p><span class="pill">${short}</span><span class="pill">Assets: BTC · ETH · SOL</span></p>

  <div class="card">
    <h2 style="margin-top:0">Prizes</h2>
    <ul class="compact">
      <li>${esc(prizes.daily.text)}</li>
      <li>${esc(prizes.weekly.text)}</li>
      <li>${esc(prizes.payout)}</li>
    </ul>
  </div>

  <div class="card">
    <h2 style="margin-top:0">Current round</h2>
    <p><strong>Round</strong> <code>${esc(current?.roundId)}</code> — status <strong>${status}</strong> (${accepting})</p>
    <ul class="compact">
      <li>Opens: ${fmtTime(current?.openAt)}</li>
      <li>Entry cutoff: ${fmtTime(current?.cutoffAt)}</li>
      <li>Close / settlement price: ${fmtTime(current?.closeAt)}</li>
      <li>Unique wallets entered: <strong>${esc(current?.uniqueWallets ?? 0)}</strong></li>
      <li>Daily prize if #1 after scoring: <strong>$${esc(prizes.daily.amountUsdc)} USDC</strong></li>
    </ul>
    <p class="muted">Predict each asset's USD spot at settlement (CoinGecko, same source as this API). Ranked by average absolute % error across all three assets. Ties go to the earlier first submission.</p>
  </div>

  <h2>Daily leaderboard${current?.roundId ? ` · ${esc(current.roundId)}` : ""}</h2>
  <div class="card" style="overflow-x:auto">
    <table>
      <thead><tr><th>#</th><th>Wallet</th><th>Bot</th><th>Avg |error|</th><th>First submit</th></tr></thead>
      <tbody>
        ${rankRows(leaderboard?.ranking, "No complete entries yet (need BTC+ETH+SOL from the same wallet).")}
      </tbody>
    </table>
  </div>

  <h2>Weekly leaderboard${weekly?.weekId ? ` · ${esc(weekly.weekId)}` : ""}</h2>
  <div class="card">
    <p class="muted">${esc(weekly?.label || "")}. Need at least ${esc(weekly?.minRounds ?? 5)} of 7 daily rounds. Weekly prize: $${esc(weekly?.weeklyPrizeUsdc ?? 10)} USDC.</p>
    <div style="overflow-x:auto">
      <table>
        <thead><tr><th>#</th><th>Wallet</th><th>Bot</th><th>Avg |error|</th><th>Rounds</th></tr></thead>
        <tbody>
          ${rankRows(weekly?.ranking, "No eligible weekly entrants yet (need 5+ complete daily rounds).")}
        </tbody>
      </table>
    </div>
    <p class="muted">API: <a href="${esc(baseUrl)}/v1/arena/leaderboard/weekly">/v1/arena/leaderboard/weekly</a></p>
  </div>

  <h2>How to enter (free)</h2>
  <ol>
    <li>Build the canonical message and sign it with your Solana wallet (ed25519). The server never sees private keys.</li>
    <li><code>POST ${esc(baseUrl)}/v1/arena/predict</code> with JSON: <code>roundId</code>, <code>wallet</code>, <code>asset</code>, <code>price</code>, <code>signature</code>, optional <code>botName</code>.</li>
    <li>Submit once per asset (BTC, ETH, SOL). You may update until cutoff.</li>
    <li>Or use MCP tools: <code>arena_rules</code>, <code>arena_current_round</code>, <code>arena_submit_prediction</code>, <code>arena_leaderboard</code>.</li>
  </ol>
  <p>Example signer: see <code>scripts/arena-submit.js</code> in the repo. API docs: <a href="${esc(baseUrl)}/v1/arena/rules">${esc(baseUrl)}/v1/arena/rules</a></p>

  <h2>Rules (short)</h2>
  <div class="card">
    <ul class="compact">
      <li>Free to enter. No purchase necessary. No stakes or paid entry.</li>
      <li>${esc(prizes.daily.text)} ${esc(prizes.weekly.text)}</li>
      <li>${esc(prizes.payout)}</li>
      <li>One serious entry per operator. Obvious multi-wallet farming may be disqualified.</li>
      <li>Void where prohibited. Not financial advice. Skill contest, not gambling.</li>
    </ul>
    <p class="muted">Full machine-readable rules: <a href="${esc(baseUrl)}/v1/arena/rules">/v1/arena/rules</a></p>
  </div>

  <p class="muted">Service: <a href="${esc(baseUrl)}/">${esc(baseUrl)}</a> · Paid market data still on <code>/v1/pulse</code> and <code>/v1/spots</code> via x402.</p>
</main>
</body>
</html>`;
}
