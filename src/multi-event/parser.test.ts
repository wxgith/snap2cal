import { describe, expect, it } from "vitest";
import { parseEventCandidates } from "./parser";

const options = {
  referenceDateTime: new Date("2026-08-23T10:00:00+08:00"),
  timeZone: "Asia/Shanghai",
};

describe("parseEventCandidates", () => {
  it("复用单事件解析器生成多个候选", () => {
    const result = parseEventCandidates(
      "- 8月26日上午9点，在公司会议室开项目评审会\n- 8月27日下午2点，在客户办公室开需求沟通会",
      options,
    );
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0].draft.title.value).toBe("项目评审会");
    expect(result.candidates[1].draft.startDate.value).toBe("2026-08-27");
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: "MULTI_EVENT_DETECTED" }),
    );
  });

  it("共享上下文字段指回真实标题 SourceSpan", () => {
    const input = "8月26日 地点：公司三楼\n09:00 项目评审\n14:00 客户沟通";
    const result = parseEventCandidates(input, options);
    const second = result.candidates[1];
    expect(second.draft.startDate.value).toBe("2026-08-26");
    expect(second.draft.location.value).toBe("公司三楼");
    expect(second.draft.startDate.source).toEqual(
      expect.objectContaining({ startIndex: input.indexOf("8月26日"), text: "8月26日" }),
    );
    expect(second.draft.location.source).toEqual(
      expect.objectContaining({ startIndex: input.indexOf("公司三楼"), text: "公司三楼" }),
    );
    expect(second.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(["SHARED_DATE_INHERITED", "SHARED_LOCATION_INHERITED"]),
    );
  });

  it("候选自己的显式地点优先且不显示为继承", () => {
    const result = parseEventCandidates(
      "地点：公司三楼\n8月26日上午9点，在一楼会议室开项目评审会\n8月27日下午2点 客户沟通",
      options,
    );
    expect(result.candidates[0].draft.location.value).toBe("一楼会议室");
    expect(result.candidates[0].segment.inheritedContext.location).toBeUndefined();
    expect(result.candidates[1].segment.inheritedContext.location?.value).toBe("公司三楼");
  });

  it("候选置信度与字段置信度分开", () => {
    const result = parseEventCandidates("8月26日\n09:00 项目评审\n14:00 客户沟通", options);
    expect(result.candidates[0].confidence).toBe("medium");
    expect(result.candidates[0].draft.startTime.confidence).toBe("high");
  });

  it("保守标记重复事件但不删除", () => {
    const result = parseEventCandidates(
      "- 8月26日上午9点，在公司会议室开项目评审会\n- 8月26日上午9点，在公司会议室开项目评审会",
      options,
    );
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[1].duplicateOf).toBe(result.candidates[0].id);
    expect(result.candidates[1].selectedForExport).toBe(true);
  });

  it("未识别尾注仍保留", () => {
    const result = parseEventCandidates(
      "8月26日上午9点 项目评审\n8月27日下午2点 客户沟通\n总备注：请携带证件",
      options,
    );
    expect(result.unassignedText).toContainEqual(
      expect.objectContaining({ text: "总备注：请携带证件", reason: "trailing-note" }),
    );
  });

  it("空输入和无候选输入返回稳定错误", () => {
    expect(parseEventCandidates("   ", options).warnings).toContainEqual(
      expect.objectContaining({ code: "EMPTY_INPUT" }),
    );
    expect(parseEventCandidates("仅供参考", options).warnings).toContainEqual(
      expect.objectContaining({ code: "NO_EVENT_CANDIDATE" }),
    );
  });
});
