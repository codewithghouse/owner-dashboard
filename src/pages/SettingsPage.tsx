import { useState, useEffect, useRef } from "react";
import { auth, db } from "@/lib/firebase";
import { addAuditLog } from "@/lib/auditService";
import { doc, getDoc, setDoc, collection, getDocs, query, where } from "firebase/firestore";
import {
  getStorage, ref as storageRef, uploadBytes, getDownloadURL
} from "firebase/storage";
import {
  User, Mail, Phone, MapPin, Building2,
  Bell, BellOff, Clock, Calendar, DollarSign,
  Save, Loader2, CheckCircle2, AlertCircle,
  Camera, Upload, Trash2, Image, Download, FileText, Activity,
  Settings as SettingsIcon, Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import {
  B1, T1, T3, T4, GREEN, RED, GOLD, VIOLET,
  GRAD_PRIMARY, GRAD_BLUE, GRAD_GREEN, GRAD_VIOLET, GRAD_GOLD, GRAD_RED,
  SHADOW_SM, SHADOW_BTN, usePageShellStyle,
  DashGlobalStyles, PageHead, DarkHero, AIInsightCard,
} from "@/lib/dashboardTokens";
import { useIsMobile } from "@/hooks/use-mobile";

// ── Types ─────────────────────────────────────────────────────────────────────
interface RiskThresholds {
  attendanceCritical: number; // default 65 — below this = Critical alert
  attendanceWarning:  number; // default 80 — below this = Warning alert
  feeOverdueDays:     number; // default 30 — days before fee overdue alert
}

interface SchoolSettings {
  ownerName:    string;
  email:        string;
  phone:        string;
  schoolName:   string;
  address:      string;
  timezone:     string;
  dateFormat:   string;
  currency:     string;
  language:     string;
  logoUrl:      string;
  notifications: {
    criticalAlerts:  boolean;
    dailySummary:    boolean;
    weeklyReports:   boolean;
    feeReminders:    boolean;
    whatsappAlerts:  boolean;
    whatsappDigest:  boolean;
  };
  whatsappPhone: string;
  thresholds: RiskThresholds;
}

const DEFAULT_THRESHOLDS: RiskThresholds = {
  attendanceCritical: 65,
  attendanceWarning:  80,
  feeOverdueDays:     30,
};

const DEFAULT_SETTINGS: SchoolSettings = {
  ownerName:    "",
  email:        "",
  phone:        "",
  schoolName:   "",
  address:      "",
  timezone:     "Asia/Kolkata (IST)",
  dateFormat:   "DD/MM/YYYY",
  currency:     "INR (₹)",
  language:     "English",
  logoUrl:      "",
  notifications: {
    criticalAlerts:  true,
    dailySummary:    true,
    weeklyReports:   true,
    feeReminders:    true,
    whatsappAlerts:  false,
    whatsappDigest:  false,
  },
  whatsappPhone: "",
  thresholds: { ...DEFAULT_THRESHOLDS },
};

const TIMEZONE_OPTIONS = [
  "Asia/Kolkata (IST)",
  "Asia/Dubai (GST)",
  "Asia/Singapore (SGT)",
  "Europe/London (GMT)",
  "America/New_York (EST)",
  "America/Los_Angeles (PST)",
];
const DATE_FORMAT_OPTIONS = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"];
const CURRENCY_OPTIONS    = ["INR (₹)", "USD ($)", "EUR (€)", "GBP (£)", "AED (د.إ)"];
const LANGUAGE_OPTIONS    = ["English", "Hindi", "Arabic", "French", "Spanish"];

// ── Toggle ────────────────────────────────────────────────────────────────────
// iOS-style toggle. Uses flex centering + transform translateX for symmetric
// thumb positioning and GPU-accelerated smooth motion. `p-0 border-0` kills
// browser default <button> padding/border that otherwise shifts the thumb.
const Toggle = ({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) => (
  <button
    type="button"
    onClick={() => onChange(!value)}
    aria-pressed={value}
    className={`relative inline-flex items-center h-6 w-12 rounded-full shrink-0 cursor-pointer p-0 border-0 transition-colors duration-300 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[#1e3a8a]/40 ${
      value ? "bg-[#1e3a8a] shadow-md shadow-blue-900/20" : "bg-slate-300"
    }`}
  >
    <span
      aria-hidden="true"
      className="pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-md transition-transform duration-300 ease-in-out will-change-transform"
      style={{ transform: value ? "translateX(26px)" : "translateX(2px)" }}
    />
  </button>
);

// ── Field ─────────────────────────────────────────────────────────────────────
const Field = ({
  label, icon: Icon, children
}: {
  label: string; icon: React.ElementType; children: React.ReactNode;
}) => (
  <div className="space-y-2">
    <label className="text-[10px] font-black text-slate-600 uppercase tracking-widest flex items-center gap-1.5 ml-1">
      <Icon className="w-3 h-3" /> {label}
    </label>
    {children}
  </div>
);

// ── Main Page ─────────────────────────────────────────────────────────────────
// ── CSV export helper ─────────────────────────────────────────────────────────
function downloadCSV(data: Record<string, any>[], filename: string) {
  if (!data.length) { return false; }
  const headers = Object.keys(data[0]);
  const rows = data.map(r =>
    headers.map(h => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(",")
  );
  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
  return true;
}

export default function SettingsPage() {
  const isMobile = useIsMobile();
  const pageShellStyle = usePageShellStyle();
  const [settings, setSettings]     = useState<SchoolSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">("idle");
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoPreview, setLogoPreview]     = useState<string>("");
  const logoInputRef                      = useRef<HTMLInputElement>(null);
  const [exporting, setExporting]         = useState<string | null>(null);

  // ── Load from Firestore ────────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      if (!auth.currentUser) { setLoading(false); return; }
      try {
        const snap = await getDoc(doc(db, "schools", auth.currentUser.uid));
        if (snap.exists()) {
          const d = snap.data();
          const loaded: SchoolSettings = {
            ownerName:   d.ownerName   || auth.currentUser.displayName || "",
            email:       d.email       || auth.currentUser.email       || "",
            phone:       d.phone       || "",
            schoolName:  d.schoolName  || "",
            address:     d.address     || "",
            timezone:    d.timezone    || "Asia/Kolkata (IST)",
            dateFormat:  d.dateFormat  || "DD/MM/YYYY",
            currency:    d.currency    || "INR (₹)",
            language:    d.language    || "English",
            logoUrl:     d.logoUrl     || "",
            notifications: {
              criticalAlerts:  d.notifications?.criticalAlerts  ?? true,
              dailySummary:    d.notifications?.dailySummary    ?? true,
              weeklyReports:   d.notifications?.weeklyReports   ?? true,
              feeReminders:    d.notifications?.feeReminders    ?? true,
              whatsappAlerts:  d.notifications?.whatsappAlerts  ?? false,
              whatsappDigest:  d.notifications?.whatsappDigest  ?? false,
            },
            whatsappPhone: d.whatsappPhone || "",
            thresholds: {
              attendanceCritical: d.thresholds?.attendanceCritical ?? DEFAULT_THRESHOLDS.attendanceCritical,
              attendanceWarning:  d.thresholds?.attendanceWarning  ?? DEFAULT_THRESHOLDS.attendanceWarning,
              feeOverdueDays:     d.thresholds?.feeOverdueDays     ?? DEFAULT_THRESHOLDS.feeOverdueDays,
            },
          };
          setSettings(loaded);
          if (loaded.logoUrl) setLogoPreview(loaded.logoUrl);
        }
      } catch (e) {
        console.error("Settings load error:", e);
        toast.error("Failed to load settings. Check your connection.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  // ── Logo upload ────────────────────────────────────────────────────────────
  const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !auth.currentUser) return;

    if (file.size > 2 * 1024 * 1024) {
      toast.error("Logo must be under 2MB");
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }

    // Local preview immediately
    const reader = new FileReader();
    reader.onload = (ev) => setLogoPreview(ev.target?.result as string);
    reader.readAsDataURL(file);

    setLogoUploading(true);
    try {
      const storage = getStorage();
      const logoRef = storageRef(storage, `schools/${auth.currentUser.uid}/logo`);
      await uploadBytes(logoRef, file);
      const url = await getDownloadURL(logoRef);
      setSettings(prev => ({ ...prev, logoUrl: url }));
      setLogoPreview(url);
      // Save logo URL immediately to Firestore
      await setDoc(doc(db, "schools", auth.currentUser!.uid), { logoUrl: url }, { merge: true });
      toast.success("Logo uploaded successfully!");
    } catch (err: any) {
      console.error("Logo upload error:", err);
      if (err?.code === "storage/unauthorized") {
        toast.error("Storage permission denied. Check Firebase rules.");
      } else {
        toast.error("Logo upload failed. Try again.");
      }
      setLogoPreview(settings.logoUrl || "");
    } finally {
      setLogoUploading(false);
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  };

  const handleRemoveLogo = async () => {
    if (!auth.currentUser) return;
    setLogoPreview("");
    setSettings(prev => ({ ...prev, logoUrl: "" }));
    try {
      await setDoc(doc(db, "schools", auth.currentUser.uid), { logoUrl: "" }, { merge: true });
      toast.success("Logo removed.");
    } catch (e) {
      toast.error("Failed to remove logo.");
    }
  };

  // ── Save to Firestore ──────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!auth.currentUser) return;
    if (!settings.ownerName.trim()) {
      toast.error("Owner name cannot be empty.");
      return;
    }
    if (!settings.schoolName.trim()) {
      toast.error("School name cannot be empty.");
      return;
    }
    setSaving(true);
    setSaveStatus("idle");
    try {
      await setDoc(doc(db, "schools", auth.currentUser.uid), {
        ownerName:     settings.ownerName.trim(),
        phone:         settings.phone.trim(),
        schoolName:    settings.schoolName.trim(),
        address:       settings.address.trim(),
        timezone:      settings.timezone,
        dateFormat:    settings.dateFormat,
        currency:      settings.currency,
        language:      settings.language,
        logoUrl:       settings.logoUrl,
        notifications:  settings.notifications,
        whatsappPhone:  settings.whatsappPhone.trim(),
        thresholds:     settings.thresholds,
        updatedAt:     new Date().toISOString(),
      }, { merge: true });
      addAuditLog("settings_saved", "School settings updated", settings.schoolName || undefined);
      setSaveStatus("success");
      toast.success("Settings saved!");
      setTimeout(() => setSaveStatus("idle"), 3000);
    } catch (e) {
      console.error("Settings save error:", e);
      setSaveStatus("error");
      toast.error("Save failed — check your connection.");
      setTimeout(() => setSaveStatus("idle"), 4000);
    } finally {
      setSaving(false);
    }
  };

  // ── Export handlers ────────────────────────────────────────────────────────
  const handleExport = async (type: "students" | "fees" | "audit") => {
    if (!auth.currentUser) return;
    const uid = auth.currentUser.uid;
    setExporting(type);
    try {
      if (type === "students") {
        const snap = await getDocs(query(collection(db, "students"), where("schoolId", "==", uid)));
        const rows = snap.docs.map(d => {
          const s = d.data();
          return {
            Name:       [s.firstName, s.lastName].filter(Boolean).join(" ") || s.name || "—",
            Email:      s.email || "—",
            Branch:     s.branchId || s.schoolId || "—",
            Grade:      s.grade || s.class || "—",
            Phone:      s.phone || "—",
            EnrolledAt: s.createdAt?.toDate?.()?.toLocaleDateString() || "—",
          };
        });
        if (!downloadCSV(rows, `students_${new Date().toISOString().slice(0,10)}.csv`)) {
          toast.error("No student records found.");
          return;
        }
        addAuditLog("data_exported", `Students list exported (${rows.length} records)`);
        toast.success(`${rows.length} students exported!`);
      }

      if (type === "fees") {
        const snap = await getDocs(query(collection(db, "fees"), where("schoolId", "==", uid)));
        const rows = snap.docs.map(d => {
          const f = d.data();
          return {
            StudentId:  f.studentId || "—",
            Amount:     f.amount || f.totalAmount || "—",
            Status:     f.status || "—",
            PaidAmount: f.paidAmount || f.collectedAmount || "—",
            DueDate:    f.dueDate || "—",
            PaidAt:     f.paidAt?.toDate?.()?.toLocaleDateString() || "—",
            Branch:     f.branchId || "—",
          };
        });
        if (!downloadCSV(rows, `fees_${new Date().toISOString().slice(0,10)}.csv`)) {
          toast.error("No fee records found.");
          return;
        }
        addAuditLog("data_exported", `Fee records exported (${rows.length} records)`);
        toast.success(`${rows.length} fee records exported!`);
      }

      if (type === "audit") {
        const { fetchAuditLog } = await import("@/lib/auditService");
        const entries = await fetchAuditLog(500);
        const rows = entries.map(e => ({
          Action:    e.action,
          Label:     e.label,
          Details:   e.details || "",
          Timestamp: e.ts?.toDate?.()?.toLocaleString() || "",
        }));
        if (!downloadCSV(rows, `audit_log_${new Date().toISOString().slice(0,10)}.csv`)) {
          toast.error("No audit entries found.");
          return;
        }
        toast.success(`${rows.length} audit entries exported!`);
      }
    } catch (e) {
      console.error("Export error:", e);
      toast.error("Export failed. Check your connection.");
    } finally {
      setExporting(null);
    }
  };

  const set = (key: keyof SchoolSettings, value: any) =>
    setSettings(prev => ({ ...prev, [key]: value }));

  const setNotif = (key: keyof SchoolSettings["notifications"], value: boolean) =>
    setSettings(prev => ({
      ...prev,
      notifications: { ...prev.notifications, [key]: value }
    }));

  const initials = settings.ownerName
    ? settings.ownerName.split(" ").map(w => w[0]).join("").substring(0, 2).toUpperCase()
    : "SC";

  // ── Loading Skeleton ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ ...pageShellStyle, display:"flex", flexDirection:"column", gap: isMobile ? 14 : 18 }}>
        {[1, 2, 3].map(i => (
          <div key={i} style={{ background:"#fff", borderRadius: isMobile ? 16 : 22, border:"0.5px solid rgba(0,85,255,.08)", boxShadow:SHADOW_SM, padding: isMobile ? "18px 18px" : "28px 28px", animation:"pulse 2s ease-in-out infinite" }}>
            <div style={{ height: isMobile ? 12 : 14, width: isMobile ? 110 : 140, background:"rgba(0,85,255,.08)", borderRadius:999, marginBottom: isMobile ? 16 : 22 }}/>
            <div style={{ display:"grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, 1fr)", gap: isMobile ? 12 : 16 }}>
              {[1, 2, 3, 4].map(j => (
                <div key={j} style={{ height: isMobile ? 42 : 46, background:"rgba(0,85,255,.04)", borderRadius:14 }}/>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Count enabled notifications for summary
  const enabledNotifs = Object.values(settings.notifications).filter(Boolean).length;
  const totalNotifs   = Object.keys(settings.notifications).length;

  return (
    <>
      <DashGlobalStyles />
      <div style={{ ...pageShellStyle, display:"flex", flexDirection:"column", gap: isMobile ? 14 : 24 }}>

      <PageHead
        icon={SettingsIcon}
        title="Settings"
        subtitle="Manage your profile and school preferences"
        right={
          saveStatus === "success" ? (
            <div style={{
              display:"inline-flex", alignItems:"center", justifyContent:"center", gap:6,
              padding: isMobile ? "7px 12px" : "8px 14px", borderRadius:12,
              background:"rgba(0,200,83,.10)", color:GREEN, border:`0.5px solid ${GREEN}33`,
              fontSize:10, fontWeight:800, letterSpacing:"0.10em", textTransform:"uppercase",
              width: isMobile ? "100%" : "auto",
            }}>
              <CheckCircle2 size={13}/> Saved
            </div>
          ) : saveStatus === "error" ? (
            <div style={{
              display:"inline-flex", alignItems:"center", justifyContent:"center", gap:6,
              padding: isMobile ? "7px 12px" : "8px 14px", borderRadius:12,
              background:"rgba(255,51,85,.10)", color:RED, border:`0.5px solid ${RED}33`,
              fontSize:10, fontWeight:800, letterSpacing:"0.10em", textTransform:"uppercase",
              width: isMobile ? "100%" : "auto",
            }}>
              <AlertCircle size={13}/> Error
            </div>
          ) : null
        }
      />

      <DarkHero
        icon={SettingsIcon}
        eyebrow={<><Sparkles size={11} style={{ display:"inline", marginRight:4 }}/> Configuration Center</> as any}
        title={settings.schoolName || "Configure"}
        subtitle={`${settings.ownerName ? settings.ownerName + " · " : ""}${enabledNotifs}/${totalNotifs} notifications active · ${settings.timezone.split(" ")[0]}`}
        stats={[
          { label:"Timezone",  value: settings.timezone.match(/\(([^)]+)\)/)?.[1] || "—" },
          { label:"Currency",  value: settings.currency.match(/\(([^)]+)\)/)?.[1] || settings.currency },
          { label:"Language",  value: settings.language.slice(0, 8) },
        ]}
      />

      {/* ── Section 1: Owner Profile ─────────────────────────────────────── */}
      <div className="dash3d bg-white rounded-2xl md:rounded-[32px] border border-slate-100 p-5 md:p-8 lg:p-10" style={{ boxShadow: SHADOW_SM }}>
        <h3 className="text-[11px] md:text-xs font-black text-slate-600 uppercase tracking-[0.2em] mb-5 md:mb-8">Owner Profile</h3>

        {/* Avatar / Logo zone */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 md:gap-6 mb-5 md:mb-8 p-4 md:p-6 bg-slate-50 rounded-xl md:rounded-2xl">
          {/* Logo preview */}
          <div className="relative shrink-0">
            <div className="w-16 h-16 md:w-20 md:h-20 rounded-xl md:rounded-2xl overflow-hidden bg-[#1e294b] flex items-center justify-center shadow-lg">
              {logoPreview ? (
                <img src={logoPreview} alt="School logo" className="w-full h-full object-cover" />
              ) : (
                <span className="text-white text-xl md:text-2xl font-black">{initials}</span>
              )}
            </div>
            {logoUploading && (
              <div className="absolute inset-0 rounded-xl md:rounded-2xl bg-black/40 flex items-center justify-center">
                <Loader2 className="w-5 h-5 md:w-6 md:h-6 text-white animate-spin" />
              </div>
            )}
          </div>

          {/* Info + upload buttons */}
          <div className="flex-1 min-w-0 w-full">
            <p className="text-sm md:text-base font-black text-[#1e293b] truncate">{settings.ownerName || "—"}</p>
            <p className="text-[12px] md:text-sm text-slate-600 font-medium truncate">{settings.email}</p>
            <p className="text-[11px] md:text-xs text-slate-500 mt-0.5 truncate">{settings.schoolName || "School name not set"}</p>
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <input
                ref={logoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleLogoChange}
              />
              <button
                type="button"
                onClick={() => logoInputRef.current?.click()}
                disabled={logoUploading}
                className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3 md:px-4 py-2 rounded-xl bg-white border border-slate-200 text-[11px] md:text-xs font-black text-slate-600 hover:border-blue-300 hover:text-[#1e3a8a] transition-all disabled:opacity-60"
              >
                <Upload className="w-3.5 h-3.5 shrink-0" />
                {logoPreview ? "Change" : "Upload"}
              </button>
              {logoPreview && (
                <button
                  type="button"
                  onClick={handleRemoveLogo}
                  disabled={logoUploading}
                  className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3 md:px-4 py-2 rounded-xl bg-white border border-rose-100 text-[11px] md:text-xs font-black text-rose-500 hover:bg-rose-50 transition-all disabled:opacity-60"
                >
                  <Trash2 className="w-3.5 h-3.5 shrink-0" /> Remove
                </button>
              )}
              <p className="text-[10px] text-slate-500 font-medium w-full sm:w-auto sm:ml-1">PNG/JPG, max 2MB</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
          <Field label="Owner / Chairman Name" icon={User}>
            <input
              type="text"
              value={settings.ownerName}
              onChange={e => set("ownerName", e.target.value)}
              placeholder="Your full name"
              className="w-full h-12 px-4 rounded-2xl border border-slate-100 bg-slate-50 text-sm font-semibold text-[#1e293b] outline-none focus:border-blue-300 focus:bg-white transition-all"
            />
          </Field>

          <Field label="Email Address" icon={Mail}>
            <input
              type="email"
              value={settings.email}
              disabled
              className="w-full h-12 px-4 rounded-2xl border border-slate-100 bg-slate-100 text-sm font-semibold text-slate-600 outline-none cursor-not-allowed"
            />
            <p className="text-[10px] text-slate-600 ml-1">Email cannot be changed here</p>
          </Field>

          <Field label="Phone Number" icon={Phone}>
            <input
              type="tel"
              value={settings.phone}
              onChange={e => set("phone", e.target.value)}
              placeholder="+91 98765 43210"
              className="w-full h-12 px-4 rounded-2xl border border-slate-100 bg-slate-50 text-sm font-semibold text-[#1e293b] outline-none focus:border-blue-300 focus:bg-white transition-all"
            />
          </Field>

          <Field label="School / Institution Name" icon={Building2}>
            <input
              type="text"
              value={settings.schoolName}
              onChange={e => set("schoolName", e.target.value)}
              placeholder="Edullent Academy"
              className="w-full h-12 px-4 rounded-2xl border border-slate-100 bg-slate-50 text-sm font-semibold text-[#1e293b] outline-none focus:border-blue-300 focus:bg-white transition-all"
            />
          </Field>

          <div className="md:col-span-2">
            <Field label="School Address" icon={MapPin}>
              <input
                type="text"
                value={settings.address}
                onChange={e => set("address", e.target.value)}
                placeholder="123 Main Street, City, State - PIN"
                className="w-full h-12 px-4 rounded-2xl border border-slate-100 bg-slate-50 text-sm font-semibold text-[#1e293b] outline-none focus:border-blue-300 focus:bg-white transition-all"
              />
            </Field>
          </div>
        </div>
      </div>


      {/* ── Section 3: Notifications ─────────────────────────────────────── */}
      <div className="dash3d bg-white rounded-2xl md:rounded-[32px] border border-slate-100 p-5 md:p-8 lg:p-10" style={{ boxShadow: SHADOW_SM }}>
        <h3 className="text-[11px] md:text-xs font-black text-slate-600 uppercase tracking-[0.2em] mb-5 md:mb-8">Notification Preferences</h3>
        <div className="space-y-1">
          {[
            {
              key: "criticalAlerts" as const,
              label: "Critical Alerts",
              desc: "Immediate notification for attendance drops, fee defaults, risk events",
              icon: Bell,
            },
            {
              key: "dailySummary" as const,
              label: "Daily Summary",
              desc: "Morning email with key metrics — attendance, fees, pending actions",
              icon: Calendar,
            },
            {
              key: "weeklyReports" as const,
              label: "Weekly Reports",
              desc: "Every Monday — academic health, branch performance, risk trends",
              icon: Clock,
            },
            {
              key: "feeReminders" as const,
              label: "Fee Defaulter Reminders",
              desc: "Alerts when students cross 30/60 day overdue thresholds",
              icon: DollarSign,
            },
          ].map(({ key, label, desc, icon: Icon }) => (
            <div
              key={key}
              className="flex items-center justify-between py-4 md:py-5 border-b border-slate-50 last:border-0 gap-3 md:gap-4"
            >
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                  settings.notifications[key] ? "bg-blue-50" : "bg-slate-50"
                }`}>
                  {settings.notifications[key]
                    ? <Icon className="w-4 h-4 text-[#1e3a8a]" />
                    : <BellOff className="w-4 h-4 text-slate-500" />
                  }
                </div>
                <div className="min-w-0">
                  <p className="text-[13px] md:text-sm font-black text-[#1e293b]">{label}</p>
                  <p className="text-[10px] md:text-[11px] text-slate-600 font-medium mt-0.5 leading-relaxed">{desc}</p>
                </div>
              </div>
              <Toggle
                value={settings.notifications[key]}
                onChange={v => setNotif(key, v)}
              />
            </div>
          ))}
        </div>

      </div>

      {/* ── Section 4: Data Export ───────────────────────────────────────── */}
      <div className="dash3d bg-white rounded-2xl md:rounded-[32px] border border-slate-100 p-5 md:p-8 lg:p-10" style={{ boxShadow: SHADOW_SM }}>
        <h3 className="text-[11px] md:text-xs font-black text-slate-600 uppercase tracking-[0.2em] mb-2">Data Export</h3>
        <p className="text-[11px] md:text-xs text-slate-600 font-medium mb-5 md:mb-8">
          Download your school data as CSV files for compliance, backup, or analysis.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
          {[
            {
              key:     "students" as const,
              label:   "Students List",
              desc:    "All enrolled students with branch & grade info",
              icon:    FileText,
              color:   "bg-blue-50 border-blue-100 text-blue-600",
              btnColor: "bg-[#1e3a8a] hover:bg-blue-900 text-white",
            },
            {
              key:     "fees" as const,
              label:   "Fee Records",
              desc:    "All fee transactions — paid, pending, overdue",
              icon:    DollarSign,
              color:   "bg-emerald-50 border-emerald-100 text-emerald-600",
              btnColor: "bg-emerald-600 hover:bg-emerald-700 text-white",
            },
            {
              key:     "audit" as const,
              label:   "Audit Log",
              desc:    "Complete activity trail with timestamps",
              icon:    Activity,
              color:   "bg-purple-50 border-purple-100 text-purple-600",
              btnColor: "bg-purple-600 hover:bg-purple-700 text-white",
            },
          ].map(item => {
            const Icon = item.icon;
            return (
              <div key={item.key} className={`rounded-xl md:rounded-2xl border p-4 md:p-6 space-y-3 md:space-y-4 ${item.color}`}>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 md:w-10 md:h-10 rounded-xl bg-white/60 flex items-center justify-center shrink-0">
                    <Icon className="w-4 h-4 md:w-5 md:h-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[13px] md:text-sm font-black text-[#1e294b] truncate">{item.label}</p>
                    <p className="text-[10px] md:text-[11px] font-medium opacity-70 leading-snug">{item.desc}</p>
                  </div>
                </div>
                <button
                  onClick={() => handleExport(item.key)}
                  disabled={exporting === item.key}
                  className={`w-full h-11 md:h-10 rounded-xl text-[11px] md:text-xs font-bold flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-60 shadow-sm ${item.btnColor}`}
                >
                  {exporting === item.key
                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Exporting...</>
                    : <><Download className="w-3.5 h-3.5" /> Export CSV</>
                  }
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Section 5: Risk Thresholds ───────────────────────────────────── */}
      <div className="dash3d bg-white rounded-2xl md:rounded-[32px] border border-slate-100 p-5 md:p-8 lg:p-10" style={{ boxShadow: SHADOW_SM }}>
        <h3 className="text-[11px] md:text-xs font-black text-slate-600 uppercase tracking-[0.2em] mb-2">Risk Alert Thresholds</h3>
        <p className="text-[11px] md:text-xs text-slate-600 font-medium mb-5 md:mb-8">
          Customize when students are flagged as at-risk. These thresholds power the Risks &amp; Alerts page.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-600 uppercase tracking-widest block">
              Attendance Critical (%)
            </label>
            <p className="text-[11px] text-slate-600 font-medium">Below this = Critical alert</p>
            <div className="relative">
              <input
                type="number"
                min={30} max={90}
                value={settings.thresholds.attendanceCritical}
                onChange={e => setSettings(prev => ({
                  ...prev,
                  thresholds: { ...prev.thresholds, attendanceCritical: Math.min(90, Math.max(30, parseInt(e.target.value) || 65)) }
                }))}
                className="w-full h-12 rounded-xl bg-slate-50 border border-slate-100 pl-4 pr-14 text-sm font-bold text-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-100 focus:border-rose-200 transition-all"
              />
              <span className="pointer-events-none absolute right-8 top-1/2 -translate-y-1/2 text-xs font-black text-slate-600">%</span>
            </div>
          </div>
          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-600 uppercase tracking-widest block">
              Attendance Warning (%)
            </label>
            <p className="text-[11px] text-slate-600 font-medium">Below this = Warning alert</p>
            <div className="relative">
              <input
                type="number"
                min={50} max={95}
                value={settings.thresholds.attendanceWarning}
                onChange={e => setSettings(prev => ({
                  ...prev,
                  thresholds: { ...prev.thresholds, attendanceWarning: Math.min(95, Math.max(50, parseInt(e.target.value) || 80)) }
                }))}
                className="w-full h-12 rounded-xl bg-slate-50 border border-slate-100 pl-4 pr-14 text-sm font-bold text-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-100 focus:border-amber-200 transition-all"
              />
              <span className="pointer-events-none absolute right-8 top-1/2 -translate-y-1/2 text-xs font-black text-slate-600">%</span>
            </div>
          </div>
          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-600 uppercase tracking-widest block">
              Fee Overdue Days
            </label>
            <p className="text-[11px] text-slate-600 font-medium">Days before marking fee overdue</p>
            <div className="relative">
              <input
                type="number"
                min={7} max={90}
                value={settings.thresholds.feeOverdueDays}
                onChange={e => setSettings(prev => ({
                  ...prev,
                  thresholds: { ...prev.thresholds, feeOverdueDays: Math.min(90, Math.max(7, parseInt(e.target.value) || 30)) }
                }))}
                className="w-full h-12 rounded-xl bg-slate-50 border border-slate-100 pl-4 pr-20 text-sm font-bold text-[#1e3a8a] focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-200 transition-all"
              />
              <span className="pointer-events-none absolute right-8 top-1/2 -translate-y-1/2 text-xs font-black text-slate-600">days</span>
            </div>
          </div>
        </div>
        <div className="mt-5 md:mt-6 p-3 md:p-4 rounded-xl bg-blue-50 border border-blue-100 flex items-start gap-2 md:gap-3">
          <span className="text-sm md:text-base shrink-0">💡</span>
          <p className="text-[11px] md:text-xs text-blue-700 font-medium leading-relaxed">
            Default: Critical &lt; {DEFAULT_THRESHOLDS.attendanceCritical}%, Warning &lt; {DEFAULT_THRESHOLDS.attendanceWarning}%, Fee overdue after {DEFAULT_THRESHOLDS.feeOverdueDays} days.
            Changes take effect on next risks calculation.
          </p>
        </div>
      </div>

      {/* ── Save Bar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 md:gap-4 pt-2 pb-4 md:pb-8">
        <div className="min-h-[32px] flex items-center justify-center sm:justify-start">
          {saveStatus === "success" && (
            <div className="flex items-center gap-2 text-emerald-600 text-[12px] md:text-sm font-bold animate-in fade-in">
              <CheckCircle2 className="w-4 h-4" /> Settings saved successfully
            </div>
          )}
          {saveStatus === "error" && (
            <div className="flex items-center gap-2 text-rose-500 text-[12px] md:text-sm font-bold animate-in fade-in">
              <AlertCircle className="w-4 h-4" /> Save failed — check your connection
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 md:gap-3">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="flex-1 sm:flex-initial h-11 md:h-auto px-5 md:px-6 py-0 md:py-3 rounded-xl md:rounded-2xl text-[11px] md:text-xs font-black uppercase tracking-widest text-slate-500 hover:text-[#1e3a8a] border border-slate-200 md:border-0 hover:bg-slate-50 transition-all"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || logoUploading}
            className="flex-[2] sm:flex-initial h-11 md:h-auto flex items-center justify-center gap-2 px-5 md:px-8 py-0 md:py-3 rounded-xl md:rounded-2xl bg-[#1e294b] text-white text-[11px] md:text-xs font-black uppercase tracking-widest shadow-lg shadow-slate-900/10 hover:bg-[#1e3a8a] transition-all active:scale-95 disabled:opacity-60 disabled:scale-100"
          >
            {saving
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
              : <><Save className="w-4 h-4" /> Save Changes</>
            }
          </button>
        </div>
      </div>

      <AIInsightCard
        title="Settings Intelligence"
        items={[
          { label:"Profile Setup", value: settings.schoolName && settings.ownerName ? "Complete" : "Incomplete", sub: settings.logoUrl ? "Logo uploaded" : "No logo yet" },
          { label:"Notifications", value: `${enabledNotifs}/${totalNotifs} enabled`, sub: settings.notifications.whatsappAlerts ? "WhatsApp active" : "Email only" },
          { label:"Risk Thresholds", value: `${settings.thresholds.attendanceCritical}% / ${settings.thresholds.attendanceWarning}%`, sub: `${settings.thresholds.feeOverdueDays}d fee window` },
        ]}
      />

      {/* Danger zone — Play Store data-deletion compliance surface. The
          actual self-serve form lives at the public /delete-account route
          so logged-out users (and Play reviewers) can reach it too. */}
      <div
        style={{
          marginTop: 18,
          background: "#fff",
          borderRadius: 16,
          padding: "20px 22px",
          border: "1px solid rgba(220,38,38,0.20)",
          borderLeft: "3px solid #DC2626",
          boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 8px 32px rgba(0,16,64,0.06)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <AlertCircle size={16} color="#DC2626" />
          <h3 style={{ fontSize: 13, fontWeight: 800, color: "#7F1D1D", margin: 0, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Danger Zone
          </h3>
        </div>
        <p style={{ fontSize: 13, color: "#475569", lineHeight: 1.6, margin: "0 0 14px" }}>
          Permanently delete your Edullent Owner account and all associated
          school data. Processed manually within 7 business days. This
          action cannot be undone.
        </p>
        <a
          href="/delete-account"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 18px",
            borderRadius: 10,
            background: "linear-gradient(135deg, #DC2626, #EF4444)",
            color: "#fff",
            fontSize: 12,
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            textDecoration: "none",
            boxShadow: "0 6px 18px rgba(220,38,38,0.22)",
          }}
        >
          <Trash2 size={14} /> Delete Account
        </a>
      </div>
      </div>
    </>
  );
}
