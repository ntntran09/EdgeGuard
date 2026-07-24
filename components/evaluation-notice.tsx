import { Info } from "lucide-react";

export function EvaluationNotice() {
  return (
    <div className="flex gap-3 rounded-2xl border border-teal-200 bg-teal-50 px-5 py-4 text-sm leading-6 text-teal-950">
      <Info className="mt-0.5 size-5 shrink-0 text-teal-700" />
      <p>
        <strong>Presence evaluation</strong> chấm theo kịch bản human, object, hoặc human + object.
        Prediction được nhận khi score đạt threshold, đúng label và centroid nằm trong bbox ground truth; không dùng IoU hoặc khoảng cách centroid.
      </p>
    </div>
  );
}
