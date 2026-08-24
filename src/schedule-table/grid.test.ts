import { describe, expect, it } from "vitest";
import { buildOcrDocument, editOcrBlock } from "../ocr/document";
import {
  addGridLine,
  assignOcrBlocksToGridCellsDetailed,
  buildGridCells,
  moveGridLine,
  removeGridLine,
  toggleGridLineLock,
  validateGrid,
} from "./grid";
import type { TableGrid } from "./types";

function grid(): TableGrid {
  return {
    imageWidth: 200,
    imageHeight: 120,
    horizontalLines: [0, 40, 80, 120].map((position, index) => ({
      id: `h${index}`,
      orientation: "horizontal",
      position,
      confidence: 1,
      origin: "detected",
      locked: false,
    })),
    verticalLines: [0, 70, 140, 200].map((position, index) => ({
      id: `v${index}`,
      orientation: "vertical",
      position,
      confidence: 1,
      origin: "detected",
      locked: false,
    })),
    confidence: 1,
    warnings: [],
  };
}

describe("schedule grid", () => {
  it("生成稳定单元格 ID，并校验重复线和过小单元格", () => {
    expect(buildGridCells(grid())).toHaveLength(9);
    expect(buildGridCells(grid())[0].id).toBe("cell:h0:h1:v0:v1");
    const invalid = grid();
    invalid.horizontalLines[1].position = 0;
    expect(validateGrid(invalid).map((item) => item.code)).toEqual(
      expect.arrayContaining(["GRID_DUPLICATE_LINE", "GRID_CELL_TOO_SMALL"]),
    );
  });

  it("移动、添加、删除和锁定网格线都保持自然坐标约束", () => {
    let value = moveGridLine(grid(), "h1", 200);
    expect(value.horizontalLines[1].position).toBe(76);
    expect(value.horizontalLines[1].origin).toBe("manual");
    value = addGridLine(value, "vertical", 170);
    expect(value.verticalLines.some((line) => line.position === 170)).toBe(true);
    value = toggleGridLineLock(value, "v1");
    expect(removeGridLine(value, "v1").verticalLines).toHaveLength(value.verticalLines.length);
  });

  it("按中心点和重叠归属 OCR，歧义块不复制，编辑不覆盖 originalText", () => {
    const document = buildOcrDocument(
      {
        blocks: [
          {
            text: "周一",
            confidence: 0.98,
            bbox: { x: 80, y: 8, width: 30, height: 20 },
            lineIndex: 0,
            orderIndex: 0,
          },
          {
            text: "高等数学",
            confidence: 0.9,
            bbox: { x: 120, y: 50, width: 40, height: 20 },
            lineIndex: 1,
            orderIndex: 1,
          },
        ],
      },
      200,
      120,
    );
    const edited = editOcrBlock(document, document.blocks[0].id, "星期一");
    const assigned = assignOcrBlocksToGridCellsDetailed(edited, grid());
    expect(assigned.cells.flatMap((cell) => cell.ocrBlockIds)).toHaveLength(2);
    const header = assigned.cells.find((cell) => cell.ocrBlockIds.includes(document.blocks[0].id));
    expect(header?.text).toBe("星期一");
    expect(header?.originalText).toBe("周一");
    const ambiguous = assigned.cells.find((cell) =>
      cell.ocrBlockIds.includes(document.blocks[1].id),
    );
    expect(ambiguous?.warnings.map((item) => item.code)).toContain("COURSE_CELL_AMBIGUOUS_OCR");
  });
});
