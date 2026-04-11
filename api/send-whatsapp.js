/**
 * api/send-whatsapp.js
 * Vercel serverless function — sends WhatsApp messages via Twilio API.
 *
 * Environment variables required in Vercel dashboard:
 *   TWILIO_ACCOUNT_SID   — from console.twilio.com
 *   TWILIO_AUTH_TOKEN    — from console.twilio.com
 *   TWILIO_WHATSAPP_FROM — e.g. whatsapp:+14155238886 (Twilio sandbox number)
 *
 * POST /api/send-whatsapp
 * Body: { to, type, data }
 *   to     — phone number with country code, e.g. "+919876543210"
 *   type   — "attendance_alert" | "fee_reminder" | "weekly_digest" | "critical_alert"
 *   data   — object with message-specific fields
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;
  const from       = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';

  if (!accountSid || !authToken) {
    return res.status(500).json({
      success: false,
      error: 'Twilio credentials not configured. Add TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN to Vercel environment variables.',
    });
  }

  const { to, type, data } = req.body || {};
  if (!to) return res.status(400).json({ success: false, error: 'Missing recipient phone number (to)' });

  // ── Build message body ───────────────────────────────────────────────────
  let body = '';
  const d = data || {};

  switch (type) {
    case 'attendance_alert':
      body =
        `📚 *EduIntellect Alert*\n\n` +
        `Dear ${d.parentName || 'Parent'},\n\n` +
        `*${d.studentName}*'s attendance has dropped to *${d.attendance}%*.\n\n` +
        `This is below the required ${d.threshold || 75}% threshold.\n` +
        `Please contact the school office or speak with the principal.\n\n` +
        `_Branch: ${d.branch || '—'}_\n` +
        `_Sent by EduIntellect School Management_`;
      break;

    case 'fee_reminder':
      body =
        `💰 *EduIntellect Fee Reminder*\n\n` +
        `Dear ${d.parentName || 'Parent'},\n\n` +
        `This is a friendly reminder that fee payment for *${d.studentName}* is pending.\n\n` +
        `Amount due: *₹${d.amount?.toLocaleString('en-IN') || '—'}*\n` +
        (d.dueDate ? `Due date: *${d.dueDate}*\n` : '') +
        `\nPlease visit the school office or contact us to make the payment.\n\n` +
        `_${d.schoolName || 'Your School'} · EduIntellect_`;
      break;

    case 'critical_alert':
      body =
        `🚨 *EduIntellect Critical Alert*\n\n` +
        `Dear ${d.ownerName || 'School Owner'},\n\n` +
        `Your school has *${d.criticalCount} critical risk alerts* right now.\n` +
        (d.warningCount ? `Additionally, ${d.warningCount} students are on watch.\n` : '') +
        `\nBranch: *${d.branchName || 'Multiple branches'}*\n\n` +
        `Please review the risk dashboard immediately.\n` +
        `_EduIntellect School Management_`;
      break;

    case 'weekly_digest':
      body =
        `📊 *EduIntellect Weekly Digest*\n\n` +
        `*${d.schoolName || 'Your School'}* — Week Summary\n\n` +
        `🏫 AHI Score: *${d.ahi || '—'}%* ${d.ahiTrend > 0 ? '↑' : d.ahiTrend < 0 ? '↓' : '→'}\n` +
        `👥 Active Students: *${d.totalStudents || '—'}*\n` +
        `📋 Attendance: *${d.attendance || '—'}%*\n` +
        `⚠️ Risk Alerts: *${d.alertCount || 0}*\n\n` +
        `_Have a great week! — EduIntellect_`;
      break;

    default:
      body = d.message || 'Message from EduIntellect School Management';
  }

  // ── Send via Twilio API ──────────────────────────────────────────────────
  const toWhatsApp = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const twilioUrl   = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

  const formData = new URLSearchParams();
  formData.append('From', from);
  formData.append('To', toWhatsApp);
  formData.append('Body', body);

  try {
    const response = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    const result = await response.json();
    console.log('[send-whatsapp] Twilio response:', response.status, result.sid || result.message);

    if (response.ok && result.sid) {
      return res.status(200).json({ success: true, sid: result.sid });
    }

    return res.status(response.status).json({
      success: false,
      error: result.message || 'Failed to send WhatsApp message',
    });
  } catch (err) {
    console.error('[send-whatsapp] Error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}
