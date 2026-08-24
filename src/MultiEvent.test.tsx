import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const threeEvents = [
  "- 8月26日上午9点，在公司会议室开项目评审会",
  "- 8月27日下午2点，在客户办公室开需求沟通会",
  "- 8月28日晚上7点，在餐厅吃团队晚餐",
].join("\n");

describe("多事件候选界面", () => {
  beforeEach(() => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:calendar"),
    });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  });

  it("检测、编辑、忽略、恢复并保留状态", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByLabelText("活动文本"), threeEvents);
    await user.click(screen.getByRole("button", { name: "解析事件" }));
    expect(screen.getByRole("heading", { name: "发现 3 个事件候选" })).toBeVisible();
    const second = screen.getByTestId("candidate-2");
    const third = screen.getByTestId("candidate-3");
    expect(within(second).getByLabelText("候选 2 事件标题")).toHaveValue("需求沟通会");
    await user.clear(within(second).getByLabelText("候选 2 事件标题"));
    await user.type(within(second).getByLabelText("候选 2 事件标题"), "客户需求确认");
    expect(within(second).getByText("已手工修改")).toBeInTheDocument();
    await user.click(within(third).getByRole("button", { name: "忽略候选 3" }));
    expect(within(third).getByLabelText("导出候选 3")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "重新检测事件边界" }));
    expect(screen.getByLabelText("候选 2 事件标题")).toHaveValue("客户需求确认");
    expect(screen.getByRole("button", { name: "恢复候选 3" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "恢复候选 3" }));
    expect(screen.getByRole("button", { name: "忽略候选 3" })).toBeVisible();
  });

  it("合并相邻候选并撤销", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByLabelText("活动文本"), threeEvents);
    await user.click(screen.getByRole("button", { name: "解析事件" }));
    await user.click(screen.getByRole("button", { name: "合并候选 1 与下一个" }));
    expect(screen.getByRole("heading", { name: "发现 2 个事件候选" })).toBeVisible();
    expect(screen.getByText("边界：手工合并")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "撤销最近合并" }));
    expect(screen.getByRole("heading", { name: "发现 3 个事件候选" })).toBeVisible();
  });

  it("无效候选被选择时阻止批量下载，有效选择可触发下载", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.selectOptions(screen.getByRole("combobox", { name: "事件识别模式" }), "multiple");
    await user.type(screen.getByLabelText("活动文本"), "- 今天\n- 8月26日上午9点 项目评审");
    await user.click(screen.getByRole("button", { name: "解析事件" }));
    await user.click(screen.getByRole("button", { name: "全选" }));
    expect(screen.getByRole("button", { name: "下载所选事件 ICS" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "只选有效" }));
    expect(screen.getByRole("button", { name: "下载所选事件 ICS" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "下载所选事件 ICS" }));
    expect(URL.createObjectURL).toHaveBeenCalledWith(
      expect.objectContaining({ type: "text/calendar;charset=utf-8" }),
    );
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
  });

  it("多事件模式下清空恢复初始状态", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByLabelText("活动文本"), threeEvents);
    await user.click(screen.getByRole("button", { name: "解析事件" }));
    await user.click(screen.getByRole("button", { name: "清空" }));
    expect(screen.getByLabelText("活动文本")).toHaveValue("");
    expect(screen.queryByTestId("candidate-1")).not.toBeInTheDocument();
  });

  it("切换为单事件模式后重新解析会退出候选界面", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByLabelText("活动文本"), threeEvents);
    await user.click(screen.getByRole("button", { name: "解析事件" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "事件识别模式" }), "single");
    await user.click(screen.getByRole("button", { name: "重新解析并保留手工修改" }));
    expect(screen.queryByRole("heading", { name: /个事件候选/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText("事件标题")).toBeInTheDocument();
  });
});
