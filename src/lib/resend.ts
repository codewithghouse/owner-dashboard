/**
 * Utility to send emails via Resend API
 * Note: In production, it's better to call this from a backend/serverless function 
 * to keep your API Key secure.
 */

export const sendInvitationEmail = async ({
  to,
  name,
  branch,
  schoolName,
}: {
  to: string;
  name: string;
  branch: string;
  schoolName: string;
}) => {
  const apiKey = import.meta.env.VITE_RESEND_API_KEY;

  if (!apiKey || apiKey === "re_123456789") {
    console.error("Resend API Key is missing or invalid.");
    return { success: false, error: "API Key not configured" };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: "EduIntellect <onboarding@resend.dev>", // Default Resend test domain
        to: [to],
        subject: `Welcome to ${schoolName} - Principal Dashboard Access`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; rounded: 10px;">
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
      }),
    });

    const data = await response.json();

    if (response.ok) {
      return { success: true, data };
    } else {
      return { success: false, error: data };
    }
  } catch (error) {
    console.error("Resend Email Error:", error);
    return { success: false, error };
  }
};
