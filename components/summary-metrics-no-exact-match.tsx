import type { OverallPresenceMetrics } from "@/lib/metrics/presence";
import { Check, CircleHelp, Images, Target, X, type LucideIcon } from "lucide-react";

const format = (value: number | null) => (value === null ? "N/A" : `${(value * 100).toFixed(1)}%`);

type SummaryCard = {
  label: string;
  value: string | number;
  icon: LucideIcon;
  definition?: string;
};

export function SummaryMetricsNoExactMatch({ metrics }: { metrics: OverallPresenceMetrics }) {
  const cards: SummaryCard[] = [
    {
      label: "Macro F1",
      value: format(metrics.macroF1),
      icon: Target,
      definition:
        "Trung bình F1 của từng class. F1 mỗi class = 2 x Precision x Recall / (Precision + Recall).",
    },
    {
      label: "Micro F1",
      value: format(metrics.microF1),
      icon: Target,
      definition:
        "F1 tính từ Micro Precision và Micro Recall trên tổng TP, FP, FN của tất cả class: 2 x Micro Precision x Micro Recall / (Micro Precision + Micro Recall).",
    },
    {
      label: "Micro Precision",
      value: format(metrics.microPrecision),
      icon: Target,
      definition:
        "Tổng TP / (Tổng TP + Tổng FP). Chỉ số này cho biết trong các prediction được tính là positive, có bao nhiêu prediction đúng.",
    },
    {
      label: "Micro Recall",
      value: format(metrics.microRecall),
      icon: Target,
      definition:
        "Tổng TP / (Tổng TP + Tổng FN). Chỉ số này cho biết trong các ground truth cần tìm, có bao nhiêu object được phát hiện đúng.",
    },
    { label: "Tổng số ảnh", value: metrics.totalSamples, icon: Images },
    { label: "Ảnh PASS", value: metrics.exactMatches, icon: Check },
    { label: "Ảnh FAIL", value: metrics.failedSamples, icon: X },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-7">
      {cards.map(({ label, value, icon: Icon, definition }) => (
        <div key={label} className="panel p-4">
          <Icon className="mb-4 size-5 text-teal-700" />
          <div className="flex items-center gap-1.5">
            <p className="muted text-[11px] font-bold uppercase tracking-wide">{label}</p>
            {definition && (
              <span className="group relative inline-flex" tabIndex={0} aria-label={`Định nghĩa ${label}`}>
                <CircleHelp className="size-3.5 cursor-help text-slate-400 transition group-hover:text-teal-700 group-focus:text-teal-700" />
                <span
                  role="tooltip"
                  className="pointer-events-none absolute left-1/2 top-5 z-30 hidden w-64 -translate-x-1/2 rounded-md border border-slate-200 bg-white px-3 py-2 text-left text-xs font-medium normal-case leading-5 text-slate-700 shadow-xl group-hover:block group-focus:block"
                >
                  {definition}
                </span>
              </span>
            )}
          </div>
          <p className="mt-1 text-xl font-black tracking-tight">{value}</p>
        </div>
      ))}
    </div>
  );
}
