"use client";

import type { PresenceEvaluation } from "@/lib/metrics/presence";

export function VariantComparison({
  evaluations,
}: {
  evaluations: Record<string, PresenceEvaluation>;
}) {
  void evaluations;
  return null;
}
