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
    // 1. First choice: try calling the serverless function (Vercel)
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

    // If it's a 404, it means we are in local Vite dev environment, not Vercel dev.
    // Browser CORS policy blocks direct calls to Resend, so we will MOCK a success here
    // so that the Firestore record is still created and the UI flow is not broken.
    if (response.status === 404) {
      console.warn("DEVELOPMENT MODE: Local API endpoint '/api/send-email' not found.");
      console.log("%c📧 MOCK EMAIL SENT", "background: #1e3a8a; color: white; padding: 4px 8px; border-radius: 4px; font-weight: bold;");
      console.log(`To: ${to}`);
      console.log(`Subject: Welcome to ${schoolName}`);
      console.log(`Content: Principal invite for ${branch}`);
      console.log("%cNote: Real emails only work when deployed to Vercel or running with 'vercel dev'.", "color: #64748b; font-style: italic;");
      
      // Simulate a small delay for realism
      await new Promise(resolve => setTimeout(resolve, 800));
      
      return { 
        success: true, 
        data: { id: "mock_id_dev_mode", devMode: true }, 
        message: "Development Mode: Email logged to console instead of sending real mail." 
      };
    }

    const contentType = response.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
      const data = await response.json();
      if (response.ok) {
        return { success: true, data };
      } else {
        return { success: false, error: data };
      }
    } else {
      const text = await response.text();
      return { success: false, error: `Server error (${response.status}): ${text.substring(0, 100)}` };
    }
  } catch (error: any) {
    console.error("Internal API Error:", error);
    return { success: false, error: error.message || "Network error" };
  }
};
