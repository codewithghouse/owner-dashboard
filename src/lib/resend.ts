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
  try {
    const response = await fetch("/api/send-email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to,
        name,
        branch,
        schoolName,
      }),
    });

    const data = await response.json();

    if (response.ok) {
      return { success: true, data };
    } else {
      return { success: false, error: data };
    }
  } catch (error) {
    console.error("Internal API Error:", error);
    return { success: false, error };
  }
};
