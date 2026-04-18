// api/send-email.js — Vercel serverless. Hardened 2026-04-18.
//
// Sends owner-side emails (principal invitation + report sharing) via Resend.
// Requires: Firebase ID-token auth, role gate, strict CORS, HTML escaping,
//           input caps, rate limiting.
import { applyCors, requireAuth, requireRole, escapeHtml, boundString, isValidEmail, rateLimit } from "./_auth.js";

const MAX_SUBJECT = 200;
const MAX_BODY    = 4000;
const MAX_NAME    = 120;
const MAX_BRANCH  = 120;
const MAX_SCHOOL  = 200;
const MAX_REPORT_ID = 80;

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")   return res.status(405).json({ error: "Method not allowed" });

  // 1) Auth + role gate
  const decoded = await requireAuth(req, res);
  if (!decoded) return;
  if (!requireRole(decoded, ["owner", "principal", "teacher"], res)) return;

  // 2) Per-user rate limit
  if (!rateLimit(`send-email:${decoded.uid}`, 20)) {
    return res.status(429).json({ error: "Too many requests. Try again in a minute." });
  }

  // 3) Server-only env var (do NOT accept VITE_* — those leak to clients)
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey === "re_123456789") {
    return res.status(500).json({ error: "Email service not configured." });
  }

  // 4) Validate inputs
  const {
    type, to, name, branch, schoolName, subject, body, reportId,
  } = req.body || {};

  if (!isValidEmail(to)) {
    return res.status(400).json({ error: "Invalid recipient email." });
  }

  const sName    = boundString(name, MAX_NAME);
  const sBranch  = boundString(branch, MAX_BRANCH);
  const sSchool  = boundString(schoolName, MAX_SCHOOL);
  const sSubject = boundString(subject, MAX_SUBJECT);
  const sBody    = boundString(body, MAX_BODY);
  const sReportId = boundString(reportId, MAX_REPORT_ID);

  // 5) Build payload — NO user data interpolated without escapeHtml()
  let emailPayload;

  if (type === "report") {
    if (!sSubject) return res.status(400).json({ error: "Missing subject." });
    const safeBody = escapeHtml(sBody).replace(/\n/g, "<br>");
    const safeSubj = escapeHtml(sSubject.replace(/^\[EDULLENT\]\s*/, ""));
    const safeReportId = sReportId ? `<p style="color:#64748b;font-size:12px;margin:0 0 20px;">Report ID: <strong>${escapeHtml(sReportId)}</strong></p>` : "";

    emailPayload = {
      from: "Edullent Reports <noreply@edulent.dgion.com>",
      to: [to],
      subject: sSubject,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:0;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
          <div style="background:#1e3a8a;padding:24px 28px;">
            <h1 style="color:#fff;margin:0;font-size:20px;font-weight:700;letter-spacing:0.5px;">EDULLENT</h1>
            <p style="color:#bfdbfe;margin:4px 0 0;font-size:13px;">Reports Center</p>
          </div>
          <div style="padding:28px;background:#fff;">
            <h2 style="color:#1e293b;font-size:17px;margin:0 0 8px;">${safeSubj}</h2>
            ${safeReportId}
            <div style="background:#f8fafc;border-left:3px solid #1e3a8a;padding:16px 18px;border-radius:0 8px 8px 0;color:#334155;font-size:14px;line-height:1.6;">
              ${safeBody}
            </div>
            <div style="margin-top:28px;text-align:center;">
              <a href="https://owner-dashboard-blue.vercel.app/reports"
                 style="background:#1e3a8a;color:#fff;padding:12px 28px;text-decoration:none;border-radius:8px;font-weight:700;font-size:13px;display:inline-block;">
                View Full Report
              </a>
            </div>
          </div>
          <div style="background:#f1f5f9;padding:14px 28px;text-align:center;">
            <p style="color:#94a3b8;font-size:11px;margin:0;">Powered by Edullent Cloud Architecture</p>
          </div>
        </div>
      `,
    };
  } else {
    // Invitation email (default)
    if (!sName) return res.status(400).json({ error: "Missing name." });
    const safeName   = escapeHtml(sName);
    const safeBranch = escapeHtml(sBranch || "Main");
    const safeSchool = escapeHtml(sSchool || "your school");

    emailPayload = {
      from: "Edullent <invite@edulent.dgion.com>",
      to: [to],
      subject: `Welcome to ${sSchool || "Edullent"} – Principal Dashboard Access`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:0;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
          <div style="background:#1e3a8a;padding:24px 28px;">
            <h1 style="color:#fff;margin:0;font-size:20px;font-weight:700;letter-spacing:0.5px;">EDULLENT</h1>
            <p style="color:#bfdbfe;margin:4px 0 0;font-size:13px;">Principal Dashboard Invitation</p>
          </div>
          <div style="padding:28px;background:#fff;">
            <h2 style="color:#1e293b;margin:0 0 12px;">Welcome, ${safeName}!</h2>
            <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 16px;">
              You have been invited as the <strong>Principal</strong> for the
              <strong>${safeBranch}</strong> branch of <strong>${safeSchool}</strong>.
            </p>
            <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 24px;">
              Your dashboard is now ready. Log in with the email address this was sent to.
            </p>
            <div style="text-align:center;margin:24px 0;">
              <a href="https://principal-dashboard-seven.vercel.app/"
                 style="background:#1e3a8a;color:#fff;padding:13px 30px;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;display:inline-block;">
                Open Principal Dashboard
              </a>
            </div>
            <p style="color:#94a3b8;font-size:12px;margin:20px 0 0;">
              If you didn't expect this invitation, please ignore this email.
            </p>
          </div>
          <div style="background:#f1f5f9;padding:14px 28px;text-align:center;">
            <p style="color:#94a3b8;font-size:11px;margin:0;">Powered by Edullent Cloud Architecture</p>
          </div>
        </div>
      `,
    };
  }

  // 6) Send via Resend — log failures server-side, return generic error to client
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(emailPayload),
    });
    const result = await response.json().catch(() => ({}));
    if (response.ok) {
      return res.status(200).json({ success: true, id: result.id });
    }
    console.error("[send-email] Resend error:", response.status, result);
    return res.status(502).json({ success: false, error: "Email provider error." });
  } catch (err) {
    console.error("[send-email] Network error:", err);
    return res.status(500).json({ success: false, error: "Failed to send email." });
  }
}