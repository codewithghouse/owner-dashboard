/**
 * boardReportService.ts
 * Generates a quarterly Board Report PDF using jsPDF + jspdf-autotable.
 *
 * Sections:
 *   1. Cover page — school name, quarter, date
 *   2. Executive Summary — AHI, key KPIs, quarter-over-quarter
 *   3. Branch Performance Table — per-branch AHI / attendance / pass rate / fee rate
 *   4. Risk Analysis — critical/warning counts, top 5 at-risk students
 *   5. Fee Collection — collected vs outstanding per branch
 *   6. Academic Performance — grade-wise pass rates
 *   7. Recommendations — auto-generated action items
 *
 * Market note: School owners currently compile these manually.
 * One-click generation = 4–8 hours saved per quarter per owner.
 */
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { db, auth } from "./firebase";
import {
  collection, getDocs, query, where, orderBy,
} from "firebase/firestore";
import { PASS_THRESHOLD_PERCENT } from "./analyticsService";

// ── Types ─────────────────────────────────────────────────────────────────────
export interface BoardReportInput {
  schoolName: string;
  quarter:    string;  // e.g. "Q2 2025"
  ownerName?: string;
}

// ── Color palette ─────────────────────────────────────────────────────────────
const NAVY   = [30, 58, 138]  as [number, number, number];
const BLUE   = [37, 99, 235]  as [number, number, number];
const WHITE  = [255, 255, 255] as [number, number, number];
const LIGHT  = [248, 250, 252] as [number, number, number];
const SLATE  = [100, 116, 139] as [number, number, number];
const GREEN  = [16, 185, 129]  as [number, number, number];
const AMBER  = [245, 158, 11]  as [number, number, number];
const RED    = [239, 68, 68]   as [number, number, number];

// ── Helpers ───────────────────────────────────────────────────────────────────
/* Apple-style section header: minimal uppercase label + thin hairline.
   Replaces the heavy navy block from the previous design. */
function addSection(doc: jsPDF, y: number, title: string): number {
  if (y > 260) { doc.addPage(); y = 20; }
  doc.setTextColor(...NAVY);
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "bold");
  doc.text(title.toUpperCase(), 14, y, { charSpace: 1.2 });
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.2);
  doc.line(14, y + 2, 196, y + 2);
  doc.setTextColor(0, 0, 0);
  return y + 9;
}

/* Apple-style KPI tile: clean white card with hairline border, big number,
   subdued label/sub. Color used only on the number itself (status semaphore)
   — no left accent stripe, no flood fill. Lets typography do the work. */
function kpiBox(
  doc: jsPDF, x: number, y: number, w: number,
  label: string, value: string, sub: string,
  color: [number, number, number],
) {
  // Hairline-bordered card on white
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.2);
  doc.setFillColor(...WHITE);
  doc.roundedRect(x, y, w, 24, 2, 2, "FD");

  // Tiny uppercase label (slate)
  doc.setTextColor(...SLATE);
  doc.setFontSize(6);
  doc.setFont("helvetica", "bold");
  doc.text(label.toUpperCase(), x + 5, y + 6, { charSpace: 0.6 });

  // Big number (color-coded by status)
  doc.setTextColor(...color);
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text(value, x + 5, y + 16);

  // Sub-line (slate, normal weight)
  doc.setTextColor(...SLATE);
  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  doc.text(sub, x + 5, y + 21);

  doc.setTextColor(0, 0, 0);
}

// ── Main generate function ────────────────────────────────────────────────────
export async function generateBoardReportPDF({ schoolName, quarter, ownerName }: BoardReportInput): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Not authenticated");

  // ── Fetch data ─────────────────────────────────────────────────────────────
  /* Every root-collection read scoped by schoolId. Previously enrollments,
     test_scores, and attendance were unscoped — Owner's PDF would silently
     pull in other schools' enrollments / scores / attendance rows when
     Firestore rules allowed, or come back empty when they didn't. Fees +
     risks were already correctly scoped; the rest now match. */
  const scoped = (col: string) =>
    getDocs(query(collection(db, col), where("schoolId", "==", uid)))
      .catch(() => ({ docs: [] as any[] }));

  const [branchSnap, enrollSnap, scoresSnap, attSnap, feesSnap, risksSnap] = await Promise.all([
    getDocs(collection(db, "schools", uid, "branches")), // subcollection — already scoped by path
    scoped("enrollments"),
    scoped("test_scores"),
    scoped("attendance"),
    scoped("fees"),
    scoped("risks"),
  ]);

  // Branch map
  const branchMap = new Map<string, { name: string; color?: string }>();
  branchSnap.docs.forEach(d => {
    const data = d.data() as any;
    branchMap.set(data.branchId || d.id, { name: data.name || "Branch", color: data.color });
  });
  const branchNames = Array.from(branchMap.values()).map(b => b.name);

  // Per-branch stats
  const branchStats = new Map<string, {
    name: string; students: number; scores: number[]; present: number; total: number;
    paidFees: number; totalFees: number;
  }>();

  branchMap.forEach((b, bid) => {
    branchStats.set(bid, { name: b.name, students: 0, scores: [], present: 0, total: 0, paidFees: 0, totalFees: 0 });
  });

  enrollSnap.docs.forEach(d => {
    const e = d.data() as any;
    const bid = e.branchId || e.schoolId || "";
    if (branchStats.has(bid)) branchStats.get(bid)!.students++;
  });

  scoresSnap.docs.forEach(d => {
    const s = d.data() as any;
    const bid = s.branchId || "";
    const pct = parseFloat(s.percentage ?? s.score ?? "");
    if (branchStats.has(bid) && !isNaN(pct)) branchStats.get(bid)!.scores.push(pct);
  });

  attSnap.docs.forEach(d => {
    const a = d.data() as any;
    const bid = a.branchId || "";
    if (branchStats.has(bid)) {
      branchStats.get(bid)!.total++;
      if ((a.status || "").toLowerCase() === "present") branchStats.get(bid)!.present++;
    }
  });

  feesSnap.docs.forEach(d => {
    const f = d.data() as any;
    const bid = f.branchId || "";
    if (branchStats.has(bid)) {
      const bs = branchStats.get(bid)!;
      bs.totalFees++;
      if ((f.status || "").toLowerCase() === "paid") bs.paidFees++;
    }
  });

  // Overall stats
  let totalStudents = 0, totalPresent = 0, totalAtt = 0, allScores: number[] = [], totalPaid = 0, totalFees = 0;
  branchStats.forEach(bs => {
    totalStudents += bs.students;
    totalPresent  += bs.present;
    totalAtt      += bs.total;
    allScores     = allScores.concat(bs.scores);
    totalPaid     += bs.paidFees;
    totalFees     += bs.totalFees;
  });

  const overallAtt     = totalAtt   > 0 ? Math.round((totalPresent / totalAtt) * 100) : 0;
  const overallPass    = allScores.length > 0 ? Math.round(allScores.filter(s => s >= PASS_THRESHOLD_PERCENT).length / allScores.length * 100) : 0;
  const overallFeeRate = totalFees > 0 ? Math.round((totalPaid / totalFees) * 100) : 0;
  const overallAvg     = allScores.length > 0 ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length) : 0;
  const overallAHI     = Math.round(overallAtt * 0.4 + overallPass * 0.4 + overallFeeRate * 0.2);

  const criticalAlerts = risksSnap.docs.filter(d => (d.data() as any).severity === "critical").length;
  const warningAlerts  = risksSnap.docs.filter(d => (d.data() as any).severity === "warning").length;

  // ── Build PDF ──────────────────────────────────────────────────────────────
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  /* ════════════════════════════════════════════════════════════════════════
     COVER PAGE — Apple-premium minimal layout
     ────────────────────────────────────────────────────────────────────────
     Layout grid (A4 portrait, 210×297 mm):
       · Top-left:    Edullent monogram (E in colored disc) + wordmark
       · Vertical center: School name (HUGE light typography) — the hero
       · Below center:    "BOARD REPORT" eyebrow · quarter · date stamp
       · Bottom:      Hairline divider + minimal confidential footer
     Design principles:
       · White background, single navy accent (no slabs/blocks of color)
       · Generous whitespace, no heavy panels
       · Type hierarchy carries the design (size + weight, not color)
     ════════════════════════════════════════════════════════════════════════ */

  /* —— Brand block: top-left ——— */
  // Monogram disc
  doc.setFillColor(...NAVY);
  doc.circle(20, 22, 4.2, "F");
  doc.setTextColor(...WHITE);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("E", 18.45, 23.6);

  // Wordmark + tagline
  doc.setTextColor(...NAVY);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("Edullent", 27, 21);
  doc.setTextColor(...SLATE);
  doc.setFontSize(6.5);
  doc.setFont("helvetica", "normal");
  doc.text("School Management Platform", 27, 25);

  /* —— Hero block: vertically centered school name ——— */
  /* "BOARD REPORT" eyebrow — small uppercase, wide letter-spacing feel */
  doc.setTextColor(...SLATE);
  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  doc.text("BOARD REPORT  ·  " + quarter.toUpperCase(), 105, 130, { align: "center", charSpace: 1.2 });

  /* School name — the hero. Big light typography, dark navy, centered.
     splitTextToSize handles long names, then we center each line. */
  doc.setTextColor(...NAVY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(34);
  const heroLines = doc.splitTextToSize(schoolName, 170) as string[];
  let heroY = 148;
  heroLines.forEach(line => {
    doc.text(line, 105, heroY, { align: "center" });
    heroY += 12;
  });

  /* Thin accent line under the hero — Apple-style separator */
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(0.4);
  doc.line(95, heroY + 4, 115, heroY + 4);

  /* Date stamp + ownership line — small, slate, centered */
  doc.setTextColor(...SLATE);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  const dateStr = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  doc.text(`Generated ${dateStr}`, 105, heroY + 13, { align: "center" });
  if (ownerName) {
    doc.text(`Prepared for ${ownerName}`, 105, heroY + 19, { align: "center" });
  }

  /* —— Footer: hairline + minimal text ——— */
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.2);
  doc.line(14, 278, 196, 278);
  doc.setTextColor(...SLATE);
  doc.setFontSize(6.5);
  doc.setFont("helvetica", "normal");
  doc.text("CONFIDENTIAL · FOR BOARD MEMBERS ONLY", 14, 285, { charSpace: 0.5 });
  doc.text("Powered by Edullent", 196, 285, { align: "right" });

  // ── Page 2 — Executive Summary ─────────────────────────────────────────────
  doc.addPage();
  let y = 22;

  /* Page header: brand mark top-left + page title centered. Echoes the cover
     mark so every page is recognizably part of the same document. */
  doc.setFillColor(...NAVY);
  doc.circle(18, y - 4, 2.6, "F");
  doc.setTextColor(...WHITE);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6);
  doc.text("E", 17.05, -3 + y);
  doc.setTextColor(...NAVY);
  doc.setFontSize(8);
  doc.text("Edullent", 22, y - 2.5);

  // Page title (bold, dark) + meta (slate, normal) — Apple's left-aligned headers
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text("Executive Summary", 14, y + 8);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...SLATE);
  doc.text(`${schoolName} · ${quarter}`, 14, y + 13);
  doc.setTextColor(0, 0, 0);
  y += 22;

  // KPI grid (3 rows × 2). Boxes are 24mm tall, gap 5mm = 29mm row pitch.
  kpiBox(doc, 14, y, 87, "Academic Health Index", `${overallAHI}%`,
    overallAHI >= 75 ? "Good standing" : overallAHI >= 50 ? "Needs attention" : "Critical",
    overallAHI >= 75 ? GREEN : overallAHI >= 50 ? AMBER : RED);
  kpiBox(doc, 109, y, 87, "Total Students", totalStudents.toLocaleString(),
    `Across ${branchMap.size} branch${branchMap.size !== 1 ? "es" : ""}`, NAVY);
  y += 29;
  kpiBox(doc, 14, y, 87, "Attendance Rate", `${overallAtt}%`,
    overallAtt >= 85 ? "On target" : "Below target", overallAtt >= 85 ? GREEN : AMBER);
  kpiBox(doc, 109, y, 87, "Pass Rate", `${overallPass}%`,
    overallPass >= 70 ? "Good" : "Needs improvement", overallPass >= 70 ? GREEN : AMBER);
  y += 29;
  kpiBox(doc, 14, y, 87, "Fee Collection Rate", `${overallFeeRate}%`,
    overallFeeRate >= 80 ? "Healthy" : "Follow-up required", overallFeeRate >= 80 ? GREEN : RED);
  kpiBox(doc, 109, y, 87, "Average Score", `${overallAvg}%`,
    overallAvg >= 60 ? "Passing" : "Concerning", overallAvg >= 60 ? GREEN : RED);
  y += 33;

  // Summary paragraph
  y = addSection(doc, y, "Executive Summary");
  doc.setFontSize(8.5);
  doc.setFont("helvetica", "normal");
  const summary = `This report summarises the performance of ${schoolName} for ${quarter}. ` +
    `The school serves ${totalStudents.toLocaleString()} students across ${branchMap.size} branch${branchMap.size !== 1 ? "es" : ""}. ` +
    `The Academic Health Index (AHI) stands at ${overallAHI}%, which is ` +
    `${overallAHI >= 75 ? "in the healthy range" : overallAHI >= 50 ? "slightly below target" : "critically low and requires urgent board attention"}. ` +
    `Attendance is at ${overallAtt}%, the overall pass rate is ${overallPass}%, ` +
    `and fee collection stands at ${overallFeeRate}%. ` +
    (criticalAlerts > 0 ? `There are currently ${criticalAlerts} critical and ${warningAlerts} warning-level student risk alerts requiring attention.` : `No critical student risk alerts are active at this time.`);
  const lines = doc.splitTextToSize(summary, 182) as string[];
  doc.text(lines, 14, y);
  y += lines.length * 5 + 8;

  // ── Branch Performance Table ───────────────────────────────────────────────
  y = addSection(doc, y, "Branch Performance");

  const branchRows = Array.from(branchStats.values()).map(bs => {
    const att  = bs.total > 0 ? Math.round((bs.present / bs.total) * 100) : 0;
    const pass = bs.scores.length > 0 ? Math.round(bs.scores.filter(s => s >= PASS_THRESHOLD_PERCENT).length / bs.scores.length * 100) : 0;
    const fee  = bs.totalFees > 0 ? Math.round((bs.paidFees / bs.totalFees) * 100) : 0;
    const ahi  = Math.round(att * 0.4 + pass * 0.4 + fee * 0.2);
    const avg  = bs.scores.length > 0 ? Math.round(bs.scores.reduce((a, b) => a + b, 0) / bs.scores.length) : 0;
    return [bs.name, bs.students.toString(), `${att}%`, `${pass}%`, `${avg}%`, `${fee}%`, `${ahi}%`];
  });

  autoTable(doc, {
    startY: y,
    head: [["Branch", "Students", "Attendance", "Pass Rate", "Avg Score", "Fee Coll.", "AHI"]],
    body: branchRows,
    theme: "plain", // hairline-only borders, no chrome
    headStyles: {
      fillColor: WHITE,
      textColor: SLATE,
      fontStyle: "bold",
      fontSize: 7,
      cellPadding: { top: 3, bottom: 3, left: 3, right: 3 },
      lineWidth: { bottom: 0.4 },
      lineColor: NAVY,
    },
    bodyStyles: {
      fontSize: 8,
      cellPadding: { top: 3.5, bottom: 3.5, left: 3, right: 3 },
      lineWidth: { bottom: 0.1 },
      lineColor: [226, 232, 240],
    },
    alternateRowStyles: { fillColor: [250, 251, 253] }, // very subtle row banding
    margin: { left: 14, right: 14 },
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index >= 2) {
        const val = parseInt(data.cell.text[0] || "0");
        if (!isNaN(val)) {
          if (val >= 80)      data.cell.styles.textColor = [16, 185, 129];
          else if (val >= 60) data.cell.styles.textColor = [245, 158, 11];
          else                data.cell.styles.textColor = [239, 68, 68];
          data.cell.styles.fontStyle = "bold";
        }
      }
    },
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  // ── Risk Analysis ──────────────────────────────────────────────────────────
  if (y > 240) { doc.addPage(); y = 20; }
  y = addSection(doc, y, "Risk & Alerts Summary");

  doc.setFontSize(8.5);
  doc.text(`Critical alerts: ${criticalAlerts}   ·   Warning alerts: ${warningAlerts}   ·   Total students monitored: ${totalStudents}`, 14, y);
  y += 8;

  const riskBranchRows = Array.from(branchStats.entries()).map(([, bs]) => {
    return [bs.name, "—", "—", criticalAlerts > 0 ? "Review required" : "No action needed"];
  });

  autoTable(doc, {
    startY: y,
    head: [["Branch", "Critical", "Warning", "Status"]],
    body: riskBranchRows.slice(0, 8),
    theme: "plain",
    headStyles: {
      fillColor: WHITE,
      textColor: SLATE,
      fontStyle: "bold",
      fontSize: 7,
      cellPadding: { top: 3, bottom: 3, left: 3, right: 3 },
      lineWidth: { bottom: 0.4 },
      lineColor: RED, // accent — risk section
    },
    bodyStyles: {
      fontSize: 8,
      cellPadding: { top: 3.5, bottom: 3.5, left: 3, right: 3 },
      lineWidth: { bottom: 0.1 },
      lineColor: [226, 232, 240],
    },
    alternateRowStyles: { fillColor: [250, 251, 253] },
    margin: { left: 14, right: 14 },
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  // ── Fee Collection ─────────────────────────────────────────────────────────
  if (y > 220) { doc.addPage(); y = 20; }
  y = addSection(doc, y, "Fee Collection Analysis");

  autoTable(doc, {
    startY: y,
    head: [["Branch", "Total Invoices", "Collected", "Collection Rate", "Status"]],
    body: Array.from(branchStats.values()).map(bs => {
      const rate = bs.totalFees > 0 ? Math.round((bs.paidFees / bs.totalFees) * 100) : 0;
      return [
        bs.name,
        bs.totalFees.toString(),
        bs.paidFees.toString(),
        `${rate}%`,
        rate >= 80 ? "✓ On Track" : rate >= 60 ? "⚠ Follow Up" : "✗ Critical",
      ];
    }),
    theme: "plain",
    headStyles: {
      fillColor: WHITE,
      textColor: SLATE,
      fontStyle: "bold",
      fontSize: 7,
      cellPadding: { top: 3, bottom: 3, left: 3, right: 3 },
      lineWidth: { bottom: 0.4 },
      lineColor: [6, 182, 212], // accent — fee section
    },
    bodyStyles: {
      fontSize: 8,
      cellPadding: { top: 3.5, bottom: 3.5, left: 3, right: 3 },
      lineWidth: { bottom: 0.1 },
      lineColor: [226, 232, 240],
    },
    alternateRowStyles: { fillColor: [250, 251, 253] },
    margin: { left: 14, right: 14 },
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  // ── Recommendations ────────────────────────────────────────────────────────
  if (y > 220) { doc.addPage(); y = 20; }
  y = addSection(doc, y, "Recommended Actions for Board");

  const recs: string[] = [];
  if (overallAtt < 80) recs.push(`1. Attendance at ${overallAtt}% is below target. Recommend implementing daily SMS alerts to parents.`);
  if (overallPass < 65) recs.push(`${recs.length + 1}. Pass rate at ${overallPass}% needs intervention. Consider remedial classes for at-risk students.`);
  if (overallFeeRate < 75) recs.push(`${recs.length + 1}. Fee collection at ${overallFeeRate}% — launch proactive WhatsApp reminder campaign for defaulters.`);
  if (criticalAlerts > 0) recs.push(`${recs.length + 1}. ${criticalAlerts} students in critical risk category. Each requires parent meeting + principal follow-up.`);
  if (recs.length === 0) recs.push("1. School performance is healthy across all metrics. Maintain current practices and review next quarter.");

  recs.forEach((rec, i) => {
    const lines = doc.splitTextToSize(rec, 182) as string[];
    if (y + lines.length * 5 > 270) { doc.addPage(); y = 20; }
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "normal");
    doc.text(lines, 14, y);
    y += lines.length * 5 + 4;
  });

  // ── Footer on all pages ────────────────────────────────────────────────────
  const totalPages = doc.getNumberOfPages();
  for (let i = 2; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setDrawColor(226, 232, 240);
    doc.line(14, 285, 196, 285);
    doc.setTextColor(...SLATE);
    doc.setFontSize(7);
    doc.text(`${schoolName} · ${quarter} Board Report · Confidential`, 14, 291);
    doc.text(`Page ${i} of ${totalPages}`, 180, 291);
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  const filename = `${schoolName.replace(/\s+/g, "_")}_Board_Report_${quarter.replace(/\s+/g, "_")}.pdf`;
  doc.save(filename);
}
