"use client";

import { exportDetailsCsv, exportSummaryCsv } from "@/lib/export/csv";
import { exportReportHtml } from "@/lib/export/html";
import { exportReportJson } from "@/lib/export/json";
import type { PresenceReport } from "@/lib/export/types";
import { Download } from "lucide-react";

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url);
}

export function ExportMenu({ report }: { report: PresenceReport }) {
  const items: Array<[string, () => void]> = [
    ["presence_summary.csv", () => download("presence_summary.csv", exportSummaryCsv(report.classMetrics), "text/csv;charset=utf-8")],
    ["presence_details.csv", () => download("presence_details.csv", exportDetailsCsv(report.sampleResults), "text/csv;charset=utf-8")],
    ["presence_report.json", () => download("presence_report.json", exportReportJson(report), "application/json;charset=utf-8")],
    ["presence_report.html", () => download("presence_report.html", exportReportHtml(report), "text/html;charset=utf-8")],
    ["thresholds.json", () => download("thresholds.json", JSON.stringify(report.thresholds, null, 2), "application/json;charset=utf-8")],
  ];
  return <section className="panel flex flex-wrap items-center justify-between gap-4 p-5"><div><h2 className="section-title">Xuất báo cáo</h2><p className="muted mt-1 text-sm">Không định dạng nào chứa API key.</p></div><div className="flex flex-wrap gap-2">{items.map(([name, action]) => <button key={name} className="btn btn-soft text-xs" onClick={action}><Download className="size-4"/>{name}</button>)}</div></section>;
}
