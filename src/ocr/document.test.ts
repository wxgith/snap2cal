import { describe, expect, it } from "vitest";
import { buildOcrDocument, editOcrBlock, rebuildOcrDocument, setOcrBlockIgnored } from "./document";
import type { OcrRawResult } from "./types";

const raw: OcrRawResult = {
  blocks: [
    {
      text: "世界",
      confidence: 0.8,
      bbox: { x: 60, y: 10, width: 40, height: 20 },
      lineIndex: 0,
      orderIndex: 1,
    },
    {
      text: "你好",
      confidence: 0.9,
      bbox: { x: 10, y: 10, width: 40, height: 20 },
      lineIndex: 0,
      orderIndex: 0,
    },
    {
      text: "Snap",
      confidence: 0.7,
      bbox: { x: 10, y: 40, width: 50, height: 20 },
      lineIndex: 1,
      orderIndex: 2,
    },
    {
      text: "2Cal",
      confidence: 0.6,
      bbox: { x: 70, y: 40, width: 50, height: 20 },
      lineIndex: 1,
      orderIndex: 3,
    },
  ],
};

describe("OcrDocument", () => {
  it("按行和横向位置稳定排序并正确拼接中英文", () => {
    const document = buildOcrDocument(raw, 200, 100);
    expect(document.blocks.map((block) => block.text)).toEqual(["你好", "世界", "Snap", "2Cal"]);
    expect(document.combinedText).toBe("你好世界\nSnap 2Cal");
    expect(document.segments.map(({ startIndex, endIndex }) => [startIndex, endIndex])).toEqual([
      [0, 2],
      [2, 4],
      [5, 9],
      [10, 14],
    ]);
  });

  it("编辑只改变 text 并重建索引", () => {
    const document = buildOcrDocument(raw, 200, 100);
    const target = document.blocks[0];
    const edited = editOcrBlock(document, target.id, "您好呀");
    expect(edited.blocks[0]).toMatchObject({
      originalText: "你好",
      text: "您好呀",
      manuallyEdited: true,
    });
    expect(edited.combinedText.startsWith("您好呀世界")).toBe(true);
    expect(edited.segments[1].startIndex).toBe(3);
  });

  it("ignored 块不进入组合文本且可恢复", () => {
    const document = buildOcrDocument(raw, 200, 100);
    const target = document.blocks[1];
    const ignored = setOcrBlockIgnored(document, target.id, true);
    expect(ignored.combinedText).not.toContain("世界");
    expect(ignored.segments.some((segment) => segment.blockId === target.id)).toBe(false);
    expect(setOcrBlockIgnored(ignored, target.id, false).combinedText).toContain("世界");
  });

  it("空结果和全部忽略时置信度为空", () => {
    expect(buildOcrDocument({ blocks: [] }, 1, 1)).toMatchObject({
      combinedText: "",
      averageConfidence: null,
    });
    const document = buildOcrDocument(raw, 200, 100);
    const allIgnored = rebuildOcrDocument({
      ...document,
      blocks: document.blocks.map((block) => ({ ...block, ignored: true })),
    });
    expect(allIgnored.combinedText).toBe("");
    expect(allIgnored.averageConfidence).toBeNull();
  });

  it("归一化 OCR 置信度到 0..1", () => {
    const document = buildOcrDocument({ blocks: [{ ...raw.blocks[0], confidence: 2 }] }, 100, 100);
    expect(document.blocks[0].confidence).toBe(1);
  });
});
