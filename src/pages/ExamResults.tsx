/**
 * ExamResults.tsx — Owner-side BRANCH-WISE view of published exam results.
 *
 * The owner doesn't upload (that's the principal's job) — this page is a
 * read-only roll-up: every result PDF principals published, grouped by branch,
 * filterable by K-12 / Pre-Primary and by branch. Mirrors the design vocabulary
 * of the rest of the owner dashboard (PageHead / StatTile / Card3D tokens).
 */
import { useEffect, useMemo, useState } from "react";
import {
  FileText, Download, Users, Calendar, GraduationCap, Baby,
  ChevronDown, RefreshCw, Loader2, FolderOpen, Building2,
} from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  usePageShellStyle, DashGlobalStyles, PageHead, StatTile, Card3D,
  GRAD_BLUE, GRAD_GREEN, GRAD_VIOLET, GRAD_GOLD, T1, T3, T4,
} from "@/lib/dashboardTokens";
import {
  subscribeOwnerResults, type OwnerResultsData, type OwnerResultDoc, type ResultKind,
} from "@/lib/resultsService";

type KindFilter = "all" | ResultKind;

const TERM_LABEL: Record<string, string> = {
  term1: "Term 1", term2: "Term 2", term3: "Term 3", annual: "Annual",
  q1: "Q1", q2: "Q2", q3: "Q3", q4: "Q4",
};

function fmtDate(ms: number | null): string {
  if (!ms) return "—";
  try { return new Date(ms).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }); }
  catch { return "—"; }
}

export default function ExamResults() {
  const shell = usePageShellStyle();
  const isMobile = useIsMobile();

  const [data, setData] = useState<OwnerResultsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const [kind, setKind] = useState<KindFilter>("all");
  const [branchFilter, setBranchFilter] = useState<string>("all");

  useEffect(() => {
    setLoading(true);
    const unsub = subscribeOwnerResults(
      (d) => { setData(d); setLoading(false); setError(null); },
      (e) => { setError(e.message); setLoading(false); },
    );
    return () => unsub();
  }, [refreshTick]);

  // ── Apply filters (kind + branch) to the branch-grouped data ────────────────
  const view = useMemo(() => {
    if (!data) return null;
    const branches = data.branches
      .filter((b) => branchFilter === "all" || b.id === branchFilter)
      .map((b) => {
        const results = b.results.filter((r) => kind === "all" || r.kind === kind);
        return {
          ...b,
          results,
          resultCount: results.length,
          studentPdfCount: results.reduce((s, r) => s + r.studentResults.length, 0),
          classPdfCount: results.filter((r) => r.classPdfUrl).length,
        };
      })
      .filter((b) => b.resultCount > 0);

    return {
      branches,
      totalResults: branches.reduce((s, b) => s + b.resultCount, 0),
      totalStudentPdfs: branches.reduce((s, b) => s + b.studentPdfCount, 0),
      branchesWithResults: branches.length,
    };
  }, [data, kind, branchFilter]);

  return (
    <div style={shell}>
      <DashGlobalStyles />
      <PageHead
        icon={FileText}
        title="Exam Results"
        subtitle="Branch-wise result PDFs published across K-12 and Pre-Primary"
        right={
          <button
            onClick={() => setRefreshTick((t) => t + 1)}
            className="dash-btn"
            style={{
              display: "inline-flex", alignItems: "center", gap: 7, padding: isMobile ? "8px 12px" : "10px 16px",
              borderRadius: 12, background: "#fff", border: "0.5px solid rgba(0,85,255,.12)",
              boxShadow: "0 2px 8px rgba(0,85,255,.10)", color: T1, fontSize: 12, fontWeight: 700, cursor: "pointer",
            }}
          >
            <RefreshCw size={14} /> {isMobile ? "" : "Refresh"}
          </button>
        }
      />

      {/* ── Loading / error / empty ─────────────────────────────────────────── */}
      {loading && !data ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "80px 0", gap: 10, color: T3 }}>
          <Loader2 size={22} className="animate-spin" /> <span style={{ fontWeight: 600 }}>Loading results…</span>
        </div>
      ) : error ? (
        <Card3D>
          <p style={{ color: "#DC2626", fontWeight: 700, margin: 0 }}>Could not load results</p>
          <p style={{ color: T3, fontSize: 13, margin: "6px 0 0 0" }}>{error}</p>
        </Card3D>
      ) : (
        <>
          {/* ── Stat tiles ─────────────────────────────────────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: isMobile ? 10 : 16, marginBottom: isMobile ? 16 : 22 }}>
            <StatTile label="Total Results" value={view?.totalResults ?? 0} sub={`${data?.k12Count ?? 0} K-12 · ${data?.ppCount ?? 0} Pre-Primary`} grad={GRAD_BLUE} icon={FolderOpen} />
            <StatTile label="Student Report Cards" value={view?.totalStudentPdfs ?? 0} sub="Individual PDFs" grad={GRAD_GREEN} icon={Users} />
            <StatTile label="Branches Reporting" value={view?.branchesWithResults ?? 0} sub={`of ${data?.branches.length ?? 0} with data`} grad={GRAD_VIOLET} icon={Building2} />
            <StatTile label="Exam Sets" value={`${data?.k12Count ?? 0}/${data?.ppCount ?? 0}`} sub="K-12 / Pre-Primary" grad={GRAD_GOLD} icon={GraduationCap} />
          </div>

          {/* ── Filters ────────────────────────────────────────────────────── */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 18 }}>
            <div style={{ display: "inline-flex", background: "#fff", borderRadius: 12, padding: 4, boxShadow: "0 2px 8px rgba(0,85,255,.08)", border: "0.5px solid rgba(0,85,255,.10)" }}>
              {([["all", "All"], ["k12", "K-12"], ["pp", "Pre-Primary"]] as [KindFilter, string][]).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setKind(k)}
                  style={{
                    padding: "7px 14px", borderRadius: 9, border: "none", cursor: "pointer",
                    fontSize: 12, fontWeight: 700,
                    background: kind === k ? "linear-gradient(135deg,#0055FF,#1166FF)" : "transparent",
                    color: kind === k ? "#fff" : T3,
                    boxShadow: kind === k ? "0 4px 12px rgba(0,85,255,.30)" : "none",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Branch dropdown */}
            <div style={{ position: "relative" }}>
              <select
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                style={{
                  appearance: "none", padding: "9px 34px 9px 14px", borderRadius: 12, border: "0.5px solid rgba(0,85,255,.14)",
                  background: "#fff", color: T1, fontSize: 12, fontWeight: 700, cursor: "pointer",
                  boxShadow: "0 2px 8px rgba(0,85,255,.08)", minWidth: 160,
                }}
              >
                <option value="all">All branches</option>
                {data?.branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
              <ChevronDown size={15} style={{ position: "absolute", right: 11, top: "50%", transform: "translateY(-50%)", color: T4, pointerEvents: "none" }} />
            </div>
          </div>

          {/* ── Branch sections ────────────────────────────────────────────── */}
          {!view || view.branches.length === 0 ? (
            <Card3D>
              <div style={{ textAlign: "center", padding: "30px 10px" }}>
                <FileText size={42} color={T4} style={{ marginBottom: 12 }} />
                <p style={{ fontWeight: 800, color: T1, margin: 0, fontSize: 15 }}>No results to show</p>
                <p style={{ color: T3, fontSize: 13, margin: "6px 0 0 0" }}>
                  {data && data.totalResults > 0
                    ? "No results match the current filters."
                    : "Once your principals publish exam result PDFs, they'll appear here grouped by branch."}
                </p>
              </div>
            </Card3D>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? 16 : 22 }}>
              {view.branches.map((b) => (
                <div key={b.id}>
                  {/* Branch header */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                    <span style={{ width: 12, height: 12, borderRadius: 4, background: b.color, flexShrink: 0, boxShadow: `0 2px 6px ${b.color}55` }} />
                    <h2 style={{ fontSize: isMobile ? 16 : 19, fontWeight: 800, color: T1, margin: 0, letterSpacing: "-0.4px" }}>{b.name}</h2>
                    <span style={{ fontSize: 11, fontWeight: 700, color: T3, background: "rgba(0,85,255,.06)", padding: "3px 10px", borderRadius: 999 }}>
                      {b.resultCount} result{b.resultCount !== 1 ? "s" : ""}
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: T3, background: "rgba(16,185,129,.10)", padding: "3px 10px", borderRadius: 999 }}>
                      {b.studentPdfCount} student PDF{b.studentPdfCount !== 1 ? "s" : ""}
                    </span>
                  </div>

                  {/* Result cards */}
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, 1fr)", gap: 14 }}>
                    {b.results.map((r) => <ResultCard key={`${r.kind}-${r.id}`} r={r} />)}
                  </div>
                </div>
              ))}
            </div>
          )}

          {data?.hasUnassigned && (
            <p style={{ marginTop: 18, fontSize: 11.5, color: T4, fontWeight: 600 }}>
              ⓘ "Unassigned" holds results whose class couldn't be matched to a branch — check that the class has a branch/teacher set.
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ── Single result card (class PDF + expandable per-student PDFs) ─────────────
function ResultCard({ r }: { r: OwnerResultDoc }) {
  const [open, setOpen] = useState(false);
  const isPP = r.kind === "pp";
  const accent = isPP ? "#7C3AED" : "#0055FF";
  const termLabel = TERM_LABEL[r.term] || r.term;

  return (
    <Card3D padding="16px 18px">
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: 11, background: isPP ? GRAD_VIOLET : GRAD_BLUE, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {isPP ? <Baby size={20} color={accent} /> : <GraduationCap size={20} color={accent} />}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h3 style={{ fontSize: 14.5, fontWeight: 800, color: T1, margin: 0, letterSpacing: "-0.3px" }}>{r.examName}</h3>
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", color: accent, background: `${accent}14`, padding: "2px 7px", borderRadius: 6 }}>
              {isPP ? "Pre-Primary" : "K-12"}
            </span>
          </div>
          <p style={{ fontSize: 12, color: T3, fontWeight: 600, margin: "4px 0 0 0" }}>
            {r.className}{r.section ? ` · ${r.section}` : ""}{termLabel ? ` · ${termLabel}` : ""}{r.academicYear ? ` · ${r.academicYear}` : ""}
          </p>
          <p style={{ fontSize: 11, color: T4, fontWeight: 600, margin: "5px 0 0 0", display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Calendar size={11} /> {fmtDate(r.publishedAt)}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
        {r.classPdfUrl && (
          <a href={r.classPdfUrl} target="_blank" rel="noopener noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 9, background: "rgba(0,85,255,.08)", color: "#0055FF", fontSize: 11.5, fontWeight: 700, textDecoration: "none" }}>
            <Download size={13} /> Class summary PDF
          </a>
        )}
        {r.studentResults.length > 0 && (
          <button onClick={() => setOpen((o) => !o)}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 9, background: "rgba(16,185,129,.10)", color: "#059669", fontSize: 11.5, fontWeight: 700, border: "none", cursor: "pointer" }}>
            <Users size={13} /> {r.studentResults.length} student PDF{r.studentResults.length !== 1 ? "s" : ""}
            <ChevronDown size={13} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
          </button>
        )}
        {!r.classPdfUrl && r.studentResults.length === 0 && (
          <span style={{ fontSize: 11.5, color: T4, fontWeight: 600 }}>No PDF attached</span>
        )}
      </div>

      {/* Expandable per-student list */}
      {open && r.studentResults.length > 0 && (
        <div style={{ marginTop: 10, maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2, paddingRight: 4 }}>
          {r.studentResults.map((s) => (
            <a key={s.studentId || s.pdfName} href={s.pdfUrl} target="_blank" rel="noopener noreferrer"
              className="dash-row"
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "7px 10px", borderRadius: 8, textDecoration: "none" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: T1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {s.rollNumber ? `#${s.rollNumber} ` : ""}{s.studentName}
              </span>
              <Download size={13} style={{ color: T4, flexShrink: 0 }} />
            </a>
          ))}
        </div>
      )}
    </Card3D>
  );
}
