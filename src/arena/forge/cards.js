/**
 * Shareable Pulse Forge result and streak cards (SVG + HTML OG preview).
 * Referral code on the share link is the player's payout wallet.
 */
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shortWallet(wallet) {
  const w = String(wallet || "");
  if (w.length <= 12) return w;
  return `${w.slice(0, 4)}…${w.slice(-4)}`;
}

function badgeLine(badges) {
  const labels = (badges || []).slice(0, 4).map((b) => b.label || b.id);
  return labels.length ? labels.join(" · ") : "No badges yet";
}

function svgDoc(body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#0b1020"/>
  <rect x="48" y="48" width="1104" height="534" rx="28" fill="#141a2e" stroke="#243056"/>
  <text x="88" y="128" fill="#6ea8fe" font-family="ui-sans-serif, system-ui, sans-serif" font-size="28">Pulse Forge</text>
  ${body}
  <text x="88" y="530" fill="#9aa8c7" font-family="ui-sans-serif, system-ui, sans-serif" font-size="22">Free arena · non-cash · cryptopulseapi.com</text>
</svg>
`;
}

export function renderRoundCardSvg({
  roundId,
  wallet,
  botName,
  rank,
  avgAbsPctError,
  level,
  xp,
  accuracyStreak,
  badges,
} = {}) {
  const err = avgAbsPctError == null || !Number.isFinite(Number(avgAbsPctError))
    ? "—"
    : `${Number(avgAbsPctError).toFixed(4)}%`;
  const body = `
  <text x="88" y="210" fill="#e8eefc" font-family="ui-sans-serif, system-ui, sans-serif" font-size="64">${esc(botName || "Bot")}</text>
  <text x="88" y="280" fill="#e8eefc" font-family="ui-sans-serif, system-ui, sans-serif" font-size="36">Round ${esc(roundId || "—")} · rank #${esc(rank ?? "—")}</text>
  <text x="88" y="340" fill="#9aa8c7" font-family="ui-sans-serif, system-ui, sans-serif" font-size="32">Avg |error| ${esc(err)}</text>
  <text x="88" y="410" fill="#3ddc97" font-family="ui-sans-serif, system-ui, sans-serif" font-size="32">Lv ${esc(level ?? 1)} · ${esc(xp ?? 0)} XP · streak ${esc(accuracyStreak ?? 0)}</text>
  <text x="88" y="470" fill="#e8eefc" font-family="ui-sans-serif, system-ui, sans-serif" font-size="26">${esc(badgeLine(badges))}</text>
  <text x="700" y="470" fill="#9aa8c7" font-family="ui-monospace, monospace" font-size="24">ref ${esc(shortWallet(wallet))}</text>`;
  return svgDoc(body);
}

export function renderStreakCardSvg({
  wallet,
  botName,
  level,
  xp,
  accuracyStreak,
  bestAccuracyStreak,
  badges,
} = {}) {
  const body = `
  <text x="88" y="210" fill="#e8eefc" font-family="ui-sans-serif, system-ui, sans-serif" font-size="64">${esc(botName || "Bot")}</text>
  <text x="88" y="310" fill="#3ddc97" font-family="ui-sans-serif, system-ui, sans-serif" font-size="72">${esc(accuracyStreak ?? 0)}-round streak</text>
  <text x="88" y="380" fill="#9aa8c7" font-family="ui-sans-serif, system-ui, sans-serif" font-size="32">Best ${esc(bestAccuracyStreak ?? 0)} · Lv ${esc(level ?? 1)} · ${esc(xp ?? 0)} XP</text>
  <text x="88" y="450" fill="#e8eefc" font-family="ui-sans-serif, system-ui, sans-serif" font-size="26">${esc(badgeLine(badges))}</text>
  <text x="700" y="450" fill="#9aa8c7" font-family="ui-monospace, monospace" font-size="24">ref ${esc(shortWallet(wallet))}</text>`;
  return svgDoc(body);
}

export function renderShareHtml({
  title,
  description,
  pageUrl,
  imageUrl,
  heading,
  lines,
} = {}) {
  const rows = (lines || []).map((line) => `<p>${esc(line)}</p>`).join("\n");
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}"/>
<meta property="og:type" content="website"/>
<meta property="og:title" content="${esc(title)}"/>
<meta property="og:description" content="${esc(description)}"/>
<meta property="og:image" content="${esc(imageUrl)}"/>
<meta property="og:url" content="${esc(pageUrl)}"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${esc(title)}"/>
<meta name="twitter:description" content="${esc(description)}"/>
<meta name="twitter:image" content="${esc(imageUrl)}"/>
<style>
  :root { color-scheme: dark; --bg:#0b1020; --fg:#e8eefc; --muted:#9aa8c7; --accent:#6ea8fe; }
  body { margin:0; font-family: ui-sans-serif, system-ui, sans-serif; background:var(--bg); color:var(--fg); }
  main { max-width: 720px; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
  a { color: var(--accent); }
  img { width: 100%; height: auto; border-radius: 16px; border: 1px solid #243056; }
  .muted { color: var(--muted); }
</style></head><body><main>
<p><a href="/arena">← Arena</a></p>
<h1>${esc(heading || title)}</h1>
<img alt="${esc(title)}" src="${esc(imageUrl)}"/>
${rows}
<p class="muted">Share link includes the referral code. Cash prizes and paid-call eligibility are unchanged. This card does not pay USDC.</p>
<p><a href="${esc(pageUrl)}">Share link</a></p>
</main></body></html>`;
}

export function shareUrls({ baseUrl, roundId, wallet }) {
  const base = String(baseUrl || "").replace(/\/$/, "");
  const w = encodeURIComponent(wallet);
  const ref = encodeURIComponent(wallet);
  return {
    ref: wallet,
    cardPath: `/v1/forge/cards/round/${roundId}/${w}.svg`,
    pagePath: `/arena/forge/share/${roundId}/${w}`,
    streakCardPath: `/v1/forge/cards/streak/${w}.svg`,
    streakPagePath: `/arena/forge/streak/${w}`,
    pageUrl: `${base}/arena/forge/share/${roundId}/${w}?ref=${ref}`,
    imageUrl: `${base}/v1/forge/cards/round/${roundId}/${w}.svg`,
    streakPageUrl: `${base}/arena/forge/streak/${w}?ref=${ref}`,
    streakImageUrl: `${base}/v1/forge/cards/streak/${w}.svg`,
  };
}
