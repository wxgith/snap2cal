import { afterEach, describe, expect, it, vi } from "vitest";
import { IMAGE_LIMITS, normalizeImage, validateImageMetadata } from "./image";

describe("image validation", () => {
  it.each(["image/png", "image/jpeg", "image/webp"])("接受 %s", (type) =>
    expect(() =>
      validateImageMetadata(new Blob(["ok"], { type }), { width: 100, height: 100 }),
    ).not.toThrow(),
  );
  it("拒绝 SVG 和错误 MIME", () =>
    expect(() => validateImageMetadata(new Blob(["x"], { type: "image/svg+xml" }))).toThrow(
      "仅支持",
    ));
  it("拒绝空文件", () =>
    expect(() => validateImageMetadata(new Blob([], { type: "image/png" }))).toThrow("为空"));
  it("拒绝过大文件", () =>
    expect(() =>
      validateImageMetadata(
        new Blob([new Uint8Array(IMAGE_LIMITS.maxFileSizeBytes + 1)], { type: "image/png" }),
      ),
    ).toThrow("8 MB"));
  it("拒绝过大像素和零尺寸", () => {
    const file = new Blob(["x"], { type: "image/png" });
    expect(() => validateImageMetadata(file, { width: 9000, height: 10 })).toThrow("像素");
    expect(() => validateImageMetadata(file, { width: 0, height: 10 })).toThrow("宽高");
  });
  it("显示图片解码失败", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new Error("bad")));
    await expect(normalizeImage(new Blob(["bad"], { type: "image/png" }))).rejects.toThrow(
      "无法解码",
    );
  });
  afterEach(() => vi.unstubAllGlobals());
});
