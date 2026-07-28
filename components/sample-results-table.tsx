"use client";

import type { NormalizedSample } from "@/lib/edge-impulse/types";
import type { SamplePresenceResult } from "@/lib/metrics/presence";
import { ChevronLeft, ChevronRight, ExternalLink, ImageIcon, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { SampleDetailDialog } from "./sample-detail-dialog";

const display = (labels: string[]) => (labels.length ? labels.join(", ") : "—");

function preloadImage(url?: string) {
  if (!url || typeof window === "undefined") return;
  const image = new window.Image();
  image.src = url;
}

function SampleThumbnail({ sample }: { sample?: NormalizedSample }) {
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState("");
  if (!sample?.thumbnailUrl || failed) {
    return <div className="flex size-12 items-center justify-center rounded-lg bg-slate-100 text-slate-400" title={error || "Khong tai duoc anh"}><ImageIcon className="size-5" /></div>;
  }
  // eslint-disable-next-line @next/next/no-img-element -- Authenticated local image proxy.
  return <img src={sample.thumbnailUrl} alt={sample.filename} className="size-12 rounded-lg border border-slate-200 object-cover" loading="lazy" onError={() => { setError(sample.thumbnailUrl ?? ""); setFailed(true); }} />;
}

export function SampleResultsTable({
  samples,
  results,
  classes,
  confidenceThreshold,
}: {
  samples: NormalizedSample[];
  results: SamplePresenceResult[];
  classes: string[];
  confidenceThreshold: number;
}) {
  const [status, setStatus] = useState("all");
  const [className, setClassName] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("filename");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string>();
  const perPage = 8;
  const sampleById = useMemo(() => new Map(samples.map((sample) => [sample.id, sample])), [samples]);
  const filtered = useMemo(() => {
    const rows = results.filter((result) => {
      if (!result.filename.toLowerCase().includes(search.toLowerCase())) return false;
      if (className && ![...result.groundTruthLabels, ...result.predictedLabels].includes(className)) return false;
      if (status === "pass" && !result.exactMatch) return false;
      if (status === "fail" && result.exactMatch) return false;
      if (status === "fp" && !result.falsePositiveLabels.length) return false;
      if (status === "fn" && !result.falseNegativeLabels.length) return false;
      if (status === "skipped" && !result.skipped) return false;
      return true;
    });
    return rows.sort((a, b) => {
      const aScores = Object.values(a.maxScores);
      const bScores = Object.values(b.maxScores);
      if (sort === "low") return Math.min(...aScores) - Math.min(...bScores);
      if (sort === "high") return Math.max(...bScores) - Math.max(...aScores);
      if (sort === "errors") return b.falsePositiveLabels.length + b.falseNegativeLabels.length - a.falsePositiveLabels.length - a.falseNegativeLabels.length;
      return a.filename.localeCompare(b.filename);
    });
  }, [results, search, className, status, sort]);
  const pages = Math.max(1, Math.ceil(filtered.length / perPage));
  const currentPage = Math.min(page, pages);
  const rows = filtered.slice((currentPage - 1) * perPage, currentPage * perPage);
  const selected = selectedId ? results.find((result) => result.sampleId === selectedId) : undefined;
  const sample = selected ? sampleById.get(selected.sampleId) : undefined;
  const selectedIndex = selected ? filtered.findIndex((result) => result.sampleId === selected.sampleId) : -1;
  useEffect(() => {
    if (selectedIndex < 0) return;
    const nearby = [
      filtered[selectedIndex],
      filtered[selectedIndex - 2],
      filtered[selectedIndex - 1],
      filtered[selectedIndex + 1],
      filtered[selectedIndex + 2],
    ];
    nearby.forEach((item) => preloadImage(item ? sampleById.get(item.sampleId)?.thumbnailUrl : undefined));
  }, [filtered, sampleById, selectedIndex]);
  const selectRelative = (offset: number) => {
    const next = filtered[selectedIndex + offset];
    if (next) setSelectedId(next.sampleId);
  };

  return (
    <section className="panel overflow-hidden">
      <div className="p-5 md:p-6">
        <h2 className="section-title">Kết quả theo từng ảnh</h2>
        <p className="muted mt-1 text-sm">Thumbnail được proxy trực tiếp từ Edge Impulse. Prediction gốc không bị chỉnh sửa trước khi hiển thị raw object.</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <label className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><input className="field !pl-10" placeholder="Tìm filename" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label>
          <select className="field" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
            <option value="all">Tất cả kết quả</option><option value="pass">Chỉ PASS</option><option value="fail">Chỉ FAIL</option><option value="fp">Có False Positive</option><option value="fn">Có False Negative</option><option value="skipped">Skipped unsupported label</option>
          </select>
          <select className="field" value={className} onChange={(event) => { setClassName(event.target.value); setPage(1); }}>
            <option value="">Tất cả lớp</option>{classes.map((name) => <option key={name}>{name}</option>)}
          </select>
          <select className="field" value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="filename">Sắp xếp: Filename</option><option value="low">Confidence thấp nhất</option><option value="high">Confidence cao nhất</option><option value="errors">Nhiều lỗi nhất</option>
          </select>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="metric-table">
          <thead><tr><th>Ảnh</th><th>Filename</th><th>Ground Truth</th><th>Prediction</th><th>Max Confidence</th><th>TP</th><th>FP</th><th>FN</th><th>Warnings</th><th>Kết quả</th><th>Classification</th></tr></thead>
          <tbody>
            {rows.map((result) => {
              const rowSample = sampleById.get(result.sampleId);
              return (
                <tr
                  key={result.sampleId}
                  className="cursor-pointer"
                  onClick={() => setSelectedId(result.sampleId)}
                  onMouseEnter={() => preloadImage(rowSample?.thumbnailUrl)}
                  onFocus={() => preloadImage(rowSample?.thumbnailUrl)}
                >
                  <td><SampleThumbnail sample={rowSample} /></td>
                  <td className="max-w-52 truncate font-bold">{result.filename}</td>
                  <td>{display(result.groundTruthLabels)}</td>
                  <td>{display(result.predictedLabels)}</td>
                  <td>{Object.entries(result.maxScores).map(([key, value]) => `${key}: ${value.toFixed(4)}`).join(" · ")}</td>
                  <td className="text-emerald-700">{display(result.truePositiveLabels)}</td>
                  <td className="text-red-700">{display(result.falsePositiveLabels)}</td>
                  <td className="text-orange-700">{display(result.falseNegativeLabels)}</td>
                  <td>{display(result.warnings)}</td>
                  <td><span className={`badge ${result.exactMatch ? "badge-pass" : "badge-fail"}`}>{result.result.replaceAll("_", " ")}</span></td>
                  <td>{rowSample?.classificationUrl && <button className="btn btn-soft p-2" onClick={(event) => { event.stopPropagation(); window.open(rowSample.classificationUrl, "_blank", "noopener,noreferrer"); }} aria-label="Xem classification" title="Xem classification"><ExternalLink className="size-4" /></button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && <p className="p-8 text-center text-sm text-slate-500">Không có sample phù hợp bộ lọc.</p>}
      </div>
      <div className="flex items-center justify-between border-t border-slate-200 p-4 text-sm">
        <span className="muted">{filtered.length} kết quả · Trang {currentPage}/{pages}</span>
        <div className="flex gap-2">
          <button className="btn btn-soft p-2" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft className="size-4" /></button>
          <button className="btn btn-soft p-2" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}><ChevronRight className="size-4" /></button>
        </div>
      </div>
      {selected && sample && <SampleDetailDialog sample={sample} result={selected} confidenceThreshold={confidenceThreshold} onClose={() => setSelectedId(undefined)} onPrevious={selectedIndex > 0 ? () => selectRelative(-1) : undefined} onNext={selectedIndex >= 0 && selectedIndex < filtered.length - 1 ? () => selectRelative(1) : undefined} />}
    </section>
  );
}
