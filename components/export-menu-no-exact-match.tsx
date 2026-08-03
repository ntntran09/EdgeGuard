"use client";

import type { PresenceReport } from "@/lib/export/types";
import {
  exportClassMetricsNoExactMatchCsv,
  exportDetailsNoExactMatchCsv,
  exportOverallMetricsNoExactMatchCsv,
  exportReportNoExactMatchHtml,
  exportReportNoExactMatchJson,
} from "@/lib/export/no-exact-match";
import { Download } from "lucide-react";

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ExportMenuNoExactMatch({ report }: { report: PresenceReport }) {
  const items: Array<[string, () => void]> = [
    ["presence_overall_metrics.csv", () => download("presence_overall_metrics.csv", exportOverallMetricsNoExactMatchCsv(report), "text/csv;charset=utf-8")],
    ["presence_class_metrics.csv", () => download("presence_class_metrics.csv", exportClassMetricsNoExactMatchCsv(report.classMetrics), "text/csv;charset=utf-8")],
    ["presence_details.csv", () => download("presence_details.csv", exportDetailsNoExactMatchCsv(report.sampleResults), "text/csv;charset=utf-8")],
    ["presence_report.json", () => download("presence_report.json", exportReportNoExactMatchJson(report), "application/json;charset=utf-8")],
    ["presence_report.html", () => download("presence_report.html", exportReportNoExactMatchHtml(report), "text/html;charset=utf-8")],
    ["thresholds.json", () => download("thresholds.json", JSON.stringify(report.thresholds, null, 2), "application/json;charset=utf-8")],
  ];

  return (
    <section className="panel space-y-4 p-5">
      <div>
        <h2 className="section-title">Xuất báo cáo</h2>
        <p className="muted mt-1 text-sm">Không định dạng nào chứa API key.</p>
      </div>
      <div className="overflow-x-auto pb-1">
        <div className="flex min-w-max flex-nowrap gap-2">
          {items.map(([name, action]) => (
            <button key={name} className="btn btn-soft shrink-0 whitespace-nowrap text-xs" onClick={action}>
              <Download className="size-4" />
              {name}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
