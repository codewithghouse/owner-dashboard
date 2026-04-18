/**
 * OnboardingModal — 4-step first-run wizard shown to brand-new owners.
 * Steps:
 *   0. School name + contact email
 *   1. Add first branch (name + location)
 *   2. Invite first principal (name + email) — skippable
 *   3. Done — feature preview grid
 *
 * Completion sets schools/{uid}.onboardingComplete = true (merge)
 * so the modal never shows again.
 */
import { useState } from "react";
import { db, auth } from "@/lib/firebase";
import {
  doc, setDoc, addDoc, collection, serverTimestamp,
} from "firebase/firestore";
import {
  CheckCircle2, ChevronRight, Building2, GraduationCap,
  BarChart3, ShieldCheck, Users, BookOpen, X,
} from "lucide-react";
import { sendInvitationEmail } from "@/lib/resend";
import { addAuditLog } from "@/lib/auditService";

// ── Types ────────────────────────────────────────────────────────────────────
interface Props {
  onComplete: () => void;
}

// ── Step config ───────────────────────────────────────────────────────────────
const STEPS = [
  { title: "Welcome! Let's set up your school",    sub: "Tell us a bit about your school" },
  { title: "Add your first branch",                sub: "You can add more branches later from the dashboard" },
  { title: "Invite your first principal",          sub: "They'll get login access immediately — skip if you want" },
  { title: "You're all set!",                      sub: "Here's everything you can do with Edullent" },
];

// ── Feature cards shown on Done screen ───────────────────────────────────────
const FEATURES = [
  { icon: BarChart3,    label: "Live KPI Dashboard",     color: "#1e3a8a" },
  { icon: Users,        label: "Student Intelligence",   color: "#3b82f6" },
  { icon: GraduationCap,label: "Teacher Performance",    color: "#8b5cf6" },
  { icon: BookOpen,     label: "Academics Overview",     color: "#10b981" },
  { icon: ShieldCheck,  label: "Risks & Alerts",         color: "#ef4444" },
  { icon: Building2,    label: "Branch Comparison",      color: "#06b6d4" },
];

// ── Component ─────────────────────────────────────────────────────────────────
export default function OnboardingModal({ onComplete }: Props) {
  const [step, setStep]             = useState(0);
  const [saving, setSaving]         = useState(false);

  // Step 0
  const [schoolName,  setSchoolName]  = useState("");
  const [ownerEmail,  setOwnerEmail]  = useState(auth.currentUser?.email || "");

  // Step 1
  const [branchName,  setBranchName]  = useState("");
  const [branchLoc,   setBranchLoc]   = useState("");
  const [branchSaved, setBranchSaved] = useState(false);

  // Step 2
  const [principalName,  setPrincipalName]  = useState("");
  const [principalEmail, setPrincipalEmail] = useState("");
  const [inviteSent,     setInviteSent]     = useState(false);
  const [inviteError,    setInviteError]    = useState("");

  const uid = auth.currentUser?.uid;

  // ── Step 0 → save school name ─────────────────────────────────────────────
  const handleSchoolStep = async () => {
    if (!schoolName.trim() || !uid) return;
    setSaving(true);
    try {
      await setDoc(
        doc(db, "schools", uid),
        { schoolName: schoolName.trim(), email: ownerEmail.trim(), onboardingComplete: false },
        { merge: true },
      );
      setStep(1);
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  // ── Step 1 → save first branch ───────────────────────────────────────────
  const handleBranchStep = async () => {
    if (!branchName.trim() || !uid) return;
    setSaving(true);
    try {
      const color = "#1e3a8a";
      const docRef = await addDoc(collection(db, "schools", uid, "branches"), {
        name:      branchName.trim(),
        location:  branchLoc.trim(),
        color,
        schoolId:  uid,
        createdAt: serverTimestamp(),
      });
      // store branchId equal to the doc id
      await setDoc(docRef, { branchId: docRef.id }, { merge: true });
      addAuditLog("branch_added", `Branch added: ${branchName.trim()}`, "Via onboarding wizard").catch(() => {});
      setBranchSaved(true);
      setStep(2);
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  // ── Step 2 → invite principal (optional) ─────────────────────────────────
  const handleInviteStep = async (skip = false) => {
    if (skip) { setStep(3); return; }
    if (!principalName.trim() || !principalEmail.trim() || !uid) return;
    setSaving(true);
    setInviteError("");
    try {
      await addDoc(collection(db, "principals"), {
        name:       principalName.trim(),
        email:      principalEmail.trim(),
        schoolId:   uid,
        schoolName: schoolName.trim(),
        status:     "invited",
        invitedAt:  serverTimestamp(),
      });
      const result = await sendInvitationEmail({
        to:         principalEmail.trim(),
        name:       principalName.trim(),
        branch:     branchName.trim() || "Your branch",
        schoolName: schoolName.trim() || "Your school",
      });
      if (!result.success) {
        setInviteError(result.message || "Email send failed. Principal was saved anyway.");
      } else {
        setInviteSent(true);
      }
      addAuditLog("principal_invited", `Principal invited: ${principalName.trim()}`, principalEmail.trim()).catch(() => {});
      setStep(3);
    } catch (e: any) {
      setInviteError(e.message || "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  // ── Step 3 → mark complete ────────────────────────────────────────────────
  const handleFinish = async () => {
    if (!uid) { onComplete(); return; }
    setSaving(true);
    try {
      await setDoc(doc(db, "schools", uid), { onboardingComplete: true }, { merge: true });
    } catch { /* non-fatal */ }
    setSaving(false);
    onComplete();
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  const stepDot = (i: number) => (
    <div
      key={i}
      className={`w-2 h-2 rounded-full transition-all duration-300 ${
        i === step ? "bg-[#1e3a8a] w-6" : i < step ? "bg-[#1e3a8a]/40" : "bg-slate-200"
      }`}
    />
  );

  return (
    <div className="fixed inset-0 z-[200] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center px-4">
      <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="bg-gradient-to-r from-[#1e3a8a] to-[#2563eb] px-8 pt-8 pb-6 text-white">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-black uppercase tracking-[0.2em] text-blue-200">
              Step {step + 1} of {STEPS.length}
            </span>
            {step === 3 && (
              <button onClick={handleFinish} className="p-1 rounded-full hover:bg-white/10 transition-colors">
                <X className="w-4 h-4 text-white/60" />
              </button>
            )}
          </div>
          <h2 className="text-xl font-black leading-tight">{STEPS[step].title}</h2>
          <p className="text-sm text-blue-100 mt-1">{STEPS[step].sub}</p>
          {/* progress dots */}
          <div className="flex items-center gap-1.5 mt-5">
            {STEPS.map((_, i) => stepDot(i))}
          </div>
        </div>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div className="px-8 py-7">

          {/* Step 0 — School info */}
          {step === 0 && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1.5">
                  School / Institute Name *
                </label>
                <input
                  value={schoolName}
                  onChange={e => setSchoolName(e.target.value)}
                  placeholder="e.g. Greenfield Academy"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm font-medium text-[#1e294b] outline-none focus:border-[#1e3a8a] focus:ring-2 focus:ring-[#1e3a8a]/10 transition-all"
                  onKeyDown={e => e.key === "Enter" && handleSchoolStep()}
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1.5">
                  Your Email
                </label>
                <input
                  value={ownerEmail}
                  onChange={e => setOwnerEmail(e.target.value)}
                  type="email"
                  placeholder="owner@school.com"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm font-medium text-[#1e294b] outline-none focus:border-[#1e3a8a] focus:ring-2 focus:ring-[#1e3a8a]/10 transition-all"
                />
              </div>
              <button
                onClick={handleSchoolStep}
                disabled={!schoolName.trim() || saving}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-[#1e3a8a] text-white text-sm font-black disabled:opacity-40 hover:bg-[#1e40af] transition-colors mt-2"
              >
                {saving ? "Saving..." : "Continue"}
                {!saving && <ChevronRight className="w-4 h-4" />}
              </button>
            </div>
          )}

          {/* Step 1 — First branch */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1.5">
                  Branch Name *
                </label>
                <input
                  value={branchName}
                  onChange={e => setBranchName(e.target.value)}
                  placeholder="e.g. Main Campus, North Branch"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm font-medium text-[#1e294b] outline-none focus:border-[#1e3a8a] focus:ring-2 focus:ring-[#1e3a8a]/10 transition-all"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1.5">
                  Location / City
                </label>
                <input
                  value={branchLoc}
                  onChange={e => setBranchLoc(e.target.value)}
                  placeholder="e.g. Hyderabad, Mumbai"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm font-medium text-[#1e294b] outline-none focus:border-[#1e3a8a] focus:ring-2 focus:ring-[#1e3a8a]/10 transition-all"
                />
              </div>
              <button
                onClick={handleBranchStep}
                disabled={!branchName.trim() || saving}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-[#1e3a8a] text-white text-sm font-black disabled:opacity-40 hover:bg-[#1e40af] transition-colors mt-2"
              >
                {saving ? "Creating branch..." : "Add Branch & Continue"}
                {!saving && <ChevronRight className="w-4 h-4" />}
              </button>
            </div>
          )}

          {/* Step 2 — Invite principal */}
          {step === 2 && (
            <div className="space-y-4">
              {inviteError && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs font-medium text-amber-700">
                  {inviteError}
                </div>
              )}
              <div>
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1.5">
                  Principal Name
                </label>
                <input
                  value={principalName}
                  onChange={e => setPrincipalName(e.target.value)}
                  placeholder="e.g. Dr. Ravi Kumar"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm font-medium text-[#1e294b] outline-none focus:border-[#1e3a8a] focus:ring-2 focus:ring-[#1e3a8a]/10 transition-all"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1.5">
                  Principal Email
                </label>
                <input
                  value={principalEmail}
                  onChange={e => setPrincipalEmail(e.target.value)}
                  type="email"
                  placeholder="principal@school.com"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm font-medium text-[#1e294b] outline-none focus:border-[#1e3a8a] focus:ring-2 focus:ring-[#1e3a8a]/10 transition-all"
                />
              </div>
              <button
                onClick={() => handleInviteStep(false)}
                disabled={!principalName.trim() || !principalEmail.trim() || saving}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-[#1e3a8a] text-white text-sm font-black disabled:opacity-40 hover:bg-[#1e40af] transition-colors mt-2"
              >
                {saving ? "Sending invite..." : "Send Invite & Continue"}
                {!saving && <ChevronRight className="w-4 h-4" />}
              </button>
              <button
                onClick={() => handleInviteStep(true)}
                disabled={saving}
                className="w-full py-2.5 rounded-xl text-sm font-bold text-slate-400 hover:text-slate-600 transition-colors"
              >
                Skip for now
              </button>
            </div>
          )}

          {/* Step 3 — Done */}
          {step === 3 && (
            <div className="space-y-5">
              <div className="flex items-center justify-center">
                <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center">
                  <CheckCircle2 className="w-9 h-9 text-emerald-500" />
                </div>
              </div>
              <p className="text-center text-sm font-medium text-slate-500">
                <span className="font-black text-[#1e294b]">{schoolName || "Your school"}</span> is ready.<br />
                Explore all the features below.
              </p>
              {/* Feature grid */}
              <div className="grid grid-cols-3 gap-2.5">
                {FEATURES.map(f => {
                  const Icon = f.icon;
                  return (
                    <div
                      key={f.label}
                      className="flex flex-col items-center gap-2 p-3 bg-slate-50 rounded-2xl"
                    >
                      <div
                        className="w-9 h-9 rounded-xl flex items-center justify-center text-white shadow-sm"
                        style={{ backgroundColor: f.color }}
                      >
                        <Icon className="w-4 h-4" />
                      </div>
                      <p className="text-[10px] font-black text-slate-500 text-center leading-tight">{f.label}</p>
                    </div>
                  );
                })}
              </div>
              <button
                onClick={handleFinish}
                disabled={saving}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-[#1e3a8a] text-white text-sm font-black hover:bg-[#1e40af] transition-colors disabled:opacity-40"
              >
                {saving ? "Setting up..." : "Go to Dashboard"}
                {!saving && <ChevronRight className="w-4 h-4" />}
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
