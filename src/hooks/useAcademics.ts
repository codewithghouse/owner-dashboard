import { useEffect, useState } from "react";
import {
  AcademicsOverviewData,
  SubjectDetail,
  fetchSubjectDetail,
  subscribeAcademicsOverview,
} from "@/lib/academicsService";

export function useAcademicsOverview() {
  const [data, setData]     = useState<AcademicsOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribeAcademicsOverview(
      (d) => { setData(d); setLoading(false); },
      (err) => { setError(err.message); setLoading(false); }
    );
    return () => unsub();
  }, []);

  return { data, loading, error };
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
