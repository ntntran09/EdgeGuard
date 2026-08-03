import { Info } from "lucide-react";

export function EvaluationNotice() {
  return (
    <div className="rounded-2xl border border-teal-200 bg-teal-50 px-5 py-4 text-sm leading-6 text-teal-950">
      <div className="flex gap-3">
      <Info className="mt-0.5 size-5 shrink-0 text-teal-700" />
      <p>
        <strong>Cách chấm:</strong> Web lấy centroid của prediction. Nếu centroid đó nằm trong bbox ground truth,
        đúng class và đủ threshold thì tính là đúng. Không dùng IoU.
      </p>
      </div>
      <details className="mt-3 rounded-xl border border-teal-200 bg-white/55 px-4 py-3">
        <summary className="cursor-pointer font-extrabold">Xem logic tính điểm</summary>
        <div className="mt-3 space-y-2 text-teal-950">
          <p>Edge Impulse cung cấp ground truth bbox, prediction bbox, class và confidence score. Web tự chấm lại TP, FP, FN, TN theo logic bên dưới.</p>
          <p><strong>Ảnh chỉ có human:</strong> có ít nhất một prediction human đúng class, đủ threshold và centroid nằm trong bbox human thì PASS. Dự đoán dư class khác không làm ảnh sai.</p>
          <p><strong>Ảnh chỉ có object package/backpack:</strong> có ít nhất một object đúng class, đủ threshold và centroid nằm trong bbox object thì PASS. Nếu dư human thì FAIL.</p>
          <p><strong>Ảnh có cả human và object:</strong> chỉ cần human đúng class, đủ threshold và centroid nằm trong bbox human thì PASS. Object được bỏ qua theo đặc tả.</p>
          <p><strong>Metric tổng:</strong> Exact-match = số ảnh PASS / tổng số ảnh được đánh giá. Precision, Recall và F1 được tính từ TP, FP, FN, TN do web tự chấm, không lấy trực tiếp từ Edge Impulse.</p>
        </div>
      </details>
    </div>
  );
}
