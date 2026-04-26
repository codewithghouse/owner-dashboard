import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { fetchOwnerLeaderboard } from "@/lib/ownerLeaderboardService";
import { invalidateCache } from "@/lib/analyticsService";
import type { OwnerLeaderboardData } from "@/lib/ownerTypes";

const REFRESH_MS = 60_000;

export function useOwnerBranchLeaderboard() {
  const [data, setData]       = useState<OwnerLeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    const run = async (uid: string) => {
      try {
        invalidateCache(`core:${uid}`);
        const result = await fetchOwnerLeaderboard();
        if (!cancelled) { setData(result); setError(null); }
      } catch (err) {
        if (!cancelled) setError(err as Error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const unsubAuth = onAuthStateChanged(auth, user => {
      if (interval) { clearInterval(interval); interval = null; }
      if (!user) {
        setData(null); setLoading(false);
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

  return { data, loading, error };
}
