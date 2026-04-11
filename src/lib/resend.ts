/**
 * Utility to send emails via Resend API
 * Note: In production, it's better to call this from a backend/serverless function 
 * to keep your API Key secure.
 */

/**
 * Sends a critical-alert notification email to the school owner.
 * Called from risksService when criticalCount > 0 and
 * the owner has criticalAlerts notifications enabled.
 */
export const sendCriticalAlertEmail = async ({
  to,
  ownerName,
  schoolName,
  criticalCount,
  warningCount,
  branchName,
}: {
  to: string;
  ownerName: string;
  schoolName: string;
  criticalCount: number;
  warningCount: number;
  branchName?: string;
}) => {
  try {
    const response = await fetch("/api/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to,
        type: "critical_alert",
        ownerName,
        schoolName,
        criticalCount,
        warningCount,
        branchName: branchName || "Multiple branches",
      }),
    });
    const data = await response.json().catch(() => ({}));
    return { success: response.ok, data };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
};

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

    const contentType = response.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
      const data = await response.json();
      console.log("Resend full response:", response.status, JSON.stringify(data));
      if (response.ok) {
        return { success: true, data, message: data.message };
      } else {
        const msg = data.message || data.error || JSON.stringify(data);
        return { success: false, error: data, message: msg };
      }
    } else {
      const text = await response.text();
      console.log("Resend non-JSON response:", response.status, text);
      return { success: false, error: text, message: `Server error (${response.status}): ${text}` };
    }
  } catch (error: any) {
    console.error("Internal API Error:", error);
    return { success: false, error: error.message || "Network error", message: error.message };
  }
};
