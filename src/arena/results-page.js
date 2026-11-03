/**
 * HTML for /arena/results and /arena/results/:roundId
 */
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function houseBadge(row) {
  if (row?.house) return ` <span class="house">house</span>`;
  return "";
}

export function renderResultsIndexHtml({ rounds, baseUrl }) {
  const rows = (rounds || [])
    .map((r) => {
      const win = r.prizeWinner;
      const pay = r.payout || {};
      return `<tr>
        <td><a href="${esc(baseUrl)}/arena/results/${esc(r.roundId)}">${esc(r.roundId)}</a></td>
        <td>${esc(r.status)}</td>
        <td>${esc(r.scoredAt || "—")}</td>
        <td>${win ? `<code>${esc(win.wallet.slice(0, 4))}…</code>${houseBadge(win)} ${esc(win.botName || "")}` : "—"}</td>
        <td>${esc(pay.payoutStatus || "—")}${pay.explorer ? ` · <a href="${esc(pay.explorer)}" rel="noopener noreferrer" target="_blank">tx</a>` : ""}</td>
      </tr>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Arena results · Crypto Pulse</title>
<style>
:root{color-scheme:dark light;--bg:#0b1020;--card:#141a2e;--fg:#e8eefc;--muted:#9aa8c7;--accent:#6ea8fe;--house:#f0c674}
body{margin:0;font-family:ui-sans-serif,system-ui,sans-serif;background:var(--bg);color:var(--fg);line-height:1.5}
main{max-width:960px;margin:0 auto;padding:2rem 1.25rem 4rem}
a{color:var(--accent)}.muted{color:var(--muted)}.card{background:var(--card);border:1px solid #243056;border-radius:12px;padding:1rem;margin:1rem 0;overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:.92rem}th,td{text-align:left;padding:.45rem .35rem;border-bottom:1px solid #243056}
.house{display:inline-block;background:#3a2f12;color:var(--house);border-radius:999px;padding:.05rem .45rem;font-size:.75rem;margin-left:.25rem}
</style></head><body><main>
<h1>Prediction Arena results</h1>
<p class="muted">Closing prices, predictions, scores, prize-eligible winners, and payout status. House bots (<code>official-*</code>) are labeled and never win prizes.</p>
<p><a href="${esc(baseUrl)}/arena">← Arena</a> · JSON <a href="${esc(baseUrl)}/v1/arena/history">/v1/arena/history</a> · CSV <a href="${esc(baseUrl)}/v1/arena/history?format=csv">?format=csv</a></p>
<div class="card"><table>
<thead><tr><th>Round</th><th>Status</th><th>Scored</th><th>Prize winner</th><th>Payout</th></tr></thead>
<tbody>${rows || `<tr><td colspan="5" class="muted">No rounds yet.</td></tr>`}</tbody>
</table></div>
</main></body></html>`;
}

export function renderRoundResultsHtml({ results, baseUrl }) {
  const r = results;
  const closes = r.closes || {};
  const closeRows = ["BTC", "ETH", "SOL"]
    .map(
      (a) =>
        `<tr><td>${a}</td><td>${closes[a] != null ? esc(closes[a]) : "—"}</td></tr>`,
    )
    .join("");
  const rankRows = (r.ranking || [])
    .map((row) => {
      const err = row.avgAbsPctError == null ? "—" : `${Number(row.avgAbsPctError).toFixed(4)}%`;
      return `<tr>
        <td>${esc(row.rank)}${row.prizeRank != null ? ` <span class="muted">(prize #${esc(row.prizeRank)})</span>` : ""}</td>
        <td><code>${esc(row.wallet)}</code>${houseBadge(row)}</td>
        <td>${esc(row.botName || "—")}</td>
        <td>${esc(err)}</td>
        <td>${row.prizeEligible === false ? "no" : "yes"}</td>
      </tr>`;
    })
    .join("");
  const predRows = (r.predictions || [])
    .map((p) => {
      const actual = closes[p.asset];
      const err = p.absPctError == null ? "—" : `${Number(p.absPctError).toFixed(4)}%`;
      return `<tr>
        <td>${esc(p.asset)}</td>
        <td><code>${esc(p.wallet)}</code>${houseBadge(p)}</td>
        <td>${esc(p.botName || "—")}</td>
        <td>${esc(p.price)}</td>
        <td>${actual != null ? esc(actual) : "—"}</td>
        <td>${esc(err)}</td>
      </tr>`;
    })
    .join("");
  const pay = r.payout || {};
  const win = r.prizeWinner;

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Results ${esc(r.roundId)} · Crypto Pulse Arena</title>
<style>
:root{color-scheme:dark light;--bg:#0b1020;--card:#141a2e;--fg:#e8eefc;--muted:#9aa8c7;--accent:#6ea8fe;--house:#f0c674;--ok:#3ddc97}
body{margin:0;font-family:ui-sans-serif,system-ui,sans-serif;background:var(--bg);color:var(--fg);line-height:1.5}
main{max-width:960px;margin:0 auto;padding:2rem 1.25rem 4rem}
a{color:var(--accent)}.muted{color:var(--muted)}.card{background:var(--card);border:1px solid #243056;border-radius:12px;padding:1rem;margin:1rem 0;overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:.92rem}th,td{text-align:left;padding:.45rem .35rem;border-bottom:1px solid #243056;vertical-align:top}
.house{display:inline-block;background:#3a2f12;color:var(--house);border-radius:999px;padding:.05rem .45rem;font-size:.75rem;margin-left:.25rem}
.ok{color:var(--ok)}
</style></head><body><main>
<p><a href="${esc(baseUrl)}/arena/results">← All results</a> · <a href="${esc(baseUrl)}/arena">Arena</a> · JSON <a href="${esc(baseUrl)}/v1/arena/results/${esc(r.roundId)}">/v1/arena/results/${esc(r.roundId)}</a></p>
<h1>Round <code>${esc(r.roundId)}</code></h1>
<p class="muted">Status: <strong>${esc(r.status)}</strong>${r.scoredAt ? ` · scored ${esc(r.scoredAt)}` : ""}</p>

<div class="card">
<h2 style="margin-top:0">Closing prices (CoinGecko)</h2>
<table><thead><tr><th>Asset</th><th>USD</th></tr></thead><tbody>${closeRows}</tbody></table>
${r.source ? `<p class="muted">Source: ${esc(r.source)}${closes.fetchedAt ? ` · ${esc(closes.fetchedAt)}` : ""}</p>` : `<p class="muted">Closes appear after the round is scored.</p>`}
</div>

<div class="card">
<h2 style="margin-top:0">Prize-eligible winner</h2>
${
  win
    ? `<p><code>${esc(win.wallet)}</code> · ${esc(win.botName || "—")} · avg |error| ${
        win.avgAbsPctError == null ? "—" : esc(Number(win.avgAbsPctError).toFixed(4)) + "%"
      }</p>`
    : `<p class="muted">No prize-eligible complete entry yet (house bots do not count).</p>`
}
<p>Payout: <strong>${esc(pay.payoutStatus || "unpaid")}</strong>
${pay.amountUsdc != null ? ` · $${esc(pay.amountUsdc)} USDC` : ""}
${pay.explorer ? ` · <a class="ok" href="${esc(pay.explorer)}" rel="noopener noreferrer" target="_blank">Solscan tx</a>` : ""}
${pay.txSignature ? ` · <code>${esc(pay.txSignature.slice(0, 12))}…</code>` : ""}</p>
</div>

<div class="card">
<h2 style="margin-top:0">Leaderboard</h2>
<table><thead><tr><th>#</th><th>Wallet</th><th>Bot</th><th>Avg |error|</th><th>Eligible</th></tr></thead>
<tbody>${rankRows || `<tr><td colspan="5" class="muted">No complete entries.</td></tr>`}</tbody></table>
</div>

<div class="card">
<h2 style="margin-top:0">Every prediction</h2>
<table><thead><tr><th>Asset</th><th>Wallet</th><th>Bot</th><th>Predicted</th><th>Actual</th><th>|error|%</th></tr></thead>
<tbody>${predRows || `<tr><td colspan="6" class="muted">No predictions.</td></tr>`}</tbody></table>
</div>
<p class="muted">${esc(r.houseBotsNote || "")}</p>
</main></body></html>`;
}
