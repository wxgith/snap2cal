import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

describe("App", () => {
  beforeEach(() => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:timetable"),
    });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  });

  it("displays the package-derived application version", () => {
    render(<App />);
    expect(screen.getByText("Snap2Cal v0.1.0")).toBeVisible();
  });

  it("解析、展示、编辑并保留手工修改标记", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(
      screen.getByLabelText("活动文本"),
      "2026年8月26日下午3点，在万达影城看电影，提前30分钟提醒",
    );
    await user.click(screen.getByRole("button", { name: "解析事件" }));
    expect(screen.getByLabelText("事件标题")).toHaveValue("看电影");
    expect(screen.getByLabelText("开始日期")).toHaveValue("2026-08-26");
    expect(screen.getByLabelText("开始时间")).toHaveValue("15:00");
    expect(screen.getByLabelText("地点")).toHaveValue("万达影城");
    await user.clear(screen.getByLabelText("事件标题"));
    await user.type(screen.getByLabelText("事件标题"), "周末电影");
    expect(screen.getByTestId("evidence-title")).toHaveTextContent("已手工修改");
  });

  it("清空恢复初始状态", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByLabelText("活动文本"), "今天开会");
    await user.click(screen.getByRole("button", { name: "清空" }));
    expect(screen.getByLabelText("活动文本")).toHaveValue("");
    expect(screen.queryByLabelText("事件标题")).not.toBeInTheDocument();
  });

  it("显示警告并在有错误时禁用下载", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByLabelText("活动文本"), "今天");
    await user.click(screen.getByRole("button", { name: "解析事件" }));
    expect(screen.getByText("未能可靠识别事件标题，请手工填写。")).toBeVisible();
    expect(screen.getByRole("button", { name: "下载 ICS" })).toBeDisabled();
  });

  it("延迟加载课程表，并在切换模式后保留课程表内存状态", async () => {
    const user = userEvent.setup();
    render(<App imageNormalizer={async (blob) => ({ blob, width: 640, height: 185 })} />);
    await user.click(screen.getByRole("button", { name: "课程表" }));
    await user.upload(
      await screen.findByLabelText("选择图片"),
      new File(["schedule"], "schedule.png", { type: "image/png" }),
    );
    expect(screen.getByTestId("image-preview")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "文字输入" }));
    expect(screen.getByLabelText("活动文本")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "课程表" }));
    expect(screen.getByTestId("image-preview")).toBeVisible();
  });

  it("延迟加载排班表，并在切换模式后保留排班表内存状态", async () => {
    const user = userEvent.setup();
    render(<App imageNormalizer={async (blob) => ({ blob, width: 600, height: 180 })} />);
    await user.click(screen.getByRole("button", { name: "排班表" }));
    await user.upload(
      await screen.findByLabelText("选择图片"),
      new File(["roster"], "roster.png", { type: "image/png" }),
    );
    expect(screen.getByTestId("image-preview")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "文字输入" }));
    expect(screen.getByLabelText("活动文本")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "排班表" }));
    expect(screen.getByTestId("image-preview")).toBeVisible();
  });
});
