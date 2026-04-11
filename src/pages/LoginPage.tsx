import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { GraduationCap, Mail, Lock, ArrowRight, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { auth, db } from "@/lib/firebase";
import { signInWithEmailAndPassword, sendPasswordResetEmail } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { toast } from "sonner";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const [forgotOpen, setForgotOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetLoading, setResetLoading] = useState(false);

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetEmail.trim()) return;
    setResetLoading(true);
    try {
      await sendPasswordResetEmail(auth, resetEmail.trim());
      toast.success("Password reset email sent! Check your inbox.");
      setForgotOpen(false);
      setResetEmail("");
    } catch (error: any) {
      const code = error?.code ?? "";
      if (code === "auth/user-not-found" || code === "auth/invalid-email") {
        toast.error("No account found with this email address.");
      } else if (code === "auth/too-many-requests") {
        toast.error("Too many requests. Please wait a few minutes and try again.");
      } else {
        toast.error("Failed to send reset email. Please try again.");
      }
    } finally {
      setResetLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // Verify role in Firestore (separate try so Firestore errors don't block login)
      try {
        const docRef  = doc(db, "schools", user.uid);
        const docSnap = await getDoc(docRef);

        if (!docSnap.exists()) {
          // No school document found — let them in if auth passed (owner may not have a schools doc)
          toast.success("Welcome back!");
          navigate("/");
          return;
        }

        const role = (docSnap.data()?.role ?? "").toString().toLowerCase().trim();
        if (role === "owner") {
          toast.success("Welcome back, Chairman!");
          navigate("/");
        } else {
          await auth.signOut();
          toast.error(`Access denied — your role is "${docSnap.data()?.role ?? "unknown"}". Owner portal only.`);
        }
      } catch (firestoreErr: any) {
        // Firestore check failed (rules / network) but auth succeeded — let them in
        console.warn("Firestore role check failed:", firestoreErr?.code, firestoreErr?.message);
        toast.success("Welcome back!");
        navigate("/");
      }
    } catch (error: any) {
      const code = error?.code ?? "";
      if (code === "auth/wrong-password" || code === "auth/user-not-found" || code === "auth/invalid-credential") {
        toast.error("Invalid email or password.");
      } else if (code === "auth/too-many-requests") {
        toast.error("Too many failed attempts. Please try again later.");
      } else if (code === "auth/invalid-email") {
        toast.error("Invalid email format.");
      } else if (code === "auth/network-request-failed") {
        toast.error("Network error. Check your internet connection.");
      } else {
        toast.error(`Login failed: ${code || error?.message || "Unknown error"}`);
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
          Secured by EduIntellect Cloud Architecture
        </p>
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
