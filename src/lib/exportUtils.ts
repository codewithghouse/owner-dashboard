/**
 * exportUtils.ts
 * PDF (jsPDF) + Excel (SheetJS) + CSV + Email export for Reports Center.
 */
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { logReportDownload } from "./reportsService";
import { auth } from "./firebase";

type ExportPayload = {
  title: string;
  reportId: string;
  generatedOn: string;
  summary: string;
  stats: { label: string; value: string }[];
  tableHeaders?: string[];
  tableRows?: string[][];
};

// ── PDF Export ─────────────────────────────────────────────────────────────────

export function exportPDF(payload: ExportPayload): void {
  const doc = new jsPDF();

  // Header
  doc.setFillColor(30, 58, 138); // #1e3a8a
  doc.rect(0, 0, 210, 32, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text("EDULLENT", 14, 15);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(payload.title, 14, 24);
  doc.text(`Report ID: ${payload.reportId} | Generated: ${payload.generatedOn}`, 210 - 14, 24, { align: "right" });

  // Stats cards
  let y = 42;
  doc.setTextColor(17, 24, 39);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("Key Metrics", 14, y);
  y += 8;

  const cardW = 44;
  payload.stats.forEach((stat, i) => {
    const x = 14 + i * (cardW + 4);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(x, y, cardW, 22, 2, 2, "S");
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.setFont("helvetica", "normal");
    doc.text(stat.label, x + 4, y + 8);
    doc.setFontSize(14);
    doc.setTextColor(17, 24, 39);
    doc.setFont("helvetica", "bold");
    doc.text(stat.value, x + 4, y + 18);
  });

  y += 32;

  // Summary
  doc.setFontSize(11);
  doc.setTextColor(17, 24, 39);
  doc.setFont("helvetica", "bold");
  doc.text("Report Summary", 14, y);
  y += 6;
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(71, 85, 105);
  const summaryLines = doc.splitTextToSize(payload.summary, 182);
  doc.text(summaryLines, 14, y);
  y += summaryLines.length * 5 + 8;

  // Table
  if (payload.tableHeaders && payload.tableRows && payload.tableRows.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [payload.tableHeaders],
      body: payload.tableRows,
      margin: { left: 14, right: 14 },
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: {
        fillColor: [30, 58, 138],
        textColor: 255,
        fontStyle: "bold",
        fontSize: 8,
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
    });
  }

  // Footer
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `EDULLENT Reports Center | Page ${i} of ${pageCount}`,
      105, 290, { align: "center" }
    );
  }

  doc.save(`${payload.title.replace(/\s+/g, "_")}_${payload.reportId}.pdf`);
  logReportDownload(payload.title, "pdf");
}

// ── Excel Export ───────────────────────────────────────────────────────────────

export function exportExcel(payload: ExportPayload): void {
  const wb = XLSX.utils.book_new();

  // Summary sheet
  const summaryData = [
    ["EDULLENT - " + payload.title],
    ["Report ID", payload.reportId],
    ["Generated", payload.generatedOn],
    [""],
    ...payload.stats.map(s => [s.label, s.value]),
    [""],
    ["Summary"],
    [payload.summary],
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(summaryData);
  ws1["!cols"] = [{ wch: 25 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, ws1, "Summary");

  // Data sheet
  if (payload.tableHeaders && payload.tableRows) {
    const ws2 = XLSX.utils.aoa_to_sheet([payload.tableHeaders, ...payload.tableRows]);
    ws2["!cols"] = payload.tableHeaders.map(() => ({ wch: 18 }));
    XLSX.utils.book_append_sheet(wb, ws2, "Data");
  }

  XLSX.writeFile(wb, `${payload.title.replace(/\s+/g, "_")}_${payload.reportId}.xlsx`);
  logReportDownload(payload.title, "excel");
}

// ── CSV Export ─────────────────────────────────────────────────────────────────

export function exportCSV(payload: ExportPayload): void {
  const lines: string[] = [];

  // Header
  lines.push(`"EDULLENT - ${payload.title}"`);
  lines.push(`"Report ID","${payload.reportId}"`);
  lines.push(`"Generated","${payload.generatedOn}"`);
  lines.push("");

  // Stats
  payload.stats.forEach(s => lines.push(`"${s.label}","${s.value}"`));
  lines.push("");

  // Table
  if (payload.tableHeaders && payload.tableRows) {
    lines.push(payload.tableHeaders.map(h => `"${h}"`).join(","));
    payload.tableRows.forEach(row => {
      lines.push(row.map(c => `"${c}"`).join(","));
    });
  }

  // Summary
  lines.push("");
  lines.push(`"Summary"`);
  lines.push(`"${payload.summary.replace(/"/g, '""')}"`);

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${payload.title.replace(/\s+/g, "_")}_${payload.reportId}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
  logReportDownload(payload.title, "csv");
}

// ── Email Export ───────────────────────────────────────────────────────────────

export async function exportEmail(payload: ExportPayload): Promise<{ success: boolean; message: string }> {
  logReportDownload(payload.title, "email");

  const ownerEmail = auth.currentUser?.email;
  const emailBody = `${payload.title}\nReport ID: ${payload.reportId}\nGenerated: ${payload.generatedOn}\n\n${payload.summary}`;

  // Fallback helper — uses <a> anchor trick to avoid popup-blocker on mailto
  const mailtoFallback = () => {
    const subject = encodeURIComponent(`[EDULLENT] ${payload.title}`);
    const body = encodeURIComponent(emailBody);
    const a = document.createElement("a");
    a.href = `mailto:${ownerEmail ?? ""}?subject=${subject}&body=${body}`;
    a.click();
    return { success: true, message: "Email client opened with report content" };
  };

  if (!ownerEmail) {
    // Not logged in — fall back to mailto
    return mailtoFallback();
  }

  try {
    const idToken = await auth.currentUser?.getIdToken();
    const response = await fetch("/api/send-email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      body: JSON.stringify({
        type: "report",
        to: ownerEmail,
        subject: `[EDULLENT] ${payload.title} – ${payload.reportId}`,
        body: emailBody,
        reportId: payload.reportId,
      }),
    });

    if (response.ok) {
      return { success: true, message: `Report emailed to ${ownerEmail}` };
    }

    // API responded but with error — try to parse message
    let errMsg = "Email API returned an error.";
    try {
      const errData = await response.json();
      errMsg = errData.message || errData.error || errMsg;
    } catch { /* ignore parse error */ }

    // Fall back to mailto so user isn't left empty-handed
    mailtoFallback();
    return { success: false, message: `${errMsg} Email client opened as fallback.` };

  } catch {
    // Network error (e.g. local dev without vercel dev) — fall back to mailto
    return mailtoFallback();
  }
}

// ── Print ──────────────────────────────────────────────────────────────────────

export function printReport(): void {
  window.print();
}
