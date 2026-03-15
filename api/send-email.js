import { Resend } from 'resend';

const resend = new Resend(process.env.VITE_RESEND_API_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { to, name, branch, schoolName } = req.body;

  try {
    const data = await resend.emails.send({
      from: 'EduIntellect <onboarding@resend.dev>',
      to: [to],
      subject: `Welcome to ${schoolName} - Principal Dashboard Access`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2 style="color: #1e3a8a;">Welcome, ${name}!</h2>
          <p>You have been invited as the <strong>Principal</strong> for the <strong>${branch}</strong> branch of <strong>${schoolName}</strong>.</p>
          <p>Your dashboard is now ready. You can access it using your Google account associated with this email.</p>
          <div style="margin: 30px 0;">
            <a href="https://principal-dashboard-seven.vercel.app/" 
               style="background: #1e3a8a; color: white; padding: 12px 25px; text-decoration: none; border-radius: 8px; font-weight: bold;">
              Open Principal Dashboard
            </a>
          </div>
          <p style="color: #666; font-size: 12px;">If you didn't expect this invitation, please ignore this email.</p>
          <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="font-size: 10px; color: #999; text-align: center;">Powered by EduIntellect Cloud Architecture</p>
        </div>
      `,
    });

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
