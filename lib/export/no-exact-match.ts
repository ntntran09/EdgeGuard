import type { PresenceReport } from "@/lib/export/types";
import type { ClassPresenceMetric, SamplePresenceResult } from "@/lib/metrics/presence";
import { sanitizeForClient } from "@/lib/security/redact";

const cell = (value: unknown): string => {
  const text = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const rowsToCsv = (rows: unknown[][]) => `\uFEFF${rows.map((row) => row.map(cell).join(",")).join("\r\n")}`;

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const percent = (value: number | null) => (value === null ? "N/A" : `${(value * 100).toFixed(2)}%`);

export function exportOverallMetricsNoExactMatchCsv(report: PresenceReport): string {
  return rowsToCsv([
    ["metric", "value"],
    ["Macro F1", report.overallMetrics.macroF1],
    ["Micro F1", report.overallMetrics.microF1],
    ["Micro Precision", report.overallMetrics.microPrecision],
    ["Micro Recall", report.overallMetrics.microRecall],
    ["Tổng số ảnh", report.overallMetrics.totalSamples],
    ["Ảnh PASS", report.overallMetrics.exactMatches],
    ["Ảnh FAIL", report.overallMetrics.failedSamples],
  ]);
}

export function exportClassMetricsNoExactMatchCsv(metrics: ClassPresenceMetric[]): string {
  return rowsToCsv([
    ["class", "threshold", "precision", "recall", "f1", "tp", "fp", "fn", "tn", "support", "predicted_positives"],
    ...metrics.map((m) => [
      m.className,
      m.threshold,
      m.precision,
      m.recall,
      m.f1,
      m.tp,
      m.fp,
      m.fn,
      m.tn,
      m.support,
      m.predictedPositives,
    ]),
  ]);
}

export function exportDetailsNoExactMatchCsv(results: SamplePresenceResult[]): string {
  return rowsToCsv([
    [
      "sample_id",
      "filename",
      "ground_truth_labels",
      "predicted_labels",
      "maximum_scores",
      "tp_labels",
      "fp_labels",
      "fn_labels",
      "result",
    ],
    ...results.map((r) => [
      r.sampleId,
      r.filename,
      r.groundTruthLabels.join("|"),
      r.predictedLabels.join("|"),
      r.maxScores,
      r.truePositiveLabels.join("|"),
      r.falsePositiveLabels.join("|"),
      r.falseNegativeLabels.join("|"),
      r.result,
    ]),
  ]);
}

export function exportReportNoExactMatchJson(input: PresenceReport): string {
  const report = sanitizeForClient(input);
  return JSON.stringify(
    {
      generatedAt: report.generatedAt,
      projectId: report.projectId,
      dataset: report.dataset,
      modelVariant: report.modelVariant,
      thresholds: report.thresholds,
      definitions: report.definitions,
      overallMetrics: {
        macroF1: report.overallMetrics.macroF1,
        microF1: report.overallMetrics.microF1,
        microPrecision: report.overallMetrics.microPrecision,
        microRecall: report.overallMetrics.microRecall,
        totalSamples: report.overallMetrics.totalSamples,
        passSamples: report.overallMetrics.exactMatches,
        failedSamples: report.overallMetrics.failedSamples,
      },
      classMetrics: report.classMetrics,
      sampleResults: report.sampleResults.map((result) => ({
        sampleId: result.sampleId,
        filename: result.filename,
        groundTruthLabels: result.groundTruthLabels,
        predictedLabels: result.predictedLabels,
        maxScores: result.maxScores,
        truePositiveLabels: result.truePositiveLabels,
        falsePositiveLabels: result.falsePositiveLabels,
        falseNegativeLabels: result.falseNegativeLabels,
        result: result.result,
        warnings: result.warnings,
        skipped: result.skipped,
      })),
    },
    null,
    2,
  );
}

export function exportReportNoExactMatchHtml(input: PresenceReport): string {
  const report = sanitizeForClient(input);
  const cards = [
    ["Macro F1", percent(report.overallMetrics.macroF1)],
    ["Micro F1", percent(report.overallMetrics.microF1)],
    ["Micro Precision", percent(report.overallMetrics.microPrecision)],
    ["Micro Recall", percent(report.overallMetrics.microRecall)],
    ["Tổng số ảnh", report.overallMetrics.totalSamples],
    ["Ảnh PASS", report.overallMetrics.exactMatches],
    ["Ảnh FAIL", report.overallMetrics.failedSamples],
  ];
  const classRows = report.classMetrics
    .map(
      (m) =>
        `<tr><td>${escapeHtml(m.className)}</td><td>${m.threshold.toFixed(2)}</td><td>${percent(m.precision)}</td><td>${percent(m.recall)}</td><td>${percent(m.f1)}</td><td>${m.tp}</td><td>${m.fp}</td><td>${m.fn}</td><td>${m.tn}</td></tr>`,
    )
    .join("");
  const sampleRows = report.sampleResults
    .map(
      (r) =>
        `<tr data-pass="${r.exactMatch}" data-name="${escapeHtml(r.filename.toLowerCase())}"><td>${escapeHtml(r.filename)}</td><td>${escapeHtml(r.groundTruthLabels.join(", ") || "-")}</td><td>${escapeHtml(r.predictedLabels.join(", ") || "-")}</td><td>${escapeHtml(r.falsePositiveLabels.join(", ") || "-")}</td><td>${escapeHtml(r.falseNegativeLabels.join(", ") || "-")}</td><td><span class="pill ${r.exactMatch ? "pass" : "fail"}">${escapeHtml(r.result.replaceAll("_", " "))}</span></td></tr>`,
    )
    .join("");

  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Báo cáo Presence</title><style>
  :root{font-family:"Segoe UI","Noto Sans",Arial,Helvetica,sans-serif;color:#172033;background:#f5f7fb}body{margin:0;padding:32px;text-rendering:optimizeLegibility;-webkit-font-smoothing:antialiased}.wrap{max-width:1180px;margin:auto}.hero{background:#12233f;color:white;padding:28px;border-radius:18px}.note{color:#afc9ff}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:20px 0}.card,section{background:white;padding:18px;border:1px solid #dce3ee;border-radius:14px}.card b{display:block;font-size:24px;margin-top:7px}section{margin-top:16px;overflow:auto}table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;padding:10px;border-bottom:1px solid #e7ebf2;white-space:nowrap}th{color:#536174;letter-spacing:0}input,select{padding:10px;border:1px solid #b9c4d4;border-radius:8px;margin:0 8px 12px 0}.pill{padding:4px 8px;border-radius:999px;font-weight:700}.pass{background:#d9fbe8;color:#087443}.fail{background:#ffe2e2;color:#b42318}@media(max-width:700px){body{padding:12px}.cards{grid-template-columns:1fr 1fr}}@media print{body{background:white;padding:0}.hero{background:white;color:#111;border:2px solid #111}.note{color:#333}input,select{display:none}section,.card{break-inside:avoid}}
  </style></head><body><main class="wrap"><header class="hero"><h1>Đánh giá FOMO theo Presence</h1><p>Project ID: ${escapeHtml(report.projectId || "Demo")} - ${escapeHtml(report.dataset)} - ${escapeHtml(report.modelVariant)}</p><p class="note">Prediction đúng khi score đạt threshold, label khớp và centroid nằm trong bbox ground truth. Không dùng IoU hoặc khoảng cách centroid.</p><small>Tạo lúc: ${escapeHtml(new Date(report.generatedAt).toLocaleString("vi-VN"))}</small></header><div class="cards">${cards.map(([label, value]) => `<div class="card">${label}<b>${value}</b></div>`).join("")}</div><section><h2>Metric theo lớp</h2><table><thead><tr><th>Lớp</th><th>Threshold</th><th>Precision</th><th>Recall</th><th>F1</th><th>TP</th><th>FP</th><th>FN</th><th>TN</th></tr></thead><tbody>${classRows}</tbody></table></section><section><h2>Kết quả từng ảnh</h2><input id="search" placeholder="Tìm filename"><select id="filter"><option value="all">Tất cả</option><option value="pass">Chỉ PASS</option><option value="fail">Chỉ FAIL</option></select><table><thead><tr><th>Filename</th><th>Ground Truth</th><th>Prediction</th><th>FP</th><th>FN</th><th>Kết quả</th></tr></thead><tbody id="samples">${sampleRows}</tbody></table></section></main><script>const q=document.querySelector('#search'),f=document.querySelector('#filter'),rows=[...document.querySelectorAll('#samples tr')];function apply(){const s=q.value.toLowerCase(),v=f.value;rows.forEach(r=>r.hidden=!r.dataset.name.includes(s)||(v==='pass'&&r.dataset.pass!=='true')||(v==='fail'&&r.dataset.pass==='true'))}q.addEventListener('input',apply);f.addEventListener('change',apply);</script></body></html>`;
}
