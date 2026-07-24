"use client";

import type { ThresholdOptimization } from "@/lib/metrics/threshold-optimizer";
import { useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function ThresholdChart({ classes, optimizations }: { classes: string[]; optimizations: Record<string, ThresholdOptimization> }) {
  const [selected, setSelected] = useState(classes[0] ?? "");
  const effectiveSelected = classes.includes(selected) ? selected : (classes[0] ?? "");
  const current = optimizations[effectiveSelected];
  return <section className="panel p-5 md:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="section-title">Đường cong threshold</h2><p className="muted mt-1 text-sm">Precision, Recall và F1 từ 0.05 đến 0.95.</p></div><select className="field w-48" value={effectiveSelected} onChange={(e) => setSelected(e.target.value)}>{classes.map((name) => <option key={name}>{name}</option>)}</select></div><div className="mt-5 h-80">{current ? <ResponsiveContainer width="100%" height="100%"><LineChart data={current.curve}><CartesianGrid strokeDasharray="3 3" stroke="#e3e9ef"/><XAxis dataKey="threshold" label={{ value: "Threshold", position: "insideBottom", offset: -2 }}/><YAxis domain={[0,1]} label={{ value: "Metric score", angle: -90, position: "insideLeft" }}/><Tooltip formatter={(value) => typeof value === "number" ? value.toFixed(4) : "N/A"}/><Legend/><Line type="monotone" dataKey="f1" name="F1" stroke="#0f766e" dot={false} strokeWidth={3}/><Line type="monotone" dataKey="precision" name="Precision" stroke="#f97316" dot={false}/><Line type="monotone" dataKey="recall" name="Recall" stroke="#2563eb" dot={false}/><ReferenceLine x={current.threshold} stroke="#9f1239" strokeDasharray="5 4" label="Tối ưu"/></LineChart></ResponsiveContainer> : <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-center text-sm text-slate-500">Nhấn “Tối ưu” để tạo đường cong cho từng lớp.</div>}</div></section>;
}
