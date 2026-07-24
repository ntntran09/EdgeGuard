"use client";

import type { Box, NormalizedSample, Prediction } from "@/lib/edge-impulse/types";
import type { SamplePresenceResult } from "@/lib/metrics/presence";
import {
  getBoxCentroid,
  hasDrawableCoordinates,
  hasDrawableCentroid,
  transformBoxFromContain,
  type ImageSize,
} from "@/lib/visualization/coordinates";
import { Eye, ImageOff, Layers3, ScanSearch, SplitSquareHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type ViewMode = "compare" | "overlay" | "original";
type LayerKind = "ground-truth" | "prediction";

type DrawBox = Box & {
  score?: number;
  color: string;
  fill: string;
  caption: string;
  dashed?: boolean;
};

function drawGroundTruth(boxes: Box[]): DrawBox[] {
  return boxes.map((box) => ({
    ...box,
    color: "#06b6d4",
    fill: "rgba(6,182,212,.10)",
    caption: `GT · ${box.label}`,
  }));
}

function drawPredictions(
  predictions: Prediction[],
  result: SamplePresenceResult,
  confidenceThreshold: number,
): DrawBox[] {
  return predictions.map((prediction) => {
    const active = prediction.score >= confidenceThreshold;
    const isTruePositive = active && result.groundTruthLabels.includes(prediction.label);
    const color = !active ? "#94a3b8" : isTruePositive ? "#22c55e" : "#ef4444";
    return {
      ...prediction,
      color,
      fill: !active
        ? "rgba(148,163,184,.08)"
        : isTruePositive
          ? "rgba(34,197,94,.10)"
          : "rgba(239,68,68,.10)",
      caption: `${prediction.label} · ${prediction.score.toFixed(4)}`,
      dashed: !active,
    };
  });
}

function BoxLayer({
  boxes,
  kind,
  canvasWidth,
  canvasHeight,
}: {
  boxes: DrawBox[];
  kind: LayerKind;
  canvasWidth: number;
  canvasHeight: number;
}) {
  const fontSize = Math.max(2.5, Math.min(10, canvasWidth * 0.018));
  const labelHeight = fontSize * 1.7;
  return (
    <>
      {boxes.filter((box) => kind === "prediction" ? getBoxCentroid(box) !== null : hasDrawableCoordinates(box)).map((box, index) => {
        const captionWidth = Math.max(
          fontSize * 5,
          Math.min(canvasWidth * 0.72, box.caption.length * fontSize * 0.61 + fontSize * 1.5),
        );
        if (kind === "prediction") {
          const centroid = getBoxCentroid(box)!;
          const hasBox = hasDrawableCoordinates(box);
          const radius = Math.max(3, Math.min(8, Math.min(canvasWidth, canvasHeight) * 0.014));
          const edgeX = hasBox ? box.x! : centroid.x;
          const edgeY = hasBox ? box.y! : centroid.y;
          const label = `${box.label}${box.score === undefined ? "" : ` (${box.score.toFixed(2)})`}`;
          const labelWidth = Math.max(
            fontSize * 6,
            Math.min(canvasWidth * 0.5, label.length * fontSize * 0.62 + fontSize * 1.2),
          );
          const captionX = Math.max(
            0,
            Math.min(canvasWidth - labelWidth, edgeX),
          );
          const captionY = Math.max(0, edgeY - labelHeight);
          return (
            <g key={`${box.caption}-${centroid.x}-${centroid.y}-${index}`}>
              {hasBox && (
                <rect
                  x={box.x}
                  y={box.y}
                  width={box.width}
                  height={box.height}
                  fill={box.fill}
                  stroke={box.color}
                  strokeWidth="2"
                  strokeDasharray={box.dashed ? "7 5" : undefined}
                  vectorEffect="non-scaling-stroke"
                />
              )}
              <circle
                cx={centroid.x}
                cy={centroid.y}
                r={radius}
                fill="rgba(34,197,94,.35)"
                stroke={box.color}
                strokeWidth="2.5"
                strokeDasharray={box.dashed ? "5 4" : undefined}
                vectorEffect="non-scaling-stroke"
              />
              <rect
                x={captionX}
                y={captionY}
                width={labelWidth}
                height={labelHeight}
                rx="2"
                fill={box.color}
              />
              <text
                x={captionX + fontSize * 0.65}
                y={captionY + fontSize * 1.18}
                fill="white"
                fontSize={fontSize}
                fontWeight="700"
                fontFamily="Arial, sans-serif"
              >
                {label}
              </text>
            </g>
          );
        }
        const captionY = Math.max(0, box.y! - labelHeight);
        return (
          <g key={`${box.caption}-${box.x}-${box.y}-${index}`}>
            <rect
              x={box.x}
              y={box.y}
              width={box.width}
              height={box.height}
              fill={box.fill}
              stroke={box.color}
              strokeWidth="2.5"
              strokeDasharray={box.dashed ? "7 5" : undefined}
              vectorEffect="non-scaling-stroke"
            />
            <rect
              x={box.x}
              y={captionY}
              width={captionWidth}
              height={labelHeight}
              rx="3"
              fill={box.color}
            />
            <text
              x={box.x! + fontSize * 0.65}
              y={captionY + fontSize * 1.18}
              fill="white"
              fontSize={fontSize}
              fontWeight="700"
              fontFamily="Arial, sans-serif"
            >
              {box.caption}
            </text>
          </g>
        );
      })}
    </>
  );
}

function inferDimension(boxes: Box[], axis: "width" | "height") {
  const edge = axis === "width" ? "x" : "y";
  return Math.max(
    1,
    ...boxes.map((box) => {
      const start = box[edge] ?? 0;
      const size = box[axis] ?? 0;
      return start + size;
    }),
  );
}

function predictionImageUrl(imageUrl?: string) {
  if (!imageUrl?.startsWith("/api/edge-impulse/sample-image") && !imageUrl?.startsWith("/api/images/")) return imageUrl;
  return `${imageUrl}${imageUrl.includes("?") ? "&" : "?"}afterInputBlock=true`;
}

function shouldRemapFromInputBlock(boxes: Box[], rawSize?: ImageSize, inputSize?: ImageSize) {
  if (!rawSize || !inputSize) return false;
  if (Math.abs(rawSize.width - inputSize.width) < 1 && Math.abs(rawSize.height - inputSize.height) < 1) {
    return false;
  }
  const maxX = Math.max(
    0,
    ...boxes.flatMap((box) => [
      box.x ?? 0,
      hasDrawableCoordinates(box) ? box.x + box.width : 0,
      box.cX ?? 0,
    ]),
  );
  const maxY = Math.max(
    0,
    ...boxes.flatMap((box) => [
      box.y ?? 0,
      hasDrawableCoordinates(box) ? box.y + box.height : 0,
      box.cY ?? 0,
    ]),
  );
  return maxX <= inputSize.width * 1.1 && maxY <= inputSize.height * 1.1;
}

function clampBoxToImage(box: Box, imageSize?: ImageSize): Box {
  if (!imageSize) return box;
  const next = { ...box };
  if (hasDrawableCoordinates(box)) {
    const x1 = Math.max(0, Math.min(imageSize.width, box.x));
    const y1 = Math.max(0, Math.min(imageSize.height, box.y));
    const x2 = Math.max(0, Math.min(imageSize.width, box.x + box.width));
    const y2 = Math.max(0, Math.min(imageSize.height, box.y + box.height));
    next.x = x1;
    next.y = y1;
    next.width = Math.max(1, x2 - x1);
    next.height = Math.max(1, y2 - y1);
  }
  if (hasDrawableCentroid(box)) {
    next.cX = Math.max(0, Math.min(imageSize.width, box.cX));
    next.cY = Math.max(0, Math.min(imageSize.height, box.cY));
  }
  return next;
}

function useImageSize(imageUrl?: string): ImageSize | undefined {
  const [size, setSize] = useState<ImageSize>();
  useEffect(() => {
    setSize(undefined);
    if (!imageUrl) return;
    const image = new window.Image();
    image.onload = () => setSize({ width: image.naturalWidth, height: image.naturalHeight });
    image.src = imageUrl;
    return () => {
      image.onload = null;
    };
  }, [imageUrl]);
  return size;
}

async function imageProxyError(imageUrl?: string): Promise<string> {
  if (!imageUrl?.startsWith("/api/")) return "Image element could not decode the source.";
  try {
    const response = await fetch(imageUrl, { cache: "no-store" });
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("json")) {
      const data = (await response.json()) as { error?: string; code?: string };
      return `${response.status} ${data.code ?? "IMAGE_PROXY_ERROR"}${data.error ? `: ${data.error}` : ""}`;
    }
    return `${response.status} ${response.statusText || "IMAGE_PROXY_ERROR"} (${contentType || "no content-type"})`;
  } catch (error) {
    return error instanceof Error ? error.message : "Image proxy request failed.";
  }
}

function VisualFrame({
  title,
  subtitle,
  imageUrl,
  sample,
  layers,
  zoom,
  coordinateSize,
}: {
  title: string;
  subtitle: string;
  imageUrl?: string;
  sample: NormalizedSample;
  layers: Array<{ kind: LayerKind; boxes: DrawBox[] }>;
  zoom: number;
  coordinateSize?: ImageSize;
}) {
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number }>();
  const [imageError, setImageError] = useState(false);
  const [imageErrorText, setImageErrorText] = useState("");
  useEffect(() => {
    setImageError(false);
    setImageErrorText("");
    setNaturalSize(undefined);
  }, [imageUrl]);
  const allBoxes = layers.flatMap((layer) => layer.boxes);
  const width = coordinateSize?.width ?? sample.imageWidth ?? naturalSize?.width ?? inferDimension(allBoxes, "width");
  const height = coordinateSize?.height ?? sample.imageHeight ?? naturalSize?.height ?? inferDimension(allBoxes, "height");
  const omitted = layers.reduce(
    (count, layer) =>
      count + layer.boxes.filter((box) =>
        layer.kind === "prediction" ? getBoxCentroid(box) === null : !hasDrawableCoordinates(box),
      ).length,
    0,
  );

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 shadow-sm">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-white">
        <div>
          <h4 className="text-sm font-extrabold">{title}</h4>
          <p className="mt-0.5 text-[11px] text-slate-400">{subtitle}</p>
        </div>
        <ScanSearch className="size-5 text-cyan-300" />
      </div>
      <div className="max-h-[62vh] overflow-auto bg-[linear-gradient(45deg,#182334_25%,transparent_25%),linear-gradient(-45deg,#182334_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#182334_75%),linear-gradient(-45deg,transparent_75%,#182334_75%)] bg-[length:20px_20px] bg-[position:0_0,0_10px,10px_-10px,-10px_0px] p-3">
        {!imageUrl || imageError ? (
          <div className="flex min-h-72 flex-col items-center justify-center rounded-xl bg-slate-900 p-6 text-center text-sm text-slate-400" title={imageErrorText}>
            <ImageOff className="mb-3 size-9" />
            <strong className="text-slate-200">Không tải được ảnh sample</strong>
            <span className="mt-1 max-w-sm text-xs">
              Hãy tải lại kết quả để làm mới phiên ảnh Edge Impulse.
            </span>
            {imageErrorText && (
              <code className="mt-3 max-w-xl rounded-lg bg-slate-950 px-3 py-2 text-[11px] text-amber-200">
                {imageErrorText}
              </code>
            )}
          </div>
        ) : (
          <div className="mx-auto" style={{ width: `${zoom * 100}%`, minWidth: "100%" }}>
            <div className="relative overflow-hidden rounded-lg bg-black">
              {/* eslint-disable-next-line @next/next/no-img-element -- Authenticated local image proxy. */}
              <img
                src={imageUrl}
                alt={`${title}: ${sample.filename}`}
                className="block h-auto w-full select-none"
                draggable={false}
                onLoad={(event) =>
                  setNaturalSize({
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  })
                }
                onError={() => {
                  setImageError(true);
                  void imageProxyError(imageUrl).then(setImageErrorText);
                }}
              />
              <svg
                viewBox={`0 0 ${width} ${height}`}
                preserveAspectRatio="none"
                className="pointer-events-none absolute inset-0 size-full"
                aria-hidden="true"
              >
                {layers.map((layer, index) => (
                  <BoxLayer
                    key={`${layer.kind}-${index}`}
                    boxes={layer.boxes}
                    kind={layer.kind}
                    canvasWidth={width}
                    canvasHeight={height}
                  />
                ))}
              </svg>
            </div>
          </div>
        )}
      </div>
      {omitted > 0 && (
        <p className="border-t border-white/10 px-4 py-2 text-[11px] text-amber-300">
          {omitted} box không có đủ x/y/width/height nên không thể vẽ.
        </p>
      )}
    </article>
  );
}

export function QualitativeVisual({
  sample,
  result,
  confidenceThreshold,
}: {
  sample: NormalizedSample;
  result: SamplePresenceResult;
  confidenceThreshold: number;
}) {
  const [mode, setMode] = useState<ViewMode>("compare");
  const [zoom, setZoom] = useState(1);
  const groundTruth = useMemo(() => drawGroundTruth(sample.groundTruthBoxes), [sample]);
  const predictions = useMemo(
    () => drawPredictions(sample.predictions, result, confidenceThreshold),
    [sample, result, confidenceThreshold],
  );
  const imageUrl = sample.thumbnailUrl;
  const inputBlockImageUrl = predictionImageUrl(imageUrl);
  const loadedRawImageSize = useImageSize(imageUrl);
  const rawImageSize = useMemo(
    () => loadedRawImageSize ??
      (sample.imageWidth && sample.imageHeight
        ? { width: sample.imageWidth, height: sample.imageHeight }
        : undefined),
    [loadedRawImageSize, sample.imageHeight, sample.imageWidth],
  );
  const inputBlockImageSize = useImageSize(inputBlockImageUrl);
  const displayPredictions = useMemo(() => {
    if (!shouldRemapFromInputBlock(predictions, rawImageSize, inputBlockImageSize)) return predictions;
    return predictions.map((box) => ({
      ...box,
      ...clampBoxToImage(transformBoxFromContain(box, rawImageSize!, inputBlockImageSize!), rawImageSize),
    }));
  }, [inputBlockImageSize, predictions, rawImageSize]);
  const overlayGroundTruth = useMemo(() => {
    return groundTruth;
  }, [groundTruth]);
  const tabs: Array<[ViewMode, string, typeof Eye]> = [
    ["compare", "So sánh", SplitSquareHorizontal],
    ["overlay", "Overlay", Layers3],
    ["original", "Ảnh gốc", Eye],
  ];

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-xl border border-slate-200 bg-slate-100 p-1">
          {tabs.map(([value, label, Icon]) => (
            <button
              key={value}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold transition ${mode === value ? "bg-white text-teal-800 shadow-sm" : "text-slate-500"}`}
              onClick={() => setMode(value)}
            >
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-3 text-xs font-bold text-slate-600">
          Zoom
          <input
            type="range"
            min="1"
            max="3"
            step="0.25"
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
          />
          <span className="w-10 font-mono text-teal-800">{zoom.toFixed(2)}×</span>
        </label>
      </div>
      {mode === "compare" && (
        <div className="grid gap-4 xl:grid-cols-2">
          <VisualFrame
            title="Ground Truth"
            subtitle={`${sample.groundTruthBoxes.length} bounding box gốc`}
            imageUrl={imageUrl}
            sample={sample}
            layers={[{ kind: "ground-truth", boxes: groundTruth }]}
            zoom={zoom}
            coordinateSize={rawImageSize}
          />
          <VisualFrame
            title="Prediction"
            subtitle={`${sample.predictions.length} centroid · ưu tiên cₓ/cᵧ từ JSON`}
            imageUrl={imageUrl}
            sample={sample}
            layers={[{ kind: "prediction", boxes: displayPredictions }]}
            zoom={zoom}
            coordinateSize={rawImageSize}
          />
        </div>
      )}
      {mode === "overlay" && (
        <VisualFrame
          title="Overlay Ground Truth + Prediction"
          subtitle="Dùng để kiểm tra định tính; vị trí không tham gia Presence metric"
          imageUrl={imageUrl}
          sample={sample}
          layers={[
            { kind: "ground-truth", boxes: overlayGroundTruth },
            { kind: "prediction", boxes: displayPredictions },
          ]}
          zoom={zoom}
          coordinateSize={rawImageSize}
        />
      )}
      {mode === "original" && (
        <VisualFrame
          title="Ảnh gốc"
          subtitle="Không hiển thị bounding box"
          imageUrl={imageUrl}
          sample={sample}
          layers={[]}
          zoom={zoom}
          coordinateSize={rawImageSize}
        />
      )}
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 rounded-xl bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-700">
        <span><i className="mr-2 inline-block size-3 rounded-sm bg-cyan-500" />Ground Truth</span>
        <span><i className="mr-2 inline-block size-3 rounded-full border-2 border-green-500" />Centroid đúng lớp, đạt threshold</span>
        <span><i className="mr-2 inline-block size-3 rounded-full border-2 border-red-500" />Centroid False Positive</span>
        <span><i className="mr-2 inline-block size-3 rounded-full border-2 border-dashed border-slate-400" />Centroid dưới threshold</span>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Centroid chỉ được vẽ để quan sát vị trí prediction; không được sử dụng khi tính Presence metric.
      </p>
    </section>
  );
}
