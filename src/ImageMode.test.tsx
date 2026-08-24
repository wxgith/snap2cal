import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { ImageNormalizer } from "./components/ImageOcrWorkspace";
import { MockOcrAdapter } from "./ocr/MockOcrAdapter";
import { OcrError } from "./ocr/types";
import type { OcrAdapter, OcrRawResult } from "./ocr/types";

const normalize: ImageNormalizer = async (file) => ({ blob: file, width: 400, height: 240 });

describe("图片 OCR 模式", () => {
  beforeEach(() => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:preview"),
    });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  });

  it("上传、识别、校对、忽略、解析并高亮字段证据", async () => {
    const user = userEvent.setup();
    render(
      <App ocrAdapterFactory={async () => new MockOcrAdapter()} imageNormalizer={normalize} />,
    );
    await user.click(screen.getByRole("button", { name: "图片识别" }));
    await user.upload(
      screen.getByLabelText("选择图片"),
      new File(["image"], "event.png", { type: "image/png" }),
    );
    expect(await screen.findByTestId("image-preview")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "开始识别" }));
    expect(await screen.findByLabelText("OCR 文本块 1")).toHaveValue("8月26日");
    expect(screen.getAllByTestId("ocr-box")).toHaveLength(4);
    await user.clear(screen.getByLabelText("OCR 文本块 1"));
    await user.type(screen.getByLabelText("OCR 文本块 1"), "8月27日");
    expect(screen.getByText("已人工校对")).toBeVisible();
    const ignoreButtons = screen.getAllByRole("button", { name: "忽略" });
    await user.click(ignoreButtons[3]);
    expect(screen.getByRole("button", { name: "恢复" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "恢复" }));
    await user.click(screen.getByRole("button", { name: "解析事件" }));
    expect((screen.getByLabelText("开始日期") as HTMLInputElement).value).toMatch(/-08-27$/);
    expect(screen.getByLabelText("开始时间")).toHaveValue("15:00");
    expect(screen.getByLabelText("地点")).toHaveValue("万达影城");
    await user.click(screen.getByLabelText("开始时间"));
    expect(screen.getAllByTestId("ocr-box").some((box) => box.dataset.selected === "true")).toBe(
      true,
    );
    expect(screen.getByTestId("evidence-startTime")).toHaveTextContent("OCR 置信度");
    await user.clear(screen.getByLabelText("事件标题"));
    await user.type(screen.getByLabelText("事件标题"), "保留标题");
    await user.click(screen.getByRole("button", { name: "重新解析并保留手工修改" }));
    expect(screen.getByLabelText("事件标题")).toHaveValue("保留标题");
  });

  it("粘贴图片并在删除或卸载时释放 Object URL", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <App ocrAdapterFactory={async () => new MockOcrAdapter()} imageNormalizer={normalize} />,
    );
    await user.click(screen.getByRole("button", { name: "图片识别" }));
    const section = screen.getByRole("heading", { name: "本地图片识别" }).closest("section")!;
    const file = new File(["image"], "pasted.png", { type: "image/png" });
    fireEvent.paste(section, {
      clipboardData: { items: [{ type: "image/png", getAsFile: () => file }] },
    });
    expect(await screen.findByTestId("image-preview")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "删除图片" }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
    unmount();
  });

  it("识别可取消且会释放适配器", async () => {
    const user = userEvent.setup();
    const adapter = new MockOcrAdapter({ delayMs: 30 });
    render(<App ocrAdapterFactory={async () => adapter} imageNormalizer={normalize} />);
    await user.click(screen.getByRole("button", { name: "图片识别" }));
    await user.upload(
      screen.getByLabelText("选择图片"),
      new File(["x"], "event.png", { type: "image/png" }),
    );
    await user.click(screen.getByRole("button", { name: "开始识别" }));
    expect(screen.getByRole("progressbar")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "取消识别" }));
    await waitFor(() => expect(adapter.disposed).toBe(true));
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("更换图片后旧任务晚返回也不能覆盖新结果", async () => {
    const user = userEvent.setup();
    let resolveOld!: (result: OcrRawResult) => void;
    const oldAdapter: OcrAdapter = {
      recognize: () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
      dispose: vi.fn(async () => undefined),
    };
    let factoryCalls = 0;
    render(
      <App
        ocrAdapterFactory={async () => (factoryCalls++ === 0 ? oldAdapter : new MockOcrAdapter())}
        imageNormalizer={normalize}
      />,
    );
    await user.click(screen.getByRole("button", { name: "图片识别" }));
    await user.upload(
      screen.getByLabelText("选择图片"),
      new File(["first"], "first.png", { type: "image/png" }),
    );
    await user.click(screen.getByRole("button", { name: "开始识别" }));
    await user.upload(
      screen.getByLabelText("更换图片"),
      new File(["second"], "second.png", { type: "image/png" }),
    );
    await user.click(screen.getByRole("button", { name: "开始识别" }));
    expect(await screen.findByLabelText("OCR 文本块 1")).toHaveValue("8月26日");
    resolveOld({
      blocks: [
        {
          text: "旧任务",
          confidence: 1,
          bbox: { x: 0, y: 0, width: 10, height: 10 },
          lineIndex: 0,
          orderIndex: 0,
        },
      ],
    });
    await waitFor(() => expect(screen.queryByDisplayValue("旧任务")).not.toBeInTheDocument());
    expect(oldAdapter.dispose).toHaveBeenCalled();
  });

  it("显示图片校验错误并可切回文字模式", async () => {
    const user = userEvent.setup();
    render(
      <App
        imageNormalizer={async () => {
          throw new OcrError("UNSUPPORTED_IMAGE_TYPE", "不支持该图片类型，请更换文件。");
        }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "图片识别" }));
    await user.upload(
      screen.getByLabelText("选择图片"),
      new File(["x"], "bad.png", { type: "image/png" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("UNSUPPORTED_IMAGE_TYPE");
    await user.click(screen.getByRole("button", { name: "文字输入" }));
    expect(screen.getByLabelText("活动文本")).toBeVisible();
  });

  it("从一张图片生成多个候选并分别高亮候选与字段证据", async () => {
    const user = userEvent.setup();
    const multiResult: OcrRawResult = {
      blocks: [
        {
          text: "8月26日",
          confidence: 0.96,
          bbox: { x: 10, y: 10, width: 100, height: 20 },
          lineIndex: 0,
          orderIndex: 0,
        },
        {
          text: "09:00 项目评审",
          confidence: 0.94,
          bbox: { x: 10, y: 40, width: 180, height: 20 },
          lineIndex: 1,
          orderIndex: 1,
        },
        {
          text: "14:00 客户沟通",
          confidence: 0.92,
          bbox: { x: 10, y: 70, width: 180, height: 20 },
          lineIndex: 2,
          orderIndex: 2,
        },
        {
          text: "19:00 团队晚餐",
          confidence: 0.9,
          bbox: { x: 10, y: 100, width: 180, height: 20 },
          lineIndex: 3,
          orderIndex: 3,
        },
      ],
    };
    render(
      <App
        ocrAdapterFactory={async () => new MockOcrAdapter({ result: multiResult })}
        imageNormalizer={normalize}
      />,
    );
    await user.click(screen.getByRole("button", { name: "图片识别" }));
    await user.upload(
      screen.getByLabelText("选择图片"),
      new File(["image"], "multi.png", { type: "image/png" }),
    );
    await user.click(screen.getByRole("button", { name: "开始识别" }));
    expect(await screen.findByLabelText("OCR 文本块 4")).toHaveValue("19:00 团队晚餐");
    await user.click(screen.getByRole("button", { name: "解析事件" }));
    expect(screen.getByRole("heading", { name: "发现 3 个事件候选" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "查看候选 2 原图证据" }));
    expect(screen.getAllByTestId("ocr-box").some((box) => box.dataset.selected === "true")).toBe(
      true,
    );
    await user.click(screen.getByLabelText("候选 2 开始时间"));
    expect(screen.getByLabelText("候选 2 开始时间")).toHaveValue("14:00");
    await user.clear(screen.getByLabelText("候选 2 事件标题"));
    await user.type(screen.getByLabelText("候选 2 事件标题"), "人工客户沟通");
    await user.click(screen.getByRole("button", { name: "重新解析并保留手工修改" }));
    expect(screen.getByLabelText("候选 2 事件标题")).toHaveValue("人工客户沟通");
  });
});
