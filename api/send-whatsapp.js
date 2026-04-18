// api/send-whatsapp.js — Vercel serverless. Hardened 2026-04-18.
//
// Sends WhatsApp messages via Twilio API. Server-side templates only — the
// client picks a `type` and passes typed fields; never the raw body.
import { applyCors, requireAuth, requireRole, escapeHtml, boundString, isValidE164, rateLimit } from "./_auth.js";

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")   return res.status(405).json({ error: "Method not allowed" });

  const decoded = await requireAuth(req, res);
  if (!decoded) return;
  // WhatsApp costs money per message — restrict to admin roles.
  if (!requireRole(decoded, ["owner", "principal"], res)) return;

  if (!rateLimit(`send-wa:${decoded.uid}`, 30)) {
    return res.status(429).json({ error: "Too many requests." });
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;
  const from       = process.env.TWILIO_WHATSAPP_FROM || "whatsapp:+14155238886";
  if (!accountSid || !authToken) {
    return res.status(500).json({ error: "WhatsApp service not configured." });
  }

  const { to, type, data } = req.body || {};

  // Strip `whatsapp:` prefix if client included it, then validate E.164.
  const rawTo = typeof to === "string" ? to.replace(/^whatsapp:/, "").trim() : "";
  if (!isValidE164(rawTo)) {
    return res.status(400).json({ error: "Invalid phone number (E.164 required, e.g. +919876543210)." });
  }

  // Strip asterisks and newlines from user-provided strings to block WhatsApp
  // markdown injection (attacker using *bold* or `code` to hide phishing links).
  const safe = (v, max) => boundString(String(v ?? ""), max).replace(/[*_~`\n\r]/g, " ");

  const d = data || {};
  let body = "";

  switch (type) {
    case "attendance_alert": {
      const parent   = safe(d.parentName, 80) || "Parent";
      const student  = safe(d.studentName, 80);
      const pct      = Number.isFinite(+d.attendance) ? String(+d.attendance) : "0";
      const thr      = Number.isFinite(+d.threshold)  ? String(+d.threshold)  : "75";
      const branch   = safe(d.branch, 80) || "—";
      body =
        `📚 *Edullent Alert*\n\n` +
        `Dear ${parent},\n\n` +
        `*${student}*'s attendance has dropped to *${pct}%*.\n\n` +
        `This is below the required ${thr}% threshold.\n` +
        `Please contact the school office or speak with the principal.\n\n` +
        `_Branch: ${branch}_\n` +
        `_Sent by Edullent School Management_`;
      break;
    }

    case "fee_reminder": {
      const parent   = safe(d.parentName, 80) || "Parent";
      const student  = safe(d.studentName, 80);
      const amount   = Number.isFinite(+d.amount) ? (+d.amount).toLocaleString("en-IN") : "—";
      const dueDate  = safe(d.dueDate, 40);
      const school   = safe(d.schoolName, 100) || "Your School";
      body =
        `💰 *Edullent Fee Reminder*\n\n` +
        `Dear ${parent},\n\n` +
        `This is a friendly reminder that fee payment for *${student}* is pending.\n\n` +
        `Amount due: *₹${amount}*\n` +
        (dueDate ? `Due date: *${dueDate}*\n` : "") +
        `\nPlease visit the school office or contact us to make the payment.\n\n` +
        `_${school} · Edullent_`;
      break;
    }

    case "critical_alert": {
      const owner    = safe(d.ownerName, 80) || "School Owner";
      const critical = Number.isFinite(+d.criticalCount) ? String(+d.criticalCount) : "0";
      const warning  = Number.isFinite(+d.warningCount)  ? String(+d.warningCount)  : "";
      const branch   = safe(d.branchName, 100) || "Multiple branches";
      body =
        `🚨 *Edullent Critical Alert*\n\n` +
        `Dear ${owner},\n\n` +
        `Your school has *${critical} critical risk alerts* right now.\n` +
        (warning ? `Additionally, ${warning} students are on watch.\n` : "") +
        `\nBranch: *${branch}*\n\n` +
        `Please review the risk dashboard immediately.\n` +
        `_Edullent School Management_`;
      break;
    }

    case "weekly_digest": {
      const school     = safe(d.schoolName, 100) || "Your School";
      const ahi        = Number.isFinite(+d.ahi)           ? String(+d.ahi)           : "—";
      const ahiTrend   = Number.isFinite(+d.ahiTrend)      ? +d.ahiTrend              : 0;
      const arrow      = ahiTrend > 0 ? "↑" : ahiTrend < 0 ? "↓" : "→";
      const students   = Number.isFinite(+d.totalStudents) ? String(+d.totalStudents) : "—";
      const attendance = Number.isFinite(+d.attendance)    ? String(+d.attendance)    : "—";
      const alerts     = Number.isFinite(+d.alertCount)    ? String(+d.alertCount)    : "0";
      body =
        `📊 *Edullent Weekly Digest*\n\n` +
        `*${school}* — Week Summary\n\n` +
        `🏫 AHI Score: *${ahi}%* ${arrow}\n` +
        `👥 Active Students: *${students}*\n` +
        `📋 Attendance: *${attendance}%*\n` +
        `⚠️ Risk Alerts: *${alerts}*\n\n` +
        `_Have a great week! — Edullent_`;
      break;
    }

    default:
      return res.status(400).json({ error: "Unknown message type." });
  }

  // Ignore escapeHtml — WhatsApp is plain-text — but we stripped markdown
  // metacharacters above.
  void escapeHtml;

  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const twilioUrl   = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

  const formData = new URLSearchParams();
  formData.append("From", from);
  formData.append("To", `whatsapp:${rawTo}`);
  formData.append("Body", body);

  try {
    const response = await fetch(twilioUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    });
    const result = await response.json().catch(() => ({}));

    if (response.ok && result.sid) {
      return res.status(200).json({ success: true, sid: result.sid });
    }
    console.error("[send-whatsapp] Twilio error:", response.status, result?.message);
    return res.status(502).json({ error: "WhatsApp provider error." });
  } catch (err) {
    console.error("[send-whatsapp] Network error:", err);
    return res.status(500).json({ error: "Failed to send WhatsApp message." });
  }
}