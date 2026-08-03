import type { OverallPresenceMetrics } from "@/lib/metrics/presence";
import { Check, Images, Target, X } from "lucide-react";

const format = (value: number | null) => (value === null ? "N/A" : `${(value * 100).toFixed(1)}%`);

export function SummaryCards({ metrics }: { metrics: OverallPresenceMetrics }) {
  const cards = [
    ["Macro F1", format(metrics.macroF1), Target],
    ["Micro F1", format(metrics.microF1), Target],
    ["Micro Precision", format(metrics.microPrecision), Target],
    ["Micro Recall", format(metrics.microRecall), Target],
    ["Exact-match", format(metrics.exactMatchAccuracy), Check],
    ["Tổng số ảnh", metrics.totalSamples, Images],
    ["Ảnh PASS", metrics.exactMatches, Check],
    ["Ảnh FAIL", metrics.failedSamples, X],
  ] as const;
  return <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">{cards.map(([label, value, Icon]) => <div key={label} className="panel p-4"><Icon className="mb-4 size-5 text-teal-700" /><p className="muted text-[11px] font-bold uppercase tracking-wide">{label}</p><p className="mt-1 text-xl font-black tracking-tight">{value}</p></div>)}</div>;
}
