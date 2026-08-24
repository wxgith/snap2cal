import { describe, expect, it, vi } from "vitest";
import { MockOcrAdapter } from "./MockOcrAdapter";
import { OcrError } from "./types";

describe("MockOcrAdapter", () => {
  it("返回确定结果并报告所有进度阶段", async () => {
    const onProgress = vi.fn();
    const adapter = new MockOcrAdapter();
    const result = await adapter.recognize(new Blob(["x"]), {
      languages: ["chi_sim", "eng"],
      onProgress,
    });
    expect(result.blocks).toHaveLength(4);
    expect(onProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ stage: "completed", progress: 1 }),
    );
  });
  it("传递初始化或识别失败", async () => {
    const adapter = new MockOcrAdapter({
      failWith: new OcrError("OCR_INITIALIZATION_FAILED", "初始化失败"),
    });
    await expect(
      adapter.recognize(new Blob(["x"]), { languages: ["chi_sim"] }),
    ).rejects.toMatchObject({ code: "OCR_INITIALIZATION_FAILED" });
  });
  it("支持取消", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      new MockOcrAdapter().recognize(new Blob(["x"]), {
        languages: ["eng"],
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "OCR_CANCELLED" });
  });
  it("dispose 释放适配器", async () => {
    const adapter = new MockOcrAdapter();
    await adapter.dispose();
    expect(adapter.disposed).toBe(true);
  });
});
