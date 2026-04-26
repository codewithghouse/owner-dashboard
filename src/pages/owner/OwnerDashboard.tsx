import React, { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { FONT, T } from "./ownerDashboardTokens";
import LeaderboardPanel from "./panels/LeaderboardPanel";
import DetailPanel from "./panels/DetailPanel";
import { useIsMobile } from "@/hooks/use-mobile";
import { useOwnerBranchLeaderboard } from "@/hooks/useOwnerBranchLeaderboard";
import type { OwnerBranchRanking, OwnerNetworkSummary } from "@/lib/ownerTypes";

const EMPTY_NETWORK: OwnerNetworkSummary = {
  name: "Network", monthLabel: "",
  totalBranches: 0, totalStudents: 0, totalTeachers: 0,
  networkAvg: 0, topScore: 0, totalAtRisk: 0,
};

const FullScreenMessage: React.FC<{ children: React.ReactNode; spinner?: boolean }> = ({
  children, spinner,
}) => (
  <div style={{
    minHeight: "60vh", background: T.pageBg, display: "flex", alignItems: "center",
    justifyContent: "center", flexDirection: "column", gap: 16, fontFamily: FONT,
  }}>
    {spinner && <Loader2 className="w-8 h-8 animate-spin" style={{ color: T.B1 }} />}
    <p style={{ fontSize: 14, fontWeight: 600, color: T.T3, margin: 0, textAlign: "center", padding: "0 24px" }}>
      {children}
    </p>
  </div>
);

const OwnerDashboard: React.FC = () => {
  const isMobile = useIsMobile();
  const { data, loading, error } = useOwnerBranchLeaderboard();

  const [mobileScreen, setMobileScreen] = useState<"list" | "detail">("list");
  const [selectedId, setSelectedId]     = useState<string | null>(null);

  // Default selection on desktop = rank #1.
  useEffect(() => {
    if (!data || data.branches.length === 0) return;
    if (!isMobile && !selectedId) setSelectedId(data.branches[0].id);
  }, [data, isMobile, selectedId]);

  // Drop the selection if the branch list changes underneath us.
  useEffect(() => {
    if (!data) return;
    if (selectedId && !data.branches.find(b => b.id === selectedId)) {
      setSelectedId(data.branches[0]?.id || null);
    }
  }, [data, selectedId]);

  const selectedBranch: OwnerBranchRanking | null = useMemo(() => {
    if (!data || !selectedId) return null;
    return data.branches.find(b => b.id === selectedId) || null;
  }, [data, selectedId]);

  const selectedInsight = selectedBranch && data
    ? data.insights[selectedBranch.id] || null
    : null;

  const handleSelect = (b: OwnerBranchRanking) => {
    setSelectedId(b.id);
    if (isMobile) setMobileScreen("detail");
  };

  if (loading && !data) {
    return <FullScreenMessage spinner>Loading branch leaderboard…</FullScreenMessage>;
  }
  if (error) {
    return (
      <FullScreenMessage>
        Couldn't load leaderboard: {error.message}
      </FullScreenMessage>
    );
  }

  const network = data?.network || EMPTY_NETWORK;
  const branches = data?.branches || [];
  const insights = data?.insights || {};

  if (data && branches.length === 0) {
    return (
      <FullScreenMessage>
        No branches found in this account yet. Add a branch from Branches Comparison or the onboarding wizard to start ranking.
      </FullScreenMessage>
    );
  }

  // Mobile — let the inner panel scroll naturally inside AppLayout's main.
  // Negative margin escapes the p-4 wrapper so the design renders edge-to-edge.
  if (isMobile) {
    return (
      <div style={{
        margin: "-16px -16px -80px",
        background: T.pageBg, fontFamily: FONT, minHeight: "calc(100vh - 64px)",
      }}>
        {mobileScreen === "list" && (
          <LeaderboardPanel
            network={network}
            branches={branches}
            insights={insights}
            selectedId={selectedId}
            onSelect={handleSelect}
            isMobile
          />
        )}
        {mobileScreen === "detail" && (
          <DetailPanel
            branch={selectedBranch}
            insight={selectedInsight}
            network={network}
            onBack={() => setMobileScreen("list")}
            isMobile
          />
        )}
      </div>
    );
  }

  // Desktop split — escape AppLayout's p-10 padding (40px each side) so each
  // panel can scroll independently inside the available viewport height
  // (100vh - 80px header - 80px vertical padding = calc(100vh - 160px)).
  // We add the padding back via negative margins so we paint edge-to-edge.
  const panelHeight = "calc(100vh - 80px)";
  return (
    <div style={{
      margin: "-40px",
      background: T.pageBg, display: "flex", fontFamily: FONT,
      height: panelHeight,
    }}>
      <div style={{
        width: 400, flexShrink: 0, height: "100%",
        overflowY: "auto", borderRight: T.BORDER,
      }}>
        <LeaderboardPanel
          network={network}
          branches={branches}
          insights={insights}
          selectedId={selectedId}
          onSelect={handleSelect}
          isMobile={false}
        />
      </div>
      <div style={{ flex: 1, height: "100%", overflowY: "auto" }}>
        <DetailPanel
          branch={selectedBranch}
          insight={selectedInsight}
          network={network}
          onBack={null}
          isMobile={false}
        />
      </div>
    </div>
  );
};

export default OwnerDashboard;
