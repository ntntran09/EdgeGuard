"use client";

import type { ClassPresenceMetric } from "@/lib/metrics/presence";
import { ArrowUpDown } from "lucide-react";
import { useState } from "react";

const pct = (value: number | null) => value === null ? "N/A" : `${(value * 100).toFixed(2)}%`;

export function ClassMetricsTable({ metrics }: { metrics: ClassPresenceMetric[] }) {
  const [sort, setSort] = useState<keyof ClassPresenceMetric>("className");
  const rows = [...metrics].sort((a, b) => String(a[sort] ?? -1).localeCompare(String(b[sort] ?? -1), undefined, { numeric: true }));
  const headers: Array<[keyof ClassPresenceMetric, string]> = [["className","Lớp"],["threshold","Threshold"],["precision","Precision"],["recall","Recall"],["f1","F1"],["tp","TP"],["fp","FP"],["fn","FN"],["tn","TN"],["support","Support"]];
  return <section className="panel overflow-hidden"><div className="p-5"><h2 className="section-title">Metric theo lớp</h2><p className="muted mt-1 text-sm">Chọn tiêu đề cột để sắp xếp.</p></div><div className="overflow-x-auto"><table className="metric-table"><thead><tr>{headers.map(([key,label]) => <th key={key} onClick={() => setSort(key)}>{label} <ArrowUpDown className="inline size-3" /></th>)}</tr></thead><tbody>{rows.map((m) => <tr key={m.className} className={m.f1 !== null && m.f1 < .6 ? "bg-orange-50" : ""}><td className="font-extrabold">{m.className}</td><td>{m.threshold.toFixed(2)}</td><td>{pct(m.precision)}</td><td>{pct(m.recall)}</td><td className="font-bold">{pct(m.f1)}</td><td>{m.tp}</td><td>{m.fp}</td><td>{m.fn}</td><td>{m.tn}</td><td>{m.support}</td></tr>)}</tbody></table></div></section>;
}
