// api/principal-insights.js — Vercel serverless. Generates real AI insights
// for the Principal Leaderboard via OpenAI gpt-4o-mini.
//
// Returns the same { mode, oneLiner, reasons[], actions[], actionsLabel }
// shape the rule-based generator in principalLeaderboardService.ts uses, so
// the client can transparently swap one for the other (with rule-based as
// the fallback on 5xx / missing key).
//
// Auth: Firebase ID token via Authorization: Bearer header.
// Server-only env: OPENAI_API_KEY (do NOT prefix with VITE_).
// If the key is missing the route returns 503 and the client falls back.
import { applyCors, requireAuth, rateLimit } from "./_auth.js";

const MODEL = "gpt-4o-mini";

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
function buildTopPrompt(p, network) {
  const ratio = p.teachers > 0 ? (p.students / p.teachers).toFixed(1) : "—";
  return `Principal: ${clean(p.name, 80)} (Rank #1 of ${num(network.totalPrincipals)})
Branch: ${clean(p.branchName, 120)}
Network: ${clean(network.name)} · ${clean(network.monthLabel)}

THIS PRINCIPAL'S BRANCH METRICS (real, from Firestore):
- Composite AHI: ${num(p.ahi)} (network avg: ${num(network.networkAvgAhi)})
- Attendance: ${num(p.attendance)}% (network avg: ${num(network.networkAvgAtt)}%)
- Pass rate: ${num(p.passRate)}% (network avg: ${num(network.networkAvgPass)}%)
- Fee collection: ${num(p.feeCollection)}% (network avg: ${num(network.networkAvgFee)}%)
- Students: ${num(p.students)}
- Teachers: ${num(p.teachers)} (student-teacher ratio: ${ratio}:1)
- At-risk students: ${num(p.atRiskStudents)}
- Attendance trend (month-over-month): ${num(p.weekChange).toFixed(1)} pts

You are an experienced school network analyst writing for the OWNER of the
school chain. Generate:

- oneLiner: 1 punchy sentence (max 20 words) summarising why this principal
  is leading. Reference at least one specific number.
- reasons: 3 grounded bullets explaining WHY this principal is at the top.
  Each MUST cite a specific number from the metrics above.
- actions: 3 concrete suggestions for HOW THE OWNER CAN HELP THIS PRINCIPAL
  STAY ON TOP. Make them practical — mentorship, documentation, stretch goals,
  protecting their time, etc. NOT generic "keep up the good work" advice.

Tone: respectful, observational, never sycophantic. Address the principal
in third person (they / their).

Return ONLY this JSON:
{
  "oneLiner": "Single sentence.",
  "reasons": ["Bullet 1 citing numbers.", "Bullet 2.", "Bullet 3."],
  "actions": ["Action 1 — concrete and specific.", "Action 2.", "Action 3."]
}`;
}

function buildLowerPrompt(p, top, network, rank) {
  const atRiskPct = p.students > 0 ? (p.atRiskStudents / p.students) * 100 : 0;
  const isDeclining = p.weekChange < -1;
  const isAtRisk    = num(p.ahi) > 0 && num(p.ahi) < 50;
  return `Principal: ${clean(p.name, 80)} (Rank #${rank} of ${num(network.totalPrincipals)})
Branch: ${clean(p.branchName, 120)}
Network: ${clean(network.name)} · ${clean(network.monthLabel)}
Top principal reference: ${clean(top.name, 80)} at ${clean(top.branchName, 120)} (AHI ${num(top.ahi)})

THIS PRINCIPAL'S BRANCH METRICS:
- Composite AHI: ${num(p.ahi)} (network avg: ${num(network.networkAvgAhi)}, top: ${num(top.ahi)})
- Attendance: ${num(p.attendance)}% (top: ${num(top.attendance)}%)
- Pass rate: ${num(p.passRate)}% (top: ${num(top.passRate)}%)
- Fee collection: ${num(p.feeCollection)}% (top: ${num(top.feeCollection)}%)
- Students: ${num(p.students)} · Teachers: ${num(p.teachers)}
- At-risk students: ${num(p.atRiskStudents)} (${atRiskPct.toFixed(1)}% of branch)
- Attendance trend (MoM): ${num(p.weekChange).toFixed(1)} pts (${isDeclining ? "DECLINING" : "stable/up"})

You are an experienced school network analyst writing for the OWNER. This is
${isAtRisk ? "an AT-RISK principal needing intervention" : "a principal in the middle of the pack"}.

Generate:

- oneLiner: 1 punchy sentence (max 22 words) summarising the gap or risk.
  Reference at least one specific gap vs top OR network avg.
- reasons: 3 grounded bullets explaining WHY this principal is at this rank.
  Each MUST cite a specific number (a gap, a target missed, a declining trend).
- actions: 3 concrete steps the OWNER and PRINCIPAL can take together.
  ${isAtRisk
    ? "At-risk: urgency matters. Include at least 1 'this week' action."
    : "Focus on closing the gap to the next rank up. Reference the top principal where useful."}
  Make them practical — specific cohorts, weekly rituals, peer pairing, etc.
- actionsLabel: "${rank === 2 ? "How to reach #1" : rank === 3 ? "How to reach #2" : isAtRisk ? "Recovery plan" : "How to climb the rankings"}"

Tone: direct but supportive, never demoralising.

Return ONLY this JSON:
{
  "oneLiner": "Single sentence.",
  "reasons": ["Bullet 1 citing numbers.", "Bullet 2.", "Bullet 3."],
  "actions": ["Action 1 — specific.", "Action 2.", "Action 3."],
  "actionsLabel": "How to reach #1 | How to climb the rankings | Recovery plan"
}`;
}

// ── Response validation ────────────────────────────────────────────────────
function sanitize(parsed, fallbackLabel) {
  const reasons = Array.isArray(parsed?.reasons) ? parsed.reasons : [];
  const actions = Array.isArray(parsed?.actions) ? parsed.actions : [];
  return {
    oneLiner: clean(parsed?.oneLiner, 240),
    reasons:  reasons.slice(0, 4).map(r => clean(r, 360)).filter(Boolean),
    actions:  actions.slice(0, 4).map(a => clean(a, 360)).filter(Boolean),
    actionsLabel: clean(parsed?.actionsLabel, 60) || fallbackLabel,
  };
}

// ── Handler ────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")    return res.status(405).json({ error: "Method not allowed" });

  const decoded = await requireAuth(req, res);
  if (!decoded) return;

  // 60 req / min per owner — leaderboard with 20 principals fits comfortably.
  if (!rateLimit(`principal-insights:${decoded.uid}`, 60)) {
    return res.status(429).json({ error: "Too many requests. Try again in a minute." });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: "AI insights not configured." });
  }

  const { rank, principal, top, network } = req.body || {};
  if (!principal || !network || typeof rank !== "number") {
    return res.status(400).json({ error: "Missing principal / network / rank." });
  }
  if (rank > 1 && !top) {
    return res.status(400).json({ error: "Missing top principal reference for non-top rank." });
  }

  const isTop = rank === 1;
  const userPrompt = isTop
    ? buildTopPrompt(principal, network)
    : buildLowerPrompt(principal, top, network, rank);

  const systemPrompt = isTop
    ? "You are a school network analyst writing for the OWNER. Cite specific numbers from the metrics. Reply ONLY with valid JSON."
    : "You are a school network analyst writing for the OWNER. Diagnose root causes; suggest concrete fixes. Cite specific numbers. Reply ONLY with valid JSON.";

  const fallbackLabel = isTop
    ? "How to keep this lead"
    : (rank === 2 ? "How to reach #1" : rank === 3 ? "How to reach #2" : "How to climb");

  try {
    const oaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.5,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userPrompt },
        ],
      }),
    });

    if (!oaiRes.ok) {
      const errBody = await oaiRes.text().catch(() => "");
      console.error("[principal-insights] OpenAI error:", oaiRes.status, errBody.slice(0, 300));
      return res.status(502).json({ error: "AI provider error." });
    }

    const data = await oaiRes.json();
    const raw  = data?.choices?.[0]?.message?.content || "{}";
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { parsed = {}; }

    const insight = sanitize(parsed, fallbackLabel);

    // Reject empty AI output so client falls back to rule-based.
    if (!insight.oneLiner || insight.reasons.length === 0 || insight.actions.length === 0) {
      return res.status(502).json({ error: "AI returned empty insight." });
    }

    return res.status(200).json({
      isTop, rank, model: MODEL, generatedAt: Date.now(), insight,
    });
  } catch (err) {
    console.error("[principal-insights] Network error:", err);
    return res.status(500).json({ error: "Failed to generate insight." });
  }
}
