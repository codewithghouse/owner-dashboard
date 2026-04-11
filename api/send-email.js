export default async function handler(req, res) {
  // ── CORS Headers ────────────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const apiKey = process.env.VITE_RESEND_API_KEY || process.env.RESEND_API_KEY;
  if (!apiKey || apiKey === 're_123456789') {
    return res.status(500).json({
      success: false,
      error: 'RESEND_API_KEY is missing. Add it to your Vercel environment variables.',
    });
  }

  const { type, to, name, branch, schoolName, subject, body, reportId } = req.body || {};

  if (!to) {
    return res.status(400).json({ success: false, error: 'Missing recipient email (to)' });
  }

  // ── Build email payload based on type ───────────────────────────────────────
  let emailPayload;

  if (type === 'report') {
    // ── Report sharing email ───────────────────────────────────────────────
    if (!subject) {
      return res.status(400).json({ success: false, error: 'Missing subject for report email' });
    }

    const safeBody = (body || '').replace(/\n/g, '<br>');

    emailPayload = {
      from: 'EduIntellect Reports <noreply@edulent.dgion.com>',
      to: [to],
      subject,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 0; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
          <!-- Header -->
          <div style="background: #1e3a8a; padding: 24px 28px;">
            <h1 style="color: #fff; margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 0.5px;">EDUINTELLECT</h1>
            <p style="color: #bfdbfe; margin: 4px 0 0; font-size: 13px;">Reports Center</p>
          </div>
          <!-- Body -->
          <div style="padding: 28px; background: #fff;">
            <h2 style="color: #1e293b; font-size: 17px; margin: 0 0 8px;">${subject.replace(/^\[EDUINTELLECT\]\s*/, '')}</h2>
            ${reportId ? `<p style="color: #64748b; font-size: 12px; margin: 0 0 20px;">Report ID: <strong>${reportId}</strong></p>` : ''}
            <div style="background: #f8fafc; border-left: 3px solid #1e3a8a; padding: 16px 18px; border-radius: 0 8px 8px 0; color: #334155; font-size: 14px; line-height: 1.6;">
              ${safeBody}
            </div>
            <div style="margin-top: 28px; text-align: center;">
              <a href="https://owner-dashboard.vercel.app/reports"
                 style="background: #1e3a8a; color: #fff; padding: 12px 28px; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 13px; display: inline-block;">
                View Full Report
              </a>
            </div>
          </div>
          <!-- Footer -->
          <div style="background: #f1f5f9; padding: 14px 28px; text-align: center;">
            <p style="color: #94a3b8; font-size: 11px; margin: 0;">Powered by EduIntellect Cloud Architecture</p>
          </div>
        </div>
      `,
    };

  } else {
    // ── Principal invitation email (default) ───────────────────────────────
    if (!name) {
      return res.status(400).json({ success: false, error: 'Missing name for invitation email' });
    }

    emailPayload = {
      from: 'EduIntellect <invite@edulent.dgion.com>',
      to: [to],
      subject: `Welcome to ${schoolName || 'EduIntellect'} – Principal Dashboard Access`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 0; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
          <!-- Header -->
          <div style="background: #1e3a8a; padding: 24px 28px;">
            <h1 style="color: #fff; margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 0.5px;">EDUINTELLECT</h1>
            <p style="color: #bfdbfe; margin: 4px 0 0; font-size: 13px;">Principal Dashboard Invitation</p>
          </div>
          <!-- Body -->
          <div style="padding: 28px; background: #fff;">
            <h2 style="color: #1e293b; margin: 0 0 12px;">Welcome, ${name}!</h2>
            <p style="color: #475569; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
              You have been invited as the <strong>Principal</strong> for the
              <strong>${branch || 'Main'}</strong> branch of
              <strong>${schoolName || 'your school'}</strong>.
            </p>
            <p style="color: #475569; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">
              Your dashboard is now ready. Log in with the email address this was sent to.
            </p>
            <div style="text-align: center; margin: 24px 0;">
              <a href="https://principal-dashboard-seven.vercel.app/"
                 style="background: #1e3a8a; color: #fff; padding: 13px 30px; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 14px; display: inline-block;">
                Open Principal Dashboard
              </a>
            </div>
            <p style="color: #94a3b8; font-size: 12px; margin: 20px 0 0;">
              If you didn't expect this invitation, please ignore this email.
            </p>
          </div>
          <!-- Footer -->
          <div style="background: #f1f5f9; padding: 14px 28px; text-align: center;">
            <p style="color: #94a3b8; font-size: 11px; margin: 0;">Powered by EduIntellect Cloud Architecture</p>
          </div>
        </div>
      `,
    };
  }

  // ── Send via Resend ──────────────────────────────────────────────────────────
  try {
    console.log(`[send-email] type=${type || 'invitation'} → ${to}`);
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(emailPayload),
    });

    const result = await response.json();
    console.log('[send-email] Resend response:', response.status, result);

    if (response.ok) {
      return res.status(200).json({ success: true, data: result });
    }

    const msg = result.message || (result.error && result.error.message) || 'Failed to send email';
    return res.status(response.status).json({ success: false, error: result, message: msg });

  } catch (error) {
    console.error('[send-email] Internal error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
