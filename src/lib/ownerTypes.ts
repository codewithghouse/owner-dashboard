// Types for the Owner Branch Leaderboard view.
// Adapted to the existing single-school owner data model (schools/{uid}/branches).

export interface OwnerBranchRanking {
  rank: number;
  id: string;
  name: string;
  city: string;
  initial: string;
  students: number;
  teachers: number;
  composite: number;            // = AHI (40% attendance + 40% passRate + 20% feeCollection)
  weekChange: number;           // month-over-month attendance % delta
  trend: "up" | "down" | "same";
  contextLine: string;
  contextColor: string;
}

export interface BranchWhyTopItem {
  metric: string;
  detail: string;
}

export interface BranchWhyHereItem {
  color: string;
  bold: string;
  rest: string;
}

export interface BranchSolution {
  urgent: boolean;
  text: string;
}

export interface OwnerBranchStyle {
  headerGradient: string;
  rankBg: string;
  rankShadow: string;
  avatarBg: string;
  avatarColor: string;
  solutionBg: string;
  solutionBorder: string;
  solutionArrowColor: string;
}

export interface OwnerBranchInsight {
  branchId: string;
  isTop: boolean;
  whyTop: BranchWhyTopItem[];
  pills: string[];
  whyHere: BranchWhyHereItem[];
  solutions: BranchSolution[];
  solutionLabel: string;
  style: OwnerBranchStyle;
}

export interface OwnerNetworkSummary {
  name: string;          // school name
  monthLabel: string;    // current month label e.g. "April"
  totalBranches: number;
  totalStudents: number;
  totalTeachers: number;
  networkAvg: number;
  topScore: number;
  totalAtRisk: number;
}

export interface OwnerLeaderboardData {
  network: OwnerNetworkSummary;
  branches: OwnerBranchRanking[];
  insights: Record<string, OwnerBranchInsight>;
}
