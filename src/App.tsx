import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import AppLayout from "@/components/AppLayout";
import OnboardingModal from "@/components/OnboardingModal";
import LoginPage from "@/pages/LoginPage";
import { lazy, Suspense, useState, useEffect } from "react";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc, collection, getDocs, limit, query, setDoc } from "firebase/firestore";
import { onAuthStateChanged, User } from "firebase/auth";
import { syncClaimsAndRefreshToken } from "@/lib/syncClaims";
import { Loader2 } from "lucide-react";

// ── Route-level code splitting (PWA pre-req: shrink initial bundle) ──────────
const Dashboard            = lazy(() => import("@/pages/Dashboard"));
const StudentsIntelligence = lazy(() => import("@/pages/StudentsIntelligence"));
const StudentProfile       = lazy(() => import("@/pages/StudentProfile"));
const TeacherPerformance   = lazy(() => import("@/pages/TeacherPerformance"));
const TeacherProfile       = lazy(() => import("@/pages/TeacherProfile"));
const TeachersDirectory    = lazy(() => import("@/pages/TeachersDirectory"));
const FeeStructureOverview = lazy(() => import("@/pages/FeeStructureOverview"));
const AcademicsOverview    = lazy(() => import("@/pages/AcademicsOverview"));
const FinanceFees          = lazy(() => import("@/pages/FinanceFees"));
const RisksAlerts          = lazy(() => import("@/pages/RisksAlerts"));
const AlertDetail          = lazy(() => import("@/pages/AlertDetail"));
const BranchesComparison   = lazy(() => import("@/pages/BranchesComparison"));
const ReportsCenter        = lazy(() => import("@/pages/ReportsCenter"));
const SettingsPage         = lazy(() => import("@/pages/SettingsPage"));
const PrincipalManagement  = lazy(() => import("@/pages/PrincipalManagement"));
const DEOManagement        = lazy(() => import("@/pages/DEOManagement"));
const AuditLogPage         = lazy(() => import("@/pages/AuditLogPage"));
const AIPredictorPage      = lazy(() => import("@/pages/AIPredictorPage"));
const TeacherLeaderboard   = lazy(() => import("@/pages/TeacherLeaderboard"));
const OwnerDashboard       = lazy(() => import("@/pages/owner/OwnerDashboard"));
const ParentPortal         = lazy(() => import("@/pages/ParentPortal"));
const NotFound             = lazy(() => import("@/pages/NotFound"));

const RouteFallback = () => (
  <div className="flex items-center justify-center py-20">
    <Loader2 className="w-6 h-6 animate-spin text-[#1e3a8a]" />
  </div>
);

const queryClient = new QueryClient();

const App = () => {
  const [user, setUser]                   = useState<User | null>(null);
  const [loading, setLoading]             = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      // Sync custom claims first so subsequent reads pass through Firestore rules.
      if (currentUser) {
        await syncClaimsAndRefreshToken(currentUser);
      }
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
            <Route path="/parent-portal" element={<Suspense fallback={<RouteFallback />}><ParentPortal /></Suspense>} />

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
                    <Suspense fallback={<RouteFallback />}>
                      <Routes>
                        <Route path="/"                      element={<Dashboard />} />
                        <Route path="/students"              element={<StudentsIntelligence />} />
                        <Route path="/students/:id"          element={<StudentProfile />} />
                        <Route path="/teachers"              element={<TeacherPerformance />} />
                        <Route path="/teachers/:id"          element={<TeacherPerformance />} />
                        <Route path="/teachers/profile/:id"  element={<TeacherProfile />} />
                        <Route path="/teachers-directory"    element={<TeachersDirectory />} />
                        <Route path="/academics"             element={<AcademicsOverview />} />
                        <Route path="/academics/:id"         element={<AcademicsOverview />} />
                        <Route path="/finance"               element={<FinanceFees />} />
                        <Route path="/fee-structure"         element={<FeeStructureOverview />} />
                        <Route path="/risks"                 element={<RisksAlerts />} />
                        <Route path="/risks/:id"             element={<AlertDetail />} />
                        <Route path="/branches"              element={<BranchesComparison />} />
                        <Route path="/branches/:id"          element={<BranchesComparison />} />
                        <Route path="/reports"               element={<ReportsCenter />} />
                        <Route path="/principals"            element={<PrincipalManagement />} />
                        <Route path="/deo"                   element={<DEOManagement />} />
                        <Route path="/audit"                 element={<AuditLogPage />} />
                        <Route path="/ai-predictor"          element={<AIPredictorPage />} />
                        <Route path="/teacher-leaderboard"   element={<TeacherLeaderboard />} />
                        <Route path="/branch-leaderboard"    element={<OwnerDashboard />} />
                        <Route path="/settings"              element={<SettingsPage />} />
                        <Route path="*"                      element={<NotFound />} />
                      </Routes>
                    </Suspense>
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
