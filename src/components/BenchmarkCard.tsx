/**
 * BenchmarkCard.tsx
 * Shows inter-school benchmarking in Dashboard.
 * Fetches once on mount, shows percentile rank + comparison bars.
 */
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { fetchBenchmarkData, BenchmarkData } from "@/lib/benchmarkService";
import { Trophy, TrendingUp, Users, Loader2, BarChart3 } from "lucide-react";

const TIER_CONFIG = {
  "Top 25%":    { color: "text-emerald-600", bg: "bg-emerald-50", border: "border-emerald-200", icon: "🏆" },
  "Upper-Mid":  { color: "text-blue-600",    bg: "bg-blue-50",    border: "border-blue-200",    icon: "📈" },
  "Lower-Mid":  { color: "text-amber-600",   bg: "bg-amber-50",   border: "border-amber-200",   icon: "📊" },
  "Bottom 25%": { color: "text-red-600",     bg: "bg-red-50",     border: "border-red-200",     icon: "⚠️" },
};

function CompareBar({ label, myVal, avgVal, topVal }: { label: string; myVal: number; avgVal: number; topVal?: number }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-slate-500">{label}</span>
        <span className="text-xs font-black text-[#1e294b]">{myVal}%</span>
      </div>
      <div className="relative h-2.5 bg-slate-100 rounded-full overflow-hidden">
        {/* Platform avg marker */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-slate-400 z-10"
          style={{ left: `${avgVal}%` }}
          title={`Platform avg: ${avgVal}%`}
        />
        {/* My bar */}
        <div
          className={`h-full rounded-full transition-all ${
            myVal >= avgVal ? "bg-emerald-500" : "bg-amber-500"
          }`}
          style={{ width: `${myVal}%` }}
        />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[9px] text-slate-400">Avg: {avgVal}%</span>
        {topVal && <span className="text-[9px] text-slate-400">Top: {topVal}%</span>}
      </div>
    </div>
  );
}

export default function BenchmarkCard() {
  const navigate = useNavigate();
  const [data,    setData]    = useState<BenchmarkData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBenchmarkData().then(d => { setData(d); setLoading(false); });
  }, []);

  if (loading) {
    return (
      <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm p-6 flex items-center justify-center h-40">
        <Loader2 className="w-5 h-5 animate-spin text-slate-300" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm p-6 flex flex-col items-center justify-center h-40 gap-2">
        <BarChart3 className="w-8 h-8 text-slate-200" />
        <p className="text-xs font-bold text-slate-400 text-center">
          Benchmarking unlocks once your school has saved at least one monthly snapshot.
        </p>
      </div>
    );
  }

  const tierCfg = TIER_CONFIG[data.tier];

  return (
    <div
      onClick={() => navigate("/reports")}
      role="button"
      tabIndex={0}
      className="bg-white rounded-[2rem] border border-slate-100 shadow-sm p-6 space-y-5 cursor-pointer hover:shadow-md transition-shadow"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">Platform Benchmark</h3>
          <p className="text-sm font-bold text-[#1e294b] mt-0.5">How you rank among {data.totalSchools} schools</p>
        </div>
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${tierCfg.bg} border ${tierCfg.border}`}>
          <span className="text-base">{tierCfg.icon}</span>
        </div>
      </div>

      {/* Percentile badge */}
      <div className={`rounded-2xl border ${tierCfg.border} ${tierCfg.bg} px-4 py-3 flex items-center justify-between`}>
        <div>
          <p className={`text-2xl font-black ${tierCfg.color}`}>{data.tier}</p>
          <p className="text-xs font-bold text-slate-500 mt-0.5">
            Better than {data.ahiPercentile}% of schools on the platform
          </p>
        </div>
        <div className="text-right">
          <p className={`text-3xl font-black ${tierCfg.color}`}>{data.myAhi}%</p>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Your AHI</p>
        </div>
      </div>

      {/* AHI comparison */}
      <div className="space-y-1">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-bold text-slate-500">AHI vs Platform</span>
        </div>
        <div className="flex items-end gap-2">
          {[
            { label: "You",      value: data.myAhi,          color: "bg-[#1e3a8a]" },
            { label: "Avg",      value: data.platformAvgAhi, color: "bg-slate-300"  },
            { label: "Top 25%",  value: data.topQuartileAhi, color: "bg-emerald-400" },
          ].map(b => {
            const maxH = 64;
            const h    = Math.max(8, Math.round((b.value / 100) * maxH));
            return (
              <div key={b.label} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-[10px] font-black text-slate-600">{b.value}%</span>
                <div className={`w-full rounded-t-xl ${b.color}`} style={{ height: h }} />
                <span className="text-[9px] text-slate-400 font-bold">{b.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Detailed comparison bars */}
      <div className="space-y-3">
        <CompareBar
          label="Attendance"
          myVal={data.myAttendance}
          avgVal={data.platformAvgAttendance}
        />
        <CompareBar
          label="Pass Rate"
          myVal={data.myPassRate}
          avgVal={data.platformAvgPassRate}
        />
        <CompareBar
          label="Fee Collection"
          myVal={data.myFeeRate}
          avgVal={data.platformAvgFeeRate}
        />
      </div>

      <p className="text-[9px] text-slate-300 font-medium">
        All data is anonymized. Schools are identified only by tier, not name.
      </p>
    </div>
  );
}
