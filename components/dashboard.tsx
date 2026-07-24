"use client";

import { DEFAULT_CONFIDENCE_THRESHOLD } from "@/lib/constants/fomo";
import type { NormalizedDataset } from "@/lib/edge-impulse/types";
import type { PresenceReport } from "@/lib/export/types";
import { evaluatePresence } from "@/lib/metrics/presence";
import type { ThresholdOptimization } from "@/lib/metrics/threshold-optimizer";
import { useMemo, useState } from "react";
import { ClassMetricsTable } from "./class-metrics-table";
import { ConnectionPanel, type LoadedContext } from "./connection-panel";
import { EvaluationNotice } from "./evaluation-notice";
import { ExportMenu } from "./export-menu";
import { SampleResultsTable } from "./sample-results-table";
import { SummaryCards } from "./summary-cards";
import { ThresholdChart } from "./threshold-chart";
import { ThresholdControls } from "./threshold-controls";

const VI_TIME_FORMATTER = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export function Dashboard() {
  const [data, setData] = useState<NormalizedDataset | null>(null);
  const [context, setContext] = useState<LoadedContext | null>(null);
  const [confidenceThreshold, setConfidenceThreshold] = useState(DEFAULT_CONFIDENCE_THRESHOLD);
  const [optimizations, setOptimizations] = useState<Record<string, ThresholdOptimization>>({});

  const evaluation = useMemo(
    () => (data ? evaluatePresence(data.samples, confidenceThreshold) : null),
    [data, confidenceThreshold],
  );

  const report: PresenceReport | null = evaluation && context
    ? {
        generatedAt: context.loadedAt,
        projectId: String(context.projectId),
        dataset: context.dataset,
        modelVariant: context.variant,
        thresholds: Object.fromEntries(evaluation.classes.map((name) => [name, confidenceThreshold])),
        definitions: {
          presence: "Prediction hợp lệ khi score >= threshold, đúng label và centroid nằm trong bbox ground truth.",
          ignored: ["IoU", "centroid distance"],
        },
        overallMetrics: evaluation.overallMetrics,
        classMetrics: evaluation.classMetrics,
        sampleResults: evaluation.sampleResults,
      }
    : null;

  const handleData = (next: NormalizedDataset, loaded: LoadedContext, threshold: number) => {
    setData(next);
    setContext(loaded);
    setConfidenceThreshold(threshold);
    setOptimizations({});
  };

  const handleClear = () => {
    setData(null);
    setContext(null);
    setOptimizations({});
    setConfidenceThreshold(DEFAULT_CONFIDENCE_THRESHOLD);
  };

  return (
    <main className="mx-auto max-w-[1500px] px-3 py-5 md:px-7 md:py-8">
      <header className="mb-6 overflow-hidden rounded-[24px] bg-[#10263f] p-6 text-white shadow-xl md:p-9">
        <div className="max-w-4xl">
          <div className="mb-4 inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-bold uppercase text-cyan-200">
            Edge Impulse Presence Evaluator
          </div>
          <h1 className="text-3xl font-black md:text-5xl">Đánh giá FOMO theo Presence</h1>
          <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-300 md:text-base">
            Chỉ dùng Project ID, API key và Confidence Threshold. Impulse ID luôn là 1, model variant luôn là int8, class cố định là human, package và backpack.
          </p>
        </div>
      </header>

      <div className="space-y-5">
        <EvaluationNotice />
        <ConnectionPanel
          confidenceThreshold={confidenceThreshold}
          onThresholdChange={setConfidenceThreshold}
          onData={handleData}
          onClear={handleClear}
        />

        {!data || !context || !evaluation ? (
          <section className="panel p-6 text-sm text-slate-700">
            Nhập Project ID, Edge Impulse Project API Key và Confidence Threshold để tải dữ liệu Model Testing thật từ Edge Impulse.
          </section>
        ) : (
          <>
            {data.warnings.length > 0 && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
                {data.warnings.map((warning) => <p key={warning}>• {warning}</p>)}
              </div>
            )}
            {evaluation.sampleResults.some((result) => result.warnings.length > 0) && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
                Dữ liệu chứa class không được hỗ trợ. Custom metric này chỉ hỗ trợ human, package và backpack.
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
              <span>
                <b>{data.samples.length}</b> sample · Dataset <b>{context.dataset}</b> · Variant <b>{context.variant}</b> · Tải lúc <b>{VI_TIME_FORMATTER.format(new Date(context.loadedAt))}</b>
              </span>
              <span className="font-bold">Threshold {confidenceThreshold.toFixed(2)}</span>
            </div>
            <SummaryCards metrics={evaluation.overallMetrics} />
            <ClassMetricsTable metrics={evaluation.classMetrics} />
            <ThresholdControls
              samples={data.samples}
              classes={evaluation.classes}
              metrics={evaluation.classMetrics}
              confidenceThreshold={confidenceThreshold}
              onChange={setConfidenceThreshold}
              onOptimize={setOptimizations}
            />
            <ThresholdChart classes={evaluation.classes} optimizations={optimizations} />
            <SampleResultsTable
              samples={data.samples}
              results={evaluation.sampleResults}
              classes={evaluation.classes}
              confidenceThreshold={confidenceThreshold}
            />
            {report && <ExportMenu report={report} />}
          </>
        )}
      </div>
      <footer className="py-8 text-center text-xs text-slate-500">
        Presence metric · score ≥ threshold · Không dùng dữ liệu mô phỏng
      </footer>
    </main>
  );
}
