/**
 * auditService.ts
 * Writes and reads activity entries from schools/{uid}/audit_log subcollection.
 * Every destructive or management action should call addAuditLog() so the owner
 * has a complete, immutable history of changes.
 */
import { db, auth } from "./firebase";
import {
  collection, addDoc, getDocs,
  query, orderBy, limit as fsLimit, serverTimestamp,
} from "firebase/firestore";

// ── Action types ──────────────────────────────────────────────────────────────
export type AuditAction =
  | "branch_added"
  | "branch_edited"
  | "branch_deleted"
  | "principal_invited"
  | "principal_removed"
  | "deo_revoked"
  | "deo_reinstated"
  | "settings_saved"
  | "alert_resolved"
  | "alert_acknowledged"
  | "data_exported";

// ── Entry shape ───────────────────────────────────────────────────────────────
export interface AuditEntry {
  id: string;
  action: AuditAction;
  label: string;
  details?: string | null;
  performedBy: string;
  ts: any; // Firestore Timestamp
}

// ── Config per action (icon + badge color) ────────────────────────────────────
export const ACTION_CONFIG: Record<AuditAction, { icon: string; label: string; color: string }> = {
  branch_added:       { icon: "🏫", label: "Branch Added",         color: "bg-blue-50 text-blue-600 border-blue-100" },
  branch_edited:      { icon: "✏️", label: "Branch Edited",        color: "bg-slate-50 text-slate-600 border-slate-100" },
  branch_deleted:     { icon: "🗑️", label: "Branch Deleted",       color: "bg-rose-50 text-rose-600 border-rose-100" },
  principal_invited:  { icon: "👤", label: "Principal Invited",    color: "bg-emerald-50 text-emerald-600 border-emerald-100" },
  principal_removed:  { icon: "❌", label: "Principal Removed",    color: "bg-rose-50 text-rose-600 border-rose-100" },
  deo_revoked:        { icon: "🔒", label: "DEO Revoked",          color: "bg-amber-50 text-amber-600 border-amber-100" },
  deo_reinstated:     { icon: "🔓", label: "DEO Reinstated",       color: "bg-emerald-50 text-emerald-600 border-emerald-100" },
  settings_saved:     { icon: "⚙️", label: "Settings Updated",     color: "bg-slate-50 text-slate-600 border-slate-100" },
  alert_resolved:     { icon: "✅", label: "Alert Resolved",       color: "bg-emerald-50 text-emerald-600 border-emerald-100" },
  alert_acknowledged: { icon: "👁️", label: "Alert Acknowledged",   color: "bg-blue-50 text-blue-600 border-blue-100" },
  data_exported:      { icon: "📥", label: "Data Exported",        color: "bg-purple-50 text-purple-600 border-purple-100" },
};

// ── Write ─────────────────────────────────────────────────────────────────────
/**
 * addAuditLog — write a single activity entry.
 * Silently swallows errors so it never crashes the calling action.
 */
export async function addAuditLog(
  action: AuditAction,
  label: string,
  details?: string,
): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  try {
    await addDoc(collection(db, "schools", uid, "audit_log"), {
      action,
      label,
      details: details ?? null,
      performedBy: uid,
      ts: serverTimestamp(),
    });
  } catch (e) {
    // Audit failures must NEVER block the main action
    console.warn("[auditService] Failed to write audit entry:", e);
  }
}

// ── Read ──────────────────────────────────────────────────────────────────────
export async function fetchAuditLog(count = 100): Promise<AuditEntry[]> {
  const uid = auth.currentUser?.uid;
  if (!uid) return [];
  try {
    const snap = await getDocs(
      query(
        collection(db, "schools", uid, "audit_log"),
        orderBy("ts", "desc"),
        fsLimit(count),
      ),
    );
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as AuditEntry));
  } catch {
    return [];
  }
}
