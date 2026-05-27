import { useEffect, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import {
  ArrowLeft, GraduationCap, Calendar, MapPin, CheckCircle2, Circle, Loader2,
  ChevronRight, Clock, UserCheck, X, AlertTriangle,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import { Button } from "@/components/ui/button";
import { fetchAlertDetail, resolveAlert, AlertDetailData } from "@/lib/risksService";
import { addAuditLog } from "@/lib/auditService";
import { toast } from "sonner";
import { tilt3D, tilt3DStyle } from "@/lib/use3DTilt";

export default function AlertDetailPage() {
  const { id }     = useParams<{ id: string }>();
  const navigate   = useNavigate();
  const location   = useLocation();
  /* Smart back: if user landed on this page directly (notification deep-link,
     bookmark, refresh) location.key is "default" and navigate(-1) would leave
     the SPA — fall back to /risks. If they came in via in-app navigation,
     location.key is unique and navigate(-1) preserves their breadcrumb. */
  const goBack = () => {
    if (location.key !== 'default') navigate(-1);
    else navigate('/risks');
  };
  const [data, setData]           = useState<AlertDetailData | null>(null);
  const [loading, setLoading]     = useState(true);
  const [acting, setActing]       = useState<string | null>(null);
  const [showAssign, setShowAssign] = useState(false);
  const [assigneeName, setAssigneeName] = useState("");
  /* Local UI feedback for acknowledge/assign actions. Resolve navigates away
     so doesn't need this. Without it, the toast confirms success but the page
     header still says "Critical" with no trace of what just happened — user
     wonders if the click registered. */
  const [actedState, setActedState] = useState<{ action: 'acknowledged' | 'assigned'; assignee?: string } | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetchAlertDetail(id)
      .then(setData)
      .catch(err => {
        console.error(err);
        toast.error("Failed to load alert details.");
      })
      .finally(() => setLoading(false));
  }, [id]);

  const handleAction = async (action: "resolved" | "acknowledged", label: string) => {
    if (!id) return;
    setActing(action);
    try {
      await resolveAlert(id, action);
      addAuditLog(
        action === "resolved" ? "alert_resolved" : "alert_acknowledged",
        `Alert ${action}: ${data?.title || id}`,
        data?.branchName,
      );
      toast.success(`Alert ${label} successfully.`);
      if (action === "resolved") {
        navigate("/risks");
      } else if (action === "acknowledged") {
        setActedState({ action: 'acknowledged' });
      }
    } catch {
      toast.error("Action failed. Please try again.");
    } finally {
      setActing(null);
    }
  };

  const handleAssign = async () => {
    if (!id || !assigneeName.trim()) return;
    setActing("assigned");
    try {
      await resolveAlert(id, "assigned", assigneeName.trim());
      addAuditLog("alert_assigned", `Alert assigned to ${assigneeName.trim()}: ${data?.title || id}`, data?.branchName);
      toast.success(`Alert assigned to ${assigneeName.trim()}.`);
      setActedState({ action: 'assigned', assignee: assigneeName.trim() });
      setShowAssign(false);
      setAssigneeName("");
    } catch {
      toast.error("Assignment failed. Please try again.");
    } finally {
      setActing(null);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-[70vh] gap-4">
        <Loader2 className="w-10 h-10 animate-spin text-[#1e3a8a]" />
        <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Loading Alert Details...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-[70vh] gap-4">
        <p className="text-sm font-bold text-slate-400">Alert not found.</p>
        <Button variant="outline" onClick={() => navigate("/risks")}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Risks
        </Button>
      </div>
    );
  }

  const isCritical = data.type === "critical";
  const accentColor = isCritical ? "#ef4444" : data.type === "warning" ? "#f59e0b" : "#0ea5e9";
  const bgClass    = isCritical ? "bg-[#fef2f2]" : "bg-[#fffbeb]";

  // Check if trend has any real data
  const hasTrendData = data.trend.some(t => t.pct > 0);

  return (
    <div className="space-y-8 max-w-[1400px] mx-auto animate-in fade-in duration-500 pb-16">

      {/* ── Breadcrumb ───────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 text-xs text-slate-400 font-medium">
        <button onClick={() => navigate("/risks")} className="hover:text-slate-600 transition-colors">
          Risks &amp; Alerts
        </button>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-slate-600">Alert Details</span>
      </div>

      {/* ── Header Card ─────────────────────────────────────────────────────── */}
      <div {...tilt3D} style={tilt3DStyle} className="bg-white rounded-[2rem] border border-slate-100 p-5 sm:p-8 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-8">
          {/* Back + icon + title */}
          <div className="flex items-start gap-6">
            <button
              onClick={goBack}
              className="mt-1 p-2 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors shrink-0"
              aria-label="Back"
            >
              <ArrowLeft className="w-5 h-5 text-slate-500" />
            </button>
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center text-white shrink-0 shadow-lg"
              style={{ backgroundColor: accentColor }}
            >
              <GraduationCap className="w-8 h-8" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-3 mb-2">
                <h1 className="text-2xl lg:text-3xl font-black text-[#1e294b] tracking-tight">{data.title}</h1>
                <span
                  className="px-3 py-1 rounded-md text-[9px] font-black uppercase tracking-widest text-white"
                  style={{ backgroundColor: accentColor }}
                >
                  {data.status}
                </span>
                {actedState && (
                  <span className="px-3 py-1 rounded-md text-[9px] font-black uppercase tracking-widest bg-emerald-500 text-white">
                    {actedState.action === 'acknowledged'
                      ? '✓ Acknowledged'
                      : `Assigned: ${actedState.assignee}`}
                  </span>
                )}
                <div className="px-3 py-1 rounded-md border border-slate-100 bg-slate-50 text-slate-400 text-[9px] font-bold">
                  Alert #{data.alertNum}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-slate-400 text-[11px] font-bold">
                <span className="flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5" /> Detected on {data.detectedOn}
                </span>
                <span className="text-slate-200">|</span>
                <span className="flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5" /> {data.branchName}
                </span>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-3 shrink-0">
            <Button
              variant="outline"
              disabled={!!acting}
              onClick={() => handleAction("acknowledged", "acknowledged")}
              className="h-11 px-6 rounded-xl border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50"
            >
              {acting === "acknowledged" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Acknowledge"}
            </Button>
            <Button
              disabled={!!acting}
              onClick={() => setShowAssign(true)}
              className="h-11 px-6 rounded-xl bg-[#1e3a8a] text-white text-xs font-bold hover:bg-blue-900 shadow-lg shadow-blue-900/10"
            >
              {acting === "assigned" ? <Loader2 className="w-4 h-4 animate-spin" /> : <><UserCheck className="w-4 h-4 mr-1.5" />Assign</>}
            </Button>
            <Button
              disabled={!!acting}
              onClick={() => handleAction("resolved", "resolved")}
              className="h-11 px-6 rounded-xl bg-[#10b981] text-white text-xs font-bold hover:bg-emerald-600 shadow-lg shadow-emerald-900/10"
            >
              {acting === "resolved" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Resolve"}
            </Button>
          </div>
        </div>
      </div>

      {/* ── Mapping issue banner ─────────────────────────────────────────────
          Surfaced when overview generated this alert (so the branch DOES have
          risk) but our resolution chain found zero students attributable to
          the branch. Without the banner the user sees an honest-but-confusing
          empty page and assumes the branch is healthy. */}
      {data.mappingIssue && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:p-5 flex items-start gap-3">
          <div className="shrink-0 w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-amber-900 mb-1">Student-branch mapping issue</p>
            <p className="text-xs text-amber-700 leading-relaxed">
              The overview reports risk in <span className="font-semibold">{data.branchName}</span>,
              but no students from your <span className="font-semibold">{data.mappingIssue.totalSchoolStudents}</span> total
              could be resolved to this branch. Counts on this page may be incomplete — check that
              your students have a <code className="px-1 py-0.5 rounded bg-amber-100 text-amber-800 font-mono text-[10px]">branchId</code> field
              matching this branch's ID.
            </p>
          </div>
        </div>
      )}

      {/* ── Metrics Row ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {data.metrics.map((m, i) => (
          <div key={i} {...tilt3D} className={`${bgClass}/50 border p-5 sm:p-8 rounded-[1.5rem]`}
            style={{ borderColor: isCritical ? "#fecaca" : "#fde68a", ...tilt3DStyle }}>
            <p className="text-slate-400 text-[11px] font-bold uppercase tracking-tight mb-4">{m.label}</p>
            <h3 className={`text-4xl font-black tracking-tighter mb-2 ${m.color}`}>{m.value}</h3>
            <p className="text-[11px] font-bold" style={{ color: accentColor }}>{m.note}</p>
          </div>
        ))}
      </div>

      {/* ── Issue Description ────────────────────────────────────────────────── */}
      <div {...tilt3D} style={tilt3DStyle} className="bg-white rounded-[1.5rem] border border-slate-100 p-5 sm:p-8">
        <h4 className="text-lg font-bold text-[#1e294b] mb-4">Issue Description</h4>
        <p className="text-slate-600 text-sm leading-relaxed max-w-4xl">{data.description}</p>
      </div>

      {/* ── Chart + Affected Students ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Trend (attendance daily / academic weekly — driven by data.kind) */}
        <div {...tilt3D} style={tilt3DStyle} className="lg:col-span-7 bg-white p-5 sm:p-8 rounded-[1.5rem] border border-slate-100">
          <h4 className="text-base font-bold text-[#1e294b] mb-8">{data.trendLabel}</h4>
          {hasTrendData ? (
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.trend} margin={{ left: -20, right: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="day" axisLine={false} tickLine={false}
                    tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: "bold" }} dy={10} />
                  {/* Academic scores can dip below 50 — full [0,100] axis. Attendance
                      stays in the [50,100] band so a tighter axis reads better there. */}
                  <YAxis
                    domain={data.kind === 'academic' ? [0, 100] : [50, 100]}
                    axisLine={false} tickLine={false}
                    tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: "bold" }}
                    ticks={data.kind === 'academic' ? [0, 25, 50, 75, 100] : [50, 60, 70, 80, 90, 100]} />
                  <Tooltip contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)" }} />
                  <ReferenceLine y={data.baseline} stroke="#10b981" strokeDasharray="5 5"
                    label={{ value: data.baselineLabel, position: "right", fill: "#10b981", fontSize: 10, fontWeight: "bold" }} />
                  <Line type="monotone" dataKey="pct" name={data.kind === 'academic' ? "Avg Score %" : "Attendance %"}
                    stroke={accentColor} strokeWidth={3}
                    dot={{ r: 4, fill: accentColor, strokeWidth: 1.5, stroke: "#fff" }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-[250px] flex flex-col items-center justify-center border border-dashed border-slate-200 rounded-xl gap-2">
              <p className="text-sm text-slate-400 font-semibold">
                {data.kind === 'academic' ? "No recent test-score data found"
                  : data.kind === 'fees'     ? "Trend view not applicable for fee alerts"
                  : data.kind === 'teachers' ? "Trend view not applicable for teacher alerts"
                  : "No daily attendance data found"}
              </p>
              <p className="text-xs text-slate-300">
                {data.kind === 'academic'
                  ? "Trend appears once tests are recorded over the last 4 weeks"
                  : data.kind === 'fees'
                    ? "See defaulter list on the right for affected students + amounts"
                    : data.kind === 'teachers'
                      ? "See affected list on the right for teachers and days-idle"
                      : "Trend appears once attendance is recorded per day"}
              </p>
            </div>
          )}
        </div>

        {/* Affected list — heading + empty state both flex by alert kind:
            students for attendance/academic/fees, teachers for inactive-teacher.
            The data shape is the same (initials/name/pct/color); only the
            human-readable label changes. */}
        <div {...tilt3D} style={tilt3DStyle} className="lg:col-span-5 bg-white p-8 rounded-[1.5rem] border border-slate-100">
          <h4 className="text-base font-bold text-[#1e294b] mb-6">
            {data.kind === 'teachers' ? "Inactive Teachers"
              : data.kind === 'fees'  ? "Defaulter Students"
              : "Affected Students"}
            {data.affectedStudents.length > 0 && (
              <span className="ml-2 text-xs font-bold text-slate-400">{data.affectedSubtitle}</span>
            )}
          </h4>
          {data.affectedStudents.length === 0 ? (
            <div className="h-[200px] flex flex-col items-center justify-center gap-2">
              <CheckCircle2 className="w-10 h-10 text-emerald-400 opacity-40" />
              <p className="text-sm font-bold text-slate-400">
                {data.kind === 'teachers' ? "No inactive teachers found"
                  : data.kind === 'fees'  ? "No fee defaulters resolved"
                  : "No at-risk students found"}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {data.affectedStudents.map((s, idx) => (
                <div key={idx}
                  className="flex items-center justify-between p-3.5 rounded-xl bg-slate-50/50 hover:bg-slate-50 transition-colors border border-transparent hover:border-slate-100">
                  <div className="flex items-center gap-4">
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-white text-[11px] font-black shrink-0"
                      style={{ backgroundColor: s.color }}
                    >
                      {s.initials}
                    </div>
                    <span className="text-sm font-bold text-[#1e294b]">{s.name}</span>
                  </div>
                  <span className="text-sm font-black" style={{ color: s.color }}>{s.pct}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Actions + Historical ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recommended Actions */}
        <div {...tilt3D} style={tilt3DStyle} className="bg-white p-5 sm:p-10 rounded-[2rem] border border-slate-100 shadow-sm">
          <h4 className="text-lg font-bold text-[#1e294b] mb-10">Recommended Actions</h4>
          <div className="space-y-6">
            {data.actions.map((action, i) => (
              <div key={i} className="flex items-start gap-5 group">
                <div className={`mt-1 shrink-0 ${action.done ? "text-[#10b981]" : "text-slate-300"}`}>
                  {action.done
                    ? <CheckCircle2 className="w-6 h-6 fill-emerald-50" />
                    : <Circle className="w-6 h-6" />}
                </div>
                <div className="flex-1 pb-6 border-b border-slate-50 group-last:border-none">
                  <p className={`text-[15px] font-bold leading-none mb-2 ${action.done ? "text-slate-800" : "text-slate-500"}`}>
                    {action.title}
                  </p>
                  <p className="text-slate-400 text-[11px] font-medium tracking-tight uppercase">{action.sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Similar Historical Alerts */}
        <div {...tilt3D} style={tilt3DStyle} className="bg-white p-5 sm:p-10 rounded-[2rem] border border-slate-100 shadow-sm flex flex-col gap-6">
          <h4 className="text-lg font-bold text-[#1e294b]">Similar Historical Alerts</h4>

          {data.historicalAlerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2">
              <Clock className="w-8 h-8 text-slate-200" />
              <p className="text-sm text-slate-400 font-medium">No historical alerts yet</p>
              <p className="text-xs text-slate-300">Resolved alerts will appear here</p>
            </div>
          ) : (
            <div className="space-y-3">
              {data.historicalAlerts.map((h, i) => (
                <div key={i} className="flex items-start justify-between p-4 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors border border-slate-100">
                  <div>
                    <p className="text-sm font-semibold text-[#1e294b] mb-1">{h.title}</p>
                    <p className="text-xs text-slate-400">
                      {[h.period, h.branch, h.resolvedIn].filter(Boolean).join(" • ")}
                    </p>
                  </div>
                  <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-emerald-100 text-emerald-600 shrink-0 ml-3">
                    {h.status}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Summary footer */}
          <div className={`p-4 rounded-xl text-sm font-medium leading-relaxed ${bgClass} border`}
            style={{ borderColor: isCritical ? "#fecaca" : "#fde68a", color: accentColor }}>
            {isCritical
              ? "⚠️ Immediate attention required. Take action as soon as possible."
              : "ℹ️ Monitor closely and take preventive action to avoid escalation."}
          </div>
        </div>
      </div>

      {/* ── Assign Modal ─────────────────────────────────────────────────────── */}
      {showAssign && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-bold text-[#1e294b]">Assign Alert</h3>
              <button onClick={() => setShowAssign(false)} className="p-1.5 rounded-lg hover:bg-slate-100">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              Enter the name of the principal or staff member to assign this alert to.
            </p>
            <input
              type="text"
              value={assigneeName}
              onChange={e => setAssigneeName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleAssign()}
              placeholder="e.g. Priya Sharma"
              autoFocus
              className="w-full h-11 px-4 rounded-xl border border-slate-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#1e3a8a]/30 mb-4"
            />
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => setShowAssign(false)}
                className="flex-1 h-10 rounded-xl text-xs font-bold"
              >
                Cancel
              </Button>
              <Button
                disabled={!assigneeName.trim() || acting === "assigned"}
                onClick={handleAssign}
                className="flex-1 h-10 rounded-xl bg-[#1e3a8a] text-white text-xs font-bold hover:bg-blue-900"
              >
                {acting === "assigned" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Assign"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
