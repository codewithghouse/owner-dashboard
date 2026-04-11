/**
 * AIPredictorPage.tsx
 * "AI-Powered Risk Predictor" — the standout feature.
 *
 * Shows every student's probability of failing this semester,
 * with explanation (which factors drove the score) and a
 * recommended action. Rule-based scoring, no ML server needed.
 *
 * Also lets owner generate a parent-shareable link per student.
 */
import { useState, useEffect, useMemo } from "react";
import { db, auth } from "@/lib/firebase";
import {
  collection, addDoc, serverTimestamp,
} from "firebase/firestore";
import {
  Brain, AlertTriangle, TrendingDown, TrendingUp, Users,
  Search, ChevronDown, ChevronUp, RefreshCw, Share2,
  CheckCircle2, Copy, Check, Loader2, Minus,
  ShieldAlert, Eye, Filter,
} from "lucide-react";
import {
  fetchAllPredictions,
  StudentRiskPrediction,
  RiskLevel,
} from "@/lib/riskPredictorService";
import { addAuditLog } from "@/lib/auditService";
import { toast } from "sonner";

// ── Risk visual config ────────────────────────────────────────────────────────
const RISK_CONFIG: Record<RiskLevel, { label: string; color: string; bg: string; border: string; bar: string }> = {
  Critical: { label: "Critical Risk",  color: "text-red-600",    bg: "bg-red-50",    border: "border-red-200",   bar: "bg-red-500"    },
  High:     { label: "High Risk",      color: "text-orange-600", bg: "bg-orange-50", border: "border-orange-200", bar: "bg-orange-400" },
  Watch:    { label: "Watch",          color: "text-amber-600",  bg: "bg-amber-50",  border: "border-amber-200",  bar: "bg-amber-400"  },
  Safe:     { label: "Safe",           color: "text-emerald-600",bg: "bg-emerald-50",border: "border-emerald-200",bar: "bg-emerald-400"},
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
export default function AIPredictorPage() {
  const [predictions, setPredictions] = useState<StudentRiskPrediction[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [search,      setSearch]      = useState("");
  const [filterLevel, setFilterLevel] = useState<RiskLevel | "All">("All");
  const [expanded,    setExpanded]    = useState<string | null>(null);
  const [copiedId,    setCopiedId]    = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const data = await fetchAllPredictions();
    setPredictions(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // ── Stats ─────────────────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total:    predictions.length,
    critical: predictions.filter(p => p.riskLevel === "Critical").length,
    high:     predictions.filter(p => p.riskLevel === "High").length,
    watch:    predictions.filter(p => p.riskLevel === "Watch").length,
    safe:     predictions.filter(p => p.riskLevel === "Safe").length,
  }), [predictions]);

  // ── Filtered list ─────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = predictions;
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
  }, [predictions, filterLevel, search]);

  // ── Generate parent share link ────────────────────────────────────────────
  const generateParentLink = async (p: StudentRiskPrediction) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    try {
      // Store token in Firestore: parent_tokens/{token}
      const token  = crypto.randomUUID();
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + 30); // 30-day link

      await addDoc(collection(db, "parent_tokens"), {
        token,
        studentId:   p.studentId,
        studentName: p.studentName,
        schoolId:    uid,
        branch:      p.branch,
        grade:       p.grade,
        // Pre-computed snapshot so portal doesn't need auth
        attendance:  p.attendance,
        avgScore:    p.avgScore,
        recentScores: p.recentScores,
        feeDefaulted: p.feeDefaulted,
        failProbability: p.failProbability,
        riskLevel:   p.riskLevel,
        riskFactors: p.riskFactors,
        recommendation: p.recommendation,
        expiresAt:   expiry.toISOString(),
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
      <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-3">
          <Brain className="w-10 h-10 text-[#1e3a8a] mx-auto animate-pulse" />
          <p className="text-sm font-bold text-slate-500">Analysing student data…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* ── Page Header ──────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-600 to-blue-600 flex items-center justify-center shadow-sm">
              <Brain className="w-4 h-4 text-white" />
            </div>
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-600 bg-violet-50 border border-violet-200 px-2 py-0.5 rounded-full">
              AI-Powered
            </span>
          </div>
          <h1 className="text-2xl font-black text-[#1e294b]">Risk Predictor</h1>
          <p className="text-sm text-slate-500 font-medium mt-0.5">
            Probability of failing this semester — for every student, with explanation.
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* ── Stats row ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {([
          { label: "Critical Risk",  value: stats.critical, color: "text-red-600",    bg: "bg-red-50",    border: "border-red-100",    icon: ShieldAlert },
          { label: "High Risk",      value: stats.high,     color: "text-orange-600", bg: "bg-orange-50", border: "border-orange-100", icon: AlertTriangle },
          { label: "Watch List",     value: stats.watch,    color: "text-amber-600",  bg: "bg-amber-50",  border: "border-amber-100",  icon: Eye },
          { label: "Safe",           value: stats.safe,     color: "text-emerald-600",bg: "bg-emerald-50",border: "border-emerald-100",icon: CheckCircle2 },
        ] as const).map(s => {
          const Icon = s.icon;
          return (
            <button
              key={s.label}
              onClick={() => setFilterLevel(prev =>
                prev === (s.label.split(" ")[0] as RiskLevel) ? "All" :
                (s.label.includes("Critical") ? "Critical" :
                 s.label.includes("High") ? "High" :
                 s.label.includes("Watch") ? "Watch" : "Safe")
              )}
              className={`flex items-center gap-3 p-4 rounded-2xl border ${s.bg} ${s.border} transition-all hover:shadow-sm`}
            >
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${s.bg} border ${s.border}`}>
                <Icon className={`w-4 h-4 ${s.color}`} />
              </div>
              <div className="text-left">
                <p className={`text-xl font-black ${s.color}`}>{s.value}</p>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{s.label}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Filters ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 bg-white rounded-xl border border-slate-200 px-4 py-2.5 flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search students, branch, grade…"
            className="flex-1 text-sm font-medium text-[#1e294b] placeholder:text-slate-400 outline-none bg-transparent"
          />
        </div>
        <div className="flex items-center gap-2">
          {(["All", "Critical", "High", "Watch", "Safe"] as const).map(lvl => (
            <button
              key={lvl}
              onClick={() => setFilterLevel(lvl)}
              className={`px-3 py-1.5 rounded-lg text-xs font-black transition-colors border ${
                filterLevel === lvl
                  ? "bg-[#1e3a8a] text-white border-[#1e3a8a]"
                  : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
              }`}
            >
              {lvl}
            </button>
          ))}
        </div>
      </div>

      {/* ── Student Cards ─────────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 bg-white rounded-[2rem] border border-slate-100">
          <Brain className="w-10 h-10 text-slate-200" />
          <p className="text-sm font-bold text-slate-400">
            {predictions.length === 0 ? "No student data found." : "No students match the filter."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(p => {
            const cfg  = RISK_CONFIG[p.riskLevel];
            const Icon = RISK_ICON[p.riskLevel];
            const isExpanded = expanded === p.studentId;

            return (
              <div
                key={p.studentId}
                className={`bg-white rounded-2xl border ${cfg.border} shadow-sm overflow-hidden transition-all`}
              >
                {/* ── Row ──────────────────────────────────────────────── */}
                <div className="flex items-center gap-4 p-4">
                  {/* Avatar */}
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white text-xs font-black shrink-0 ${
                    p.riskLevel === "Critical" ? "bg-red-500" :
                    p.riskLevel === "High"     ? "bg-orange-400" :
                    p.riskLevel === "Watch"    ? "bg-amber-400" : "bg-emerald-400"
                  }`}>
                    {getInitials(p.studentName)}
                  </div>

                  {/* Name + meta */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-black text-[#1e294b] truncate">{p.studentName}</p>
                      <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${cfg.color} ${cfg.bg} ${cfg.border}`}>
                        {cfg.label}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 font-medium">
                      {p.grade} · {p.branch}
                    </p>
                  </div>

                  {/* Probability bar */}
                  <div className="hidden sm:block w-32 shrink-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-bold text-slate-400">Fail Risk</span>
                      <span className={`text-sm font-black ${cfg.color}`}>{p.failProbability}%</span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${cfg.bar}`}
                        style={{ width: `${p.failProbability}%` }}
                      />
                    </div>
                  </div>

                  {/* Quick stats */}
                  <div className="hidden md:flex items-center gap-4 shrink-0">
                    <div className="text-center">
                      <p className={`text-sm font-black ${p.attendance < 75 ? "text-red-600" : "text-slate-700"}`}>{p.attendance}%</p>
                      <p className="text-[9px] font-bold text-slate-400 uppercase">Att.</p>
                    </div>
                    <div className="text-center">
                      <p className={`text-sm font-black ${p.avgScore < 50 ? "text-red-600" : "text-slate-700"}`}>{p.avgScore}%</p>
                      <p className="text-[9px] font-bold text-slate-400 uppercase">Avg</p>
                    </div>
                    <div className="text-center flex items-center gap-0.5">
                      {p.scoreTrend > 0
                        ? <TrendingUp className="w-3 h-3 text-emerald-500" />
                        : p.scoreTrend < 0
                        ? <TrendingDown className="w-3 h-3 text-red-500" />
                        : <Minus className="w-3 h-3 text-slate-400" />
                      }
                      <p className={`text-sm font-black ${p.scoreTrend > 0 ? "text-emerald-600" : p.scoreTrend < 0 ? "text-red-600" : "text-slate-400"}`}>
                        {p.scoreTrend > 0 ? "+" : ""}{p.scoreTrend}
                      </p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => generateParentLink(p)}
                      title="Copy parent share link"
                      className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors"
                    >
                      {copiedId === p.studentId
                        ? <Check className="w-3.5 h-3.5 text-emerald-500" />
                        : <Share2 className="w-3.5 h-3.5 text-slate-400" />
                      }
                    </button>
                    <button
                      onClick={() => setExpanded(isExpanded ? null : p.studentId)}
                      className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors"
                    >
                      {isExpanded
                        ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                        : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                      }
                    </button>
                  </div>
                </div>

                {/* ── Expanded Detail ──────────────────────────────────── */}
                {isExpanded && (
                  <div className={`border-t ${cfg.border} ${cfg.bg} px-4 pb-4 pt-3 space-y-3`}>
                    {/* Risk factors */}
                    <div>
                      <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">
                        Why this prediction?
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {p.riskFactors.map((f, i) => (
                          <span
                            key={i}
                            className={`text-xs font-bold px-2.5 py-1 rounded-lg border ${cfg.color} ${cfg.bg} ${cfg.border}`}
                          >
                            {f}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Recent scores */}
                    {p.recentScores.length > 0 && (
                      <div>
                        <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">
                          Last {p.recentScores.length} test scores
                        </p>
                        <div className="flex items-center gap-2">
                          {[...p.recentScores].reverse().map((s, i) => (
                            <div key={i} className="text-center">
                              <div
                                className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-black text-white shadow-sm ${
                                  s >= 75 ? "bg-emerald-500" : s >= 50 ? "bg-amber-500" : "bg-red-500"
                                }`}
                              >
                                {s}
                              </div>
                              <p className="text-[9px] text-slate-400 mt-1">#{i + 1}</p>
                            </div>
                          ))}
                          {p.scoreTrend !== 0 && (
                            <div className="ml-2 flex items-center gap-1">
                              {p.scoreTrend > 0
                                ? <TrendingUp className="w-4 h-4 text-emerald-500" />
                                : <TrendingDown className="w-4 h-4 text-red-500" />
                              }
                              <span className={`text-xs font-black ${p.scoreTrend > 0 ? "text-emerald-600" : "text-red-600"}`}>
                                {p.scoreTrend > 0 ? "+" : ""}{p.scoreTrend} pts trend
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Recommendation */}
                    <div className="bg-white rounded-xl p-3 border border-slate-100">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
                        Recommended Action
                      </p>
                      <p className="text-sm font-bold text-[#1e294b]">{p.recommendation}</p>
                    </div>

                    {/* Share link button */}
                    <button
                      onClick={() => generateParentLink(p)}
                      className="flex items-center gap-2 text-xs font-black text-[#1e3a8a] hover:underline"
                    >
                      <Share2 className="w-3.5 h-3.5" />
                      Generate parent link (secure, 30-day expiry)
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Footer note ──────────────────────────────────────────────────── */}
      <div className="flex items-start gap-2 bg-violet-50 border border-violet-100 rounded-2xl p-4">
        <Brain className="w-4 h-4 text-violet-500 shrink-0 mt-0.5" />
        <p className="text-xs font-medium text-violet-700">
          <strong>How it works:</strong> Fail probability is computed using a weighted formula —
          attendance trend (40%), score average (35%), score trajectory (15%), and fee signals (10%).
          Students with ≥70% probability are flagged Critical and need immediate intervention.
        </p>
      </div>
    </div>
  );
}
