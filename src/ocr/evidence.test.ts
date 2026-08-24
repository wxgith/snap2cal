import { describe, expect, it } from "vitest";
import { buildOcrDocument, editOcrBlock, setOcrBlockIgnored } from "./document";
import { mapSourceSpanToOcrEvidence } from "./evidence";
import { mapCandidateToOcrEvidence } from "./evidence";
import { parseEventCandidates } from "../multi-event";
import type { OcrRawResult } from "./types";

const raw: OcrRawResult = {
  blocks: [
    {
      text: "日期8月26日",
      confidence: 0.9,
      bbox: { x: 10, y: 10, width: 100, height: 20 },
      lineIndex: 0,
      orderIndex: 0,
    },
    {
      text: "地点万达",
      confidence: 0.6,
      bbox: { x: 20, y: 40, width: 80, height: 20 },
      lineIndex: 1,
      orderIndex: 1,
    },
    {
      text: "日期8月26日",
      confidence: 0.8,
      bbox: { x: 15, y: 70, width: 100, height: 20 },
      lineIndex: 2,
      orderIndex: 2,
    },
  ],
};

describe("mapSourceSpanToOcrEvidence", () => {
  it("按 UTF-16 索引映射单块而不是搜索重复文字", () => {
    const document = buildOcrDocument(raw, 200, 100);
    const segment = document.segments[2];
    const evidence = mapSourceSpanToOcrEvidence(
      { text: "8月26日", startIndex: segment.startIndex + 2, endIndex: segment.endIndex },
      document,
    );
    expect(evidence.blockIds).toEqual([document.blocks[2].id]);
    expect(evidence.bbox?.y).toBe(70);
  });

  it("跨块和跨行时计算联合框及保守置信度", () => {
    const document = buildOcrDocument(raw, 200, 100);
    const evidence = mapSourceSpanToOcrEvidence(
      { text: "跨行", startIndex: 4, endIndex: document.segments[1].endIndex },
      document,
    );
    expect(evidence.blockIds).toHaveLength(2);
    expect(evidence.bbox).toEqual({ x: 10, y: 10, width: 100, height: 50 });
    expect(evidence.confidence).toBe(0.6);
  });

  it("传递人工校对标记", () => {
    let document = buildOcrDocument(raw, 200, 100);
    document = editOcrBlock(document, document.blocks[0].id, "日期8月27日");
    expect(
      mapSourceSpanToOcrEvidence({ text: "日期", startIndex: 0, endIndex: 2 }, document)
        .containsManualCorrection,
    ).toBe(true);
  });

  it("无来源、越界或已忽略块返回空证据", () => {
    let document = buildOcrDocument(raw, 200, 100);
    const ignored = document.blocks[0];
    document = setOcrBlockIgnored(document, ignored.id, true);
    expect(mapSourceSpanToOcrEvidence(undefined, document).bbox).toBeNull();
    expect(
      mapSourceSpanToOcrEvidence({ text: "x", startIndex: 999, endIndex: 1000 }, document).blockIds,
    ).toEqual([]);
  });

  it("同时映射候选整体与候选字段证据", () => {
    const document = buildOcrDocument(raw, 200, 100);
    const result = parseEventCandidates(document.combinedText, {
      referenceDateTime: new Date("2026-08-23T10:00:00+08:00"),
      timeZone: "Asia/Shanghai",
    });
    const evidence = mapCandidateToOcrEvidence(result.candidates[0], document);
    expect(evidence.candidate.blockIds.length).toBeGreaterThan(0);
    expect(evidence.fields.startDate?.blockIds).toContain(document.blocks[0].id);
  });
});
