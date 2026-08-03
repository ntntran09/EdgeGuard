"use client";

import type { NormalizedSample } from "@/lib/edge-impulse/types";
import type { SamplePresenceResult } from "@/lib/metrics/presence";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect } from "react";
import { QualitativeVisual } from "./qualitative-visual";

const labels = (values: string[]) => (values.length ? values.join(", ") : "—");

export function SampleDetailDialog({
  sample,
  result,
  confidenceThreshold,
  onClose,
  onPrevious,
  onNext,
}: {
  sample: NormalizedSample;
  result: SamplePresenceResult;
  confidenceThreshold: number;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
}) {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") onPrevious?.();
      if (event.key === "ArrowRight") onNext?.();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose, onPrevious, onNext]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-2 backdrop-blur-sm md:p-4"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="max-h-[96vh] w-full max-w-7xl overflow-auto rounded-2xl bg-white shadow-2xl">
        <div className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-slate-200 bg-white/95 p-4 backdrop-blur md:px-6">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-black">{result.filename}</h2>
            <p className="muted text-xs">Sample ID: {result.sampleId}{sample.imageSampleId && sample.imageSampleId !== result.sampleId ? ` · Image ID: ${sample.imageSampleId}` : ""}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              className="btn btn-soft p-2"
              disabled={!onPrevious}
              onClick={onPrevious}
              aria-label="Sample trước"
              title="Sample trước (←)"
            >
              <ChevronLeft className="size-5" />
            </button>
            <button
              className="btn btn-soft p-2"
              disabled={!onNext}
              onClick={onNext}
              aria-label="Sample sau"
              title="Sample sau (→)"
            >
              <ChevronRight className="size-5" />
            </button>
            <button
              className="btn btn-soft p-2"
              onClick={onClose}
              aria-label="Đóng"
              title="Đóng (Esc)"
            >
              <X className="size-5" />
            </button>
          </div>
        </div>

        <div className="p-4 md:p-6">
          <QualitativeVisual sample={sample} result={result} confidenceThreshold={confidenceThreshold} />

          <div className="mt-5 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm sm:grid-cols-2 lg:grid-cols-6">
            <p><b>Ground Truth</b><br />{labels(result.groundTruthLabels)}</p>
            <p><b>Prediction</b><br />{labels(result.predictedLabels)}</p>
            <p className="text-emerald-700"><b>TP classes</b><br />{labels(result.truePositiveLabels)}</p>
            <p className="text-red-700"><b>FP classes</b><br />{labels(result.falsePositiveLabels)}</p>
            <p className="text-orange-700"><b>FN classes</b><br />{labels(result.falseNegativeLabels)}</p>
            <p><b>Kết quả</b><br />{result.result.replaceAll("_", " ")}</p>
          </div>

          <div className="mt-4 rounded-2xl bg-slate-950 p-4 text-sm text-white">
            <b>Maximum score từng lớp</b>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {Object.entries(result.maxScores).map(([label, score]) => (
                <div key={label} className="flex justify-between rounded-lg bg-white/10 px-3 py-2">
                  <span>{label}</span><code>{score.toFixed(4)}</code>
                </div>
              ))}
            </div>
          </div>

          <p className="mt-5 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            Bounding box và tọa độ trong phần visual chỉ phục vụ đánh giá định tính/debug,
            không ảnh hưởng đến Presence metric.
          </p>

          <details className="mt-4 rounded-2xl border border-slate-200 p-4">
            <summary className="cursor-pointer text-sm font-extrabold">
              Xem raw Ground Truth và prediction objects
            </summary>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <b className="text-sm">Raw Ground Truth boxes</b>
                <pre className="mt-2 max-h-60 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">
                  {JSON.stringify(sample.groundTruthBoxes, null, 2)}
                </pre>
              </div>
              <div>
                <b className="text-sm">Raw prediction objects</b>
                <pre className="mt-2 max-h-60 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">
                  {JSON.stringify(sample.predictions, null, 2)}
                </pre>
              </div>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
