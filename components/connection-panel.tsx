"use client";

import { DEFAULT_CONFIDENCE_THRESHOLD } from "@/lib/constants/fomo";
import type { NormalizedDataset } from "@/lib/edge-impulse/types";
import { CheckCircle2, CloudDownload, LoaderCircle, PlugZap, RefreshCw, Trash2 } from "lucide-react";
import { useRef, useState } from "react";

export type LoadedContext = {
  projectId: number;
  dataset: "testing";
  variant: "int8";
  loadedAt: string;
};

type SafeConfig = {
  projectId: number;
  confidenceThreshold: number;
  hasApiKey: boolean;
  impulseId: 1;
  modelVariant: "int8";
  supportedLabels: ["human", "package", "backpack"];
};

type ConfigResponse = {
  ok: boolean;
  config?: SafeConfig;
  sampleCount?: number;
  warnings?: string[];
  error?: string;
};

type EvaluationResponse = NormalizedDataset & {
  ok: boolean;
  config?: SafeConfig;
  error?: string;
};

async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json()) as T;
  if (!response.ok || (typeof data === "object" && data && "ok" in data && !data.ok)) {
    throw new Error((data as { error?: string }).error || "Yêu cầu không thành công.");
  }
  return data;
}

export function ConnectionPanel({
  confidenceThreshold,
  onThresholdChange,
  onData,
  onClear,
}: {
  confidenceThreshold: number;
  onThresholdChange: (value: number) => void;
  onData: (data: NormalizedDataset, context: LoadedContext, threshold: number) => void;
  onClear: () => void;
}) {
  const apiKeyRef = useRef<HTMLInputElement>(null);
  const [projectId, setProjectId] = useState("");
  const [configured, setConfigured] = useState<SafeConfig | null>(null);
  const [status, setStatus] = useState("Chưa cấu hình project");
  const [busy, setBusy] = useState(false);

  const loadEvaluation = async (path = "/api/evaluation", method = "GET") => {
    const response = await fetch(path, { method });
    const data = await readJson<EvaluationResponse>(response);
    const config = data.config ?? configured;
    if (!config) throw new Error("Chưa có cấu hình project.");
    setConfigured(config);
    onThresholdChange(config.confidenceThreshold);
    onData(data, {
      projectId: config.projectId,
      dataset: "testing",
      variant: "int8",
      loadedAt: new Date().toISOString(),
    }, config.confidenceThreshold);
    setStatus(`Đã tải ${data.samples.length} sample lúc ${new Date().toLocaleTimeString("vi-VN")}`);
  };

  const connect = async () => {
    setBusy(true);
    setStatus("Đang kết nối project...");
    try {
      const response = await fetch("/api/session/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: Number(projectId),
          apiKey: apiKeyRef.current?.value ?? "",
          confidenceThreshold,
        }),
      });
      const configResponse = await readJson<ConfigResponse>(response);
      if (!configResponse.config) throw new Error("Backend không trả cấu hình an toàn.");
      setConfigured(configResponse.config);
      setStatus(`Kết nối thành công · ${configResponse.sampleCount ?? 0} sample`);
      await loadEvaluation();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Không thể kết nối project.");
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    setBusy(true);
    setStatus("Đang làm mới dữ liệu từ Edge Impulse...");
    try {
      await loadEvaluation("/api/evaluation/refresh", "POST");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Không thể làm mới dữ liệu.");
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    try {
      await fetch("/api/session/config", { method: "DELETE" });
      apiKeyRef.current?.form?.reset();
      setConfigured(null);
      setProjectId("");
      onThresholdChange(DEFAULT_CONFIDENCE_THRESHOLD);
      onClear();
      setStatus("Đã xóa cấu hình project");
    } finally {
      setBusy(false);
    }
  };

  const changeProject = async () => {
    await clear();
    setStatus("Nhập project mới để kết nối");
  };

  return (
    <section className="panel p-5 md:p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="section-title">Cấu hình Edge Impulse</h2>
          <p className="muted mt-1 text-sm">Chỉ Project ID, API key và Confidence Threshold có thể thay đổi.</p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700">
          <CheckCircle2 className="size-4 text-teal-600" /> {status}
        </span>
      </div>

      <form className="grid gap-4 md:grid-cols-3" onSubmit={(event) => { event.preventDefault(); void connect(); }}>
        <label className="text-sm font-bold">Project ID
          <input
            className="field mt-2"
            type="number"
            name="projectId"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            placeholder="Nhập Edge Impulse Project ID"
            disabled={busy || Boolean(configured)}
          />
        </label>
        <label className="text-sm font-bold">API Key
          <input
            ref={apiKeyRef}
            className="field mt-2"
            type="password"
            name="apiKey"
            autoComplete="off"
            placeholder="Nhập Edge Impulse Project API Key"
            disabled={busy || Boolean(configured)}
          />
        </label>
        <label className="text-sm font-bold">Confidence Threshold
          <div className="mt-2 flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
            <input
              className="min-w-0 flex-1"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={confidenceThreshold}
              onChange={(event) => onThresholdChange(Number(event.target.value))}
            />
            <span className="w-12 text-right font-mono text-sm">{confidenceThreshold.toFixed(2)}</span>
          </div>
        </label>
      </form>

      <p className="muted mt-3 text-xs">API key chỉ được lưu tạm trong server memory, cookie chỉ chứa session ID HttpOnly.</p>
      <div className="mt-5 flex flex-wrap gap-2">
        <button className="btn btn-primary" disabled={busy || Boolean(configured)} onClick={connect}>
          {busy ? <LoaderCircle className="size-4 animate-spin" /> : <PlugZap className="size-4" />} Kết nối project
        </button>
        <button className="btn btn-soft" disabled={busy || !configured} onClick={changeProject}>
          <CloudDownload className="size-4" /> Đổi project
        </button>
        <button className="btn btn-soft" disabled={busy || !configured} onClick={clear}>
          <Trash2 className="size-4" /> Xóa cấu hình
        </button>
        <button className="btn btn-dark" disabled={busy || !configured} onClick={refresh}>
          <RefreshCw className="size-4" /> Làm mới dữ liệu
        </button>
      </div>
    </section>
  );
}
