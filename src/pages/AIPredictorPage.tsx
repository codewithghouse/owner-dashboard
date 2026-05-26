/**
 * AIPredictorPage.tsx
 * "AI-Powered Risk Predictor" — the standout feature.
 */
import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { db, auth } from "@/lib/firebase";
import { collection, addDoc, getDocs, getDoc, doc, setDoc, serverTimestamp } from "firebase/firestore";
import {
  Brain, AlertTriangle, TrendingDown, TrendingUp, Users,
  Search, ChevronDown, ChevronUp, RefreshCw, Share2,
  CheckCircle2, Check, Loader2, Minus,
  ShieldAlert, Eye, Sparkles,
} from "lucide-react";
import {
  fetchAllPredictions,
  StudentRiskPrediction,
  RiskLevel,
} from "@/lib/riskPredictorService";
import { toast } from "sonner";
import {
  B1, T1, T3, T4, GREEN, RED, GOLD, VIOLET, ORANGE,
  GRAD_PRIMARY, GRAD_BLUE, GRAD_GREEN, GRAD_VIOLET, GRAD_GOLD, GRAD_RED, GRAD_ORANGE,
  SHADOW_SM, SHADOW_LG, SHADOW_BTN, usePageShellStyle,
  DashGlobalStyles, PageHead, StatTile, DarkHero, Card3D, AIInsightCard,
} from "@/lib/dashboardTokens";
import { useBreakpoint } from "@/hooks/useBreakpoint";

// 30-day expiry for parent share links. Mirrored in the parent-portal
// validation. Surfaced as a constant so the toast text + the Firestore
// write never drift apart.
const PARENT_LINK_EXPIRY_DAYS = 30;

// ── Risk visual config ────────────────────────────────────────────────────────
const RISK_TIER: Record<RiskLevel, { label: string; grad: string; solidGrad: string; color: string; bg: string }> = {
  Critical: { label: "Critical Risk", grad: GRAD_RED,    solidGrad: "linear-gradient(135deg,#FF3355 0%,#DC2626 100%)", color: RED,    bg: "rgba(255,51,85,.10)" },
  High:     { label: "High Risk",     grad: GRAD_ORANGE, solidGrad: "linear-gradient(135deg,#FF8800 0%,#EA580C 100%)", color: ORANGE, bg: "rgba(255,136,0,.10)" },
  Watch:    { label: "Watch",         grad: GRAD_GOLD,   solidGrad: "linear-gradient(135deg,#F59E0B 0%,#D97706 100%)", color: GOLD,   bg: "rgba(255,170,0,.10)" },
  Safe:     { label: "Safe",          grad: GRAD_GREEN,  solidGrad: "linear-gradient(135deg,#10B981 0%,#059669 100%)", color: GREEN,  bg: "rgba(0,200,83,.10)" },
};

const RISK_ICON: Record<RiskLevel, React.ElementType> = {
  Critical: ShieldAlert,
  High:     AlertTriangle,
  Watch:    Eye,
  Safe:     CheckCircle2,
};

function getInitials(name: string) {
  return (name || "?").split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
}

// ── Component ─────────────────────────────────────────────────────────────────
// Cards per page — keeps the rendered DOM small even at 1000+ students.
// The full prediction set is loaded upfront (one cached fetch); pagination
// is client-side over the filtered list.
const PAGE_SIZE = 10;

export default function AIPredictorPage() {
  const navigate = useNavigate();
  const isMobile = useBreakpoint() === "mobile";
  const pageShellStyle = usePageShellStyle();
  const [predictions, setPredictions] = useState<StudentRiskPrediction[]>([]);
  // Canonical branch list from schools/{uid}/branches. Empty branches (no
  // enrolled students yet) still need to appear in the dropdown — the
  // user should see they exist before populating them.
  const [knownBranches, setKnownBranches] = useState<string[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [search,      setSearch]      = useState("");
  const [filterLevel, setFilterLevel] = useState<RiskLevel | "All">("All");
  const [expanded,    setExpanded]    = useState<string | null>(null);
  const [copiedId,    setCopiedId]    = useState<string | null>(null);
  // Page-level branch filter — drives the stat cards, hero subtitle, and
  // student list. Same pattern as the StudentsIntelligence page so the
  // user has one consistent gesture across owner pages.
  const [pageBranch,  setPageBranch]  = useState<string>("All");
  const [currentPage, setCurrentPage] = useState(1);

  // Initial mount uses cache (instant if warm); the Refresh button forces
  // a fresh fetch so users can manually reload after entering new scores.
  const load = async (force = false) => {
    setLoading(true);
    const data = await fetchAllPredictions({ force });
    setPredictions(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // Fetch canonical branch list once on mount. Independent of predictions
  // because branches without students still need to be selectable.
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    getDocs(collection(db, "schools", uid, "branches"))
      .then(snap => {
        const names = snap.docs
          .map(d => {
            const data = d.data() as any;
            return (data.name || data.branchName || "") as string;
          })
          .filter(Boolean);
        setKnownBranches(names);
      })
      .catch(err => console.warn("[AIPredictor] branches fetch failed:", err));
  }, []);

  // Union of canonical branches (subcollection) + any branches that appear
  // on prediction rows. The fallback covers schools whose student docs
  // carry a branch name that isn't in the subcollection (legacy data).
  const branchList = useMemo(() => {
    const set = new Set<string>(knownBranches);
    predictions.forEach(p => { if (p.branch && p.branch !== "—") set.add(p.branch); });
    return ["All", ...[...set].sort()];
  }, [predictions, knownBranches]);

  // Single source of truth for "students currently in scope". Top stat
  // cards + hero number + filter pill counts all derive from this so
  // selecting a branch re-scopes the entire page coherently.
  const branchScopedPredictions = useMemo(
    () => pageBranch === "All" ? predictions : predictions.filter(p => p.branch === pageBranch),
    [predictions, pageBranch],
  );

  const filtersActive = filterLevel !== "All" || search.trim() !== "" || pageBranch !== "All";
  const clearFilters = () => { setFilterLevel("All"); setSearch(""); setPageBranch("All"); };

  // Reset to page 1 whenever any upstream filter changes — otherwise the
  // user can land on page 4 of an empty filtered list.
  useEffect(() => { setCurrentPage(1); }, [pageBranch, filterLevel, search]);

  // Stats are branch-scoped so the top cards reflect "students currently
  // in scope" — selecting a branch flips them to that branch's tier
  // counts, not the whole school.
  const stats = useMemo(() => ({
    total:    branchScopedPredictions.length,
    critical: branchScopedPredictions.filter(p => p.riskLevel === "Critical").length,
    high:     branchScopedPredictions.filter(p => p.riskLevel === "High").length,
    watch:    branchScopedPredictions.filter(p => p.riskLevel === "Watch").length,
    safe:     branchScopedPredictions.filter(p => p.riskLevel === "Safe").length,
  }), [branchScopedPredictions]);

  const filtered = useMemo(() => {
    let list = branchScopedPredictions;
    if (filterLevel !== "All") list = list.filter(p => p.riskLevel === filterLevel);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(p =>
        p.studentName.toLowerCase().includes(q) ||
        p.branch.toLowerCase().includes(q) ||
        p.grade.toLowerCase().includes(q)
      );
    }
    return list;
  }, [branchScopedPredictions, filterLevel, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pagedPredictions = useMemo(
    () => filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filtered, currentPage],
  );

  /* School-contact lookup is per-link (not per-prediction-batch) so we
     fetch on first use and cache for the SPA session. Contact = email +
     phone + name from the owner's `schools/{uid}` doc, surfaced to
     parents in the portal footer so they can reach out without needing
     to dig through emails. */
  const [schoolContact, setSchoolContact] = useState<{
    name: string; email: string; phone: string;
  } | null>(null);
  const ensureSchoolContact = async () => {
    if (schoolContact) return schoolContact;
    const uid = auth.currentUser?.uid;
    if (!uid) return { name: "", email: "", phone: "" };
    try {
      const snap = await getDoc(doc(db, "schools", uid));
      const sd = snap.exists() ? snap.data() as any : {};
      const contact = {
        name:  sd.schoolName || sd.name  || "",
        email: sd.email      || "",
        phone: sd.phone      || sd.contactPhone || "",
      };
      setSchoolContact(contact);
      return contact;
    } catch {
      return { name: "", email: "", phone: "" };
    }
  };

  const generateParentLink = async (p: StudentRiskPrediction) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    try {
      const token  = crypto.randomUUID();
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + PARENT_LINK_EXPIRY_DAYS);
      const contact = await ensureSchoolContact();

      /* Use the token AS the Firestore doc ID. Previous `addDoc` generated
         a random docId and stored token as a field — but the parent_tokens
         security rule allows `get` (point-lookup by docId) and DENIES
         `list` (collection queries). The reader's `query + where token=X`
         was a list operation, hence "Missing or insufficient permissions".
         setDoc with token-as-docId aligns writer + reader + rules: token
         IS both the credential AND the lookup key. UUID v4 entropy (122
         bits) makes enumeration infeasible. */
      await setDoc(doc(db, "parent_tokens", token), {
        token,                    // kept as a field for legacy backfills
        studentId:   p.studentId,
        studentName: p.studentName,
        schoolId:    uid,
        // branchId added so cross-dashboard reads can scope by branch
        // without a second lookup. (See cross_dashboard_linking_rule
        // memory.) `branch` (the branch NAME) preserved for display.
        branchId:    p.branchId,
        branch:      p.branch,
        grade:       p.grade,
        attendance:  p.attendance,
        avgScore:    p.avgScore,
        recentScores:     p.recentScores,
        recentScoreDates: p.recentScoreDates,
        feeDefaulted:     p.feeDefaulted,
        feePendingAmount: p.feePendingAmount,
        failProbability:  p.failProbability,
        riskLevel:        p.riskLevel,
        riskFactors:      p.riskFactors,
        recommendation:   p.recommendation,
        // School contact for the portal footer — parents have one tap
        // to reach the school instead of asking around.
        schoolContact:    contact,
        expiresAt:        expiry.toISOString(),
        // expiresAtMs is the field a Firestore TTL policy can target.
        // Setup: Firebase Console → Firestore → TTL → add policy on
        // `parent_tokens` with field `expiresAtMs`. Without this policy
        // the collection grows unbounded — every link generated is kept
        // forever. Auto-delete via TTL keeps storage costs at ₹0 long-term.
        expiresAtMs: expiry.getTime(),
        createdAt:   serverTimestamp(),
      });

      const link = `${window.location.origin}/parent-portal?token=${token}`;
      await navigator.clipboard.writeText(link);
      setCopiedId(p.studentId);
      toast.success("Parent link copied to clipboard!");
      setTimeout(() => setCopiedId(null), 3000);
    } catch (err: any) {
      toast.error("Failed to generate link: " + err.message);
    }
  };

  if (loading) {
    return (
      <div style={{ ...pageShellStyle, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:14 }}>
        <div style={{ width: isMobile ? 48 : 56, height: isMobile ? 48 : 56, borderRadius: isMobile ? 14 : 16, background:"linear-gradient(135deg,#7B3FF4 0%,#0055FF 100%)", display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 10px 28px rgba(123,63,244,.32)" }}>
          <Brain size={isMobile ? 24 : 28} color="#fff" strokeWidth={2.2} className="animate-pulse"/>
        </div>
        <p style={{ fontSize: isMobile ? 10 : 11, fontWeight:800, color:T3, letterSpacing:"0.12em", textTransform:"uppercase", textAlign:"center" }}>Analysing student data...</p>
      </div>
    );
  }

  const criticalSafe = stats.total > 0 ? Math.round((stats.safe / stats.total) * 100) : 0;
  const atRiskTotal = stats.critical + stats.high;

  return (
    <>
      <DashGlobalStyles />
      <div style={{ ...pageShellStyle, display:"flex", flexDirection:"column", gap: isMobile ? 16 : 24 }}>

        <PageHead
          icon={Brain}
          title="AI Risk Predictor"
          subtitle="Probability of failing this semester · with explanations"
          right={
            <button
              onClick={() => load(true)}
              className="dash-btn"
              style={{
                display:"inline-flex", alignItems:"center", justifyContent:"center", gap:6,
                padding: isMobile ? "10px 14px" : "10px 16px", borderRadius:12,
                background:"#fff", color:T3, border:"0.5px solid rgba(0,85,255,.12)",
                fontSize: isMobile ? 10 : 11, fontWeight:800, letterSpacing:"0.08em", textTransform:"uppercase",
                cursor:"pointer", boxShadow:SHADOW_SM, fontFamily:"inherit",
                width: isMobile ? "100%" : "auto",
              }}
            >
              <RefreshCw size={13}/> Refresh
            </button>
          }
        />

        <DarkHero
          icon={Brain}
          eyebrow={<><Sparkles size={11} style={{ display:"inline", marginRight:4 }}/> AI-Powered Intelligence</> as any}
          title={stats.total.toString()}
          subtitle={`Student${stats.total!==1?"s":""} analysed${pageBranch !== "All" ? ` in ${pageBranch}` : ""} · ${atRiskTotal} at risk · ${criticalSafe}% currently safe`}
          stats={[
            { label:"Critical", value: stats.critical.toString() },
            { label:"High",     value: stats.high.toString() },
            { label:"Safe",     value: stats.safe.toString() },
          ]}
        />

        {/* Bright Stat Grid — each is a filter */}
        <div style={{ display:"grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: isMobile ? 10 : 16 }}>
          {/* Sublabels MUST match the bands in getRiskLevel():
              ≥70 Critical · 45–69 High · 20–44 Watch · <20 Safe.
              Earlier they read 50-69 / 30-49 / <30 — drift between the
              service thresholds and what the user saw on screen. */}
          <StatTile label="Critical Risk" value={stats.critical.toString()} sub="≥70% fail probability" grad={GRAD_RED}    icon={ShieldAlert}    onClick={() => setFilterLevel(filterLevel === "Critical" ? "All" : "Critical")} />
          <StatTile label="High Risk"     value={stats.high.toString()}     sub="45-69%"                 grad={GRAD_ORANGE} icon={AlertTriangle}  onClick={() => setFilterLevel(filterLevel === "High" ? "All" : "High")} />
          <StatTile label="Watch List"    value={stats.watch.toString()}    sub="20-44%"                 grad={GRAD_GOLD}   icon={Eye}            onClick={() => setFilterLevel(filterLevel === "Watch" ? "All" : "Watch")} />
          <StatTile label="Safe"          value={stats.safe.toString()}     sub="<20%"                   grad={GRAD_GREEN}  icon={CheckCircle2}   onClick={() => setFilterLevel(filterLevel === "Safe" ? "All" : "Safe")} />
        </div>

        {/* Filters */}
        <Card3D padding={isMobile ? "12px 14px" : "14px 18px"}>
          <div style={{ display:"flex", alignItems:"center", gap: isMobile ? 10 : 12, flexWrap:"wrap" }}>
            <div style={{ position:"relative", flex:1, minWidth: isMobile ? "100%" : 220 }}>
              <Search size={14} color={T4} style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)" }}/>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={isMobile ? "Search students…" : "Search students, branch, grade…"}
                style={{
                  width:"100%", padding: isMobile ? "9px 12px 9px 34px" : "10px 12px 10px 36px", borderRadius:12,
                  border:"0.5px solid rgba(0,85,255,.14)", background:"#F5F9FF",
                  fontSize: isMobile ? 12 : 13, fontWeight:500, color:T1, outline:"none", fontFamily:"inherit",
                }}
              />
            </div>
            {/* Page-level branch selector — drives the stat cards, hero
                subtitle, filter pill counts, and student list. Active
                branch gets the GRAD_PRIMARY treatment so it reads as
                "scoped" rather than "default". */}
            {branchList.length > 1 && (
              <select
                value={pageBranch}
                onChange={e => setPageBranch(e.target.value)}
                aria-label="Filter page by branch"
                style={{
                  padding: isMobile ? "9px 12px" : "10px 14px", borderRadius:12,
                  background: pageBranch === "All" ? "#F5F9FF" : GRAD_PRIMARY,
                  color: pageBranch === "All" ? T3 : "#fff",
                  border: pageBranch === "All" ? "0.5px solid rgba(0,85,255,.14)" : "none",
                  fontSize: isMobile ? 11 : 12, fontWeight:800, letterSpacing:"0.06em",
                  outline:"none", fontFamily:"inherit",
                  boxShadow: pageBranch === "All" ? "none" : SHADOW_BTN,
                  cursor:"pointer", flexShrink:0,
                }}
              >
                {branchList.map(b => (
                  <option key={b} value={b} style={{ color: T1 }}>
                    {b === "All" ? "All Branches" : b}
                  </option>
                ))}
              </select>
            )}
            <div className="no-scrollbar" style={{
              display:"flex",
              gap: isMobile ? 5 : 6,
              flexWrap: isMobile ? "nowrap" : "wrap",
              overflowX: isMobile ? "auto" : "visible",
              WebkitOverflowScrolling:"touch",
              marginLeft: isMobile ? -14 : 0,
              marginRight: isMobile ? -14 : 0,
              paddingLeft: isMobile ? 14 : 0,
              paddingRight: isMobile ? 14 : 0,
              width: isMobile ? "calc(100% + 28px)" : undefined,
            }}>
              {(["All", "Critical", "High", "Watch", "Safe"] as const).map(lvl => {
                const active = filterLevel === lvl;
                // Use SOLID gradients for active state — the imported
                // GRAD_RED / GRAD_ORANGE / GRAD_GOLD / GRAD_GREEN tokens are
                // pastel CARD backgrounds (e.g. #FEF8F9 → #FCEAEE), which
                // render as near-white pills with white text → unreadable.
                // RISK_TIER.solidGrad gives the correct vivid pill colour.
                const activeGrad =
                  lvl === "All"      ? GRAD_PRIMARY :
                  lvl === "Critical" ? RISK_TIER.Critical.solidGrad :
                  lvl === "High"     ? RISK_TIER.High.solidGrad :
                  lvl === "Watch"    ? RISK_TIER.Watch.solidGrad :
                                       RISK_TIER.Safe.solidGrad;
                return (
                  <button
                    key={lvl}
                    onClick={() => setFilterLevel(lvl)}
                    className="dash-btn"
                    style={{
                      padding: isMobile ? "7px 12px" : "8px 14px", borderRadius: isMobile ? 999 : 11,
                      background: active ? activeGrad : "#F5F9FF",
                      color: active ? "#fff" : T3,
                      fontSize: isMobile ? 9 : 10, fontWeight:800, letterSpacing:"0.10em", textTransform:"uppercase",
                      border: active ? "none" : "0.5px solid rgba(0,85,255,.12)",
                      cursor:"pointer", fontFamily:"inherit",
                      boxShadow: active ? SHADOW_BTN : "none",
                      whiteSpace:"nowrap", flexShrink:0,
                    }}
                  >
                    {lvl}
                  </button>
                );
              })}
              {/* Clear affordance — only renders when a filter or search is
                  active. Mirrors the StudentsIntelligence header pattern so
                  the user has the same reset gesture across pages. */}
              {filtersActive && (
                <button
                  onClick={clearFilters}
                  className="dash-btn"
                  aria-label="Clear filters"
                  style={{
                    padding: isMobile ? "7px 12px" : "8px 14px", borderRadius: isMobile ? 999 : 11,
                    background:"#fff", color:T3, border:"0.5px solid rgba(0,85,255,.18)",
                    fontSize: isMobile ? 9 : 10, fontWeight:800, letterSpacing:"0.10em", textTransform:"uppercase",
                    cursor:"pointer", fontFamily:"inherit",
                    whiteSpace:"nowrap", flexShrink:0,
                    display:"inline-flex", alignItems:"center", gap:4,
                  }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </Card3D>

        {/* Student Cards */}
        {filtered.length === 0 ? (
          <Card3D padding={isMobile ? "36px 16px" : "48px 24px"}>
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:10 }}>
              <div style={{ width: isMobile ? 52 : 60, height: isMobile ? 52 : 60, borderRadius:18, background:"#F5F9FF", border:"0.5px solid rgba(0,85,255,.1)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                <Brain size={isMobile ? 24 : 28} color={T4}/>
              </div>
              <p style={{ fontSize: isMobile ? 12 : 13, fontWeight:800, color:T3, margin:0, textAlign:"center" }}>
                {predictions.length === 0
                  ? "No student data found"
                  : pageBranch !== "All" && branchScopedPredictions.length === 0
                    ? `No predictions for ${pageBranch} yet`
                    : "No students match the filter"}
              </p>
              {pageBranch !== "All" && branchScopedPredictions.length === 0 && (
                <p style={{ fontSize: isMobile ? 10 : 11, fontWeight:600, color:T4, margin:"4px 0 0 0", textAlign:"center", maxWidth:280 }}>
                  Predictions appear once students have attendance or test-score data recorded for this branch.
                </p>
              )}
            </div>
          </Card3D>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap: isMobile ? 10 : 12 }}>
            {pagedPredictions.map(p => {
              const tier = RISK_TIER[p.riskLevel];
              const Icon = RISK_ICON[p.riskLevel];
              const isExpanded = expanded === p.studentId;

              return (
                <div
                  key={p.studentId}
                  className="dash-card"
                  onClick={() => setExpanded(isExpanded ? null : p.studentId)}
                  role="button"
                  tabIndex={0}
                  aria-expanded={isExpanded}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setExpanded(isExpanded ? null : p.studentId);
                    }
                  }}
                  style={{
                    background:"#fff", borderRadius: isMobile ? 14 : 18,
                    border:`0.5px solid ${tier.color}33`,
                    boxShadow:SHADOW_SM, overflow:"hidden",
                    position:"relative", cursor:"pointer",
                  }}
                >
                  <div style={{ position:"absolute", left:0, top:0, bottom:0, width: isMobile ? 3 : 4, background:tier.solidGrad }}/>

                  {isMobile ? (
                    /* Mobile: two-row layout — header + compact stats strip */
                    <div style={{ padding: "12px 14px 12px 16px" }}>
                      {/* Row 1: avatar + name/meta + actions */}
                      <div style={{ display:"flex", alignItems:"center", gap:11 }}>
                        <div style={{
                          width:38, height:38, borderRadius:11, background:tier.solidGrad,
                          display:"flex", alignItems:"center", justifyContent:"center",
                          color:"#fff", fontSize:11, fontWeight:800, flexShrink:0,
                          boxShadow:`0 6px 14px ${tier.color}33`,
                        }}>
                          {getInitials(p.studentName)}
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <p style={{ fontSize:13, fontWeight:800, color:T1, margin:0, letterSpacing:"-0.2px", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{p.studentName}</p>
                          <p style={{ fontSize:10, fontWeight:600, color:T4, margin:"2px 0 0 0", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                            {p.grade} · {p.branch}
                          </p>
                        </div>
                        <div style={{ display:"flex", gap:6, flexShrink:0 }}>
                          <button
                            onClick={(e) => { e.stopPropagation(); generateParentLink(p); }}
                            aria-label="Copy parent share link"
                            className="dash-btn"
                            style={{
                              width:34, height:34, borderRadius:10,
                              background:"#F5F9FF", border:"0.5px solid rgba(0,85,255,.12)",
                              display:"flex", alignItems:"center", justifyContent:"center",
                              cursor:"pointer",
                            }}
                          >
                            {copiedId === p.studentId ? <Check size={14} color={GREEN}/> : <Share2 size={13} color={T3}/>}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setExpanded(isExpanded ? null : p.studentId); }}
                            aria-label={isExpanded ? "Collapse" : "Expand"}
                            className="dash-btn"
                            style={{
                              width:34, height:34, borderRadius:10,
                              background:"#F5F9FF", border:"0.5px solid rgba(0,85,255,.12)",
                              display:"flex", alignItems:"center", justifyContent:"center",
                              cursor:"pointer",
                            }}
                          >
                            {isExpanded ? <ChevronUp size={14} color={T3}/> : <ChevronDown size={14} color={T3}/>}
                          </button>
                        </div>
                      </div>

                      {/* Row 2: tier badge + 3-metric compact strip */}
                      <div style={{ marginTop:10, display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                        <span style={{
                          display:"inline-flex", alignItems:"center", gap:4,
                          fontSize:9, fontWeight:800, padding:"3px 8px", borderRadius:999,
                          background:tier.bg, color:tier.color,
                          letterSpacing:"0.10em", textTransform:"uppercase",
                        }}>
                          <Icon size={10} strokeWidth={2.4}/> {tier.label}
                        </span>
                      </div>

                      {/* Row 3: fail risk bar with metrics */}
                      <div style={{ marginTop:10 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                          <span style={{ fontSize:9, fontWeight:700, color:T4, letterSpacing:"0.08em", textTransform:"uppercase" }}>Fail Risk</span>
                          <span style={{ fontSize:12, fontWeight:800, color:tier.color }}>{p.failProbability}%</span>
                        </div>
                        <div style={{ height:6, background:"#F5F9FF", borderRadius:999, overflow:"hidden" }}>
                          <div style={{ height:"100%", width:`${p.failProbability}%`, background:tier.solidGrad, borderRadius:999 }}/>
                        </div>
                      </div>

                      {/* Row 4: Attendance / Avg / Trend mini-grid */}
                      <div style={{ marginTop:10, display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:8, borderTop:"0.5px solid rgba(0,85,255,.06)", paddingTop:10 }}>
                        <div>
                          <p style={{ fontSize:8, fontWeight:800, color:T4, letterSpacing:"0.10em", textTransform:"uppercase", margin:0 }}>Attendance</p>
                          <p style={{ fontSize:12, fontWeight:800, margin:"2px 0 0 0", color: p.attendance < 75 ? RED : T1 }}>{p.attendance}%</p>
                        </div>
                        <div>
                          <p style={{ fontSize:8, fontWeight:800, color:T4, letterSpacing:"0.10em", textTransform:"uppercase", margin:0 }}>Avg Score</p>
                          <p style={{ fontSize:12, fontWeight:800, margin:"2px 0 0 0", color: p.avgScore < 50 ? RED : T1 }}>{p.avgScore}%</p>
                        </div>
                        <div>
                          <p style={{ fontSize:8, fontWeight:800, color:T4, letterSpacing:"0.10em", textTransform:"uppercase", margin:0 }}>Trend</p>
                          <div style={{ display:"flex", alignItems:"center", gap:3, marginTop:2 }}>
                            {p.scoreTrend > 0 ? <TrendingUp size={12} color={GREEN}/> :
                              p.scoreTrend < 0 ? <TrendingDown size={12} color={RED}/> :
                              <Minus size={12} color={T4}/>}
                            <p style={{ fontSize:12, fontWeight:800, margin:0, color: p.scoreTrend > 0 ? GREEN : p.scoreTrend < 0 ? RED : T4 }}>
                              {p.scoreTrend > 0 ? "+" : ""}{p.scoreTrend}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                  <div style={{ display:"flex", alignItems:"center", gap:14, padding:"14px 18px 14px 22px" }}>
                    <div style={{
                      width:40, height:40, borderRadius:12, background:tier.solidGrad,
                      display:"flex", alignItems:"center", justifyContent:"center",
                      color:"#fff", fontSize:11, fontWeight:800, flexShrink:0,
                      boxShadow:`0 6px 14px ${tier.color}33`,
                    }}>
                      {getInitials(p.studentName)}
                    </div>

                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", marginBottom:3 }}>
                        <p style={{ fontSize:13, fontWeight:800, color:T1, margin:0, letterSpacing:"-0.2px", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", maxWidth:180 }}>{p.studentName}</p>
                        <span style={{
                          display:"inline-flex", alignItems:"center", gap:4,
                          fontSize:9, fontWeight:800, padding:"3px 8px", borderRadius:999,
                          background:tier.bg, color:tier.color,
                          letterSpacing:"0.12em", textTransform:"uppercase",
                        }}>
                          <Icon size={10} strokeWidth={2.4}/> {tier.label}
                        </span>
                      </div>
                      <p style={{ fontSize:11, fontWeight:600, color:T4, margin:0 }}>
                        {p.grade} · {p.branch}
                      </p>
                    </div>

                    {/* Probability bar */}
                    <div style={{ width:140, flexShrink:0 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                        <span style={{ fontSize:9, fontWeight:700, color:T4, letterSpacing:"0.08em", textTransform:"uppercase" }}>Fail Risk</span>
                        <span style={{ fontSize:13, fontWeight:800, color:tier.color }}>{p.failProbability}%</span>
                      </div>
                      <div style={{ height:6, background:"#F5F9FF", borderRadius:999, overflow:"hidden" }}>
                        <div style={{ height:"100%", width:`${p.failProbability}%`, background:tier.solidGrad, borderRadius:999 }}/>
                      </div>
                    </div>

                    {/* Quick stats */}
                    <div style={{ display:"flex", gap:12, flexShrink:0 }}>
                      <div style={{ textAlign:"center" }}>
                        <p style={{ fontSize:13, fontWeight:800, margin:0, color: p.attendance < 75 ? RED : T1 }}>{p.attendance}%</p>
                        <p style={{ fontSize:9, fontWeight:700, color:T4, margin:"2px 0 0 0", letterSpacing:"0.08em", textTransform:"uppercase" }}>Att.</p>
                      </div>
                      <div style={{ textAlign:"center" }}>
                        <p style={{ fontSize:13, fontWeight:800, margin:0, color: p.avgScore < 50 ? RED : T1 }}>{p.avgScore}%</p>
                        <p style={{ fontSize:9, fontWeight:700, color:T4, margin:"2px 0 0 0", letterSpacing:"0.08em", textTransform:"uppercase" }}>Avg</p>
                      </div>
                      <div style={{ textAlign:"center", display:"flex", flexDirection:"column", alignItems:"center" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:2 }}>
                          {p.scoreTrend > 0 ? <TrendingUp size={12} color={GREEN}/> :
                            p.scoreTrend < 0 ? <TrendingDown size={12} color={RED}/> :
                            <Minus size={12} color={T4}/>}
                          <p style={{ fontSize:13, fontWeight:800, margin:0, color: p.scoreTrend > 0 ? GREEN : p.scoreTrend < 0 ? RED : T4 }}>
                            {p.scoreTrend > 0 ? "+" : ""}{p.scoreTrend}
                          </p>
                        </div>
                        <p style={{ fontSize:9, fontWeight:700, color:T4, margin:"2px 0 0 0", letterSpacing:"0.08em", textTransform:"uppercase" }}>Trend</p>
                      </div>
                    </div>

                    {/* Actions */}
                    <div style={{ display:"flex", gap:6, flexShrink:0 }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); generateParentLink(p); }}
                        title="Copy parent share link"
                        className="dash-btn"
                        style={{
                          width:34, height:34, borderRadius:10,
                          background:"#F5F9FF", border:"0.5px solid rgba(0,85,255,.12)",
                          display:"flex", alignItems:"center", justifyContent:"center",
                          cursor:"pointer",
                        }}
                      >
                        {copiedId === p.studentId ? <Check size={14} color={GREEN}/> : <Share2 size={13} color={T3}/>}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setExpanded(isExpanded ? null : p.studentId); }}
                        aria-label={isExpanded ? "Collapse" : "Expand"}
                        className="dash-btn"
                        style={{
                          width:34, height:34, borderRadius:10,
                          background:"#F5F9FF", border:"0.5px solid rgba(0,85,255,.12)",
                          display:"flex", alignItems:"center", justifyContent:"center",
                          cursor:"pointer",
                        }}
                      >
                        {isExpanded ? <ChevronUp size={14} color={T3}/> : <ChevronDown size={14} color={T3}/>}
                      </button>
                    </div>
                  </div>
                  )}

                  {/* Expanded Detail — clicks inside don't bubble to the
                       card-level toggle so users can interact with chips,
                       the parent-link button, etc. without collapsing the
                       panel. To collapse: click the chevron. */}
                  {isExpanded && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        borderTop:`0.5px solid ${tier.color}22`,
                        background:tier.bg, padding: isMobile ? "14px 14px 14px 16px" : "16px 22px",
                        display:"flex", flexDirection:"column", gap: isMobile ? 12 : 14,
                        cursor:"default",
                      }}
                    >
                      <div>
                        <p style={{ fontSize:9, fontWeight:800, color:T3, letterSpacing:"0.14em", textTransform:"uppercase", margin:"0 0 8px 0" }}>
                          Why this prediction?
                        </p>
                        <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                          {p.riskFactors.map((f, i) => (
                            <span
                              key={i}
                              style={{
                                fontSize: isMobile ? 10 : 10, fontWeight:700, padding: isMobile ? "4px 9px" : "4px 10px", borderRadius:999,
                                background:"#fff", color:tier.color,
                                border:`0.5px solid ${tier.color}33`,
                              }}
                            >
                              {f}
                            </span>
                          ))}
                        </div>
                      </div>

                      {p.recentScores.length > 0 && (
                        <div>
                          <p style={{ fontSize:9, fontWeight:800, color:T3, letterSpacing:"0.14em", textTransform:"uppercase", margin:"0 0 8px 0" }}>
                            Last {p.recentScores.length} test scores
                          </p>
                          <div style={{
                            display:"flex", alignItems:"center", gap: isMobile ? 6 : 8,
                            overflowX: isMobile ? "auto" : "visible",
                            WebkitOverflowScrolling:"touch",
                            paddingBottom: isMobile ? 2 : 0,
                          }}>
                            {[...p.recentScores].reverse().map((s, i) => {
                              // Belt-and-suspenders clamp on top of the
                              // service-side sanitisation: garbage data
                              // (5e12, "50.000000000000", scientific strings)
                              // used to overflow the chip and bleed across
                              // the card. Even if a corrupt row sneaks past
                              // the service guard, the chip will still render
                              // a clean 0-100 integer in ≤3 chars (2026-05-26).
                              const safeScore = Math.min(100, Math.max(0, Math.round(Number(s) || 0)));
                              // Saturated solid gradients so white text reads.
                              // The pale GRAD_* tokens are for stat-tile
                              // backgrounds where text is dark — they killed
                              // contrast on these score chips (2026-05-26 fix).
                              const scoreGrad = safeScore >= 75
                                ? "linear-gradient(135deg,#10B981 0%,#059669 100%)"
                                : safeScore >= 50
                                ? "linear-gradient(135deg,#F59E0B 0%,#D97706 100%)"
                                : "linear-gradient(135deg,#FF3355 0%,#DC2626 100%)";
                              const scoreShadow = safeScore >= 75
                                ? "0 4px 12px rgba(16,185,129,.30)"
                                : safeScore >= 50
                                ? "0 4px 12px rgba(245,158,11,.30)"
                                : "0 4px 12px rgba(255,51,85,.30)";
                              return (
                                <div key={i} style={{ textAlign:"center", flexShrink:0 }}>
                                  <div style={{
                                    width: isMobile ? 38 : 42, height: isMobile ? 38 : 42, borderRadius: isMobile ? 11 : 12, background:scoreGrad,
                                    display:"flex", alignItems:"center", justifyContent:"center",
                                    color:"#fff", fontSize: isMobile ? 13 : 14, fontWeight:800,
                                    letterSpacing:"-0.2px",
                                    boxShadow: scoreShadow,
                                    textShadow:"0 1px 2px rgba(0,0,0,.18)",
                                    overflow:"hidden",
                                  }}>
                                    {safeScore}
                                  </div>
                                  <p style={{ fontSize:9, fontWeight:700, color:T4, margin:"4px 0 0 0" }}>#{i + 1}</p>
                                </div>
                              );
                            })}
                            {p.scoreTrend !== 0 && (
                              <div style={{ marginLeft: isMobile ? 4 : 8, display:"flex", alignItems:"center", gap:4, flexShrink:0 }}>
                                {p.scoreTrend > 0 ? <TrendingUp size={14} color={GREEN}/> : <TrendingDown size={14} color={RED}/>}
                                <span style={{ fontSize: isMobile ? 10 : 11, fontWeight:800, color: p.scoreTrend > 0 ? GREEN : RED, whiteSpace:"nowrap" }}>
                                  {p.scoreTrend > 0 ? "+" : ""}{p.scoreTrend} pts
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Recommendation */}
                      <div
                        style={{
                          background:"#fff", borderRadius:12, padding: isMobile ? "11px 13px" : "12px 14px",
                          border:"0.5px solid rgba(0,85,255,.08)",
                        }}
                      >
                        <p style={{ fontSize:9, fontWeight:800, color:T4, letterSpacing:"0.14em", textTransform:"uppercase", margin:"0 0 4px 0" }}>
                          Recommended Action
                        </p>
                        <p style={{ fontSize: isMobile ? 12 : 13, fontWeight:700, color:T1, margin:0, letterSpacing:"-0.2px", lineHeight:1.4 }}>{p.recommendation}</p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination strip — only renders when filtered set spills past
            one page. Numbered buttons cap at 5 visible to keep mobile width
            sane; on larger sets the user pages via prev/next instead. */}
        {filtered.length > PAGE_SIZE && (
          <Card3D padding={isMobile ? "12px 14px" : "14px 18px"}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap: isMobile ? 10 : 16, flexWrap:"wrap" }}>
              <p style={{ fontSize: isMobile ? 9 : 10, fontWeight:800, color:T4, letterSpacing:"0.14em", textTransform:"uppercase", margin:0, width: isMobile ? "100%" : "auto", textAlign: isMobile ? "center" : "left" }}>
                Showing {Math.min((currentPage - 1) * PAGE_SIZE + 1, filtered.length)}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length}
              </p>
              <div style={{ display:"flex", gap:6, margin: isMobile ? "0 auto" : 0, flexWrap:"wrap", justifyContent:"center" }}>
                <button
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  className="dash-btn"
                  style={{
                    padding:"7px 14px", borderRadius:10,
                    background:"#F5F9FF", border:"0.5px solid rgba(0,85,255,.12)",
                    fontSize:11, fontWeight:800, color:T3, cursor: currentPage === 1 ? "not-allowed" : "pointer",
                    opacity: currentPage === 1 ? 0.4 : 1, fontFamily:"inherit",
                  }}
                >Prev</button>
                {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map(n => (
                  <button
                    key={n}
                    onClick={() => setCurrentPage(n)}
                    className="dash-btn"
                    style={{
                      width:32, height:32, borderRadius:10,
                      background: currentPage === n ? GRAD_PRIMARY : "#F5F9FF",
                      color: currentPage === n ? "#fff" : T3,
                      border: currentPage === n ? "none" : "0.5px solid rgba(0,85,255,.12)",
                      fontSize:11, fontWeight:800, cursor:"pointer",
                      boxShadow: currentPage === n ? SHADOW_BTN : "none", fontFamily:"inherit",
                    }}
                  >{n}</button>
                ))}
                <button
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  className="dash-btn"
                  style={{
                    padding:"7px 14px", borderRadius:10,
                    background:"#F5F9FF", border:"0.5px solid rgba(0,85,255,.12)",
                    fontSize:11, fontWeight:800, color:T3, cursor: currentPage === totalPages ? "not-allowed" : "pointer",
                    opacity: currentPage === totalPages ? 0.4 : 1, fontFamily:"inherit",
                  }}
                >Next</button>
              </div>
            </div>
          </Card3D>
        )}

        {/* How it works banner */}
        <div
          style={{
            background:"linear-gradient(135deg,#7B3FF4 0%,#0055FF 100%)",
            borderRadius: isMobile ? 14 : 18, padding: isMobile ? "14px 14px" : "16px 18px", color:"#fff",
            display:"flex", alignItems:"flex-start", gap: isMobile ? 10 : 12,
            boxShadow:"0 14px 38px rgba(123,63,244,.26)",
          }}
        >
          <div style={{ width: isMobile ? 32 : 36, height: isMobile ? 32 : 36, borderRadius: isMobile ? 10 : 11, background:"rgba(255,255,255,.16)", border:"0.5px solid rgba(255,255,255,.26)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
            <Brain size={isMobile ? 16 : 18} color="#fff" strokeWidth={2.3}/>
          </div>
          <div style={{ minWidth:0 }}>
            <p style={{ fontSize: isMobile ? 12 : 13, fontWeight:800, color:"#fff", margin:0, letterSpacing:"-0.2px" }}>How it works</p>
            <p style={{ fontSize: isMobile ? 10 : 11, fontWeight:500, color:"rgba(255,255,255,.85)", margin:"4px 0 0 0", lineHeight:1.55 }}>
              Fail probability is computed using a weighted formula — attendance trend (40%), score average (35%),
              score trajectory (15%), and fee signals (10%). Students with ≥70% probability are flagged Critical
              and need immediate intervention.
            </p>
          </div>
        </div>

        <AIInsightCard
          title="Risk Predictor Intelligence"
          items={[
            { label:"Critical Watch", value: stats.critical > 0 ? `${stats.critical} urgent` : "None critical", sub: stats.critical > 0 ? "Intervention needed" : "All tracked students stable" },
            { label:"Overall Health", value: `${criticalSafe}% safe`, sub: stats.total > 0 ? `${stats.total} students analysed` : "No data yet" },
            { label:"Parent Outreach", value: atRiskTotal > 0 ? `${atRiskTotal} at-risk` : "None at risk", sub: atRiskTotal > 0 ? "Share parent links" : "Maintain engagement" },
          ]}
        />
      </div>
    </>
  );
}