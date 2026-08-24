import { describe, expect, it } from "vitest";
import { parseEventText } from ".";

const options = {
  referenceDateTime: new Date("2026-08-23T10:00:00+08:00"),
  timeZone: "Asia/Shanghai",
};

describe("parseEventText", () => {
  it("解析电影示例", () => {
    const event = parseEventText("8月26日下午3点，在万达影城看电影，提前30分钟提醒", options);
    expect({
      title: event.title.value,
      startDate: event.startDate.value,
      startTime: event.startTime.value,
      location: event.location.value,
      reminder: event.reminderMinutes.value,
      allDay: event.allDay.value,
    }).toEqual({
      title: "看电影",
      startDate: "2026-08-26",
      startTime: "15:00",
      location: "万达影城",
      reminder: 30,
      allDay: false,
    });
  });

  it("解析会议时间范围", () => {
    const event = parseEventText(
      "明天上午9点到11点，在公司三楼会议室开项目评审会，提前1小时提醒",
      options,
    );
    expect({
      title: event.title.value,
      startDate: event.startDate.value,
      startTime: event.startTime.value,
      endDate: event.endDate.value,
      endTime: event.endTime.value,
      location: event.location.value,
      reminder: event.reminderMinutes.value,
    }).toEqual({
      title: "项目评审会",
      startDate: "2026-08-24",
      startTime: "09:00",
      endDate: "2026-08-24",
      endTime: "11:00",
      location: "公司三楼会议室",
      reminder: 60,
    });
  });

  it("解析全天事件", () => {
    const event = parseEventText("2026年9月3日全天，新生报到，地点：学校体育馆", options);
    expect({
      title: event.title.value,
      startDate: event.startDate.value,
      location: event.location.value,
      allDay: event.allDay.value,
    }).toEqual({
      title: "新生报到",
      startDate: "2026-09-03",
      location: "学校体育馆",
      allDay: true,
    });
  });

  it("多个日期优先活动时间标签并列出候选", () => {
    const event = parseEventText("报名截止8月25日，活动时间8月28日下午3点", options);
    expect(event.startDate.value).toBe("2026-08-28");
    expect(event.warnings).toContainEqual(
      expect.objectContaining({
        code: "MULTIPLE_DATE_CANDIDATES",
        message: expect.stringContaining("8月25日"),
      }),
    );
  });
});
