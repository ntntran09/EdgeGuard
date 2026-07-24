"use client";

import { DEFAULT_CONFIDENCE_THRESHOLD } from "@/lib/constants/fomo";
import type { NormalizedSample } from "@/lib/edge-impulse/types";
import type { ClassPresenceMetric } from "@/lib/metrics/presence";
import { optimizeGlobalThreshold } from "@/lib/metrics/threshold-optimizer";
import { clampThreshold } from "@/lib/utils";
import { RotateCcw, Sparkles } from "lucide-react";
import { useState } from "react";

const metric = (value: number | null) => value === null ? "N/A" : `${(value * 100).toFixed(1)}%`;

export function ThresholdControls({
  samples,
  metrics,
  confidenceThreshold,
  onChange,
}: {
  samples: NormalizedSample[];
  classes: string[];
  metrics: ClassPresenceMetric[];
  confidenceThreshold: number;
  onChange: (threshold: number) => void;
}) {
  const [message, setMessage] = useState("");
  const update = (value: number) => {
    onChange(clampThreshold(value));
    setMessage("Việc giảm threshold không thể khôi phục những prediction không có trong dữ liệu Model Testing mà Edge Impulse trả về.");
  };
  const optimize = () => {
    const best = optimizeGlobalThreshold(samples);
    onChange(best.threshold);
    setMessage("Đã áp dụng threshold global có macro F1 tốt nhất trên dữ liệu hiện tại.");
  };

  return (
    <section className="panel p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="section-title">Confidence Threshold</h2>
          <p className="muted mt-1 text-sm">Metric cập nhật tức thì từ prediction và confidence score đã tải.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-dark" onClick={optimize}><Sparkles className="size-4" /> Tối ưu</button>
          <button className="btn btn-soft" onClick={() => update(DEFAULT_CONFIDENCE_THRESHOLD)}><RotateCcw className="size-4" /> 0.50</button>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_8rem]">
        <input
          className="w-full"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={confidenceThreshold}
          onChange={(event) => update(Number(event.target.value))}
        />
        <input
          className="field font-mono"
          type="number"
          min="0"
          max="1"
          step="0.01"
          value={confidenceThreshold}
          onChange={(event) => update(Number(event.target.value))}
        />
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-3">
        {metrics.map((item) => (
          <div key={item.className} className="rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between"><strong>{item.className}</strong><span className="font-mono text-sm">{confidenceThreshold.toFixed(2)}</span></div>
            <div className="muted mt-3 flex flex-wrap gap-4 text-xs">
              <span>Precision <b className="text-slate-900">{metric(item.precision)}</b></span>
              <span>Recall <b className="text-slate-900">{metric(item.recall)}</b></span>
              <span>F1 <b className="text-slate-900">{metric(item.f1)}</b></span>
            </div>
          </div>
        ))}
      </div>
      {message && <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{message}</p>}
    </section>
  );
}
