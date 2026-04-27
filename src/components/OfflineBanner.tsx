import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

export default function OfflineBanner() {
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  if (online) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-0 inset-x-0 z-[55] bg-amber-500 text-white text-xs font-bold px-4 py-1.5 flex items-center justify-center gap-2 shadow-md"
      style={{ paddingTop: "calc(0.375rem + env(safe-area-inset-top))" }}
    >
      <WifiOff className="w-3.5 h-3.5" />
      <span>You're offline — showing cached data</span>
    </div>
  );
}
