export const EDGE_IMPULSE_CONFIG = {
  impulseId: 1,
  modelVariant: "int8",
} as const;

export const FOMO_LABELS = {
  human: "human",
  package: "package",
  backpack: "backpack",
} as const;

export const OBJECT_LABELS = new Set<string>([
  FOMO_LABELS.package,
  FOMO_LABELS.backpack,
]);

export const SUPPORTED_LABELS = new Set<string>([
  FOMO_LABELS.human,
  FOMO_LABELS.package,
  FOMO_LABELS.backpack,
]);

export const SUPPORTED_LABEL_LIST = [
  FOMO_LABELS.human,
  FOMO_LABELS.package,
  FOMO_LABELS.backpack,
] as const;

export const DEFAULT_CONFIDENCE_THRESHOLD = 0.5;

export function isHumanLabel(label: string): boolean {
  return label === FOMO_LABELS.human;
}

export function isObjectLabel(label: string): boolean {
  return OBJECT_LABELS.has(label);
}

export function isSupportedLabel(label: string): boolean {
  return SUPPORTED_LABELS.has(label);
}
