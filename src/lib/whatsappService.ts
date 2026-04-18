/**
 * whatsappService.ts
 * Client-side wrapper for /api/send-whatsapp Vercel function.
 * Sends Firebase ID token with every call.
 */
import { auth } from "./firebase";

type WAType = "attendance_alert" | "fee_reminder" | "critical_alert" | "weekly_digest";

async function sendWhatsApp(to: string, type: WAType, data: Record<string, any>) {
  try {
    const token = await auth.currentUser?.getIdToken();
    const res = await fetch("/api/send-whatsapp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ to, type, data }),
    });
    const json = await res.json().catch(() => ({}));
    return { success: res.ok, ...json };
  } catch (e: any) {
    console.error("[sendWhatsApp] error:", e);
    return { success: false, error: "Network error." };
  }
}

export const sendAttendanceAlertWA = (
  to: string,
  { parentName, studentName, attendance, threshold, branch }:
  { parentName: string; studentName: string; attendance: number; threshold?: number; branch?: string }
) => sendWhatsApp(to, "attendance_alert", { parentName, studentName, attendance, threshold, branch });

export const sendFeeReminderWA = (
  to: string,
  { parentName, studentName, amount, dueDate, schoolName }:
  { parentName: string; studentName: string; amount?: number; dueDate?: string; schoolName?: string }
) => sendWhatsApp(to, "fee_reminder", { parentName, studentName, amount, dueDate, schoolName });

export const sendCriticalAlertWA = (
  to: string,
  { ownerName, criticalCount, warningCount, branchName }:
  { ownerName: string; criticalCount: number; warningCount?: number; branchName?: string }
) => sendWhatsApp(to, "critical_alert", { ownerName, criticalCount, warningCount, branchName });

export const sendWeeklyDigestWA = (
  to: string,
  { schoolName, ahi, ahiTrend, totalStudents, attendance, alertCount }:
  { schoolName: string; ahi: number; ahiTrend?: number; totalStudents?: number; attendance?: number; alertCount?: number }
) => sendWhatsApp(to, "weekly_digest", { schoolName, ahi, ahiTrend, totalStudents, attendance, alertCount });