import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import {
  fetchOwnerLeaderboard, fetchAIInsightForBranch,
} from "@/lib/ownerLeaderboardService";
import { invalidateCache } from "@/lib/analyticsService";
import type { OwnerLeaderboardData, OwnerBranchInsight } from "@/lib/ownerTypes";

const REFRESH_MS = 60_000;

export type AISourceLabel = "ai" | "cache" | "fallback";

export function useOwnerBranchLeaderboard() {
  const [data, setData]       = useState<OwnerLeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<Error | null>(null);
  /** Per-branch source: shows where the insight came from. */
  const [aiSources, setAiSources] = useState<Record<string, AISourceLabel>>({});

  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    const enhanceWithAI = async (base: OwnerLeaderboardData) => {
      if (cancelled) return;
      const top = base.aiSources[base.branches[0]?.id];
      if (!top) return;

      // Kick off all branches in parallel; merge each as it resolves.
      base.branches.forEach(async ranking => {
        const fallback = base.insights[ranking.id];
        const source = base.aiSources[ranking.id];
        if (!fallback || !source) return;

        const { insight, source: src } = await fetchAIInsightForBranch(
          ranking.id, base.network.monthKey, ranking,
          ranking.rank === 1 ? null : top,
          source, base.network, fallback,
        );
        if (cancelled) return;

        setData(prev => {
          if (!prev) return prev;
          return { ...prev, insights: { ...prev.insights, [ranking.id]: insight } };
        });
        setAiSources(prev => ({ ...prev, [ranking.id]: src }));
      });
    };

    const run = async (uid: string) => {
      try {
        invalidateCache(`core:${uid}`);
        const result = await fetchOwnerLeaderboard();
        if (cancelled) return;
        setData(result);
        setError(null);
        setLoading(false);
        // Fire-and-forget AI enhancement.
        void enhanceWithAI(result);
      } catch (err) {
        if (!cancelled) {
          setError(err as Error);
          setLoading(false);
        }
      }
    };

    const unsubAuth = onAuthStateChanged(auth, user => {
      if (interval) { clearInterval(interval); interval = null; }
      if (!user) {
        setData(null); setLoading(false); setAiSources({});
        return;
      }
      setLoading(true);
      run(user.uid);
      interval = setInterval(() => run(user.uid), REFRESH_MS);
    });

    return () => {
      cancelled = true;
      unsubAuth();
      if (interval) clearInterval(interval);
    };
  }, []);

  return { data, loading, error, aiSources };
}
