import { describe, expect, it } from "vitest";
import { parseEventCandidates } from "./parser";
import {
  appendUnassignedText,
  mergeAdjacentCandidates,
  preserveCandidateState,
  setCandidateStatus,
  undoCandidateMerge,
  updateCandidateField,
} from "./state";

const options = {
  referenceDateTime: new Date("2026-08-23T10:00:00+08:00"),
  timeZone: "Asia/Shanghai",
};
const input = "- 8月26日上午9点 项目评审\n- 8月27日下午2点 客户沟通";

describe("多事件候选状态", () => {
  it("编辑、忽略、恢复并在重新检测时安全迁移", () => {
    let result = parseEventCandidates(input, options);
    const id = result.candidates[0].id;
    result = updateCandidateField(result, id, "title", "人工标题");
    result = setCandidateStatus(result, result.candidates[1].id, "ignored");
    const detectedAgain = parseEventCandidates(input, options);
    const preserved = preserveCandidateState(result, detectedAgain);
    expect(preserved.candidates[0].draft.title.value).toBe("人工标题");
    expect(preserved.candidates[0].draft.title.manuallyEdited).toBe(true);
    expect(preserved.candidates[1].status).toBe("ignored");
    expect(preserved.selectedCount).toBe(1);
    expect(
      setCandidateStatus(preserved, preserved.candidates[1].id, "needs-review").candidates[1]
        .status,
    ).toBe("needs-review");
  });

  it("只允许合并相邻候选并可无损撤销", () => {
    const original = parseEventCandidates(input, options);
    const operation = mergeAdjacentCandidates(original, original.candidates[0].id, options);
    expect(operation).toBeDefined();
    expect(operation?.result.candidates).toHaveLength(1);
    expect(operation?.result.candidates[0].segment.boundaryReason).toBe("manual-merge");
    expect(operation?.result.candidates[0].mergedFrom).toHaveLength(2);
    expect(operation && undoCandidateMerge(operation)).toEqual(original);
    expect(mergeAdjacentCandidates(original, original.candidates[1].id, options)).toBeUndefined();
  });

  it("追加最后一段未分配文字后清除过期警告", () => {
    const result = parseEventCandidates(`${input}\n总备注：带证件`, options);
    const updated = appendUnassignedText(result, result.candidates[0].id, 0);
    expect(updated.unassignedText).toHaveLength(0);
    expect(updated.warnings.some((warning) => warning.code === "UNASSIGNED_TEXT")).toBe(false);
    expect(updated.candidates[0].draft.description.value).toContain("带证件");
  });
});
