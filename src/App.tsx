import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import AppLayout from "@/components/AppLayout";
import Dashboard from "@/pages/Dashboard";
import StudentsIntelligence from "@/pages/StudentsIntelligence";
import TeacherPerformance from "@/pages/TeacherPerformance";
import TeacherProfile from "@/pages/TeacherProfile";
import AcademicsOverview from "@/pages/AcademicsOverview";
import FinanceFees from "@/pages/FinanceFees";
import RisksAlerts from "@/pages/RisksAlerts";
import AlertDetail from "@/pages/AlertDetail";
import BranchesComparison from "@/pages/BranchesComparison";
import ReportsCenter from "@/pages/ReportsCenter";
import SettingsPage from "@/pages/SettingsPage";
import PrincipalManagement from "@/pages/PrincipalManagement";
import DEOManagement from "@/pages/DEOManagement";
import AuditLogPage from "@/pages/AuditLogPage";
import AIPredictorPage from "@/pages/AIPredictorPage";
import ParentPortal from "@/pages/ParentPortal";
import NotFound from "@/pages/NotFound";
import LoginPage from "@/pages/LoginPage";
import OnboardingModal from "@/components/OnboardingModal";
import { useState, useEffect } from "react";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc, collection, getDocs, limit, query, setDoc } from "firebase/firestore";
import { onAuthStateChanged, User } from "firebase/auth";
import { Loader2 } from "lucide-react";

const queryClient = new QueryClient();

const App = () => {
  const [user, setUser]                   = useState<User | null>(null);
  const [loading, setLoading]             = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setLoading(false);

      // Check if new user needs onboarding
      if (currentUser) {
        try {
          const uid       = currentUser.uid;
          const schoolDoc = await getDoc(doc(db, "schools", uid));
          const data      = schoolDoc.data();

          if (data?.onboardingComplete) {
            // Already completed — never show again
            return;
          }

          // Check if owner already has branches set up
          // (existing owners won't have onboardingComplete but DO have data)
          const branchSnap = await getDocs(
            query(collection(db, "schools", uid, "branches"), limit(1))
          );
          const hasBranches = !branchSnap.empty;

          if (hasBranches || data?.schoolName) {
            // Existing owner — silently mark complete, skip wizard
            await setDoc(doc(db, "schools", uid), { onboardingComplete: true }, { merge: true });
          } else {
            // Genuinely new owner with no data — show wizard
            setShowOnboarding(true);
          }
        } catch {
          // Doc doesn't exist yet → brand new owner, show wizard
          setShowOnboarding(true);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#f8fafc]">
        <Loader2 className="w-8 h-8 animate-spin text-[#1e3a8a]" />
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            {/* ── Public routes (no auth needed) ────────────────────── */}
            <Route path="/parent-portal" element={<ParentPortal />} />

            {/* ── Auth-gated routes ──────────────────────────────────── */}
            {!user ? (
              <Route path="*" element={<LoginPage />} />
            ) : (
              <Route path="*" element={
                <>
                  {showOnboarding && (
                    <OnboardingModal onComplete={() => setShowOnboarding(false)} />
                  )}
                  <AppLayout>
                    <Routes>
                      <Route path="/"                      element={<Dashboard />} />
                      <Route path="/students"              element={<StudentsIntelligence />} />
                      <Route path="/students/:id"          element={<StudentsIntelligence />} />
                      <Route path="/teachers"              element={<TeacherPerformance />} />
                      <Route path="/teachers/:id"          element={<TeacherPerformance />} />
                      <Route path="/teachers/profile/:id"  element={<TeacherProfile />} />
                      <Route path="/academics"             element={<AcademicsOverview />} />
                      <Route path="/academics/:id"         element={<AcademicsOverview />} />
                      <Route path="/finance"               element={<FinanceFees />} />
                      <Route path="/risks"                 element={<RisksAlerts />} />
                      <Route path="/risks/:id"             element={<AlertDetail />} />
                      <Route path="/branches"              element={<BranchesComparison />} />
                      <Route path="/branches/:id"          element={<BranchesComparison />} />
                      <Route path="/reports"               element={<ReportsCenter />} />
                      <Route path="/principals"            element={<PrincipalManagement />} />
                      <Route path="/deo"                   element={<DEOManagement />} />
                      <Route path="/audit"                 element={<AuditLogPage />} />
                      <Route path="/ai-predictor"          element={<AIPredictorPage />} />
                      <Route path="/settings"              element={<SettingsPage />} />
                      <Route path="*"                      element={<NotFound />} />
                    </Routes>
                  </AppLayout>
                </>
              } />
            )}
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
