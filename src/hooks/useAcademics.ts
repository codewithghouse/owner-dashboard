import { useCallback, useEffect, useState } from "react";
import {
  AcademicsOverviewData,
  SubjectDetail,
  fetchSubjectDetail,
  invalidateAcademicsCache,
  subscribeAcademicsOverview,
} from "@/lib/academicsService";

export function useAcademicsOverview() {
  const [data, setData]     = useState<AcademicsOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    setLoading(true);
    const unsub = subscribeAcademicsOverview(
      (d) => { setData(d); setLoading(false); },
      (err) => { setError(err.message); setLoading(false); }
    );
    return () => unsub();
  }, [refreshTick]);

  const refresh = useCallback(() => {
    invalidateAcademicsCache();
    setRefreshTick(t => t + 1);
  }, []);

  return { data, loading, error, refresh };
}

export function useSubjectDetail(id: string | undefined) {
  const [subject, setSubject]   = useState<SubjectDetail | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  useEffect(() => {
    if (!id) { setSubject(null); return; }
    setLoading(true);
    fetchSubjectDetail(id)
      .then((d) => { setSubject(d); setLoading(false); })
      .catch((err) => { setError(err.message); setLoading(false); });
  }, [id]);

  return { subject, loading, error };
}
