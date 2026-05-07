import { useEffect, useMemo, useState, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Printer, MessageSquare, AlertCircle, Loader2, ChevronLeft, ChevronRight, CheckCircle2, FileText, BookOpen, Calendar, TrendingUp, BarChart3, Activity, Star, Lightbulb } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, RadarChart, PolarGrid, PolarAngleAxis, Radar } from "recharts";
import { doc, getDoc, collection, query, where, getDocs } from "firebase/firestore";
import { db, auth } from "@/lib/firebase";
import { useIsMobile } from "@/hooks/use-mobile";
import { tilt3D, tilt3DStyle } from "@/lib/use3DTilt";
import { toast } from "sonner";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

// ── Tokens ───────────────────────────────────────────────────────────────────
const T = {
  bg: "#EEF4FF", white: "#ffffff", ink: "#0f172a", ink2: "#475569", ink3: "#94a3b8",
  bdr: "#e2e8f0", s1: "#f1f5f9", s2: "#e2e8f0",
  blue: "#3B5BDB", blBg: "#EDF2FF", blBdr: "#BAC8FF",
  grn: "#16a34a", glBg: "#f0fdf4", red: "#dc2626", rlBg: "#fef2f2",
  amb: "#d97706", alBg: "#fffbeb", pur: "#7c3aed",
};

const toDate = (v: any): Date | null => { if (!v) return null; if (v?.toDate) return v.toDate(); if (v?.seconds) return new Date(v.seconds * 1000); const d = new Date(v); return isNaN(d.getTime()) ? null : d; };
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const timeAgo = (v: any) => { const d = toDate(v); if (!d) return ""; const s = (Date.now() - d.getTime()) / 1000; if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase(); };

/* Dashboard 4-card vibe — pastel grad + solid icon badge top-left + faded
   decorative icon bottom-right + tilt3D. Same visual language used across
   Dashboard.tsx and BranchesComparison cards so the whole Owner experience
   feels like one product, not several.

   `staticTilt` is read from the StudentProfile component scope (closure on
   exporting state) — when exporting, tilt3D handlers + style are skipped so
   html2canvas captures a clean upright snapshot. */
const Card = ({
  children,
  title,
  action,
  icon: IconCmp,
  accent = "#3B5BDB",
  style,
  staticTilt = false,
}: {
  children: React.ReactNode;
  title?: string;
  action?: React.ReactNode;
  icon?: any;             // Lucide icon component (optional — when set, badge appears)
  accent?: string;        // Hex color driving pastel bg + badge tint (default brand blue)
  style?: React.CSSProperties;
  staticTilt?: boolean;   // when true, skip tilt3D handlers/transform (export-friendly)
}) => {
  return (
    <div
      {...(staticTilt ? {} : tilt3D)}
      style={{
        /* Branded color tinted at ~12% over near-white (matches BranchesComparison
           card recipe). `${accent}1F` = hex alpha 0x1F (~12%). */
        background: `linear-gradient(135deg, #FAFCFF 0%, #F5F9FF 55%, ${accent}1F 100%)`,
        border: `0.5px solid ${accent}33`,
        borderRadius: 16,
        boxShadow: "0 4px 8px rgba(0,85,255,0.10), 0 12px 24px rgba(0,85,255,0.12), 0 28px 56px rgba(0,85,255,0.14)",
        position: "relative",
        overflow: "hidden",
        willChange: "transform",
        ...(staticTilt ? {} : tilt3DStyle),
        ...style,
      }}
    >
      {/* Decorative faded icon — bottom-right (Dashboard pattern) */}
      {IconCmp && (
        <div style={{
          position: "absolute",
          bottom: 14,
          right: 18,
          color: accent,
          opacity: 0.10,
          pointerEvents: "none",
          lineHeight: 0,
          zIndex: 1,
        }}>
          <IconCmp size={64} strokeWidth={1.8} />
        </div>
      )}

      {title && (
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 18px",
          borderBottom: `1px solid rgba(255,255,255,0.5)`,
          position: "relative",
          zIndex: 2,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            {IconCmp && (
              <div style={{
                width: 30,
                height: 30,
                borderRadius: 9,
                background: accent,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: `0 4px 10px ${accent}44`,
                flexShrink: 0,
              }}>
                <IconCmp size={15} color="#FFFFFF" strokeWidth={2.5} />
              </div>
            )}
            <span style={{
              fontSize: 14,
              fontWeight: 700,
              color: T.ink,
              letterSpacing: "-0.2px",
            }}>{title}</span>
          </div>
          {action || null}
        </div>
      )}
      <div style={{ padding: "16px 18px", position: "relative", zIndex: 2 }}>{children}</div>
    </div>
  );
};

const DetailLink = () => <span style={{ fontSize: 11, color: T.blue, fontWeight: 500, cursor: "pointer" }}>Details →</span>;

// ═══════════════════════════════════════════════════════════════════════════════
// OWNER STUDENT PROFILE — canonical design (matches principal/teacher/parent)
// ═══════════════════════════════════════════════════════════════════════════════
const StudentProfile = () => {
  const { id: studentId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const realIsMobile = useIsMobile();
  /* `forceMobile` lets the export flow render the page in mobile layout
     (single-column, smaller paddings, narrower hero) regardless of the
     Owner's actual viewport. This way a desktop Owner clicking Export still
     gets a portrait, mobile-styled PDF — easier to read on phone, cleaner
     2-page layout. We OR it with the live media-query result so a real
     mobile user behaves the same. */
  const [forceMobile, setForceMobile] = useState(false);
  const isMobile = forceMobile || realIsMobile;
  /* Disable tilt3D during export — the transform causes html2canvas to
     capture a tilted snapshot or skew text rendering. */
  const [exporting, setExporting] = useState(false);
  /* Container we hand to html2canvas. Wraps the entire profile body so the
     snapshot includes hero + every card + status bar. */
  const exportRef = useRef<HTMLDivElement>(null);

  const [loading, setLoading] = useState(true);
  const [student, setStudent] = useState<any>(null);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [testScores, setTestScores] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [incidents, setIncidents] = useState<any[]>([]);
  const [parentNotes, setParentNotes] = useState<any[]>([]);
  const [interventions, setInterventions] = useState<any[]>([]);
  // Teacher-side behaviour signals — synced from teacher dashboard's
  // StudentBehaviour page. Same Firestore source of truth as parent /
  // principal views, so an owner sees the exact same picture.
  const [studentRatings, setStudentRatings] = useState<any[]>([]);
  const [improvementAreas, setImprovementAreas] = useState<any[]>([]);
  const [calMonth, setCalMonth] = useState(new Date());
  /* Live clock for the bottom status bar. Was rendering Date.now() once at
     mount and never updating — visually a static timestamp pretending to be
     a clock. 1-second tick is fine on a profile page. */
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // ── Fetch — owner's schoolId == their uid ─────────────────────────────────
  useEffect(() => {
    if (!studentId) { setLoading(false); return; }
    const schoolId = auth.currentUser?.uid;
    if (!schoolId) return;

    const run = async () => {
      setLoading(true);
      try {
        const decoded = decodeURIComponent(studentId);
        let sd: any = null;
        let resolvedSid = decoded;
        let resolvedEmail = "";

        // Try 1: students/{decoded}
        try {
          const snap = await getDoc(doc(db, "students", decoded));
          if (snap.exists()) {
            sd = { id: snap.id, ...snap.data() };
            resolvedSid = snap.id;
            resolvedEmail = (sd.email || sd.studentEmail || "").toLowerCase();
          }
        } catch {}

        // Try 2: enrollments where studentId == decoded OR studentEmail == decoded
        if (!sd) {
          const isEmail = decoded.includes("@");
          const [byIdSnap, byEmailSnap] = await Promise.all([
            getDocs(query(
              collection(db, "enrollments"),
              where("schoolId", "==", schoolId),
              where("studentId", "==", decoded),
            )).catch(() => null),
            isEmail ? getDocs(query(
              collection(db, "enrollments"),
              where("schoolId", "==", schoolId),
              where("studentEmail", "==", decoded.toLowerCase()),
            )).catch(() => null) : Promise.resolve(null),
          ]);
          const enrDoc = byIdSnap?.docs[0] || byEmailSnap?.docs[0];
          if (enrDoc) {
            const e = enrDoc.data() as any;
            resolvedSid = e.studentId || decoded;
            resolvedEmail = (e.studentEmail || (isEmail ? decoded.toLowerCase() : "")).toLowerCase();
            sd = {
              id: resolvedSid,
              name: e.studentName || e.name || "Student",
              studentName: e.studentName || e.name,
              email: resolvedEmail,
              studentEmail: resolvedEmail,
              classId: e.classId,
              className: e.className || e.class || e.grade,
              class: e.class || e.grade,
              rollNo: e.rollNo || e.roll,
              roll: e.roll,
              grade: e.grade || e.class,
              branchId: e.branchId,
              schoolName: e.schoolName,
            };
          }
        }

        // Try 3: enrollment doc id (last resort)
        if (!sd) {
          try {
            const enrSnap = await getDoc(doc(db, "enrollments", decoded));
            if (enrSnap.exists()) {
              const e = enrSnap.data() as any;
              resolvedSid = e.studentId || decoded;
              resolvedEmail = (e.studentEmail || "").toLowerCase();
              sd = {
                id: resolvedSid,
                name: e.studentName || e.name || "Student",
                studentName: e.studentName || e.name,
                email: resolvedEmail,
                studentEmail: resolvedEmail,
                classId: e.classId,
                className: e.className || e.class || e.grade,
                class: e.class || e.grade,
                rollNo: e.rollNo || e.roll,
                roll: e.roll,
                grade: e.grade || e.class,
                branchId: e.branchId,
                schoolName: e.schoolName,
              };
            }
          } catch {}
        }

        if (!sd) { setLoading(false); return; }
        setStudent(sd);

        const byId = (col: string) => getDocs(query(
          collection(db, col),
          where("schoolId", "==", schoolId),
          where("studentId", "==", resolvedSid),
        )).catch(() => null);
        const byEmail = (col: string) => resolvedEmail ? getDocs(query(
          collection(db, col),
          where("schoolId", "==", schoolId),
          where("studentEmail", "==", resolvedEmail),
        )).catch(() => null) : Promise.resolve(null as any);
        const merge = (a: any, b: any) => { const l: any[] = []; if (a) a.docs.forEach((d: any) => l.push({ id: d.id, ...d.data() })); if (b) b.docs.forEach((d: any) => { if (!l.find(x => x.id === d.id)) l.push({ id: d.id, ...d.data() }); }); return l; };

        /* Extend dual-query (byId + byEmail) to incidents / parent_notes /
           interventions per `dual_query_pattern_studentid_email` memory rule.
           Some Teacher Dashboard writers key by studentEmail; without merging
           both keys, those records would be invisible in this view. */
        const [aI, aE, sI, sE, rI, rE, subI, subE, incI, incE, pnI, pnE, ivI, ivE, srI, srE, imI, imE] = await Promise.all([
          byId("attendance"),         byEmail("attendance"),
          byId("test_scores"),        byEmail("test_scores"),
          byId("results"),            byEmail("results"),
          byId("submissions"),        byEmail("submissions"),
          byId("incidents"),          byEmail("incidents"),
          byId("parent_notes"),       byEmail("parent_notes"),
          byId("interventions"),      byEmail("interventions"),
          byId("student_ratings"),    byEmail("student_ratings"),
          byId("improvement_areas"),  byEmail("improvement_areas"),
        ]);
        setAttendance(merge(aI, aE));
        setTestScores([...merge(sI, sE), ...merge(rI, rE)]);
        setSubmissions(merge(subI, subE));
        setIncidents(merge(incI, incE));
        setParentNotes(merge(pnI, pnE));
        setInterventions(merge(ivI, ivE));
        setStudentRatings(merge(srI, srE));
        setImprovementAreas(merge(imI, imE));

        /* Multi-class assignment lookup. A student in 3 classes (e.g. Maths
           + Science + English under different subject teachers) has 3 distinct
           classId entries in `enrollments`. Querying assignments for ONE
           classId silently dropped the other two subjects — student appeared
           to have fewer assignments than they actually did.
           Now: collect every classId from enrollments + the student doc,
           chunk into groups of 10 (Firestore `in` cap), merge results, dedup
           by assignment id. */
        const enrollmentRows = merge(await byId("enrollments"), await byEmail("enrollments"));
        const allClassIds = Array.from(new Set([
          ...(sd.classId ? [sd.classId] : []),
          ...enrollmentRows.map((e: any) => e.classId).filter(Boolean),
        ]));
        if (allClassIds.length > 0) {
          const chunks: string[][] = [];
          for (let i = 0; i < allClassIds.length; i += 10) chunks.push(allClassIds.slice(i, i + 10));
          const assignmentMap = new Map<string, any>();
          for (const chunk of chunks) {
            try {
              const snap = await getDocs(query(
                collection(db, "assignments"),
                where("schoolId", "==", schoolId),
                where("classId", "in", chunk),
              ));
              snap.docs.forEach((d: any) => {
                if (!assignmentMap.has(d.id)) assignmentMap.set(d.id, { id: d.id, ...d.data() });
              });
            } catch { /* ignore chunk failure, others may still succeed */ }
          }
          setAssignments(Array.from(assignmentMap.values()));
        }
      } catch (e) { console.error("StudentProfile fetch error:", e); }
      finally { setLoading(false); }
    };
    run();
  }, [studentId]);

  // ── Metrics ────────────────────────────────────────────────────────────────
  const m = useMemo(() => {
    const tot = attendance.length;
    const pres = attendance.filter(r => r.status === "present").length;
    const late = attendance.filter(r => r.status === "late").length;
    const abs = tot - pres - late;
    const attRate = tot > 0 ? ((pres + late) / tot) * 100 : 0;

    const vals = testScores.map(t => Number(t.percentage ?? t.score ?? 0)).filter(n => !isNaN(n) && n > 0);
    const avg = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;

    const subScores: Record<string, number> = {};
    const subCounts: Record<string, number> = {};
    testScores.forEach(t => {
      const sub = (t.subject || t.subjectName || "General").toUpperCase();
      const p = Number(t.percentage ?? t.score ?? 0);
      if (isNaN(p) || p <= 0) return;
      subScores[sub] = (subScores[sub] || 0) + p;
      subCounts[sub] = (subCounts[sub] || 0) + 1;
    });
    Object.keys(subScores).forEach(k => { subScores[k] = Math.round(subScores[k] / subCounts[k]); });

    /* Trend window: filter `n > 0` to match the averaging logic below.
       Without this filter, a 0% score (often a "no-data, default to 0"
       artifact) drags the trend toward "down" — student showing real growth
       gets falsely flagged as declining. Per `bug_pattern_score_zero_no_data`
       memory rule, no-data points must not contribute to inferences. */
    const sorted = [...testScores].sort((a, b) => (toDate(b.timestamp || b.createdAt)?.getTime() || 0) - (toDate(a.timestamp || a.createdAt)?.getTime() || 0));
    const r3 = sorted.slice(0, 3).map(t => Number(t.percentage ?? t.score ?? 0)).filter(n => !isNaN(n) && n > 0);
    const p3 = sorted.slice(3, 6).map(t => Number(t.percentage ?? t.score ?? 0)).filter(n => !isNaN(n) && n > 0);
    const rAvg = r3.length ? r3.reduce((a, b) => a + b, 0) / r3.length : 0;
    const pAvg = p3.length ? p3.reduce((a, b) => a + b, 0) / p3.length : 0;
    /* Trend only meaningful when both windows have data — otherwise show flat. */
    const trend: "up" | "down" | "flat" =
      r3.length === 0 || p3.length === 0 ? "flat" :
      rAvg - pAvg >= 5 ? "up" :
      pAvg - rAvg >= 5 ? "down" : "flat";

    const now = new Date();
    const monthly = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const mAtt = attendance.filter(r => { const dt = toDate(r.date); return dt && dt.getMonth() === d.getMonth() && dt.getFullYear() === d.getFullYear(); });
      const mSc = testScores.filter(t => { const dt = toDate(t.timestamp || t.createdAt); return dt && dt.getMonth() === d.getMonth() && dt.getFullYear() === d.getFullYear(); });
      const mP = mAtt.filter(r => r.status === "present" || r.status === "late").length;
      const attP = mAtt.length > 0 ? (mP / mAtt.length) * 100 : 0;
      const sV = mSc.map(t => Number(t.percentage ?? t.score ?? 0)).filter(n => !isNaN(n) && n > 0);
      const scP = sV.length > 0 ? sV.reduce((a, b) => a + b, 0) / sV.length : 0;
      return { month: MONTHS[d.getMonth()], score: Math.round(scP), attendance: Math.round(attP) };
    });

    const subCount = submissions.length;
    const asgCount = assignments.length;
    const completion = asgCount > 0 ? (subCount / asgCount) * 100 : 0;
    const days = new Set(attendance.map(a => toDate(a.date)?.toDateString())).size;

    return { tot, pres, late, abs, attRate, avg, subScores, trend, monthly, subCount, asgCount, completion, days };
  }, [attendance, testScores, submissions, assignments]);

  /* Risk score — only count dimensions that actually have data. Previously
     a brand-new student with 100% attendance but no tests/assignments yet
     scored ~50 → "ELEVATED" risk because m.avg=0 and m.completion=0 fed
     full 100% penalties. Per `bug_pattern_score_zero_no_data` memory rule,
     no-data should not become "high risk". */
  const overallRisk = useMemo(() => {
    const dims: number[] = [];
    if (m.tot > 0)         dims.push(Math.max(0, 100 - m.attRate));      // attendance
    if (testScores.length) dims.push(Math.max(0, 100 - m.avg));          // academic
    if (m.asgCount > 0)    dims.push(Math.max(0, 100 - m.completion));   // submission
    /* Behavioural always counts — 0 incidents is meaningful "good" data,
       not absence of data. */
    dims.push(Math.min(100, incidents.length * 25));
    return dims.length > 0 ? Math.round(dims.reduce((a, b) => a + b, 0) / dims.length) : 0;
  }, [m, testScores.length, incidents.length]);
  const riskLevel = overallRisk < 20 ? "STABLE" : overallRisk < 45 ? "MONITOR" : overallRisk < 70 ? "ELEVATED" : "CRITICAL";
  const riskColor = overallRisk < 20 ? T.grn : overallRisk < 45 ? T.amb : T.red;

  /* Sort subjects by score descending so "Subject Mastery" actually shows
     mastery ranking. Was using `Object.entries` insertion order, which means
     "first 5 subjects encountered" — alphabetical or arbitrary, not best-to-worst. */
  const subEntries = Object.entries(m.subScores).sort((a, b) => b[1] - a[1]);
  const radarData = subEntries.map(([sub, sc]) => ({ subject: sub.slice(0, 10), score: sc, fullMark: 100 }));

  const calYear = calMonth.getFullYear();
  const calMon = calMonth.getMonth();
  const firstDay = new Date(calYear, calMon, 1).getDay();
  const daysInMonth = new Date(calYear, calMon + 1, 0).getDate();
  /* Local-date matcher (YYYY-MM-DD in user's timezone). `toISOString()`
     returns UTC, so for IST users a record at 11pm IST shifted to next-day
     UTC and showed up on the wrong calendar cell. `toLocaleDateString("en-CA")`
     produces local YYYY-MM-DD — matches the format MarkAttendance writers use. */
  const localDateStr = (d: Date) => d.toLocaleDateString("en-CA");
  const calDays = Array.from({ length: 42 }, (_, i) => {
    const dayNum = i - firstDay + 1;
    if (dayNum < 1 || dayNum > daysInMonth) return null;
    const d = new Date(calYear, calMon, dayNum);
    const dateStr = localDateStr(d);
    const rec = attendance.find(a => {
      const ad = toDate(a.date);
      return ad && localDateStr(ad) === dateStr;
    });
    return { dayNum, date: d, status: rec?.status || null };
  });
  const calPresent = attendance.filter(a => { const d = toDate(a.date); return d && d.getMonth() === calMon && d.getFullYear() === calYear && a.status === "present"; }).length;
  const calLate = attendance.filter(a => { const d = toDate(a.date); return d && d.getMonth() === calMon && d.getFullYear() === calYear && a.status === "late"; }).length;
  const calAbsent = attendance.filter(a => { const d = toDate(a.date); return d && d.getMonth() === calMon && d.getFullYear() === calYear && a.status === "absent"; }).length;

  /* Visual-snapshot export — captures the profile DOM exactly as rendered
     and slices it across PDF pages. Owner gets a document that LOOKS like
     the on-screen profile (same cards, gradients, tilt-tinted backgrounds
     minus the live tilt) instead of a separately-styled report.

     Flow:
       1. Force mobile layout (single column, smaller paddings) so the PDF
          is portrait + narrow — fits A4 cleanly + reads well on phones.
       2. Disable tilt3D (`exporting=true`) so transforms don't skew capture.
       3. Wait two animation frames for React re-render + style settle.
       4. Snapshot via html2canvas at 2x DPR for sharp text.
       5. Generate A4 portrait jsPDF, slice the tall canvas across multiple
          pages so we don't crop content.
       6. Restore state.
  */
  const handleExport = async () => {
    if (!student || !exportRef.current) return;
    const studentName = student.name || "Student";
    setExporting(true);
    setForceMobile(true);

    /* 2 RAFs: one for state-flush, one for layout settle. Recharts re-renders
       on width change so giving it a frame avoids capturing mid-layout. */
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    /* Extra 200ms for chart animations + tilt3D unwind to fully settle. */
    await new Promise(r => setTimeout(r, 250));

    try {
      const node = exportRef.current;
      const canvas = await html2canvas(node, {
        scale: 2,                  // retina-sharp
        backgroundColor: T.bg,
        useCORS: true,
        logging: false,
        windowWidth: node.scrollWidth,
        windowHeight: node.scrollHeight,
      });

      /* A4 portrait: 210 × 297 mm. Map full canvas width to page width;
         page height becomes proportional. Slicing handled by repositioning
         the SAME image at -y on each new page. */
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgW  = pageW;
      const imgH  = (canvas.height * imgW) / canvas.width;
      const imgData = canvas.toDataURL("image/jpeg", 0.92);

      let heightLeft = imgH;
      let position   = 0;

      pdf.addImage(imgData, "JPEG", 0, position, imgW, imgH);
      heightLeft -= pageH;

      while (heightLeft > 0) {
        position -= pageH;
        pdf.addPage();
        pdf.addImage(imgData, "JPEG", 0, position, imgW, imgH);
        heightLeft -= pageH;
      }

      const fname = `${studentName.replace(/[^a-z0-9]+/gi, "_")}_Profile_${new Date().toISOString().slice(0, 10)}.pdf`;
      pdf.save(fname);
      toast.success("Student profile exported");
    } catch (e) {
      console.error("[StudentProfile] export failed:", e);
      toast.error("Export failed. Try again.");
    } finally {
      setExporting(false);
      setForceMobile(false);
    }
  };

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh", gap: 10 }}>
      <Loader2 className="animate-spin" size={20} color={T.blue} /><span style={{ fontSize: 13, color: T.ink3 }}>Loading student profile...</span>
    </div>
  );
  if (!student) return (
    <div style={{ textAlign: "center", padding: 64 }}>
      <AlertCircle size={40} color={T.red} style={{ margin: "0 auto 12px" }} />
      <p style={{ fontSize: 16, fontWeight: 600, color: T.ink, marginBottom: 6 }}>Student not found</p>
      <button onClick={() => navigate("/students")} style={{ padding: "8px 20px", borderRadius: 10, border: `1px solid ${T.bdr}`, background: T.white, color: T.blue, fontSize: 13, fontWeight: 500, cursor: "pointer" }}>← Back to students</button>
    </div>
  );

  const initials = (student.name || "?").split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2);
  const today = new Date();

  const scoreHistory = [...testScores]
    .sort((a, b) => (toDate(b.timestamp || b.createdAt)?.getTime() || 0) - (toDate(a.timestamp || a.createdAt)?.getTime() || 0))
    .slice(0, 6);

  const barChartData = [...scoreHistory].reverse().map(t => ({
    name: (t.subject || t.subjectName || "TEST").slice(0, 8),
    score: Number(t.percentage ?? t.score ?? 0),
  }));

  return (
    <div
      ref={exportRef}
      style={{
        minHeight: "100vh",
        background: T.bg,
        padding: isMobile ? "12px 12px 40px" : "20px 24px 60px",
        fontFamily: "'Inter','Plus Jakarta Sans',-apple-system,sans-serif",
        /* When exporting we pin the container to a phone-width canvas (414px,
           iPhone 12 Pro width) so the snapshot looks like a real mobile
           rendering. `margin: 0 auto` keeps it centered if the viewport is
           wider than 414. */
        ...(forceMobile ? { width: 414, maxWidth: 414, margin: "0 auto" } : {}),
      }}
    >

      {/* ═══ TOP BAR ══════════════════════════════════════════════════════════ */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <button onClick={() => navigate("/students")} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 10, border: `1px solid ${T.bdr}`, background: T.white, color: T.ink2, fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
          <ArrowLeft size={14} /> RETURN
        </button>
        <div style={{ display: "flex", gap: 8 }}>
          {/* Visual-snapshot export — captures the live profile DOM and
              splits it across PDF pages. Disabled during the async render
              + capture so user can't double-click. The spinner replaces the
              icon so the click feels acknowledged. */}
          <button
            onClick={handleExport}
            disabled={exporting}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 16px",
              borderRadius: 10,
              border: `1px solid ${T.bdr}`,
              background: T.white,
              color: T.ink2,
              fontSize: 12,
              fontWeight: 500,
              cursor: exporting ? "wait" : "pointer",
              opacity: exporting ? 0.6 : 1,
            }}
          >
            {exporting
              ? <Loader2 size={13} className="animate-spin" />
              : <Printer size={13} />}
            {exporting ? "EXPORTING…" : "EXPORT"}
          </button>
          {/* Was labeled "CONTACT" but navigated to /reports — misleading. Now
              the label matches the destination (Reports Center), and the icon
              reflects the action. If a real parent-contact flow ships later,
              swap navigate("/reports") for the new route. */}
          <button onClick={() => navigate("/reports")} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 10, border: "none", background: T.blue, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            <FileText size={13} /> REPORTS
          </button>
        </div>
      </div>

      {/* ═══ HERO: 3-COLUMN ══════════════════════════════════════════════════ */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 280px 1fr", gap: isMobile ? 14 : 20, marginBottom: 20 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card icon={Activity} accent="#3B5BDB" staticTilt={exporting} title="Academic Performance">
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
              <div style={{ position: "relative", width: 64, height: 64 }}>
                <svg width="64" height="64" viewBox="0 0 64 64">
                  <circle cx="32" cy="32" r="26" fill="none" stroke={T.s2} strokeWidth="6" />
                  <circle cx="32" cy="32" r="26" fill="none" stroke={T.blue} strokeWidth="6" strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 26} strokeDashoffset={2 * Math.PI * 26 * (1 - m.avg / 100)} transform="rotate(-90 32 32)"
                    style={{ transition: "stroke-dashoffset 1s ease" }} />
                </svg>
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: T.blue }}>{(m.avg / 25).toFixed(1)}</div>
              </div>
              <div>
                <div style={{ fontSize: 28, fontWeight: 800, color: T.ink }}>{Math.round(m.avg)}%</div>
                <div style={{ fontSize: 11, color: T.ink3, display: "flex", alignItems: "center", gap: 4 }}>
                  Avg Score · {testScores.length} tests
                  {m.trend === "up" && <TrendingUp size={12} color={T.grn} />}
                  {m.trend === "down" && <TrendingUp size={12} color={T.red} style={{ transform: "scaleY(-1)" }} />}
                </div>
              </div>
            </div>
            {subEntries.slice(0, 5).map(([sub, sc]) => (
              <div key={sub} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: T.ink3, width: 100, flexShrink: 0 }}>{sub}</span>
                <div style={{ flex: 1, height: 6, background: T.s1, borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${sc}%`, background: sc >= 75 ? T.blue : sc >= 50 ? T.amb : T.red, borderRadius: 3, transition: "width 1s ease" }} />
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: sc >= 75 ? T.blue : sc >= 50 ? T.amb : T.red, width: 30, textAlign: "right" }}>{sc}</span>
              </div>
            ))}
          </Card>

          <Card icon={Calendar} accent="#16a34a" staticTilt={exporting} title="Attendance">
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{ position: "relative", width: 72, height: 72 }}>
                <svg width="72" height="72" viewBox="0 0 72 72">
                  <circle cx="36" cy="36" r="28" fill="none" stroke={T.s2} strokeWidth="7" />
                  <circle cx="36" cy="36" r="28" fill="none"
                    stroke={m.attRate >= 85 ? T.grn : m.attRate >= 70 ? T.amb : T.red}
                    strokeWidth="7" strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 28} strokeDashoffset={2 * Math.PI * 28 * (1 - m.attRate / 100)}
                    transform="rotate(-90 36 36)" style={{ transition: "stroke-dashoffset 1s ease" }} />
                </svg>
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 700, color: m.attRate >= 85 ? T.grn : T.amb }}>{Math.round(m.attRate)}%</div>
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: T.ink }}>Present</div>
                <div style={{ fontSize: 12, color: T.ink3, marginTop: 2 }}>Late: {m.late} · Abs: {m.abs}</div>
                <div style={{ fontSize: 11, color: T.ink3, marginTop: 2 }}>{m.pres + m.late} / {m.tot} days</div>
              </div>
            </div>
          </Card>

          <Card icon={BookOpen} accent="#7c3aed" staticTilt={exporting} title="Subject Mastery" action={<DetailLink />}>
            {radarData.length >= 3 && (
              <div style={{ height: 180, marginBottom: 12 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart cx="50%" cy="50%" outerRadius="70%" data={radarData}>
                    <PolarGrid stroke={T.s2} />
                    <PolarAngleAxis dataKey="subject" tick={{ fill: T.ink3, fontSize: 10 }} />
                    <Radar dataKey="score" stroke={T.blue} fill={T.blue} fillOpacity={0.15} strokeWidth={2} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            )}
            {subEntries.map(([sub, sc]) => (
              <div key={sub} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: T.ink3, width: 90, flexShrink: 0 }}>{sub}</span>
                <div style={{ flex: 1, height: 6, background: T.s1, borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${sc}%`, background: sc >= 75 ? T.blue : sc >= 50 ? T.grn : T.red, borderRadius: 3 }} />
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: T.ink, width: 28, textAlign: "right" }}>{sc}</span>
              </div>
            ))}
          </Card>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 20 }}>
          <div style={{ width: 140, height: 140, borderRadius: "50%", border: `4px solid ${T.blue}`, background: T.blBg, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16, boxShadow: "0 8px 30px rgba(59,91,219,0.15)" }}>
            <span style={{ fontSize: 42, fontWeight: 800, color: T.blue }}>{initials}</span>
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: T.ink, textAlign: "center", marginBottom: 4 }}>{student.name}</h2>
          <p style={{ fontSize: 12, color: T.ink3, textAlign: "center", marginBottom: 4 }}>{student.className || student.class || "—"}</p>
          <p style={{ fontSize: 11, color: T.ink3, textAlign: "center", marginBottom: 12 }}>Roll: {student.rollNo || student.roll || "—"} · ID: {(student.id || "").slice(0, 6).toUpperCase()}</p>
          <div style={{ display: "flex", gap: 6 }}>
            <span style={{ padding: "4px 12px", borderRadius: 20, background: T.glBg, color: T.grn, fontSize: 10, fontWeight: 600 }}>ACTIVE</span>
            <span style={{ padding: "4px 12px", borderRadius: 20, background: riskColor === T.grn ? T.glBg : riskColor === T.amb ? T.alBg : T.rlBg, color: riskColor, fontSize: 10, fontWeight: 600 }}>{riskLevel}</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card icon={AlertCircle} accent="#d97706" staticTilt={exporting} title="Behaviour Record" action={<DetailLink />}>
            {incidents.length === 0 ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: T.glBg, borderRadius: 10 }}>
                <CheckCircle2 size={14} color={T.grn} /><span style={{ fontSize: 12, color: T.grn, fontWeight: 500 }}>No incidents recorded</span>
              </div>
            ) : incidents.slice(0, 3).map(inc => (
              <div key={inc.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 0", borderBottom: `1px solid ${T.s2}` }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: T.red, marginTop: 5, flexShrink: 0 }} />
                <div>
                  <span style={{ fontSize: 12, fontWeight: 600, color: T.red }}>{(inc.type || "INCIDENT").toUpperCase()}</span>
                  <p style={{ fontSize: 11, color: T.ink3, marginTop: 2 }}>{(inc.description || inc.content || "").slice(0, 80)}</p>
                </div>
              </div>
            ))}
          </Card>

          <Card icon={TrendingUp} accent="#3B5BDB" staticTilt={exporting} title="Performance Forecast" action={<DetailLink />}>
            {/* Renamed from "AI Intelligence" — the formula is a deterministic
                trend-aware extrapolation, not an LLM call. Honest framing
                lets us still call out the ML-style insight without overpromising
                generative-AI capabilities the page doesn't have. */}
            {m.avg > 0 ? (
              <>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: T.ink3 }}>Projected next score:</span>
                  <span style={{ fontSize: 20, fontWeight: 700, color: T.blue }}>{(() => {
                    /* Project ±5% of the gap to 100 / 0 based on trend direction.
                       Was always trending UP regardless of actual trend — a
                       declining student got predicted "improvement". Now the
                       direction follows the data. */
                    const delta =
                      m.trend === "up"   ? Math.max(0, (100 - m.avg) * 0.05)  :
                      m.trend === "down" ? -Math.max(0, m.avg * 0.05)         :
                                            0;
                    return `${Math.min(100, Math.max(0, Math.round(m.avg + delta)))}%`;
                  })()}</span>
                </div>
                <div style={{ fontSize: 11, color: T.ink3, lineHeight: 1.6 }}>
                  {m.trend === "up" ? "Performance trend is positive — student shows consistent growth." :
                   m.trend === "down" ? "Performance is declining — early intervention recommended." :
                   "Performance is stable — encourage continued effort."}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 11, color: T.ink3, lineHeight: 1.6 }}>
                Forecast appears once test scores are recorded.
              </div>
            )}
          </Card>

          <Card icon={MessageSquare} accent="#16a34a" staticTilt={exporting} title="Parent Communication" action={<DetailLink />}>
            {parentNotes.length === 0 ? (
              <p style={{ fontSize: 12, color: T.ink3, textAlign: "center", padding: "8px 0" }}>No messages yet</p>
            ) : parentNotes.slice(0, 2).map(n => (
              <div key={n.id} style={{ padding: "8px 0", borderBottom: `1px solid ${T.s2}` }}>
                <div style={{ fontSize: 10, color: n.from === "teacher" ? T.blue : T.grn, fontWeight: 600, marginBottom: 2 }}>
                  {n.from === "teacher" ? (n.teacherName || "TEACHER") : "PARENT"} · {timeAgo(n.createdAt)}
                </div>
                <p style={{ fontSize: 12, color: T.ink2, lineHeight: 1.5, margin: 0 }}>{(n.content || n.message || "").slice(0, 100)}</p>
              </div>
            ))}
          </Card>

          <Card icon={FileText} accent="#3B5BDB" staticTilt={exporting} title="Teacher Observations">
            {parentNotes.filter(n => n.from === "teacher").length === 0 ? (
              <p style={{ fontSize: 12, color: T.ink3, textAlign: "center" }}>No observations yet</p>
            ) : (
              <div style={{ padding: "10px 14px", background: T.blBg, borderLeft: `3px solid ${T.blue}`, borderRadius: 8 }}>
                <p style={{ fontSize: 12, color: T.ink2, lineHeight: 1.6, margin: 0, fontStyle: "italic" }}>
                  "{(parentNotes.find(n => n.from === "teacher")?.content || parentNotes.find(n => n.from === "teacher")?.message || "").slice(0, 150)}"
                </p>
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* ═══ PERFORMANCE TIMELINE ═══ */}
      <Card icon={TrendingUp} accent="#3B5BDB" staticTilt={exporting} title="Performance Timeline" action={<DetailLink />} style={{ marginBottom: 20 }}>
        <div style={{ height: 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={m.monthly}>
              <defs>
                <linearGradient id="blGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={T.blue} stopOpacity={0.15} /><stop offset="95%" stopColor={T.blue} stopOpacity={0} /></linearGradient>
                <linearGradient id="gnGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={T.grn} stopOpacity={0.15} /><stop offset="95%" stopColor={T.grn} stopOpacity={0} /></linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={T.s2} />
              <XAxis dataKey="month" tick={{ fill: T.ink3, fontSize: 11 }} axisLine={{ stroke: T.s2 }} />
              <YAxis tick={{ fill: T.ink3, fontSize: 11 }} axisLine={{ stroke: T.s2 }} domain={[0, 100]} />
              <Tooltip contentStyle={{ background: T.white, border: `1px solid ${T.bdr}`, borderRadius: 8, fontSize: 12 }} />
              <Area type="monotone" dataKey="score" stroke={T.blue} fill="url(#blGrad)" strokeWidth={2.5} />
              <Area type="monotone" dataKey="attendance" stroke={T.grn} fill="url(#gnGrad)" strokeWidth={2} strokeDasharray="5 3" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* ═══ ASSIGNMENTS + RISK ASSESSMENT ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 14 : 20, marginBottom: 20 }}>
        <Card icon={CheckCircle2} accent="#3B5BDB" staticTilt={exporting} title={`Assignments · ${m.subCount}/${m.asgCount}`} action={<span style={{ fontSize: 11, color: T.blue, fontWeight: 500, cursor: "pointer" }}>View All →</span>}>
          {[...assignments].sort((a, b) => (toDate(b.dueDate)?.getTime() || 0) - (toDate(a.dueDate)?.getTime() || 0)).slice(0, 5).map(a => {
            const sub = submissions.find((s: any) => s.assignmentId === a.id);
            return (
              <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: `1px solid ${T.s2}` }}>
                <CheckCircle2 size={14} color={sub ? T.grn : T.ink3} />
                <span style={{ fontSize: 13, color: T.ink, flex: 1 }}>{(a.title || "Assignment").slice(0, 35)}</span>
              </div>
            );
          })}
          {assignments.length === 0 && <p style={{ fontSize: 12, color: T.ink3, textAlign: "center" }}>No assignments</p>}
        </Card>

        <Card icon={AlertCircle} accent="#dc2626" staticTilt={exporting} title="Risk Assessment" action={<DetailLink />}>
          <div style={{ fontSize: 22, fontWeight: 800, color: riskColor, marginBottom: 14 }}>{riskLevel}</div>
          {[
            { label: "ATTENDANCE", val: m.attRate, color: m.attRate >= 85 ? T.blue : T.amb, extra: undefined as string | undefined },
            { label: "ACADEMIC", val: m.avg, color: m.avg >= 75 ? T.blue : m.avg >= 50 ? T.amb : T.red, extra: undefined },
            { label: "SUBMISSION", val: m.completion, color: m.completion >= 80 ? T.blue : T.amb, extra: undefined },
            { label: "BEHAVIOURAL", val: incidents.length > 0 ? -1 : 100, color: incidents.length === 0 ? T.blue : T.red, extra: incidents.length > 0 ? `${incidents.length} Events` : undefined },
          ].map(r => (
            <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 11, color: T.ink3, width: 100, flexShrink: 0 }}>{r.label}</span>
              <div style={{ flex: 1, height: 6, background: T.s1, borderRadius: 3, overflow: "hidden" }}>
                {r.val >= 0 && <div style={{ height: "100%", width: `${r.val}%`, background: r.color, borderRadius: 3, transition: "width 1s" }} />}
              </div>
              <span style={{ fontSize: 12, fontWeight: 600, color: r.color, width: 60, textAlign: "right" }}>{r.extra || `${Math.round(r.val >= 0 ? r.val : 0)}%`}</span>
            </div>
          ))}
        </Card>
      </div>

      {/* ═══ ATTENDANCE CALENDAR + SUPPORT ACTIONS ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 14 : 20, marginBottom: 20 }}>
        <Card icon={Calendar} accent="#16a34a" staticTilt={exporting} title="Attendance Calendar" action={<span style={{ fontSize: 11, color: T.ink3 }}>Daily attendance record</span>}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, marginBottom: 14 }}>
            <button onClick={() => setCalMonth(new Date(calYear, calMon - 1))} style={{ background: "none", border: "none", cursor: "pointer", color: T.ink3 }}><ChevronLeft size={16} /></button>
            <span style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{MONTHS[calMon]} {calYear}</span>
            <button onClick={() => setCalMonth(new Date(calYear, calMon + 1))} style={{ background: "none", border: "none", cursor: "pointer", color: T.ink3 }}><ChevronRight size={16} /></button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14 }}>
            <div style={{ textAlign: "center", padding: "10px 0", background: T.glBg, borderRadius: 10 }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: T.grn }}>{calPresent}</div><div style={{ fontSize: 10, color: T.grn }}>PRESENT</div>
            </div>
            <div style={{ textAlign: "center", padding: "10px 0", background: T.alBg, borderRadius: 10 }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: T.amb }}>{calLate}</div><div style={{ fontSize: 10, color: T.amb }}>LATE</div>
            </div>
            <div style={{ textAlign: "center", padding: "10px 0", background: T.rlBg, borderRadius: 10 }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: T.red }}>{calAbsent}</div><div style={{ fontSize: 10, color: T.red }}>ABSENT</div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, textAlign: "center" }}>
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => (
              <div key={d} style={{ fontSize: 10, fontWeight: 600, color: T.ink3, padding: "4px 0" }}>{d}</div>
            ))}
            {calDays.map((d, i) => {
              if (!d) return <div key={i} />;
              const isToday = d.date.toDateString() === today.toDateString();
              const bg = d.status === "present" ? T.grn : d.status === "late" ? T.amb : d.status === "absent" ? T.red : "transparent";
              const isWknd = d.date.getDay() === 0 || d.date.getDay() === 6;
              return (
                <div key={i} style={{
                  width: 32, height: 32, borderRadius: isToday ? "50%" : 8, margin: "0 auto",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 12, fontWeight: isToday ? 700 : 400,
                  color: d.status ? "#fff" : isWknd ? T.ink3 : T.ink,
                  background: isToday && !d.status ? T.blue : bg,
                }}>
                  {d.dayNum}
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 14, marginTop: 12, justifyContent: "center" }}>
            {[{ c: T.grn, l: "Present" }, { c: T.amb, l: "Late" }, { c: T.red, l: "Absent" }, { c: T.s2, l: "Weekend" }, { c: "transparent", l: "No Data" }].map(x => (
              <div key={x.l} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: x.c, border: x.c === "transparent" ? `1px solid ${T.s2}` : "none" }} />
                <span style={{ fontSize: 10, color: T.ink3 }}>{x.l}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card icon={Activity} accent="#d97706" staticTilt={exporting} title="Support Actions" action={<DetailLink />}>
          {interventions.length === 0 ? (
            <p style={{ fontSize: 12, color: T.ink3, textAlign: "center", padding: "20px 0" }}>No active interventions</p>
          ) : interventions.map(iv => (
            <div key={iv.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 0", borderBottom: `1px solid ${T.s2}` }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: iv.status === "completed" ? T.grn : T.amb, marginTop: 5, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: T.ink3, marginBottom: 2 }}>{timeAgo(iv.createdAt)}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{iv.actionTitle || iv.title || "Intervention"}</div>
                <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                  <span style={{ padding: "2px 8px", borderRadius: 4, background: T.blBg, color: T.blue, fontSize: 10, fontWeight: 600 }}>{(iv.actionType || iv.type || "GENERAL").toUpperCase()}</span>
                  <span style={{ padding: "2px 8px", borderRadius: 4, background: iv.status === "completed" ? T.glBg : T.alBg, color: iv.status === "completed" ? T.grn : T.amb, fontSize: 10, fontWeight: 600 }}>{iv.status === "completed" ? "Complete" : "Active"}</span>
                </div>
              </div>
              <span style={{ fontSize: 10, color: T.ink3, flexShrink: 0 }}>{iv.assignedTo || ""}</span>
            </div>
          ))}
        </Card>
      </div>

      {/* ═══ INCIDENTS + OVERVIEW ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 14 : 20, marginBottom: 20 }}>
        <Card icon={AlertCircle} accent="#dc2626" staticTilt={exporting} title="Incidents" action={<DetailLink />}>
          {incidents.length === 0 ? (
            <div style={{ textAlign: "center", padding: "20px 0" }}>
              <CheckCircle2 size={24} color={T.grn} style={{ margin: "0 auto 8px" }} />
              <p style={{ fontSize: 12, color: T.grn, fontWeight: 500 }}>No incidents on record</p>
            </div>
          ) : incidents.map(inc => (
            <div key={inc.id} style={{ padding: "10px 0", borderBottom: `1px solid ${T.s2}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: T.red }}>• {(inc.type || "INCIDENT").toUpperCase()}</span>
                <span style={{ fontSize: 10, color: T.ink3 }}>{timeAgo(inc.createdAt || inc.date)}</span>
              </div>
              <p style={{ fontSize: 11, color: T.ink2, marginTop: 4, lineHeight: 1.5 }}>{(inc.description || inc.content || "").slice(0, 120)}</p>
            </div>
          ))}
          {incidents.length > 0 && (
            <div style={{ textAlign: "center", padding: "10px 0", marginTop: 8, background: T.rlBg, borderRadius: 8 }}>
              <span style={{ fontSize: 11, color: T.red, fontWeight: 500 }}>Total: {incidents.length} incident{incidents.length > 1 ? "s" : ""} recorded</span>
            </div>
          )}
        </Card>

        <Card icon={BarChart3} accent="#3B5BDB" staticTilt={exporting} title="Overview" action={<span style={{ fontSize: 11, color: T.blue, cursor: "pointer" }}>Dashboard →</span>}>
          {[
            { icon: FileText, label: "TOTAL TESTS", val: testScores.length },
            { icon: BookOpen, label: "SUBJECTS TRACKED", val: subEntries.length },
            { icon: Calendar, label: "DAYS ON RECORD", val: m.days },
            { icon: Activity, label: "AVG ATTENDANCE", val: `${Math.round(m.attRate)}%` },
            { icon: BarChart3, label: "ASSIGNMENT RATE", val: `${Math.round(m.completion)}%` },
            { icon: MessageSquare, label: "PARENT NOTES", val: parentNotes.length },
          ].map(item => (
            <div key={item.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${T.s2}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <item.icon size={14} color={T.ink3} />
                <span style={{ fontSize: 12, color: T.ink3 }}>{item.label}</span>
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{item.val}</span>
            </div>
          ))}
        </Card>
      </div>

      {/* ═══ COMMUNICATIONS + SCORE HISTORY ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 14 : 20, marginBottom: 20 }}>
        <Card icon={MessageSquare} accent="#3B5BDB" staticTilt={exporting} title={`Communications · ${parentNotes.length} entries`} action={<span style={{ fontSize: 11, color: T.blue, cursor: "pointer" }}>View All →</span>}>
          {parentNotes.slice(0, 3).map(n => (
            <div key={n.id} style={{ padding: "12px 0", borderBottom: `1px solid ${T.s2}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{n.from === "teacher" ? (n.teacherName || "TEACHER") : "PARENT"}</span>
                <span style={{ padding: "2px 8px", borderRadius: 4, background: n.from === "teacher" ? T.blBg : T.glBg, color: n.from === "teacher" ? T.blue : T.grn, fontSize: 10, fontWeight: 600 }}>{n.from === "teacher" ? "FACULTY" : "PARENT"}</span>
                <span style={{ fontSize: 10, color: T.ink3, marginLeft: "auto" }}>{timeAgo(n.createdAt)}</span>
              </div>
              <p style={{ fontSize: 12, color: T.ink2, lineHeight: 1.5, margin: 0 }}>{(n.content || n.message || "").slice(0, 120)}</p>
            </div>
          ))}
          {parentNotes.length === 0 && <p style={{ fontSize: 12, color: T.ink3, textAlign: "center", padding: "16px 0" }}>No communications</p>}
        </Card>

        <Card icon={BarChart3} accent="#3B5BDB" staticTilt={exporting} title={`Score History · ${testScores.length} records`} action={<span style={{ fontSize: 11, color: T.blue, cursor: "pointer" }}>View All →</span>}>
          {barChartData.length > 0 && (
            <div style={{ height: 150, marginBottom: 12 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={T.s2} />
                  <XAxis dataKey="name" tick={{ fill: T.ink3, fontSize: 9 }} axisLine={{ stroke: T.s2 }} />
                  <YAxis tick={{ fill: T.ink3, fontSize: 9 }} axisLine={{ stroke: T.s2 }} domain={[0, 100]} />
                  <Tooltip contentStyle={{ background: T.white, border: `1px solid ${T.bdr}`, borderRadius: 8, fontSize: 11 }} />
                  <Bar dataKey="score" fill={T.blue} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>{["SUBJECT", "DATE", "SCORE"].map(h => <th key={h} style={{ textAlign: "left", padding: "6px 8px", fontSize: 10, color: T.ink3, fontWeight: 600, borderBottom: `1px solid ${T.s2}` }}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {scoreHistory.map(t => {
                const d = toDate(t.timestamp || t.createdAt);
                /* Truncate with ellipsis indicator so user sees there's more to
                   the subject name. Plain `.slice(0, 20)` chopped silently. */
                const rawSubject = t.subject || t.subjectName || "TEST";
                const subject = rawSubject.length > 20 ? `${rawSubject.slice(0, 19)}…` : rawSubject;
                return (
                  <tr key={t.id} style={{ borderBottom: `1px solid ${T.s2}` }}>
                    <td style={{ padding: "8px", color: T.ink }} title={rawSubject}>{subject}</td>
                    <td style={{ padding: "8px", color: T.ink3 }}>{d ? d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }).toUpperCase() : "—"}</td>
                    <td style={{ padding: "8px", fontWeight: 600, color: T.blue }}>{Number(t.percentage ?? t.score ?? 0)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </div>

      {/* ═══ TEACHER RATINGS + IMPROVEMENT AREAS (cross-dashboard sync) ═══════
           Teacher writes via StudentBehaviour page — surfaced here so owners
           see the same picture parents and principal see. Single Firestore
           source of truth across all 4 dashboards. */}
      {(studentRatings.length > 0 || improvementAreas.length > 0) && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>
          {/* Teacher Ratings */}
          <Card icon={Star} accent="#FFAA00" staticTilt={exporting} title={`Teacher Ratings · ${studentRatings.length}`} action={<DetailLink />}>
            {studentRatings.length === 0 ? (
              <p style={{ fontSize: 12, color: T.ink3, textAlign: "center", padding: "16px 0" }}>No teacher ratings yet</p>
            ) : (() => {
              const valid = studentRatings.filter(r => typeof r.rating === "number");
              const avg = valid.length > 0 ? valid.reduce((a, r) => a + r.rating, 0) / valid.length : null;
              const sorted = [...studentRatings].sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0));
              return (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 18px", borderBottom: `1px solid ${T.bdr}` }}>
                    <div style={{ fontSize: 26, fontWeight: 700, color: "#FFAA00", letterSpacing: "-0.6px" }}>
                      {avg !== null ? avg.toFixed(1) : "—"}
                      <span style={{ fontSize: 13, color: T.ink3, fontWeight: 500 }}> / 5</span>
                    </div>
                    <div style={{ display: "flex", gap: 2 }}>
                      {[1,2,3,4,5].map(n => (
                        <Star key={n} size={13}
                          color={avg !== null && n <= Math.round(avg) ? "#FFAA00" : T.ink3}
                          fill={avg !== null && n <= Math.round(avg) ? "#FFAA00" : "transparent"} />
                      ))}
                    </div>
                    <span style={{ fontSize: 11, color: T.ink3, marginLeft: "auto" }}>{valid.length} rating{valid.length === 1 ? "" : "s"}</span>
                  </div>
                  <div style={{ padding: "0 18px" }}>
                    {sorted.slice(0, 5).map(r => (
                      <div key={r.id} style={{ display: "flex", gap: 10, padding: "10px 0", borderBottom: `1px solid ${T.bdr}` }}>
                        <div style={{ display: "flex", gap: 1, flexShrink: 0, marginTop: 3 }}>
                          {[1,2,3,4,5].map(n => (
                            <Star key={n} size={11}
                              color={typeof r.rating === "number" && n <= r.rating ? "#FFAA00" : T.ink3}
                              fill={typeof r.rating === "number" && n <= r.rating ? "#FFAA00" : "transparent"} />
                          ))}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          {r.note && <p style={{ fontSize: 12, color: T.ink2, lineHeight: 1.5, margin: 0 }}>{r.note}</p>}
                          <div style={{ fontSize: 10, color: T.ink3, marginTop: 3 }}>
                            {r.teacherName || "Teacher"} · {timeAgo(r.createdAt)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              );
            })()}
          </Card>

          {/* Improvement Areas */}
          <Card icon={Lightbulb} accent="#7c3aed" staticTilt={exporting} title={`Improvement Areas · ${improvementAreas.length}`} action={<DetailLink />}>
            {improvementAreas.length === 0 ? (
              <p style={{ fontSize: 12, color: T.ink3, textAlign: "center", padding: "16px 0" }}>No improvement areas tracked</p>
            ) : (() => {
              const isResolvedFn = (s?: string) => String(s || "").toLowerCase() === "resolved";
              const active = improvementAreas.filter(i => !isResolvedFn(i.status));
              const resolved = improvementAreas.filter(i => isResolvedFn(i.status));
              const sorted = [...improvementAreas].sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0));
              return (
                <>
                  <div style={{ display: "flex", gap: 10, padding: "10px 18px", borderBottom: `1px solid ${T.bdr}` }}>
                    <div style={{ flex: 1, padding: "6px 10px", background: T.alBg, borderRadius: 8 }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: T.amb }}>{active.length}</div>
                      <div style={{ fontSize: 9, color: T.ink3, fontWeight: 600 }}>ACTIVE</div>
                    </div>
                    <div style={{ flex: 1, padding: "6px 10px", background: T.glBg, borderRadius: 8 }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: T.grn }}>{resolved.length}</div>
                      <div style={{ fontSize: 9, color: T.ink3, fontWeight: 600 }}>RESOLVED</div>
                    </div>
                  </div>
                  <div style={{ padding: "0 18px" }}>
                    {sorted.slice(0, 5).map(imp => {
                      const r = isResolvedFn(imp.status);
                      const pri = String(imp.priority || "low").toLowerCase();
                      const priColor = pri === "high" ? T.red : pri === "medium" ? T.amb : T.blue;
                      const priBg    = pri === "high" ? T.rlBg : pri === "medium" ? T.alBg : T.blBg;
                      return (
                        <div key={imp.id} style={{ display: "flex", gap: 10, padding: "10px 0", borderBottom: `1px solid ${T.bdr}`, opacity: r ? 0.6 : 1 }}>
                          <div style={{ width: 16, height: 16, borderRadius: 4, background: r ? T.grn : "transparent", border: `1.5px solid ${r ? T.grn : T.bdr}`, flexShrink: 0, marginTop: 2, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            {r && <CheckCircle2 size={11} color="#fff" />}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3, flexWrap: "wrap" }}>
                              <span style={{ fontSize: 13, fontWeight: 600, color: T.ink, textDecoration: r ? "line-through" : "none" }}>
                                {imp.title || "Untitled"}
                              </span>
                              <span style={{ padding: "1px 7px", borderRadius: 5, background: priBg, color: priColor, fontSize: 9, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                                {pri}
                              </span>
                            </div>
                            {imp.description && (
                              <p style={{ fontSize: 11, color: T.ink2, lineHeight: 1.4, margin: 0 }}>{imp.description}</p>
                            )}
                            <div style={{ fontSize: 10, color: T.ink3, marginTop: 3 }}>
                              {imp.teacherName || "Teacher"} · {timeAgo(imp.createdAt)}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              );
            })()}
          </Card>
        </div>
      )}

      {/* ═══ BOTTOM STATUS BAR ═══ */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 20px", background: T.white, border: `1px solid ${T.bdr}`, borderRadius: 12, fontSize: 10, color: T.ink3 }}>
        <span>★ PARENT ENGAGEMENT: {Math.min(100, parentNotes.length * 20)}%</span>
        <span>★ Status: Active</span>
        <span>★ Data: Live</span>
        <span>★ Secured</span>
        <span>★ STUDENT ID: {(student.id || "").slice(0, 8).toUpperCase()}</span>
        <span style={{ color: T.blue, fontWeight: 600 }}>{now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
      </div>
    </div>
  );
};

export default StudentProfile;