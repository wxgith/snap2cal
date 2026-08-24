import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockOcrAdapter, MOCK_SCHEDULE_RESULT } from "../ocr/MockOcrAdapter";
import { MockGridDetector } from "../schedule-table/MockGridDetector";
import ScheduleTableWorkspace from "./ScheduleTableWorkspace";

describe("ScheduleTableWorkspace", () => {
  beforeEach(() => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:schedule"),
    });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  });

  it("完成 OCR、网格确认、课程生成、单次排除和导出闭环", async () => {
    const user = userEvent.setup();
    const onDownload = vi.fn();
    render(
      <ScheduleTableWorkspace
        ocrAdapterFactory={async () => new MockOcrAdapter({ result: MOCK_SCHEDULE_RESULT })}
        imageNormalizer={async (blob) => ({ blob, width: 640, height: 185 })}
        imageDataLoader={async () =>
          ({ width: 640, height: 185, data: new Uint8ClampedArray(640 * 185 * 4) }) as ImageData
        }
        gridDetectorFactory={async () => new MockGridDetector()}
        onDownload={onDownload}
        onMessage={vi.fn()}
      />,
    );
    await user.upload(
      screen.getByLabelText("选择图片"),
      new File(["schedule"], "schedule.png", { type: "image/png" }),
    );
    await user.click(screen.getByRole("button", { name: "开始识别" }));
    await waitFor(() => expect(screen.getByLabelText("OCR 文本块 12")).toHaveValue("双周"));
    await user.click(screen.getByRole("button", { name: "检测课程表" }));
    await waitFor(() => expect(screen.getByTestId("schedule-grid-overlay")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "确认网格" }));
    expect(screen.getByLabelText("第 2 行开始时间")).toHaveValue("08:00");
    expect(screen.getByLabelText("第 3 行结束时间")).toHaveValue("11:40");
    await user.click(screen.getByRole("button", { name: "确认表头和时间" }));
    await user.type(screen.getByLabelText("第一教学周的星期一日期"), "2026-09-07");
    await user.clear(screen.getByLabelText("本学期总周数"));
    await user.type(screen.getByLabelText("本学期总周数"), "4");
    await user.click(screen.getByRole("button", { name: "生成课程模板与具体事件" }));
    expect(screen.getByRole("heading", { name: "课程模板与具体事件" })).toBeVisible();
    expect(screen.getByLabelText("课程 1 名称")).toHaveValue("高等数学");
    expect(screen.getAllByRole("checkbox", { name: /^包含 / })).toHaveLength(6);
    await user.click(screen.getByLabelText("包含 2026-09-21 高等数学"));
    await user.click(screen.getByRole("button", { name: "下载全部选中课程 ICS" }));
    expect(onDownload).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: expect.stringContaining("occurrence:") }),
      ]),
      "2026-09-07-5-classes-snap2cal.ics",
    );
    expect(onDownload.mock.calls[0][0]).toHaveLength(5);
  });
});
