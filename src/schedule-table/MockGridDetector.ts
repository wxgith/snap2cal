import type { GridDetectionOptions, GridDetector, GridLine, TableGrid } from "./types";

export interface MockGridDetectorOptions {
  horizontalPositions?: number[];
  verticalPositions?: number[];
  confidence?: number;
  delayMs?: number;
}

function lines(positions: number[], orientation: GridLine["orientation"]): GridLine[] {
  return positions.map((position, index) => ({
    id: `detected-${orientation}-${index}`,
    orientation,
    position,
    confidence: 0.96,
    origin: "detected",
    locked: false,
  }));
}

export class MockGridDetector implements GridDetector {
  constructor(private readonly config: MockGridDetectorOptions = {}) {}

  async detect(image: ImageData, options?: GridDetectionOptions): Promise<TableGrid> {
    const stages = [
      ["preparing-image", 0.1, "正在准备测试图像"],
      ["detecting-horizontal-lines", 0.3, "正在检测水平网格线"],
      ["detecting-vertical-lines", 0.55, "正在检测垂直网格线"],
      ["merging-lines", 0.75, "正在合并线候选"],
      ["building-grid", 0.9, "正在生成网格"],
    ] as const;
    for (const [stage, progress, message] of stages) {
      if (options?.signal?.aborted) throw new DOMException("课程表网格检测已取消。", "AbortError");
      options?.onProgress?.({ stage, progress, message });
      if (this.config.delayMs)
        await new Promise((resolve) => setTimeout(resolve, this.config.delayMs));
    }
    const horizontal = this.config.horizontalPositions ?? [0, 55, 120, 185];
    const vertical = this.config.verticalPositions ?? [0, 100, 280, 460, 640];
    options?.onProgress?.({ stage: "completed", progress: 1, message: "网格检测完成" });
    return {
      imageWidth: image.width,
      imageHeight: image.height,
      horizontalLines: lines(horizontal, "horizontal"),
      verticalLines: lines(vertical, "vertical"),
      confidence: this.config.confidence ?? 0.96,
      warnings: [
        {
          code: "GRID_MANUAL_CONFIRMATION_REQUIRED",
          message: "自动网格必须经人工确认后才能生成课程。",
          severity: "info",
          scope: "grid",
        },
      ],
    };
  }
}
