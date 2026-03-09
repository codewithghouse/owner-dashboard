// ==================== DASHBOARD ====================
export const dashboardStats = {
  academicHealthIndex: { value: 87.4, change: "+2.3% vs last month" },
  totalStudents: { value: 4286, change: "+124 new this term" },
  feeCollectionRate: { value: "94.2%", change: "+1.8% vs last term" },
  activeAlerts: { value: 12, change: "+3 since yesterday" },
};

export const branches = [
  { name: "Main Campus", ahi: 92, students: 2145 },
  { name: "North Branch", ahi: 88, students: 1203 },
  { name: "South Branch", ahi: 81, students: 938 },
];

export const riskDistribution = [
  { name: "Critical", value: 4, fill: "hsl(0, 84%, 60%)" },
  { name: "Warning", value: 6, fill: "hsl(38, 92%, 50%)" },
  { name: "Info", value: 2, fill: "hsl(210, 100%, 50%)" },
];

export const revenueTrend = [
  { month: "Jul", revenue: 380 },
  { month: "Aug", revenue: 420 },
  { month: "Sep", revenue: 450 },
  { month: "Oct", revenue: 480 },
  { month: "Nov", revenue: 510 },
  { month: "Dec", revenue: 540 },
];

export const criticalAlerts = [
  { id: 1, message: "Attendance drop in Grade 8 - North Branch", time: "2 hours ago", severity: "critical" as const },
  { id: 2, message: "Fee defaulters exceeding 30 days", time: "5 hours ago", severity: "warning" as const },
];

// ==================== STUDENTS ====================
export const studentStats = {
  totalEnrollment: { value: 4286, change: "+124 this term" },
  averageAttendance: { value: "91.8%", change: "+0.5% vs last month" },
  atRiskStudents: { value: 186, change: "4.3% of total" },
  highPerformers: { value: 892, change: "20.8% of total" },
};

export const enrollmentByBranch = [
  { branch: "Main", value: 2145 },
  { branch: "North", value: 1203 },
  { branch: "South", value: 938 },
];

export const attendanceByGrade = {
  main: [
    { grade: "Grade 6", attendance: 96 },
    { grade: "Grade 7", attendance: 93 },
    { grade: "Grade 8", attendance: 87 },
    { grade: "Grade 9", attendance: 94 },
    { grade: "Grade 10", attendance: 91 },
    { grade: "Grade 11", attendance: 95 },
  ],
  north: [
    { grade: "Grade 6", attendance: 94 },
    { grade: "Grade 7", attendance: 88 },
    { grade: "Grade 8", attendance: 82 },
    { grade: "Grade 9", attendance: 92 },
    { grade: "Grade 10", attendance: 86 },
    { grade: "Grade 11", attendance: 96 },
  ],
  south: [
    { grade: "Grade 6", attendance: 97 },
    { grade: "Grade 7", attendance: 95 },
    { grade: "Grade 8", attendance: 89 },
    { grade: "Grade 9", attendance: 95 },
    { grade: "Grade 10", attendance: 93 },
    { grade: "Grade 11", attendance: 94 },
  ],
};

export const studentsList = [
  { id: "STU-2021-0842", name: "Aarav Sharma", grade: "Grade 9", branch: "Main Campus", attendance: 96, academicScore: 87, riskStatus: "Low" as const },
  { id: "STU-2022-1156", name: "Priya Kumar", grade: "Grade 8", branch: "North Branch", attendance: 82, academicScore: 74, riskStatus: "Medium" as const },
  { id: "STU-2020-0621", name: "Rahul Verma", grade: "Grade 11", branch: "South Branch", attendance: 68, academicScore: 58, riskStatus: "High" as const },
  { id: "STU-2021-0923", name: "Sneha Patel", grade: "Grade 10", branch: "Main Campus", attendance: 94, academicScore: 91, riskStatus: "Low" as const },
  { id: "STU-2022-1089", name: "Amit Mishra", grade: "Grade 7", branch: "North Branch", attendance: 88, academicScore: 78, riskStatus: "Low" as const },
];

// ==================== TEACHERS ====================
export const teacherStats = {
  effectivenessIndex: { value: 84.6, change: "+1.2 vs last term" },
  totalTeachers: { value: 186, change: "+8 new hires" },
  topPerformers: { value: 42, change: "22.6% of staff" },
  needsImprovement: { value: 18, change: "9.7% of staff" },
};

export const performanceDistribution = [
  { name: "Excellent", value: 42, fill: "hsl(142, 71%, 45%)" },
  { name: "Good", value: 96, fill: "hsl(210, 100%, 50%)" },
  { name: "Average", value: 30, fill: "hsl(38, 92%, 50%)" },
  { name: "Needs Imp.", value: 18, fill: "hsl(0, 84%, 60%)" },
];

export const subjectRatings = [
  { subject: "Math", rating: 90 },
  { subject: "Science", rating: 88 },
  { subject: "English", rating: 86 },
  { subject: "History", rating: 82 },
  { subject: "Arts", rating: 78 },
];

export const topTeachers = [
  { rank: 1, name: "Dr. Sarah Johnson", score: 96.2, subject: "Mathematics", branch: "Main Campus" },
  { rank: 2, name: "Prof. Michael Chen", score: 94.8, subject: "Physics", branch: "North Branch" },
  { rank: 3, name: "Ms. Emily Davis", score: 93.5, subject: "English", branch: "Main Campus" },
  { rank: 4, name: "Mr. Robert Wilson", score: 92.1, subject: "History", branch: "South Branch" },
];

export const performanceVsAttendance = [
  { month: "Aug", performance: 82, attendance: 90 },
  { month: "Sep", performance: 85, attendance: 88 },
  { month: "Oct", performance: 84, attendance: 92 },
  { month: "Nov", performance: 88, attendance: 91 },
  { month: "Dec", performance: 86, attendance: 89 },
  { month: "Jan", performance: 90, attendance: 93 },
];

// Teacher profile
export const teacherProfile = {
  name: "Dr. Sarah Johnson",
  title: "Senior Mathematics Teacher",
  branch: "Main Campus",
  id: "TCH-2018-0042",
  status: "Excellent",
  effectivenessScore: { value: 96.2, note: "Top 1% school-wide" },
  studentFeedback: { value: "4.8/5.0", note: "Based on 234 reviews" },
  classAttendance: { value: "98.5%", note: "Average across classes" },
  studentsTaught: { value: 312, note: "This academic year" },
  performanceTimeline: [
    { month: "Aug", score: 93, branchAvg: 82 },
    { month: "Sep", score: 94, branchAvg: 83 },
    { month: "Oct", score: 95, branchAvg: 84 },
    { month: "Nov", score: 96, branchAvg: 84 },
    { month: "Dec", score: 96, branchAvg: 85 },
    { month: "Jan", score: 96.2, branchAvg: 85 },
  ],
  classes: [
    { name: "Grade 9 - A", status: "Active", students: 32, schedule: "Mon-Fri 9:00 AM", avgScore: "89%", attendance: "97%" },
    { name: "Grade 10 - B", status: "Active", students: 28, schedule: "Mon-Fri 10:30 AM", avgScore: "92%", attendance: "99%" },
    { name: "Grade 11 - A", status: "Active", students: 24, schedule: "Mon-Fri 1:00 PM", avgScore: "94%", attendance: "100%" },
  ],
};

// ==================== ACADEMICS ====================
export const academicsStats = {
  overallPassRate: { value: "94.2%", change: "+1.8% vs last year" },
  averageGPA: { value: 3.42, change: "+0.15 improvement" },
  distinctionRate: { value: "28.6%", change: "+3.2% increase" },
  curriculumCoverage: { value: "87.4%", change: "On track" },
};

export const gradePerformanceMatrix = [
  { subject: "Math", G6: 88, G7: 86, G8: 84, G9: 89, G10: 91, G11: 93, G12: 94 },
  { subject: "Science", G6: 85, G7: 88, G8: 86, G9: 90, G10: 92, G11: 94, G12: 95 },
  { subject: "English", G6: 90, G7: 87, G8: 85, G9: 88, G10: 89, G11: 91, G12: 92 },
  { subject: "History", G6: 82, G7: 84, G8: 83, G9: 86, G10: 87, G11: 89, G12: 90 },
  { subject: "Arts", G6: 78, G7: 80, G8: 82, G9: 84, G10: 85, G11: 87, G12: 88 },
];

export const subjectPerformance = [
  { subject: "Math", main: 90, north: 85, south: 80 },
  { subject: "Science", main: 88, north: 86, south: 82 },
  { subject: "English", main: 92, north: 88, south: 85 },
  { subject: "History", main: 85, north: 82, south: 78 },
  { subject: "Arts", main: 80, north: 78, south: 75 },
];

export const examDistribution = [
  { range: "90-100", count: 680 },
  { range: "80-89", count: 1200 },
  { range: "70-79", count: 1100 },
  { range: "60-69", count: 800 },
  { range: "Below 60", count: 506 },
];

export const learningOutcomeTrends = [
  { month: "Aug", score: 78, target: 85 },
  { month: "Sep", score: 80, target: 85 },
  { month: "Oct", score: 82, target: 85 },
  { month: "Nov", score: 84, target: 85 },
  { month: "Dec", score: 86, target: 85 },
  { month: "Jan", score: 87, target: 85 },
];

// ==================== FINANCE ====================
export const financeStats = {
  totalRevenue: { value: "$2.84M", change: "+8.4% vs last term" },
  collectionRate: { value: "94.2%", change: "+1.8% improvement" },
  outstanding: { value: "$168K", change: "5.9% of total" },
  defaulters: { value: 142, change: "3.3% of students" },
};

export const branchRevenue = [
  { branch: "Main", revenue: 1400 },
  { branch: "North", revenue: 890 },
  { branch: "South", revenue: 520 },
];

export const monthlyCollection = [
  { month: "Aug", amount: 380 },
  { month: "Sep", amount: 420 },
  { month: "Oct", amount: 450 },
  { month: "Nov", amount: 480 },
  { month: "Dec", amount: 510 },
  { month: "Jan", amount: 540 },
];

export const paymentModes = [
  { name: "Online", value: 45, fill: "hsl(220, 70%, 30%)" },
  { name: "Bank Transfer", value: 25, fill: "hsl(210, 100%, 50%)" },
  { name: "Cash", value: 15, fill: "hsl(210, 60%, 70%)" },
  { name: "Cheque", value: 15, fill: "hsl(210, 40%, 85%)" },
];

export const recentTransactions = [
  { date: "Jan 15, 2025", student: "Aarav Sharma", branch: "Main Campus", amount: "$1,200", mode: "Online", status: "Paid" as const },
  { date: "Jan 14, 2025", student: "Priya Kumar", branch: "North Branch", amount: "$1,150", mode: "Bank Transfer", status: "Paid" as const },
  { date: "Jan 14, 2025", student: "Rahul Verma", branch: "South Branch", amount: "$1,100", mode: "Cash", status: "Pending" as const },
  { date: "Jan 13, 2025", student: "Sneha Patel", branch: "Main Campus", amount: "$1,200", mode: "Online", status: "Paid" as const },
  { date: "Jan 12, 2025", student: "Amit Mishra", branch: "North Branch", amount: "$1,050", mode: "Cheque", status: "Paid" as const },
];

export const defaultersList = [
  { name: "Rahul Verma", branch: "South Branch", amountDue: "$2,400", daysOverdue: 78, lastReminder: "Jan 10, 2025", status: "Critical" as const },
  { name: "Anita Kumar", branch: "North Branch", amountDue: "$1,800", daysOverdue: 45, lastReminder: "Jan 12, 2025", status: "Warning" as const },
  { name: "Mohit Singh", branch: "Main Campus", amountDue: "$1,200", daysOverdue: 32, lastReminder: "Jan 14, 2025", status: "Warning" as const },
];

export const defaulterStats = {
  totalDefaulters: { value: 142 },
  critical: { value: 28 },
  reminderSent: { value: 98 },
  outstanding: { value: "$168K" },
  atRisk: { value: "$52K" },
  pending: { value: 44 },
};

// ==================== RISKS & ALERTS ====================
export const risksStats = {
  activeAlerts: { value: 12, change: "+3 since yesterday" },
  critical: { value: 4, change: "Immediate action" },
  warning: { value: 6, change: "Monitor closely" },
  resolved: { value: 28, change: "92% resolution rate" },
};

export const riskTrend = [
  { week: "W1", critical: 2, warning: 4 },
  { week: "W2", critical: 3, warning: 5 },
  { week: "W3", critical: 3, warning: 4 },
  { week: "W4", critical: 4, warning: 6 },
];

export const branchRisk = [
  { branch: "Main", critical: 1, warning: 2 },
  { branch: "North", critical: 2, warning: 2 },
  { branch: "South", critical: 1, warning: 2 },
];

export const activeAlertsList = [
  {
    id: "RA-2025-0142",
    title: "Attendance Drop - Grade 8 North",
    severity: "Critical" as const,
    description: "Average attendance dropped to 78% • 42 students affected • Started 5 days ago",
  },
  {
    id: "RA-2025-0143",
    title: "Fee Defaulters Exceeding 60 Days",
    severity: "Critical" as const,
    description: "28 students • $52K outstanding • South Branch most affected",
  },
];

export const alertDetail = {
  id: "RA-2025-0142",
  title: "Attendance Drop - Grade 8 North",
  severity: "Critical" as const,
  detectedOn: "Jan 10, 2025",
  branch: "North Branch",
  grade: "Grade 8",
  currentAttendance: { value: "78%", change: "↓ 12% from baseline (90%)" },
  studentsAffected: { value: 42, note: "Out of 48 total" },
  duration: { value: "5 days", note: "Since Jan 10, 2025" },
  description: "Significant attendance decline detected in Grade 8 at North Branch. Pattern analysis shows consistent drop across all sections, with Monday and Friday showing highest absence rates. Preliminary investigation suggests transportation issues and seasonal illness as potential causes.",
  attendanceTrend: [
    { day: "Jan 6", attendance: 92 },
    { day: "Jan 7", attendance: 90 },
    { day: "Jan 8", attendance: 85 },
    { day: "Jan 9", attendance: 82 },
    { day: "Jan 10", attendance: 78 },
    { day: "Jan 11", attendance: 76 },
    { day: "Jan 12", attendance: 78 },
  ],
  affectedStudents: [
    { name: "Rahul Verma", initials: "RV", attendance: "68%" },
    { name: "Anita Kumar", initials: "AK", attendance: "72%" },
    { name: "Sanjay Patel", initials: "SP", attendance: "65%" },
    { name: "Neha Gupta", initials: "NG", attendance: "74%" },
  ],
  recommendations: [
    { text: "Contact parents of students with <70% attendance", priority: "High", time: "2 hours" },
    { text: "Investigate transportation issues with bus coordinator", priority: "Medium", time: "1 day" },
  ],
  historicalAlerts: [
    { alert: "Grade 7 Attendance Drop", date: "Nov 2024", status: "Resolved" },
    { alert: "Grade 9 Absenteeism", date: "Sep 2024", status: "Resolved" },
  ],
};

// ==================== BRANCHES COMPARISON ====================
export const branchComparison = [
  { name: "Main Campus", students: 2145, ahi: 92, feeCollection: 96, passRate: 96, attendance: 94 },
  { name: "North Branch", students: 1203, ahi: 88, feeCollection: 94, passRate: 93, attendance: 92 },
  { name: "South Branch", students: 938, ahi: 81, feeCollection: 91, passRate: 90, attendance: 88 },
];

export const performanceRanking = [
  { metric: "Attendance", main: 94, north: 92, south: 88 },
  { metric: "Pass Rate", main: 96, north: 93, south: 90 },
  { metric: "Fee Collection", main: 96, north: 94, south: 91 },
  { metric: "AHI", main: 92, north: 88, south: 81 },
];

export const comparativeTrends = [
  { month: "Aug", main: 88, north: 85, south: 78 },
  { month: "Sep", main: 90, north: 86, south: 79 },
  { month: "Oct", main: 91, north: 87, south: 80 },
  { month: "Nov", main: 92, north: 88, south: 81 },
  { month: "Dec", main: 91, north: 87, south: 80 },
  { month: "Jan", main: 92, north: 88, south: 81 },
];

export const branchDetail = {
  name: "South Branch",
  students: 938,
  teachers: 52,
  established: 2019,
  ahi: 81,
  feeCollection: 91,
  passRate: 90,
  activeAlerts: 5,
  historicalPerformance: [
    { year: "2021", score: 74, schoolAvg: 82 },
    { year: "2022", score: 76, schoolAvg: 84 },
    { year: "2023", score: 78, schoolAvg: 86 },
    { year: "2024", score: 80, schoolAvg: 87 },
    { year: "2025", score: 81, schoolAvg: 88 },
  ],
  strengths: [
    "Strong extracurricular participation (85%)",
    "Good parent engagement scores (4.2/5)",
    "Modern facilities & infrastructure",
    "Low teacher turnover rate (8%)",
  ],
  improvements: [
    "Mathematics performance below average",
    "Attendance rate needs improvement (88%)",
    "Fee collection below target",
    "Higher disciplinary incidents",
  ],
};

// ==================== REPORTS ====================
export const reportStats = {
  totalReports: { value: 48, note: "12 categories" },
  scheduled: { value: 8, note: "Auto-generated" },
  recentDownloads: { value: 24, note: "Last 7 days" },
  favorites: { value: 6, note: "Quick access" },
};

export const reportCategories = {
  student: ["Enrollment Summary", "Attendance Analysis", "Performance Report", "At-Risk Students"],
  teacher: ["Performance Evaluation", "Workload Analysis", "Feedback Summary", "Training Needs"],
  financial: ["Revenue Summary", "Fee Collection", "Outstanding Report", "Expense Analysis"],
};

export const scheduledReports = [
  { name: "Weekly Executive Summary", frequency: "Every Monday", nextRun: "Jan 20, 2025", recipients: 3, status: "Active" },
  { name: "Monthly Financial Report", frequency: "1st of Month", nextRun: "Feb 1, 2025", recipients: 5, status: "Active" },
];

export const enrollmentReport = {
  id: "RPT-2025-0084",
  generatedOn: "Jan 15, 2025",
  totalEnrollment: 4286,
  newAdmissions: 342,
  withdrawals: 86,
  netGrowth: 256,
  enrollmentByGrade: [
    { grade: "G6", enrollment: 700 },
    { grade: "G7", enrollment: 680 },
    { grade: "G8", enrollment: 720 },
    { grade: "G9", enrollment: 650 },
    { grade: "G10", enrollment: 620 },
    { grade: "G11", enrollment: 580 },
    { grade: "G12", enrollment: 540 },
  ],
  enrollmentTrend: [
    { year: "2021", enrollment: 3200 },
    { year: "2022", enrollment: 3500 },
    { year: "2023", enrollment: 3800 },
    { year: "2024", enrollment: 4100 },
    { year: "2025", enrollment: 4286 },
  ],
  summary: "This report provides a comprehensive overview of student enrollment across all branches for the current academic term. Total enrollment stands at 4,286 students, representing a net growth of 256 students (+6.4%) compared to the previous term. Main Campus continues to lead with 2,145 students, followed by North Branch (1,203) and South Branch (938).",
};

// ==================== SETTINGS ====================
export const settingsData = {
  profile: {
    name: "School Chairman",
    email: "chairman@eduintellect.edu",
    initials: "SC",
  },
  notifications: {
    criticalAlerts: "Immediate email & SMS",
    dailySummary: "Email at 8:00 AM",
    weeklyReports: "Every Monday",
    marketingUpdates: true,
  },
  preferences: {
    timezone: "Asia/Kolkata (IST)",
    dateFormat: "DD/MM/YYYY",
    currency: "INR (₹)",
    language: "English",
  },
};
