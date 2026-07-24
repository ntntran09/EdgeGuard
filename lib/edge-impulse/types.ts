export type Box = {
  label: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  cX?: number;
  cY?: number;
};

export type Prediction = Box & { score: number };

export type NormalizedSample = {
  id: string;
  filename: string;
  category: "validation" | "testing" | string;
  groundTruthBoxes: Box[];
  predictions: Prediction[];
  imageSampleId?: string;
  thumbnailUrl?: string;
  classificationUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
};

export type NormalizedDataset = {
  samples: NormalizedSample[];
  classes: string[];
  availableVariants: string[];
  warnings: string[];
};

export type DatasetKind = "testing" | "validation";
export type ModelVariant = "int8";
