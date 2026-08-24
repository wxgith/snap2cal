import { withValidatedGrid } from "./grid";
import type {
  GridDetectionOptions,
  GridDetector,
  GridLine,
  GridLineOrientation,
  ScheduleWarning,
  TableGrid,
} from "./types";

export interface ProjectionOptions {
  darkThreshold?: number;
  responseRatio?: number;
  mergeDistance?: number;
}

export interface DarkMask {
  width: number;
  height: number;
  pixels: Uint8Array;
}

export interface ProjectionCandidate {
  position: number;
  confidence: number;
  start: number;
  end: number;
}

function cancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("课程表网格检测已取消。", "AbortError");
}

function report(
  options: GridDetectionOptions | undefined,
  stage: Parameters<NonNullable<GridDetectionOptions["onProgress"]>>[0]["stage"],
  progress: number,
  message: string,
): void {
  options?.onProgress?.({ stage, progress, message });
}

export function imageDataToDarkMask(image: ImageData, darkThreshold = 180): DarkMask {
  const pixels = new Uint8Array(image.width * image.height);
  for (let index = 0; index < pixels.length; index += 1) {
    const offset = index * 4;
    const alpha = image.data[offset + 3] / 255;
    const gray =
      (image.data[offset] * 0.299 +
        image.data[offset + 1] * 0.587 +
        image.data[offset + 2] * 0.114) *
        alpha +
      255 * (1 - alpha);
    pixels[index] = gray <= darkThreshold ? 1 : 0;
  }
  return { width: image.width, height: image.height, pixels };
}

export function projectDarkPixels(mask: DarkMask, orientation: GridLineOrientation): number[] {
  const length = orientation === "horizontal" ? mask.height : mask.width;
  const divisor = orientation === "horizontal" ? mask.width : mask.height;
  const result = new Array<number>(length).fill(0);
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      if (!mask.pixels[y * mask.width + x]) continue;
      result[orientation === "horizontal" ? y : x] += 1 / divisor;
    }
  }
  return result;
}

export function findProjectionCandidates(
  projection: number[],
  responseRatio = 0.42,
): ProjectionCandidate[] {
  const maximum = Math.max(0, ...projection);
  if (maximum < 0.12) return [];
  const threshold = Math.max(0.12, maximum * responseRatio);
  const candidates: ProjectionCandidate[] = [];
  let start = -1;
  for (let index = 0; index <= projection.length; index += 1) {
    const active = index < projection.length && projection[index] >= threshold;
    if (active && start < 0) start = index;
    if ((!active || index === projection.length) && start >= 0) {
      const end = index - 1;
      let weighted = 0;
      let total = 0;
      let confidence = 0;
      for (let position = start; position <= end; position += 1) {
        weighted += position * projection[position];
        total += projection[position];
        confidence = Math.max(confidence, projection[position]);
      }
      candidates.push({
        position: total ? weighted / total : (start + end) / 2,
        confidence: Math.min(1, confidence),
        start,
        end,
      });
      start = -1;
    }
  }
  return candidates;
}

export function mergeProjectionCandidates(
  candidates: ProjectionCandidate[],
  distance: number,
): ProjectionCandidate[] {
  const sorted = [...candidates].sort((a, b) => a.position - b.position);
  const merged: ProjectionCandidate[] = [];
  for (const candidate of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || candidate.position - previous.position > distance) {
      merged.push({ ...candidate });
      continue;
    }
    const weight = previous.confidence + candidate.confidence;
    previous.position =
      (previous.position * previous.confidence + candidate.position * candidate.confidence) /
      weight;
    previous.confidence = Math.max(previous.confidence, candidate.confidence);
    previous.start = Math.min(previous.start, candidate.start);
    previous.end = Math.max(previous.end, candidate.end);
  }
  return merged;
}

function toLines(candidates: ProjectionCandidate[], orientation: GridLineOrientation): GridLine[] {
  return candidates.map((candidate, index) => ({
    id: `detected-${orientation}-${index}`,
    orientation,
    position: Number(candidate.position.toFixed(3)),
    confidence: candidate.confidence,
    origin: "detected",
    locked: false,
  }));
}

function spacingScore(lines: GridLine[]): number {
  if (lines.length < 3) return lines.length === 2 ? 0.45 : 0;
  const gaps = lines.slice(1).map((line, index) => line.position - lines[index].position);
  const mean = gaps.reduce((sum, value) => sum + value, 0) / gaps.length;
  if (!mean) return 0;
  const deviation =
    gaps.reduce((sum, value) => sum + Math.abs(value - mean), 0) / gaps.length / mean;
  return Math.max(0, 1 - deviation);
}

function intersectionScore(mask: DarkMask, horizontal: GridLine[], vertical: GridLine[]): number {
  if (!horizontal.length || !vertical.length) return 0;
  let found = 0;
  for (const h of horizontal) {
    for (const v of vertical) {
      const centerX = Math.round(v.position);
      const centerY = Math.round(h.position);
      let dark = false;
      for (let y = Math.max(0, centerY - 2); y <= Math.min(mask.height - 1, centerY + 2); y += 1)
        for (let x = Math.max(0, centerX - 2); x <= Math.min(mask.width - 1, centerX + 2); x += 1)
          dark ||= Boolean(mask.pixels[y * mask.width + x]);
      if (dark) found += 1;
    }
  }
  return found / (horizontal.length * vertical.length);
}

export function calculateGridConfidence(
  mask: DarkMask,
  horizontal: GridLine[],
  vertical: GridLine[],
): number {
  if (horizontal.length < 2 || vertical.length < 2) return 0;
  const continuity =
    [...horizontal, ...vertical].reduce((sum, line) => sum + line.confidence, 0) /
    (horizontal.length + vertical.length);
  const intersections = intersectionScore(mask, horizontal, vertical);
  const regularity = (spacingScore(horizontal) + spacingScore(vertical)) / 2;
  const completeness = Math.min(1, ((horizontal.length - 1) * (vertical.length - 1)) / 12);
  return Number(
    (continuity * 0.35 + intersections * 0.35 + regularity * 0.2 + completeness * 0.1).toFixed(3),
  );
}

export class ProjectionGridDetector implements GridDetector {
  constructor(private readonly config: ProjectionOptions = {}) {}

  async detect(image: ImageData, options?: GridDetectionOptions): Promise<TableGrid> {
    cancelled(options?.signal);
    report(options, "preparing-image", 0.05, "正在生成灰度与深色像素矩阵");
    const mask = imageDataToDarkMask(image, this.config.darkThreshold);
    cancelled(options?.signal);
    report(options, "detecting-horizontal-lines", 0.25, "正在检测水平网格线");
    const horizontalProjection = projectDarkPixels(mask, "horizontal");
    const horizontalCandidates = findProjectionCandidates(
      horizontalProjection,
      this.config.responseRatio,
    );
    cancelled(options?.signal);
    report(options, "detecting-vertical-lines", 0.5, "正在检测垂直网格线");
    const verticalProjection = projectDarkPixels(mask, "vertical");
    const verticalCandidates = findProjectionCandidates(
      verticalProjection,
      this.config.responseRatio,
    );
    cancelled(options?.signal);
    report(options, "merging-lines", 0.72, "正在合并相邻线候选");
    const mergeDistance =
      this.config.mergeDistance ?? Math.max(2, Math.min(image.width, image.height) * 0.004);
    const horizontal = toLines(
      mergeProjectionCandidates(horizontalCandidates, mergeDistance),
      "horizontal",
    );
    const vertical = toLines(
      mergeProjectionCandidates(verticalCandidates, mergeDistance),
      "vertical",
    );
    report(options, "building-grid", 0.9, "正在校验网格完整度");
    const confidence = calculateGridConfidence(mask, horizontal, vertical);
    const warnings: ScheduleWarning[] = [];
    if (horizontal.length < 2 || vertical.length < 2)
      warnings.push({
        code: "GRID_NOT_DETECTED",
        message: "未检测到完整矩形网格，可手工添加和调整网格线。",
        severity: "error",
        scope: "grid",
      });
    if (confidence < 0.65)
      warnings.push({
        code: "GRID_LOW_CONFIDENCE",
        message: "自动网格置信度较低，请逐条检查并人工确认。",
        severity: "warning",
        scope: "grid",
      });
    warnings.push({
      code: "GRID_MANUAL_CONFIRMATION_REQUIRED",
      message: "自动网格必须经人工确认后才能生成课程。",
      severity: "info",
      scope: "grid",
    });
    const result = withValidatedGrid({
      imageWidth: image.width,
      imageHeight: image.height,
      horizontalLines: horizontal,
      verticalLines: vertical,
      confidence,
      warnings,
    });
    report(options, "completed", 1, "网格检测完成");
    return result;
  }
}
