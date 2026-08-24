import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockOcrAdapter, MOCK_ROSTER_RESULT } from "../ocr/MockOcrAdapter";
import { MockGridDetector } from "../schedule-table/MockGridDetector";
import ShiftRosterWorkspace from "./ShiftRosterWorkspace";

describe("ShiftRosterWorkspace", () => {
  beforeEach(() => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:roster"),
    });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  });

  it("完成跨夜、skip、单次排除及个人和团队导出闭环", async () => {
    const user = userEvent.setup();
    const onDownload = vi.fn();
    render(
      <ShiftRosterWorkspace
        ocrAdapterFactory={async () => new MockOcrAdapter({ result: MOCK_ROSTER_RESULT })}
        imageNormalizer={async (blob) => ({ blob, width: 600, height: 180 })}
        imageDataLoader={async () =>
          ({ width: 600, height: 180, data: new Uint8ClampedArray(600 * 180 * 4) }) as ImageData
        }
        gridDetectorFactory={async () =>
          new MockGridDetector({
            horizontalPositions: [0, 50, 115, 180],
            verticalPositions: [0, 120, 240, 360, 480, 600],
          })
        }
        onDownload={onDownload}
        onMessage={vi.fn()}
      />,
    );
    await user.upload(
      screen.getByLabelText("选择图片"),
      new File(["roster"], "roster.png", { type: "image/png" }),
    );
    await user.click(screen.getByRole("button", { name: "开始识别" }));
    await waitFor(() => expect(screen.getByLabelText("OCR 文本块 15")).toHaveValue("OFF"));
    await user.click(screen.getByRole("button", { name: "检测排班表" }));
    await waitFor(() => expect(screen.getByTestId("roster-grid-overlay")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "确认网格" }));
    expect(screen.getByLabelText("排班日期标题行")).toHaveValue("0");
    expect(screen.getByLabelText("排班人员姓名列")).toHaveValue("0");
    await user.type(screen.getByLabelText("排班年份"), "2026");
    await user.type(screen.getByLabelText("排班月份"), "9");
    await user.click(screen.getByRole("button", { name: "确认人员和日期" }));
    expect(screen.getByLabelText("日期列 2")).toHaveValue("2026-09-01");
    expect(screen.getByLabelText("人员 2 姓名")).toHaveValue("张三");

    await user.clear(screen.getByLabelText("班次 1 名称"));
    await user.type(screen.getByLabelText("班次 1 名称"), "早班");
    await user.type(screen.getByLabelText("班次 1 开始时间"), "08:00");
    await user.type(screen.getByLabelText("班次 1 结束时间"), "16:00");
    await user.click(screen.getAllByRole("button", { name: "确认班次定义" })[0]);

    await user.clear(screen.getByLabelText("班次 2 名称"));
    await user.type(screen.getByLabelText("班次 2 名称"), "夜班");
    await user.type(screen.getByLabelText("班次 2 开始时间"), "20:00");
    await user.type(screen.getByLabelText("班次 2 结束时间"), "08:00");
    await user.click(screen.getByLabelText("班次 2 跨午夜"));
    await user.click(screen.getAllByRole("button", { name: "确认班次定义" })[1]);

    await user.selectOptions(screen.getByLabelText("班次 3 类型"), "skip");
    await user.clear(screen.getByLabelText("班次 3 名称"));
    await user.type(screen.getByLabelText("班次 3 名称"), "休息");
    await user.click(screen.getAllByRole("button", { name: "确认班次定义" })[2]);

    await user.click(screen.getByRole("button", { name: "生成班次事件" }));
    expect(screen.getAllByRole("checkbox", { name: /^导出 / })).toHaveLength(6);
    expect(screen.getByText(/2026-09-02 · 张三 · 夜班/)).toBeVisible();
    expect(screen.getAllByText("20:00-次日 08:00")).toHaveLength(2);

    const septemberFourth = screen.getByLabelText("导出 2026-09-04 张三 早班");
    await user.click(septemberFourth);
    await user.click(screen.getByRole("button", { name: "下载个人排班 ICS" }));
    expect(onDownload).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: expect.stringContaining("shift-occurrence:") }),
      ]),
      "张三-2026-09-排班-Snap2Cal.ics",
    );
    expect(onDownload.mock.calls.at(-1)?.[0]).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "下载团队排班 ICS" }));
    expect(onDownload.mock.calls.at(-1)?.[0]).toHaveLength(5);
    expect(onDownload.mock.calls.at(-1)?.[0][0].title.value).toMatch(/^张三 · /);

    const matrixButton = screen.getByRole("button", { name: "张三 2026-09-01 班次 A" });
    await user.click(matrixButton);
    const editor = screen
      .getByLabelText("活动 assignment 班次代码")
      .closest<HTMLElement>(".roster-assignment-editor")!;
    expect(within(editor).getByText("OCR 原文：A")).toBeVisible();
    await user.clear(screen.getByLabelText("活动 assignment 班次代码"));
    await user.type(screen.getByLabelText("活动 assignment 班次代码"), "N");
    expect(within(editor).getByText("OCR 原文：A")).toBeVisible();
  }, 15_000);
});
