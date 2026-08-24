import { describe, expect, it } from "vitest";
import {
  ProjectionGridDetector,
  findProjectionCandidates,
  imageDataToDarkMask,
  mergeProjectionCandidates,
  projectDarkPixels,
} from "./ProjectionGridDetector";

function gridImage(width: number, height: number, vertical: number[], horizontal: number[]) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let index = 3; index < data.length; index += 4) data[index] = 255;
  const dark = (x: number, y: number) => {
    const offset = (y * width + x) * 4;
    data[offset] = 0;
    data[offset + 1] = 0;
    data[offset + 2] = 0;
  };
  for (const x of vertical) for (let y = 0; y < height; y += 1) dark(x, y);
  for (const y of horizontal) for (let x = 0; x < width; x += 1) dark(x, y);
  return { data, width, height, colorSpace: "srgb" } as ImageData;
}

describe("ProjectionGridDetector", () => {
  it("从纯像素矩阵检测清晰水平线和垂直线", async () => {
    const image = gridImage(120, 90, [2, 40, 80, 118], [2, 30, 60, 88]);
    const progress: string[] = [];
    const result = await new ProjectionGridDetector().detect(image, {
      onProgress: (item) => progress.push(item.stage),
    });
    expect(result.horizontalLines.map((line) => Math.round(line.position))).toEqual([
      2, 30, 60, 88,
    ]);
    expect(result.verticalLines.map((line) => Math.round(line.position))).toEqual([2, 40, 80, 118]);
    expect(result.confidence).toBeGreaterThan(0.75);
    expect(progress.at(-1)).toBe("completed");
  });

  it("合并粗线和相邻候选，并保留远距离线", () => {
    const image = gridImage(30, 20, [4, 5, 20], [3, 15]);
    const projection = projectDarkPixels(imageDataToDarkMask(image), "vertical");
    const candidates = findProjectionCandidates(projection);
    expect(candidates).toHaveLength(2);
    expect(mergeProjectionCandidates(candidates, 3)).toHaveLength(2);
    expect(Math.round(candidates[0].position)).toBe(5);
  });

  it("无完整网格时返回低置信度警告而不是伪造网格", async () => {
    const data = new Uint8ClampedArray(30 * 20 * 4).fill(255);
    const result = await new ProjectionGridDetector().detect({
      data,
      width: 30,
      height: 20,
    } as ImageData);
    expect(result.horizontalLines).toHaveLength(0);
    expect(result.warnings.map((item) => item.code)).toEqual(
      expect.arrayContaining(["GRID_NOT_DETECTED", "GRID_LOW_CONFIDENCE"]),
    );
  });
});
