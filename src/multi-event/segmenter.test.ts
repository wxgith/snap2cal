import { describe, expect, it } from "vitest";
import { segmentEventText } from "./segmenter";

describe("segmentEventText", () => {
  it("按每行完整事件拆分并为单事件回退", () => {
    const multi = segmentEventText(
      "8月26日上午9点 项目评审\n8月27日下午2点 客户沟通\n8月28日全天 团建",
    );
    expect(multi.segments).toHaveLength(3);
    expect(multi.segments.map((item) => item.boundaryReason)).toEqual([
      "date-prefix",
      "date-prefix",
      "date-prefix",
    ]);
    const single = segmentEventText("8月26日下午3点，在万达影城看电影");
    expect(single.segments).toHaveLength(1);
    expect(single.segments[0].boundaryReason).toBe("single-event-fallback");
  });

  it.each([
    ["- 8月26日上午9点 项目评审\n* 8月27日下午2点 客户沟通", "bullet"],
    ["1. 8月26日上午9点 项目评审\n2、8月27日下午2点 客户沟通", "numbered-item"],
    ["（1）8月26日上午9点 项目评审\n二、8月27日下午2点 客户沟通", "numbered-item"],
    ["活动一：8月26日上午9点 项目评审\n事件2：8月27日下午2点 客户沟通", "explicit-label"],
  ])("识别列表边界 %#", (input, reason) => {
    const result = segmentEventText(input);
    expect(result.segments).toHaveLength(2);
    expect(result.segments.every((item) => item.boundaryReason === reason)).toBe(true);
  });

  it("按空行分隔多行事件组", () => {
    const input = "8月26日\n上午9点\n项目评审\r\n\r\n8月27日\n下午2点\n客户沟通";
    const result = segmentEventText(input);
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0].source.text).toBe("8月26日\n上午9点\n项目评审");
    expect(result.segments[1].source.text).toContain("8月27日");
  });

  it("继承共享日期、共享地点及组合标题", () => {
    const date = segmentEventText("8月26日\n09:00 项目评审\n14:00 客户沟通\n19:00 团队晚餐");
    expect(date.segments).toHaveLength(3);
    expect(date.segments.every((item) => item.inheritedContext.date?.value === "8月26日")).toBe(
      true,
    );

    const location = segmentEventText(
      "地点：公司三楼\n8月26日09:00 项目评审\n8月27日14:00 客户沟通",
    );
    expect(location.segments).toHaveLength(2);
    expect(location.segments[1].inheritedContext.location?.value).toBe("公司三楼");

    const combined = segmentEventText("8月26日 地点：公司三楼\n09:00 项目评审\n14:00 客户沟通");
    expect(combined.segments).toHaveLength(2);
    expect(combined.segments[0].inheritedContext.date?.value).toBe("8月26日");
    expect(combined.segments[0].inheritedContext.location?.value).toBe("公司三楼");
  });

  it("仅在分号两侧都有完整事件结构时拆分", () => {
    expect(
      segmentEventText("8月26日上午9点 项目评审；8月27日下午2点 客户沟通").segments,
    ).toHaveLength(2);
    expect(segmentEventText("8月26日上午9点 项目评审；记得带资料").segments).toHaveLength(1);
    expect(
      segmentEventText("8月26日上午9点 项目评审；8月27日下午2点 客户沟通；8月28日晚上7点 团队晚餐")
        .segments,
    ).toHaveLength(3);
  });

  it("新日期和新章节会停止共享日期传播", () => {
    const result = segmentEventText(
      "8月26日\n09:00 项目评审\n14:00 客户沟通\n8月27日上午10点 新活动\n其他事项：\n16:00 普通备注",
    );
    expect(result.segments[2].inheritedContext.date).toBeUndefined();
    expect(result.unassignedText.some((item) => item.text === "其他事项：")).toBe(true);
  });

  it("限制为 50 个候选且保留溢出文字", () => {
    const input = Array.from(
      { length: 51 },
      (_, index) => `- 8月26日上午9点 活动${index + 1}`,
    ).join("\n");
    const result = segmentEventText(input);
    expect(result.segments).toHaveLength(50);
    expect(result.unassignedText.at(-1)?.text).toContain("活动51");
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: "CANDIDATE_LIMIT_REACHED" }),
    );
  });

  it("保留 CRLF、emoji 和重复文字的 UTF-16 原始索引", () => {
    const input = "说明😀\r\n- 8月26日上午9点 重复\r\n- 8月27日下午2点 重复";
    const result = segmentEventText(input);
    expect(result.segments).toHaveLength(2);
    for (const segment of result.segments) {
      expect(input.slice(segment.source.startIndex, segment.source.endIndex)).toBe(
        segment.source.text,
      );
    }
    expect(result.segments[1].source.startIndex).toBe(input.lastIndexOf("8月27日"));
  });

  it("相同输入产生稳定候选 ID", () => {
    const input = "- 8月26日上午9点 项目评审\n- 8月27日下午2点 客户沟通";
    expect(segmentEventText(input).segments.map((item) => item.id)).toEqual(
      segmentEventText(input).segments.map((item) => item.id),
    );
  });
});
