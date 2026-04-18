/**
 * resend.ts — client-side wrapper for /api/send-email.
 *
 * Sends the caller's Firebase ID token as Authorization: Bearer so the
 * serverless function can verify identity and role.
 */
import { auth } from "./firebase";

async function authHeader(): Promise<Record<string, string>> {
  const token = await auth.currentUser?.getIdToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export const sendCriticalAlertEmail = async ({
  to, ownerName, schoolName, criticalCount, warningCount, branchName,
}: {
  to: string; ownerName: string; schoolName: string;
  criticalCount: number; warningCount: number; branchName?: string;
}) => {
  try {
    const response = await fetch("/api/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeader()) },
      body: JSON.stringify({
        to, type: "critical_alert", ownerName, schoolName,
        criticalCount, warningCount, branchName: branchName || "Multiple branches",
      }),
    });
    const data = await response.json().catch(() => ({}));
    return { success: response.ok, data };
  } catch (error: any) {
    console.error("[sendCriticalAlertEmail] error:", error);
    return { success: false, error: "Network error." };
  }
};

export const sendInvitationEmail = async ({
  to, name, branch, schoolName,
}: {
  to: string; name: string; branch: string; schoolName: string;
}) => {
  try {
    const response = await fetch("/api/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeader()) },
      body: JSON.stringify({ to, name, branch, schoolName }),
    });

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const data = await response.json();
      if (response.ok) {
        return { success: true, data, message: "Invitation sent." };
      }
      return { success: false, error: data, message: data?.error || "Email failed." };
    }
    // Non-JSON response
    return { success: false, error: "server_error", message: `Server error (${response.status})` };
  } catch (error: any) {
    console.error("[sendInvitationEmail] error:", error);
    return { success: false, error: "network_error", message: "Network error." };
  }
};