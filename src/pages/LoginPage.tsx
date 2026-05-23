import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { GraduationCap, Mail, Lock, ArrowRight, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { auth, googleProvider } from "@/lib/firebase";
import { signInWithEmailAndPassword, sendPasswordResetEmail, signInWithPopup } from "firebase/auth";
import { syncClaimsAndRefreshToken } from "@/lib/syncClaims";
import { toast } from "sonner";

const GoogleIcon = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden>
    <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.616z" />
    <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" />
    <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" />
    <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
  </svg>
);

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const navigate = useNavigate();

  const [forgotOpen, setForgotOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetLoading, setResetLoading] = useState(false);

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const target = resetEmail.trim();
    if (!target) return;
    setResetLoading(true);
    try {
      await sendPasswordResetEmail(auth, target);
    } catch (err: any) {
      // Swallow auth/user-not-found etc. to prevent user-enumeration.
      // Only surface rate-limit so the user knows to wait.
      if (err?.code === "auth/too-many-requests") {
        toast.error("Too many requests. Please wait a few minutes and try again.");
        setResetLoading(false);
        return;
      }
      console.warn("[reset-password] non-fatal:", err?.code);
    }
    // Generic success message regardless of whether the account exists.
    toast.success("If an account exists for that email, a reset link has been sent.");
    setForgotOpen(false);
    setResetEmail("");
    setResetLoading(false);
  };

  const verifyRoleAndEnter = async () => {
    const user = auth.currentUser;
    if (!user) {
      toast.error("Sign-in completed but user session missing. Please try again.");
      return false;
    }
    let role: string | undefined;
    try {
      const synced = await syncClaimsAndRefreshToken(user);
      role = synced?.role;
      if (!role) {
        const tok = await user.getIdTokenResult(true);
        role = (tok.claims as any)?.role;
      }
    } catch (syncErr) {
      console.error("[login] claims sync failed:", syncErr);
      await auth.signOut();
      toast.error("Could not verify your account. Please try again.");
      return false;
    }
    if (role !== "owner") {
      await auth.signOut();
      toast.error("Access denied — this portal is for school owners only.");
      return false;
    }
    toast.success("Welcome back, Chairman!");
    navigate("/");
    return true;
  };

  const handleGoogle = async () => {
    setGoogleLoading(true);
    try {
      await signInWithPopup(auth, googleProvider);
      await verifyRoleAndEnter();
    } catch (err: any) {
      const code = err?.code ?? "";
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
        // user cancelled — silent
      } else if (code === "auth/popup-blocked") {
        toast.error("Popup was blocked. Please allow popups for this site.");
      } else {
        console.error("[login] google sign-in failed:", code, err?.message);
        toast.error("Google sign-in failed. Please try again.");
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await signInWithEmailAndPassword(auth, email, password);
      const user = auth.currentUser;
      if (!user) throw new Error("Login failed — no user session.");

      // Sync custom claims so Firestore rules + role gates work.
      // Failure = can't determine role = block login (secure default).
      let role: string | undefined;
      try {
        const synced = await syncClaimsAndRefreshToken(user);
        role = synced?.role;
        // Double-check via token in case sync returned null from caught error.
        if (!role) {
          const tok = await user.getIdTokenResult(true);
          role = (tok.claims as any)?.role;
        }
      } catch (syncErr) {
        console.error("[login] claims sync failed:", syncErr);
        await auth.signOut();
        toast.error("Could not verify your account. Please try again.");
        setLoading(false);
        return;
      }

      // HARD role gate — no "let them in on error" path.
      if (role !== "owner") {
        await auth.signOut();
        toast.error("Access denied — this portal is for school owners only.");
        setLoading(false);
        return;
      }

      toast.success("Welcome back, Chairman!");
      navigate("/");
    } catch (error: any) {
      const code = error?.code ?? "";
      if (code === "auth/wrong-password" || code === "auth/user-not-found" || code === "auth/invalid-credential") {
        toast.error("Invalid email or password.");
      } else if (code === "auth/too-many-requests") {
        toast.error("Too many failed attempts. Please try again in a few minutes.");
      } else if (code === "auth/invalid-email") {
        toast.error("Invalid email format.");
      } else if (code === "auth/network-request-failed") {
        toast.error("Network error. Check your internet connection.");
      } else {
        console.error("[login] unexpected error:", code, error?.message);
        toast.error("Login failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-[400px] space-y-8">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-[2rem] bg-[#1e3a8a] text-white shadow-xl shadow-blue-900/20 mb-6">
            <GraduationCap className="w-8 h-8" />
          </div>
          <h1 className="text-3xl font-black text-[#1e294b] tracking-tight">Owner Portal</h1>
          <p className="text-slate-400 font-medium mt-2">Sign in to manage your school network</p>
        </div>

        <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-xl shadow-slate-200/50">
          <Button
            type="button"
            onClick={handleGoogle}
            disabled={googleLoading || loading}
            variant="outline"
            className="dash-tile w-full h-12 rounded-xl border border-slate-300 hover:bg-slate-50 hover:border-slate-400 text-slate-900 font-bold text-sm flex items-center justify-center gap-3 transition-colors active:scale-95"
            style={{ background: "#FFFFFF" }}
          >
            {googleLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <GoogleIcon /> Continue with Google
              </>
            )}
          </Button>

          <div className="flex items-center gap-3 my-5">
            <div className="h-px flex-1 bg-slate-100" />
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">or</span>
            <div className="h-px flex-1 bg-slate-100" />
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Work Email</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-12 pl-11 rounded-xl bg-slate-50 border-slate-100 focus:bg-white transition-all font-medium text-sm"
                  placeholder="admin@school.com"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center ml-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Password</label>
                <button
                  type="button"
                  onClick={() => { setResetEmail(email); setForgotOpen(true); }}
                  className="text-[10px] font-bold text-blue-600 hover:text-blue-700 transition-colors"
                >
                  Forgot?
                </button>
              </div>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-12 pl-11 rounded-xl bg-slate-50 border-slate-100 focus:bg-white transition-all font-medium text-sm"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <Button
              disabled={loading}
              className="w-full h-12 rounded-xl bg-[#1e294b] hover:bg-[#1e3a8a] text-white font-bold shadow-lg shadow-blue-900/10 transition-all active:scale-95 flex items-center justify-center gap-2 mt-2"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <>Sign In <ArrowRight className="w-4 h-4" /></>}
            </Button>
          </form>
        </div>

        <p className="text-center text-slate-400 text-xs font-medium">
          Secured by Edullent Cloud Architecture
        </p>
        <div className="text-center text-[10px] font-semibold mt-2 flex items-center justify-center gap-3 flex-wrap">
          <a href="/privacy" className="text-slate-400 hover:text-[#1e3a8a] hover:underline transition-colors">
            Privacy Policy
          </a>
          <span className="text-slate-300">·</span>
          <a href="/delete-account" className="text-slate-400 hover:text-[#1e3a8a] hover:underline transition-colors">
            Delete Account
          </a>
          <span className="text-slate-300">·</span>
          <a href="mailto:edullentofficial@gmail.com" className="text-slate-400 hover:text-[#1e3a8a] hover:underline transition-colors">
            Contact
          </a>
        </div>
      </div>

      {/* ── Forgot Password Modal ────────────────────────────────────────── */}
      {forgotOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-sm p-8 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-black text-[#1e294b]">Reset Password</h2>
              <button
                onClick={() => { setForgotOpen(false); setResetEmail(""); }}
                className="p-2 rounded-xl hover:bg-slate-50 transition-colors"
              >
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <p className="text-sm text-slate-500 mb-6 leading-relaxed">
              Enter your work email and we'll send a password reset link to your inbox.
            </p>
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  type="email"
                  required
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  className="h-12 pl-11 rounded-xl bg-slate-50 border-slate-100 focus:bg-white transition-all font-medium text-sm"
                  placeholder="admin@school.com"
                />
              </div>
              <Button
                disabled={resetLoading}
                className="w-full h-12 rounded-xl bg-[#1e294b] hover:bg-[#1e3a8a] text-white font-bold shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2"
              >
                {resetLoading
                  ? <Loader2 className="w-5 h-5 animate-spin" />
                  : "Send Reset Link"
                }
              </Button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
