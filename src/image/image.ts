import { OcrError } from "../ocr/types";

export const IMAGE_LIMITS = {
  maxFileSizeBytes: 8 * 1024 * 1024,
  maxPixelCount: 25_000_000,
  maxWidth: 8_000,
  maxHeight: 8_000,
} as const;

export const SUPPORTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export interface ImageDimensions {
  width: number;
  height: number;
}
export interface NormalizedImage extends ImageDimensions {
  blob: Blob;
}

export function validateImageMetadata(file: Blob, dimensions?: ImageDimensions): void {
  if (!SUPPORTED_IMAGE_TYPES.includes(file.type as (typeof SUPPORTED_IMAGE_TYPES)[number]))
    throw new OcrError("UNSUPPORTED_IMAGE_TYPE", "仅支持 PNG、JPEG 或 WebP 图片，请更换文件。");
  if (file.size === 0) throw new OcrError("IMAGE_DECODE_FAILED", "图片文件为空，请重新选择。");
  if (file.size > IMAGE_LIMITS.maxFileSizeBytes)
    throw new OcrError("IMAGE_TOO_LARGE", "图片超过 8 MB，请压缩后重试。");
  if (dimensions) {
    if (dimensions.width <= 0 || dimensions.height <= 0)
      throw new OcrError("IMAGE_DECODE_FAILED", "图片宽高无效，请重新导出图片后重试。");
    if (
      dimensions.width > IMAGE_LIMITS.maxWidth ||
      dimensions.height > IMAGE_LIMITS.maxHeight ||
      dimensions.width * dimensions.height > IMAGE_LIMITS.maxPixelCount
    )
      throw new OcrError(
        "IMAGE_DIMENSIONS_TOO_LARGE",
        "图片像素尺寸过大，请缩小到 2500 万像素以内。",
      );
  }
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new OcrError("IMAGE_DECODE_FAILED", "浏览器无法规范化这张图片。")),
      "image/png",
    );
  });
}

export async function normalizeImage(file: Blob): Promise<NormalizedImage> {
  validateImageMetadata(file);
  if (typeof createImageBitmap !== "function")
    throw new OcrError("IMAGE_DECODE_FAILED", "当前浏览器不支持安全图片解码，请升级浏览器后重试。");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new OcrError("IMAGE_DECODE_FAILED", "图片无法解码，可能已损坏或格式与 MIME 不符。");
  }
  try {
    validateImageMetadata(file, { width: bitmap.width, height: bitmap.height });
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new OcrError("IMAGE_DECODE_FAILED", "浏览器无法创建图片处理画布。");
    context.drawImage(bitmap, 0, 0);
    return { blob: await canvasToBlob(canvas), width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}
