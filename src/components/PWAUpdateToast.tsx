import { useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";

let registerSWFn: ((opts: any) => any) | null = null;

async function loadRegister() {
  if (registerSWFn) return registerSWFn;
  const mod = await import("virtual:pwa-register");
  registerSWFn = mod.registerSW;
  return registerSWFn;
}

export default function PWAUpdateToast() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const [updateFn, setUpdateFn] = useState<(() => Promise<void>) | null>(null);

  useEffect(() => {
    let cancelled = false;
    let dismissOfflineReady: ReturnType<typeof setTimeout>;

    loadRegister().then((registerSW) => {
      if (cancelled || !registerSW) return;
      const update = registerSW({
        onNeedRefresh() { setNeedRefresh(true); },
        onOfflineReady() {
          setOfflineReady(true);
          dismissOfflineReady = setTimeout(() => setOfflineReady(false), 4000);
        },
        onRegisterError(err: any) {
          console.warn("[PWA] SW register failed:", err);
        },
      });
      setUpdateFn(() => update);
    }).catch((err) => {
      console.warn("[PWA] SW module not available:", err);
    });

    return () => {
      cancelled = true;
      if (dismissOfflineReady) clearTimeout(dismissOfflineReady);
    };
  }, []);

  if (!needRefresh && !offlineReady) return null;

  if (needRefresh) {
    return (
      <div
        role="status"
        className="fixed bottom-24 lg:bottom-6 right-4 left-4 sm:left-auto sm:right-6 z-[60] max-w-sm sm:max-w-xs mx-auto sm:mx-0 bg-white rounded-2xl shadow-2xl shadow-blue-900/15 border border-slate-100 p-4 animate-in slide-in-from-bottom-3 duration-300"
        style={{ marginBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
            <RefreshCw className="w-5 h-5 text-[#1e3a8a]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-[#1e294b]">Update available</p>
            <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
              A new version of Edullent is ready.
            </p>
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={() => updateFn && updateFn()}
                className="px-3 py-1.5 rounded-lg bg-[#1e3a8a] text-white text-xs font-bold hover:bg-blue-900 transition-colors touch-target"
              >
                Reload
              </button>
              <button
                onClick={() => setNeedRefresh(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-500 hover:bg-slate-100 transition-colors touch-target"
              >
                Later
              </button>
            </div>
          </div>
          <button
            onClick={() => setNeedRefresh(false)}
            className="p-1 -m-1 text-slate-400 hover:text-slate-600 touch-target"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      role="status"
      className="fixed bottom-24 lg:bottom-6 right-4 left-4 sm:left-auto sm:right-6 z-[60] max-w-sm sm:max-w-xs mx-auto sm:mx-0 bg-emerald-50 border border-emerald-100 rounded-2xl shadow-lg p-3 px-4 animate-in slide-in-from-bottom-3 duration-300"
      style={{ marginBottom: "env(safe-area-inset-bottom)" }}
    >
      <p className="text-sm font-bold text-emerald-700">Ready to work offline</p>
      <p className="text-xs text-emerald-600/80 mt-0.5">App content is now cached.</p>
    </div>
  );
}
