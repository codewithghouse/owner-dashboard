import { useState, useEffect, useRef, useMemo } from "react";
import { db, auth } from "@/lib/firebase";
import { collection, getDocs, query, where, orderBy, limit, onSnapshot, doc, getDoc, setDoc } from "firebase/firestore";
import { calculateAHI, invalidateCache } from "@/lib/analyticsService";
import { loadDashboardStats, invalidateDashboardCache } from "@/lib/cloudAggregation";
import {
  Activity, Users, Percent, Bell, Download, Mail, Calendar, Settings,
  AlertCircle, Loader2, TrendingUp, ArrowUpRight, ArrowDownRight, Minus,
  GraduationCap
} from "lucide-react";
import {
  PieChart, Pie, Cell, AreaChart, Area, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from "recharts";
import { useNavigate } from "react-router-dom";
import BenchmarkCard from "@/components/BenchmarkCard";

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/* ── responsive breakpoint hook ──────────────────────── */
function useBreakpoint() {
  const get = () => {
    if (typeof window === "undefined") return "desktop" as const;
    const w = window.innerWidth;
    return w < 768 ? ("mobile" as const) : w < 1024 ? ("tablet" as const) : ("desktop" as const);
  };
  const [bp, setBp] = useState<"mobile" | "tablet" | "desktop">(get);
  useEffect(() => {
    const onResize = () => setBp(get());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return bp;
}

/* ── helpers ─────────────────────────────────────────── */
function timeAgo(ts: any): string {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 3600)  return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} hours ago`;
  return `${Math.round(diff / 86400)} days ago`;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const bp = useBreakpoint();
  const isMobile = bp === "mobile";
  const isTablet = bp === "tablet";

  /* ── stat state ─────────────────────────────────── */
  const [ahi,           setAhi]           = useState<number>(0);
  const [totalStudents, setTotalStudents] = useState<number>(0);
  const [feeRate,       setFeeRate]       = useState<number>(0);
  const [activeAlerts,  setActiveAlerts]  = useState<number>(0);

  /* ── section state ──────────────────────────────── */
  const [branches,     setBranches]     = useState<any[]>([]);
  const [riskData,     setRiskData]     = useState([
    { name: "Low Risk", value: 0, color: "#22c55e" },
    { name: "Moderate", value: 0, color: "#f59e0b" },
    { name: "Critical", value: 0, color: "#ef4444" },
  ]);
  const [revenueTrend,       setRevenueTrend]       = useState<any[]>([]);
  const [improvementTimeline, setImprovementTimeline] = useState<any[]>([]);
  const [alerts,              setAlerts]              = useState<any[]>([]);
  const [selectedAlertBranch, setSelectedAlertBranch] = useState<string>("all");
  const [loading,             setLoading]             = useState(true);
  const [lastRefreshed,       setLastRefreshed]       = useState<Date | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ── data fetch ─────────────────────────────────── */
  useEffect(() => {
    let alertsUnsub = () => {};
    let branchesUnsub = () => {};

    const uid = auth.currentUser?.uid;
    if (!uid) return;

    // ── Save monthly historical snapshot (once per month) ─────────────────
    const saveMonthlySnapshot = async (ahi: number, attendance: number, passRate: number, feeRate: number) => {
      const now = new Date();
      const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      try {
        const snapRef = doc(db, "schools", uid, "snapshots", monthKey);
        const existing = await getDoc(snapRef);
        if (!existing.exists()) {
          await setDoc(snapRef, { ahi, attendance, passRate, feeRate, savedAt: new Date().toISOString() });
        }
      } catch { /* snapshot saving must never crash the dashboard */ }
    };

    const fetchAll = async (branchDocs: any[]) => {
      try {
        // ── Fast-path: server-aggregated branch stats (5min cache) ──────────
        // Replaces the per-branch parallel fetch loop below for 95% read savings.
        // Falls back to client-side computation if the cloud call fails.
        try {
          const cloudStats = await loadDashboardStats();
          if (cloudStats?.branches?.length) {
            const mapped = cloudStats.branches.map((b) => ({
              id:           b.id,
              name:         b.name,
              students:     b.students,
              ahi:          b.ahi,
              avgMarks:     b.passRate, // proxy until per-branch avgMarks added to cloud fn
              avgAttendance: b.attendance,
              passRate:     b.passRate,
              feeRate:      b.feeCollection,
            }));
            setBranches(mapped);
            setTotalStudents(cloudStats.totals.totalStudents);
            setAhi(cloudStats.totals.avgAhi);
            setLoading(false);
            setLastRefreshed(new Date());
            // Continue below for risk distribution / revenue / timeline
            // which aren't covered by the cloud aggregator yet.
          }
        } catch (err) {
          console.warn("[Dashboard] cloud aggregation failed — falling back to client-side:", err);
        }

        const schoolDocs = branchDocs;

        /* 2. Per-branch stats */
        const branchData = await Promise.all(
          schoolDocs.map(async (school) => {
            const sid = school.id;

            /* student count — use branchId for owner's branches */
            const enrollSnap  = await getDocs(query(collection(db, "enrollments"), where("branchId","==",sid)));
            const studentCount = enrollSnap.size;

            /* scores → passRate */
            const scoresSnap  = await getDocs(query(collection(db, "test_scores"), where("branchId","==",sid)));
            const allPct      = scoresSnap.docs
              .map(d => parseFloat(d.data().percentage ?? d.data().score ?? ""))
              .filter(n => !isNaN(n));
            const avgMarks    = allPct.length
              ? Math.round(allPct.reduce((a,b)=>a+b,0) / allPct.length)
              : 0;
            const passRate    = allPct.length
              ? Math.round(allPct.filter(p => p >= 40).length / allPct.length * 100)
              : 0;

            /* attendance */
            const attSnap     = await getDocs(query(collection(db, "attendance"), where("branchId","==",sid)));
            const presentCnt  = attSnap.docs.filter(d => (d.data().status||"").toLowerCase()==="present").length;
            const avgAtt      = attSnap.size ? Math.round((presentCnt / attSnap.size) * 100) : 0;

            /* fee collection rate per branch */
            const branchFeesSnap = await getDocs(query(collection(db, "fees"), where("branchId","==",sid)));
            const branchPaid     = branchFeesSnap.docs.filter(d => (d.data().status||"").toLowerCase()==="paid").length;
            const feeRate        = branchFeesSnap.size ? Math.round((branchPaid / branchFeesSnap.size) * 100) : 0;

            /* AHI — standard formula: 40% attendance + 40% passRate + 20% feeCollection */
            const schoolAHI = calculateAHI(avgAtt, passRate, feeRate);

            return {
              id:       sid,
              name:     school.name || school.schoolName || "School",
              students: studentCount,
              ahi:      schoolAHI,
              avgMarks,
              avgAttendance: avgAtt,
              passRate,
              feeRate,
            };
          })
        );

        const activeBranches = branchData.filter(b => b.name !== "School");
        setBranches(activeBranches);

        /* 3. Overall stats */
        const totalStuds = activeBranches.reduce((s,b)=>s+b.students, 0);
        setTotalStudents(totalStuds);

        const overallAHI = activeBranches.length > 0
          ? Math.round(activeBranches.reduce((s,b)=>s+b.ahi,0) / activeBranches.length)
          : 0;
        setAhi(overallAHI);

        /* 4. Risk distribution for this owner */
        const allScoresSnap = await getDocs(query(collection(db, "test_scores"), where("schoolId", "==", uid)));
        const studentMap    = new Map<string, number[]>();
        allScoresSnap.docs.forEach(d => {
          const data = d.data();
          const key  = data.studentId || data.studentEmail || d.id;
          const pct  = parseFloat(data.percentage ?? data.score ?? "");
          if (!isNaN(pct)) {
            if (!studentMap.has(key)) studentMap.set(key, []);
            studentMap.get(key)!.push(pct);
          }
        });
        let low=0, mid=0, crit=0;
        studentMap.forEach(vals => {
          const avg = vals.reduce((a,b)=>a+b,0) / vals.length;
          if      (avg >= 75) low++;
          else if (avg >= 50) mid++;
          else                crit++;
        });
        const total = low + mid + crit || 1;
        setRiskData([
          { name: "Low Risk", value: Math.round((low  / total)*100), color: "#22c55e" },
          { name: "Moderate", value: Math.round((mid  / total)*100), color: "#f59e0b" },
          { name: "Critical", value: Math.round((crit / total)*100), color: "#ef4444" },
        ]);

        /* 5. Fee collection rate for this owner */
        const feesSnap = await getDocs(query(collection(db, "fees"), where("schoolId", "==", uid)));
        const totalFee = feesSnap.size;
        const paidFee  = feesSnap.docs.filter(d => (d.data().status||"").toLowerCase()==="paid").length;
        setFeeRate(totalFee > 0 ? Math.round((paidFee / totalFee)*1000)/10 : 0);

        /* 6. Revenue trend (last 6 months) */
        const monthMap: Record<string,number> = {};
        feesSnap.docs
          .filter(d => (d.data().status||"").toLowerCase()==="paid")
          .forEach(d => {
            const data  = d.data();
            const date  = data.paidAt?.toDate?.() || data.createdAt?.toDate?.() || null;
            if (date) {
              const key = MONTH_NAMES[date.getMonth()];
              monthMap[key] = (monthMap[key]||0) + (parseFloat(data.amount ?? data.totalAmount ?? "0")||0);
            }
          });
        const now  = new Date();
        const last6 = Array.from({length:6},(_,i)=>{
          const d = new Date(now.getFullYear(), now.getMonth()-5+i, 1);
          return MONTH_NAMES[d.getMonth()];
        });
        setRevenueTrend(last6.map(m => ({
          month:   m,
          revenue: Math.round((monthMap[m]||0) / 1000), // K units
        })));

        /* 7. Improvement Timeline — AHI + Attendance + Fee rate per month (last 6) */
        const allAttSnap    = await getDocs(query(collection(db, "attendance"),  where("schoolId","==",uid)));
        const allScoresSnap2 = await getDocs(query(collection(db, "test_scores"), where("schoolId","==",uid)));

        const now2 = new Date();
        const timelineMonths = Array.from({ length: 6 }, (_, i) => {
          const d = new Date(now2.getFullYear(), now2.getMonth() - 5 + i, 1);
          return { month: MONTH_NAMES[d.getMonth()], year: d.getFullYear(), num: d.getMonth() };
        });

        const timeline = timelineMonths.map(({ month, year, num }) => {
          // Attendance for month
          const attRecs = allAttSnap.docs
            .map(d => d.data())
            .filter(d => {
              const date = d.date ? new Date(d.date) : null;
              return date && date.getMonth() === num && date.getFullYear() === year;
            });
          const attPct = attRecs.length
            ? Math.round((attRecs.filter(r => r.status === "present").length / attRecs.length) * 100)
            : null;

          // Test scores for month
          const scoreRecs = allScoresSnap2.docs
            .map(d => d.data())
            .filter(d => {
              const ts = d.createdAt?.toDate?.() || d.timestamp?.toDate?.() || null;
              return ts && ts.getMonth() === num && ts.getFullYear() === year;
            });
          const avgScore = scoreRecs.length
            ? Math.round(scoreRecs.reduce((s, d) => s + parseFloat(d.percentage ?? d.score ?? "0"), 0) / scoreRecs.length)
            : null;

          // AHI for that month
          const ahi = avgScore != null && attPct != null
            ? Math.round(avgScore * 0.6 + attPct * 0.4)
            : avgScore ?? attPct ?? null;

          // Fee collection for month
          const feeRecs = feesSnap.docs
            .map(d => d.data())
            .filter(d => {
              const ts = d.paidAt?.toDate?.() || d.createdAt?.toDate?.() || null;
              return ts && ts.getMonth() === num && ts.getFullYear() === year;
            });
          const feePaid  = feeRecs.filter(d => (d.status || "").toLowerCase() === "paid").length;
          const feeTotal = feesSnap.docs
            .map(d => d.data())
            .filter(d => {
              const ts = d.createdAt?.toDate?.() || null;
              return ts && ts.getMonth() === num && ts.getFullYear() === year;
            }).length;
          const feeRate2 = feeTotal > 0 ? Math.round((feePaid / feeTotal) * 100) : null;

          return { month, ahi, attendance: attPct, fee: feeRate2 };
        });
        setImprovementTimeline(timeline.filter(t => t.ahi !== null || t.attendance !== null));

        // ── Save this month's snapshot for historical trend ───────────────
        const overallAtt  = activeBranches.length > 0
          ? Math.round(activeBranches.reduce((s, b) => s + b.avgAttendance, 0) / activeBranches.length) : 0;
        const overallPass = activeBranches.length > 0
          ? Math.round(activeBranches.reduce((s, b) => s + b.passRate, 0) / activeBranches.length) : 0;
        const overallFee  = activeBranches.length > 0
          ? Math.round(activeBranches.reduce((s, b) => s + b.feeRate, 0) / activeBranches.length) : 0;
        saveMonthlySnapshot(overallAHI, overallAtt, overallPass, overallFee);

      } catch(e) {
        console.error("Dashboard fetch error:", e);
      }
      setLoading(false);
      setLastRefreshed(new Date());
    };

    // ── Real-time onSnapshot for branches ─────────────────────────────────
    branchesUnsub = onSnapshot(
      collection(db, "schools", uid, "branches"),
      (snap) => {
        const docs = snap.docs.map(d => ({
          id: d.data().branchId || d.data().schoolId || d.id,
          ...d.data() as any
        }));
        invalidateCache(`core:${uid}`);
        invalidateDashboardCache();
        fetchAll(docs);
      },
      () => {
        // Fallback on permission error
        getDocs(collection(db, "schools", uid, "branches")).then(s => {
          fetchAll(s.docs.map(d => ({ id: d.data().branchId || d.id, ...d.data() as any })));
        });
      }
    );

    // ── Auto-refresh analytics data every 5 minutes ───────────────────────
    refreshTimerRef.current = setInterval(() => {
      getDocs(collection(db, "schools", uid, "branches")).then(s => {
        invalidateCache(`core:${uid}`);
        invalidateDashboardCache();
        fetchAll(s.docs.map(d => ({ id: d.data().branchId || d.id, ...d.data() as any })));
      });
    }, 5 * 60 * 1000);

    /* 7. Live alerts — try `risks`, fallback to `discipline` */
    try {
      alertsUnsub = onSnapshot(
        query(collection(db, "risks"), orderBy("createdAt","desc"), limit(5)),
        snap => {
          setAlerts(snap.docs.map(d => ({ id: d.id, ...d.data() as any })));
          setActiveAlerts(snap.size);
        }
      );
    } catch {
      alertsUnsub = onSnapshot(
        query(collection(db, "discipline"), orderBy("createdAt","desc"), limit(5)),
        snap => {
          setAlerts(snap.docs.map(d => ({ id: d.id, ...d.data() as any })));
          setActiveAlerts(snap.size);
        }
      );
    }

    return () => {
      alertsUnsub();
      branchesUnsub();
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, []);

  /* ── derived values for center of donut ────────────── */
  const lowPct = riskData.find(r=>r.name==="Low Risk")?.value ?? 0;

  const displayAlertsCount = activeAlerts;

  /* ── real month-over-month deltas from improvementTimeline ── */
  const deltas = useMemo(() => {
    if (improvementTimeline.length < 2) return { ahi: null, fee: null } as { ahi: number | null; fee: number | null };
    const last = improvementTimeline[improvementTimeline.length - 1];
    const prev = improvementTimeline[improvementTimeline.length - 2];
    return {
      ahi: last?.ahi  != null && prev?.ahi  != null ? last.ahi  - prev.ahi  : null,
      fee: last?.fee  != null && prev?.fee  != null ? last.fee  - prev.fee  : null,
    };
  }, [improvementTimeline]);

  /* ── critical alert count (severity === "critical") ── */
  const criticalAlerts = useMemo(
    () => alerts.filter(a => (a.severity || "").toLowerCase() === "critical").length,
    [alerts]
  );

  const filteredAlerts = alerts.filter(alert => {
    if (selectedAlertBranch === "all") return true;
    return alert.branchId === selectedAlertBranch || alert.schoolId === selectedAlertBranch;
  });

  // Fresh school detection (no branches and no loading)
  const isFreshSchool = !loading && branches.length === 0 && totalStudents === 0;

  // ─── Design tokens (principal dashboard system) ────────────────────────
  const B1 = "#0055FF";
  const B2 = "#1166FF";
  const T1 = "#001040";
  const T3 = "#5070B0";
  const T4 = "#99AACC";
  const SEP = "rgba(0,85,255,0.07)";
  const GREEN = "#00C853";
  const RED = "#FF3355";

  const GRAD_PRIMARY = `linear-gradient(135deg, ${B1}, ${B2})`;
  const GRAD_HERO = "linear-gradient(135deg,#001040 0%,#001888 35%,#0033CC 70%,#0055FF 100%)";
  const SHADOW_SM = "0 0 0 .5px rgba(0,85,255,.08), 0 2px 8px rgba(0,85,255,.08), 0 10px 26px rgba(0,85,255,.10)";
  const SHADOW_LG = "0 0 0 .5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.11), 0 18px 44px rgba(0,85,255,.13)";
  const SHADOW_BTN = "0 6px 22px rgba(0,85,255,.40), 0 2px 5px rgba(0,85,255,.20)";

  const ahiDelta = deltas.ahi;
  const feeDelta = deltas.fee;

  const ahiTier =
    ahi >= 85
      ? { label: "Excellent", bg: "rgba(0,200,83,.22)", border: "rgba(0,200,83,.4)", color: "#66FFAA" }
      : ahi >= 70
      ? { label: "Healthy", bg: "rgba(0,85,255,.22)", border: "rgba(0,85,255,.4)", color: "#AACCFF" }
      : ahi >= 55
      ? { label: "Average", bg: "rgba(255,170,0,.22)", border: "rgba(255,170,0,.4)", color: "#FFDD44" }
      : ahi > 0
      ? { label: "Needs Focus", bg: "rgba(255,51,85,.22)", border: "rgba(255,51,85,.4)", color: "#FF99AA" }
      : { label: "No Data", bg: "rgba(153,170,204,.18)", border: "rgba(153,170,204,.32)", color: "#CCDDEE" };

  return (
    <div
      style={{
        fontFamily: "'DM Sans', -apple-system, sans-serif",
        background: "#EEF4FF",
        minHeight: "100vh",
        margin: isMobile ? "-16px -16px 0" : "-16px -24px 0",
        padding: isMobile ? "16px 16px 32px" : "24px 32px 40px",
      }}
    >
      {/* ── Page Head ─────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: isMobile ? 12 : 20, marginBottom: isMobile ? 16 : 22, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 10 : 14, minWidth: 0 }}>
          <div
            style={{
              width: isMobile ? 40 : 48,
              height: isMobile ? 40 : 48,
              borderRadius: isMobile ? 12 : 14,
              background: GRAD_PRIMARY,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 8px 22px rgba(0,85,255,.35)",
              flexShrink: 0,
            }}
          >
            <Activity size={isMobile ? 20 : 24} color="#fff" strokeWidth={2.2} />
          </div>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ fontSize: isMobile ? 22 : 32, fontWeight: 700, color: T1, letterSpacing: "-0.8px", margin: 0, lineHeight: 1.1 }}>
              Executive Dashboard
            </h1>
            <p style={{ fontSize: isMobile ? 10 : 12, color: T3, fontWeight: 500, margin: "5px 0 0 0", letterSpacing: "0.10em", textTransform: "uppercase" }}>
              Real-time overview of all school operations
            </p>
          </div>
        </div>
        {lastRefreshed && (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              padding: "8px 14px",
              borderRadius: 14,
              background: "#fff",
              border: "0.5px solid rgba(0,85,255,.12)",
              boxShadow: SHADOW_SM,
              fontSize: 11,
              fontWeight: 700,
              color: T3,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            <div
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: GREEN,
                boxShadow: "0 0 0 3px rgba(0,200,83,.15), 0 0 10px rgba(0,200,83,.5)",
              }}
            />
            Updated {timeAgo(lastRefreshed)}
          </div>
        )}
      </div>

      {/* ── Fresh School Onboarding Banner ───────────────── */}
      {isFreshSchool && (
        <div
          style={{
            background: GRAD_HERO,
            borderRadius: isMobile ? 20 : 24,
            padding: isMobile ? "22px 20px" : "28px 32px",
            color: "#fff",
            marginBottom: isMobile ? 18 : 24,
            position: "relative",
            overflow: "hidden",
            boxShadow: "0 14px 40px rgba(0,8,60,.32), 0 0 0 .5px rgba(255,255,255,.12)",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: -60,
              right: -40,
              width: 260,
              height: 260,
              background: "radial-gradient(circle, rgba(255,255,255,.12) 0%, transparent 65%)",
              borderRadius: "50%",
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 24,
              flexWrap: "wrap",
              position: "relative",
              zIndex: 1,
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: isMobile ? 12 : 16, flex: 1, minWidth: isMobile ? 0 : 300 }}>
              <div
                style={{
                  width: isMobile ? 44 : 52,
                  height: isMobile ? 44 : 52,
                  borderRadius: isMobile ? 13 : 15,
                  background: "rgba(255,255,255,.16)",
                  border: "0.5px solid rgba(255,255,255,.26)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <GraduationCap size={isMobile ? 22 : 26} color="#fff" strokeWidth={2.2} />
              </div>
              <div style={{ minWidth: 0 }}>
                <h2 style={{ fontSize: isMobile ? 18 : 22, fontWeight: 700, letterSpacing: "-0.5px", margin: 0, color: "#fff" }}>
                  Welcome to Edullent!
                </h2>
                <p style={{ fontSize: isMobile ? 12 : 13, color: "rgba(255,255,255,.72)", fontWeight: 400, margin: "6px 0 0 0", lineHeight: 1.6 }}>
                  Your dashboard is ready. Set up branches, invite principals, and start adding data to see live analytics here.
                </p>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", width: isMobile ? "100%" : "auto" }}>
              <button
                onClick={() => navigate("/branches")}
                style={{
                  padding: "10px 20px",
                  borderRadius: 12,
                  background: "#fff",
                  color: T1,
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  border: "none",
                  cursor: "pointer",
                  boxShadow: "0 4px 12px rgba(0,0,0,.18)",
                  fontFamily: "inherit",
                  flex: isMobile ? 1 : "0 0 auto",
                }}
              >
                Add First Branch
              </button>
              <button
                onClick={() => navigate("/principals")}
                style={{
                  padding: "10px 20px",
                  borderRadius: 12,
                  background: "rgba(255,255,255,.14)",
                  color: "#fff",
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  border: "0.5px solid rgba(255,255,255,.22)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  flex: isMobile ? 1 : "0 0 auto",
                }}
              >
                Invite Principal
              </button>
            </div>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)",
              gap: 12,
              marginTop: isMobile ? 18 : 24,
              position: "relative",
              zIndex: 1,
            }}
          >
            {[
              { step: "1", label: "Add Branches" },
              { step: "2", label: "Invite Principals" },
              { step: "3", label: "Enroll Students" },
              { step: "4", label: "Start Analytics" },
            ].map((s) => (
              <div
                key={s.step}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  background: "rgba(255,255,255,.10)",
                  borderRadius: 14,
                  padding: "12px 16px",
                  border: "0.5px solid rgba(255,255,255,.14)",
                }}
              >
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: "rgba(255,255,255,.18)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#fff",
                    flexShrink: 0,
                  }}
                >
                  {s.step}
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,.80)", letterSpacing: "0.04em" }}>
                  {s.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Dark Hero Banner (AHI) ────────────────────────── */}
      {!isFreshSchool && (
        <div
          style={{
            background: GRAD_HERO,
            borderRadius: isMobile ? 20 : 24,
            padding: isMobile ? "18px 20px" : "22px 28px",
            position: "relative",
            overflow: "hidden",
            boxShadow: "0 12px 36px rgba(0,8,60,.28), 0 0 0 .5px rgba(255,255,255,.12)",
            marginBottom: isMobile ? 14 : 18,
          }}
        >
          <div
            style={{
              position: "absolute",
              top: -60,
              right: -40,
              width: 240,
              height: 240,
              background: "radial-gradient(circle, rgba(255,255,255,.12) 0%, transparent 65%)",
              borderRadius: "50%",
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "absolute",
              backgroundImage:
                "linear-gradient(rgba(255,255,255,.014) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.014) 1px,transparent 1px)",
              backgroundSize: "22px 22px",
              inset: 0,
              pointerEvents: "none",
            }}
          />
          <div style={{ display: "flex", alignItems: isMobile ? "stretch" : "center", justifyContent: "space-between", gap: isMobile ? 14 : 24, flexWrap: "wrap", position: "relative", zIndex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 12 : 16 }}>
              <div
                style={{
                  width: isMobile ? 46 : 54,
                  height: isMobile ? 46 : 54,
                  borderRadius: isMobile ? 14 : 16,
                  background: "rgba(255,255,255,.16)",
                  border: "0.5px solid rgba(255,255,255,.24)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Activity size={isMobile ? 22 : 26} color="rgba(255,255,255,.92)" strokeWidth={2.1} />
              </div>
              <div>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(255,255,255,.50)", marginBottom: 4 }}>
                  Academic Health Index
                </div>
                <div style={{ fontSize: isMobile ? 32 : 40, fontWeight: 700, color: "#fff", letterSpacing: "-1.2px", lineHeight: 1 }}>
                  {loading ? "—" : ahi}
                </div>
              </div>
            </div>

            <div
              style={{
                display: "inline-flex",
                alignSelf: isMobile ? "flex-start" : "center",
                alignItems: "center",
                gap: 6,
                padding: isMobile ? "6px 14px" : "8px 18px",
                borderRadius: 100,
                background: ahiTier.bg,
                border: `0.5px solid ${ahiTier.border}`,
                fontSize: isMobile ? 11 : 13,
                fontWeight: 700,
                color: ahiTier.color,
              }}
            >
              <TrendingUp size={isMobile ? 12 : 14} strokeWidth={2.5} />
              {ahiTier.label} tier
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 1,
                background: "rgba(255,255,255,.12)",
                borderRadius: 14,
                overflow: "hidden",
                minWidth: isMobile ? 0 : 340,
                width: isMobile ? "100%" : "auto",
              }}
            >
              {[
                { v: branches.length, l: "Branches", c: "#fff" },
                { v: totalStudents.toLocaleString(), l: "Students", c: "#AACCFF" },
                { v: `${feeRate}%`, l: "Fee Rate", c: "#66EE88" },
              ].map((s, i) => (
                <div key={i} style={{ background: "rgba(255,255,255,.08)", padding: isMobile ? "12px 10px" : "14px 18px", textAlign: "center", minWidth: isMobile ? 0 : 100 }}>
                  <div style={{ fontSize: isMobile ? 18 : 22, fontWeight: 700, color: s.c, letterSpacing: "-0.5px", lineHeight: 1, marginBottom: 4 }}>
                    {s.v}
                  </div>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,.40)" }}>
                    {s.l}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Bright Stat Grid (4 cards) ───────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : isTablet ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: isMobile ? 10 : 14, marginBottom: isMobile ? 16 : 20 }}>
        {[
          {
            title: "Academic Health Index",
            value: loading ? "—" : ahi.toString(),
            sub: ahiDelta != null ? `${ahiDelta >= 0 ? "+" : ""}${ahiDelta} vs last month` : "No prior data",
            up: ahiDelta == null ? true : ahiDelta >= 0,
            bg: "linear-gradient(140deg,#DDEAFF 0%,#A8C5FF 55%,#7AA5FF 100%)",
            border: "0.5px solid rgba(0,85,255,.4)",
            lblColor: "#002080",
            valColor: "#001055",
            subColor: "#002080",
            icon: <Activity size={18} color="#001055" strokeWidth={2.5} />,
            href: "/academics",
          },
          {
            title: "Total Students",
            value: loading ? "—" : totalStudents.toLocaleString(),
            sub: branches.length > 0 ? `Across ${branches.length} branch${branches.length !== 1 ? "es" : ""}` : "No branches yet",
            up: true,
            bg: "linear-gradient(140deg,#EEE0FF 0%,#C9A8FF 55%,#A880FF 100%)",
            border: "0.5px solid rgba(123,63,244,.4)",
            lblColor: "#3A1580",
            valColor: "#280C5C",
            subColor: "#3A1580",
            icon: <Users size={18} color="#3A1580" strokeWidth={2.5} />,
            href: "/students",
          },
          {
            title: "Fee Collection Rate",
            value: loading ? "—" : `${feeRate}%`,
            sub: feeDelta != null ? `${feeDelta >= 0 ? "+" : ""}${feeDelta}% vs last month` : "No prior data",
            up: feeDelta == null ? true : feeDelta >= 0,
            bg: "linear-gradient(140deg,#DEFCE8 0%,#8CF0B0 55%,#50E088 100%)",
            border: "0.5px solid rgba(0,200,83,.4)",
            lblColor: "#005A20",
            valColor: "#004018",
            subColor: "#005A20",
            icon: <Percent size={18} color="#005A20" strokeWidth={2.5} />,
            href: "/finance",
          },
          {
            title: "Active Alerts",
            value: loading ? "—" : displayAlertsCount.toString(),
            sub: criticalAlerts > 0 ? `${criticalAlerts} critical` : "No critical issues",
            up: criticalAlerts === 0,
            bg: criticalAlerts > 0 ? "linear-gradient(140deg,#FFE3E8 0%,#FFA8B8 55%,#FF7085 100%)" : "linear-gradient(140deg,#FFF6D1 0%,#FFE488 55%,#FFCC33 100%)",
            border: criticalAlerts > 0 ? "0.5px solid rgba(255,51,85,.4)" : "0.5px solid rgba(255,170,0,.4)",
            lblColor: criticalAlerts > 0 ? "#8A0A22" : "#664400",
            valColor: criticalAlerts > 0 ? "#60081A" : "#472A00",
            subColor: criticalAlerts > 0 ? "#8A0A22" : "#664400",
            icon: <Bell size={18} color={criticalAlerts > 0 ? "#8A0A22" : "#664400"} strokeWidth={2.5} />,
            href: "/risks",
          },
        ].map((s) => (
          <div
            key={s.title}
            onClick={() => navigate(s.href)}
            role="button"
            tabIndex={0}
            style={{
              borderRadius: isMobile ? 16 : 20,
              padding: isMobile ? 14 : 20,
              position: "relative",
              overflow: "hidden",
              background: s.bg,
              border: s.border,
              boxShadow: "0 10px 28px rgba(0,0,0,.08), 0 2px 6px rgba(0,0,0,.04)",
              cursor: "pointer",
              transition: "transform .18s cubic-bezier(.34,1.56,.64,1)",
            }}
          >
            <div style={{ position: "absolute", top: -24, right: -20, width: 110, height: 110, borderRadius: "50%", background: "radial-gradient(circle, rgba(255,255,255,.65) 0%, transparent 70%)", pointerEvents: "none" }} />
            <div style={{ position: "absolute", top: isMobile ? 12 : 16, right: isMobile ? 12 : 16, width: isMobile ? 32 : 38, height: isMobile ? 32 : 38, borderRadius: isMobile ? 10 : 12, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,.75)", border: "0.5px solid rgba(255,255,255,.95)", boxShadow: "0 2px 6px rgba(0,0,0,.05)" }}>
              {s.icon}
            </div>
            <div style={{ fontSize: isMobile ? 9 : 10, fontWeight: 700, letterSpacing: "0.10em", textTransform: "uppercase", color: s.lblColor, marginBottom: isMobile ? 8 : 12, position: "relative", zIndex: 1, paddingRight: isMobile ? 40 : 0 }}>
              {s.title}
            </div>
            {loading ? (
              <Loader2 size={isMobile ? 20 : 24} color={s.valColor} style={{ animation: "spin 1s linear infinite" }} />
            ) : (
              <>
                <div style={{ fontSize: isMobile ? 22 : 32, fontWeight: 700, color: s.valColor, letterSpacing: "-1px", lineHeight: 1, marginBottom: 6, position: "relative", zIndex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.value}
                </div>
                <div style={{ fontSize: isMobile ? 10 : 11, fontWeight: 600, color: s.subColor, position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: 4 }}>
                  {s.up ? <ArrowUpRight size={12} strokeWidth={2.5} /> : <ArrowDownRight size={12} strokeWidth={2.5} />}
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.sub}</span>
                </div>
              </>
            )}
          </div>
        ))}
        <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
      </div>

      {/* ── Middle Row ───────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : isTablet ? "repeat(2, 1fr)" : "repeat(12, 1fr)", gap: isMobile ? 12 : 14, marginBottom: isMobile ? 16 : 20 }}>

        {/* Branch Overview */}
        <div style={{ gridColumn: isMobile ? "span 1" : isTablet ? "span 1" : "span 4", background: "#fff", borderRadius: isMobile ? 20 : 24, border: "0.5px solid rgba(0,85,255,.10)", boxShadow: SHADOW_LG, padding: isMobile ? "18px 18px" : "22px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: T1, letterSpacing: "-0.2px", margin: 0 }}>Branch Overview</h3>
            {branches.length > 0 && (
              <span style={{ padding: "3px 9px", borderRadius: 100, background: "rgba(0,85,255,.10)", border: "0.5px solid rgba(0,85,255,.16)", fontSize: 10, fontWeight: 700, color: B1 }}>
                {branches.length}
              </span>
            )}
          </div>
          {loading ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 180 }}>
              <Loader2 size={24} color={T4} style={{ animation: "spin 1s linear infinite" }} />
            </div>
          ) : branches.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 180, textAlign: "center" }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: T4, margin: 0 }}>No branches found</p>
              <p style={{ fontSize: 11, color: T4, marginTop: 4 }}>Schools will appear here once registered</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {branches.map((branch) => {
                const ahiColor = branch.ahi >= 90 ? GREEN : branch.ahi >= 80 ? "#22C865" : branch.ahi >= 60 ? B1 : "#FF8800";
                const ahiBg = branch.ahi >= 90 ? "linear-gradient(135deg, #00C853, #66EE88)" : branch.ahi >= 80 ? "linear-gradient(135deg, #22C865, #50E088)" : branch.ahi >= 60 ? GRAD_PRIMARY : "linear-gradient(135deg, #FF8800, #FFAA00)";
                return (
                  <div
                    key={branch.id}
                    onClick={() => navigate("/branches")}
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", padding: "10px 14px", borderRadius: 14, border: "0.5px solid rgba(0,85,255,.07)", background: "rgba(0,85,255,.02)", transition: "background .15s" }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: T1, letterSpacing: "-0.2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {branch.name}
                      </div>
                      <div style={{ fontSize: 10, color: T4, fontWeight: 600, marginTop: 2 }}>
                        {branch.students.toLocaleString()} students
                      </div>
                    </div>
                    <div style={{ padding: "5px 12px", borderRadius: 100, fontSize: 11, fontWeight: 700, color: "#fff", background: branch.ahi > 0 ? ahiBg : "rgba(153,170,204,.7)", boxShadow: branch.ahi > 0 ? `0 3px 10px ${ahiColor}40` : "none", letterSpacing: "0.02em", whiteSpace: "nowrap", flexShrink: 0 }}>
                      {branch.ahi > 0 ? `${branch.ahi}%` : "N/A"} AHI
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Risk Distribution */}
        <div style={{ gridColumn: isMobile ? "span 1" : isTablet ? "span 1" : "span 4", background: "#fff", borderRadius: isMobile ? 20 : 24, border: "0.5px solid rgba(0,85,255,.10)", boxShadow: SHADOW_LG, padding: isMobile ? "18px 18px" : "22px 24px" }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: T1, letterSpacing: "-0.2px", margin: "0 0 18px 0" }}>Risk Distribution</h3>
          {riskData.every(r => r.value === 0) ? (
            <div style={{ height: 220, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 18, border: "0.5px dashed rgba(0,85,255,.2)", background: "rgba(0,200,83,.03)" }}>
              <div style={{ width: 48, height: 48, borderRadius: 16, background: "rgba(0,200,83,.10)", border: "0.5px solid rgba(0,200,83,.22)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <TrendingUp size={24} color={GREEN} strokeWidth={2.2} />
              </div>
              <div style={{ textAlign: "center" }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: T4, margin: 0 }}>No risk data yet</p>
                <p style={{ fontSize: 11, color: T4, marginTop: 4 }}>Appears once student data is added</p>
              </div>
            </div>
          ) : (
            <>
              <div style={{ height: 220, position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={riskData} cx="50%" cy="50%" innerRadius={70} outerRadius={100} paddingAngle={6} cornerRadius={10} dataKey="value" stroke="none" startAngle={90} endAngle={-270}>
                      {riskData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: any) => [`${v}%`, ""]} contentStyle={{ borderRadius: 14, border: "none", boxShadow: "0 10px 25px rgba(0,0,0,.10)", padding: "10px 16px" }} itemStyle={{ fontWeight: 700, fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none", marginTop: 4 }}>
                  <span style={{ fontSize: 32, fontWeight: 700, color: T1, letterSpacing: "-0.8px", lineHeight: 1 }}>{lowPct}%</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: T4, letterSpacing: "0.14em", textTransform: "uppercase", marginTop: 4 }}>Safe</span>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 18, marginTop: 14 }}>
                {riskData.map(r => (
                  <div key={r.name} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 3, background: r.color }} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: T3 }}>{r.name}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Revenue Trend */}
        <div style={{ gridColumn: isMobile ? "span 1" : isTablet ? "span 2" : "span 4", background: "#fff", borderRadius: isMobile ? 20 : 24, border: "0.5px solid rgba(0,85,255,.10)", boxShadow: SHADOW_LG, padding: isMobile ? "18px 18px" : "22px 24px" }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: T1, letterSpacing: "-0.2px", margin: "0 0 18px 0" }}>Revenue Trend</h3>
          {revenueTrend.every(r => r.revenue === 0) ? (
            <div style={{ height: 220, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 18, border: "0.5px dashed rgba(0,85,255,.2)", background: "rgba(0,85,255,.03)" }}>
              <div style={{ width: 48, height: 48, borderRadius: 16, background: "rgba(0,85,255,.10)", border: "0.5px solid rgba(0,85,255,.22)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Download size={24} color={B1} strokeWidth={2.2} />
              </div>
              <div style={{ textAlign: "center" }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: T4, margin: 0 }}>No revenue data yet</p>
                <p style={{ fontSize: 11, color: T4, marginTop: 4 }}>Appears once fee payments are recorded</p>
              </div>
            </div>
          ) : (
            <div style={{ height: isMobile ? 180 : 220, width: "100%" }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={revenueTrend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={B1} stopOpacity={0.18} />
                      <stop offset="95%" stopColor={B1} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,85,255,.08)" />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: T4, fontSize: 11, fontWeight: 700 }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: T4, fontSize: 11, fontWeight: 700 }} />
                  <Tooltip formatter={(v: any) => [`${v}K`, "Revenue"]} contentStyle={{ borderRadius: 14, border: "none", boxShadow: "0 10px 25px rgba(0,0,0,.10)", padding: "10px 14px" }} itemStyle={{ fontWeight: 700, fontSize: 12 }} />
                  <Area type="monotone" dataKey="revenue" stroke={B1} strokeWidth={3} fillOpacity={1} fill="url(#revGrad)" dot={{ r: 4, fill: B1, strokeWidth: 2, stroke: "#fff" }} activeDot={{ r: 6, strokeWidth: 0 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* ── Bottom Row ───────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 12 : 14, marginBottom: isMobile ? 16 : 20 }}>

        {/* Critical Alerts */}
        <div style={{ background: "#fff", borderRadius: isMobile ? 20 : 24, border: "0.5px solid rgba(0,85,255,.10)", boxShadow: SHADOW_LG, padding: isMobile ? "18px 18px" : "22px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: T1, letterSpacing: "-0.2px", margin: 0 }}>Critical Alerts</h3>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <select
                value={selectedAlertBranch}
                onChange={(e) => setSelectedAlertBranch(e.target.value)}
                style={{ fontSize: 11, fontWeight: 700, color: T3, background: "#fff", border: "0.5px solid rgba(0,85,255,.14)", borderRadius: 10, padding: "6px 10px", outline: "none", cursor: "pointer", fontFamily: "inherit", boxShadow: SHADOW_SM }}
              >
                <option value="all">All Branches</option>
                {branches.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
              <button
                onClick={() => navigate("/risks")}
                style={{ fontSize: 11, fontWeight: 700, color: B1, background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit", letterSpacing: "0.06em", textTransform: "uppercase" }}
              >
                View All →
              </button>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {filteredAlerts.length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 16px", textAlign: "center" }}>
                <div style={{ width: 44, height: 44, borderRadius: 14, background: "rgba(0,200,83,.10)", border: "0.5px solid rgba(0,200,83,.22)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
                  <AlertCircle size={22} color={GREEN} strokeWidth={2.2} />
                </div>
                <p style={{ fontSize: 13, fontWeight: 700, color: T4, margin: 0 }}>No critical alerts</p>
                <p style={{ fontSize: 11, color: T4, marginTop: 4 }}>Everything looks good!</p>
              </div>
            ) : (
              filteredAlerts.slice(0, 5).map((alert) => {
                const isCritical = (alert.severity || "warning") === "critical";
                const accent = isCritical ? "linear-gradient(180deg, #FF3355, #FF6688)" : "linear-gradient(180deg, #FF8800, #FFAA00)";
                const bg = isCritical ? "rgba(255,51,85,.05)" : "rgba(255,170,0,.05)";
                const iconColor = isCritical ? RED : "#FF8800";
                const iconBg = isCritical ? "rgba(255,51,85,.10)" : "rgba(255,170,0,.10)";
                const iconBorder = isCritical ? "rgba(255,51,85,.22)" : "rgba(255,170,0,.22)";
                return (
                  <div
                    key={alert.id}
                    onClick={() => navigate("/risks")}
                    style={{ position: "relative", display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderRadius: 14, background: bg, border: `0.5px solid ${iconBorder}`, cursor: "pointer", overflow: "hidden", transition: "transform .15s" }}
                  >
                    <div style={{ position: "absolute", left: 0, top: 6, bottom: 6, width: 4, borderRadius: "0 3px 3px 0", background: accent }} />
                    <div style={{ width: 34, height: 34, borderRadius: 11, background: iconBg, border: `0.5px solid ${iconBorder}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginLeft: 4 }}>
                      <AlertCircle size={16} color={iconColor} strokeWidth={2.3} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13, fontWeight: 700, color: T1, letterSpacing: "-0.1px", margin: 0, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const }}>
                        {alert.message || alert.description || alert.title || "Alert"}
                      </p>
                      <p style={{ fontSize: 10, color: T4, fontWeight: 600, marginTop: 3, margin: "3px 0 0 0" }}>
                        {alert._fallback
                          ? (alert.id === "f1" ? "2 hours ago" : alert.id === "f2" ? "5 hours ago" : "1 day ago")
                          : timeAgo(alert.createdAt)}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div style={{ background: "#fff", borderRadius: isMobile ? 20 : 24, border: "0.5px solid rgba(0,85,255,.10)", boxShadow: SHADOW_LG, padding: isMobile ? "18px 18px" : "22px 24px" }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: T1, letterSpacing: "-0.2px", margin: "0 0 16px 0" }}>Quick Actions</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: isMobile ? 10 : 12 }}>
            <button
              onClick={() => navigate("/reports")}
              style={{ display: "flex", alignItems: "center", gap: isMobile ? 10 : 12, padding: isMobile ? 14 : 18, borderRadius: 16, background: GRAD_PRIMARY, color: "#fff", border: "none", boxShadow: SHADOW_BTN, cursor: "pointer", textAlign: "left", fontFamily: "inherit", position: "relative", overflow: "hidden" }}
            >
              <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, rgba(255,255,255,.14) 0%, transparent 52%)", pointerEvents: "none" }} />
              <div style={{ padding: 10, borderRadius: 11, background: "rgba(255,255,255,.18)", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", zIndex: 1 }}>
                <Download size={18} color="#fff" strokeWidth={2.4} />
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "-0.1px", position: "relative", zIndex: 1 }}>Export Report</span>
            </button>
            <button
              onClick={() => navigate("/branches")}
              style={{ display: "flex", alignItems: "center", gap: isMobile ? 10 : 12, padding: isMobile ? 14 : 18, borderRadius: 16, background: "rgba(0,200,83,.06)", color: "#005A20", border: "0.5px solid rgba(0,200,83,.22)", cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}
            >
              <div style={{ padding: 10, borderRadius: 11, background: "rgba(0,200,83,.10)", border: "0.5px solid rgba(0,200,83,.22)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Mail size={18} color={GREEN} strokeWidth={2.4} />
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "-0.1px" }}>Message Branches</span>
            </button>
            <button
              onClick={() => navigate("/principals")}
              style={{ display: "flex", alignItems: "center", gap: isMobile ? 10 : 12, padding: isMobile ? 14 : 18, borderRadius: 16, background: "rgba(123,63,244,.06)", color: "#3A1580", border: "0.5px solid rgba(123,63,244,.22)", cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}
            >
              <div style={{ padding: 10, borderRadius: 11, background: "rgba(123,63,244,.10)", border: "0.5px solid rgba(123,63,244,.22)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Calendar size={18} color="#7B3FF4" strokeWidth={2.4} />
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "-0.1px" }}>Schedule Meeting</span>
            </button>
            <button
              onClick={() => navigate("/settings")}
              style={{ display: "flex", alignItems: "center", gap: isMobile ? 10 : 12, padding: isMobile ? 14 : 18, borderRadius: 16, background: "rgba(255,136,0,.06)", color: "#663300", border: "0.5px solid rgba(255,136,0,.22)", cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}
            >
              <div style={{ padding: 10, borderRadius: 11, background: "rgba(255,136,0,.10)", border: "0.5px solid rgba(255,136,0,.22)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Settings size={18} color="#FF8800" strokeWidth={2.4} />
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "-0.1px" }}>System Settings</span>
            </button>
          </div>
        </div>

      </div>

      {/* ── Improvement Timeline ─────────────────────────── */}
      <div style={{ background: "#fff", borderRadius: isMobile ? 20 : 24, border: "0.5px solid rgba(0,85,255,.10)", boxShadow: SHADOW_LG, padding: isMobile ? "18px 18px" : "22px 24px", marginBottom: isMobile ? 16 : 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: T1, letterSpacing: "-0.2px", margin: 0 }}>School Improvement Timeline</h3>
            <p style={{ fontSize: 11, color: T4, fontWeight: 600, margin: "4px 0 0 0", letterSpacing: "0.06em", textTransform: "uppercase" }}>
              AHI · Attendance · Fee Collection — last 6 months
            </p>
          </div>
          {improvementTimeline.length >= 2 && (() => {
            const first = improvementTimeline[0];
            const last = improvementTimeline[improvementTimeline.length - 1];
            const delta = (last.ahi ?? 0) - (first.ahi ?? 0);
            const isUp = delta > 0;
            const isFlat = delta === 0;
            const chipBg = isUp ? "rgba(0,200,83,.10)" : isFlat ? "rgba(153,170,204,.12)" : "rgba(255,51,85,.10)";
            const chipColor = isUp ? "#007830" : isFlat ? T3 : "#B01030";
            const chipBorder = isUp ? "rgba(0,200,83,.22)" : isFlat ? "rgba(153,170,204,.22)" : "rgba(255,51,85,.22)";
            return (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 100, background: chipBg, border: `0.5px solid ${chipBorder}`, fontSize: 11, fontWeight: 700, color: chipColor, letterSpacing: "0.02em" }}>
                {isFlat ? <Minus size={13} strokeWidth={2.5} /> : isUp ? <ArrowUpRight size={13} strokeWidth={2.5} /> : <ArrowDownRight size={13} strokeWidth={2.5} />}
                AHI {isUp ? "+" : ""}{delta} pts over 6 months
              </div>
            );
          })()}
        </div>

        {loading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 208 }}>
            <Loader2 size={24} color={T4} style={{ animation: "spin 1s linear infinite" }} />
          </div>
        ) : improvementTimeline.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 208, textAlign: "center", borderRadius: 18, border: "0.5px dashed rgba(0,85,255,.2)" }}>
            <TrendingUp size={32} color="rgba(0,85,255,.22)" strokeWidth={1.8} style={{ marginBottom: 10 }} />
            <p style={{ fontSize: 13, fontWeight: 700, color: T4, margin: 0 }}>No historical data yet</p>
            <p style={{ fontSize: 11, color: T4, marginTop: 4 }}>Timeline will appear as months of data accumulate</p>
          </div>
        ) : (
          <>
            <div style={{ height: isMobile ? 200 : 240, width: "100%" }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={improvementTimeline} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="ahiGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={B1} stopOpacity={0.15} />
                      <stop offset="95%" stopColor={B1} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,85,255,.08)" />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: T4, fontSize: 11, fontWeight: 700 }} dy={8} />
                  <YAxis domain={[40, 100]} axisLine={false} tickLine={false} tick={{ fill: T4, fontSize: 11, fontWeight: 700 }} />
                  <Tooltip contentStyle={{ borderRadius: 14, border: "none", boxShadow: "0 10px 25px rgba(0,0,0,.10)", padding: "10px 14px" }} itemStyle={{ fontWeight: 700, fontSize: 12 }} formatter={(v: any, name: string) => [`${v}%`, name]} />
                  <Legend wrapperStyle={{ fontSize: 11, fontWeight: 700, paddingTop: 12, color: T3 }} />
                  <Line type="monotone" dataKey="ahi" name="AHI" stroke={B1} strokeWidth={3} dot={{ r: 4, fill: B1, stroke: "#fff", strokeWidth: 2 }} activeDot={{ r: 6, strokeWidth: 0 }} connectNulls />
                  <Line type="monotone" dataKey="attendance" name="Attendance" stroke={GREEN} strokeWidth={2.5} strokeDasharray="5 3" dot={{ r: 3, fill: GREEN, stroke: "#fff", strokeWidth: 2 }} activeDot={{ r: 5, strokeWidth: 0 }} connectNulls />
                  <Line type="monotone" dataKey="fee" name="Fee Collection" stroke="#FF8800" strokeWidth={2.5} strokeDasharray="8 4" dot={{ r: 3, fill: "#FF8800", stroke: "#fff", strokeWidth: 2 }} activeDot={{ r: 5, strokeWidth: 0 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Month-over-month delta chips */}
            {improvementTimeline.length >= 2 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
                {improvementTimeline.slice(1).map((m, i) => {
                  const prev = improvementTimeline[i];
                  const delta = (m.ahi ?? 0) - (prev.ahi ?? 0);
                  const isUp = delta > 0;
                  const chipBg = isUp ? "rgba(0,200,83,.10)" : delta < 0 ? "rgba(255,51,85,.10)" : "rgba(153,170,204,.10)";
                  const chipColor = isUp ? "#007830" : delta < 0 ? "#B01030" : T4;
                  const chipBorder = isUp ? "rgba(0,200,83,.22)" : delta < 0 ? "rgba(255,51,85,.22)" : "rgba(153,170,204,.22)";
                  return (
                    <div key={m.month} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 100, fontSize: 10, fontWeight: 700, background: chipBg, color: chipColor, border: `0.5px solid ${chipBorder}`, letterSpacing: "0.02em" }}>
                      {isUp ? <ArrowUpRight size={11} strokeWidth={2.5} /> : delta < 0 ? <ArrowDownRight size={11} strokeWidth={2.5} /> : <Minus size={11} strokeWidth={2.5} />}
                      {prev.month}→{m.month}: {isUp ? "+" : ""}{delta}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Benchmarking ─────────────────────────────────── */}
      <BenchmarkCard />

    </div>
  );
}
