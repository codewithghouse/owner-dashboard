import { useState, useEffect, useMemo } from "react";
import { db, auth } from "@/lib/firebase";
import {
  collection, query, where, onSnapshot, getDocs,
} from "firebase/firestore";
import {
  Trophy, Loader2, Building2, Users, Award, Crown,
  TrendingUp, Filter, ChevronDown, X, Search, Sparkles,
} from "lucide-react";
import {
  B1, T1, T3, T4, GREEN, RED, GOLD, VIOLET,
  GRAD_PRIMARY, GRAD_BLUE, GRAD_GREEN, GRAD_VIOLET, GRAD_GOLD, GRAD_RED,
  SHADOW_SM, SHADOW_BTN, usePageShellStyle,
  DashGlobalStyles, PageHead, StatTile, DarkHero, Card3D, AIInsightCard,
} from "@/lib/dashboardTokens";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  scoreTeachers, TeacherScore, TeacherDoc, ScoreDoc,
  AttendanceDoc, AssignmentDoc, TeacherAttendanceDoc,
} from "@/lib/teacherScorer";

type TimeRange = "term" | "month" | "all";

const TONE_CLASSES: Record<string, string> = {
  gold:    "bg-amber-50   text-amber-700   border-amber-200",
  blue:    "bg-blue-50    text-blue-700    border-blue-200",
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
  violet:  "bg-violet-50  text-violet-700  border-violet-200",
  rose:    "bg-rose-50    text-rose-700    border-rose-200",
};

const initialsOf = (name?: string) => {
  if (!name) return "??";
  const parts = name.trim().split(/\s+/);
  return (parts.length >= 2 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase();
};

const scoreTone = (n: number) =>
  n >= 80 ? "text-emerald-600" : n >= 60 ? "text-blue-600" : n >= 40 ? "text-amber-600" : "text-rose-600";

const scoreBgTone = (n: number) =>
  n >= 80 ? "bg-emerald-500" : n >= 60 ? "bg-blue-500" : n >= 40 ? "bg-amber-500" : "bg-rose-500";

// ── Time-range → cutoff date ─────────────────────────────────────────────
function cutoffFor(range: TimeRange): Date | null {
  const now = new Date();
  if (range === "month") {
    const d = new Date(now);
    d.setDate(d.getDate() - 30);
    return d;
  }
  if (range === "term") {
    const d = new Date(now);
    d.setDate(d.getDate() - 120); // approx 4-month term
    return d;
  }
  return null;
}

function filterByTime<T extends { date?: any; createdAt?: any; uploadedAt?: any }>(
  items: T[], cutoff: Date | null, keys: string[]
): T[] {
  if (!cutoff) return items;
  const cutMs = cutoff.getTime();
  return items.filter((d: any) => {
    for (const k of keys) {
      const v = d[k];
      if (!v) continue;
      const ms = v?.toMillis?.() ?? (typeof v === "number" ? v : v?.seconds ? v.seconds * 1000 : new Date(v).getTime());
      if (Number.isFinite(ms) && ms >= cutMs) return true;
    }
    return false;
  });
}

/* Composite=0 alone doesn't mean "bad teacher" — it can also mean "no data
   recorded yet". Distinguish so we don't paint new teachers red on the list
   or include them in averages (per `bug_pattern_score_zero_no_data` memory rule). */
const hasTeacherData = (r: TeacherScore) =>
  r.composite > 0 && (r.testCount > 0 || r.assignments > 0 || r.attendance !== null);

// ═════════════════════════════════════════════════════════════════════════
export default function TeacherLeaderboard() {
  const isMobile = useIsMobile();
  const pageShellStyle = usePageShellStyle();
  const [loading, setLoading] = useState(true);
  const [teachers, setTeachers] = useState<TeacherDoc[]>([]);
  const [testScores, setTestScores] = useState<ScoreDoc[]>([]);
  const [results, setResults] = useState<ScoreDoc[]>([]);
  const [gradebook, setGradebook] = useState<ScoreDoc[]>([]);
  const [attendance, setAttendance] = useState<AttendanceDoc[]>([]);
  const [assignments, setAssignments] = useState<AssignmentDoc[]>([]);
  const [tAttendance, setTAttendance] = useState<TeacherAttendanceDoc[]>([]);
  const [teachingAssignments, setTeachingAssignments] = useState<any[]>([]);
  const [branchMap, setBranchMap] = useState<Map<string, string>>(new Map());

  const [branchFilter, setBranchFilter] = useState<string>("All");
  const [timeRange, setTimeRange] = useState<TimeRange>("term");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<TeacherScore | null>(null);

  // ── Load ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) { setLoading(false); return; }

    let loadedCount = 0;
    const markLoaded = () => {
      loadedCount++;
      if (loadedCount >= 8) setLoading(false);
    };

    // Branch names map
    getDocs(collection(db, "schools", uid, "branches")).then((snap) => {
      const m = new Map<string, string>();
      snap.docs.forEach((d) => {
        const data = d.data() as any;
        const id = data.branchId || d.id;
        if (id) m.set(id, data.name || data.branchName || id);
      });
      setBranchMap(m);
    });

    const schoolQ = (col: string) => query(collection(db, col), where("schoolId", "==", uid));

    const unsubs = [
      onSnapshot(schoolQ("teachers"),         (s) => { setTeachers(s.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))); markLoaded(); }, () => markLoaded()),
      onSnapshot(schoolQ("test_scores"),      (s) => { setTestScores(s.docs.map((d) => d.data() as ScoreDoc)); markLoaded(); }, () => markLoaded()),
      onSnapshot(schoolQ("results"),          (s) => { setResults(s.docs.map((d) => d.data() as ScoreDoc)); markLoaded(); }, () => markLoaded()),
      onSnapshot(schoolQ("gradebook_scores"), (s) => { setGradebook(s.docs.map((d) => d.data() as ScoreDoc)); markLoaded(); }, () => markLoaded()),
      onSnapshot(schoolQ("attendance"),       (s) => { setAttendance(s.docs.map((d) => d.data() as AttendanceDoc)); markLoaded(); }, () => markLoaded()),
      onSnapshot(schoolQ("assignments"),      (s) => { setAssignments(s.docs.map((d) => d.data() as AssignmentDoc)); markLoaded(); }, () => markLoaded()),
      onSnapshot(schoolQ("teacher_attendance"), (s) => { setTAttendance(s.docs.map((d) => d.data() as TeacherAttendanceDoc)); markLoaded(); }, () => markLoaded()),
      onSnapshot(schoolQ("teaching_assignments"), (s) => { setTeachingAssignments(s.docs.map((d) => d.data() as any)); markLoaded(); }, () => markLoaded()),
    ];

    return () => unsubs.forEach((u) => u());
  }, []);

  // ── Branch options — sourced from `branches` subcollection so branches with
  //     no teachers yet still appear (per `bug_pattern_branch_dropdown_derived`
  //     memory rule). Deriving from `teachers[].branchId` would silently hide
  //     newly-opened branches and skew Owner's mental model.
  const branchOptions = useMemo(() => {
    const ids = [...branchMap.keys()].sort((a, b) =>
      (branchMap.get(a) || "").localeCompare(branchMap.get(b) || "")
    );
    return ["All", ...ids];
  }, [branchMap]);

  // ── Apply filters + compute scores ───────────────────────────────────────
  const ranked: TeacherScore[] = useMemo(() => {
    const cut = cutoffFor(timeRange);

    const filtered = (list: TeacherDoc[] | any[]) => {
      if (branchFilter === "All") return list;
      return list.filter((x: any) => x.branchId === branchFilter);
    };

    /* Time-range key sets must cover every timestamp field name writers use,
       otherwise filterByTime silently drops every doc and leaderboard scores
       collapse to 0% under "Term"/"Month" range. Discovered fields per writer:
         - test_scores      → `timestamp` (EnterScores.tsx)
         - gradebook_scores → `updatedAt` (Gradebook.tsx)
         - results          → `date` / `createdAt` (Excel uploads)
         - attendance       → `date` + `timestamp` (MarkAttendance.tsx)
         - assignments      → `createdAt` (CreateAssignment.tsx)
         - teacher_attendance → `date` / `timestamp` (Principal-side) */
    const scoreKeys     = ["timestamp", "updatedAt", "date", "createdAt", "uploadedAt"];
    const attKeys       = ["timestamp", "date", "createdAt"];
    const assignKeys    = ["createdAt", "timestamp", "uploadedAt", "date"];
    const scored = scoreTeachers({
      teachers:            filtered(teachers),
      scores:              filterByTime(filtered([...testScores, ...results, ...gradebook]) as any, cut, scoreKeys),
      attendance:          filterByTime(filtered(attendance) as any, cut, attKeys),
      assignments:         filterByTime(filtered(assignments) as any, cut, assignKeys),
      teacherAttendance:   filterByTime(filtered(tAttendance) as any, cut, attKeys),
      teachingAssignments: filtered(teachingAssignments),
    });

    const q = search.trim().toLowerCase();
    if (!q) return scored;
    return scored.filter((t) =>
      (t.teacher.name || "").toLowerCase().includes(q) ||
      (t.teacher.email || "").toLowerCase().includes(q)
    );
  }, [teachers, testScores, results, gradebook, attendance, assignments, tAttendance, teachingAssignments, branchFilter, timeRange, search]);

  // ── Stats for top cards ──────────────────────────────────────────────────
  const stats = useMemo(() => {
    const total = ranked.length;
    const withData = ranked.filter(hasTeacherData);
    /* Avg over teachers WITH data — including 0%/no-data teachers would drag
       the average down and read as "team is failing" when really data just
       hasn't been recorded yet. */
    const avg = withData.length > 0
      ? withData.reduce((a, b) => a + b.composite, 0) / withData.length
      : 0;
    /* Top is the highest-scoring teacher WITH data, not just ranked[0] which
       could be a new teacher with composite=0 and a misleading "leads" badge. */
    const top = withData[0];
    /* "Active" should mean "has any signal at all" — same definition as
       hasTeacherData so the count matches the podium-eligible set. */
    const active = withData.length;
    return { total, avg, top, active };
  }, [ranked]);

  // Podium and "rest" derived from the same definition used in stats.
  const dataTeachers   = ranked.filter(hasTeacherData);
  const noDataTeachers = ranked.filter((r) => !hasTeacherData(r));
  const top3 = dataTeachers.slice(0, 3);
  const rest = [...dataTeachers.slice(3), ...noDataTeachers];

  // ═══════════════════════════════════════════════════════════════════════
  if (loading) {
    return (
      <div style={{ ...pageShellStyle, display:"flex", alignItems:"center", justifyContent:"center" }}>
        <Loader2 className="animate-spin" size={32} color={B1}/>
      </div>
    );
  }

  return (
    <>
      <DashGlobalStyles />
      <div style={{ ...pageShellStyle, display:"flex", flexDirection:"column", gap: isMobile ? 16 : 24 }}>

      <PageHead
        icon={Trophy}
        title="Teacher Leaderboard"
        subtitle={isMobile ? "Ranked by outcomes & engagement" : "Auto-ranked by student outcomes + engagement"}
        right={
          <div style={{ display:"flex", alignItems:"center", gap: isMobile ? 8 : 8, flexWrap:"wrap", width: isMobile ? "100%" : "auto" }}>
            <div style={{ display:"flex", padding:4, borderRadius: isMobile ? 12 : 14, background:"#fff", border:"0.5px solid rgba(0,85,255,.12)", boxShadow:SHADOW_SM, width: isMobile ? "100%" : "auto" }}>
              {(["term", "month", "all"] as TimeRange[]).map((r) => {
                const active = timeRange === r;
                return (
                  <button
                    key={r}
                    onClick={() => setTimeRange(r)}
                    className="dash-btn"
                    style={{
                      padding: isMobile ? "7px 8px" : "7px 14px", borderRadius: isMobile ? 9 : 10,
                      background: active ? GRAD_PRIMARY : "transparent",
                      color: active ? "#fff" : T3,
                      fontSize: isMobile ? 9 : 10, fontWeight:800, letterSpacing: isMobile ? "0.06em" : "0.10em", textTransform:"uppercase",
                      border:"none", cursor:"pointer", fontFamily:"inherit",
                      boxShadow: active ? SHADOW_BTN : "none",
                      flex: isMobile ? 1 : "initial", whiteSpace:"nowrap",
                    }}
                  >
                    {r === "term" ? (isMobile ? "Term" : "This Term") : r === "month" ? (isMobile ? "Month" : "This Month") : (isMobile ? "All" : "All Time")}
                  </button>
                );
              })}
            </div>
            <div style={{ position:"relative", width: isMobile ? "100%" : "auto" }}>
              <Building2 size={14} color={T4} style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", pointerEvents:"none" }}/>
              <select
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                style={{
                  appearance:"none", padding: isMobile ? "9px 34px 9px 34px" : "10px 36px 10px 36px",
                  borderRadius: isMobile ? 12 : 14, border:"0.5px solid rgba(0,85,255,.12)",
                  background:"#fff", boxShadow:SHADOW_SM,
                  fontSize:12, fontWeight:700, color:T3,
                  outline:"none", fontFamily:"inherit", cursor:"pointer",
                  minWidth: isMobile ? 0 : 180, width: isMobile ? "100%" : "auto",
                }}
              >
                {branchOptions.map((b) => (
                  <option key={b} value={b}>{b === "All" ? "All Branches" : branchMap.get(b) || b}</option>
                ))}
              </select>
              <ChevronDown size={13} color={T4} style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)", pointerEvents:"none" }}/>
            </div>
          </div>
        }
      />

      <DarkHero
        icon={Award}
        eyebrow={<><Sparkles size={11} style={{ display:"inline", marginRight:4 }}/> Performance Intelligence</> as any}
        title={stats.top ? `${stats.top.composite.toFixed(0)}%` : "—"}
        subtitle={stats.top ? `${stats.top.teacher.name} leads · ${stats.total} teacher${stats.total!==1?"s":""} ranked · ${stats.avg.toFixed(1)}% avg performance` : "No data yet — rankings appear once academic data is recorded"}
        stats={[
          { label:"Total",  value: stats.total.toString() },
          { label:"Active", value: stats.active.toString() },
          { label:"Avg",    value: `${stats.avg.toFixed(0)}%` },
        ]}
      />

      {/* Bright Stat Grid */}
      <div style={{ display:"grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: isMobile ? 10 : 16 }}>
        <StatTile label="Total Teachers"   value={stats.total.toString()}                                        sub="In scope"                          grad={GRAD_BLUE}   icon={Users} />
        <StatTile label="Avg Performance"  value={`${stats.avg.toFixed(1)}%`}                                    sub="Across all teachers"                grad={GRAD_GREEN}  icon={TrendingUp} />
        <StatTile label="Active Teachers"  value={stats.active.toString()}                                       sub="With recent data"                   grad={GRAD_VIOLET} icon={Sparkles} />
        <StatTile label="Top Performer"    value={stats.top ? `${stats.top.composite.toFixed(0)}%` : "—"}        sub={stats.top?.teacher.name || "No data yet"} grad={GRAD_GOLD} icon={Crown} onClick={()=>stats.top && setSelected(stats.top)} />
      </div>

      {/* Empty state */}
      {ranked.length === 0 ? (
        <div className="dash3d bg-white border border-dashed border-slate-200 rounded-2xl p-6 md:p-12 text-center" style={{ boxShadow: SHADOW_SM }}>
          <Trophy className="w-10 h-10 md:w-12 md:h-12 text-slate-200 mx-auto mb-3 md:mb-4" />
          <h3 className="text-sm md:text-base font-extrabold text-[#1e294b] mb-1">No teachers to rank yet</h3>
          <p className="text-xs md:text-sm text-slate-500 font-medium max-w-md mx-auto leading-snug">
            Once principals add teachers and academic data is recorded, they'll appear here with performance rankings.
          </p>
        </div>
      ) : (
        <>
          {/* ═══ Top Podium — only teachers with real data ════════════ */}
          {top3.length > 0 && (
            <div className="dash3d bg-gradient-to-br from-amber-50 via-white to-blue-50 rounded-2xl md:rounded-3xl border border-amber-100 p-4 md:p-8 pt-8 md:pt-10" style={{ boxShadow: SHADOW_SM }}>
              <div className="flex items-center gap-2 mb-5 md:mb-8">
                <Award className="w-4 h-4 md:w-5 md:h-5 text-amber-600" />
                <h2 className="text-[11px] md:text-sm font-extrabold text-[#1e294b] uppercase tracking-wider">
                  {top3.length === 1 ? "Top Performer" : top3.length === 2 ? "Top 2 Performers" : "Top 3 Performers"}
                </h2>
              </div>

              {isMobile ? (
                // ─── Mobile podium: #1 featured on top, #2+#3 in 2-col row below ───
                <div className="flex flex-col gap-4">
                  {top3[0] && (
                    <div className="max-w-[200px] mx-auto w-full">
                      <PodiumCard
                        rank={1}
                        score={top3[0]}
                        branchName={branchMap.get(top3[0].teacher.branchId || "") || top3[0].teacher.branchId || ""}
                        onClick={() => setSelected(top3[0])}
                        isMobile
                      />
                    </div>
                  )}
                  {top3.length > 1 && (
                    <div className="grid grid-cols-2 gap-3 items-end">
                      {top3[1] && (
                        <PodiumCard
                          rank={2}
                          score={top3[1]}
                          branchName={branchMap.get(top3[1].teacher.branchId || "") || top3[1].teacher.branchId || ""}
                          onClick={() => setSelected(top3[1])}
                          isMobile
                        />
                      )}
                      {top3[2] && (
                        <PodiumCard
                          rank={3}
                          score={top3[2]}
                          branchName={branchMap.get(top3[2].teacher.branchId || "") || top3[2].teacher.branchId || ""}
                          onClick={() => setSelected(top3[2])}
                          isMobile
                        />
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className={`grid gap-3 md:gap-6 items-end ${
                  top3.length === 1 ? "grid-cols-1 max-w-xs mx-auto" :
                  top3.length === 2 ? "grid-cols-2 max-w-2xl mx-auto" :
                  "grid-cols-3"
                }`}>
                  {top3.length >= 3 && top3[1] && (
                    <PodiumCard
                      rank={2}
                      score={top3[1]}
                      branchName={branchMap.get(top3[1].teacher.branchId || "") || top3[1].teacher.branchId || ""}
                      onClick={() => setSelected(top3[1])}
                    />
                  )}
                  {top3[0] && (
                    <PodiumCard
                      rank={1}
                      score={top3[0]}
                      branchName={branchMap.get(top3[0].teacher.branchId || "") || top3[0].teacher.branchId || ""}
                      onClick={() => setSelected(top3[0])}
                    />
                  )}
                  {top3.length === 2 && top3[1] && (
                    <PodiumCard
                      rank={2}
                      score={top3[1]}
                      branchName={branchMap.get(top3[1].teacher.branchId || "") || top3[1].teacher.branchId || ""}
                      onClick={() => setSelected(top3[1])}
                    />
                  )}
                  {top3.length >= 3 && top3[2] && (
                    <PodiumCard
                      rank={3}
                      score={top3[2]}
                      branchName={branchMap.get(top3[2].teacher.branchId || "") || top3[2].teacher.branchId || ""}
                      onClick={() => setSelected(top3[2])}
                    />
                  )}
                </div>
              )}
            </div>
          )}

          {/* Search bar */}
          <div className="flex items-center gap-2 md:gap-3">
            <div className="relative flex-1 md:max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={isMobile ? "Search teacher..." : "Search teacher by name or email..."}
                className="pl-10 h-10 w-full border border-slate-200 rounded-xl text-xs font-semibold bg-white outline-none focus:ring-2 focus:ring-[#1e3a8a]/10"
              />
            </div>
            {branchFilter !== "All" && (
              <button
                onClick={() => setBranchFilter("All")}
                className="flex items-center gap-1.5 px-2.5 md:px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-bold uppercase tracking-wider transition-all shrink-0"
              >
                <X className="w-3 h-3" /> {isMobile ? "Clear" : "Clear Branch"}
              </button>
            )}
          </div>

          {/* ═══ Full ranked list ══════════════════════════════════════ */}
          <div className="dash3d bg-white rounded-2xl border border-slate-100 overflow-hidden" style={{ boxShadow: SHADOW_SM }}>
            <div className="px-4 md:px-5 py-3 md:py-3.5 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <h3 className="text-[11px] md:text-xs font-extrabold text-[#1e294b] uppercase tracking-wider flex items-center gap-2">
                <Filter className="w-3 h-3 md:w-3.5 md:h-3.5" /> Full Rankings ({ranked.length})
              </h3>
            </div>
            <div className={`divide-y divide-slate-100 ${isMobile ? "max-h-[65vh]" : "max-h-[600px]"} overflow-y-auto`}>
              {(rest.length > 0 ? rest : ranked).map((r, i) => {
                const rank = rest.length > 0 ? i + 4 : i + 1;
                return (
                  <TeacherRow
                    key={r.teacher.id}
                    rank={rank}
                    score={r}
                    branchName={branchMap.get(r.teacher.branchId || "") || r.teacher.branchId || ""}
                    onClick={() => setSelected(r)}
                    isMobile={isMobile}
                  />
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* ═══ Detail Modal ═══════════════════════════════════════════════ */}
      {selected && (
        <DetailModal
          score={selected}
          branchName={branchMap.get(selected.teacher.branchId || "") || selected.teacher.branchId || ""}
          onClose={() => setSelected(null)}
          isMobile={isMobile}
        />
      )}

      {ranked.length > 0 && (
        <AIInsightCard
          title="Leaderboard Intelligence"
          items={[
            { label:"Top Signal",       value: stats.top ? `${stats.top.teacher.name}` : "No top yet", sub: stats.top ? `${stats.top.composite.toFixed(0)}% composite` : "Awaiting data" },
            { label:"Team Pulse",       value: `${stats.avg.toFixed(0)}% avg`, sub: stats.avg >= 70 ? "Healthy team" : stats.avg >= 50 ? "Room to grow" : "Needs focus" },
            { label:"Data Coverage",    value: `${stats.active}/${stats.total} active`, sub: stats.active < stats.total ? `${stats.total - stats.active} without recent data` : "All teachers tracked" },
          ]}
        />
      )}
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Subcomponents
// ═══════════════════════════════════════════════════════════════════════════

function PodiumCard({
  rank, score, branchName, onClick, isMobile = false,
}: { rank: 1 | 2 | 3; score: TeacherScore; branchName: string; onClick: () => void; isMobile?: boolean }) {
  // Mobile uses uniform heights so #2 and #3 sit equal in the grid below the hero #1.
  const heightClass = isMobile
    ? (rank === 1 ? "min-h-[200px]" : "min-h-[170px]")
    : (rank === 1 ? "min-h-[260px]" : rank === 2 ? "min-h-[220px]" : "min-h-[200px]");
  const accent =
    rank === 1 ? { border: "border-amber-300", bg: "bg-gradient-to-br from-amber-100 to-white", ring: "ring-amber-400/40", badgeBg: "bg-amber-500", trophy: "text-amber-600" }
    : rank === 2 ? { border: "border-slate-300", bg: "bg-gradient-to-br from-slate-100 to-white", ring: "ring-slate-400/30", badgeBg: "bg-slate-400", trophy: "text-slate-500" }
    : { border: "border-orange-300", bg: "bg-gradient-to-br from-orange-100 to-white", ring: "ring-orange-400/30", badgeBg: "bg-orange-500", trophy: "text-orange-600" };

  const rounded = isMobile ? "rounded-2xl" : "rounded-3xl";
  const padding = isMobile
    ? (rank === 1 ? "p-3 pt-7" : "p-2.5 pt-6")
    : "p-4 md:p-5 pt-8";
  const badgeSize = isMobile
    ? (rank === 1 ? "w-9 h-9 -top-4 text-base" : "w-8 h-8 -top-4 text-sm")
    : "w-10 h-10 md:w-12 md:h-12 -top-5 text-lg md:text-xl";
  const avatarSize = isMobile
    ? (rank === 1 ? "w-14 h-14 text-base" : "w-11 h-11 text-sm")
    : "w-14 h-14 md:w-16 md:h-16 text-base md:text-lg";
  const nameSize = isMobile ? (rank === 1 ? "text-[13px]" : "text-[11px]") : "text-sm md:text-base";
  const scoreSize = isMobile ? (rank === 1 ? "text-2xl" : "text-xl") : "text-2xl md:text-3xl";
  const crownSize = isMobile ? "w-6 h-6 mb-1" : "w-7 h-7 md:w-8 md:h-8 mb-2";

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      className={`dash3d clickable-card relative ${accent.bg} ${accent.border} border-2 ${rounded} ${padding} flex flex-col items-center justify-end text-center hover:ring-4 ${accent.ring} cursor-pointer ${heightClass}`}
      style={{ boxShadow: SHADOW_SM }}
    >
      {/* Rank badge */}
      <div className={`absolute left-1/2 -translate-x-1/2 rounded-full ${accent.badgeBg} flex items-center justify-center text-white font-black shadow-lg ring-4 ring-white ${badgeSize}`}>
        {rank}
      </div>

      {/* Crown for #1 */}
      {rank === 1 && <Crown className={`${crownSize} ${accent.trophy}`} />}

      {/* Initials circle */}
      <div className={`rounded-full bg-white border-2 ${accent.border} flex items-center justify-center font-extrabold text-[#1e294b] shadow-sm mb-2 md:mb-3 ${avatarSize}`}>
        {initialsOf(score.teacher.name)}
      </div>

      <h4 className={`${nameSize} font-extrabold text-[#1e294b] truncate w-full px-1`}>
        {score.teacher.name || score.teacher.email || "Teacher"}
      </h4>
      {branchName && (
        <p className={`${isMobile ? "text-[9px]" : "text-[10px]"} font-bold text-slate-500 uppercase tracking-wider mt-0.5 md:mt-1 truncate w-full`}>
          {branchName}
        </p>
      )}

      <div className={`font-black mt-1.5 md:mt-2 ${scoreSize} ${scoreTone(score.composite)}`}>
        {score.composite.toFixed(0)}%
      </div>

      {/* Reasons — show 2 on desktop, 1 on mobile #2/#3, 2 on mobile #1 */}
      <div className="flex flex-wrap justify-center gap-1 mt-1.5 md:mt-2">
        {score.reasons.slice(0, isMobile && rank !== 1 ? 1 : 2).map((b, i) => (
          <span key={i} className={`${isMobile ? "text-[8px] px-1.5" : "text-[9px] px-2"} font-bold py-0.5 rounded-full border ${TONE_CLASSES[b.tone]}`}>
            {b.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function TeacherRow({
  rank, score, branchName, onClick, isMobile = false,
}: { rank: number; score: TeacherScore; branchName: string; onClick: () => void; isMobile?: boolean }) {
  /* No-data teachers should not look like they're failing. Show "—" in
     neutral gray instead of "0%" in red. */
  const noData = !hasTeacherData(score);
  // Mobile: 2-line row — top line has rank + avatar + name/branch + score.
  // Progress bar occupies full row width below for clearer signal.
  if (isMobile) {
    return (
      <div
        onClick={onClick}
        role="button"
        tabIndex={0}
        className="px-3 py-3 hover:bg-slate-50/60 active:bg-slate-100/60 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-3">
          {/* Rank */}
          <div className="w-6 text-center text-[11px] font-black text-slate-400 shrink-0">
            #{rank}
          </div>

          {/* Avatar */}
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center text-[11px] font-extrabold text-[#1e294b] flex-shrink-0">
            {initialsOf(score.teacher.name)}
          </div>

          {/* Name + branch */}
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-extrabold text-[#1e294b] truncate leading-tight">
              {score.teacher.name || score.teacher.email || "Teacher"}
            </p>
            {branchName && (
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider truncate">
                {branchName}
              </p>
            )}
          </div>

          {/* Score */}
          {noData ? (
            <p className="text-base font-black shrink-0 text-slate-300">—</p>
          ) : (
            <p className={`text-base font-black shrink-0 ${scoreTone(score.composite)}`}>
              {score.composite.toFixed(0)}%
            </p>
          )}
        </div>

        {/* Full-width progress bar — hidden for no-data so we don't render an
            empty/colored sliver that signals failure. */}
        {!noData && (
          <div className="mt-2 ml-9 h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div
              className={`h-full ${scoreBgTone(score.composite)} rounded-full transition-all duration-500`}
              style={{ width: `${Math.min(100, score.composite)}%` }}
            />
          </div>
        )}
      </div>
    );
  }

  // Desktop (original)
  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      className="px-4 md:px-5 py-3.5 flex items-center gap-3 md:gap-4 hover:bg-slate-50/60 transition-colors cursor-pointer"
    >
      {/* Rank */}
      <div className="w-7 md:w-9 text-center text-xs md:text-sm font-black text-slate-400">
        #{rank}
      </div>

      {/* Avatar */}
      <div className="w-10 h-10 md:w-11 md:h-11 rounded-full bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center text-xs md:text-sm font-extrabold text-[#1e294b] flex-shrink-0">
        {initialsOf(score.teacher.name)}
      </div>

      {/* Name + branch */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-extrabold text-[#1e294b] truncate">
          {score.teacher.name || score.teacher.email || "Teacher"}
        </p>
        {branchName && (
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider truncate">
            {branchName}
          </p>
        )}
      </div>

      {/* Reason badges */}
      <div className="hidden md:flex flex-wrap gap-1 max-w-[340px] justify-end">
        {score.reasons.slice(0, 2).map((b, i) => (
          <span key={i} className={`text-[9px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${TONE_CLASSES[b.tone]}`}>
            {b.label}: {b.value}
          </span>
        ))}
      </div>

      {/* Score */}
      <div className="flex items-center gap-3 ml-auto md:ml-0">
        <div className="w-20 md:w-32 flex flex-col items-end">
          {noData ? (
            <>
              <p className="text-base md:text-lg font-black text-slate-300">—</p>
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">No data yet</p>
            </>
          ) : (
            <>
              <p className={`text-base md:text-lg font-black ${scoreTone(score.composite)}`}>
                {score.composite.toFixed(0)}%
              </p>
              <div className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className={`h-full ${scoreBgTone(score.composite)} rounded-full transition-all duration-500`}
                  style={{ width: `${Math.min(100, score.composite)}%` }}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailModal({
  score, branchName, onClose, isMobile = false,
}: { score: TeacherScore; branchName: string; onClose: () => void; isMobile?: boolean }) {
  const metrics = [
    { label: "Class Avg Score", value: score.classAvg,    weight: 35, unit: "%" },
    { label: "Pass Rate",       value: score.passRate,    weight: 20, unit: "%" },
    { label: "Class Attendance", value: score.attendance, weight: 20, unit: "%" },
    { label: "Assignments",     value: score.assignments, weight: 15, unit: " posted", raw: true },
    { label: "Punctuality",     value: score.punctuality, weight: 10, unit: "%" },
  ];

  return (
    <div
      className={`fixed inset-0 z-50 bg-black/50 flex ${isMobile ? "items-end p-0" : "items-center justify-center p-4"}`}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`bg-white flex flex-col shadow-2xl overflow-hidden ${
          isMobile
            ? "w-full rounded-t-3xl max-h-[92vh] animate-in slide-in-from-bottom-8 duration-300"
            : "rounded-3xl w-full max-w-2xl max-h-[90vh]"
        }`}
      >
        {/* Drag handle (mobile only) */}
        {isMobile && (
          <div className="flex justify-center pt-2 pb-1 bg-gradient-to-r from-amber-50 to-blue-50">
            <div className="w-10 h-1 rounded-full bg-slate-300" />
          </div>
        )}

        {/* Header */}
        <div className={`${isMobile ? "px-4 py-3" : "px-6 py-5"} border-b border-slate-100 bg-gradient-to-r from-amber-50 to-blue-50 flex items-start justify-between gap-2 md:gap-3`}>
          <div className={`flex items-start ${isMobile ? "gap-3" : "gap-4"} min-w-0 flex-1`}>
            <div className={`${isMobile ? "w-12 h-12 text-sm" : "w-14 h-14 text-base"} rounded-full bg-white border-2 border-amber-200 flex items-center justify-center font-extrabold text-[#1e294b] flex-shrink-0`}>
              {initialsOf(score.teacher.name)}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className={`${isMobile ? "text-[15px]" : "text-base md:text-lg"} font-extrabold text-[#1e294b] truncate`}>
                {score.teacher.name || score.teacher.email}
              </h3>
              <p className={`${isMobile ? "text-[11px]" : "text-xs"} font-semibold text-slate-500 truncate`}>
                {branchName ? `${branchName} · ` : ""}{score.teacher.email || "No email"}
              </p>
              <div className="flex items-center gap-2 mt-1.5 md:mt-2 flex-wrap">
                <span className={`${isMobile ? "text-xl" : "text-xl md:text-2xl"} font-black ${scoreTone(score.composite)}`}>
                  {score.composite.toFixed(1)}%
                </span>
                <span className="text-[9px] md:text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  Composite Score
                </span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/60 transition-all shrink-0">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        {/* Body */}
        <div className={`flex-1 overflow-y-auto ${isMobile ? "px-4 py-4 space-y-4" : "px-6 py-5 space-y-5"}`}>
          {/* Reasons */}
          {score.reasons.length > 0 && (
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                Why They Rank Here
              </p>
              <div className="flex flex-wrap gap-1.5 md:gap-2">
                {score.reasons.map((b, i) => (
                  <span
                    key={i}
                    className={`${isMobile ? "text-[10px] px-2.5 py-1" : "text-xs px-3 py-1.5"} font-bold rounded-full border ${TONE_CLASSES[b.tone]}`}
                  >
                    {b.label} · {b.value}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Metric breakdown */}
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 md:mb-3">
              Score Breakdown
            </p>
            <div className="space-y-2.5 md:space-y-3">
              {metrics.map((m) => {
                const hasData = m.value !== null && m.value !== undefined;
                const displayVal = hasData
                  ? m.raw
                    ? `${m.value}${m.unit}`
                    : `${(m.value as number).toFixed(1)}${m.unit}`
                  : "No data";
                const pctBar = hasData && !m.raw ? Math.min(100, m.value as number) : 0;
                return (
                  <div key={m.label}>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`${isMobile ? "text-[11px]" : "text-xs"} font-bold text-slate-700 truncate`}>{m.label}</span>
                        <span className={`${isMobile ? "text-[8px]" : "text-[9px]"} font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap`}>
                          {m.weight}%
                        </span>
                      </div>
                      <span className={`${isMobile ? "text-[11px]" : "text-xs"} font-extrabold whitespace-nowrap ${hasData ? scoreTone(Number(m.value)) : "text-slate-400"}`}>
                        {displayVal}
                      </span>
                    </div>
                    {hasData && !m.raw && (
                      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className={`h-full ${scoreBgTone(Number(m.value))} rounded-full transition-all duration-500`}
                          style={{ width: `${pctBar}%` }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Context */}
          <div className="grid grid-cols-3 gap-2 md:gap-3">
            <div className={`bg-slate-50 rounded-xl ${isMobile ? "p-2.5" : "p-3"} text-center`}>
              <p className="text-[8px] md:text-[9px] font-black text-slate-400 uppercase tracking-widest">Students</p>
              <p className={`${isMobile ? "text-base" : "text-lg"} font-extrabold text-[#1e294b]`}>{score.studentCount}</p>
            </div>
            <div className={`bg-slate-50 rounded-xl ${isMobile ? "p-2.5" : "p-3"} text-center`}>
              <p className="text-[8px] md:text-[9px] font-black text-slate-400 uppercase tracking-widest">Tests</p>
              <p className={`${isMobile ? "text-base" : "text-lg"} font-extrabold text-[#1e294b]`}>{score.testCount}</p>
            </div>
            <div className={`bg-slate-50 rounded-xl ${isMobile ? "p-2.5" : "p-3"} text-center`}>
              <p className="text-[8px] md:text-[9px] font-black text-slate-400 uppercase tracking-widest">Assignments</p>
              <p className={`${isMobile ? "text-base" : "text-lg"} font-extrabold text-[#1e294b]`}>{score.assignments}</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className={`${isMobile ? "px-4 py-3 flex-col items-stretch gap-2" : "px-6 py-3.5 flex-row items-center justify-between"} border-t border-slate-100 bg-slate-50 flex`}>
          {!isMobile && (
            <p className="text-[10px] text-slate-400 font-semibold">
              Weighted signals: scores 35% · pass rate 20% · attendance 20% · assignments 15% · punctuality 10%
            </p>
          )}
          <button
            onClick={onClose}
            className={`${isMobile ? "w-full py-3" : "px-4 py-2"} rounded-xl bg-[#1e3a8a] text-white text-xs font-bold hover:bg-[#152961] transition-all`}
          >
            Close
          </button>
          {isMobile && (
            <p className="text-[9px] text-slate-400 font-semibold text-center leading-snug">
              Weighted: scores 35% · pass 20% · attendance 20% · assignments 15% · punctuality 10%
            </p>
          )}
        </div>
      </div>
    </div>
  );
}