// api/account-deletion.js — Vercel serverless function.
//
// PUBLIC endpoint (no Firebase auth required) so:
//   1. Logged-out users + ex-users can request deletion (Play Store mandate).
//   2. Google Play reviewers can verify the flow without account creation.
//
// Spam protection:
//   • IP-based in-memory rate limit: 3 POSTs per 10 minutes per warm lambda.
//   • Server-side email/length validation rejects malformed bodies early.
//
// On valid submission:
//   • Writes a doc to `deletion_requests` (Firestore Admin SDK — bypasses
//     client rules, no need to open the collection to anonymous writes).
//   • Fires a notification email to edullentofficial@gmail.com via Resend.
//   • Returns 200 with { requestId } even if the email side fails — the
//     Firestore write is the source of truth; email is a notification.
//
// Required env vars (set on Vercel):
//   • FIREBASE_ADMIN_SA_JSON  (stringified service account)
//   • RESEND_API_KEY           (Resend account key)
import admin from "firebase-admin";
import { applyCors, boundString, escapeHtml, isValidEmail, rateLimit } from "./_auth.js";

const NOTIFY_TO = "edullentofficial@gmail.com";
const MAX_COMMENTS = 2000;
const ALLOWED_REASONS = new Set([
  "no_longer_needed",
  "switching_platform",
  "privacy_concerns",
  "other",
]);
const REASON_LABEL = {
  no_longer_needed: "No longer need the service",
  switching_platform: "Switching to another platform",
  privacy_concerns: "Privacy concerns",
  other: "Other",
};

function initAdmin() {
  if (admin.apps.length) return admin;
  const saJson = process.env.FIREBASE_ADMIN_SA_JSON;
  if (saJson) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(saJson)) });
  } else {
    admin.initializeApp();
  }
  return admin;
}

// Client IP — Vercel sets x-forwarded-for; fall back to remoteAddress.
function clientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    return xff.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "unknown";
}

// Optionally decode Bearer token to attach uid — never REQUIRES it.
async function tryReadUid(req) {
  const authz = req.headers.authorization || "";
  const token = authz.startsWith("Bearer ") ? authz.slice(7).trim() : null;
  if (!token) return null;
  try {
    const a = initAdmin();
    const decoded = await a.auth().verifyIdToken(token);
    return decoded?.uid || null;
  } catch {
    return null;
  }
}

async function sendNotificationEmail({ requestId, email, reasonLabel, comments, uid, ip }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey === "re_123456789") {
    console.warn("[account-deletion] RESEND_API_KEY missing — skipping email");
    return { ok: false, reason: "no_api_key" };
  }

  const safeEmail = escapeHtml(email);
  const safeReason = escapeHtml(reasonLabel);
  const safeComments = comments ? escapeHtml(comments).replace(/\n/g, "<br>") : "<em>(none)</em>";
  const safeRequestId = escapeHtml(requestId);
  const safeUid = uid ? escapeHtml(uid) : "<em>(not signed in)</em>";
  const safeIp = escapeHtml(ip);

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
      <div style="background:#DC2626;padding:24px 28px;">
        <h1 style="color:#fff;margin:0;font-size:18px;font-weight:700;letter-spacing:0.4px;">EDULLENT · ACCOUNT DELETION REQUEST</h1>
      </div>
      <div style="padding:28px;background:#fff;">
        <p style="color:#0F172A;font-size:14px;margin:0 0 18px;">
          A user has submitted an account deletion request via the public Delete Account page.
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;color:#0F172A;">
          <tr><td style="padding:6px 0;color:#64748B;width:140px;">Email</td><td style="padding:6px 0;font-weight:600;">${safeEmail}</td></tr>
          <tr><td style="padding:6px 0;color:#64748B;">Reason</td><td style="padding:6px 0;">${safeReason}</td></tr>
          <tr><td style="padding:6px 0;color:#64748B;">Firebase UID</td><td style="padding:6px 0;font-family:monospace;font-size:12px;">${safeUid}</td></tr>
          <tr><td style="padding:6px 0;color:#64748B;">Request ID</td><td style="padding:6px 0;font-family:monospace;font-size:12px;">${safeRequestId}</td></tr>
          <tr><td style="padding:6px 0;color:#64748B;">IP</td><td style="padding:6px 0;font-family:monospace;font-size:12px;">${safeIp}</td></tr>
        </table>
        <div style="margin-top:18px;padding:14px 16px;background:#FEF2F2;border-left:3px solid #DC2626;border-radius:0 8px 8px 0;color:#7F1D1D;font-size:13px;line-height:1.6;">
          <strong>Comments:</strong><br>${safeComments}
        </div>
        <p style="color:#475569;font-size:12px;margin:20px 0 0;line-height:1.6;">
          SLA: confirm + complete within 7 business days. Mark the Firestore doc
          <code style="background:#F1F5F9;padding:1px 6px;border-radius:4px;">deletion_requests/${safeRequestId}</code>
          as <code>status: "completed"</code> after processing.
        </p>
      </div>
    </div>
  `;

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Edullent Account Deletion <noreply@edulent.dgion.com>",
        to: [NOTIFY_TO],
        reply_to: email,
        subject: `[EDULLENT] Account deletion request — ${email}`,
        html,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.error("[account-deletion] Resend rejected:", resp.status, data);
      return { ok: false, reason: "resend_error", status: resp.status, data };
    }
    return { ok: true, data };
  } catch (err) {
    console.error("[account-deletion] Resend fetch failed:", err);
    return { ok: false, reason: "network_error" };
  }
}

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const ip = clientIp(req);
  if (!rateLimit(`account-deletion:${ip}`, 3)) {
    return res.status(429).json({
      error: "Too many requests. Please try again in a few minutes or email edullentofficial@gmail.com directly.",
    });
  }

  const { email, reason, comments } = req.body || {};

  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "Please enter a valid email address." });
  }
  const normalisedEmail = String(email).trim().toLowerCase();

  const safeReason = typeof reason === "string" && ALLOWED_REASONS.has(reason)
    ? reason
    : null;
  const safeComments = boundString(comments, MAX_COMMENTS).trim();

  const uid = await tryReadUid(req);

  try {
    const a = initAdmin();
    const docRef = a.firestore().collection("deletion_requests").doc();
    const requestId = docRef.id;

    await docRef.set({
      email: normalisedEmail,
      reason: safeReason,
      reasonLabel: safeReason ? REASON_LABEL[safeReason] : null,
      comments: safeComments || null,
      requestedAt: admin.firestore.FieldValue.serverTimestamp(),
      status: "pending",
      userId: uid || null,
      ip,
      userAgent: boundString(req.headers["user-agent"], 500) || null,
    });

    // Fire-and-don't-fail — Firestore write is the source of truth.
    const mail = await sendNotificationEmail({
      requestId,
      email: normalisedEmail,
      reasonLabel: safeReason ? REASON_LABEL[safeReason] : "(not specified)",
      comments: safeComments,
      uid,
      ip,
    });

    return res.status(200).json({
      success: true,
      requestId,
      notificationEmailed: mail.ok,
    });
  } catch (err) {
    console.error("[account-deletion] Firestore write failed:", err);
    return res.status(500).json({
      error: "Could not record your request. Please email edullentofficial@gmail.com directly.",
    });
  }
}
