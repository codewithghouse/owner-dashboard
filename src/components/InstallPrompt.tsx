import { useEffect, useState } from "react";
import { Share, Plus, Download, X } from "lucide-react";

const STORAGE_KEY = "edu_install_dismissed_at";
const COOLDOWN_DAYS = 7;

type BIPEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as any).standalone === true
  );
}

function isIOSSafari() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(ua);
  return isIOS && isSafari;
}

function withinCooldown(): boolean {
  try {
    const ts = Number(localStorage.getItem(STORAGE_KEY) || "0");
    if (!ts) return false;
    const days = (Date.now() - ts) / (1000 * 60 * 60 * 24);
    return days < COOLDOWN_DAYS;
  } catch {
    return false;
  }
}

function markDismissed() {
  try {
    localStorage.setItem(STORAGE_KEY, String(Date.now()));
  } catch {
    /* localStorage may be blocked */
  }
}

export default function InstallPrompt() {
  const [bipEvent, setBipEvent] = useState<BIPEvent | null>(null);
  const [showIOSHint, setShowIOSHint] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (isStandalone() || withinCooldown()) {
      setDismissed(true);
      return;
    }

    const onBIP = (e: Event) => {
      e.preventDefault();
      setBipEvent(e as BIPEvent);
    };
    window.addEventListener("beforeinstallprompt", onBIP);

    const onInstalled = () => {
      setBipEvent(null);
      setShowIOSHint(false);
    };
    window.addEventListener("appinstalled", onInstalled);

    if (isIOSSafari()) {
      const timer = window.setTimeout(() => setShowIOSHint(true), 4000);
      return () => {
        window.clearTimeout(timer);
        window.removeEventListener("beforeinstallprompt", onBIP);
        window.removeEventListener("appinstalled", onInstalled);
      };
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBIP);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (!bipEvent) return;
    await bipEvent.prompt();
    const choice = await bipEvent.userChoice;
    if (choice.outcome === "dismissed") markDismissed();
    setBipEvent(null);
  };

  const handleDismiss = () => {
    markDismissed();
    setBipEvent(null);
    setShowIOSHint(false);
    setDismissed(true);
  };

  if (dismissed) return null;

  if (bipEvent) {
    return (
      <div
        role="dialog"
        aria-label="Install Edullent"
        className="fixed bottom-24 lg:bottom-6 right-4 left-4 sm:left-auto sm:right-6 z-[60] max-w-sm sm:max-w-xs mx-auto sm:mx-0 bg-white rounded-2xl shadow-2xl shadow-blue-900/15 border border-slate-100 p-4 animate-in slide-in-from-bottom-3 duration-300"
        style={{ marginBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#1e3a8a] flex items-center justify-center shrink-0">
            <Download className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-[#1e294b]">Install Edullent</p>
            <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
              Add to your home screen for quick access and offline use.
            </p>
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={handleInstall}
                className="px-3 py-1.5 rounded-lg bg-[#1e3a8a] text-white text-xs font-bold hover:bg-blue-900 transition-colors touch-target"
              >
                Install
              </button>
              <button
                onClick={handleDismiss}
                className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-500 hover:bg-slate-100 transition-colors touch-target"
              >
                Not now
              </button>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className="p-1 -m-1 text-slate-400 hover:text-slate-600 touch-target"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  if (showIOSHint) {
    return (
      <div
        role="dialog"
        aria-label="Install on iOS"
        className="fixed bottom-24 right-4 left-4 z-[60] max-w-sm mx-auto bg-white rounded-2xl shadow-2xl shadow-blue-900/15 border border-slate-100 p-4 animate-in slide-in-from-bottom-3 duration-300"
        style={{ marginBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#1e3a8a] flex items-center justify-center shrink-0">
            <Download className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-[#1e294b]">Add to Home Screen</p>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              Tap <Share className="inline w-3.5 h-3.5 -mt-0.5 mx-0.5 text-[#1e3a8a]" /> Share, then{" "}
              <span className="inline-flex items-center gap-0.5 font-bold text-[#1e3a8a]">
                <Plus className="w-3.5 h-3.5" />Add to Home Screen
              </span>.
            </p>
            <button
              onClick={handleDismiss}
              className="mt-3 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-500 hover:bg-slate-100 transition-colors touch-target"
            >
              Got it
            </button>
          </div>
          <button
            onClick={handleDismiss}
            className="p-1 -m-1 text-slate-400 hover:text-slate-600 touch-target"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return null;
}
