/**
 * Delete Account — public route (no auth required).
 *
 * Mandatory surface for Google Play Store TWA submission (data deletion
 * policy effective Dec 2023). Must be:
 *   • Publicly reachable via direct URL (no sign-in wall).
 *   • Linked from privacy policy + in-app settings.
 *   • Capable of accepting requests from logged-OUT users (former users,
 *     reviewers, etc.).
 *
 * Submission flow:
 *   form → POST /api/account-deletion → writes deletion_requests/{id}
 *   + emails edullentofficial@gmail.com. SLA: 7 business days, founder
 *   processes manually and emails the requester confirmation.
 *
 * The page styling intentionally mirrors PrivacyPolicy.tsx (same scaffold,
 * same card pattern) so both Play Store-mandated public pages share a
 * cohesive visual identity.
 */
import { useEffect, useState } from "react";
import { auth } from "@/lib/firebase";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Mail,
  ShieldAlert,
} from "lucide-react";

const REASONS = [
  { value: "", label: "Select a reason (optional)" },
  { value: "no_longer_needed", label: "No longer need the service" },
  { value: "switching_platform", label: "Switching to another platform" },
  { value: "privacy_concerns", label: "Privacy concerns" },
  { value: "other", label: "Other" },
] as const;

interface SubmitState {
  loading: boolean;
  error: string | null;
  success: { requestId: string } | null;
}

export default function DeleteAccount() {
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState<string>("");
  const [comments, setComments] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [state, setState] = useState<SubmitState>({
    loading: false,
    error: null,
    success: null,
  });

  // Pre-fill email if the user is signed in — saves them re-typing what we
  // already know. Still editable (a signed-in user might request deletion
  // for a different account they've used).
  useEffect(() => {
    const u = auth.currentUser;
    if (u?.email) setEmail(u.email);
  }, []);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const canSubmit = emailValid && confirmed && !state.loading;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setState({ loading: true, error: null, success: null });
    try {
      // Send Bearer token IF signed in — server uses it to attach uid to the
      // Firestore doc. Logged-out submissions still go through (uid = null).
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      try {
        const token = await auth.currentUser?.getIdToken();
        if (token) headers.Authorization = `Bearer ${token}`;
      } catch {
        // Ignore — endpoint accepts anonymous submissions.
      }

      const resp = await fetch("/api/account-deletion", {
        method: "POST",
        headers,
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          reason: reason || undefined,
          comments: comments.trim() || undefined,
        }),
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const msg = data?.error || `Request failed (${resp.status}).`;
        setState({ loading: false, error: msg, success: null });
        return;
      }

      setState({
        loading: false,
        error: null,
        success: { requestId: data.requestId || "saved" },
      });
    } catch (err) {
      console.error("[DeleteAccount] submit failed:", err);
      setState({
        loading: false,
        error:
          "Network error. Please check your connection and try again, or email edullentofficial@gmail.com directly.",
        success: null,
      });
    }
  }

  return (
    <div
      style={{
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        background: "#EEF4FF",
        minHeight: "100vh",
        padding: "32px 16px 64px",
      }}
    >
      <div
        style={{
          maxWidth: 760,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: 18,
        }}
      >
        {/* Back link */}
        <a
          href="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            color: "#1e3a8a",
            fontSize: 13,
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          ← Back to Edullent
        </a>

        {/* Header */}
        <div>
          <h1
            style={{
              fontSize: 28,
              fontWeight: 800,
              margin: 0,
              color: "#001040",
              letterSpacing: "-0.5px",
            }}
          >
            Delete Your Account
          </h1>
          <p
            style={{
              color: "#64748B",
              fontSize: 14,
              margin: "6px 0 0",
              lineHeight: 1.6,
            }}
          >
            Permanently delete your Edullent Owner account and associated
            data. We process every request manually within 7 business days.
          </p>
        </div>

        {/* SUCCESS state */}
        {state.success && (
          <SuccessPanel requestId={state.success.requestId} />
        )}

        {/* FORM card */}
        {!state.success && (
          <form
            onSubmit={handleSubmit}
            style={{
              background: "#fff",
              borderRadius: 16,
              padding: "28px 24px",
              boxShadow:
                "0 1px 2px rgba(0,0,0,0.04), 0 8px 32px rgba(0,16,64,0.06)",
              border: "0.5px solid rgba(0,16,64,0.08)",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <Field label="Account email" required>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  inputMode="email"
                  style={inputStyle}
                />
                {email.length > 0 && !emailValid && (
                  <p style={hintStyle("#DC2626")}>
                    Enter a valid email address.
                  </p>
                )}
              </Field>

              <Field label="Reason for deletion (optional)">
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  style={inputStyle}
                >
                  {REASONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Additional comments (optional)">
                <textarea
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  rows={4}
                  maxLength={2000}
                  placeholder="Anything specific you'd like us to know? (max 2000 characters)"
                  style={{ ...inputStyle, resize: "vertical", minHeight: 96 }}
                />
                <p style={hintStyle("#94A3B8")}>
                  {comments.length} / 2000
                </p>
              </Field>

              {/* Confirmation checkbox */}
              <label
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  padding: "12px 14px",
                  background: "#FEF2F2",
                  border: "1px solid rgba(220,38,38,0.18)",
                  borderRadius: 12,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  style={{
                    marginTop: 2,
                    width: 16,
                    height: 16,
                    accentColor: "#DC2626",
                    cursor: "pointer",
                  }}
                />
                <span style={{ fontSize: 13, color: "#7F1D1D", lineHeight: 1.5 }}>
                  <strong>I understand this action is permanent and cannot be undone.</strong>{" "}
                  My school's data — including student records, teacher records,
                  financial entries, and uploaded documents — will be deleted
                  within 7 business days.
                </span>
              </label>

              {/* Submit error */}
              {state.error && (
                <div
                  role="alert"
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 8,
                    padding: "10px 12px",
                    background: "#FEF2F2",
                    border: "1px solid #FECACA",
                    borderRadius: 10,
                    color: "#7F1D1D",
                    fontSize: 13,
                  }}
                >
                  <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>{state.error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={!canSubmit}
                style={{
                  marginTop: 4,
                  height: 48,
                  borderRadius: 12,
                  border: "none",
                  background: canSubmit
                    ? "linear-gradient(135deg, #DC2626, #EF4444)"
                    : "#FCA5A5",
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: 14,
                  letterSpacing: "0.02em",
                  cursor: canSubmit ? "pointer" : "not-allowed",
                  boxShadow: canSubmit
                    ? "0 8px 24px rgba(220,38,38,0.28)"
                    : "none",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  transition: "transform 0.15s ease",
                }}
              >
                {state.loading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Submitting…
                  </>
                ) : (
                  <>
                    <ShieldAlert size={16} />
                    Request Account Deletion
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        {/* INFO sections */}
        <InfoCard
          title="What will be deleted"
          tone="red"
          items={[
            "Your owner account credentials",
            "Your personal information (name, email, phone)",
            "Your school's data including students, teachers, fees records",
            "Uploaded documents and files",
            "All historical data and reports",
          ]}
        />
        <InfoCard
          title="What we may retain"
          tone="amber"
          items={[
            "Anonymized usage analytics for product improvement",
            "Financial transaction records (required by Indian law for 7 years)",
            "Data required by legal obligations",
          ]}
        />
        <InfoCard
          title="Processing time"
          tone="navy"
          items={[
            "Request will be processed within 7 business days",
            "You will receive confirmation email at your registered address",
            "Your subscription will be cancelled (no refunds for current billing period)",
          ]}
        />
        <InfoCard
          title="Alternative options"
          tone="green"
          items={[
            <>
              If you only want to delete some data (not the account), email us
              at{" "}
              <a
                href="mailto:edullentofficial@gmail.com"
                style={{ color: "#047857", fontWeight: 700 }}
              >
                edullentofficial@gmail.com
              </a>
            </>,
            "If you want to pause your subscription instead, contact support",
          ]}
        />
        <div
          style={{
            background: "#fff",
            borderRadius: 16,
            padding: "20px 22px",
            boxShadow:
              "0 1px 2px rgba(0,0,0,0.04), 0 8px 32px rgba(0,16,64,0.06)",
            border: "0.5px solid rgba(0,16,64,0.08)",
          }}
        >
          <h3
            style={{
              fontSize: 13,
              fontWeight: 800,
              margin: 0,
              color: "#001040",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Mail size={14} /> Contact
          </h3>
          <p style={{ fontSize: 13, color: "#475569", margin: "8px 0 0", lineHeight: 1.6 }}>
            Email:{" "}
            <a
              href="mailto:edullentofficial@gmail.com"
              style={{ color: "#1e3a8a", fontWeight: 700 }}
            >
              edullentofficial@gmail.com
            </a>
            <br />
            Response time: Within 48 hours
          </p>
        </div>

        {/* Footer link to privacy */}
        <p style={{ textAlign: "center", fontSize: 12, color: "#64748B", margin: "10px 0 0" }}>
          See our{" "}
          <a
            href="/privacy"
            style={{ color: "#1e3a8a", fontWeight: 600 }}
          >
            Privacy Policy
          </a>{" "}
          for full details on data handling.
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components + styles
// ─────────────────────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "11px 14px",
  borderRadius: 10,
  border: "1px solid #E2E8F0",
  fontSize: 14,
  color: "#0F172A",
  background: "#fff",
  fontFamily: "inherit",
  outline: "none",
  boxSizing: "border-box",
};

const hintStyle = (color: string): React.CSSProperties => ({
  fontSize: 11,
  color,
  margin: "6px 0 0",
});

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        style={{
          display: "block",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "#475569",
          marginBottom: 6,
        }}
      >
        {label}
        {required && <span style={{ color: "#DC2626", marginLeft: 4 }}>*</span>}
      </label>
      {children}
    </div>
  );
}

function InfoCard({
  title,
  items,
  tone,
}: {
  title: string;
  items: React.ReactNode[];
  tone: "red" | "amber" | "navy" | "green";
}) {
  const accent = {
    red:   { bar: "#DC2626", icon: "#DC2626" },
    amber: { bar: "#F59E0B", icon: "#92400E" },
    navy:  { bar: "#1e3a8a", icon: "#1e3a8a" },
    green: { bar: "#10B981", icon: "#047857" },
  }[tone];
  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 16,
        padding: "20px 22px",
        boxShadow:
          "0 1px 2px rgba(0,0,0,0.04), 0 8px 32px rgba(0,16,64,0.06)",
        border: "0.5px solid rgba(0,16,64,0.08)",
        borderLeft: `3px solid ${accent.bar}`,
      }}
    >
      <h3
        style={{
          fontSize: 13,
          fontWeight: 800,
          margin: 0,
          color: "#001040",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {title}
      </h3>
      <ul
        style={{
          margin: "10px 0 0",
          padding: "0 0 0 18px",
          color: "#334155",
          fontSize: 13,
          lineHeight: 1.7,
        }}
      >
        {items.map((it, i) => (
          <li key={i} style={{ marginBottom: 4 }}>
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SuccessPanel({ requestId }: { requestId: string }) {
  return (
    <div
      role="status"
      style={{
        background: "linear-gradient(135deg, #D1FAE5 0%, #F7FBF8 100%)",
        border: "1px solid rgba(16,185,129,0.30)",
        borderRadius: 16,
        padding: "28px 26px",
        textAlign: "center",
        boxShadow:
          "0 1px 2px rgba(0,0,0,0.04), 0 8px 32px rgba(0,16,64,0.06)",
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          margin: "0 auto 14px",
          borderRadius: "50%",
          background: "linear-gradient(135deg, #10B981, #34D399)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 8px 24px rgba(16,185,129,0.30)",
        }}
      >
        <CheckCircle2 size={28} color="#fff" />
      </div>
      <h2
        style={{
          fontSize: 18,
          fontWeight: 800,
          margin: 0,
          color: "#047857",
        }}
      >
        Request received
      </h2>
      <p
        style={{
          fontSize: 14,
          color: "#0F172A",
          margin: "10px 0 0",
          lineHeight: 1.6,
        }}
      >
        Your account deletion request has been received. We will process it
        within 7 days and confirm via email.
      </p>
      <p
        style={{
          fontSize: 11,
          color: "#64748B",
          margin: "14px 0 0",
          fontFamily: "monospace",
        }}
      >
        Reference: {requestId}
      </p>
    </div>
  );
}
