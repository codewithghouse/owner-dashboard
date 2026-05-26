import React, { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { db, auth } from "@/lib/firebase";
import { collection, getDocs, query, where } from "firebase/firestore";
import {
  Users, Search, Filter, TrendingUp,
  X, Loader2,
  GraduationCap, Award, Percent, AlertTriangle, ArrowUpRight, ArrowDownRight,
  BarChart3, Activity, Sparkles, Mail
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area, LineChart, Line
} from "recharts";
import { useBreakpoint } from "@/hooks/useBreakpoint";
import { tilt3D, tilt3DStyle } from "@/lib/use3DTilt";
import { GRAD_ACCENTS } from "@/lib/dashboardTokens";

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const GRADE_COLORS = ["#1e3a8a","#2563eb","#3b82f6","#60a5fa","#93c5fd","#bfdbfe"];

/* Year-aware month key — bucketing by month NAME alone collapses May 2024
 * and May 2025 into the same cell, which silently corrupts every "last 6
 * months" trend once an owner has >12 months of data. Use this everywhere
 * we group by month. */
const monthKey = (d: Date): number => d.getFullYear() * 12 + d.getMonth();

/* Module-level cache for per-student detail. Power-users browse 50+ students
 * in a session; without this every "View" click costs 4 Firestore reads
 * (test_scores ×2 + attendance ×2). Keyed by `${ownerUid}:${sid}` so a
 * second owner signing in from the same tab can't read the first owner's
 * cache. 5-min TTL matches the cloud aggregator's freshness window. */
type DetailCacheEntry = {
  trend: { month: string; score: number; attendance: number }[];
  att30: number | null;
  attDelta: number | null;
  scoreDelta: number | null;
};
const DETAIL_CACHE_TTL_MS = 5 * 60 * 1000;
const detailCache = new Map<string, { data: DetailCacheEntry; ts: number }>();

/* normalise "6" / "Class 6" / "Grade 6" / "VI" → "Grade 6" */
function normalizeGrade(raw: string): string {
  if (!raw) return "";
  const s = raw.trim();
  const num = s.match(/\d+/);
  if (num) return `Grade ${num[0]}`;
  // roman numerals up to 12
  const roman: Record<string,string> = {
    I:"1",II:"2",III:"3",IV:"4",V:"5",VI:"6",VII:"7",
    VIII:"8",IX:"9",X:"10",XI:"11",XII:"12"
  };
  const up = s.toUpperCase();
  if (roman[up]) return `Grade ${roman[up]}`;
  return s;
}

/* ── risk helpers ───────────────────────────────────
 * Single source of truth for the score-tier visual treatment. The same
 * tier renders in 3 places (mobile card, desktop table row, detail panel
 * header) — keep all hex/gradient values here so a colour change is one
 * line, not three.
 *
 * 4 tiers: Untested (no data) → Low (≥75) → Medium (50–74) → High (<50).
 * The Untested tier is critical — without it, a student with no
 * test_scores docs gets `avgScore = 0` and falls into "High Risk" (red
 * avatar + red badge), which is misleading. They're not at-risk; they
 * just haven't been tested yet.
 *
 * Tier thresholds match `atRisk` (score>0 && score<50) and
 * `highPerformers` (score>=85) used elsewhere; "Medium" and "Low" line
 * up with the pass threshold (50) and the platform's high-performer
 * cutoff.
 */
type RiskTier = {
  label:    "Untested" | "Low" | "Medium" | "High";
  fg:       string;  // foreground hex (badge text)
  bg:       string;  // badge background tint (rgba)
  gradient: string;  // avatar circle gradient
};
const RISK_UNKNOWN: RiskTier = {
  label:    "Untested",
  fg:       "#5070B0",  // T3 — slate, intentionally neutral
  bg:       "rgba(80,112,176,.10)",
  gradient: "linear-gradient(135deg,#94A3B8 0%,#64748B 100%)",
};
const RISK_LOW: RiskTier = {
  label:    "Low",
  fg:       "#00C853",
  bg:       "rgba(0,200,83,.1)",
  gradient: "linear-gradient(135deg,#10B981 0%,#059669 100%)",
};
const RISK_MED: RiskTier = {
  label:    "Medium",
  fg:       "#FFAA00",
  bg:       "rgba(255,170,0,.1)",
  gradient: "linear-gradient(135deg,#F59E0B 0%,#D97706 100%)",
};
const RISK_HIGH: RiskTier = {
  label:    "High",
  fg:       "#FF3355",
  bg:       "rgba(255,51,85,.1)",
  gradient: "linear-gradient(135deg,#FF3355 0%,#DC2626 100%)",
};
function getRisk(score: number): RiskTier {
  // No-data check FIRST — distinguish untested from actual zero. Without
  // this gate, every untested student is wrongly painted red.
  if (!score || score <= 0) return RISK_UNKNOWN;
  if (score >= 75)          return RISK_LOW;
  if (score >= 50)          return RISK_MED;
  return RISK_HIGH;
}

function getInitials(name: string) {
  return (name || "?").split(" ").map(n=>n[0]).join("").toUpperCase().slice(0,2);
}

const PAGE_SIZE = 10;

export default function StudentsIntelligence() {
  const navigate = useNavigate();
  const isMobile = useBreakpoint() === "mobile";
  /* ── raw data ───────────────────────────────────── */
  const [students,   setStudents]   = useState<any[]>([]);
  // branchId → branchName, sourced from the schools/{ownerUid}/branches
  // subcollection. Drives the branch dropdowns + table/heatmap labels.
  const [branches,   setBranches]   = useState<Map<string,string>>(new Map());
  // heatRaw: branchName → grade → {p, t}
  const [heatRaw,    setHeatRaw]    = useState<Map<string, Map<string,{p:number;t:number}>>>(new Map());
  // studentIds whose score / attendance docs carry an orphan branchId
  // (empty, or not present in the canonical branches subcollection). Drives
  // the virtual "Unassigned" entry in the branch filter — even when the
  // student's enrollment IS clean, this surfaces them so the founder can
  // audit data hygiene across all three sources (matches AcademicsOverview
  // behaviour, 2026-05-26).
  const [orphanStudentIds, setOrphanStudentIds] = useState<Set<string>>(new Set());
  const [loading,    setLoading]    = useState(true);

  /* ── UI state ───────────────────────────────────── */
  const [search,      setSearch]      = useState("");
  const [page,        setPage]        = useState(1);
  const [selected,    setSelected]    = useState<any | null>(null);
  // Single page-level branch filter — drives EVERY card, chart, table row,
  // heatmap row, AI summary, hero subtitle. Replaces the earlier per-card
  // dropdowns that let one card show all-branch data while the table next
  // to it showed a single branch (confusing).
  const [pageBranch,   setPageBranch]   = useState<string>("All");
  // Secondary filters surfaced via the Filter popover. scoreFilter mirrors
  // the stat-card drill-throughs ("At Risk" card → scoreFilter="atRisk").
  // gradeFilter is set when the user clicks a slice of the Grade
  // Distribution pie.
  type ScoreFilter = "all" | "atRisk" | "medium" | "high";
  const [scoreFilter,  setScoreFilter]  = useState<ScoreFilter>("all");
  const [gradeFilter,  setGradeFilter]  = useState<string | null>(null);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  // Filter button bounding rect — captured on open so the portal-rendered
  // popover can anchor under the button on desktop. We portal the popover
  // out of the table card because that card has a tilt3D transform; CSS
  // `position: fixed` is broken inside any transformed ancestor (it gets
  // re-anchored to the transformed element rather than the viewport).
  const filterBtnRef = useRef<HTMLButtonElement | null>(null);
  const [filterAnchor, setFilterAnchor] = useState<{ top: number; right: number } | null>(null);
  const openFilterMenu = () => {
    const r = filterBtnRef.current?.getBoundingClientRect();
    if (r) setFilterAnchor({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) });
    setFilterMenuOpen(true);
  };

  /* ── per-student detail data ─────────────────────── */
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTrend,   setDetailTrend]   = useState<{ month: string; score: number; attendance: number }[]>([]);
  const [attDelta,      setAttDelta]      = useState<number | null>(null);   // % diff last30 vs prev30
  const [scoreDelta,    setScoreDelta]    = useState<number | null>(null);   // pts diff last 2 exams
  const [att30,         setAtt30]         = useState<number | null>(null);   // last-30-day att %
  // Tracks the latest selected student id. If the user clicks A → B → C
  // quickly, A's slow response can land after C and overwrite the panel
  // with stale data; the detail effect drops any response whose sid no
  // longer matches this ref.
  const lastDetailSidRef = useRef<string | null>(null);

  /* ── fetch everything ───────────────────────────── */
  useEffect(() => {
    const go = async () => {
      try {
        const ownerUid = auth.currentUser?.uid;
        if (!ownerUid) { setLoading(false); return; }

        // Branches first — needed to build branchMap before resolving
        // attendance/enrollment branch labels in the parallel pass below.
        const branchMap = new Map<string, string>(); // branchId → branchName
        const branchSnap = await getDocs(
          collection(db, "schools", ownerUid, "branches")
        );
        branchSnap.docs.forEach(d => {
          const data = d.data() as any;
          const bname = data.name || data.branchName || "";
          const bid   = data.branchId || d.id;
          if (bname && bid) branchMap.set(bid, bname);
        });
        setBranches(branchMap);

        // Bound attendance to last 12 months — heatmap reflects the current
        // pattern, not all-time history. attendance.date is a "YYYY-MM-DD"
        // string so a string ">=" comparison works as a date bound and lets
        // Firestore use the (schoolId, date) index. Cuts a 200K+-doc scan
        // to typically 30K-60K on busy schools.
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        const attCutoff = `${oneYearAgo.getFullYear()}-${String(oneYearAgo.getMonth() + 1).padStart(2, "0")}-01`;

        // Parallel fetch — 4 reads dispatch concurrently. Initial load
        // latency drops from sum(latencies) to max(latencies) (~4× faster
        // on cold cache). swallow() keeps a single failed collection from
        // blanking the whole page.
        const swallow = (label: string) => (err: unknown) => {
          console.warn(`[StudentsIntelligence] ${label} fetch failed:`, err);
          return { docs: [] as any[] } as any;
        };
        const [enrollSnap, scoresSnap, attSnap, discSnap] = await Promise.all([
          getDocs(query(collection(db, "enrollments"), where("schoolId", "==", ownerUid))).catch(swallow("enrollments")),
          getDocs(query(collection(db, "test_scores"), where("schoolId", "==", ownerUid))).catch(swallow("test_scores")),
          getDocs(query(
            collection(db, "attendance"),
            where("schoolId", "==", ownerUid),
            where("date", ">=", attCutoff),
          )).catch(swallow("attendance")),
          getDocs(query(collection(db, "discipline"), where("schoolId", "==", ownerUid))).catch(swallow("discipline")),
        ]);

        const enrollments = enrollSnap.docs.map(d => ({ _eid: d.id, ...d.data() as any }));

        // Track students whose score OR attendance docs have an orphan
        // branchId (missing, or not in branchMap). Used to surface a
        // virtual "Unassigned" option in the page filter dropdown even
        // when enrolments are clean.
        const orphanIds = new Set<string>();
        const isOrphanBid = (bid: any): boolean => {
          if (!bid || typeof bid !== "string") return true;
          return !branchMap.has(bid);
        };
        // Orphan enrolment also flags the student so "Unassigned" filter
        // picks up enrolment-orphan students too.
        enrollments.forEach(e => {
          const sid = e.studentId || e.studentEmail || e._eid;
          if (!sid) return;
          if (isOrphanBid(e.branchId)) orphanIds.add(sid);
        });

        const scoreMap = new Map<string, number[]>();
        scoresSnap.docs.forEach(d => {
          const data = d.data() as any;
          const key  = data.studentId || data.studentEmail || "";
          const pct  = parseFloat(data.percentage ?? data.score ?? "");
          if (!key) return;
          if (isOrphanBid(data.branchId)) orphanIds.add(key);
          if (!isNaN(pct)) {
            if (!scoreMap.has(key)) scoreMap.set(key, []);
            scoreMap.get(key)!.push(pct);
          }
        });

        /* student→grade and student→branchId lookup from enrollments.
         * stuBranchMap stores branchId ONLY — branchMap is keyed by
         * branchId, so storing schoolId here would never resolve. Missing
         * branchIds are auto-backfilled by the enforceBranchId_* cloud
         * trigger within ~1-2s (memory: branchid_inference_lag). */
        const stuGradeMap  = new Map<string,string>();
        const stuBranchMap = new Map<string,string>();
        enrollments.forEach(e => {
          const sid = e.studentId || e.studentEmail || e._eid;
          const g   = normalizeGrade(e.grade || e.class || e.className || "");
          if (g)          stuGradeMap.set(sid, g);
          if (e.branchId) stuBranchMap.set(sid, e.branchId);
        });

        /* studentId → { present, total } for per-student attendance % */
        const attMap   = new Map<string,{p:number;t:number}>();
        /* branchName → grade → { present, total } for heatmap */
        const heatMap  = new Map<string, Map<string,{p:number;t:number}>>();

        attSnap.docs.forEach((d: any) => {
          const data    = d.data() as any;
          const sid     = data.studentId || data.studentEmail || "";
          if (!sid) return;
          if (isOrphanBid(data.branchId)) orphanIds.add(sid);

          if (!attMap.has(sid)) attMap.set(sid, {p:0,t:0});
          const cur = attMap.get(sid)!;
          cur.t++;
          const isPresent = (data.status||"").toLowerCase() === "present";
          if (isPresent) cur.p++;

          const bid    = data.branchId || stuBranchMap.get(sid) || "";
          const branch = branchMap.get(bid) || data.schoolName || "";
          const grade  = normalizeGrade(data.grade || data.class || stuGradeMap.get(sid) || "");
          if (!branch || !grade) return;

          if (!heatMap.has(branch)) heatMap.set(branch, new Map());
          const gm = heatMap.get(branch)!;
          if (!gm.has(grade)) gm.set(grade, {p:0,t:0});
          const hc = gm.get(grade)!;
          hc.t++;
          if (isPresent) hc.p++;
        });

        setHeatRaw(heatMap);

        const discMap = new Map<string,number>();
        discSnap.docs.forEach((d: any) => {
          const key = (d.data() as any).studentId || (d.data() as any).studentEmail || "";
          if (key) discMap.set(key, (discMap.get(key)||0)+1);
        });

        /* enrich enrollment rows + dedup by studentId.
         *
         * `enrollments` is one doc per (student, class) pair, so a student
         * enrolled in 3 classes produces 3 rows. Dedup by studentId so the
         * table shows each student exactly once. We pick the MOST RECENT
         * enrollment as canonical (latest createdAt wins) — fresh class
         * assignments overwrite older ones in the visible row, and the
         * `classCount` field tracks the multi-class case for future UI.
         *
         * Score / attendance / incidents are already per-student
         * aggregates (the upstream maps key by studentId), so collapsing
         * rows doesn't lose any data — only stops the visual duplication.
         */
        const enrichedMap = new Map<string, any>();
        enrollments.forEach(e => {
          const sid    = e.studentId || e.studentEmail || e._eid;
          const scores = scoreMap.get(sid) || [];
          const avgScore = scores.length
            ? Math.round(scores.reduce((a,b)=>a+b,0)/scores.length)
            : 0;
          const att    = attMap.get(sid);
          const attPct = att && att.t > 0 ? Math.round((att.p/att.t)*100) : 0;
          const incidents = discMap.get(sid) || 0;
          const ts =
            e.createdAt?.toMillis?.() ??
            (typeof e.createdAt?.seconds === "number" ? e.createdAt.seconds * 1000 : 0);

          const row = {
            id:          sid,
            _eid:        e._eid,
            name:        e.studentName || e.name || "Unknown",
            grade:       normalizeGrade(e.grade || e.class || e.className || "") || "—",
            schoolId:    e.schoolId || "",
            // Orphan enrollments (no branchId AND no schoolName) get
            // routed to "Unassigned" so they show up in the page filter
            // dropdown — earlier the em-dash sentinel was excluded by
            // the dropdown builder and these students were unreachable
            // unless "All" was selected. Matches the AcademicsOverview +
            // AIPredictor pattern (2026-05-26).
            branch:      branchMap.get(e.branchId) || e.schoolName || "Unassigned",
            score:       avgScore,
            attendance:  attPct,
            incidents,
            createdAt:   e.createdAt,
            _ts:         ts,
            classCount:  1,
          };

          const existing = enrichedMap.get(sid);
          if (!existing) {
            enrichedMap.set(sid, row);
          } else {
            // Multi-class student — bump the count, keep most-recent enrollment as canonical.
            existing.classCount += 1;
            if (ts > (existing._ts ?? 0)) {
              // Replace canonical fields with the fresher enrollment.
              const preservedCount = existing.classCount;
              enrichedMap.set(sid, { ...row, classCount: preservedCount });
            }
          }
        });

        const enriched = [...enrichedMap.values()];
        enriched.sort((a,b)=>(a.name||"").localeCompare(b.name||""));
        setStudents(enriched);
        setOrphanStudentIds(orphanIds);
      } catch(e) {
        console.error(e);
      }
      setLoading(false);
    };
    go();
  }, []);

  /* ── branch-scoped student set ───────────────────────
   * Single source of truth for "students currently in scope". Every top
   * card, hero stat, chart, AI summary derives from this — selecting a
   * branch in the page-head dropdown filters the entire page coherently
   * (no more "card shows X but table shows Y" confusion). */
  const branchScopedStudents = useMemo(
    () => {
      if (pageBranch === "All") return students;
      if (pageBranch === "Unassigned") {
        // Match by orphan-data set (covers students whose enrolment is
        // clean but whose score/attendance docs lack a canonical branchId)
        // PLUS any student whose enrolment itself resolved to "Unassigned".
        return students.filter(s => orphanStudentIds.has(s.id) || s.branch === "Unassigned");
      }
      return students.filter(s => s.branch === pageBranch);
    },
    [students, pageBranch, orphanStudentIds],
  );

  /* ── derived stats (all branch-scoped) ─────────── */
  const totalEnrollment = branchScopedStudents.length;

  const avgAttendance = useMemo(() => {
    const list = branchScopedStudents.filter(s=>s.attendance>0);
    return list.length ? Math.round(list.reduce((s,x)=>s+x.attendance,0)/list.length*10)/10 : 0;
  }, [branchScopedStudents]);

  const atRisk = useMemo(
    () => branchScopedStudents.filter(s=>s.score>0 && s.score<50).length,
    [branchScopedStudents],
  );

  const highPerformers = useMemo(
    () => branchScopedStudents.filter(s=>s.score>=85).length,
    [branchScopedStudents],
  );

  /* New enrollments this term — students with createdAt in last 4 months */
  const newThisTerm = useMemo(() => {
    const cutoff = Date.now() - (120 * 24 * 60 * 60 * 1000);
    return branchScopedStudents.filter(s => {
      const d = s.createdAt?.toDate?.();
      return d && d.getTime() >= cutoff;
    }).length;
  }, [branchScopedStudents]);

  /* ── grade distribution for pie (branch-scoped) ── */
  const gradeDistData = useMemo(() => {
    const map: Record<string,number> = {};
    branchScopedStudents.forEach(s => { map[s.grade] = (map[s.grade]||0)+1; });
    return Object.entries(map)
      .sort((a,b)=>b[1]-a[1])
      .slice(0,6)
      .map(([name,value],i)=>({ name, value, fill: GRADE_COLORS[i]||"#94a3b8" }));
  }, [branchScopedStudents]);

  /* ── enrollment trend (last 6 months, year-aware, branch-scoped) ─ */
  const enrollTrend = useMemo(() => {
    const counts = new Map<number, number>();
    branchScopedStudents.forEach(s => {
      const d = s.createdAt?.toDate?.();
      if (!d) return;
      const k = monthKey(d);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    });
    const nowKey = monthKey(new Date());
    return Array.from({ length: 6 }, (_, i) => {
      const k = nowKey - 5 + i;
      const monthIdx = ((k % 12) + 12) % 12;
      return { month: MONTH_NAMES[monthIdx], value: counts.get(k) ?? 0 };
    });
  }, [branchScopedStudents]);

  /* ── performance by branch ─────────────────────────
   * Cross-branch comparison chart — intentionally uses ALL students even
   * when a branch filter is active, so the user can see how the selected
   * branch compares to its peers. */
  const perfByBranch = useMemo(() => {
    const map: Record<string,number[]> = {};
    students.forEach(s => {
      if (!s.branch || s.branch==="—" || !s.score) return;
      if (!map[s.branch]) map[s.branch]=[];
      map[s.branch].push(s.score);
    });
    return Object.entries(map).map(([branch,scores])=>({
      branch: branch.length > 8 ? branch.split(" ")[0] : branch,
      fullBranch: branch,
      value: Math.round(scores.reduce((a,b)=>a+b,0)/scores.length),
    }));
  }, [students]);

  /* ── branch list for dropdowns — from branches subcollection ── */
  // Union of canonical branches (subcollection) + any branch label that
  // appears on a student row + a virtual "Unassigned" entry whenever the
  // page has detected orphan-branchId data in scores/attendance (mirrors
  // the AcademicsOverview audit). Selecting "Unassigned" filters to
  // students whose own enrolment is orphan OR who have score/attendance
  // docs without a canonical branchId — surfaces them for cleanup even
  // when their enrolment was tagged correctly.
  const branchList = useMemo(() => {
    const set = new Set<string>();
    branches.forEach(name => { if (name) set.add(name); });
    students.forEach(s => { if (s.branch && s.branch !== "—" && s.branch !== "Unassigned") set.add(s.branch); });
    const list = ["All", ...[...set].sort()];
    if (orphanStudentIds.size > 0) list.push("Unassigned");
    return list;
  }, [branches, students, orphanStudentIds]);

  /* ── attendance heatmap — branch-scoped via pageBranch ── */
  const heatmapGrades = useMemo(() => {
    const gradeSet = new Set<string>();
    if (pageBranch !== "All") {
      heatRaw.get(pageBranch)?.forEach((_, g) => gradeSet.add(g));
    } else {
      heatRaw.forEach(gm => gm.forEach((_, g) => gradeSet.add(g)));
    }
    return [...gradeSet].sort((a, b) => {
      const na = parseInt(a.match(/\d+/)?.[0] || "0");
      const nb = parseInt(b.match(/\d+/)?.[0] || "0");
      return na - nb;
    });
  }, [heatRaw, pageBranch]);

  const heatmapData = useMemo(() => {
    const rows: { branch: string; cells: number[] }[] = [];
    const source: [string, Map<string, { p: number; t: number }>][] =
      pageBranch !== "All"
        ? heatRaw.has(pageBranch) ? [[pageBranch, heatRaw.get(pageBranch)!]] : []
        : [...heatRaw.entries()];
    source.forEach(([branch, gradeMap]) => {
      rows.push({
        branch,
        cells: heatmapGrades.map(grade => {
          const entry = gradeMap.get(grade);
          return entry && entry.t > 0 ? Math.round((entry.p / entry.t) * 100) : 0;
        }),
      });
    });
    return rows;
  }, [heatRaw, heatmapGrades, pageBranch]);

  /* ── filtered & paginated ─────────────────────────
   * Table starts from `branchScopedStudents` (page-level branch filter)
   * then layers on search + secondary filters (score-tier from stat-card
   * drill-throughs, grade from pie-slice clicks). Each filter is
   * independent so the user can stack them.
   */
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return branchScopedStudents.filter(s => {
      if (q && !(s.name || "").toLowerCase().includes(q)) return false;
      if (gradeFilter && s.grade !== gradeFilter) return false;
      if (scoreFilter === "atRisk" && !(s.score > 0 && s.score < 50)) return false;
      if (scoreFilter === "medium" && !(s.score >= 50 && s.score < 75)) return false;
      if (scoreFilter === "high"   && !(s.score >= 85)) return false;
      return true;
    });
  }, [branchScopedStudents, search, gradeFilter, scoreFilter]);

  /* Reset pagination whenever an upstream filter changes — otherwise the
   * user can land on page 4 of an empty filtered list. */
  useEffect(() => { setPage(1); }, [pageBranch, scoreFilter, gradeFilter, search]);

  /* Convenience flag — anything beyond default scope is "active" */
  const filtersActive = pageBranch !== "All" || scoreFilter !== "all" || gradeFilter !== null;
  const clearAllFilters = () => {
    setPageBranch("All");
    setScoreFilter("all");
    setGradeFilter(null);
    setSearch("");
  };

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageStudents = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page],
  );

  /* group by first letter */
  const grouped = useMemo(() => {
    const map: Record<string,any[]> = {};
    pageStudents.forEach(s => {
      const key = (s.name||"?")[0].toUpperCase();
      if (!map[key]) map[key]=[];
      map[key].push(s);
    });
    return Object.entries(map).sort(([a],[b])=>a.localeCompare(b));
  }, [pageStudents]);

  /* ── fetch real per-student detail when selection changes ── */
  useEffect(() => {
    if (!selected) return;

    const sid = selected.id; // studentId or studentEmail
    const ownerUid = auth.currentUser?.uid;
    if (!ownerUid) return;

    lastDetailSidRef.current = sid;
    const cacheKey = `${ownerUid}:${sid}`;

    // Cache hit → paint immediately, no spinner flash, no Firestore reads.
    const cached = detailCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < DETAIL_CACHE_TTL_MS) {
      setDetailTrend(cached.data.trend);
      setAtt30(cached.data.att30);
      setAttDelta(cached.data.attDelta);
      setScoreDelta(cached.data.scoreDelta);
      setDetailLoading(false);
      return;
    }

    setDetailLoading(true);
    setDetailTrend([]);
    setAttDelta(null);
    setScoreDelta(null);
    setAtt30(null);

    const fetchDetail = async () => {
      // schoolId scope is mandatory: studentId / studentEmail can collide
      // across tenants, so without this filter the query would surface
      // another school's data. Aligns with the platform-wide security
      // hardening sweep (memory: security_hardening_apr18).
      try {
        const now      = new Date();
        const ms30     = 30 * 24 * 60 * 60 * 1000;
        const cut30    = new Date(now.getTime() - ms30);
        const cut60    = new Date(now.getTime() - ms30 * 2);

        /* ── 1. test_scores for this student (schoolId-scoped) ── */
        const [byId, byEmail] = await Promise.all([
          getDocs(query(collection(db, "test_scores"),
            where("schoolId", "==", ownerUid),
            where("studentId", "==", sid))),
          getDocs(query(collection(db, "test_scores"),
            where("schoolId", "==", ownerUid),
            where("studentEmail", "==", sid))),
        ]);
        // deduplicate by doc id
        const seenScore = new Set<string>();
        const scoreDocs: any[] = [];
        [...byId.docs, ...byEmail.docs].forEach(d => {
          if (!seenScore.has(d.id)) { seenScore.add(d.id); scoreDocs.push({ _id: d.id, ...d.data() as any }); }
        });
        // sort ascending by timestamp (field name is "timestamp" in test_scores)
        scoreDocs.sort((a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0));

        /* last-2-exam delta — computed as a local; state set in the
         * race-guarded apply block at the end of this fetch. */
        const pcts = scoreDocs
          .map(d => parseFloat(d.percentage ?? d.score ?? ""))
          .filter(n => !isNaN(n));
        const localScoreDelta = pcts.length >= 2
          ? Math.round(pcts[pcts.length - 1] - pcts[pcts.length - 2])
          : null;

        /* month-wise average score — last 6 months (year-aware key) */
        const scoreByMonth = new Map<number, number[]>();
        scoreDocs.forEach(d => {
          // date field is "timestamp" (Firestore Timestamp)
          const date = d.timestamp?.toDate?.();
          if (!date) return;
          const k = monthKey(date);
          const pct = parseFloat(d.percentage ?? d.score ?? "");
          if (!isNaN(pct)) {
            if (!scoreByMonth.has(k)) scoreByMonth.set(k, []);
            scoreByMonth.get(k)!.push(pct);
          }
        });

        /* ── 2. attendance for this student (schoolId-scoped) ── */
        const [attById, attByEmail] = await Promise.all([
          getDocs(query(collection(db, "attendance"),
            where("schoolId", "==", ownerUid),
            where("studentId", "==", sid))),
          getDocs(query(collection(db, "attendance"),
            where("schoolId", "==", ownerUid),
            where("studentEmail", "==", sid))),
        ]);
        // deduplicate
        const seenAtt = new Set<string>();
        const attDocs: any[] = [];
        [...attById.docs, ...attByEmail.docs].forEach(d => {
          if (!seenAtt.has(d.id)) { seenAtt.add(d.id); attDocs.push(d.data() as any); }
        });

        /* last-30-day vs prev-30-day attendance % + year-aware monthly bucket */
        let l30p = 0, l30t = 0, p30p = 0, p30t = 0;
        const attByMonth = new Map<number, { p: number; t: number }>();

        attDocs.forEach(d => {
          // "date" is stored as "YYYY-MM-DD" string; "timestamp" is Firestore Timestamp
          let date: Date | null = null;
          if (d.timestamp?.toDate) {
            date = d.timestamp.toDate();
          } else if (typeof d.date === "string" && d.date) {
            date = new Date(d.date + "T00:00:00");
          }
          const isPresent = (d.status || "").toLowerCase() === "present";

          if (date && !isNaN(date.getTime())) {
            if (date >= cut30)       { l30t++; if (isPresent) l30p++; }
            else if (date >= cut60)  { p30t++; if (isPresent) p30p++; }

            const k = monthKey(date);
            if (!attByMonth.has(k)) attByMonth.set(k, { p: 0, t: 0 });
            const m = attByMonth.get(k)!;
            m.t++;
            if (isPresent) m.p++;
          }
        });

        const localAtt30   = l30t > 0 ? Math.round((l30p / l30t) * 100) : null;
        const localPrev30  = p30t > 0 ? Math.round((p30p / p30t) * 100) : null;
        const localAttDelta = localAtt30 !== null && localPrev30 !== null
          ? localAtt30 - localPrev30 : null;

        /* ── 3. build trend: last 6 months (year-aware) ── */
        const nowKey = monthKey(now);
        const localTrend = Array.from({ length: 6 }, (_, i) => {
          const k = nowKey - 5 + i;
          const monthIdx = ((k % 12) + 12) % 12;
          const sc = scoreByMonth.get(k);
          const at = attByMonth.get(k);
          return {
            month:      MONTH_NAMES[monthIdx],
            score:      sc ? Math.round(sc.reduce((a, b) => a + b, 0) / sc.length) : 0,
            attendance: at && at.t > 0 ? Math.round((at.p / at.t) * 100) : 0,
          };
        });

        // Race guard — if the user picked a different student mid-fetch,
        // drop this response so it can't overwrite the panel with stale data.
        if (lastDetailSidRef.current !== sid) return;

        setScoreDelta(localScoreDelta);
        setAtt30(localAtt30);
        setAttDelta(localAttDelta);
        setDetailTrend(localTrend);

        // Cache for the rest of the session — repeat clicks on the same
        // student within 5 min skip the 4 Firestore reads entirely.
        detailCache.set(cacheKey, {
          data: {
            trend:      localTrend,
            att30:      localAtt30,
            attDelta:   localAttDelta,
            scoreDelta: localScoreDelta,
          },
          ts: Date.now(),
        });
      } catch (e) {
        console.error(e);
      }
      // Only the latest fetch should clear the spinner; otherwise an old
      // fetch could flicker the loading state off mid-flight for a newer one.
      if (lastDetailSidRef.current === sid) setDetailLoading(false);
    };

    fetchDetail();
  }, [selected?.id]);

  /* ─── Design tokens (principal/owner dashboard system) ─── */
  const B1 = "#0055FF", B2 = "#1166FF";
  const T1 = "#001040", T3 = "#5070B0", T4 = "#99AACC";
  const GREEN = "#00C853", RED = "#FF3355", GOLD = "#FFAA00", VIOLET = "#7B3FF4";
  const GRAD_PRIMARY = `linear-gradient(135deg, ${B1}, ${B2})`;
  const GRAD_HERO = "linear-gradient(135deg,#001040 0%,#001888 35%,#0033CC 70%,#0055FF 100%)";
  const GRAD_BLUE   = "linear-gradient(135deg,#F7FAFF 0%,#EEF3FF 100%)";
  const GRAD_GREEN  = "linear-gradient(135deg,#F5FCF8 0%,#E9F8EF 100%)";
  const GRAD_VIOLET = "linear-gradient(135deg,#FAF7FF 0%,#F2EBFF 100%)";
  const GRAD_GOLD   = "linear-gradient(135deg,#FFFCF0 0%,#FEF5DC 100%)";
  const GRAD_RED    = "linear-gradient(135deg,#FEF8F9 0%,#FCEAEE 100%)";
  const SHADOW_SM = "0 0 0 .5px rgba(0,85,255,.08), 0 2px 8px rgba(0,85,255,.08), 0 10px 26px rgba(0,85,255,.10)";
  const SHADOW_LG = "0 0 0 .5px rgba(0,85,255,.10), 0 4px 16px rgba(0,85,255,.11), 0 18px 44px rgba(0,85,255,.13)";
  const SHADOW_BTN = "0 6px 22px rgba(0,85,255,.40), 0 2px 5px rgba(0,85,255,.20)";

  return (
    <>
      <style>{`
        .stu-row {
          transition: transform .3s ease, background .2s ease;
        }
        .stu-row:hover {
          transform: translateX(4px);
          background: rgba(0,85,255,.04) !important;
        }
        .stu-btn {
          transition: transform .2s ease, box-shadow .2s ease, background .2s ease;
        }
        .stu-btn:hover {
          transform: translateY(-1px);
        }
      `}</style>
      <div
        style={{
          fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          background: "#EEF4FF",
          minHeight: "100vh",
          margin: isMobile ? 0 : "-32px -32px 0",
          width: "100%",
          maxWidth: "100%",
          boxSizing: "border-box",
          overflowX: "hidden",
          padding: isMobile ? "16px 14px 28px" : "24px 32px 40px",
        }}
      >
      {/* ── Page Head ───────────────────────────────────── */}
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap: isMobile ? 12 : 20, marginBottom: isMobile ? 16 : 22, flexWrap:"wrap" }}>
        <div style={{ display:"flex", alignItems:"center", gap: isMobile ? 10 : 14, minWidth:0, flex: isMobile ? "1 1 auto" : undefined }}>
          <div style={{ width: isMobile ? 40 : 48, height: isMobile ? 40 : 48, borderRadius: isMobile ? 12 : 14, background:GRAD_PRIMARY, display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 8px 22px rgba(0,85,255,.35)", flexShrink:0 }}>
            <GraduationCap size={isMobile ? 20 : 24} color="#fff" strokeWidth={2.2}/>
          </div>
          <div style={{ minWidth:0 }}>
            <h1 style={{ fontSize: isMobile ? 20 : 28, fontWeight:700, color:T1, letterSpacing: isMobile ? "-0.4px" : "-0.6px", margin:0, lineHeight:1.15 }}>
              Students Intelligence
            </h1>
            <p style={{ fontSize: isMobile ? 12 : 14, color:T3, fontWeight:500, margin:"4px 0 0 0", letterSpacing:0 }}>
              {pageBranch === "All"
                ? "Enrollment, performance & behavior analytics"
                : `Viewing ${pageBranch} · enrollment, performance & behavior`}
            </p>
          </div>
        </div>
        {/* Page-level branch selector — drives every card, chart, table row.
            Visually anchored top-right so the user can re-scope the entire
            page without scrolling. Clear-filters chip appears only when
            something beyond the default scope is active. */}
        <div style={{ display:"flex", alignItems:"center", gap: 8, flexWrap:"wrap", width: isMobile ? "100%" : "auto" }}>
          {filtersActive && (
            <button
              onClick={clearAllFilters}
              className="stu-btn"
              style={{
                display:"inline-flex", alignItems:"center", justifyContent:"center", gap:6,
                padding: isMobile ? "9px 12px" : "10px 14px", borderRadius:12,
                background:"#fff", border:"0.5px solid rgba(0,85,255,.18)",
                fontSize:11, fontWeight:700, color:T3, cursor:"pointer", fontFamily:"inherit",
                letterSpacing:"0.06em", textTransform:"uppercase",
              }}
            >
              <X size={13}/> Clear
            </button>
          )}
          <select
            value={pageBranch}
            onChange={e => setPageBranch(e.target.value)}
            aria-label="Filter page by branch"
            style={{
              padding: isMobile ? "9px 12px" : "11px 16px", borderRadius:12,
              background: pageBranch === "All" ? "#fff" : GRAD_PRIMARY,
              color: pageBranch === "All" ? T1 : "#fff",
              border: pageBranch === "All" ? "0.5px solid rgba(0,85,255,.18)" : "none",
              fontSize: isMobile ? 11 : 12, fontWeight:800, letterSpacing:"0.06em",
              outline:"none", fontFamily:"inherit",
              boxShadow: pageBranch === "All" ? SHADOW_SM : SHADOW_BTN,
              cursor:"pointer", flex: isMobile ? 1 : undefined,
            }}
          >
            {branchList.map(b=><option key={b} value={b} style={{ color: T1 }}>{b==="All"?"All Branches":b}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:260 }}>
          <Loader2 className="animate-spin" size={32} color={B1}/>
        </div>
      ) : (
        <>
          {/* ── Dark Hero Banner ─────────────────────────
               Click anywhere on the dark area resets to the all-branches
               view. Inner stat tiles handle their own drill-through. */}
          <div
            {...tilt3D}
            onClick={clearAllFilters}
            role="button" tabIndex={0}
            style={{
              background:GRAD_HERO, borderRadius: isMobile ? 18 : 24, padding: isMobile ? "18px 18px" : "24px 28px", color:"#fff",
              marginBottom: isMobile ? 16 : 24, position:"relative", overflow:"hidden",
              boxShadow:"0 14px 40px rgba(0,8,60,.32), 0 0 0 .5px rgba(255,255,255,.12)",
              cursor: filtersActive ? "pointer" : "default",
              ...tilt3DStyle,
            }}
          >
            <div style={{ position:"absolute", top:-60, right:-40, width:280, height:280, background:"radial-gradient(circle, rgba(255,255,255,.12) 0%, transparent 65%)", borderRadius:"50%", pointerEvents:"none" }}/>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap: isMobile ? 14 : 24, flexWrap:"wrap", position:"relative", zIndex:1 }}>
              <div style={{ display:"flex", alignItems:"flex-start", gap: isMobile ? 12 : 16, flex:1, minWidth: isMobile ? 0 : 300 }}>
                <div style={{ width: isMobile ? 42 : 52, height: isMobile ? 42 : 52, borderRadius: isMobile ? 12 : 15, background:"rgba(255,255,255,.16)", border:"0.5px solid rgba(255,255,255,.26)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                  <Users size={isMobile ? 20 : 26} color="#fff" strokeWidth={2.2}/>
                </div>
                <div style={{ minWidth:0 }}>
                  <div style={{ display:"inline-flex", alignItems:"center", gap:6, padding:"4px 10px", borderRadius:999, background:"rgba(255,255,255,.14)", border:"0.5px solid rgba(255,255,255,.22)", fontSize: isMobile ? 9 : 10, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:10 }}>
                    <Sparkles size={11}/> Academic Intelligence
                  </div>
                  <h2 style={{ fontSize: isMobile ? 28 : 38, fontWeight:800, letterSpacing: isMobile ? "-0.6px" : "-1px", margin:0, color:"#fff", lineHeight:1 }}>
                    {totalEnrollment.toLocaleString()}
                  </h2>
                  <p style={{ fontSize: isMobile ? 11 : 13, color:"rgba(255,255,255,.72)", fontWeight:500, margin:"8px 0 0 0" }}>
                    {pageBranch === "All"
                      ? `Total scholars across ${branchList.length-1} branch${branchList.length-1 === 1 ? "" : "es"}`
                      : `Total scholars in ${pageBranch}`}
                    {newThisTerm > 0 ? ` · +${newThisTerm} new this term` : " · steady enrollment"}
                  </p>
                </div>
              </div>
              {/* Hero stat tiles — drill-through filter actions, no nav.
                  Clicking "At Risk" filters the page to at-risk students;
                  click again to clear (toggle behaviour). */}
              <div style={{ display:"grid", gridTemplateColumns: isMobile ? "repeat(3, 1fr)" : "repeat(3, minmax(120px,1fr))", gap: isMobile ? 8 : 10, width: isMobile ? "100%" : "auto" }}>
                {([
                  {
                    label: "Avg Attendance",
                    value: avgAttendance > 0 ? `${avgAttendance}%` : "—",
                    activeKey: null as ScoreFilter | null,
                  },
                  {
                    label: "At Risk",
                    value: atRisk.toString(),
                    activeKey: "atRisk" as ScoreFilter,
                  },
                  {
                    label: "High Performers",
                    value: highPerformers.toString(),
                    activeKey: "high" as ScoreFilter,
                  },
                ]).map(s => {
                  const isActive = s.activeKey !== null && scoreFilter === s.activeKey;
                  return (
                  <div
                    key={s.label}
                    onClick={(e)=>{
                      e.stopPropagation();
                      if (s.activeKey) {
                        // Toggle: re-clicking the active tile clears the filter.
                        setScoreFilter(scoreFilter === s.activeKey ? "all" : s.activeKey);
                      } else {
                        // Avg Attendance has no filter — scroll to heatmap instead.
                        document.getElementById("attendance-heatmap")?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }
                    }}
                    role="button" tabIndex={0}
                    style={{
                      background: isActive ? "rgba(255,255,255,.22)" : "rgba(255,255,255,.10)",
                      borderRadius: isMobile ? 12 : 14, padding: isMobile ? "10px 10px" : "12px 14px",
                      border: isActive ? "0.5px solid rgba(255,255,255,.5)" : "0.5px solid rgba(255,255,255,.14)",
                      cursor:"pointer",
                    }}
                  >
                    <p style={{ fontSize: isMobile ? 8 : 9, fontWeight:700, color:"rgba(255,255,255,.65)", letterSpacing:"0.10em", textTransform:"uppercase", margin:"0 0 6px 0" }}>{s.label}</p>
                    <p style={{ fontSize: isMobile ? 16 : 20, fontWeight:800, color:"#fff", margin:0, letterSpacing:"-0.4px" }}>{s.value}</p>
                  </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ── Bright Stat Grid (drill-through, branch-scoped) ─
               Each card filters/scopes the page in-place instead of
               navigating away. Total Enrollment → resets filters.
               Avg Attendance → scrolls to heatmap. At-Risk → score<50.
               High Performers → score>=85. Re-clicking the active card
               toggles the filter off. */}
          <div style={{ display:"grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: isMobile ? 10 : 16, marginBottom: isMobile ? 16 : 24, perspective:"1200px" }}>
            {([
              { label:"Total Enrollment",  value:totalEnrollment.toLocaleString(),                                                            sub:newThisTerm > 0 ? `+${newThisTerm} this term` : "Steady",                                            grad:GRAD_BLUE,                              icon:Users,         delta:newThisTerm > 0 ? "up" : null,  action:"reset"  as const, activeKey:null },
              { label:"Avg Attendance",    value:avgAttendance > 0 ? `${avgAttendance}%` : "—",                                                sub:`Across ${totalEnrollment} students`,                                                                  grad:GRAD_GREEN,                             icon:Percent,       delta:null,                            action:"scroll" as const, activeKey:null },
              { label:"At-Risk Students",  value:atRisk.toString(),                                                                            sub:`${totalEnrollment>0?((atRisk/totalEnrollment)*100).toFixed(1):0}% of total`,                          grad:atRisk > 0 ? GRAD_RED : GRAD_GOLD,      icon:AlertTriangle, delta:atRisk > 0 ? "down" : null,      action:"score"  as const, activeKey:"atRisk" as ScoreFilter },
              { label:"High Performers",   value:highPerformers.toString(),                                                                    sub:`${totalEnrollment>0?((highPerformers/totalEnrollment)*100).toFixed(1):0}% of total`,                  grad:GRAD_VIOLET,                            icon:Award,         delta:"up",                            action:"score"  as const, activeKey:"high"   as ScoreFilter },
            ]).map(s=>{
              const Icon = s.icon;
              const accent = GRAD_ACCENTS[s.grad] || "#4F46E5";
              const isActive = s.activeKey !== null && scoreFilter === s.activeKey;
              const handleClick = () => {
                if (s.action === "score" && s.activeKey) {
                  // Toggle the score filter — re-click clears it.
                  setScoreFilter(scoreFilter === s.activeKey ? "all" : s.activeKey);
                } else if (s.action === "scroll") {
                  document.getElementById("attendance-heatmap")?.scrollIntoView({ behavior: "smooth", block: "start" });
                } else if (s.action === "reset") {
                  clearAllFilters();
                }
              };
              return (
                <div
                  key={s.label}
                  onClick={handleClick}
                  role="button"
                  tabIndex={0}
                  {...tilt3D}
                  style={{
                    background:s.grad, borderRadius: isMobile ? 16 : 22, padding: isMobile ? "14px 14px" : "20px 22px",
                    cursor:"pointer", position:"relative", overflow:"hidden",
                    boxShadow:"0 4px 8px rgba(0,85,255,.12), 0 12px 24px rgba(0,85,255,.16), 0 28px 56px rgba(0,85,255,.18)",
                    outline: isActive ? `2px solid ${accent}` : "none",
                    outlineOffset: isActive ? -2 : 0,
                    ...tilt3DStyle,
                  }}
                >
                  {/* Decorative faded icon — bottom-right */}
                  <div style={{ position:"absolute", bottom: isMobile ? 8 : 12, right: isMobile ? 10 : 16, color: accent, opacity: 0.22, pointerEvents:"none", lineHeight: 0 }}>
                    <Icon size={isMobile ? 48 : 64} strokeWidth={2}/>
                  </div>
                  {/* Solid icon badge — top-left */}
                  <div style={{ width: isMobile ? 36 : 44, height: isMobile ? 36 : 44, borderRadius: isMobile ? 10 : 12, display:"flex", alignItems:"center", justifyContent:"center", background: accent, marginBottom: isMobile ? 10 : 14, boxShadow: `0 4px 12px ${accent}33`, position:"relative", zIndex:1 }}>
                    <Icon size={isMobile ? 18 : 20} color="#FFFFFF" strokeWidth={2.5}/>
                  </div>
                  {s.delta && (
                    <div style={{ position:"absolute", top: isMobile ? 14 : 20, right: isMobile ? 14 : 20, display:"inline-flex", alignItems:"center", gap:3, padding:"4px 8px", borderRadius:8, background: `${accent}1A`, fontSize:10, fontWeight:800, color: accent, zIndex:1 }}>
                      {s.delta === "up" ? <ArrowUpRight size={11}/> : <ArrowDownRight size={11}/>}
                    </div>
                  )}
                  <p style={{ fontSize: isMobile ? 9 : 10, fontWeight:700, color:"#94A3B8", letterSpacing:"0.10em", textTransform:"uppercase", margin:"0 0 6px 0", position:"relative", zIndex:1 }}>{s.label}</p>
                  <p style={{ fontSize: isMobile ? 22 : 30, fontWeight:800, color:"#0F172A", letterSpacing:"-0.6px", margin:0, lineHeight:1.1, position:"relative", zIndex:1 }}>{s.value}</p>
                  <p style={{ fontSize: isMobile ? 10 : 11, fontWeight:600, color:"#64748B", margin:"6px 0 0 0", position:"relative", zIndex:1 }}>{s.sub}</p>
                </div>
              );
            })}
          </div>

          {/* ── Charts Row (3-col) ───────────────────── */}
          <div style={{ display:"grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: isMobile ? 12 : 16, marginBottom: isMobile ? 16 : 24, perspective:"1200px" }}>

            {/* Grade Distribution — click a slice to filter the table to that grade */}
            <div
              {...tilt3D}
              style={{
                background:"#fff", borderRadius: isMobile ? 16 : 22, padding: isMobile ? "16px 14px 14px" : "22px 22px 18px",
                boxShadow:SHADOW_SM, border:"0.5px solid rgba(0,85,255,.08)",
                ...tilt3DStyle,
              }}
            >
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
                <div>
                  <h3 style={{ fontSize:15, fontWeight:700, color:T1, margin:0, letterSpacing:"-0.3px" }}>Grade Distribution</h3>
                  <p style={{ fontSize:10, fontWeight:600, color:T4, margin:"3px 0 0 0", letterSpacing:"0.08em", textTransform:"uppercase" }}>
                    {gradeFilter ? `Filtering: ${gradeFilter} · click again to clear` : "Scholars by grade · click to filter"}
                  </p>
                </div>
                <div style={{ width:32, height:32, borderRadius:10, background:"rgba(0,85,255,.08)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <BarChart3 size={16} color={B1} strokeWidth={2.3}/>
                </div>
              </div>
              <div style={{ height:220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={gradeDistData.length ? gradeDistData : [{name:"No Data",value:1,fill:"#e2e8f0"}]}
                      cx="50%" cy="50%" outerRadius={isMobile ? 62 : 78} innerRadius={isMobile ? 30 : 38}
                      dataKey="value" stroke="#fff" strokeWidth={2} paddingAngle={3}
                      onClick={(slice: any) => {
                        const name = slice?.name;
                        if (!name || name === "No Data") return;
                        // Toggle: clicking the active slice clears the filter.
                        setGradeFilter(prev => prev === name ? null : name);
                      }}
                      cursor={gradeDistData.length ? "pointer" : "default"}
                      label={({name,midAngle,cx,cy,outerRadius:or})=>{
                        const R=Math.PI/180;
                        const x=cx+(or+18)*Math.cos(-midAngle*R);
                        const y=cy+(or+18)*Math.sin(-midAngle*R);
                        return <text x={x} y={y} fill={T3} fontSize={10} fontWeight="700" textAnchor={x>cx?"start":"end"} dominantBaseline="central">{name}</text>;
                      }}
                    >
                      {(gradeDistData.length?gradeDistData:[{fill:"#e2e8f0"}]).map((e:any,i:number)=>(
                        <Cell
                          key={i}
                          fill={e.fill}
                          opacity={gradeFilter === null || gradeFilter === e.name ? 1 : 0.32}
                        />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius:12, border:"none", boxShadow:SHADOW_LG, fontSize:11, fontWeight:700 }}/>
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Enrollment Trend — driven by branch-scoped students */}
            <div
              {...tilt3D}
              style={{
                background:"#fff", borderRadius: isMobile ? 16 : 22, padding: isMobile ? "16px 14px 14px" : "22px 22px 18px",
                boxShadow:SHADOW_SM, border:"0.5px solid rgba(0,85,255,.08)",
                ...tilt3DStyle,
              }}
            >
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
                <div>
                  <h3 style={{ fontSize:15, fontWeight:700, color:T1, margin:0, letterSpacing:"-0.3px" }}>Enrollment Trend</h3>
                  <p style={{ fontSize:10, fontWeight:600, color:T4, margin:"3px 0 0 0", letterSpacing:"0.08em", textTransform:"uppercase" }}>Last 6 months</p>
                </div>
                <div style={{ width:32, height:32, borderRadius:10, background:"rgba(123,63,244,.1)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <TrendingUp size={16} color={VIOLET} strokeWidth={2.3}/>
                </div>
              </div>
              <div style={{ height:220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={enrollTrend} margin={{top:5,right:10,left:-22,bottom:0}}>
                    <defs>
                      <linearGradient id="enGradOw" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={B1} stopOpacity={0.22}/>
                        <stop offset="95%" stopColor={B1} stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,85,255,.07)"/>
                    <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fill:T3,fontSize:11,fontWeight:600}}/>
                    <YAxis axisLine={false} tickLine={false} tick={{fill:T3,fontSize:11,fontWeight:600}}/>
                    <Tooltip contentStyle={{ borderRadius:12, border:"none", boxShadow:SHADOW_LG, fontSize:11, fontWeight:700 }}/>
                    <Area type="monotone" dataKey="value" stroke={B1} strokeWidth={3} fill="url(#enGradOw)"
                      dot={{r:4,fill:B1,strokeWidth:2,stroke:"#fff"}} activeDot={{r:6}}/>
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Performance by Branch — click a bar to scope the page to that branch */}
            <div
              {...tilt3D}
              style={{
                background:"#fff", borderRadius: isMobile ? 16 : 22, padding: isMobile ? "16px 14px 14px" : "22px 22px 18px",
                boxShadow:SHADOW_SM, border:"0.5px solid rgba(0,85,255,.08)",
                ...tilt3DStyle,
              }}
            >
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
                <div>
                  <h3 style={{ fontSize:15, fontWeight:700, color:T1, margin:0, letterSpacing:"-0.3px" }}>Performance by Branch</h3>
                  <p style={{ fontSize:10, fontWeight:600, color:T4, margin:"3px 0 0 0", letterSpacing:"0.08em", textTransform:"uppercase" }}>
                    Avg scores · click bar to focus
                  </p>
                </div>
                <div style={{ width:32, height:32, borderRadius:10, background:"rgba(0,200,83,.1)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <Activity size={16} color={GREEN} strokeWidth={2.3}/>
                </div>
              </div>
              <div style={{ height:220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={perfByBranch.length ? perfByBranch : [{branch:"No Data",fullBranch:"",value:0}]}
                    layout="vertical"
                    margin={{left:0,right:40,top:5,bottom:5}}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(0,85,255,.07)"/>
                    <XAxis type="number" domain={[0,100]} axisLine={false} tickLine={false}
                      tick={{fill:T3,fontSize:11,fontWeight:600}} ticks={[0,25,50,75,100]}/>
                    <YAxis dataKey="branch" type="category" axisLine={false} tickLine={false}
                      tick={{fill:T3,fontSize:11,fontWeight:700}} width={60}/>
                    <Tooltip contentStyle={{ borderRadius:12, border:"none", boxShadow:SHADOW_LG, fontSize:11, fontWeight:700 }} cursor={{fill:"rgba(0,85,255,.04)"}}/>
                    <Bar
                      dataKey="value" radius={[0,6,6,0]} barSize={22}
                      onClick={(bar: any) => {
                        const fullBranch = bar?.fullBranch;
                        if (!fullBranch || fullBranch === "") return;
                        // Toggle: clicking the active branch's bar clears the filter.
                        setPageBranch(prev => prev === fullBranch ? "All" : fullBranch);
                      }}
                      cursor={perfByBranch.length ? "pointer" : "default"}
                      label={{position:"right",fill:T3,fontSize:11,fontWeight:700,formatter:(v:any)=>`${v}%`}}
                    >
                      {perfByBranch.map((e,i)=>(
                        <Cell
                          key={i}
                          fill={e.value>=80?GREEN:e.value>=60?GOLD:RED}
                          opacity={pageBranch === "All" || pageBranch === e.fullBranch ? 1 : 0.35}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* ── Attendance Heatmap ─────────────────────
               Driven by the page-level branchscope filter; per-card
               dropdown removed in favour of the single page-head
               selector. Anchor id used by the "Avg Attendance" stat
               card's scroll-to action. */}
          <div
            id="attendance-heatmap"
            {...tilt3D}
            style={{
              background:"#fff", borderRadius: isMobile ? 16 : 22, padding: isMobile ? "16px 14px" : "22px 24px",
              boxShadow:SHADOW_SM, border:"0.5px solid rgba(0,85,255,.08)",
              marginBottom: isMobile ? 16 : 24, perspective:"1200px",
              ...tilt3DStyle,
            }}
          >
            <div style={{ display:"flex", alignItems: isMobile ? "flex-start" : "center", justifyContent:"space-between", gap: isMobile ? 10 : 16, marginBottom: isMobile ? 14 : 20, flexWrap:"wrap" }}>
              <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                <div style={{ width:36, height:36, borderRadius:11, background:GRAD_PRIMARY, display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 6px 14px rgba(0,85,255,.28)" }}>
                  <Percent size={18} color="#fff" strokeWidth={2.3}/>
                </div>
                <div>
                  <h3 style={{ fontSize:15, fontWeight:700, color:T1, margin:0, letterSpacing:"-0.3px" }}>Attendance Heatmap</h3>
                  <p style={{ fontSize:10, fontWeight:600, color:T4, margin:"3px 0 0 0", letterSpacing:"0.08em", textTransform:"uppercase" }}>
                    {pageBranch === "All" ? "Branch × grade" : `${pageBranch} × grade`}
                  </p>
                </div>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:14, flexWrap:"wrap" }}>
                <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                  {[[GREEN,"95%+"],[GOLD,"85-94%"],[RED,"<85%"]].map(([c,l])=>(
                    <div key={l as string} style={{ display:"flex", alignItems:"center", gap:5 }}>
                      <div style={{ width:8, height:8, borderRadius:"50%", background:c as string }}/>
                      <span style={{ fontSize:10, fontWeight:700, color:T3 }}>{l}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ overflowX:"auto", paddingBottom:4, WebkitOverflowScrolling:"touch" }}>
              <div style={{ minWidth: isMobile ? 480 : 600 }}>
                <div style={{ display:"grid", gap: isMobile ? 6 : 8, marginBottom: isMobile ? 6 : 8, gridTemplateColumns:`${isMobile ? 100 : 140}px repeat(${Math.max(heatmapGrades.length,1)},${isMobile ? "56px" : "1fr"})` }}>
                  <div style={{ fontSize:9, fontWeight:700, color:T4, letterSpacing:"0.12em", textTransform:"uppercase" }}>Branch</div>
                  {heatmapGrades.map(g=>(
                    <div key={g} style={{ textAlign:"center", fontSize:9, fontWeight:700, color:T4, letterSpacing:"0.12em", textTransform:"uppercase" }}>{g}</div>
                  ))}
                </div>
                {heatmapData.length === 0 ? (
                  <div style={{ textAlign:"center", padding:"30px 0", fontSize:12, color:T4, fontWeight:600 }}>No attendance data yet</div>
                ) : (
                  heatmapData.map(row=>(
                    <div key={row.branch} style={{ display:"grid", gap: isMobile ? 6 : 8, marginBottom: isMobile ? 6 : 8, gridTemplateColumns:`${isMobile ? 100 : 140}px repeat(${Math.max(heatmapGrades.length,1)},${isMobile ? "56px" : "1fr"})` }}>
                      <div style={{ display:"flex", alignItems:"center" }}>
                        <span style={{ fontSize: isMobile ? 10 : 11, fontWeight:700, color:T3, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", paddingRight:6 }}>{row.branch}</span>
                      </div>
                      {row.cells.map((val,i)=>{
                        const bg = val >= 95 ? GREEN : val >= 85 ? GOLD : val > 0 ? RED : "rgba(0,85,255,.06)";
                        return (
                          <div key={i} className="stu-btn"
                            style={{
                              height: isMobile ? 34 : 40, borderRadius: isMobile ? 8 : 10,
                              display:"flex", alignItems:"center", justifyContent:"center",
                              fontWeight:800, fontSize: isMobile ? 10 : 11,
                              color: val>0 ? "#fff" : T4,
                              background: bg,
                              boxShadow: val>0 ? "0 4px 10px rgba(0,0,0,.08)" : "none",
                            }}
                          >
                            {val>0 ? `${val}%` : "—"}
                          </div>
                        );
                      })}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* ── Student Table ─────────────────────────── */}
          <div
            {...tilt3D}
            style={{
              background:"#fff", borderRadius: isMobile ? 16 : 22,
              boxShadow:SHADOW_SM, border:"0.5px solid rgba(0,85,255,.08)",
              overflow:"hidden", marginBottom: isMobile ? 16 : 24, perspective:"1200px",
              ...tilt3DStyle,
            }}
          >
            <div style={{ padding: isMobile ? "14px 14px" : "18px 24px", borderBottom:"0.5px solid rgba(0,85,255,.08)", display:"flex", gap: isMobile ? 8 : 12, alignItems:"center", flexWrap:"wrap" }}>
              <div style={{ position:"relative", flex:"1 1 100%", minWidth: isMobile ? 0 : 220, order: isMobile ? 0 : undefined }}>
                <Search style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)" }} size={15} color={T4}/>
                <input
                  value={search}
                  onChange={e=>{setSearch(e.target.value);setPage(1);}}
                  placeholder="Search scholars by name..."
                  style={{
                    width:"100%", padding: isMobile ? "9px 10px 9px 34px" : "10px 12px 10px 36px", borderRadius:12,
                    border:"0.5px solid rgba(0,85,255,.14)", background:"#F5F9FF",
                    fontSize: isMobile ? 12 : 13, fontWeight:500, color:T1, outline:"none", fontFamily:"inherit",
                  }}
                />
              </div>
              {/* Filter button toggles a small popover with two secondary
                  filters: risk tier (mirrors the stat-card drill-throughs)
                  and grade (mirrors the pie-chart slice click). Branch
                  filtering lives in the page-head selector — we don't
                  duplicate it here to avoid two sources of truth. */}
              <button
                ref={filterBtnRef}
                onClick={() => filterMenuOpen ? setFilterMenuOpen(false) : openFilterMenu()}
                className="stu-btn"
                aria-expanded={filterMenuOpen}
                style={{
                  display:"inline-flex", alignItems:"center", justifyContent:"center", gap:6,
                  padding: isMobile ? "9px 12px" : "10px 14px", borderRadius:12,
                  background: filtersActive ? GRAD_PRIMARY : "#F5F9FF",
                  color: filtersActive ? "#fff" : T3,
                  border: filtersActive ? "none" : "0.5px solid rgba(0,85,255,.14)",
                  fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit",
                }}
              >
                <Filter size={13}/> {isMobile ? "" : "Filters"}
                {filtersActive && (
                  <span style={{
                    display:"inline-flex", alignItems:"center", justifyContent:"center",
                    minWidth:18, height:18, padding:"0 5px", borderRadius:9,
                    background:"#fff", color:B1, fontSize:10, fontWeight:800,
                  }}>
                    {[
                      pageBranch !== "All" ? 1 : 0,
                      scoreFilter !== "all" ? 1 : 0,
                      gradeFilter !== null ? 1 : 0,
                    ].reduce((a,b)=>a+b, 0)}
                  </span>
                )}
              </button>
              {/* Popover is portalled to <body> to escape the table card's
                  tilt3D transform — `position: fixed` is unreliable inside
                  any transformed ancestor. Anchor coordinates are captured
                  at open time so desktop can place it under the button. */}
              {filterMenuOpen && createPortal(
                <>
                  <div
                    onClick={() => setFilterMenuOpen(false)}
                    style={{
                      position:"fixed", inset:0, zIndex:1040,
                      background: isMobile ? "rgba(0,16,64,.32)" : "transparent",
                    }}
                  />
                  <div
                    role="menu"
                    style={isMobile ? {
                      position:"fixed", left:14, right:14, bottom:16, zIndex:1041,
                      maxWidth:360, marginInline:"auto",
                      background:"#fff", borderRadius:18, padding:"16px 16px 12px",
                      border:"0.5px solid rgba(0,85,255,.14)",
                      boxShadow:"0 -10px 40px rgba(0,8,60,.20), 0 0 0 .5px rgba(0,85,255,.10)",
                      display:"flex", flexDirection:"column", gap:14,
                    } : {
                      position:"fixed",
                      top: filterAnchor?.top ?? 80,
                      right: filterAnchor?.right ?? 32,
                      zIndex:1041,
                      width:280,
                      background:"#fff", borderRadius:14, padding:"14px 14px 10px",
                      border:"0.5px solid rgba(0,85,255,.14)", boxShadow:SHADOW_LG,
                      display:"flex", flexDirection:"column", gap:14,
                    }}
                  >
                      <div>
                        <p style={{ fontSize:9, fontWeight:800, color:T4, letterSpacing:"0.14em", textTransform:"uppercase", margin:"0 0 8px 0" }}>Risk Tier</p>
                        <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                          {([
                            { k: "all"    as ScoreFilter, label: "All",            tint: T3 },
                            { k: "atRisk" as ScoreFilter, label: "At Risk (<50)",  tint: RED },
                            { k: "medium" as ScoreFilter, label: "Medium (50-74)", tint: GOLD },
                            { k: "high"   as ScoreFilter, label: "High (≥85)",     tint: GREEN },
                          ]).map(p => {
                            const active = scoreFilter === p.k;
                            return (
                              <button
                                key={p.k}
                                onClick={() => setScoreFilter(p.k)}
                                style={{
                                  padding:"6px 11px", borderRadius:9,
                                  border: active ? "none" : `0.5px solid ${p.tint}33`,
                                  background: active ? p.tint : `${p.tint}10`,
                                  color: active ? "#fff" : p.tint,
                                  fontSize:11, fontWeight:800, letterSpacing:"0.04em",
                                  cursor:"pointer", fontFamily:"inherit",
                                }}
                              >
                                {p.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div>
                        <p style={{ fontSize:9, fontWeight:800, color:T4, letterSpacing:"0.14em", textTransform:"uppercase", margin:"0 0 8px 0" }}>Grade</p>
                        <select
                          value={gradeFilter ?? ""}
                          onChange={e => setGradeFilter(e.target.value || null)}
                          style={{
                            width:"100%", padding:"8px 10px", borderRadius:10,
                            border:"0.5px solid rgba(0,85,255,.18)", background:"#F5F9FF",
                            fontSize:12, fontWeight:700, color:T3,
                            outline:"none", fontFamily:"inherit",
                          }}
                        >
                          <option value="">All grades</option>
                          {[...new Set(branchScopedStudents.map(s => s.grade).filter(g => g && g !== "—"))]
                            .sort((a,b) => {
                              const na = parseInt(a.match(/\d+/)?.[0] || "0");
                              const nb = parseInt(b.match(/\d+/)?.[0] || "0");
                              return na - nb;
                            })
                            .map(g => <option key={g} value={g}>{g}</option>)}
                        </select>
                      </div>

                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", borderTop:"0.5px solid rgba(0,85,255,.08)", paddingTop:10 }}>
                        <button
                          onClick={() => { clearAllFilters(); setFilterMenuOpen(false); }}
                          style={{
                            padding:"6px 10px", borderRadius:8, border:"none",
                            background:"transparent", color:T3,
                            fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"inherit",
                          }}
                        >
                          Clear all
                        </button>
                        <button
                          onClick={() => setFilterMenuOpen(false)}
                          style={{
                            padding:"7px 14px", borderRadius:9, border:"none",
                            background:GRAD_PRIMARY, color:"#fff",
                            fontSize:11, fontWeight:800, letterSpacing:"0.06em", textTransform:"uppercase",
                            cursor:"pointer", fontFamily:"inherit",
                          }}
                        >
                          Done
                        </button>
                      </div>
                    </div>
                  </>,
                  document.body
                )}
            </div>

            {isMobile ? (
              <div style={{ padding: "8px 10px 4px" }}>
                {grouped.map(([letter, rows])=>(
                  <React.Fragment key={letter}>
                    <div style={{ padding:"8px 6px", fontSize:10, fontWeight:800, color:B1, letterSpacing:"0.16em", textTransform:"uppercase" }}>
                      {letter}
                    </div>
                    {rows.map(s=>{
                      const risk = getRisk(s.score);
                      const isSelected = selected?._eid===s._eid;
                      return (
                        <div key={s._eid}
                          onClick={()=>navigate(`/students/${encodeURIComponent(s.id)}`)}
                          role="button" tabIndex={0}
                          style={{
                            borderRadius:14, padding:"12px 12px", marginBottom:8,
                            background: isSelected ? "rgba(0,85,255,.06)" : "#F8FBFF",
                            border:"0.5px solid rgba(0,85,255,.08)",
                            cursor:"pointer",
                            display:"flex", flexDirection:"column", gap:10,
                          }}
                        >
                          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                            <div style={{
                              width:38, height:38, borderRadius:"50%", background:risk.gradient,
                              display:"flex", alignItems:"center", justifyContent:"center",
                              color:"#fff", fontSize:12, fontWeight:800, flexShrink:0,
                              boxShadow:"0 4px 10px rgba(0,85,255,.18)",
                            }}>
                              {getInitials(s.name)}
                            </div>
                            <div style={{ minWidth:0, flex:1 }}>
                              <p style={{ fontSize:13, fontWeight:800, color:T1, margin:0, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{s.name}</p>
                              <p style={{ fontSize:10, fontWeight:600, color:T4, margin:"2px 0 0 0" }}>{s.grade} · {s.branch}</p>
                            </div>
                            <span style={{
                              fontSize:9, fontWeight:800, letterSpacing:"0.12em", textTransform:"uppercase",
                              padding:"3px 8px", borderRadius:6, background:risk.bg, color:risk.fg, flexShrink:0,
                            }}>{risk.label}</span>
                          </div>
                          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr auto", gap:10, alignItems:"center" }}>
                            <div>
                              <p style={{ fontSize:9, fontWeight:700, color:T4, letterSpacing:"0.10em", textTransform:"uppercase", margin:0 }}>Attendance</p>
                              <p style={{ fontSize:13, fontWeight:800, color:T1, margin:"2px 0 0 0" }}>{s.attendance>0?`${s.attendance}%`:"—"}</p>
                            </div>
                            <div>
                              <p style={{ fontSize:9, fontWeight:700, color:T4, letterSpacing:"0.10em", textTransform:"uppercase", margin:0 }}>Score</p>
                              <p style={{ fontSize:13, fontWeight:800, color:T1, margin:"2px 0 0 0" }}>{s.score>0?`${s.score}%`:"—"}</p>
                            </div>
                            <button
                              onClick={(e)=>{e.stopPropagation();setSelected(isSelected ? null : s);}}
                              style={{
                                padding:"7px 14px", borderRadius:10,
                                background:isSelected?GRAD_PRIMARY:"rgba(0,85,255,.08)",
                                color:isSelected?"#fff":B1,
                                fontSize:10, fontWeight:800, letterSpacing:"0.08em", textTransform:"uppercase",
                                border:"none", cursor:"pointer", fontFamily:"inherit",
                                boxShadow:isSelected?SHADOW_BTN:"none",
                              }}
                            >
                              {isSelected ? "Close" : "View"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </React.Fragment>
                ))}
                {filtered.length===0 && (
                  <div style={{ padding:"40px 0", textAlign:"center", fontSize:11, fontWeight:700, color:T4, letterSpacing:"0.14em", textTransform:"uppercase" }}>No scholars found</div>
                )}
              </div>
            ) : (
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", minWidth:720, borderCollapse:"collapse" }}>
                <thead>
                  <tr style={{ background:"rgba(0,85,255,.03)", borderBottom:"0.5px solid rgba(0,85,255,.08)" }}>
                    {["Student","Grade","Branch","Attendance","Score","Actions"].map((h,i)=>(
                      <th key={h} style={{
                        padding:"12px 18px", textAlign:"left", fontSize:10, fontWeight:800,
                        color:T4, letterSpacing:"0.14em", textTransform:"uppercase",
                        display:i===1||i===2?"table-cell":undefined,
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grouped.map(([letter, rows])=>(
                    <React.Fragment key={letter}>
                      <tr style={{ background:"rgba(0,85,255,.04)" }}>
                        <td colSpan={6} style={{ padding:"8px 22px", fontSize:10, fontWeight:800, color:B1, letterSpacing:"0.16em", textTransform:"uppercase" }}>
                          {letter}
                        </td>
                      </tr>
                      {rows.map(s=>{
                        const risk = getRisk(s.score);
                        const isSelected = selected?._eid===s._eid;
                        return (
                          <tr key={s._eid}
                            className="stu-row"
                            onClick={()=>navigate(`/students/${encodeURIComponent(s.id)}`)}
                            style={{
                              borderBottom:"0.5px solid rgba(0,85,255,.04)",
                              background: isSelected ? "rgba(0,85,255,.06)" : "transparent",
                              cursor:"pointer",
                            }}
                          >
                            <td style={{ padding:"12px 18px" }}>
                              <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                                <div style={{
                                  width:36, height:36, borderRadius:"50%", background:risk.gradient,
                                  display:"flex", alignItems:"center", justifyContent:"center",
                                  color:"#fff", fontSize:11, fontWeight:800,
                                  boxShadow:"0 4px 10px rgba(0,85,255,.18)", flexShrink:0,
                                }}>
                                  {getInitials(s.name)}
                                </div>
                                <div style={{ minWidth:0 }}>
                                  <p style={{ fontSize:13, fontWeight:700, color:T1, margin:0, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{s.name}</p>
                                  <p style={{ fontSize:10, fontWeight:600, color:T4, margin:"2px 0 0 0", letterSpacing:"0.04em" }}>ID: {s.id.length>10?s.id.slice(0,10):s.id}</p>
                                </div>
                              </div>
                            </td>
                            <td style={{ padding:"12px 18px", fontSize:12, fontWeight:700, color:T3 }}>{s.grade}</td>
                            <td style={{ padding:"12px 18px", fontSize:12, fontWeight:700, color:T3 }}>{s.branch}</td>
                            <td style={{ padding:"12px 18px", fontSize:13, fontWeight:800, color:T1 }}>{s.attendance>0?`${s.attendance}%`:"—"}</td>
                            <td style={{ padding:"12px 18px" }}>
                              <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                                <span style={{ fontSize:13, fontWeight:800, color:T1 }}>{s.score>0?`${s.score}%`:"—"}</span>
                                <span style={{
                                  fontSize:9, fontWeight:800, letterSpacing:"0.14em", textTransform:"uppercase",
                                  padding:"2px 7px", borderRadius:6, background:risk.bg, color:risk.fg,
                                  alignSelf:"flex-start",
                                }}>{risk.label}</span>
                              </div>
                            </td>
                            <td style={{ padding:"12px 18px" }}>
                              <button
                                onClick={(e)=>{e.stopPropagation();setSelected(isSelected ? null : s);}}
                                className="stu-btn"
                                style={{
                                  padding:"7px 14px", borderRadius:10,
                                  background:isSelected?GRAD_PRIMARY:"rgba(0,85,255,.08)",
                                  color:isSelected?"#fff":B1,
                                  fontSize:11, fontWeight:800, letterSpacing:"0.08em", textTransform:"uppercase",
                                  border:"none", cursor:"pointer", fontFamily:"inherit",
                                  boxShadow:isSelected?SHADOW_BTN:"none",
                                }}
                              >
                                {isSelected ? "Close" : "View"}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  ))}
                  {filtered.length===0 && (
                    <tr><td colSpan={6} style={{ padding:"60px 0", textAlign:"center", fontSize:12, fontWeight:700, color:T4, letterSpacing:"0.14em", textTransform:"uppercase" }}>No scholars found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            )}

            <div style={{ padding: isMobile ? "12px 14px" : "14px 24px", borderTop:"0.5px solid rgba(0,85,255,.08)", display:"flex", alignItems:"center", justifyContent:"space-between", gap: isMobile ? 10 : 16, flexWrap:"wrap" }}>
              <p style={{ fontSize: isMobile ? 9 : 10, fontWeight:700, color:T4, letterSpacing:"0.14em", textTransform:"uppercase", margin:0, width: isMobile ? "100%" : "auto", textAlign: isMobile ? "center" : "left" }}>
                Showing {Math.min((page-1)*PAGE_SIZE+1, filtered.length)}–{Math.min(page*PAGE_SIZE, filtered.length)} of {filtered.length}
              </p>
              <div style={{ display:"flex", gap:6, margin: isMobile ? "0 auto" : 0, flexWrap:"wrap", justifyContent:"center" }}>
                <button
                  disabled={page===1}
                  onClick={()=>setPage(p=>p-1)}
                  className="stu-btn"
                  style={{
                    padding:"7px 14px", borderRadius:10,
                    background:"#F5F9FF", border:"0.5px solid rgba(0,85,255,.12)",
                    fontSize:11, fontWeight:800, color:T3, cursor:page===1?"not-allowed":"pointer",
                    opacity:page===1?0.4:1, fontFamily:"inherit",
                  }}
                >Prev</button>
                {Array.from({length:Math.min(totalPages,5)},(_,i)=>i+1).map(n=>(
                  <button key={n} onClick={()=>setPage(n)}
                    className="stu-btn"
                    style={{
                      width:32, height:32, borderRadius:10,
                      background:page===n?GRAD_PRIMARY:"#F5F9FF",
                      color:page===n?"#fff":T3,
                      border: page===n ? "none" : "0.5px solid rgba(0,85,255,.12)",
                      fontSize:11, fontWeight:800, cursor:"pointer",
                      boxShadow:page===n?SHADOW_BTN:"none", fontFamily:"inherit",
                    }}
                  >{n}</button>
                ))}
                <button
                  disabled={page===totalPages}
                  onClick={()=>setPage(p=>p+1)}
                  className="stu-btn"
                  style={{
                    padding:"7px 14px", borderRadius:10,
                    background:"#F5F9FF", border:"0.5px solid rgba(0,85,255,.12)",
                    fontSize:11, fontWeight:800, color:T3, cursor:page===totalPages?"not-allowed":"pointer",
                    opacity:page===totalPages?0.4:1, fontFamily:"inherit",
                  }}
                >Next</button>
              </div>
            </div>
          </div>

          {/* ── Student Detail Panel ─────────────────── */}
          {selected && (()=>{
            const risk = getRisk(selected.score);
            const isCritical = selected.score > 0 && selected.score < 50;
            return (
              <div
                {...tilt3D}
                onClick={()=>navigate(`/students/${encodeURIComponent(selected.id)}`)}
                role="button" tabIndex={0}
                style={{
                  background:"#fff", borderRadius: isMobile ? 16 : 22,
                  boxShadow:SHADOW_LG, border:"0.5px solid rgba(0,85,255,.10)",
                  overflow:"hidden", marginBottom: isMobile ? 16 : 24,
                  animation:"slide-in-from-bottom .3s ease", perspective:"1200px",
                  cursor:"pointer",
                  ...tilt3DStyle,
                }}
              >
                <div style={{ padding: isMobile ? "16px 14px" : "22px 26px", borderBottom:"0.5px solid rgba(0,85,255,.08)", display:"flex", justifyContent:"space-between", alignItems: isMobile ? "flex-start" : "center", gap: isMobile ? 10 : 16, flexWrap:"wrap" }}>
                  <div style={{ display:"flex", alignItems:"center", gap: isMobile ? 10 : 14, minWidth:0, flex: isMobile ? "1 1 100%" : undefined }}>
                    <div style={{
                      width: isMobile ? 44 : 54, height: isMobile ? 44 : 54, borderRadius: isMobile ? 13 : 16, background:risk.gradient,
                      display:"flex", alignItems:"center", justifyContent:"center",
                      color:"#fff", fontSize: isMobile ? 14 : 16, fontWeight:800, flexShrink:0,
                      boxShadow:"0 8px 20px rgba(0,85,255,.22)",
                    }}>
                      {getInitials(selected.name)}
                    </div>
                    <div style={{ minWidth:0 }}>
                      <h2 style={{ fontSize: isMobile ? 17 : 22, fontWeight:800, color:T1, margin:0, letterSpacing:"-0.5px", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{selected.name}</h2>
                      <p style={{ fontSize: isMobile ? 10 : 11, fontWeight:700, color:T4, margin:"4px 0 0 0", letterSpacing:"0.08em", textTransform:"uppercase" }}>
                        {selected.grade} · {selected.branch}
                      </p>
                    </div>
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap: isMobile ? 6 : 8, flexWrap:"wrap", width: isMobile ? "100%" : "auto" }}>
                    <span style={{
                      fontSize: isMobile ? 9 : 10, fontWeight:800, padding:"6px 12px", borderRadius:10,
                      background:risk.gradient, color:"#fff", letterSpacing:"0.12em", textTransform:"uppercase",
                      boxShadow:"0 4px 10px rgba(0,85,255,.18)",
                    }}>{risk.label === "Untested" ? "Untested" : `${risk.label} Risk`}</span>
                    <button
                      onClick={(e)=>e.stopPropagation()}
                      className="stu-btn"
                      style={{
                        display:"inline-flex", alignItems:"center", justifyContent:"center", gap:6,
                        padding: isMobile ? "8px 12px" : "9px 16px", borderRadius:11,
                        background:GRAD_PRIMARY, color:"#fff",
                        fontSize: isMobile ? 9 : 10, fontWeight:800, letterSpacing:"0.10em", textTransform:"uppercase",
                        border:"none", cursor:"pointer", boxShadow:SHADOW_BTN, fontFamily:"inherit",
                        flex: isMobile ? 1 : undefined,
                      }}
                    >
                      <Mail size={13}/> Contact Parent
                    </button>
                    <button onClick={(e)=>{e.stopPropagation();setSelected(null);}}
                      className="stu-btn"
                      style={{
                        width: isMobile ? 34 : 36, height: isMobile ? 34 : 36, borderRadius:11, border:"0.5px solid rgba(0,85,255,.12)",
                        background:"#F5F9FF", display:"flex", alignItems:"center", justifyContent:"center",
                        cursor:"pointer", flexShrink:0,
                      }}
                    >
                      <X size={15} color={T3}/>
                    </button>
                  </div>
                </div>

                <div style={{ padding: isMobile ? "16px 14px" : 24 }}>
                  {(() => {
                    const attDisplay  = att30 !== null ? `${att30}%` : (selected.attendance > 0 ? `${selected.attendance}%` : "—");
                    const attSubText  = attDelta !== null
                      ? `${attDelta >= 0 ? "↑" : "↓"} ${Math.abs(attDelta)}% vs last month`
                      : "No comparison data";
                    const attColor = attDelta === null ? T4 : attDelta >= 0 ? GREEN : RED;
                    const scoreDisplay = selected.score > 0 ? `${selected.score}/100` : "—";
                    const scoreSubText = scoreDelta !== null
                      ? `${scoreDelta >= 0 ? "↑" : "↓"} ${Math.abs(scoreDelta)} pts from last exam`
                      : "No previous exam";
                    const scoreColor = scoreDelta === null ? T4 : scoreDelta >= 0 ? GREEN : RED;

                    return (
                      <div style={{ display:"grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: isMobile ? 10 : 14, marginBottom: isMobile ? 16 : 22 }}>
                        {[
                          { label:"Attendance (30d)", value:attDisplay, sub:attSubText, subColor:attColor, icon:Percent, grad:"linear-gradient(135deg,#10B981 0%,#059669 100%)", route:`/students/${encodeURIComponent(selected.id)}` },
                          { label:"Academic Score", value:scoreDisplay, sub:scoreSubText, subColor:scoreColor, icon:Award, grad:"linear-gradient(135deg,#0055FF 0%,#1166FF 100%)", route:`/students/${encodeURIComponent(selected.id)}` },
                          { label:"Behavior Incidents", value:selected.incidents.toString(), sub:"This term", subColor:T4, icon:AlertTriangle, grad: selected.incidents>0 ? "linear-gradient(135deg,#FF3355 0%,#DC2626 100%)" : "linear-gradient(135deg,#7B3FF4 0%,#9333EA 100%)", route: selected.incidents>0 ? "/risks" : `/students/${encodeURIComponent(selected.id)}` },
                        ].map(c=>{
                          const Icon = c.icon;
                          return (
                            <div key={c.label} {...tilt3D}
                              onClick={(e)=>{e.stopPropagation();navigate(c.route);}}
                              role="button" tabIndex={0}
                              style={{
                                background:"#F5F9FF", borderRadius: isMobile ? 14 : 16, padding: isMobile ? "14px 14px" : "16px 18px",
                                border:"0.5px solid rgba(0,85,255,.1)",
                                cursor:"pointer",
                                ...tilt3DStyle,
                              }}
                            >
                              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
                                <p style={{ fontSize: isMobile ? 9 : 10, fontWeight:800, color:T4, letterSpacing:"0.12em", textTransform:"uppercase", margin:0 }}>{c.label}</p>
                                <div style={{ width: isMobile ? 28 : 30, height: isMobile ? 28 : 30, borderRadius:10, background:c.grad, display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 4px 10px rgba(0,85,255,.2)" }}>
                                  <Icon size={14} color="#fff" strokeWidth={2.4}/>
                                </div>
                              </div>
                              <p style={{ fontSize: isMobile ? 22 : 26, fontWeight:800, color:isCritical?RED:T1, margin:0, letterSpacing:"-0.4px", lineHeight:1 }}>{c.value}</p>
                              <p style={{ fontSize: isMobile ? 10 : 11, fontWeight:700, color:c.subColor, margin:"6px 0 0 0" }}>{c.sub}</p>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}

                  <div>
                    <h3 style={{ fontSize:14, fontWeight:700, color:T1, margin:"0 0 14px 0", letterSpacing:"-0.3px" }}>Performance Trend</h3>
                    {detailLoading ? (
                      <div style={{ height:200, display:"flex", alignItems:"center", justifyContent:"center" }}>
                        <Loader2 className="animate-spin" size={24} color={B1}/>
                      </div>
                    ) : detailTrend.every(d => d.score === 0 && d.attendance === 0) ? (
                      <div style={{ height:200, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:700, color:T4 }}>
                        No trend data available for this student
                      </div>
                    ) : (
                      <div style={{ height:220 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={detailTrend} margin={{top:5,right:20,left:-22,bottom:5}}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,85,255,.07)"/>
                            <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fill:T3,fontSize:11,fontWeight:600}}/>
                            <YAxis axisLine={false} tickLine={false} tick={{fill:T3,fontSize:11,fontWeight:600}} domain={[0,100]}/>
                            <Tooltip contentStyle={{ borderRadius:12, border:"none", boxShadow:SHADOW_LG, fontSize:11, fontWeight:700 }}/>
                            <Line type="monotone" dataKey="score" name="Score" stroke={isCritical?RED:B1} strokeWidth={3}
                              dot={{r:4,fill:isCritical?RED:B1,strokeWidth:2,stroke:"#fff"}} activeDot={{r:6}} connectNulls={false}/>
                            <Line type="monotone" dataKey="attendance" name="Attendance" stroke={GREEN} strokeWidth={3} strokeDasharray="5 5"
                              dot={{r:4,fill:GREEN,strokeWidth:2,stroke:"#fff"}} activeDot={{r:6}} connectNulls={false}/>
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ── AI Intelligence Card ─────────────────── */}
          <div
            {...tilt3D}
            onClick={()=>navigate("/ai-predictor")}
            role="button" tabIndex={0}
            style={{
              background:GRAD_HERO, borderRadius: isMobile ? 16 : 22, padding: isMobile ? "18px 16px" : "24px 26px", color:"#fff",
              position:"relative", overflow:"hidden",
              boxShadow:"0 14px 40px rgba(0,8,60,.32), 0 0 0 .5px rgba(255,255,255,.12)",
              cursor:"pointer",
              ...tilt3DStyle,
            }}
          >
            <div style={{ position:"absolute", bottom:-50, left:-40, width:240, height:240, background:"radial-gradient(circle, rgba(123,63,244,.28) 0%, transparent 65%)", borderRadius:"50%", pointerEvents:"none" }}/>
            <div style={{ display:"flex", alignItems:"flex-start", gap: isMobile ? 12 : 14, position:"relative", zIndex:1, marginBottom: isMobile ? 14 : 16 }}>
              <div style={{ width: isMobile ? 38 : 44, height: isMobile ? 38 : 44, borderRadius: isMobile ? 11 : 13, background:"rgba(255,255,255,.16)", border:"0.5px solid rgba(255,255,255,.26)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                <Sparkles size={isMobile ? 18 : 22} color="#fff" strokeWidth={2.2}/>
              </div>
              <div style={{ minWidth:0 }}>
                <div style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"3px 10px", borderRadius:999, background:"rgba(255,255,255,.14)", border:"0.5px solid rgba(255,255,255,.22)", fontSize:9, fontWeight:800, letterSpacing:"0.14em", textTransform:"uppercase", marginBottom:8 }}>
                  AI Insights
                </div>
                <h3 style={{ fontSize: isMobile ? 15 : 18, fontWeight:700, color:"#fff", margin:0, letterSpacing:"-0.4px" }}>Student Intelligence Summary</h3>
              </div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: isMobile ? 10 : 12, position:"relative", zIndex:1 }}>
              {[
                { label:"Performance Insight", value:highPerformers>0?`${((highPerformers/Math.max(totalEnrollment,1))*100).toFixed(0)}% high performers`:"Track top scorers", sub:atRisk>0?`${atRisk} need attention`:"All stable" },
                { label:"Attendance Pulse", value:avgAttendance > 0 ? `${avgAttendance}% campus avg` : "Collecting data", sub:avgAttendance>=90?"Excellent":avgAttendance>=75?"Healthy":"Monitor closely" },
                { label:"Enrollment Momentum", value:newThisTerm > 0 ? `+${newThisTerm} new this term` : "Steady state", sub:`${totalEnrollment} total scholars` },
              ].map(c=>(
                <div key={c.label} style={{ background:"rgba(255,255,255,.10)", borderRadius: isMobile ? 12 : 14, padding: isMobile ? "12px 14px" : "14px 16px", border:"0.5px solid rgba(255,255,255,.14)" }}>
                  <p style={{ fontSize:9, fontWeight:800, color:"rgba(255,255,255,.65)", letterSpacing:"0.14em", textTransform:"uppercase", margin:"0 0 8px 0" }}>{c.label}</p>
                  <p style={{ fontSize: isMobile ? 14 : 15, fontWeight:700, color:"#fff", margin:0, letterSpacing:"-0.3px" }}>{c.value}</p>
                  <p style={{ fontSize: isMobile ? 10 : 11, fontWeight:600, color:"rgba(255,255,255,.72)", margin:"6px 0 0 0" }}>{c.sub}</p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
      </div>
    </>
  );

}
