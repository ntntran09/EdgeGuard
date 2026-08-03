import type {
  ClassPresenceMetric,
  OverallPresenceMetrics,
  SamplePresenceResult,
  ThresholdMap,
} from "@/lib/metrics/presence";

export type PresenceReport = {
  generatedAt: string;
  projectId: string;
  dataset: string;
  modelVariant: string;
  thresholds: ThresholdMap;
  definitions: {
    presence: string;
    ignored: string[];
  };
  overallMetrics: OverallPresenceMetrics;
  classMetrics: ClassPresenceMetric[];
  sampleResults: SamplePresenceResult[];
};
