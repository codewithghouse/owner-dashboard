// api/owner-insights.js — Vercel serverless. Generates AI insights for the
// Owner Branch Leaderboard via OpenAI gpt-4o-mini.
//
// Returns the same { whyTop, pills } | { whyHere, solutions, solutionLabel }
// shapes the rule-based generators in ownerLeaderboardService.ts already use,
// so the client can transparently swap one for the other.
//
// Auth: Firebase ID token via Authorization: Bearer header.
// Server-only env: OPENAI_API_KEY (do NOT prefix with VITE_).
// If the key is missing the route returns 503 and the client falls back to
// rule-based insights.
import { applyCors, requireAuth, rateLimit } from "./_auth.js";

const MODEL = "gpt-4o-mini";
const MAX_BRANCH_NAME = 120;
const MAX_CITY        = 120;

function clean(v, max = 200) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return s.length > max ? s.slice(0, max) : s;
}
function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// ── Prompt builders ─────────────────────────────────────────────────────────
function buildTopPrompt(b, network) {
  const networkAvg = num(network.networkAvg);
  const atRiskPct  = b.studentCount > 0 ? (b.activeAlerts / b.studentCount) * 100 : 0;
  return `Branch: ${clean(b.name, MAX_BRANCH_NAME)} (Rank #1 of ${num(network.totalBranches)})
Network: ${clean(network.name)} · ${clean(network.monthLabel)}

METRICS (real, from Firestore aggregation):
- Composite (AHI): ${num(b.ahi)} (network avg: ${networkAvg})
- Attendance: ${num(b.attendance)}%
- Pass rate: ${num(b.passRate)}%
- Fee collection: ${num(b.feeCollection)}%
- At-risk students: ${num(b.activeAlerts)} of ${num(b.studentCount)} (${atRiskPct.toFixed(1)}%)
- Teachers: ${num(b.teacherCount)}

Generate 4-5 specific strength bullets explaining WHY this branch leads.
Each bullet MUST cite a specific number from the metrics above.
Do NOT suggest improvements — this is a top-branch celebration.

Return ONLY this JSON:
{
  "whyTop": [
    { "metric": "Short label e.g. 'Attendance 92%'", "detail": "Specific explanation citing exact numbers" }
  ],
  "pills": ["Label 1", "Label 2", "Label 3", "Label 4"]
}`;
}

function buildLowerPrompt(b, top, network, rank) {
  const atRiskPct = b.studentCount > 0 ? (b.activeAlerts / b.studentCount) * 100 : 0;
  const isDeclining = b.weekChange < -1;
  return `Branch: ${clean(b.name, MAX_BRANCH_NAME)} (Rank #${rank} of ${num(network.totalBranches)})
Network: ${clean(network.name)} · ${clean(network.monthLabel)}
Top branch reference: ${clean(top.name, MAX_BRANCH_NAME)} (composite ${num(top.ahi)})

THIS BRANCH METRICS:
- Composite (AHI): ${num(b.ahi)} (network avg: ${num(network.networkAvg)}, top: ${num(top.ahi)})
- Attendance: ${num(b.attendance)}% (top: ${num(top.attendance)}%)
- Pass rate: ${num(b.passRate)}% (top: ${num(top.passRate)}%)
- Fee collection: ${num(b.feeCollection)}% (top: ${num(top.feeCollection)}%)
- At-risk students: ${num(b.activeAlerts)} of ${num(b.studentCount)} (${atRiskPct.toFixed(1)}%)
- Month-over-month attendance change: ${num(b.weekChange).toFixed(1)} points (${isDeclining ? "DECLINING" : "stable/up"})

Generate:
- 2-3 root-cause bullets (cite specific gaps vs top branch or network)
- 3-4 specific solution steps (must reference attendance/pass/fee/at-risk action — be concrete)
- urgent=true ONLY for: branch declining (>1 point drop) OR at-risk pct >= 10%
- solutionLabel: "How to reach #${rank - 1}" if not declining, else "Recovery plan"

Return ONLY this JSON:
{
  "whyHere": [
    { "color": "#FF8800 or #FF453A", "bold": "Short bold label with the specific issue.", "rest": " Continued explanation citing numbers." }
  ],
  "solutions": [
    { "urgent": false, "text": "Concrete action — must name attendance/pass/fee or specific cohort." }
  ],
  "solutionLabel": "How to reach #${rank - 1} | Recovery plan"
}`;
}

// ── Response validation ────────────────────────────────────────────────────
const VALID_COLORS = new Set(["#FF8800", "#FF453A"]);

function sanitizeTop(parsed) {
  const whyTop = Array.isArray(parsed?.whyTop) ? parsed.whyTop : [];
  const pills  = Array.isArray(parsed?.pills) ? parsed.pills : [];
  return {
    whyTop: whyTop.slice(0, 5).map(it => ({
      metric: clean(it?.metric, 80),
      detail: clean(it?.detail, 400),
    })).filter(x => x.metric && x.detail),
    pills: pills.slice(0, 6).map(p => clean(p, 40)).filter(Boolean),
  };
}

function sanitizeLower(parsed) {
  const whyHere = Array.isArray(parsed?.whyHere) ? parsed.whyHere : [];
  const solutions = Array.isArray(parsed?.solutions) ? parsed.solutions : [];
  return {
    whyHere: whyHere.slice(0, 4).map(it => ({
      color: VALID_COLORS.has(it?.color) ? it.color : "#FF8800",
      bold: clean(it?.bold, 120),
      rest: clean(it?.rest, 400),
    })).filter(x => x.bold),
    solutions: solutions.slice(0, 5).map(it => ({
      urgent: Boolean(it?.urgent),
      text: clean(it?.text, 400),
    })).filter(x => x.text),
    solutionLabel: clean(parsed?.solutionLabel, 60) || "How to improve",
  };
}

// ── Handler ────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")    return res.status(405).json({ error: "Method not allowed" });

  const decoded = await requireAuth(req, res);
  if (!decoded) return;

  if (!rateLimit(`owner-insights:${decoded.uid}`, 30)) {
    return res.status(429).json({ error: "Too many requests. Try again in a minute." });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // Client falls back to rule-based generators on 503.
    return res.status(503).json({ error: "AI insights not configured." });
  }

  const { rank, branch, top, network } = req.body || {};
  if (!branch || !network || typeof rank !== "number") {
    return res.status(400).json({ error: "Missing branch / network / rank." });
  }
  if (rank > 1 && !top) {
    return res.status(400).json({ error: "Missing top branch reference for non-top rank." });
  }

  const isTop = rank === 1;
  const userPrompt = isTop ? buildTopPrompt(branch, network)
                           : buildLowerPrompt(branch, top, network, rank);
  const systemPrompt = isTop
    ? "You are a school network analyst. Explain WHY this branch is ranked #1. Cite specific numbers. Reply ONLY with valid JSON."
    : "You are a school network analyst. Diagnose root causes and suggest concrete fixes. Cite specific numbers. Reply ONLY with valid JSON.";

  try {
    const oaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userPrompt },
        ],
      }),
    });

    if (!oaiRes.ok) {
      const errBody = await oaiRes.text().catch(() => "");
      console.error("[owner-insights] OpenAI error:", oaiRes.status, errBody.slice(0, 300));
      return res.status(502).json({ error: "AI provider error." });
    }

    const data = await oaiRes.json();
    const raw  = data?.choices?.[0]?.message?.content || "{}";
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { parsed = {}; }

    const insight = isTop ? sanitizeTop(parsed) : sanitizeLower(parsed);

    // Reject empty AI output so client falls back to rule-based.
    if (isTop && (insight.whyTop.length === 0 || insight.pills.length === 0)) {
      return res.status(502).json({ error: "AI returned empty insight." });
    }
    if (!isTop && (insight.whyHere.length === 0 || insight.solutions.length === 0)) {
      return res.status(502).json({ error: "AI returned empty insight." });
    }

    return res.status(200).json({
      isTop, rank, model: MODEL, generatedAt: Date.now(), insight,
    });
  } catch (err) {
    console.error("[owner-insights] Network error:", err);
    return res.status(500).json({ error: "Failed to generate insight." });
  }
}
