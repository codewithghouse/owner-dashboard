import { useState, useEffect, useRef, useMemo } from "react";
import { db, auth } from "@/lib/firebase";
import { collection, getDocs, query, where, orderBy, limit, onSnapshot, doc, getDoc, setDoc } from "firebase/firestore";
import { calculateAHI, invalidateCache, PASS_THRESHOLD_PERCENT } from "@/lib/analyticsService";
import { loadDashboardStats, invalidateDashboardCache, type CloudSchoolStats } from "@/lib/cloudAggregation";
import {
  computeFeeStats, bucketFeeHistory, normalizeFeeDoc,
  invalidateFeeHistoryCache, type FeeHistoryPoint,
} from "@/lib/feeHistoryService";
import {
  Activity, Users, Percent, Bell, Download, Settings,
  AlertCircle, Loader2, TrendingUp, ArrowUpRight, ArrowDownRight, Minus,
  GraduationCap
} from "lucide-react";
import {
  PieChart, Pie, Cell, AreaChart, Area, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from "recharts";
import { useNavigate } from "react-router-dom";
import BenchmarkCard from "@/components/BenchmarkCard";
import { tilt3D, tilt3DStyle } from "@/lib/use3DTilt";
import { useBreakpoint } from "@/hooks/useBreakpoint";

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/* ── design tokens (module-scope so they aren't re-allocated each render) ─ */
const B1 = "#0055FF";
const B2 = "#1166FF";
const T1 = "#001040";
const T3 = "#5070B0";
const T4 = "#99AACC";
const GREEN = "#00C853";
const RED = "#FF3355";
const GOLD = "#FFAA00";

const GRAD_PRIMARY = `linear-gradient(135deg, ${B1}, ${B2})`;
const GRAD_HERO = "linear-gradient(135deg,#001040 0%,#001888 35%,#0033CC 70%,#0055FF 100%)";
const SHADOW_SM = "0 0 0 .5px rgba(0,85,255,.08), 0 2px 8px rgba(0,85,255,.08), 0 10px 26px rgba(0,85,255,.10)";
const SHADOW_LG = "0 0 0 .5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.11), 0 18px 44px rgba(0,85,255,.13)";
const SHADOW_BTN = "0 6px 22px rgba(0,85,255,.40), 0 2px 5px rgba(0,85,255,.20)";

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
  const [ahi,             setAhi]             = useState<number>(0);
  const [totalStudents,   setTotalStudents]   = useState<number>(0);
  const [feeRate,         setFeeRate]         = useState<number>(0);
  const [feeCollectedAmt, setFeeCollectedAmt] = useState<number>(0);
  const [activeAlerts,    setActiveAlerts]    = useState<number>(0);

  /* ── section state ──────────────────────────────── */
  const [branches,     setBranches]     = useState<any[]>([]);
  // Risk distribution stored per-branch (key = branchId, plus "all" aggregate).
  // Lets the user toggle the donut between school-wide and branch-specific view.
  const [riskByBranch, setRiskByBranch] = useState<Map<string, { low: number; mid: number; crit: number }>>(new Map());
  const [selectedRiskBranch, setSelectedRiskBranch] = useState<string>("all");
  const [revenueTrend,        setRevenueTrend]        = useState<FeeHistoryPoint[]>([]);
  const [improvementTimeline, setImprovementTimeline] = useState<any[]>([]);
  // Number of months actually covered by the timeline. Bounded by the owner's
  // join date (account creationTime) so brand-new owners don't see hollow
  // 6-month skeletons. Capped at 6 for older accounts.
  const [timelineSpan,        setTimelineSpan]        = useState<number>(0);
  const [alerts,              setAlerts]              = useState<any[]>([]);
  const [selectedAlertBranch, setSelectedAlertBranch] = useState<string>("all");
  const [loading,             setLoading]             = useState(true);
  const [lastRefreshed,       setLastRefreshed]       = useState<Date | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Dedup the monthly-snapshot save: fetchAll runs every 5 min + on branch
  // list changes, so the "if not exists" guard alone still costs one read +
  // one round-trip per refresh. After the first successful save in this
  // session we skip entirely.
  const snapshotSavedRef = useRef(false);

  /* ── data fetch ─────────────────────────────────── */
  useEffect(() => {
    let alertsUnsub = () => {};
    let branchesUnsub = () => {};

    // ── Save monthly historical snapshot (once per month) ─────────────────
    const saveMonthlySnapshot = async (
      uid: string, ahi: number, attendance: number, passRate: number, feeRate: number,
    ) => {
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

    const fetchAll = async (uid: string, branchDocs: any[]) => {
      try {
        // ── Fast-path: server-aggregated branch stats (5min cache) ──────────
        // 95% Firestore read savings vs client-side per-branch loop.
        // Cloud fn covers branches + totals; risk/revenue/timeline still computed client-side.
        let cloudStats: CloudSchoolStats | null = null;
        try {
          const result = await loadDashboardStats();
          if (result?.branches?.length) cloudStats = result;
        } catch (err) {
          console.warn("[Dashboard] cloud aggregation failed — falling back to client-side:", err);
        }

        let activeBranches: Array<{
          id: string; name: string; students: number; ahi: number;
          avgAttendance: number; passRate: number; feeRate: number;
        }>;

        if (cloudStats) {
          // Fast path — trust the server aggregate
          activeBranches = cloudStats.branches.map((b) => ({
            id:            b.id,
            name:          b.name,
            students:      b.students,
            ahi:           b.ahi,
            avgAttendance: b.attendance,
            passRate:      b.passRate,
            feeRate:       b.feeCollection,
          }));
          setBranches(activeBranches);
          setTotalStudents(cloudStats.totals.totalStudents);
          setAhi(cloudStats.totals.avgAhi);
        } else {
          // Slow path — single query per collection (5 reads), group-by branchId
          // in memory. Replaces the old N+1 (4 reads × N branches). Students
          // counted by unique studentId via Set, so multi-class students are
          // not double-counted. `results` merged with `test_scores` to mirror
          // the cloud aggregator (some schools record exam scores in results/).
          const swallow = (label: string) => (err: unknown) => {
            console.warn(`[Dashboard] ${label} fetch failed:`, err);
            return { docs: [] as any[] } as any;
          };
          const [enrollSnap, scoresSnap, resultsSnap, attSnap, feesSnap] = await Promise.all([
            getDocs(query(collection(db, "enrollments"), where("schoolId", "==", uid))).catch(swallow("enrollments")),
            getDocs(query(collection(db, "test_scores"), where("schoolId", "==", uid))).catch(swallow("test_scores")),
            getDocs(query(collection(db, "results"),     where("schoolId", "==", uid))).catch(swallow("results")),
            getDocs(query(collection(db, "attendance"),  where("schoolId", "==", uid))).catch(swallow("attendance")),
            getDocs(query(collection(db, "fees"),        where("schoolId", "==", uid))).catch(swallow("fees")),
          ]);

          const allScoreDocs = [...scoresSnap.docs, ...resultsSnap.docs];

          const branchStudents = new Map<string, Set<string>>();
          enrollSnap.docs.forEach(d => {
            const data = d.data() as any;
            const bid = data.branchId; const sid = data.studentId;
            if (!bid || !sid) return;
            let set = branchStudents.get(bid);
            if (!set) { set = new Set(); branchStudents.set(bid, set); }
            set.add(sid);
          });

          const branchScores = new Map<string, number[]>();
          allScoreDocs.forEach(d => {
            const data = d.data() as any;
            const bid = data.branchId;
            if (!bid) return;
            const pct = parseFloat(data.percentage ?? data.score ?? "");
            if (isNaN(pct)) return;
            let arr = branchScores.get(bid);
            if (!arr) { arr = []; branchScores.set(bid, arr); }
            arr.push(pct);
          });

          const branchAtt = new Map<string, { total: number; present: number }>();
          attSnap.docs.forEach(d => {
            const data = d.data() as any;
            const bid = data.branchId;
            if (!bid) return;
            let b = branchAtt.get(bid);
            if (!b) { b = { total: 0, present: 0 }; branchAtt.set(bid, b); }
            b.total++;
            if (String(data.status || "").toLowerCase() === "present") b.present++;
          });

          const branchFees = new Map<string, { total: number; paid: number }>();
          feesSnap.docs.forEach(d => {
            const data = d.data() as any;
            const bid = data.branchId;
            if (!bid) return;
            let f = branchFees.get(bid);
            if (!f) { f = { total: 0, paid: 0 }; branchFees.set(bid, f); }
            f.total++;
            if (String(data.status || "").toLowerCase() === "paid") f.paid++;
          });

          activeBranches = branchDocs.map(school => {
            const sid = school.id;
            const sCount = branchStudents.get(sid)?.size ?? 0;
            const sArr = branchScores.get(sid) ?? [];
            const passRate = sArr.length
              ? Math.round(sArr.filter(p => p >= PASS_THRESHOLD_PERCENT).length / sArr.length * 100) : 0;
            const att = branchAtt.get(sid);
            const avgAtt = att?.total ? Math.round((att.present / att.total) * 100) : 0;
            const feeAgg = branchFees.get(sid);
            const branchFeeRate = feeAgg?.total ? Math.round((feeAgg.paid / feeAgg.total) * 100) : 0;
            return {
              id:            sid,
              name:          school.name || school.schoolName || "Branch",
              students:      sCount,
              ahi:           calculateAHI(avgAtt, passRate, branchFeeRate),
              avgAttendance: avgAtt,
              passRate,
              feeRate:       branchFeeRate,
            };
          });
          setBranches(activeBranches);

          setTotalStudents(activeBranches.reduce((s, b) => s + b.students, 0));

          setAhi(activeBranches.length > 0
            ? Math.round(activeBranches.reduce((s, b) => s + b.ahi, 0) / activeBranches.length)
            : 0);
        }

        /* 4. Risk distribution + score time-bucket — merged scoreDocs from
              `test_scores` AND `results` (mirrors cloud aggregator). Single
              pass classifies each student by their AVERAGE score; the student
              contributes to both the "all" bucket and their own branch bucket.
              The score time-bucket (used by Improvement Timeline below) is
              built in the same pass to avoid re-walking the docs later. */
        const swallowDocs = (label: string) => (err: unknown) => {
          console.warn(`[Dashboard] ${label} fetch failed:`, err);
          return { docs: [] as any[] } as any;
        };
        const [allScoresSnap, allResultsSnap] = await Promise.all([
          getDocs(query(collection(db, "test_scores"), where("schoolId", "==", uid))).catch(swallowDocs("test_scores")),
          getDocs(query(collection(db, "results"),     where("schoolId", "==", uid))).catch(swallowDocs("results")),
        ]);
        const allScoreDocs = [...allScoresSnap.docs, ...allResultsSnap.docs];

        // Robust date parser — handles Firestore Timestamp, ISO string, and Date.
        const parseDate = (raw: unknown): Date | null => {
          if (!raw) return null;
          if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
          if (typeof raw === "object" && raw !== null && typeof (raw as any).toDate === "function") {
            try { const d = (raw as any).toDate(); return d instanceof Date && !isNaN(d.getTime()) ? d : null; }
            catch { return null; }
          }
          if (typeof raw === "string" || typeof raw === "number") {
            const d = new Date(raw);
            return isNaN(d.getTime()) ? null : d;
          }
          return null;
        };
        const monthKey = (d: Date) => d.getFullYear() * 12 + d.getMonth();

        const studentScores = new Map<string, number[]>();
        const studentBranch = new Map<string, string>();
        // Tracks the timestamp of each student's most-recent score doc, so a
        // transferred student lands in their NEW branch's risk bucket instead
        // of being permanently stuck in the first branch we ever saw them in.
        const studentBranchTs = new Map<string, number>();
        const scoreBucket   = new Map<number, { sum: number; count: number }>();

        allScoreDocs.forEach(d => {
          const data = d.data();
          const sid = data.studentId || data.studentEmail || d.id;
          const pct = parseFloat(data.percentage ?? data.score ?? "");
          if (isNaN(pct)) return;

          // Risk-distribution bookkeeping (per-student, per-branch)
          const arr = studentScores.get(sid) ?? [];
          arr.push(pct);
          studentScores.set(sid, arr);

          const ts = parseDate(data.createdAt) ?? parseDate(data.timestamp);
          const tsMs = ts?.getTime() ?? 0;

          const bid = typeof data.branchId === "string" ? data.branchId : "";
          if (bid && tsMs >= (studentBranchTs.get(sid) ?? -1)) {
            studentBranch.set(sid, bid);
            studentBranchTs.set(sid, tsMs);
          }

          // Improvement-timeline bookkeeping (per-month average)
          if (ts) {
            const k = monthKey(ts);
            const b = scoreBucket.get(k) ?? { sum: 0, count: 0 };
            b.sum += pct;
            b.count++;
            scoreBucket.set(k, b);
          }
        });

        const riskMap = new Map<string, { low: number; mid: number; crit: number }>();
        const ensure = (k: string) => {
          let b = riskMap.get(k);
          if (!b) { b = { low: 0, mid: 0, crit: 0 }; riskMap.set(k, b); }
          return b;
        };
        // Pre-seed "all" + every known branch so empty branches still appear in the dropdown bucket.
        ensure("all");
        activeBranches.forEach(b => ensure(b.id));

        studentScores.forEach((vals, sid) => {
          const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
          const tier: "low" | "mid" | "crit" = avg >= 75 ? "low" : avg >= 50 ? "mid" : "crit";
          ensure("all")[tier]++;
          const bid = studentBranch.get(sid);
          if (bid) ensure(bid)[tier]++;
        });
        setRiskByBranch(riskMap);

        /* 5+6. Fees — single Firestore read, derive stats + history + timeline
                buckets from the same docs. Replaces three separate reads
                (fetchFeeStats + raw getDocs + fetchFeeHistory) that all hit the
                same query. ~66% read reduction on this section. */
        let feeRecords: ReturnType<typeof normalizeFeeDoc>[] = [];
        let feesDocs: any[] = [];
        try {
          const feesSnap = await getDocs(query(collection(db, "fees"), where("schoolId", "==", uid)));
          feesDocs = feesSnap.docs;
          feeRecords = feesDocs.map(d => normalizeFeeDoc(d.data() as Record<string, unknown>));
          const feeStats = computeFeeStats(feeRecords);
          setFeeRate(feeStats.collectionRate);
          setFeeCollectedAmt(feeStats.collectedAmt);
          setRevenueTrend(bucketFeeHistory(feeRecords));
        } catch (err) {
          console.warn("[Dashboard] fees fetch failed:", err);
          setRevenueTrend([]);
          // feeRecords/feesDocs stay empty; timeline will show no fee signal.
        }

        /* 7. Improvement Timeline — AHI + Attendance + Fee rate per month.
              Uses unified calculateAHI formula (40% att + 40% pass + 20% fee), same
              as per-branch AHI, so timeline trend matches header AHI.
              Bounded by owner join date so a new account doesn't see hollow months
              from before they ever existed. */
        // Compute the timeline window FIRST — drives the bounded attendance
        // read below, so a school with deep history doesn't trigger a
        // 200K-row scan on every refresh.
        const now2 = new Date();
        const currentKey = monthKey(now2);

        // Owner's account creation month — comes straight from Firebase auth, no
        // extra read. Falls back to `currentKey - 5` if metadata is missing
        // (matches legacy "last 6 months" behavior).
        const joinTimeStr = auth.currentUser?.metadata?.creationTime;
        const joinDate = joinTimeStr ? new Date(joinTimeStr) : null;
        const joinKey = joinDate && !isNaN(joinDate.getTime())
          ? monthKey(joinDate)
          : currentKey - 5;

        // earliestKey = max(joinMonth, currentMonth - 5). Cap span at 6 months
        // for older accounts; a brand-new account starts at its join month only.
        const earliestKey = Math.max(joinKey, currentKey - 5);
        const monthCount = Math.max(1, Math.min(6, currentKey - earliestKey + 1));

        // attendance.date is "YYYY-MM-DD" string → string ">=" works as a date
        // bound. Cuts the read from "all-time" to "last 6 months".
        const earliestY = Math.floor(earliestKey / 12);
        const earliestM = ((earliestKey % 12) + 12) % 12;
        const earliestDateStr = `${earliestY}-${String(earliestM + 1).padStart(2, "0")}-01`;
        const allAttSnap = await getDocs(query(
          collection(db, "attendance"),
          where("schoolId", "==", uid),
          where("date", ">=", earliestDateStr),
        )).catch(err => {
          console.warn("[Dashboard] attendance fetch failed:", err);
          return { docs: [] as any[] } as any;
        });

        const timelineMonths = Array.from({ length: monthCount }, (_, i) => {
          const k = earliestKey + i;
          const year = Math.floor(k / 12);
          const num = ((k % 12) + 12) % 12;
          return { month: MONTH_NAMES[num], year, num };
        });

        const attBucket = new Map<number, { total: number; present: number }>();
        allAttSnap.docs.forEach(doc => {
          const data = doc.data();
          const date = parseDate(data.date);
          if (!date) return;
          const k = monthKey(date);
          const b = attBucket.get(k) ?? { total: 0, present: 0 };
          b.total++;
          if (String(data.status || "").toLowerCase() === "present") b.present++;
          attBucket.set(k, b);
        });

        // scoreBucket was already populated in the risk-distribution pass above.

        const feePaidBucket = new Map<number, number>();   // paid count by month (paidAt)
        const feeTotalBucket = new Map<number, number>();  // total count by month (createdAt)
        feesDocs.forEach(doc => {
          const data = doc.data();
          const created = parseDate(data.createdAt);
          if (created) {
            const k = monthKey(created);
            feeTotalBucket.set(k, (feeTotalBucket.get(k) ?? 0) + 1);
          }
          const status = String(data.status || "").toLowerCase();
          if (status === "paid") {
            const paid = parseDate(data.paidAt) ?? parseDate(data.createdAt);
            if (paid) {
              const k = monthKey(paid);
              feePaidBucket.set(k, (feePaidBucket.get(k) ?? 0) + 1);
            }
          }
        });

        const timeline = timelineMonths.map(({ month, year, num }) => {
          const k = year * 12 + num;
          const att   = attBucket.get(k);
          const score = scoreBucket.get(k);
          const feeT  = feeTotalBucket.get(k) ?? 0;
          const feeP  = feePaidBucket.get(k)  ?? 0;

          const attPct   = att?.total ? Math.round((att.present / att.total) * 100) : null;
          // passRate proxy from score average (legacy timeline used same field)
          const passRate = score?.count ? Math.round((score.sum / score.count)) : null;
          const feePct   = feeT > 0 ? Math.round((feeP / feeT) * 100) : null;

          // Single AHI formula across the page — calculateAHI handles missing buckets.
          const ahiVal = calculateAHI(attPct ?? 0, passRate ?? 0, feePct ?? 0);
          const ahiOrNull = (attPct == null && passRate == null && feePct == null) ? null : ahiVal;

          return { month, ahi: ahiOrNull, attendance: attPct, fee: feePct };
        });
        // Keep month if ANY signal is present (don't drop fee-only months silently)
        setImprovementTimeline(
          timeline.filter(t => t.ahi !== null || t.attendance !== null || t.fee !== null),
        );
        setTimelineSpan(monthCount);

        // ── Save this month's snapshot for historical trend ───────────────
        // Once-per-session: skip the get+set round-trip after the first
        // successful save. The `if (!exists)` guard inside saveMonthlySnapshot
        // still protects against double-writes across sessions.
        if (!snapshotSavedRef.current && activeBranches.length > 0) {
          snapshotSavedRef.current = true;
          const overallAtt  = Math.round(activeBranches.reduce((s, b) => s + b.avgAttendance, 0) / activeBranches.length);
          const overallPass = Math.round(activeBranches.reduce((s, b) => s + b.passRate, 0) / activeBranches.length);
          const overallFee  = Math.round(activeBranches.reduce((s, b) => s + b.feeRate, 0) / activeBranches.length);
          const overallAhi  = cloudStats?.totals.avgAhi
            ?? Math.round(activeBranches.reduce((s, b) => s + b.ahi, 0) / activeBranches.length);
          saveMonthlySnapshot(uid, overallAhi, overallAtt, overallPass, overallFee);
        }

      } catch(e) {
        console.error("Dashboard fetch error:", e);
      }
      setLoading(false);
      setLastRefreshed(new Date());
    };

    // Bind all uid-dependent listeners. Called exactly once per mount.
    const start = (uid: string) => {
      // ── Real-time onSnapshot for branches ─────────────────────────────────
      // Heavy aggregate refetch is gated on the BRANCH LIST changing (count or
      // ids). Metadata-only edits (name/color tweaks) refresh the in-page
      // cards in place, without triggering a 5-collection refetch + cache
      // wipe. The 5-min interval below still catches drift in scores / fees /
      // attendance that aren't tied to a branch-doc edit.
      let prevBranchIdsKey = "";
      branchesUnsub = onSnapshot(
        collection(db, "schools", uid, "branches"),
        (snap) => {
          const docs = snap.docs.map(d => ({
            id: d.data().branchId || d.data().schoolId || d.id,
            ...d.data() as any
          }));
          const idsKey = docs.map(d => d.id).sort().join("|");
          const isFirstFire = prevBranchIdsKey === "";
          const idsChanged = idsKey !== prevBranchIdsKey;
          prevBranchIdsKey = idsKey;

          if (isFirstFire || idsChanged) {
            invalidateCache(`core:${uid}`);
            invalidateDashboardCache();
            invalidateFeeHistoryCache(uid);
            fetchAll(uid, docs);
          } else {
            // Metadata-only update — refresh names in place, skip aggregation.
            setBranches(prev => prev.map(b => {
              const fresh = docs.find(d => d.id === b.id);
              return fresh
                ? { ...b, name: (fresh.name || fresh.schoolName || b.name) as string }
                : b;
            }));
          }
        },
        () => {
          // Permission-denied fallback — one-shot read, no realtime, no gate.
          getDocs(collection(db, "schools", uid, "branches")).then(s => {
            fetchAll(uid, s.docs.map(d => ({ id: d.data().branchId || d.id, ...d.data() as any })));
          });
        }
      );

      // ── Auto-refresh analytics data every 5 minutes ───────────────────────
      // (onSnapshot above re-fires on branch edits; this poll catches drift in
      //  data not covered by branch-doc changes — e.g. new fee / attendance rows.)
      refreshTimerRef.current = setInterval(() => {
        getDocs(collection(db, "schools", uid, "branches")).then(s => {
          invalidateCache(`core:${uid}`);
          invalidateDashboardCache();
          invalidateFeeHistoryCache(uid);
          fetchAll(uid, s.docs.map(d => ({ id: d.data().branchId || d.id, ...d.data() as any })));
        });
      }, 5 * 60 * 1000);

      /* Live alerts — merge `risks` + student `incidents`, scoped by schoolId.
         Listener limit is wider than the visible card (max 5 shown) so the
         in-memory branch filter has enough headroom to still show alerts when
         the user picks a branch whose recent activity isn't in the global top 10. */
      const ALERT_QUERY_LIMIT = 30;
      let risksAlerts: any[] = [];
      let incidentAlerts: any[] = [];
      let disciplineFallbackUnsub: (() => void) | null = null;

      const mergeAndSet = () => {
        const combined = [...risksAlerts, ...incidentAlerts]
          .sort((a, b) => {
            const ta = a.createdAt?.toMillis?.() || (a.createdAt?.seconds ?? 0) * 1000;
            const tb = b.createdAt?.toMillis?.() || (b.createdAt?.seconds ?? 0) * 1000;
            return tb - ta;
          });
        setAlerts(combined);
        // Active Alerts = total open alerts (matches card title). Critical count
        // is shown separately in the sub-text + drives the card's accent color.
        setActiveAlerts(combined.length);
      };

      const risksUnsub = onSnapshot(
        query(collection(db, "risks"), where("schoolId", "==", uid), orderBy("createdAt", "desc"), limit(ALERT_QUERY_LIMIT)),
        snap => { risksAlerts = snap.docs.map(d => ({ id: d.id, ...d.data() as any })); mergeAndSet(); },
        () => {
          // Permission-denied fallback: try the legacy `discipline` collection.
          // Capture the unsub so we don't leak on cleanup.
          disciplineFallbackUnsub = onSnapshot(
            query(collection(db, "discipline"), where("schoolId", "==", uid), orderBy("createdAt", "desc"), limit(ALERT_QUERY_LIMIT)),
            s => { risksAlerts = s.docs.map(d => ({ id: d.id, ...d.data() as any })); mergeAndSet(); },
            err => console.warn("[Dashboard/discipline-fallback]", err.code),
          );
        },
      );

      const incidentsUnsub = onSnapshot(
        query(collection(db, "incidents"), where("schoolId", "==", uid), orderBy("createdAt", "desc"), limit(ALERT_QUERY_LIMIT)),
        snap => {
          incidentAlerts = snap.docs
            .map(d => ({ id: d.id, ...d.data() as any }))
            .filter(d => (d.type || "").toUpperCase() !== "POSITIVE")
            .map(d => {
              // Principal Discipline.tsx writes student as a NESTED object
              // ({ name, grade }) and severity as a flat string ("low" |
              // "medium" | "high" | "critical"). Earlier this block expected
              // flat d.studentName / d.className and inferred severity from
              // type — both wrong, so the student name never rendered and
              // every incident silently became a "warning".
              const studentName = d.student?.name ?? d.studentName ?? "";
              const studentGrade = d.student?.grade ?? d.className ?? "";
              const sev = String(d.severity || "").toLowerCase();
              return {
                ...d,
                message: studentName
                  ? `${studentName}${studentGrade ? ` · ${studentGrade}` : ""} — ${d.title || d.description || d.content || (d.type || "Incident")}`
                  : (d.title || d.description || d.content || d.type || "Student incident"),
                // Trust the doc-level severity. "high" + "critical" both bubble
                // up to the red treatment; everything else stays as warning.
                severity: (sev === "critical" || sev === "high") ? "critical" : "warning",
              };
            });
          mergeAndSet();
        },
        err => console.warn("[Dashboard/incidents]", err.code),
      );

      alertsUnsub = () => {
        risksUnsub();
        incidentsUnsub();
        disciplineFallbackUnsub?.();
      };
    };

    // App.tsx already gates this route on `auth.currentUser`, so by the time
    // Dashboard mounts the uid is guaranteed to be present. Avoids a
    // redundant onAuthStateChanged subscription + token refresh round-trip.
    const uid = auth.currentUser?.uid;
    if (uid) start(uid);

    return () => {
      alertsUnsub();
      branchesUnsub();
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, []);

  /* ── risk donut: derived from selected branch ─────── */
  const riskBucket = useMemo(
    () => riskByBranch.get(selectedRiskBranch) ?? { low: 0, mid: 0, crit: 0 },
    [riskByBranch, selectedRiskBranch],
  );
  const riskTotalCount = riskBucket.low + riskBucket.mid + riskBucket.crit;
  const riskData = useMemo(() => {
    const denom = riskTotalCount || 1;
    return [
      { name: "Low Risk", value: Math.round((riskBucket.low  / denom) * 100), color: "#22c55e" },
      { name: "Moderate", value: Math.round((riskBucket.mid  / denom) * 100), color: "#f59e0b" },
      { name: "Critical", value: Math.round((riskBucket.crit / denom) * 100), color: "#ef4444" },
    ];
  }, [riskBucket, riskTotalCount]);
  const lowPct = riskData[0].value;

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

  // Branch-aware filtering — alert.branchId is the only correct key. Compare
  // against selectedAlertBranch ("all" | branchId). schoolId is owner-scoped and
  // never matches a branch id, so it isn't part of the filter.
  const filteredAlerts = useMemo(
    () => selectedAlertBranch === "all"
      ? alerts
      : alerts.filter(a => a.branchId === selectedAlertBranch),
    [alerts, selectedAlertBranch],
  );

  // Fresh school detection — only the absence of branches matters. A school
  // with branches but zero enrolled students yet is still "set up", not fresh.
  const isFreshSchool = !loading && branches.length === 0;

  const ahiDelta = deltas.ahi;
  const feeDelta = deltas.fee;

  return (
    <div
      style={{
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        background: "#EEF4FF",
        minHeight: "100vh",
        // Mobile: no negative margin (was breaking layout into narrow right column).
        margin: isMobile ? 0 : "-32px -32px 0",
        padding: isMobile ? "8px 0 32px" : "24px 32px 40px",
        width: "100%",
        maxWidth: "100%",
        overflowX: "hidden",
        boxSizing: "border-box",
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
            <h1 style={{ fontSize: isMobile ? 20 : 28, fontWeight: 700, color: T1, letterSpacing: "-0.6px", margin: 0, lineHeight: 1.15 }}>
              Owner Dashboard
            </h1>
            <p style={{ fontSize: isMobile ? 12 : 14, color: T3, fontWeight: 500, margin: "4px 0 0 0", letterSpacing: 0 }}>
              Real-time school intelligence overview
            </p>
          </div>
        </div>
      </div>

      {/* ── Fresh School Onboarding Banner ───────────────── */}
      {isFreshSchool && (
        <div
          {...tilt3D}
          style={{
            background: GRAD_HERO,
            borderRadius: isMobile ? 20 : 24,
            padding: isMobile ? "22px 20px" : "28px 32px",
            color: "#fff",
            marginBottom: isMobile ? 18 : 24,
            position: "relative",
            overflow: "hidden",
            boxShadow: "0 14px 40px rgba(0,8,60,.32), 0 0 0 .5px rgba(255,255,255,.12)",
            ...tilt3DStyle,
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
              { step: "1", label: "Add Branches",      href: "/branches" },
              { step: "2", label: "Invite Principals", href: "/principals" },
              { step: "3", label: "Enroll Students",   href: "/students" },
              { step: "4", label: "Start Analytics",   href: "/" },
            ].map((s) => (
              <div
                key={s.step}
                onClick={() => navigate(s.href)}
                role="button"
                tabIndex={0}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  background: "rgba(255,255,255,.10)",
                  borderRadius: 14,
                  padding: "12px 16px",
                  border: "0.5px solid rgba(255,255,255,.14)",
                  cursor: "pointer",
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
          {...tilt3D}
          onClick={() => navigate("/academics")}
          role="button"
          tabIndex={0}
          style={{
            background: GRAD_HERO,
            borderRadius: isMobile ? 20 : 24,
            padding: isMobile ? "18px 20px" : "22px 28px",
            position: "relative",
            overflow: "hidden",
            boxShadow: "0 12px 36px rgba(0,8,60,.28), 0 0 0 .5px rgba(255,255,255,.12)",
            marginBottom: isMobile ? 14 : 18,
            cursor: "pointer",
            ...tilt3DStyle,
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
                { v: branches.length, l: "Branches", c: "#fff", href: "/branches" },
                { v: totalStudents.toLocaleString(), l: "Students", c: "#AACCFF", href: "/students" },
                { v: `${feeRate}%`, l: "Fee Rate", c: "#66EE88", href: "/finance" },
              ].map((s, i) => (
                <div
                  key={i}
                  onClick={(e) => { e.stopPropagation(); navigate(s.href); }}
                  role="button"
                  tabIndex={0}
                  style={{ background: "rgba(255,255,255,.08)", padding: isMobile ? "12px 10px" : "14px 18px", textAlign: "center", minWidth: isMobile ? 0 : 100, cursor: "pointer" }}
                >
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
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : isTablet ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: isMobile ? 10 : 14, marginBottom: isMobile ? 16 : 20, perspective: "1200px" }}>
        {[
          {
            title: "Academic Health Index",
            value: loading ? "—" : ahi.toString(),
            sub: ahiDelta != null ? `${ahiDelta >= 0 ? "+" : ""}${ahiDelta} vs last month` : "No prior data",
            up: ahiDelta == null ? true : ahiDelta >= 0,
            bg: "linear-gradient(135deg,#F7FAFF 0%,#EEF3FF 100%)",
            border: "0.5px solid rgba(79,70,229,.08)",
            lblColor: "#94A3B8",
            valColor: "#0F172A",
            subColor: "#64748B",
            accent: "#4F46E5",
            icon: <Activity size={20} color="#FFFFFF" strokeWidth={2.5} />,
            decoIcon: TrendingUp,
            href: "/academics",
          },
          {
            title: "Total Students",
            value: loading ? "—" : totalStudents.toLocaleString(),
            sub: branches.length > 0 ? `Across ${branches.length} branch${branches.length !== 1 ? "es" : ""}` : "No branches yet",
            up: true,
            bg: "linear-gradient(135deg,#FAF7FF 0%,#F2EBFF 100%)",
            border: "0.5px solid rgba(124,58,237,.08)",
            lblColor: "#94A3B8",
            valColor: "#0F172A",
            subColor: "#64748B",
            accent: "#7C3AED",
            icon: <Users size={20} color="#FFFFFF" strokeWidth={2.5} />,
            decoIcon: Users,
            href: "/students",
          },
          {
            title: "Fee Collection Rate",
            value: loading ? "—" : `${feeRate}%`,
            // Sub-text aligns with FinanceFees hero: shows ₹ collected + delta if available.
            sub: loading
              ? ""
              : feeDelta != null
                ? `₹${(feeCollectedAmt/1000).toFixed(1)}K collected · ${feeDelta >= 0 ? "+" : ""}${feeDelta}% vs last month`
                : `₹${(feeCollectedAmt/1000).toFixed(1)}K collected`,
            up: feeDelta == null ? true : feeDelta >= 0,
            bg: "linear-gradient(135deg,#F5FCF8 0%,#E9F8EF 100%)",
            border: "0.5px solid rgba(16,185,129,.08)",
            lblColor: "#94A3B8",
            valColor: "#0F172A",
            subColor: "#64748B",
            accent: "#10B981",
            icon: <Percent size={20} color="#FFFFFF" strokeWidth={2.5} />,
            decoIcon: TrendingUp,
            href: "/finance",
          },
          {
            title: "Active Alerts",
            value: loading ? "—" : activeAlerts.toString(),
            sub: criticalAlerts > 0 ? `${criticalAlerts} critical` : "No critical issues",
            up: criticalAlerts === 0,
            bg: criticalAlerts > 0 ? "linear-gradient(135deg,#FEF8F9 0%,#FCEAEE 100%)" : "linear-gradient(135deg,#FFFCF0 0%,#FEF5DC 100%)",
            border: criticalAlerts > 0 ? "0.5px solid rgba(220,38,38,.08)" : "0.5px solid rgba(245,158,11,.08)",
            lblColor: "#94A3B8",
            valColor: "#0F172A",
            subColor: "#64748B",
            accent: criticalAlerts > 0 ? "#DC2626" : "#F59E0B",
            icon: <Bell size={20} color="#FFFFFF" strokeWidth={2.5} />,
            decoIcon: AlertCircle,
            href: "/risks",
          },
        ].map((s) => {
          const DecoIcon = s.decoIcon;
          return (
          <div
            key={s.title}
            onClick={() => navigate(s.href)}
            role="button"
            tabIndex={0}
            {...tilt3D}
            style={{
              borderRadius: isMobile ? 16 : 20,
              padding: isMobile ? 14 : 20,
              position: "relative",
              overflow: "hidden",
              background: s.bg,
              border: s.border,
              boxShadow: SHADOW_LG,
              cursor: "pointer",
              ...tilt3DStyle,
            }}
          >
            {/* Decorative faded icon — bottom-right */}
            <div style={{ position: "absolute", bottom: isMobile ? 8 : 12, right: isMobile ? 10 : 16, color: s.accent, opacity: 0.22, pointerEvents: "none", lineHeight: 0 }}>
              <DecoIcon size={isMobile ? 48 : 64} strokeWidth={2} />
            </div>
            {/* Solid icon badge — top-left */}
            <div style={{ width: isMobile ? 36 : 44, height: isMobile ? 36 : 44, borderRadius: isMobile ? 10 : 12, display: "flex", alignItems: "center", justifyContent: "center", background: s.accent, marginBottom: isMobile ? 10 : 14, boxShadow: `0 4px 12px ${s.accent}33`, position: "relative", zIndex: 1 }}>
              {s.icon}
            </div>
            <div style={{ fontSize: isMobile ? 9 : 10, fontWeight: 700, letterSpacing: "0.10em", textTransform: "uppercase", color: s.lblColor, marginBottom: isMobile ? 6 : 8, position: "relative", zIndex: 1 }}>
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
          );
        })}
        <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
      </div>

      {/* ── Middle Row ───────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : isTablet ? "repeat(2, 1fr)" : "repeat(12, 1fr)", gap: isMobile ? 12 : 14, marginBottom: isMobile ? 16 : 20, perspective: "1200px" }}>

        {/* Branch Overview */}
        <div {...tilt3D} onClick={() => navigate("/branches")} role="button" tabIndex={0} style={{ gridColumn: isMobile ? "span 1" : isTablet ? "span 1" : "span 4", background: "#fff", borderRadius: isMobile ? 20 : 24, border: "0.5px solid rgba(0,85,255,.10)", boxShadow: SHADOW_LG, padding: isMobile ? "18px 18px" : "22px 24px", cursor: "pointer", ...tilt3DStyle }}>
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
                    onClick={(e) => { e.stopPropagation(); navigate(`/branches/${branch.id}`); }}
                    role="button"
                    tabIndex={0}
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
        <div {...tilt3D} onClick={() => navigate("/risks")} role="button" tabIndex={0} style={{ gridColumn: isMobile ? "span 1" : isTablet ? "span 1" : "span 4", background: "#fff", borderRadius: isMobile ? 20 : 24, border: "0.5px solid rgba(0,85,255,.10)", boxShadow: SHADOW_LG, padding: isMobile ? "18px 18px" : "22px 24px", cursor: "pointer", ...tilt3DStyle }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: T1, letterSpacing: "-0.2px", margin: 0 }}>Risk Distribution</h3>
            {branches.length > 0 && (
              <select
                value={selectedRiskBranch}
                onChange={(e) => setSelectedRiskBranch(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                aria-label="Filter risk distribution by branch"
                style={{ fontSize: 11, fontWeight: 700, color: T3, background: "#fff", border: "0.5px solid rgba(0,85,255,.14)", borderRadius: 10, padding: "6px 10px", outline: "none", cursor: "pointer", fontFamily: "inherit", boxShadow: SHADOW_SM }}
              >
                <option value="all">All Branches</option>
                {branches.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            )}
          </div>
          {riskTotalCount === 0 ? (
            <div style={{ height: 220, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 18, border: "0.5px dashed rgba(0,85,255,.2)", background: "rgba(0,200,83,.03)" }}>
              <div style={{ width: 48, height: 48, borderRadius: 16, background: "rgba(0,200,83,.10)", border: "0.5px solid rgba(0,200,83,.22)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <TrendingUp size={24} color={GREEN} strokeWidth={2.2} />
              </div>
              <div style={{ textAlign: "center" }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: T4, margin: 0 }}>No risk data yet</p>
                <p style={{ fontSize: 11, color: T4, marginTop: 4 }}>
                  {selectedRiskBranch === "all"
                    ? "Appears once student data is added"
                    : "No scores recorded for this branch yet"}
                </p>
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

        {/* Revenue Trend — sourced from /api Finance & Fees data (collected + pending) */}
        <div {...tilt3D} onClick={() => navigate("/finance")} role="button" tabIndex={0} style={{ gridColumn: isMobile ? "span 1" : isTablet ? "span 2" : "span 4", background: "#fff", borderRadius: isMobile ? 20 : 24, border: "0.5px solid rgba(0,85,255,.10)", boxShadow: SHADOW_LG, padding: isMobile ? "18px 18px" : "22px 24px", cursor: "pointer", ...tilt3DStyle }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 8, margin: "0 0 14px 0" }}>
            <div>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: T1, letterSpacing: "-0.2px", margin: 0 }}>Revenue Trend</h3>
              <p style={{ fontSize: 11, fontWeight: 600, color: T4, margin: "2px 0 0" }}>Last 6 months · ₹ in thousands · from Finance &amp; Fees</p>
            </div>
            {revenueTrend.length > 0 && (() => {
              const totalCollected = revenueTrend.reduce((s, r) => s + r.collected, 0);
              const totalPending   = revenueTrend.reduce((s, r) => s + r.pending, 0);
              return (
                <div style={{ display: "flex", gap: 14 }}>
                  <div style={{ textAlign: "right" }}>
                    <p style={{ fontSize: 9, fontWeight: 800, letterSpacing: "1px", color: T4, margin: 0, textTransform: "uppercase" }}>6-mo collected</p>
                    <p style={{ fontSize: 16, fontWeight: 800, color: GREEN, margin: "1px 0 0" }}>₹{totalCollected.toLocaleString()}K</p>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <p style={{ fontSize: 9, fontWeight: 800, letterSpacing: "1px", color: T4, margin: 0, textTransform: "uppercase" }}>6-mo pending</p>
                    <p style={{ fontSize: 16, fontWeight: 800, color: GOLD, margin: "1px 0 0" }}>₹{totalPending.toLocaleString()}K</p>
                  </div>
                </div>
              );
            })()}
          </div>
          {revenueTrend.length === 0 || revenueTrend.every(r => r.collected === 0 && r.pending === 0) ? (
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
            <div style={{ height: isMobile ? 200 : 240, width: "100%" }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={revenueTrend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={GREEN} stopOpacity={0.22} />
                      <stop offset="95%" stopColor={GREEN} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="penGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={GOLD} stopOpacity={0.18} />
                      <stop offset="95%" stopColor={GOLD} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,85,255,.08)" />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: T4, fontSize: 11, fontWeight: 700 }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: T4, fontSize: 11, fontWeight: 700 }} />
                  <Tooltip
                    formatter={(v: number, name: string) => [`₹${v.toLocaleString()}K`, name === "collected" ? "Collected" : "Pending"]}
                    contentStyle={{ borderRadius: 14, border: "none", boxShadow: "0 10px 25px rgba(0,0,0,.10)", padding: "10px 14px" }}
                    itemStyle={{ fontWeight: 700, fontSize: 12 }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 11, fontWeight: 700, paddingTop: 4 }}
                    iconType="circle"
                    formatter={(value: string) => value === "collected" ? "Collected" : "Pending"}
                  />
                  <Area type="monotone" dataKey="pending"   stroke={GOLD}  strokeWidth={2.5} fillOpacity={1} fill="url(#penGrad)" dot={{ r: 3, fill: GOLD,  strokeWidth: 2, stroke: "#fff" }} activeDot={{ r: 5, strokeWidth: 0 }} />
                  <Area type="monotone" dataKey="collected" stroke={GREEN} strokeWidth={3}   fillOpacity={1} fill="url(#revGrad)" dot={{ r: 4, fill: GREEN, strokeWidth: 2, stroke: "#fff" }} activeDot={{ r: 6, strokeWidth: 0 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* ── Bottom Row ───────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 12 : 14, marginBottom: isMobile ? 16 : 20, perspective: "1200px" }}>

        {/* Critical Alerts */}
        <div {...tilt3D} onClick={() => navigate("/risks")} role="button" tabIndex={0} style={{ background: "#fff", borderRadius: isMobile ? 20 : 24, border: "0.5px solid rgba(0,85,255,.10)", boxShadow: SHADOW_LG, padding: isMobile ? "18px 18px" : "22px 24px", cursor: "pointer", ...tilt3DStyle }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: T1, letterSpacing: "-0.2px", margin: 0 }}>Critical Alerts</h3>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <select
                value={selectedAlertBranch}
                onChange={(e) => setSelectedAlertBranch(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                style={{ fontSize: 11, fontWeight: 700, color: T3, background: "#fff", border: "0.5px solid rgba(0,85,255,.14)", borderRadius: 10, padding: "6px 10px", outline: "none", cursor: "pointer", fontFamily: "inherit", boxShadow: SHADOW_SM }}
              >
                <option value="all">All Branches</option>
                {branches.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
              <button
                onClick={(e) => { e.stopPropagation(); navigate("/risks"); }}
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
                <p style={{ fontSize: 13, fontWeight: 700, color: T4, margin: 0 }}>
                  {selectedAlertBranch === "all" ? "No alerts" : "No alerts for this branch"}
                </p>
                <p style={{ fontSize: 11, color: T4, marginTop: 4 }}>
                  {selectedAlertBranch === "all" ? "Everything looks good!" : "All quiet on this branch."}
                </p>
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
                    onClick={(e) => { e.stopPropagation(); navigate(`/risks/${alert.id}`); }}
                    role="button"
                    tabIndex={0}
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
                        {timeAgo(alert.createdAt)}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Quick Actions — only buttons that actually do something land here.
             Message Branches & Schedule Meeting were removed (dead navigations
             with no feature behind them). Re-add when the features ship. */}
        <div {...tilt3D} style={{ background: "#fff", borderRadius: isMobile ? 20 : 24, border: "0.5px solid rgba(0,85,255,.10)", boxShadow: SHADOW_LG, padding: isMobile ? "18px 18px" : "22px 24px", ...tilt3DStyle }}>
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
      <div {...tilt3D} onClick={() => navigate("/academics")} role="button" tabIndex={0} style={{ background: "#fff", borderRadius: isMobile ? 20 : 24, border: "0.5px solid rgba(0,85,255,.10)", boxShadow: SHADOW_LG, padding: isMobile ? "18px 18px" : "22px 24px", marginBottom: isMobile ? 16 : 20, perspective: "1200px", cursor: "pointer", ...tilt3DStyle }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: T1, letterSpacing: "-0.2px", margin: 0 }}>School Improvement Timeline</h3>
            <p style={{ fontSize: 11, color: T4, fontWeight: 600, margin: "4px 0 0 0", letterSpacing: "0.06em", textTransform: "uppercase" }}>
              AHI · Attendance · Fee Collection — {timelineSpan > 0 ? `last ${timelineSpan} month${timelineSpan === 1 ? "" : "s"}` : "since you joined"}
            </p>
          </div>
          {improvementTimeline.length >= 2 && (() => {
            const first = improvementTimeline[0];
            const last  = improvementTimeline[improvementTimeline.length - 1];
            const delta = (last.ahi ?? 0) - (first.ahi ?? 0);
            const isUp   = delta > 0;
            const isFlat = delta === 0;
            // Span = months between the first and last *data-bearing* points.
            // Honest label: matches the actual span of plotted data.
            const span = improvementTimeline.length;
            const chipBg     = isUp ? "rgba(0,200,83,.10)" : isFlat ? "rgba(153,170,204,.12)" : "rgba(255,51,85,.10)";
            const chipColor  = isUp ? "#007830" : isFlat ? T3 : "#B01030";
            const chipBorder = isUp ? "rgba(0,200,83,.22)" : isFlat ? "rgba(153,170,204,.22)" : "rgba(255,51,85,.22)";
            return (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 100, background: chipBg, border: `0.5px solid ${chipBorder}`, fontSize: 11, fontWeight: 700, color: chipColor, letterSpacing: "0.02em" }}>
                {isFlat ? <Minus size={13} strokeWidth={2.5} /> : isUp ? <ArrowUpRight size={13} strokeWidth={2.5} /> : <ArrowDownRight size={13} strokeWidth={2.5} />}
                AHI {isUp ? "+" : ""}{delta} pts over {span} month{span === 1 ? "" : "s"}
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
